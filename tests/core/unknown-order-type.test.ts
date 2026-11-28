// この版が知らない決済の注文の種類（Issue #115。設計書 C54 の「満期（SQ）」`expiry`。ADR-0020 の決定 7）。
// 足の形を出した後に画面を切り戻すと、この版の画面が `expiry` を持つ取引を読みうる。注文の種類は画面に文字で
// 出さず、判定は「逆指値（stop）か」だけを見るので、知らない種類は「不明（unknown）」と同じに読まれる
// （逆指値と読んで救わない。C54 の「不明と同じく救わない」と同じ）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { toTradeInput } from '../../core/record';
import type { ExitOrderType, TradeInput } from '../../core/trade';
import { fromTradeInput, stored } from './helpers/record';
import { closedAtR } from './helpers/trade-builder';

// この版の型に無い値（次の版の保存の値）
const EXPIRY = 'expiry' as unknown as ExitOrderType;

const cases: Array<[string, TradeInput, TradeInput]> = [
  -1.0, -1.05, -1.1, -1.5, -0.4, 0.8, 2.0,
].flatMap((r) =>
  (['lc', 'other', 'gapSlip'] as const).map((reason): [string, TradeInput, TradeInput] => [
    `R ${r}・理由 ${reason}`,
    closedAtR(r, {}, { orderType: 'unknown', reason }),
    closedAtR(r, {}, { orderType: EXPIRY, reason }),
  ]),
);

describe('知らない注文の種類 expiry は「不明」と同じ', () => {
  it.each(cases)('%s: 判定・理由・数が unknown と同じ', (_name, unknown, expiry) => {
    expect(evaluateTrade(expiry)).toEqual(evaluateTrade(unknown));
  });

  it('逆指値とは読まない（−1.2R・理由 LC: 逆指値なら救う A、expiry は不明と同じ B）', () => {
    // 1R を超えた負け（−1.2R）で、逆指値の約定なら「LC を越えて持ち続けた」にしない（5.3）
    const stop = evaluateTrade(closedAtR(-1.2, {}, { orderType: 'stop', reason: 'lc' }));
    const expiry = evaluateTrade(closedAtR(-1.2, {}, { orderType: EXPIRY, reason: 'lc' }));
    const unknown = evaluateTrade(closedAtR(-1.2, {}, { orderType: 'unknown', reason: 'lc' }));
    if (!stop.ok || !expiry.ok || !unknown.ok) throw new Error('受け付けられなかった');
    expect(expiry.judgment?.grade).toBe(unknown.judgment?.grade);
    expect(expiry.judgment?.grade).not.toBe(stop.judgment?.grade);
  });

  it('保存の形から計算の入力へ写しても壊れない（値はそのまま運ばれ、判定は unknown と同じ）', () => {
    const scene = fromTradeInput(closedAtR(-1.2, {}, { orderType: 'unknown', reason: 'lc' }));
    const withOrder = (o: ExitOrderType) =>
      toTradeInput(
        stored({
          ...scene,
          record: { ...scene.record, exit: { ...scene.record.exit, orderType: o } },
        }),
      );
    expect(withOrder(EXPIRY).exit?.orderType).toBe('expiry');
    expect(evaluateTrade(withOrder(EXPIRY))).toEqual(evaluateTrade(withOrder('unknown')));
  });
});
