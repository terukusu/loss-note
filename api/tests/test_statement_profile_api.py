"""明細の特徴の覚え（Issue #66 の AC-1・AC-4・AC-5・AC-6・KEEP-5）。

読み取りの応答の ``profile`` と、覚える入口 ``PUT /api/statement-profiles/{鍵}``。保存先 2 つ（記憶 / エミュレーターの
Firestore）で同じテストを回す。実際の AI は呼ばない（偽の claude_agent_sdk）。会社の名前・値はすべて架空。
"""

import copy
import json
import logging

import pytest
from conftest import ApiClient
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.records import t1

from loss_note_api import logs
from loss_note_api.app import create_app
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.statement_profile import profile_key
from loss_note_api.store import FirestoreStore

U1 = "profileApiUser1"
U2 = "profileApiUser2"
READ = "/api/statement-reads"
X = "架空証券 X"
Y = "架空 FX Y"
IMAGE = png(800, 600, size=2_000)


def read_row(**kw) -> dict:
    row = {
        "symbol": "US30", "side_written": "buy", "side_of": "position", "entry_price": 100.0,
        "entry_time": "2026-03-04T01:15", "exit_price": 99.4, "exit_time": "2026-03-04T06:40", "time_zone": "JST",
        "qty": 100, "fees": [50, 50], "pnl": -9100, "pnl_currency": "JPY", "exit_order_type": "stop",
    }  # fmt: skip
    row.update(kw)
    return row


def statement(issuer, *rows) -> dict:
    return {"kind": "statement", "issuer": issuer, "rows": list(rows) or [read_row()]}


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = statement(X)
    return fake


@pytest.fixture
def papi(store_kind, monkeypatch, clock):
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
           "ANTHROPIC_API_KEY": "fictional-key-for-tests"}
    return ApiClient(create_app(env, store=store, clock=clock), store, store_kind)


def read(api: ApiClient, uid: str):
    return api.post(READ, uid, raw=IMAGE, content_type="image/png")


def learn(api: ApiClient, uid: str, key: str, account_id: str):
    return api.put(f"/api/statement-profiles/{key}", uid, {"accountId": account_id})


def account(api: ApiClient, uid: str, name: str) -> str:
    res = api.post("/api/accounts", uid, {"name": name, "capitalYen": 1_000_000})
    assert res.status_code == 201, res.get_json()
    return res.get_json()["id"]


@pytest.fixture
def capture(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(logs.logger, "propagate", True)
    return caplog


# ---- AC-1: 応答の形と、会社の名前が出ないこと（S12） ----


def test_response_has_profile_without_issuer(papi, sdk, capture, capfd):
    res = read(papi, U1)
    assert res.status_code == 200
    body = res.get_json()
    assert set(body) == {"kind", "rows", "profile"}
    assert set(body["profile"]) == {"key", "accountId"}
    assert body["profile"]["key"] == profile_key(U1, X, [read_row()])
    assert body["profile"]["accountId"] is None  # 覚えなし（S1）
    row = body["rows"][0]
    assert row["pnlCurrency"] == "JPY" and row["pnl"] == -9100 and row["feesTotal"] == 100
    out, err = capfd.readouterr()
    log_text = "\n".join([out, err, *(r.getMessage() for r in capture.records)])
    for text in (res.get_data(as_text=True), log_text):
        assert "架空証券" not in text and "架空証券 X".encode("unicode_escape").decode() not in text
    # ログには鍵も出さない（決まった語だけ）
    assert body["profile"]["key"] not in log_text
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    (line,) = [ln for ln in lines if ln.get("event") == "statement_read"]
    assert line["profile"] == "miss"


def test_no_issuer_profile_is_null(papi, sdk):
    # S5: 会社の名前が写っていない明細は鍵なし（profile = null）
    sdk.tool_input = statement(None)
    body = read(papi, U1).get_json()
    assert body["profile"] is None


# ---- AC-4: 覚える / 覚え直す（S1〜S4・S7・S10）。後に記録したものが勝つ ----


def test_learn_overwrites(papi, sdk):
    a = account(papi, U1, "口座 A")
    b = account(papi, U1, "口座 B")
    key = read(papi, U1).get_json()["profile"]["key"]
    assert learn(papi, U1, key, a).status_code == 204  # S1: A で記録 → X の鍵 → A
    assert read(papi, U1).get_json()["profile"] == {"key": key, "accountId": a}  # S2
    assert learn(papi, U1, key, b).status_code == 204  # S3・S4: B で記録 → 覚え直す
    assert read(papi, U1).get_json()["profile"] == {"key": key, "accountId": b}
    assert papi.store.get_statement_profile(U1, key)["accountId"] == b


def test_learn_default_account_for_single_account_user(papi, sdk):
    # S7: 口座が 1 つ（既定の口座）の利用者でも覚える（既定の口座がまだ無ければ作ってから）
    key = read(papi, U1).get_json()["profile"]["key"]
    assert learn(papi, U1, key, "default").status_code == 204
    assert read(papi, U1).get_json()["profile"]["accountId"] == "default"


def test_learn_account_added_on_the_spot(papi, sdk):
    # S10: その場で足した口座 C で記録 → X の鍵 → C
    c = account(papi, U1, "口座 C")
    key = read(papi, U1).get_json()["profile"]["key"]
    assert learn(papi, U1, key, c).status_code == 204
    assert papi.store.get_statement_profile(U1, key)["accountId"] == c


def test_other_issuer_has_no_suggestion(papi, sdk):
    # S6: X → A の覚えは Y の明細に使わない
    a = account(papi, U1, "口座 A")
    key_x = read(papi, U1).get_json()["profile"]["key"]
    learn(papi, U1, key_x, a)
    sdk.tool_input = statement(Y)
    prof = read(papi, U1).get_json()["profile"]
    assert prof["key"] != key_x and prof["accountId"] is None


# ---- 入口の検査 ----


@pytest.mark.parametrize("bad", ["0" * 31, "0" * 33, "G" * 32, "x", "..%2F" + "0" * 32, "0" * 32 + "%2Fx"])
def test_bad_key_is_404_without_store(papi, sdk, bad):
    a = account(papi, U1, "口座 A")
    res = learn(papi, U1, bad, a)
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}


@pytest.mark.parametrize(
    "body,issue",
    [
        ({}, {"field": "accountId", "kind": "required"}),
        ({"accountId": 5}, {"field": "accountId", "kind": "format"}),
        ({"accountId": "a/b"}, {"field": "accountId", "kind": "format"}),
        ({"accountId": "default", "issuer": X}, {"field": "", "kind": "unknownField"}),
        ([], {"field": "", "kind": "type"}),
    ],
)
def test_bad_body_is_400(papi, sdk, body, issue):
    res = papi.put(f"/api/statement-profiles/{'0' * 32}", U1, body)
    assert res.status_code == 400
    assert issue in res.get_json()["issues"]
    assert papi.store.get_statement_profile(U1, "0" * 32) is None


def test_missing_account_is_400(papi, sdk):
    res = learn(papi, U1, "0" * 32, "noSuchAccount")
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "accountId", "kind": "notFound"}]
    assert papi.store.get_statement_profile(U1, "0" * 32) is None


def test_unauthenticated_is_401(papi, sdk):
    res = papi.put(f"/api/statement-profiles/{'0' * 32}", None, {"accountId": "default"})
    assert res.status_code == 401


# ---- AC-5: 利用者の分離（S11） ----


def test_s11_users_are_separated(papi, sdk):
    a = account(papi, U1, "口座 A")
    key1 = read(papi, U1).get_json()["profile"]["key"]
    assert learn(papi, U1, key1, a).status_code == 204
    # 利用者 2 の同じ会社の明細: 鍵が違い、提案なし
    prof2 = read(papi, U2).get_json()["profile"]
    assert prof2["key"] != key1 and prof2["accountId"] is None
    # 利用者 2 が利用者 1 の鍵で読み書きしても、利用者 1 の覚えは読めない・変わらない
    assert learn(papi, U2, key1, a).status_code == 400  # 利用者 1 の口座は利用者 2 には無い
    assert learn(papi, U2, key1, "default").status_code == 204  # 利用者 2 の場所に書く
    assert papi.store.get_statement_profile(U1, key1)["accountId"] == a
    assert papi.store.get_statement_profile(U2, key1)["accountId"] == "default"
    assert read(papi, U1).get_json()["profile"]["accountId"] == a


# ---- AC-6: 保存の中身（S12） ----


def test_profile_doc_fields(papi, sdk, clock):
    a = account(papi, U1, "口座 A")
    inst = papi.instrument(U1, "US30")
    key = read(papi, U1).get_json()["profile"]["key"]
    trade = papi.post("/api/trades", U1, t1(inst["id"], source="statement", accountId=a)).get_json()
    assert learn(papi, U1, key, a).status_code == 204
    doc = papi.store.get_statement_profile(U1, key)
    assert set(doc) == {"accountId", "updatedAt"} and doc["accountId"] == a
    assert isinstance(doc["updatedAt"], int)
    # 取引の文書に鍵も会社の名前も無い
    stored = papi.store.get_trade(U1, trade["id"])
    text = json.dumps(stored, ensure_ascii=False)
    assert key not in text and "架空証券" not in text and "issuer" not in text and "profile" not in text


# ---- KEEP-5: 読み取りは覚えを読むだけ（書かない）。覚えが読めなくても 200 ----


def test_read_does_not_write_memory(memory_api, monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = statement(X)
    store = memory_api.store
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": "fictional-key-for-tests"}
    api = ApiClient(create_app(env, store=store), store, "memory")
    before = copy.deepcopy(store.users)
    res = read(api, U1)
    assert res.status_code == 200 and res.get_json()["profile"]["accountId"] is None
    assert store.users == before


def test_profile_store_failure_keeps_200(monkeypatch, capfd):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = statement(X)
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    store = MemoryStore()
    store.fail_profiles = True
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "ANTHROPIC_API_KEY": "fictional-key-for-tests"}
    api = ApiClient(create_app(env, store=store), store, "memory")
    capfd.readouterr()
    res = read(api, U1)
    assert res.status_code == 200
    prof = res.get_json()["profile"]
    assert prof["accountId"] is None and len(prof["key"]) == 32
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    (line,) = [ln for ln in lines if ln.get("event") == "statement_read"]
    assert line["profile"] == "unavailable" and line["reason"] == "ok"
    # 覚える入口の保存先の失敗は 503（画面は黙って捨てる）
    assert learn(api, U1, prof["key"], "default").status_code == 503


# ---- #118: オプションの行（限月・P / C・行使価格・買い / 売り・ポジションの番号）。先物の行は前と同じ ----


def _option_row(strike: int, side_written: str, **kw) -> dict:
    return read_row(
        symbol=f"日経225OP 1月限 P {strike}", side_written=side_written, side_of="close",
        entry_time="2026-12-10T10:05", exit_time="2026-12-15T13:50", time_zone="JST", qty=2,
        option={"underlying": "日経225OP", "expiry_year": None, "expiry_month": 1, "put_call": "put", "strike": strike},
        **kw,
    )  # fmt: skip


def test_option_rows_in_response(papi, sdk):
    sdk.tool_input = statement(X, _option_row(36000, "buy"), _option_row(35500, "sell"), read_row())
    res = read(papi, U1)
    assert res.status_code == 200
    body = res.get_json()
    first, second, futures = body["rows"]
    assert first["option"] == {
        "underlying": "日経225OP", "expiry": "2027-01", "expiryYearInferred": True, "putCall": "put",
        "strike": 36000, "side": "sell", "position": 0,
    }  # fmt: skip
    assert second["option"]["side"] == "buy" and second["option"]["position"] == 0
    assert "option" not in futures
    # 先物だけの明細とは鍵が分かれる
    sdk.tool_input = statement(X, read_row(side_of="close"))
    assert read(papi, U1).get_json()["profile"]["key"] != body["profile"]["key"]


_NULLS = {"underlying": None, "expiry_year": None, "expiry_month": None, "put_call": None, "strike": None}


@pytest.mark.parametrize("empty", [{}, _NULLS, {**_NULLS, "underlying": ""}, {**_NULLS, "underlying": " 　"},
                                   {"underlying": "  ", "strike": None}])
def test_all_null_option_keeps_futures_response_and_key(papi, sdk, empty):
    """レビュー B1: AI が先物の行の option を null ではなく中身が空の物で返しても、応答の行と鍵は前と同じ"""
    sdk.tool_input = statement(X, read_row())
    before = read(papi, U1).get_json()
    sdk.tool_input = statement(X, read_row(option=empty))
    after = read(papi, U1).get_json()
    assert after == before
    assert "option" not in after["rows"][0]
    assert after["profile"]["key"] == profile_key(U1, X, [read_row()])
