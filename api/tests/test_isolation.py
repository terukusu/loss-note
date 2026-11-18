"""利用者の分離（AC-5〜8・R1・設計書 2.2 AC5）。A で 3 種類を作り、B で全操作 × 全資源を試す。

保存先 2 つ（記憶・エミュレーターの Firestore）で同じテストを回す。値はすべて架空。
"""

import json

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


# ---- チャート画像（Issue #12 AC-7・E9・EPIC #10 終了条件 5） ----

CHART_SLOTS_CRAFTED = ["entry", "exit", "Entry", "entry%2F..", "..", "%2E%2E", "exit%00", "x"]


def test_b_cannot_read_replace_delete_a_charts(api):
    """AC-7: B が A のチャートを読む・差し替える・消す（細工した ID・枠を含む）→ すべて 404・本文は not_found だけ。
    トークンなしは 401。最後に A の 2 枚のバイト列は前と同じ"""
    from helpers.charts import CHART_MARKER, chart_count, chart_jpeg, chart_png, post_with_charts

    inst = api.instrument(A, "US30")
    entry, exit_ = chart_png(), chart_jpeg()
    created = post_with_charts(api, A, t1(inst["id"], entryChartTimeframe="4h", exitChartTimeframe="1d"),
                               {"entry": (entry, "image/png"), "exit": (exit_, "image/jpeg")}).get_json()  # fmt: skip
    tid = created["id"]
    ids = [tid] + [c.format(id=tid) for c in CRAFTED_IDS]
    paths = [f"/api/trades/{i}/charts/{s}" for i in ids for s in CHART_SLOTS_CRAFTED]
    for path in paths:
        for res in (
            api.get(path, B),
            api.put(path, B, raw=chart_png(filler=b"B-wrote"), content_type="image/png"),
            api.delete(path, B),
        ):
            assert res.status_code == 404, (path, res.status_code)
            assert res.get_json() == {"error": "not_found"}
            assert CHART_MARKER.decode() not in res.get_data(as_text=True)
            assert_no_a_values(res)
    for res in (
        api.get(f"/api/trades/{tid}/charts/entry"),
        api.put(f"/api/trades/{tid}/charts/entry", raw=chart_png(), content_type="image/png"),
        api.delete(f"/api/trades/{tid}/charts/exit"),
    ):
        assert res.status_code == 401
    # A のチャートは前と同じ
    assert api.get(f"/api/trades/{tid}/charts/entry", A).data == entry
    assert api.get(f"/api/trades/{tid}/charts/exit", A).data == exit_
    assert api.get(f"/api/trades/{tid}", A).get_json() == created
    assert chart_count(api, A) == 2
    assert chart_count(api, B) == 0


def test_b_cannot_attach_a_chart_to_own_trade(api):
    """AC-7「付け替え」: B が自分の取引に A の取引・チャートを指す手段は無い（知らない項目・部分 → 400、パス → 404）"""
    from helpers.charts import chart_count, chart_parts, chart_png, post_multipart, post_with_charts

    a_inst = api.instrument(A, "US30")
    a_trade = post_with_charts(api, A, t1(a_inst["id"]), {"entry": (chart_png(), "image/png")}).get_json()
    a_tid = a_trade["id"]
    b_inst = api.instrument(B, "US30")
    b_trade = api.post("/api/trades", B, t1(b_inst["id"])).get_json()

    # 作成: 記録に A のチャートを指す項目 / A のチャートを指す部分
    pointers = [
        {"charts": {"entry": {"contentType": "image/png", "size": 1}}},
        {"entryChart": f"users/{A}/charts/{a_tid}-entry"},
        {"chartRef": f"{a_tid}-entry"},
    ]
    for extra in pointers:
        res = api.post("/api/trades", B, {**t1(b_inst["id"]), **extra})
        assert res.status_code == 400, extra
        res = post_multipart(api, B, chart_parts({**t1(b_inst["id"]), **extra}))
        assert res.status_code == 400, extra
        res = api.put(f"/api/trades/{b_trade['id']}", B, {**t1(b_inst["id"]), **extra})
        assert res.status_code == 400, extra
    for name in ("entryChartId", "chartPath", "fromTrade"):
        res = post_multipart(api, B, chart_parts(t1(b_inst["id"])) + [(name, f"{a_tid}-entry", None, None)])
        assert res.status_code == 400 and res.get_json()["issues"] == [{"field": "", "kind": "unknownPart"}]
    # B の取引の枠の名前に A の取引を混ぜる
    for slot in (f"..%2F{a_tid}-entry", f"{a_tid}-entry"):
        res = api.put(f"/api/trades/{b_trade['id']}/charts/{slot}", B, raw=chart_png(), content_type="image/png")
        assert res.status_code == 404
    assert api.get(f"/api/trades/{b_trade['id']}", B).get_json() == b_trade
    assert chart_count(api, B) == 0
    assert api.get(f"/api/trades/{a_tid}", A).get_json() == a_trade
    assert chart_count(api, A) == 1


# ---- 口座（Issue #47 PR-1 AC-5・例 A5）----


def test_b_cannot_use_or_read_a_account(api):
    """A5: B が A の口座の ID で記録・付け替え → 400（口座が無い）。
    B の一覧に A の口座は出ない（自分の「口座 1」だけ）。
    読む・直すは 404。A の口座は変わらない"""
    res = api.post("/api/accounts", A, {"name": "口座 A", "capitalYen": 1_000_000})
    assert res.status_code == 201
    a_acc = res.get_json()
    a_default = api.get("/api/accounts/default", A).get_json()
    b_inst = api.instrument(B, "US30")
    res = api.post("/api/trades", B, {**t1(b_inst["id"]), "accountId": a_acc["id"]})
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "accountId", "kind": "notFound"}]
    assert api.trades(B) == []
    b_trade = api.post("/api/trades", B, t1(b_inst["id"])).get_json()
    res = api.put(f"/api/trades/{b_trade['id']}", B, {**t1(b_inst["id"]), "accountId": a_acc["id"]})
    assert res.status_code == 400
    assert api.get(f"/api/trades/{b_trade['id']}", B).get_json() == b_trade
    items = api.get("/api/accounts", B).get_json()["items"]
    assert [x["name"] for x in items] == ["口座 1"]
    assert "1000000" not in json.dumps(items)
    ids = [a_acc["id"]] + [c.format(id=a_acc["id"]) for c in CRAFTED_IDS]
    for aid in ids:
        path = f"/api/accounts/{aid}"
        for res in (api.get(path, B), api.put(path, B, {"name": "B が付けた", "capitalYen": 1, "riskTolerancePct": 1})):
            assert res.status_code == 404, (path, res.status_code)
            assert res.get_json() == {"error": "not_found"}
            assert "口座 A" not in res.get_data(as_text=True)
    assert api.get(f"/api/accounts/{a_acc['id']}", A).get_json() == a_acc
    # 既定の口座の ID は同じ（default）でも、利用者ごとの場所（B の「口座 1」は A の「口座 1」と別の文書）
    put = api.put("/api/accounts/default", B, {"name": "口座 1", "capitalYen": 5, "riskTolerancePct": 1})
    assert put.status_code == 200
    assert api.get("/api/accounts/default", A).get_json() == a_default
