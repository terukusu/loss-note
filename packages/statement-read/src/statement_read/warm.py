"""先立ての CLI（Issue #65・ADR-0013）。明細の読み取りの CLI を 1 つ先に起動して待たせ、1 回の読み取りに使ったら捨てる。

要求ごとに CLI を起動して終わらせる手間（本番で約 4.7 秒）を、利用者が画像を貼る前に済ませる。本番は最小 0 台・
要求の処理中だけ CPU（ADR-0009）なので、先立ては CPU が割り当てられている間（起動の段・準備の要求）にだけ行う
（呼ぶ側が決める）。

- 先立て（slot）は最大 1 つ。slot 1 つ = 要求ごとの一時ディレクトリ 1 つ + SDK の ``query()`` 1 回（使い回さない。
  前の要求の画像・会話が CLI に残らない）。子の環境・一時ディレクトリの作りは ``agent_reader`` と同じ
  （``option_kwargs``。方式ごとの許可リスト・isolated_env）
- SDK の ``query()`` は「子の起動 → initialize → prompt の stream を読む」の順。prompt の generator の最初の yield を
  仕事が渡されるまで待たせる。generator が読まれ始めた = 立ち上がった（ready）
- 起動から後始末までを背後のスレッドの event loop の 1 つの task で行う（SDK のクライアントは同じ async の文脈で使う）。
  締め切りは anyio の CancelScope の deadline を付け替える: 起動の上限（startup）→ ready で「作ってから ttl」→
  取ったら「取った時点から timeout」。取り消しの後始末（子の stdin を閉じ → SIGTERM → SIGKILL）は SDK の shield の中
- 読み取り（``read``）は lock の下で slot を 1 つだけ取る（同時の 2 つ目は None = 呼ぶ側がその場で立てる）。結果は
  CLI を止めて一時ディレクトリを消してから返す（応答の後は CPU が止まりうるので、後始末を後回しにしない）
- 画像を送る前に slot が失敗した（起動の失敗・期限切れ）ときは None を返す（呼ぶ側が残りの時間でその場で立てる。
  AI へ送るのは 1 回）
- federation: slot を立てるときに ID トークンを取ってファイル（0600）に置き（CLI が起動の近くでも読むため）、読み取りの
  要求ごとのトークンで送る直前に差し替える（CLI のファイルの provider は交換のたびにファイルを読む）
- 期限: 作ってから ttl 秒。取るときにも時計で確かめる（CPU が止まって loop の deadline が遅れても古い slot を
  使わない）。``close``（プロセスの終了の atexit）で slot を取り消し、一時ディレクトリを消す
- ログ・例外の文言は出さない（呼ぶ側が種類だけを出す）
- 段の時間（#99）: 取った時刻から ``agent_reader.Stages`` で数え（``wait_ms`` = 取ってから立ち上がりの残りを
  待った時間）、一時ディレクトリを消した後に ``ReadOutcome.stages`` に入れる
- 静まり（#99。``prepare_settled``）: CLI は立ち上がった後も止めていた起動の仕事（プラグイン・設定の書き込みなど）を
  続ける。準備の要求は、立ち上がった後に CLI の CPU 時間（``cli_cpu_ms``。``/proc`` の stat）が静まるまで最大 settle 秒
  待ち、その仕事を CPU が割り当てられている要求の中で済ませる（応答の後に CPU が止まると、次の読み取りに持ち越される）
- 使われなかった先立ての印（#99 の続き）: slot ごとに出どころ（``origin`` = ``startup`` / ``prepare``）・作った時刻・
  立ち上がった時刻を持つ。読み取りに取られずに終わった slot は終わり方（``WarmEnd.kind``）を決めて ``on_end`` に渡し、
  最後の 1 つを覚える。読み取りが先立てを使えなかったときは、その理由と時間を ``attempt`` に入れる（``miss``・
  ``origin``・``age_ms`` = 作ってから今まで・``ready_ms`` = 作ってから立ち上がるまで・``end_ms`` = 作ってから
  終わるまで）。時間は ``time.monotonic``（CPU が絞られている間も進む）で数える
"""

import asyncio
import atexit
import concurrent.futures
import contextlib
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Callable
from typing import NamedTuple

import anyio

from . import agent_reader as ar

# 取ってから結果を待つ上限に足す余裕（SDK の後始末は最大約 15 秒。ADR-0005 の決定 6）
CLOSE_MARGIN_SECONDS = 20.0
# 立ち上がった後の静まり（#99）: SETTLE_STEP 秒ごとに CLI の CPU 時間を測り、SETTLE_WINDOW 秒前との差が
# SETTLE_QUIET_MS 以下になったら静まったとする（CPU 時間の刻みは 10 ms）。同梱の CLI 2.1.316 は立ち上がった後、
# 約 0.3・0.6・1.0・1.5 秒の時点で小さな仕事を流し（1.0 秒の時点は止めていた起動の仕事 5 つ。CLI の startupWorkGate の
# 待ちの上限 1 秒）、間は 0.3〜0.5 秒静か、その後は 1 秒以上静かになる（手元の実測）。窓は間の静けさとゲートの上限より
# 長くとる
SETTLE_STEP = 0.05
SETTLE_WINDOW = 1.0
SETTLE_QUIET_MS = 10


def cli_cpu_ms(base: str) -> int | None:
    """先立ての CLI（このプロセスの子で、cwd が ``<base>/cwd`` のもの）の CPU 時間の合計（ミリ秒。utime + stime と、
    その子の分 cutime + cstime）。``/proc`` を読めない・見つからなければ None。読むのは stat と cwd だけ（cmdline・
    environ は読まない）"""
    want = os.path.realpath(f"{base}/cwd")
    me = os.getpid()
    try:
        names = os.listdir("/proc")
        tick = os.sysconf("SC_CLK_TCK")
    except (OSError, ValueError):
        return None
    total = 0
    found = False
    for name in names:
        if not name.isdecimal():
            continue
        try:
            with open(f"/proc/{name}/stat", encoding="ascii", errors="replace") as f:
                fields = f.read().rsplit(")", 1)[1].split()
            if int(fields[1]) != me:  # 親（ppid）
                continue
            if os.path.realpath(os.readlink(f"/proc/{name}/cwd")) != want:
                continue
            total += sum(int(x) for x in fields[11:15])  # utime・stime・cutime・cstime
            found = True
        except (OSError, ValueError, IndexError):
            continue
    return total * 1000 // tick if found else None


class _Job:
    def __init__(self, message: dict, identity_token: str | None, timeout: float | None):
        self.message = message
        self.identity_token = identity_token
        self.timeout = timeout
        self.future: concurrent.futures.Future = concurrent.futures.Future()
        # 段の時間（#99）。取った時刻から数える（時計は time.monotonic。期限の clock はテストが止めるので使わない）
        self.stages = ar.Stages(time.monotonic, time.monotonic())


# 読み取りに取られずに終わった slot の終わり方（#99 の続き）
END_STARTUP_TIMEOUT = "startup_timeout"  # 立ち上がる前に起動の上限（作ってから startup 秒）を過ぎた
END_START_FAILED = "start_failed"  # 立ち上がる前に失敗した（例外・CLI が終わった）
END_EXPIRED = "expired"  # 立ち上がった後、作ってから ttl を過ぎた（loop の締め切り・取るときの時計）
END_ENDED = "ended"  # 立ち上がった後、取られる前に CLI が自分で終わった
END_CLOSED = "closed"  # プロセスの終了（close）
# 読み取りが先立てを使えなかった理由（attempt["miss"]）。上の終わり方のほかに
MISS_NONE = "none"  # 一度も立てていない
MISS_USED = "used"  # 最後の先立ては前の読み取りが取った（画像を送った・送っている）。1 回で捨てるので、次の準備まで無い
MISS_RETRIED = "retried"  # 最後の先立ては前の読み取りが取ったが、画像を送る前に失敗した（その回は cli = cold_retry）
MISS_CLOSED = "closed"


class WarmEnd(NamedTuple):
    """読み取りに取られずに終わった slot（#99 の続き）。時間はミリ秒。ready_ms は立ち上がらなかったら None"""

    kind: str
    origin: str
    end_ms: float
    ready_ms: float | None


class Prepared(NamedTuple):
    """準備の結果（#99）。ready = 立ち上がっている。settle_ms = 静まりを待ったミリ秒（測れない・静まり済みなら 0）。
    ended = 静まりを待つ間に CLI が自分で終わった（ready は False）"""

    ready: bool
    settle_ms: float
    ended: bool = False


class _Slot:
    """先立て 1 つ。Python の側（lock の下）と loop の側で分けて触る"""

    def __init__(self, expires_at: float, origin: str):
        self.expires_at = expires_at  # 時計（clock）の値
        self.origin = origin  # startup / prepare（#99 の続き）
        self.created_mono = time.monotonic()
        self.ready_mono: float | None = None
        self.discard_kind: str | None = None  # 捨てた理由（expired / closed）
        self.ready = threading.Event()  # 立ち上がった、または終わった（待つ側を起こす）
        self.ok = False  # 立ち上がった
        self.finished = threading.Event()  # task が終わり、一時ディレクトリを消した
        self.taken = False
        self.cancelled = False
        self.job: _Job | None = None
        self.base: str | None = None
        # loop の側だけ
        self.scope: anyio.CancelScope | None = None
        self.job_event: asyncio.Event | None = None
        self.job_started: float | None = None
        self.sent = False
        self.prep_failed = False  # 送る前の段（ID トークンの差し替え）で失敗した
        self.settled = False  # 静まりを確かめた（次の準備では待たない。#99）


class WarmPool:
    """先立ての CLI の置き場（1 プロセスに 1 つ）。引数は ``agent_reader.Reader`` と同じ。identity_token は
    federation の ID トークンの取り方（slot を立てるときに呼ぶ）。query_fn はテスト用（options は option_kwargs の
    dict のまま）。clock は期限を確かめる時計（テスト用）"""

    def __init__(
        self,
        credential: str,
        secret,
        model: str,
        effort: str,
        *,
        timeout: float | None,
        max_output_tokens: int | None = None,
        identity_token: Callable[[], str] | None = None,
        ttl: float = 600.0,
        startup: float = 20.0,
        tmp_parent: str | None = None,
        query_fn: Callable | None = None,
        clock: Callable[[], float] = time.monotonic,
        cpu_probe: Callable[[str], int | None] = cli_cpu_ms,
        on_end: Callable[[WarmEnd], None] | None = None,
    ):
        self._credential = credential
        self._secret = secret
        self._identity_token = identity_token
        self.model = model
        self.effort = effort
        self.timeout = timeout
        self.max_output_tokens = max_output_tokens
        self.ttl = ttl
        self.startup = startup
        self._tmp_parent = tmp_parent
        self._query_fn = query_fn
        self._clock = clock
        self.cpu_probe = cpu_probe
        self._on_end = on_end
        self._lock = threading.Lock()
        self._slot: _Slot | None = None
        # 置き場から外れた最後の slot と、取られずに終わったならその終わり方（取られたなら None。#99 の続き）
        self._last: tuple[_Slot, WarmEnd | None] | None = None
        self._active: set[_Slot] = set()  # task が終わっていない slot（取られて処理中を含む）
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._closed = False

    def __repr__(self) -> str:  # 資格情報の値を repr に出さない
        return f"WarmPool(model={self.model!r}, effort={self.effort!r}, credential={self._credential!r})"

    # ── Python の側（Flask のスレッド）──

    def start(self, origin: str = "startup") -> bool:
        """先立てが無ければ 1 つ立て始める（待たない）。立ち上げ中・立ち上がった slot があればそのまま。
        閉じた後は False。origin は出どころ（ログの印。#99 の続き）"""
        return self._ensure(origin) is not None

    def prepare(self, wait: float) -> bool:
        """先立てを立て（あればそのまま）、立ち上がるまで最大 wait 秒待つ。立ち上がっていれば True"""
        return self.prepare_settled(wait, 0.0)[0]

    def prepare_settled(self, wait: float, settle: float, origin: str = "prepare") -> Prepared:
        """prepare に加えて、立ち上がった後に CLI の CPU の使用が静まるまで最大 settle 秒待つ（#99）。
        CLI は立ち上がった後も止めていた起動の仕事を続ける。応答の後は CPU がほぼ止まる（ADR-0009）ので、この要求の中で
        済ませて次の読み取りに持ち越さない。CPU を読めない・立ち上がっていない・同じ slot で静まりを確かめ済みなら
        待たない（settle_ms = 0）。待つ間に CLI が自分で終わったら ready = False・ended = True"""
        slot = self._ensure(origin)
        if slot is None:
            return Prepared(False, 0.0)
        slot.ready.wait(wait)
        ready = slot.ok and not slot.cancelled and not slot.taken
        if not ready or settle <= 0 or slot.settled:
            return Prepared(ready, 0.0)
        waited, quiet = self._settle(slot, settle)
        if slot.cancelled:
            return Prepared(False, waited)
        if slot.finished.is_set() and not slot.taken:
            return Prepared(False, waited, ended=True)
        if quiet:
            slot.settled = True
        # 待つ間に読み取りが取った slot は、立ち上がっていたので True のまま
        return Prepared(True, waited)

    def _settle(self, slot: "_Slot", limit: float) -> tuple[float, bool]:
        """slot の CLI の CPU 時間が SETTLE_WINDOW の間に SETTLE_QUIET_MS 以下しか増えなくなるまで待つ
        （最大 limit 秒）。読み取りに取られた・捨てられた・終わったらそこで終える。返すのは (待ったミリ秒, 静まったか)。
        測れなければ (0, False)"""
        base = slot.base
        if base is None:
            return 0.0, False
        t0 = time.monotonic()
        first = self.cpu_probe(base)
        if first is None:
            return 0.0, False
        samples = [(t0, first)]
        quiet = False
        while True:
            now = time.monotonic()
            if now - t0 >= limit:
                break
            time.sleep(min(SETTLE_STEP, max(0.0, limit - (now - t0))))
            if slot.taken or slot.cancelled or slot.finished.is_set():
                break
            cpu = self.cpu_probe(base)
            now = time.monotonic()
            if cpu is None:
                break
            samples.append((now, cpu))
            old = [c for t, c in samples if now - t >= SETTLE_WINDOW]
            if old and cpu - old[-1] <= SETTLE_QUIET_MS:
                quiet = True
                break
        return round((time.monotonic() - t0) * 1000, 1), quiet

    def read(self, data: bytes, media_type: str, identity_token: str | None = None,
             attempt: dict | None = None) -> ar.ReadOutcome | None:
        """先立てで 1 回読む。使える slot が無い・画像を送る前に slot が失敗したら None（呼ぶ側がその場で立てる）。
        立ち上げ中の slot も取る（残りの立ち上がりを待つ）。締め切りは取った時点から timeout 秒。attempt（dict）を
        渡すと、slot を取ったときに ``attempt["taken"] = True``（None が「slot が無い」か「取ったが送る前に
        失敗した」かを呼ぶ側が見分ける。#99）。先立てを使えなかったときは ``attempt["miss"]`` に理由
        （``MISS_*``・``END_*``）を入れ、slot があれば ``origin``・``age_ms``・``ready_ms``・``end_ms`` も入れる（取った
        ときも ``origin``・``age_ms``・``ready_ms``。#99 の続き）"""
        info: dict = {} if attempt is None else attempt
        with self._lock:
            slot = self._slot
            if self._closed:
                info["miss"] = MISS_CLOSED
                return None
            if slot is None:
                self._describe_last_locked(info)
                return None
            if slot.taken:  # 取った slot は置き場から外すので、ここには来ない（念のため）
                info["miss"] = MISS_USED
                self._describe(slot, info)
                return None
            if slot.cancelled or slot.finished.is_set():
                info["miss"] = slot.discard_kind or END_START_FAILED
                self._describe(slot, info)
                return None
            if self._clock() >= slot.expires_at:
                self._discard_locked(slot, END_EXPIRED)
                info["miss"] = END_EXPIRED
                self._describe(slot, info)
                return None
            if slot.ready.is_set() and not slot.ok:
                info["miss"] = END_START_FAILED
                self._describe(slot, info)
                return None
            slot.taken = True
            info["taken"] = True
            self._describe(slot, info)
            self._last = (slot, None)
            self._slot = None
            job = _Job(ar.user_message(data, media_type), identity_token, self.timeout)
            slot.job = job
            loop = self._loop
        loop.call_soon_threadsafe(self._begin, slot)
        wait = None if self.timeout is None else self.timeout + CLOSE_MARGIN_SECONDS
        try:
            return job.future.result(timeout=wait)
        except concurrent.futures.TimeoutError:
            return ar.ReadOutcome(result=None, seconds=None, error="timeout")

    @staticmethod
    def _describe(slot: "_Slot", info: dict, end_ms: float | None = None) -> None:
        """slot の出どころと時間（ミリ秒）を info に入れる（#99 の続き）"""
        now = time.monotonic()
        info["origin"] = slot.origin
        info["age_ms"] = round((now - slot.created_mono) * 1000, 1)
        if slot.ready_mono is not None:
            info["ready_ms"] = round((slot.ready_mono - slot.created_mono) * 1000, 1)
        if end_ms is not None:
            info["end_ms"] = end_ms

    def _describe_last_locked(self, info: dict) -> None:
        """slot が無いとき: 最後の slot が読み取りに取られて画像を送ったなら used、取られたが送る前に失敗したなら
        retried、取られずに終わったならその終わり方（どれも無ければ none）"""
        last = self._last
        if last is None:
            info["miss"] = MISS_NONE
            return
        slot, end = last
        if end is None:
            info["miss"] = MISS_USED
            self._describe(slot, info)
            return
        info["miss"] = end.kind
        self._describe(slot, info, end.end_ms)

    def close(self, wait: float = 10.0) -> None:
        """待っている先立てを取り消し、取られて処理中の先立ても含めて後始末を待ち（最大 wait 秒）、loop を止める。
        プロセスの終了（atexit）でも呼ぶ。間に合わなかった slot の一時ディレクトリもここで消す"""
        with self._lock:
            self._closed = True
            slot = self._slot
            self._slot = None
            if slot is not None:
                self._discard_locked(slot, END_CLOSED)
            active = list(self._active)
            loop, thread = self._loop, self._thread
        deadline = time.monotonic() + wait
        for s in active:
            s.finished.wait(max(0.0, deadline - time.monotonic()))
        # 待っても終わらない処理中の slot は取り消す（SDK の後始末で CLI を止める。上界 約 15 秒）
        late = [s for s in active if not s.finished.is_set()]
        if late and loop is not None:
            for s in late:
                loop.call_soon_threadsafe(self._cancel_any, s)
            cutoff = time.monotonic() + CLOSE_MARGIN_SECONDS
            for s in late:
                s.finished.wait(max(0.0, cutoff - time.monotonic()))
        for s in active:
            if s.base is not None:  # 後始末が間に合わなかったときも一時ディレクトリは消す
                shutil.rmtree(s.base, ignore_errors=True)
        if loop is not None and thread is not None and loop.is_running():
            # 閉じ忘れの async generator の後始末を loop の上で済ませてから止める
            with contextlib.suppress(Exception):
                asyncio.run_coroutine_threadsafe(loop.shutdown_asyncgens(), loop).result(
                    max(0.1, deadline - time.monotonic()))
            loop.call_soon_threadsafe(loop.stop)
            thread.join(max(0.1, deadline - time.monotonic()))

    def wait_idle(self, wait: float) -> bool:
        """テスト用: 今の slot（あれば）が終わるまで待つ"""
        with self._lock:
            slot = self._slot
        return True if slot is None else slot.finished.wait(wait)

    def _ensure(self, origin: str) -> _Slot | None:
        with self._lock:
            if self._closed:
                return None
            slot = self._slot
            if slot is not None:
                usable = not (slot.taken or slot.cancelled or slot.finished.is_set()) and not (
                    slot.ready.is_set() and not slot.ok)
                if usable and self._clock() < slot.expires_at:
                    return slot
                self._discard_locked(slot, END_EXPIRED)
            if self._loop is None:
                self._loop = asyncio.new_event_loop()
                self._thread = threading.Thread(target=self._loop.run_forever, name="statement-read-warm",
                                                daemon=True)
                self._thread.start()
                atexit.register(self.close)
            slot = _Slot(self._clock() + self.ttl, origin)
            self._slot = slot
            self._active.add(slot)
            asyncio.run_coroutine_threadsafe(self._run(slot), self._loop)
            return slot

    def _discard_locked(self, slot: _Slot, kind: str) -> None:
        """slot を捨てる（lock の下で呼ぶ）。取り消しは loop の側で。kind は終わり方（expired / closed）"""
        if slot.discard_kind is None:
            slot.discard_kind = kind
        slot.cancelled = True
        if self._slot is slot:
            self._slot = None
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._cancel, slot)

    @staticmethod
    def _end_of(slot: "_Slot", deadline_hit: bool) -> WarmEnd:
        """取られずに終わった slot の終わり方（#99 の続き）"""
        if slot.discard_kind is not None:
            kind = slot.discard_kind
        elif slot.ok:
            kind = END_EXPIRED if deadline_hit else END_ENDED
        else:
            kind = END_STARTUP_TIMEOUT if deadline_hit else END_START_FAILED
        return WarmPool._end_with(slot, kind)

    @staticmethod
    def _end_with(slot: "_Slot", kind: str) -> WarmEnd:
        ready_ms = (None if slot.ready_mono is None
                    else round((slot.ready_mono - slot.created_mono) * 1000, 1))
        return WarmEnd(kind, slot.origin, round((time.monotonic() - slot.created_mono) * 1000, 1), ready_ms)

    # ── loop の側 ──

    @staticmethod
    def _cancel(slot: _Slot) -> None:
        if slot.job is None and slot.scope is not None:
            slot.scope.cancel()

    @staticmethod
    def _cancel_any(slot: _Slot) -> None:
        """取られて処理中の slot も取り消す（close だけが使う）"""
        if slot.scope is not None:
            slot.scope.cancel()

    @staticmethod
    def _begin(slot: _Slot) -> None:
        """取った slot に仕事を渡す。締め切りを取った時点から timeout に付け替える"""
        loop = asyncio.get_running_loop()
        slot.job_started = loop.time()
        if slot.scope is not None and slot.job is not None and slot.job.timeout is not None:
            slot.scope.deadline = slot.job_started + slot.job.timeout
        elif slot.scope is not None:
            slot.scope.deadline = float("inf")
        if slot.job_event is not None:
            slot.job_event.set()

    def _token_path(self, base: str) -> str:
        return f"{base}/{ar.IDENTITY_TOKEN_SUBDIR}/{ar.IDENTITY_TOKEN_NAME}"

    @staticmethod
    def _write_token(path: str, token: str) -> None:
        """ID トークンを 0600 のファイルに置く（同じパスに置き換える。途中の中身を CLI に読ませない）"""
        tmp = f"{path}.new"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as f:
            f.write(token)
        os.replace(tmp, path)

    async def _run(self, slot: _Slot) -> None:
        loop = asyncio.get_running_loop()
        created = loop.time()
        captured: list = []
        done = asyncio.Event()
        slot.job_event = asyncio.Event()
        collector: ar.Collector | None = None
        outcome: ar.ReadOutcome | None = None
        deadline_hit = False  # 締め切り（起動の上限・ttl）で取り消した（#99 の続き）
        try:
            with anyio.CancelScope(deadline=created + self.startup) as scope:
                slot.scope = scope
                if slot.cancelled and slot.job is None:
                    scope.cancel()
                if slot.job_started is not None:  # 取られた後に task が始まった
                    self._begin(slot)
                if self._tmp_parent is not None:
                    os.makedirs(self._tmp_parent, mode=0o700, exist_ok=True)
                base = slot.base = tempfile.mkdtemp(prefix="statement-read-", dir=self._tmp_parent)
                for sub in ar.ISOLATED_SUBDIRS:
                    os.mkdir(f"{base}/{sub}", 0o700)
                values = ({ar.CREDENTIAL_ENV[self._credential]: self._secret} if isinstance(self._secret, str)
                          else dict(self._secret))
                if self._credential == ar.FEDERATION:
                    if self._identity_token is None:
                        raise ar.NoCredential("identity_token")
                    token = await anyio.to_thread.run_sync(self._identity_token)
                    if not token:
                        raise ar.NoCredential("identity_token")
                    self._write_token(self._token_path(base), token)
                    del token
                    values[ar.IDENTITY_TOKEN_FILE_ENV] = self._token_path(base)
                kwargs = ar.option_kwargs(self.model, self.effort, self._credential, values, base,
                                          max_output_tokens=self.max_output_tokens)
                query_fn, opts = ar.resolve_query(self._query_fn, kwargs, captured)

                async def gated():
                    # 立ち上がった（initialize の後に初めて読まれる）
                    if slot.job_started is None:  # まだ取られていない: 作ってから ttl で捨てる
                        scope.deadline = created + self.ttl
                    slot.ready_mono = time.monotonic()
                    slot.ok = True
                    slot.ready.set()
                    await slot.job_event.wait()
                    job = slot.job
                    if self._credential == ar.FEDERATION:
                        # 送る前の失敗は例外にしない（SDK は prompt の例外の文言をログに出す）。印を立てて何も送らずに
                        # 終える（入力が閉じて CLI が止まる → 呼ぶ側がその場で立てる）
                        try:
                            if not job.identity_token:
                                raise ar.NoCredential("identity_token")
                            self._write_token(self._token_path(base), job.identity_token)
                        except Exception:  # noqa: BLE001 - 文言を出さない
                            slot.prep_failed = True
                            return
                    nonlocal collector
                    collector = ar.Collector(loop.time, loop.time())
                    job.stages.mark_sent()
                    slot.sent = True
                    # 結果を受け取るまで入力を閉じない（Reader と同じ）
                    yield job.message
                    await done.wait()

                try:
                    async with contextlib.aclosing(query_fn(prompt=gated(), options=opts)) as stream:
                        async for m in stream:
                            if slot.job is not None:
                                slot.job.stages.feed(m)
                            if collector is not None and collector.feed(m):
                                done.set()
                finally:
                    done.set()
            deadline_hit = scope.cancelled_caught and not slot.cancelled
            if slot.job is not None and slot.sent:
                if scope.cancelled_caught:
                    outcome = ar.ReadOutcome(result=None, seconds=None, error="timeout")
                elif collector is not None:
                    outcome = collector.outcome(captured)
        except ar.SdkMissing:
            outcome = ar.ReadOutcome(result=None, seconds=None, error="sdk_missing") if slot.sent else None
        except ar.CredentialEnvPresent:
            outcome = ar.ReadOutcome(result=None, seconds=None, error="credential_env") if slot.sent else None
        except Exception as e:  # noqa: BLE001 - 型の名前だけを返す。送る前の失敗は None（その場で立て直す）
            outcome = ar.ReadOutcome(result=None, seconds=None, error=type(e).__name__) if slot.sent else None
        finally:
            if slot.base is not None:
                shutil.rmtree(slot.base, ignore_errors=True)
            end: WarmEnd | None = None
            with self._lock:
                if slot.job is not None and not slot.sent and self._last is not None and self._last[0] is slot:
                    # 取ったが画像を送る前に失敗した（#99 の続き）。次の読み取りの印を used と分ける
                    self._last = (slot, self._end_with(slot, MISS_RETRIED))
                if slot.job is None:  # 取られずに終わった（#99 の続き）
                    end = self._end_of(slot, deadline_hit)
                    # 後から作った slot の覚えを、前の slot の遅れた終わりで上書きしない
                    if self._last is None or self._last[0].created_mono <= slot.created_mono:
                        self._last = (slot, end)
                if self._slot is slot:
                    self._slot = None
                self._active.discard(slot)
            if end is not None and self._on_end is not None:
                with contextlib.suppress(Exception):  # 印の失敗で後始末を止めない
                    self._on_end(end)
            if outcome is not None and slot.job is not None:
                # 段の時間は一時ディレクトリを消した後に締める（close_ms に後始末を含める。#99）。結果は下の future で
                # 渡すので、終わりの印より前に入れておく
                outcome.stages = slot.job.stages.ms(time.monotonic())
            slot.ready.set()
            slot.finished.set()
            if slot.job is not None and not slot.job.future.done():
                slot.job.future.set_result(outcome)
