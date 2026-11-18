// Issue #9 の例の表（L1〜L3・D1・D2・E1・E2・H1）の保存した取引。値はすべて架空（実際の記録を写さない）。
// 共通: 銘柄 US30（価格の通貨 未設定・乗数 1・刻み 1）、円建て、手数料 0、3 つのタップは計画どおり（決めていた / そのまま / そのまま）。
// 損益（円）は明細の値 = (決済 − イン) × 数量（S は符号が逆）。R = (決済 − イン) / (イン − LC)（S は符号が逆）、
// 1R = |明細の損益| / |R|、リスク（%）= 1R / 写した資金 × 100（設計書 5.1）
import type {
  InstrumentRecord,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../../core/record';
import { US30 } from './record-drafts';

export { US30 };

/** 2026-11-10 09:00（日本時間）の前後の架空の時刻（ミリ秒） */
const DAY = 86_400_000;
export const T_1110 = Date.UTC(2026, 10, 10, 0, 0); // 2026-11-10 09:00 JST
export const T_1111 = T_1110 + DAY;
export const T_1112 = T_1110 + 2 * DAY;

export const SNAP_1M: TradeSnapshot = {
  instrument: {
    multiplier: 1,
    quantityStep: 1,
    priceCurrency: null,
    underlyingKind: 'index',
    productForm: 'spotCfd',
  },
  capitalYen: 1_000_000,
  riskTolerancePct: 1,
};
export const SNAP_NO_CAPITAL: TradeSnapshot = { ...SNAP_1M, capitalYen: null };

const PLANNED_RECORD: TradeRecord = {
  status: 'closed',
  source: 'manual',
  instrumentId: US30.id,
  side: 'L',
  lc: 99.5,
  lcBasis: 'chart',
  stopOrderPlaced: 'unanswered',
  lcDecidedBeforeEntry: true,
  lcMove: { kind: 'none' },
  timeframeChange: 'none',
  entries: [{ price: 100, quantity: 10_000 }],
  exit: { time: T_1110, price: 99.5, orderType: 'unknown', reason: 'other', gapSlip: 'unanswered' },
  fees: [],
};

export function stored(
  id: string,
  record: { readonly [K in keyof TradeRecord]?: TradeRecord[K] | undefined },
  over: Partial<Omit<StoredTrade, 'record'>> = {},
): StoredTrade {
  return {
    id,
    schemaVersion: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    snapshot: SNAP_1M,
    ...over,
    // undefined の欄は鍵ごと除く（API の応答に無い欄と同じ形）
    record: Object.fromEntries(
      Object.entries({ ...PLANNED_RECORD, ...record }).filter(([, v]) => v !== undefined),
    ) as unknown as TradeRecord,
  };
}

/** L1: L、イン 100.00、LC 99.50、決済 99.50、損益 (99.5 − 100) × 10,000 = −5,000 円、資金 1,000,000 円 → A、−1.0R、5,000 / 1,000,000 = 0.5% */
export const L1 = stored('l1', { statementPnlYen: -5_000 }, { createdAt: 1_700_000_000_001 });

/** L2: S、イン 150.00、LC 150.50、決済 149.00、損益 (150 − 149) × 10,000 = +10,000 円、資金なし → 計画どおりの勝ち、R = 1 / 0.5 = +2.0R、リスクは出ない */
export const L2 = stored(
  'l2',
  {
    side: 'S',
    lc: 150.5,
    entries: [{ price: 150, quantity: 10_000 }],
    exit: { ...PLANNED_RECORD.exit, time: T_1112, price: 149, reason: 'tp' },
    statementPnlYen: 10_000,
  },
  { snapshot: SNAP_NO_CAPITAL, createdAt: 1_700_000_000_002 },
);

/** L3: L、イン 100.00、LC なし、決済 101.00、損益 (101 − 100) × 3,000 = +3,000 円 → 危ない勝ち（LC を決めずに入った）、R なし */
export const L3 = stored(
  'l3',
  {
    lc: undefined,
    lcDecidedBeforeEntry: false,
    entries: [{ price: 100, quantity: 3_000 }],
    exit: { ...PLANNED_RECORD.exit, time: T_1111, price: 101 },
    statementPnlYen: 3_000,
  },
  { createdAt: 1_700_000_000_003 },
);

/** D1: L、イン 100.00、LC 99.50 を下げた（99.20）、決済 99.20、損益 (99.2 − 100) × 10,000 = −8,000 円、資金 1,000,000 円、
 * チャート エントリー時 4 時間足・決済時 日足 → B、R = −0.8 / 0.5 = −1.6R、1R = 8,000 / 1.6 = 5,000 → 0.5% */
export const D1 = stored(
  'd1',
  {
    lcMove: { kind: 'widened', after: 99.2 },
    exit: { ...PLANNED_RECORD.exit, price: 99.2 },
    statementPnlYen: -8_000,
    entryChartTimeframe: '4h',
    exitChartTimeframe: '1d',
  },
  {
    createdAt: 1_700_000_000_004,
    charts: {
      entry: { contentType: 'image/png', size: 120 },
      exit: { contentType: 'image/png', size: 130 },
    },
  },
);

/** D2: D1 と同じで決済時のチャートが無い（エントリー時だけ。時間足もエントリー時だけ） */
export const D2 = stored(
  'd2',
  {
    lcMove: { kind: 'widened', after: 99.2 },
    exit: { ...PLANNED_RECORD.exit, price: 99.2 },
    statementPnlYen: -8_000,
    entryChartTimeframe: '4h',
  },
  { createdAt: 1_700_000_000_005, charts: { entry: { contentType: 'image/png', size: 120 } } },
);

/** E1: L、イン 100.00、LC 99.50 を下げた（99.20）、決済 99.50、損益 −5,000 円、写した資金 1,000,000 円（今の設定は 2,000,000 円）。
 * 直す前 B（LC を下げた）→「そのまま」で A、−1.0R、0.5%（今の資金なら 5,000 / 2,000,000 = 0.25% → 0.3%） */
export const E1 = stored(
  'e1',
  { lcMove: { kind: 'widened', after: 99.2 }, statementPnlYen: -5_000 },
  { createdAt: 1_700_000_000_006 },
);
export const CAPITAL_NOW = 2_000_000;

/** E2: L1 と同じ値で、時間足 エントリー時 4 時間足・決済時 日足が記録にあり、チャートは無い（#12 より前の形） */
export const E2 = stored(
  'e2',
  { statementPnlYen: -5_000, entryChartTimeframe: '4h', exitChartTimeframe: '1d' },
  { createdAt: 1_700_000_000_007 },
);

/** H1: 決済の時刻の違う 7 件（1 日ずつ。新しい方から 2 件目が危ない勝ち = L3 の形） */
export const H1: readonly StoredTrade[] = Array.from({ length: 7 }, (_, i) => {
  const time = T_1110 - i * DAY;
  if (i === 1) {
    return stored(`h${i}`, { ...L3.record, exit: { ...L3.record.exit, time } });
  }
  return stored(`h${i}`, { ...L1.record, exit: { ...L1.record.exit, time } });
});

export const INSTRUMENTS: readonly InstrumentRecord[] = [US30];

/** 架空の PNG の見出し（署名 + IHDR。寸法だけ読める。画素は無い） */
export function pngHead(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  for (let i = 0; i < extra; i++) b[33 + i] = (i * 7) & 0xff;
  return b;
}
