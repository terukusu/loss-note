// 直近の連続（Issue #35 AC-1）。新しい順の判定の並び → 最新の種類と、新しい方から同じ種類が続く件数
import { describe, expect, it } from 'vitest';
import type { Grade } from '../../core/judge';
import { recentRun, runKindOf } from '../../core/review';
import { forAll, type Rng } from './helpers/prng';

const GRADES: readonly (Grade | null)[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', null];

describe('runKindOf', () => {
  it('A・計画どおりの勝ち = 計画どおり、B・危ない勝ち・C = 崩れ、判定なし = none', () => {
    expect(GRADES.map(runKindOf)).toEqual(['plan', 'plan', 'off', 'off', 'off', 'none']);
  });
});

describe('recentRun: 例', () => {
  it('空 → null', () => {
    expect(recentRun([])).toBeNull();
  });

  it('S1（新しい順: 計画どおりの勝ち・A・C・危ない勝ち・B・計画どおりの勝ち・A）→ 計画どおり 2 件', () => {
    expect(recentRun(['safeWin', 'A', 'C', 'riskyWin', 'B', 'safeWin', 'A'])).toEqual({
      kind: 'plan',
      count: 2,
    });
  });

  it('B・危ない勝ち・C は同じ「崩れ」として続く', () => {
    expect(recentRun(['B', 'riskyWin', 'C', 'A'])).toEqual({ kind: 'off', count: 3 });
  });

  it('判定なしは別の種類（計画どおりの連続を止める）', () => {
    expect(recentRun([null, null, 'A'])).toEqual({ kind: 'none', count: 2 });
    expect(recentRun(['A', null, 'A'])).toEqual({ kind: 'plan', count: 1 });
  });

  it('全部が同じ種類なら並びの長さ', () => {
    expect(recentRun(['A', 'A', 'safeWin'])).toEqual({ kind: 'plan', count: 3 });
  });
});

const randomGrades = (r: Rng): (Grade | null)[] =>
  Array.from({ length: r.int(1, 15) }, () => r.pick(GRADES));

describe('recentRun: 性質', () => {
  it('件数は 1 以上・並びの長さ以下、種類は最新の取引の種類、連続の中は同じ種類で次（あれば）は違う種類', () => {
    forAll(35, 400, randomGrades, (gs) => {
      const run = recentRun(gs);
      expect(run).not.toBeNull();
      if (!run) return;
      expect(run.count).toBeGreaterThanOrEqual(1);
      expect(run.count).toBeLessThanOrEqual(gs.length);
      expect(run.kind).toBe(runKindOf(gs[0] ?? null));
      for (const g of gs.slice(0, run.count)) expect(runKindOf(g)).toBe(run.kind);
      const next = gs[run.count];
      if (run.count < gs.length) expect(runKindOf(next ?? null)).not.toBe(run.kind);
    });
  });

  it('並びの後ろ（もっと古い取引）に違う種類を足しても変わらない', () => {
    forAll(3501, 200, randomGrades, (gs) => {
      const run = recentRun(gs);
      if (!run || run.count < gs.length) return;
      const other: Grade | null = run.kind === 'plan' ? 'B' : 'A';
      expect(recentRun([...gs, other])).toEqual(run);
    });
  });
});
