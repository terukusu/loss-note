// Issue #13 の例の表（E1〜E18）の下書き。値はすべて架空（実際の記録を写さない）。
// 共通: 銘柄 US30（価格の通貨 未設定・乗数 1・刻み 1）、数量 10,000、手数料なし。
// タップは「決めていたか / 動かしたか / 時間足」の順

import type { InstrumentRecord } from '../../../core/record';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  EMPTY_DRAFT,
} from '../../../ui/src/lib/record-form';
import { defaultAccount } from './accounts';

export const US30: InstrumentRecord = {
  id: 'inst-us30',
  name: 'US30',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: null,
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

export const NO_CAPITAL: DraftContext = {
  instruments: [US30],
  accounts: [defaultAccount(null)],
};

export const CAPITAL_1M: DraftContext = {
  instruments: [US30],
  accounts: [defaultAccount(1_000_000)],
};

export function draft(values: Partial<Draft>): Draft {
  return applyDraft(EMPTY_DRAFT, {
    type: 'fill',
    values: {
      instrumentName: 'US30',
      quantity: '10000',
      exitTime: '2026-03-04T10:00',
      ...values,
    },
  });
}

/** すべて計画どおりのタップ（決めていた / そのまま / そのまま） */
export const PLANNED: Partial<Draft> = {
  lcDecided: true,
  lcMove: 'none',
  timeframeChange: 'none',
};

const L100: Partial<Draft> = { side: 'L', entryPrice: '100.00', lc: '99.50' };

export const E1 = draft({
  ...L100,
  exitPrice: '99.20',
  lcDecided: true,
  lcMove: 'widened',
  lcAfter: '99.20',
  timeframeChange: 'none',
});
export const E2 = draft({ ...L100, exitPrice: '99.50', pnlYen: '-5,000', ...PLANNED });
export const E3 = draft({
  ...L100,
  exitPrice: '100.75',
  lcDecided: false,
  lcMove: 'none',
  timeframeChange: 'none',
});
export const E4 = draft({ ...L100, exitPrice: '100.50', pnlYen: '+25,000', ...PLANNED });
export const E5 = draft({
  side: 'S',
  entryPrice: '150.00',
  lc: '150.50',
  exitPrice: '151.00',
  lcDecided: true,
  lcMove: 'widened',
  lcAfter: '151.00',
  timeframeChange: 'none',
});
export const E6 = draft({ ...L100, exitPrice: '99.40', ...PLANNED });
export const E7 = draft({ ...L100, exitPrice: '100.00', ...PLANNED });
export const E10 = applyDraft(E1, { type: 'set', field: 'timeframeChange', value: null });
export const E11 = draft({ ...L100, exitPrice: '99.50', ...PLANNED });
/** E12: 決済 = LC、損益（円）から 1R を逆算 → リスク 2.01% / 2.00% / 1.96% */
export const E12 = (pnl: string) => draft({ ...L100, exitPrice: '99.50', pnlYen: pnl, ...PLANNED });
export const E16 = draft({
  side: 'L',
  entryPrice: '100.00',
  lcNone: true,
  exitPrice: '99.20',
  timeframeChange: 'none',
});
export const E17 = draft({
  side: 'L',
  entryPrice: '100.00',
  lcNone: true,
  exitPrice: '100.75',
  timeframeChange: 'none',
});
export const E18 = applyDraft(E1, { type: 'set', field: 'lc', value: '' });
/** E8: L で LC = イン（誤り） */
export const E8 = draft({ ...L100, lc: '100.00', exitPrice: '99.20', ...PLANNED });
/** E9: 広げた後の LC が入る前の LC より上（誤り） */
export const E9 = draft({
  ...L100,
  exitPrice: '99.20',
  lcDecided: true,
  lcMove: 'widened',
  lcAfter: '99.60',
  timeframeChange: 'none',
});
