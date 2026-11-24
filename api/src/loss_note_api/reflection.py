"""取引の Good / More の話題の ID と上限（Issue #123・設計書 C58・ADR-0024）。

画面の一覧（``core/reflection.ts``）と同じ ID・同じ順・同じ上限。fixture
``tests/fixtures/records/reflection-topics.json`` で突き合わせる
（``api/tests/test_reflection_fixture.py``）。ID は保存の形なので変えない（足すだけ）。
取引は文書の最上位の ``reflection`` に ``{good: {topics, notes}, more: {topics, notes}}`` で持つ（``record`` の外。
判定・R には入らない。両側とも空なら鍵ごと消す）。
"""

TOPICS = {
    "good": (
        "cutEarly", "readRight", "followedRules", "letProfitRun",
        "resistedUrge", "noGreedExit", "waitedForSignal",
    ),
    "more": (
        "enteredEarly", "againstHigherTf", "oversized", "lcTooTight",
        "noExitPlan", "reEntered", "orderMistake",
    ),
}  # fmt: skip
SIDES = ("good", "more")
# 自分で書く行: 片側の行数と 1 行の文字数（コードポイント）
MAX_NOTES = 10
MAX_NOTE_LENGTH = 100

ORDER = {side: {t: i for i, t in enumerate(ids)} for side, ids in TOPICS.items()}


def ordered(side: str, topics: list[str]) -> list[str]:
    """一覧の順に並べる（検査を通った ID だけを渡す）"""
    return sorted(topics, key=ORDER[side].__getitem__)


def is_empty(value: dict) -> bool:
    return all(not value[s]["topics"] and not value[s]["notes"] for s in SIDES)
