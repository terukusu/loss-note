// 振り返りの次の画面「期間の取引」（`/review/trades?period=…&emotion=<ID>` / `&after=winStreak`。#185。設計書 9.2・9.4）の
// 絞り方の URL と表示の形。取引の詳細の心理のチップの行き先（tradeEmotionHref。#188）もここ。DOM・通信に触れない。
// 対象は気づき（insight-view.ts）と同じ: 消した印を外し、範囲の外を落とし、取り込みは切り替えに従う。心理は気づきの行に数えた取引
// （そのタグが付いた取引）、連勝の後は core の afterWinStreak の取引。並びは取引の一覧と同じ（決済の新しい順）。
// 要約は気づきの行・連勝の後のカードと同じ文（summaryOf）。URL の心理は一覧（C55）の ID だけを通す（知らない値は「該当なし」）
import {
  type EmotionTagId,
  isEmotionTagId,
  normalizeEmotions,
  OVERCONFIDENT,
} from '../../../core/emotion-tags';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import { afterWinStreak, type ReviewItem, reviewPeriod } from '../../../core/review';
import { EMOTION_TEXT } from './emotion-tags';
import {
  insightItems,
  labeledSummaryOf,
  STREAK_NONE,
  STREAK_TITLE,
  summaryOf,
} from './insight-view';
import { type PeriodRange, type PeriodSelection, periodAround, periodSearch } from './period';
import type { ReviewState } from './review-controller';
import { TRUNCATED } from './review-view';
import { sortTrades, type TradeRow, tradeRow } from './trade-view';

/** 経路の名前（上の帯の「‹ 期間の取引」・知らない絞り方の題） */
export const REVIEW_TRADES_NAME = '期間の取引';
/** 該当の取引が無い（知らない絞り方・0 件） */
export const REVIEW_TRADES_NONE = 'この期間に該当する取引はありません';

/** 絞り方: 心理（気づきの行）か、連勝の後（連勝の後のカード） */
export type TrailFilter =
  | { readonly kind: 'emotion'; readonly id: EmotionTagId }
  | { readonly kind: 'winStreak' };

const AFTER_WIN_STREAK = 'winStreak';

/** URL の検索部分 → 絞り方（心理は一覧の ID だけ。両方あれば心理。どちらでもなければ null） */
export function parseTrail(search: string): TrailFilter | null {
  const q = new URLSearchParams(search);
  const emotion = q.get('emotion');
  if (emotion !== null) return isEmotionTagId(emotion) ? { kind: 'emotion', id: emotion } : null;
  return q.get('after') === AFTER_WIN_STREAK ? { kind: 'winStreak' } : null;
}

/** 取引の詳細から来た印の鍵と値（`&via=trade`。期間は自動で決めたと範囲の行で言う。#188） */
const VIA = 'via';
const VIA_TRADE = 'trade';

/**
 * 選んだ期間 + 絞り方 → 期間の取引の URL（期間の検索部分は振り返りのタブと同じ。parsePeriod・parseTrail と往復で同じ）。
 * fromTrade = 取引の詳細の心理のチップから（期間は periodAround で自動。`&via=trade`）。期間を選び直すと印は外れる
 */
export function reviewTradesHref(
  sel: PeriodSelection,
  filter: TrailFilter,
  opts: { readonly fromTrade?: boolean } = {},
): string {
  const q = new URLSearchParams(periodSearch(sel).slice(1));
  if (filter.kind === 'emotion') q.set('emotion', filter.id);
  else q.set('after', AFTER_WIN_STREAK);
  if (opts.fromTrade) q.set(VIA, VIA_TRADE);
  return `/review/trades?${q.toString()}`;
}

/** URL の検索部分 → 取引の詳細から来た（期間を自動で決めた）か */
export function isFromTrade(search: string): boolean {
  return new URLSearchParams(search).get(VIA) === VIA_TRADE;
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
 * 取り込んだ取引なら取り込みを含める（押した取引が一覧に入る）
 */
export function tradeEmotionHref(trade: StoredTrade, id: EmotionTagId, now: number): string {
  const imports = trade.record.source === 'import';
  return reviewTradesHref(
    periodAround(trade.record.exit.time, now, imports),
    { kind: 'emotion', id },
    { fromTrade: true },
  );
}

/** 絞り方の題（心理の名前・「連勝の後」。知らない絞り方は「期間の取引」） */
export function trailTitle(filter: TrailFilter | null): string {
  if (filter === null) return REVIEW_TRADES_NAME;
  return filter.kind === 'emotion' ? EMOTION_TEXT[filter.id].name : STREAK_TITLE;
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
  return `この期間に「${EMOTION_TEXT[filter.id].name}」を付けた取引はありません`;
}

/** 心理の添えに出す名前の数（超えた分は「ほか N」） */
const NOTE_NAMES = 2;

function noteOf(t: StoredTrade, filter: TrailFilter): string | null {
  let tags: EmotionTagId[] = normalizeEmotions(t.emotionTags);
  if (filter.kind === 'emotion') tags = tags.filter((id) => id !== filter.id);
  else if (tags.includes(OVERCONFIDENT)) {
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
