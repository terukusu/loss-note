// 性質テスト（種つきの乱数で各 1,000 回。失敗したら種と回数を出す）。値はすべて架空
import { describe, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { REASON_ORDER, REASON_WEIGHT, type Reason } from '../../core/judge';
import {
  isPostSingleEntry,
  oneRYen,
  pnlYen,
  riskPct,
  rMultiple,
  statementFxRate,
} from '../../core/pnl';
import { type StoredTrade, toTradeInput } from '../../core/record';
import { reviewSizing, suggestQuantity } from '../../core/sizing';
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
  const priceInAccountCurrency = r.bool();
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
    instrument: { multiplier: r.pick([1, 10, 100, 0.5]), quantityStep: 1, priceInAccountCurrency },
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
          instrument: { multiplier: mult, quantityStep: 1, priceInAccountCurrency: true },
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
  // ---- 数量の比と提案の数量（#67 AC-4）。乱数の取引に刻みを混ぜる ----

  /** 刻みを乱数で選び直した取引 */
  function withStep(t: TradeInput, step: number): TradeInput {
    return { ...t, instrument: { ...t.instrument, quantityStep: step } };
  }

  it('数量の比: 比 × 許容リスク = リスク（%）、比 > 0、出ない ⇔ 1R か資金が無い', () => {
    forAll(
      109,
      N,
      (r) => genLongTrade(r),
      (t) => {
        const s = reviewSizing(t);
        const o = oneRYen(t);
        const has = o !== undefined && o > 0 && t.capitalYen !== undefined;
        assert((s !== undefined) === has, `出る / 出ない ${s?.ratio} 1R ${o}`);
        if (s === undefined) return;
        assert(s.ratio > 0 && Number.isFinite(s.ratio), `比 ${s.ratio}`);
        assert(
          close(s.ratio * t.riskTolerancePct, riskPct(t)),
          `${s.ratio} × ${t.riskTolerancePct}`,
        );
        assert(
          (s.suggestedQuantity !== undefined) === (t.entries.length === 1),
          `提案はエントリー 1 つのときだけ ${t.entries.length}`,
        );
      },
    );
  });

  it('提案の数量: 刻みの整数倍・0 以上、そのリスクは許容額以下で、1 刻み足すと許容額を超える', () => {
    const steps = [100, 10, 1, 0.1, 0.01];
    forAll(
      110,
      N,
      (r) => withStep(genLongTrade(r), r.pick(steps)),
      (t) => {
        const s = reviewSizing(t);
        const o = oneRYen(t);
        if (s?.suggestedQuantity === undefined || o === undefined) return;
        const q = s.suggestedQuantity;
        const step = t.instrument.quantityStep;
        assert(q >= 0, `提案 ${q}`);
        assert(close(Math.round(q / step) * step, q, 1e-12), `刻みの整数倍でない ${q} / ${step}`);
        // 1 数量あたりのリスク = 1R ÷ 数量（1R は数量に比例する。明細の逆算でも同じ取引の 1 数量あたり）
        const unit = o / t.entries[0].quantity;
        assert(
          q * unit <= s.allowance * (1 + 1e-9),
          `許容額を超える ${q} × ${unit} > ${s.allowance}`,
        );
        assert((q + step) * unit > s.allowance, `1 刻み足しても超えない ${q}`);
      },
    );
  });

  it('提案の数量: 円建て・エントリー 1 つ・明細の損益なしの取引では、入る前の数量の提案（5.2 の式）と同じ', () => {
    // 事後の逆算（数量 × 許容額 ÷ 1R）と 5.2 の式（資金 × 許容リスク ÷ (|イン − LC| × 乗数 × 為替)）を独立に突き合わせる
    const steps = [100, 10, 1, 0.1, 0.01];
    forAll(
      113,
      N,
      (r) => {
        const side = r.pick(['L', 'S'] as const);
        const entry = r.int(1_000, 50_000) / r.pick([1, 100]);
        const width = r.int(1, 500) / r.pick([1, 10, 100]);
        const lc = side === 'L' ? entry - width : entry + width;
        const t: TradeInput = {
          side,
          instrument: {
            multiplier: r.pick([1, 10, 100, 0.1]),
            quantityStep: r.pick(steps),
            priceInAccountCurrency: true,
          },
          entries: [{ price: entry, quantity: r.int(1, 100_000) / r.pick([1, 10, 100]) }],
          lc,
          lcBasis: 'chart',
          lcDecidedBeforeEntry: true,
          lcMove: { kind: 'none' },
          timeframeChange: 'none',
          capitalYen: r.int(100, 50_000) * 1_000,
          riskTolerancePct: r.pick([0.5, 1, 1.5, 2, 3]),
          exit: { price: lc, orderType: 'unknown', reason: 'other' },
        };
        return t;
      },
      (t) => {
        const want = suggestQuantity({
          side: t.side,
          entryPrice: t.entries[0].price,
          ...(t.lc === undefined ? {} : { lc: t.lc }),
          ...(t.capitalYen === undefined ? {} : { capitalYen: t.capitalYen }),
          riskTolerancePct: t.riskTolerancePct,
          multiplier: t.instrument.multiplier,
          fx: 1,
          quantityStep: t.instrument.quantityStep,
        });
        const got = reviewSizing(t)?.suggestedQuantity;
        assert(want !== undefined && got === want, `事後 ${got} / 5.2 ${want}`);
      },
    );
  });

  it('数量の比: L と S（価格を折り返す）で同じ', () => {
    forAll(
      111,
      N,
      (r) => ({ t: genLongTrade(r), k: r.int(1_500, 3_000) }),
      ({ t, k }) => {
        const a = reviewSizing(t);
        const b = reviewSizing(mirror(t, k));
        assert(close(a?.ratio, b?.ratio), `比 ${a?.ratio} / ${b?.ratio}`);
        assert(a?.suggestedQuantity === b?.suggestedQuantity, '提案');
      },
    );
  });

  it('数量の比: 資金と数量（明細の損益・手数料も）を同じ k 倍にしても同じ。数量を増やすと減らない', () => {
    forAll(
      112,
      N,
      (r) => ({ t: genLongTrade(r), k: r.int(2, 50) / r.pick([1, 10]) }),
      ({ t, k }) => {
        const more = t.entries.map((e) => ({ ...e, quantity: e.quantity * k })) as [
          Entry,
          ...Entry[],
        ];
        const scaled: TradeInput = {
          ...t,
          entries: more,
          ...(t.capitalYen === undefined ? {} : { capitalYen: t.capitalYen * k }),
          ...(t.statementPnlYen === undefined ? {} : { statementPnlYen: t.statementPnlYen * k }),
          ...(t.feesTotalYen === undefined ? {} : { feesTotalYen: t.feesTotalYen * k }),
        };
        const a = reviewSizing(t);
        assert(close(a?.ratio, reviewSizing(scaled)?.ratio), `同じ k 倍 ${k}`);
        // 数量だけ k 倍にする。比は数量の多い方が小さくならない（明細から 1R を出した取引は変わらない）
        const b = reviewSizing({ ...t, entries: more });
        if (a === undefined || b === undefined) return;
        const [small, large] = k >= 1 ? [a, b] : [b, a];
        assert(
          large.ratio >= small.ratio * (1 - 1e-9),
          `数量の多い方の比が小さい ${small.ratio} → ${large.ratio}（k ${k}）`,
        );
      },
    );
  });
});

// 通貨と為替（#47 PR-2・C43）。金額は口座の通貨
describe('性質: 通貨と為替', () => {
  /** 為替（決済・計画）を差し替える */
  const withFx = (t: TradeInput, exitFx: number | undefined, planFx: number | undefined) => {
    const { planFxRate: _p, ...rest } = t;
    let exit = t.exit;
    if (exit !== undefined) {
      const { fxRate: _f, ...e } = exit;
      exit = exitFx === undefined ? e : { ...e, fxRate: exitFx };
    }
    return {
      ...rest,
      ...(exit === undefined ? {} : { exit }),
      ...(planFx === undefined ? {} : { planFxRate: planFx }),
    } as TradeInput;
  };
  const withSame = (t: TradeInput, same: boolean): TradeInput => ({
    ...t,
    instrument: { ...t.instrument, priceInAccountCurrency: same },
  });

  it('P1: 価格の通貨 = 口座の通貨なら、為替を何にしても損益・1R・リスク・R が同じ', () => {
    forAll(
      401,
      N,
      (r) => ({ t: withSame(genLongTrade(r), true), fx: r.int(1, 300) / 7 }),
      ({ t, fx }) => {
        const a = evaluateTrade(t);
        const b = evaluateTrade(withFx(t, fx, fx));
        assert(
          JSON.stringify(a) === JSON.stringify(b),
          `${JSON.stringify(a)} / ${JSON.stringify(b)}`,
        );
      },
    );
  });

  it('P2: R 倍数は為替・口座の通貨・資金に依らない', () => {
    forAll(
      402,
      N,
      (r) => ({ t: genLongTrade(r), fx: r.int(1, 300) / 3, cap: r.int(1, 1_000) * 1_000 }),
      ({ t, fx, cap }) => {
        const base = rMultiple(t);
        for (const v of [
          withSame(t, !t.instrument.priceInAccountCurrency),
          withFx(t, fx, fx),
          { ...t, capitalYen: cap },
        ])
          assert(rMultiple(v) === base, `R ${rMultiple(v)} / ${base}`);
      },
    );
  });

  it('P3: 明細の損益が無ければ、損益と 1R は為替に比例し、資金も同じ倍ならリスク（%）は同じ', () => {
    forAll(
      403,
      N,
      (r) => ({
        t: withSame(genLongTrade(r, { statement: false }), false),
        fx: r.int(80, 200),
        k: r.pick([0.01, 0.5, 2, 3, 150]),
      }),
      ({ t, fx, k }) => {
        const a = withFx(t, fx, fx);
        const b = {
          ...withFx(t, fx * k, fx * k),
          ...(t.capitalYen === undefined ? {} : { capitalYen: t.capitalYen * k }),
        };
        const pa = pnlYen(a);
        const oa = oneRYen(a);
        assert(
          close(pnlYen(b), pa === undefined ? undefined : pa * k),
          `損益 ${pnlYen(b)} / ${pa}×${k}`,
        );
        assert(
          close(oneRYen(b), oa === undefined ? undefined : oa * k),
          `1R ${oneRYen(b)} / ${oa}×${k}`,
        );
        assert(close(riskPct(b), riskPct(a)), `リスク ${riskPct(b)} / ${riskPct(a)}`);
      },
    );
  });

  it('P4: 逆算の為替が出るなら、明細を外してその為替で計算した損益 = 手数料を除いた損益、1R も C32 の逆算と一致', () => {
    let seen = 0;
    forAll(
      404,
      N,
      (r) => {
        const t = withSame(genLongTrade(r, { statement: false }), false);
        return {
          t: { ...t, statementPnlYen: r.int(-100_000, 100_000), feesTotalYen: r.int(0, 2_000) },
        };
      },
      ({ t }) => {
        const fx = statementFxRate(t);
        if (fx === undefined) return;
        seen++;
        const { statementPnlYen: st, feesTotalYen: fees, ...rest } = t;
        const plain = withFx(rest as TradeInput, fx, fx);
        const net = (st ?? 0) + (fees ?? 0);
        assert(close(pnlYen(plain), net), `損益 ${pnlYen(plain)} / net ${net}`);
        if (isPostSingleEntry(t))
          assert(close(oneRYen(plain), oneRYen(t)), `1R ${oneRYen(plain)} / ${oneRYen(t)}`);
      },
    );
    assert(seen > 100, `逆算が出た件数 ${seen}`);
  });

  it('P5: 逆算の為替は出るなら正の有限の数。明細なし・net 0・決済 = イン・同じ通貨・1 エントリーでない取引なら出ない', () => {
    forAll(
      405,
      N,
      (r) => {
        const t = withSame(genLongTrade(r, { statement: false }), false);
        return {
          t: { ...t, statementPnlYen: r.int(-100_000, 100_000), feesTotalYen: r.int(0, 2_000) },
        };
      },
      ({ t }) => {
        const fx = statementFxRate(t);
        if (fx !== undefined) assert(Number.isFinite(fx) && fx > 0, `為替 ${fx}`);
        const { statementPnlYen: _s, ...noStatement } = t;
        assert(statementFxRate(noStatement as TradeInput) === undefined, '明細なし');
        assert(
          statementFxRate({ ...t, statementPnlYen: -(t.feesTotalYen ?? 0) }) === undefined,
          'net 0',
        );
        assert(statementFxRate(withSame(t, true)) === undefined, '同じ通貨');
        if (!isPostSingleEntry(t))
          assert(fx === undefined, '2 つ以上のエントリー・計画あり（C32 と同じ）');
        if (t.exit !== undefined) {
          const flat: TradeInput = {
            ...t,
            entries: t.entries.map((e) => ({ ...e, price: t.exit?.price ?? e.price })) as [
              Entry,
              ...Entry[],
            ],
          };
          assert(statementFxRate(flat) === undefined, '決済 = イン');
        }
      },
    );
  });

  it('P6: snapshot に口座の通貨が無い ≡ JPY（toTradeInput が同じ入力を返す）', () => {
    forAll(
      406,
      N,
      (r) => ({
        price: r.pick(['JPY', 'USD', 'EUR', null] as const),
        cap: r.bool(0.8) ? r.int(1, 1_000) * 1_000 : null,
        fx: r.bool() ? r.int(80, 200) : undefined,
        st: r.bool() ? r.int(-10_000, 10_000) : undefined,
      }),
      ({ price, cap, fx, st }) => {
        const t: Pick<StoredTrade, 'record' | 'snapshot'> = {
          record: {
            status: 'closed',
            source: 'manual',
            instrumentId: 'I',
            side: 'L',
            lc: 99.5,
            lcBasis: 'chart',
            stopOrderPlaced: 'unanswered',
            lcDecidedBeforeEntry: true,
            lcMove: { kind: 'none' },
            timeframeChange: 'none',
            entries: [{ price: 100, quantity: 10 }],
            exit: {
              time: 1,
              price: 99,
              ...(fx === undefined ? {} : { fxRate: fx }),
              orderType: 'unknown',
              reason: 'other',
              gapSlip: 'unanswered',
            },
            ...(st === undefined ? {} : { statementPnlYen: st }),
            fees: [],
          },
          snapshot: {
            instrument: {
              multiplier: 1,
              quantityStep: 1,
              priceCurrency: price,
              underlyingKind: 'index',
              productForm: 'spotCfd',
            },
            capitalYen: cap,
            riskTolerancePct: 1,
          },
        };
        const a = toTradeInput(t);
        const b = toTradeInput({ ...t, snapshot: { ...t.snapshot, accountCurrency: 'JPY' } });
        assert(
          JSON.stringify(a) === JSON.stringify(b),
          `${JSON.stringify(a)} / ${JSON.stringify(b)}`,
        );
      },
    );
  });
});
