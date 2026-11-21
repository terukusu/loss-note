"""心理のタグの ID の一覧が画面と同じ（Issue #156・ADR-0022）。

fixture ``tests/fixtures/records/emotion-tags.json`` は TS のテスト（``tests/core/emotion-tags-fixture.test.ts``）が
``core/emotion-tags.ts`` の一覧から作る。API の一覧（``loss_note_api.emotion_tags``）と ID・順・平常心・上限が同じこと。
"""

from helpers.records import load_fixture

from loss_note_api import emotion_tags


def test_ids_match_screen():
    fixture = load_fixture("emotion-tags.json")
    assert list(emotion_tags.EMOTION_TAG_IDS) == fixture["ids"]
    assert emotion_tags.CALM == fixture["calm"]
    assert emotion_tags.MAX_TRADES == fixture["maxTrades"]
