// 振り返りで両建てのまとまりを 1 件として数える（設計書 6.5・C80・ADR-0027。#268）。時刻・DOM・通信に触れず、入力を変えない。
// 取引（範囲の中の取引と範囲の外のメンバー）とまとまり（範囲の一覧の positionGroups。4.8 の保存の形）を、
// まとまりの 1 件の集計の項目（groupReviewItem = まとまりの判定・R・決済の時刻・心理と Good / More の和・取り込み）と、
// 単独で数える取引に分ける。期間に入れるか（まとまりの決済の時刻で）は呼ぶ側が決める。
// - 消した印（[元に戻す] を待つ）のメンバーは除いてまとまりを組み、残りで役割の組を満たさなければ残りを単独で数える
// - 崩れたまとまり（無い取引を指す・役割の組が崩れた・同じ取引が 2 つのまとまりにいる = そのどのまとまりも）はメンバーを単独で数える（4.8）
// - 判定の出ないまとまり（メンバーの取引の入力の誤り）は判定なしの 1 件（今の「判定の出ない取引」と同じ）
import {
  evaluatePositionGroup,
  type GroupEvaluation,
  type GroupExitOverride,
  type GroupMember,
  type GroupTrade,
  groupReviewItem,
  type MemberRole,
  unionEmotions,
  unionReflection,
} from './position-group';
import { isEmptyReflection } from './reflection';
import type { ReviewItem } from './review';

/** まとまりのメンバー（保存の形。4.8。時刻の写しは範囲の読みの索引で、計算には使わない） */
export interface StoredGroupMember {
  readonly tradeId: string;
  readonly role: MemberRole;
  readonly entryTime?: number;
  readonly exitTime?: number;
}

/** 両建てのまとまり（`GET /api/position-groups`・範囲の一覧の `positionGroups` の 1 件。4.8） */
export interface StoredPositionGroup {
  readonly id: string;
  readonly schemaVersion: number;
  readonly members: readonly StoredGroupMember[];
  readonly exit?: GroupExitOverride;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 振り返りの 1 件に組んだまとまり */
export interface GroupUnit<T extends GroupTrade> {
  readonly groupId: string;
  /** 最初の本玉（決済の時刻の早い本玉。同じなら最初のエントリーの時刻 → 取引の ID の順）の取引の ID = 集計の 1 件の ID */
  readonly leadId: string;
  readonly lead: T;
  /** まとまりに数えたメンバーの取引（消した印を除く。結んだ順） */
  readonly trades: readonly T[];
  /** 集計の 1 件（ID = leadId・決済の時刻 = まとまりの決済の時刻） */
  readonly item: ReviewItem;
  /** 本玉に LC の無い取引がある（R が出ないときの「LC が無い」の数え分け） */
  readonly noLc: boolean;
  /** まとまりの計算と判定（5.8。ok: false はメンバーの取引の入力の誤り = 判定なし） */
  readonly evaluation: GroupEvaluation;
}

export interface GroupedTrades<T extends GroupTrade> {
  readonly units: readonly GroupUnit<T>[];
  /** 単独で数える取引（入力の順。まとまりに数えたメンバーを除く） */
  readonly singles: readonly T[];
}

const firstEntryTime = (t: GroupTrade) => t.record.entries[0].time ?? Number.POSITIVE_INFINITY;

/** 最初の本玉（position-group.ts の evaluatePositionGroup と同じ選び方） */
function leadOf<T extends GroupTrade>(mains: readonly T[]): T | undefined {
  return [...mains].sort(
    (a, b) =>
      a.record.exit.time - b.record.exit.time ||
      firstEntryTime(a) - firstEntryTime(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}

/** 判定の出ないまとまり（メンバーの取引の入力の誤り）の 1 件: 決済の時刻 = 本玉の決済の遅いほう（5.8 の 2 の残りのある場合と同じ） */
function ungradedItem(id: string, trades: readonly GroupTrade[], mains: readonly GroupTrade[]) {
  const emotions = unionEmotions(trades);
  const reflection = unionReflection(trades);
  const item: ReviewItem = {
    id,
    exitTime: Math.max(...mains.map((t) => t.record.exit.time)),
    createdAt: Math.min(...trades.map((t) => t.createdAt)),
    grade: null,
    imported: trades.some((t) => t.record.source === 'import'),
    ...(emotions.length === 0 ? {} : { emotions }),
    ...(isEmptyReflection(reflection) ? {} : { reflection }),
  };
  return item;
}

/**
 * 取引とまとまり → まとまりの 1 件と単独の取引（6.5）。trades は範囲の中の取引と範囲の外のメンバー（同じ ID は最初の 1 件）。
 * excluded = 消した印の取引の ID（まとまりからも単独からも除く）。まとまりが無ければ singles は trades（excluded を除く）のまま
 */
export function groupTrades<T extends GroupTrade>(
  trades: readonly T[],
  groups: readonly StoredPositionGroup[],
  opts: { readonly excluded?: ReadonlySet<string> } = {},
): GroupedTrades<T> {
  const excluded = opts.excluded ?? new Set<string>();
  const byId = new Map<string, T>();
  for (const t of trades) if (!excluded.has(t.id) && !byId.has(t.id)) byId.set(t.id, t);
  // 同じ取引が 2 つ以上のまとまりにいる（API は 409 で守る。崩れた）なら、そのどのまとまりも組まない（応答の並びに依らない）
  const seen = new Map<string, number>();
  for (const g of groups) {
    for (const id of new Set(g.members.map((m) => m.tradeId))) {
      if (!excluded.has(id)) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  const consumed = new Set<string>();
  const units: GroupUnit<T>[] = [];
  for (const g of groups) {
    const kept = g.members.filter((m) => !excluded.has(m.tradeId));
    if (kept.some((m) => (seen.get(m.tradeId) ?? 0) > 1)) continue;
    const members: GroupMember[] = kept.map((m) => {
      const trade = byId.get(m.tradeId);
      return trade === undefined
        ? { tradeId: m.tradeId, role: m.role }
        : { tradeId: m.tradeId, role: m.role, trade };
    });
    const input = { members, ...(g.exit === undefined ? {} : { exit: g.exit }) };
    const ev = evaluatePositionGroup(input);
    if (!ev.ok && ev.problems.length > 0) continue;
    const found = kept.flatMap((m) => {
      const t = byId.get(m.tradeId);
      return t === undefined ? [] : [t];
    });
    const mains = kept.flatMap((m) => {
      const t = m.role === 'main' ? byId.get(m.tradeId) : undefined;
      return t === undefined ? [] : [t];
    });
    const lead = leadOf(mains);
    if (lead === undefined) continue;
    const item = groupReviewItem(lead.id, input, ev) ?? ungradedItem(lead.id, found, mains);
    for (const t of found) consumed.add(t.id);
    units.push({
      groupId: g.id,
      leadId: lead.id,
      lead,
      trades: found,
      item,
      noLc: mains.some((t) => t.record.lc === undefined),
      evaluation: ev,
    });
  }
  const singles: T[] = [];
  for (const t of byId.values()) if (!consumed.has(t.id)) singles.push(t);
  return { units, singles };
}
