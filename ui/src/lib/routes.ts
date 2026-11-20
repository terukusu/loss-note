// 画面の URL と行き来の純関数（Issue #3 R4・契約 C-5。ADR-0002）。DOM・history を触らない
import type { IconName } from '../components/Icon';
import { APP_NAME } from './app-name';

export type Route =
  | { readonly name: 'login' }
  | { readonly name: 'home' }
  | { readonly name: 'record' }
  | { readonly name: 'trades' }
  | { readonly name: 'review' }
  /** 振り返りの次の画面「数で見る」（#128。ui-guidelines 9.3・9.11） */
  | { readonly name: 'reviewTable' }
  | { readonly name: 'trade'; readonly id: string }
  | { readonly name: 'tradeEdit'; readonly id: string }
  | { readonly name: 'settings' }
  /** 設定の次の画面（#133。ui-guidelines 9.3・9.7）: 口座・銘柄・AI の利用状況 */
  | { readonly name: 'settingsAccounts' }
  | { readonly name: 'settingsInstruments' }
  | { readonly name: 'settingsAiUsage' }
  | { readonly name: 'glossary' }
  | { readonly name: 'parts' };

export type RouteName = Route['name'];

export interface RouteOptions {
  /** 開発の時だけの画面（部品の見本）を経路に入れるか */
  readonly dev: boolean;
}

/** 取引の ID の形（外れたら知らない URL） */
const TRADE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const FIXED: Readonly<Record<string, Route>> = {
  '/login': { name: 'login' },
  '/': { name: 'home' },
  '/record': { name: 'record' },
  '/trades': { name: 'trades' },
  '/review': { name: 'review' },
  '/review/table': { name: 'reviewTable' },
  '/settings': { name: 'settings' },
  '/settings/accounts': { name: 'settingsAccounts' },
  '/settings/instruments': { name: 'settingsInstruments' },
  '/settings/ai-usage': { name: 'settingsAiUsage' },
  '/glossary': { name: 'glossary' },
};

/** パス（クエリ・ハッシュを含まない）から画面を引く。知らない URL は null */
export function parseRoute(pathname: string, opts: RouteOptions): Route | null {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return null;
  // 末尾の / は 1 つだけ外す（/trades/ → /trades）。ルートの / はそのまま
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const fixed = FIXED[path];
  if (fixed) return fixed;
  if (path === '/dev/parts') return opts.dev ? { name: 'parts' } : null;
  const m = /^\/trades\/([^/]+)$/.exec(path);
  if (m && TRADE_ID.test(m[1] ?? '')) return { name: 'trade', id: m[1] ?? '' };
  // 直す（Issue #9。URL を持つ = 再読み込みで同じ取引の直しが開く。P6）
  const e = /^\/trades\/([^/]+)\/edit$/.exec(path);
  if (e && TRADE_ID.test(e[1] ?? '')) return { name: 'tradeEdit', id: e[1] ?? '' };
  return null;
}

export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'login':
      return '/login';
    case 'home':
      return '/';
    case 'record':
      return '/record';
    case 'trades':
      return '/trades';
    case 'review':
      return '/review';
    case 'reviewTable':
      return '/review/table';
    case 'trade':
      return `/trades/${route.id}`;
    case 'tradeEdit':
      return `/trades/${route.id}/edit`;
    case 'settings':
      return '/settings';
    case 'settingsAccounts':
      return '/settings/accounts';
    case 'settingsInstruments':
      return '/settings/instruments';
    case 'settingsAiUsage':
      return '/settings/ai-usage';
    case 'glossary':
      return '/glossary';
    case 'parts':
      return '/dev/parts';
  }
}

const NAMES: Readonly<Record<RouteName, string>> = {
  login: 'ログイン',
  home: 'ホーム',
  record: '記録する',
  trades: '取引',
  review: '振り返り',
  reviewTable: '数で見る',
  trade: '取引の詳細',
  tradeEdit: '取引を編集',
  settings: '設定',
  settingsAccounts: '口座',
  settingsInstruments: '銘柄',
  settingsAiUsage: 'AI の利用状況',
  glossary: '用語集',
  // 開発の時だけの画面。名前の文字列を本番のビルドに残さないため、見出しは画面の側に持つ
  parts: '開発用',
};

/**
 * 用語集の画面の「‹ 〈来た画面〉」（#57 デザインの再レビュー 3）。?from= の値が自分の画面（用語集・ログインを除く）なら、
 * その画面の名前。それ以外（無い・外の URL・知らない画面）は null（設定へのリンクにする）
 */
export function glossaryBack(
  search: string,
  opts: RouteOptions,
): { readonly label: string; readonly route: Route } | null {
  let from: string | null;
  try {
    from = new URLSearchParams(search).get('from');
  } catch {
    return null;
  }
  if (!from?.startsWith('/') || from.startsWith('//') || from.includes('\\')) return null;
  const route = parseRoute(from.split(/[?#]/)[0] ?? '', opts);
  if (!route || route.name === 'login' || route.name === 'glossary') return null;
  return { label: NAMES[route.name], route };
}

/** document.title（読み上げ・タブ・履歴の一覧に出る） */
export function titleOf(route: Route): string {
  return `${NAMES[route.name]} — ${APP_NAME}`;
}

/** 下のタブ（行き先。ui-guidelines 9.2・設計書 K16）。並びは ホーム・取引・（＋ 記録）・振り返り・設定 */
export type Tab = 'home' | 'trades' | 'review' | 'settings';

export interface TabItem {
  readonly tab: Tab;
  /** タブの根の URL */
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
}

/** 4 つのタブ（タブの根へ 1 タップ。V6） */
export const TAB_ITEMS: readonly TabItem[] = [
  { tab: 'home', href: '/', label: 'ホーム', icon: 'home' },
  { tab: 'trades', href: '/trades', label: '取引', icon: 'list' },
  { tab: 'review', href: '/review', label: '振り返り', icon: 'review' },
  { tab: 'settings', href: '/settings', label: '設定', icon: 'settings' },
];

/** 真ん中の ［＋ 記録］（行き先ではなく作業の入口。見える文字は「記録」、読み上げの名前は「記録する」。9.2） */
export const RECORD_ENTRY = { href: '/record', label: '記録', name: '記録する' } as const;

/** タブの根の URL */
export function tabRoot(tab: Tab): string {
  return tab === 'home' ? '/' : `/${tab}`;
}

/**
 * URL から決まるタブ（9.7 の 5: `/trades*` = 取引、`/review*` = 振り返り、`/settings*`（設定の下の画面も。#133）・`/glossary` = 設定、ほか = ホーム）。
 * 印の無い起動の組み直しにだけ使う（アプリの中で進んだ画面のタブは、進んだ元のタブのまま = history.state の印）
 */
export function tabOfRoute(route: Route): Tab {
  switch (route.name) {
    case 'trades':
    case 'trade':
    case 'tradeEdit':
      return 'trades';
    case 'review':
    case 'reviewTable':
      return 'review';
    case 'settings':
    case 'settingsAccounts':
    case 'settingsInstruments':
    case 'settingsAiUsage':
    case 'glossary':
      return 'settings';
    default:
      return 'home';
  }
}

/** タブの根の画面ならそのタブ（無ければ null） */
export function rootTabOf(route: Route): Tab | null {
  switch (route.name) {
    case 'home':
      return 'home';
    case 'trades':
      return 'trades';
    case 'review':
      return 'review';
    case 'settings':
      return 'settings';
    default:
      return null;
  }
}

/** 全画面のシート（作業）の画面か（記録する・編集。タブを隠し、どのタブの積み重ねにも残さない。9.3） */
export function isSheetRoute(route: Route): boolean {
  return route.name === 'record' || route.name === 'tradeEdit';
}

/** 画面の種類（殻の上の帯と余白の決め方。root = タブの根・push = 次の画面・sheet = 全画面のシート・bare = それ以外） */
export type ScreenKind = 'root' | 'push' | 'sheet' | 'bare';

export function screenKindOf(route: Route): ScreenKind {
  if (route.name === 'login' || route.name === 'parts') return 'bare';
  if (isSheetRoute(route)) return 'sheet';
  return rootTabOf(route) ? 'root' : 'push';
}

/** 「‹ 前の画面の名前」の名前（上の帯の戻るのボタン。知らない URL は null） */
export function screenLabel(href: string, opts: RouteOptions): string | null {
  const route = parseRoute(href.split(/[?#]/)[0] ?? '', opts);
  if (!route || route.name === 'login') return null;
  return NAMES[route.name];
}

export interface Resolved {
  readonly route: Route;
  /** 知らない URL のとき、履歴を置き換える先 */
  readonly replace?: string;
}

/** 開いた URL の行き先。知らない URL はホームへ置き換える（V5: 戻るで知らない URL に戻らない） */
export function resolveNavigation(pathname: string, opts: RouteOptions): Resolved {
  const route = parseRoute(pathname, opts);
  return route ? { route } : { route: { name: 'home' }, replace: '/' };
}

/**
 * ログイン後の戻り先（?next= の値）。自分の画面だけを通し、外の URL・//・\・javascript:・
 * ログイン画面そのもの・知らない画面はホーム（オープンリダイレクトを作らない）
 */
export function safeNext(raw: string | null | undefined, opts: RouteOptions): Route {
  const home: Route = { name: 'home' };
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return home;
  const path = raw.split(/[?#]/)[0] ?? '';
  const route = parseRoute(path, opts);
  if (!route || route.name === 'login') return home;
  return route;
}

export interface ClickLike {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
}

/** リンクの押下をアプリの行き来で横取りするか（修飾キー・中クリックは新しいタブなどブラウザに任せる） */
export function shouldInterceptClick(e: ClickLike): boolean {
  return (
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}
