// 規律コストの曲線の描く位置（Issue #88 契約 P-4・AC-9）。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { CurvePoint } from '../../core/review';
import { reviewPeriod } from '../../core/review';
import { curveGeometry, niceStep, pointsOf, rOfY } from '../../ui/src/lib/review-chart';
import { reviewItemOf } from '../../ui/src/lib/review-view';
import { forAll } from '../core/helpers/prng';
import { S1 } from './helpers/review-examples';

const curveOf = (ts = S1) => reviewPeriod(ts.map(reviewItemOf), { includeImports: false }).curve;
/** 点の R を読み戻す（小数 1 桁。座標は小数 3 桁に丸めてあるので 0.05 の幅で十分） */
const rs = (points: string, g: ReturnType<typeof curveGeometry>) =>
  pointsOf(points).map((p) => Math.round(rOfY(p.y, g) * 10) / 10 + 0);

describe('curveGeometry: S1（AC-9）', () => {
  const g = curveGeometry(curveOf());

  it('2 本の線の点の R が例の表の累積の順に並ぶ（原点 0 から）', () => {
    expect(rs(g.actualPoints, g)).toEqual([0, -1, 1, -0.6, -0.1, -0.9, 0.3]);
    expect(rs(g.plannedPoints, g)).toEqual([0, -1, 1, 0, 0.5, -0.3, 0.9]);
  });

  it('横は順番の等間隔（0〜100）', () => {
    expect(pointsOf(g.actualPoints).map((p) => p.x)).toEqual([
      0, 16.667, 33.333, 50, 66.667, 83.333, 100,
    ]);
  });

  it('差の面は 3 番（B）の区間から後だけ（点 2 → 6）', () => {
    expect(g.gapSpans).toEqual([[2, 6]]);
    expect(g.gapPolygons).toHaveLength(1);
    const poly = pointsOf(g.gapPolygons[0] ?? '');
    // 上の縁 = 計画どおり（点 2〜6）、下の縁 = 実際（点 6〜2 の逆順）
    expect(poly).toHaveLength(10);
    expect(poly.map((p) => p.x)).toEqual([
      33.333, 50, 66.667, 83.333, 100, 100, 83.333, 66.667, 50, 33.333,
    ]);
  });

  it('目盛りはきりのよい刻み（1R ごと・0 を含む 3 本。空きが同じなら本数の少ない方）', () => {
    expect(g.step).toBe(1);
    expect(g.ticks.map((t) => t.label)).toEqual(['−1R', '0', '+1R']);
    for (const t of g.ticks) {
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(100);
    }
  });

  it('右端の札: 計画 +0.9R が上・実際 +0.3R が下、差の括弧は −0.6R', () => {
    expect(g.ends.planned.text).toBe('計画 +0.9R');
    expect(g.ends.actual.text).toBe('実際 +0.3R');
    expect(g.ends.planned.y).toBeLessThan(g.ends.actual.y);
    expect(g.ends.actual.y - g.ends.planned.y).toBeGreaterThanOrEqual(13 - 1e-9);
    expect(g.ends.bracket?.label.text).toBe('−0.6R');
    expect(g.ends.bracket?.top).toBeLessThan(g.ends.bracket?.bottom ?? 0);
  });

  it('崩れの印は置き換えた 3 番（B）の点だけ・判定のバッジと同じ形（△・崩れの段）。点は 6 つ', () => {
    expect(g.marks.map((m) => [m.x, m.tier, m.symbol])).toEqual([[50, 'break', 'triangle']]);
    expect(g.dots).toHaveLength(6);
  });

  it('斜線の切り抜きは差の面と同じ多角形の 0〜1 の割合', () => {
    const a = pointsOf(g.gapPolygons[0] ?? '');
    const b = pointsOf(g.gapFractions[0] ?? '');
    expect(b.map((p) => [p.x * 100, p.y * 100].map((v) => Math.round(v)))).toEqual(
      a.map((p) => [Math.round(p.x), Math.round(p.y)]),
    );
  });
});

describe('niceStep: 0.5・1・2・2.5・5 × 10^k・3〜7 本・上下の空きが最小（同じなら本数の少ない方）', () => {
  it.each([
    [-1, 1, 1],
    [-0.5, 0.5, 0.5],
    [-3.2, 0, 2],
    [-8, 2, 2],
    [-7.6, 1, 2],
    [0, 12, 2],
    [-1.3, 1.1, 0.5],
    [-40, 3, 10],
    [-120, 10, 25],
  ])('[%s, %s] → %s', (lo, hi, want) => {
    expect(niceStep(lo, hi)).toBe(want);
  });
});

describe('curveGeometry: 端', () => {
  it('1 日（1 件だけ・差 0）: 差の括弧も面も無く、2 つの札は重ならない', () => {
    const one: CurvePoint[] = [
      { id: 'a', grade: 'safeWin', r: 1.2, plannedR: 1.2, actualCum: 1.2, plannedCum: 1.2 },
    ];
    const g = curveGeometry(one);
    expect(g.ends.bracket).toBeNull();
    expect(g.gapPolygons).toEqual([]);
    expect(g.ends.actual.y - g.ends.planned.y).toBeGreaterThanOrEqual(13 - 1e-9);
    expect(g.ends.planned.y).toBeGreaterThanOrEqual(4);
    expect(g.ends.actual.y).toBeLessThanOrEqual(96);
  });

  it('rug: 近い崩れの印は 1 つにまとめ、件数と重い方の形を残す', () => {
    let a = 0;
    let p = 0;
    const near: CurvePoint[] = Array.from({ length: 60 }, (_, i) => {
      const grade = i === 30 ? 'C' : i === 31 ? 'B' : 'safeWin';
      const r = i === 30 || i === 31 ? -1.5 : 0.2;
      const pr = Math.max(r, -1);
      a += r;
      p += pr;
      return { id: `n${i}`, grade, r, plannedR: pr, actualCum: a, plannedCum: p };
    });
    const g = curveGeometry(near);
    expect(g.dense).toEqual({ narrow: true, wide: false });
    expect(g.rug.map((m) => [m.count, m.symbol])).toEqual([[2, 'cross']]);
  });

  it('大きな負け（−8R の C）でも目盛りはきりのよい刻み（−8R を含む範囲）', () => {
    const big: CurvePoint[] = [
      { id: 'a', grade: 'C', r: -8, plannedR: -1, actualCum: -8, plannedCum: -1 },
    ];
    const g = curveGeometry(big);
    expect(g.step).toBe(2);
    expect(g.ticks.map((t) => t.label)).toEqual(['−8R', '−6R', '−4R', '−2R', '0']);
    expect(g.marks.map((m) => m.symbol)).toEqual(['cross']);
    expect(g.ends.bracket?.label.text).toBe('−7.0R');
  });

  it('件数が多い（120 件）と点は打たず、崩れの印だけ', () => {
    let a = 0;
    let p = 0;
    const many: CurvePoint[] = Array.from({ length: 120 }, (_, i) => {
      const r = i % 10 === 0 ? -1.5 : 0.3;
      const pr = Math.max(r, -1);
      a += r;
      p += pr;
      return {
        id: `p${i}`,
        grade: r < -1 ? 'B' : 'safeWin',
        r,
        plannedR: pr,
        actualCum: a,
        plannedCum: p,
      };
    });
    const g = curveGeometry(many);
    expect(g.dots).toEqual([]);
    expect(g.marks).toHaveLength(12);
    // 件数が多い: 狭い幅でも広い幅でも 1 件あたり 8px 未満 → rug。印は 10 件ごと（約 8.3% 間隔）なのでまとめない
    expect(g.dense).toEqual({ narrow: true, wide: true });
    expect(g.rug).toHaveLength(12);
    expect(g.rug.every((m) => m.y === 100 && m.count === 1)).toBe(true);
  });

  it('1 件だけでも 0 から 1 本の線・縦の幅は 1R 以上', () => {
    const one: CurvePoint[] = [
      { id: 'a', grade: 'A', r: -0.1, plannedR: -0.1, actualCum: -0.1, plannedCum: -0.1 },
    ];
    const g = curveGeometry(one);
    expect(pointsOf(g.actualPoints)).toHaveLength(2);
    expect(g.hi - g.lo).toBeGreaterThanOrEqual(1);
    expect(g.gapPolygons).toEqual([]);
  });

  it('差が 1e-9 以下の区間は面にしない', () => {
    const tiny: CurvePoint[] = [
      { id: 'a', grade: 'B', r: -1, plannedR: -1 + 1e-12, actualCum: -1, plannedCum: -1 + 1e-12 },
    ];
    expect(curveGeometry(tiny).gapPolygons).toEqual([]);
  });

  it('性質: 座標はすべて 0〜100・有限、点の数 = 取引 + 1、面の区間は差のある所だけ', () => {
    forAll(
      8803,
      300,
      (r) => {
        const n = r.int(1, 30);
        let a = 0;
        let p = 0;
        return Array.from({ length: n }, (_, i): CurvePoint => {
          const v = r.pick([-3, -1.6, -1, -0.5, 0, 0.5, 2, 7]);
          const pr = r.bool(0.3) && v < -1 ? -1 : v;
          a += v;
          p += pr;
          return { id: `p${i}`, grade: 'B', r: v, plannedR: pr, actualCum: a, plannedCum: p };
        });
      },
      (curve) => {
        const g = curveGeometry(curve);
        const all = [g.actualPoints, g.plannedPoints, ...g.gapPolygons].flatMap(pointsOf);
        for (const pt of all) {
          expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
          expect(pt.x).toBeGreaterThanOrEqual(0);
          expect(pt.x).toBeLessThanOrEqual(100);
          expect(pt.y).toBeGreaterThanOrEqual(0);
          expect(pt.y).toBeLessThanOrEqual(100);
        }
        expect(pointsOf(g.actualPoints)).toHaveLength(curve.length + 1);
        const anyGap = curve.some((c) => c.plannedCum - c.actualCum > 1e-9);
        expect(g.gapPolygons.length > 0).toBe(anyGap);
        // 計画の線はどの点でも実際の線より上（y が小さいか同じ）。差の面の向きは逆にならない
        const ap = pointsOf(g.actualPoints);
        pointsOf(g.plannedPoints).forEach((pt, i) => {
          expect(pt.y).toBeLessThanOrEqual((ap[i]?.y ?? 0) + 1e-9);
        });
        // 目盛りは 3〜7 本で 0 を含む
        expect(g.ticks.length).toBeGreaterThanOrEqual(3);
        expect(g.ticks.length).toBeLessThanOrEqual(7);
        expect(g.ticks.some((t) => t.zero)).toBe(true);
      },
    );
  });
});
