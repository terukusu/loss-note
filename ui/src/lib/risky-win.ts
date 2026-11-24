// 危ない勝ちの数字の扱い（#227。設計書 5.4・C59、ui-guidelines 9.9）。DOM なし。
// 危ない勝ちは、どの画面でも R を主役の数字の段に出さない（大きい数字 = 計画どおりに出た数）。主役は崩れの文と、
// LC の線を崩した勝ちだけ「LC で切っていれば −1.0R」の 1 行。記録する・編集の下の帯・判定の枠・一覧の行・ホームの行・
// 保存の後のシートがこの 1 か所の規則で見せ方を決める（画面ごとに扱いを変えない）
import {
  type Grade,
  type Judgment,
  REASON_ORDER,
  REASON_WEIGHT,
  type Reason,
  type ReasonKind,
} from '../../../core/judge';
import type { Side } from '../../../core/trade';
import { formatR } from './format';
import { reasonText } from './reasons';

/** 反実の 1 行（6.2 の「計画どおりだったら」と同じ −1.0R。条件の形で言い切らない。C59） */
export const COUNTERFACTUAL = `LC で切っていれば ${formatR(-1)}`;

/** 反実の 1 行を出す理由（LC の線を崩した理由だけ。ほかは LC で切っても計画の崩れが消えない） */
const LC_LINE_BROKEN: ReadonlySet<ReasonKind> = new Set(['lcWidened', 'lcCancelled', 'heldPastLc']);

/** R を静かな形（主役の段に出さない）で出すか: 判定が危ない勝ちのときだけ */
export function quietR(grade: Grade | null | undefined): boolean {
  return grade === 'riskyWin';
}

export interface BreachView {
  /** 崩れの文（5.3 の表の順で最初の B・C の理由の文） */
  readonly breach: string;
  /** 反実の 1 行（LC の線を崩し、R が出るときだけ） */
  readonly counterfactual: string | null;
}

/**
 * 危ない勝ちの主役の文。危ない勝ちでなければ null。side は理由の文言へ渡すだけ（どの理由も向きで言葉を変えない。#56）
 */
export function breachView(
  judgment: Judgment | undefined,
  r: number | undefined,
  side: Side = 'L',
): BreachView | null {
  const first = breachReason(judgment);
  if (judgment === undefined || first === null) return null;
  const lcLine = judgment.reasons.some((x) => LC_LINE_BROKEN.has(x.kind));
  return {
    breach: reasonText(first, side),
    counterfactual: lcLine && r !== undefined && Number.isFinite(r) ? COUNTERFACTUAL : null,
  };
}

/**
 * 崩れの文にした理由（危ない勝ちのときだけ。5.3 の表の順で最初の B・C の理由）。判定の枠は同じ文を理由の一覧に重ねない
 * （C の「LC を決めずに入った」と添え書きの扱いと同じ）
 */
export function breachReason(judgment: Judgment | undefined): Reason | null {
  if (judgment?.grade !== 'riskyWin') return null;
  const broken = judgment.reasons
    .filter((x) => REASON_WEIGHT[x.kind] !== 'note')
    .sort((a, b) => REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind));
  return broken[0] ?? null;
}

/** 下の帯の文（反実の 1 行、無ければ崩れの文） */
export function cautionText(v: BreachView): string {
  return v.counterfactual ?? v.breach;
}
