"""記録する画面がチャートつきで作る本文を、本物の API が受けて読み戻せる（Issue #12 AC-4・E1〜E6・E11）。

共有の合成の fixture ``tests/fixtures/records/chart-entry.json`` は TS のテスト
（``tests/ui/chart-entry-fixture.test.ts``）が画面の純関数 ``readDraft`` から作り、判定・理由（括弧の中の
「チャートから」まで）を確かめる。ここでは同じ本文を fixture の ``charts`` の枠に合成のチャートを付けて multipart で
送り、読み戻した ``record`` が送ったものと一致する（= 読み戻した取引でも TS の判定が同じ）ことを確かめる。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空。
"""

import copy

from helpers.charts import chart_count, chart_png, post_with_charts
from helpers.records import load_fixture, put_default_account, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def test_chart_entry_bodies_round_trip(api):
    fixture = load_fixture("chart-entry.json")
    assert [t["name"] for t in fixture["trades"]] == ["E1", "E2", "E3", "E4", "E5", "E6"]
    inst = api.post("/api/instruments", A, fixture["trades"][0]["instrument"]).get_json()
    total = 0
    for item in fixture["trades"]:
        put_default_account(api, A, item["settings"])
        sent = copy.deepcopy(item["record"])
        assert sent["instrumentId"] == PLACEHOLDER
        sent["instrumentId"] = inst["id"]
        res = post_with_charts(api, A, sent, {s: (chart_png(), "image/png") for s in item["charts"]})
        assert res.status_code == 201, (item["name"], res.get_json())
        tid = res.get_json()["id"]
        got = api.get(f"/api/trades/{tid}", A).get_json()
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
        assert got["snapshot"] == item["snapshot"], item["name"]
        assert sorted(got["charts"]) == sorted(item["charts"]), item["name"]
        total += len(item["charts"])
    assert chart_count(api, A) == total


def test_e11_remove_exit_chart_drops_its_timeframe(api):
    """E11: E1 の決済時のチャートを外すと、読み戻した record から決済時の時間足だけが消える（TS の側で理由が消える）"""
    item = next(t for t in load_fixture("chart-entry.json")["trades"] if t["name"] == "E1")
    inst = api.post("/api/instruments", A, item["instrument"]).get_json()
    sent = {**copy.deepcopy(item["record"]), "instrumentId": inst["id"]}
    tid = post_with_charts(api, A, sent, {s: (chart_png(), "image/png") for s in item["charts"]}).get_json()["id"]
    res = api.delete(f"/api/trades/{tid}/charts/exit", A)
    assert res.status_code == 200
    want = {k: v for k, v in sent.items() if k != "exitChartTimeframe"}
    assert api.get(f"/api/trades/{tid}", A).get_json()["record"] == want
    assert chart_count(api, A) == 1
