// 保存の形（記録の API が返す取引・銘柄・設定。設計書 4 章・Issue #4・ADR-0004）と、計算の入力への写し。
// 取引は記録したときの銘柄の値（乗数・数量の刻み・価格の通貨・原資産の種類・商品の形）と資金・許容リスクを
// snapshot に写して持つ。後で銘柄・設定を直しても過去の取引は変わらない（C36）。判定・R・損益は保存しない（4.2 導出）。
// 価格は銘柄の価格の通貨、金額は円、時点はエポックからのミリ秒（core/trade.ts と同じ）。表示の丸めはしない
import type {
  Entry,
  ExitOrderType,
  ExitReason,
  LcMove,
  Side,
  Timeframe,
  TimeframeChange,
  TradeInput,
} from './trade';

/** 取引の状態（この Issue は closed だけを受ける。ほかは縦切り 3 の余地） */
export type TradeStatus = 'planned' | 'open' | 'closed' | 'skipped';
/** 記録の出どころ（この Issue は manual だけを作る） */
export type RecordSource = 'manual' | 'statement' | 'import';
export type StopOrderPlaced = 'placed' | 'notPlaced' | 'unanswered';
/** 「窓・滑りでしたか」の答え */
export type GapSlip = 'yes' | 'no' | 'unanswered';
export type UnderlyingKind = 'index' | 'fx' | 'commodity' | 'crypto' | 'stock' | 'other';
export type ProductForm = 'spotCfd' | 'future' | 'option';
export type PerformanceUnit = 'R' | 'yen';

/** 明細の手数料の欄（円。費用を正の数。7.5） */
export interface Fee {
  readonly label?: string;
  readonly amountYen: number;
}

export interface RecordExit {
  readonly time: number;
  readonly price: number;
  readonly fxRate?: number;
  readonly orderType: ExitOrderType;
  readonly reason: ExitReason;
  readonly gapSlip: GapSlip;
  readonly emotion?: string;
  readonly review?: string;
}

/** 取引の記録（API に送る本文。応答では既定が埋まっている） */
export interface TradeRecord {
  readonly status: TradeStatus;
  readonly source: RecordSource;
  readonly instrumentId: string;
  readonly side: Side;
  readonly contractMonth?: string;
  readonly optionType?: 'P' | 'C';
  readonly strike?: number;
  readonly timeframe?: Timeframe;
  readonly lc?: number;
  /** 崩れの条件（一文） */
  readonly brokenCondition?: string;
  readonly lcBasis: 'chart' | 'amount';
  readonly tp?: number;
  readonly thesis?: string;
  readonly entryEmotion?: string;
  readonly stopOrderPlaced: StopOrderPlaced;
  readonly planFxRate?: number;
  readonly plannedAt?: number;
  readonly lcDecidedBeforeEntry: boolean;
  readonly lcMove: LcMove;
  readonly timeframeChange: TimeframeChange;
  readonly entries: readonly [Entry, ...Entry[]];
  readonly exit: RecordExit;
  readonly statementPnlYen?: number;
  readonly fees: readonly Fee[];
  readonly entryChartTimeframe?: Timeframe;
  readonly exitChartTimeframe?: Timeframe;
}

/** 記録したときの銘柄の値 */
export interface InstrumentSnapshot {
  readonly multiplier: number;
  readonly quantityStep: number;
  /** ISO 4217 の 3 文字。null = 未設定（円とみなさない） */
  readonly priceCurrency: string | null;
  readonly underlyingKind: UnderlyingKind;
  readonly productForm: ProductForm;
}

/** 記録したときに API が写した値（本文では送らない） */
export interface TradeSnapshot {
  readonly instrument: InstrumentSnapshot;
  /** 資金（円）。設定する前に記録した取引は null */
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
}

/** 保存したチャート画像の要約（形式と大きさだけ。バイト列は API の /api/trades/{id}/charts/{slot} から読む。Issue #12） */
export interface ChartMeta {
  readonly contentType: 'image/png' | 'image/jpeg';
  readonly size: number;
}

export interface StoredTrade {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly snapshot: TradeSnapshot;
  readonly record: TradeRecord;
  /** 根拠の足のチャート（エントリー時・決済時。ある枠だけ。チャートの無い取引には鍵が無い） */
  readonly charts?: { readonly entry?: ChartMeta; readonly exit?: ChartMeta };
}

/** 銘柄の本文（省いた欄は API が既定を入れる） */
export interface InstrumentBody {
  readonly name: string;
  readonly underlying?: string;
  readonly underlyingKind?: UnderlyingKind;
  readonly productForm?: ProductForm;
  readonly priceCurrency?: string | null;
  readonly multiplier?: number;
  readonly quantityStep?: number;
}

export interface InstrumentRecord {
  readonly id: string;
  readonly name: string;
  readonly underlying?: string;
  readonly underlyingKind: UnderlyingKind;
  readonly productForm: ProductForm;
  readonly priceCurrency: string | null;
  readonly multiplier: number;
  readonly quantityStep: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SettingsBody {
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
  readonly performanceUnit: PerformanceUnit;
}

export interface SettingsRecord extends SettingsBody {
  /** 資金が変わったときの値と時刻（古い順） */
  readonly capitalHistory: readonly { readonly valueYen: number | null; readonly at: number }[];
}

/** 手数料の欄の合計（円。空なら 0。丸めない） */
export function feesTotalYen(fees: readonly Fee[]): number {
  let sum = 0;
  for (const f of fees) sum += f.amountYen;
  return sum;
}

/**
 * 保存した取引を計算の入力に写す。銘柄の値・資金・許容リスクは snapshot だけから取る（今の銘柄・設定を引かない）。
 * 判定に使わない欄（崩れの条件・根拠・感情・総評・TP・限月・P / C・行使価格・逆指値を入れた・銘柄の ID）は写さない
 */
export function toTradeInput(stored: Pick<StoredTrade, 'record' | 'snapshot'>): TradeInput {
  const { record: r, snapshot: s } = stored;
  const x = r.exit;
  return {
    side: r.side,
    instrument: {
      multiplier: s.instrument.multiplier,
      quantityStep: s.instrument.quantityStep,
      isJpy: s.instrument.priceCurrency === 'JPY',
    },
    entries: r.entries,
    ...(r.lc === undefined ? {} : { lc: r.lc }),
    lcBasis: r.lcBasis,
    lcDecidedBeforeEntry: r.lcDecidedBeforeEntry,
    lcMove: r.lcMove,
    timeframeChange: r.timeframeChange,
    ...(r.timeframe === undefined ? {} : { timeframe: r.timeframe }),
    ...(r.entryChartTimeframe === undefined ? {} : { entryChartTimeframe: r.entryChartTimeframe }),
    ...(r.exitChartTimeframe === undefined ? {} : { exitChartTimeframe: r.exitChartTimeframe }),
    exit: {
      time: x.time,
      price: x.price,
      orderType: x.orderType,
      reason: x.reason,
      ...(x.fxRate === undefined ? {} : { fxRate: x.fxRate }),
    },
    ...(r.statementPnlYen === undefined ? {} : { statementPnlYen: r.statementPnlYen }),
    feesTotalYen: feesTotalYen(r.fees),
    ...(x.gapSlip === 'unanswered' ? {} : { gapSlipAnswer: x.gapSlip === 'yes' }),
    ...(r.planFxRate === undefined ? {} : { planFxRate: r.planFxRate }),
    ...(s.capitalYen === null ? {} : { capitalYen: s.capitalYen }),
    riskTolerancePct: s.riskTolerancePct,
    ...(r.plannedAt === undefined ? {} : { plannedAt: r.plannedAt }),
  };
}
