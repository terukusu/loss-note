// 数の約束（設計書 5.2・5.3）。誤差を許すのは次の 5 つだけ:
// 過剰リスクの 2% の境・勝ち負けの境（R ≥ −TOL）・持ち続けたの 1R 超え・持ち続けたの 0.1R までの滑りの境（C71）・
// 数量の刻みへの切り捨て
import type { Side } from './trade';

/** 比較で許す小数の誤差 */
export const TOL = 1e-9;

/** 刻みへの切り捨てで許す相対の誤差（0.3 ÷ 0.1 = 2.9999999999999996 を 3 に数える） */
const STEP_REL_TOL = 1e-12;

/** L なら +1、S なら −1 */
export function signOf(side: Side): 1 | -1 {
  return side === 'L' ? 1 : -1;
}

/**
 * raw を刻みの整数倍に切り捨てる。0 以下・有限でなければ 0。
 * 小数の誤差で 1 刻み落とさない（相対 1e-12 以内で次の刻みに届くなら届いたとみなす）。
 * 戻り値は有効数字 15 桁に丸め、0.30000000000000004 を 0.3 にする
 */
export function floorToStep(raw: number, step: number): number {
  if (!(raw > 0) || !Number.isFinite(raw) || !(step > 0)) return 0;
  const q = raw / step;
  let n = Math.floor(q);
  if (n + 1 - q <= q * STEP_REL_TOL) n += 1;
  return Number((n * step).toPrecision(15));
}
