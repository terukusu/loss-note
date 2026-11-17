// 計算の例 E15〜E18（数量の提案。設計書 5.2。値はすべて架空）
import { describe, expect, it } from 'vitest';
import { type SizingParams, suggestQuantity } from '../../core/sizing';

const base: SizingParams = {
  side: 'L',
  entryPrice: 100,
  lc: 99.5,
  capitalYen: 1_000_000,
  riskTolerancePct: 1,
  multiplier: 1,
  fx: 1,
  quantityStep: 1,
};

describe('数量の提案 E15〜E18', () => {
  it('E15 資金 1,000,000 円・1%・L 100.00 / LC 99.50・刻み 1 は 20,000', () => {
    // 1,000,000 × 1% ÷ (0.50 × 1 × 1) = 20,000
    expect(suggestQuantity(base)).toBe(20_000);
  });

  it('E16 資金 900,000 円・1%・38,200 / 38,000・為替 150・刻み 0.1 は 0.3（0.2 にしない）', () => {
    // 900,000 × 1% ÷ (200 × 1 × 150) = 9,000 ÷ 30,000 = 0.3（0.3 ÷ 0.1 = 2.9999999999999996 を 3 に）
    const q = suggestQuantity({
      ...base,
      entryPrice: 38_200,
      lc: 38_000,
      capitalYen: 900_000,
      fx: 150,
      quantityStep: 0.1,
    });
    expect(q).toBe(0.3);
  });

  it('E17 資金 100,000 円では刻みに満たないので 0', () => {
    // 100,000 × 1% ÷ 30,000 = 0.033… → 0.1 の刻みに切り捨てて 0
    const q = suggestQuantity({
      ...base,
      entryPrice: 38_200,
      lc: 38_000,
      capitalYen: 100_000,
      fx: 150,
      quantityStep: 0.1,
    });
    expect(q).toBe(0);
  });

  it('E18 資金が未設定、または LC が無いと提案しない', () => {
    const { capitalYen: _c, ...noCapital } = base;
    const { lc: _l, ...noLc } = base;
    expect(suggestQuantity(noCapital)).toBeUndefined();
    expect(suggestQuantity(noLc)).toBeUndefined();
  });

  it('LC の向きが逆なら提案しない', () => {
    expect(suggestQuantity({ ...base, lc: 100.5 })).toBeUndefined();
    expect(suggestQuantity({ ...base, side: 'S', lc: 99.5 })).toBeUndefined();
  });
});
