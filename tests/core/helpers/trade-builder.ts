// テストの取引を作る道具。値はすべて架空。
// 既定: L、イン 100.00、LC 99.50、数量 10,000、乗数 1、円建て、刻み 1、資金 1,000,000 円、許容リスク 1%、
// 3 つのタップは計画どおり、未決済。決済を付けるときの既定は注文の種類 unknown・理由 other（C19・C26）
import type { Exit, TradeInput } from '../../../core/trade';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function trade(over: Partial<TradeInput> = {}): TradeInput {
  return {
    side: 'L',
    instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: true },
    entries: [{ price: 100, quantity: 10_000 }],
    lc: 99.5,
    lcBasis: 'chart',
    lcDecidedBeforeEntry: true,
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    capitalYen: 1_000_000,
    riskTolerancePct: 1,
    ...over,
  };
}

/** 決済を付ける（既定は注文の種類 unknown・理由 other） */
export function closedAt(t: TradeInput, price: number, exitOver: Partial<Exit> = {}): TradeInput {
  return { ...t, exit: { price, orderType: 'unknown', reason: 'other', ...exitOver } };
}

/** エントリーが 1 つの取引で、R 倍数が r になる決済価格（イン + s × r × |イン − LC|） */
export function exitPriceAtR(t: TradeInput, r: number): number {
  const entry = t.entries[0];
  const lc = entry.lc ?? t.lc;
  if (lc === undefined) throw new Error('LC が無い取引の R から決済価格は出せません');
  const s = t.side === 'L' ? 1 : -1;
  return entry.price + s * r * Math.abs(entry.price - lc);
}

/** 既定の取引を作り、R 倍数が r になる価格で決済する */
export function closedAtR(
  r: number,
  over: Partial<TradeInput> = {},
  exitOver: Partial<Exit> = {},
): TradeInput {
  const t = trade(over);
  return closedAt(t, exitPriceAtR(t, r), exitOver);
}

/** 任意の欄を取り除く（exactOptionalPropertyTypes のため undefined を入れずに消す） */
export function without<K extends keyof TradeInput>(t: TradeInput, ...keys: K[]): TradeInput {
  const copy: Partial<Mutable<TradeInput>> = { ...t };
  for (const k of keys) delete copy[k];
  return copy as TradeInput;
}
