// 保存の形（記録の API が返す取引・銘柄・口座・設定。設計書 4 章・Issue #4・#47・ADR-0004・ADR-0012）と、計算の入力への写し。
// 取引は記録したときの銘柄の値（乗数・数量の刻み・価格の通貨・原資産の種類・商品の形）と、その取引の口座の資金・許容リスクを
// snapshot に写して持つ。後で銘柄・口座を直しても過去の取引は変わらない（C36・C41）。判定・R・損益は保存しない（4.2 導出）。
// 価格は銘柄の価格の通貨、金額は口座の通貨、時点はエポックからのミリ秒（core/trade.ts と同じ）。表示の丸めはしない。
// 金額の鍵の名前（capitalYen・statementPnlYen・amountYen・valueYen）は歴史的に `…Yen` のまま。外貨の口座ではその通貨の金額
// （#47 PR-2・C43。鍵を変えると保存済みの取引・口座を書き換えることになるため。円の口座では今と同じ円）
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

/** 明細の手数料の欄（口座の通貨。費用を正の数。7.5） */
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
  /** 口座の ID（#47。無い = 既定の口座。移す前の取引・口座 1 つの利用者の取引） */
  readonly accountId?: string;
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
  /** 付属のチャート（#89。最大 5 枚・追加した順。判定に使わない）。付属の無い取引には鍵が無い */
  readonly extraCharts?: readonly ExtraChart[];
}

/** 記録したときの銘柄の値 */
export interface InstrumentSnapshot {
  readonly multiplier: number;
  readonly quantityStep: number;
  /** ISO 4217 の 3 文字。null = 未設定（口座の通貨と同じとみなさない） */
  readonly priceCurrency: string | null;
  readonly underlyingKind: UnderlyingKind;
  readonly productForm: ProductForm;
}

/** 記録したときに API が写した値（本文では送らない） */
export interface TradeSnapshot {
  readonly instrument: InstrumentSnapshot;
  /** 記録したときの、その取引の口座の資金（口座の通貨）。資金が未設定の口座で記録した取引は null */
  readonly capitalYen: number | null;
  /** 記録したときの、その取引の口座の許容リスク（%） */
  readonly riskTolerancePct: number;
  /** 記録したとき（付け替えたとき）の口座の通貨（ISO 4217 の 3 文字。#47 PR-2）。無い = JPY（移す前・PR-1 の取引） */
  readonly accountCurrency?: string;
}

/** 口座の通貨の既定（口座の `currency`・snapshot の `accountCurrency` が無いときの値） */
export const DEFAULT_CURRENCY = 'JPY';

/** 取引の口座の通貨（snapshot に無ければ JPY。API の accounts.account_snapshot と同じ） */
export function accountCurrencyOf(snapshot: Pick<TradeSnapshot, 'accountCurrency'>): string {
  return snapshot.accountCurrency || DEFAULT_CURRENCY;
}

/** 付属のチャートの枠（#89。x1〜x5） */
export type ExtraChartSlot = 'x1' | 'x2' | 'x3' | 'x4' | 'x5';

/** 付属のチャートの記録（枠・任意の時間足・任意の一言 40 字まで） */
export interface ExtraChart {
  readonly slot: ExtraChartSlot;
  readonly timeframe?: Timeframe;
  readonly note?: string;
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
  /** 根拠の足のチャート（エントリー時・決済時・付属 x1〜x5。ある枠だけ。チャートの無い取引には鍵が無い） */
  readonly charts?: { readonly [K in 'entry' | 'exit' | ExtraChartSlot]?: ChartMeta };
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

/** 設定（#47 の後、資金・許容リスク・資金の履歴は既定の口座へ移す元。画面は performanceUnit だけを使う） */
export interface SettingsRecord extends SettingsBody {
  /** 資金が変わったときの値と時刻（古い順） */
  readonly capitalHistory: readonly CapitalHistoryEntry[];
}

/** 既定の口座の ID（決まった値。API の accounts.DEFAULT_ACCOUNT_ID と同じ） */
export const DEFAULT_ACCOUNT_ID = 'default';
/** 既定の口座の名前（移し替えで作る。設定の画面で直せる） */
export const DEFAULT_ACCOUNT_NAME = '口座 1';

/** 取引の口座の ID（無ければ既定の口座。API の accounts.account_id_of と同じ） */
export function accountIdOf(record: Pick<TradeRecord, 'accountId'>): string {
  return record.accountId || DEFAULT_ACCOUNT_ID;
}

/** 資金の履歴の 1 件（古い順に積む） */
export interface CapitalHistoryEntry {
  /** 資金（その行の通貨。鍵の名前は歴史的に `…Yen`） */
  readonly valueYen: number | null;
  readonly at: number;
  /** その行の通貨（口座の履歴の #47 PR-2 からの行だけ。無い = JPY。設定の履歴には無い） */
  readonly currency?: string;
}

/** 口座（#47） */
export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  /** 口座の通貨（ISO 4217 の 3 文字。API はいつも返す。保存に無い = JPY。#47 PR-2） */
  readonly currency: string;
  /** 資金（口座の通貨）。未設定は null */
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
  readonly capitalHistory: readonly CapitalHistoryEntry[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 口座を足す本文（省いた通貨は JPY・資金は未設定・許容リスクは 1） */
export interface AccountBody {
  readonly name: string;
  readonly currency?: string;
  readonly capitalYen?: number | null;
  readonly riskTolerancePct?: number;
}

/** 口座を直す本文（3 欄を丸ごと。通貨は省くと今のまま。取引のある口座の通貨を変えると 409） */
export interface AccountPut {
  readonly name: string;
  readonly currency?: string;
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
}

/** 手数料の欄の合計（口座の通貨。空なら 0。丸めない） */
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
      // 未設定（null）は口座の通貨と同じとみなさない（F11）。snapshot に口座の通貨が無ければ JPY（F15）
      priceInAccountCurrency:
        s.instrument.priceCurrency !== null && s.instrument.priceCurrency === accountCurrencyOf(s),
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
