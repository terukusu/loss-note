// 損益（円）・R 倍数・1R（円）・リスク（%）（設計書 5.1・C18・C32）。丸めずに返す
import { signOf, TOL } from './numeric';
import { hasPrePlan } from './pre-plan';
import type { TradeInput } from './trade';

/** エントリーごとのそのときの LC（無ければ取引の LC） */
function lcOf(t: TradeInput, i: number): number | undefined {
  return t.entries[i]?.lc ?? t.lc;
}

/** すべてのエントリーの LC（エントリーの LC か取引の LC）。1 つでも決まらなければ無し */
export function allLcs(t: TradeInput): number[] | undefined {
  const lcs: number[] = [];
  for (let i = 0; i < t.entries.length; i++) {
    const lc = lcOf(t, i);
    if (lc === undefined) return undefined;
    lcs.push(lc);
  }
  return lcs;
}

/** 決済の為替（円建ては 1） */
function exitFx(t: TradeInput): number | undefined {
  return t.instrument.isJpy ? 1 : t.exit?.fxRate;
}

/** 計画時の為替（円建ては 1） */
function planFx(t: TradeInput): number | undefined {
  return t.instrument.isJpy ? 1 : t.planFxRate;
}

/** 事後の記録でエントリーが 1 つか（C18） */
export function isPostSingleEntry(t: TradeInput): boolean {
  return t.entries.length === 1 && t.exit !== undefined && !hasPrePlan(t);
}

/** 価格だけの動き Σ s(決済 − イン_i) × 数量_i（未決済なら無し） */
export function priceMove(t: TradeInput): number | undefined {
  if (t.exit === undefined) return undefined;
  const s = signOf(t.side);
  const exitPrice = t.exit.price;
  return t.entries.reduce((sum, e) => sum + s * (exitPrice - e.price) * e.quantity, 0);
}

/** 損益（円）。明細の損益があればそれ（C18）、無ければ Σ s(決済 − イン_i) × 数量_i × 乗数 × 決済の為替 */
export function pnlYen(t: TradeInput): number | undefined {
  if (t.exit === undefined) return undefined;
  if (t.statementPnlYen !== undefined) return t.statementPnlYen;
  const fx = exitFx(t);
  const move = priceMove(t);
  if (fx === undefined || move === undefined) return undefined;
  return move * t.instrument.multiplier * fx;
}

/** R 倍数（価格だけ）: Σ s(決済 − イン_i) × 数量_i ÷ Σ |イン_i − LC_i| × 数量_i */
export function rMultiple(t: TradeInput): number | undefined {
  const move = priceMove(t);
  const lcs = allLcs(t);
  if (move === undefined || lcs === undefined) return undefined;
  const risk = t.entries.reduce(
    (sum, e, i) => sum + Math.abs(e.price - (lcs[i] ?? e.price)) * e.quantity,
    0,
  );
  if (!(risk > 0)) return undefined;
  return move / risk;
}

/** 1R（円）（5.1・C32） */
export function oneRYen(t: TradeInput): number | undefined {
  const lcs = allLcs(t);
  if (lcs === undefined) return undefined;
  const mult = t.instrument.multiplier;

  if (isPostSingleEntry(t) && t.exit !== undefined) {
    const entry = t.entries[0];
    const lc = lcs[0] ?? entry.price;
    const width = Math.abs(entry.price - lc);
    const move = t.exit.price - entry.price;
    // 手数料を除いた損益から逆算する。0・R と符号が食い違う・決済 = イン なら逆算しない
    if (t.statementPnlYen !== undefined && move !== 0) {
      const net = t.statementPnlYen + (t.feesTotalYen ?? 0);
      if (net !== 0 && Math.sign(net) === Math.sign(signOf(t.side) * move)) {
        return (Math.abs(net) * width) / Math.abs(move);
      }
    }
    const fx = exitFx(t);
    if (fx === undefined) return undefined;
    return width * entry.quantity * mult * fx;
  }

  const fx = planFx(t);
  if (fx === undefined) return undefined;
  const sum = t.entries.reduce(
    (acc, e, i) => acc + Math.abs(e.price - (lcs[i] ?? e.price)) * e.quantity,
    0,
  );
  return sum * mult * fx;
}

/** リスク（%）= 1R ÷ 資金 × 100（1R か資金が無ければ無し） */
export function riskPct(t: TradeInput): number | undefined {
  const oneR = oneRYen(t);
  if (oneR === undefined || t.capitalYen === undefined) return undefined;
  return (oneR / t.capitalYen) * 100;
}

/** 過剰リスク: 2% を超える（ちょうど 2% は過剰でない。誤差 TOL を許す） */
export function isOverRisk(pct: number): boolean {
  return pct - 2 > TOL;
}
