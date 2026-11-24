// 振り返りの次の画面「期間の取引」（`/review/trades?period=…&emotion=<ID>` / `&after=winStreak`。#185。設計書 9.2・9.4）の
// 絞り方の URL と表示の形。取引の詳細の心理のチップの行き先（tradeEmotionHref。#188）もここ。DOM・通信に触れない。
// 対象は気づき（insight-view.ts）と同じ: 消した印を外し、範囲の外を落とし、取り込みは切り替えに従う。心理は気づきの行に数えた取引
// （そのタグが付いた取引）、連勝の後は core の afterWinStreak の取引。並びは取引の一覧と同じ（決済の新しい順）。
// 要約は気づきの行・連勝の後のカードと同じ文（summaryOf）。URL の心理は一覧（C55）の ID だけを通す（知らない値は「該当なし」）
// Good / More（#221）: 話題（`&good=<ID>` / `&more=<ID>`。その側の一覧（C58）の ID だけ）と自分で書いた行（`&notes=good|more`）
// 崩れの取引（#228。`&tier=off`。判定が B・危ない勝ち・C = core の runKindOf が off。振り返りの「崩れの取引を見る ›」から）
import {
  type EmotionTagId,
  isEmotionTagId,
  normalizeEmotions,
  OVERCONFIDENT,
} from '../../../core/emotion-tags';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import {
  isTopicOf,
  normalizeReflection,
  REFLECTION_SIDES,
  type ReflectionSide,
  type ReflectionTopicId,
} from '../../../core/reflection';
import { afterWinStreak, type ReviewItem, reviewPeriod, runKindOf } from '../../../core/review';
import { EMOTION_TEXT } from './emotion-tags';
import {
  insightItems,
  labeledSummaryOf,
  NOTES_ROW_NAME,
  STREAK_NONE,
  STREAK_TITLE,
  summaryOf,
} from './insight-view';
import {
  type PeriodRange,
  type PeriodSelection,
  periodAround,
  periodSearch,
  type WhyKey,
} from './period';
import { REFLECTION_SIDE_TEXT, REFLECTION_TOPIC_NAME } from './reflection';
import type { ReviewState } from './review-controller';
import { TRUNCATED } from './review-view';
import { sortTrades, type TradeRow, tradeRow } from './trade-view';

/** 経路の名前（上の帯の「‹ 期間の取引」・知らない絞り方の題） */
export const REVIEW_TRADES_NAME = '期間の取引';
/** 該当の取引が無い（知らない絞り方・0 件） */
export const REVIEW_TRADES_NONE = 'この期間に該当する取引はありません';

/** 崩れの取引の題（#228） */
export const OFF_TITLE = '崩れの取引';
/** 振り返りの押せる行「崩れの取引を見る ›」（#228。#142 の「崩れの取引を見る」） */
export const OFF_LINK = '崩れの取引を見る';

/**
 * 絞り方: 心理（気づきの行）か、連勝の後（連勝の後のカード）か、Good / More の話題・自分で書いた行（#221）か、
 * 崩れの取引（#228）
 */
export type TrailFilter =
  | { readonly kind: 'emotion'; readonly id: EmotionTagId }
  | { readonly kind: 'winStreak' }
  | { readonly kind: 'off' }
  | { readonly kind: 'topic'; readonly side: ReflectionSide; readonly id: ReflectionTopicId }
  | { readonly kind: 'notes'; readonly side: ReflectionSide };

const AFTER_WIN_STREAK = 'winStreak';
const NOTES = 'notes';
const TIER = 'tier';
const TIER_OFF = 'off';

/**
 * URL の検索部分 → 絞り方（心理は一覧の ID だけ、話題はその側の一覧の ID だけ。前から 心理 → Good → More → 自分で書いた行 →
 * 崩れの取引 → 連勝の後 の順に最初にある鍵で決め、その値が通らなければ null。どれでもなければ null）
 */
export function parseTrail(search: string): TrailFilter | null {
  const q = new URLSearchParams(search);
  const emotion = q.get('emotion');
  if (emotion !== null) return isEmotionTagId(emotion) ? { kind: 'emotion', id: emotion } : null;
  for (const side of REFLECTION_SIDES) {
    const id = q.get(side);
    if (id !== null) return isTopicOf(side, id) ? { kind: 'topic', side, id } : null;
  }
  const notes = q.get(NOTES);
  if (notes !== null) {
    return (REFLECTION_SIDES as readonly string[]).includes(notes)
      ? { kind: 'notes', side: notes as ReflectionSide }
      : null;
  }
  const tier = q.get(TIER);
  if (tier !== null) return tier === TIER_OFF ? { kind: 'off' } : null;
  return q.get('after') === AFTER_WIN_STREAK ? { kind: 'winStreak' } : null;
}

/**
 * 絞り方 → 戻る先の振り返りの「何で崩れたか」の切り替え（#228）: More / Good の行から来たらその側、ほか（心理・連勝の後・
 * 崩れの取引・知らない絞り方）は心理
 */
export function whyOfTrail(filter: TrailFilter | null): WhyKey {
  return filter && (filter.kind === 'topic' || filter.kind === 'notes') ? filter.side : 'emotion';
}

/**
 * 取引の詳細から来た印の **鍵 via と値 trade**（`&via=trade`。期間は自動で決めたと範囲の行で言う。#188）。
 * 下の元の取引の ID の **鍵 trade**（`&trade=<ID>`）とは別物: 同じ語が `via=trade&trade=x-emo` のように鍵と値に出るが、
 * 印は isFromTrade（via の値を見る）、ID は originOf（trade の値を見る）だけが読む。印の値は前からの URL（#188）と同じに保つ
 */
const VIA = 'via';
const VIA_TRADE = 'trade';
/** 押して来た元の取引の ID の鍵（`&trade=<ID>`。一覧のその行に札「この取引」を付ける。#194）。上の印の値とは別 */
const ORIGIN = 'trade';
/** 元の取引の行の札 */
export const ORIGIN_BADGE = 'この取引';

/**
 * 選んだ期間 + 絞り方 → 期間の取引の URL（期間の検索部分は振り返りのタブと同じ。parsePeriod・parseTrail と往復で同じ）。
 * fromTrade = 取引の詳細の心理のチップから（期間は periodAround で自動。`&via=trade`）。期間を選び直すと印は外れる。
 * trade = 押して来た元の取引の ID（`&trade=`。#194）。期間を選び直しても呼ぶ側が渡し続ける（元の取引は変わらない）
 */
export function reviewTradesHref(
  sel: PeriodSelection,
  filter: TrailFilter,
  opts: { readonly fromTrade?: boolean; readonly trade?: string | null } = {},
): string {
  const q = new URLSearchParams(periodSearch(sel).slice(1));
  if (filter.kind === 'emotion') q.set('emotion', filter.id);
  else if (filter.kind === 'topic') q.set(filter.side, filter.id);
  else if (filter.kind === 'notes') q.set(NOTES, filter.side);
  else if (filter.kind === 'off') q.set(TIER, TIER_OFF);
  else q.set('after', AFTER_WIN_STREAK);
  if (opts.fromTrade) q.set(VIA, VIA_TRADE);
  if (opts.trade) q.set(ORIGIN, opts.trade);
  return `/review/trades?${q.toString()}`;
}

/** URL の検索部分 → 取引の詳細から来た（期間を自動で決めた）か */
export function isFromTrade(search: string): boolean {
  return new URLSearchParams(search).get(VIA) === VIA_TRADE;
}

/**
 * URL の検索部分 → 押して来た元の取引の ID（無い・空なら null）。外から入る値なので、一覧の行の ID と比べるだけで、
 * 画面の文字にも要求にも使わない（#194）
 */
export function originOf(search: string): string | null {
  const id = new URLSearchParams(search).get(ORIGIN);
  return id ? id : null;
}

/**
 * 範囲の行の頭に添える期間の名前（#188。取引の詳細から来て期間を自動で決めたときだけ。ほかは null = 日付だけ）:
 * 「3 か月」なら「この取引を含む 3 か月」、決済の日までの指定の期間なら「この取引までの 3 か月」
 */
export function autoPeriodLead(sel: PeriodSelection, fromTrade: boolean): string | null {
  if (!fromTrade) return null;
  if (sel.key === '3m') return 'この取引を含む 3 か月';
  if (sel.key === 'custom') return 'この取引までの 3 か月';
  return null;
}

/**
 * 取引の詳細の心理のチップの行き先（#188。設計書 9.4）: その心理で絞った期間の取引。期間は決済の日を含む 3 か月（periodAround）、
 * 取り込んだ取引なら取り込みを含める（押した取引が一覧に入る）。押した取引の ID を持たせ、一覧のその行に札を付ける（#194）
 */
export function tradeEmotionHref(trade: StoredTrade, id: EmotionTagId, now: number): string {
  const imports = trade.record.source === 'import';
  return reviewTradesHref(
    periodAround(trade.record.exit.time, now, imports),
    { kind: 'emotion', id },
    { fromTrade: true, trade: trade.id },
  );
}

/** 自分で書いた行の絞り方の題（「More の自分で書いた行」。#221） */
export function notesTitle(side: ReflectionSide): string {
  return `${REFLECTION_SIDE_TEXT[side].name} の${NOTES_ROW_NAME}`;
}

/** 絞り方の題（心理の名前・「連勝の後」・話題の名前・「More の自分で書いた行」。知らない絞り方は「期間の取引」） */
export function trailTitle(filter: TrailFilter | null): string {
  if (filter === null) return REVIEW_TRADES_NAME;
  switch (filter.kind) {
    case 'emotion':
      return EMOTION_TEXT[filter.id].name;
    case 'topic':
      return REFLECTION_TOPIC_NAME[filter.id];
    case 'notes':
      return notesTitle(filter.side);
    case 'winStreak':
      return STREAK_TITLE;
    case 'off':
      return OFF_TITLE;
  }
}

export interface ReviewTradesModel {
  readonly title: string;
  /** 押した行と同じ要約（「5 件 · 0%（0 / 5）· 崩れで −1.8R」）。該当なしは null */
  readonly summary: string | null;
  /** 画面に出す名前つきの要約の組（「5 件」「計画どおり率 0%（0 / 5）」「規律コスト 崩れで −1.8R」）。該当なしは空 */
  readonly summaryParts: readonly string[];
  /**
   * 行ごとの心理の添え（取引の ID → 「調子に乗った・取り戻したい ほか 1」）。心理で絞った画面では絞った心理を省く。
   * 連勝の後では「調子に乗った」を先に出す。心理の無い行は無い（#185 デザインレビュー 3）
   */
  readonly notes: Readonly<Record<string, string>>;
  /** 期間の取引が上限（2,000 件）を超えたときの文（気づき・規律と同じ。C44）。超えなければ null */
  readonly truncatedText: string | null;
  /** 札「この取引」を付ける行の ID（URL の元の取引が行にあるときだけ。無い・当たらないなら null。#194） */
  readonly origin: string | null;
  /** 決済の新しい順の行 */
  readonly rows: readonly TradeRow[];
  readonly empty: boolean;
  /** 該当なしの文（行があれば null） */
  readonly emptyText: string | null;
}

/** 該当なしの文（絞りが分かるときは何で絞ったかを言う。#185 デザインレビュー 7） */
function noneTextOf(filter: TrailFilter | null): string {
  if (filter === null) return REVIEW_TRADES_NONE;
  if (filter.kind === 'winStreak') return STREAK_NONE;
  if (filter.kind === 'off') return `この期間に${OFF_TITLE}はありません`;
  if (filter.kind === 'notes') {
    return `この期間に ${REFLECTION_SIDE_TEXT[filter.side].name} を自分で書いた取引はありません`;
  }
  return `この期間に「${trailTitle(filter)}」を付けた取引はありません`;
}

/** 心理の添えに出す名前の数（超えた分は「ほか N」） */
const NOTE_NAMES = 2;

/**
 * Good / More の絞り方の行の添え（#221）: 話題 = 同じ側のほかの話題（一覧の順・2 つまで + 「ほか N」）、自分で書いた行 = 最初の行を
 * かぎ括弧で（2 行以上なら「ほか N 行」）。文は利用者が書いたものなので、画面はテキストのノードで出す
 */
function reflectionNoteOf(
  t: StoredTrade,
  filter: { readonly side: ReflectionSide; readonly id?: ReflectionTopicId },
): string | null {
  const part = normalizeReflection(t.reflection)[filter.side];
  if (filter.id === undefined) {
    const [first, ...rest] = part.notes;
    if (first === undefined) return null;
    return rest.length > 0 ? `「${first}」ほか ${rest.length} 行` : `「${first}」`;
  }
  const topics = part.topics.filter((id) => id !== filter.id);
  if (topics.length === 0) return null;
  const names = topics.slice(0, NOTE_NAMES).map((id) => REFLECTION_TOPIC_NAME[id]);
  const more = topics.length - NOTE_NAMES;
  return more > 0 ? `${names.join('・')} ほか ${more}` : names.join('・');
}

function noteOf(t: StoredTrade, filter: TrailFilter): string | null {
  if (filter.kind === 'topic') return reflectionNoteOf(t, filter);
  if (filter.kind === 'notes') return reflectionNoteOf(t, { side: filter.side });
  let tags: EmotionTagId[] = normalizeEmotions(t.emotionTags);
  if (filter.kind === 'emotion') tags = tags.filter((id) => id !== filter.id);
  else if (filter.kind === 'winStreak' && tags.includes(OVERCONFIDENT)) {
    tags = [OVERCONFIDENT, ...tags.filter((id) => id !== OVERCONFIDENT)];
  }
  if (tags.length === 0) return null;
  const names = tags.slice(0, NOTE_NAMES).map((id) => EMOTION_TEXT[id].name);
  const more = tags.length - NOTE_NAMES;
  return more > 0 ? `${names.join('・')} ほか ${more}` : names.join('・');
}

/** 絞り方に当たる集計の 1 件（対象 = 取り込みの切り替えの後） */
function pick(
  items: readonly ReviewItem[],
  filter: TrailFilter,
  includeImports: boolean,
): ReviewItem[] {
  const target = includeImports ? [...items] : items.filter((i) => !i.imported);
  if (filter.kind === 'emotion') return target.filter((i) => i.emotions?.includes(filter.id));
  if (filter.kind === 'topic') {
    return target.filter((i) => i.reflection?.[filter.side].topics.includes(filter.id));
  }
  if (filter.kind === 'notes') {
    return target.filter((i) => (i.reflection?.[filter.side].notes.length ?? 0) > 0);
  }
  if (filter.kind === 'off') return target.filter((i) => runKindOf(i.grade) === 'off');
  const ids = afterWinStreak(target, { includeImports: true });
  return target.filter((i) => ids.has(i.id));
}

/** 期間の取引（範囲つきの一覧の応答）→ 期間の取引の画面の表示の形 */
export function reviewTradesModel(
  trades: readonly StoredTrade[],
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly range?: { readonly from: number; readonly to: number };
    readonly filter: TrailFilter | null;
    readonly instruments: readonly InstrumentRecord[];
    readonly accounts?: readonly AccountRecord[];
    readonly truncated?: boolean;
    /** URL の元の取引の ID（originOf） */
    readonly origin?: string | null;
  },
): ReviewTradesModel {
  const title = trailTitle(opts.filter);
  const truncatedText = opts.truncated ? TRUNCATED : null;
  const none: ReviewTradesModel = {
    title,
    summary: null,
    summaryParts: [],
    rows: [],
    notes: {},
    empty: true,
    emptyText: noneTextOf(opts.filter),
    truncatedText,
    origin: null,
  };
  if (opts.filter === null) return none;
  const picked = pick(insightItems(trades, opts), opts.filter, opts.includeImports);
  if (picked.length === 0) return none;
  const ids = new Set(picked.map((i) => i.id));
  const filter = opts.filter;
  const shown = sortTrades(trades.filter((t) => ids.has(t.id)));
  const rows = shown.map((t) => tradeRow(t, opts.instruments, opts.accounts ?? []));
  const notes: Record<string, string> = {};
  for (const t of shown) {
    const n = noteOf(t, filter);
    if (n !== null) notes[t.id] = n;
  }
  const v = reviewPeriod(picked, { includeImports: true });
  return {
    title,
    summary: summaryOf(v),
    summaryParts: labeledSummaryOf(v),
    rows,
    notes,
    empty: false,
    emptyText: null,
    truncatedText,
    origin: opts.origin && ids.has(opts.origin) ? opts.origin : null,
  };
}

/** 画面の状態 → 表示の形（insightModelFor と同じ: 読み終えた範囲が今の期間の範囲と同じときだけ。null = 読み込み中） */
export function reviewTradesModelFor(
  state: ReviewState,
  range: PeriodRange,
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly filter: TrailFilter | null;
    readonly instruments: readonly InstrumentRecord[];
    readonly accounts?: readonly AccountRecord[];
    readonly origin?: string | null;
  },
): ReviewTradesModel | null {
  if (state.phase !== 'ready' || !range.ok) return null;
  if (state.range.from !== range.from || state.range.to !== range.to) return null;
  return reviewTradesModel(state.trades, {
    ...opts,
    range: state.range,
    truncated: state.truncated,
  });
}
