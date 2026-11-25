// LC の物差しの点の位置（Issue #34 契約 P-1。ルール 1〜4）。値はすべて架空。
// 位置 = (R − 下端) ÷ (上端 − 下端)、R = s ×（価格 − イン）÷ |イン − LC|（設計書 5.1・C30）
import { describe, expect, it } from 'vitest';
import { TOL } from '../../core/numeric';
import { optionOneR } from '../../core/option';
import { rMultiple } from '../../core/pnl';
import { noLcRulerOf, type Ruler, type RulerPointKind, rulerOf } from '../../core/ruler';
import type { LcMove, TradeInput } from '../../core/trade';
import { leg, position } from './helpers/option-builder';
import { forAll, type Rng } from './helpers/prng';
import { closedAt, trade, without } from './helpers/trade-builder';

const widened = (after?: number): LcMove =>
  after === undefined ? { kind: 'widened' } : { kind: 'widened', after };

/** 表の 1 行: 入力・TP・範囲・点（種類 → 位置）・範囲の外の点 */
interface Row {
  readonly id: string;
  readonly t: TradeInput;
  readonly tp?: number;
  readonly lo: number;
  readonly hi: number;
  readonly pos: Partial<Record<RulerPointKind, number>>;
  readonly out?: readonly RulerPointKind[];
  readonly overshoot?: number;
}

// 既定: L、イン 100、LC 99.5（幅 0.5）
const ROWS: readonly Row[] = [
  // E1: 決済 99.5 → R −1。範囲 −1〜+1。LC (−1+1)/2 = 0・決済 0・イン 1/2 = 0.5
  {
    id: 'E1',
    t: closedAt(trade(), 99.5),
    lo: -1,
    hi: 1,
    pos: { plannedLc: 0, exit: 0, entry: 0.5 },
  },
  // E2: 広げた後 99.2 → R (99.2−100)/0.5 = −1.6。範囲 −1.6〜+1（幅 2.6）。LC (−1+1.6)/2.6 = 0.2308・イン 1.6/2.6 = 0.6154
  {
    id: 'E2',
    t: closedAt(trade({ lcMove: widened(99.2) }), 99.2),
    lo: -1.6,
    hi: 1,
    pos: { movedLc: 0, exit: 0, plannedLc: 0.2308, entry: 0.6154 },
    overshoot: 0.6,
  },
  // E3: S、イン 150・LC 150.5（幅 0.5）、広げた後 150.8 → R −1 × (150.8−150)/0.5 = −1.6。E2 と同じ位置
  {
    id: 'E3',
    t: closedAt(
      trade({
        side: 'S',
        entries: [{ price: 150, quantity: 10_000 }],
        lc: 150.5,
        lcMove: widened(150.8),
      }),
      150.8,
    ),
    lo: -1.6,
    hi: 1,
    pos: { movedLc: 0, exit: 0, plannedLc: 0.2308, entry: 0.6154 },
    overshoot: 0.6,
  },
  // E4: TP 101・決済 101 → R 2。範囲 −1〜+2（幅 3）。イン 1/3 = 0.3333・TP 1・決済 1
  {
    id: 'E4',
    t: closedAt(trade(), 101),
    tp: 101,
    lo: -1,
    hi: 2,
    pos: { plannedLc: 0, entry: 0.3333, tp: 1, exit: 1 },
  },
  // E5: TP 100.75 → R 1.5。(1.5+1)/3 = 0.8333
  {
    id: 'E5',
    t: closedAt(trade(), 101),
    tp: 100.75,
    lo: -1,
    hi: 2,
    pos: { plannedLc: 0, entry: 0.3333, tp: 0.8333, exit: 1 },
  },
  // E6: 窓・滑りで決済 99.2（判定は A のまま。物差しは事実を出す）
  {
    id: 'E6',
    t: { ...closedAt(trade(), 99.2, { reason: 'gapSlip' }), gapSlipAnswer: true },
    lo: -1.6,
    hi: 1,
    pos: { exit: 0, plannedLc: 0.2308, entry: 0.6154 },
    overshoot: 0.6,
  },
  // E7: 決済 97.5 → R −5。下端は −3 で止める（範囲 −3〜+1、幅 4）。決済 0（範囲の外）・LC 2/4 = 0.5・イン 3/4 = 0.75
  {
    id: 'E7',
    t: closedAt(trade(), 97.5),
    lo: -3,
    hi: 1,
    pos: { exit: 0, plannedLc: 0.5, entry: 0.75 },
    out: ['exit'],
    overshoot: 4,
  },
  // E8: 狭めた・決済 99.7 → R −0.6。(−0.6+1)/2 = 0.2。広げた後の LC の点は無い
  {
    id: 'E8',
    t: closedAt(trade({ lcMove: { kind: 'tightened' } }), 99.7),
    lo: -1,
    hi: 1,
    pos: { plannedLc: 0, exit: 0.2, entry: 0.5 },
  },
  // E9: 広げた・後の値なし・決済 99.2 → E6 と同じ位置（広げた後の LC の点は無い）
  {
    id: 'E9',
    t: closedAt(trade({ lcMove: widened() }), 99.2),
    lo: -1.6,
    hi: 1,
    pos: { exit: 0, plannedLc: 0.2308, entry: 0.6154 },
    overshoot: 0.6,
  },
  // E10: 広げた後 99.2・決済 100.25 → R 0.5。(0.5+1.6)/2.6 = 0.8077
  {
    id: 'E10',
    t: closedAt(trade({ lcMove: widened(99.2) }), 100.25),
    lo: -1.6,
    hi: 1,
    pos: { movedLc: 0, plannedLc: 0.2308, entry: 0.6154, exit: 0.8077 },
  },
  // E11: 建値 100 → R 0。イン 0.5・決済 0.5
  {
    id: 'E11',
    t: closedAt(trade(), 100),
    lo: -1,
    hi: 1,
    pos: { plannedLc: 0, entry: 0.5, exit: 0.5 },
  },
  // E12: TP 99.8 は損の側 → TP の点は無い（E1 と同じ）
  {
    id: 'E12',
    t: closedAt(trade(), 99.5),
    tp: 99.8,
    lo: -1,
    hi: 1,
    pos: { plannedLc: 0, exit: 0, entry: 0.5 },
  },
  // E13: TP 103 → R 6（範囲の外）、決済 101 → R 2。上端は 3 で止める（範囲 −1〜+3、幅 4）。イン 1/4・決済 3/4・TP 1
  {
    id: 'E13',
    t: closedAt(trade(), 101),
    tp: 103,
    lo: -1,
    hi: 3,
    pos: { plannedLc: 0, entry: 0.25, exit: 0.75, tp: 1 },
    out: ['tp'],
  },
];

const round4 = (x: number) => Number(x.toFixed(4));

function mustRuler(t: TradeInput, tp?: number): Ruler {
  const r = rulerOf(t, tp);
  if (r === undefined) throw new Error('物差しが出ません');
  return r;
}

describe('rulerOf: 例の表 E1〜E13（AC-1）', () => {
  it.each(ROWS)('$id', (row) => {
    const r = mustRuler(row.t, row.tp);
    expect(round4(r.lo)).toBe(row.lo);
    expect(round4(r.hi)).toBe(row.hi);
    const kinds = r.points.map((p) => p.kind).sort();
    expect(kinds).toEqual(Object.keys(row.pos).sort());
    for (const p of r.points) {
      expect(round4(p.pos), p.kind).toBe(row.pos[p.kind]);
      expect(p.outOfRange, p.kind).toBe((row.out ?? []).includes(p.kind));
    }
    if (row.overshoot === undefined) expect(r.overshootR).toBeUndefined();
    else expect(round4(r.overshootR ?? Number.NaN)).toBe(row.overshoot);
  });

  it('E2 の並びは R の小さい順で、同じ R は計画の点（広げた後の LC）を先・決済を後', () => {
    const r = mustRuler(ROWS[1]?.t as TradeInput);
    expect(r.points.map((p) => p.kind)).toEqual(['movedLc', 'exit', 'plannedLc', 'entry']);
    expect(r.points.map((p) => p.price)).toEqual([99.2, 99.2, 99.5, 100]);
  });

  it('E3（S）の価格は入力のまま（左 = 高い側）', () => {
    const r = mustRuler(ROWS[2]?.t as TradeInput);
    expect(r.points.map((p) => p.price)).toEqual([150.8, 150.8, 150.5, 150]);
  });

  it('E1・E4・E11 の重なりも計画の点を先に並べる', () => {
    expect(mustRuler(ROWS[0]?.t as TradeInput).points.map((p) => p.kind)).toEqual([
      'plannedLc',
      'exit',
      'entry',
    ]);
    expect(mustRuler(ROWS[3]?.t as TradeInput, 101).points.map((p) => p.kind)).toEqual([
      'plannedLc',
      'entry',
      'tp',
      'exit',
    ]);
    expect(mustRuler(ROWS[10]?.t as TradeInput).points.map((p) => p.kind)).toEqual([
      'plannedLc',
      'entry',
      'exit',
    ]);
  });
});

describe('rulerOf: 出さない場面 N1〜N3（AC-2）', () => {
  it('N1: LC なし', () => {
    expect(rulerOf(without(closedAt(trade(), 99.2), 'lc'))).toBeUndefined();
  });
  it('N2: イン = LC（幅 0）', () => {
    expect(rulerOf(closedAt(trade({ lc: 100 }), 99.5))).toBeUndefined();
  });
  it('N3: エントリーが 2 つ（買い増し）', () => {
    const t = closedAt(
      trade({
        entries: [
          { price: 100, quantity: 10_000 },
          { price: 100.2, quantity: 10_000 },
        ],
      }),
      99.5,
    );
    expect(rulerOf(t)).toBeUndefined();
  });
  it('未決済は出さない', () => {
    expect(rulerOf(trade())).toBeUndefined();
  });
  it('エントリーの LC があれば R の分母はそれ（pnl.ts と同じ）', () => {
    // イン 100・エントリーの LC 99.8（幅 0.2）、決済 99.6 → R −2
    const t = closedAt(trade({ entries: [{ price: 100, quantity: 10_000, lc: 99.8 }] }), 99.6);
    const r = mustRuler(t);
    expect(round4(r.lo)).toBe(-2);
    const lc = r.points.find((p) => p.kind === 'plannedLc');
    expect(lc?.price).toBe(99.8);
    expect(lc?.r).toBe(-1);
  });
});

// ---- 性質テスト（種つき乱数で 1,000 回） ----

interface Gen {
  readonly entry: number;
  readonly width: number;
  readonly exitR: number;
  readonly moved: 'none' | 'tightened' | 'widenedNoValue' | 'widened';
  readonly afterR: number;
  readonly tpR: number | null;
  readonly quantity: number;
}

function gen(r: Rng): Gen {
  const scale = r.pick([1e-9, 1e-3, 1, 100, 1e9]);
  return {
    entry: (1 + r.next() * 1000) * scale,
    width: (0.001 + r.next() * 10) * scale,
    exitR: r.bool(0.2) ? r.pick([-1, 0, 1e-12, -1 - 1e-12]) : (r.next() - 0.5) * 16,
    moved: r.pick(['none', 'tightened', 'widenedNoValue', 'widened'] as const),
    afterR: -1 - r.next() * 5,
    tpR: r.bool(0.6) ? (r.next() - 0.3) * 10 : null,
    quantity: r.int(1, 100_000),
  };
}

function build(g: Gen, side: 'L' | 'S'): { t: TradeInput; tp?: number } {
  const s = side === 'L' ? 1 : -1;
  const at = (rr: number) => g.entry + s * rr * g.width;
  const lcMove: LcMove =
    g.moved === 'none'
      ? { kind: 'none' }
      : g.moved === 'tightened'
        ? { kind: 'tightened' }
        : g.moved === 'widenedNoValue'
          ? { kind: 'widened' }
          : { kind: 'widened', after: at(g.afterR) };
  const t = closedAt(
    trade({ side, entries: [{ price: g.entry, quantity: g.quantity }], lc: at(-1), lcMove }),
    at(g.exitR),
  );
  return g.tpR === null ? { t } : { t, tp: at(g.tpR) };
}

const KIND_ORDER: readonly RulerPointKind[] = ['plannedLc', 'movedLc', 'entry', 'tp', 'exit'];

/**
 * 表示の範囲と位置の式（ルール 1）を、点の R から作り直して照らす。下端 = max(−3, min(−1, 最小の R))、
 * 上端 = min(3, max(1, 最大の R))、位置 = clamp((R − 下端) ÷ (上端 − 下端), 0, 1)。食い違えば投げる
 */
function checkRangeFormula(r: Ruler): void {
  const rs = r.points.map((p) => p.r);
  const lo = Math.max(-3, Math.min(-1, ...rs));
  const hi = Math.min(3, Math.max(1, ...rs));
  if (Math.abs(r.lo - lo) > 1e-12) throw new Error(`下端 ${r.lo}（式 ${lo}）`);
  if (Math.abs(r.hi - hi) > 1e-12) throw new Error(`上端 ${r.hi}（式 ${hi}）`);
  for (const p of r.points) {
    const pos = Math.min(1, Math.max(0, (p.r - lo) / (hi - lo)));
    if (Math.abs(p.pos - pos) > 1e-12) throw new Error(`${p.kind} の位置 ${p.pos}（式 ${pos}）`);
  }
}

describe('rulerOf の性質', () => {
  it('範囲・位置が有限で、範囲 [−3,−1]〜[1,3]・位置 [0,1] に収まり、決めた LC は −1・決済は rMultiple と同じ', () => {
    forAll(34, 1000, gen, (g) => {
      for (const side of ['L', 'S'] as const) {
        const { t, tp } = build(g, side);
        const r = rulerOf(t, tp);
        if (r === undefined) throw new Error('物差しが出ません');
        expect(r.lo).toBeGreaterThanOrEqual(-3);
        expect(r.lo).toBeLessThanOrEqual(-1);
        expect(r.hi).toBeGreaterThanOrEqual(1);
        expect(r.hi).toBeLessThanOrEqual(3);
        for (const p of r.points) {
          expect(Number.isFinite(p.r)).toBe(true);
          expect(Number.isFinite(p.pos)).toBe(true);
          expect(p.pos).toBeGreaterThanOrEqual(0);
          expect(p.pos).toBeLessThanOrEqual(1);
          expect(p.outOfRange).toBe(p.r < r.lo - TOL || p.r > r.hi + TOL);
        }
        const lc = r.points.find((p) => p.kind === 'plannedLc');
        expect(lc?.r).toBe(-1);
        expect(lc?.pos).toBeCloseTo((-1 - r.lo) / (r.hi - r.lo), 12);
        const x = r.points.find((p) => p.kind === 'exit');
        expect(x?.r).toBe(rMultiple(t));
        expect(r.points.filter((p) => p.kind === 'entry')).toHaveLength(1);
        // 狭めた・値の無い広げたは広げた後の LC の点が無い
        expect(r.points.some((p) => p.kind === 'movedLc')).toBe(g.moved === 'widened');
        // TP は利の側にあるときだけ
        const tpPoint = r.points.find((p) => p.kind === 'tp');
        if (tpPoint) expect(tpPoint.r).toBeGreaterThan(0);
        if (g.tpR !== null && g.tpR > 1e-6) expect(tpPoint).toBeDefined();
        if (g.tpR === null || g.tpR <= 0) expect(tpPoint).toBeUndefined();
        // 越えた幅は決済が −1 より損の側のときだけ
        const xr = x?.r ?? 0;
        if (xr < -1 - TOL) expect(r.overshootR).toBeCloseTo(-1 - xr, 12);
        else expect(r.overshootR).toBeUndefined();
      }
    });
  });

  it('下端・上端・全点の位置が式（ルール 1）と値で一致する（Phase 4 の指摘 3）', () => {
    forAll(3404, 1000, gen, (g) => {
      for (const side of ['L', 'S'] as const) {
        const { t, tp } = build(g, side);
        checkRangeFormula(rulerOf(t, tp) as Ruler);
      }
    });
  });

  it('式の照らし合わせは誤った範囲・位置を拾う（下端をいつも −3・上端をいつも 1・位置をずらす）', () => {
    const r = mustRuler(closedAt(trade({ lcMove: widened(99.2) }), 99.2)); // E2: 下端 −1.6
    expect(() => checkRangeFormula(r)).not.toThrow();
    expect(() => checkRangeFormula({ ...r, lo: -3 })).toThrow(/下端/);
    const e4 = mustRuler(closedAt(trade(), 101), 101); // E4: 上端 2
    expect(() => checkRangeFormula({ ...e4, hi: 1 })).toThrow(/上端/);
    const shifted = r.points.map((p) => (p.kind === 'entry' ? { ...p, pos: p.pos + 0.01 } : p));
    expect(() => checkRangeFormula({ ...r, points: shifted })).toThrow(/entry の位置/);
  });

  it('入る前に決めていたかを写す（R・位置は変えない）', () => {
    const planned = mustRuler(closedAt(trade(), 100.75));
    const late = mustRuler(closedAt(trade({ lcDecidedBeforeEntry: false }), 100.75));
    expect(planned.lcDecidedBeforeEntry).toBe(true);
    expect(late.lcDecidedBeforeEntry).toBe(false);
    expect(late.points).toEqual(planned.points);
    expect([late.lo, late.hi]).toEqual([planned.lo, planned.hi]);
  });

  it('並びは R の小さい順で、同じ R は計画の点 → 決済の順', () => {
    forAll(3401, 1000, gen, (g) => {
      const { t, tp } = build(g, 'L');
      const pts = rulerOf(t, tp)?.points ?? [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        if (Math.abs(a.r - b.r) <= TOL) {
          expect(KIND_ORDER.indexOf(a.kind)).toBeLessThan(KIND_ORDER.indexOf(b.kind));
        } else {
          expect(a.r).toBeLessThan(b.r);
        }
      }
    });
  });

  it('L と S の鏡像: 同じ R の置き方なら r・位置・範囲の外の印が一致する', () => {
    forAll(3402, 1000, gen, (g) => {
      const l = rulerOf(build(g, 'L').t, build(g, 'L').tp);
      const s = rulerOf(build(g, 'S').t, build(g, 'S').tp);
      if (!l || !s) throw new Error('物差しが出ません');
      const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
      expect(close(l.lo, s.lo) && close(l.hi, s.hi)).toBe(true);
      const byKind = (r: Ruler) => new Map(r.points.map((p) => [p.kind, p]));
      const lm = byKind(l);
      const sm = byKind(s);
      expect([...lm.keys()].sort()).toEqual([...sm.keys()].sort());
      for (const [k, p] of lm) {
        const q = sm.get(k);
        if (!q) throw new Error(k);
        expect(close(p.r, q.r)).toBe(true);
        expect(close(p.pos, q.pos)).toBe(true);
      }
    });
  });

  it('単調: s × 価格 が大きい点ほど位置が小さくならない', () => {
    forAll(3403, 1000, gen, (g) => {
      for (const side of ['L', 'S'] as const) {
        const { t, tp } = build(g, side);
        const s = side === 'L' ? 1 : -1;
        const pts = rulerOf(t, tp)?.points ?? [];
        for (const a of pts) {
          for (const b of pts) {
            if (a.price === undefined || b.price === undefined) continue;
            if (s * a.price < s * b.price && b.r - a.r > TOL) {
              expect(a.pos).toBeLessThanOrEqual(b.pos);
            }
          }
        }
      }
    });
  });

  it('極端な値（幅 1e-9・価格 1e9・イン近くの決済）でも NaN・Infinity を出さない', () => {
    const cases: TradeInput[] = [
      closedAt(trade({ entries: [{ price: 1, quantity: 1 }], lc: 1 - 1e-9 }), 1 - 5e-9),
      closedAt(trade({ entries: [{ price: 1e9, quantity: 1 }], lc: 1e9 - 1 }), 1e9 + 1e-6),
      closedAt(trade(), 100 + 1e-12),
      closedAt(trade(), 99.5 - 1e-12),
    ];
    for (const t of cases) {
      const r = mustRuler(t, 1e12);
      for (const v of [r.lo, r.hi, ...r.points.flatMap((p) => [p.r, p.pos])]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('TP が有限でない・イン と同じなら TP の点を出さない', () => {
    for (const tp of [Number.NaN, Number.POSITIVE_INFINITY, 100]) {
      expect(mustRuler(closedAt(trade(), 101), tp).points.some((p) => p.kind === 'tp')).toBe(false);
    }
  });

  it('広げた後の LC の値が有限でなければ物差しを出さない', () => {
    expect(rulerOf(closedAt(trade({ lcMove: widened(Number.NaN) }), 99.2))).toBeUndefined();
  });
});

// ---- #231（設計書 C66）: LC なしの価格の位置の図・LC の価格の無いオプションの −1R ----
// 位置 = (u + 1.25) ÷ 2.5、u = s ×（価格 − イン）÷ D、D = max(|決済 − イン|, 利の側の TP までの幅)

const noLc = (over: Partial<TradeInput> = {}) =>
  without(trade({ lcDecidedBeforeEntry: false, ...over }), 'lc');

describe('noLcRulerOf（LC なしの図）の手計算の例', () => {
  it('L・イン 100・決済 98.75（D = 1.25）: LC なし 0・決済 (−1 + 1.25)/2.5 = 0.1・イン 0.5', () => {
    const r = noLcRulerOf(closedAt(noLc(), 98.75));
    expect(r?.basis).toBe('price');
    expect(r?.points.map((p) => [p.kind, p.price, Number(p.pos.toFixed(4))])).toEqual([
      ['noLc', undefined, 0],
      ['exit', 98.75, 0.1],
      ['entry', 100, 0.5],
    ]);
  });

  it('L・決済 101・TP 102（D = 2）: 決済 (0.5 + 1.25)/2.5 = 0.7・TP (1 + 1.25)/2.5 = 0.9', () => {
    const r = noLcRulerOf(closedAt(noLc(), 101), 102);
    expect(r?.points.map((p) => [p.kind, Number(p.pos.toFixed(4))])).toEqual([
      ['noLc', 0],
      ['entry', 0.5],
      ['exit', 0.7],
      ['tp', 0.9],
    ]);
  });

  it('S・イン 150・決済 151（損）: 左 = 損の側で L と同じ位置（決済 0.1）', () => {
    const t = closedAt(noLc({ side: 'S', entries: [{ price: 150, quantity: 10_000 }] }), 151);
    expect(noLcRulerOf(t)?.points.find((p) => p.kind === 'exit')?.pos).toBeCloseTo(0.1, 9);
  });

  it('損の側の TP・決済 = イン（D = 0 → 1）', () => {
    const r = noLcRulerOf(closedAt(noLc(), 100), 99);
    expect(r?.points.map((p) => p.kind)).toEqual(['noLc', 'entry', 'exit']);
    expect(r?.points.every((p) => p.kind === 'noLc' || p.pos === 0.5)).toBe(true);
  });

  it('LC がある・決済が無い・エントリーが 2 つなら無し', () => {
    expect(noLcRulerOf(closedAt(trade(), 99))).toBeUndefined();
    expect(noLcRulerOf(noLc())).toBeUndefined();
    const two = noLc({
      entries: [
        { price: 100, quantity: 1 },
        { price: 99, quantity: 1 },
      ],
    });
    expect(noLcRulerOf(closedAt(two, 98))).toBeUndefined();
  });
});

describe('noLcRulerOf の性質', () => {
  interface G {
    readonly side: 'L' | 'S';
    readonly entry: number;
    readonly exit: number;
    readonly tp?: number;
  }
  const g = (r: Rng): G => {
    const entry = r.int(1, 100_000) / 100;
    const exit = r.int(1, 100_000) / 100;
    return {
      side: r.pick(['L', 'S'] as const),
      entry,
      exit,
      ...(r.bool() ? { tp: r.int(1, 100_000) / 100 } : {}),
    };
  };
  const build = (x: G) =>
    noLcRulerOf(
      closedAt(noLc({ side: x.side, entries: [{ price: x.entry, quantity: 1 }] }), x.exit),
      x.tp,
    );

  it('位置は 0〜1・NaN なし・イン は真ん中・LC なしは左端・損の側の決済はイン より左', () => {
    forAll(2311, 1000, g, (x) => {
      const r = build(x);
      expect(r).toBeDefined();
      const pts = r?.points ?? [];
      for (const p of pts) {
        expect(Number.isFinite(p.pos)).toBe(true);
        expect(p.pos).toBeGreaterThanOrEqual(0);
        expect(p.pos).toBeLessThanOrEqual(1);
      }
      expect(pts[0]?.kind).toBe('noLc');
      expect(pts.find((p) => p.kind === 'entry')?.pos).toBe(0.5);
      const s = x.side === 'L' ? 1 : -1;
      const exit = pts.find((p) => p.kind === 'exit')?.pos ?? NaN;
      if (s * (x.exit - x.entry) < -TOL) expect(exit).toBeLessThan(0.5);
      if (s * (x.exit - x.entry) > TOL) expect(exit).toBeGreaterThan(0.5);
      // 並びは位置の小さい順
      for (let i = 1; i < pts.length; i++)
        expect((pts[i]?.pos ?? 0) + TOL).toBeGreaterThanOrEqual(pts[i - 1]?.pos ?? 0);
    });
  });

  it('L と S の対称: S の価格をイン について折り返すと同じ位置', () => {
    forAll(2312, 500, g, (x) => {
      const l = build({ ...x, side: 'L' });
      const mirror = (p: number) => 2 * x.entry - p;
      const sr = build({
        side: 'S',
        entry: x.entry,
        exit: mirror(x.exit),
        ...(x.tp === undefined ? {} : { tp: mirror(x.tp) }),
      });
      expect(sr?.points.map((p) => [p.kind, p.pos.toFixed(9)])).toEqual(
        l?.points.map((p) => [p.kind, p.pos.toFixed(9)]),
      );
    });
  });
});

describe('LC の価格の無いオプションのポジション（rulerOf の bound）', () => {
  it('オプションでない LC なしは無し（R の軸の図は出さない）', () => {
    expect(rulerOf(closedAt(noLc(), 99))).toBeUndefined();
  });

  // 例 E7 の形（設計書 5.7 の O8 と同じ）: S・建てたときの原資産 38,200・決済したときの原資産 38,600・「最大損失まで」。
  // P 38,000 買い 400 → 250（−150,000 円）・P 37,000 売り 150 → 130（+20,000 円）= −130,000 円。
  // 最大損失 (400 − 150) × 1,000 = 250,000 円 → R = −130,000 ÷ 250,000 = −0.52。範囲 −1〜+1 → 位置 (−0.52 + 1) ÷ 2 = 0.24
  const maxLossS = (sellExit = 130) =>
    without(
      position(
        [leg('P', 38_000, 'buy', 1, 400, 250), leg('P', 37_000, 'sell', 1, 150, sellExit)],
        38_600,
        { side: 'S', entries: [{ price: 38_200, quantity: 1 }], riskPlan: 'maxLoss' },
      ),
      'lc',
    );

  it('「最大損失まで」の損（S）: −1R に価格なしの上限・イン 0.5・決済 0.24・入る前に決めた計画', () => {
    const r = rulerOf(maxLossS());
    expect(r?.bound).toBe('maxLoss');
    expect(r?.lcDecidedBeforeEntry).toBe(true);
    expect(r?.lo).toBe(-1);
    expect(r?.hi).toBe(1);
    expect(r?.overshootR).toBeUndefined();
    expect(
      r?.points.map((p) => [p.kind, p.price, Number(p.r.toFixed(4)), Number(p.pos.toFixed(4))]),
    ).toEqual([
      ['plannedLc', undefined, -1, 0],
      ['exit', 38_600, -0.52, 0.24],
      ['entry', 38_200, 0, 0.5],
    ]);
    expect(r?.points.find((p) => p.kind === 'exit')?.r).toBeCloseTo(
      rMultiple(maxLossS()) ?? NaN,
      12,
    );
  });

  // 見込み（LC での損失の見込み）だけ・LC なし: L・売りのプット 150 → 360（−210,000 円）、見込み 200,000 円 → R = −1.05。
  // 範囲 −1.05〜+1（幅 2.05）→ 上限 (−1 + 1.05) ÷ 2.05 = 0.0244・決済 0・イン 1.05 ÷ 2.05 = 0.5122。越えた幅 0.05R
  it('見込みだけ（LC なし）: 名前の鍵は lossPlan・決めていない側の線・越えた幅', () => {
    const t = without(
      position([leg('P', 37_000, 'sell', 1, 150, 360)], 37_100, {
        lcLossPlanYen: 200_000,
        lcDecidedBeforeEntry: false,
      }),
      'lc',
    );
    const r = rulerOf(t);
    expect(r?.bound).toBe('lossPlan');
    expect(r?.lcDecidedBeforeEntry).toBe(false);
    expect(r?.overshootR).toBeCloseTo(0.05, 9);
    expect(r?.points.map((p) => [p.kind, Number(p.pos.toFixed(4))])).toEqual([
      ['exit', 0],
      ['plannedLc', 0.0244],
      ['entry', 0.5122],
    ]);
  });

  it('LC の価格があるオプションは前と同じ LC の図（上限の印なし。1R が実際の動き・満期の損益から出る場面も）', () => {
    // 売りのプット 150 → 360、決済したときの原資産 37,100（LC 37,500 を越えた）→ 1R は実際の動きから
    const moved = position([leg('P', 37_000, 'sell', 1, 150, 360)], 37_100);
    expect(optionOneR(moved)?.source).toBe('actualMove');
    const r1 = rulerOf(moved);
    expect(r1?.bound).toBeUndefined();
    expect(r1?.points.find((p) => p.kind === 'plannedLc')?.price).toBe(37_500);
    // 買いのコールのスプレッド（設計書 5.7 の O5 の形）: 1R は原資産 = LC の満期の損益から
    const expiry = position(
      [leg('C', 39_000, 'buy', 1, 200, 170), leg('C', 40_000, 'sell', 1, 50, 50)],
      38_900,
    );
    expect(optionOneR(expiry)?.source).toBe('expiry');
    expect(rulerOf(expiry)?.bound).toBeUndefined();
  });

  it('LC の価格も見込みも無く「最大損失まで」でもない・最大損失が定まらない・R が出ないオプションは図なし（R の軸も価格の位置も）', () => {
    const none = without(position([leg('P', 37_000, 'sell', 1, 150, 360)], 37_100), 'lc');
    expect(rulerOf(none)).toBeUndefined();
    expect(noLcRulerOf(none)).toBeUndefined();
    // 売りの裸を「最大損失まで」: 最大損失が定まらない → 1R なし
    const naked = without(
      position([leg('P', 37_000, 'sell', 1, 150, 360)], 37_100, { riskPlan: 'maxLoss' }),
      'lc',
    );
    expect(rulerOf(naked)).toBeUndefined();
    expect(noLcRulerOf(naked)).toBeUndefined();
    // 「最大損失まで」でも為替が出ない（外貨建て・為替なし）→ R なし → 図なし
    const noFx = {
      ...maxLossS(),
      instrument: { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false },
    };
    expect(rMultiple(noFx)).toBeUndefined();
    expect(rulerOf(noFx)).toBeUndefined();
  });
});
