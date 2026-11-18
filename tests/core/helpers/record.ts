// テストの道具: 計算の入力（TradeInput）を保存の形（API に送る record・銘柄・設定と、API が作る snapshot）に写す。
// toTradeInput の逆向き。決済の時刻など保存に要る欄が無ければ、決まった架空の値で埋める
import type {
  InstrumentBody,
  SettingsBody,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../../core/record';
import type { TradeInput } from '../../../core/trade';

/** 保存のときに埋める架空の値 */
export const FILL = {
  instrumentId: 'INSTRUMENT',
  exitTime: 1_700_000_000_000,
} as const;

export interface StoredScene {
  readonly record: TradeRecord;
  readonly instrument: InstrumentBody;
  readonly settings: SettingsBody;
  readonly snapshot: TradeSnapshot;
}

export function fromTradeInput(t: TradeInput, name = 'TEST'): StoredScene {
  if (t.exit === undefined)
    throw new Error('決済の無い取引は保存の形に写せません（この Issue は決済済みだけ）');
  const priceCurrency = t.instrument.priceInAccountCurrency ? 'JPY' : 'USD';
  const instrument: InstrumentBody = {
    name,
    underlyingKind: 'index',
    productForm: 'spotCfd',
    priceCurrency,
    multiplier: t.instrument.multiplier,
    quantityStep: t.instrument.quantityStep,
  };
  const settings: SettingsBody = {
    capitalYen: t.capitalYen ?? null,
    riskTolerancePct: t.riskTolerancePct,
    performanceUnit: 'R',
  };
  const snapshot: TradeSnapshot = {
    instrument: {
      multiplier: t.instrument.multiplier,
      quantityStep: t.instrument.quantityStep,
      priceCurrency,
      underlyingKind: 'index',
      productForm: 'spotCfd',
    },
    capitalYen: t.capitalYen ?? null,
    riskTolerancePct: t.riskTolerancePct,
  };
  const gapSlip = t.gapSlipAnswer === undefined ? 'unanswered' : t.gapSlipAnswer ? 'yes' : 'no';
  const record: TradeRecord = {
    status: 'closed',
    source: 'manual',
    instrumentId: FILL.instrumentId,
    side: t.side,
    ...(t.timeframe === undefined ? {} : { timeframe: t.timeframe }),
    ...(t.lc === undefined ? {} : { lc: t.lc }),
    lcBasis: t.lcBasis,
    stopOrderPlaced: 'unanswered',
    ...(t.planFxRate === undefined ? {} : { planFxRate: t.planFxRate }),
    ...(t.plannedAt === undefined ? {} : { plannedAt: t.plannedAt }),
    lcDecidedBeforeEntry: t.lcDecidedBeforeEntry,
    lcMove: t.lcMove,
    timeframeChange: t.timeframeChange,
    entries: t.entries,
    exit: {
      time: t.exit.time ?? FILL.exitTime,
      price: t.exit.price,
      ...(t.exit.fxRate === undefined ? {} : { fxRate: t.exit.fxRate }),
      orderType: t.exit.orderType,
      reason: t.exit.reason,
      gapSlip,
    },
    ...(t.statementPnlYen === undefined ? {} : { statementPnlYen: t.statementPnlYen }),
    fees: t.feesTotalYen === undefined ? [] : [{ label: '手数料', amountYen: t.feesTotalYen }],
    ...(t.entryChartTimeframe === undefined ? {} : { entryChartTimeframe: t.entryChartTimeframe }),
    ...(t.exitChartTimeframe === undefined ? {} : { exitChartTimeframe: t.exitChartTimeframe }),
  };
  return { record, instrument, settings, snapshot };
}

/** API の応答の形（id・時刻は架空） */
export function stored(scene: Pick<StoredScene, 'record' | 'snapshot'>): StoredTrade {
  return {
    id: 'T1',
    schemaVersion: 1,
    createdAt: FILL.exitTime,
    updatedAt: FILL.exitTime,
    snapshot: scene.snapshot,
    record: scene.record,
  };
}
