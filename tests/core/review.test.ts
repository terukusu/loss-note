// 期間の規律の集計（Issue #88 契約 P-1・例の表 S1〜S7。設計書 6.1・6.2）。値はすべて架空。
// 計画どおり率 = (A + 計画どおりの勝ち) ÷ 判定の出た取引、計画どおりの R = B・C の負けで R < −1.0 なら −1.0（ほかは実際の R）、
// 規律コスト = Σ(実際の R − 計画どおりの R)
import { describe, expect, it } from 'vitest';
import type { Grade } from '../../core/judge';
import {
  GRADE_KEYS,
  type PeriodReview,
  plannedROf,
  type ReviewItem,
  reviewPeriod,
} from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const DAY = 86_400_000;
const T0 = 1_763_000_000_000;

function item(
  i: number,
  grade: Grade | null,
  r?: number,
  over: Partial<ReviewItem> = {},
): ReviewItem {
  return {
    id: `t${i}`,
    exitTime: T0 + i * DAY,
    createdAt: 1_000 + i,
    grade,
    ...(r === undefined ? {} : { r }),
    imported: false,
    ...over,
  };
}

/** S1 の 7 件（決済の古い順）。入力の順はわざと崩す（並べ直すのは reviewPeriod） */
const S1_ORDERED: readonly ReviewItem[] = [
  item(1, 'A', -1.0),
  item(2, 'safeWin', 2.0),
  item(3, 'B', -1.6),
  item(4, 'riskyWin', 0.5),
  item(5, 'C'),
  item(6, 'A', -0.8),
  item(7, 'safeWin', 1.2),
];
const S1 = [...S1_ORDERED].reverse();

const near = (xs: readonly number[]) => xs.map((x) => Math.round(x * 1e9) / 1e9);

describe('reviewPeriod: 例の表', () => {
  it('S1: 率 4/7・内訳・累積 2 系列・規律コスト −0.6・運 1 件 +0.5・R なし 1 件', () => {
    const v = reviewPeriod(S1, { includeImports: false });
    expect(v.total).toBe(7);
    expect(v.counts).toEqual({ A: 2, safeWin: 2, B: 1, riskyWin: 1, C: 1, none: 0 });
    expect(v.judged).toBe(7);
    expect(v.planned).toBe(4);
    expect(v.rate).toBeCloseTo(4 / 7, 12);
    // 実際の累積 −1.0 → +1.0 → −0.6 → −0.1 → −0.9 → +0.3（5 番は R なしで飛ばす）
    expect(near(v.curve.map((p) => p.actualCum))).toEqual([-1, 1, -0.6, -0.1, -0.9, 0.3]);
    // 計画どおりの累積 −1.0 → +1.0 → 0.0（3 番 −1.6 → −1.0） → +0.5 → −0.3 → +0.9
    expect(near(v.curve.map((p) => p.plannedCum))).toEqual([-1, 1, 0, 0.5, -0.3, 0.9]);
    expect(v.curve.map((p) => p.id)).toEqual(['t1', 't2', 't3', 't4', 't6', 't7']);
    expect(v.cost).toBeCloseTo(-0.6, 12);
    expect(v.actualR).toBeCloseTo(0.3, 12);
    expect(v.plannedR).toBeCloseTo(0.9, 12);
    expect(v.luck.count).toBe(1);
    expect(v.luck.r).toBeCloseTo(0.5, 12);
    expect(v.noR).toBe(1);
    expect(v.imports).toBe(0);
    expect(v.excludedImports).toBe(0);
  });

  it('S2: 判定の出た取引が 3 件（A 1・B 2）→ 率は出さない（null）。内訳と曲線は出る', () => {
    const v = reviewPeriod([item(1, 'A', -1), item(2, 'B', -1.2), item(3, 'B', -0.5)], {
      includeImports: false,
    });
    expect(v.rate).toBeNull();
    expect(v.judged).toBe(3);
    expect(v.counts).toMatchObject({ A: 1, B: 2 });
    expect(v.curve).toHaveLength(3);
  });

  it('S2 の境: 判定の出た取引 5 件で率が出る・判定なしは分母に入れない', () => {
    const five = [1, 2, 3, 4, 5].map((i) => item(i, i <= 2 ? 'A' : 'B', -1));
    expect(reviewPeriod(five, { includeImports: false }).rate).toBeCloseTo(2 / 5, 12);
    const withNone = [...five.slice(0, 4), item(9, null)];
    const v = reviewPeriod(withNone, { includeImports: false });
    expect(v.judged).toBe(4);
    expect(v.rate).toBeNull();
    expect(v.counts.none).toBe(1);
  });

  it('S3: 0 件', () => {
    const v = reviewPeriod([], { includeImports: false });
    expect(v.total).toBe(0);
    expect(v.rate).toBeNull();
    expect(v.curve).toEqual([]);
    expect(v.cost).toBe(0);
    expect(v.actualR).toBe(0);
    expect(v.noR).toBe(0);
  });

  it('S4: S1 + 取り込み 2 件（A 1・B 1）。既定は外し、含めると 5/9', () => {
    const imp = [item(8, 'A', -1, { imported: true }), item(9, 'B', -1.3, { imported: true })];
    const off = reviewPeriod([...S1, ...imp], { includeImports: false });
    expect(off.total).toBe(7);
    expect(off.rate).toBeCloseTo(4 / 7, 12);
    expect(off.imports).toBe(2);
    expect(off.excludedImports).toBe(2);
    const on = reviewPeriod([...S1, ...imp], { includeImports: true });
    expect(on.total).toBe(9);
    expect(on.planned).toBe(5);
    expect(on.judged).toBe(9);
    expect(on.rate).toBeCloseTo(5 / 9, 12);
    expect(on.imports).toBe(2);
    expect(on.excludedImports).toBe(0);
    // 取り込みの B（−1.3R → −1.0R）の分だけ規律コストが増える: −0.6 + (−0.3) = −0.9
    expect(on.cost).toBeCloseTo(-0.9, 12);
  });

  it('S5: B（金額ありきの LC）−0.5R → 計画どおりも −0.5R、規律コスト 0', () => {
    const v = reviewPeriod([item(1, 'B', -0.5)], { includeImports: false });
    expect(v.curve[0]?.plannedR).toBe(-0.5);
    expect(v.cost).toBe(0);
  });

  it('S6: B（持ち続けた）−1.05R → 計画どおり −1.0R、規律コスト −0.05（表示は −0.1R）', () => {
    const v = reviewPeriod([item(1, 'B', -1.05)], { includeImports: false });
    expect(v.curve[0]?.plannedR).toBe(-1);
    expect(v.cost).toBeCloseTo(-0.05, 12);
  });

  it('S7: S1 の 3 番を除いた 6 件 → 4/6・規律コスト 0', () => {
    const v = reviewPeriod(
      S1.filter((i) => i.id !== 't3'),
      { includeImports: false },
    );
    expect(v.total).toBe(6);
    expect(v.rate).toBeCloseTo(4 / 6, 12);
    expect(v.cost).toBe(0);
  });
});

describe('plannedROf: 置き換えの境', () => {
  it.each([
    ['B', -1.6, -1],
    ['C', -2.5, -1],
    ['B', -1.0, -1.0],
    ['B', -1.0 - 5e-10, -1.0 - 5e-10],
    ['B', -1.05, -1],
    ['B', -0.5, -0.5],
    ['A', -1.3, -1.3],
    ['riskyWin', 0.5, 0.5],
    ['safeWin', 2, 2],
    [null, -3, -3],
  ] as const)('%s %s → %s', (g, r, want) => {
    expect(plannedROf(g, r)).toBe(want);
  });
});

describe('reviewPeriod: 並び', () => {
  it('決済の古い順 → 作った古い順 → ID の降順（一覧の並びの逆）', () => {
    const same = { exitTime: T0, createdAt: 5 };
    const v = reviewPeriod(
      [
        item(1, 'A', -1, { ...same, id: 'a' }),
        item(2, 'A', -1, { ...same, id: 'c' }),
        item(3, 'A', -1, { exitTime: T0, createdAt: 9, id: 'b' }),
        item(4, 'A', -1, { exitTime: T0 - 1, createdAt: 99, id: 'z' }),
      ],
      { includeImports: false },
    );
    expect(v.curve.map((p) => p.id)).toEqual(['z', 'c', 'a', 'b']);
  });

  it('入力を変えない', () => {
    const input = [...S1];
    const copy = JSON.stringify(input);
    reviewPeriod(input, { includeImports: true });
    expect(JSON.stringify(input)).toBe(copy);
  });
});

/** 種つきの乱数の取引（判定・R・取り込みの組み合わせ） */
function randomItems(r: Rng): ReviewItem[] {
  const n = r.int(0, 40);
  const grades: (Grade | null)[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', null];
  return Array.from({ length: n }, (_, i) => {
    const g = r.pick(grades);
    const hasR = r.bool(0.8);
    const mag = r.pick([0, 0.5, 1, 1 - 1e-12, 1 + 1e-12, 1.05, 2.7, 10]) * (r.bool() ? 1 : -1);
    return item(i, g, hasR ? mag : undefined, {
      exitTime: T0 + r.int(0, 5) * DAY,
      createdAt: r.int(0, 3),
      imported: r.bool(0.3),
    });
  });
}

function checkProperties(items: readonly ReviewItem[], v: PeriodReview, include: boolean) {
  const target = include ? items : items.filter((i) => !i.imported);
  // 件数の合計 = 対象の件数
  expect(GRADE_KEYS.reduce((s, k) => s + v.counts[k], 0)).toBe(target.length);
  expect(v.total).toBe(target.length);
  // 曲線の長さ + R なし = 対象の件数
  expect(v.curve.length + v.noR).toBe(target.length);
  // 各点で 計画どおりの R ≧ 実際の R、規律コスト ≦ 0
  for (const p of v.curve) expect(p.plannedR).toBeGreaterThanOrEqual(p.r);
  expect(v.cost).toBeLessThanOrEqual(0);
  // 最後の実際の累積 = Σr、計画どおり − 実際 = −規律コスト
  const sumR = target.reduce((s, i) => s + (i.r ?? 0), 0);
  expect(v.actualR).toBeCloseTo(sumR, 9);
  expect(v.plannedR - v.actualR).toBeCloseTo(-v.cost, 9);
  // 分母は判定の出た取引（判定なしを除く）・分子は A + 計画どおりの勝ち
  expect(v.judged).toBe(v.total - v.counts.none);
  expect(v.planned).toBe(v.counts.A + v.counts.safeWin);
  expect(v.planned).toBeLessThanOrEqual(v.judged);
  if (v.rate !== null) expect(v.rate).toBe(v.planned / v.judged);
  // 計画どおりの累積は、どの点でも実際の累積を下回らない（置き換えは損を小さくする向きだけ。6.2）
  for (const p of v.curve) expect(p.plannedCum).toBeGreaterThanOrEqual(p.actualCum - 1e-9);
  // 率は 0〜1、判定の出た取引 5 件未満なら null
  if (v.judged < 5) expect(v.rate).toBeNull();
  else {
    expect(v.rate).not.toBeNull();
    expect(v.rate ?? -1).toBeGreaterThanOrEqual(0);
    expect(v.rate ?? 2).toBeLessThanOrEqual(1);
  }
  for (const x of [v.cost, v.actualR, v.plannedR, v.luck.r]) expect(Number.isNaN(x)).toBe(false);
}

describe('reviewPeriod: 性質', () => {
  it('件数の合計・曲線 + R なし・計画どおり ≧ 実際・規律コスト ≦ 0・累積の最後 = 和', () => {
    forAll(88, 400, randomItems, (items) => {
      for (const include of [false, true]) {
        checkProperties(items, reviewPeriod(items, { includeImports: include }), include);
      }
    });
  });

  it('含めると外すの差は取り込みの件数だけ', () => {
    forAll(8801, 200, randomItems, (items) => {
      const on = reviewPeriod(items, { includeImports: true });
      const off = reviewPeriod(items, { includeImports: false });
      expect(on.total - off.total).toBe(off.excludedImports);
      expect(on.imports).toBe(off.imports);
    });
  });

  it('入力の順によらない（並べ直しても同じ結果）', () => {
    forAll(8802, 200, randomItems, (items) => {
      const a = reviewPeriod(items, { includeImports: true });
      const b = reviewPeriod([...items].reverse(), { includeImports: true });
      expect(b.curve.map((p) => p.id)).toEqual(a.curve.map((p) => p.id));
      expect(b.counts).toEqual(a.counts);
    });
  });
});
