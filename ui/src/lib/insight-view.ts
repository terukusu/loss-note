// 振り返りのタブの「気づき」の心理ごとの集計の表示の形（#162。設計書 6.1・6.2・9.4・C44・C55）。DOM・通信に触れない。
// 対象の取引は規律の振り返り（review-view.ts の reviewModel）と同じ: 消した印を外し、範囲の外を落とし、取り込みは切り替えに従う。
// 数えるのは core/review.ts の reviewByEmotion（タグごとの部分集合に reviewPeriod を当てる）。文は規律の振り返りの規則のまま:
// 率は formatRate・分数「5 / 5」、規律コストは 1 枚目のカードの見出しの 3 通りの言い方、判定の出た取引が 5 件未満なら件数だけ。
// 成績は R だけ・色は付けない（C34。行に棒も置かない）
import { CALM, type EmotionTagId, normalizeEmotions } from '../../../core/emotion-tags';
import type { StoredTrade } from '../../../core/record';
import {
  MIN_JUDGED_FOR_RATE,
  type PeriodReview,
  type ReviewItem,
  reviewByEmotion,
} from '../../../core/review';
import { EMOTION_TEXT } from './emotion-tags';
import { formatR, formatRate } from './format';
import { inRange, type PeriodRange } from './period';
import type { ReviewState } from './review-controller';
import {
  HEADLINE_LEAD,
  NO_CURVE,
  REVIEW_EMPTY,
  REVIEW_ONLY_IMPORTS,
  reviewItemOf,
} from './review-view';
import { visibleTrades } from './trade-view';

export const INSIGHT_TITLE = '心理ごとの規律';
/** 判定の出た取引が 5 件未満の行（6.1。率・分数・規律コストを出さない） */
export const FEW = '件数が少ない';
/** 件数が少ない行のまとまりの見出し（値のある行と分けて 1 回だけ。#162 デザインレビュー 1） */
export const FEW_HEAD = '件数が少ない（判定の出た取引が 5 件未満）';
/** 列の見出し（#162 デザインレビュー 2） */
export const COLUMN = { rate: '計画どおり率', cost: '規律コスト' } as const;
/** 平常心の行の印（比べる基準。#162 デザインレビュー 4） */
export const BASE_MARK = '基準';
/** 期間の取引にどの心理も付いていない（E5） */
export const INSIGHT_NONE_LINES = [
  'この期間の取引に心理は付いていません。',
  '取引の詳細の「心理」から付けられます。',
] as const;
export const INSIGHT_NONE = INSIGHT_NONE_LINES.join('');
/** 2 つ以上の心理が付いた取引がある期間だけ（E1・E8） */
export const OVERLAP_NOTE =
  '2 つ以上の心理が付いた取引は各行に数えるので、行の件数の和は合計より多くなります';

export interface InsightRow {
  readonly id: EmotionTagId;
  readonly name: string;
  /** 「5 件」 */
  readonly countText: string;
  /** 判定の出た取引が 5 件未満（値を出さない） */
  readonly few: boolean;
  /** 平常心（比べる基準。値のまとまりの先頭に置く） */
  readonly base: boolean;
  /** few のとき「あと 3 件」（判定の出た取引があと何件で値が出るか。ui-guidelines P5） */
  readonly restText: string | null;
  /** 「100%」（few なら null） */
  readonly rateText: string | null;
  /** 「（5 / 5）」の中身「5 / 5」（few なら null） */
  readonly fractionText: string | null;
  /**
   * 規律コストの文（few なら null）。lead = 「崩れで」「崩れなし」「R で測れる崩れ」、value = 「−1.8R」。
   * R の出る取引が 1 件も無ければ lead = 「R が出る取引がありません」・value = ''
   */
  readonly cost: {
    readonly kind: keyof typeof HEADLINE_LEAD | 'noCurve';
    readonly lead: string;
    readonly value: string;
  } | null;
  /** 行の全文（テスト・例の表の形。「平常心 5 件 · 100%（5 / 5）· 崩れなし ±0.0R」） */
  readonly text: string;
  /** 読み上げの全文（列の名前つき。見た目の部品は読み上げから外す） */
  readonly srText: string;
}

export interface InsightModel {
  /** 集計の対象が 0 件（行も見出しも出さない） */
  readonly empty: boolean;
  /** 対象 0 件・タグの付いた取引 0 件のときの文（どちらでもなければ null） */
  readonly emptyText: string | null;
  /** 「11 件のうち 10 件に記入」（対象 0 件なら null） */
  readonly headText: string | null;
  readonly overlapText: string | null;
  /** すべての行（平常心 → 件数の多い順 → 一覧の順） */
  readonly rows: readonly InsightRow[];
  /** 値を出す行（平常心は件数が少なくてもここの先頭） */
  readonly main: readonly InsightRow[];
  /** 件数が少ない行（平常心を除く。名前と件数だけを詰めて並べる） */
  readonly few: readonly InsightRow[];
}

/** 規律コストの言い方（review-view.ts の見出しと同じ規則） */
function costOf(v: PeriodReview): InsightRow['cost'] {
  if (v.curve.length === 0) return { kind: 'noCurve', lead: NO_CURVE, value: '' };
  const kind = v.cost < 0 ? 'gap' : v.noR > 0 ? 'measured' : 'none';
  return { kind, lead: HEADLINE_LEAD[kind], value: formatR(v.cost) };
}

function rowOf(id: EmotionTagId, v: PeriodReview): InsightRow {
  const name = EMOTION_TEXT[id].name;
  const countText = `${v.total} 件`;
  const base = id === CALM;
  const baseText = base ? `（${BASE_MARK}）` : '';
  if (v.rate === null) {
    const restText = `あと ${MIN_JUDGED_FOR_RATE - v.judged} 件`;
    return {
      id,
      name,
      countText,
      few: true,
      base,
      restText,
      rateText: null,
      fractionText: null,
      cost: null,
      text: `${name} ${countText} · ${FEW}`,
      srText: `${name}${baseText} ${countText}、${FEW}（${restText}で表示）`,
    };
  }
  const rateText = formatRate(v.rate);
  const fractionText = `${v.planned} / ${v.judged}`;
  const cost = costOf(v);
  const costText = cost ? [cost.lead, cost.value].filter(Boolean).join(' ') : '';
  return {
    id,
    name,
    countText,
    few: false,
    base,
    restText: null,
    rateText,
    fractionText,
    cost,
    text: `${name} ${countText} · ${rateText}（${fractionText}）· ${costText}`,
    srText: `${name}${baseText} ${countText}、${COLUMN.rate} ${rateText}（${fractionText}）、${COLUMN.cost} ${costText}`,
  };
}

/**
 * 保存した取引 → 集計の 1 件 + 心理のタグ（規律の集計の 1 件 reviewItemOf は変えない = タグで規律が変わらない。#156 の KEEP-1）。
 * 知らない ID は捨てる
 */
export function emotionItemOf(t: StoredTrade): ReviewItem {
  const emotions = normalizeEmotions(t.emotionTags);
  const item = reviewItemOf(t);
  return emotions.length > 0 ? { ...item, emotions } : item;
}

/** 期間の取引（範囲つきの一覧の応答）→ 気づきの表示（規律の reviewModel と同じ対象）。range があれば範囲の外を落とす */
export function insightModel(
  trades: readonly StoredTrade[],
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly range?: { readonly from: number; readonly to: number };
  },
): InsightModel {
  const range = opts.range;
  const shown = visibleTrades(trades, opts.hidden).filter(
    (t) => range === undefined || inRange(t.record.exit.time, range),
  );
  const v = reviewByEmotion(shown.map(emotionItemOf), { includeImports: opts.includeImports });
  if (v.total === 0) {
    return {
      empty: true,
      emptyText: v.excludedImports > 0 ? REVIEW_ONLY_IMPORTS : REVIEW_EMPTY,
      headText: null,
      overlapText: null,
      rows: [],
      main: [],
      few: [],
    };
  }
  const rows = v.rows.map((r) => rowOf(r.id, r.review));
  return {
    empty: false,
    emptyText: v.rows.length === 0 ? INSIGHT_NONE : null,
    headText: `${v.total} 件のうち ${v.tagged} 件に記入`,
    overlapText: v.overlap ? OVERLAP_NOTE : null,
    rows,
    main: rows.filter((r) => r.base || !r.few),
    few: rows.filter((r) => !r.base && r.few),
  };
}

/** 画面の状態 → 気づきの表示（reviewModelFor と同じ: 読み終えた範囲が今の期間の範囲と同じときだけ。null = 読み込み中） */
export function insightModelFor(
  state: ReviewState,
  range: PeriodRange,
  opts: { readonly hidden: ReadonlySet<string>; readonly includeImports: boolean },
): InsightModel | null {
  if (state.phase !== 'ready' || !range.ok) return null;
  if (state.range.from !== range.from || state.range.to !== range.to) return null;
  return insightModel(state.trades, { ...opts, range: state.range });
}
