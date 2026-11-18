"""直す画面が作る PUT の本文を、本物の API が受ける（Issue #9 AC-4・KEEP-1）。

共有の合成の fixture ``tests/fixtures/records/edit-bodies.json`` は TS のテスト
（``tests/ui/edit-bodies-fixture.test.ts``）が画面の純関数
（``draftFromStored`` → ``readDraft`` → ``mergeEdit``）から作る。
E1 は API で作った取引を、今の口座の資金を変えた後に直す（写した資金は変わらない。C36）。
E2 は #12 より前の形（チャートの無い枠に時間足）なので API の作成を通らない。保存先に直接置いてから直す
（直しの本文には時間足が入らないので 400 にならない）。
#47: accountScenes（口座が 2 個のときの直しの本文。A4 = 付け替え、B7 = 口座の付いていない取引を口座を変えずに保存）は、
口座を作ってから ACCOUNT_A・ACCOUNT_B の印を本物の ID に置き換えて通す。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値・名前はすべて架空。
"""

import copy

from helpers.records import load_fixture, put_default_account, same_typed

A = "userA"
PLACEHOLDER = "INSTRUMENT"


def _with_instrument(record: dict, iid: str) -> dict:
    sent = copy.deepcopy(record)
    assert sent["instrumentId"] == PLACEHOLDER
    sent["instrumentId"] = iid
    return sent


def _put_store_trade(api, uid: str, iid: str, original: dict, snapshot: dict) -> str:
    """API の作成の検査を通らない形の取引を、保存先に直接置く（作成と同じ文書の形）"""

    def build(_instrument: dict, _account: dict) -> dict:
        return {
            "schemaVersion": 1,
            "createdAt": 1_700_000_000_000,
            "updatedAt": 1_700_000_000_000,
            "snapshot": copy.deepcopy(snapshot),
            "record": copy.deepcopy(original),
        }

    tid, _doc = api.store.create_trade(uid, iid, "default", build)
    return tid


def test_edit_bodies_are_accepted_and_keep_snapshot(api):
    fixture = load_fixture("edit-bodies.json")
    assert [t["name"] for t in fixture["trades"]] == ["E1", "E2"]
    for item in fixture["trades"]:
        res = api.post("/api/instruments", A, item["instrument"])
        assert res.status_code == 201, (item["name"], res.get_json())
        iid = res.get_json()["id"]
        put_default_account(api, A, item["settings"])

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

        # 今の口座の資金を変えてから直す（写した資金は変わらない）
        put_default_account(api, A, item["settingsNow"])
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


def _with_ids(record: dict, iid: str, ids: dict[str, str]) -> dict:
    sent = _with_instrument(record, iid)
    if "accountId" in sent:
        sent["accountId"] = ids[sent["accountId"]]
    return sent


def test_account_scenes_resnapshot_only_when_reassigned(api):
    """#47 A4・B7・A9: 付け替え → 付け替え先の今の資金・通貨を写す。付け替えない（口座 1 を付けただけ）→ 写した値。
    A9（PR-2）: 通貨の違う口座へ付け替えた本文（損益・手数料なし）を本文のまま保存し、snapshot は USD"""
    scenes = load_fixture("edit-bodies.json")["accountScenes"]
    assert [x["name"] for x in scenes] == ["A4", "B7", "A9"]
    for i, item in enumerate(scenes):
        uid = f"userAcc{i}"
        ids = {"default": "default"}
        for acc in item["accounts"]:
            body = {"name": acc["name"], "capitalYen": acc["capitalYen"], "riskTolerancePct": acc["riskTolerancePct"]}
            if "currency" in acc:
                body["currency"] = acc["currency"]
            if acc["key"] == "default":
                assert api.put("/api/accounts/default", uid, body).status_code == 200
            else:
                res = api.post("/api/accounts", uid, body)
                assert res.status_code == 201, res.get_json()
                ids[acc["key"]] = res.get_json()["id"]
        res = api.post("/api/instruments", uid, item["instrument"])
        iid = res.get_json()["id"]
        original = _with_ids(item["original"], iid, ids)
        res = api.post("/api/trades", uid, original)
        assert res.status_code == 201, (item["name"], res.get_json())
        created = res.get_json()
        assert created["snapshot"] == item["snapshot"], item["name"]
        # 記録の後に口座の資金を直す（記録済みの取引は変わらない）
        for acc in item["accountsNow"]:
            body = {"name": acc["name"], "capitalYen": acc["capitalYen"], "riskTolerancePct": acc["riskTolerancePct"]}
            assert api.put(f"/api/accounts/{ids[acc['key']]}", uid, body).status_code == 200
        sent = _with_ids(item["body"], iid, ids)
        res = api.put(f"/api/trades/{created['id']}", uid, sent)
        assert res.status_code == 200, (item["name"], res.get_json())
        got = res.get_json()
        assert got["record"] == sent, item["name"]
        assert got["snapshot"]["capitalYen"] == item["expect"]["capitalYen"], item["name"]
        assert got["snapshot"]["accountCurrency"] == item["expect"]["accountCurrency"], item["name"]
        assert got["snapshot"]["instrument"] == item["snapshot"]["instrument"], item["name"]
        if item["name"] == "B7":
            assert got["snapshot"] == item["snapshot"]
