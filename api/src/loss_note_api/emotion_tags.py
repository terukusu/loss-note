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


# 選択肢に出さないにできるタグ（平常心を除く。#163・ADR-0023。平常心は気づきの基準の行なので常に出す）
HIDEABLE = tuple(t for t in EMOTION_TAG_IDS if t != CALM)


def hidden_of(doc: dict | None) -> list[str]:
    """保存した選択肢の設定 → 出さないタグ（一覧の順。平常心・知らない ID・重複・形の違う値を落とす）。

    知らない ID は、後の版で足したタグを出さないにした後で前の版へ戻したときに起きる（読むときだけ落とし、書かない）
    """
    raw = (doc or {}).get("hidden")
    if not isinstance(raw, list):
        return []
    return ordered(list({t for t in raw if isinstance(t, str) and t in ORDER and t != CALM}))
