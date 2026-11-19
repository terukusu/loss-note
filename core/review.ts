// 期間の規律の集計（Issue #88 契約 P-1。設計書 6.1・6.2・11 章・C44）。判定・R は記録・一覧と同じ計算（evaluateTrade）の
// 結果を受けるだけで、ここでは数えて足すだけ。時刻・DOM・通信に触れず、入力を変えない。
// - 対象 = 期間に決済した取引（絞るのは呼ぶ側）から、取り込んだ取引を既定で外したもの（includeImports で含める。11 章）
// - 計画どおり率 = （A + 計画どおりの勝ち）÷ 判定の出た取引。判定の出た取引が 5 件未満なら率を出さない（6.1）
// - 計画どおりだったらの R（6.2 の明確化）: B・C の負けで R が −1.0R より小さい取引だけ −1.0R に置き換え、ほかは実際の R。
//   規律コスト = Σ（実際の R − 計画どおりの R）（0 以下）。R が出ない取引は曲線と規律コストに入れず件数だけ数える
// - 危ない勝ち（運）は両方の曲線にそのまま入れ、件数と R の合計を別に出す
// - 曲線の並びは決済の古い順 → 作った古い順 → ID の降順（一覧の並び = API の trade_sort_key のちょうど逆）
// 累積は途中で丸めない（丸めは表示だけ）
import type { Grade } from './judge';
import { TOL } from './numeric';

/** 集計の 1 件（画面が保存した取引から作る。grade = 判定。null = 判定なし（計算できない取引）） */
export interface ReviewItem {
  readonly id: string;
  readonly exitTime: number;
  readonly createdAt: number;
  readonly grade: Grade | null;
  /** R（出ないときは無し） */
  readonly r?: number;
  /** 取り込んだ取引（record.source === 'import'） */
  readonly imported: boolean;
}

/** 判定の内訳の鍵（判定 + 判定なし） */
export type GradeKey = Grade | 'none';
export const GRADE_KEYS: readonly GradeKey[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', 'none'];

/** 計画どおり率を出す最小の件数（判定の出た取引。6.1） */
export const MIN_JUDGED_FOR_RATE = 5;

/** 曲線の 1 点（R の出た取引 1 件） */
export interface CurvePoint {
  readonly id: string;
  readonly grade: Grade | null;
  readonly r: number;
  readonly plannedR: number;
  /** この取引までの実際の R の累積 */
  readonly actualCum: number;
  /** この取引までの計画どおりの R の累積 */
  readonly plannedCum: number;
}

export interface PeriodReview {
  /** 集計の対象の件数（取り込みを外した後） */
  readonly total: number;
  /** 期間の取り込んだ取引の件数（含めるかによらない。切り替えを出すか） */
  readonly imports: number;
  /** 外した取り込みの件数（含めるなら 0） */
  readonly excludedImports: number;
  readonly counts: Readonly<Record<GradeKey, number>>;
  /** 判定の出た取引（判定なしを除く） */
  readonly judged: number;
  /** A + 計画どおりの勝ち */
  readonly planned: number;
  /** 計画どおり率（0〜1）。判定の出た取引が 5 件未満なら null */
  readonly rate: number | null;
  readonly curve: readonly CurvePoint[];
  /** 実際の R の合計（曲線の最後の実際の累積。点が無ければ 0） */
  readonly actualR: number;
  /** 計画どおりの R の合計 */
  readonly plannedR: number;
  /** 規律コスト = Σ（実際 − 計画どおり）。0 以下 */
  readonly cost: number;
  /** 運: R の出た危ない勝ちの件数と R の合計 */
  readonly luck: { readonly count: number; readonly r: number };
  /** R が出ない取引の件数（曲線・規律コストに入れていない） */
  readonly noR: number;
}

/** 計画どおりだったらの R（B・C の負けで −1.0R より小さいときだけ −1.0R） */
export function plannedROf(grade: Grade | null, r: number): number {
  if ((grade === 'B' || grade === 'C') && r < -1 - TOL) return -1;
  return r;
}

/** 決済の古い順 → 作った古い順 → ID の降順（一覧の並びの逆） */
function oldestFirst(a: ReviewItem, b: ReviewItem): number {
  return (
    a.exitTime - b.exitTime || a.createdAt - b.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

export function reviewPeriod(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean },
): PeriodReview {
  const imports = items.filter((i) => i.imported).length;
  const target = opts.includeImports ? [...items] : items.filter((i) => !i.imported);
  const counts: Record<GradeKey, number> = { A: 0, safeWin: 0, B: 0, riskyWin: 0, C: 0, none: 0 };
  for (const i of target) counts[i.grade ?? 'none'] += 1;
  const judged = target.length - counts.none;
  const planned = counts.A + counts.safeWin;
  const rate = judged >= MIN_JUDGED_FOR_RATE ? planned / judged : null;

  const curve: CurvePoint[] = [];
  let actualCum = 0;
  let plannedCum = 0;
  let luckCount = 0;
  let luckR = 0;
  let noR = 0;
  // 規律コストは 1 件ずつの差（どれも 0 以下）の和で足す（2 つの累積の引き算の誤差で正にしない）
  let cost = 0;
  for (const i of target.sort(oldestFirst)) {
    const r = i.r;
    if (r === undefined || !Number.isFinite(r)) {
      noR += 1;
      continue;
    }
    const p = plannedROf(i.grade, r);
    actualCum += r;
    plannedCum += p;
    cost += r - p;
    curve.push({ id: i.id, grade: i.grade, r, plannedR: p, actualCum, plannedCum });
    if (i.grade === 'riskyWin') {
      luckCount += 1;
      luckR += r;
    }
  }
  return {
    total: target.length,
    imports,
    excludedImports: opts.includeImports ? 0 : imports,
    counts,
    judged,
    planned,
    rate,
    curve,
    actualR: actualCum,
    plannedR: plannedCum,
    cost,
    luck: { count: luckCount, r: luckR },
    noR,
  };
}

/** 直近の並びの種類（Issue #35）: 計画どおり = A・計画どおりの勝ち / 崩れ = B・危ない勝ち・C / 判定なし */
export type RunKind = 'plan' | 'off' | 'none';

export function runKindOf(grade: Grade | null): RunKind {
  if (grade === null) return 'none';
  return grade === 'A' || grade === 'safeWin' ? 'plan' : 'off';
}

/** 直近の連続: 最新の取引の種類と、新しい方から同じ種類が続く件数（1 以上） */
export interface RecentRun {
  readonly kind: RunKind;
  readonly count: number;
}

/**
 * 新しい順の判定の並び → 最新の種類と連続の件数（Issue #35）。空なら null。並びの外（もっと古い取引）は見ない
 * （件数は並びの長さが上限）
 */
export function recentRun(newestFirst: readonly (Grade | null)[]): RecentRun | null {
  const first = newestFirst[0];
  if (first === undefined) return null;
  const kind = runKindOf(first);
  let count = 0;
  for (const g of newestFirst) {
    if (runKindOf(g) !== kind) break;
    count += 1;
  }
  return { kind, count };
}
