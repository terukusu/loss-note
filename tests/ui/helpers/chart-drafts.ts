// Issue #12 の例の表（E1〜E6）の下書きとチャートの有無。値はすべて架空（実際の記録を写さない）。
// 共通: 架空指数A・L・イン 100.0・LC 99.0（1R = 1.0）・数量 1・タップ「決めていた / そのまま」
import type { Timeframe, TimeframeChange } from '../../../core/trade';
import { applyDraft, type Draft, EMPTY_DRAFT } from '../../../ui/src/lib/record-form';

export interface ChartCase {
  readonly name: string;
  readonly draft: Draft;
  readonly charts: { readonly entry: boolean; readonly exit: boolean };
  /** 期待する判定と、括弧の理由の文言 */
  readonly grade: string;
  readonly reasons: readonly string[];
}

function chartDraft(
  exitPrice: string,
  tf: { entry?: Timeframe; exit?: Timeframe },
  timeframeChange: TimeframeChange = 'none',
): Draft {
  return applyDraft(EMPTY_DRAFT, {
    type: 'fill',
    values: {
      instrumentName: '架空指数A',
      side: 'L',
      entryPrice: '100.0',
      exitPrice,
      quantity: '1',
      exitTime: '2026-11-10T10:30',
      lc: '99.0',
      brokenCondition: '押し目の安値を割ったら',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange,
      entryChartTimeframe: tf.entry ?? null,
      exitChartTimeframe: tf.exit ?? null,
    },
  });
}

const BOTH = { entry: true, exit: true } as const;
const MINUS = '−';

export const CHART_CASES: readonly ChartCase[] = [
  {
    // 4 時間足 → 日足・タップは変えていない・LC より不利に −1.4R（5.6 #20）
    name: 'E1',
    draft: chartDraft('98.6', { entry: '4h', exit: '1d' }),
    charts: BOTH,
    grade: 'B',
    reasons: [
      '時間足を変えた（4 時間足 → 日足・チャートから）',
      `LC で切らずに持ち続けた（${MINUS}1.4R）`,
    ],
  },
  {
    // 日足 → 4 時間足（短い足へは責めない）・LC どおり −1.0R
    name: 'E2',
    draft: chartDraft('99.0', { entry: '1d', exit: '4h' }),
    charts: BOTH,
    grade: 'A',
    reasons: ['決めた LC で切れた'],
  },
  {
    // エントリー時 4 時間足だけ（決済時のチャートなし）・LC どおり −1.0R
    name: 'E3',
    draft: chartDraft('99.0', { entry: '4h' }),
    charts: { entry: true, exit: false },
    grade: 'A',
    reasons: ['決めた LC で切れた'],
  },
  {
    // 4 時間足 / 4 時間足・タップ「長い足へ」・−1.3R（5.6 #22）
    name: 'E4',
    draft: chartDraft('98.7', { entry: '4h', exit: '4h' }, 'longer'),
    charts: BOTH,
    grade: 'B',
    reasons: ['時間足を変えた', `LC で切らずに持ち続けた（${MINUS}1.3R）`],
  },
  {
    // 1 時間足 → 4 時間足・+1.2R（5.6 #31 と同じ考え）
    name: 'E5',
    draft: chartDraft('101.2', { entry: '1h', exit: '4h' }),
    charts: BOTH,
    grade: 'riskyWin',
    reasons: ['時間足を変えた（1 時間足 → 4 時間足・チャートから）'],
  },
  {
    // 2 枚のチャート・時間足を選ばない・LC どおり −1.0R
    name: 'E6',
    draft: chartDraft('99.0', {}),
    charts: BOTH,
    grade: 'A',
    reasons: ['決めた LC で切れた'],
  },
];
