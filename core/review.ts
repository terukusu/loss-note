// 期間の規律の集計（Issue #88 契約 P-1。設計書 6.1・6.2・11 章・C44）。判定・R は記録・一覧と同じ計算（evaluateTrade）の
// 結果を受けるだけで、ここでは数えて足すだけ。時刻・DOM・通信に触れず、入力を変えない。
// - 対象 = 期間に決済した取引（絞るのは呼ぶ側）から、取り込んだ取引を既定で外したもの（includeImports で含める。11 章）
// - 計画どおり率 = （A + 計画どおりの勝ち）÷ 判定の出た取引。判定の出た取引が 5 件未満なら率を出さない（6.1）
// - 計画どおりだったらの R（6.2 の明確化）: B・C の負けで R が −1.0R より小さい取引だけ −1.0R に置き換え、ほかは実際の R。
//   規律コスト = Σ（実際の R − 計画どおりの R）（0 以下）。R が出ない取引は曲線と規律コストに入れず件数だけ数える
// - 危ない勝ち（運）は両方の曲線にそのまま入れ、件数と R の合計を別に出す
// - 曲線の並びは決済の古い順 → 作った古い順 → ID の降順（一覧の並び = API の trade_sort_key のちょうど逆）
// 累積は途中で丸めない（丸めは表示だけ）
// 心理のタグごとの行（reviewByEmotion。#162）は、タグごとの部分集合に reviewPeriod を当てる（定義を二重に持たない）
// 連勝の後（afterWinStreak・reviewAfterWinStreak。#185）も、連勝の後の取引の部分集合に reviewPeriod を当てる
// Good / More の話題ごとの行（reviewByReflection。#221）も、話題ごとの部分集合に reviewPeriod を当てる
import { CALM, EMOTION_TAG_IDS, type EmotionTagId, OVERCONFIDENT } from './emotion-tags';
import type { Grade } from './judge';
import { TOL } from './numeric';
import {
  REFLECTION_TOPICS,
  type Reflection,
  type ReflectionSide,
  type ReflectionTopicId,
} from './reflection';

/** 集計の 1 件（画面が保存した取引から作る。grade = 判定。null = 判定なし（計算できない取引）） */
export interface ReviewItem {
  readonly id: string;
  readonly exitTime: number;
  readonly createdAt: number;
  readonly grade: Grade | null;
  /** R（出ないときは無し） */
  readonly r?: number;
  /** 取り込んだ取引（record.source === 'import'） */
  readonly imported: boolean;
  /** 心理のタグ（付いている取引だけ。一覧の順・重複なし = normalizeEmotions の後。#162） */
  readonly emotions?: readonly EmotionTagId[];
  /** Good / More（付いている取引だけ。normalizeReflection の後。#221） */
  readonly reflection?: Reflection;
}

/** 判定の内訳の鍵（判定 + 判定なし） */
export type GradeKey = Grade | 'none';
export const GRADE_KEYS: readonly GradeKey[] = ['A', 'safeWin', 'B', 'riskyWin', 'C', 'none'];

/** 計画どおり率を出す最小の件数（判定の出た取引。6.1） */
export const MIN_JUDGED_FOR_RATE = 5;

/** 曲線の 1 点（R の出た取引 1 件） */
export interface CurvePoint {
  readonly id: string;
  readonly grade: Grade | null;
  readonly r: number;
  readonly plannedR: number;
  /** この取引までの実際の R の累積 */
  readonly actualCum: number;
  /** この取引までの計画どおりの R の累積 */
  readonly plannedCum: number;
}

export interface PeriodReview {
  /** 集計の対象の件数（取り込みを外した後） */
  readonly total: number;
  /** 期間の取り込んだ取引の件数（含めるかによらない。切り替えを出すか） */
  readonly imports: number;
  /** 外した取り込みの件数（含めるなら 0） */
  readonly excludedImports: number;
  readonly counts: Readonly<Record<GradeKey, number>>;
  /** 判定の出た取引（判定なしを除く） */
  readonly judged: number;
  /** A + 計画どおりの勝ち */
  readonly planned: number;
  /** 計画どおり率（0〜1）。判定の出た取引が 5 件未満なら null */
  readonly rate: number | null;
  readonly curve: readonly CurvePoint[];
  /** 実際の R の合計（曲線の最後の実際の累積。点が無ければ 0） */
  readonly actualR: number;
  /** 計画どおりの R の合計 */
  readonly plannedR: number;
  /** 規律コスト = Σ（実際 − 計画どおり）。0 以下 */
  readonly cost: number;
  /** 運: R の出た危ない勝ちの件数と R の合計 */
  readonly luck: { readonly count: number; readonly r: number };
  /** R が出ない取引の件数（曲線・規律コストに入れていない） */
  readonly noR: number;
}

/** 計画どおりだったらの R（B・C の負けで −1.0R より小さいときだけ −1.0R） */
export function plannedROf(grade: Grade | null, r: number): number {
  if ((grade === 'B' || grade === 'C') && r < -1 - TOL) return -1;
  return r;
}

/** 決済の古い順 → 作った古い順 → ID の降順（一覧の並びの逆） */
function oldestFirst(a: ReviewItem, b: ReviewItem): number {
  return (
    a.exitTime - b.exitTime || a.createdAt - b.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

export function reviewPeriod(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean },
): PeriodReview {
  const imports = items.filter((i) => i.imported).length;
  const target = opts.includeImports ? [...items] : items.filter((i) => !i.imported);
  const counts: Record<GradeKey, number> = { A: 0, safeWin: 0, B: 0, riskyWin: 0, C: 0, none: 0 };
  for (const i of target) counts[i.grade ?? 'none'] += 1;
  const judged = target.length - counts.none;
  const planned = counts.A + counts.safeWin;
  const rate = judged >= MIN_JUDGED_FOR_RATE ? planned / judged : null;

  const curve: CurvePoint[] = [];
  let actualCum = 0;
  let plannedCum = 0;
  let luckCount = 0;
  let luckR = 0;
  let noR = 0;
  // 規律コストは 1 件ずつの差（どれも 0 以下）の和で足す（2 つの累積の引き算の誤差で正にしない）
  let cost = 0;
  for (const i of target.sort(oldestFirst)) {
    const r = i.r;
    if (r === undefined || !Number.isFinite(r)) {
      noR += 1;
      continue;
    }
    const p = plannedROf(i.grade, r);
    actualCum += r;
    plannedCum += p;
    cost += r - p;
    curve.push({ id: i.id, grade: i.grade, r, plannedR: p, actualCum, plannedCum });
    if (i.grade === 'riskyWin') {
      luckCount += 1;
      luckR += r;
    }
  }
  return {
    total: target.length,
    imports,
    excludedImports: opts.includeImports ? 0 : imports,
    counts,
    judged,
    planned,
    rate,
    curve,
    actualR: actualCum,
    plannedR: plannedCum,
    cost,
    luck: { count: luckCount, r: luckR },
    noR,
  };
}

/** 心理のタグ 1 つの行（#162） */
export interface EmotionRow {
  readonly id: EmotionTagId;
  /** そのタグが付いた取引だけの期間の集計（total = 行の件数） */
  readonly review: PeriodReview;
}

export interface EmotionReview {
  /** 集計の対象の件数（取り込みを外した後。reviewPeriod の total と同じ） */
  readonly total: number;
  /** 対象のうちタグが 1 つ以上付いた件数（見出しの「記入」） */
  readonly tagged: number;
  /** 外した取り込みの件数（含めるなら 0） */
  readonly excludedImports: number;
  /** 2 つ以上のタグが付いた取引がある（行の件数の和が tagged より多くなる） */
  readonly overlap: boolean;
  /** 平常心 → 件数の多い順 → 一覧（C55）の順。0 件のタグは無い */
  readonly rows: readonly EmotionRow[];
}

const EMOTION_ORDER: ReadonlyMap<EmotionTagId, number> = new Map(
  EMOTION_TAG_IDS.map((id, i) => [id, i]),
);

/**
 * 心理のタグごとの規律の集計（Issue #162・設計書 6.1・9.4）。対象は reviewPeriod と同じ（取り込みは includeImports のときだけ）。
 * タグごとに、そのタグが付いた取引を 1 件ずつ数える（2 つ以上のタグの取引は付いたタグすべての行に入る。重みで割らない）。
 * 行の値は、その部分集合への reviewPeriod（計画どおり率・5 件未満の null・規律コストの定義をそのまま使う）
 */
export function reviewByEmotion(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean },
): EmotionReview {
  const target = opts.includeImports ? items : items.filter((i) => !i.imported);
  const byTag = new Map<EmotionTagId, ReviewItem[]>();
  let tagged = 0;
  let overlap = false;
  for (const i of target) {
    const tags = new Set(i.emotions ?? []);
    if (tags.size === 0) continue;
    tagged += 1;
    if (tags.size > 1) overlap = true;
    for (const t of tags) {
      const list = byTag.get(t);
      if (list) list.push(i);
      else byTag.set(t, [i]);
    }
  }
  const rows: EmotionRow[] = [...byTag].map(([id, list]) => ({
    id,
    review: reviewPeriod(list, { includeImports: true }),
  }));
  rows.sort(
    (a, b) =>
      Number(b.id === CALM) - Number(a.id === CALM) ||
      b.review.total - a.review.total ||
      (EMOTION_ORDER.get(a.id) ?? 0) - (EMOTION_ORDER.get(b.id) ?? 0),
  );
  return {
    total: target.length,
    tagged,
    excludedImports: opts.includeImports ? 0 : items.length - target.length,
    overlap,
    rows,
  };
}

/** Good / More の行の鍵: 話題の ID か、自分で書いた行（#221） */
export const REFLECTION_NOTES = 'notes';
export type ReflectionRowKey = ReflectionTopicId | typeof REFLECTION_NOTES;

/** Good / More の 1 行（#221） */
export interface ReflectionRow {
  readonly key: ReflectionRowKey;
  /** その話題（自分で書いた行）が付いた取引だけの期間の集計（total = 行の件数） */
  readonly review: PeriodReview;
}

export interface ReflectionReview {
  readonly side: ReflectionSide;
  /** 集計の対象の件数（取り込みを外した後。reviewPeriod の total と同じ） */
  readonly total: number;
  /** 対象のうち、その側に話題か自分で書いた行が 1 つ以上ある件数（見出しの「記入」） */
  readonly written: number;
  /** 外した取り込みの件数（含めるなら 0） */
  readonly excludedImports: number;
  /** 2 つ以上の行（話題 + 自分で書いた行）に入る取引がある（行の件数の和が written より多くなる） */
  readonly overlap: boolean;
  /** 話題の行（件数の多い順 → 一覧（C58）の順。0 件の話題は無い）→ 最後に自分で書いた行（0 件なら無い） */
  readonly rows: readonly ReflectionRow[];
}

/**
 * Good / More の話題ごとの規律の集計（Issue #221・設計書 6.1・9.4・C58）。対象は reviewPeriod と同じ（取り込みは includeImports の
 * ときだけ）。側ごと・話題ごとに、その話題が付いた取引を 1 件ずつ数える（2 つ以上の話題の取引は付いた話題すべての行に入る）。
 * 自分で書いた行は行の数によらず取引 1 件 = 1 件。行の値はその部分集合への reviewPeriod（心理の行 reviewByEmotion と同じ定義）
 */
export function reviewByReflection(
  items: readonly ReviewItem[],
  side: ReflectionSide,
  opts: { readonly includeImports: boolean },
): ReflectionReview {
  const target = opts.includeImports ? items : items.filter((i) => !i.imported);
  const byKey = new Map<ReflectionRowKey, ReviewItem[]>();
  let written = 0;
  let overlap = false;
  for (const i of target) {
    const part = i.reflection?.[side];
    const keys: ReflectionRowKey[] = [...new Set(part?.topics ?? [])];
    if ((part?.notes.length ?? 0) > 0) keys.push(REFLECTION_NOTES);
    if (keys.length === 0) continue;
    written += 1;
    if (keys.length > 1) overlap = true;
    for (const k of keys) {
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    }
  }
  const order: ReadonlyMap<string, number> = new Map(
    (REFLECTION_TOPICS[side] as readonly string[]).map((id, n) => [id, n]),
  );
  const rows: ReflectionRow[] = [...byKey].map(([key, list]) => ({
    key,
    review: reviewPeriod(list, { includeImports: true }),
  }));
  rows.sort(
    (a, b) =>
      Number(a.key === REFLECTION_NOTES) - Number(b.key === REFLECTION_NOTES) ||
      b.review.total - a.review.total ||
      (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
  );
  return {
    side,
    total: target.length,
    written,
    excludedImports: opts.includeImports ? 0 : items.length - target.length,
    overlap,
    rows,
  };
}

/** 連勝の後と数える、直前に続けて勝った件数（#185。設計書 6.1） */
export const WIN_STREAK_MIN = 2;

/** 判定の勝ち（計画どおりの勝ち・危ない勝ち。損益 0 も判定（5.4）が勝ちとする）。判定なしは勝ちと分からない */
export function isWinGrade(grade: Grade | null): boolean {
  return grade === 'safeWin' || grade === 'riskyWin';
}

/**
 * 連勝の後の取引の ID（Issue #185・設計書 6.1）。対象（取り込みは includeImports のときだけ）を決済の古い順（曲線と同じ並び）に
 * 並べ、直前の 2 件がどちらも判定の勝ちの取引。並べるのは対象だけ（期間の前・消した印は呼ぶ側が外し、外した取り込みも入れない =
 * 連勝を切りも続けもしない）。判定なし・負けは連勝を切る。その取引自身の勝ち負けは問わない（3 連勝目も連勝の後）
 */
export function afterWinStreak(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean },
): ReadonlySet<string> {
  const target = (opts.includeImports ? [...items] : items.filter((i) => !i.imported)).sort(
    oldestFirst,
  );
  const out = new Set<string>();
  let run = 0;
  for (const i of target) {
    if (run >= WIN_STREAK_MIN) out.add(i.id);
    run = isWinGrade(i.grade) ? run + 1 : 0;
  }
  return out;
}

export interface WinStreakReview {
  /** 集計の対象の件数（取り込みの切り替えの後） */
  readonly total: number;
  /** 連勝の後の取引の ID */
  readonly ids: ReadonlySet<string>;
  /** 連勝の後の取引だけの期間の集計（total = 連勝の後の件数） */
  readonly review: PeriodReview;
  /** 比べる相手: 対象のうち連勝の後でない取引の集計（#185 デザインレビュー 1） */
  readonly rest: PeriodReview;
  /** 「調子に乗った」: 対象のうち付いた件数（tagged）と、そのうち連勝の後の件数（after） */
  readonly overconfident: { readonly tagged: number; readonly after: number };
}

/** 連勝の後の規律と「調子に乗った」との重なり（Issue #185）。比べる相手として連勝の後でない取引の集計も返す。値は連勝の後の部分集合への reviewPeriod（#162 の行と同じ定義） */
export function reviewAfterWinStreak(
  items: readonly ReviewItem[],
  opts: { readonly includeImports: boolean },
): WinStreakReview {
  const target = opts.includeImports ? items : items.filter((i) => !i.imported);
  const ids = afterWinStreak(target, { includeImports: true });
  const over = target.filter((i) => i.emotions?.includes(OVERCONFIDENT) === true);
  return {
    total: target.length,
    ids,
    review: reviewPeriod(
      target.filter((i) => ids.has(i.id)),
      { includeImports: true },
    ),
    rest: reviewPeriod(
      target.filter((i) => !ids.has(i.id)),
      { includeImports: true },
    ),
    overconfident: { tagged: over.length, after: over.filter((i) => ids.has(i.id)).length },
  };
}

/** 直近の並びの種類（Issue #35）: 計画どおり = A・計画どおりの勝ち / 崩れ = B・危ない勝ち・C / 判定なし */
export type RunKind = 'plan' | 'off' | 'none';

export function runKindOf(grade: Grade | null): RunKind {
  if (grade === null) return 'none';
  return grade === 'A' || grade === 'safeWin' ? 'plan' : 'off';
}

/** 直近の連続: 最新の取引の種類と、新しい方から同じ種類が続く件数（1 以上） */
export interface RecentRun {
  readonly kind: RunKind;
  readonly count: number;
}

/**
 * 新しい順の判定の並び → 最新の種類と連続の件数（Issue #35）。空なら null。並びの外（もっと古い取引）は見ない
 * （件数は並びの長さが上限）
 */
export function recentRun(newestFirst: readonly (Grade | null)[]): RecentRun | null {
  const first = newestFirst[0];
  if (first === undefined) return null;
  const kind = runKindOf(first);
  let count = 0;
  for (const g of newestFirst) {
    if (runKindOf(g) !== kind) break;
    count += 1;
  }
  return { kind, count };
}
