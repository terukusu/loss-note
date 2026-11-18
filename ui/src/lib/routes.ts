// 画面の URL と行き来の純関数（Issue #3 R4・契約 C-5。ADR-0002）。DOM・history を触らない
import type { IconName } from '../components/Icon';
import { APP_NAME } from './app-name';

export type Route =
  | { readonly name: 'login' }
  | { readonly name: 'home' }
  | { readonly name: 'record' }
  | { readonly name: 'trades' }
  | { readonly name: 'trade'; readonly id: string }
  | { readonly name: 'tradeEdit'; readonly id: string }
  | { readonly name: 'settings' }
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
  '/settings': { name: 'settings' },
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
    case 'trade':
      return `/trades/${route.id}`;
    case 'tradeEdit':
      return `/trades/${route.id}/edit`;
    case 'settings':
      return '/settings';
    case 'parts':
      return '/dev/parts';
  }
}

const NAMES: Readonly<Record<RouteName, string>> = {
  login: 'ログイン',
  home: 'ホーム',
  record: '記録する',
  trades: '取引の一覧',
  trade: '取引の詳細',
  tradeEdit: '取引を編集',
  settings: '設定',
  // 開発の時だけの画面。名前の文字列を本番のビルドに残さないため、見出しは画面の側に持つ
  parts: '開発用',
};

/** document.title（読み上げ・タブ・履歴の一覧に出る） */
export function titleOf(route: Route): string {
  return `${NAMES[route.name]} — ${APP_NAME}`;
}

export interface NavItem {
  readonly route: Route;
  readonly label: string;
  readonly icon: IconName;
  /** 今いる画面の印を付ける画面（詳細・直すは一覧の印） */
  readonly current: readonly RouteName[];
}

/** どの画面からも 1 タップで行ける 4 つ（V6） */
export const NAV_ITEMS: readonly NavItem[] = [
  { route: { name: 'home' }, label: 'ホーム', icon: 'home', current: ['home'] },
  { route: { name: 'record' }, label: '記録する', icon: 'record', current: ['record'] },
  {
    route: { name: 'trades' },
    label: '一覧',
    icon: 'list',
    current: ['trades', 'trade', 'tradeEdit'],
  },
  { route: { name: 'settings' }, label: '設定', icon: 'settings', current: ['settings'] },
];

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
