// 判定の補いの例 J1〜J12（Issue #2。設計書 5.3・5.4・C29〜C33。値はすべて架空）
import { describe, expect, it } from 'vitest';
import { type Evaluation, evaluateTrade } from '../../core/evaluate';
import { gradeOf, type ReasonKind } from '../../core/judge';
import type { TradeInput } from '../../core/trade';
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

  it('J8 下げた後 99.20 で成行決済・−1.6R は B で、理由は「LC を下げた」だけ', () => {
    // (99.20 − 100.00) ÷ 0.50 = −1.6
    const ev = evaluated(
      closedAt(trade({ lcMove: { kind: 'widened', after: 99.2 } }), 99.2, { orderType: 'market' }),
    );
    expect(ev.r).toBeCloseTo(-1.6, 3);
    expect(ev.judgment?.grade).toBe('B');
    expect(ev.judgment?.reasons).toEqual([{ kind: 'lcWidened', from: 99.5, to: 99.2 }]);
  });

  it('J9 J8 と同じで 98.90（成行・窓・滑り = いいえ）・−2.2R は B で「LC を下げた」「持ち続けた」', () => {
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

  it('J10 下げた後の値が無い・−1.6R は B で、理由は「LC を下げた」だけ', () => {
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
