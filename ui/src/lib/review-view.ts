// ホームの規律の振り返りの表示の形（Issue #88 契約 P-3。設計書 6.1・6.2・6.3・9.2・11 章・C44）。DOM・通信に触れない
// （「今」は引数で受け、日付の書き方だけに使う）。
// 判定・R は一覧と同じ summarize（= toTradeInput → evaluateTrade）で出し、core/review.ts の reviewPeriod で数える。
// 消した印（[元に戻す] を待つ取引）は visibleTrades で外し、範囲の外の取引（範囲の引数を知らない古い API が全件を返したとき）も
// 落とす。成績は R だけ（円を出さない。6.3）。R・% は無色（P3）
// 両建てのまとまり（#268・6.5・C80）は review-units.ts の単位で 1 件（まとまりの判定・R・決済の時刻）に数え、メンバーを別に数えない。
// 「数で見る」の行と曲線の日付はまとまりの決済の時刻、銘柄は最初の本玉の銘柄に「· 両建て」
import type { InstrumentRecord, StoredTrade } from '../../../core/record';
import {
  breachKindsOf,
  type CurvePoint,
  GRADE_KEYS,
  type GradeKey,
  MIN_JUDGED_FOR_RATE,
  type PeriodReview,
  type ReviewItem,
  reviewPeriod,
} from '../../../core/review';
import { badgeModel, type Tier, type TierSymbol } from './badge';
import { formatDay, formatR, formatRate } from './format';
import type { PeriodRange } from './period';
import { summarize } from './record-form';
import type { ReviewState } from './review-controller';
import {
  type GroupSource,
  type ReviewUnit,
  reviewUnits,
  unitExitTime,
  unitId,
  unitItem,
  unitTrade,
} from './review-units';
import { instrumentNameOf } from './trade-view';

export const REVIEW_TITLE = '規律の振り返り';
export const REVIEW_EMPTY = 'この期間に決済した取引はありません';
export const REVIEW_ONLY_IMPORTS =
  'この期間の取引は取り込んだものだけです。上の切り替えで含められます';
export const NO_CURVE = 'R が出る取引がありません';
/** 見出しが「崩れなし」と言うので、ここは線が 1 本に見える理由だけ（C70・#254） */
export const NO_GAP = '2 本の線は重なっています';
/** 見出しの 1 行目の前の言葉（崩れで失った R が主役。#88 デザインの再レビュー 1） */
export const HEADLINE_LEAD = {
  gap: '崩れで',
  none: '崩れなし',
  /** 差は 0 だが R の出ない取引（LC の無い C など）が曲線の外にある: 「崩れなし」と言い切らない */
  measured: 'R で測れる崩れ',
} as const;
export const TRUNCATED = '期間の取引が多いので先頭の 2,000 件で集計しています';
export const ROWS_CAPTION = '取引ごとの R と累積（決済の古い順）';
/** 両建てのまとまりの銘柄の後ろの添え（一覧の行と同じ。6.5） */
export const GROUP_SUFFIX = ' · 両建て';

/** 保存した取引 → 集計の 1 件（一覧と同じ判定の計算） */
export function reviewItemOf(t: StoredTrade): ReviewItem {
  return itemOf(t, summarize(t));
}

/**
 * 保存した取引 → 集計の 1 件 + 判定の崩れの理由の種類（振り返りの「何で崩れたか」の崩れ方。#239・C68）。規律の 1 件
 * reviewItemOf の値は変えない（理由で規律が変わらない）。崩れの理由が無ければ足さない
 */
export function breachItemOf(t: StoredTrade): ReviewItem {
  const s = summarize(t);
  const item = itemOf(t, s);
  const reasons = breachKindsOf(s.judgment?.reasons ?? []);
  return reasons.length > 0 ? { ...item, reasons } : item;
}

function itemOf(t: StoredTrade, s: ReturnType<typeof summarize>): ReviewItem {
  return {
    id: t.id,
    exitTime: t.record.exit.time,
    createdAt: t.createdAt,
    grade: s.judgment?.grade ?? null,
    ...(s.r === undefined ? {} : { r: s.r }),
    imported: t.record.source === 'import',
  };
}

export interface LegendItem {
  readonly key: GradeKey;
  /** 判定の名前（バッジと同じ） */
  readonly label: string;
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  readonly count: number;
}

/** 内訳の帯の 1 区切り（0〜1 の割合） */
export interface BarSegment {
  readonly key: GradeKey;
  readonly tier: Tier;
  readonly x: number;
  readonly width: number;
}

/** 「数で見る」の表の 1 行 */
export interface ReviewRow {
  readonly id: string;
  readonly dateText: string;
  readonly instrumentName: string;
  readonly gradeLabel: string;
  readonly rText: string;
  readonly actualCumText: string;
  readonly plannedCumText: string;
  /** この取引までの差（実際の累積 − 計画どおりの累積。0 以下） */
  readonly gapText: string;
}

export interface ReviewModel {
  readonly review: PeriodReview;
  /** 集計の対象が 0 件（数字・内訳・曲線を出さない） */
  readonly empty: boolean;
  /** 0 件のときの文（取り込みだけの期間は書き分ける） */
  readonly emptyText: string;
  /** 「7 件」 */
  readonly countText: string;
  /** 「57%」。判定の出た取引が 5 件未満なら null */
  readonly rateText: string | null;
  /** 「4 / 7 件」・率が出ないときは「あと 2 件で表示されます（判定の出た取引 3 件）」 */
  readonly rateCountText: string;
  /** 規律コスト「−0.6R」 */
  readonly costText: string;
  /** 守っていればの R「+0.9R」と実際の R「+0.3R」 */
  readonly plannedText: string;
  readonly actualText: string;
  readonly legend: readonly LegendItem[];
  readonly bar: readonly BarSegment[];
  /** 期間に取り込んだ取引があるときだけ（切り替えを出す） */
  readonly imports: {
    readonly count: number;
    readonly include: boolean;
    /** 切り替えの横の今の状態「取り込んだ取引 2 件は集計に含めていません」/「… 2 件を含めています」 */
    readonly stateText: string;
  } | null;
  /** 「取り込んだ取引 2 件は集計に含めていません」（含めていないときだけ） */
  readonly importsNote: string | null;
  /** 件数の上限で先頭の分だけ集計した（C44） */
  readonly truncatedText: string | null;
  /** 「危ない勝ち 1 件 +0.5R は運です」 */
  readonly luckText: string | null;
  /** 「LC が無い 1 件は曲線に入れていません」（計算できない取引は「計算できない n 件」） */
  readonly noRText: string | null;
  /**
   * 見出しの 1 行目（「崩れで −0.6R」「崩れなし ±0.0R」「R で測れる崩れ ±0.0R」）の状態。曲線が無ければ null。
   * gap = 差あり（△・崩れの段）、none = 差も R の出ない取引も無い（○・計画どおりの段）、measured = 差は 0 だが曲線の外に取引がある
   */
  readonly headline: {
    readonly kind: keyof typeof HEADLINE_LEAD;
    readonly lead: string;
    readonly value: string;
  } | null;
  /** 2 行目「守っていれば +0.9R · 実際 +0.3R」 */
  readonly subline: string;
  /** 計画どおり率の数の場所に出す文（率が出ないとき「件数が少ない」） */
  readonly rateMissingText: string | null;
  /** 差が 0 の期間（曲線の 2 本が重なる）の 1 行 */
  readonly noGapText: string | null;
  readonly curve: readonly CurvePoint[];
  /** 曲線の最初と最後の決済の日付（「11/13」。同じ日なら last は null。曲線が無ければ null） */
  readonly curveDates: { readonly first: string; readonly last: string | null } | null;
  readonly rows: readonly ReviewRow[];
}

/** 計画どおり率の数（%）と件数の文 */
function rateTexts(v: PeriodReview): {
  rateText: string | null;
  rateCountText: string;
  rateMissingText: string | null;
} {
  if (v.rate === null) {
    const rest = MIN_JUDGED_FOR_RATE - v.judged;
    return {
      rateText: null,
      rateMissingText: '件数が少ない',
      rateCountText: `あと ${rest} 件で表示されます（判定の出た取引 ${v.judged} 件）`,
    };
  }
  return {
    rateText: formatRate(v.rate),
    rateMissingText: null,
    rateCountText: `${v.planned} / ${v.judged} 件`,
  };
}

/** 曲線に入れていない取引の文（直近の判定の脚注と同じ言い方: LC が無い / 計算できない） */
function outsideText(noLc: number, invalid: number): string | null {
  if (noLc + invalid === 0) return null;
  const parts = [
    ...(noLc > 0 ? [`LC が無い ${noLc} 件`] : []),
    ...(invalid > 0 ? [`計算できない ${invalid} 件`] : []),
  ];
  return `${parts.join('・')}は曲線に入れていません`;
}

function legendOf(v: PeriodReview): LegendItem[] {
  return GRADE_KEYS.filter((k) => v.counts[k] > 0).map((k) => {
    const b = badgeModel(k === 'none' ? null : k);
    return { key: k, label: b.label, tier: b.tier, symbol: b.symbol, count: v.counts[k] };
  });
}

function barOf(v: PeriodReview): BarSegment[] {
  const out: BarSegment[] = [];
  if (v.total === 0) return out;
  let x = 0;
  for (const k of GRADE_KEYS) {
    const n = v.counts[k];
    if (n === 0) continue;
    const width = n / v.total;
    out.push({ key: k, tier: badgeModel(k === 'none' ? null : k).tier, x, width });
    x += width;
  }
  return out;
}

function curveDatesOf(
  curve: readonly CurvePoint[],
  byId: ReadonlyMap<string, ReviewUnit>,
  now: number,
): ReviewModel['curveDates'] {
  const a = byId.get(curve[0]?.id ?? '');
  const b = byId.get(curve[curve.length - 1]?.id ?? '');
  if (!a || !b) return null;
  const first = formatDay(unitExitTime(a), now);
  const last = formatDay(unitExitTime(b), now);
  return { first, last: last === first ? null : last };
}

/** 差の 1 点（0 以下。丸めて 0 なら ±0.0R） */
function gapOf(p: CurvePoint): number {
  return Math.min(0, p.actualCum - p.plannedCum);
}

/** 単位の銘柄の名前（まとまりは最初の本玉の銘柄 +「· 両建て」） */
function unitInstrumentName(u: ReviewUnit, instruments: readonly InstrumentRecord[]): string {
  const name = instrumentNameOf(unitTrade(u), instruments);
  return u.kind === 'group' ? `${name}${GROUP_SUFFIX}` : name;
}

/**
 * 期間の取引（範囲つきの一覧の応答）→ 振り返りの表示。range があれば範囲の外を落とす。now は日付の書き方だけに使う。
 * groups・groupMembers（範囲の一覧の positionGroups・groupMembers）があれば、まとまりを 1 件に数える（#268）
 */
export function reviewModel(
  trades: readonly StoredTrade[],
  opts: GroupSource & {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly instruments: readonly InstrumentRecord[];
    readonly now: number;
    readonly range?: { readonly from: number; readonly to: number };
    readonly truncated?: boolean;
  },
): ReviewModel {
  const units = reviewUnits(trades, opts);
  const byId = new Map(units.map((u) => [unitId(u), u]));
  const items = units.map((u) => unitItem(u, reviewItemOf));
  const v = reviewPeriod(items, { includeImports: opts.includeImports });
  // 曲線の外（R が出ない）取引の内訳: LC が無い / 計算できない（直近の判定の脚注と同じ分け方。まとまりは本玉の LC で）
  let noLc = 0;
  let invalid = 0;
  units.forEach((u, i) => {
    const it = items[i];
    if (!it || it.r !== undefined || (it.imported && !opts.includeImports)) return;
    if (u.kind === 'group' ? u.group.noLc : u.trade.record.lc === undefined) noLc += 1;
    else invalid += 1;
  });
  const rows: ReviewRow[] = v.curve.map((p) => {
    const u = byId.get(p.id);
    return {
      id: p.id,
      dateText: u ? formatDay(unitExitTime(u), opts.now) : '',
      instrumentName: u ? unitInstrumentName(u, opts.instruments) : '',
      gradeLabel: badgeModel(p.grade).label,
      rText: formatR(p.r),
      actualCumText: formatR(p.actualCum),
      plannedCumText: formatR(p.plannedCum),
      gapText: formatR(gapOf(p)),
    };
  });
  const plannedText = formatR(v.plannedR);
  const actualText = formatR(v.actualR);
  const importsNote =
    v.excludedImports > 0 ? `取り込んだ取引 ${v.excludedImports} 件は集計に含めていません` : null;
  return {
    review: v,
    empty: v.total === 0,
    emptyText: v.total === 0 && v.excludedImports > 0 ? REVIEW_ONLY_IMPORTS : REVIEW_EMPTY,
    countText: `${v.total} 件`,
    ...rateTexts(v),
    costText: formatR(v.cost),
    plannedText,
    actualText,
    legend: legendOf(v),
    bar: barOf(v),
    imports:
      v.imports > 0
        ? {
            count: v.imports,
            include: opts.includeImports,
            stateText: importsNote ?? `取り込んだ取引 ${v.imports} 件を含めています`,
          }
        : null,
    importsNote,
    truncatedText: opts.truncated ? TRUNCATED : null,
    luckText:
      v.luck.count > 0 ? `危ない勝ち ${v.luck.count} 件 ${formatR(v.luck.r)} は運です` : null,
    noRText: outsideText(noLc, invalid),
    noGapText: v.curve.length > 0 && v.cost === 0 && v.noR === 0 ? NO_GAP : null,
    headline:
      v.curve.length === 0
        ? null
        : v.cost < 0
          ? { kind: 'gap', lead: HEADLINE_LEAD.gap, value: formatR(v.cost) }
          : v.noR > 0
            ? { kind: 'measured', lead: HEADLINE_LEAD.measured, value: formatR(v.cost) }
            : { kind: 'none', lead: HEADLINE_LEAD.none, value: formatR(v.cost) },
    subline: `守っていれば ${plannedText} · 実際 ${actualText}`,
    curve: v.curve,
    curveDates: curveDatesOf(v.curve, byId, opts.now),
    rows,
  };
}

/**
 * 画面の状態 → 振り返りの表示（読み終えた範囲が今の期間の範囲と同じときだけ。期間を変えた直後の 1 回の描画で、前の期間の
 * 件数を新しい範囲の行に出さない・読み上げない）。null = まだ出さない（読み込み中として扱う）
 */
export function reviewModelFor(
  state: ReviewState,
  range: PeriodRange,
  opts: {
    readonly hidden: ReadonlySet<string>;
    readonly includeImports: boolean;
    readonly instruments: readonly InstrumentRecord[];
    readonly now: number;
  },
): ReviewModel | null {
  if (state.phase !== 'ready' || !range.ok) return null;
  if (state.range.from !== range.from || state.range.to !== range.to) return null;
  return reviewModel(state.trades, {
    ...opts,
    range: state.range,
    truncated: state.truncated,
    groups: state.groups,
    groupMembers: state.groupMembers,
  });
}
