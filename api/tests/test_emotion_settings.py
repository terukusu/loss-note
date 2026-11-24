"""心理のタグのうち選択肢に出さないものの設定（Issue #163・ADR-0023）。

入口は ``GET`` / ``PUT /api/settings/emotion-tags``。AC-1（未設定は空）・AC-2（一覧の順・利用者ごと）・
AC-3（平常心・知らない ID・重複・配列でない値は 400 で書かない）・KEEP-1（取引のタグは変えない）・
KEEP-3（設定の PUT と互いに消さない）。保存先 2 つ（記憶・エミュレーターの Firestore）で回す。
値はすべて架空。
"""

import pytest
from helpers.records import t1

from loss_note_api import emotion_tags, schema

A = "choiceUserA"
B = "choiceUserB"
PATH = "/api/settings/emotion-tags"


def put(api, body, uid: str = A):
    return api.put(PATH, uid, body)


def hidden(api, uid: str = A) -> list[str]:
    res = api.get(PATH, uid)
    assert res.status_code == 200, res.get_json()
    return res.get_json()["hidden"]


# ── 純関数 ──


def test_hideable_is_every_tag_but_calm():
    assert emotion_tags.HIDEABLE == tuple(t for t in emotion_tags.EMOTION_TAG_IDS if t != "calm")
    assert len(emotion_tags.HIDEABLE) == 20


@pytest.mark.parametrize(
    ("doc", "expected"),
    [
        (None, []),
        ({}, []),
        ({"hidden": "fomo"}, []),
        ({"hidden": ["bargain", "fomo", "fomo"]}, ["fomo", "bargain"]),
        # 平常心・知らない ID（後の版で足したタグ）・文字でない値は読むときに落とす
        ({"hidden": ["calm", "futureTag", 3, "hope"]}, ["hope"]),
    ],
)
def test_hidden_of_normalizes_saved_doc(doc, expected):
    assert emotion_tags.hidden_of(doc) == expected


def test_validate_orders_hidden():
    value, issues = schema.validate_emotion_settings({"hidden": ["bargain", "fomo"]})
    assert issues == []
    assert value == {"hidden": ["fomo", "bargain"]}


@pytest.mark.parametrize(
    ("body", "issue"),
    [
        ({"hidden": ["calm"]}, {"field": "hidden", "kind": "calm"}),
        ({"hidden": ["unknown"]}, {"field": "hidden.0", "kind": "enum"}),
        ({"hidden": ["fomo", "fomo"]}, {"field": "hidden", "kind": "duplicate"}),
        ({"hidden": "fomo"}, {"field": "hidden", "kind": "type"}),
        ({"hidden": [1]}, {"field": "hidden.0", "kind": "enum"}),
        ({"hidden": list(emotion_tags.EMOTION_TAG_IDS)}, {"field": "hidden", "kind": "count"}),
        ({}, {"field": "hidden", "kind": "required"}),
        ({"hidden": [], "extra": 1}, {"field": "", "kind": "unknownField"}),
    ],
)
def test_validate_rejects(body, issue):
    value, issues = schema.validate_emotion_settings(body)
    assert value is None
    assert issue in issues


def test_validate_issues_do_not_echo_values():
    _, issues = schema.validate_emotion_settings({"hidden": ["<script>secret"]})
    assert "secret" not in repr(issues)


# ── 入口（記憶・Firestore）──


def test_ac1_unset_is_empty(api):
    assert hidden(api) == []


def test_ac2_saved_in_list_order_and_per_user(api):
    res = put(api, {"hidden": ["bargain", "fomo"]})
    assert res.status_code == 200, res.get_json()
    assert res.get_json() == {"hidden": ["fomo", "bargain"]}
    assert hidden(api) == ["fomo", "bargain"]
    # ほかの利用者は別（利用者ごとの文書）
    assert hidden(api, B) == []
    # 丸ごと置き換える（空に戻せる）
    assert put(api, {"hidden": []}).status_code == 200
    assert hidden(api) == []


@pytest.mark.parametrize(
    "body",
    [
        {"hidden": ["calm"]},
        {"hidden": ["unknown"]},
        {"hidden": ["fomo", "fomo"]},
        {"hidden": "fomo"},
    ],
)
def test_ac3_rejects_and_keeps_saved(api, body):
    assert put(api, {"hidden": ["hope"]}).status_code == 200
    res = put(api, body)
    assert res.status_code == 400
    assert res.get_json()["error"] == "invalid"
    assert hidden(api) == ["hope"]


def test_needs_login(api):
    assert api.get(PATH).status_code == 401
    assert api.put(PATH, None, {"hidden": []}).status_code == 401


def test_keep3_settings_and_choices_do_not_erase_each_other(api):
    assert put(api, {"hidden": ["fomo"]}).status_code == 200
    body = {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "yen"}
    res = api.put("/api/settings", A, body)
    assert res.status_code == 200, res.get_json()
    assert hidden(api) == ["fomo"]
    assert put(api, {"hidden": ["hope"]}).status_code == 200
    got = api.get("/api/settings", A).get_json()
    assert {k: got[k] for k in body} == body
    assert len(got["capitalHistory"]) == 1


def test_keep1_trade_tags_are_not_changed(api):
    iid = api.instrument(A)["id"]
    res = api.post("/api/trades", A, t1(iid))
    assert res.status_code == 201, res.get_json()
    tid = res.get_json()["id"]
    assert api.put("/api/trade-emotions", A, {"tradeIds": [tid], "tags": ["fomo"]}).status_code == 200
    assert put(api, {"hidden": ["fomo"]}).status_code == 200
    assert api.get(f"/api/trades/{tid}", A).get_json()["emotionTags"] == ["fomo"]
    # 出さない設定のタグも付けられる（選択肢の絞り込みは画面の側だけ。開いたときに付いていたタグを外す・付け直す）
    assert api.put("/api/trade-emotions", A, {"tradeIds": [tid], "tags": ["fomo", "hope"]}).status_code == 200
