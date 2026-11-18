// 許容リスクからの数量の提案（設計書 5.2）と、記録の後の数量の比・提案の数量（#67。判定は変えない・保存しない）
import { floorToStep } from './numeric';
import { oneRYen } from './pnl';
import type { Side, TradeInput } from './trade';

export interface SizingParams {
  readonly side: Side;
  readonly entryPrice: number;
  readonly lc?: number;
  readonly capitalYen?: number;
  /** % */
  readonly riskTolerancePct: number;
  readonly multiplier: number;
  /** 計画時の為替（価格の通貨 1 単位 = 口座の通貨。価格の通貨 = 口座の通貨なら 1。C43） */
  readonly fx: number;
  readonly quantityStep: number;
}

/**
 * 資金 × 許容リスク ÷ (|イン − LC| × 乗数 × 為替) を数量の刻みに切り捨てる。
 * 刻みに満たなければ 0。資金・LC が無い、LC の向きが逆、有限でない・0 以下の値があれば無し
 */
export function suggestQuantity(p: SizingParams): number | undefined {
  const { side, entryPrice, lc, capitalYen, riskTolerancePct, multiplier, fx, quantityStep } = p;
  if (lc === undefined || capitalYen === undefined) return undefined;
  const values = [entryPrice, lc, capitalYen, riskTolerancePct, multiplier, fx, quantityStep];
  if (!values.every(Number.isFinite)) return undefined;
  if (!(capitalYen > 0 && riskTolerancePct > 0 && multiplier > 0 && fx > 0 && quantityStep > 0)) {
    return undefined;
  }
  const directionOk = side === 'L' ? lc < entryPrice : lc > entryPrice;
  if (!directionOk) return undefined;
  const unitRisk = Math.abs(entryPrice - lc) * multiplier * fx;
  return floorToStep((capitalYen * riskTolerancePct) / 100 / unitRisk, quantityStep);
}

/** 記録の後の数量の振り返り（#67）。金額（許容額）は口座の通貨（1R・資金と同じ通貨。#47 PR-2・C43） */
export interface SizingReview {
  /** 1R ÷ 許容額（= リスク（%）÷ 許容リスク）。1 を超えると許容より多く賭けた */
  readonly ratio: number;
  /** 許容額 = 資金 × 許容リスク ÷ 100 */
  readonly allowance: number;
  /** その LC で入れた最大の数量（数量 × 許容額 ÷ 1R を刻みに切り捨て。刻みに満たなければ 0）。エントリーが 1 つのときだけ */
  readonly suggestedQuantity?: number;
}

/**
 * 数量の比と提案の数量（#67）。資金・許容リスクは取引に写した値（snapshot）、1R は今の oneRYen（明細の逆算か乗数・為替）を
 * そのまま使うので、為替・乗数を新しく聞かない。提案は 1R から逆算する（1R ÷ 数量 = 1 数量あたりのリスク）。
 * 1R・資金・許容リスクのどれかが無い・0 以下・有限でなければ無し。例外を投げない。
 * LC の向き・LC = イン は見ないので、検査（`evaluateTrade` の ok）を通った取引に使う（画面は `summarize` が検査の後に呼ぶ。
 * 集計（#48）で直接使うときも先に検査する）。取引の LC が無くエントリーごとの LC だけの取引でも比を返すので、LC なしの
 * 扱いは呼ぶ側が決める（画面は出さない）
 */
export function reviewSizing(t: TradeInput): SizingReview | undefined {
  const oneR = oneRYen(t);
  const capital = t.capitalYen;
  const tol = t.riskTolerancePct;
  if (oneR === undefined || capital === undefined) return undefined;
  if (![oneR, capital, tol].every(Number.isFinite)) return undefined;
  if (!(oneR > 0 && capital > 0 && tol > 0)) return undefined;
  const allowance = (capital * tol) / 100;
  const ratio = oneR / allowance;
  if (t.entries.length !== 1) return { ratio, allowance };
  const quantity = t.entries[0].quantity;
  const step = t.instrument.quantityStep;
  if (!(Number.isFinite(quantity) && quantity > 0 && Number.isFinite(step) && step > 0)) {
    return { ratio, allowance };
  }
  return { ratio, allowance, suggestedQuantity: floorToStep((quantity * allowance) / oneR, step) };
}
