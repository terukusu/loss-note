// 判定の補いの例 J1〜J12（Issue #2。設計書 5.3・5.4・C29〜C33。値はすべて架空）
import { describe, expect, it } from 'vitest';
import { type Evaluation, evaluateTrade } from '../../core/evaluate';
import { gradeOf, type ReasonKind, slipAllowance } from '../../core/judge';
import type { TradeInput } from '../../core/trade';
import { forAll } from './helpers/prng';
import { closedAt, closedAtR, trade, without } from './helpers/trade-builder';

type Ok = Extract<Evaluation, { ok: true }>;

function evaluated(t: TradeInput): Ok {
  const ev = evaluateTrade(t);
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev.issues)}`);
  return ev;
}

function kinds(ev: Ok): ReasonKind[] {
  return (ev.judgment?.reasons ?? []).map((r) => r.kind);
}

describe('判定の補い J1〜J5', () => {
  it('J1 LC を決めず・時間足を長い足へ・リスク 2.8%・−1.0R は C で、理由が 3 つ並ぶ', () => {
    // 1R = 0.50 × 56,000 = 28,000 円 → 28,000 ÷ 1,000,000 × 100 = 2.8%
    const ev = evaluated(
      closedAtR(-1.0, {
        lcDecidedBeforeEntry: false,
        timeframeChange: 'longer',
        entries: [{ price: 100, quantity: 56_000 }],
      }),
    );
    expect(ev.riskPct).toBeCloseTo(2.8, 4);
    expect(ev.judgment?.grade).toBe('C');
    expect(kinds(ev)).toEqual(['noLc', 'timeframeLonger', 'overRisk']);
  });

  it('J2 リスク 2.5%・TP で +1.5R は危ない勝ち（過剰リスク）', () => {
    // 0.50 × 50,000 = 25,000 円 → 2.5%
    const ev = evaluated(
      closedAtR(1.5, { entries: [{ price: 100, quantity: 50_000 }] }, { reason: 'tp' }),
    );
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('overRisk');
  });

  it('J3 LC の根拠「金額から決めた」・+1.0R は危ない勝ち（金額ありき）', () => {
    const ev = evaluated(closedAtR(1.0, { lcBasis: 'amount' }));
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('amountBasedLc');
  });

  it('J4 事後。時間足を長い足へ・+0.4R は危ない勝ち（時間足を変えた）', () => {
    const ev = evaluated(closedAtR(0.4, { timeframeChange: 'longer' }));
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('timeframeLonger');
  });

  it('J5 含み損で買い増し・+0.2R は危ない勝ち（ナンピン）', () => {
    // (99.98 − 100.00) × 10,000 + (99.98 − 99.80) × 10,000 = 1,600、÷ 8,000 = +0.2R
    const ev = evaluated(
      closedAt(
        trade({
          entries: [
            { price: 100, quantity: 10_000, lc: 99.5 },
            { price: 99.8, quantity: 10_000, lc: 99.5 },
          ],
        }),
        99.98,
      ),
    );
    expect(ev.r).toBeCloseTo(0.2, 3);
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('averagingDown');
  });
});

describe('判定の補い J6〜J12', () => {
  it('J6 建値に詰めて刈られ R 0・明細の損益 −300 円は計画どおりの勝ち', () => {
    const ev = evaluated(
      closedAt(trade({ lcMove: { kind: 'tightened' }, statementPnlYen: -300 }), 100, {
        reason: 'lc',
      }),
    );
    expect(ev.r).toBeCloseTo(0, 3);
    expect(ev.pnlYen).toBe(-300);
    expect(ev.judgment?.outcome).toBe('win');
    expect(ev.judgment?.grade).toBe('safeWin');
  });

  it('J7 LC が無い入る前の記録は、−20,000 円で C、+10,000 円で危ない勝ち', () => {
    const base = without(
      trade({ plannedAt: 1_000, entries: [{ time: 2_000, price: 100, quantity: 10_000 }] }),
      'lc',
    );
    // (98.00 − 100.00) × 10,000 = −20,000
    const loss = evaluated(closedAt(base, 98));
    expect(loss.prePlan).toBe(true);
    expect(loss.pnlYen).toBeCloseTo(-20_000, 0);
    expect(loss.r).toBeUndefined();
    expect(loss.judgment?.grade).toBe('C');
    expect(kinds(loss)).toContain('noLc');
    // (101.00 − 100.00) × 10,000 = +10,000
    const win = evaluated(closedAt(base, 101));
    expect(win.pnlYen).toBeCloseTo(10_000, 0);
    expect(win.judgment?.grade).toBe('riskyWin');
    expect(kinds(win)).toContain('noLc');
  });

  it('J8 広げた後 99.20 で成行決済・−1.6R は B で、理由は「LC を広げた」だけ', () => {
    // (99.20 − 100.00) ÷ 0.50 = −1.6
    const ev = evaluated(
      closedAt(trade({ lcMove: { kind: 'widened', after: 99.2 } }), 99.2, { orderType: 'market' }),
    );
    expect(ev.r).toBeCloseTo(-1.6, 3);
    expect(ev.judgment?.grade).toBe('B');
    expect(ev.judgment?.reasons).toEqual([{ kind: 'lcWidened', from: 99.5, to: 99.2 }]);
  });

  it('J9 J8 と同じで 98.90（成行・窓・滑り = いいえ）・−2.2R は B で「LC を広げた」「持ち続けた」', () => {
    // (98.90 − 100.00) ÷ 0.50 = −2.2
    const ev = evaluated(
      closedAt(trade({ lcMove: { kind: 'widened', after: 99.2 }, gapSlipAnswer: false }), 98.9, {
        orderType: 'market',
      }),
    );
    expect(ev.r).toBeCloseTo(-2.2, 3);
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toEqual(['lcWidened', 'heldPastLc']);
    const held = ev.judgment?.reasons.find((r) => r.kind === 'heldPastLc');
    expect(held && 'r' in held ? held.r : undefined).toBeCloseTo(-2.2, 3);
  });

  it('J10 広げた後の値が無い・−1.6R は B で、理由は「LC を広げた」だけ', () => {
    const ev = evaluated(closedAtR(-1.6, { lcMove: { kind: 'widened' } }));
    expect(ev.judgment?.grade).toBe('B');
    expect(ev.judgment?.reasons).toEqual([{ kind: 'lcWidened', from: 99.5 }]);
  });

  it('J11 資金が未設定・LC どおり −1.0R は A で、過剰リスクを見ていないと添える', () => {
    // −1.0R = LC 99.50 で決済
    const ev = evaluated(closedAt(without(trade(), 'capitalYen'), 99.5));
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.grade).toBe('A');
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noCapital' });
  });

  it('J12 決済 100.01・明細 −400 円（手数料 500 円）は +0.02R・計画どおりの勝ち・1R 5,000 円・0.5%', () => {
    // R = (100.01 − 100.00) ÷ 0.50 = +0.02
    // 手数料を除いた損益 = −400 + 500 = +100 → 1R = 100 × 0.50 ÷ 0.01 = 5,000 → 5,000 ÷ 1,000,000 × 100 = 0.5%
    const ev = evaluated(closedAt(trade({ statementPnlYen: -400, feesTotalYen: 500 }), 100.01));
    expect(ev.r).toBeCloseTo(0.02, 3);
    expect(ev.oneRYen).toBeCloseTo(5_000, 0);
    expect(ev.riskPct).toBeCloseTo(0.5, 4);
    expect(ev.overRisk).toBe(false);
    expect(ev.judgment?.grade).toBe('safeWin');
  });
});

describe('判定の補い J13（取引の LC が無く、エントリーごとに LC がある）', () => {
  // 100.00（LC 99.50）と 100.20（LC 99.80）。1R の価格幅 = 0.50 × 10,000 + 0.40 × 10,000 = 9,000
  const perEntryLc = without(
    trade({
      entries: [
        { price: 100, quantity: 10_000, lc: 99.5 },
        { price: 100.2, quantity: 10_000, lc: 99.8 },
      ],
    }),
    'lc',
  );

  it('J13 すべてのエントリーに LC があれば LC あり: 101.00 で +2.0R は計画どおりの勝ち', () => {
    // (1.00 × 10,000 + 0.80 × 10,000) ÷ 9,000 = +2.0
    const ev = evaluated(closedAt(perEntryLc, 101, { reason: 'tp' }));
    expect(ev.r).toBeCloseTo(2.0, 3);
    expect(ev.judgment?.grade).toBe('safeWin');
    expect(kinds(ev)).not.toContain('noLc');
  });

  it('J13 同じ取引で LC の根拠が「金額から決めた」なら金額ありきの LC が並ぶ', () => {
    const ev = evaluated(closedAt({ ...perEntryLc, lcBasis: 'amount' }, 101, { reason: 'tp' }));
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('amountBasedLc');
  });

  it('J13 エントリーの LC が 1 つでも欠ければ LC 無し（C）', () => {
    const missing = without(
      trade({
        entries: [
          { price: 100, quantity: 10_000, lc: 99.5 },
          { price: 100.2, quantity: 10_000 },
        ],
        lcBasis: 'amount',
      }),
      'lc',
    );
    // (99.00 − 100.00) × 10,000 + (99.00 − 100.20) × 10,000 = −22,000 円
    const ev = evaluated(closedAt(missing, 99));
    expect(ev.r).toBeUndefined();
    expect(ev.judgment?.grade).toBe('C');
    expect(kinds(ev)).toContain('noLc');
    expect(kinds(ev)).not.toContain('amountBasedLc');
  });
});

// #165・C56: 取り消した（置いた逆指値を外した）。L はイン 100.00・LC 99.50、S はイン 100.00・LC 100.50（1R = 0.50）
describe('取り消した と 未設定（#165 の例 E1〜E8）', () => {
  const cancelled = { lcMove: { kind: 'cancelled' } } as const;

  it('E1 L・成行で 99.10（(99.10 − 100.00) ÷ 0.50 = −1.8R）は B（取り消した・持ち続けた）', () => {
    const ev = evaluated(closedAt(trade(cancelled), 99.1, { orderType: 'market' }));
    expect(ev.r).toBeCloseTo(-1.8, 9);
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toEqual(['lcCancelled', 'heldPastLc']);
  });

  it('E2 L・手で 99.50（−1.0R）は B（取り消した）で、持ち続けたは無い', () => {
    const ev = evaluated(closedAt(trade(cancelled), 99.5, { reason: 'brokeManual' }));
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toContain('lcCancelled');
    expect(kinds(ev)).not.toContain('heldPastLc');
  });

  it('E3 L・TP で 100.40（+0.8R）は危ない勝ち（取り消した）', () => {
    const ev = evaluated(closedAt(trade(cancelled), 100.4, { reason: 'tp' }));
    expect(ev.r).toBeCloseTo(0.8, 9);
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('lcCancelled');
  });

  it('E4 E1 で「窓・滑りでしたか」= はい は B（取り消した）で、持ち続けたは無い', () => {
    const ev = evaluated(
      closedAt(trade({ ...cancelled, gapSlipAnswer: true }), 99.1, { orderType: 'market' }),
    );
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toContain('lcCancelled');
    expect(kinds(ev)).not.toContain('heldPastLc');
  });

  it('E5 E1 で LC を入る前に決めていない は C（LC を決めずに・取り消した・持ち続けた）', () => {
    const ev = evaluated(
      closedAt(trade({ ...cancelled, lcDecidedBeforeEntry: false }), 99.1, { orderType: 'market' }),
    );
    expect(ev.judgment?.grade).toBe('C');
    expect(kinds(ev)).toEqual(expect.arrayContaining(['noLc', 'lcCancelled', 'heldPastLc']));
    // 表の順: LC 無しの次・LC を広げたの前（C56）
    expect(kinds(ev).indexOf('noLc')).toBeLessThan(kinds(ev).indexOf('lcCancelled'));
  });

  it('E6 S・成行で 100.90（−(100.90 − 100.00) ÷ 0.50 = −1.8R）は B（取り消した・持ち続けた）', () => {
    const s = trade({
      ...cancelled,
      side: 'S',
      lc: 100.5,
    });
    const ev = evaluated(closedAt(s, 100.9, { orderType: 'market' }));
    expect(ev.r).toBeCloseTo(-1.8, 9);
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toEqual(expect.arrayContaining(['lcCancelled', 'heldPastLc']));
  });

  it('E7・E8 逆指値の未設定は計算の入力に入らない（判定は逆指値の答えによらず A / B 持ち続けた）', () => {
    // 逆指値を入れたか（stopOrderPlaced）は TradeInput に無い = 未回答・置いた・未設定で同じ入力になる
    const e7 = evaluated(closedAt(trade(), 99.5, { orderType: 'market', reason: 'lc' }));
    expect(e7.judgment?.grade).toBe('A');
    expect(kinds(e7)).toContain('asPlannedLc');
    const e8 = evaluated(closedAt(trade({ gapSlipAnswer: false }), 99.1, { orderType: 'market' }));
    expect(e8.judgment?.grade).toBe('B');
    expect(kinds(e8)).toContain('heldPastLc');
  });
});

describe('gradeOf', () => {
  it('負けは最も重い理由、勝ちは C・B があれば危ない勝ち', () => {
    expect(gradeOf('loss', [])).toBe('A');
    expect(gradeOf('loss', [{ kind: 'earlyExit' }])).toBe('A');
    expect(gradeOf('loss', [{ kind: 'amountBasedLc' }])).toBe('B');
    expect(gradeOf('loss', [{ kind: 'amountBasedLc' }, { kind: 'noLc' }])).toBe('C');
    expect(gradeOf('win', [{ kind: 'earlyExit' }])).toBe('safeWin');
    expect(gradeOf('win', [{ kind: 'noLc' }])).toBe('riskyWin');
  });
});

describe('#203 決済の理由「TP の前に満足して」は判定の重さにも注記にも数えない', () => {
  it('例 2: LC を広げていて +0.4R（100.20）→ 危ない勝ち（LC を広げた）。早逃げは付かない', () => {
    const ev = evaluated(
      closedAtR(0.4, { lcMove: { kind: 'widened', after: 99.2 } }, { reason: 'satisfied' }),
    );
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('lcWidened');
    expect(kinds(ev)).not.toContain('earlyExit');
  });

  it('例 3: インの少し下で満足して手仕舞い −0.1R（99.95）→ A。早逃げは付かない', () => {
    const ev = evaluated(closedAtR(-0.1, {}, { reason: 'satisfied' }));
    expect(ev.judgment?.grade).toBe('A');
    expect(kinds(ev)).not.toContain('earlyExit');
  });

  it('理由だけを other から satisfied に替えても判定と理由の一覧は同じ（性質）', () => {
    for (const r of [-1.6, -1.0, -0.3, 0, 0.6, 2.0]) {
      const other = evaluated(closedAtR(r, {}, { reason: 'other' }));
      const sat = evaluated(closedAtR(r, {}, { reason: 'satisfied' }));
      expect(sat.judgment, String(r)).toEqual(other.judgment);
    }
  });
});

describe('0.1R までの滑りは持ち続けたにしない（#258・C71）', () => {
  // 既定: L・イン 100.00・LC 99.50（幅 0.50 → 許す滑り 0.05）・数量 10,000・1R 5,000 円
  it('L・成行で 99.46（−1.08R）は A で、注記「窓・滑り」', () => {
    const ev = evaluated(closedAt(trade(), 99.46, { orderType: 'market', reason: 'lc' }));
    expect(ev.r).toBeCloseTo(-1.08, 9);
    expect(ev.judgment?.grade).toBe('A');
    expect(kinds(ev)).toEqual(expect.arrayContaining(['asPlannedLc', 'gapSlip']));
    expect(kinds(ev)).not.toContain('heldPastLc');
  });

  it('ちょうど 10%（99.45・−1.1R）は許す側、わずかに超える 99.449（−1.102R）は B（持ち続けた）', () => {
    expect(evaluated(closedAt(trade(), 99.45)).judgment?.grade).toBe('A');
    const over = evaluated(closedAt(trade(), 99.449));
    expect(over.judgment?.grade).toBe('B');
    expect(kinds(over)).toContain('heldPastLc');
    expect(kinds(over)).not.toContain('gapSlip');
  });

  it('S・イン 100.00・LC 100.50: 100.54 と 100.55 は A、100.551 は B', () => {
    const s = (price: number) => evaluated(closedAt(trade({ side: 'S', lc: 100.5 }), price));
    expect(s(100.54).judgment?.grade).toBe('A');
    expect(s(100.55).judgment?.grade).toBe('A');
    expect(kinds(s(100.551))).toContain('heldPastLc');
  });

  it('為替あり（USD・150）・明細の損益あり: R も滑りも価格で測るので、99.46（−1.08R）は A・99.40（−1.2R）は B', () => {
    // 1R = 0.50 × 100 × 150 = 7,500 円。明細の損益 −8,400 円（手数料 300 円込み）。R は価格だけ（5.1）
    const usd = trade({
      instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false },
      entries: [{ price: 100, quantity: 100 }],
    });
    const inside = evaluated({
      ...closedAt(usd, 99.46, { orderType: 'market', fxRate: 150 }),
      statementPnlYen: -8_400,
      feesTotalYen: 300,
    });
    expect(inside.r).toBeCloseTo(-1.08, 9);
    expect(inside.judgment?.grade).toBe('A');
    expect(kinds(inside)).toContain('gapSlip');
    const outside = evaluated({
      ...closedAt(usd, 99.4, { orderType: 'market', fxRate: 150 }),
      statementPnlYen: -9_000,
    });
    expect(outside.judgment?.grade).toBe('B');
    expect(kinds(outside)).toContain('heldPastLc');
  });

  it('広げた（99.50 → 99.20）は広げた後の LC から入る前の幅の 10%: 99.15（−1.7R）は「LC を広げた」だけ、99.149 は持ち続けたも並ぶ', () => {
    const widened = trade({ lcMove: { kind: 'widened', after: 99.2 } });
    const inside = evaluated(closedAt(widened, 99.15));
    expect(inside.judgment?.grade).toBe('B');
    expect(kinds(inside)).toContain('lcWidened');
    expect(kinds(inside)).not.toContain('heldPastLc');
    expect(kinds(evaluated(closedAt(widened, 99.149)))).toContain('heldPastLc');
  });

  it('取り消した は入る前の LC から: 99.46 は「取り消した」だけ、99.44 は持ち続けたも並ぶ', () => {
    const cancelled = trade({ lcMove: { kind: 'cancelled' } });
    expect(kinds(evaluated(closedAt(cancelled, 99.46)))).not.toContain('heldPastLc');
    expect(kinds(evaluated(closedAt(cancelled, 99.44)))).toContain('heldPastLc');
  });

  it('買い増しは最後のエントリーのイン〜その LC の幅で測る（平均のインではない）', () => {
    // 100.00（LC 99.50）と 99.80（LC 99.30）。比較先 99.30、幅 |99.80 − 99.30| = 0.50 → 許す滑り 0.05
    // （平均のイン 99.90 なら幅 0.60・許す滑り 0.06 で 99.245 も許してしまう）
    const t = trade({
      entries: [
        { price: 100, quantity: 10_000, lc: 99.5 },
        { price: 99.8, quantity: 10_000, lc: 99.3 },
      ],
    });
    expect(slipAllowance(t)).toBeCloseTo(0.05, 12);
    const inside = evaluated(closedAt(t, 99.26)); // (−0.74 − 0.54) ÷ 1.00 = −1.28R
    expect(inside.r).toBeCloseTo(-1.28, 9);
    expect(kinds(inside)).toContain('averagingDown');
    expect(kinds(inside)).not.toContain('heldPastLc');
    expect(kinds(evaluated(closedAt(t, 99.245)))).toContain('heldPastLc');
  });

  it('逆指値の約定は今までどおり「逆指値で切れた」で、注記「窓・滑り」は付けない', () => {
    const ev = evaluated(closedAt(trade(), 99.46, { orderType: 'stop', reason: 'lc' }));
    expect(kinds(ev)).toContain('stopFilled');
    expect(kinds(ev)).not.toContain('gapSlip');
  });

  // 性質: 越えた割合 f（幅に対する）だけで決まり、L / S で対称・数量に依らない
  const genSlip = (r: { int: (a: number, b: number) => number }) => ({
    entry: r.int(1_000, 50_000) / 10,
    width: r.int(1, 2_000) / 10,
    f: r.int(1, 3_000) / 10_000, // 0.0001〜0.3
    quantity: r.int(1, 100) * 100,
  });
  const heldOf = (side: 'L' | 'S', g: ReturnType<typeof genSlip>, quantity = g.quantity) => {
    const s = side === 'L' ? 1 : -1;
    const lc = g.entry - s * g.width;
    const exit = lc - s * g.f * g.width;
    const ev = evaluated(
      closedAt(trade({ side, lc, entries: [{ price: g.entry, quantity }] }), exit, {
        orderType: 'market',
      }),
    );
    return kinds(ev).includes('heldPastLc');
  };

  it('性質: 10% 以内なら持ち続けたが付かず、超えれば付く（境目の近くは除く）', () => {
    forAll(25801, 300, genSlip, (g) => {
      if (Math.abs(g.f - 0.1) < 1e-6) return;
      expect(heldOf('L', g)).toBe(g.f > 0.1);
    });
  });

  it('性質: 許す幅は L / S で対称', () => {
    forAll(25802, 300, genSlip, (g) => {
      expect(heldOf('S', g)).toBe(heldOf('L', g));
    });
  });

  it('性質: 数量に依らない', () => {
    forAll(25803, 300, genSlip, (g) => {
      expect(heldOf('L', g, 1)).toBe(heldOf('L', g, g.quantity * 7));
    });
  });
});
