"""心理のタグの ID の一覧（Issue #156・設計書 C55・ADR-0022）。

画面の一覧（``core/emotion-tags.ts``）と同じ ID・同じ順。fixture ``tests/fixtures/records/emotion-tags.json`` で
突き合わせる（``api/tests/test_emotion_tags_fixture.py``）。ID は保存の形なので変えない（足すだけ）。
取引は ID の集合を文書の最上位の ``emotionTags`` に一覧の順で持つ（``record`` の外。判定・R には入らない）。
"""

EMOTION_TAG_IDS = (
    "calm",
    "fear", "nervous", "distress", "lossAversion", "reassurance", "earlyProfit",
    "wantProfit", "bigWin", "wantPosition", "fomo", "overconfident",
    "recoup", "frustrated", "anger", "missedMove", "regret",
    "hope", "cantCut", "confirmation", "bargain",
)  # fmt: skip
# 平常心（ほかのタグと同時に付かない。R3）
CALM = "calm"
# 1 回に付けられる取引の数（複数行の明細の行の上限と同じ）
MAX_TRADES = 20

ORDER = {tag: i for i, tag in enumerate(EMOTION_TAG_IDS)}


def ordered(tags: list[str]) -> list[str]:
    """一覧の順に並べる（検査を通った ID だけを渡す）"""
    return sorted(tags, key=ORDER.__getitem__)
