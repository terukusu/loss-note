// 許容リスクからの数量の提案（設計書 5.2）
import { floorToStep } from './numeric';
import type { Side } from './trade';

export interface SizingParams {
  readonly side: Side;
  readonly entryPrice: number;
  readonly lc?: number;
  readonly capitalYen?: number;
  /** % */
  readonly riskTolerancePct: number;
  readonly multiplier: number;
  /** 計画時の為替（円建ては 1） */
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
