"""先立ての CLI（warm.WarmPool。Issue #65）: 使い捨て・期限・同時の取り合い・送る前の失敗・締め切り・閉じる。

実際の AI・SDK は使わない（偽の query_fn。SDK と同じく、prompt を読む前に「起動」の時間を眠る）。値は架空。
"""

import asyncio
import contextlib
import os
import sys
import threading
import time
from pathlib import Path

import anyio
import pytest

from statement_read import agent_reader, warm

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TOKEN_A = "aaa.bbb.ccc"
TOKEN_B = "ddd.eee.fff"


@pytest.fixture(autouse=True)
def no_sdk(monkeypatch):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = {}, 1000, 0.01, False
        self.duration_ms = 1300  # CLI が報告するターンの時間（#99 の turn_ms）


def good_input(symbol="US30"):
    return {"kind": "statement", "rows": [{
        "symbol": symbol, "side_written": "buy", "side_of": "position", "entry_price": 39012.5,
        "entry_time": "2026-03-04T01:15", "exit_price": 39100.0, "exit_time": "2026-03-04T06:40", "time_zone": "GMT",
        "qty": 0.5, "fees": None, "pnl": 6500, "exit_order_type": "unknown"}]}


class FakeCli:
    """偽の SDK の query。起動（startup 秒）→ prompt の最初の message → 筋書き"""

    def __init__(self, startup=0.0, script="tool"):
        self.startup = startup
        self.script = script
        self.spawned: list[dict] = []
        self.cleaned = 0
        self.prompt_errors: list[str] = []
        self.lock = threading.Lock()

    async def __call__(self, *, prompt, options):
        rec = {"options": options, "message": None, "token_at_send": None}
        with self.lock:
            self.spawned.append(rec)
        try:
            await anyio.sleep(self.startup)
            if self.script == "fail_startup":
                raise ConnectionError("startup failed SECRET")
            try:
                async with contextlib.aclosing(prompt) as stream:
                    async for m in stream:
                        rec["message"] = m
                        f = options["env"].get(agent_reader.IDENTITY_TOKEN_FILE_ENV)
                        if f:
                            rec["token_at_send"] = Path(f).read_text()
                        break
            except Exception as e:  # noqa: BLE001 - 本物の SDK と同じく prompt の例外を握る
                self.prompt_errors.append(type(e).__name__)
            if rec["message"] is None:
                return
            if self.script == "hang":
                await anyio.sleep(60)
            # 画像の印（data の先頭）を銘柄にして返す（取り違えを見分ける）
            data = rec["message"]["message"]["content"][0]["source"]["data"]
            yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input(symbol=f"S{len(data)}"))])
            yield ResultMessage()
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.sleep(0.01)
                with self.lock:
                    self.cleaned += 1


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture
def make_pool(tmp_path):
    pools = []

    def make(cli, credential="api_key", secret="SECRET-X", timeout=5.0, **kw):
        p = warm.WarmPool(credential, secret, "claude-sonnet-5-5", "low", timeout=timeout,
                          tmp_parent=str(tmp_path / "t"), query_fn=cli, **kw)
        pools.append(p)
        return p

    yield make
    for p in pools:
        p.close()


def tmp_dirs(tmp_path) -> list[str]:
    d = tmp_path / "t"
    return sorted(os.listdir(d)) if d.exists() else []


def test_prepare_then_read_skips_startup(make_pool, tmp_path):
    cli = FakeCli(startup=0.5)
    pool = make_pool(cli)
    assert pool.prepare(5) is True
    t = time.monotonic()
    o = pool.read(PNG, "image/png")
    took = time.monotonic() - t
    sent = agent_reader.user_message(PNG, "image/png")["message"]["content"][0]["source"]["data"]
    assert o is not None and o.error is None and o.result["rows"][0]["symbol"] == f"S{len(sent)}"
    assert took < 0.5  # 起動（0.5 秒）を待たない
    assert len(cli.spawned) == 1 and cli.cleaned == 1
    # 結果を返す前に一時ディレクトリを消している
    assert tmp_dirs(tmp_path) == []


def test_slot_used_once_and_removed(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png") is not None
    # 使った slot は捨てた: 次の読み取りの slot は無い（呼ぶ側がその場で立てる）
    assert pool.read(PNG, "image/png") is None
    assert len(cli.spawned) == 1 and tmp_dirs(tmp_path) == []
    # 次の準備で新しい slot（別の一時ディレクトリ）
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png") is not None
    cwd = [r["options"]["cwd"] for r in cli.spawned]
    assert len(cwd) == 2 and cwd[0] != cwd[1]


def test_prepare_twice_starts_one(make_pool):
    cli = FakeCli(startup=0.1)
    pool = make_pool(cli)
    assert pool.prepare(5) and pool.prepare(5)
    assert len(cli.spawned) == 1
    assert all(r["message"] is None for r in cli.spawned)  # message は送っていない


def test_read_without_slot_is_none(make_pool):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.read(PNG, "image/png") is None and cli.spawned == []


def test_read_takes_starting_slot_and_waits(make_pool):
    cli = FakeCli(startup=0.3)
    pool = make_pool(cli)
    assert pool.start() is True
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error is None and len(cli.spawned) == 1


def test_concurrent_reads_take_only_one(make_pool):
    cli = FakeCli(startup=0.0)
    pool = make_pool(cli)
    assert pool.prepare(5)
    out: list = [None, None]

    def go(i):
        out[i] = pool.read(PNG + bytes([i]) * (i + 1), "image/png")

    ts = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert sum(o is None for o in out) == 1
    got = next(o for o in out if o is not None)
    assert got.error is None


def test_expired_by_clock_is_discarded(make_pool, tmp_path):
    clock = Clock()
    cli = FakeCli()
    pool = make_pool(cli, clock=clock, ttl=600)
    assert pool.prepare(5)
    clock.t += 600
    assert pool.read(PNG, "image/png") is None
    deadline = time.monotonic() + 5
    # 一時ディレクトリは偽の CLI の後始末の後（WarmPool._run の finally）で消えるので、両方を待つ
    while (cli.cleaned < 1 or tmp_dirs(tmp_path)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_ttl_expires_in_loop(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli, ttl=0.2)
    assert pool.prepare(5)
    deadline = time.monotonic() + 5
    # 一時ディレクトリは偽の CLI の後始末の後（WarmPool._run の finally）で消えるので、両方を待つ
    while (cli.cleaned < 1 or tmp_dirs(tmp_path)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []
    assert pool.read(PNG, "image/png") is None


def test_failure_before_send_is_none(make_pool, tmp_path):
    cli = FakeCli(script="fail_startup")
    pool = make_pool(cli)
    assert pool.prepare(5) is False
    assert pool.read(PNG, "image/png") is None
    assert tmp_dirs(tmp_path) == []


def test_taken_slot_failing_before_send_is_none(make_pool, tmp_path):
    cli = FakeCli(startup=0.2, script="fail_startup")
    pool = make_pool(cli)
    pool.start()
    assert pool.read(PNG, "image/png") is None  # 送る前の失敗 → 呼ぶ側がその場で立てる
    assert tmp_dirs(tmp_path) == []


def test_timeout_counts_from_take(make_pool, tmp_path):
    cli = FakeCli(script="hang")
    pool = make_pool(cli, timeout=0.3)
    assert pool.prepare(5)
    t = time.monotonic()
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error == "timeout"
    assert time.monotonic() - t < 3
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_exception_after_send_is_type_name(make_pool):
    class Boom(FakeCli):
        async def __call__(self, *, prompt, options):
            async with contextlib.aclosing(prompt) as stream:
                async for _ in stream:
                    break
            raise ConnectionError("upstream said SECRET-BODY")
            yield  # pragma: no cover

    pool = make_pool(Boom())
    assert pool.prepare(5)
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error == "ConnectionError" and "SECRET" not in repr(o)


def test_federation_writes_token_and_replaces_per_request(make_pool, tmp_path):
    tokens = iter([TOKEN_A])
    cli = FakeCli()
    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=lambda: next(tokens))
    assert pool.prepare(5)
    path = cli.spawned[0]["options"]["env"][agent_reader.IDENTITY_TOKEN_FILE_ENV]
    assert Path(path).read_text() == TOKEN_A
    assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    o = pool.read(PNG, "image/png", identity_token=TOKEN_B)
    assert o is not None and o.error is None
    assert cli.spawned[0]["token_at_send"] == TOKEN_B
    assert not Path(path).exists() and tmp_dirs(tmp_path) == []


def test_federation_without_token_does_not_start(make_pool, tmp_path):
    def fail():
        raise RuntimeError("metadata")

    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    cli = FakeCli()
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=fail)
    assert pool.prepare(5) is False
    assert cli.spawned == [] and tmp_dirs(tmp_path) == []


def test_child_env_same_as_reader(make_pool):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    env = cli.spawned[0]["options"]["env"]
    base = str(Path(cli.spawned[0]["options"]["cwd"]).parent)
    want = agent_reader.option_kwargs("claude-sonnet-5-5", "low", "api_key", "SECRET-X", base)["env"]
    assert env == want


def test_close_cancels_slot(make_pool, tmp_path):
    cli = FakeCli()
    pool = make_pool(cli)
    assert pool.prepare(5)
    pool.close()
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []
    assert pool.start() is False and pool.read(PNG, "image/png") is None


def test_repr_has_no_secret(make_pool):
    pool = make_pool(FakeCli())
    assert "SECRET" not in repr(pool)


# ── レビューの指摘 1: 送る前の段の失敗は例外にしない（SDK が prompt の例外の文言をログに出すため）──
def test_federation_missing_request_token_ends_without_exception(make_pool, tmp_path, capfd):
    fed = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": "org-example"}
    cli = FakeCli()
    pool = make_pool(cli, credential="federation", secret=fed, identity_token=lambda: TOKEN_A)
    assert pool.prepare(5)
    assert pool.read(PNG, "image/png", identity_token=None) is None  # 呼ぶ側がその場で立てる
    assert cli.prompt_errors == []  # prompt の generator は例外を投げずに終えた
    assert cli.spawned[0]["message"] is None  # 何も送っていない
    assert tmp_dirs(tmp_path) == []
    _out, err = capfd.readouterr()
    assert "identity_token" not in err and "NoCredential" not in err


# ── レビューの指摘 2: close は取られて処理中の先立ても後始末し、asyncgen の警告を残さない ──
def test_close_cleans_in_flight_slot(make_pool, tmp_path):
    cli = FakeCli(script="hang")
    pool = make_pool(cli, timeout=30)
    assert pool.prepare(5)
    out: list = []
    t = threading.Thread(target=lambda: out.append(pool.read(PNG, "image/png")))
    t.start()
    deadline = time.monotonic() + 5
    while (not cli.spawned or cli.spawned[0]["message"] is None) and time.monotonic() < deadline:
        time.sleep(0.01)
    pool.close(wait=0.3)
    t.join(5)
    assert out and out[0] is not None and out[0].error == "timeout"
    assert cli.cleaned == 1 and tmp_dirs(tmp_path) == []


def test_no_unawaited_generator_warnings(tmp_path):
    # 先立てを使う・捨てる・閉じるを別の process で流し、終わりの警告（asyncgen の後始末の漏れ）が出ないこと
    import subprocess
    import textwrap

    code = textwrap.dedent(f'''
        import sys, warnings
        sys.path.insert(0, {str(Path(__file__).parent)!r})
        sys.modules["claude_agent_sdk"] = None
        warnings.simplefilter("always")
        import test_warm as t
        from statement_read import warm
        for script in ("tool", "hang"):
            cli = t.FakeCli(script=script)
            p = warm.WarmPool("api_key", "S", "m", "low", timeout=0.2, tmp_parent={str(tmp_path / "t")!r},
                              query_fn=cli)
            assert p.prepare(5)
            p.read(t.PNG, "image/png")
            assert p.prepare(5)
            p.close()
        import gc; gc.collect()
        print("done")
    ''')
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and "done" in r.stdout
    assert "never awaited" not in r.stderr and "was destroyed" not in r.stderr, r.stderr


# ── #99: 段の時間（AC-1・AC-2・AC-4）と、準備の静まり（AC-5〜AC-7）──


class SystemMessage:
    pass


class StagedCli(FakeCli):
    """FakeCli に段の時間を足す（画像を受けてから最初の message まで first・結果まで result・終わるまで close 秒）"""

    def __init__(self, startup=0.0, first=0.0, result=0.0, close=0.0, script="tool"):
        super().__init__(startup=startup, script=script)
        self.first, self.result, self.close = first, result, close

    async def __call__(self, *, prompt, options):
        rec = {"options": options, "message": None, "token_at_send": None}
        with self.lock:
            self.spawned.append(rec)
        try:
            await anyio.sleep(self.startup)
            async with contextlib.aclosing(prompt) as stream:
                async for m in stream:
                    rec["message"] = m
                    break
            if rec["message"] is None:
                return
            await anyio.sleep(self.first)
            yield SystemMessage()
            if self.script == "hang":
                await anyio.sleep(60)
            await anyio.sleep(self.result)
            yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input())])
            yield ResultMessage()
            await anyio.sleep(self.close)
        finally:
            with anyio.CancelScope(shield=True):
                await anyio.sleep(0.01)
                with self.lock:
                    self.cleaned += 1


def test_warm_stages_after_ready(make_pool):
    # 例 #1: 立ち上がった先立ては wait が小さく、CLI の中の段と終わらせる時間が出る
    cli = StagedCli(startup=0.3, first=0.2, result=0.3, close=0.1)
    pool = make_pool(cli)
    assert pool.prepare(5)
    t = time.monotonic()
    o = pool.read(PNG, "image/png")
    took = (time.monotonic() - t) * 1000
    st = o.stages
    assert o.error is None
    assert set(st) == {"wait_ms", "first_ms", "result_ms", "turn_ms", "close_ms"}
    assert st["wait_ms"] < 150  # 起動（300）の半分未満 = 起動を待っていない
    assert st["first_ms"] >= 200 and st["result_ms"] >= 500 and st["close_ms"] >= 100
    assert st["turn_ms"] == 1300.0
    assert took >= st["wait_ms"] + st["result_ms"] + st["close_ms"] - 1


def test_warm_stages_while_starting(make_pool):
    # 例 #2: 立ち上げ中の先立てを取ると、残りの立ち上がりが wait_ms に出る
    cli = StagedCli(startup=1.0)
    pool = make_pool(cli)
    assert pool.start()
    o = pool.read(PNG, "image/png")
    assert o is not None and o.error is None
    assert o.stages["wait_ms"] >= 800


def test_warm_stages_timeout(make_pool):
    # 例 #4: 結果の前に締め切り → 進んだ段だけ
    cli = StagedCli(script="hang")
    pool = make_pool(cli, timeout=0.5)
    assert pool.prepare(5)
    o = pool.read(PNG, "image/png")
    assert o.error == "timeout"
    assert "wait_ms" in o.stages and "first_ms" in o.stages
    assert not {"result_ms", "turn_ms", "close_ms"} & set(o.stages)


class Probe:
    """偽の CPU の測り: busy 秒のあいだ呼ばれるたびに増え、その後は止まる。None を返す設定も"""

    def __init__(self, busy=0.0, forever=False, unreadable=False):
        self.busy, self.forever, self.unreadable = busy, forever, unreadable
        self.t0: float | None = None
        self.bases: list[str] = []

    def __call__(self, base):
        self.bases.append(base)
        if self.unreadable:
            return None
        now = time.monotonic()
        if self.t0 is None:
            self.t0 = now
        if self.forever or now - self.t0 < self.busy:
            return int((now - self.t0) * 1000)  # 1 CPU を使い切っている形
        return int(self.busy * 1000)


def test_prepare_settles_after_busy(make_pool):
    # 例 #5: 立ち上がった後 0.6 秒 CPU が増え続け、止まったら返す
    probe = Probe(busy=0.6)
    pool = make_pool(StagedCli(), cpu_probe=probe)
    t = time.monotonic()
    ready, settle_ms, ended = pool.prepare_settled(5, 30)
    took = time.monotonic() - t
    # 上限（30 秒）より十分前に静まりで終わる（上限は揺れない広さ。下限が AC の条件）
    assert ready is True and ended is False and 600 <= settle_ms < 15_000 and took >= 0.6
    # 測ったのは先立ての一時ディレクトリ
    assert probe.bases and all(Path(b).name.startswith("statement-read-") for b in probe.bases)


def test_prepare_settle_is_capped(make_pool):
    # 例 #6: 増え続けたら上限で打ち切る
    pool = make_pool(StagedCli(), cpu_probe=Probe(forever=True))
    ready, settle_ms, _ = pool.prepare_settled(5, 0.5)
    assert ready is True and 500 <= settle_ms < 5_000


def test_prepare_settle_quiet_returns_soon(make_pool):
    # 立ち上がった時点で静かなら、1 つの窓（SETTLE_WINDOW 秒）を見て返す
    pool = make_pool(StagedCli(), cpu_probe=Probe(busy=0))
    ready, settle_ms, _ = pool.prepare_settled(5, 30)
    assert ready is True and warm.SETTLE_WINDOW * 1000 <= settle_ms < 15_000


def test_prepare_settle_unreadable(make_pool):
    # 例 #7: CPU を読めなければ待たない
    pool = make_pool(StagedCli(), cpu_probe=Probe(unreadable=True))
    assert pool.prepare_settled(5, 3) == (True, 0.0, False)


def test_prepare_settle_not_ready(make_pool):
    # 例 #8: 立ち上がらなければ静まりを待たない
    probe = Probe(forever=True)
    pool = make_pool(FakeCli(script="fail_startup"), cpu_probe=probe)
    assert pool.prepare_settled(5, 3) == (False, 0.0, False)
    assert probe.bases == []


def test_prepare_settle_stops_when_taken(make_pool):
    # 静まりを待つ間に読み取りが取ったら、そこで終える（立ち上がっていたので ready は True）
    pool = make_pool(StagedCli(), cpu_probe=Probe(forever=True))
    out: list = []
    th = threading.Thread(target=lambda: out.append(pool.prepare_settled(5, 30)))
    th.start()
    time.sleep(0.3)
    o = pool.read(PNG, "image/png")
    th.join(5)
    assert o is not None and o.error is None
    ready, settle_ms, ended = out[0]
    assert ready is True and ended is False and settle_ms < 15_000  # 上限 30 秒より前に取られて終えた


def test_prepare_settle_cli_ends_is_not_ready(make_pool):
    # レビューの指摘 2: 静まりを待つ間に CLI が自分で終わったら ready = False・ended = True
    class Ends(StagedCli):
        async def __call__(self, *, prompt, options):
            rec = {"options": options, "message": None, "token_at_send": None}
            self.spawned.append(rec)

            async def first_only():
                async for m in prompt:  # 立ち上がった（prompt を読み始めた）
                    yield m

            stream = first_only()
            task = asyncio.ensure_future(stream.__anext__())
            await anyio.sleep(0.3)  # 立ち上がった後、0.3 秒で自分で終わる
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
            await stream.aclose()
            return
            yield  # pragma: no cover

    pool = make_pool(Ends(), cpu_probe=Probe(forever=True))
    ready, settle_ms, ended = pool.prepare_settled(5, 30)
    assert ready is False and ended is True and settle_ms < 15_000


def test_prepare_settle_once_per_slot(make_pool):
    # レビューの指摘 3: 同じ先立てで静まりを確かめた後の準備は待たない
    probe = Probe(busy=0)
    pool = make_pool(StagedCli(), cpu_probe=probe)
    first = pool.prepare_settled(5, 30)
    assert first.ready is True and first.settle_ms >= warm.SETTLE_WINDOW * 1000
    n = len(probe.bases)
    assert pool.prepare_settled(5, 30) == (True, 0.0, False)
    assert len(probe.bases) == n  # 測りもしない


def test_prepare_without_settle_unchanged(make_pool):
    probe = Probe(forever=True)
    pool = make_pool(StagedCli(), cpu_probe=probe)
    assert pool.prepare(5) is True
    assert probe.bases == []  # prepare は今までどおり静まりを待たない


@pytest.mark.skipif(not os.path.isdir("/proc/self"), reason="/proc の無い環境")
def test_cli_cpu_ms_reads_own_child(tmp_path):
    # 本物の /proc: このプロセスの子で cwd が <base>/cwd のものの CPU 時間を読む（ほかの cwd の子は数えない）
    import subprocess

    base = tmp_path / "statement-read-x"
    (base / "cwd").mkdir(parents=True)
    other = tmp_path / "other"
    other.mkdir()
    busy = "import time\nt=time.process_time()\nwhile time.process_time()-t<0.3: pass\ntime.sleep(30)\n"
    idle = "import time\nt=time.process_time()\nwhile time.process_time()-t<0.5: pass\ntime.sleep(30)\n"
    p = subprocess.Popen([sys.executable, "-c", busy], cwd=base / "cwd")
    q = subprocess.Popen([sys.executable, "-c", idle], cwd=other)
    try:
        deadline = time.monotonic() + 10
        got = None
        while time.monotonic() < deadline:
            got = warm.cli_cpu_ms(str(base))
            if got is not None and got >= 250:
                break
            time.sleep(0.05)
        assert got is not None and 250 <= got < 480  # ほかの cwd の子（0.5 秒）は足していない
        assert warm.cli_cpu_ms(str(tmp_path / "missing")) is None
    finally:
        p.kill()
        q.kill()
        p.wait()
        q.wait()


# ── 使われなかった先立ての印（#99 の続き）: 終わり方・出どころ・時間 ──


class Ends:
    """on_end に渡された WarmEnd を集める（例外を投げるときも記録はする）"""

    def __init__(self, raise_=False):
        self.got: list = []
        self.raise_ = raise_

    def __call__(self, end):
        self.got.append(end)
        if self.raise_:
            raise RuntimeError("印の失敗")


def wait_for(cond, limit=5.0):
    deadline = time.monotonic() + limit
    while not cond() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert cond()


def test_miss_none_without_slot(make_pool):
    pool = make_pool(FakeCli())
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt == {"miss": warm.MISS_NONE}


def test_startup_timeout_is_marked(make_pool):
    # 起動の段の先立てが上限（startup）までに立ち上がらない（本番で CPU が絞られた間に過ぎた締め切りの形）
    ends = Ends()
    pool = make_pool(FakeCli(startup=2.0), startup=0.2, on_end=ends)
    assert pool.start() is True
    wait_for(lambda: len(ends.got) == 1)
    end = ends.got[0]
    assert end.kind == warm.END_STARTUP_TIMEOUT and end.origin == "startup" and end.ready_ms is None
    assert 200 <= end.end_ms < 5_000
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt["miss"] == warm.END_STARTUP_TIMEOUT and attempt["origin"] == "startup"
    assert attempt["end_ms"] == end.end_ms and attempt["age_ms"] >= end.end_ms
    assert "ready_ms" not in attempt and "taken" not in attempt


def test_ttl_in_loop_is_expired_with_ready_ms(make_pool):
    ends = Ends()
    pool = make_pool(FakeCli(), ttl=0.3, on_end=ends)
    assert pool.prepare(5)
    wait_for(lambda: len(ends.got) == 1)
    end = ends.got[0]
    assert end.kind == warm.END_EXPIRED and end.origin == "prepare"
    assert end.ready_ms is not None and end.ready_ms <= end.end_ms
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt["miss"] == warm.END_EXPIRED and attempt["ready_ms"] == end.ready_ms


def test_expired_by_clock_is_marked(make_pool):
    clock = Clock()
    ends = Ends()
    pool = make_pool(FakeCli(), clock=clock, ttl=600, on_end=ends)
    assert pool.prepare(5)
    clock.t += 600
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt["miss"] == warm.END_EXPIRED and attempt["origin"] == "prepare" and "ready_ms" in attempt
    wait_for(lambda: len(ends.got) == 1)
    assert ends.got[0].kind == warm.END_EXPIRED


def test_start_failed_is_marked(make_pool):
    ends = Ends()
    pool = make_pool(FakeCli(script="fail_startup"), on_end=ends)
    assert pool.prepare(5) is False
    wait_for(lambda: len(ends.got) == 1)
    assert ends.got[0].kind == warm.END_START_FAILED and ends.got[0].ready_ms is None
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt["miss"] == warm.END_START_FAILED


def test_cli_ending_by_itself_is_ended(make_pool):
    class SelfEnding(FakeCli):
        async def __call__(self, *, prompt, options):
            self.spawned.append({"options": options})

            async def first_only():
                async for m in prompt:
                    yield m

            stream = first_only()
            task = asyncio.ensure_future(stream.__anext__())
            await anyio.sleep(0.2)  # 立ち上がった後に自分で終わる
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
            await stream.aclose()
            return
            yield  # pragma: no cover

    ends = Ends()
    pool = make_pool(SelfEnding(), on_end=ends)
    assert pool.prepare(5)
    wait_for(lambda: len(ends.got) == 1)
    assert ends.got[0].kind == warm.END_ENDED and ends.got[0].ready_ms is not None


def test_taken_slot_reports_origin_then_next_read_is_used(make_pool):
    ends = Ends()
    pool = make_pool(FakeCli(startup=0.1), on_end=ends)
    assert pool.start()
    attempt: dict = {}
    o = pool.read(PNG, "image/png", attempt=attempt)
    assert o is not None and o.error is None
    assert attempt["taken"] is True and attempt["origin"] == "startup" and "miss" not in attempt
    assert attempt["age_ms"] >= 0
    pool.wait_idle(5)
    assert ends.got == []  # 読み取りに使った先立ては「取られずに終わった」に数えない
    # 次の読み取り: 先立ては前の読み取りが使った（1 回で捨てる）
    again: dict = {}
    assert pool.read(PNG, "image/png", attempt=again) is None
    assert again["miss"] == warm.MISS_USED and again["origin"] == "startup" and "end_ms" not in again


def test_close_marks_closed_and_on_end_failure_is_ignored(make_pool, tmp_path):
    ends = Ends(raise_=True)
    pool = make_pool(FakeCli(), on_end=ends)
    assert pool.prepare(5)
    pool.close()
    assert [e.kind for e in ends.got] == [warm.END_CLOSED]
    assert tmp_dirs(tmp_path) == []
    attempt: dict = {}
    assert pool.read(PNG, "image/png", attempt=attempt) is None
    assert attempt == {"miss": warm.MISS_CLOSED}


def test_taken_slot_failing_before_send_then_next_read_is_retried(make_pool):
    # 取ったが送る前に失敗した回（呼ぶ側は cold_retry）の後の読み取りは used でなく retried（#99 の続き。レビュー 6）
    ends = Ends()
    pool = make_pool(FakeCli(startup=0.2, script="fail_startup"), on_end=ends)
    pool.start()
    first: dict = {}
    assert pool.read(PNG, "image/png", attempt=first) is None and first["taken"] is True
    again: dict = {}
    assert pool.read(PNG, "image/png", attempt=again) is None
    assert again["miss"] == warm.MISS_RETRIED and again["origin"] == "startup" and "end_ms" in again
    assert ends.got == []  # 取られた先立ては「取られずに終わった」の行を出さない
