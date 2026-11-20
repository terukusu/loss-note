"""AI の利用状況の入口 ``GET /api/ai-usage``（Issue #62 の AC-1〜AC-4・KEEP-2）と純関数 ``read_limits.usage_of``。

保存先 2 つ（記憶 / エミュレーターの Firestore）で回す。上限は環境変数から読む（本番と同じ経路）。予約額は本物
（Sonnet 5.5 で P = 285,708 µUSD。
値は pricing から取る）。AI は呼ばない（偽の claude_agent_sdk を入れて、呼ばれないことを見る）。
メール・値はすべて架空。
"""

import json
from datetime import datetime

import pytest
from helpers import fake_agent_sdk
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.tokens import unsigned_token
from statement_read import app_settings, pricing

from loss_note_api.allowlist import ALLOWED_EMAILS_VAR
from loss_note_api.app import create_app
from loss_note_api.read_limits import (
    BYPASS_EMAILS_VAR,
    JST,
    USER_COUNT_VAR,
    USER_USD_VAR,
    ReadLimits,
    month_first_day,
    usage_of,
)
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.store import READ_DAYS, READ_SPEND, FirestoreStore

A = "aiUsageUserA"
B = "aiUsageUserB"
PATH = "/api/ai-usage"
BYPASS = "fictional.usage.bypass@example.com"
OTHER = "fictional.usage.normal@example.com"
P = ReadLimits().reserve_micro_usd
# 例の表の境界（P の式。#66 で予約額が変わっても表の意味を保つ）: 計上額 + P がちょうど利用者の上限 1.00 USD /
# 1 µUSD 越える / 全体の上限 2.00 USD を 1 µUSD 越える
AT_USER = 1_000_000 - P
OVER_USER = AT_USER + 1
OVER_DAILY = 2_000_000 - P + 1


def _ms(y: int, mo: int, d: int, h: int, mi: int = 0) -> int:
    """日本時間の日時 → エポックのミリ秒"""
    return int(datetime(y, mo, d, h, mi, tzinfo=JST).timestamp() * 1000)


NOON_1118 = _ms(2026, 11, 18, 12)
EARLY_1201 = _ms(2026, 12, 1, 0, 30)  # 日本時間 12-01 の 0:30（UTC では 11-30 の 15:30）
DEFAULT_LIMITS = {"count": 30, "userMicroUsd": 1_000_000, "dailyMicroUsd": 2_000_000}
KEYS = {"today", "month", "limits", "bypass", "blocked"}


def test_reserve_is_the_issue_value():
    # 例の表の前提: 予約額は pricing の式から（値を固定するのは packages の test_pricing.py の 1 か所。#66 AC-9）。
    # 例の表の境界は P の式で書き、利用者 1.00 USD に 3 回分・全体 2.00 USD に 7 回分が入る形は変わらない
    assert P == pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)
    assert 3 * P <= 1_000_000 < 4 * P and 7 * P <= 2_000_000 < 8 * P


class Ledger:
    """日の文書を置く・読む（記憶 / エミュレーター）"""

    def __init__(self, store):
        self.store = store

    def seed_user(self, uid: str, day: str, doc: dict) -> None:
        if isinstance(self.store, MemoryStore):
            self.store.read_days.setdefault(uid, {})[day] = dict(doc)
            return
        self.store._db().collection("users").document(uid).collection(READ_DAYS).document(day).set(dict(doc))

    def seed_spend(self, day: str, doc: dict) -> None:
        if isinstance(self.store, MemoryStore):
            self.store.spend[day] = dict(doc)
            return
        self.store._db().collection(READ_SPEND).document(day).set(dict(doc))

    def snapshot(self) -> dict:
        if isinstance(self.store, MemoryStore):
            return {"days": json.dumps(self.store.read_days, sort_keys=True),
                    "spend": json.dumps(self.store.spend, sort_keys=True)}
        db = self.store._db()
        out = {}
        for uid in (A, B):
            for s in db.collection("users").document(uid).collection(READ_DAYS).stream():
                out[f"{uid}/{s.id}"] = s.to_dict()
        for s in db.collection(READ_SPEND).stream():
            out[f"spend/{s.id}"] = s.to_dict()
        return out


class Client:
    def __init__(self, app, store):
        self.app = app
        self.ledger = Ledger(store)

    def get(self, uid: str | None = A, email: str | None = OTHER, verified: bool = True):
        headers = {}
        if uid is not None:
            kw = {} if email is None else {"email": email, "email_verified": verified}
            headers["Authorization"] = f"Bearer {unsigned_token(uid, PROJECT, exp_offset=10**9, **kw)}"
        return self.app.test_client().get(PATH, headers=headers)


@pytest.fixture
def sdk(monkeypatch):
    return fake_agent_sdk.install(monkeypatch)


@pytest.fixture
def make(store_kind, monkeypatch):
    """環境変数（extra）と時刻を足した API を作る。上限は環境変数から（read_limits を注入しない）"""
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
            "ANTHROPIC_API_KEY": "KEY-MARKER-使った量-62", BYPASS_EMAILS_VAR: BYPASS}

    def build(now: int = NOON_1118, **extra) -> Client:
        app = create_app({**base, **extra}, store=store, clock=lambda: now)
        return Client(app, store)

    return build


def _logs(err: str) -> list[dict]:
    return [json.loads(ln) for ln in err.splitlines() if ln.startswith("{") and '"ai_usage"' in ln]


# ---- AC-1: 例の表 #1〜#8・#10・#11 ----

D = "2026-11-18"
EXAMPLES = [
    # (行, メール, 今日の文書, ほかの日の文書 {日付: 文書}, 時刻, 追加の環境変数, 期待の today, month, bypass, blocked)
    ("#1", OTHER, None, {}, NOON_1118, {}, (0, 0), (0, 0), False, (False, False)),
    ("#2", OTHER, {"count": 3, "microUsd": 120_000}, {"2026-11-01": {"count": 2, "microUsd": 80_000}}, NOON_1118, {},
     (3, 120_000), (5, 200_000), False, (False, False)),
    ("#3", OTHER, {"count": 24, "microUsd": 300_000}, {}, NOON_1118, {}, (24, 300_000), (24, 300_000), False,
     (False, False)),
    ("#4", OTHER, {"count": 30, "microUsd": 400_000}, {}, NOON_1118, {}, (30, 400_000), (30, 400_000), False,
     (True, False)),
    ("#5", OTHER, {"count": 3, "microUsd": OVER_USER}, {}, NOON_1118, {}, (3, OVER_USER), (3, OVER_USER), False,
     (False, True)),
    ("#6", OTHER, {"count": 3, "microUsd": AT_USER}, {}, NOON_1118, {}, (3, AT_USER), (3, AT_USER), False,
     (False, False)),
    ("#7", OTHER, {"count": 2}, {"2026-11-17": {"count": 1, "microUsd": -1}}, NOON_1118, {}, (2, 2 * P), (3, 3 * P),
     False, (False, False)),
    ("#8", BYPASS, {"count": 40, "microUsd": 1_500_000}, {}, NOON_1118, {}, (40, 1_500_000), (40, 1_500_000), True,
     (False, False)),
    ("#10", OTHER, None,
     {"2026-12-01": {"count": 1, "microUsd": 40_000}, "2026-11-30": {"count": 5, "microUsd": 200_000}},
     EARLY_1201, {}, (1, 40_000), (1, 40_000), False, (False, False)),
    ("#11", OTHER, None, {}, NOON_1118, {USER_COUNT_VAR: "0"}, (0, 0), (0, 0), False, (True, False)),
]


@pytest.mark.parametrize(("row", "email", "today_doc", "others", "now", "extra", "today", "month", "bypass", "blocked"),
                         EXAMPLES, ids=[e[0] for e in EXAMPLES])
def test_issue62_example_table(make, sdk, capfd, row, email, today_doc, others, now, extra, today, month, bypass,
                               blocked):
    c = make(now, **extra)
    if today_doc is not None:
        c.ledger.seed_user(A, D, today_doc)
    for day, doc in others.items():
        c.ledger.seed_user(A, day, doc)
    capfd.readouterr()
    res = c.get(email=email)
    _out, err = capfd.readouterr()
    assert res.status_code == 200, row
    body = res.get_json()
    day = D if now == NOON_1118 else "2026-12-01"
    assert body["today"] == {"date": day, "count": today[0], "microUsd": today[1]}, row
    assert body["month"] == {"month": day[:7], "count": month[0], "microUsd": month[1]}, row
    assert body["bypass"] is bypass, row
    assert body["blocked"] == {"count": blocked[0], "microUsd": blocked[1]}, row
    if bypass:
        assert body["limits"] == {"count": None, "userMicroUsd": None, "dailyMicroUsd": 2_000_000}
    elif extra:
        assert body["limits"] == {**DEFAULT_LIMITS, "count": 0}
    else:
        assert body["limits"] == DEFAULT_LIMITS
    assert [ln["reason"] for ln in _logs(err)] == ["ok"]
    assert len(sdk.calls) == 0  # AI を呼ばない


def test_user_spend_limit_from_env(make, sdk):
    # 上限の値は環境変数の値を返す（利用者の費用 0.50 USD）
    c = make(**{USER_USD_VAR: "0.50"})
    c.ledger.seed_user(A, D, {"count": 1, "microUsd": 300_000})
    body = c.get().get_json()
    assert body["limits"]["userMicroUsd"] == 500_000
    assert body["blocked"]["microUsd"] is True  # 300,000 + P > 500,000


# ---- AC-2: 本人の分だけ（#9）----

def test_only_own_usage(make, sdk):
    c = make()
    first = c.get().get_json()
    c.ledger.seed_user(B, D, {"count": 9, "microUsd": 900_000})
    c.ledger.seed_spend(D, {"count": 9, "microUsd": 1_900_000})
    res = c.get()
    body = res.get_json()
    assert body == first
    assert set(body) == KEYS
    assert set(body["today"]) == {"date", "count", "microUsd"}
    assert set(body["month"]) == {"month", "count", "microUsd"}
    assert set(body["limits"]) == {"count", "userMicroUsd", "dailyMicroUsd"}
    assert set(body["blocked"]) == {"count", "microUsd"}
    # 全体の使った量（1,900,000）も B の値（900,000）も応答のどこにも無い
    raw = res.get_data(as_text=True)
    assert "1900000" not in raw and "900000" not in raw
    # B は B の分だけ
    assert c.get(uid=B).get_json()["today"] == {"date": D, "count": 9, "microUsd": 900_000}


# ---- AC-3: 今月の日の文書だけ ----

def test_month_reads_only_this_month(make, sdk):
    c = make()
    c.ledger.seed_user(A, "2026-10-31", {"count": 7, "microUsd": 700_000})
    for d in range(1, 32):  # 11-31 は暦に無い日付だが、文書 ID の範囲の端として置く
        c.ledger.seed_user(A, f"2026-11-{d:02d}", {"count": 1, "microUsd": 10_000 * d})
    c.ledger.seed_user(A, "2026-12-01", {"count": 4, "microUsd": 400_000})
    body = c.get().get_json()
    assert body["month"] == {"month": "2026-11", "count": 18, "microUsd": 10_000 * sum(range(1, 19))}
    assert body["today"] == {"date": D, "count": 1, "microUsd": 180_000}
    if isinstance(c.ledger.store, MemoryStore):
        assert c.ledger.store.usage_reads == 1


def test_store_range_reads_at_most_31_days(store_kind):
    # 保存先の範囲の読み: 両端を含み、範囲の外を返さず、31 件まで
    if store_kind == "firestore":
        _auth, fs_host = require_emulator()
        clear_firestore(fs_host)
        store = FirestoreStore(PROJECT)
    else:
        store = MemoryStore()
    ledger = Ledger(store)
    ledger.seed_user(A, "2026-10-31", {"count": 1})
    for d in range(1, 32):
        ledger.seed_user(A, f"2026-11-{d:02d}", {"count": d})
    ledger.seed_user(A, "2026-11-31x", {"count": 99})  # 範囲の外（11-31 より後）
    ledger.seed_user(B, "2026-11-05", {"count": 50})
    got = store.read_days_between(A, "2026-11-01", "2026-11-18")
    assert [d for d, _ in got] == [f"2026-11-{d:02d}" for d in range(1, 19)]
    assert got[4][1] == {"count": 5}
    whole = store.read_days_between(A, "2026-11-01", "2026-11-31")
    assert len(whole) == 31 and whole[-1][0] == "2026-11-31"


# ---- AC-4・KEEP-2: 失敗の場面と書かないこと ----

def test_failures_return_fixed_bodies_and_write_nothing(make, sdk, store_kind, capfd):
    c = make()
    c.ledger.seed_user(A, D, {"count": 2, "microUsd": 50_000})
    c.ledger.seed_spend(D, {"count": 2, "microUsd": 50_000})
    before = c.ledger.snapshot()

    res = c.get(uid=None)
    assert (res.status_code, res.get_json()) == (401, {"error": "unauthorized"})

    allowed = make(**{ALLOWED_EMAILS_VAR: "fictional.someone.else@example.com"})
    res = allowed.get()
    assert (res.status_code, res.get_json()) == (403, {"error": "forbidden"})

    capfd.readouterr()
    bad = make(**{USER_USD_VAR: "abc"})
    res = bad.get()
    _out, err = capfd.readouterr()
    assert (res.status_code, res.get_json()) == (503, {"error": "read_unavailable"})
    assert [(ln["reason"], ln.get("var")) for ln in _logs(err)] == [("limit_config", USER_USD_VAR)]
    assert "abc" not in err

    if store_kind == "memory":
        c.ledger.store.unavailable = True
        res = c.get()
        assert (res.status_code, res.get_json()) == (503, {"error": "unavailable"})
        c.ledger.store.unavailable = False

    ok = c.get()
    assert ok.status_code == 200
    assert c.ledger.snapshot() == before  # 読むだけ（日の文書が変わらない）
    assert len(sdk.calls) == 0


def test_unconfigured_returns_503():
    # プロジェクト ID の無い起動では、ほかの記録の入口と同じく 503（閉じる側）
    app = create_app({})
    res = app.test_client().get(PATH)
    assert (res.status_code, res.get_json()) == (503, {"error": "unavailable"})


# ---- 純関数 usage_of ----

def test_usage_of_pure_examples():
    limits = ReadLimits()
    assert month_first_day("2026-11-18") == "2026-11-01"
    body = usage_of("2026-11-18", {}, limits, bypass=False)
    assert body["today"] == {"date": "2026-11-18", "count": 0, "microUsd": 0}
    # 境目: 等しいときは止まらない
    eq = usage_of("2026-11-18", {"2026-11-18": {"count": 1, "microUsd": AT_USER}}, limits, bypass=False)
    assert eq["blocked"] == {"count": False, "microUsd": False}
    over = usage_of("2026-11-18", {"2026-11-18": {"count": 1, "microUsd": OVER_USER}}, limits, bypass=False)
    assert over["blocked"] == {"count": False, "microUsd": True}
    # ほかの月・今日より後の鍵は入れない（入口が範囲で読んでも、渡されたら除く）
    mixed = usage_of("2026-11-18", {"2026-10-31": {"count": 5, "microUsd": 5},
                                    "2026-11-19": {"count": 5, "microUsd": 5},
                                    "2026-11-02": {"count": 1, "microUsd": 7}}, limits, bypass=False)
    assert mixed["month"] == {"month": "2026-11", "count": 1, "microUsd": 7}
    # 回数の負・型違いは 0（金額の見積もりも 0 回で 0）
    odd = usage_of("2026-11-18", {"2026-11-18": {"count": -3}, "2026-11-01": {"count": "x", "microUsd": 9}}, limits,
                   bypass=False)
    assert odd["today"]["count"] == 0 and odd["today"]["microUsd"] == 0
    assert odd["month"] == {"month": "2026-11", "count": 0, "microUsd": 9}
    # バイパスは止まらない
    by = usage_of("2026-11-18", {"2026-11-18": {"count": 99, "microUsd": 9_000_000}}, limits, bypass=True)
    assert by["blocked"] == {"count": False, "microUsd": False}


def test_usage_month_sum_property():
    # 性質: 今月の和 = 今月 1 日〜今日の各日の値の和（金額は判定と同じ見積もり）
    import random

    rng = random.Random(62)
    limits = ReadLimits()
    for _ in range(200):
        days = {}
        for d in range(1, 31):
            if rng.random() < 0.5:
                doc = {"count": rng.randint(0, 40)}
                if rng.random() < 0.8:
                    doc["microUsd"] = rng.choice([rng.randint(0, 2_000_000), -1])
                days[f"2026-11-{d:02d}"] = doc
        today = f"2026-11-{rng.randint(1, 30):02d}"
        body = usage_of(today, days, limits, bypass=False)
        in_month = [doc for day, doc in days.items() if day <= today]
        assert body["month"]["count"] == sum(doc["count"] for doc in in_month)
        expect = sum(doc["microUsd"] if doc.get("microUsd", -1) >= 0 else doc["count"] * P for doc in in_month)
        assert body["month"]["microUsd"] == expect
        assert body["month"]["count"] >= body["today"]["count"]
