// 心理のタグ（Issue #156・設計書 4.2・C55・ADR-0022）の ID と並び・まとまり、選び方の純関数。文言は持たない（画面の
// ui/src/lib/emotion-tags.ts が ID から引く）。ID は保存の形なので変えない（変えると過去の記録の意味が変わる）。
// 取引は ID の集合を文書の最上位の emotionTags に持つ（record の外。判定・R・集計の入力には入らない）。
// API の一覧（api/src/loss_note_api/emotion_tags.py）とは fixture tests/fixtures/records/emotion-tags.json で突き合わせる。

/** まとまり（good = 良い状態。ほかは 恐れ・欲・取り戻し・思い込み） */
export type EmotionGroup = 'good' | 'fear' | 'greed' | 'recoup' | 'belief';

/** まとまりの並び */
export const EMOTION_GROUPS: readonly EmotionGroup[] = [
  'good',
  'fear',
  'greed',
  'recoup',
  'belief',
];

/** 一覧（この順に並べて保存する・画面に出す） */
export const EMOTION_TAGS = [
  { id: 'calm', group: 'good' },
  { id: 'fear', group: 'fear' },
  { id: 'nervous', group: 'fear' },
  { id: 'distress', group: 'fear' },
  { id: 'lossAversion', group: 'fear' },
  { id: 'reassurance', group: 'fear' },
  { id: 'earlyProfit', group: 'fear' },
  { id: 'wantProfit', group: 'greed' },
  { id: 'bigWin', group: 'greed' },
  { id: 'wantPosition', group: 'greed' },
  { id: 'fomo', group: 'greed' },
  { id: 'overconfident', group: 'greed' },
  { id: 'recoup', group: 'recoup' },
  { id: 'frustrated', group: 'recoup' },
  { id: 'anger', group: 'recoup' },
  { id: 'missedMove', group: 'recoup' },
  { id: 'regret', group: 'recoup' },
  { id: 'hope', group: 'belief' },
  { id: 'cantCut', group: 'belief' },
  { id: 'confirmation', group: 'belief' },
  { id: 'bargain', group: 'belief' },
] as const satisfies readonly { readonly id: string; readonly group: EmotionGroup }[];

export type EmotionTagId = (typeof EMOTION_TAGS)[number]['id'];

export const EMOTION_TAG_IDS: readonly EmotionTagId[] = EMOTION_TAGS.map((t) => t.id);

/** 平常心（ほかのタグと同時に付かない。R3） */
export const CALM: EmotionTagId = 'calm';

/** 調子に乗った（連勝の後との重なりを数える。#185） */
export const OVERCONFIDENT: EmotionTagId = 'overconfident';

/** 1 取引に付けられる取引の数の上限（複数行の明細の行の上限と同じ） */
export const MAX_EMOTION_TRADES = 20;

const ORDER: ReadonlyMap<string, number> = new Map(EMOTION_TAG_IDS.map((id, i) => [id, i]));

export const EMOTION_GROUP_OF: Readonly<Record<EmotionTagId, EmotionGroup>> = Object.fromEntries(
  EMOTION_TAGS.map((t) => [t.id, t.group]),
) as Record<EmotionTagId, EmotionGroup>;

export function isEmotionTagId(s: unknown): s is EmotionTagId {
  return typeof s === 'string' && ORDER.has(s);
}

/** 知らない値を捨て、重複を 1 つにし、一覧の順に並べる（応答・保存済みの値の読み取り。冪等） */
export function normalizeEmotions(ids: unknown): EmotionTagId[] {
  if (!Array.isArray(ids)) return [];
  const set = new Set<EmotionTagId>();
  for (const v of ids) if (isEmotionTagId(v)) set.add(v);
  return [...set].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

/**
 * チップを押した後の集合: 入っていれば外す。無ければ足し、平常心なら平常心だけ、ほかなら平常心を外す（R3）。一覧の順
 */
export function toggleEmotion(current: readonly EmotionTagId[], id: EmotionTagId): EmotionTagId[] {
  const now = normalizeEmotions(current);
  if (now.includes(id)) return now.filter((t) => t !== id);
  if (id === CALM) return [CALM];
  return normalizeEmotions([...now.filter((t) => t !== CALM), id]);
}

/**
 * 選択肢に出さないタグ（#163・ADR-0023）: 知らない値・平常心（常に出す）を捨て、重複を 1 つにし、一覧の順に並べる（冪等）。
 * 保存の後のシート・詳細のシートの選択肢を絞るだけで、付いたタグ・集計は変えない
 */
export function normalizeHidden(ids: unknown): EmotionTagId[] {
  return normalizeEmotions(ids).filter((t) => t !== CALM);
}

/** 設定の画面でタグを押した後の「出さない」集合（入っていれば出す = 外す、無ければ出さない = 足す）。平常心は変えない */
export function toggleHidden(hidden: readonly EmotionTagId[], id: EmotionTagId): EmotionTagId[] {
  const now = normalizeHidden(hidden);
  if (id === CALM) return now;
  return now.includes(id) ? now.filter((t) => t !== id) : normalizeHidden([...now, id]);
}

/**
 * タグごとに付いた取引の数（#230 R2。保存の後のシートの候補を選ぶ）。取引ごとに normalizeEmotions で知らない値を捨てて重複を
 * 1 つにしてから数える（同じ取引に同じタグが 2 度あっても 1）。0 件のタグは入れない
 */
export function countEmotions(
  trades: readonly { readonly emotionTags?: unknown }[],
): Map<EmotionTagId, number> {
  const counts = new Map<EmotionTagId, number>();
  for (const t of trades) {
    for (const id of normalizeEmotions(t.emotionTags)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
