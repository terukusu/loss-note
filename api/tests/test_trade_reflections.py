"""取引の Good / More（Issue #123・設計書 C58・ADR-0024）の入口 ``PUT /api/trade-reflections``。

取引の文書の最上位の ``reflection``（record の外）を、取引の集合ごと 1 トランザクションで置き換える。
AC-1〜AC-6（例 #1〜#9）・KEEP-1（付いていない取引の形）・KEEP-4（自由記述の欄が残る）。
保存先 2 つ（記憶・エミュレーターの Firestore）で回す。値はすべて架空。
"""

import json

import pytest
from helpers.charts import chart_png
from helpers.records import load_fixture, put_default_account, t1

from loss_note_api import reflection, schema, trade_version

A = "reflectionUserA"
B = "reflectionUserB"
PATH = "/api/trade-reflections"


def part(topics=(), notes=()) -> dict:
    return {"topics": list(topics), "notes": list(notes)}


def body(ids, good=None, more=None) -> dict:
    return {"tradeIds": list(ids), "good": good or part(), "more": more or part()}


EX1 = {"good": part(["cutEarly"]), "more": part(["lcTooTight", "enteredEarly"])}
EX1_SAVED = {"good": part(["cutEarly"]), "more": part(["enteredEarly", "lcTooTight"])}


@pytest.fixture
def iid(api):
    return api.instrument(A)["id"]


def make(api, iid: str, uid: str = A, **over) -> dict:
    res = api.post("/api/trades", uid, t1(iid, **over))
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def put(api, ids, uid: str = A, **sides):
    return api.put(PATH, uid, body(ids, **sides))


def read(api, tid: str, uid: str = A) -> dict:
    res = api.get(f"/api/trades/{tid}", uid)
    assert res.status_code == 200
    return res.get_json()


# ── 検査の純関数 ──


def test_validate_orders_topics_and_strips_notes():
    value, issues, bad = schema.validate_reflection(
        body(["t1"], good=part(["noGreedExit", "cutEarly"], ["  架空の一言 "]), more=part())
    )
    assert (issues, bad) == ([], False)
    assert value == {"tradeIds": ["t1"], "good": part(["cutEarly", "noGreedExit"], ["架空の一言"]), "more": part()}


@pytest.mark.parametrize(
    ("good", "issue"),
    [
        (part(["enteredEarly"]), {"field": "good.topics.0", "kind": "enum"}),  # More の ID を Good に
        (part(["nope"]), {"field": "good.topics.0", "kind": "enum"}),
        (part(["cutEarly", "cutEarly"]), {"field": "good.topics", "kind": "duplicate"}),
        (part([], ["あ" * 101]), {"field": "good.notes.0", "kind": "length"}),
        (part([], ["   "]), {"field": "good.notes.0", "kind": "required"}),
        (part([], ["a\nb"]), {"field": "good.notes.0", "kind": "control"}),
        (part([], ["a b"]), {"field": "good.notes.0", "kind": "control"}),
        (part([], ["a​b"]), {"field": "good.notes.0", "kind": "control"}),
        (part([], [1]), {"field": "good.notes.0", "kind": "type"}),
        (part([], ["x"] * 11), {"field": "good.notes", "kind": "count"}),
        ({"topics": []}, {"field": "good.notes", "kind": "required"}),
        ({"topics": [], "notes": [], "x": 1}, {"field": "good", "kind": "unknownField"}),
        ("cutEarly", {"field": "good", "kind": "type"}),
    ],
)
def test_validate_rejects(good, issue):
    value, issues, bad = schema.validate_reflection({"tradeIds": ["t1"], "good": good, "more": part()})
    assert value is None and not bad
    assert issue in issues


def test_validate_limits_and_requires_sides():
    ok = part([], ["あ" * reflection.MAX_NOTE_LENGTH] * reflection.MAX_NOTES)
    assert schema.validate_reflection(body(["t1"], good=ok))[1] == []
    assert {"field": "more", "kind": "required"} in schema.validate_reflection({"tradeIds": ["t1"], "good": part()})[1]
    assert schema.validate_reflection(body([]))[1] == [{"field": "tradeIds", "kind": "count"}]
    assert schema.validate_reflection(body(["../x"])) == (None, [], True)


def test_validate_does_not_echo_values():
    _, issues, _ = schema.validate_reflection(body(["t1"], more=part(["秘密の話題"], ["秘密" * 60])))
    assert "秘密" not in json.dumps(issues, ensure_ascii=False)


# ── 入口 ──


def test_example_1_orders_topics_and_keeps_judgment_inputs(api, iid):
    """AC-1・例 #1"""
    t = make(api, iid)
    res = put(api, [t["id"]], **EX1)
    assert res.status_code == 200
    assert res.get_json() == EX1_SAVED
    got = read(api, t["id"])
    assert got["reflection"] == EX1_SAVED
    # 判定・R の入力と版・心理のタグは変わらない（R5）
    assert got["record"] == t["record"] and got["snapshot"] == t["snapshot"]
    assert got["schemaVersion"] == t["schemaVersion"]
    assert "emotionTags" not in got
    assert got["updatedAt"] > t["updatedAt"]
    assert next(x for x in api.trades(A) if x["id"] == t["id"])["reflection"] == EX1_SAVED


def test_example_2_notes_keep_order(api, iid):
    """AC-2・例 #2"""
    t = make(api, iid)
    notes = ["出る前に TP を決める", "架空の 2 行目", "架空の 3 行目"]
    assert put(api, [t["id"]], more=part([], notes)).status_code == 200
    assert read(api, t["id"])["reflection"] == {"good": part(), "more": part([], notes)}


@pytest.mark.parametrize(
    "sides",
    [
        {"good": part(["notInList"])},
        {"more": part([], ["あ" * 101])},
        {"more": part([], ["  "])},
        {"more": part([], ["a\nb"])},
        {"good": part([], ["x"] * 11)},
    ],
    ids=["一覧に無い", "101 字", "空白だけ", "改行", "11 行"],
)
def test_rejects_and_keeps_doc(api, iid, sides):
    """AC-3・例 #3〜#5"""
    t = make(api, iid)
    assert put(api, [t["id"]], **EX1).status_code == 200
    before = read(api, t["id"])
    res = put(api, [t["id"]], **sides)
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid"
    assert read(api, t["id"]) == before


def test_example_6_empty_removes_key(api, iid):
    """AC-4・例 #6・KEEP-1"""
    t = make(api, iid)
    assert "reflection" not in t
    assert put(api, [t["id"]], **EX1).status_code == 200
    res = put(api, [t["id"]])
    assert res.status_code == 200 and res.get_json() == {"good": part(), "more": part()}
    got = read(api, t["id"])
    assert "reflection" not in got
    assert set(got) == set(t)
    if api.kind == "memory":
        assert "reflection" not in api.store.users[A]["trades"][t["id"]]
    else:
        doc = api.store._db().collection("users").document(A).collection("trades").document(t["id"]).get()
        assert "reflection" not in doc.to_dict()


def test_example_7_other_users_trade_is_404(api, iid):
    """AC-5・例 #7: ほかの利用者の取引を含むと 404 で、指した自分の取引も変わらない"""
    mine = make(api, iid)
    assert put(api, [mine["id"]], good=part(["readRight"])).status_code == 200
    before = read(api, mine["id"])
    other_iid = api.instrument(B)["id"]
    theirs = make(api, other_iid, uid=B)
    res = put(api, [mine["id"], theirs["id"]], **EX1)
    assert res.status_code == 404 and res.get_json() == {"error": "not_found"}
    assert read(api, mine["id"]) == before
    assert "reflection" not in read(api, theirs["id"], B)
    # ほかの利用者からは自分の取引を指せない
    assert put(api, [mine["id"]], uid=B, **EX1).status_code == 404
    assert read(api, mine["id"]) == before


def test_many_trades_in_one_request(api, iid):
    a, b, c = make(api, iid), make(api, iid), make(api, iid)
    assert put(api, [a["id"], c["id"]], **EX1).status_code == 200
    assert read(api, a["id"])["reflection"] == EX1_SAVED
    assert read(api, c["id"])["reflection"] == EX1_SAVED
    assert "reflection" not in read(api, b["id"])


def test_example_8_other_entries_keep_reflection(api):
    """AC-6・例 #8: 取引の PUT（直す画面の本文・今の値で写し直す）・チャートの差し替えと外す・心理のタグの
    入口の後も残る"""
    item = next(x for x in load_fixture("edit-bodies.json")["trades"] if x["name"] == "E1")
    iid = api.post("/api/instruments", A, item["instrument"]).get_json()["id"]
    put_default_account(api, A, item["settings"])
    t = api.post("/api/trades", A, {**item["original"], "instrumentId": iid}).get_json()
    assert put(api, [t["id"]], **EX1).status_code == 200

    edit = {**item["body"], "instrumentId": iid}
    res = api.put(f"/api/trades/{t['id']}", A, edit)
    assert res.status_code == 200 and res.get_json()["reflection"] == EX1_SAVED
    res = api.put(f"/api/trades/{t['id']}?snapshot=current", A, edit)
    assert res.status_code == 200 and res.get_json()["reflection"] == EX1_SAVED
    res = api.call("PUT", f"/api/trades/{t['id']}/charts/x1", A, raw=chart_png(), content_type="image/png")
    assert res.status_code == 200 and res.get_json()["reflection"] == EX1_SAVED
    res = api.delete(f"/api/trades/{t['id']}/charts/x1", A)
    assert res.status_code == 200 and res.get_json()["reflection"] == EX1_SAVED
    assert api.put("/api/trade-emotions", A, {"tradeIds": [t["id"]], "tags": ["fear"]}).status_code == 200
    got = read(api, t["id"])
    assert got["reflection"] == EX1_SAVED and got["emotionTags"] == ["fear"]
    # 逆に、Good / More の入口は心理のタグを変えない
    assert put(api, [t["id"]]).status_code == 200
    assert read(api, t["id"])["emotionTags"] == ["fear"]


def test_example_9_import_trade_and_free_text_kept(api, iid):
    """例 #9・KEEP-4: 取り込みの取引にも付き、総評・自由記述の感情の欄は変わらない"""
    exit_ = {"time": 1_700_000_000_000, "price": 99.5, "reason": "lc", "review": "【取り込み】元の判定 A",
             "emotion": "架空のメモ（決済）"}  # fmt: skip
    t = make(api, iid, source="import", entryEmotion="架空のメモ（入る前）", exit=exit_)
    assert put(api, [t["id"]], **EX1).status_code == 200
    got = read(api, t["id"])
    assert got["reflection"] == EX1_SAVED
    assert got["record"] == t["record"]


def test_unknown_version_is_409_and_writes_nothing(api, iid):
    a, b = make(api, iid), make(api, iid)
    newer = trade_version.SCHEMA_VERSION + 1
    if api.kind == "memory":
        api.store.users[A]["trades"][b["id"]]["schemaVersion"] = newer
    else:
        api.store._db().collection("users").document(A).collection("trades").document(b["id"]).update(
            {"schemaVersion": newer}
        )
    res = put(api, [a["id"], b["id"]], **EX1)
    assert res.status_code == 409
    assert res.get_json() == {"error": "conflict", "reason": "unknownSchemaVersion"}
    assert "reflection" not in read(api, a["id"])


def test_requires_auth_and_json(api, iid):
    t = make(api, iid)
    assert api.put(PATH, None, body([t["id"]])).status_code == 401
    res = api.call("PUT", PATH, A, raw=b"tradeIds", content_type="text/plain")
    assert res.status_code == 400
