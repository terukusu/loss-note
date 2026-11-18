// 画面の行き来の薄い層（History API。契約 C-5・ADR-0002）。履歴は NavEnv で差し替えられる
// （テストは偽物、main.tsx だけが実物の window を渡す）
import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import {
  type Resolved,
  type RouteOptions,
  resolveNavigation,
  shouldInterceptClick,
} from './routes';

/** ブラウザの履歴の最小限 */
export interface NavEnv {
  location(): { readonly pathname: string; readonly search: string };
  pushState(url: string): void;
  replaceState(url: string): void;
  /** 戻る・進む（popstate）の購読。やめる関数を返す */
  onPopState(fn: () => void): () => void;
}

/** 今の画面に着いた経路（init = 開いた・再読み込み、push = アプリの中で進んだ、replace = 置き換え、pop = 戻る / 進む） */
export type NavVia = 'init' | 'push' | 'replace' | 'pop';

export interface Navigator {
  readonly current: Resolved & { readonly search: string; readonly via: NavVia };
  push(href: string): void;
  replace(href: string): void;
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

export function windowEnv(win: Window): NavEnv {
  return {
    location: () => ({ pathname: win.location.pathname, search: win.location.search }),
    pushState: (url) => win.history.pushState(null, '', url),
    replaceState: (url) => win.history.replaceState(null, '', url),
    onPopState: (fn) => {
      win.addEventListener('popstate', fn);
      return () => win.removeEventListener('popstate', fn);
    },
  };
}

/** 画面の行き来に添える知らせ（#57: 開いて閉じる層の記録を捨てる。back-layers.ts の reset） */
export interface NavHooks {
  /**
   * 画面が移る（push・replace は履歴を書く前、ほかの URL への戻る / 進むは着いた後）。URL の変わらない戻る（層の段）では
   * 呼ばない。push の前に呼ぶのは、層の記録を捨てて今の項目のスクロールの復元を auto に戻してから次の項目を積むため
   */
  readonly onNavigate?: () => void;
  /**
   * replace の前: 開いて閉じる層の段が積まれていれば巻き戻し、元の項目に着いてから done を呼ぶ（true）。段が無ければ false
   * （すぐ置き換える）。back-layers.ts の unwind（#57 再レビュー B3）
   */
  readonly unwind?: (done: () => void) => boolean;
}

export function createNavigator(env: NavEnv, opts: RouteOptions, hooks: NavHooks = {}): Navigator {
  const listeners = new Set<() => void>();
  let current: Navigator['current'] = { route: { name: 'home' }, search: '', via: 'init' };
  /** 今の画面の URL（パス + 検索）。URL の変わらない popstate（層の段の出入り）を見分ける */
  let at = '';
  const here = () => {
    const loc = env.location();
    return `${loc.pathname}${loc.search}`;
  };

  /** 今の URL から画面を決める。知らない URL は履歴を置き換えてホーム */
  const sync = (via: NavVia) => {
    const loc = env.location();
    const r = resolveNavigation(loc.pathname, opts);
    if (r.replace !== undefined) {
      env.replaceState(r.replace);
      current = { route: r.route, search: '', via };
    } else {
      current = { route: r.route, search: loc.search, via };
    }
    at = here();
  };
  const notify = () => {
    for (const fn of listeners) fn();
  };

  sync('init');
  const off = env.onPopState(() => {
    // 開いて閉じる層（「i」の吹き出し）の段の出入りは URL が変わらない: 画面を変えない（戻るで層だけを閉じる。#57）
    if (here() === at) return;
    sync('pop');
    hooks.onNavigate?.();
    notify();
  });

  return {
    get current() {
      return current;
    },
    push(href) {
      const path = href.split(/[?#]/)[0] ?? '';
      const r = resolveNavigation(path, opts);
      // 知らない画面へは積まずに置き換える（戻るで知らない URL に戻らない）
      hooks.onNavigate?.();
      if (r.replace !== undefined) env.replaceState(r.replace);
      else env.pushState(href);
      sync('push');
      notify();
    },
    replace(href) {
      const run = () => {
        hooks.onNavigate?.();
        env.replaceState(href);
        sync('replace');
        notify();
      };
      // 層の段が積まれていれば、巻き戻してから置き換える（段の項目だけが置き換わり元の画面が残らないように）
      if (hooks.unwind?.(run)) return;
      run();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      off();
      listeners.clear();
    },
  };
}

export const NavigatorContext = createContext<Navigator | null>(null);

/** 今の画面（URL が変わると描き直す） */
export function useCurrent(nav: Navigator): Navigator['current'] {
  const [cur, setCur] = useState(nav.current);
  useEffect(() => nav.subscribe(() => setCur(nav.current)), [nav]);
  return cur;
}

type AnchorProps = JSX.HTMLAttributes<HTMLAnchorElement> & { href: string };

/** アプリの中のリンク。左クリックだけを横取りして push し、新しいタブ等はブラウザに任せる */
export function Link({ href, onClick, ...rest }: AnchorProps) {
  const nav = useContext(NavigatorContext);
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (typeof onClick === 'function') onClick(e);
        if (!nav || !shouldInterceptClick(e)) return;
        e.preventDefault();
        nav.push(href);
      }}
    />
  );
}
