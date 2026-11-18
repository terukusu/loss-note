// Issue #34 の例の表 E1〜E13・N1〜N3 の保存した取引。値はすべて架空（実際の記録を写さない）。
// 既定: L、イン 100、LC 99.5（幅 0.5）、数量 10,000、TP なし、3 つのタップは計画どおり（trade-examples.ts の stored）
import type { StoredTrade, TradeRecord } from '../../../core/record';
import { L1, stored } from './trade-examples';

const X = L1.record.exit;
export const exitAt = (
  price: number,
  over: Partial<TradeRecord['exit']> = {},
): TradeRecord['exit'] => ({
  ...X,
  price,
  ...over,
});

export const RULER_EXAMPLES: Readonly<Record<string, StoredTrade>> = {
  E1: stored('r-e1', { exit: exitAt(99.5) }),
  E2: stored('r-e2', { lcMove: { kind: 'widened', after: 99.2 }, exit: exitAt(99.2) }),
  E3: stored('r-e3', {
    side: 'S',
    lc: 150.5,
    entries: [{ price: 150, quantity: 10_000 }],
    lcMove: { kind: 'widened', after: 150.8 },
    exit: exitAt(150.8),
  }),
  E4: stored('r-e4', { tp: 101, exit: exitAt(101, { reason: 'tp' }) }),
  E5: stored('r-e5', { tp: 100.75, exit: exitAt(101) }),
  E6: stored('r-e6', { exit: exitAt(99.2, { reason: 'gapSlip', gapSlip: 'yes' }) }),
  E7: stored('r-e7', { exit: exitAt(97.5) }),
  E8: stored('r-e8', { lcMove: { kind: 'tightened' }, exit: exitAt(99.7) }),
  E9: stored('r-e9', { lcMove: { kind: 'widened' }, exit: exitAt(99.2) }),
  E10: stored('r-e10', { lcMove: { kind: 'widened', after: 99.2 }, exit: exitAt(100.25) }),
  E11: stored('r-e11', { exit: exitAt(100) }),
  E12: stored('r-e12', { tp: 99.8, exit: exitAt(99.5) }),
  E13: stored('r-e13', { tp: 103, exit: exitAt(101) }),
};

/** N1: LC を決めずに入った（LC なし） */
export const N1 = stored('r-n1', {
  lc: undefined,
  lcDecidedBeforeEntry: false,
  exit: exitAt(99.2),
});
/** N2: イン = LC（保存した記録は検査を通らない → 計算できない） */
export const N2 = stored('r-n2', { lc: 100, exit: exitAt(99.5) });
/** N3: 買い増し（エントリー 2 つ） */
export const N3 = stored('r-n3', {
  entries: [
    { price: 100, quantity: 10_000 },
    { price: 100.2, quantity: 10_000 },
  ],
  exit: exitAt(99.5),
});
