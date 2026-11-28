// ホームの表示の形（#128。設計書 0.4 の K18・9.2 のホーム・ui-guidelines 9.4）。DOM・通信に触れない（「今」は引数で受ける）。
// ホームはスクロールしない 1 画面: 小さな見出し（印 + 「損失ノート」+ 今日の日付）→ 直近の流れ（主役）→ 今月の規律（計画どおり率と
// 規律コストの 2 つの数字と小さな曲線。期間は今月に固定・取り込みを外す）→ 直近の取引 3 件の詰めた行。
// 数は振り返りのタブと同じ表示の形（review-view.ts の reviewModel = core/review.ts の集計）から取り、ここでは並べ方だけを決める。
// 成績は R と % だけ（円を出さない。P2・P3）
import { type CurvePoint, MIN_JUDGED_FOR_RATE } from '../../../core/review';
import type { Tier, TierSymbol } from './badge';
import { splitNumUnit } from './num-tier';
import type { PeriodRange, PeriodSelection } from './period';
import { reviewHref } from './period';
import type { ReviewState } from './review-controller';
import { NO_CURVE, type ReviewModel } from './review-view';
import { quietR } from './risky-win';
import type { TradeRow } from './trade-view';

/** ホームに並べる直近の取引の件数（入らない高さでは 3 件目から CSS で隠す。9.4） */
export const HOME_RECENT = 3;
export const MONTH_TITLE = '今月の規律';
export const MONTH_EMPTY = '今月の取引はまだありません';
export const MONTH_ONLY_IMPORTS = '今月の取引は取り込んだものだけです';
export const DRAFT_ROW = '記録の書きかけがあります';
export const RECENT_TITLE = '直近の取引';

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 見出しの今日の日付「11月19日（木）」（端末の時間帯の暦日） */
export function homeDate(now: number): string {
  const d = new Date(now);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY[d.getDay()]}）`;
}

/** 今月の規律の数字（数と単位を分ける。単位は数の外の別の塊。数字の段 title。#236・C62） */
export interface BigNumber {
  readonly value: string;
  readonly unit: string;
}

/** 「57%」→ 57 と %、「−0.6R」→ −0.6 と R（分け方は数字の段の 1 か所 = num-tier.ts の splitNumUnit） */
export function splitUnit(text: string): BigNumber {
  return splitNumUnit(text);
}

export interface MonthCard {
  readonly title: string;
  /** 「11/1〜11/19 · 7 件」（0 件なら範囲だけ） */
  readonly meta: string;
  /** meta の範囲（「11/1〜11/19」）と件数（「7 件」。0 件なら null）。狭いカードでは範囲を外す（今月と分かるため） */
  readonly range: string;
  readonly count: string | null;
  /** 押すと振り返りのタブを今月で（`/review?period=custom&from=<1 日>&to=<今日>`） */
  readonly href: string;
  /** 今月の取引が無い（取り込みだけを含む）ときの文。あれば数を出さない */
  readonly empty: string | null;
  /** 計画どおり率（判定の出た取引が 5 件未満なら null） */
  readonly rate: BigNumber | null;
  /** 率の下の 1 行（「4 / 7 件」・率が出ないときは「あと 2 件で表示」） */
  readonly rateSub: string;
  /** 規律コスト（R が出る取引が無ければ null） */
  readonly cost: BigNumber | null;
  /** 規律コストの下の 1 行（「守っていれば +0.9R · 実際 +0.3R」・曲線が無ければ「R が出る取引がありません」） */
  readonly costSub: string;
  /**
   * costSub を語の塊に分けたもの（「守っていれば +0.9R」「実際 +0.3R」。#128 デザイン a3）。画面は塊ごとに 1 行にして、
   * 語の途中で折らない
   */
  readonly costLines: readonly string[];
  /**
   * 差は 0 だが R の出ない取引（LC の無い C など）が曲線の外にある（振り返りの見出しの「R で測れる崩れ」と同じ。#128 コードの N6）。
   * ホームは数の前に × の記号を出し、「崩れなし」に見せない
   */
  readonly costMeasured: boolean;
  /** 小さな曲線の点（無ければ空） */
  readonly curve: readonly CurvePoint[];
}

/** 振り返りの表示の形（今月の範囲・取り込みを外す）→ ホームの今月の規律のカード */
export function monthCard(model: ReviewModel, range: PeriodRange, sel: PeriodSelection): MonthCard {
  const v = model.review;
  const label = range.ok ? range.label : '';
  const base = { title: MONTH_TITLE, href: reviewHref(sel) };
  if (model.empty) {
    return {
      ...base,
      meta: label,
      range: label,
      count: null,
      empty: v.excludedImports > 0 ? MONTH_ONLY_IMPORTS : MONTH_EMPTY,
      rate: null,
      rateSub: '',
      cost: null,
      costSub: '',
      costLines: [],
      costMeasured: false,
      curve: [],
    };
  }
  const curve = model.curve;
  return {
    ...base,
    meta: `${label} · ${model.countText}`,
    range: label,
    count: model.countText,
    empty: null,
    rate: model.rateText === null ? null : splitUnit(model.rateText),
    rateSub:
      model.rateText === null
        ? `あと ${Math.max(0, MIN_JUDGED_FOR_RATE - v.judged)} 件で表示`
        : model.rateCountText,
    cost: curve.length === 0 ? null : splitUnit(model.costText),
    costSub: curve.length === 0 ? NO_CURVE : model.subline,
    costLines:
      curve.length === 0
        ? [NO_CURVE]
        : [`守っていれば ${model.plannedText}`, `実際 ${model.actualText}`],
    costMeasured: model.headline?.kind === 'measured',
    curve,
  };
}

/** 今月の規律の段（hook の層が作る。card は読み終えて今の範囲と同じときだけ） */
export interface MonthSlot {
  readonly state: ReviewState;
  readonly card: MonthCard | null;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/**
 * 詰めた 1 行の行の形（左の記号の札・2 行目の「判定の名前 · 月 / 日 [· 口座]」・右の R と「リスク 0.5%」）。#128 デザイン a4:
 * 日付は月 / 日（今年でない日だけ年つき。直近の 3 件に年は要らない）、% は何の % かを「リスク」と書き、R が出ない行は「—」を
 * 1 つだけ（リスクの段を出さない）、リスクだけが出ない行は 2 段目を出さない。
 * 2 行目は判定の名前と日付を切らず、口座の名前（利用者が付けた名前）だけを末尾で省略する（ui-guidelines 10.3。#176）ので、
 * 口座を最後に置く。画面は gradeLabel・date・accountName を別の要素にする（sub はそれをつないだ文字）
 */
export interface CompactRow {
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  readonly gradeLabel: string;
  /** 決済の日付（「11/19」、今年でなければ「2025/11/19」） */
  readonly date: string;
  /** 口座の名前（口座が 2 つ以上のときだけ。無ければ null） */
  readonly accountName: string | null;
  /** 2 行目の文字（「判定の名前 · 日付 [· 口座]」） */
  readonly sub: string;
  /** R（出ないときは「—」） */
  readonly rText: string;
  readonly rMissing: boolean;
  /** R を静かな形で出す（危ない勝ちの出る R。主役の段に出さない。#227・C59）。ほかの行には無い */
  readonly rQuiet?: true;
  /** 「リスク 0.5%」（R が出ない・リスクが出ないときは null） */
  readonly riskText: string | null;
  /** R・リスクの段を出さない（両建てのまとまりの最初の本玉でないメンバー。#267・6.5） */
  readonly noNums?: true;
}

/** 決済の日付（dateIso = 端末の時間帯の YYYY-MM-DD）→「11/19」（今年でなければ「2025/11/19」） */
function shortDate(dateIso: string, now: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const md = `${m}/${d}`;
  return y === new Date(now).getFullYear() ? md : `${y}/${md}`;
}

export function compactRowModel(row: TradeRow, now: number): CompactRow {
  const rMissing = row.rNote !== null && row.noNums !== true;
  const date = shortDate(row.dateIso, now);
  const accountName = row.accountName ?? null;
  return {
    tier: row.badge.tier,
    symbol: row.badge.symbol,
    gradeLabel: row.badge.label,
    date,
    accountName,
    sub: [row.badge.label, date, ...(accountName === null ? [] : [accountName])].join(' · '),
    rText: row.rText,
    rMissing,
    ...(!rMissing && quietR(row.grade) ? { rQuiet: true as const } : {}),
    riskText: rMissing || row.riskNote !== null || row.noNums ? null : `リスク ${row.riskText}`,
    ...(row.noNums ? { noNums: true as const } : {}),
  };
}
