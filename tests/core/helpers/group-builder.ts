// テストの両建てのまとまりを作る道具（設計書 5.8 の例。値はすべて架空）。
// 既定: 本玉 = 口座 A（円・資金 30,000,000 円・許容 1%）の XYZ 先物（乗数 1,000）L 1 枚・イン 38,000・LC 37,700（入る前に決めた・
// チャートの根拠・2 つのタップは計画どおり）。決済の代わり = 口座 B（円・資金 20,000,000 円）の XYZ CFD（乗数 10）S 100・LC なし。
// 時刻: 本玉を建てた ENTRY → 金曜の夜に固定 FIX → 月曜の寄り MON（本玉の決済）→ 決済の代わりの決済 MON + 5 分。手数料 0

import type { EmotionTagId } from '../../../core/emotion-tags';
import type { GroupMember, GroupTrade, MemberRole } from '../../../core/position-group';
import type { RecordSource } from '../../../core/record';
import type { Reflection } from '../../../core/reflection';
import type {
  Entry,
  ExitOrderType,
  ExitReason,
  LcMove,
  Side,
  Timeframe,
  TimeframeChange,
} from '../../../core/trade';

export const ENTRY = 1_800_000_000_000;
export const FIX = ENTRY + 2 * 86_400_000;
export const MON = FIX + 2.5 * 86_400_000;
export const MIN = 60_000;

export interface MemberOpts {
  readonly side?: Side;
  readonly multiplier?: number;
  readonly quantity?: number;
  readonly price?: number;
  readonly entryTime?: number;
  /** 2 つ以上のエントリー（quantity・price・entryTime より優先） */
  readonly entries?: readonly [Entry, ...Entry[]];
  readonly lc?: number | null;
  readonly lcDecidedBeforeEntry?: boolean;
  readonly lcMove?: LcMove;
  readonly lcBasis?: 'chart' | 'amount';
  readonly timeframe?: Timeframe;
  readonly timeframeChange?: TimeframeChange;
  readonly entryChartTimeframe?: Timeframe;
  readonly exitChartTimeframe?: Timeframe;
  readonly exitPrice: number;
  readonly exitTime?: number;
  readonly orderType?: ExitOrderType;
  readonly reason?: ExitReason;
  readonly gapSlip?: 'yes' | 'no' | 'unanswered';
  readonly fxRate?: number;
  readonly accountId?: string;
  readonly accountCurrency?: string;
  readonly priceCurrency?: string;
  readonly capitalYen?: number | null;
  readonly riskTolerancePct?: number;
  readonly fees?: number;
  readonly source?: RecordSource;
  readonly emotionTags?: readonly EmotionTagId[];
  readonly reflection?: Reflection;
  readonly createdAt?: number;
  readonly legs?: boolean;
}

export function tradeOf(id: string, o: MemberOpts): GroupTrade {
  const entries: readonly [Entry, ...Entry[]] = o.entries ?? [
    { time: o.entryTime ?? ENTRY, price: o.price ?? 38_000, quantity: o.quantity ?? 1 },
  ];
  const lc = o.lc === null ? undefined : (o.lc ?? 37_700);
  const record = {
    status: 'closed' as const,
    source: o.source ?? ('manual' as const),
    instrumentId: `I-${id}`,
    accountId: o.accountId ?? 'A',
    side: o.side ?? 'L',
    ...(lc === undefined ? {} : { lc }),
    lcBasis: o.lcBasis ?? 'chart',
    stopOrderPlaced: 'unanswered' as const,
    lcDecidedBeforeEntry: o.lcDecidedBeforeEntry ?? lc !== undefined,
    lcMove: o.lcMove ?? { kind: 'none' },
    timeframeChange: o.timeframeChange ?? ('none' as const),
    ...(o.timeframe === undefined ? {} : { timeframe: o.timeframe }),
    ...(o.entryChartTimeframe === undefined ? {} : { entryChartTimeframe: o.entryChartTimeframe }),
    ...(o.exitChartTimeframe === undefined ? {} : { exitChartTimeframe: o.exitChartTimeframe }),
    entries,
    exit: {
      time: o.exitTime ?? MON,
      price: o.exitPrice,
      orderType: o.orderType ?? 'unknown',
      reason: o.reason ?? 'other',
      gapSlip: o.gapSlip ?? 'unanswered',
      ...(o.fxRate === undefined ? {} : { fxRate: o.fxRate }),
    },
    fees: o.fees === undefined ? [] : [{ amountYen: o.fees }],
    ...(o.legs
      ? {
          legs: [
            {
              id: 'l1',
              optionType: 'P' as const,
              contractMonth: '2027-03',
              strike: 37_000,
              side: 'sell' as const,
              quantity: 1,
              entry: { price: 100 },
              exit: { price: 50, kind: 'closed' as const },
            },
          ] as const,
        }
      : {}),
  };
  const accountCurrency = o.accountCurrency ?? 'JPY';
  return {
    id,
    createdAt: o.createdAt ?? ENTRY,
    record,
    snapshot: {
      instrument: {
        multiplier: o.multiplier ?? 1_000,
        quantityStep: 1,
        priceCurrency: o.priceCurrency ?? accountCurrency,
        underlyingKind: 'index',
        productForm: 'future',
      },
      capitalYen: o.capitalYen === undefined ? 30_000_000 : o.capitalYen,
      riskTolerancePct: o.riskTolerancePct ?? 1,
      accountCurrency,
    },
    ...(o.emotionTags === undefined ? {} : { emotionTags: o.emotionTags }),
    ...(o.reflection === undefined ? {} : { reflection: o.reflection }),
  };
}

export function member(id: string, role: MemberRole, o: MemberOpts): GroupMember {
  return { tradeId: id, role, trade: tradeOf(id, o) };
}

/** 既定の本玉（XYZ 先物 L 1 枚・イン 38,000・LC 37,700・口座 A） */
export function main(o: Partial<MemberOpts> & { exitPrice: number }, id = 'm1'): GroupMember {
  return member(id, 'main', o);
}

/** 既定の決済の代わり（XYZ CFD S 100・乗数 10・LC なし・口座 B・FIX に建てて MON + 5 分に決済） */
export function hedge(
  o: Partial<MemberOpts> & { price: number; exitPrice: number },
  id = 'h1',
): GroupMember {
  return member(id, 'hedge', {
    side: 'S',
    multiplier: 10,
    quantity: 100,
    entryTime: FIX,
    lc: null,
    exitTime: MON + 5 * MIN,
    accountId: 'B',
    capitalYen: 20_000_000,
    ...o,
  });
}
