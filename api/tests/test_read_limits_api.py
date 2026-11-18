"""読み取りの 1 日の上限（Issue #44 の AC-1〜AC-5・AC-7・KEEP-2）。

保存先 2 つ（記憶 / エミュレーターの Firestore）で回す。

実際の AI は呼ばない（偽の claude_agent_sdk）。時計は決めた時刻（エポックのミリ秒）を返し、トークンの exp は十分先にする
（``check_claims`` は exp だけを今と比べる）。画像は合成のバイト列、値はすべて架空。金額は整数の µUSD。
"""

import json
import sys
import threading
from datetime import UTC, datetime

import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.tokens import unsigned_token

from loss_note_api.app import create_app
from loss_note_api.read_limits import ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.store import READ_DAYS, READ_SPEND, FirestoreStore

A = "limitUserA"
B = "limitUserB"
PATH = "/api/statement-reads"
KEY_MARKER = "KEY-MARKER-上限の資格情報-91d3"
EMAIL = "fictional.limits@example.com"
IMAGE = png(800, 600, size=2_000)
# 例 C の予約額は架空に 0.05 USD
LIMITS = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000)


def ms(y, mo, d, h, mi, s=0) -> int:
    return int(datetime(y, mo, d, h, mi, s, tzinfo=UTC).timestamp() * 1000)


NOON_1118 = ms(2026, 11, 18, 3, 0)  # 日本時間 11-18 の 12:00
D1118, D1119 = "2026-11-18", "2026-11-19"


class FixedClock:
    def __init__(self, now: int):
        self.now = now

    def __call__(self) -> int:
        return self.now


class Ledger:
    """計上の文書を保存先ごとに読み書きする（テストの準備と確かめ）"""

    def __init__(self, store):
        self.store = store

    def user(self, uid: str, day: str) -> dict | None:
        if isinstance(self.store, MemoryStore):
            return self.store.read_days.get(uid, {}).get(day)
        snap = self.store._db().collection("users").document(uid).collection(READ_DAYS).document(day).get()
        return snap.to_dict() if snap.exists else None

    def spend(self, day: str) -> dict | None:
        if isinstance(self.store, MemoryStore):
            return self.store.spend.get(day)
        snap = self.store._db().collection(READ_SPEND).document(day).get()
        return snap.to_dict() if snap.exists else None

    def count(self, uid: str, day: str) -> int:
        return (self.user(uid, day) or {}).get("count", 0)

    def micro(self, day: str) -> int:
        return (self.spend(day) or {}).get("microUsd", 0)

    def seed(self, uid: str | None, day: str, count: int | None = None, micro: int | None = None) -> None:
        # 利用者の文書は #51 からの形（回数と金額 0）。金額の欠けは回数 × 予約額に見積もる（#51）ので、回数の上限を
        # 見るこのファイルのテストでは金額 0 を明示する
        if isinstance(self.store, MemoryStore):
            if count is not None:
                self.store.read_days.setdefault(uid, {})[day] = {"count": count, "microUsd": 0}
            if micro is not None:
                self.store.spend[day] = {"count": 1, "microUsd": micro}
            return
        db = self.store._db()
        if count is not None:
            ref = db.collection("users").document(uid).collection(READ_DAYS).document(day)
            ref.set({"count": count, "microUsd": 0})
        if micro is not None:
            db.collection(READ_SPEND).document(day).set({"count": 1, "microUsd": micro})


class LimitClient:
    def __init__(self, app, store, clock):
        self.app = app
        self.store = store
        self.clock = clock
        self.ledger = Ledger(store)

    def post(self, uid: str | None = A, data: bytes = IMAGE, content_type: str = "image/png", **token_kw):
        h = {}
        if uid is not None:
            h["Authorization"] = f"Bearer {unsigned_token(uid, PROJECT, exp_offset=10**9, **token_kw)}"
        return self.app.test_client().post(PATH, data=data, headers=h, content_type=content_type)


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = {"kind": "statement", "rows": []}
    return fake


@pytest.fixture
def limited(store_kind, monkeypatch):
    """上限を注入した読み取りの API（資格情報あり・決めた時計）。make(limits=, read_timeout=) で作る"""
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
    env = {AUTH_EMULATOR: auth_host, FIRESTORE_EMULATOR: fs_host, "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": KEY_MARKER}

    def make(limits: ReadLimits = LIMITS, read_timeout: float | None = None) -> LimitClient:
        clock = FixedClock(NOON_1118)
        app = create_app(env, store=store, clock=clock, read_timeout=read_timeout, read_limits=limits)
        return LimitClient(app, store, clock)

    return make


# ---- AC-1: 利用者ごとの回数（例 L1・L2・L3・L5） ----


def test_user_limit_L1_L2(limited, sdk):
    c = limited()
    c.ledger.seed(A, D1118, count=29)
    res = c.post()
    assert res.status_code == 200 and len(sdk.calls) == 1  # L1
    assert c.ledger.count(A, D1118) == 30
    res = c.post()
    assert res.status_code == 429 and res.get_json() == {"error": "read_limited"}  # L2
    assert len(sdk.calls) == 1  # AI を呼ばない
    assert c.ledger.count(A, D1118) == 30


def test_user_limit_resets_at_jst_midnight_L3(limited, sdk):
    c = limited()
    c.ledger.seed(A, D1118, count=30)
    c.clock.now = ms(2026, 11, 18, 14, 59, 59)  # 日本時間 11-18 の 23:59:59
    assert c.post().status_code == 429
    c.clock.now = ms(2026, 11, 18, 15, 0, 0)  # 日本時間 11-19 の 00:00:00
    res = c.post()
    assert res.status_code == 200 and len(sdk.calls) == 1
    assert c.ledger.count(A, D1119) == 1
    assert c.ledger.count(A, D1118) == 30


def test_user_limit_per_user_L5(limited, sdk):
    c = limited()
    c.ledger.seed(A, D1118, count=30)
    assert c.post(A).status_code == 429
    res = c.post(B)
    assert res.status_code == 200 and len(sdk.calls) == 1
    assert c.ledger.count(B, D1118) == 1 and c.ledger.count(A, D1118) == 30


# ---- AC-2: 日の区切り（例 L4） ----


def test_day_boundary_L4(limited, sdk):
    c = limited()
    c.clock.now = ms(2026, 11, 18, 14, 59, 59)
    assert c.post().status_code == 200
    c.clock.now = ms(2026, 11, 18, 15, 0, 0)
    assert c.post().status_code == 200
    assert c.ledger.count(A, D1118) == 1 and c.ledger.count(A, D1119) == 1
    assert c.ledger.spend(D1118)["count"] == 1 and c.ledger.spend(D1119)["count"] == 1


# ---- AC-3: 数えるのは AI へ送った要求だけ（例 L6・L7・L9） ----


def test_not_counted_L6_401_503(limited, sdk, monkeypatch):
    c = limited()
    c.ledger.seed(A, D1118, count=29)
    # L6: 600,000 B の画像 → 400
    res = c.post(data=png(800, 600, size=600_000))
    assert res.status_code == 400 and res.get_json() == {"error": "image_rejected", "reason": "bytes"}
    # 401（トークンなし・期限切れ）
    assert c.post(uid=None).status_code == 401
    assert c.app.test_client().post(PATH, data=IMAGE, content_type="image/png", headers={
        "Authorization": f"Bearer {unsigned_token(A, PROJECT, exp_offset=-10**10)}"}).status_code == 401
    # 503（SDK が無い）
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    res = c.post()
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0
    assert c.ledger.count(A, D1118) == 29
    assert c.ledger.spend(D1118) is None


def test_not_counted_without_credential(store_kind, monkeypatch, sdk):
    # 503（資格情報なし）も数えない
    if store_kind == "firestore":
        pytest.skip("記憶の保存先だけで足りる（保存先に触れる前に返る）")
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    store = MemoryStore()
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT}
    c = LimitClient(create_app(env, store=store, clock=FixedClock(NOON_1118), read_limits=LIMITS), store,
                    FixedClock(NOON_1118))
    res = c.post()
    assert res.status_code == 503 and len(sdk.calls) == 0
    assert store.read_days == {} and store.spend == {}


def test_timeout_counted_L7(limited, sdk):
    c = limited(read_timeout=0.05)
    c.ledger.seed(A, D1118, count=29)
    sdk.script = "hang"
    res = c.post()
    assert res.status_code == 504 and res.get_json() == {"error": "read_timeout"}
    assert c.ledger.count(A, D1118) == 30


def test_store_failure_closes_L9(store_kind, monkeypatch, sdk):
    if store_kind == "firestore":
        pytest.skip("保存先の失敗は記憶の保存先で差し込む")
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": KEY_MARKER}
    for fail in ("fail_limits", "fail_with"):
        store = MemoryStore()
        if fail == "fail_limits":
            store.fail_limits = True
        else:
            store.fail_with = PermissionError("denied")  # つながらない以外の失敗でも閉じる
        c = LimitClient(create_app(env, store=store, clock=FixedClock(NOON_1118), read_limits=LIMITS), store,
                        FixedClock(NOON_1118))
        res = c.post()
        assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}, fail
        assert len(sdk.calls) == 0
        assert store.read_days == {} and store.spend == {}


def test_settle_failure_keeps_response_and_reserve(store_kind, monkeypatch, sdk, capfd):
    if store_kind == "firestore":
        pytest.skip("保存先の失敗は記憶の保存先で差し込む")
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": KEY_MARKER}
    store = MemoryStore()
    store.fail_settle = True
    c = LimitClient(create_app(env, store=store, clock=FixedClock(NOON_1118), read_limits=LIMITS), store,
                    FixedClock(NOON_1118))
    capfd.readouterr()
    res = c.post()
    assert res.status_code == 200
    assert store.spend[D1118]["microUsd"] == 50_000  # 予約額が残る（多めに数える側）
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    settle = [ln for ln in lines if ln.get("event") == "statement_read_settle"]
    assert settle == [{"event": "statement_read_settle", "reason": "unavailable", "rows": 0, "ms": settle[0]["ms"]}]


# ---- AC-4: 同時の要求で上限を越えない（例 L8） ----


def _parallel(c: LimitClient, n: int) -> list[int]:
    start = threading.Event()
    codes: list[int] = []
    lock = threading.Lock()

    def one():
        start.wait()
        code = c.post().status_code
        with lock:
            codes.append(code)

    threads = [threading.Thread(target=one) for _ in range(n)]
    for t in threads:
        t.start()
    start.set()
    for t in threads:
        t.join(timeout=60)
    assert len(codes) == n
    return codes


def test_concurrent_L8(limited, sdk, store_kind):
    c = limited()
    c.ledger.seed(A, D1118, count=29)
    codes = _parallel(c, 2)
    if store_kind == "memory":
        assert sorted(codes) == [200, 429]
    else:
        # エミュレーターが混むと、残りの 1 本は数える場所の時間切れで 503（閉じる側）になりうる。
        # どちらでも送るのは 1 本だけ（下で確かめる）
        assert sorted(codes) in ([200, 429], [200, 503])
    assert len(sdk.calls) == 1
    assert c.ledger.count(A, D1118) == 30


def test_concurrent_many(limited, sdk, store_kind):
    c = limited()
    c.ledger.seed(A, D1118, count=25)
    codes = _parallel(c, 10)
    sent = codes.count(200)
    # どの順でも、送ったのは上限まで・送った数 = 増えた回数（越えて送らない）
    assert len(sdk.calls) == sent <= 5
    assert c.ledger.count(A, D1118) == 25 + sent
    assert (c.ledger.spend(D1118) or {}).get("count", 0) == sent
    assert set(codes) <= {200, 429, 503}
    if store_kind == "memory":
        assert sent == 5 and codes.count(429) == 5
    else:
        # エミュレーターは同じ文書を読んで書くトランザクションが多く重なると、競合で再試行を使い切って 503
        # （数える場所が使えない = 閉じる側）を返しうる。503 は上限に届いた後にも出うる（時間切れは届いたかどうかと
        # 関係しない）ので、件数の組み合わせは決めない。守るのは上の「越えて送らない・送った数 = 増えた回数」
        assert codes.count(429) + codes.count(503) == 10 - sent


def test_concurrent_spend(limited, sdk, store_kind):
    # 全体の費用: 計上 1.85 USD・予約 0.05 USD → 送れるのは 3 枚まで（別々の利用者が同時に）
    c = limited()
    c.ledger.seed(None, D1118, micro=1_850_000)
    sdk.result_usage, sdk.result_cost = None, None  # 精算しない（予約額のまま）
    start = threading.Event()
    codes: list[int] = []
    lock = threading.Lock()

    def one(uid):
        start.wait()
        code = c.post(uid).status_code
        with lock:
            codes.append(code)

    threads = [threading.Thread(target=one, args=(f"spendUser{i}",)) for i in range(6)]
    for t in threads:
        t.start()
    start.set()
    for t in threads:
        t.join(timeout=60)
    sent = codes.count(200)
    # どの順でも、送ったのは費用の上限まで・送った数だけ予約額が増える（越えて送らない）
    assert len(sdk.calls) == sent <= 3
    assert c.ledger.micro(D1118) == 1_850_000 + sent * 50_000
    assert set(codes) <= {200, 429, 503}
    # エミュレーターは同じ文書のトランザクションが重なると競合で 503（閉じる側）を返しうるので、
    # 厳密な数は記憶の保存先だけで見る（test_concurrent_many と同じ）
    if store_kind == "memory":
        assert sent == 3 and codes.count(429) == 3


# ---- AC-5: 全体の費用（例 C1〜C7。予約額 0.05 USD） ----


def test_spend_C1(limited, sdk):
    c = limited()
    c.ledger.seed(None, D1118, micro=1_900_000)
    # 偽の SDK の既定: 料金表 1,500 × 2 + 300 × 10 = 6,000、SDK の合計額 0.01 USD = 10,000 → 大きい方 10,000
    assert c.post().status_code == 200 and len(sdk.calls) == 1
    assert c.ledger.micro(D1118) == 1_910_000


def test_spend_C2(limited, sdk):
    c = limited()
    c.ledger.seed(None, D1118, micro=1_960_000)
    res = c.post()
    assert res.status_code == 429 and res.get_json() == {"error": "read_limited"}
    assert len(sdk.calls) == 0
    assert c.ledger.micro(D1118) == 1_960_000
    assert c.ledger.count(A, D1118) == 0


def test_spend_C3(limited, sdk):
    c = limited()
    c.ledger.seed(None, D1118, micro=1_950_000)
    assert c.post().status_code == 200 and len(sdk.calls) == 1


def test_spend_C4(limited, sdk):
    c = limited(read_timeout=0.05)
    c.ledger.seed(None, D1118, micro=1_900_000)
    sdk.script = "hang"
    assert c.post().status_code == 504
    assert c.ledger.micro(D1118) == 1_950_000  # 予約額のまま


def test_spend_C5(limited, sdk):
    c = limited()
    c.ledger.seed(None, D1118, micro=1_900_000)
    sdk.script = "is_error"
    sdk.result_usage, sdk.result_cost = None, 0.002
    res = c.post()
    assert res.status_code == 502 and res.get_json() == {"error": "read_failed"}
    assert c.ledger.micro(D1118) == 1_902_000


def test_spend_C5_usage_only(limited, sdk):
    # 使ったトークンだけ受け取れた（料金表 1,000 × 2 = 2,000）
    c = limited()
    c.ledger.seed(None, D1118, micro=1_900_000)
    sdk.script = "is_error"
    sdk.result_usage, sdk.result_cost = {"input_tokens": 1000, "output_tokens": 0}, None
    assert c.post().status_code == 502
    assert c.ledger.micro(D1118) == 1_902_000


@pytest.mark.parametrize(("script", "code"), [("no_result", "read_failed"), ("raise", "read_failed")])
def test_spend_midway_failure_keeps_reserve(limited, sdk, script, code):
    # R2: 途中の失敗（CLI の異常終了 = 結果も例外も無いまま終わる・送り先の例外）は使ったトークンを受け取れない
    # → 予約額のまま数える（多めに数える側）。回数も 1 増える
    c = limited()
    c.ledger.seed(A, D1118, count=3)
    c.ledger.seed(None, D1118, micro=1_900_000)
    sdk.script = script
    res = c.post()
    assert res.status_code == 502 and res.get_json() == {"error": code}
    assert len(sdk.calls) == 1
    assert c.ledger.micro(D1118) == 1_950_000
    assert c.ledger.count(A, D1118) == 4


def test_spend_C6(limited, sdk):
    c = limited()
    c.ledger.seed(None, D1118, micro=1_990_000)
    assert c.post().status_code == 429
    c.clock.now = ms(2026, 11, 18, 15, 0, 1)  # 日本時間 11-19 の 0:00 過ぎ
    assert c.post().status_code == 200 and len(sdk.calls) == 1
    assert c.ledger.micro(D1119) == 10_000
    assert c.ledger.micro(D1118) == 1_990_000


def test_spend_C7(limited, sdk):
    c = limited()
    c.ledger.seed(A, D1118, count=10)
    c.ledger.seed(None, D1118, micro=1_960_000)
    assert c.post().status_code == 429 and len(sdk.calls) == 0
    assert c.ledger.count(A, D1118) == 10


def test_settle_uses_reserved_day(limited, sdk):
    # 0:00 をまたいで終わっても、精算は予約した日の文書へ
    c = limited()
    real_read = sdk._query

    async def query_then_advance(*, prompt, options):
        c.clock.now = ms(2026, 11, 18, 15, 0, 5)
        async for m in real_read(prompt=prompt, options=options):
            yield m

    sdk.query = query_then_advance
    c.clock.now = ms(2026, 11, 18, 14, 59, 59)
    assert c.post().status_code == 200
    assert c.ledger.micro(D1118) == 10_000
    assert c.ledger.spend(D1119) is None


# ---- AC-7: 計上に残るのは日付・回数・金額だけ ----


def test_ledger_keys_and_no_content(limited, sdk):
    c = limited()
    sdk.tool_input = {"kind": "statement", "rows": [{
        "symbol": "LEDGERSYMQZ", "side_written": "buy", "side_of": "position", "entry_price": 13579.5,
        "entry_time": "2026-03-04T01:15", "exit_price": 13600.0, "exit_time": "2026-03-04T06:40", "time_zone": "GMT",
        "qty": 0.5, "fees": None, "pnl_jpy": 2468, "exit_order_type": "unknown"}]}
    res = c.post(data=png(800, 600, size=5_000, filler=b"LEDGERIMG-3e9a"), email=EMAIL)
    assert res.status_code == 200
    user, spend = c.ledger.user(A, D1118), c.ledger.spend(D1118)
    assert set(user) == {"count", "microUsd"}  # #51: 利用者の日の文書にも金額（日付・回数・金額だけは同じ）
    assert set(spend) == {"count", "microUsd"}
    assert all(isinstance(v, int) for v in [*user.values(), *spend.values()])
    text = json.dumps([user, spend], ensure_ascii=False)
    for needle in ("LEDGERSYMQZ", "13579", "2468", "LEDGERIMG", KEY_MARKER, EMAIL, A):
        assert needle not in text


# ---- KEEP-2: 上限の理由のログも同じ鍵の集合 ----


def test_limit_log_shape(limited, sdk, capfd):
    c = limited()
    c.ledger.seed(A, D1118, count=30)
    c.ledger.seed(None, D1118, micro=1_960_000)
    capfd.readouterr()
    c.post(A)  # 回数
    c.post(B)  # 費用
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    reads = [ln for ln in lines if ln.get("event") == "statement_read"]
    assert [ln["reason"] for ln in reads] == ["limited_user", "limited_spend"]
    # 予約まで進んだ回は予約の時間（limit_ms。#60）も出る。AI へは送っていないので read_ms・api_ms は無い
    for ln in reads:
        assert set(ln) == {"event", "reason", "rows", "ms", "limit_ms"} and ln["rows"] == 0
    for needle in (A, B, D1118, "1960000", KEY_MARKER):
        assert needle not in err


def test_limit_unavailable_log_reason(monkeypatch, sdk, capfd):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": KEY_MARKER}
    store = MemoryStore()
    store.fail_limits = True
    c = LimitClient(create_app(env, store=store, clock=FixedClock(NOON_1118), read_limits=LIMITS), store,
                    FixedClock(NOON_1118))
    capfd.readouterr()
    c.post()
    _out, err = capfd.readouterr()
    reads = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{") and '"statement_read"' in ln]
    assert [ln["reason"] for ln in reads] == ["limit_unavailable"]
    assert set(reads[0]) == {"event", "reason", "rows", "ms", "limit_ms"}


def test_other_apis_unaffected_by_limits(limited, sdk):
    # R4: 上限に当たっていても記録の API は動く
    c = limited()
    c.ledger.seed(A, D1118, count=30)
    c.ledger.seed(None, D1118, micro=1_990_000)
    assert c.post().status_code == 429
    h = {"Authorization": f"Bearer {unsigned_token(A, PROJECT, exp_offset=10**9)}"}
    assert c.app.test_client().get("/api/trades", headers=h).status_code == 200
    assert c.app.test_client().get("/api/health").status_code == 200
