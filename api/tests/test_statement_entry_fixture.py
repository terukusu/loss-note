"""記録する画面が決済明細の読み取りから作る本文を、本物の API が受ける（Issue #15 KEEP-2・AC-4・AC-7）。

共有の合成の fixture ``tests/fixtures/records/statement-entry.json`` は TS のテスト
（``tests/ui/statement-entry-fixture.test.ts``）が画面の純関数 ``fillFromRow`` → ``readDraft`` から作る。
出どころ「明細」・注文の種類「逆指値 / 成行 / 不明」・逆指値を入れた「入れた」・手数料の合計 1 つが、今の保存の形の
まま 201 で受けられ、送った本文のまま保存されることを確かめる。保存先 2 つ（記憶・エミュレーターの Firestore）で回す。
値はすべて架空。
"""

import copy

from helpers.records import load_fixture, put_default_account, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def test_statement_entry_bodies_are_accepted_as_sent(api):
    fixture = load_fixture("statement-entry.json")
    assert [t["name"] for t in fixture["trades"]] == ["E1", "E7", "E8"]
    for item in fixture["trades"]:
        res = api.post("/api/instruments", A, item["instrument"])
        if res.status_code == 409:  # 同じ架空の銘柄を 2 回目からは一覧から引く
            inst = next(i for i in api.get("/api/instruments", A).get_json()["items"]
                        if i["name"] == item["instrument"]["name"])
        else:
            assert res.status_code == 201, (item["name"], res.get_json())
            inst = res.get_json()
        put_default_account(api, A, item["settings"])

        sent = copy.deepcopy(item["record"])
        assert sent["instrumentId"] == PLACEHOLDER
        sent["instrumentId"] = inst["id"]
        res = api.post("/api/trades", A, sent)
        assert res.status_code == 201, (item["name"], res.get_json())
        got = res.get_json()
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
        assert got["snapshot"] == item["snapshot"], item["name"]


def test_statement_entry_fixture_has_statement_fields():
    t = {x["name"]: x["record"] for x in load_fixture("statement-entry.json")["trades"]}
    for r in t.values():
        assert r["source"] == "statement"
        assert r["fees"] == [{"amountYen": 150}]
        assert r["statementPnlYen"] == -2000
        assert "time" in r["entries"][0]
    assert (t["E1"]["exit"]["orderType"], t["E1"]["stopOrderPlaced"]) == ("unknown", "unanswered")
    assert (t["E7"]["exit"]["orderType"], t["E7"]["stopOrderPlaced"], t["E7"]["exit"]["reason"]) == (
        "stop", "placed", "lc")
    assert (t["E8"]["exit"]["orderType"], t["E8"]["stopOrderPlaced"]) == ("market", "unanswered")
