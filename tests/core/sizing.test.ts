// 計算の例 E15〜E18（数量の提案。設計書 5.2）と Z1〜Z14（数量の比と提案の数量。#67）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { oneRYen } from '../../core/pnl';
import { reviewSizing, type SizingParams, suggestQuantity } from '../../core/sizing';
import type { TradeInput } from '../../core/trade';
import { closedAt, trade, without } from './helpers/trade-builder';

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

// ---- 数量の比と提案の数量（Issue #67 の例 Z1〜Z14。事後の振り返り。値はすべて架空） ----
// 共通の場面 P: L、イン 100.00、LC 99.50、決済 99.50、乗数 1、刻み 1、円建て。
// 口座 A = 資金 1,000,000・許容 1%、口座 B = 200,000・1%、口座 E = 1,000,000・0.5%。
// 許容額 = 資金 × 許容リスク ÷ 100、比 = 1R ÷ 許容額、提案 = 数量 × 許容額 ÷ 1R を刻みに切り捨て

const A = { capitalYen: 1_000_000, riskTolerancePct: 1 } as const;
const B = { capitalYen: 200_000, riskTolerancePct: 1 } as const;
const E = { capitalYen: 1_000_000, riskTolerancePct: 0.5 } as const;

/** 場面 P（決済 99.50）に口座と上書きを足す */
function p(money: Partial<TradeInput>, over: Partial<TradeInput> = {}, exitPrice = 99.5) {
  return closedAt(trade({ ...money, ...over }), exitPrice);
}

/** Z6: USD 建て・決済 99.40・数量 100・明細の損益 −9,100・手数料 100・為替は空 */
function z6(step: number): TradeInput {
  return closedAt(
    trade({
      ...A,
      instrument: { multiplier: 1, quantityStep: step, priceInAccountCurrency: false },
      entries: [{ price: 100, quantity: 100 }],
      statementPnlYen: -9_100,
      feesTotalYen: 100,
    }),
    99.4,
  );
}

/** Z8 / Z9: イン 38,000・乗数 100 */
function index(lc: number, quantity: number): TradeInput {
  return closedAt(
    trade({
      ...A,
      instrument: { multiplier: 100, quantityStep: 1, priceInAccountCurrency: true },
      entries: [{ price: 38_000, quantity }],
      lc,
    }),
    lc,
  );
}

describe('数量の比と提案の数量 Z1〜Z10（AC-1）', () => {
  const cases: readonly (readonly [string, TradeInput, number, number, number])[] = [
    // [例, 取引, 比, 許容額, 提案]
    // Z1: 1R = 0.50 × 10,000 × 1 = 5,000、許容額 = 1,000,000 × 1% = 10,000 → 0.5、提案 = 10,000 × 10,000 ÷ 5,000 = 20,000
    ['Z1', p(A), 0.5, 10_000, 20_000],
    // Z2: 許容額 = 200,000 × 1% = 2,000 → 5,000 ÷ 2,000 = 2.5、提案 = 10,000 × 2,000 ÷ 5,000 = 4,000
    ['Z2', p(B), 2.5, 2_000, 4_000],
    // Z3: 1R = 0.50 × 30,000 = 15,000、許容額 = 1,000,000 × 0.5% = 5,000 → 3.0、提案 = 30,000 × 5,000 ÷ 15,000 = 10,000
    ['Z3', p(E, { entries: [{ price: 100, quantity: 30_000 }] }), 3, 5_000, 10_000],
    // Z4: 1R = 0.50 × 20,000 = 10,000 → 1.0、提案 = 20,000 × 10,000 ÷ 10,000 = 20,000
    ['Z4', p(A, { entries: [{ price: 100, quantity: 20_000 }] }), 1, 10_000, 20_000],
    // Z5: 1R = 0.50 × 10,400 = 5,200 → 0.52、提案 = 10,400 × 10,000 ÷ 5,200 = 20,000
    ['Z5', p(A, { entries: [{ price: 100, quantity: 10_400 }] }), 0.52, 10_000, 20_000],
    // Z6: 手数料を除いた損益 −9,000、1R = 9,000 × 0.50 ÷ 0.60 = 7,500 → 0.75、提案 = 100 × 10,000 ÷ 7,500 = 133.3 → 133
    ['Z6', z6(1), 0.75, 10_000, 133],
    // Z7: Z6 で刻み 10 → 133.3 を 10 に切り捨てて 130
    ['Z7', z6(10), 0.75, 10_000, 130],
    // Z8: 1R = 100 × 2 × 100 = 20,000 → 2.0、提案 = 2 × 10,000 ÷ 20,000 = 1
    ['Z8', index(37_900, 2), 2, 10_000, 1],
    // Z9: 1R = 400 × 1 × 100 = 40,000 → 4.0、提案 = 1 × 10,000 ÷ 40,000 = 0.25 → 0
    ['Z9', index(37_600, 1), 4, 10_000, 0],
    // Z10: S・イン 100.00・LC 100.50・決済 100.50 → Z1 と同じ
    ['Z10', p(A, { side: 'S', lc: 100.5 }, 100.5), 0.5, 10_000, 20_000],
  ];

  it.each(cases)('%s', (_name, t, ratio, allowance, suggested) => {
    const s = reviewSizing(t);
    expect(s).toBeDefined();
    if (s === undefined) return;
    expect(Math.abs(s.ratio - ratio)).toBeLessThanOrEqual(1e-9);
    expect(s.allowance).toBeCloseTo(allowance, 9);
    expect(s.suggestedQuantity).toBe(suggested);
  });
});

describe('出さない Z11〜Z13（AC-2）・エントリー 2 つ Z14（AC-3）', () => {
  it('Z11 資金が未設定なら出さない', () => {
    expect(reviewSizing(without(p(A), 'capitalYen'))).toBeUndefined();
  });

  it('Z12 LC なし（C37）なら出さない', () => {
    expect(reviewSizing(without(p(A, { lcDecidedBeforeEntry: false }), 'lc'))).toBeUndefined();
  });

  it('Z13 USD 建てで為替も明細の損益も無いと 1R が出ないので出さない', () => {
    const t = p(A, {
      instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false },
    });
    expect(oneRYen(t)).toBeUndefined();
    expect(reviewSizing(t)).toBeUndefined();
  });

  it('Z14 エントリー 2 つ（100.00 × 5,000・99.80 × 5,000）は比 0.4 だけ、提案は出さない', () => {
    // 1R = 0.50 × 5,000 + 0.30 × 5,000 = 4,000 → 4,000 ÷ 10,000 = 0.4
    const t = p(A, {
      entries: [
        { price: 100, quantity: 5_000 },
        { price: 99.8, quantity: 5_000 },
      ],
    });
    const s = reviewSizing(t);
    expect(s?.ratio).toBeCloseTo(0.4, 12);
    expect(s).not.toHaveProperty('suggestedQuantity');
  });

  it('許容リスク・資金が 0 以下、数量の刻みが壊れていても例外を投げない', () => {
    expect(reviewSizing(p({ capitalYen: 0, riskTolerancePct: 1 }))).toBeUndefined();
    expect(reviewSizing(p({ capitalYen: 1_000_000, riskTolerancePct: 0 }))).toBeUndefined();
    const badStep = p(A, {
      instrument: { multiplier: 1, quantityStep: 0, priceInAccountCurrency: true },
    });
    expect(reviewSizing(badStep)?.ratio).toBeCloseTo(0.5, 12);
    expect(reviewSizing(badStep)).not.toHaveProperty('suggestedQuantity');
  });
});

describe('判定は変えない（AC-5）', () => {
  it('Z2 は B（過剰リスク 2.5%）、Z3 は A（1.5%）のまま。R・リスクも今と同じ', () => {
    const z2 = evaluateTrade(p(B));
    const z3 = evaluateTrade(p(E, { entries: [{ price: 100, quantity: 30_000 }] }));
    if (!z2.ok || !z3.ok) throw new Error('検査を通るはず');
    expect(z2.judgment?.grade).toBe('B');
    expect(z2.judgment?.reasons.map((r) => r.kind)).toEqual(['overRisk']);
    expect(z2.riskPct).toBeCloseTo(2.5, 12);
    expect(z2.r).toBeCloseTo(-1, 12);
    expect(z3.judgment?.grade).toBe('A');
    expect(z3.judgment?.reasons.map((r) => r.kind)).toEqual(['asPlannedLc']);
    expect(z3.riskPct).toBeCloseTo(1.5, 12);
    // 評価の戻り値に比は入らない（判定の入力・出力を増やさない）
    expect(Object.keys(z2).sort()).toEqual(Object.keys(evaluateTrade(p(A))).sort());
    expect(z2).not.toHaveProperty('sizing');
  });
});
