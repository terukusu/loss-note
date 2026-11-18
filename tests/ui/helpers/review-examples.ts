// Issue #88 の例の表（S1〜S7）の保存した取引。値はすべて架空（実際の記録を写さない）。
// 共通: 銘柄 US30（乗数 1・刻み 1）、円建て、資金 1,000,000 円、L、イン 100.00、LC 99.50（幅 0.5）、数量 10,000。
// R = (決済 − イン) ÷ 0.5、損益（円）= (決済 − イン) × 10,000。決済は 2026-11-13〜11-19 の 10:00（端末の時間帯）
import type { StoredTrade } from '../../../core/record';
import { stored } from './trade-examples';

/** 2026-11-(13 + i) 10:00（ローカル） */
export const exitAt = (i: number) => new Date(2026, 10, 13 + i, 10, 0).getTime();
/** 今日 = 2026-11-19 12:00（ローカル） */
export const REVIEW_NOW = new Date(2026, 10, 19, 12, 0).getTime();

function trade(
  i: number,
  id: string,
  exitPrice: number,
  over: Parameters<typeof stored>[1] = {},
  source: 'manual' | 'import' = 'manual',
): StoredTrade {
  return stored(
    id,
    {
      source,
      exit: {
        time: exitAt(i),
        price: exitPrice,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      statementPnlYen: Math.round((exitPrice - 100) * 10_000),
      ...over,
    },
    { createdAt: 1_763_000_000_000 + i },
  );
}

/**
 * S1 の 7 件（決済の古い順）:
 * 1 A −1.0R（決済 99.5）・2 計画どおりの勝ち +2.0R（101.0）・3 B LC を下げた −1.6R（99.2）・
 * 4 危ない勝ち +0.5R（100.25。時間足を長い足へ）・5 C LC なしで負け（R なし。99.0）・6 A −0.8R（99.6）・
 * 7 計画どおりの勝ち +1.2R（100.6）
 */
export const S1: readonly StoredTrade[] = [
  trade(0, 's1-1', 99.5),
  trade(1, 's1-2', 101),
  trade(2, 's1-3', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }),
  trade(3, 's1-4', 100.25, { timeframeChange: 'longer' }),
  trade(4, 's1-5', 99, { lc: undefined, lcDecidedBeforeEntry: false }),
  trade(5, 's1-6', 99.6),
  trade(6, 's1-7', 100.6),
];

/** S4 の取り込んだ取引 2 件（A −1.0R・B LC を下げた −1.3R） */
export const S4_IMPORTS: readonly StoredTrade[] = [
  trade(1, 'imp-1', 99.5, {}, 'import'),
  trade(2, 'imp-2', 99.35, { lcMove: { kind: 'widened', after: 99.3 } }, 'import'),
];

/** S2: A 1・B 2（判定の出た取引 3 件） */
export const S2: readonly StoredTrade[] = [
  trade(0, 's2-1', 99.5),
  trade(1, 's2-2', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }),
  trade(2, 's2-3', 99.75, { lcBasis: 'amount' }),
];

/** S5: B（金額ありきの LC）−0.5R */
export const S5 = trade(0, 's5', 99.75, { lcBasis: 'amount' });
/** S6: B（持ち続けた）−1.05R（決済 99.475 が LC 99.5 より不利・逆指値でない） */
export const S6 = trade(0, 's6', 99.475);
