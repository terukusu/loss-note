// 振り返りのタブの期間（Issue #88 契約 P-2・ルール R1。設計書 9.2・C44。#128 でホームから振り返りのタブ `/review` へ移した）。
// DOM・通信なし。「今」は引数で受ける。
// - 日の境目は端末の時間帯の暦日（new Date(年, 月, 日) のローカルの 0 時）。決済の時刻で数える
// - 1 日 = 今日。7 日 = 今日を含む 7 暦日。1 か月 / 3 か月 = 1 / 3 か月前の同じ日の翌日から（その日が無ければ末日の翌日から）。
//   任意 = 開始日の 0 時から終了日の翌日の 0 時まで（開始日 ≦ 終了日、長さ 366 日まで）。終了は含まない
// - 選んだ期間は URL の検索部分（?period=1d|7d|1m|3m、任意は &from=YYYY-MM-DD&to=YYYY-MM-DD、取り込みを含めるは &imports=1、振り返りの気づきのセグメントは &view=insight。#162）。
//   無い・読めないときは 7 日。端末には保存しない（P6）

import { formatDayRange } from './format';

export type PeriodKey = '1d' | '7d' | '1m' | '3m' | 'custom';
export const PERIOD_KEYS: readonly PeriodKey[] = ['1d', '7d', '1m', '3m', 'custom'];
export const DEFAULT_PERIOD: PeriodKey = '7d';

/** 期間の選択肢の文字（360px で 5 つが 1 行に入る短さ） */
export const PERIOD_LABEL: Readonly<Record<PeriodKey, string>> = {
  '1d': '1日',
  '7d': '7日',
  '1m': '1か月',
  '3m': '3か月',
  // 設計書 9.2・モックの言葉（#128。押すと期間を指定する。U3（#129） で期間のシートにする）
  custom: '指定',
};

/** 任意の期間の長さの上限（暦日） */
export const MAX_CUSTOM_DAYS = 366;

export const PERIOD_ERROR = {
  empty: '開始日と終了日を選んでください',
  order: '開始日は終了日より前にしてください',
  tooLong: '1 年以内で選んでください',
} as const;

export interface PeriodSelection {
  readonly key: PeriodKey;
  /** 任意の開始日（YYYY-MM-DD。key = custom のときだけ意味を持つ） */
  readonly from?: string;
  readonly to?: string;
  /** 取り込んだ取引も含める */
  readonly imports: boolean;
}

export type PeriodRange =
  | {
      readonly ok: true;
      /** 開始（含む。ミリ秒） */
      readonly from: number;
      /** 終了（含まない。ミリ秒） */
      readonly to: number;
      /** 「11/13〜11/19」（年が今年でない日は「2025/11/13」） */
      readonly label: string;
      /** 暦日の数 */
      readonly days: number;
    }
  | { readonly ok: false; readonly error: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * 受ける年（API の時刻の範囲 0〜2100-01-01 に、どの時間帯の端末でも収まる年だけ。1970 年の元日は東の時間帯で負の時刻、
 * 2099 年の大みそかは西の時間帯で上限を超えるため、細工した URL で通信の誤りの案内を出さないよう外す）
 */
const MIN_YEAR = 1971;
const MAX_YEAR = 2098;
const pad2 = (n: number) => String(n).padStart(2, '0');

interface Ymd {
  readonly y: number;
  /** 0 始まりの月 */
  readonly m: number;
  readonly d: number;
}

/** YYYY-MM-DD → 暦日（無い日付は null） */
export function parseYmd(s: string | undefined | null): Ymd | null {
  if (!s) return null;
  const m = DATE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 0 || mo > 11 || d < 1 || d > daysInMonth(y, mo))
    return null;
  return { y, m: mo, d };
}

/** 暦日 → YYYY-MM-DD */
export function ymdText(v: Ymd): string {
  return `${v.y}-${pad2(v.m + 1)}-${pad2(v.d)}`;
}

/** 時刻 → 端末の時間帯の暦日 */
export function ymdOf(ms: number): Ymd {
  const t = new Date(ms);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** 暦日の 0 時（端末の時間帯。日 d は範囲の外でも繰り上がる） */
function startOf(y: number, m: number, d: number): number {
  return new Date(y, m, d).getTime();
}

/** 暦日の通し番号（時間帯・夏時間によらない日の数え方） */
function dayNumber(v: Ymd): number {
  return Math.round(Date.UTC(v.y, v.m, v.d) / 86_400_000);
}

/** n か月前の同じ日（その月に無ければ末日）の翌日 */
function monthsBackNextDay(today: Ymd, n: number): number {
  const total = today.y * 12 + today.m - n;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const d = Math.min(today.d, daysInMonth(y, m));
  return startOf(y, m, d + 1);
}

function labelOf(first: Ymd, last: Ymd, now: number): string {
  return formatDayRange(startOf(first.y, first.m, first.d), startOf(last.y, last.m, last.d), now);
}

/** 選んだ期間 → 範囲（開始を含み終了を含まない）。任意の誤りは集計しない理由の文言 */
export function periodRange(sel: PeriodSelection, now: number): PeriodRange {
  const today = ymdOf(now);
  const end = startOf(today.y, today.m, today.d + 1);
  let from: number;
  let to = end;
  switch (sel.key) {
    case '1d':
      from = startOf(today.y, today.m, today.d);
      break;
    case '7d':
      from = startOf(today.y, today.m, today.d - 6);
      break;
    case '1m':
      from = monthsBackNextDay(today, 1);
      break;
    case '3m':
      from = monthsBackNextDay(today, 3);
      break;
    case 'custom': {
      const a = parseYmd(sel.from);
      const b = parseYmd(sel.to);
      if (a === null || b === null) return { ok: false, error: PERIOD_ERROR.empty };
      const days = dayNumber(b) - dayNumber(a) + 1;
      if (days < 1) return { ok: false, error: PERIOD_ERROR.order };
      if (days > MAX_CUSTOM_DAYS) return { ok: false, error: PERIOD_ERROR.tooLong };
      from = startOf(a.y, a.m, a.d);
      to = startOf(b.y, b.m, b.d + 1);
      return { ok: true, from, to, label: labelOf(a, b, now), days };
    }
  }
  const first = ymdOf(from);
  return {
    ok: true,
    from,
    to,
    label: labelOf(first, today, now),
    days: dayNumber(today) - dayNumber(first) + 1,
  };
}

/** URL の検索部分 → 選んだ期間（知らない値は 7 日。任意の日付は形の合うものだけ残す） */
export function parsePeriod(search: string): PeriodSelection {
  const q = new URLSearchParams(search);
  const raw = q.get('period');
  const key = PERIOD_KEYS.find((k) => k === raw) ?? DEFAULT_PERIOD;
  const imports = q.get('imports') === '1';
  if (key !== 'custom') return { key, imports };
  const from = parseYmd(q.get('from'));
  const to = parseYmd(q.get('to'));
  return {
    key,
    ...(from === null ? {} : { from: ymdText(from) }),
    ...(to === null ? {} : { to: ymdText(to) }),
    imports,
  };
}

/** 選んだ期間 → URL の検索部分（「?period=…」。parsePeriod と往復で同じ） */
export function periodSearch(sel: PeriodSelection): string {
  const q = new URLSearchParams();
  q.set('period', sel.key);
  if (sel.key === 'custom') {
    if (sel.from) q.set('from', sel.from);
    if (sel.to) q.set('to', sel.to);
  }
  if (sel.imports) q.set('imports', '1');
  return `?${q.toString()}`;
}

/** 任意を選んだときの最初の日付（今の 7 日と同じ。すぐに集計できる） */
export function customDefaults(now: number): { readonly from: string; readonly to: string } {
  const t = ymdOf(now);
  return { from: ymdText(ymdOf(startOf(t.y, t.m, t.d - 6))), to: ymdText(t) };
}

/** 決済の時刻が範囲に入るか（開始を含み終了を含まない。API の範囲と同じ境目） */
export function inRange(time: number, range: { readonly from: number; readonly to: number }) {
  return time >= range.from && time < range.to;
}

/** 期間の操作（押した・日付を変えた・取り込みを切り替えた）→ 次の選択を go に渡す。go は URL を置き換える（履歴を積まない） */
export function periodActions(
  selection: PeriodSelection,
  now: () => number,
  go: (next: PeriodSelection) => void,
): {
  readonly onKey: (key: PeriodKey) => void;
  readonly onDates: (from: string, to: string) => void;
  readonly onImports: (include: boolean) => void;
} {
  return {
    onKey: (key) => {
      if (key === selection.key) return;
      go(
        key === 'custom'
          ? { key, ...customDefaults(now()), imports: selection.imports }
          : { key, imports: selection.imports },
      );
    },
    onDates: (a, b) =>
      go({
        key: 'custom',
        ...(a ? { from: a } : {}),
        ...(b ? { to: b } : {}),
        imports: selection.imports,
      }),
    onImports: (include) => go({ ...selection, imports: include }),
  };
}

/** 振り返りのタブの上のセグメント（規律 / 気づき。#162・設計書 9.2）。期間は 2 つで共通 */
export type ReviewViewKey = 'discipline' | 'insight';
export const REVIEW_VIEW_LABEL: Readonly<Record<ReviewViewKey, string>> = {
  discipline: '規律',
  insight: '気づき',
};

/** URL の検索部分 → セグメント（`&view=insight` のときだけ気づき。ほかは規律） */
export function parseReviewView(search: string): ReviewViewKey {
  return new URLSearchParams(search).get('view') === 'insight' ? 'insight' : 'discipline';
}

/** 選択 → 振り返りのタブの URL（パス + 検索部分）。気づきは末尾に `&view=insight`（規律は鍵なし = 今までの URL） */
export function reviewHref(sel: PeriodSelection, view: ReviewViewKey = 'discipline'): string {
  return `/review${periodSearch(sel)}${view === 'insight' ? '&view=insight' : ''}`;
}

/** 選択 → 「数で見る」（振り返りの次の画面。#128）の URL。振り返りのタブと同じ検索部分 */
export function reviewTableHref(sel: PeriodSelection): string {
  return `/review/table${periodSearch(sel)}`;
}

/**
 * 今月（今月 1 日〜今日。取り込みを外す）の期間（#128。ホームの今月の規律。設計書 9.2・ui-guidelines 9.4）。期間の選択肢に
 * 「今月」は無いので、振り返りのタブでは指定の期間として開く（`/review?period=custom&from=<1 日>&to=<今日>`）
 */
export function monthSelection(now: number): PeriodSelection {
  const t = ymdOf(now);
  return { key: 'custom', from: ymdText({ y: t.y, m: t.m, d: 1 }), to: ymdText(t), imports: false };
}
