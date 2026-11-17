// 性質テスト（種つきの乱数で各 1,000 回。失敗したら種と回数を出す）。値はすべて架空
import { describe, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { REASON_ORDER, REASON_WEIGHT, type Reason } from '../../core/judge';
import { oneRYen, pnlYen, rMultiple } from '../../core/pnl';
import { suggestQuantity } from '../../core/sizing';
import {
  type Entry,
  type Exit,
  type ExitOrderType,
  type ExitReason,
  TIMEFRAMES,
  type TradeInput,
} from '../../core/trade';
import { forAll, type Rng } from './helpers/prng';

const N = 1_000;
const ORDER_TYPES: readonly ExitOrderType[] = ['stop', 'market', 'limit', 'unknown'];
const EXIT_REASONS: readonly ExitReason[] = [
  'lc',
  'gapSlip',
  'tp',
  'brokeManual',
  'fearEarly',
  'timeout',
  'other',
];

/** 相対の誤差で近いか（0 の近くは絶対の誤差） */
function close(a: number | undefined, b: number | undefined, rel = 1e-9): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * L の取引を乱数で作る。価格は整数（折り返し 2K − p が誤差なしになるように）。
 * LC はいつも正しい向き（検査を通る入力）
 */
function genLongTrade(r: Rng, opts: { statement?: boolean } = {}): TradeInput {
  const n = r.int(1, 3);
  const base = r.int(1_000, 2_000);
  const lc = r.bool(0.85) ? base - r.int(51, 150) : undefined; // どのエントリー（base ± 50）より下
  const entries: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const price = base + r.int(-50, 50);
    const entry: Entry = { price, quantity: r.int(1, 1_000) / r.pick([1, 10, 100]) };
    entries.push(r.bool(0.3) ? { ...entry, lc: price - r.int(1, 80) } : entry);
  }
  const isJpy = r.bool();
  const exit: Exit = {
    price: base + r.int(-300, 300),
    orderType: r.pick(ORDER_TYPES),
    reason: r.pick(EXIT_REASONS),
    ...(r.bool(0.8) ? { fxRate: r.int(80, 200) } : {}),
  };
  const lcMove = r.pick([
    { kind: 'none' } as const,
    { kind: 'tightened' } as const,
    { kind: 'widened' } as const,
    ...(lc === undefined ? [] : [{ kind: 'widened', after: lc - r.int(1, 50) } as const]),
  ]);
  const t: TradeInput = {
    side: 'L',
    instrument: { multiplier: r.pick([1, 10, 100, 0.5]), quantityStep: 1, isJpy },
    entries: entries as [Entry, ...Entry[]],
    ...(lc === undefined ? {} : { lc }),
    lcBasis: r.pick(['chart', 'amount'] as const),
    lcDecidedBeforeEntry: r.bool(0.8),
    lcMove,
    timeframeChange: r.pick(['none', 'longer', 'shorter'] as const),
    ...(r.bool() ? { entryChartTimeframe: r.pick(TIMEFRAMES) } : {}),
    ...(r.bool() ? { exitChartTimeframe: r.pick(TIMEFRAMES) } : {}),
    ...(r.bool(0.95) ? { exit } : {}),
    ...(opts.statement !== false && r.bool(0.4)
      ? { statementPnlYen: r.int(-100_000, 100_000) }
      : {}),
    ...(r.bool(0.3) ? { feesTotalYen: r.int(0, 2_000) } : {}),
    ...(r.bool(0.3) ? { gapSlipAnswer: r.bool() } : {}),
    ...(r.bool(0.8) ? { planFxRate: r.int(80, 200) } : {}),
    ...(r.bool(0.8) ? { capitalYen: r.int(100, 10_000) * 1_000 } : {}),
    riskTolerancePct: r.pick([0.5, 1, 2, 3]),
    ...(r.bool(0.3) ? { plannedAt: r.int(0, 100) } : {}),
  };
  return r.bool(0.5)
    ? { ...t, entries: entries.map((e, i) => ({ ...e, time: 50 + i })) as [Entry, ...Entry[]] }
    : t;
}

/** 価格を K で折り返した S の取引（イン・LC・決済を 2K − p に） */
function mirror(t: TradeInput, k: number): TradeInput {
  const m = (p: number) => 2 * k - p;
  const entries = t.entries.map((e) => ({
    ...e,
    price: m(e.price),
    ...(e.lc === undefined ? {} : { lc: m(e.lc) }),
  })) as [Entry, ...Entry[]];
  return {
    ...t,
    side: 'S',
    entries,
    ...(t.lc === undefined ? {} : { lc: m(t.lc) }),
    lcMove:
      t.lcMove.kind === 'widened' && t.lcMove.after !== undefined
        ? { kind: 'widened', after: m(t.lcMove.after) }
        : t.lcMove,
    ...(t.exit === undefined ? {} : { exit: { ...t.exit, price: m(t.exit.price) } }),
  };
}

function kinds(reasons: readonly Reason[] | undefined): string[] {
  return (reasons ?? []).map((r) => r.kind);
}

describe('性質', () => {
  it('L と S の対称: 価格を折り返した S は損益・R・1R・リスク・判定・理由が同じ', () => {
    forAll(
      101,
      N,
      (r) => ({ t: genLongTrade(r), k: r.int(1_500, 3_000) }),
      ({ t, k }) => {
        const a = evaluateTrade(t);
        const b = evaluateTrade(mirror(t, k));
        assert(a.ok && b.ok, '検査を通る入力のはず');
        if (!a.ok || !b.ok) return;
        assert(close(a.pnlYen, b.pnlYen), `損益 ${a.pnlYen} / ${b.pnlYen}`);
        assert(close(a.r, b.r), `R ${a.r} / ${b.r}`);
        assert(close(a.oneRYen, b.oneRYen), `1R ${a.oneRYen} / ${b.oneRYen}`);
        assert(close(a.riskPct, b.riskPct), `リスク ${a.riskPct} / ${b.riskPct}`);
        assert(a.judgment?.outcome === b.judgment?.outcome, '勝ち負け');
        assert(
          a.judgment?.grade === b.judgment?.grade,
          `判定 ${a.judgment?.grade} / ${b.judgment?.grade}`,
        );
        assert(
          JSON.stringify(kinds(a.judgment?.reasons)) === JSON.stringify(kinds(b.judgment?.reasons)),
          `理由 ${kinds(a.judgment?.reasons)} / ${kinds(b.judgment?.reasons)}`,
        );
      },
    );
  });

  it('符号: L で決済がすべてのインより上なら損益と R は正、下なら負', () => {
    forAll(
      102,
      N,
      (r) => genLongTrade(r, { statement: false }),
      (t) => {
        if (t.exit === undefined) return;
        const exitPrice = t.exit.price;
        const p = pnlYen(t);
        const rm = rMultiple(t);
        if (t.entries.every((e) => exitPrice > e.price)) {
          assert(p === undefined || p > 0, `損益 ${p}`);
          assert(rm === undefined || rm > 0, `R ${rm}`);
        }
        if (t.entries.every((e) => exitPrice < e.price)) {
          assert(p === undefined || p < 0, `損益 ${p}`);
          assert(rm === undefined || rm < 0, `R ${rm}`);
        }
      },
    );
  });

  it('数量に対して線形: 数量を k 倍すると損益・1R は k 倍、R は変わらない', () => {
    forAll(
      103,
      N,
      (r) => ({ t: genLongTrade(r, { statement: false }), k: r.int(2, 50) / r.pick([1, 10]) }),
      ({ t, k }) => {
        const scaled: TradeInput = {
          ...t,
          entries: t.entries.map((e) => ({ ...e, quantity: e.quantity * k })) as [
            Entry,
            ...Entry[],
          ],
        };
        const p = pnlYen(t);
        const ps = pnlYen(scaled);
        assert(close(p === undefined ? undefined : p * k, ps), `損益 ${p} × ${k} / ${ps}`);
        const o = oneRYen(t);
        const os = oneRYen(scaled);
        assert(close(o === undefined ? undefined : o * k, os), `1R ${o} × ${k} / ${os}`);
        assert(close(rMultiple(t), rMultiple(scaled)), 'R');
      },
    );
  });

  it('NaN を出さない: 検査を通った入力の数値は有限か無し、壊れた入力は例外なく受け付けない', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1];
    forAll(
      104,
      N,
      (r) => ({ t: genLongTrade(r), breakIt: r.int(0, 6), v: r.pick(bad) }),
      ({ t, breakIt, v }) => {
        const ev = evaluateTrade(t);
        assert(ev.ok, '検査を通る入力のはず');
        if (ev.ok) {
          for (const x of [ev.pnlYen, ev.r, ev.oneRYen, ev.riskPct]) {
            assert(x === undefined || Number.isFinite(x), `有限でない ${x}`);
          }
        }
        const e0 = t.entries[0];
        const broken: TradeInput[] = [
          { ...t, entries: [{ ...e0, quantity: v }, ...t.entries.slice(1)] },
          { ...t, instrument: { ...t.instrument, multiplier: v } },
          { ...t, instrument: { ...t.instrument, quantityStep: v } },
          { ...t, riskTolerancePct: v },
          { ...t, capitalYen: v },
          { ...t, entries: [{ ...e0, price: Number.NaN }, ...t.entries.slice(1)] },
          { ...t, entries: [{ ...e0, lc: e0.price }, ...t.entries.slice(1)] }, // LC = イン
        ];
        const target = broken[breakIt];
        if (target === undefined) return;
        const evb = evaluateTrade(target);
        assert(!evb.ok, `壊れた入力 ${breakIt} を受け付けた`);
      },
    );
  });

  it('判定: 理由の重さの最大と一致し、理由は 5.3 の順で、持ち続けたは勝ちに出ない', () => {
    forAll(
      105,
      N,
      (r) => genLongTrade(r),
      (t) => {
        const ev = evaluateTrade(t);
        if (!ev.ok || ev.judgment === undefined) return;
        const { outcome, grade, reasons } = ev.judgment;
        const idx = reasons.map((x) => REASON_ORDER.indexOf(x.kind));
        for (let i = 1; i < idx.length; i++) {
          assert((idx[i] ?? -1) >= (idx[i - 1] ?? -1), `理由の順 ${kinds(reasons)}`);
        }
        const hasC = reasons.some((x) => REASON_WEIGHT[x.kind] === 'C');
        const hasB = reasons.some((x) => REASON_WEIGHT[x.kind] === 'B');
        if (outcome === 'loss') {
          assert(
            grade === (hasC ? 'C' : hasB ? 'B' : 'A'),
            `負けの判定 ${grade} ${kinds(reasons)}`,
          );
        } else {
          assert(grade === (hasC || hasB ? 'riskyWin' : 'safeWin'), `勝ちの判定 ${grade}`);
          assert(!kinds(reasons).includes('heldPastLc'), '勝ちに持ち続けた');
        }
      },
    );
  });

  it('数量の提案: 刻みの整数倍で、許容リスクに収まり、1 刻み足すと超える', () => {
    const steps = [100, 1, 0.1, 0.01, 0.001];
    forAll(
      106,
      N,
      (r) => ({
        step: r.pick(steps),
        entry: r.int(1_000, 50_000) / r.pick([1, 100]),
        width: r.int(1, 500) / r.pick([1, 10, 100]),
        capital: r.int(100, 50_000) * 1_000,
        risk: r.pick([0.5, 1, 1.5, 2, 3]),
        mult: r.pick([1, 10, 100, 0.1]),
        fx: r.pick([1, 110.5, 150, 0.9]),
      }),
      ({ step, entry, width, capital, risk, mult, fx }) => {
        const q = suggestQuantity({
          side: 'L',
          entryPrice: entry,
          lc: entry - width,
          capitalYen: capital,
          riskTolerancePct: risk,
          multiplier: mult,
          fx,
          quantityStep: step,
        });
        assert(q !== undefined && q >= 0, `提案 ${q}`);
        if (q === undefined) return;
        const n = Math.round(q / step);
        assert(close(n * step, q, 1e-12), `刻みの整数倍でない ${q}`);
        const unit = (entry - (entry - width)) * mult * fx;
        const budget = (capital * risk) / 100;
        assert(q * unit <= budget * (1 + 1e-9), `許容リスクを超える ${q}`);
        assert((q + step) * unit > budget, `1 刻み足しても超えない ${q}`);
      },
    );
  });

  it('数量の提案: ちょうど n 刻みになる入力は n × 刻みを返す', () => {
    const steps = [100, 1, 0.1, 0.01, 0.001];
    forAll(
      107,
      N,
      (r) => ({ step: r.pick(steps), n: r.int(1, 100_000) }),
      ({ step, n }) => {
        // 1 単位のリスクを 1 円にし、資金 × 許容リスクを n × 刻みにする
        const expected = Number((n * step).toPrecision(15));
        const q = suggestQuantity({
          side: 'S',
          entryPrice: 100,
          lc: 101,
          capitalYen: expected * 100,
          riskTolerancePct: 1,
          multiplier: 1,
          fx: 1,
          quantityStep: step,
        });
        assert(q === expected, `${n} × ${step}: ${q}`);
      },
    );
  });

  it('1R の逆算の整合: 円建てで明細の損益 = 価格からの損益・手数料 0 なら式の 1R と同じ', () => {
    forAll(
      108,
      N,
      (r) => ({
        entry: r.int(1_000, 2_000),
        width: r.int(1, 100),
        move: r.pick([-1, 1]) * r.int(1, 300),
        qty: r.int(1, 1_000),
        mult: r.pick([1, 10, 100]),
      }),
      ({ entry, width, move, qty, mult }) => {
        const base: TradeInput = {
          side: 'L',
          instrument: { multiplier: mult, quantityStep: 1, isJpy: true },
          entries: [{ price: entry, quantity: qty }],
          lc: entry - width,
          lcBasis: 'chart',
          lcDecidedBeforeEntry: true,
          lcMove: { kind: 'none' },
          timeframeChange: 'none',
          riskTolerancePct: 1,
          exit: { price: entry + move, orderType: 'unknown', reason: 'other' },
        };
        const withStatement: TradeInput = {
          ...base,
          statementPnlYen: move * qty * mult,
          feesTotalYen: 0,
        };
        assert(
          close(oneRYen(base), oneRYen(withStatement)),
          `${oneRYen(base)} / ${oneRYen(withStatement)}`,
        );
        assert(close(oneRYen(base), width * qty * mult), '式の 1R');
      },
    );
  });
});
