// 気づきの連勝の後のカードの表示の形（Issue #185 の AC-5・AC-6。例 B1〜B5）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { emotionItemOf, insightModel, STREAK_NONE } from '../../ui/src/lib/insight-view';
import { periodRange } from '../../ui/src/lib/period';
import { E1, E1_HIDDEN, E6 } from './helpers/insight-examples';
import { REVIEW_NOW } from './helpers/review-examples';
import { B, B_HIDDEN, B3, B4, B5 } from './helpers/streak-examples';

const range7 = periodRange({ key: '7d', imports: false }, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };
const NONE = new Set<string>();

const streak = (
  trades: Parameters<typeof insightModel>[0],
  includeImports = false,
  hidden: ReadonlySet<string> = NONE,
) => insightModel(trades, { hidden, includeImports, range: R7 }).streak;

describe('例 B の取引の判定（手で決めた値）', () => {
  it('B: 勝ち・負け・判定なしの並び', () => {
    expect(B.map(emotionItemOf).map((i) => [i.id, i.grade])).toEqual([
      ['o1', 'safeWin'],
      ['s1', 'safeWin'],
      ['s2', 'riskyWin'],
      ['d1', 'B'],
      ['s3', 'B'],
      ['s4', 'safeWin'],
      ['s5', 'safeWin'],
      ['s6', 'B'],
      ['s7', 'A'],
      ['s8', 'C'],
      ['s9', 'safeWin'],
      ['i1', 'safeWin'],
      ['s10', 'A'],
    ]);
    expect(B5.map(emotionItemOf).map((i) => i.grade)).toEqual([
      'safeWin',
      'A',
      'safeWin',
      null,
      'safeWin',
      'safeWin',
    ]);
  });
});

describe('AC-5・AC-6: 連勝の後のカード', () => {
  it('B1: 2 件 · 件数が少ない · あと 3 件・このうち 調子に乗った 2 件・調子に乗った 4 件のうち 連勝の後 2 件', () => {
    const s = streak(B, false, B_HIDDEN);
    expect(s).toMatchObject({
      count: 2,
      few: true,
      countText: '2 件',
      restText: 'あと 3 件',
      rateText: null,
      fractionText: null,
      cost: null,
      summary: '2 件 · 件数が少ない',
      noneText: null,
      afterText: 'このうち 調子に乗った 2 件',
      tagText: '調子に乗った 4 件のうち 連勝の後 2 件',
    });
  });

  it('B1: 比べる相手 = 連勝の後でない 8 件（S1・S2・S4・S5・S7・S8・S9・S10）: 75%（6 / 8）・規律コスト（R の出ない S8 があるので R で測れる崩れ）', () => {
    const s = streak(B, false, B_HIDDEN);
    expect(s?.others).toEqual({
      rate: 'ほかの取引 75%（6 / 8）',
      cost: 'ほかの取引 R で測れる崩れ ±0.0R',
    });
    expect(s?.pairs).toEqual([
      { label: 'このうち 調子に乗った', value: '2 件', zero: false },
      { label: '調子に乗った 4 件のうち 連勝の後', value: '2 件', zero: false },
    ]);
  });

  it('B1: 消した印の D1 を外さなければ、D1 自身と S6 が連勝の後になり S3 は入らない（並びに入れないことの確かめ）', () => {
    // D1 の直前は S1・S2（勝ち）→ D1 が連勝の後。S3 の直前は S2・D1（負け）→ 入らない。S3 の「調子に乗った」が外れる
    expect(streak(B, false, NONE)).toMatchObject({
      count: 2,
      afterText: 'このうち 調子に乗った 1 件',
    });
  });

  it('B2: 取り込みを含める → 3 件 · あと 2 件・このうち 3 件・4 件のうち 3 件', () => {
    expect(streak(B, true, B_HIDDEN)).toMatchObject({
      count: 3,
      restText: 'あと 2 件',
      summary: '3 件 · 件数が少ない',
      afterText: 'このうち 調子に乗った 3 件',
      tagText: '調子に乗った 4 件のうち 連勝の後 3 件',
    });
  });

  it('B3: 5 件 · 60%（3 / 5）· 崩れで −1.5R', () => {
    const s = streak(B3);
    expect(s).toMatchObject({
      count: 5,
      few: false,
      restText: null,
      rateText: '60%',
      fractionText: '3 / 5',
      cost: { kind: 'gap', lead: '崩れで', value: '−1.5R' },
      summary: '5 件 · 60%（3 / 5）· 崩れで −1.5R',
      // ほかの取引 = 勝ちの 10 件
      others: { rate: 'ほかの取引 100%（10 / 10）', cost: 'ほかの取引 崩れなし ±0.0R' },
      afterText: 'このうち 調子に乗った 2 件',
      tagText: '調子に乗った 2 件のうち 連勝の後 2 件',
    });
  });

  it('B4: 2 件・このうち 調子に乗った 0 件・2 つ目の文は出ない（調子に乗った 0 件）', () => {
    expect(streak(B4)).toMatchObject({
      count: 2,
      summary: '2 件 · 件数が少ない',
      afterText: 'このうち 調子に乗った 0 件',
      tagText: null,
      // ほかの取引 = 1・2 件目（勝ち 2 件。判定の出た取引が 5 件未満）
      others: { rate: 'ほかの取引 件数が少ない', cost: null },
      pairs: [{ label: 'このうち 調子に乗った', value: '0 件', zero: true }],
    });
  });

  it('B5: 0 件の文と「調子に乗った 1 件のうち 連勝の後 0 件」', () => {
    expect(streak(B5)).toMatchObject({
      count: 0,
      summary: null,
      noneText: STREAK_NONE,
      afterText: null,
      tagText: '調子に乗った 1 件のうち 連勝の後 0 件',
      others: null,
      pairs: [{ label: '調子に乗った 1 件のうち 連勝の後', value: '0 件', zero: true }],
    });
    expect(STREAK_NONE).toBe('この期間に 2 連勝の直後の取引はありません');
  });

  it('対象が 0 件（取り込みだけで含めない）ならカードを作らない', () => {
    expect(streak(E6)).toBeNull();
  });

  it('E1（#162）の期間: 連勝の後 = T5（直前 T3 勝ち · T4 A で切れる → 0）… 手で数えた件数', () => {
    // E1 の並び（取り込みを外す・T12 は消した印）: T1 A · T2 A · T3 W · T4 A · T5 W · T6 B · T7 B · T8 危ない勝ち · T9 C ·
    // T10 A · T11 B → 2 連勝が無いので 0 件。調子に乗ったは T8 の 1 件
    expect(streak(E1, false, E1_HIDDEN)).toMatchObject({
      count: 0,
      tagText: '調子に乗った 1 件のうち 連勝の後 0 件',
    });
  });
});
