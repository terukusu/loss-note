// 連勝の後（Issue #185。設計書 6.1）。値はすべて架空。
// 連勝の後 = 対象（取り込みは切り替えに従う）を決済の古い順に並べ、直前の 2 件がどちらも判定の勝ち（計画どおりの勝ち・危ない勝ち）。
// 値は連勝の後の部分集合への reviewPeriod: 計画どおり率 = (A + 計画どおりの勝ち) ÷ 判定の出た取引、
// 規律コスト = Σ(実際の R − 計画どおりの R)（計画どおりの R = B・C の負けで R < −1.0 なら −1.0）
import { describe, expect, it } from 'vitest';
import { EMOTION_TAG_IDS, type EmotionTagId } from '../../core/emotion-tags';
import type { Grade } from '../../core/judge';
import {
  afterWinStreak,
  isWinGrade,
  type ReviewItem,
  reviewAfterWinStreak,
  reviewPeriod,
  WIN_STREAK_MIN,
} from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const MIN = 60_000;
const T0 = 1_763_000_000_000;

/** n 番目に決済した取引（n が大きいほど新しい） */
function item(
  n: number,
  id: string,
  grade: Grade | null,
  r: number | undefined,
  emotions: readonly EmotionTagId[] = [],
  imported = false,
): ReviewItem {
  return {
    id,
    exitTime: T0 + n * MIN,
    createdAt: n,
    grade,
    ...(r === undefined ? {} : { r }),
    imported,
    ...(emotions.length > 0 ? { emotions } : {}),
  };
}

const ids = (s: ReadonlySet<string>) => [...s].sort();

/**
 * 例 B の S の期間（O1 = 期間の外・D1 = 消した印は呼ぶ側が外すのでここには無い。I1 は取り込み）。
 * 並び: S1 W · S2 危ない勝ち · S3 B · S4 W · S5 W · S6 B · S7 A · S8 C · S9 W · I1 W(取り込み) · S10 A
 */
const S: readonly ReviewItem[] = [
  item(1, 's1', 'safeWin', 1.0, ['calm']),
  item(2, 's2', 'riskyWin', 1.0),
  item(4, 's3', 'B', -1.6, ['overconfident']),
  item(5, 's4', 'safeWin', 1.0),
  item(6, 's5', 'safeWin', 1.0, ['overconfident']),
  item(7, 's6', 'B', -2.0, ['wantPosition', 'overconfident']),
  item(8, 's7', 'A', -1.0, ['calm']),
  item(9, 's8', 'C', undefined, ['hope']),
  item(10, 's9', 'safeWin', 1.0),
  item(11, 'i1', 'safeWin', 1.0, [], true),
  item(12, 's10', 'A', -1.0, ['overconfident']),
];
const O1 = item(0, 'o1', 'safeWin', 1.0);
const D1 = item(3, 'd1', 'B', -1.2);

/** 決済の古い順の判定と R の並び → 取引（ID = x1, x2, …） */
function seq(gs: readonly [Grade | null, number | undefined][], over: readonly number[] = []) {
  return gs.map(([g, r], k) =>
    item(k + 1, `x${k + 1}`, g, r, over.includes(k + 1) ? ['overconfident'] : []),
  );
}
const W: [Grade, number] = ['safeWin', 1.0];

describe('afterWinStreak: 例 B（手計算）', () => {
  it('B1: 取り込みを含めない → S3・S6（S2 は直前の勝ちが S1 だけ・S5 は直前が S3（負け）・S10 は直前が S8（C））', () => {
    expect(ids(afterWinStreak(S, { includeImports: false }))).toEqual(['s3', 's6']);
  });

  it('B1: 期間の外の O1 を並びに入れていれば S2 も入る（入れないので入らない）', () => {
    expect(afterWinStreak([O1, ...S], { includeImports: false }).has('s2')).toBe(true);
    expect(afterWinStreak(S, { includeImports: false }).has('s2')).toBe(false);
  });

  it('B1: 消した印の D1（B）を並びに入れていれば S3 は入らない（入れないので入る）', () => {
    expect(afterWinStreak([...S, D1], { includeImports: false }).has('s3')).toBe(false);
    expect(afterWinStreak(S, { includeImports: false }).has('s3')).toBe(true);
  });

  it('B2: 取り込みを含める → S3・S6・S10（S10 の直前が S9・I1。I1 自身は直前が S8・S9 で入らない）', () => {
    expect(ids(afterWinStreak(S, { includeImports: true }))).toEqual(['s10', 's3', 's6']);
  });

  it('B3: W W B W W A W W B W W A W W A → 3・6・9・12・15 件目', () => {
    const xs = seq([
      W,
      W,
      ['B', -1.5],
      W,
      W,
      ['A', -1.0],
      W,
      W,
      ['B', -2.0],
      W,
      W,
      ['A', -1.0],
      W,
      W,
      ['A', -0.8],
    ]);
    expect(ids(afterWinStreak(xs, { includeImports: false }))).toEqual(
      ['x3', 'x6', 'x9', 'x12', 'x15'].sort(),
    );
  });

  it('B4: W W W W → 3・4 件目（3 連勝目も連勝の後）', () => {
    expect(ids(afterWinStreak(seq([W, W, W, W]), { includeImports: false }))).toEqual(['x3', 'x4']);
  });

  it('B5: W A W 判定なし W W → 0 件（A・判定なしが連勝を切る）', () => {
    const xs = seq([W, ['A', -1.0], W, [null, undefined], W, W], [5]);
    expect(afterWinStreak(xs, { includeImports: false }).size).toBe(0);
  });

  it('危ない勝ちも勝ち・損益 0 の勝ちも勝ち（判定に従う）', () => {
    expect(isWinGrade('riskyWin')).toBe(true);
    expect(isWinGrade('safeWin')).toBe(true);
    for (const g of ['A', 'B', 'C', null] as const) expect(isWinGrade(g)).toBe(false);
    const xs = seq([
      ['riskyWin', 0.5],
      ['safeWin', 0],
      ['B', -1.2],
    ]);
    expect(ids(afterWinStreak(xs, { includeImports: false }))).toEqual(['x3']);
  });

  it('同じ決済の時刻は作った順（一覧の並びの逆）で並べる', () => {
    const a = { ...item(1, 'a', 'safeWin', 1), exitTime: T0, createdAt: 1 };
    const b = { ...item(2, 'b', 'safeWin', 1), exitTime: T0, createdAt: 2 };
    const c = { ...item(3, 'c', 'B', -1.2), exitTime: T0, createdAt: 3 };
    expect(ids(afterWinStreak([c, b, a], { includeImports: false }))).toEqual(['c']);
  });
});

describe('reviewAfterWinStreak: 例 B の値と重なり（手計算）', () => {
  it('B1: 2 件（判定の出た取引 2 = 件数が少ない）・調子に乗った 4 件のうち連勝の後 2 件', () => {
    const v = reviewAfterWinStreak(S, { includeImports: false });
    expect(v.total).toBe(10);
    expect(v.review.total).toBe(2);
    expect(v.review.judged).toBe(2);
    expect(v.review.rate).toBeNull();
    expect(v.overconfident).toEqual({ tagged: 4, after: 2 });
  });

  it('B2: 取り込みを含める → 3 件・調子に乗った 4 件のうち 3 件', () => {
    const v = reviewAfterWinStreak(S, { includeImports: true });
    expect(v.total).toBe(11);
    expect(v.review.total).toBe(3);
    expect(v.overconfident).toEqual({ tagged: 4, after: 3 });
  });

  it('B3: 5 件 · 60%（3 / 5）· 規律コスト −1.5R（B −1.5R → −0.5R、B −2.0R → −1.0R）', () => {
    const xs = seq(
      [
        W,
        W,
        ['B', -1.5],
        W,
        W,
        ['A', -1.0],
        W,
        W,
        ['B', -2.0],
        W,
        W,
        ['A', -1.0],
        W,
        W,
        ['A', -0.8],
      ],
      [3, 9],
    );
    const v = reviewAfterWinStreak(xs, { includeImports: false });
    expect(v.review.total).toBe(5);
    expect(v.review.planned).toBe(3);
    expect(v.review.judged).toBe(5);
    expect(v.review.rate).toBeCloseTo(0.6, 12);
    // 実際 −1.5 −1.0 −2.0 −1.0 −0.8 = −6.3、計画どおり −1.0 −1.0 −1.0 −1.0 −0.8 = −4.8、差 −1.5
    expect(v.review.cost).toBeCloseTo(-1.5, 12);
    expect(v.overconfident).toEqual({ tagged: 2, after: 2 });
    // ほかの取引 = 勝ちの 10 件（計画どおりの勝ち 10 / 10 = 100%・規律コスト 0）
    expect([v.rest.total, v.rest.planned, v.rest.judged, v.rest.cost]).toEqual([10, 10, 10, 0]);
  });

  it('B4: 2 件・調子に乗った 0 件', () => {
    const v = reviewAfterWinStreak(seq([W, W, W, W]), { includeImports: false });
    expect(v.review.total).toBe(2);
    expect(v.overconfident).toEqual({ tagged: 0, after: 0 });
  });

  it('B5: 0 件・調子に乗った 1 件のうち 0 件', () => {
    const v = reviewAfterWinStreak(seq([W, ['A', -1.0], W, [null, undefined], W, W], [5]), {
      includeImports: false,
    });
    expect(v.review.total).toBe(0);
    expect(v.overconfident).toEqual({ tagged: 1, after: 0 });
  });
});

/** 種つきの乱数の取引（判定・R・取り込み・0〜2 個のタグ。決済の時刻は重なることがある） */
function randomItems(r: Rng): ReviewItem[] {
  const n = r.int(0, 40);
  const grades: (Grade | null)[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', null];
  return Array.from({ length: n }, (_, k) => {
    const tags = new Set<EmotionTagId>();
    for (let j = r.int(0, 2); j > 0; j--) tags.add(r.pick(EMOTION_TAG_IDS));
    if (r.bool(0.2)) tags.add('overconfident');
    const g = r.pick(grades);
    return {
      ...item(
        r.int(0, 30),
        `p${k}`,
        g,
        r.bool(0.85) ? r.pick([0, 0.5, 1, 2.7]) * (isWinGrade(g) ? 1 : -1) : undefined,
        EMOTION_TAG_IDS.filter((t) => tags.has(t)),
        r.bool(0.3),
      ),
      createdAt: k,
    };
  });
}

/** 契約 P-1 の定義をそのまま書いた参照の実装（決済の古い順 → 作った古い順 → ID の降順） */
function reference(items: readonly ReviewItem[], include: boolean): string[] {
  const t = (include ? [...items] : items.filter((i) => !i.imported)).sort(
    (a, b) =>
      a.exitTime - b.exitTime ||
      a.createdAt - b.createdAt ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  return t
    .filter(
      (_, k) =>
        k >= WIN_STREAK_MIN &&
        Array.from({ length: WIN_STREAK_MIN }, (__, j) => t[k - 1 - j]).every((p) =>
          isWinGrade(p?.grade ?? null),
        ),
    )
    .map((i) => i.id)
    .sort();
}

describe('afterWinStreak・reviewAfterWinStreak: 性質', () => {
  it('定義どおり・対象の部分集合・並びによらない・入力を変えない・値 = 部分集合の reviewPeriod', () => {
    forAll(185, 400, randomItems, (items) => {
      const frozen = JSON.stringify(items);
      for (const include of [false, true]) {
        const got = afterWinStreak(items, { includeImports: include });
        expect(ids(got)).toEqual(reference(items, include));
        const target = include ? items : items.filter((i) => !i.imported);
        for (const id of got) expect(target.some((i) => i.id === id)).toBe(true);
        if (!include) for (const i of items) if (i.imported) expect(got.has(i.id)).toBe(false);
        expect(ids(afterWinStreak([...items].reverse(), { includeImports: include }))).toEqual(
          ids(got),
        );
        const v = reviewAfterWinStreak(items, { includeImports: include });
        expect(v.total).toBe(target.length);
        expect(ids(v.ids)).toEqual(ids(got));
        expect(v.review).toEqual(
          reviewPeriod(
            target.filter((i) => got.has(i.id)),
            { includeImports: true },
          ),
        );
        expect(v.rest).toEqual(
          reviewPeriod(
            target.filter((i) => !got.has(i.id)),
            { includeImports: true },
          ),
        );
        expect(v.review.total + v.rest.total).toBe(target.length);
        expect(v.review.cost).toBeLessThanOrEqual(0);
        expect(v.overconfident.after).toBeLessThanOrEqual(
          Math.min(v.overconfident.tagged, v.review.total),
        );
        expect(Number.isNaN(v.review.cost)).toBe(false);
      }
      expect(JSON.stringify(items)).toBe(frozen);
    });
  });

  it('勝ちだけの n 件なら n − 2 件・負けと判定なしだけなら 0 件', () => {
    forAll(
      1185,
      100,
      (r) => r.int(0, 30),
      (n) => {
        const wins = Array.from({ length: n }, (_, k) => item(k, `w${k}`, 'safeWin', 1));
        expect(afterWinStreak(wins, { includeImports: false }).size).toBe(Math.max(0, n - 2));
        const losses = Array.from({ length: n }, (_, k) =>
          item(k, `l${k}`, k % 2 === 0 ? 'A' : null, k % 2 === 0 ? -1 : undefined),
        );
        expect(afterWinStreak(losses, { includeImports: false }).size).toBe(0);
      },
    );
  });
});
