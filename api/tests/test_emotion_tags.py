"""心理のタグ（Issue #156・設計書 C55・ADR-0022）の入口 ``PUT /api/trade-emotions``。

取引の文書の最上位の ``emotionTags``（record の外）を、取引の集合ごと 1 トランザクションで置き換える。
AC-2（拒む 3 通り）・AC-6（押した時点で保存）・AC-8（取り込みの取引の例 #10）・
KEEP-2（直してもタグが残る）・KEEP-4（タグの無い取引の形）・KEEP-7（自由記述の感情の欄が残る）。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。
値はすべて架空。
"""

import json

import pytest
from helpers.charts import chart_parts, chart_png, encode_multipart
from helpers.records import load_fixture, put_default_account, t1

from loss_note_api import emotion_tags, schema, trade_version

A = "emotionUserA"
PATH = "/api/trade-emotions"


@pytest.fixture
def iid(api):
    return api.instrument(A)["id"]


def make(api, iid: str, **over) -> dict:
    res = api.post("/api/trades", A, t1(iid, **over))
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def put_tags(api, ids: list[str], tags: list[str], uid: str = A):
    return api.put(PATH, uid, {"tradeIds": ids, "tags": tags})


def read(api, tid: str, uid: str = A) -> dict:
    res = api.get(f"/api/trades/{tid}", uid)
    assert res.status_code == 200
    return res.get_json()


# ── 検査の純関数 ──


def test_validate_orders_tags_and_keeps_ids():
    value, issues, bad = schema.validate_emotion_tags({"tradeIds": ["t1", "t2"], "tags": ["hope", "fear"]})
    assert (issues, bad) == ([], False)
    assert value == {"tradeIds": ["t1", "t2"], "tags": ["fear", "hope"]}


@pytest.mark.parametrize(
    ("body", "issue"),
    [
        ({"tradeIds": ["t1"], "tags": ["unknown"]}, {"field": "tags.0", "kind": "enum"}),
        ({"tradeIds": ["t1"], "tags": ["fear", "fear"]}, {"field": "tags", "kind": "duplicate"}),
        ({"tradeIds": ["t1"], "tags": ["calm", "fear"]}, {"field": "tags", "kind": "exclusive"}),
        ({"tradeIds": ["t1"], "tags": "fear"}, {"field": "tags", "kind": "type"}),
        ({"tradeIds": ["t1"], "tags": [1]}, {"field": "tags.0", "kind": "enum"}),
        ({"tradeIds": [], "tags": []}, {"field": "tradeIds", "kind": "count"}),
        ({"tradeIds": [f"t{i}" for i in range(21)], "tags": []}, {"field": "tradeIds", "kind": "count"}),
        ({"tradeIds": ["t1", "t1"], "tags": []}, {"field": "tradeIds", "kind": "duplicate"}),
        ({"tradeIds": ["t1"]}, {"field": "tags", "kind": "required"}),
        ({"tags": []}, {"field": "tradeIds", "kind": "required"}),
    ],
)
def test_validate_rejects(body, issue):
    value, issues, bad = schema.validate_emotion_tags(body)
    assert value is None and not bad
    assert issue in issues


def test_validate_unknown_field_and_not_object():
    assert schema.validate_emotion_tags({"tradeIds": ["t1"], "tags": [], "x": 1})[1] == [
        {"field": "", "kind": "unknownField"}
    ]
    assert schema.validate_emotion_tags([])[1] == [{"field": "", "kind": "type"}]


def test_validate_bad_trade_id_is_not_found():
    value, issues, bad = schema.validate_emotion_tags({"tradeIds": ["../x"], "tags": []})
    assert (value, issues, bad) == (None, [], True)


def test_validate_does_not_echo_values():
    _, issues, _ = schema.validate_emotion_tags({"tradeIds": ["t1"], "tags": ["秘密のタグ"]})
    assert "秘密" not in json.dumps(issues, ensure_ascii=False)


def test_upper_limits():
    assert emotion_tags.MAX_TRADES == 20
    assert len(emotion_tags.EMOTION_TAG_IDS) == 21
    value, issues, _ = schema.validate_emotion_tags({"tradeIds": ["t1"], "tags": ["calm"]})
    assert issues == [] and value["tags"] == ["calm"]


# ── 入口 ──


def test_put_then_get_keeps_tags_in_list_order(api, iid):
    """AC-6・例 #1（一覧の順）"""
    t = make(api, iid)
    res = put_tags(api, [t["id"]], ["recoup", "wantPosition"])
    assert res.status_code == 200
    assert res.get_json() == {"tags": ["wantPosition", "recoup"]}
    got = read(api, t["id"])
    assert got["emotionTags"] == ["wantPosition", "recoup"]
    # 判定・R の入力（record・snapshot）と版は変わらない（KEEP-1）
    assert got["record"] == t["record"] and got["snapshot"] == t["snapshot"]
    assert got["schemaVersion"] == t["schemaVersion"] == trade_version.LEGACY_VERSION
    assert got["updatedAt"] > t["updatedAt"]
    # 一覧にも同じ値
    assert next(x for x in api.trades(A) if x["id"] == t["id"])["emotionTags"] == ["wantPosition", "recoup"]


def test_empty_set_removes_key(api, iid):
    """例 #2・#5: 外すと鍵ごと消え、タグの無い取引と同じ形（KEEP-4）"""
    t = make(api, iid)
    assert "emotionTags" not in t
    assert put_tags(api, [t["id"]], ["frustrated"]).status_code == 200
    res = put_tags(api, [t["id"]], [])
    assert res.status_code == 200 and res.get_json() == {"tags": []}
    got = read(api, t["id"])
    assert "emotionTags" not in got
    assert set(got) == set(t)


@pytest.mark.parametrize(
    "tags",
    [["notInList"], ["fear", "fear"], ["calm", "fear"]],
    ids=["一覧に無い", "同じタグ 2 回", "平常心と怖い"],
)
def test_rejects_three_bodies_and_keeps_tags(api, iid, tags):
    """AC-2・例 #11"""
    t = make(api, iid)
    assert put_tags(api, [t["id"]], ["hope"]).status_code == 200
    before = read(api, t["id"])
    res = put_tags(api, [t["id"]], tags)
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid"
    assert read(api, t["id"]) == before


def test_many_trades_in_one_request(api, iid):
    """R4・例 #6 / #7: 指した取引すべてに付き、ほかの取引には付かない"""
    a, b, c = make(api, iid), make(api, iid), make(api, iid)
    res = put_tags(api, [a["id"], c["id"]], ["bargain"])
    assert res.status_code == 200
    assert read(api, a["id"])["emotionTags"] == ["bargain"]
    assert read(api, c["id"])["emotionTags"] == ["bargain"]
    assert "emotionTags" not in read(api, b["id"])


def test_missing_trade_writes_nothing(api, iid):
    a = make(api, iid)
    res = put_tags(api, [a["id"], "missingTrade1"], ["fear"])
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    assert "emotionTags" not in read(api, a["id"])


def test_bad_trade_id_is_404(api, iid):
    a = make(api, iid)
    for bad in ["../x", "a/b", "x" * 41, 1]:
        res = put_tags(api, [a["id"], bad], ["fear"])
        assert res.status_code == 404, bad
    assert "emotionTags" not in read(api, a["id"])


def test_import_trade_can_be_tagged_and_judgment_inputs_stay(api, iid):
    """AC-8・例 #10: 取り込みの取引にも付く。判定・R の入力は前と同じ"""
    t = make(api, iid, source="import", exit={"time": 1_700_000_000_000, "price": 99.5, "reason": "lc",
                                              "review": "【取り込み】元の判定 A"})  # fmt: skip
    assert put_tags(api, [t["id"]], ["bargain"]).status_code == 200
    got = read(api, t["id"])
    assert got["emotionTags"] == ["bargain"]
    assert got["record"] == t["record"] and got["snapshot"] == t["snapshot"]


def test_free_text_emotions_are_kept(api, iid):
    """KEEP-7: 自由記述の感情の欄は付け外しで変わらない"""
    exit_ = {"time": 1_700_000_000_000, "price": 99.5, "reason": "lc", "emotion": "架空のメモ（決済）"}
    t = make(api, iid, entryEmotion="架空のメモ（入る前）", exit=exit_)
    put_tags(api, [t["id"]], ["fear", "hope"])
    put_tags(api, [t["id"]], [])
    got = read(api, t["id"])
    assert got["record"]["entryEmotion"] == "架空のメモ（入る前）"
    assert got["record"]["exit"]["emotion"] == "架空のメモ（決済）"
    assert got["record"] == t["record"]


def test_edit_and_charts_keep_tags(api):
    """KEEP-2・例 #13: 直す画面の本文（fixture）・今の値で写し直す・チャートの PUT / DELETE の後もタグが残る"""
    item = next(x for x in load_fixture("edit-bodies.json")["trades"] if x["name"] == "E1")
    iid = api.post("/api/instruments", A, item["instrument"]).get_json()["id"]
    put_default_account(api, A, item["settings"])
    original = {**item["original"], "instrumentId": iid}
    t = api.post("/api/trades", A, original).get_json()
    assert put_tags(api, [t["id"]], ["overconfident", "fear"]).status_code == 200
    want = ["fear", "overconfident"]

    body = {**item["body"], "instrumentId": iid}
    res = api.put(f"/api/trades/{t['id']}", A, body)
    assert res.status_code == 200 and res.get_json()["emotionTags"] == want
    res = api.put(f"/api/trades/{t['id']}?snapshot=current", A, body)
    assert res.status_code == 200 and res.get_json()["emotionTags"] == want
    res = api.call("PUT", f"/api/trades/{t['id']}/charts/x1", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["emotionTags"] == want
    res = api.delete(f"/api/trades/{t['id']}/charts/x1", A)
    assert res.status_code == 200 and res.get_json()["emotionTags"] == want
    assert read(api, t["id"])["emotionTags"] == want
    # 取引の PUT の multipart（チャートつきの直し。#89）でも残る
    body_mp, ctype = encode_multipart(chart_parts(body, {"entry": (chart_png(), "image/png")}))
    res = api.call("PUT", f"/api/trades/{t['id']}", A, raw=body_mp, content_type=ctype)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["emotionTags"] == want
    assert read(api, t["id"])["emotionTags"] == want


def test_unknown_version_is_409_and_writes_nothing(api, iid):
    """知らない版の文書には書かない（ADR-0020 の決定 7 の (a) と同じ規則）"""
    a, b = make(api, iid), make(api, iid)
    newer = trade_version.SCHEMA_VERSION + 1
    if api.kind == "memory":
        api.store.users[A]["trades"][b["id"]]["schemaVersion"] = newer
    else:
        api.store._db().collection("users").document(A).collection("trades").document(b["id"]).update(
            {"schemaVersion": newer}
        )
    res = put_tags(api, [a["id"], b["id"]], ["fear"])
    assert res.status_code == 409
    assert res.get_json() == {"error": "conflict", "reason": "unknownSchemaVersion"}
    assert "emotionTags" not in read(api, a["id"])


def test_requires_auth_and_json(api, iid):
    t = make(api, iid)
    assert api.put(PATH, None, {"tradeIds": [t["id"]], "tags": []}).status_code == 401
    res = api.call("PUT", PATH, A, raw=b"tradeIds", content_type="text/plain")
    assert res.status_code == 400
    assert res.get_json()["issues"] == [{"field": "", "kind": "contentType"}]
