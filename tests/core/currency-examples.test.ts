// 通貨と為替の手計算の例（Issue #47 PR-2 の F1〜F15。AC-13・AC-14）。値・名前はすべて架空。
// 保存の形（snapshot の口座の通貨・銘柄の価格の通貨）→ toTradeInput → evaluateTrade / statementFxRate で確かめる。
// 共通の場面 P: L、イン 100.00、LC 99.50、乗数 1、3 つのタップは計画どおり、LC の根拠はチャート
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { statementFxRate } from '../../core/pnl';
import { type StoredTrade, type TradeRecord, toTradeInput } from '../../core/record';
import { reviewSizing } from '../../core/sizing';
import type { Side } from '../../core/trade';

interface Scene {
  readonly side?: Side;
  readonly entry?: number;
  readonly lc?: number;
  readonly exit: number;
  readonly quantity?: number;
  readonly priceCurrency: string | null;
  /** 無い = snapshot に口座の通貨が無い（移す前の取引） */
  readonly accountCurrency?: string;
  readonly capital: number | null;
  readonly fxRate?: number;
  readonly statementPnl?: number;
  readonly fee?: number;
}

function stored(s: Scene): Pick<StoredTrade, 'record' | 'snapshot'> {
  const record: TradeRecord = {
    status: 'closed',
    source: 'manual',
    instrumentId: 'INSTRUMENT',
    side: s.side ?? 'L',
    lc: s.lc ?? 99.5,
    lcBasis: 'chart',
    stopOrderPlaced: 'unanswered',
    lcDecidedBeforeEntry: true,
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    entries: [{ price: s.entry ?? 100, quantity: s.quantity ?? 100 }],
    exit: {
      time: 1_700_000_000_000,
      price: s.exit,
      ...(s.fxRate === undefined ? {} : { fxRate: s.fxRate }),
      orderType: 'unknown',
      reason: 'lc',
      gapSlip: 'unanswered',
    },
    ...(s.statementPnl === undefined ? {} : { statementPnlYen: s.statementPnl }),
    fees: s.fee === undefined ? [] : [{ label: '手数料', amountYen: s.fee }],
  };
  return {
    record,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: s.priceCurrency,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: s.capital,
      riskTolerancePct: 1,
      ...(s.accountCurrency === undefined ? {} : { accountCurrency: s.accountCurrency }),
    },
  };
}

function judged(s: Scene) {
  const ev = evaluateTrade(toTradeInput(stored(s)));
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev.issues)}`);
  return ev;
}

/** 金額は 1e-9 の誤差まで */
function expectMoney(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(1e-9 * Math.abs(expected));
}

// 口座 A = JPY・資金 1,000,000 / 口座 D = USD・資金 10,000
const A = { accountCurrency: 'JPY', capital: 1_000_000 } as const;
const D = { accountCurrency: 'USD', capital: 10_000 } as const;

describe('損益・1R・リスク（%）・R・判定（AC-13）', () => {
  it('F1: JPY の口座・USD 建て・数量 100・決済 99.50・為替 150 → −7,500 円・1R 7,500 円・0.75%・−1.0R・A', () => {
    const ev = judged({ ...A, priceCurrency: 'USD', exit: 99.5, fxRate: 150 });
    // 損益 = (99.50 − 100.00) × 100 × 1 × 150 = −7,500。1R = 0.50 × 100 × 1 × 150 = 7,500
    // リスク = 7,500 ÷ 1,000,000 × 100 = 0.75（表示は切り上げて 0.8%）。R = −0.50 ÷ 0.50 = −1.0
    expectMoney(ev.pnlYen, -7_500);
    expectMoney(ev.oneRYen, 7_500);
    expectMoney(ev.riskPct, 0.75);
    expect(ev.r).toBeCloseTo(-1.0, 12);
    expect(ev.judgment?.grade).toBe('A');
  });

  it('F2: F1 で為替も明細の損益も空 → R −1.0 は出る。損益・1R・リスクは無し、理由 riskNotChecked(noOneR)、A', () => {
    const ev = judged({ ...A, priceCurrency: 'USD', exit: 99.5 });
    expect(ev.r).toBeCloseTo(-1.0, 12);
    expect(ev.pnlYen).toBeUndefined();
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
    expect(ev.judgment?.grade).toBe('A');
  });

  it('F7: F1 で為替 150 と明細 −9,000（手数料 0）→ 損益 −9,000・1R 9,000・0.9%（明細の値が正）', () => {
    const ev = judged({
      ...A,
      priceCurrency: 'USD',
      exit: 99.5,
      fxRate: 150,
      statementPnl: -9_000,
    });
    // 損益 = 明細の −9,000。1R = 9,000 × 0.50 ÷ 0.50 = 9,000（C32）。リスク = 9,000 ÷ 1,000,000 × 100 = 0.9
    expectMoney(ev.pnlYen, -9_000);
    expectMoney(ev.oneRYen, 9_000);
    expectMoney(ev.riskPct, 0.9);
    expect(ev.r).toBeCloseTo(-1.0, 12);
    expect(ev.judgment?.grade).toBe('A');
  });

  it('F9: USD の口座・USD 建て → 為替 1。損益 −50・1R 50・0.5%', () => {
    // fxRate を入れても使わない（価格の通貨 = 口座の通貨）
    const ev = judged({ ...D, priceCurrency: 'USD', exit: 99.5, fxRate: 999 });
    // 損益 = −0.50 × 100 × 1 × 1 = −50。1R = 0.50 × 100 = 50。リスク = 50 ÷ 10,000 × 100 = 0.5
    expectMoney(ev.pnlYen, -50);
    expectMoney(ev.oneRYen, 50);
    expectMoney(ev.riskPct, 0.5);
    expect(ev.r).toBeCloseTo(-1.0, 12);
    expect(ev.judgment?.grade).toBe('A');
  });

  it('F10: USD の口座・EUR 建て・為替 1.10 → 1R 55・0.55%', () => {
    const ev = judged({ ...D, priceCurrency: 'EUR', exit: 99.5, fxRate: 1.1 });
    // 1R = 0.50 × 100 × 1 × 1.10 = 55。損益 = −55。リスク = 55 ÷ 10,000 × 100 = 0.55（表示は 0.6%）
    expectMoney(ev.oneRYen, 55);
    expectMoney(ev.pnlYen, -55);
    expectMoney(ev.riskPct, 0.55);
    expect(ev.judgment?.grade).toBe('A');
  });

  it('F15: snapshot に口座の通貨が無い・USD 建て・明細あり → JPY として移す前と同じ値', () => {
    const scene: Scene = {
      capital: 1_000_000,
      priceCurrency: 'USD',
      exit: 99.4,
      statementPnl: -9_100,
      fee: 100,
    };
    const ev = judged(scene);
    // 移す前（為替 1 で固定にならない = USD ≠ JPY）: 1R = (9,100 − 100) × 0.50 ÷ 0.60 = 7,500。R = −1.2
    expectMoney(ev.pnlYen, -9_100);
    expectMoney(ev.oneRYen, 7_500);
    expectMoney(ev.riskPct, 0.75);
    expect(ev.r).toBeCloseTo(-1.2, 12);
    expect(ev).toEqual(judged({ ...scene, accountCurrency: 'JPY' }));
  });

  it('F8: JPY の口座・円建て → 為替 1（A1 と同じ値）', () => {
    const ev = judged({ ...A, priceCurrency: 'JPY', exit: 99.5, quantity: 10_000 });
    // 1R = 0.50 × 10,000 = 5,000。リスク 0.5%
    expectMoney(ev.oneRYen, 5_000);
    expectMoney(ev.riskPct, 0.5);
  });

  it('F11: 価格の通貨 未設定 → 為替 1 にしない。1R は明細の損益があるときだけ', () => {
    expect(judged({ ...A, priceCurrency: null, exit: 99.5 }).oneRYen).toBeUndefined();
    const ev = judged({ ...A, priceCurrency: null, exit: 99.5, statementPnl: -5_000 });
    expectMoney(ev.oneRYen, 5_000);
  });
});

describe('明細から逆算した為替（AC-14・R6）', () => {
  const F3: Scene = { ...A, priceCurrency: 'USD', exit: 99.4, statementPnl: -9_100, fee: 100 };

  it('F3: L・決済 99.40・明細 −9,100・手数料 100 → 為替 150。1R 7,500・0.75%・−1.2R', () => {
    // net = −9,100 + 100 = −9,000。move = (99.40 − 100.00) × 100 = −60。為替 = −9,000 ÷ (−60 × 1) = 150
    expectMoney(statementFxRate(toTradeInput(stored(F3))), 150);
    const ev = judged(F3);
    // 1R = 9,000 × 0.50 ÷ 0.60 = 7,500（= 0.50 × 100 × 150）
    expectMoney(ev.oneRYen, 7_500);
    expectMoney(ev.riskPct, 0.75);
    expect(ev.r).toBeCloseTo(-1.2, 12);
  });

  it('F4: 決済 = イン（100.00）・明細 −100 → 見せない', () => {
    expect(
      statementFxRate(toTradeInput(stored({ ...F3, exit: 100, statementPnl: -100 }))),
    ).toBeUndefined();
  });

  it('F5: 明細 +400・手数料 100（net +500、値動きは −0.60）→ 符号が食い違うので見せない', () => {
    expect(statementFxRate(toTradeInput(stored({ ...F3, statementPnl: 400 })))).toBeUndefined();
  });

  it('F6: S・イン 100.00・LC 100.50・決済 100.60・明細 −9,100・手数料 100 → 為替 150。1R 7,500・−1.2R', () => {
    const s: Scene = { ...F3, side: 'S', lc: 100.5, exit: 100.6 };
    // move = −(100.60 − 100.00) × 100 = −60。net = −9,000。為替 = 150
    expectMoney(statementFxRate(toTradeInput(stored(s))), 150);
    const ev = judged(s);
    expectMoney(ev.oneRYen, 7_500);
    expect(ev.r).toBeCloseTo(-1.2, 12);
  });

  it('価格の通貨 = 口座の通貨・明細が無い・net が 0 なら見せない', () => {
    expect(statementFxRate(toTradeInput(stored({ ...F3, priceCurrency: 'JPY' })))).toBeUndefined();
    expect(
      statementFxRate(toTradeInput(stored({ ...A, priceCurrency: 'USD', exit: 99.4 }))),
    ).toBeUndefined();
    expect(
      statementFxRate(toTradeInput(stored({ ...F3, statementPnl: -100, fee: 100 }))),
    ).toBeUndefined();
  });

  it('エントリーが 2 つ（買い増し）の取引には出さない（C32 の 1R の逆算と同じ条件）', () => {
    const base = stored(F3);
    const t = toTradeInput({
      ...base,
      record: {
        ...base.record,
        entries: [
          { price: 100, quantity: 50 },
          { price: 100, quantity: 50 },
        ],
      },
    });
    expect(statementFxRate(t)).toBeUndefined();
  });

  it('乗数が 1 でないとき: 為替 = net ÷ (move × 乗数)', () => {
    const base = stored(F3);
    const t = toTradeInput({
      ...base,
      snapshot: { ...base.snapshot, instrument: { ...base.snapshot.instrument, multiplier: 10 } },
    });
    // −9,000 ÷ (−60 × 10) = 15
    expectMoney(statementFxRate(t), 15);
  });
});

describe('数量の比と提案の数量（#67）は口座の通貨で 1R と資金をそろえて出す（#47 PR-2）', () => {
  it('F1（JPY の口座・USD 建て・為替 150）: 1R 7,500 ÷ 許容額 10,000 = 0.75 倍・提案 floor(100 × 10,000 ÷ 7,500) = 133', () => {
    const r = reviewSizing(
      toTradeInput(stored({ ...A, priceCurrency: 'USD', exit: 99.5, fxRate: 150 })),
    );
    expect(r?.ratio).toBeCloseTo(0.75, 12);
    expect(r?.allowance).toBe(10_000);
    expect(r?.suggestedQuantity).toBe(133);
  });

  it('F9（USD の口座・USD 建て）: 1R 50 USD ÷ 許容額 100 USD = 0.5 倍・提案 200（為替に依らない）', () => {
    const r = reviewSizing(toTradeInput(stored({ ...D, priceCurrency: 'USD', exit: 99.5 })));
    expect(r?.ratio).toBeCloseTo(0.5, 12);
    expect(r?.allowance).toBe(100);
    expect(r?.suggestedQuantity).toBe(200);
  });

  it('F2（為替も明細も無い）: 1R が出ないので比も出さない', () => {
    expect(
      reviewSizing(toTradeInput(stored({ ...A, priceCurrency: 'USD', exit: 99.5 }))),
    ).toBeUndefined();
  });
});
