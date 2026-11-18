// #47 PR-2（通貨と為替）の例の銘柄・口座・下書き。値・名前はすべて架空。
// 共通の場面 P: L、イン 100.00、LC 99.50、乗数 1、3 つのタップはすべて計画どおり、数量 100
import type { InstrumentRecord } from '../../../core/record';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  EMPTY_DRAFT,
} from '../../../ui/src/lib/record-form';
import { account } from './accounts';

function instrument(id: string, name: string, priceCurrency: string | null): InstrumentRecord {
  return {
    id,
    name,
    underlyingKind: 'index',
    productForm: 'spotCfd',
    priceCurrency,
    multiplier: 1,
    quantityStep: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/** USD 建て・EUR 建て・円建て・価格の通貨 未設定 */
export const INST_USD = instrument('inst-usd', '架空指数U', 'USD');
export const INST_EUR = instrument('inst-eur', '架空指数E', 'EUR');
export const INST_JPY = instrument('inst-jpy', '架空指数J', 'JPY');
export const INST_NONE = instrument('inst-none', '架空指数N', null);
export const INSTRUMENTS = [INST_USD, INST_EUR, INST_JPY, INST_NONE];

/** 口座 A（既定の口座・JPY・1,000,000・1%）と口座 D（USD・10,000・1%） */
export const ACC_A = account('default', '口座 A', 1_000_000);
export const ACC_D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });

/** 口座 A だけ / 口座 D だけ（既定の口座が USD）/ 2 つ */
export const CTX_A: DraftContext = { instruments: INSTRUMENTS, accounts: [ACC_A] };
export const CTX_D: DraftContext = {
  instruments: INSTRUMENTS,
  accounts: [{ ...ACC_D, id: 'default' }],
};
export const CTX_AD: DraftContext = { instruments: INSTRUMENTS, accounts: [ACC_A, ACC_D] };

/** 場面 P の下書き（USD 建て・決済 99.50・数量 100・計画どおりのタップ） */
export function pDraft(values: Partial<Draft>): Draft {
  return applyDraft(EMPTY_DRAFT, {
    type: 'fill',
    values: {
      instrumentName: INST_USD.name,
      side: 'L',
      entryPrice: '100.00',
      lc: '99.50',
      exitPrice: '99.50',
      quantity: '100',
      exitTime: '2026-03-04T10:00',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange: 'none',
      ...values,
    },
  });
}
