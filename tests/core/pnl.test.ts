// 計算の例 E1〜E14（Issue #2。値はすべて架空）。式は設計書 5.1
import { describe, expect, it } from 'vitest';
import { isOverRisk, oneRYen, pnlYen, riskPct, rMultiple } from '../../core/pnl';
import { closedAt, trade, without } from './helpers/trade-builder';

/** 1 円単位で一致（差 < 0.5 円） */
function expectYen(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(actual).toBeCloseTo(expected, 0);
}

// E5: L、エントリー 2 つ（100.00 × 10,000・LC 99.50 と 99.80 × 10,000・LC 99.50）、決済 99.50
const e5 = closedAt(
  trade({
    entries: [
      { price: 100, quantity: 10_000, lc: 99.5 },
      { price: 99.8, quantity: 10_000, lc: 99.5 },
    ],
  }),
  99.5,
);

describe('損益（円）E1〜E5', () => {
  it('E1 損益: L、100.00 → 99.40、10,000、乗数 1、為替 1 は −6,000 円', () => {
    // (99.40 − 100.00) × 10,000 × 1 × 1 = −6,000
    expectYen(pnlYen(closedAt(trade(), 99.4)), -6_000);
  });

  it('E2 損益: S、150.00 → 149.50、10,000 は +5,000 円', () => {
    // −1 × (149.50 − 150.00) × 10,000 × 1 × 1 = +5,000
    const t = closedAt(
      trade({ side: 'S', entries: [{ price: 150, quantity: 10_000 }], lc: 150.4 }),
      149.5,
    );
    expectYen(pnlYen(t), 5_000);
  });

  it('E3 損益: L、外貨建て、40,000 → 40,100、2、乗数 1、為替 150 は +30,000 円', () => {
    // (40,100 − 40,000) × 2 × 1 × 150 = +30,000
    const t = closedAt(
      trade({
        instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false },
        entries: [{ price: 40_000, quantity: 2 }],
        lc: 39_900,
      }),
      40_100,
      { fxRate: 150 },
    );
    expectYen(pnlYen(t), 30_000);
  });

  it('E4 損益: L、38,000 → 37,900、1、乗数 100、為替 1 は −10,000 円', () => {
    // (37,900 − 38,000) × 1 × 100 × 1 = −10,000
    const t = closedAt(
      trade({
        instrument: { multiplier: 100, quantityStep: 1, priceInAccountCurrency: true },
        entries: [{ price: 38_000, quantity: 1 }],
        lc: 37_800,
      }),
      37_900,
    );
    expectYen(pnlYen(t), -10_000);
  });

  it('E5 損益: 買い増しの 2 エントリーで −8,000 円', () => {
    // (99.50 − 100.00) × 10,000 + (99.50 − 99.80) × 10,000 = −5,000 − 3,000 = −8,000
    expectYen(pnlYen(e5), -8_000);
  });
});

describe('R 倍数 E5〜E8', () => {
  it('E5 R 倍数: 買い増しで −1.0R', () => {
    // (−0.50 × 10,000 − 0.30 × 10,000) ÷ (0.50 × 10,000 + 0.30 × 10,000) = −8,000 ÷ 8,000 = −1.0
    expect(rMultiple(e5)).toBeCloseTo(-1.0, 3);
  });

  it('E6 R 倍数: 事後。L、100.00・LC 99.50・決済 99.40 は −1.2R', () => {
    // (99.40 − 100.00) ÷ |100.00 − 99.50| = −0.60 ÷ 0.50 = −1.2
    expect(rMultiple(closedAt(trade(), 99.4))).toBeCloseTo(-1.2, 3);
  });

  it('E7 R 倍数: 事後。S、150.00・LC 150.40・決済 149.20 は +2.0R', () => {
    // −1 × (149.20 − 150.00) ÷ |150.00 − 150.40| = 0.80 ÷ 0.40 = +2.0
    const t = closedAt(
      trade({ side: 'S', entries: [{ price: 150, quantity: 10_000 }], lc: 150.4 }),
      149.2,
    );
    expect(rMultiple(t)).toBeCloseTo(2.0, 3);
  });

  it('E8 R 倍数: 事後。L、100.00・LC 99.50・決済 100.00 は 0R', () => {
    expect(rMultiple(closedAt(trade(), 100))).toBeCloseTo(0, 3);
  });
});

describe('1R（円）E5・E9〜E11', () => {
  it('E5 1R: 買い増しの合計で 8,000 円', () => {
    // (|100.00 − 99.50| × 10,000 + |99.80 − 99.50| × 10,000) × 乗数 1 × 計画時の為替 1 = 8,000
    expectYen(oneRYen(e5), 8_000);
  });

  it('E9 1R: 事後。明細の損益 −9,000 円（外貨建て・為替なし）から 7,500 円を逆算', () => {
    // |−9,000| × |100.00 − 99.50| ÷ |99.40 − 100.00| = 9,000 × 0.50 ÷ 0.60 = 7,500
    const t = closedAt(
      trade({
        instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false },
        statementPnlYen: -9_000,
      }),
      99.4,
    );
    expectYen(oneRYen(t), 7_500);
  });

  it('E10 1R: 事後。決済 = イン なので乗数と為替の式で 5,000 円', () => {
    // |100.00 − 99.50| × 10,000 × 1 × 1 = 5,000
    expectYen(oneRYen(closedAt(trade(), 100)), 5_000);
  });

  it('E11 1R: 外貨建てで為替が分からないと 1R とリスクを出さない（R は 0R）', () => {
    const t = closedAt(
      trade({ instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false } }),
      100,
    );
    expect(oneRYen(t)).toBeUndefined();
    expect(riskPct(t)).toBeUndefined();
    expect(rMultiple(t)).toBeCloseTo(0, 3);
  });
});

describe('リスク（%）E12〜E14', () => {
  it('E12 リスク: 1R 5,000 円・資金 1,000,000 円は 0.5%', () => {
    // 5,000 ÷ 1,000,000 × 100 = 0.5
    const t = trade();
    expectYen(oneRYen(t), 5_000);
    expect(riskPct(t)).toBeCloseTo(0.5, 4);
  });

  it('E13 リスク: 資金が未設定なら出さない', () => {
    expect(riskPct(without(trade(), 'capitalYen'))).toBeUndefined();
  });

  it('E14 リスク: 1R 20,000 円は 2.0%（過剰でない）・20,001 円は 2.0001%（過剰）', () => {
    // 0.50 × 40,000 = 20,000 → 20,000 ÷ 1,000,000 × 100 = 2.0
    const at2 = trade({ entries: [{ price: 100, quantity: 40_000 }] });
    expectYen(oneRYen(at2), 20_000);
    const p2 = riskPct(at2);
    expect(p2).toBeCloseTo(2.0, 4);
    expect(isOverRisk(p2 ?? Number.NaN)).toBe(false);

    // 0.50 × 40,002 = 20,001 → 2.0001
    const over = trade({ entries: [{ price: 100, quantity: 40_002 }] });
    expectYen(oneRYen(over), 20_001);
    const pOver = riskPct(over);
    expect(pOver).toBeCloseTo(2.0001, 4);
    expect(isOverRisk(pOver ?? Number.NaN)).toBe(true);
  });
});
