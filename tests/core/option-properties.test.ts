// オプションのポジションの性質テスト（種つきの乱数で各 1,000 回。失敗したら種と回数を出す）。値はすべて架空
import { describe, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { optionOneR, positionExitOrderType, positionNetYen } from '../../core/option';
import type { ExitOrderType, ExitReason, Leg, LegSide, TradeInput } from '../../core/trade';
import { forAll, type Rng } from './helpers/prng';

const N = 1_000;
const ORDER_TYPES: readonly ExitOrderType[] = ['stop', 'market', 'limit', 'unknown', 'expiry'];
const EXIT_REASONS: readonly ExitReason[] = [
  'lc',
  'gapSlip',
  'tp',
  'brokeManual',
  'fearEarly',
  'timeout',
  'other',
];
const SIDES: readonly LegSide[] = ['buy', 'sell'];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function close(a: number | undefined, b: number | undefined, rel = 1e-9): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}

/** L のポジションを乱数で作る。原資産の価格は整数（折り返しが誤差なしになるように）。LC はいつも正しい向き */
function genLongPosition(r: Rng): TradeInput {
  const entry = r.int(20_000, 40_000);
  const width = r.int(100, 2_000);
  const hasLc = r.bool(0.85);
  const n = r.int(1, 4);
  const legs: Leg[] = [];
  for (let i = 0; i < n; i++) {
    const expired = r.bool(0.3);
    legs.push({
      id: `l${i + 1}`,
      optionType: r.pick(['P', 'C'] as const),
      contractMonth: r.pick(['2027-01', '2027-02']),
      strike: entry + r.int(-3_000, 3_000),
      side: r.pick(SIDES),
      quantity: r.int(1, 5),
      entry: { price: r.int(0, 800) },
      exit: {
        price: expired && r.bool(0.6) ? 0 : r.int(0, 1_200),
        kind: expired ? 'expired' : 'closed',
      },
    });
  }
  const priceInAccountCurrency = r.bool(0.7);
  const lcMove = r.pick([
    { kind: 'none' } as const,
    { kind: 'tightened' } as const,
    { kind: 'widened' } as const,
    { kind: 'widened', after: entry - width - r.int(1, 500) } as const,
  ]);
  return {
    side: 'L',
    instrument: { multiplier: r.pick([1_000, 100, 10]), quantityStep: 1, priceInAccountCurrency },
    entries: [{ price: entry, quantity: 1 }],
    ...(hasLc ? { lc: entry - width } : {}),
    lcBasis: r.pick(['chart', 'amount'] as const),
    lcDecidedBeforeEntry: r.bool(0.8),
    lcMove: hasLc ? lcMove : { kind: 'none' },
    timeframeChange: r.pick(['none', 'longer', 'shorter'] as const),
    exit: {
      price: entry + r.int(-3_000, 3_000),
      orderType: r.pick(ORDER_TYPES),
      reason: r.pick(EXIT_REASONS),
      ...(r.bool(0.7) ? { fxRate: r.int(80, 200) } : {}),
    },
    ...(r.bool(0.4) ? { statementPnlYen: r.int(-500_000, 500_000) } : {}),
    feesTotalYen: r.pick([0, 0, r.int(1, 5_000)]),
    ...(r.bool(0.3) ? { gapSlipAnswer: r.bool() } : {}),
    ...(r.bool(0.8) ? { capitalYen: r.int(1, 50) * 1_000_000 } : {}),
    riskTolerancePct: 1,
    option: {
      legs: legs as [Leg, ...Leg[]],
      ...(r.bool(0.25) ? { lcLossPlanYen: r.int(10_000, 500_000) } : {}),
    },
  };
}

/** 原資産の価格を K で折り返した S のポジション（L / S の対称）。レッグは P / C と行使価格を折り返し、プレミアムは同じ */
function mirror(t: TradeInput, k: number): TradeInput {
  const f = (p: number) => 2 * k - p;
  const o = t.option;
  if (o === undefined || t.exit === undefined) throw new Error('ポジションでない');
  const legs = o.legs.map(
    (l) => ({ ...l, optionType: l.optionType === 'P' ? 'C' : 'P', strike: f(l.strike) }) as Leg,
  );
  const lcMove =
    t.lcMove.kind === 'widened' && t.lcMove.after !== undefined
      ? { kind: 'widened' as const, after: f(t.lcMove.after) }
      : t.lcMove;
  return {
    ...t,
    side: 'S',
    entries: [{ price: f(t.entries[0].price), quantity: 1 }],
    ...(t.lc === undefined ? {} : { lc: f(t.lc) }),
    lcMove,
    exit: { ...t.exit, price: f(t.exit.price) },
    option: { ...o, legs: legs as [Leg, ...Leg[]] },
  };
}

/** すべての枚数（と明細の損益・手数料・見込み）を k 倍にする */
function scale(t: TradeInput, k: number): TradeInput {
  const o = t.option;
  if (o === undefined) throw new Error('ポジションでない');
  const legs = o.legs.map((l) => ({ ...l, quantity: l.quantity * k }));
  return {
    ...t,
    ...(t.statementPnlYen === undefined ? {} : { statementPnlYen: t.statementPnlYen * k }),
    ...(t.feesTotalYen === undefined ? {} : { feesTotalYen: t.feesTotalYen * k }),
    option: {
      legs: legs as [Leg, ...Leg[]],
      ...(o.lcLossPlanYen === undefined ? {} : { lcLossPlanYen: o.lcLossPlanYen * k }),
    },
  };
}

describe('オプションのポジションの性質', () => {
  it('作った入力は検査を通る', () => {
    forAll(11301, N, genLongPosition, (t) => {
      const ev = evaluateTrade(t);
      assert(ev.ok, `検査で落ちた: ${JSON.stringify(ev.ok ? [] : ev.issues)}`);
    });
  });

  it('L / S の対称: 原資産の価格を折り返した S のポジションは、損益・1R・R・判定・理由が同じ', () => {
    forAll(11302, N, genLongPosition, (t) => {
      const a = evaluateTrade(t);
      const b = evaluateTrade(mirror(t, 50_000));
      assert(a.ok && b.ok, '検査で落ちた');
      if (!a.ok || !b.ok) return;
      assert(close(a.pnlYen, b.pnlYen), `損益 ${a.pnlYen} ≠ ${b.pnlYen}`);
      assert(close(a.oneRYen, b.oneRYen), `1R ${a.oneRYen} ≠ ${b.oneRYen}`);
      assert(close(a.r, b.r), `R ${a.r} ≠ ${b.r}`);
      assert(a.oneRSource === b.oneRSource, '1R の出どころ');
      assert(
        a.judgment?.grade === b.judgment?.grade,
        `判定 ${a.judgment?.grade} ≠ ${b.judgment?.grade}`,
      );
      assert(a.judgment?.outcome === b.judgment?.outcome, '勝ち負け');
      const ka = (a.judgment?.reasons ?? []).map((x) => x.kind).join(',');
      const kb = (b.judgment?.reasons ?? []).map((x) => x.kind).join(',');
      assert(ka === kb, `理由 ${ka} ≠ ${kb}`);
    });
  });

  it('枚数に対する線形: 枚数を k 倍にすると損益・1R は k 倍、R・判定は変わらない（資金も k 倍）', () => {
    forAll(
      11303,
      N,
      (r) => ({ t: genLongPosition(r), k: r.int(2, 7) }),
      ({ t, k }) => {
        const scaled = scale(t, k);
        const withCapital =
          t.capitalYen === undefined ? scaled : { ...scaled, capitalYen: t.capitalYen * k };
        const a = evaluateTrade(t);
        const b = evaluateTrade(withCapital);
        assert(a.ok && b.ok, '検査で落ちた');
        if (!a.ok || !b.ok) return;
        assert(close(b.pnlYen, a.pnlYen === undefined ? undefined : a.pnlYen * k), '損益が k 倍');
        assert(close(b.oneRYen, a.oneRYen === undefined ? undefined : a.oneRYen * k), '1R が k 倍');
        assert(close(a.r, b.r), `R ${a.r} ≠ ${b.r}`);
        assert(close(a.riskPct, b.riskPct), 'リスク（%）');
        assert(
          a.judgment?.grade === b.judgment?.grade,
          `判定 ${a.judgment?.grade} ≠ ${b.judgment?.grade}`,
        );
      },
    );
  });

  it('NaN・無限を出さない（数は有限か無し）', () => {
    forAll(11304, N, genLongPosition, (t) => {
      const ev = evaluateTrade(t);
      if (!ev.ok) return;
      for (const [name, v] of Object.entries({
        pnlYen: ev.pnlYen,
        r: ev.r,
        oneRYen: ev.oneRYen,
        riskPct: ev.riskPct,
      })) {
        assert(v === undefined || Number.isFinite(v), `${name} = ${v}`);
      }
      assert(ev.judgment !== undefined, '決済済みなのに判定が無い');
    });
  });

  it('明細の損益が無ければ、手数料だけを変えても手数料を除いた損益・R・勝ち負けは変わらない（B1）', () => {
    forAll(
      11307,
      N,
      (r) => ({ t: genLongPosition(r), fees: r.int(0, 50_000) }),
      ({ t, fees }) => {
        const { statementPnlYen: _drop, ...rest } = t;
        const a: TradeInput = { ...rest, feesTotalYen: 0 };
        const b: TradeInput = { ...rest, feesTotalYen: fees };
        assert(close(positionNetYen(a), positionNetYen(b)), '手数料を除いた損益');
        const ea = evaluateTrade(a);
        const eb = evaluateTrade(b);
        if (!ea.ok || !eb.ok) return;
        assert(close(ea.r, eb.r), `R ${ea.r} ≠ ${eb.r}`);
        assert(ea.judgment?.outcome === eb.judgment?.outcome, '勝ち負け');
      },
    );
  });

  it('明細の損益があれば、手数料を k 増やして明細の損益を k 減らしても手数料を除いた損益は変わらない', () => {
    forAll(
      11308,
      N,
      (r) => ({ t: genLongPosition(r), k: r.int(1, 50_000) }),
      ({ t, k }) => {
        if (t.statementPnlYen === undefined) return;
        const fees = t.feesTotalYen ?? 0;
        const b: TradeInput = {
          ...t,
          statementPnlYen: t.statementPnlYen - k,
          feesTotalYen: fees + k,
        };
        assert(close(positionNetYen(t), positionNetYen(b)), '手数料を除いた損益');
      },
    );
  });

  it('実際の動きからの 1R は |手数料を除いた損益| の 2 倍以下で正', () => {
    forAll(11305, N, genLongPosition, (t) => {
      const oneR = optionOneR(t);
      if (oneR?.source !== 'actualMove') return;
      const net = positionNetYen(t);
      assert(net !== undefined && net < 0, '負けだけ');
      if (net === undefined) return;
      assert(oneR.value > 0 && oneR.value <= 2 * Math.abs(net) * (1 + 1e-12), `1R ${oneR.value}`);
    });
  });

  it('負けで原資産が LC を越え、逆指値でも窓・滑りでもなく、広げていなければ持ち続けた', () => {
    forAll(11306, N, genLongPosition, (t) => {
      const ev = evaluateTrade(t);
      if (!ev.ok || t.exit === undefined || t.lc === undefined) return;
      if (t.lcMove.kind === 'widened') return;
      const rescued =
        positionExitOrderType(t.option?.legs ?? [], t.exit.orderType) === 'stop' ||
        t.exit.reason === 'gapSlip' ||
        t.gapSlipAnswer === true;
      const beyond = t.exit.price < t.lc;
      const held = (ev.judgment?.reasons ?? []).some((x) => x.kind === 'heldPastLc');
      assert(
        held === (beyond && !rescued),
        `持ち続けた ${held}・越えた ${beyond}・救い ${rescued}`,
      );
    });
  });
});
