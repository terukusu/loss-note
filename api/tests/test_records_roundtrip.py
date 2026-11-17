"""保存して読み戻すと、送った値がそのまま返る（AC-9・AC-10・R3）。

共有の合成の fixture（``tests/fixtures/records/``。TS のテスト ``tests/core/record.test.ts`` も読む）を API に通す。
TS の型と Python の検査の項目がずれたら、ここで 400 か不一致になる。保存先 2 つで回す。

チャートの時間足（``entryChartTimeframe`` / ``exitChartTimeframe``）は、その枠のチャートがある取引にだけ持てる
（Issue #12 R4）。時間足を持つ項目は、その枠に合成のチャートを付けて multipart で送る（期待値は変えない。送り方だけ）。
"""

import copy

from helpers.charts import chart_png, post_with_charts
from helpers.records import load_fixture, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def roundtrip(api, item: dict) -> tuple[dict, dict]:
    """銘柄と設定を作り、record の銘柄 ID を差し替えて取引を作り、1 件読みで読み戻す"""
    res = api.post("/api/instruments", A, item["instrument"])
    assert res.status_code == 201, (item.get("name") or item.get("scene"), res.get_json())
    iid = res.get_json()["id"]
    res = api.put("/api/settings", A, item["settings"])
    assert res.status_code == 200, res.get_json()
    sent = copy.deepcopy(item["record"])
    assert sent["instrumentId"] == PLACEHOLDER
    sent["instrumentId"] = iid
    slots = {s: (chart_png(), "image/png") for s in ("entry", "exit") if f"{s}ChartTimeframe" in sent}
    res = post_with_charts(api, A, sent, slots) if slots else api.post("/api/trades", A, sent)
    assert res.status_code == 201, (item.get("name") or item.get("scene"), res.get_json())
    got = api.get(f"/api/trades/{res.get_json()['id']}", A).get_json()
    return sent, got


def test_full_record_round_trip(api):
    """AC-9（E1・E11・E12・E18）: すべての欄を埋めた取引ほか。数は丸めず、整数は整数・小数は小数のまま"""
    fixture = load_fixture("full-record.json")
    assert [t["name"] for t in fixture["trades"]] == ["full", "E11", "E12", "E18"]
    for item in fixture["trades"]:
        sent, got = roundtrip(api, item)
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
    # E18: 数量 0.3 のまま（刻み 0.1 の銘柄）
    e18 = [t for t in api.trades(A) if t["record"]["entries"][0]["quantity"] == 0.3]
    assert len(e18) == 1


def test_design_table_fixture_round_trip(api):
    """AC-10: 5.6 の全場面の保存の形を API で作って読む → record・snapshot が fixture と一致"""
    items = load_fixture("design-table.json")
    scenes = {x["scene"] for x in items}
    assert len(scenes) >= 30  # 表の行数は TS のテストが設計書と突き合わせる
    for item in items:
        sent, got = roundtrip(api, item)
        where = f"#{item['scene']} 場面 {item['index'] + 1}"
        assert got["record"] == sent, where
        assert same_typed(got["record"], sent), where
        assert got["snapshot"] == item["snapshot"], where
        assert same_typed(got["snapshot"], item["snapshot"]), where
    assert len(api.trades(A)) == len(items)
