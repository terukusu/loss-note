"""画面が作る両建てのまとまりの本文を、本物の API が受ける（Issue #267 の AC-11・設計書 4.8・7.7）。

共有の合成の fixture ``tests/fixtures/records/position-groups.json`` は TS のテスト
（``tests/ui/position-groups-fixture.test.ts``）が画面の純関数（相手を選ぶシートの役割 ``rolesOf`` → ``groupBody``、
直すシートの ``readExitDraft``）から作る。取引の ID は API が決めるので、本文の tradeId は取引の名前の印、取引の本文の
instrumentId は銘柄の名前の印。結ぶ（POST 201）→ 直す（PUT 200）→ 解く（DELETE 204）を通し、メンバーの逆参照と
上書きを確かめる。保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値・名前はすべて架空。
"""

import copy

from helpers.records import load_fixture

A = "userA"


def _members(body: dict, ids: dict[str, str]) -> dict:
    sent = copy.deepcopy(body)
    for m in sent["members"]:
        m["tradeId"] = ids[m["tradeId"]]
    return sent


def test_screen_group_bodies_round_trip(api):
    fixture = load_fixture("position-groups.json")
    inst_ids: dict[str, str] = {}
    for inst in fixture["instruments"]:
        res = api.post("/api/instruments", A, inst)
        assert res.status_code == 201, (inst["name"], res.get_json())
        inst_ids[inst["name"]] = res.get_json()["id"]
    ids: dict[str, str] = {}
    for t in fixture["trades"]:
        record = copy.deepcopy(t["record"])
        record["instrumentId"] = inst_ids[t["instrument"]]
        res = api.post("/api/trades", A, record)
        assert res.status_code == 201, (t["name"], res.get_json())
        ids[t["name"]] = res.get_json()["id"]

    assert [s["name"] for s in fixture["scenes"]] == ["F", "F5"]
    for scene in fixture["scenes"]:
        created = _members(scene["create"], ids)
        res = api.post("/api/position-groups", A, created)
        assert res.status_code == 201, (scene["name"], res.get_json())
        group = res.get_json()
        gid = group["id"]
        assert [(m["tradeId"], m["role"]) for m in group["members"]] == [
            (m["tradeId"], m["role"]) for m in created["members"]
        ]
        assert "exit" not in group
        for m in created["members"]:
            assert api.get(f"/api/trades/{m['tradeId']}", A).get_json()["positionGroupId"] == gid

        updated = _members(scene["update"], ids)
        res = api.put(f"/api/position-groups/{gid}", A, updated)
        assert res.status_code == 200, (scene["name"], res.get_json())
        assert res.get_json().get("exit") == updated.get("exit")
        listed = api.get("/api/position-groups", A).get_json()["items"]
        assert [g["exit"] for g in listed if g["id"] == gid] == [updated["exit"]]

        assert api.delete(f"/api/position-groups/{gid}", A).status_code == 204
        for m in created["members"]:
            assert "positionGroupId" not in api.get(f"/api/trades/{m['tradeId']}", A).get_json()
