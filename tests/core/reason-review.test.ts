// 崩れ方（判定の崩れの理由）ごとの規律の集計（Issue #239。設計書 6.1・6.2・C68）。値はすべて架空。
// 行 = その崩れ方が当たった取引の部分集合への reviewPeriod。規律コスト = Σ(実際の R − 計画どおりの R)
// （計画どおりの R = B・C の負けで R < −1.0 なら −1.0、ほかは実際の R）
import { describe, expect, it } from 'vitest';
import type { Grade, Reason } from '../../core/judge';
import {
  BREACH_KINDS,
  type BreachKind,
  breachKindsOf,
  type ReviewItem,
  reviewByReason,
  reviewPeriod,
} from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const DAY = 86_400_000;
const T0 = 1_763_000_000_000;

function item(
  id: string,
  grade: Grade | null,
  r: number | undefined,
  reasons: readonly BreachKind[],
  imported = false,
): ReviewItem {
  const n = Number(id.replace(/\D/g, '')) || 0;
  return {
    id,
    exitTime: T0 + n * DAY,
    createdAt: n,
    grade,
    ...(r === undefined ? {} : { r }),
    imported,
    ...(reasons.length > 0 ? { reasons } : {}),
  };
}

/** Issue の例 E1（i1 は取り込み） */
const E1: readonly ReviewItem[] = [
  item('t1', 'A', -1.0, []),
  item('t2', 'safeWin', 2.0, []),
  item('t3', 'B', -1.6, ['lcWidened']),
  item('t4', 'B', -2.0, ['lcWidened', 'heldPastLc']),
  item('t5', 'riskyWin', 1.0, ['lcWidened']),
  item('t6', 'C', undefined, ['noLc']),
  item('t7', 'B', -0.5, ['amountBasedLc']),
  item('t8', 'B', -1.2, ['lcWidened', 'overRisk']),
  // 2 回のナンピンは理由の種類にすると 1 つ（breachKindsOf）
  item(
    't9',
    'B',
    -3.0,
    breachKindsOf([{ kind: 'lcWidened' }, { kind: 'averagingDown' }, { kind: 'averagingDown' }]),
  ),
  item('i1', 'B', -1.5, ['lcWidened'], true),
];

const rowsOf = (items: readonly ReviewItem[], includeImports: boolean) =>
  reviewByReason(items, { includeImports }).rows.map((r) => [r.kind, r.review.total]);

describe('reviewByReason: 例 E1・E2（手計算）', () => {
  it('E1: 9 件のうち崩れ 7 件・LC を広げた 5 件で −3.8R・ほかは 1 件ずつ 5.3 の表の順・重なりあり', () => {
    const v = reviewByReason(E1, { includeImports: false });
    expect(v.total).toBe(9);
    expect(v.breached).toBe(7);
    expect(v.excludedImports).toBe(1);
    expect(v.overlap).toBe(true);
    expect(rowsOf(E1, false)).toEqual([
      ['lcWidened', 5],
      ['noLc', 1],
      ['heldPastLc', 1],
      ['overRisk', 1],
      ['amountBasedLc', 1],
      ['averagingDown', 1],
    ]);
    // 行の件数の和 10 > 崩れ 7
    expect(v.rows.reduce((s, r) => s + r.review.total, 0)).toBe(10);
    const widened = v.rows[0]?.review;
    // LC を広げた: t3 −1.6 → −1.0（−0.6）、t4 −2.0 → −1.0（−1.0）、t5 危ない勝ち（0）、t8 −1.2 → −1.0（−0.2）、
    // t9 −3.0 → −1.0（−2.0）→ 規律コスト −3.8R。判定の出た 5 件・計画どおり 0
    expect(widened?.cost).toBeCloseTo(-3.8, 9);
    expect(widened?.judged).toBe(5);
    expect(widened?.planned).toBe(0);
    expect(widened?.noR).toBe(0);
    // LC を決めずに入った: t6 は R なし → 曲線に入らない
    const noLc = v.rows.find((r) => r.kind === 'noLc')?.review;
    expect(noLc?.noR).toBe(1);
    expect(noLc?.curve).toEqual([]);
    // 金額ありき −0.5R は置き換えない（−1.0R 以上）→ 規律コスト 0
    expect(v.rows.find((r) => r.kind === 'amountBasedLc')?.review.cost).toBe(0);
  });

  it('E2: 取り込みを含めると LC を広げた 6 件で −4.3R・10 件のうち崩れ 8 件', () => {
    const v = reviewByReason(E1, { includeImports: true });
    expect(v.total).toBe(10);
    expect(v.breached).toBe(8);
    expect(v.excludedImports).toBe(0);
    expect(v.rows[0]?.kind).toBe('lcWidened');
    expect(v.rows[0]?.review.total).toBe(6);
    // −3.8 + (−1.5 − −1.0) = −4.3
    expect(v.rows[0]?.review.cost).toBeCloseTo(-4.3, 9);
  });

  it('E3: A・計画どおりの勝ちだけ（理由なし）→ 行 0・崩れ 0', () => {
    const v = reviewByReason([item('t1', 'A', -1.0, []), item('t2', 'safeWin', 1.5, [])], {
      includeImports: false,
    });
    expect(v.breached).toBe(0);
    expect(v.rows).toEqual([]);
    expect(v.overlap).toBe(false);
  });

  it('E4: 取引 0 件 → total 0・行 0', () => {
    const v = reviewByReason([], { includeImports: false });
    expect([v.total, v.breached, v.rows.length]).toEqual([0, 0, 0]);
  });

  it('入力を変えない', () => {
    const copy = JSON.parse(JSON.stringify(E1));
    reviewByReason(E1, { includeImports: false });
    expect(JSON.parse(JSON.stringify(E1))).toEqual(copy);
  });
});

describe('breachKindsOf: 崩れの理由の種類（AC-2・AC-3）', () => {
  it('注記（決めた LC で切れた・逆指値で切れた・窓・滑り・早逃げ・過剰リスクを判定していない）は落とす', () => {
    const notes: Reason[] = [
      { kind: 'asPlannedLc' },
      { kind: 'stopFilled' },
      { kind: 'gapSlip' },
      { kind: 'earlyExit' },
      { kind: 'riskNotChecked', cause: 'noCapital' },
    ];
    expect(breachKindsOf(notes)).toEqual([]);
  });

  it('同じ種類の 2 回目（2 回のナンピン）は 1 つ・並びは 5.3 の表の順', () => {
    const reasons: Reason[] = [
      { kind: 'averagingDown', entryIndex: 1 },
      { kind: 'overRisk', riskPct: 2.4 },
      { kind: 'averagingDown', entryIndex: 2 },
      { kind: 'noLc' },
      { kind: 'earlyExit' },
    ];
    expect(breachKindsOf(reasons)).toEqual(['noLc', 'overRisk', 'averagingDown']);
  });

  it('崩れの理由の種類は B・C の 8 種（5.3 の表の順）', () => {
    expect(BREACH_KINDS).toEqual([
      'noLc',
      'lcCancelled',
      'lcWidened',
      'timeframeLonger',
      'heldPastLc',
      'overRisk',
      'amountBasedLc',
      'averagingDown',
    ]);
  });
});

/** 種つきの乱数の期間: 判定・R・崩れの理由（判定と矛盾しない組）・取り込み */
function randomItems(r: Rng): ReviewItem[] {
  const n = r.int(0, 30);
  return Array.from({ length: n }, (_, k) => {
    const grade = r.pick<Grade | null>(['A', 'safeWin', 'B', 'riskyWin', 'C', null]);
    const off = grade === 'B' || grade === 'riskyWin' || grade === 'C';
    const kinds: BreachKind[] = [];
    if (off) {
      const pool = grade === 'C' ? BREACH_KINDS : BREACH_KINDS.filter((x) => x !== 'noLc');
      const count = r.int(1, 3);
      for (let j = 0; j < count; j++) kinds.push(r.pick(pool));
      if (grade === 'C' && !kinds.includes('noLc')) kinds.push('noLc');
    }
    const rr =
      grade === null || r.bool(0.15)
        ? undefined
        : grade === 'safeWin' || grade === 'riskyWin'
          ? r.int(0, 40) / 10
          : -r.int(1, 50) / 10;
    return item(`x${k}`, grade, rr, breachKindsOf(kinds.map((kind) => ({ kind }))), r.bool(0.2));
  });
}

describe('reviewByReason: 性質（AC-4）', () => {
  it('行の件数 ≤ 崩れ ≤ 行の件数の和、行の規律コスト ≥ 期間の規律コスト ≥ 行の規律コストの和（どれも 0 以下）', () => {
    const TOL = 1e-9;
    forAll(239, 400, randomItems, (items) => {
      for (const include of [false, true]) {
        const v = reviewByReason(items, { includeImports: include });
        const period = reviewPeriod(items, { includeImports: include });
        const sum = v.rows.reduce((s, x) => s + x.review.total, 0);
        const costSum = v.rows.reduce((s, x) => s + x.review.cost, 0);
        const broken: string[] = [];
        if (v.total !== period.total) broken.push('total');
        if (v.breached > sum) broken.push('breached > sum');
        if (v.breached > v.total) broken.push('breached > total');
        for (const x of v.rows) {
          if (x.review.total > v.breached || x.review.total === 0) broken.push(`${x.kind} 件数`);
          if (x.review.cost > TOL) broken.push(`${x.kind} 規律コストが正`);
          if (x.review.cost < period.cost - TOL) broken.push(`${x.kind} < 期間`);
          // 行の取引はすべて崩れなので計画どおりは 0
          if (x.review.planned !== 0) broken.push(`${x.kind} 計画どおり`);
        }
        if (period.cost < costSum - TOL) broken.push('期間 < 行の和');
        if (!v.overlap) {
          if (sum !== v.breached) broken.push('重なりなしで件数の和が違う');
          if (Math.abs(costSum - period.cost) > TOL)
            broken.push('重なりなしで規律コストの和が違う');
        } else if (sum <= v.breached) broken.push('重なりありで件数の和が増えない');
        expect(broken).toEqual([]);
      }
    });
  });

  it('並び: 件数の多い順 → 5.3 の表の順', () => {
    forAll(2391, 300, randomItems, (items) => {
      const rows = reviewByReason(items, { includeImports: true }).rows;
      const broken: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1];
        const b = rows[i];
        if (!a || !b) continue;
        const ok =
          a.review.total > b.review.total ||
          (a.review.total === b.review.total &&
            BREACH_KINDS.indexOf(a.kind) < BREACH_KINDS.indexOf(b.kind));
        if (!ok) broken.push(`${a.kind} → ${b.kind}`);
      }
      expect(broken).toEqual([]);
    });
  });
});
