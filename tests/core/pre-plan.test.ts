// 計算の例 E20（事前の計画あり。設計書 5.5）。時点は架空の日のミリ秒
import { describe, expect, it } from 'vitest';
import { hasPrePlan } from '../../core/pre-plan';
import { trade } from './helpers/trade-builder';

const T0900 = 1_700_000_000_000; // 架空の日の 09:00
const T0905 = T0900 + 5 * 60 * 1000;

describe('E20 事前の計画あり', () => {
  it('E20 計画 09:00・エントリー 09:05 なら付ける', () => {
    expect(
      hasPrePlan(trade({ plannedAt: T0900, entries: [{ time: T0905, price: 100, quantity: 1 }] })),
    ).toBe(true);
  });

  it('E20 同じ時刻なら付けない', () => {
    expect(
      hasPrePlan(trade({ plannedAt: T0905, entries: [{ time: T0905, price: 100, quantity: 1 }] })),
    ).toBe(false);
  });

  it('E20 計画の時刻が無ければ付けない', () => {
    expect(hasPrePlan(trade({ entries: [{ time: T0905, price: 100, quantity: 1 }] }))).toBe(false);
  });
});
