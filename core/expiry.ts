// 満期の損益と最大損失（設計書 5.7 の 5・C47・C50）。価格の通貨（乗数込み）の区分線形の式で、為替は掛けない
// （口座の通貨にするのは option.ts。定まるかは価格の通貨のまま見る。C50）。折れ点は行使価格。I/O・時刻・乱数なし
import { TOL } from './numeric';
import type { Leg, Side } from './trade';

function sign(l: Leg): 1 | -1 {
  return l.side === 'buy' ? 1 : -1;
}

/** 満期の本源的価値: P = max(K − x, 0)・C = max(x − K, 0) */
export function intrinsicValue(l: Leg, x: number): number {
  return l.optionType === 'P' ? Math.max(l.strike - x, 0) : Math.max(x - l.strike, 0);
}

/** すべてのレッグの限月が同じか（満期の損益・最大損失・(3)・向きの比べ方はこのときだけ。C49・C50） */
export function sameContractMonth(legs: readonly Leg[]): boolean {
  const [first, ...rest] = legs;
  return first !== undefined && rest.every((l) => l.contractMonth === first.contractMonth);
}

/** 原資産 = x の満期の損益（価格の通貨）= Σ sign × 枚数 × 乗数 × (本源的価値(x) − 建値) */
export function expiryPnlPrice(legs: readonly Leg[], multiplier: number, x: number): number {
  return legs.reduce(
    (sum, l) => sum + sign(l) * l.quantity * multiplier * (intrinsicValue(l, x) - l.entry.price),
    0,
  );
}

/**
 * 両端の傾き（価格の通貨 ÷ 原資産 1）。low = 最小の行使価格より下（プットだけが効く）、
 * high = 最大の行使価格より上（コールだけが効く）
 */
export function expirySlopes(
  legs: readonly Leg[],
  multiplier: number,
): { readonly low: number; readonly high: number } {
  let low = 0;
  let high = 0;
  for (const l of legs) {
    const w = sign(l) * l.quantity * multiplier;
    if (l.optionType === 'P') low -= w;
    else high += w;
  }
  return { low, high };
}

/**
 * 最大損失（価格の通貨）。定まらない理由: contractMonths = 限月が違う、unbounded = 原資産が 0 の側の傾きが正か
 * 上の端の傾きが負（売りの裸）、noLoss = 最小値が 0 以上（誤差 1e-9）
 */
export type MaxLossPrice =
  | { readonly defined: true; readonly value: number }
  | { readonly defined: false; readonly cause: 'contractMonths' | 'unbounded' | 'noLoss' };

export function maxLossPrice(legs: readonly Leg[], multiplier: number): MaxLossPrice {
  if (!sameContractMonth(legs)) return { defined: false, cause: 'contractMonths' };
  const { low, high } = expirySlopes(legs, multiplier);
  if (low > TOL || high < -TOL) return { defined: false, cause: 'unbounded' };
  // 両端で減り続けないので、最小値は折れ点（行使価格）か原資産 0 の端のどれか
  let min = expiryPnlPrice(legs, multiplier, 0);
  for (const l of legs) min = Math.min(min, expiryPnlPrice(legs, multiplier, l.strike));
  if (!(min < -TOL)) return { defined: false, cause: 'noLoss' };
  return { defined: true, value: -min };
}

/** 向きを比べる幅（建てたときの原資産の ±10%。C47） */
export const SIDE_PROBE = 0.1;

/**
 * 満期の損益の比べ方の向き（C47）: 限月がそろうときだけ、建てたときの原資産の −10% と +10% の満期の損益を比べ、
 * 上がる側が得なら L・下がる側が得なら S。同じ（誤差 1e-9）・限月が違う・原資産が有限の正でなければ無し
 */
export function sideFromExpiry(
  legs: readonly Leg[],
  multiplier: number,
  entryUnderlying: number,
): Side | undefined {
  if (!sameContractMonth(legs) || !(Number.isFinite(entryUnderlying) && entryUnderlying > 0))
    return undefined;
  const down = expiryPnlPrice(legs, multiplier, entryUnderlying * (1 - SIDE_PROBE));
  const up = expiryPnlPrice(legs, multiplier, entryUnderlying * (1 + SIDE_PROBE));
  if (Math.abs(up - down) <= TOL) return undefined;
  return up > down ? 'L' : 'S';
}
