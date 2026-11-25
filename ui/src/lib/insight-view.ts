// 振り返りのタブの「気づき」の心理ごとの集計の表示の形（#162。設計書 6.1・6.2・9.4・C44・C55）。DOM・通信に触れない。
// 対象の取引は規律の振り返り（review-view.ts の reviewModel）と同じ: 消した印を外し、範囲の外を落とし、取り込みは切り替えに従う。
// 数えるのは core/review.ts の reviewByEmotion（タグごとの部分集合に reviewPeriod を当てる）。文は規律の振り返りの規則のまま:
// 率は formatRate・分数「5 / 5」、規律コストは 1 枚目のカードの見出しの 3 通りの言い方、判定の出た取引が 5 件未満なら件数だけ。
// 成績は R だけ・色は付けない（C34。行に棒も置かない）
// 連勝の後のカード（#185）も同じ対象・同じ文の規則で、連勝の後の取引の部分集合を数える（core の reviewAfterWinStreak）
// Good / More のカード（#221）も同じ対象・同じ行の文の規則で、話題ごとの部分集合を数える（core の reviewByReflection）
// 崩れ方（#239・C68）も同じ対象・同じ行の文の規則で、判定の崩れの理由ごとの部分集合を数える（core の reviewByReason）。
// 行の取引はすべて崩れで計画どおり率がいつも 0% なので、率と分数は出さない（件数と規律コストだけ）
import { CALM, type EmotionTagId, normalizeEmotions } from '../../../core/emotion-tags';
import type { StoredTrade } from '../../../core/record';
import {
  isEmptyReflection,
  normalizeReflection,
  type ReflectionSide,
} from '../../../core/reflection';
import {
  type BreachKind,
  MIN_JUDGED_FOR_RATE,
  type PeriodReview,
  REFLECTION_NOTES,
  type ReflectionRowKey,
  type ReviewItem,
  reviewAfterWinStreak,
  reviewByEmotion,
  reviewByReason,
  reviewByReflection,
  WIN_STREAK_MIN,
} from '../../../core/review';
import { EMOTION_TEXT } from './emotion-tags';
import { formatDay, formatR, formatRate } from './format';
import { inRange, type PeriodRange } from './period';
import { BREACH_NAME } from './reasons';
import { REFLECTION_SIDE_TEXT, REFLECTION_TOPIC_NAME } from './reflection';
import type { ReviewState } from './review-controller';
import {
  breachItemOf,
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
export const FEW_HEAD = '件数が少ない（判定の出た取引が 5 件になると表示）';
/** 列の見出し（#162 デザインレビュー 2） */
export const COLUMN = { rate: '計画どおり率', cost: '規律コスト' } as const;
/** 平常心の行の印（比べる基準。#162 デザインレビュー 4） */
export const BASE_MARK = '基準';
/** 期間の取引にどの心理も付いていない（E5） */
export const INSIGHT_NONE_LINES = ['この期間の取引に心理は付いていません'] as const;
export const INSIGHT_NONE = INSIGHT_NONE_LINES.join('');
/**
 * 2 つ以上の心理が付いた取引がある期間だけ（E1・E8）。数字を読み違えさせないための注記なので消さず、見える文は結果だけにして
 * 訳は「i」の中（C70・#254）
 */
export const OVERLAP_NOTE = '行の件数の和は合計より多くなります';
export const OVERLAP_INFO = {
  label: '行の件数の和',
  body: '2 つ以上の心理が付いた取引は、当てはまる行のそれぞれに 1 件ずつ数えます。',
  id: 'review-overlap-info',
} as const;

/** 連勝の後のカード（#185。設計書 6.1・9.4） */
export const STREAK_TITLE = '連勝の後';
export const STREAK_LEAD = `${WIN_STREAK_MIN} 連勝以上の直後の取引`;
export const STREAK_NONE = `この期間に ${WIN_STREAK_MIN} 連勝の直後の取引はありません`;
/** 数え方は見出しの「i」の中（C70・#254） */
export const STREAK_INFO = {
  label: STREAK_TITLE,
  body: '期間の中の決済の順で数えます（期間の前の取引は見ません）。',
  id: 'review-streak-info',
} as const;
export const STREAK_LINK = '連勝の後の取引を見る';
const OVERCONFIDENT_NAME = EMOTION_TEXT.overconfident.name;

/** 連勝の後のカードの表示の形（対象が 0 件なら作らない） */
export interface StreakModel {
  /** 連勝の後の件数（0 なら値の行の代わりに noneText） */
  readonly count: number;
  /** 判定の出た取引が 5 件未満（値を出さない） */
  readonly few: boolean;
  readonly countText: string;
  /** few のとき「あと 3 件」 */
  readonly restText: string | null;
  readonly rateText: string | null;
  readonly fractionText: string | null;
  readonly cost: InsightRow['cost'];
  /** 心理の行と同じ形の要約（「5 件 · 60%（3 / 5）· 崩れで −1.5R」「2 件 · 件数が少ない」）。0 件なら null */
  readonly summary: string | null;
  /** 連勝の後が 0 件の文（1 件以上なら null） */
  readonly noneText: string | null;
  /** 「このうち 調子に乗った 2 件」（連勝の後が 0 件なら null） */
  readonly afterText: string | null;
  /** 「調子に乗った 4 件のうち 連勝の後 2 件」（調子に乗ったが 0 件なら null） */
  readonly tagText: string | null;
  /**
   * 重なりの 2 文を名前と値の組にしたもの（画面の形。afterText・tagText と同じ順・同じ数。値が 0 件の組は zero = 軽く
   * 見せる。Issue 185 のデザインレビュー 2）
   */
  readonly pairs: readonly {
    readonly label: string;
    readonly value: string;
    readonly zero: boolean;
  }[];
  /**
   * 比べる相手 = 連勝の後でない取引（#185 デザインレビュー 1）。率「ほかの取引 80%（8 / 10）」（判定の出た取引が 5 件未満なら
   * 「ほかの取引 あと 3 件で率を表示」。#194）と規律コスト「ほかの取引 崩れで −0.6R」（率が出ないときは null）。ほかの取引が 0 件なら null
   */
  readonly others: { readonly rate: string; readonly cost: string | null } | null;
}

/** 比べる相手の行の頭 */
export const STREAK_OTHERS = 'ほかの取引';

/** 判定の出た取引が judged 件のとき、計画どおり率が出るまでの残り（「あと 3 件」。率が出ないとき = judged が 5 未満のときだけ使う） */
export function restOf(judged: number): string {
  return `あと ${MIN_JUDGED_FOR_RATE - judged} 件`;
}

/** 行の文（心理の行・Good / More の行で共有。#221） */
export interface InsightRowText {
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
  /**
   * 規律コストの数（R。0 以下）。few・R の出る取引が無い行は null。「何で崩れたか」の順位図の並びと棒の長さに使う（#228）
   */
  readonly costR: number | null;
  /**
   * 順位図の行の 2 行目に添える R の出ない取引の件数（「R なし 1 件」。#228）。few・R の出ない取引が無い行は null。
   * 規律コストの言い方を「崩れで ±0.0R」にそろえる代わりに、測れていない取引があることをここで言う
   */
  readonly noRText: string | null;
  /** 行の全文（テスト・例の表の形。「平常心 5 件 · 100%（5 / 5）· 崩れなし ±0.0R」） */
  readonly text: string;
  /** 読み上げの全文（列の名前つき。見た目の部品は読み上げから外す） */
  readonly srText: string;
}

export interface InsightRow extends InsightRowText {
  readonly id: EmotionTagId;
}

/** Good / More の 1 行（#221。key = 話題の ID か自分で書いた行） */
export interface ReflectionInsightRow extends InsightRowText {
  readonly key: ReflectionRowKey;
}

/** Good / More の 1 枚のカード（#221） */
export interface ReflectionCardModel {
  readonly side: ReflectionSide;
  /** 「More の話題ごとの規律」 */
  readonly title: string;
  /** 「11 件のうち 5 件に記入」 */
  readonly headText: string;
  /** その側が付いた取引が無い期間の 1 行（行があれば null） */
  readonly noneText: string | null;
  readonly overlapText: string | null;
  /** すべての行（話題は件数の多い順 → 一覧の順、最後に自分で書いた行） */
  readonly rows: readonly ReflectionInsightRow[];
  /** 値を出す行 */
  readonly main: readonly ReflectionInsightRow[];
  /** 件数が少ない行 */
  readonly few: readonly ReflectionInsightRow[];
}

/** 気づきの Good / More（#221）。両側とも付いた取引が無ければ cards は空で noneLines だけ */
export interface ReflectionInsight {
  /** 両側とも付いた取引が無い期間の文（段落ごと。カードがあれば null） */
  readonly noneLines: readonly string[] | null;
  /** More → Good */
  readonly cards: readonly ReflectionCardModel[];
}

/** 崩れ方の 1 行（#239。kind = 崩れの理由の種類） */
export interface ReasonInsightRow extends InsightRowText {
  readonly kind: BreachKind;
}

/** 崩れ方の切り口（#239・C68） */
export interface ReasonInsight {
  /** 「11 件のうち崩れ 7 件」 */
  readonly headText: string;
  /** 崩れの取引が無い期間の 1 行（行があれば null） */
  readonly noneText: string | null;
  readonly overlapText: string | null;
  /** すべての行（件数の多い順 → 5.3 の表の順） */
  readonly rows: readonly ReasonInsightRow[];
  /** 値を出す行（判定の出た取引 = 行の件数が 5 件以上） */
  readonly main: readonly ReasonInsightRow[];
  /** 件数が少ない行 */
  readonly few: readonly ReasonInsightRow[];
}

export const REASON_NONE = 'この期間に崩れの取引はありません';
/** 2 つ以上の崩れ方がある取引がある期間だけ（訳は「i」の中。C70・#254） */
export const REASON_OVERLAP_NOTE = '行の件数と失った R の和は合計より大きくなります';
export const REASON_OVERLAP_INFO = {
  label: '行の和',
  body: '2 つ以上の崩れ方がある取引は、当てはまる行のそれぞれに数えます。',
  id: 'review-reason-overlap-info',
} as const;

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
  /** 連勝の後のカード（#185。対象が 0 件なら null。省いた組み立てはカードを出さない） */
  readonly streak?: StreakModel | null;
  /** Good / More のカード（#221。対象が 0 件なら null。省いた組み立てはカードを出さない） */
  readonly reflection?: ReflectionInsight | null;
  /** 次はこうする（#228。More の自分で書いた行の最新 1 行。対象が 0 件なら null。省いた組み立ては段を出さない） */
  readonly next?: NextModel | null;
  /** 崩れ方（#239。対象が 0 件なら null。省いた組み立ては切り口の中身を出さない） */
  readonly reason?: ReasonInsight | null;
}

/** 「次はこうする」の段（#228。設計書 9.2・C60） */
export interface NextModel {
  /** More の自分で書いた行のある取引のうち決済のいちばん新しい取引の最初の行（無ければ null = 案内の 1 行） */
  readonly text: string | null;
  /** その取引の決済の日（「11/19 の取引」） */
  readonly dateText: string | null;
  /** More の自分で書いた行のある取引の件数（押せる行の添え） */
  readonly count: number;
}

export const NEXT_TITLE = '次はこうする';
export const NEXT_NONE = '取引の詳細の「Good / More」で More を書くと、ここに表示されます。';
export const NEXT_LINK = 'More の自分で書いた行を見る';

/** 決済の新しい順（一覧の並び = 決済の新しい順 → 作った新しい順 → ID の昇順）で a が先か */
function newerFirst(a: ReviewItem, b: ReviewItem): number {
  return (
    b.exitTime - a.exitTime || b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * 次はこうする（#228）: 対象（取り込みは切り替えに従う）のうち More の自分で書いた行のある取引の、決済のいちばん新しい取引の
 * 最初の行と決済の日。now は日付の年を出すかの基準（formatDay。無ければその取引の年 = 年を出さない）
 */
export function nextOf(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean; readonly now?: number | undefined },
): NextModel {
  const written = (opts.includeImports ? [...items] : items.filter((i) => !i.imported))
    .filter((i) => (i.reflection?.more.notes.length ?? 0) > 0)
    .sort(newerFirst);
  const first = written[0];
  const text = first?.reflection?.more.notes[0];
  if (first === undefined || text === undefined) return { text: null, dateText: null, count: 0 };
  return {
    text,
    dateText: `${formatDay(first.exitTime, opts.now ?? first.exitTime)} の取引`,
    count: written.length,
  };
}

/**
 * 順位図の行の規律コストの見た目の文（#228）: 1 枚目の見出しと同じ「崩れで −1.8R」の形にそろえる。崩れの R が 0 の行は、
 * R の出ない取引があっても「崩れで ±0.0R」（それは行の noRText で言う）、無ければ「崩れなし ±0.0R」。R の出る取引が無い行は
 * 「R が出る取引がありません」のまま。読み上げ（srText）は前の全文のまま
 */
export function rankCostOf(
  r: Pick<InsightRowText, 'cost'>,
): { lead: string; value: string } | null {
  if (!r.cost) return null;
  return {
    lead: r.cost.kind === 'measured' ? HEADLINE_LEAD.gap : r.cost.lead,
    value: r.cost.value,
  };
}

/** 順位図の 1 行（#228）: 行と棒の長さ（0〜1。表示中の行のうち規律コストの絶対値の最大に対する割合） */
export interface RankRow<R extends InsightRowText> {
  readonly row: R;
  readonly ratio: number;
}

/**
 * 「何で崩れたか」の順位図（#228。設計書 9.4・C60）: 値の出る行を 基準（平常心）→ 規律コストの小さい順（多く失った順）→ 同じ値は
 * 今の順（件数の多い順 → 一覧の順）に並べ、棒の長さを規律コストの絶対値 ÷ 最大の絶対値にする（最大が 0 なら全部 0）。
 * 規律コストの無い行（R の出る取引が無い・件数が少ない基準）は棒 0 で値の行の最後（基準は先頭のまま）。値は変えない
 */
export function rankRows<R extends InsightRowText>(main: readonly R[]): RankRow<R>[] {
  const max = main.reduce((m, r) => (r.costR === null ? m : Math.max(m, Math.abs(r.costR))), 0);
  const order = (r: R) =>
    r.base ? Number.NEGATIVE_INFINITY : (r.costR ?? Number.POSITIVE_INFINITY);
  // sort は安定（同じ値は今の順のまま）
  return [...main]
    .sort((a, b) => {
      const x = order(a);
      const y = order(b);
      return x === y ? 0 : x < y ? -1 : 1;
    })
    .map((row) => ({
      row,
      ratio: max > 0 && row.costR !== null ? Math.min(1, Math.abs(row.costR) / max) : 0,
    }));
}

/** 規律コストの言い方（review-view.ts の見出しと同じ規則） */
function costOf(v: PeriodReview): InsightRow['cost'] {
  if (v.curve.length === 0) return { kind: 'noCurve', lead: NO_CURVE, value: '' };
  const kind = v.cost < 0 ? 'gap' : v.noR > 0 ? 'measured' : 'none';
  return { kind, lead: HEADLINE_LEAD[kind], value: formatR(v.cost) };
}

/** 行の値の要約（名前を除いた行の文。「5 件 · 0%（0 / 5）· 崩れで −1.8R」「1 件 · 件数が少ない」。期間の取引の画面と共有。#185） */
export function summaryOf(v: PeriodReview): string {
  const countText = `${v.total} 件`;
  if (v.rate === null) return `${countText} · ${FEW}`;
  const cost = costOf(v);
  const costText = cost ? [cost.lead, cost.value].filter(Boolean).join(' ') : '';
  return `${countText} · ${formatRate(v.rate)}（${v.planned} / ${v.judged}）· ${costText}`;
}

/** 崩れ方の絞り方の要約（#239。崩れ方の行と同じ: 率を出さない。「5 件 · 崩れで −3.8R」「1 件 · 件数が少ない」） */
export function reasonSummaryOf(v: PeriodReview): string {
  const countText = `${v.total} 件`;
  return v.rate === null ? `${countText} · ${FEW}` : `${countText} · ${costTextOf(v)}`;
}

/** 崩れ方の絞り方の名前つきの要約（#239）: ["5 件", "規律コスト 崩れで −3.8R"] / ["1 件", "規律コスト あと 4 件で表示"] */
export function reasonLabeledSummaryOf(v: PeriodReview): string[] {
  const countText = `${v.total} 件`;
  return v.rate === null
    ? [countText, `${COLUMN.cost} ${restOf(v.judged)}で表示`]
    : [countText, `${COLUMN.cost} ${costTextOf(v)}`];
}

/** 規律コストの文（「崩れで −1.8R」「崩れなし ±0.0R」「R で測れる崩れ ±0.0R」「R が出る取引がありません」） */
function costTextOf(v: PeriodReview): string {
  const cost = costOf(v);
  return cost ? [cost.lead, cost.value].filter(Boolean).join(' ') : '';
}

/**
 * 名前つきの要約の組（期間の取引の画面の見せ方。気づきの表を離れても何の数か分かるように。Issue 185 のデザインレビュー 4）。
 * ["5 件", "計画どおり率 0%（0 / 5）", "規律コスト 崩れで −1.8R"] / ["1 件", "計画どおり率 あと 4 件で表示"]
 * （判定の出た取引が 5 件未満は、何が出ないかとあと何件で出るかを言う。「件数が少ない」だけでは何に対して少ないか分からない。#194）
 */
export function labeledSummaryOf(v: PeriodReview): string[] {
  const countText = `${v.total} 件`;
  if (v.rate === null) return [countText, `${COLUMN.rate} ${restOf(v.judged)}で表示`];
  const cost = costOf(v);
  const costText = cost ? [cost.lead, cost.value].filter(Boolean).join(' ') : '';
  return [
    countText,
    `${COLUMN.rate} ${formatRate(v.rate)}（${v.planned} / ${v.judged}）`,
    `${COLUMN.cost} ${costText}`,
  ];
}

/** 連勝の後のカードの表示の形（#185） */
function streakOf(items: readonly ReviewItem[], includeImports: boolean): StreakModel {
  const s = reviewAfterWinStreak(items, { includeImports });
  const v = s.review;
  const over = s.overconfident;
  const tagLabel = `${OVERCONFIDENT_NAME} ${over.tagged} 件のうち ${STREAK_TITLE}`;
  const tagText = over.tagged > 0 ? `${tagLabel} ${over.after} 件` : null;
  const afterLabel = `このうち ${OVERCONFIDENT_NAME}`;
  const afterText = v.total > 0 ? `${afterLabel} ${over.after} 件` : null;
  const pairs = [
    ...(afterText
      ? [{ label: afterLabel, value: `${over.after} 件`, zero: over.after === 0 }]
      : []),
    ...(tagText ? [{ label: tagLabel, value: `${over.after} 件`, zero: over.after === 0 }] : []),
  ];
  const r = s.rest;
  const others =
    v.total === 0 || r.total === 0
      ? null
      : r.rate === null
        ? { rate: `${STREAK_OTHERS} ${restOf(r.judged)}で率を表示`, cost: null }
        : {
            rate: `${STREAK_OTHERS} ${formatRate(r.rate)}（${r.planned} / ${r.judged}）`,
            cost: (() => {
              const c = costOf(r);
              return c ? `${STREAK_OTHERS} ${[c.lead, c.value].filter(Boolean).join(' ')}` : null;
            })(),
          };
  const base = {
    count: v.total,
    countText: `${v.total} 件`,
    afterText,
    tagText,
    pairs,
    others,
  };
  if (v.total === 0) {
    return {
      ...base,
      few: true,
      restText: null,
      rateText: null,
      fractionText: null,
      cost: null,
      summary: null,
      noneText: STREAK_NONE,
    };
  }
  const summary = summaryOf(v);
  if (v.rate === null) {
    return {
      ...base,
      few: true,
      restText: restOf(v.judged),
      rateText: null,
      fractionText: null,
      cost: null,
      summary,
      noneText: null,
    };
  }
  return {
    ...base,
    few: false,
    restText: null,
    rateText: formatRate(v.rate),
    fractionText: `${v.planned} / ${v.judged}`,
    cost: costOf(v),
    summary,
    noneText: null,
  };
}

/** 行の文（名前・基準の印は呼ぶ側。心理の行と Good / More の行で同じ規則） */
function rowTextOf(name: string, v: PeriodReview, base: boolean): InsightRowText {
  const countText = `${v.total} 件`;
  const baseText = base ? `（${BASE_MARK}）` : '';
  if (v.rate === null) {
    const restText = restOf(v.judged);
    return {
      name,
      countText,
      few: true,
      base,
      restText,
      rateText: null,
      fractionText: null,
      cost: null,
      costR: null,
      noRText: null,
      text: `${name} ${summaryOf(v)}`,
      srText: `${name}${baseText} ${countText}、${FEW}（${restText}で表示）`,
    };
  }
  const rateText = formatRate(v.rate);
  const fractionText = `${v.planned} / ${v.judged}`;
  const cost = costOf(v);
  const costText = cost ? [cost.lead, cost.value].filter(Boolean).join(' ') : '';
  return {
    name,
    countText,
    few: false,
    base,
    restText: null,
    rateText,
    fractionText,
    cost,
    costR: v.curve.length === 0 ? null : v.cost,
    noRText: v.noR > 0 && v.curve.length > 0 ? `R なし ${v.noR} 件` : null,
    text: `${name} ${summaryOf(v)}`,
    srText: `${name}${baseText} ${countText}、${COLUMN.rate} ${rateText}（${fractionText}）、${COLUMN.cost} ${costText}`,
  };
}

/**
 * 崩れ方の行の文（#239）: 心理の行（rowTextOf）と同じ件数が少ない行の規則・規律コストの言い方で、計画どおり率と分数を出さない
 * （行の取引はすべて崩れで、率はいつも 0%）
 */
export function reasonRowTextOf(name: string, v: PeriodReview): InsightRowText {
  const row = rowTextOf(name, v, false);
  if (row.few) return row;
  const costText = costTextOf(v);
  return {
    ...row,
    rateText: null,
    fractionText: null,
    text: `${name} ${row.countText} · ${costText}`,
    srText: `${name} ${row.countText}、${COLUMN.cost} ${costText}`,
  };
}

function reasonOf(items: readonly ReviewItem[], includeImports: boolean): ReasonInsight {
  const v = reviewByReason(items, { includeImports });
  const rows = v.rows.map((r) => ({
    kind: r.kind,
    ...reasonRowTextOf(BREACH_NAME[r.kind], r.review),
  }));
  return {
    headText: `${v.total} 件のうち崩れ ${v.breached} 件`,
    noneText: rows.length === 0 ? REASON_NONE : null,
    overlapText: v.overlap ? REASON_OVERLAP_NOTE : null,
    rows,
    main: rows.filter((r) => !r.few),
    few: rows.filter((r) => r.few),
  };
}

function rowOf(id: EmotionTagId, v: PeriodReview): InsightRow {
  return { id, ...rowTextOf(EMOTION_TEXT[id].name, v, id === CALM) };
}

/** Good / More の自分で書いた行の名前（側ごとに 1 行にまとめる。#221） */
export const NOTES_ROW_NAME = '自分で書いた行';
/** Good / More のカードの列の見出し（心理のカードの「心理」にあたる） */
export const REFLECTION_COLUMN = '話題';
/** 期間の取引のどれにも Good / More が無い（両側とも。カードは 1 枚にまとめる。#221 の E5） */
export const REFLECTION_NONE_LINES = ['この期間の取引に Good / More は付いていません'] as const;
/** 2 つ以上の行（話題 + 自分で書いた行）に入る取引がある側だけ（訳は「i」の中。C70・#254） */
export const REFLECTION_OVERLAP_NOTE = OVERLAP_NOTE;
export const REFLECTION_OVERLAP_INFO = {
  label: '行の件数の和',
  body: '2 つ以上の行（話題・自分で書いた行）に入る取引は、それぞれの行に 1 件ずつ数えます。',
  id: 'review-reflection-overlap-info',
} as const;

/** Good / More のカードの題（「More の話題ごとの規律」） */
export function reflectionCardTitle(side: ReflectionSide): string {
  return `${REFLECTION_SIDE_TEXT[side].name} の話題ごとの規律`;
}

/** 片側だけ付いていない期間のその側のカードの 1 行（E6） */
export function reflectionNoneText(side: ReflectionSide): string {
  return `この期間の取引に ${REFLECTION_SIDE_TEXT[side].name} は付いていません`;
}

/** Good / More の行の名前（話題の名前・自分で書いた行） */
export function reflectionRowName(key: ReflectionRowKey): string {
  return key === REFLECTION_NOTES ? NOTES_ROW_NAME : REFLECTION_TOPIC_NAME[key];
}

/** 気づきのカードの並びの側（「同じ負け方を繰り返さない」の材料の More を先に） */
export const REFLECTION_CARD_SIDES: readonly ReflectionSide[] = ['more', 'good'];

function reflectionOf(items: readonly ReviewItem[], includeImports: boolean): ReflectionInsight {
  const cards = REFLECTION_CARD_SIDES.map((side): ReflectionCardModel => {
    const v = reviewByReflection(items, side, { includeImports });
    const rows = v.rows.map((r) => ({
      key: r.key,
      ...rowTextOf(reflectionRowName(r.key), r.review, false),
    }));
    return {
      side,
      title: reflectionCardTitle(side),
      headText: `${v.total} 件のうち ${v.written} 件に記入`,
      noneText: rows.length === 0 ? reflectionNoneText(side) : null,
      overlapText: v.overlap ? REFLECTION_OVERLAP_NOTE : null,
      rows,
      main: rows.filter((r) => !r.few),
      few: rows.filter((r) => r.few),
    };
  });
  return cards.every((c) => c.rows.length === 0)
    ? { noneLines: REFLECTION_NONE_LINES, cards: [] }
    : { noneLines: null, cards };
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

/**
 * 保存した取引 → 気づきの集計の 1 件（判定の崩れの理由の種類（#239）+ 心理のタグ + Good / More。#221）。Good / More は normalizeReflection を通し、両側とも空なら
 * 足さない（規律の集計の 1 件は変えない）
 */
export function insightItemOf(t: StoredTrade): ReviewItem {
  // 判定の崩れの理由の種類（#239）+ 心理のタグ（emotionItemOf と同じ）
  const emotions = normalizeEmotions(t.emotionTags);
  const breach = breachItemOf(t);
  const item = emotions.length > 0 ? { ...breach, emotions } : breach;
  if (t.reflection === undefined) return item;
  const reflection = normalizeReflection(t.reflection);
  return isEmptyReflection(reflection) ? item : { ...item, reflection };
}

/**
 * 期間の取引 → 気づきの対象の集計の 1 件（規律の reviewModel と同じ: 消した印を外し、range があれば範囲の外を落とす）。
 * 取り込みは呼ぶ側の切り替えで外す（core の reviewByEmotion・reviewAfterWinStreak）。期間の取引の画面と共有する（#185）
 */
export function insightItems(
  trades: readonly StoredTrade[],
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly range?: { readonly from: number; readonly to: number } | undefined;
  },
): ReviewItem[] {
  const range = opts.range;
  return visibleTrades(trades, opts.hidden)
    .filter((t) => range === undefined || inRange(t.record.exit.time, range))
    .map(insightItemOf);
}

/** 期間の取引（範囲つきの一覧の応答）→ 気づきの表示（規律の reviewModel と同じ対象）。range があれば範囲の外を落とす */
export function insightModel(
  trades: readonly StoredTrade[],
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly range?: { readonly from: number; readonly to: number };
    /** 次はこうするの日付の年を出すかの基準（無ければ年を出さない） */
    readonly now?: number;
  },
): InsightModel {
  const items = insightItems(trades, opts);
  const v = reviewByEmotion(items, { includeImports: opts.includeImports });
  if (v.total === 0) {
    return {
      empty: true,
      emptyText: v.excludedImports > 0 ? REVIEW_ONLY_IMPORTS : REVIEW_EMPTY,
      headText: null,
      overlapText: null,
      rows: [],
      main: [],
      few: [],
      streak: null,
      reflection: null,
      next: null,
      reason: null,
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
    streak: streakOf(items, opts.includeImports),
    reflection: reflectionOf(items, opts.includeImports),
    next: nextOf(items, { includeImports: opts.includeImports, now: opts.now }),
    reason: reasonOf(items, opts.includeImports),
  };
}

/** 画面の状態 → 気づきの表示（reviewModelFor と同じ: 読み終えた範囲が今の期間の範囲と同じときだけ。null = 読み込み中） */
export function insightModelFor(
  state: ReviewState,
  range: PeriodRange,
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly now?: number;
  },
): InsightModel | null {
  if (state.phase !== 'ready' || !range.ok) return null;
  if (state.range.from !== range.from || state.range.to !== range.to) return null;
  return insightModel(state.trades, { ...opts, range: state.range });
}
