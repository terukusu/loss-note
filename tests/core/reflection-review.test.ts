// Good / More の話題ごとの規律の集計（Issue #221。設計書 6.1・6.2・9.4・C58）。値はすべて架空。
// 行 = その話題（自分で書いた行）が付いた取引の部分集合への reviewPeriod。計画どおり率 = (A + 計画どおりの勝ち) ÷ 判定の出た取引、
// 規律コスト = Σ(実際の R − 計画どおりの R)（計画どおりの R = B・C の負けで R < −1.0 なら −1.0）
import { describe, expect, it } from 'vitest';
import type { Grade } from '../../core/judge';
import {
  REFLECTION_SIDES,
  REFLECTION_TOPICS,
  type Reflection,
  type ReflectionPart,
  type ReflectionSide,
  type ReflectionTopicId,
} from '../../core/reflection';
import {
  REFLECTION_NOTES,
  type ReviewItem,
  reviewByEmotion,
  reviewByReflection,
  reviewPeriod,
} from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const DAY = 86_400_000;
const T0 = 1_763_000_000_000;

interface Sides {
  readonly good?: readonly ReflectionTopicId[];
  readonly more?: readonly ReflectionTopicId[];
  readonly goodNotes?: number;
  readonly moreNotes?: number;
}

const part = (topics: readonly ReflectionTopicId[] = [], notes = 0): ReflectionPart => ({
  topics,
  notes: Array.from({ length: notes }, (_, i) => `架空の行 ${i + 1}`),
});

function item(
  id: string,
  grade: Grade | null,
  r: number | undefined,
  s: Sides,
  imported = false,
): ReviewItem {
  const n = Number(id.replace(/\D/g, '')) || 0;
  const reflection: Reflection = {
    good: part(s.good, s.goodNotes),
    more: part(s.more, s.moreNotes),
  };
  const empty =
    reflection.good.topics.length + reflection.good.notes.length === 0 &&
    reflection.more.topics.length + reflection.more.notes.length === 0;
  return {
    id,
    exitTime: T0 + n * DAY,
    createdAt: n,
    grade,
    ...(r === undefined ? {} : { r }),
    imported,
    ...(empty ? {} : { reflection }),
  };
}

/** Issue の例 E1 の期間の取引（消した印の X1 は呼ぶ側が外すのでここには無い）。I1 は取り込み */
const E1: readonly ReviewItem[] = [
  item('t1', 'A', -1.0, { good: ['cutEarly', 'followedRules'] }),
  item('t2', 'B', -1.6, { more: ['enteredEarly', 'oversized'] }),
  item('t3', 'B', -2.0, { more: ['oversized'] }),
  item('t4', 'C', undefined, { more: ['oversized', 'noExitPlan'] }),
  item('t5', 'riskyWin', 1.0, { more: ['oversized'] }),
  item('t6', 'B', -1.2, { more: ['oversized'], moreNotes: 2 }),
  item('t7', 'A', -1.0, { good: ['cutEarly', 'followedRules'] }),
  item('t8', 'safeWin', 2.0, { good: ['followedRules', 'letProfitRun'] }),
  item('t9', 'A', -0.9, { good: ['cutEarly', 'followedRules'], goodNotes: 1 }),
  item('t10', 'A', -1.0, {}),
  item('t11', 'safeWin', 1.5, { good: ['followedRules'] }),
  item('i1', 'B', -1.5, { more: ['oversized'] }, true),
];

const rowsOf = (v: ReturnType<typeof reviewByReflection>) =>
  v.rows.map((r) => [r.key, r.review.total]);

describe('reviewByReflection: 例 E1〜E4（手計算）', () => {
  it('E1 More: 11 件のうち 5 件に記入・数量が多すぎた 0 / 5 で −1.8R・1 件の行は一覧の順・自分で書いた行は最後', () => {
    const v = reviewByReflection(E1, 'more', { includeImports: false });
    expect([v.side, v.total, v.written, v.excludedImports, v.overlap]).toEqual([
      'more',
      11,
      5,
      1,
      true,
    ]);
    expect(rowsOf(v)).toEqual([
      ['oversized', 5],
      ['enteredEarly', 1],
      ['noExitPlan', 1],
      [REFLECTION_NOTES, 1],
    ]);
    const over = v.rows[0]?.review;
    // B 3（t2・t3・t6）・C 1（t4）・危ない勝ち 1（t5）→ 0 / 5。
    // 規律コスト = (−1.6 − −1.0) + (−2.0 − −1.0) + (−1.2 − −1.0) + 危ない勝ち 0 = −0.6 − 1.0 − 0.2 = −1.8（t4 は R なし）
    expect([over?.planned, over?.judged, over?.rate, over?.noR]).toEqual([0, 5, 0, 1]);
    expect(over?.cost).toBeCloseTo(-1.8, 9);
    // 1 件の行は判定の出た取引が 5 件未満 → 率は null
    for (const r of v.rows.slice(1)) expect(r.review.rate).toBeNull();
    // 自分で書いた行は行が 2 行でも取引 1 件
    expect(v.rows[3]?.review.curve.map((p) => p.id)).toEqual(['t6']);
  });

  it('E2 Good: ルールどおりに動けた 5 / 5 で ±0・早めに撤退できた 3 件・利を伸ばせた 1 件・自分で書いた行 1 件', () => {
    const v = reviewByReflection(E1, 'good', { includeImports: false });
    expect([v.total, v.written, v.overlap]).toEqual([11, 5, true]);
    expect(rowsOf(v)).toEqual([
      ['followedRules', 5],
      ['cutEarly', 3],
      ['letProfitRun', 1],
      [REFLECTION_NOTES, 1],
    ]);
    // A 3（t1・t7・t9）・計画どおりの勝ち 2（t8・t11）→ 5 / 5。B・C が無いので置き換えなし → 規律コスト 0
    const rules = v.rows[0]?.review;
    expect([rules?.planned, rules?.judged, rules?.rate, rules?.cost]).toEqual([5, 5, 1, 0]);
    // 早めに撤退できた: 判定の出た取引 3 件 → 率なし
    expect([v.rows[1]?.review.judged, v.rows[1]?.review.rate]).toEqual([3, null]);
  });

  it('E3: 取り込みを含めると More は 12 件のうち 6 件・数量が多すぎた 0 / 6 で −2.3R（I1 の −1.5 → −0.5 を足す）・Good は 12 件のうち 5 件', () => {
    const more = reviewByReflection(E1, 'more', { includeImports: true });
    expect([more.total, more.written, more.excludedImports]).toEqual([12, 6, 0]);
    expect(more.rows[0]?.key).toBe('oversized');
    expect([more.rows[0]?.review.planned, more.rows[0]?.review.judged]).toEqual([0, 6]);
    expect(more.rows[0]?.review.cost).toBeCloseTo(-2.3, 9);
    const good = reviewByReflection(E1, 'good', { includeImports: true });
    expect([good.total, good.written]).toEqual([12, 5]);
    expect(rowsOf(good)).toEqual(rowsOf(reviewByReflection(E1, 'good', { includeImports: false })));
  });

  it('E4: 話題 1 つずつ・自分で書いた行なし → 重なりなし・行の和 = 記入。同じ件数は一覧の順', () => {
    const items = [
      item('a1', 'B', -1.4, { more: ['oversized'] }),
      item('a2', 'A', -1, { more: ['lcTooTight'] }),
      item('a3', 'A', -1, { more: ['oversized'] }),
    ];
    const v = reviewByReflection(items, 'more', { includeImports: false });
    expect(v.overlap).toBe(false);
    expect(rowsOf(v)).toEqual([
      ['oversized', 2],
      ['lcTooTight', 1],
    ]);
    expect(v.written).toBe(3);
    const tie = reviewByReflection(
      [
        item('b1', 'A', -1, { more: ['orderMistake'] }),
        item('b2', 'A', -1, { more: ['enteredEarly'] }),
      ],
      'more',
      { includeImports: false },
    );
    expect(tie.rows.map((r) => r.key)).toEqual(['enteredEarly', 'orderMistake']);
  });

  it('自分で書いた行は件数が多くても最後', () => {
    const items = [
      item('n1', 'A', -1, { goodNotes: 1 }),
      item('n2', 'A', -1, { goodNotes: 3 }),
      item('n3', 'A', -1, { good: ['readRight'] }),
    ];
    const v = reviewByReflection(items, 'good', { includeImports: false });
    expect(rowsOf(v)).toEqual([
      ['readRight', 1],
      [REFLECTION_NOTES, 2],
    ]);
    expect([v.written, v.overlap]).toEqual([3, false]);
  });

  it('何も付いていない・空の期間は行 0。ほかの側だけの取引は記入に入らない', () => {
    expect(reviewByReflection([], 'good', { includeImports: false })).toEqual({
      side: 'good',
      total: 0,
      written: 0,
      excludedImports: 0,
      overlap: false,
      rows: [],
    });
    const v = reviewByReflection([item('x1', 'A', -1, { more: ['oversized'] })], 'good', {
      includeImports: false,
    });
    expect([v.total, v.written, v.rows.length]).toEqual([1, 0, 0]);
  });

  it('KEEP-1: Good / More は心理の集計・期間の集計を変えない', () => {
    const plain = E1.map(({ reflection: _r, ...rest }) => rest);
    for (const include of [false, true]) {
      expect(reviewPeriod(E1, { includeImports: include })).toEqual(
        reviewPeriod(plain, { includeImports: include }),
      );
      expect(reviewByEmotion(E1, { includeImports: include })).toEqual(
        reviewByEmotion(plain, { includeImports: include }),
      );
    }
  });
});

/** 種つきの乱数の取引（判定・R・取り込み・側ごとに 0〜3 個の話題と 0〜2 行） */
function randomItems(r: Rng): ReviewItem[] {
  const n = r.int(0, 40);
  const grades: (Grade | null)[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', null];
  return Array.from({ length: n }, (_, i) => {
    const pick = (side: ReflectionSide) => {
      const all = REFLECTION_TOPICS[side] as readonly ReflectionTopicId[];
      const set = new Set<ReflectionTopicId>();
      for (let j = r.int(0, 3); j > 0; j--) set.add(r.pick(all));
      return all.filter((t) => set.has(t));
    };
    const hasR = r.bool(0.8);
    const mag = r.pick([0, 0.5, 1, 1.05, 2.7, 10]) * (r.bool() ? 1 : -1);
    return item(
      `p${i}`,
      r.pick(grades),
      hasR ? mag : undefined,
      {
        good: pick('good'),
        more: pick('more'),
        goodNotes: r.pick([0, 0, 1, 2]),
        moreNotes: r.pick([0, 0, 1, 2]),
      },
      r.bool(0.3),
    );
  });
}

const keysOf = (i: ReviewItem, side: ReflectionSide): string[] => {
  const p = i.reflection?.[side];
  return [...(p?.topics ?? []), ...((p?.notes.length ?? 0) > 0 ? [REFLECTION_NOTES] : [])];
};

describe('reviewByReflection: 性質', () => {
  it('記入 ≦ 対象・行の和 = Σ 取引ごとの行の数 ≧ 記入・重なり ⇔ 2 つ以上の行・行 = 部分集合の reviewPeriod・規律コスト ≦ 0', () => {
    forAll(221, 300, randomItems, (items) => {
      for (const side of REFLECTION_SIDES) {
        for (const include of [false, true]) {
          const v = reviewByReflection(items, side, { includeImports: include });
          const target = include ? items : items.filter((i) => !i.imported);
          const sum = v.rows.reduce((s, row) => s + row.review.total, 0);
          expect({
            total: v.total,
            written: v.written,
            sum,
            overlap: v.overlap,
            excluded: v.excludedImports,
          }).toEqual({
            total: target.length,
            written: target.filter((i) => keysOf(i, side).length > 0).length,
            sum: target.reduce((s, i) => s + keysOf(i, side).length, 0),
            overlap: target.some((i) => keysOf(i, side).length > 1),
            excluded: include ? 0 : items.length - target.length,
          });
          expect(v.written).toBeLessThanOrEqual(v.total);
          expect(sum).toBeGreaterThanOrEqual(v.written);
          for (const row of v.rows) {
            expect(row.review.total).toBeGreaterThan(0);
            expect(row.review.cost).toBeLessThanOrEqual(0);
            expect(Number.isNaN(row.review.cost)).toBe(false);
            expect(row.review).toEqual(
              reviewPeriod(
                target.filter((i) => keysOf(i, side).includes(row.key)),
                { includeImports: true },
              ),
            );
          }
        }
      }
    });
  });

  it('並び: 話題は件数の降順・同じ件数は一覧の順・自分で書いた行は最後。入力を変えない', () => {
    forAll(2211, 300, randomItems, (items) => {
      const before = JSON.stringify(items);
      for (const side of REFLECTION_SIDES) {
        const rows = reviewByReflection(items, side, { includeImports: true }).rows;
        const notesAt = rows.findIndex((r) => r.key === REFLECTION_NOTES);
        expect(notesAt === -1 || notesAt === rows.length - 1).toBe(true);
        const topics = rows.filter((r) => r.key !== REFLECTION_NOTES);
        const order = REFLECTION_TOPICS[side] as readonly string[];
        for (let i = 1; i < topics.length; i++) {
          const a = topics[i - 1];
          const b = topics[i];
          if (!a || !b) continue;
          const ok =
            a.review.total > b.review.total ||
            (a.review.total === b.review.total && order.indexOf(a.key) < order.indexOf(b.key));
          expect(ok).toBe(true);
        }
      }
      expect(JSON.stringify(items)).toBe(before);
    });
  });
});
