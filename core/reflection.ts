// 取引の Good / More（Issue #123・設計書 4.2・9.4・C58・ADR-0024）の話題の ID と並び・上限、正規化と操作の純関数。
// 文言は持たない（画面の ui/src/lib/reflection.ts が ID から引く）。ID は保存の形なので変えない（足すだけ）。
// 取引は文書の最上位の reflection に持つ（record の外。判定・R・集計の入力には入らない。心理のタグ C55 と同じ層）。
// 話題は「行動」だけ（気持ちは心理のタグ C55 に任せて二重に付けない。判定が自動で出すものも入れない）。
// API の一覧（api/src/loss_note_api/reflection.py）とは fixture tests/fixtures/records/reflection-topics.json で突き合わせる。

/** Good = 良かった行動、More = もっとこうすべきだった行動 */
export type ReflectionSide = 'good' | 'more';

export const REFLECTION_SIDES: readonly ReflectionSide[] = ['good', 'more'];

/** 話題の ID（この順に並べて保存する・画面に出す） */
export const REFLECTION_TOPICS = {
  good: [
    'cutEarly',
    'readRight',
    'followedRules',
    'letProfitRun',
    'resistedUrge',
    'noGreedExit',
    'waitedForSignal',
  ],
  more: [
    'enteredEarly',
    'againstHigherTf',
    'oversized',
    'lcTooTight',
    'noExitPlan',
    'reEntered',
    'orderMistake',
  ],
} as const;

export type GoodTopicId = (typeof REFLECTION_TOPICS.good)[number];
export type MoreTopicId = (typeof REFLECTION_TOPICS.more)[number];
export type ReflectionTopicId = GoodTopicId | MoreTopicId;

/** 自分で書く行の上限（片側の行数・1 行の文字数。文字はコードポイントで数える = API と同じ） */
export const MAX_REFLECTION_NOTES = 10;
export const MAX_REFLECTION_NOTE_LENGTH = 100;

/** 片側（話題の ID の集合 + 自分で書いた行） */
export interface ReflectionPart {
  readonly topics: readonly ReflectionTopicId[];
  readonly notes: readonly string[];
}

/** 取引の Good / More（保存の形。両側とも空なら取引の文書に鍵が無い） */
export interface Reflection {
  readonly good: ReflectionPart;
  readonly more: ReflectionPart;
}

export const EMPTY_PART: ReflectionPart = { topics: [], notes: [] };
export const EMPTY_REFLECTION: Reflection = { good: EMPTY_PART, more: EMPTY_PART };

const ORDER: Readonly<Record<ReflectionSide, ReadonlyMap<string, number>>> = {
  good: new Map(REFLECTION_TOPICS.good.map((id, i) => [id, i])),
  more: new Map(REFLECTION_TOPICS.more.map((id, i) => [id, i])),
};

export function isTopicOf(side: ReflectionSide, s: unknown): s is ReflectionTopicId {
  return typeof s === 'string' && ORDER[side].has(s);
}

/** 文字数（コードポイント。API の len と同じ数え方） */
export function noteLength(s: string): number {
  return [...s].length;
}

// 改行・タブ・ほかの制御文字（Cc）・書式文字（Cf。双方向の上書き・ゼロ幅文字など）・孤立したサロゲート（Cs）・行と段落の
// 区切り（Zl・Zp）。ZWJ（U+200D）だけは絵文字の組み立てに使うので受ける（API の schema.text と同じ考え）
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const ZWJ = '\u200d';

function hasControl(s: string): boolean {
  return CONTROL.test(s.split(ZWJ).join(''));
}

/** 行の誤り（前後の空白を除いた後で見る）。無ければ null */
export type NoteIssue = 'empty' | 'tooLong' | 'control';

export function noteIssue(raw: string): NoteIssue | null {
  const v = raw.trim();
  if (v === '') return 'empty';
  if (hasControl(v)) return 'control';
  if (noteLength(v) > MAX_REFLECTION_NOTE_LENGTH) return 'tooLong';
  return null;
}

function normalizePart(side: ReflectionSide, raw: unknown): ReflectionPart {
  const src = (raw && typeof raw === 'object' ? raw : {}) as { topics?: unknown; notes?: unknown };
  const set = new Set<ReflectionTopicId>();
  if (Array.isArray(src.topics)) for (const v of src.topics) if (isTopicOf(side, v)) set.add(v);
  const topics = [...set].sort((a, b) => (ORDER[side].get(a) ?? 0) - (ORDER[side].get(b) ?? 0));
  const notes = Array.isArray(src.notes)
    ? src.notes
        .filter((n): n is string => typeof n === 'string' && noteIssue(n) === null)
        .map((n) => n.trim())
        .slice(0, MAX_REFLECTION_NOTES)
    : [];
  return { topics, notes };
}

/** 応答・保存済みの値の読み取り: 知らない ID・形の違う行を捨て、話題を一覧の順にそろえる（冪等） */
export function normalizeReflection(raw: unknown): Reflection {
  const src = (raw && typeof raw === 'object' ? raw : {}) as { good?: unknown; more?: unknown };
  return { good: normalizePart('good', src.good), more: normalizePart('more', src.more) };
}

export function isEmptyPart(p: ReflectionPart): boolean {
  return p.topics.length === 0 && p.notes.length === 0;
}

export function isEmptyReflection(r: Reflection): boolean {
  return isEmptyPart(r.good) && isEmptyPart(r.more);
}

export function sameReflection(a: Reflection, b: Reflection): boolean {
  const eq = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return REFLECTION_SIDES.every((s) => eq(a[s].topics, b[s].topics) && eq(a[s].notes, b[s].notes));
}

const withPart = (r: Reflection, side: ReflectionSide, part: ReflectionPart): Reflection =>
  side === 'good' ? { good: part, more: r.more } : { good: r.good, more: part };

/** チップを押した後: 付いていれば外す、無ければ足す（一覧の順） */
export function toggleTopic(
  r: Reflection,
  side: ReflectionSide,
  id: ReflectionTopicId,
): Reflection {
  const part = r[side];
  const topics = part.topics.includes(id)
    ? part.topics.filter((t) => t !== id)
    : [...part.topics, id];
  return withPart(r, side, normalizePart(side, { topics, notes: part.notes }));
}

/** 行を足す（前後の空白を除く）。足せない理由があれば理由を返し、値は変えない */
export function addNote(
  r: Reflection,
  side: ReflectionSide,
  raw: string,
): { readonly value: Reflection; readonly issue: NoteIssue | 'full' | null } {
  const issue = noteIssue(raw);
  if (issue !== null) return { value: r, issue };
  const part = r[side];
  if (part.notes.length >= MAX_REFLECTION_NOTES) return { value: r, issue: 'full' };
  return {
    value: withPart(r, side, { topics: part.topics, notes: [...part.notes, raw.trim()] }),
    issue: null,
  };
}

/** index の行を消す（範囲の外なら変えない） */
export function removeNote(r: Reflection, side: ReflectionSide, index: number): Reflection {
  const part = r[side];
  if (index < 0 || index >= part.notes.length) return r;
  return withPart(r, side, {
    topics: part.topics,
    notes: part.notes.filter((_, i) => i !== index),
  });
}
