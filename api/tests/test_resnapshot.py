"""今の値で写し直す（Issue #31。AC-4・AC-5・KEEP-1・KEEP-2・例 E2・E4・E7・E10）。
保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。値・名前はすべて架空。

取引の PUT に ``?snapshot=current`` を付けたときだけ、取引の銘柄と口座の今の値で snapshot を写し直す。
付けなければ今と同じ（口座・銘柄を付け替えたときだけ写し直す。C36・C41）。

場面: L、イン 38,000、LC 37,800、決済 37,800、数量 1、乗数 100、円建て。1R = |38,000 − 37,800| × 1 × 100 = 20,000 円。
リスク（%）= 1R ÷ 写した資金 × 100（資金 1,000,000 円なら 2.0%、乗数 10 なら 1R 2,000 円で 0.2%）
"""

import pytest
from helpers.records import t1

A = "userA"
B = "userB"


def trade_body(iid: str, account_id: str | None = None, **over) -> dict:
    body = t1(iid, lc=37_800, entries=[{"price": 38_000, "quantity": 1}],
              exit={"time": 1_700_000_000_000, "price": 37_800, "reason": "lc"}, **over)  # fmt: skip
    body.pop("statementPnlYen")
    body["fees"] = []
    if account_id is not None:
        body["accountId"] = account_id
    return body


def one_r(trade: dict) -> float:
    e = trade["record"]["entries"][0]
    return abs(e["price"] - trade["record"]["lc"]) * e["quantity"] * trade["snapshot"]["instrument"]["multiplier"]


def index_instrument(api, uid: str = A, multiplier: float = 100) -> dict:
    return api.instrument(uid, "架空指数A", underlyingKind="index", multiplier=multiplier)


def put_account(api, aid: str, name: str, capital, risk=1, uid: str = A):
    res = api.put(f"/api/accounts/{aid}", uid, {"name": name, "capitalYen": capital, "riskTolerancePct": risk})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def add_account(api, name: str, capital=None, uid: str = A) -> dict:
    body = {"name": name} if capital is None else {"name": name, "capitalYen": capital}
    res = api.post("/api/accounts", uid, body)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def no_capital_trade(api) -> tuple[dict, dict]:
    """資金が未設定のときに記録した取引（E1 の形）。その後に口座 1 の資金を 1,000,000 円にする"""
    inst = index_instrument(api)
    created = api.post("/api/trades", A, trade_body(inst["id"])).get_json()
    assert created["snapshot"]["capitalYen"] is None
    put_account(api, "default", "口座 1", 1_000_000, 1.5)
    return inst, created


def test_without_query_keeps_snapshot(api):
    """E4・KEEP-1: 指定なしの PUT は写した資金を空のまま（口座 1 を選び直しても = 本文に default を入れても）"""
    inst, created = no_capital_trade(api)
    got = api.put(f"/api/trades/{created['id']}", A, trade_body(inst["id"])).get_json()
    assert got["snapshot"] == created["snapshot"]
    got = api.put(f"/api/trades/{created['id']}", A, trade_body(inst["id"], "default")).get_json()
    assert got["snapshot"] == created["snapshot"]
    assert got["record"]["accountId"] == "default"


def test_current_resnapshots_capital(api):
    """E2: ?snapshot=current で口座 1 の今の資金・許容リスクを写す。1R 20,000 ÷ 1,000,000 = 2.0%"""
    inst, created = no_capital_trade(api)
    res = api.put(f"/api/trades/{created['id']}?snapshot=current", A, trade_body(inst["id"]))
    assert res.status_code == 200
    got = res.get_json()
    assert got["snapshot"]["capitalYen"] == 1_000_000
    assert got["snapshot"]["riskTolerancePct"] == 1.5
    assert got["snapshot"]["instrument"] == created["snapshot"]["instrument"]
    assert one_r(got) / got["snapshot"]["capitalYen"] * 100 == pytest.approx(2.0)
    # 本文に口座が無ければ記録にも足さない（口座 1 つの利用者の形のまま）
    assert "accountId" not in got["record"]
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == got


def test_current_resnapshots_instrument(api):
    """E7: 銘柄の乗数を 100 → 10 に直した後、?snapshot=current で 1R 2,000 円・0.2%"""
    inst = index_instrument(api)
    put_account(api, "default", "口座 1", 1_000_000)
    created = api.post("/api/trades", A, trade_body(inst["id"])).get_json()
    res = api.put(f"/api/instruments/{inst['id']}", A,
                  {"name": "架空指数A", "priceCurrency": "JPY", "underlyingKind": "index", "multiplier": 10,
                   "quantityStep": 0.1})  # fmt: skip
    assert res.status_code == 200, res.get_json()
    # 指定なしは写した乗数のまま（C36）
    kept = api.put(f"/api/trades/{created['id']}", A, trade_body(inst["id"])).get_json()
    assert kept["snapshot"]["instrument"]["multiplier"] == 100
    got = api.put(f"/api/trades/{created['id']}?snapshot=current", A, trade_body(inst["id"])).get_json()
    assert got["snapshot"]["instrument"]["multiplier"] == 10
    assert got["snapshot"]["instrument"]["quantityStep"] == 0.1
    assert one_r(got) == pytest.approx(2_000)
    assert one_r(got) / got["snapshot"]["capitalYen"] * 100 == pytest.approx(0.2)


def test_current_uses_stored_account_when_body_has_none(api):
    """口座 A の取引を、本文に口座を入れずに ?snapshot=current → 口座 A の今の値（既定の口座ではない）"""
    inst = index_instrument(api)
    a = add_account(api, "口座 A", 1_000_000)
    put_account(api, "default", "口座 1", 3_000_000)
    created = api.post("/api/trades", A, trade_body(inst["id"], a["id"])).get_json()
    put_account(api, a["id"], "口座 A", 500_000)
    got = api.put(f"/api/trades/{created['id']}?snapshot=current", A, trade_body(inst["id"])).get_json()
    assert got["record"]["accountId"] == a["id"]
    assert got["snapshot"]["capitalYen"] == 500_000


def test_current_with_reassign_uses_new_account(api):
    """KEEP-2: 付け替えと一緒に指定しても、付け替え先の今の値（付け替えだけのときと同じ）"""
    inst = index_instrument(api)
    a = add_account(api, "口座 A", 1_000_000)
    b = add_account(api, "口座 B", 200_000)
    created = api.post("/api/trades", A, trade_body(inst["id"], a["id"])).get_json()
    got = api.put(f"/api/trades/{created['id']}?snapshot=current", A, trade_body(inst["id"], b["id"])).get_json()
    assert got["record"]["accountId"] == b["id"]
    assert got["snapshot"]["capitalYen"] == 200_000


@pytest.mark.parametrize(
    "query", ["?snapshot=stored", "?snapshot=", "?snapshot=CURRENT", "?snapshot=current&snapshot=x",
              "?snapshot=current&snapshot=current"]
)  # fmt: skip
def test_unknown_value_is_400_and_keeps_trade(api, query):
    """AC-5: 決まった値（current）でなければ 400。保存しない"""
    inst, created = no_capital_trade(api)
    res = api.put(f"/api/trades/{created['id']}{query}", A, trade_body(inst["id"], brokenCondition="書き換えた"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "snapshot", "kind": "invalid"}]
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created


def test_other_users_trade_is_404(api):
    """E10: ほかの利用者の取引への指定つきの PUT は 404。その取引は変わらない"""
    inst, created = no_capital_trade(api)
    mine = index_instrument(api, B)
    res = api.put(f"/api/trades/{created['id']}?snapshot=current", B, trade_body(mine["id"]))
    assert res.status_code == 404
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created
    assert api.put("/api/trades/nonexistent?snapshot=current", A, trade_body(inst["id"])).status_code == 404


def test_current_writes_account_currency(api):
    """#47 PR-2 との合わせ直し: ?snapshot=current は口座の今の通貨も写す（USD の口座の取引は USD・今の資金）。
    口座の通貨を写していない移す前の形でも、写し直した後は accountCurrency を持つ"""
    inst = index_instrument(api)
    d = api.post("/api/accounts", A, {"name": "口座 D", "currency": "USD", "capitalYen": 10_000}).get_json()
    created = api.post("/api/trades", A, trade_body(inst["id"], d["id"])).get_json()
    assert created["snapshot"]["accountCurrency"] == "USD"
    put = api.put(f"/api/accounts/{d['id']}", A, {"name": "口座 D", "capitalYen": 20_000, "riskTolerancePct": 1})
    assert put.status_code == 200
    got = api.put(f"/api/trades/{created['id']}?snapshot=current", A, trade_body(inst["id"], d["id"])).get_json()
    assert got["snapshot"]["accountCurrency"] == "USD"
    assert got["snapshot"]["capitalYen"] == 20_000
    # 既定の口座（JPY）の取引も写し直すと JPY を持つ
    jp = api.post("/api/trades", A, trade_body(inst["id"])).get_json()
    got = api.put(f"/api/trades/{jp['id']}?snapshot=current", A, trade_body(inst["id"])).get_json()
    assert got["snapshot"]["accountCurrency"] == "JPY"
