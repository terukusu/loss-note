"""明細の読み取りの先立ての CLI（Issue #65 の AC-1〜AC-11）。

本番と同じ起動（verify。公開鍵の取得だけを差し替える）・記憶の保存先・偽の claude_agent_sdk（実際の AI は呼ばない）。
偽の SDK の ``startup_delay`` が CLI の起動の時間の真似。値はすべて架空。
"""

import json
import tempfile
import threading
import time

import anyio
import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, patch_certs, signed_token
from statement_read import app_settings

from loss_note_api.app import create_app
from loss_note_api.read_limits import ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

PROD = "example-prod"
U = "warmUserA"
EMAIL = "fictional.warm@example.com"
OTHER = "fictional.other@example.com"
PATH = "/api/statement-reads"
PREPARE = "/api/statement-reads/prepare"
KEY = "KEY-MARKER-先立て-w1"
ORG = "00000000-0000-0000-0000-000000000001"
TOKEN_A = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJBIn0.c2lnbmF0dXJlQQ"  # 架空の JWT の形
TOKEN_B = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJCIn0.c2lnbmF0dXJlQg"
LIMITS = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000)
STARTUP = 2.0  # 偽の CLI の起動（秒。例の表の「CLI の起動 = 2.0 秒」）


def row(symbol: str) -> dict:
    return {"symbol": symbol, "side_written": "buy", "side_of": "position", "entry_price": 39012.5,
            "entry_time": "2026-03-04T01:15", "exit_price": 39100.0, "exit_time": "2026-03-04T06:40",
            "time_zone": "GMT", "qty": 0.5, "fees": None, "pnl": 6500, "exit_order_type": "unknown"}


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = {"kind": "statement", "rows": [row("US30")]}
    return fake


@pytest.fixture
def sys_tmp(monkeypatch, tmp_path):
    d = tmp_path / "sys-tmp"
    d.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(d))
    return d


class Warm:
    def __init__(self, app, store):
        self.app = app
        self.client = app.test_client()
        self.store = store
        self.pool = app.extensions["statement_read_warm"]

    def prepare(self, token=None):
        return self.client.post(PREPARE, headers=bearer(token or owner_token()))

    def read(self, data=None, token=None):
        return self.client.post(PATH, data=data or png(800, 600, size=2_000), content_type="image/png",
                                headers=bearer(token or owner_token()))


@pytest.fixture
def make(monkeypatch, sys_tmp):
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"):
        monkeypatch.delenv(name, raising=False)
    patch_certs(monkeypatch)
    made: list[Warm] = []

    def build(identity_token=None, read_timeout=None, **extra):
        env = {"GOOGLE_CLOUD_PROJECT": PROD, "LOSS_NOTE_ALLOWED_EMAILS": EMAIL, **extra}
        if not any(k in extra for k in ("ANTHROPIC_API_KEY", "STATEMENT_READ_CREDENTIAL")):
            env["ANTHROPIC_API_KEY"] = KEY
        store = MemoryStore()
        app = create_app(env, store=store, read_limits=LIMITS, identity_token=identity_token,
                         read_timeout=read_timeout)
        w = Warm(app, store)
        made.append(w)
        return w

    yield build
    for w in made:
        if w.pool is not None:
            w.pool.close()


def owner_token() -> str:
    return signed_token(U, PROD, email=EMAIL, email_verified=True)


def read_logs(capfd, event="statement_read") -> list[dict]:
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    return [ln for ln in lines if ln.get("event") == event]


def files(d) -> list[str]:
    return sorted(str(p.relative_to(d)) for p in d.rglob("*"))


# ── AC-1（例 #1）: 準備の後の読み取りは起動を待たない ──
def test_warm_read_skips_startup(make, sdk, sys_tmp, capfd):
    sdk.startup_delay = STARTUP
    w = make()
    res = w.prepare()
    assert res.status_code == 200 and res.get_json() == {"ready": True}
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200 and res.get_json()["rows"][0]["symbol"] == "US30"
    (log,) = read_logs(capfd)
    assert log["cli"] == "warm" and log["reason"] == "ok"
    assert log["read_ms"] < STARTUP * 1000
    assert len(sdk.calls) == 1
    assert files(sys_tmp) == []  # 応答の時点で一時ディレクトリは無い


# ── AC-2（例 #2）: 準備なしは今までどおりその場で立てる ──
def test_cold_read_without_prepare(make, sdk, sys_tmp, capfd):
    sdk.startup_delay = 0.3
    w = make()
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200 and res.get_json()["rows"][0]["symbol"] == "US30"
    (log,) = read_logs(capfd)
    assert log["cli"] == "cold" and log["read_ms"] >= 300
    assert len(sdk.calls) == 1 and files(sys_tmp) == []


# ── AC-3（例 #3）: 先立ては 1 回で捨てる ──
def test_warm_used_once(make, sdk, sys_tmp, capfd):
    w = make()
    seen_after_first: list = []
    assert w.prepare().get_json() == {"ready": True}
    capfd.readouterr()
    assert w.read().status_code == 200
    seen_after_first = files(sys_tmp)
    assert w.read().status_code == 200
    logs = read_logs(capfd)
    assert [ln["cli"] for ln in logs] == ["warm", "cold"]
    assert len(sdk.calls) == 2
    cwd = [c["options"].cwd for c in sdk.calls]
    assert cwd[0] != cwd[1]
    assert seen_after_first == [] and files(sys_tmp) == []


# ── AC-4（例 #4）: 同時の 2 つの読み取りで先立てを取るのは 1 つ ──
def test_concurrent_reads_take_one(make, sdk, capfd):
    sdk.startup_delay = 0.3
    w = make()
    assert w.prepare().get_json() == {"ready": True}
    capfd.readouterr()
    # 画像ごとに違う結果を返す（取り違えを見分ける）。送られた画像の大きさで銘柄を決める
    sdk.tool_input = lambda message: {
        "kind": "statement", "rows": [row(f"S{len(message['message']['content'][0]['source']['data'])}")]}
    out: dict = {}

    def go(size):
        c = w.app.test_client()
        r = c.post(PATH, data=png(800, 600, size=size), content_type="image/png", headers=bearer(owner_token()))
        out[size] = r

    ts = [threading.Thread(target=go, args=(s,)) for s in (2_000, 3_000)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert all(r.status_code == 200 for r in out.values())
    for size, r in out.items():
        import base64

        want = len(base64.b64encode(png(800, 600, size=size)))
        assert r.get_json()["rows"][0]["symbol"] == f"S{want}"
    assert sorted(ln["cli"] for ln in read_logs(capfd)) == ["cold", "warm"]
    assert len(sdk.calls) == 2


# ── AC-5（例 #5・#11）: 準備は 1 つだけ立て、AI を呼ばず、数えない ──
def test_prepare_starts_one_and_is_not_counted(make, sdk, capfd):
    w = make()
    for _ in range(3):
        assert w.prepare().get_json() == {"ready": True}
    assert len(sdk.calls) == 1
    assert sdk.calls[0]["message"] is None  # AI への message は 0 件
    assert w.store.read_days == {} and w.store.spend == {}
    logs = read_logs(capfd, "statement_read_prepare")
    assert [ln["reason"] for ln in logs] == ["ok"] * 3
    # #99: 静まりを待った時間 settle_ms（偽の SDK は子のプロセスが無く CPU を測れないので 0）
    assert all(set(ln) == {"event", "reason", "ms", "settle_ms"} for ln in logs)
    assert all(ln["settle_ms"] == 0 for ln in logs)


# ── AC-6（例 #10）: 準備の入口は読み取りと同じ門 ──
def test_prepare_gate(make, sdk, monkeypatch):
    w = make()
    assert w.client.post(PREPARE).status_code == 401
    other = signed_token("otherUser", PROD, email=OTHER, email_verified=True)
    assert w.prepare(token=other).status_code == 403
    # 資格情報が空
    w2 = make(STATEMENT_READ_CREDENTIAL="oauth_token")
    res = w2.prepare()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert sdk.calls == []


def test_prepare_without_sdk_is_503(make, monkeypatch):
    import sys

    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    w = make()
    res = w.prepare()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}


def test_prepare_only_post(make, sdk):
    w = make()
    assert w.client.get(PREPARE, headers=bearer(owner_token())).status_code == 405


# ── AC-7（例 #6）: 使われない先立ては期限で捨てる ──
def test_expired_slot_is_discarded(make, sdk, sys_tmp, capfd, monkeypatch):
    w = make()
    now = [1000.0]
    monkeypatch.setattr(w.pool, "_clock", lambda: now[0])
    assert w.prepare().get_json() == {"ready": True}
    now[0] += app_settings.APP_WARM_TTL_SECONDS
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200
    assert [ln["cli"] for ln in read_logs(capfd)] == ["cold"]
    deadline = time.monotonic() + 5
    # 捨てた先立ては、閉じた後に一時ディレクトリを消す（閉じた数だけを待つと、消す前に確かめて揺れる）
    while (sdk.closed < 2 or files(sys_tmp)) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sdk.closed == 2 and files(sys_tmp) == []
    assert sdk.calls[0]["message"] is None  # 捨てた先立てには何も送っていない


def test_default_ttl_is_ten_minutes():
    assert app_settings.APP_WARM_TTL_SECONDS == 600


# ── AC-8（例 #7）: 送る前に先立てが失敗したら、その場で立てて読む ──
def test_warm_failure_before_send_falls_back(make, sdk, capfd):
    w = make()
    sdk.startup_fail = True
    sdk.startup_delay = 0.2
    assert w.pool.start()  # 起動の段と同じ（待たない）
    # 先立ての起動が失敗した後の読み取りは、その場で立てる（偽の SDK を成功に戻す）
    assert w.pool.wait_idle(5)
    sdk.startup_fail = False
    sdk.startup_delay = 0.0
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200
    assert [ln["cli"] for ln in read_logs(capfd)] == ["cold"]
    assert sum(1 for c in sdk.calls if c["message"] is not None) == 1
    assert w.store.read_days != {}
    (day,) = w.store.spend.values()
    assert day["count"] == 1


def test_taken_slot_failing_before_send_falls_back(make, sdk, capfd):
    # 立ち上げ中の先立てを読み取りが取り、その先立てが送る前に失敗 → その場で立てて 1 回だけ送る
    w = make()
    orig = sdk._run
    n = [0]

    async def first_fails(call, prompt, options):
        n[0] += 1
        if n[0] == 1:  # 先立て: 起動の途中で失敗（prompt を読む前）
            await anyio.sleep(0.3)
            raise ConnectionError("startup failed")
        async for m in orig(call, prompt, options):
            yield m

    sdk._run = first_fails
    assert w.pool.start()
    calls_before = 1
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200
    # #99: 先立てを取ったが送る前に失敗した回は cold_retry。wait_ms は先立てを取った時刻から（先立ての 0.3 秒を含む）
    (log,) = read_logs(capfd)
    assert log["cli"] == "cold_retry" and log["wait_ms"] >= 300
    assert log["read_ms"] >= log["wait_ms"] + log["result_ms"] + log["close_ms"] - 1
    assert len(sdk.calls) == calls_before + 1
    assert sum(1 for c in sdk.calls if c["message"] is not None) == 1
    (day,) = w.store.spend.values()
    assert day["count"] == 1


# ── AC-9（例 #8）: 先立てを取った読み取りの締め切りは取った時点から ──
def test_warm_timeout_is_504(make, sdk, sys_tmp, capfd):
    w = make(read_timeout=0.3)
    assert w.prepare().get_json() == {"ready": True}
    sdk.script = "hang"
    time.sleep(0.4)  # 準備から締め切りより長く待っても、締め切りは取った時点から数える
    capfd.readouterr()
    t = time.monotonic()
    res = w.read()
    took = time.monotonic() - t
    assert res.status_code == 504 and res.get_json() == {"error": "read_timeout"}
    assert 0.3 <= took < 5
    assert [ln["cli"] for ln in read_logs(capfd)] == ["warm"]
    assert sdk.cleaned == 1 and files(sys_tmp) == []


# ── AC-10（例 #9）: federation は送る時点で要求ごとの ID トークン ──
def test_federation_warm_uses_request_token(make, sdk, sys_tmp, capfd):
    tokens = iter([TOKEN_A, TOKEN_B])
    fetched = []

    def fetch():
        t = next(tokens)
        fetched.append(t)
        return t

    w = make(identity_token=fetch, STATEMENT_READ_CREDENTIAL="federation",
             ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    assert w.prepare().get_json() == {"ready": True}
    assert fetched == [TOKEN_A]
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 200
    assert fetched == [TOKEN_A, TOKEN_B]
    assert sdk.calls[0]["token_at_send"] == TOKEN_B
    _out, err = capfd.readouterr()
    assert TOKEN_A not in err and TOKEN_B not in err
    assert files(sys_tmp) == []


def test_federation_prepare_without_token_is_not_ready(make, sdk):
    def fail():
        raise RuntimeError("metadata unreachable")

    w = make(identity_token=fail, STATEMENT_READ_CREDENTIAL="federation",
             ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    res = w.prepare()
    assert res.status_code == 200 and res.get_json() == {"ready": False}
    assert sdk.calls == []


# ── AC-11: 先立ての子の環境は方式ごとの許可リスト（偽の SDK。本物の SDK は test_real_sdk_env.py）──
@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
def test_warm_child_env_has_only_selected_credential(make, sdk, method):
    extra = {
        "api_key": {"ANTHROPIC_API_KEY": KEY},
        "oauth_token": {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "OAUTH-MARKER"},
        "federation": {"STATEMENT_READ_CREDENTIAL": "federation", "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example",
                       "ANTHROPIC_ORGANIZATION_ID": ORG},
    }[method]
    names = {
        "api_key": {"ANTHROPIC_API_KEY"},
        "oauth_token": {"CLAUDE_CODE_OAUTH_TOKEN"},
        "federation": {"ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE"},
    }[method]
    w = make(identity_token=lambda: TOKEN_A, **extra)
    assert w.prepare().get_json() == {"ready": True}
    assert w.read().status_code == 200
    child = sdk.calls[0]["child_env"]
    family = {k for k in child if k.startswith(("ANTHROPIC_", "AWS_")) or k in (
        "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDECODE")}
    assert family == names


# ═══ Issue #99: 段の時間・準備の静まり・会話を保存しない ═══

STAGE_KEYS = {"wait_ms", "first_ms", "result_ms", "turn_ms", "close_ms"}


# ── AC-1（例 #1）: 立ち上がった先立てを使う読み取りの段の時間 ──
def test_warm_read_stage_timings(make, sdk, capfd):
    sdk.startup_delay, sdk.first_delay, sdk.result_delay, sdk.close_delay = 0.5, 0.2, 0.8, 0.1
    w = make()
    assert w.prepare().get_json() == {"ready": True}
    capfd.readouterr()
    assert w.read().status_code == 200
    (log,) = read_logs(capfd)
    assert log["cli"] == "warm" and STAGE_KEYS <= set(log)
    assert log["wait_ms"] < 250  # 起動（500）の半分未満 = 起動を待っていない（揺れない広さ。レビューの指摘 5）
    assert log["first_ms"] >= 200 and log["result_ms"] >= 1000 and log["close_ms"] >= 100
    assert log["turn_ms"] == 1300.0
    assert log["read_ms"] >= log["result_ms"] + log["close_ms"]
    assert all(isinstance(log[k], int | float) and not isinstance(log[k], bool) for k in STAGE_KEYS)


# ── AC-2（例 #2）: 立ち上げ中の先立てを取ると、残りの立ち上がりが wait_ms に出る ──
def test_warm_read_while_starting_shows_wait(make, sdk, capfd):
    sdk.startup_delay = 1.0
    w = make()
    assert w.pool.start()  # 起動の段と同じく立て始めるだけ
    capfd.readouterr()
    assert w.read().status_code == 200
    (log,) = read_logs(capfd)
    assert log["cli"] == "warm" and log["wait_ms"] >= 800


# ── AC-3（例 #3）: その場で立てる読み取りの段の時間 ──
def test_cold_read_stage_timings(make, sdk, capfd):
    sdk.startup_delay = 0.5
    w = make()
    capfd.readouterr()
    assert w.read().status_code == 200
    (log,) = read_logs(capfd)
    assert log["cli"] == "cold" and log["wait_ms"] >= 500
    assert "result_ms" in log and "close_ms" in log


# ── AC-4（例 #4）: 結果の前に締め切り → 進んだ段だけ ──
@pytest.mark.parametrize("warm", [True, False])
def test_timeout_logs_only_reached_stages(make, sdk, capfd, warm):
    w = make(read_timeout=0.5)
    if warm:
        assert w.prepare().get_json() == {"ready": True}
    sdk.script = "hang"
    capfd.readouterr()
    res = w.read()
    assert res.status_code == 504
    (log,) = read_logs(capfd)
    assert log["cli"] == ("warm" if warm else "cold")
    assert "wait_ms" in log and not {"result_ms", "turn_ms", "close_ms"} & set(log)


class Probe:
    """偽の CPU の測り（busy 秒のあいだ増え、その後は止まる / 増え続ける / 読めない）"""

    def __init__(self, busy=0.0, forever=False, unreadable=False):
        self.busy, self.forever, self.unreadable = busy, forever, unreadable
        self.t0 = None

    def __call__(self, base):
        if self.unreadable:
            return None
        now = time.monotonic()
        if self.t0 is None:
            self.t0 = now
        if self.forever or now - self.t0 < self.busy:
            return int((now - self.t0) * 1000)
        return int(self.busy * 1000)


def prepare_log(capfd) -> dict:
    (log,) = read_logs(capfd, "statement_read_prepare")
    return log


# ── AC-5（例 #5）: 準備は立ち上がった後の CPU が静まるまで待つ ──
def test_prepare_waits_until_settled(make, sdk, capfd):
    w = make()
    w.pool.cpu_probe = Probe(busy=0.6)
    capfd.readouterr()
    t = time.monotonic()
    res = w.prepare()
    took = time.monotonic() - t
    assert res.status_code == 200 and res.get_json() == {"ready": True}
    assert took >= 0.6
    log = prepare_log(capfd)
    assert log["reason"] == "ok" and log["settle_ms"] >= 600


# ── AC-6（例 #6）: 静まりの待ちは 5 秒で打ち切る ──
def test_prepare_settle_capped(make, sdk, capfd):
    assert app_settings.APP_WARM_SETTLE_SECONDS == 5
    w = make()
    w.pool.cpu_probe = Probe(forever=True)
    capfd.readouterr()
    res = w.prepare()
    assert res.get_json() == {"ready": True}
    log = prepare_log(capfd)
    assert 5000 <= log["settle_ms"] < 5500


# ── AC-7（例 #7・#8）: 読めない・立ち上がらないときは待たない ──
def test_prepare_unreadable_cpu_does_not_wait(make, sdk, capfd):
    w = make()
    w.pool.cpu_probe = Probe(unreadable=True)
    capfd.readouterr()
    assert w.prepare().get_json() == {"ready": True}
    assert prepare_log(capfd)["settle_ms"] == 0


def test_prepare_not_ready_does_not_wait(make, sdk, capfd):
    sdk.startup_fail = True
    w = make()
    w.pool.cpu_probe = Probe(forever=True)
    capfd.readouterr()
    assert w.prepare().get_json() == {"ready": False}
    log = prepare_log(capfd)
    assert log["reason"] == "not_ready" and log["settle_ms"] == 0


# ── AC-8（例 #9）: 会話を保存しない指定（3 方式・先立て / その場で立てる）──
@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
@pytest.mark.parametrize("warm", [True, False])
def test_cli_started_without_session_persistence(make, sdk, method, warm):
    extra = {
        "api_key": {"ANTHROPIC_API_KEY": KEY},
        "oauth_token": {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "OAUTH-MARKER"},
        "federation": {"STATEMENT_READ_CREDENTIAL": "federation", "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example",
                       "ANTHROPIC_ORGANIZATION_ID": ORG},
    }[method]
    w = make(identity_token=lambda: TOKEN_A, **extra)
    if warm:
        assert w.prepare().get_json() == {"ready": True}
    assert w.read().status_code == 200
    (call,) = sdk.calls
    assert call["options"].extra_args == {"no-session-persistence": None}


# ── レビューの指摘 2: 静まりを待つ間に CLI が自分で終わった準備は ready = false・reason = ended ──
def test_prepare_cli_ended_during_settle(make, sdk, capfd, monkeypatch):
    from statement_read.warm import Prepared

    w = make()
    monkeypatch.setattr(w.pool, "prepare_settled", lambda wait, settle: Prepared(False, 120.0, ended=True))
    capfd.readouterr()
    assert w.prepare().get_json() == {"ready": False}
    log = prepare_log(capfd)
    assert log["reason"] == "ended" and log["settle_ms"] == 120.0
