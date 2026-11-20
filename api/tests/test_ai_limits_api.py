"""AI の利用者ごとの費用の上限とバイパスのリスト（Issue #51 の AC-1〜AC-5・AC-7・AC-8・KEEP-4。ADR-0014）。

保存先 2 つ（記憶 / エミュレーターの Firestore）で回す。上限は環境変数から読む（``create_app`` に ``read_limits`` を
渡さない = 本番と同じ経路）。予約額は本物（Sonnet 5.5 で P = 285,708 µUSD。
値は pricing から取る）。実際の AI は呼ばない（偽の
claude_agent_sdk。精算の既定は 料金表 6,000 と SDK の合計 10,000 の大きい方 = 10,000 µUSD）。メール・値はすべて架空。
"""

import json
import threading

import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.tokens import unsigned_token
from statement_read import app_settings, pricing

from loss_note_api.allowlist import ALLOWED_EMAILS_VAR
from loss_note_api.app import create_app
from loss_note_api.read_limits import BYPASS_EMAILS_VAR, DAILY_USD_VAR, USER_COUNT_VAR, USER_USD_VAR, ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.store import READ_DAYS, READ_SPEND, FirestoreStore

A = "aiLimitUserA"
PATH = "/api/statement-reads"
KEY_MARKER = "KEY-MARKER-利用者の上限-51a7"
OAUTH_MARKER = "OAUTH-MARKER-利用者の上限-51b2"
IMAGE = png(800, 600, size=2_000)
BYPASS = "fictional.bypass@example.com"
OTHER = "fictional.normal@example.com"
P = ReadLimits().reserve_micro_usd
# 例の表の境界（P の式。#66 で予約額が変わっても表の意味を保つ）: 計上額 + P がちょうど利用者の上限 1.00 USD /
# 1 µUSD 越える / 全体の上限 2.00 USD を 1 µUSD 越える
AT_USER = 1_000_000 - P
OVER_USER = AT_USER + 1
OVER_DAILY = 2_000_000 - P + 1
SETTLED = 10_000  # 偽の SDK の既定の精算の額
NOON_1118 = 1_794_970_800_000  # 2026-11-18 03:00 UTC = 日本時間 11-18 の 12:00
D1118 = "2026-11-18"


def test_reserve_is_the_issue_value():
    # 例の表の前提: 予約額は pricing の式から（値を固定するのは packages の test_pricing.py の 1 か所。#66 AC-9）。
    # 例の表の境界は P の式で書き、利用者 1.00 USD に 3 回分・全体 2.00 USD に 7 回分が入る形は変わらない
    assert P == pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)
    assert 3 * P <= 1_000_000 < 4 * P and 7 * P <= 2_000_000 < 8 * P


class Ledger:
    def __init__(self, store):
        self.store = store

    def user(self, uid: str) -> dict | None:
        if isinstance(self.store, MemoryStore):
            return self.store.read_days.get(uid, {}).get(D1118)
        snap = self.store._db().collection("users").document(uid).collection(READ_DAYS).document(D1118).get()
        return snap.to_dict() if snap.exists else None

    def spend(self) -> dict | None:
        if isinstance(self.store, MemoryStore):
            return self.store.spend.get(D1118)
        snap = self.store._db().collection(READ_SPEND).document(D1118).get()
        return snap.to_dict() if snap.exists else None

    def seed(self, uid: str, user: dict | None, spend: dict | None) -> None:
        if isinstance(self.store, MemoryStore):
            if user is not None:
                self.store.read_days.setdefault(uid, {})[D1118] = dict(user)
            if spend is not None:
                self.store.spend[D1118] = dict(spend)
            return
        db = self.store._db()
        if user is not None:
            db.collection("users").document(uid).collection(READ_DAYS).document(D1118).set(dict(user))
        if spend is not None:
            db.collection(READ_SPEND).document(D1118).set(dict(spend))


class Client:
    def __init__(self, app, store):
        self.app = app
        self.ledger = Ledger(store)

    def post(self, uid: str = A, email: str | None = OTHER, verified: bool = True):
        kw = {} if email is None else {"email": email, "email_verified": verified}
        token = unsigned_token(uid, PROJECT, exp_offset=10**9, **kw)
        return self.app.test_client().post(PATH, data=IMAGE, content_type="image/png",
                                           headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = {"kind": "statement", "rows": []}
    return fake


@pytest.fixture
def make(store_kind, monkeypatch):
    """環境変数（extra）を足した読み取りの API を作る。上限は環境変数から（read_limits を注入しない）"""
    if store_kind == "firestore":
        auth_host, fs_host = require_emulator()
        clear_firestore(fs_host)
        store = FirestoreStore(PROJECT)
    else:
        hosts = emulator_hosts()
        auth_host, fs_host = hosts if hosts else ("127.0.0.1:9099", "127.0.0.1:8080")
        store = MemoryStore()
    monkeypatch.setenv(AUTH_EMULATOR, auth_host)
    monkeypatch.setenv(FIRESTORE_EMULATOR, fs_host)
    base = {AUTH_EMULATOR: auth_host, FIRESTORE_EMULATOR: fs_host, "GOOGLE_CLOUD_PROJECT": PROJECT,
            "ANTHROPIC_API_KEY": KEY_MARKER, BYPASS_EMAILS_VAR: BYPASS}

    def build(read_timeout: float | None = None, **extra) -> Client:
        app = create_app({**base, **extra}, store=store, clock=lambda: NOON_1118, read_timeout=read_timeout)
        return Client(app, store)

    return build


def _reads(err: str) -> list[dict]:
    return [json.loads(ln) for ln in err.splitlines() if ln.startswith("{") and '"statement_read"' in ln]


# ---- AC-1・AC-2: 例の表 #1〜#9 ----

EXAMPLES = [
    # (行, メール, 確かめ済み, 利用者の文書, 全体の文書, 追加の環境変数, 状態, ログの理由)
    ("#1", OTHER, True, None, None, {}, 200, "ok"),
    ("#2", OTHER, True, {"count": 30, "microUsd": 0}, None, {}, 429, "limited_user"),
    ("#3", OTHER, True, {"count": 3, "microUsd": AT_USER}, {"count": 3, "microUsd": AT_USER}, {}, 200, "ok"),
    ("#4", OTHER, True, {"count": 3, "microUsd": OVER_USER}, {"count": 3, "microUsd": OVER_USER}, {}, 429,
     "limited_user_spend"),
    ("#5", OTHER, True, None, {"count": 9, "microUsd": OVER_DAILY}, {}, 429, "limited_spend"),
    ("#6", BYPASS, True, {"count": 30, "microUsd": 5_000_000}, None, {}, 200, "ok"),
    ("#7", BYPASS, True, None, {"count": 9, "microUsd": OVER_DAILY}, {}, 429, "limited_spend"),
    ("#8", BYPASS, False, {"count": 30, "microUsd": 0}, None, {}, 429, "limited_user"),
    ("#9", OTHER, True, None, None, {USER_USD_VAR: "0.10"}, 429, "limited_user_spend"),
]


@pytest.mark.parametrize(("row", "email", "verified", "user", "spend", "extra", "status", "reason"), EXAMPLES,
                         ids=[e[0] for e in EXAMPLES])
def test_issue51_example_table(make, sdk, capfd, row, email, verified, user, spend, extra, status, reason):
    c = make(**extra)
    c.ledger.seed(A, user, spend)
    capfd.readouterr()
    res = c.post(email=email, verified=verified)
    _out, err = capfd.readouterr()
    assert res.status_code == status, row
    assert [ln["reason"] for ln in _reads(err)] == [reason], row
    if status == 429:
        assert res.get_json() == {"error": "read_limited"}
        assert len(sdk.calls) == 0  # AI を呼ばない
        assert c.ledger.user(A) == user and c.ledger.spend() == spend  # 何も書かない
    else:
        assert len(sdk.calls) == 1
        before_user = user or {"count": 0, "microUsd": 0}
        before_spend = spend or {"count": 0, "microUsd": 0}
        # 精算の後は実額（予約額は残らない）。バイパスの利用者も記録する
        assert c.ledger.user(A) == {"count": before_user["count"] + 1, "microUsd": before_user["microUsd"] + SETTLED}
        assert c.ledger.spend() == {"count": before_spend["count"] + 1,
                                    "microUsd": before_spend["microUsd"] + SETTLED}
    for needle in (BYPASS, OTHER, A, KEY_MARKER):
        assert needle not in err


# ---- AC-3〜AC-5: 利用者の日の文書の金額 ----


def test_user_ledger_settles_both(make, sdk):
    c = make()
    assert c.post().status_code == 200
    assert c.ledger.user(A) == {"count": 1, "microUsd": SETTLED}
    assert c.ledger.spend() == {"count": 1, "microUsd": SETTLED}


def test_user_ledger_keeps_reserve_on_timeout(make, sdk):
    c = make(read_timeout=0.05)
    sdk.script = "hang"
    res = c.post()
    assert res.status_code == 504
    assert c.ledger.user(A) == {"count": 1, "microUsd": P}
    assert c.ledger.spend() == {"count": 1, "microUsd": P}


def test_user_ledger_without_micro(make, sdk):
    # 金額の欠けた文書（#51 より前・切り戻した日に前のコードが置き換えた）は「数えられない」として
    # 回数 × 予約額に見積もる（多めに数える側）。2 回 → 2P + P = 836,208 ≤ 1,000,000 で送れる
    c = make()
    c.ledger.seed(A, {"count": 2}, None)
    assert c.post().status_code == 200
    assert c.ledger.user(A) == {"count": 3, "microUsd": 2 * P + SETTLED}


def test_user_ledger_without_micro_closes_when_estimate_exceeds(make, sdk, capfd):
    # 5 回 → 5P = 1,393,680 > 1,000,000 → 利用者の費用で 429（0 として扱わない）。バイパスは通る
    c = make()
    c.ledger.seed(A, {"count": 5}, None)
    capfd.readouterr()
    res = c.post()
    _out, err = capfd.readouterr()
    assert res.status_code == 429 and len(sdk.calls) == 0
    assert [ln["reason"] for ln in _reads(err)] == ["limited_user_spend"]
    assert c.post(email=BYPASS).status_code == 200


def test_user_ledger_negative_micro_is_not_zero(make, sdk):
    # 負の金額（前のコードの予約が新しいコードの予約と精算の間に挟まった）も回数 × 予約額に見積もる
    c = make()
    c.ledger.seed(A, {"count": 1, "microUsd": -200_000}, None)
    assert c.post().status_code == 200
    assert c.ledger.user(A) == {"count": 2, "microUsd": P + SETTLED}
    c.ledger.seed(A, {"count": 3, "microUsd": -1}, None)
    assert c.post().status_code == 429  # 3P + P > 1,000,000（0 として扱えば送れてしまう）


def test_settle_failure_keeps_reserve_in_both(store_kind, make, sdk):
    if store_kind == "firestore":
        pytest.skip("保存先の失敗は記憶の保存先で差し込む")
    c = make()
    c.ledger.store.fail_settle = True
    assert c.post().status_code == 200
    assert c.ledger.user(A) == {"count": 1, "microUsd": P}
    assert c.ledger.spend() == {"count": 1, "microUsd": P}


def test_concurrent_user_spend(make, sdk, store_kind):
    # 利用者の計上 0.50 USD → 予約額 1 回分だけ入る（2 回分 = 1,057,472 > 1,000,000）。同時に 4 つ
    c = make()
    c.ledger.seed(A, {"count": 1, "microUsd": 500_000}, None)
    sdk.result_usage, sdk.result_cost = None, None  # 精算しない（予約額のまま）
    start = threading.Event()
    codes: list[int] = []
    lock = threading.Lock()

    def one():
        start.wait()
        code = c.post().status_code
        with lock:
            codes.append(code)

    threads = [threading.Thread(target=one) for _ in range(4)]
    for t in threads:
        t.start()
    start.set()
    for t in threads:
        t.join(timeout=60)
    sent = codes.count(200)
    assert len(sdk.calls) == sent <= 1
    assert c.ledger.user(A)["microUsd"] == 500_000 + sent * P
    assert set(codes) <= {200, 429, 503}
    if store_kind == "memory":
        assert sent == 1 and codes.count(429) == 3


# ---- AC-7: 上限の値の形の誤りは閉じる側 ----


@pytest.mark.parametrize(
    "extra",
    [{USER_USD_VAR: "abc"}, {USER_USD_VAR: "-1"}, {USER_USD_VAR: "1.0000001"}, {USER_COUNT_VAR: "3.5"},
     {DAILY_USD_VAR: "1e9"}],
)
def test_bad_limit_env_is_503(make, sdk, capfd, extra):
    c = make(**extra)
    capfd.readouterr()
    res = c.post(email=BYPASS)  # バイパスの利用者でも閉じる
    _out, err = capfd.readouterr()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0
    assert c.ledger.user(A) is None and c.ledger.spend() is None
    reads = _reads(err)
    assert [ln["reason"] for ln in reads] == ["limit_config"]
    assert reads[0]["var"] == next(iter(extra))  # 誤っている変数の名前だけ（値は出さない）
    for value in extra.values():
        assert value not in err


@pytest.mark.parametrize("blank", [" ", "  ", "\t"])
def test_blank_limit_env_is_503(make, sdk, blank):
    # 空白だけの値は「空」でなく形の誤り（既定値に戻さない = 閉じる側。ADR-0014 決定 4）
    c = make(**{USER_USD_VAR: blank})
    res = c.post()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0 and c.ledger.user(A) is None


def test_prepare_is_503_on_bad_limit_env(make, sdk, capfd):
    # 準備の入口（#65）も上限の値の形の誤りでは 503。CLI を立てない（AI を呼ばないので利用者の上限は見ない）
    c = make(**{DAILY_USD_VAR: "two"})
    token = unsigned_token(A, PROJECT, exp_offset=10**9, email=OTHER, email_verified=True)
    capfd.readouterr()
    res = c.app.test_client().post(f"{PATH}/prepare", headers={"Authorization": f"Bearer {token}"})
    _out, err = capfd.readouterr()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{") and '"statement_read_prepare"' in ln]
    assert [(ln["reason"], ln["var"]) for ln in lines] == [("limit_config", DAILY_USD_VAR)]
    assert "two" not in err
    # 正しい値なら準備は通る（上限に数えない）
    c = make()
    assert c.app.test_client().post(f"{PATH}/prepare", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert c.ledger.user(A) is None


def test_limit_env_values_apply(make, sdk):
    # 全体の上限を 5 USD に上げると、既定（2 USD）なら止まる計上でも送れる
    c = make(**{DAILY_USD_VAR: "5"})
    c.ledger.seed(A, None, {"count": 9, "microUsd": 1_900_000})
    assert c.post().status_code == 200
    # 回数 0 = バイパスの利用者だけ送れる
    c = make(**{USER_COUNT_VAR: "0"})
    c.ledger.seed(A, None, {"count": 0, "microUsd": 0})
    assert c.post(uid="aiLimitUserZ").status_code == 429
    assert c.post(uid="aiLimitUserY", email=BYPASS).status_code == 200


# ---- AC-8: 方式によらず同じ数え方 ----


def test_oauth_token_counts_same_as_api_key(make, sdk):
    amounts = []
    for extra in ({}, {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": OAUTH_MARKER}):
        c = make(**extra)
        uid = f"aiLimitCred{len(amounts)}"
        assert c.post(uid=uid).status_code == 200
        amounts.append(c.ledger.user(uid))
    assert amounts[0] == amounts[1] == {"count": 1, "microUsd": SETTLED}


# ---- KEEP-4: バイパスのリストは使えるかどうかに影響しない ----


def test_bypass_does_not_grant_access(make, sdk):
    # 許可リストに無いメールは、バイパスのリストにあっても 403（読み取りの入口より前で、数えない）
    c = make(**{ALLOWED_EMAILS_VAR: OTHER})
    res = c.post(email=BYPASS)
    assert res.status_code == 403 and res.get_json() == {"error": "forbidden"}
    assert len(sdk.calls) == 0 and c.ledger.user(A) is None
    token = unsigned_token(A, PROJECT, exp_offset=10**9, email=BYPASS, email_verified=True)
    assert c.app.test_client().get("/api/trades", headers={"Authorization": f"Bearer {token}"}).status_code == 403
    # 許可リストにあれば、バイパスでない利用者として通る
    assert c.post(email=OTHER).status_code == 200
