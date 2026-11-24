"""Good / More の話題の ID の一覧が画面と同じ（Issue #123・ADR-0024）。

fixture ``tests/fixtures/records/reflection-topics.json`` は TS のテスト（``tests/core/reflection-fixture.test.ts``）が
``core/reflection.ts`` の一覧から作る。API の一覧（``loss_note_api.reflection``）と ID・順・上限が同じこと（AC-8）。
"""

from helpers.records import load_fixture

from loss_note_api import reflection


def test_topics_match_screen():
    fixture = load_fixture("reflection-topics.json")
    assert list(reflection.TOPICS["good"]) == fixture["good"]
    assert list(reflection.TOPICS["more"]) == fixture["more"]
    assert reflection.MAX_NOTES == fixture["maxNotes"]
    assert reflection.MAX_NOTE_LENGTH == fixture["maxNoteLength"]
