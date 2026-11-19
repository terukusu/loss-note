// オプションのポジションのテストの取引を作る道具（設計書 5.7）。値はすべて架空。
// 既定: 架空の指数 XYZ のオプション（乗数 1,000・円の口座・刻み 1）、資金 10,000,000 円・許容 1%、
// 向き L、建てたときの原資産 38,500、LC 37,500（幅 1,000）、3 つのタップは計画どおり。
// 決済の既定は注文の種類 unknown・理由 other（C19・C26）
import type { Exit, Leg, LegSide, TradeInput } from '../../../core/trade';

export const ENTRY_UNDERLYING = 38_500;
export const LC_UNDERLYING = 37_500;
export const MULT = 1_000;

let seq = 0;

/** レッグを作る（id は呼んだ順に l1, l2, …。同じポジションの中で重ならないよう positionOf で振り直す） */
export function leg(
  optionType: 'P' | 'C',
  strike: number,
  side: LegSide,
  quantity: number,
  entryPrice: number,
  exitPrice: number,
  exitOver: Partial<Leg['exit']> = {},
  contractMonth = '2027-01',
): Leg {
  seq += 1;
  return {
    id: `l${seq}`,
    optionType,
    contractMonth,
    strike,
    side,
    quantity,
    entry: { price: entryPrice },
    exit: { price: exitPrice, kind: 'closed', ...exitOver },
  };
}

/** 満期で消えたレッグ（決済値は本源的価値。OTM なら 0） */
export function expiredLeg(
  optionType: 'P' | 'C',
  strike: number,
  side: LegSide,
  quantity: number,
  entryPrice: number,
  intrinsic = 0,
  time?: number,
  contractMonth = '2027-01',
): Leg {
  return leg(
    optionType,
    strike,
    side,
    quantity,
    entryPrice,
    intrinsic,
    { kind: 'expired', ...(time === undefined ? {} : { time }) },
    contractMonth,
  );
}

export interface PositionOver extends Partial<Omit<TradeInput, 'option' | 'exit'>> {
  readonly lcLossPlanYen?: number;
}

/** レッグからポジション（原資産の取引 + レッグ）を作り、決済したときの原資産で決済する */
export function position(
  legs: readonly Leg[],
  exitUnderlying: number,
  over: PositionOver = {},
  exitOver: Partial<Exit> = {},
): TradeInput {
  const [first, ...rest] = legs.map((l, i) => ({ ...l, id: `l${i + 1}` }));
  if (first === undefined) throw new Error('レッグが 1 本も無い');
  const { lcLossPlanYen, ...tradeOver } = over;
  return {
    side: 'L',
    instrument: { multiplier: MULT, quantityStep: 1, priceInAccountCurrency: true },
    entries: [{ price: ENTRY_UNDERLYING, quantity: 1 }],
    lc: LC_UNDERLYING,
    lcBasis: 'chart',
    lcDecidedBeforeEntry: true,
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    capitalYen: 10_000_000,
    riskTolerancePct: 1,
    ...tradeOver,
    exit: { price: exitUnderlying, orderType: 'unknown', reason: 'other', ...exitOver },
    option: {
      legs: [first, ...rest],
      ...(lcLossPlanYen === undefined ? {} : { lcLossPlanYen }),
    },
  };
}
