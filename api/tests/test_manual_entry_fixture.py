"""記録する画面が手で入れた下書きから作る本文を、本物の API が受ける（Issue #13 AC-1・KEEP-2）。

共有の合成の fixture ``tests/fixtures/records/manual-entry.json`` は TS のテスト
（``tests/ui/manual-entry-fixture.test.ts``）が画面の純関数 ``readDraft`` から作る。
画面の偽の API（``tests/ui/helpers/fake-api.ts``）と本物の形がずれたら、ここで 400 か不一致になる。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空。
"""

import copy

from helpers.records import load_fixture, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def test_manual_entry_bodies_are_accepted_as_sent(api):
    fixture = load_fixture("manual-entry.json")
    names = [t["name"] for t in fixture["trades"]]
    assert names == ["E1", "E2", "E5", "E16", "full", "tightened", "widenedNoAfter"]
    for item in fixture["trades"]:
        # 画面は一覧に無い銘柄を名前だけで足す（既定は API が埋める。C21）
        res = api.post("/api/instruments", A, item["instrument"])
        assert res.status_code == 201, (item["name"], res.get_json())
        inst = res.get_json()
        assert {k: inst[k] for k in item["snapshot"]["instrument"]} == item["snapshot"]["instrument"], item["name"]
        res = api.put("/api/settings", A, item["settings"])
        assert res.status_code == 200, res.get_json()

        sent = copy.deepcopy(item["record"])
        assert sent["instrumentId"] == PLACEHOLDER
        sent["instrumentId"] = inst["id"]
        res = api.post("/api/trades", A, sent)
        assert res.status_code == 201, (item["name"], res.get_json())
        got = res.get_json()
        # 画面が送った本文がそのまま保存され（既定で埋まる欄は無い）、snapshot は画面の予想どおり
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
        assert got["snapshot"] == item["snapshot"], item["name"]
        again = api.get(f"/api/trades/{got['id']}", A).get_json()
        assert again["record"] == sent, item["name"]


def test_manual_entry_optional_fields_are_in_fixture():
    """任意の欄（建てた時刻・手数料・一言・損益・金額ありき・決済の理由・窓・滑り = はい・詰めた・長い足へ・
    後の値の無い下げた）が本文に入っている（偽の API ではなく本物の検査を通す。レビュー指摘 3）"""
    t = {x["name"]: x["record"] for x in load_fixture("manual-entry.json")["trades"]}
    assert "time" in t["full"]["entries"][0]
    assert t["full"]["fees"] == [{"amountYen": 200}]
    assert t["full"]["brokenCondition"]
    assert t["full"]["statementPnlYen"] == -12200
    assert t["full"]["lcBasis"] == "amount"
    assert t["full"]["exit"]["reason"] == "brokeManual"
    assert t["full"]["exit"]["gapSlip"] == "yes"
    assert t["tightened"]["lcMove"] == {"kind": "tightened"}
    assert t["tightened"]["timeframeChange"] == "longer"
    assert t["widenedNoAfter"]["lcMove"] == {"kind": "widened"}


def test_manual_entry_without_lc_keeps_no_lc(api):
    """E16（LC なし）: lc を持たず、決めていなかった・動かしていないのまま保存される"""
    item = next(t for t in load_fixture("manual-entry.json")["trades"] if t["name"] == "E16")
    assert "lc" not in item["record"]
    assert item["record"]["lcDecidedBeforeEntry"] is False
    assert item["record"]["lcMove"] == {"kind": "none"}
    iid = api.post("/api/instruments", A, item["instrument"]).get_json()["id"]
    sent = {**copy.deepcopy(item["record"]), "instrumentId": iid}
    got = api.post("/api/trades", A, sent).get_json()
    assert "lc" not in got["record"]
