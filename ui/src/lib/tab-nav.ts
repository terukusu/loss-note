// タブごとの積み重ねと戻るの規則（#127。docs/ui-guidelines.md 9.7・ADR-0021 の決定 3・ADR-0019 の追記）。純関数
// （DOM・history・時刻に触らない）。糊は router.tsx の createNavigator で、ここが返す計画（戻る数・置き換え・積み直し）を
// 実物の history で行う。
// - 履歴はいつも「ホーム（`/`）+ 今のタブの根（ホーム以外）+ 今のタブで開いた次の画面」の形。全画面のシート（記録する・編集）は
//   その上に 1 段（どのタブの記憶にも残さない）。層（「i」など）は back-stack.ts がさらに上に積む
// - 各項目の history.state に印（深さ・タブ・ホームからの並び）を持つ。印の無い最初の起動だけ並びを組み直す
// - タブを替えると、今のタブの並び（シートを除く）とスクロールの位置を記憶に残し、根の段まで戻して次のタブの記憶を積み直す
import {
  isSheetRoute,
  parseRoute,
  type RouteOptions,
  type Tab,
  tabOfRoute,
  tabRoot,
} from './routes';

/** history.state に持つ印（ホームの段からの並び。depth = stack.length − 1） */
export interface NavMark {
  /** アプリの中の深さ（ホームの段 = 0。#75 の「前の画面」の appDepth） */
  readonly depth: number;
  /** この項目のタブ（進んだ元のタブ。全画面のシートは開いたときのタブ） */
  readonly tab: Tab;
  /** ホームの段からこの項目までの URL（パス + 検索） */
  readonly stack: readonly string[];
}

/** history.state の鍵（back-layers.ts は state を写して層の段を積むので、層の段にも残る） */
export const MARK_KEYS = { depth: 'appDepth', tab: 'appTab', stack: 'appStack' } as const;

const TABS: readonly Tab[] = ['home', 'trades', 'review', 'settings'];
const MAX_STACK = 64;

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] ?? '';
}

function isSheetHref(href: string, opts: RouteOptions): boolean {
  const r = parseRoute(pathOf(href), opts);
  return r !== null && isSheetRoute(r);
}

/** 印を history.state の形に（ほかの鍵は呼ぶ側が残す） */
export function markState(mark: NavMark): Record<string, unknown> {
  return {
    [MARK_KEYS.depth]: mark.depth,
    [MARK_KEYS.tab]: mark.tab,
    [MARK_KEYS.stack]: [...mark.stack],
  };
}

/**
 * history.state から印を読む。印が無い（新しく開いた・外から来た）・壊れた値は null。深さだけの古い印（#127 の前の版）は、
 * URL からタブと並びを補う（再読み込みで組み直さない）
 */
export function readMark(state: unknown, href: string, opts: RouteOptions): NavMark | null {
  if (typeof state !== 'object' || state === null) return null;
  const s = state as Record<string, unknown>;
  const depth = s[MARK_KEYS.depth];
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  const tab = s[MARK_KEYS.tab];
  const stack = s[MARK_KEYS.stack];
  if (
    typeof tab === 'string' &&
    (TABS as readonly string[]).includes(tab) &&
    Array.isArray(stack) &&
    stack.length === depth + 1 &&
    stack.length <= MAX_STACK &&
    stack.every((h) => typeof h === 'string' && h.startsWith('/') && !h.startsWith('//'))
  ) {
    return { depth, tab: tab as Tab, stack: stack as string[] };
  }
  const route = parseRoute(pathOf(href), opts);
  // 深さだけの古い印: URL から組み直した並びで補い、深さ = 段の数 − 1 を保つ（足りない下の段はホーム）
  const boot = bootStack(href, opts);
  const filled =
    boot.length >= depth + 1
      ? boot.slice(boot.length - (depth + 1))
      : [...new Array<string>(depth + 1 - boot.length).fill('/'), ...boot];
  return { depth, tab: route ? tabOfRoute(route) : 'home', stack: filled };
}

/**
 * 印の無い最初の起動で組み直す並び（9.7 の 5）。`/trades/a` → `[/, /trades, /trades/a]`、`/trades/a/edit` →
 * `[/, /trades, /trades/a, /trades/a/edit]`、`/record` → `[/, /record]`、`/glossary` → `[/, /settings, /glossary]`。
 * ホーム・ログイン・知らない URL は組み直さない（`[href]`）
 */
export function bootStack(href: string, opts: RouteOptions): string[] {
  const route = parseRoute(pathOf(href), opts);
  if (!route || route.name === 'login' || route.name === 'home') return [href];
  switch (route.name) {
    case 'trade':
      return ['/', '/trades', href];
    case 'tradeEdit':
      return ['/', '/trades', `/trades/${route.id}`, href];
    case 'glossary':
      return ['/', '/settings', href];
    default:
      return ['/', href];
  }
}

/** 組み直した並びの各項目の印（タブは URL で決める。ホームの段だけはホームのタブ） */
export function bootMarks(href: string, opts: RouteOptions): { href: string; mark: NavMark }[] {
  const stack = bootStack(href, opts);
  const route = parseRoute(pathOf(href), opts);
  const tab: Tab = route ? tabOfRoute(route) : 'home';
  return stack.map((h, i) => ({
    href: h,
    mark: {
      depth: i,
      tab: i === 0 && stack.length > 1 ? 'home' : tab,
      stack: stack.slice(0, i + 1),
    },
  }));
}

/**
 * 同じ画面の中で 1 段積む（用語集の中で言葉をたどる = URL の #… だけが変わる）ときの history.state。印の深さを 1 つ進め、
 * ほかの鍵（たどった数など）は残す（#127 のレビュー B1: 深さに数えないと、タブの切り替え・押し直しの戻る段が足りなくなる）
 */
export function inPageStepState(
  state: unknown,
  here: string,
  next: string,
  opts: RouteOptions,
): Record<string, unknown> {
  const base =
    typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  const route = parseRoute(pathOf(here), opts);
  const cur = readMark(state, here, opts) ?? {
    depth: 0,
    tab: route ? tabOfRoute(route) : 'home',
    stack: [here],
  };
  return { ...base, ...markState(pushMark(cur, next)) };
}

/** 進んだ画面の印（今のタブのまま 1 段深く） */
export function pushMark(cur: NavMark, href: string): NavMark {
  return { depth: cur.depth + 1, tab: cur.tab, stack: [...cur.stack, href] };
}

/** 置き換えた画面の印（深さ・タブはそのまま） */
export function replaceMark(cur: NavMark, href: string): NavMark {
  return { depth: cur.depth, tab: cur.tab, stack: [...cur.stack.slice(0, -1), href] };
}

/** タブの記憶（その画面の積み重ね。根から順。全画面のシートを除く。scrolls は各段のスクロールの位置） */
export interface TabMemory {
  readonly hrefs: readonly string[];
  readonly scrolls: readonly number[];
}

/**
 * 今の並びをタブの記憶にする: ホーム以外のタブはホームの段を除き、全画面のシートを除く。scrolls[i] は stack[i] の位置
 * （無ければ 0）
 */
export function memoryOf(mark: NavMark, scrolls: readonly number[], opts: RouteOptions): TabMemory {
  const hrefs: string[] = [];
  const ys: number[] = [];
  mark.stack.forEach((h, i) => {
    if (i === 0 && mark.tab !== 'home' && mark.stack.length > 1) return;
    if (isSheetHref(h, opts)) return;
    // ページの中でたどった段（用語集の #…）は、同じ画面の 1 段にまとめる（積み直すのは画面の段だけ）
    const prev = hrefs.at(-1);
    if (prev !== undefined && prev.split('#')[0] === h.split('#')[0]) return;
    hrefs.push(h);
    ys.push(scrolls[i] ?? 0);
  });
  if (hrefs.length === 0) return { hrefs: [tabRoot(mark.tab)], scrolls: [0] };
  return { hrefs, scrolls: ys };
}

/** 履歴の操作の計画（go で戻ってから、replace で今の段を置き換え、push を順に積む） */
export interface NavPlan {
  /** 戻る数（0 以下。0 なら戻らない） */
  readonly go: number;
  readonly replace: { readonly href: string; readonly mark: NavMark } | null;
  readonly push: readonly { readonly href: string; readonly mark: NavMark }[];
  /** 着いた画面（いちばん上）の印とスクロールの位置 */
  readonly top: NavMark;
  readonly scroll: number;
}

/**
 * タブを替える（A → B。9.7 の 2）: ホームの段まで戻し、B の根と記憶を積み直す（B がホームなら、ホームの段の上に記憶を積む）。
 * memory は B の記憶（無ければ根だけ）
 */
export function planTabSwitch(cur: NavMark, target: Tab, memory: TabMemory | null): NavPlan {
  const mem: TabMemory =
    memory && memory.hrefs.length > 0 ? memory : { hrefs: [tabRoot(target)], scrolls: [0] };
  const base = cur.stack[0] ?? '/';
  if (target === 'home') {
    // ホームの記憶はホームの段から（mem.hrefs[0] はホームの URL。期間の検索部分を含むことがある）
    const first = mem.hrefs[0] ?? '/';
    const marks = mem.hrefs.map((h, i) => ({
      href: h,
      mark: { depth: i, tab: 'home' as Tab, stack: mem.hrefs.slice(0, i + 1) },
    }));
    const top = marks.at(-1)?.mark ?? { depth: 0, tab: 'home', stack: [first] };
    return {
      go: -cur.depth,
      replace: base === first ? null : (marks[0] ?? null),
      push: marks.slice(1),
      top,
      scroll: mem.scrolls.at(-1) ?? 0,
    };
  }
  const stack = [base, ...mem.hrefs];
  const marks = mem.hrefs.map((h, i) => ({
    href: h,
    mark: { depth: i + 1, tab: target, stack: stack.slice(0, i + 2) },
  }));
  const top = marks.at(-1)?.mark ?? { depth: 1, tab: target, stack: stack.slice(0, 2) };
  // ホームの段まで戻してから根を積む（置き換えでなく積むので、前のタブの「進む」側の段が残らない）
  return { go: -cur.depth, replace: null, push: marks, top, scroll: mem.scrolls.at(-1) ?? 0 };
}

/**
 * 同じタブをもう一度押す（9.7 の 3）: 次の画面（またはシート）を開いていれば根へ戻る（記憶を捨てる）。根にいれば 'top'
 * （先頭へ送って裏で読み直す）
 */
export function planRetap(cur: NavMark): { readonly go: number } | 'top' {
  const rootDepth = cur.tab === 'home' ? 0 : 1;
  if (cur.depth > rootDepth && cur.stack.length > rootDepth) return { go: rootDepth - cur.depth };
  return 'top';
}
