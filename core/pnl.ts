// 損益・R 倍数・1R・リスク（%）・明細から逆算した為替（設計書 5.1・C18・C32・C43）。金額は口座の通貨。丸めずに返す。
// 足を持つ取引（t.option）は option.ts に回す（5.7。5.1 の 1R の補いの式と明細から逆算した為替を当てない。C49）
import { signOf, TOL } from './numeric';
import { optionOneR, positionNetYen, positionPnlYen } from './option';
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

/** 決済の為替（価格の通貨 = 口座の通貨なら 1） */
function exitFx(t: TradeInput): number | undefined {
  return t.instrument.priceInAccountCurrency ? 1 : t.exit?.fxRate;
}

/** 計画時の為替（価格の通貨 = 口座の通貨なら 1） */
function planFx(t: TradeInput): number | undefined {
  return t.instrument.priceInAccountCurrency ? 1 : t.planFxRate;
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

/** 損益（口座の通貨）。明細の損益があればそれ（C18）、無ければ Σ s(決済 − イン_i) × 数量_i × 乗数 × 決済の為替 */
export function pnlYen(t: TradeInput): number | undefined {
  if (t.option !== undefined) return positionPnlYen(t);
  if (t.exit === undefined) return undefined;
  if (t.statementPnlYen !== undefined) return t.statementPnlYen;
  const fx = exitFx(t);
  const move = priceMove(t);
  if (fx === undefined || move === undefined) return undefined;
  return move * t.instrument.multiplier * fx;
}

/** R 倍数（価格だけ。為替・口座の通貨・資金に依らない）: Σ s(決済 − イン_i) × 数量_i ÷ Σ |イン_i − LC_i| × 数量_i */
export function rMultiple(t: TradeInput): number | undefined {
  // 足を持つ取引: R = 手数料を除いた損益 ÷ 1R（C49）
  if (t.option !== undefined) {
    const net = positionNetYen(t);
    const oneR = optionOneR(t)?.value;
    if (net === undefined || oneR === undefined || !(oneR > 0)) return undefined;
    return net / oneR;
  }
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

/**
 * 手数料を除いた明細の損益（net）と値動き（move = Σ s(決済 − イン_i) × 数量_i）が、明細から逆算してよい組か。
 * 決済が無い・明細の損益が無い・move が 0・net が 0・符号が食い違う、のどれかなら無し（C32 と R6 の共通の条件）
 */
function statementNetAndMove(t: TradeInput): { net: number; move: number } | undefined {
  if (t.exit === undefined || t.statementPnlYen === undefined) return undefined;
  const move = priceMove(t);
  if (move === undefined || move === 0) return undefined;
  const net = t.statementPnlYen + (t.feesTotalYen ?? 0);
  if (net === 0 || Math.sign(net) !== Math.sign(move)) return undefined;
  return { net, move };
}

/**
 * 明細の損益から逆算した為替（価格の通貨 1 単位 = 口座の通貨。R6・C43）= net ÷ (move × 乗数)。
 * 価格の通貨 = 口座の通貨・エントリーが 2 つ以上・入る前の計画あり（C32 の逆算をしない取引）なら無し。
 * 見せるだけで保存しない。出るなら正の有限の数
 */
export function statementFxRate(t: TradeInput): number | undefined {
  // C32 の 1R の逆算と同じく、事後の記録のエントリーが 1 つの取引だけ（買い増しの取引では為替と 1R の根拠が分かれるため）
  if (t.option !== undefined) return undefined; // 足を持つ取引には当てない（C49）
  if (t.instrument.priceInAccountCurrency || !isPostSingleEntry(t)) return undefined;
  const nm = statementNetAndMove(t);
  if (nm === undefined) return undefined;
  const fx = nm.net / (nm.move * t.instrument.multiplier);
  return Number.isFinite(fx) && fx > 0 ? fx : undefined;
}

/** 1R（口座の通貨）（5.1・C32） */
export function oneRYen(t: TradeInput): number | undefined {
  if (t.option !== undefined) return optionOneR(t)?.value; // 補いの式を当てない（C49）
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
