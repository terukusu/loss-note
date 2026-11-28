// 振り返りの集計の単位（取引 1 件 / 両建てのまとまり 1 件。設計書 6.5・C80。#268）。DOM・通信に触れない。
// 範囲の一覧の応答（範囲の中の取引 + 重なるまとまり positionGroups + 範囲の外のメンバー groupMembers）から、消した印を外し、
// まとまりを core/review-group.ts の groupTrades で 1 件に組み、期間に入れるかを決済の時刻（まとまりはまとまりの決済の時刻）で決める。
// 規律の集計（review-view.ts）・気づき（insight-view.ts）・期間の取引（review-trades.ts）が同じ単位を使う（定義を 3 か所に持たない）
import type { StoredTrade } from '../../../core/record';
import type { ReviewItem } from '../../../core/review';
import { type GroupUnit, groupTrades, type StoredPositionGroup } from '../../../core/review-group';
import { inRange } from './period';
import { visibleTrades } from './trade-view';

export type ReviewUnit =
  | { readonly kind: 'trade'; readonly trade: StoredTrade }
  | { readonly kind: 'group'; readonly group: GroupUnit<StoredTrade> };

/** まとまりを組むための応答の分（無い = まとまりの無い応答・前の版の API） */
export interface GroupSource {
  readonly groups?: readonly StoredPositionGroup[] | undefined;
  readonly groupMembers?: readonly StoredTrade[] | undefined;
}

/** 単位の集計の 1 件の ID（取引の ID / まとまりは最初の本玉の取引の ID） */
export function unitId(u: ReviewUnit): string {
  return u.kind === 'trade' ? u.trade.id : u.group.leadId;
}

/** 単位の決済の時刻（まとまりはまとまりの決済の時刻。5.8 の 2） */
export function unitExitTime(u: ReviewUnit): number {
  return u.kind === 'trade' ? u.trade.record.exit.time : u.group.item.exitTime;
}

/** 単位の代表の取引（まとまりは最初の本玉） */
export function unitTrade(u: ReviewUnit): StoredTrade {
  return u.kind === 'trade' ? u.trade : u.group.lead;
}

/** 単位 → 集計の 1 件（取引は呼ぶ側の写し方。まとまりはまとまりの 1 件 = 判定・R・心理と Good / More の和・崩れ方） */
export function unitItem(u: ReviewUnit, ofTrade: (t: StoredTrade) => ReviewItem): ReviewItem {
  return u.kind === 'trade' ? ofTrade(u.trade) : u.group.item;
}

/** 一覧の並び（決済の新しい順 → 作った新しい順 → ID の昇順。sortTrades と同じ。まとまりはまとまりの決済の時刻） */
export function newestFirst(a: ReviewUnit, b: ReviewUnit): number {
  const ta = unitTrade(a);
  const tb = unitTrade(b);
  const ia = unitId(a);
  const ib = unitId(b);
  return (
    unitExitTime(b) - unitExitTime(a) ||
    tb.createdAt - ta.createdAt ||
    (ia < ib ? -1 : ia > ib ? 1 : 0)
  );
}

/**
 * 期間の取引 → 集計の単位。range があれば範囲の外の単位を落とす（まとまりはまとまりの決済の時刻で）。
 * まとまりが無ければ入力の順の取引だけ（今と同じ）。あれば一覧の並びに並べる
 */
export function reviewUnits(
  trades: readonly StoredTrade[],
  opts: GroupSource & {
    readonly hidden: ReadonlySet<string>;
    readonly range?: { readonly from: number; readonly to: number } | undefined;
  },
): ReviewUnit[] {
  const range = opts.range;
  const keep = (time: number) => range === undefined || inRange(time, range);
  const groups = opts.groups ?? [];
  if (groups.length === 0) {
    return visibleTrades(trades, opts.hidden)
      .filter((t) => keep(t.record.exit.time))
      .map((trade) => ({ kind: 'trade', trade }));
  }
  // 範囲の外のメンバーは、まとまりを組むためだけに足す（単独に残っても範囲で落ちる）
  const all = [...trades, ...(opts.groupMembers ?? [])];
  const { units, singles } = groupTrades(all, groups, { excluded: opts.hidden });
  const out: ReviewUnit[] = [
    ...singles.map((trade) => ({ kind: 'trade' as const, trade })),
    ...units.map((group) => ({ kind: 'group' as const, group })),
  ];
  return out.filter((u) => keep(unitExitTime(u))).sort(newestFirst);
}

/** 取引の ID → その取引を数えた単位の集計の 1 件の ID（まとまりのメンバーは最初の本玉の ID） */
export function unitIdsByTrade(units: readonly ReviewUnit[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const u of units) {
    if (u.kind === 'trade') out.set(u.trade.id, u.trade.id);
    else for (const t of u.group.trades) out.set(t.id, u.group.leadId);
  }
  return out;
}

/** 取引の逆参照（`positionGroupId`。#266。メンバーの取引だけ） */
export function positionGroupIdOf(t: StoredTrade): string | undefined {
  const id = (t as { readonly positionGroupId?: unknown }).positionGroupId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}
