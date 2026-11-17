"""利用者の分離（AC-5〜8・R1・設計書 2.2 AC5）。A で 3 種類を作り、B で全操作 × 全資源を試す。

保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。値はすべて架空。
"""

import pytest
from helpers.records import BROKEN_CONDITION, t1

A = "userA"
B = "userB"

# 細工した ID（A の場所を指そうとする）。どれも 404 で、保存先に触れない
CRAFTED_IDS = ["..%2FuserA%2Ftrades%2F{id}", "%2E%2E%2F{id}", "a/b", "x" * 41, "a b", "..", "{id}%00", "{id}/"]


@pytest.fixture
def world(api):
    """A の銘柄・設定・取引を作る"""
    inst = api.instrument(A, "US30")
    api.put("/api/settings", A, {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"})
    trade = api.post("/api/trades", A, t1(inst["id"])).get_json()
    return {"api": api, "inst": inst, "trade": trade}


def assert_no_a_values(res):
    text = res.get_data(as_text=True)
    assert "99.5" not in text and BROKEN_CONDITION not in text and "1000000" not in text


def test_b_cannot_read_update_delete_a_trade(world):
    """AC-5（E2・E3）"""
    api, trade, inst = world["api"], world["trade"], world["inst"]
    tid = trade["id"]
    paths = [f"/api/trades/{tid}"] + [f"/api/trades/{c.format(id=tid)}" for c in CRAFTED_IDS]
    for path in paths:
        for res in (
            api.get(path, B),
            api.put(path, B, t1(inst["id"], brokenCondition="B が書いた")),
            api.delete(path, B),
        ):
            assert res.status_code == 404, (path, res.status_code)
            assert res.get_json() == {"error": "not_found"}
            assert_no_a_values(res)
    # A が読む T1 は前と同じ
    assert api.get(f"/api/trades/{tid}", A).get_json() == trade


def test_b_list_is_empty(world):
    """AC-6（E4）"""
    api = world["api"]
    res = api.get("/api/trades", B)
    assert res.get_json() == {"items": []}
    assert_no_a_values(res)
    assert len(api.trades(A)) == 1


def test_b_cannot_touch_a_instrument(world):
    """AC-7（E5・E6）"""
    api, inst = world["api"], world["inst"]
    iid = inst["id"]
    paths = [f"/api/instruments/{iid}"] + [f"/api/instruments/{c.format(id=iid)}" for c in CRAFTED_IDS]
    for path in paths:
        for res in (api.get(path, B), api.put(path, B, {"name": "B が付けた"}), api.delete(path, B)):
            assert res.status_code == 404, (path, res.status_code)
            assert "US30" not in res.get_data(as_text=True)
    assert api.get("/api/instruments", B).get_json() == {"items": []}
    # B が A の銘柄 ID を指して取引を作る → 400、B の取引は 0 件
    res = api.post("/api/trades", B, t1(iid))
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "instrumentId", "kind": "notFound"}]
    assert api.trades(B) == []
    # B の取引を A の銘柄に付け替えることもできない
    b_inst = api.instrument(B, "US30")
    b_trade = api.post("/api/trades", B, t1(b_inst["id"])).get_json()
    assert api.put(f"/api/trades/{b_trade['id']}", B, t1(iid)).status_code == 400
    # A の銘柄は変わらない
    assert api.get(f"/api/instruments/{iid}", A).get_json() == inst


def test_settings_are_per_user(world):
    """AC-8（E7）"""
    api = world["api"]
    assert api.get("/api/settings", B).get_json() == {
        "capitalYen": None, "riskTolerancePct": 1, "performanceUnit": "R", "capitalHistory": []
    }  # fmt: skip
    res = api.put("/api/settings", B, {"capitalYen": 300_000, "riskTolerancePct": 2, "performanceUnit": "yen"})
    assert res.status_code == 200
    a = api.get("/api/settings", A).get_json()
    assert a["capitalYen"] == 1_000_000 and a["riskTolerancePct"] == 1 and a["performanceUnit"] == "R"
    assert len(a["capitalHistory"]) == 1


def test_uid_with_slash_cannot_reach_other_user(api):
    """エミュレーターでは誰でも sub を作れる。/ や .. を含む uid は 401（他人の場所を指させない）"""
    api.instrument(A)
    for uid in ("userA/trades", "../userA", "userA/../userA"):
        res = api.get("/api/trades", uid)
        assert res.status_code == 401, uid
