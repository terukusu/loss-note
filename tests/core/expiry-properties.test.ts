// 満期の損益・最大損失の性質テスト（種つきの乱数で各 1,000 回。失敗したら種と回数を出す。#114）。値はすべて架空
import { describe, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { expiryPnlPrice, type MaxLossPrice, maxLossPrice } from '../../core/expiry';
import { optionExpiryPnlYen, optionMaxLoss } from '../../core/option';
import type { Leg, LegSide, TradeInput } from '../../core/trade';
import { forAll, type Rng } from './helpers/prng';

const N = 1_000;
const SIDES: readonly LegSide[] = ['buy', 'sell'];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function close(a: number | undefined, b: number | undefined, rel = 1e-9): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}

interface Book {
  readonly legs: [Leg, ...Leg[]];
  readonly mult: number;
  readonly entry: number;
}

/** 限月のそろったレッグ（1〜6 本）。原資産・行使価格は整数、建値は小数も混ぜる */
function genBook(r: Rng): Book {
  const entry = r.int(20_000, 40_000);
  const n = r.int(1, 6);
  const legs: Leg[] = [];
  for (let i = 0; i < n; i++) {
    legs.push({
      id: `l${i + 1}`,
      optionType: r.pick(['P', 'C'] as const),
      contractMonth: '2027-01',
      strike: entry + r.int(-3_000, 3_000),
      side: r.pick(SIDES),
      quantity: r.int(1, 5),
      entry: { price: r.bool(0.2) ? r.int(0, 80_000) / 100 : r.int(0, 800) },
      exit: { price: r.int(0, 1_200), kind: 'closed' },
    });
  }
  return { legs: legs as [Leg, ...Leg[]], mult: r.pick([1_000, 100, 10]), entry };
}

/** 原資産を確かめる点: 0・行使価格とその前後・乱数の点・遠くの点 */
function probes(book: Book, r: Rng): number[] {
  const xs = [0, book.entry * 10];
  for (const l of book.legs) xs.push(l.strike, l.strike - 1, l.strike + 1);
  for (let i = 0; i < 8; i++) xs.push(r.int(0, 80_000));
  return xs;
}

/** 原資産の価格を k で折り返す（P ↔ C・行使価格 2k − K。プレミアムは同じ） */
function mirrorLegs(legs: readonly Leg[], k: number): [Leg, ...Leg[]] {
  return legs.map(
    (l) =>
      ({ ...l, optionType: l.optionType === 'P' ? 'C' : 'P', strike: 2 * k - l.strike }) as Leg,
  ) as [Leg, ...Leg[]];
}

function sameMaxLoss(a: MaxLossPrice, b: MaxLossPrice): boolean {
  if (a.defined && b.defined) return close(a.value, b.value);
  if (!a.defined && !b.defined) return a.cause === b.cause;
  return false;
}

/** 「最大損失まで」のポジション（LC なし）。為替は空のこともある */
function genMaxLossTrade(r: Rng): TradeInput {
  const book = genBook(r);
  const priceInAccountCurrency = r.bool(0.6);
  return {
    side: r.pick(['L', 'S'] as const),
    instrument: { multiplier: book.mult, quantityStep: 1, priceInAccountCurrency },
    entries: [{ price: book.entry, quantity: 1 }],
    lcBasis: 'chart',
    lcDecidedBeforeEntry: r.bool(0.9),
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    exit: {
      price: book.entry + r.int(-3_000, 3_000),
      orderType: r.pick(['market', 'unknown', 'limit'] as const),
      reason: 'other',
      ...(r.bool(0.7) ? { fxRate: r.int(80, 200) } : {}),
    },
    ...(r.bool(0.3) ? { statementPnlYen: r.int(-500_000, 500_000) } : {}),
    ...(r.bool(0.8) ? { capitalYen: r.int(1, 50) * 1_000_000 } : {}),
    riskTolerancePct: 1,
    option: { legs: book.legs, riskPlan: 'maxLoss' },
  };
}

describe('満期の損益・最大損失の性質', () => {
  it('満期の損益はすべてのレッグの満期の損益の和', () => {
    forAll(11401, N, genBook, (book) => {
      for (const x of [0, ...book.legs.map((l) => l.strike), book.entry, book.entry * 2]) {
        const whole = expiryPnlPrice(book.legs, book.mult, x);
        const sum = book.legs.reduce((s, l) => s + expiryPnlPrice([l], book.mult, x), 0);
        assert(close(whole, sum), `x = ${x}: ${whole} ≠ ${sum}`);
      }
    });
  });

  it('L / S の対称: 原資産の価格を折り返したレッグは、折り返した点で同じ満期の損益・同じ最大損失（定まるか・理由も）', () => {
    forAll(
      11402,
      N,
      (r) => ({ book: genBook(r), seed: r.int(0, 1_000_000) }),
      ({ book, seed }) => {
        const k = 50_000;
        const m = mirrorLegs(book.legs, k);
        for (const x of [book.entry, ...book.legs.map((l) => l.strike), (seed % 40_000) + 1]) {
          const a = expiryPnlPrice(book.legs, book.mult, x);
          const b = expiryPnlPrice(m, book.mult, 2 * k - x);
          assert(close(a, b), `x = ${x}: ${a} ≠ ${b}`);
        }
        const a = maxLossPrice(book.legs, book.mult);
        const b = maxLossPrice(m, book.mult);
        assert(sameMaxLoss(a, b), `最大損失 ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
      },
    );
  });

  it('枚数に対する線形: 枚数を k 倍にすると満期の損益・最大損失は k 倍（定まるか・理由は同じ）', () => {
    forAll(
      11403,
      N,
      (r) => ({ book: genBook(r), k: r.int(2, 7), x: r.int(0, 60_000) }),
      ({ book, k, x }) => {
        const scaled = book.legs.map((l) => ({ ...l, quantity: l.quantity * k }));
        assert(
          close(expiryPnlPrice(scaled, book.mult, x), k * expiryPnlPrice(book.legs, book.mult, x)),
          '満期の損益が k 倍',
        );
        const a = maxLossPrice(book.legs, book.mult);
        const b = maxLossPrice(scaled, book.mult);
        const ak: MaxLossPrice = a.defined ? { defined: true, value: a.value * k } : a;
        assert(sameMaxLoss(ak, b), `最大損失 ${JSON.stringify(ak)} ≠ ${JSON.stringify(b)}`);
      },
    );
  });

  it('最大損失は満期の損益の最小値と一致する（定まるとき）・定まらないなら端で減り続けるか損失が無い', () => {
    forAll(
      11404,
      N,
      (r) => {
        const book = genBook(r);
        return { book, xs: probes(book, r) };
      },
      ({ book, xs }) => {
        const values = xs.map((x) => expiryPnlPrice(book.legs, book.mult, x));
        const min = Math.min(...values);
        const m = maxLossPrice(book.legs, book.mult);
        if (m.defined) {
          assert(m.value > 0, `最大損失 ${m.value} が正でない`);
          // どの点も −最大損失 を下回らず、行使価格か 0 のどこかで −最大損失 に届く
          assert(min >= -m.value - 1e-6, `最小 ${min} < −${m.value}`);
          assert(close(min, -m.value), `最小 ${min} ≠ −${m.value}`);
        } else if (m.cause === 'noLoss') {
          assert(min >= -1e-6, `損失が無いはずが最小 ${min}`);
        } else if (m.cause === 'unbounded') {
          // 0 の側の傾きが正なら原資産 0 が最小の行使価格より悪く、上の端の傾きが負なら遠くの点が最大の行使価格より悪い
          const strikes = book.legs.map((l) => l.strike);
          const at = (x: number) => expiryPnlPrice(book.legs, book.mult, x);
          const lowWorse = at(0) < at(Math.min(...strikes));
          const highWorse = at(book.entry * 10) < at(Math.max(...strikes));
          assert(lowWorse || highWorse, '端で減り続けていない');
        }
      },
    );
  });

  it('NaN・無限を出さない（「最大損失まで」のポジションの判定と、満期の損益・最大損失の額）', () => {
    forAll(11405, N, genMaxLossTrade, (t) => {
      const ev = evaluateTrade(t);
      assert(ev.ok, `検査で落ちた: ${JSON.stringify(ev.ok ? [] : ev.issues)}`);
      if (!ev.ok) return;
      for (const [name, v] of Object.entries({
        pnlYen: ev.pnlYen,
        r: ev.r,
        oneRYen: ev.oneRYen,
        riskPct: ev.riskPct,
        expiry: optionExpiryPnlYen(t, t.entries[0].price),
        maxLoss: (() => {
          const m = optionMaxLoss(t);
          return m?.defined === true ? m.yen : undefined;
        })(),
      })) {
        assert(v === undefined || Number.isFinite(v), `${name} = ${v}`);
      }
      assert(ev.judgment !== undefined, '決済済みなのに判定が無い');
      // 「最大損失まで」が効けば 1R は最大損失か無し、持ち続けたは付かない
      const m = optionMaxLoss(t);
      if (m?.defined === true) {
        assert(ev.oneRSource === undefined || ev.oneRSource === 'maxLoss', `${ev.oneRSource}`);
        assert(close(ev.oneRYen, m.yen), `1R ${ev.oneRYen} ≠ 最大損失 ${m.yen}`);
        const kinds = (ev.judgment?.reasons ?? []).map((x) => x.kind);
        assert(!kinds.includes('heldPastLc'), '持ち続けたが付いた');
        assert(kinds.includes('noLc') === !t.lcDecidedBeforeEntry, 'LC を決めずに');
      }
    });
  });
});
