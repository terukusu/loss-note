"""口座の API（Issue #47 PR-1。AC-1〜AC-4・AC-8・例 A1〜A4・A6〜A8・B7）。
保存先 2 つ（記憶・エミュレーターの Firestore）で
同じテストを回す。値・名前はすべて架空（「口座 A」など）。

共通の場面 P: L、イン 100.00、LC 99.50、乗数 1、3 つのタップはすべて計画どおり、LC の根拠はチャート、決済 99.50。
円建ての銘柄なので 1R = 丨100.00 − 99.50丨 × 数量 × 1、リスク（%）= 1R ÷ 記録したときの口座の資金 × 100。
判定（A / B）は画面の core が snapshot から出す（API は保存しない）ので、ここでは snapshot の資金・許容リスクと、
そこから手で出したリスク（%）が 2% を超えるか（過剰リスクの B）を確かめる
"""

import pytest
from helpers.records import t1

A = "userA"


def p_trade(iid: str, account_id: str | None = None, quantity: int = 10_000, **over) -> dict:
    """場面 P の取引（明細の損益・手数料なし。1R は価格から）"""
    body = t1(iid, entries=[{"price": 100, "quantity": quantity}], exit={"time": 1_700_000_000_000, "price": 99.5,
                                                                          "reason": "lc"}, **over)  # fmt: skip
    body.pop("statementPnlYen")
    body["fees"] = []
    if account_id is not None:
        body["accountId"] = account_id
    return body


def risk_pct(trade: dict) -> float:
    """1R ÷ 資金 × 100（手計算の式と同じ。円建て・乗数 1）"""
    e = trade["record"]["entries"][0]
    one_r = abs(e["price"] - trade["record"]["lc"]) * e["quantity"] * trade["snapshot"]["instrument"]["multiplier"]
    return one_r / trade["snapshot"]["capitalYen"] * 100


def add_account(api, name: str, capital=None, risk=None, uid: str = A) -> dict:
    body = {"name": name}
    if capital is not None:
        body["capitalYen"] = capital
    if risk is not None:
        body["riskTolerancePct"] = risk
    res = api.post("/api/accounts", uid, body)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def put_account(api, aid: str, name: str, capital, risk=1, uid: str = A):
    return api.put(f"/api/accounts/{aid}", uid, {"name": name, "capitalYen": capital, "riskTolerancePct": risk})


def jpy(api) -> dict:
    return api.instrument(A, "架空指数A", priceCurrency="JPY", underlyingKind="index")


# ── AC-1 ─────────────────────────────────────


def test_add_list_edit_in_name_order(api):
    """AC-1: 「口座 B」「口座 A」を足す → 一覧は「口座 1, 口座 A, 口座 B」。口座 A の資金を直すと値が変わる"""
    b = add_account(api, "口座 B", 200_000)
    a = add_account(api, "口座 A")
    assert a["capitalYen"] is None and a["riskTolerancePct"] == 1 and a["capitalHistory"] == []
    assert "nameKey" not in a
    items = api.get("/api/accounts", A).get_json()["items"]
    assert [x["name"] for x in items] == ["口座 1", "口座 A", "口座 B"]
    assert items[0]["id"] == "default"
    res = put_account(api, a["id"], "口座 A", 1_000_000, 1.5)
    assert res.status_code == 200
    items = {x["id"]: x for x in api.get("/api/accounts", A).get_json()["items"]}
    assert items[a["id"]]["capitalYen"] == 1_000_000
    assert items[a["id"]]["riskTolerancePct"] == 1.5
    assert len(items[a["id"]]["capitalHistory"]) == 1
    assert items[b["id"]]["capitalHistory"] == [{"valueYen": 200_000, "at": b["createdAt"]}]
    assert api.get(f"/api/accounts/{a['id']}", A).get_json() == items[a["id"]]


def test_capital_history_per_account(api, clock):
    """AC-1: 資金を直すとその口座の履歴に 1 件足す。資金が同じ直し（名前・許容リスクだけ）では増えない。
    ほかの口座は変わらない"""
    a = add_account(api, "口座 A", 1_000_000)
    b = add_account(api, "口座 B", 200_000)
    clock.advance(1000)
    put_account(api, a["id"], "口座 A", 800_000)
    clock.advance(1000)
    put_account(api, a["id"], "口座 A 改", 800_000, 2)
    clock.advance(1000)
    got = put_account(api, a["id"], "口座 A 改", 900_000, 2).get_json()
    assert [h["valueYen"] for h in got["capitalHistory"]] == [1_000_000, 800_000, 900_000]
    ats = [h["at"] for h in got["capitalHistory"]]
    assert ats == sorted(ats)
    assert got["createdAt"] == a["createdAt"] and got["updatedAt"] > a["updatedAt"]
    assert api.get(f"/api/accounts/{b['id']}", A).get_json()["capitalHistory"] == b["capitalHistory"]
    # 設定の資金・履歴は口座の直しで変わらない（設定は移し替えの元のまま）
    assert api.get("/api/settings", A).get_json()["capitalHistory"] == []


def test_capital_history_keeps_latest_1000(memory_api):
    api = memory_api
    for i in range(1003):
        assert put_account(api, "default", "口座 1", 1000 + i).status_code == 200
    history = api.get("/api/accounts/default", A).get_json()["capitalHistory"]
    assert len(history) == 1000
    assert history[0]["valueYen"] == 1003 and history[-1]["valueYen"] == 2002


# ── AC-2 ─────────────────────────────────────


def test_duplicate_name_409(api):
    """A6: 「口座 A」があるときに「口座 Ａ」・「 口座 a 」は 409。既定の口座「口座 1」とも（まだ作られていなくても）
    重なる"""
    a = add_account(api, "口座 A")
    for name in ("口座 Ａ", " 口座 a "):
        res = api.post("/api/accounts", A, {"name": name})
        assert res.status_code == 409, name
        assert res.get_json() == {"error": "conflict", "reason": "duplicateName"}
    # 直しで別の口座の名前にする → 409。自分自身の名前（大文字小文字・空白の違い）は 200
    b = add_account(api, "口座 B")
    assert put_account(api, b["id"], "口座 ａ", None).status_code == 409
    assert put_account(api, a["id"], "口座 a", None).status_code == 200
    assert len(api.get("/api/accounts", A).get_json()["items"]) == 3
    # 新しい利用者が最初に「口座　１」（全角の空白・数字）を足そうとする（既定の口座はこの要求の中で作られる）→ 409
    res = api.post("/api/accounts", "userNew", {"name": "口座　１"})
    assert res.status_code == 409
    assert [x["name"] for x in api.get("/api/accounts", "userNew").get_json()["items"]] == ["口座 1"]


def test_risk_range(api):
    """A7: 許容リスク 3.5 / 0.4 は 400（range）、2.5 は 201"""
    for risk in (3.5, 0.4):
        res = api.post("/api/accounts", A, {"name": f"口座 {risk}", "riskTolerancePct": risk})
        assert res.status_code == 400, risk
        assert res.get_json()["issues"] == [{"field": "riskTolerancePct", "kind": "range"}]
    res = api.post("/api/accounts", A, {"name": "口座 E", "riskTolerancePct": 2.5})
    assert res.status_code == 201
    assert res.get_json()["riskTolerancePct"] == 2.5
    assert [x["name"] for x in api.get("/api/accounts", A).get_json()["items"]] == ["口座 1", "口座 E"]


@pytest.mark.parametrize(
    ("body", "issue"),
    [
        ({"name": "口座 F", "currency": "USD"}, {"field": "", "kind": "unknownField"}),
        ({"name": ""}, {"field": "name", "kind": "length"}),
        ({"name": "   "}, {"field": "name", "kind": "length"}),
        ({"name": "x" * 41}, {"field": "name", "kind": "length"}),
        ({"name": "口座‮F"}, {"field": "name", "kind": "control"}),
        ({"capitalYen": 1}, {"field": "name", "kind": "required"}),
        ({"name": "口座 F", "capitalYen": 0}, {"field": "capitalYen", "kind": "range"}),
        ({"name": "口座 F", "capitalYen": "100"}, {"field": "capitalYen", "kind": "type"}),
    ],
)
def test_invalid_account_bodies(api, body, issue):
    res = api.post("/api/accounts", A, body)
    assert res.status_code == 400
    assert res.get_json() == {"error": "invalid", "issues": [issue]}


def test_put_requires_all_three(api):
    res = api.put("/api/accounts/default", A, {"name": "口座 1"})
    assert res.status_code == 400
    assert {"field": "capitalYen", "kind": "required"} in res.get_json()["issues"]


@pytest.mark.parametrize("path", ["/api/accounts/nonexistent", "/api/accounts/a%2Fb", "/api/accounts/" + "x" * 41])
def test_unknown_or_bad_ids_are_404(api, path):
    assert api.get(path, A).status_code == 404
    assert api.put(path, A, {"name": "x", "capitalYen": None, "riskTolerancePct": 1}).status_code == 404


def test_delete_is_not_allowed(api):
    assert api.call("DELETE", "/api/accounts/default", A).status_code == 405


# ── AC-3: A1〜A3・A8 ─────────────────────────


def test_trade_snapshot_from_account(api):
    """A1・A2・A3・A8: snapshot に取引の口座の資金・許容リスクを写す。過剰リスクの境目は 2% 固定（画面の core）"""
    inst = jpy(api)
    a = add_account(api, "口座 A", 1_000_000)
    b = add_account(api, "口座 B", 200_000)
    e = add_account(api, "口座 E", 1_000_000, 0.5)
    # A1: 1R = 0.5 × 10,000 = 5,000、5,000 ÷ 1,000,000 × 100 = 0.5%
    a1 = api.post("/api/trades", A, p_trade(inst["id"], a["id"])).get_json()
    assert a1["record"]["accountId"] == a["id"]
    assert a1["snapshot"]["capitalYen"] == 1_000_000 and a1["snapshot"]["riskTolerancePct"] == 1
    assert risk_pct(a1) == pytest.approx(0.5)
    # A2: 5,000 ÷ 200,000 × 100 = 2.5% > 2%（過剰リスクの B）
    a2 = api.post("/api/trades", A, p_trade(inst["id"], b["id"])).get_json()
    assert a2["snapshot"]["capitalYen"] == 200_000
    assert risk_pct(a2) == pytest.approx(2.5) and risk_pct(a2) > 2
    # A3: 口座 A の資金を 500,000 に直してからもう 1 件 → 1 件目 0.5% のまま、2 件目 5,000 ÷ 500,000 = 1.0%
    assert put_account(api, a["id"], "口座 A", 500_000).status_code == 200
    a3 = api.post("/api/trades", A, p_trade(inst["id"], a["id"])).get_json()
    assert risk_pct(api.get(f"/api/trades/{a1['id']}", A).get_json()) == pytest.approx(0.5)
    assert risk_pct(a3) == pytest.approx(1.0)
    # A8: 口座 E（許容 0.5%）・数量 30,000 → 1R 15,000、1.5%（許容を超えても 2% 以下 = A）
    a8 = api.post("/api/trades", A, p_trade(inst["id"], e["id"], 30_000)).get_json()
    assert a8["snapshot"]["riskTolerancePct"] == 0.5
    assert risk_pct(a8) == pytest.approx(1.5) and risk_pct(a8) <= 2


def test_trade_without_account_uses_default(api):
    """口座 1 つの利用者の本文（accountId 無し）は既定の口座の値を写し、record に accountId を足さない"""
    inst = jpy(api)
    put_account(api, "default", "口座 1", 300_000, 2)
    got = api.post("/api/trades", A, p_trade(inst["id"])).get_json()
    assert "accountId" not in got["record"]
    assert got["snapshot"]["capitalYen"] == 300_000 and got["snapshot"]["riskTolerancePct"] == 2


def test_trade_with_unknown_account_is_400(api):
    inst = jpy(api)
    for aid in ("nonexistent", "default2"):
        res = api.post("/api/trades", A, p_trade(inst["id"], aid))
        assert res.status_code == 400
        assert res.get_json()["issues"] == [{"field": "accountId", "kind": "notFound"}]
    res = api.post("/api/trades", A, p_trade(inst["id"], "a/b"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "accountId", "kind": "format"}]
    assert api.trades(A) == []


# ── AC-4: A4 ─────────────────────────────────


def test_reassign_account_resnapshots(api):
    """A4 付け替え: 口座 A の資金を 500,000 に直した後、A1 を口座 B へ → 口座 B の今の値（200,000）で 2.5%"""
    inst = jpy(api)
    a = add_account(api, "口座 A", 1_000_000)
    b = add_account(api, "口座 B", 200_000)
    tid = api.post("/api/trades", A, p_trade(inst["id"], a["id"])).get_json()["id"]
    put_account(api, a["id"], "口座 A", 500_000)
    res = api.put(f"/api/trades/{tid}", A, p_trade(inst["id"], b["id"]))
    assert res.status_code == 200
    got = res.get_json()
    assert got["record"]["accountId"] == b["id"]
    assert got["snapshot"]["capitalYen"] == 200_000
    assert risk_pct(got) == pytest.approx(2.5)
    # 銘柄の写しは変わらない（口座の付け替えは銘柄と独立）
    assert got["snapshot"]["instrument"]["priceCurrency"] == "JPY"


def test_edit_keeps_snapshot(api):
    """A4 そのまま: 口座を変えずに数量以外を直す → 写した値（1,000,000）のまま 0.5%。
    本文に口座が無くても保存済みの口座を保つ"""
    inst = jpy(api)
    a = add_account(api, "口座 A", 1_000_000)
    tid = api.post("/api/trades", A, p_trade(inst["id"], a["id"])).get_json()["id"]
    put_account(api, a["id"], "口座 A", 500_000)
    got = api.put(f"/api/trades/{tid}", A, p_trade(inst["id"], a["id"], brokenCondition="書き換えた")).get_json()
    assert got["snapshot"]["capitalYen"] == 1_000_000
    assert risk_pct(got) == pytest.approx(0.5)
    # 古い画面の本文（accountId 無し）でも口座 A のまま（既定の口座へ黙って付け替えない）
    got = api.put(f"/api/trades/{tid}", A, p_trade(inst["id"])).get_json()
    assert got["record"]["accountId"] == a["id"]
    assert got["snapshot"]["capitalYen"] == 1_000_000


def test_reassign_to_unknown_account_is_400_and_keeps_trade(api):
    inst = jpy(api)
    a = add_account(api, "口座 A", 1_000_000)
    created = api.post("/api/trades", A, p_trade(inst["id"], a["id"])).get_json()
    res = api.put(f"/api/trades/{created['id']}", A, p_trade(inst["id"], "nonexistent"))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "accountId", "kind": "notFound"}]
    assert api.get(f"/api/trades/{created['id']}", A).get_json() == created


# ── AC-8: B7 ─────────────────────────────────


def test_edit_unassigned_trade_keeps_snapshot(api):
    """B7: 口座の付いていない取引（移す前）を、口座 2 個のときに口座 1（default）を付けて保存 → snapshot は変わらない"""
    inst = jpy(api)
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    legacy = api.post("/api/trades", A, p_trade(inst["id"])).get_json()
    assert "accountId" not in legacy["record"]
    add_account(api, "口座 B", 200_000)
    put_account(api, "default", "口座 1", 2_000_000)
    got = api.put(f"/api/trades/{legacy['id']}", A, p_trade(inst["id"], "default")).get_json()
    assert got["snapshot"] == legacy["snapshot"]
    assert got["record"]["accountId"] == "default"
    assert risk_pct(got) == pytest.approx(risk_pct(legacy))


def test_unconfigured_returns_503_for_accounts(monkeypatch):
    from loss_note_api.app import create_app

    app = create_app({})
    client = app.test_client()
    for method, path in (("GET", "/api/accounts"), ("POST", "/api/accounts"), ("GET", "/api/accounts/default"),
                         ("PUT", "/api/accounts/default")):  # fmt: skip
        assert client.open(path, method=method).status_code == 503, (method, path)
