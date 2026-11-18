"""チャートの時間足の読み取りの入口 POST /api/chart-reads（Issue #27 の AC-2〜AC-5）。

実際の AI は呼ばない（偽の claude_agent_sdk）。画像は合成のバイト列、表記・値はすべて架空。上限（AC-4）は保存先 2 つ
（記憶 / エミュレーターの Firestore）で回す。
"""

import copy
import json
import logging
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, patch_certs, signed_token, unsigned_token
from statement_read import app_settings, chart_timeframe, pricing
from statement_read.task import STATEMENT_TASK

from loss_note_api import identity_token, logs, read_limits
from loss_note_api.app import create_app
from loss_note_api.read_limits import BYPASS_EMAILS_VAR, USER_USD_VAR, ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.store import READ_DAYS, READ_SPEND, FirestoreStore

A = "chartReaderA"
PATH = "/api/chart-reads"
STATEMENT_PATH = "/api/statement-reads"
CRED_MARKER = "CRED-MARKER-チャートの資格情報-3f9a"
IMG_MARKER = b"CHARTIMGMARKER-61d0"
# 書かれた表記の目印（許した文字だけ・16 文字以下。応答・ログに出ないこと）
WRITTEN_MARKER = "Qz4Hzq"
EMAIL = "fictional.chart@example.com"
NOON_1118 = int(datetime(2026, 11, 18, 3, 0, tzinfo=UTC).timestamp() * 1000)  # 日本時間 11-18 の 12:00
D1118 = "2026-11-18"
LIMITS = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000,
                    chart_reserve_micro_usd=20_000)


def chart(written="4H", kind="chart") -> dict:
    return {"kind": kind, "timeframe_written": written}


def _hosts() -> tuple[str, str]:
    """エミュレーターの接続先（エミュレーターの下で流すときはその値。無ければ使わない架空の値）"""
    return emulator_hosts() or ("127.0.0.1:9099", "127.0.0.1:8080")


def base_env(**extra) -> dict:
    auth_host, fs_host = _hosts()
    return {AUTH_EMULATOR: auth_host, FIRESTORE_EMULATOR: fs_host, "GOOGLE_CLOUD_PROJECT": PROJECT, **extra}


class FixedClock:
    def __init__(self, now: int):
        self.now = now

    def __call__(self) -> int:
        return self.now


class Client:
    def __init__(self, app, store):
        self.app = app
        self.store = store

    def post(self, data: bytes, path: str = PATH, uid: str | None = A, content_type: str = "image/png", **kw):
        h = {}
        if uid is not None:
            h["Authorization"] = f"Bearer {unsigned_token(uid, PROJECT, exp_offset=10**9, **kw)}"
        return self.app.test_client().post(path, data=data, headers=h, content_type=content_type)


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = chart()
    return fake


@pytest.fixture
def make_client(monkeypatch):
    auth_host, fs_host = _hosts()
    monkeypatch.setenv(AUTH_EMULATOR, auth_host)
    monkeypatch.setenv(FIRESTORE_EMULATOR, fs_host)

    def make(env=None, read_timeout=None, store=None, limits: ReadLimits | None = LIMITS):
        store = store or MemoryStore()
        env = base_env(ANTHROPIC_API_KEY=CRED_MARKER) if env is None else env
        app = create_app(env, store=store, clock=FixedClock(NOON_1118), read_timeout=read_timeout, read_limits=limits)
        return Client(app, store)

    return make


@pytest.fixture
def client(make_client):
    return make_client()


IMAGE = png(1200, 700, size=20_000)


# ---- AC-2: 応答は「チャートか」と列挙の時間足だけ ----


@pytest.mark.parametrize(
    "tool_input,want",
    [
        (chart("4H"), {"kind": "chart", "timeframe": "4h"}),
        (chart("日足"), {"kind": "chart", "timeframe": "1d"}),
        (chart("1M"), {"kind": "chart", "timeframe": None}),  # 2 通りに読める（N8）
        (chart("2H"), {"kind": "chart", "timeframe": None}),  # 列挙に無い（N9）
        (chart(None), {"kind": "chart", "timeframe": None}),  # 表示なし（N10）
        (chart(None, kind="not_chart"), {"kind": "not_chart", "timeframe": None}),  # N11
        (chart("4H", kind="not_chart"), {"kind": "not_chart", "timeframe": None}),
    ],
)
def test_response_has_only_kind_and_timeframe(client, sdk, tool_input, want):
    sdk.tool_input = tool_input
    res = client.post(IMAGE)
    assert res.status_code == 200
    body = res.get_json()
    assert set(body) == {"kind", "timeframe"}
    assert body == want


def test_written_label_is_not_returned(client, sdk):
    sdk.tool_input = chart(WRITTEN_MARKER)
    res = client.post(IMAGE)
    assert res.status_code == 200 and res.get_json() == {"kind": "chart", "timeframe": None}
    assert WRITTEN_MARKER not in res.get_data(as_text=True)


def test_request_uses_chart_task(client, sdk):
    client.post(IMAGE)
    call = sdk.calls[0]
    opts = call["options"]
    assert opts.system_prompt is chart_timeframe.CHART_SYSTEM
    assert [t.name for t in opts.mcp_servers["eval"]["tools"]] == [chart_timeframe.TOOL_NAME]
    content = call["message"]["message"]["content"]
    assert [c["type"] for c in content] == ["image", "text"]
    assert content[1]["text"] == chart_timeframe.CHART_USER_TEXT
    # 明細の読み取りと同じ守り（組み込みのツールなし・設定を読まない・turn 1・同じモデル）
    assert opts.tools == [] and opts.setting_sources == [] and opts.max_turns == 1
    assert opts.env["ANTHROPIC_API_KEY"] == CRED_MARKER


# ---- AC-3: 形に合わない結果は全体を捨てる ----


@pytest.mark.parametrize(
    "case,script,tool_input",
    [
        ("未知の鍵", "tool", {**chart("4H"), "price": 151.25}),
        ("種類の外", "tool", chart("4H", kind="statement")),
        ("長すぎる表記", "tool", chart("4" * 17)),
        ("許さない文字", "tool", chart("4H@1234")),
        ("ツールを呼ばない", "text", None),
    ],
)
def test_invalid_result_is_502(make_client, sdk, case, script, tool_input, capfd):
    c = make_client()
    sdk.script, sdk.tool_input = script, tool_input
    res = c.post(IMAGE)
    assert res.status_code == 502
    assert res.get_json() == {"error": "read_invalid_result"}
    out, err = capfd.readouterr()
    for t in (out, err, res.get_data(as_text=True)):
        assert "4H@1234" not in t and "151.25" not in t and "4" * 17 not in t


# ---- 失敗の符号は明細と同じ ----


def test_unauthenticated_is_401(client, sdk):
    res = client.post(IMAGE, uid=None)
    assert res.status_code == 401 and sdk.calls == []


@pytest.mark.parametrize(
    "data,ct,reason",
    [
        (png(2001, 900, size=10_000), "image/png", "dimensions"),
        (png(800, 600, size=500_001), "image/png", "bytes"),
        (b"GIF89a" + b"\x00" * 64, "image/gif", "format"),
    ],
)
def test_image_limits_without_calling(client, sdk, data, ct, reason):
    res = client.post(data, content_type=ct)
    assert res.status_code == 400
    assert res.get_json() == {"error": "image_rejected", "reason": reason}
    assert sdk.calls == []
    assert client.store.read_days == {}  # 数えない


def test_unavailable_without_credential(make_client, sdk):
    c = make_client(env=base_env())
    res = c.post(IMAGE)
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"} and sdk.calls == []


def test_unavailable_when_unconfigured(sdk):
    # プロジェクト ID が無い設定（記録の API・明細の読み取りと同じく 503 unavailable）
    res = create_app({}).test_client().post(PATH, data=IMAGE, content_type="image/png")
    assert res.status_code == 503 and res.get_json() == {"error": "unavailable"}
    assert sdk.calls == []


@pytest.mark.parametrize("script,status,code", [("raise", 502, "read_failed"), ("is_error", 502, "read_failed"),
                                                ("no_result", 502, "read_failed")])
def test_upstream_failure_is_fixed_code(client, sdk, script, status, code):
    sdk.script = script
    res = client.post(IMAGE)
    assert res.status_code == status and res.get_json() == {"error": code}


def test_timeout_is_504(make_client, sdk):
    c = make_client(read_timeout=0.05)
    sdk.script = "hang"
    res = c.post(IMAGE)
    assert res.status_code == 504 and res.get_json() == {"error": "read_timeout"}
    assert sdk.cleaned == 1


# ---- AC-4: 明細の読み取りと同じ財布（上限の例 L1〜L3） ----


class Ledger:
    def __init__(self, store):
        self.store = store

    def seed_count(self, uid: str, day: str, count: int, micro: int = 0) -> None:
        # 利用者の文書は #51 からの形（回数と金額）。金額の欠けは回数 × 予約額に見積もられるので、回数の上限を見る
        # テストでは金額を明示する
        doc = {"count": count, "microUsd": micro}
        if isinstance(self.store, MemoryStore):
            self.store.read_days.setdefault(uid, {})[day] = doc
            return
        self.store._db().collection("users").document(uid).collection(READ_DAYS).document(day).set(doc)

    def user_micro(self, uid: str, day: str) -> int:
        if isinstance(self.store, MemoryStore):
            return self.store.read_days.get(uid, {}).get(day, {}).get("microUsd", 0)
        snap = self.store._db().collection("users").document(uid).collection(READ_DAYS).document(day).get()
        return (snap.to_dict() or {}).get("microUsd", 0) if snap.exists else 0

    def count(self, uid: str, day: str) -> int:
        if isinstance(self.store, MemoryStore):
            return self.store.read_days.get(uid, {}).get(day, {}).get("count", 0)
        snap = self.store._db().collection("users").document(uid).collection(READ_DAYS).document(day).get()
        return (snap.to_dict() or {}).get("count", 0) if snap.exists else 0

    def spend(self, day: str) -> dict:
        if isinstance(self.store, MemoryStore):
            return self.store.spend.get(day, {})
        snap = self.store._db().collection(READ_SPEND).document(day).get()
        return snap.to_dict() if snap.exists else {}


@pytest.fixture
def wallet(store_kind, make_client):
    if store_kind == "firestore":
        _auth, fs_host = require_emulator()
        clear_firestore(fs_host)
        store = FirestoreStore(PROJECT)
    else:
        store = MemoryStore()
    return make_client(store=store), Ledger(store)


def test_L1_30th_read_is_sent(wallet, sdk):
    # 明細 20 + チャート 9 = 29 回 → チャートの読み取りは 30 回目として送る
    c, ledger = wallet
    ledger.seed_count(A, D1118, 29)
    res = c.post(IMAGE)
    assert res.status_code == 200 and len(sdk.calls) == 1
    assert ledger.count(A, D1118) == 30


@pytest.mark.parametrize("path", [PATH, STATEMENT_PATH], ids=["L2 チャート", "L3 明細"])
def test_L2_L3_31st_read_is_limited(wallet, sdk, path):
    # 明細 20 + チャート 10 = 30 回 → チャートも明細も 429・AI を呼ばない
    c, ledger = wallet
    ledger.seed_count(A, D1118, 30)
    res = c.post(IMAGE, path=path)
    assert res.status_code == 429 and res.get_json() == {"error": "read_limited"}
    assert sdk.calls == []
    assert ledger.count(A, D1118) == 30


def test_chart_and_statement_share_count_and_spend(wallet, sdk):
    c, ledger = wallet
    sdk.tool_input = chart("4H")
    assert c.post(IMAGE).status_code == 200
    sdk.tool_input = {"kind": "statement", "rows": []}
    assert c.post(IMAGE, path=STATEMENT_PATH).status_code == 200
    assert ledger.count(A, D1118) == 2
    assert ledger.user_micro(A, D1118) == 2 * 10_000  # 利用者ごとの費用も合わせて数える（#51）
    spend = ledger.spend(D1118)
    assert spend["count"] == 2
    # 精算: 偽の SDK の合計額 0.01 USD（料金表の額より大きい方）× 2
    assert spend["microUsd"] == 2 * 10_000


def test_spend_limit_applies_to_chart(make_client, sdk):
    store = MemoryStore()
    c = make_client(store=store)
    # チャートの予約額（20,000）で判定する: 計上額 + 20,000 が 2.00 USD を超えれば 429、ちょうどなら送る
    store.spend[D1118] = {"count": 5, "microUsd": 2_000_000 - 19_999}
    res = c.post(IMAGE)
    assert res.status_code == 429 and sdk.calls == []
    store.spend[D1118] = {"count": 5, "microUsd": 2_000_000 - 20_000}
    assert c.post(IMAGE).status_code == 200


def test_user_spend_limit_applies_to_chart(make_client, sdk):
    # 利用者ごとの費用（#51）も明細と合わせて数える: 計上額 + 予約額が利用者の上限を超えるなら 429
    store = MemoryStore()
    limits = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000,
                        per_user_micro_usd=100_000, chart_reserve_micro_usd=20_000)
    c = make_client(store=store, limits=limits)
    store.read_days[A] = {D1118: {"count": 1, "microUsd": 80_001}}
    res = c.post(IMAGE)
    assert res.status_code == 429 and res.get_json() == {"error": "read_limited"} and sdk.calls == []
    store.read_days[A] = {D1118: {"count": 1, "microUsd": 80_000}}
    assert c.post(IMAGE).status_code == 200


BYPASS = "fictional.chart.bypass@example.com"


@pytest.mark.parametrize("email,status", [(BYPASS, 200), ("fictional.chart.normal@example.com", 429)])
def test_bypass_skips_user_limits_for_chart(make_client, sdk, email, status):
    # バイパスのリスト（#51）: 利用者ごとの回数・費用を受けない（全体は受ける）。明細と同じ照らし方
    store = MemoryStore()
    c = make_client(env=base_env(ANTHROPIC_API_KEY=CRED_MARKER, **{BYPASS_EMAILS_VAR: BYPASS}), store=store,
                    limits=None)
    store.read_days[A] = {D1118: {"count": 30, "microUsd": 0}}
    res = c.post(IMAGE, email=email, email_verified=True)
    assert res.status_code == status


def test_bypass_still_hits_daily_limit(make_client, sdk):
    store = MemoryStore()
    c = make_client(env=base_env(ANTHROPIC_API_KEY=CRED_MARKER, **{BYPASS_EMAILS_VAR: BYPASS}), store=store,
                    limits=None)
    store.spend[D1118] = {"count": 9, "microUsd": 2_000_000}
    res = c.post(IMAGE, email=BYPASS, email_verified=True)
    assert res.status_code == 429 and sdk.calls == []


def test_bad_limit_env_is_503_for_chart(make_client, sdk, capfd):
    # 上限の値の形の誤り（#51）: 明細と同じく閉じる側（AI を呼ばない・数えない。ログは変数の名前だけ）
    store = MemoryStore()
    c = make_client(env=base_env(ANTHROPIC_API_KEY=CRED_MARKER, **{USER_USD_VAR: "abc"}), store=store, limits=None)
    capfd.readouterr()
    res = c.post(IMAGE, email=BYPASS, email_verified=True)
    _out, err = capfd.readouterr()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert sdk.calls == [] and store.read_days == {} and store.spend == {}
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{") and '"chart_read"' in ln]
    assert [(ln["reason"], ln["var"]) for ln in lines] == [("limit_config", USER_USD_VAR)]
    assert "abc" not in err


def test_chart_reserve_is_per_task():
    # B1: 予約額は種類ごと。チャートは指示・ツールの定義が短く、最大出力も小さい（ADR-0015 の決定 4）
    real = ReadLimits()
    chart = pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_CHART_MAX_OUTPUT_TOKENS,
                                      chart_timeframe.CHART_TASK)
    assert real.chart_reserve_micro_usd == chart == 130_164
    assert real.reserve_micro_usd == 278_736
    assert chart_timeframe.CHART_TASK.prompt_bytes() <= STATEMENT_TASK.prompt_bytes() == pricing.prompt_bytes()
    assert real.for_chart().reserve_micro_usd == chart and real.for_chart().per_user == real.per_user


@pytest.mark.parametrize("p,ok", [(0, 3), (150_000, 3), (460_936, 3), (460_937, 2), (721_264, 1)])
def test_statement_and_two_charts_at_once(p, ok):
    # B1 の例（ADR-0015 の結果の節）: その日の利用者の計上額 P のとき、明細 1 + チャート 2 の予約が重なって何件通るか
    # （既定の上限: 利用者 1.00 USD・全体 2.00 USD。全体は他の利用者 0 とする）。予約額は 明細 278,736・チャート 130,164
    limits = ReadLimits()
    reserves = [(limits, limits.reserve_micro_usd), (limits.for_chart(), limits.chart_reserve_micro_usd),
                (limits.for_chart(), limits.chart_reserve_micro_usd)]
    user, spent, passed = p, p, 0
    for lim, r in reserves:
        if read_limits.decide(1, spent, lim, user_spent_micro=user) == "ok":
            passed += 1
            user += r
            spent += r
    assert passed == ok


def test_limit_store_failure_is_503(make_client, sdk):
    store = MemoryStore()

    def broken(*_a, **_k):
        raise RuntimeError("SECRET 保存先の文言")

    store.reserve_read = broken
    c = make_client(store=store)
    res = c.post(IMAGE)
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"} and sdk.calls == []


# ---- AC-5: 画像も結果も保存しない・ログに出ない ----


@pytest.fixture
def sys_tmp(monkeypatch, tmp_path):
    d = tmp_path / "sys-tmp"
    d.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(d))
    return d


@pytest.fixture
def capture(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    return caplog


@pytest.mark.parametrize(
    "script,tool_input,status",
    [("tool", chart(WRITTEN_MARKER), 200), ("tool", {**chart(WRITTEN_MARKER), "x": 1}, 502), ("raise", None, 502),
     ("hang", None, 504)],
    ids=["成功", "形の誤り", "送り先の失敗", "締め切り超え"],
)
def test_nothing_left_after_read(make_client, sdk, sys_tmp, capture, capfd, script, tool_input, status):
    store = MemoryStore()
    c = make_client(read_timeout=0.05, store=store)
    users_before = copy.deepcopy(store.users)
    sdk.script, sdk.tool_input, sdk.write_tmp = script, tool_input, True
    sdk.raise_text = f"{WRITTEN_MARKER} {CRED_MARKER}"
    res = c.post(png(1600, 900, size=200_000, filler=IMG_MARKER), email=EMAIL)
    assert res.status_code == status
    # 記録の保存先は前と同じ。増えたのは計上の文書（回数・金額）だけ
    assert store.users == users_before
    assert set(store.read_days) == {A} and set(store.read_days[A][D1118]) == {"count", "microUsd"}
    assert set(store.spend[D1118]) == {"count", "microUsd"}
    # 一時ディレクトリは要求ごとに作って消える
    env = sdk.calls[0]["options"].env
    for key in ("CLAUDE_CODE_TMPDIR", "CLAUDE_CONFIG_DIR", "HOME", "TMPDIR"):
        assert env[key].startswith(str(sys_tmp)) and not Path(env[key]).exists(), key
    assert sorted(sys_tmp.rglob("*")) == []
    # ログ・応答に画像・書かれた表記・資格情報・メール・uid が出ない
    out, err = capfd.readouterr()
    log_text = "\n".join([out, err, *(r.getMessage() for r in capture.records)])
    assert "chart_read" in log_text
    for t in (log_text, res.get_data(as_text=True)):
        for needle in (WRITTEN_MARKER, CRED_MARKER, IMG_MARKER.decode(), EMAIL, A):
            assert needle not in t
    assert IMG_MARKER not in (out + err).encode()


def test_chart_read_log_shape(client, sdk, capfd):
    sdk.tool_input = chart("4H")
    client.post(IMAGE)
    sdk.tool_input = chart(None)
    client.post(IMAGE)
    client.post(b"GIF89a" + b"\x00" * 10, content_type="image/gif")
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    reads = [ln for ln in lines if ln.get("event") == "chart_read"]
    assert [(ln["reason"], ln["rows"]) for ln in reads] == [("ok", 1), ("ok", 0), ("image_format", 0)]
    assert set(reads[0]) == {"event", "reason", "rows", "ms", "cli", "limit_ms", "read_ms", "api_ms"}
    # 先立ての CLI（#65）は使わない（その場で立てる）
    assert {ln["cli"] for ln in reads} == {"cold"}


# ---- N1: 資格情報の方式（#55）を明細と同じに通す ----

PROD = "example-prod"
PROD_EMAIL = "fictional.chart.cred@example.com"
KEY = "KEY-MARKER-チャートの資格情報-k1"
OAUTH = "OAUTH-MARKER-チャートの資格情報-o1"
ORG = "00000000-0000-0000-0000-000000000001"
ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"  # 架空の JWT の形


@pytest.fixture
def prod(monkeypatch):
    """本番と同じ起動（エミュレーターの接続先なし・プロジェクト ID あり = verify）"""
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"):
        monkeypatch.delenv(name, raising=False)
    patch_certs(monkeypatch)

    def make(identity_token=None, **extra):
        store = MemoryStore()
        env = {"GOOGLE_CLOUD_PROJECT": PROD, "LOSS_NOTE_ALLOWED_EMAILS": PROD_EMAIL, **extra}
        app = create_app(env, store=store, read_limits=LIMITS, identity_token=identity_token)
        return app.test_client(), store

    return make


def prod_post(client):
    token = signed_token(A, PROD, email=PROD_EMAIL, email_verified=True)
    return client.post(PATH, data=IMAGE, content_type="image/png", headers=bearer(token))


@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
def test_chart_read_each_credential_method(prod, sdk, method):
    extra = {"STATEMENT_READ_CREDENTIAL": method, "ANTHROPIC_API_KEY": KEY, "CLAUDE_CODE_OAUTH_TOKEN": OAUTH,
             "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": ORG}
    client, store = prod(identity_token=lambda: ID_TOKEN, **extra)
    res = prod_post(client)
    assert res.status_code == 200 and len(sdk.calls) == 1
    child = sdk.calls[0]["child_env"]
    wanted = {"api_key": {"ANTHROPIC_API_KEY"}, "oauth_token": {"CLAUDE_CODE_OAUTH_TOKEN"},
              "federation": {"ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID",
                             "ANTHROPIC_IDENTITY_TOKEN_FILE"}}[method]
    for name in ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_FEDERATION_RULE_ID",
                 "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE"):
        assert (name in child) == (name in wanted), name
    assert store.spend != {}  # 送った回は数える


def test_chart_read_leftover_name_not_sent(prod, sdk, monkeypatch):
    # 親の環境に系統の名前が残っている起動: 送らず、数えない（明細と同じ 502）
    monkeypatch.setenv("ANTHROPIC_API_KEY", "LEFTOVER-x")
    client, store = prod(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=OAUTH)
    res = prod_post(client)
    assert res.status_code == 502 and res.get_json() == {"error": "read_failed"}
    assert len(sdk.calls) == 0 and store.read_days == {} and store.spend == {}


def test_chart_read_federation_token_failure_not_counted(prod, sdk):
    def fail():
        raise identity_token.IdentityTokenUnavailable("unreachable")

    client, store = prod(identity_token=fail, STATEMENT_READ_CREDENTIAL="federation",
                         ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    res = prod_post(client)
    assert res.status_code == 502 and res.get_json() == {"error": "read_failed"}
    assert len(sdk.calls) == 0 and store.read_days == {} and store.spend == {}


def test_chart_read_uses_chart_max_output(client, sdk):
    # 子の CLI の最大出力はチャートの値（予約額の前提）
    assert client.post(IMAGE).status_code == 200
    env = sdk.calls[0]["options"].env
    assert env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] == str(app_settings.APP_CHART_MAX_OUTPUT_TOKENS)
