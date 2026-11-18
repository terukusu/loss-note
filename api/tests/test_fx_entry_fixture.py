"""通貨と為替（#47 PR-2）の記録する画面が作る本文を、本物の API が受ける（F1・F3・F9・F10。AC-13・AC-14）。

共有の合成の fixture ``tests/fixtures/records/fx-entry.json`` は TS のテスト（``tests/ui/fx-entry-fixture.test.ts``）が
画面の純関数 ``readDraft`` から作る。口座（通貨つき）と銘柄（価格の通貨つき）を先に足し、取引の本文を送って、
送った本文のまま保存すること・snapshot に口座の通貨と資金が写ることを確かめる。逆算の為替は本文に入らない（F3）。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値・名前はすべて架空。
"""

import copy

from helpers.records import load_fixture, same_typed

A = "userA"
INSTRUMENT = "INSTRUMENT"
ACCOUNT = "ACCOUNT"


def test_fx_entry_bodies_are_accepted_as_sent(api):
    fixture = load_fixture("fx-entry.json")
    assert [t["name"] for t in fixture["trades"]] == ["F1", "F3", "F9", "F10"]
    for item in fixture["trades"]:
        res = api.post("/api/instruments", A, item["instrument"])
        assert res.status_code == 201, (item["name"], res.get_json())
        inst = res.get_json()
        res = api.post("/api/accounts", A, item["account"])
        assert res.status_code == 201, (item["name"], res.get_json())
        acc = res.get_json()
        assert acc["currency"] == item["snapshot"]["accountCurrency"], item["name"]

        sent = copy.deepcopy(item["record"])
        assert sent["instrumentId"] == INSTRUMENT and sent["accountId"] == ACCOUNT
        sent["instrumentId"] = inst["id"]
        sent["accountId"] = acc["id"]
        res = api.post("/api/trades", A, sent)
        assert res.status_code == 201, (item["name"], res.get_json())
        got = res.get_json()
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
        assert got["snapshot"] == item["snapshot"], item["name"]
        # 取引が付いた口座の通貨はもう変えられない（F14）
        other = "JPY" if acc["currency"] != "JPY" else "USD"
        body = {"name": acc["name"], "currency": other, "capitalYen": acc["capitalYen"], "riskTolerancePct": 1}
        assert api.put(f"/api/accounts/{acc['id']}", A, body).status_code == 409, item["name"]


def test_fx_entry_derived_rate_is_not_saved():
    """F3: 明細から逆算した為替は本文に入らない（見せるだけ。R6）。F9: 同じ通貨は為替を送らない"""
    t = {x["name"]: x for x in load_fixture("fx-entry.json")["trades"]}
    assert "fxRate" not in t["F3"]["record"]["exit"]
    assert t["F3"]["expect"]["derivedFx"] is not None
    assert "fxRate" not in t["F9"]["record"]["exit"]
    assert t["F1"]["record"]["exit"]["fxRate"] == 150
    assert t["F10"]["record"]["exit"]["fxRate"] == 1.1
