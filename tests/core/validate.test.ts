// 計算の例 E19（LC の向きの検査。C11）と、受け付けない入力（Issue の仮定 11）
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { validateTrade } from '../../core/validate';
import { closedAt, trade } from './helpers/trade-builder';

describe('E19 LC の向き', () => {
  const cases = [
    { name: 'L、イン 100.00、LC 100.00（LC = イン）', t: closedAt(trade({ lc: 100 }), 99) },
    { name: 'L、イン 100.00、LC 100.10（上にある）', t: closedAt(trade({ lc: 100.1 }), 99) },
    {
      name: 'S、イン 150.00、LC 149.90（下にある）',
      t: closedAt(
        trade({ side: 'S', entries: [{ price: 150, quantity: 10_000 }], lc: 149.9 }),
        151,
      ),
    },
  ];

  it.each(cases)('E19 $name は受け付けず、R と判定を出さない', ({ t }) => {
    const ev = evaluateTrade(t);
    expect(ev.ok).toBe(false);
    if (ev.ok) return;
    expect(ev.issues).toContainEqual({ kind: 'lcDirection', entryIndex: 0 });
    expect(ev).not.toHaveProperty('r');
    expect(ev).not.toHaveProperty('judgment');
  });
});

describe('受け付けない入力', () => {
  it('正しい向きなら問題なし', () => {
    expect(validateTrade(closedAt(trade(), 99))).toEqual([]);
  });

  it('買い増しのエントリーのそのときの LC も向きを見る', () => {
    const t = trade({
      entries: [
        { price: 100, quantity: 1 },
        { price: 101, quantity: 1, lc: 101.5 },
      ],
    });
    expect(validateTrade(t)).toContainEqual({ kind: 'lcDirection', entryIndex: 1 });
  });

  it('下げた後の LC が入る前の LC より不利でなければ受け付けない', () => {
    expect(validateTrade(trade({ lcMove: { kind: 'widened', after: 99.6 } }))).toContainEqual({
      kind: 'lcMoveDirection',
    });
    expect(validateTrade(trade({ lcMove: { kind: 'widened', after: 99.2 } }))).toEqual([]);
  });

  it('数量 0 以下・有限でない数は受け付けない', () => {
    expect(validateTrade(trade({ entries: [{ price: 100, quantity: 0 }] }))).toContainEqual({
      kind: 'invalidNumber',
      field: 'entries[0].quantity',
    });
    expect(validateTrade(closedAt(trade(), Number.NaN))).toContainEqual({
      kind: 'invalidNumber',
      field: 'exit.price',
    });
    expect(validateTrade(trade({ capitalYen: Number.POSITIVE_INFINITY }))).toContainEqual({
      kind: 'invalidNumber',
      field: 'capitalYen',
    });
    expect(
      validateTrade(
        trade({ instrument: { multiplier: -1, quantityStep: 1, priceInAccountCurrency: true } }),
      ),
    ).toContainEqual({ kind: 'invalidNumber', field: 'instrument.multiplier' });
  });
});
