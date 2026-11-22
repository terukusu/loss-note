// 心理のタグごとの規律の集計（Issue #162。設計書 6.1・6.2・9.4）。値はすべて架空。
// 行 = そのタグが付いた取引の部分集合への reviewPeriod。計画どおり率 = (A + 計画どおりの勝ち) ÷ 判定の出た取引、
// 規律コスト = Σ(実際の R − 計画どおりの R)（計画どおりの R = B・C の負けで R < −1.0 なら −1.0）
import { describe, expect, it } from 'vitest';
import { CALM, EMOTION_TAG_IDS, type EmotionTagId } from '../../core/emotion-tags';
import type { Grade } from '../../core/judge';
import { type ReviewItem, reviewByEmotion, reviewPeriod } from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const DAY = 86_400_000;
const T0 = 1_763_000_000_000;

function item(
  id: string,
  grade: Grade | null,
  r: number | undefined,
  emotions: readonly EmotionTagId[],
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
    ...(emotions.length > 0 ? { emotions } : {}),
  };
}

/**
 * Issue の例 E1 の期間の取引（消した印の T12・期間の外の T13 は呼ぶ側が外すのでここには無い）。I1・I2 は取り込み
 */
const E1: readonly ReviewItem[] = [
  item('t1', 'A', -1.0, ['calm']),
  item('t2', 'A', -0.9, ['calm']),
  item('t3', 'safeWin', 2.0, ['calm']),
  item('t4', 'A', -1.0, ['calm']),
  item('t5', 'safeWin', 1.5, ['calm']),
  item('t6', 'B', -1.6, ['wantPosition', 'recoup']),
  item('t7', 'B', -2.0, ['recoup']),
  item('t8', 'riskyWin', 1.0, ['overconfident', 'recoup']),
  item('t9', 'C', undefined, ['recoup', 'cantCut']),
  item('t10', 'A', -1.0, []),
  item('t11', 'B', -1.2, ['wantProfit', 'recoup']),
  item('i1', 'B', -1.5, ['recoup'], true),
  item('i2', 'A', -1.0, ['calm'], true),
];

describe('reviewByEmotion: 例 E1・E2（手計算）', () => {
  it('E1: 11 件のうち 10 件に記入・平常心 5 / 5 で ±0・取り戻したい 0 / 5 で −1.8R・残りは 1 件ずつ一覧の順', () => {
    const v = reviewByEmotion(E1, { includeImports: false });
    expect(v.total).toBe(11);
    expect(v.tagged).toBe(10);
    expect(v.excludedImports).toBe(2);
    expect(v.overlap).toBe(true);
    expect(v.rows.map((r) => [r.id, r.review.total])).toEqual([
      ['calm', 5],
      ['recoup', 5],
      ['wantProfit', 1],
      ['wantPosition', 1],
      ['overconfident', 1],
      ['cantCut', 1],
    ]);
    // 行の件数の和 14 ≠ 記入 10
    expect(v.rows.reduce((s, r) => s + r.review.total, 0)).toBe(14);
    const calm = v.rows[0]?.review;
    // 平常心: A 3・計画どおりの勝ち 2 → 5 / 5。B・C が無いので置き換えなし → 規律コスト 0
    expect(calm?.planned).toBe(5);
    expect(calm?.judged).toBe(5);
    expect(calm?.rate).toBe(1);
    expect(calm?.cost).toBe(0);
    expect(calm?.noR).toBe(0);
    const recoup = v.rows[1]?.review;
    // 取り戻したい: B 3・危ない勝ち 1・C 1 → 0 / 5。
    // 規律コスト = (−1.6 − −1.0) + (−2.0 − −1.0) + (−1.2 − −1.0) + (危ない勝ち 0) = −0.6 − 1.0 − 0.2 = −1.8（T9 は R なし）
    expect(recoup?.planned).toBe(0);
    expect(recoup?.judged).toBe(5);
    expect(recoup?.rate).toBe(0);
    expect(recoup?.cost).toBeCloseTo(-1.8, 9);
    expect(recoup?.noR).toBe(1);
    // 件数が少ない行は率が null（判定の出た取引 1 件）
    for (const r of v.rows.slice(2)) expect(r.review.rate).toBeNull();
  });

  it('E2: 取り込みを含めると 13 件のうち 12 件・平常心 6 / 6・取り戻したい 0 / 6 で −2.3R（I1 の −1.5 → −0.5 を足す）', () => {
    const v = reviewByEmotion(E1, { includeImports: true });
    expect([v.total, v.tagged, v.excludedImports]).toEqual([13, 12, 0]);
    expect(v.rows[0]?.id).toBe('calm');
    expect([v.rows[0]?.review.planned, v.rows[0]?.review.judged]).toEqual([6, 6]);
    expect(v.rows[0]?.review.cost).toBe(0);
    expect(v.rows[1]?.id).toBe('recoup');
    expect([v.rows[1]?.review.planned, v.rows[1]?.review.judged]).toEqual([0, 6]);
    expect(v.rows[1]?.review.cost).toBeCloseTo(-2.3, 9);
  });

  it('E8: タグ 1 つずつ（平常心 5・悔しい 2）→ 重なりなし・行の和 = 記入', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => item(`c${i}`, 'A', -1, ['calm'])),
      item('f1', 'B', -1.4, ['frustrated']),
      item('f2', 'A', -1, ['frustrated']),
    ];
    const v = reviewByEmotion(items, { includeImports: false });
    expect(v.overlap).toBe(false);
    expect(v.rows.map((r) => [r.id, r.review.total])).toEqual([
      ['calm', 5],
      ['frustrated', 2],
    ]);
    expect(v.tagged).toBe(7);
  });

  it('平常心は件数が少なくても先頭・同じ件数は一覧の順・タグの無い取引は行にも記入にも入らない', () => {
    const items = [
      item('a1', 'A', -1, ['calm']),
      item('a2', 'B', -2, ['regret']),
      item('a3', 'B', -2, ['regret']),
      item('a4', 'A', -1, ['fear']),
      item('a5', 'A', -1, ['fear']),
      item('a6', 'A', -1, []),
    ];
    const v = reviewByEmotion(items, { includeImports: false });
    expect(v.rows.map((r) => r.id)).toEqual(['calm', 'fear', 'regret']);
    expect([v.total, v.tagged]).toEqual([6, 5]);
  });

  it('保存した値が平常心の排他の約束を外れた（平常心 + 取り戻したい）取引は、両方の行に 1 件ずつ入る', () => {
    const v = reviewByEmotion(
      [item('q1', 'B', -1.5, ['calm', 'recoup']), item('q2', 'A', -1, ['calm'])],
      { includeImports: false },
    );
    expect(v.rows.map((r) => [r.id, r.review.total])).toEqual([
      ['calm', 2],
      ['recoup', 1],
    ]);
    expect([v.tagged, v.overlap]).toEqual([2, true]);
    // 規律コストは両方の行に −0.5（−1.5 → −1.0）
    expect(v.rows.map((r) => Math.round(r.review.cost * 10) / 10)).toEqual([-0.5, -0.5]);
  });

  it('タグが無い・空の期間は行 0', () => {
    expect(reviewByEmotion([], { includeImports: false })).toEqual({
      total: 0,
      tagged: 0,
      excludedImports: 0,
      overlap: false,
      rows: [],
    });
    const v = reviewByEmotion([item('x1', 'A', -1, []), item('x2', 'B', -1.2, [])], {
      includeImports: false,
    });
    expect([v.total, v.tagged, v.rows.length]).toEqual([2, 0, 0]);
  });
});

/** 種つきの乱数の取引（判定・R・取り込み・0〜4 個のタグ） */
function randomItems(r: Rng, maxTags = 4): ReviewItem[] {
  const n = r.int(0, 40);
  const grades: (Grade | null)[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', null];
  return Array.from({ length: n }, (_, i) => {
    const k = r.int(0, maxTags);
    const tags = new Set<EmotionTagId>();
    for (let j = 0; j < k; j++) tags.add(r.pick(EMOTION_TAG_IDS));
    const hasR = r.bool(0.8);
    const mag = r.pick([0, 0.5, 1, 1.05, 2.7, 10]) * (r.bool() ? 1 : -1);
    return item(
      `p${i}`,
      r.pick(grades),
      hasR ? mag : undefined,
      EMOTION_TAG_IDS.filter((t) => tags.has(t)),
      r.bool(0.3),
    );
  });
}

describe('reviewByEmotion: 性質', () => {
  it('行の件数の和 ≧ 記入 ≦ 対象・各行 ≦ 記入・0 件の行なし・重なり ⇔ 2 つ以上のタグ・行 = 部分集合の reviewPeriod', () => {
    forAll(162, 400, randomItems, (items) => {
      for (const include of [false, true]) {
        const v = reviewByEmotion(items, { includeImports: include });
        const target = include ? items : items.filter((i) => !i.imported);
        const sum = v.rows.reduce((s, r) => s + r.review.total, 0);
        expect(v.total).toBe(target.length);
        expect(v.tagged).toBe(target.filter((i) => (i.emotions?.length ?? 0) > 0).length);
        expect(v.tagged).toBeLessThanOrEqual(v.total);
        expect(sum).toBeGreaterThanOrEqual(v.tagged);
        // 行の件数の和 = Σ 取引ごとのタグの数
        expect(sum).toBe(target.reduce((s, i) => s + (i.emotions?.length ?? 0), 0));
        expect(v.overlap).toBe(target.some((i) => (i.emotions?.length ?? 0) > 1));
        if (!v.overlap) expect(sum).toBe(v.tagged);
        for (const row of v.rows) {
          expect(row.review.total).toBeGreaterThan(0);
          expect(row.review.total).toBeLessThanOrEqual(v.tagged);
          expect(row.review.cost).toBeLessThanOrEqual(0);
          const subset = target.filter((i) => i.emotions?.includes(row.id));
          expect(row.review).toEqual(reviewPeriod(subset, { includeImports: true }));
        }
      }
    });
  });

  it('並び: 平常心が先頭・ほかは件数の降順・同じ件数は一覧の順', () => {
    forAll(1621, 300, randomItems, (items) => {
      const rows = reviewByEmotion(items, { includeImports: true }).rows;
      const calmAt = rows.findIndex((r) => r.id === CALM);
      expect(calmAt === -1 || calmAt === 0).toBe(true);
      const rest = rows.filter((r) => r.id !== CALM);
      for (let i = 1; i < rest.length; i++) {
        const a = rest[i - 1];
        const b = rest[i];
        if (!a || !b) continue;
        expect(a.review.total).toBeGreaterThanOrEqual(b.review.total);
        if (a.review.total === b.review.total) {
          expect(EMOTION_TAG_IDS.indexOf(a.id)).toBeLessThan(EMOTION_TAG_IDS.indexOf(b.id));
        }
      }
    });
  });

  it('タグ 1 つだけの取引の集合: 行の件数の和 = 記入、行の規律コストの和 = 記入した取引の規律コスト', () => {
    forAll(
      1622,
      300,
      (r) => randomItems(r, 1),
      (items) => {
        const v = reviewByEmotion(items, { includeImports: false });
        expect(v.overlap).toBe(false);
        expect(v.rows.reduce((s, r) => s + r.review.total, 0)).toBe(v.tagged);
        const taggedItems = items.filter((i) => (i.emotions?.length ?? 0) > 0);
        const whole = reviewPeriod(taggedItems, { includeImports: false });
        expect(v.rows.reduce((s, r) => s + r.review.cost, 0)).toBeCloseTo(whole.cost, 9);
        expect(v.rows.reduce((s, r) => s + r.review.planned, 0)).toBe(whole.planned);
        expect(v.rows.reduce((s, r) => s + r.review.judged, 0)).toBe(whole.judged);
      },
    );
  });

  it('重なりがあると、行の規律コストの和は記入した取引の規律コスト以下（同じ崩れを各行に数える）', () => {
    forAll(1623, 300, randomItems, (items) => {
      const v = reviewByEmotion(items, { includeImports: true });
      const whole = reviewPeriod(
        items.filter((i) => (i.emotions?.length ?? 0) > 0),
        { includeImports: true },
      );
      expect(v.rows.reduce((s, r) => s + r.review.cost, 0)).toBeLessThanOrEqual(whole.cost + 1e-9);
    });
  });

  it('入力の順によらない・入力を変えない', () => {
    forAll(1624, 200, randomItems, (items) => {
      const copy = structuredClone(items);
      const a = reviewByEmotion(items, { includeImports: true });
      const b = reviewByEmotion([...items].reverse(), { includeImports: true });
      expect(b.rows.map((r) => [r.id, r.review.total, r.review.cost])).toEqual(
        a.rows.map((r) => [r.id, r.review.total, r.review.cost]),
      );
      expect(items).toEqual(copy);
    });
  });
});
