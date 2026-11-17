// 設計書 5.6 の例の表の場面（テスト側の入力と期待）。場面の文章は写さず、設計書の `#` で対応づける。
// 値はすべて架空。既定（helpers/trade-builder）: L、イン 100.00、LC 99.50（1R = 0.50 × 10,000 = 5,000 円）、
// 資金 1,000,000 円、決済の注文の種類 unknown・理由 other
import type { Grade, ReasonKind } from '../../core/judge';
import type { TradeInput } from '../../core/trade';
import { closedAt, closedAtR, trade, without } from './helpers/trade-builder';

export interface Scene {
  readonly label?: string;
  readonly input: TradeInput;
  readonly grade: Grade;
  /** 理由の一覧に含まれること（ほかに並んでもよい。C31） */
  readonly reasons: readonly ReasonKind[];
  /** 理由の一覧に含まれないこと */
  readonly absent?: readonly ReasonKind[];
}

// 買い増しの 2 エントリー（含み損でのナンピン）: 100.00 と 99.80、ともに LC 99.50 → 1R 8,000 円
const averagingDown = trade({
  entries: [
    { price: 100, quantity: 10_000, lc: 99.5 },
    { price: 99.8, quantity: 10_000, lc: 99.5 },
  ],
});

export const DESIGN_TABLE_CASES: Readonly<Record<string, readonly Scene[]>> = {
  '1': [{ input: closedAtR(-1.0, {}, { reason: 'lc' }), grade: 'A', reasons: ['asPlannedLc'] }],
  '2': [
    {
      // 99.20 で −1.6R、理由: 窓・滑り
      input: closedAtR(-1.6, {}, { reason: 'gapSlip' }),
      grade: 'A',
      reasons: ['gapSlip'],
      absent: ['heldPastLc'],
    },
  ],
  '3': [
    {
      // LC 無し: (98.75 − 100.00) × 10,000 = −12,500 円
      input: closedAt(without(trade(), 'lc'), 98.75),
      grade: 'C',
      reasons: ['noLc'],
    },
  ],
  '4': [
    {
      // LC 無し: (100.75 − 100.00) × 10,000 = +7,500 円
      input: closedAt(without(trade(), 'lc'), 100.75),
      grade: 'riskyWin',
      reasons: ['noLc'],
    },
  ],
  '5': [
    {
      // (99.20 − 100.00) ÷ 0.50 = −1.6R。下げた後の LC で切れたので持ち続けたは出ない
      input: closedAt(trade({ lcMove: { kind: 'widened', after: 99.2 } }), 99.2),
      grade: 'B',
      reasons: ['lcWidened'],
      absent: ['heldPastLc'],
    },
  ],
  '6': [
    {
      label: '時間足を日足へ、−3.0R',
      input: closedAtR(-3.0, { timeframe: '4h', timeframeChange: 'longer' }),
      grade: 'B',
      reasons: ['timeframeLonger', 'heldPastLc'],
    },
    {
      label: 'LC も 99.20 へ下げていた、−3.0R',
      input: closedAtR(-3.0, {
        timeframe: '4h',
        timeframeChange: 'longer',
        lcMove: { kind: 'widened', after: 99.2 },
      }),
      grade: 'B',
      reasons: ['lcWidened', 'timeframeLonger', 'heldPastLc'],
    },
  ],
  '7': [{ input: closedAtR(-1.8), grade: 'B', reasons: ['heldPastLc'] }],
  '8': [
    {
      // 0.50 × 56,000 = 28,000 円 → 2.8%
      input: closedAtR(-1.0, { entries: [{ price: 100, quantity: 56_000 }] }, { reason: 'lc' }),
      grade: 'B',
      reasons: ['overRisk'],
    },
  ],
  '9': [{ input: closedAtR(-1.0, { lcBasis: 'amount' }), grade: 'B', reasons: ['amountBasedLc'] }],
  '10': [
    {
      // (−0.66 − 0.46) × 10,000 ÷ 8,000 = −1.4R（LC 99.50 を割っているので持ち続けたも並ぶ）
      input: closedAt(averagingDown, 99.34),
      grade: 'B',
      reasons: ['averagingDown'],
    },
  ],
  '11': [
    {
      // 100.00（LC 99.50）と含み益で 100.50（LC 100.25）。100.25 で刈られて (0.25 − 0.25) × 10,000 = 0 → 0R
      input: closedAt(
        trade({
          entries: [
            { price: 100, quantity: 10_000, lc: 99.5 },
            { price: 100.5, quantity: 10_000, lc: 100.25 },
          ],
          lcMove: { kind: 'tightened' },
        }),
        100.25,
        { reason: 'lc' },
      ),
      grade: 'safeWin',
      reasons: [],
    },
  ],
  '12': [{ input: closedAtR(2.0, {}, { reason: 'tp' }), grade: 'safeWin', reasons: [] }],
  '13': [
    {
      input: closedAtR(0.5, { lcMove: { kind: 'widened', after: 99.2 } }),
      grade: 'riskyWin',
      reasons: ['lcWidened'],
    },
  ],
  '14': [
    { input: closedAtR(-0.3, {}, { reason: 'fearEarly' }), grade: 'A', reasons: ['earlyExit'] },
  ],
  '15': [{ input: closedAtR(-0.8, {}, { reason: 'brokeManual' }), grade: 'A', reasons: [] }],
  '16': [
    {
      // 0.50 × 30,000 = 15,000 円 → 1.5%
      input: closedAtR(-1.0, { entries: [{ price: 100, quantity: 30_000 }] }, { reason: 'lc' }),
      grade: 'A',
      reasons: [],
      absent: ['overRisk'],
    },
  ],
  '17': [
    {
      input: closedAtR(-1.0, {}, { orderType: 'market', reason: 'lc' }),
      grade: 'A',
      reasons: ['asPlannedLc'],
    },
  ],
  '18': [
    {
      input: closedAtR(-1.1, {}, { orderType: 'stop', reason: 'lc' }),
      grade: 'A',
      reasons: ['stopFilled'],
      absent: ['heldPastLc'],
    },
  ],
  '18b': [
    {
      input: closedAtR(-1.1, { gapSlipAnswer: true }, { reason: 'lc' }),
      grade: 'A',
      reasons: ['asPlannedLc'],
      absent: ['heldPastLc', 'stopFilled'],
    },
  ],
  '18c': [
    {
      input: closedAtR(-1.1, { gapSlipAnswer: false }, { reason: 'lc' }),
      grade: 'B',
      reasons: ['heldPastLc'],
    },
  ],
  '19': [
    { input: closedAtR(-1.0, { lcDecidedBeforeEntry: false }), grade: 'C', reasons: ['noLc'] },
  ],
  '20': [
    {
      input: closedAtR(-1.4, { entryChartTimeframe: '4h', exitChartTimeframe: '1d' }),
      grade: 'B',
      reasons: ['timeframeLonger', 'heldPastLc'],
    },
  ],
  '21': [
    {
      input: closedAtR(-1.6, { lcMove: { kind: 'widened' } }),
      grade: 'B',
      reasons: ['lcWidened'],
      absent: ['heldPastLc'],
    },
  ],
  '22': [
    {
      input: closedAtR(-1.3, { timeframeChange: 'longer' }),
      grade: 'B',
      reasons: ['timeframeLonger', 'heldPastLc'],
    },
  ],
  '23': [
    {
      input: closedAtR(-0.6, { lcMove: { kind: 'tightened' }, timeframeChange: 'shorter' }),
      grade: 'A',
      reasons: [],
      absent: ['lcWidened', 'timeframeLonger'],
    },
  ],
  '24': [{ input: closedAtR(1.8, {}, { reason: 'tp' }), grade: 'safeWin', reasons: [] }],
  '25': [
    {
      input: closedAtR(0.9, { lcDecidedBeforeEntry: false }),
      grade: 'riskyWin',
      reasons: ['noLc'],
    },
  ],
  '26': [
    {
      // 0.50 × 40,000 = 20,000 円 → ちょうど 2.0%（過剰でない）
      input: closedAtR(-1.0, { entries: [{ price: 100, quantity: 40_000 }] }, { reason: 'lc' }),
      grade: 'A',
      reasons: [],
      absent: ['overRisk'],
    },
  ],
  '27': [
    {
      label: '成行で −1.05R・窓・滑り = はい',
      input: closedAtR(-1.05, { gapSlipAnswer: true }, { orderType: 'market', reason: 'lc' }),
      grade: 'A',
      reasons: [],
      absent: ['heldPastLc'],
    },
    {
      label: '注文の種類が不明で −1.05R・窓・滑り = いいえ',
      input: closedAtR(-1.05, { gapSlipAnswer: false }, { reason: 'lc' }),
      grade: 'B',
      reasons: ['heldPastLc'],
    },
  ],
  '28': [
    {
      input: closedAtR(-1.0, { lcDecidedBeforeEntry: false }, { orderType: 'stop', reason: 'lc' }),
      grade: 'C',
      reasons: ['noLc'],
    },
  ],
  '29': [
    {
      // 0.50 × 50,000 = 25,000 円 → 2.5%
      input: closedAtR(1.5, { entries: [{ price: 100, quantity: 50_000 }] }, { reason: 'tp' }),
      grade: 'riskyWin',
      reasons: ['overRisk'],
    },
  ],
  '30': [
    { input: closedAtR(1.0, { lcBasis: 'amount' }), grade: 'riskyWin', reasons: ['amountBasedLc'] },
  ],
  '31': [
    {
      input: closedAtR(0.4, { timeframeChange: 'longer' }),
      grade: 'riskyWin',
      reasons: ['timeframeLonger'],
    },
  ],
  '32': [
    {
      // (99.98 − 100.00) × 10,000 + (99.98 − 99.80) × 10,000 = 1,600 → ÷ 8,000 = +0.2R
      input: closedAt(averagingDown, 99.98),
      grade: 'riskyWin',
      reasons: ['averagingDown'],
    },
  ],
};
