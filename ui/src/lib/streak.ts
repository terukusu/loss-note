// ホームと一覧の「直近の流れ」の表示の形（Issue #35。設計書 6.1・9.2）。DOM・通信・現在時刻に触れない。
// 消した印を除いた取引を決済の新しい順（一覧と同じ sortTrades）に並べ、先頭の 10 件から取り込んだ取引を外して、
// 判定の段の点を古い順（左 = 古い・右 = 新しい。#88 の曲線と同じ向き）に並べる。取り込みは 3 つのタップが事実でなく
// 既定値なので、規律の並びに混ぜない（6.1・11 章・#88 と同じ）。
// 連続は core/review.ts の recentRun（最新の種類と、新しい方から同じ種類が続く件数）。判定・段は一覧と同じ
// summarize と badge.ts から（色・記号・名前の対応を 2 か所に持たない）。損益・R は出さない（規律の並び）
// 両建てのまとまり（#268・6.5）: まとまりとメンバーの取引（groups・groupMembers）を渡すと、先頭の 10 行のうちまとまりのメンバーを
// 1 点（最初の本玉の行の位置。まとまりの判定の段・決済の時刻。取り込んだメンバーがあれば取り込み）にまとめ、ほかのメンバーの行は
// 点にしない。最初の本玉の行が 10 行の外なら点にしない。渡さなければ今と同じ
import type { Grade } from '../../../core/judge';
import type { StoredTrade } from '../../../core/record';
import { type RecentRun, recentRun } from '../../../core/review';
import { type GroupUnit, groupTrades } from '../../../core/review-group';
import { badgeModel, type Tier, type TierSymbol } from './badge';
import { formatDate } from './datetime';
import { summarize } from './record-form';
import type { GroupSource } from './review-units';
import { sortTrades, visibleTrades } from './trade-view';

/** 並べる件数（決済の新しい方から。ホームが読む件数 HOME_LIMIT と同じ） */
export const STREAK_WINDOW = 10;
export const STREAK_TITLE = '直近の流れ';
/** 並びの目盛り（図の左右。読み上げは ol の名前で順を伝える） */
export const STREAK_AXIS = { old: '古い', new: '新しい' } as const;

export interface StreakDot {
  readonly id: string;
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  /** 読み上げの文字（「2026/11/18 B 悪い損失」） */
  readonly label: string;
  /** 新しい方からの連続に入る点（下に線を引く） */
  readonly run: boolean;
}

export interface StreakModel {
  /** 古い順 */
  readonly dots: readonly StreakDot[];
  readonly run: RecentRun;
  /** 最新の取引の段（見出しの記号と色） */
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  /** 1 行目「計画どおりが 3 件続いています」 */
  readonly headline: string;
  /**
   * 1 行目を文節の塊に分けたもの（「計画どおりが 3 件」「続いています」。#128 デザイン a2）。画面は塊の間でだけ折る
   * （語の途中で折らない。文字は小さくしない）。つなぐと headline と同じ
   */
  readonly headlineParts: readonly string[];
  /** 2 行目「直近 10 件のうち計画どおり 6 件」 */
  readonly subline: string;
  /** 並びの名前（読み上げ）「直近 10 件の判定（古い順）」 */
  readonly listLabel: string;
  /** 「取り込んだ取引 2 件は並べていません」（外したときだけ） */
  readonly importsNote: string | null;
}

function headlinePartsOf(run: RecentRun, latestLabel: string): string[] {
  if (run.count === 1) return ['直近の取引は ', latestLabel];
  if (run.kind === 'plan') return [`計画どおりが ${run.count} 件`, '続いています'];
  if (run.kind === 'off') return [`崩れが ${run.count} 件`, '続いています'];
  return [`直近の ${run.count} 件は`, '判定なし'];
}

/** 取引（読み込み済みの分）→ 直近の流れ。並べる取引が無ければ null（段を出さない）。groups があればまとまりを 1 点に（#268） */
export function streakModel(
  trades: readonly StoredTrade[],
  hidden: ReadonlySet<string>,
  groups?: GroupSource,
): StreakModel | null {
  return streakModelOfSorted(sortTrades(visibleTrades(trades, hidden)), groups, hidden);
}

/** 並びの 1 点（取引 1 件 / まとまり 1 件） */
interface StreakPoint {
  readonly id: string;
  readonly grade: Grade | null;
  readonly time: number;
  readonly imported: boolean;
}

/** 先頭の 10 行 → 点（まとまりのメンバーは最初の本玉の行で 1 点。ほかのメンバーの行は点にしない） */
function pointsOf(
  window: readonly StoredTrade[],
  src: GroupSource | undefined,
  hidden: ReadonlySet<string>,
): StreakPoint[] {
  const single = (t: StoredTrade): StreakPoint => ({
    id: t.id,
    grade: summarize(t).judgment?.grade ?? null,
    time: t.record.exit.time,
    imported: t.record.source === 'import',
  });
  const groups = src?.groups ?? [];
  if (groups.length === 0) return window.map(single);
  const { units } = groupTrades([...window, ...(src?.groupMembers ?? [])], groups, {
    excluded: hidden,
  });
  const byTrade = new Map<string, GroupUnit<StoredTrade>>();
  for (const u of units) for (const t of u.trades) byTrade.set(t.id, u);
  return window.flatMap((t) => {
    const u = byTrade.get(t.id);
    if (u === undefined) return [single(t)];
    if (u.leadId !== t.id) return [];
    return [
      { id: u.leadId, grade: u.item.grade, time: u.item.exitTime, imported: u.item.imported },
    ];
  });
}

/**
 * 消した印を除いて sortTrades で並べ済みの取引 → 直近の流れ（一覧は同じ描画で並べた配列を渡し、全件を 2 回並べない）。
 * 見るのは先頭の 10 件だけ。groups があればまとまりを 1 点に（#268）
 */
export function streakModelOfSorted(
  sorted: readonly StoredTrade[],
  groups?: GroupSource,
  hidden: ReadonlySet<string> = new Set(),
): StreakModel | null {
  const window = sorted.slice(0, STREAK_WINDOW);
  const points = pointsOf(window, groups, hidden);
  const shown = points.filter((p) => !p.imported);
  const excluded = points.length - shown.length;
  const grades = shown.map((p) => p.grade);
  const run = recentRun(grades);
  if (!run) return null;
  const badges = grades.map(badgeModel);
  const newestFirst = shown.map((t, i) => {
    const b = badges[i] ?? badgeModel(null);
    return {
      id: t.id,
      tier: b.tier,
      symbol: b.symbol,
      label: `${formatDate(t.time)} ${b.label}`,
      run: i < run.count,
    };
  });
  const latest = badges[0] ?? badgeModel(null);
  const planned = badges.filter((b) => b.tier === 'plan').length;
  const n = shown.length;
  return {
    dots: newestFirst.reverse(),
    run,
    tier: latest.tier,
    symbol: latest.symbol,
    headline: headlinePartsOf(run, latest.label).join(''),
    headlineParts: headlinePartsOf(run, latest.label),
    subline: `直近 ${n} 件のうち計画どおり ${planned} 件`,
    listLabel: `直近 ${n} 件の判定（古い順）`,
    importsNote: excluded > 0 ? `取り込んだ取引 ${excluded} 件は並べていません` : null,
  };
}
