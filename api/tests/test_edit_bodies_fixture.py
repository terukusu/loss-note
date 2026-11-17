"""直す画面が作る PUT の本文を、本物の API が受ける（Issue #9 AC-4・KEEP-1）。

共有の合成の fixture ``tests/fixtures/records/edit-bodies.json`` は TS のテスト
（``tests/ui/edit-bodies-fixture.test.ts``）が画面の純関数
（``draftFromStored`` → ``readDraft`` → ``mergeEdit``）から作る。
E1 は API で作った取引を、今の設定の資金を変えた後に直す（写した資金は変わらない。C36）。
E2 は #12 より前の形（チャートの無い枠に時間足）なので API の作成を通らない。保存先に直接置いてから直す
（直しの本文には時間足が入らないので 400 にならない）。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空。
"""

import copy

from helpers.records import load_fixture, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def _with_instrument(record: dict, iid: str) -> dict:
    sent = copy.deepcopy(record)
    assert sent["instrumentId"] == PLACEHOLDER
    sent["instrumentId"] = iid
    return sent


def _put_store_trade(api, uid: str, iid: str, original: dict, snapshot: dict) -> str:
    """API の作成の検査を通らない形の取引を、保存先に直接置く（作成と同じ文書の形）"""

    def build(_instrument: dict, _settings: dict | None) -> dict:
        return {
            "schemaVersion": 1,
            "createdAt": 1_700_000_000_000,
            "updatedAt": 1_700_000_000_000,
            "snapshot": copy.deepcopy(snapshot),
            "record": copy.deepcopy(original),
        }

    tid, _doc = api.store.create_trade(uid, iid, build)
    return tid


def test_edit_bodies_are_accepted_and_keep_snapshot(api):
    fixture = load_fixture("edit-bodies.json")
    assert [t["name"] for t in fixture["trades"]] == ["E1", "E2"]
    for item in fixture["trades"]:
        res = api.post("/api/instruments", A, item["instrument"])
        assert res.status_code == 201, (item["name"], res.get_json())
        iid = res.get_json()["id"]
        assert api.put("/api/settings", A, item["settings"]).status_code == 200

        original = _with_instrument(item["original"], iid)
        if item["name"] == "E1":
            res = api.post("/api/trades", A, original)
            assert res.status_code == 201, res.get_json()
            tid = res.get_json()["id"]
        else:
            # チャートの無い枠の時間足は API の作成では 400（noChart）になる形
            assert api.post("/api/trades", A, original).status_code == 400
            tid = _put_store_trade(api, A, iid, original, item["snapshot"])
        before = api.get(f"/api/trades/{tid}", A).get_json()
        assert before["snapshot"] == item["snapshot"], item["name"]
        assert before["record"] == original, item["name"]

        # 今の設定の資金を変えてから直す（写した資金は変わらない）
        assert api.put("/api/settings", A, item["settingsNow"]).status_code == 200
        sent = _with_instrument(item["body"], iid)
        res = api.put(f"/api/trades/{tid}", A, sent)
        assert res.status_code == 200, (item["name"], res.get_json())
        got = res.get_json()
        assert got["record"] == sent, item["name"]
        assert same_typed(got["record"], sent), item["name"]
        assert got["snapshot"] == item["snapshot"], item["name"]
        assert got["snapshot"]["capitalYen"] == item["settings"]["capitalYen"], item["name"]
        again = api.get(f"/api/trades/{tid}", A).get_json()
        assert again["record"] == sent, item["name"]
        assert "charts" not in again, item["name"]


def test_e2_body_drops_timeframes_without_charts():
    item = next(t for t in load_fixture("edit-bodies.json")["trades"] if t["name"] == "E2")
    assert item["original"]["entryChartTimeframe"] == "4h"
    assert item["original"]["exitChartTimeframe"] == "1d"
    assert "entryChartTimeframe" not in item["body"]
    assert "exitChartTimeframe" not in item["body"]
    assert item["expect"]["before"] == "B"
    assert item["expect"]["grade"] == "A"
