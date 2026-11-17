// C-5 画面の行き来（Issue #3 の例の表 V1〜V6・R4）。履歴は偽物を差して window を使わない
import { describe, expect, it } from 'vitest';
import { Shell } from '../../ui/src/layout/Shell';
import { createNavigator, type NavEnv } from '../../ui/src/lib/router';
import {
  hrefOf,
  NAV_ITEMS,
  parseRoute,
  type Route,
  resolveNavigation,
  safeNext,
  shouldInterceptClick,
  titleOf,
} from '../../ui/src/lib/routes';
import { TradeDetail } from '../../ui/src/pages/TradeDetail';

/** ブラウザの履歴の偽物（項目の列と今の位置。戻るで popstate を出す） */
class FakeBrowser implements NavEnv {
  entries: string[];
  index = 0;
  private listeners = new Set<() => void>();
  constructor(first: string) {
    this.entries = [first];
  }
  get url(): string {
    return this.entries[this.index] ?? '';
  }
  location() {
    const u = new URL(this.url, 'http://localhost');
    return { pathname: u.pathname, search: u.search };
  }
  pushState(url: string) {
    this.entries = [...this.entries.slice(0, this.index + 1), url];
    this.index = this.entries.length - 1;
  }
  replaceState(url: string) {
    this.entries[this.index] = url;
  }
  onPopState(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** 利用者がアドレス欄に打って開く（新しい項目が積まれ、ページが読み直される） */
  open(url: string) {
    this.pushState(url);
  }
  back() {
    if (this.index === 0) return;
    this.index--;
    for (const fn of this.listeners) fn();
  }
  forward() {
    if (this.index >= this.entries.length - 1) return;
    this.index++;
    for (const fn of this.listeners) fn();
  }
}

const PROD = { dev: false };
const DEV = { dev: true };

describe('parseRoute / hrefOf', () => {
  it.each([
    ['/login', { name: 'login' }],
    ['/', { name: 'home' }],
    ['/record', { name: 'record' }],
    ['/trades', { name: 'trades' }],
    ['/trades/abc_DEF-123', { name: 'trade', id: 'abc_DEF-123' }],
    ['/settings', { name: 'settings' }],
    ['/trades/', { name: 'trades' }],
  ] as const)('%s → %j', (path, route) => {
    expect(parseRoute(path, PROD)).toEqual(route);
  });

  it.each([
    '/nope',
    '/trades/a/b',
    '/trades/a.b',
    `/trades/${'x'.repeat(65)}`,
    '//evil.example',
    '',
    'trades',
    '/dev/parts',
  ])('知らない URL: %s → null', (path) => {
    expect(parseRoute(path, PROD)).toBeNull();
  });

  it('部品の見本は開発の時だけ', () => {
    expect(parseRoute('/dev/parts', DEV)).toEqual({ name: 'parts' });
    expect(parseRoute('/dev/parts', PROD)).toBeNull();
  });

  it('hrefOf は parseRoute の逆', () => {
    const routes: Route[] = [
      { name: 'login' },
      { name: 'home' },
      { name: 'record' },
      { name: 'trades' },
      { name: 'trade', id: 't-1' },
      { name: 'settings' },
      { name: 'parts' },
    ];
    for (const r of routes) expect(parseRoute(hrefOf(r), DEV)).toEqual(r);
  });

  it('画面の名前（document.title）は「<名前> — loss-note」', () => {
    expect(titleOf({ name: 'trades' })).toBe('取引の一覧 — loss-note');
    expect(titleOf({ name: 'trade', id: 'x' })).toBe('取引の詳細 — loss-note');
  });
});

describe('safeNext（ログイン後の戻り先。自分の画面だけ）', () => {
  it.each([
    ['/trades', { name: 'trades' }],
    ['/trades/abc', { name: 'trade', id: 'abc' }],
    ['/record?x=1#y', { name: 'record' }],
    [null, { name: 'home' }],
    ['', { name: 'home' }],
    ['https://evil.example/', { name: 'home' }],
    ['//evil.example', { name: 'home' }],
    ['/\\evil.example', { name: 'home' }],
    ['javascript:alert(1)', { name: 'home' }],
    ['/login', { name: 'home' }],
    ['/login?next=/trades', { name: 'home' }],
    ['/nope', { name: 'home' }],
    ['/dev/parts', { name: 'home' }],
  ] as const)('%s → %j', (raw, route) => {
    expect(safeNext(raw, PROD)).toEqual(route);
  });
});

describe('resolveNavigation', () => {
  it('知らない URL はホームへ置き換える', () => {
    expect(resolveNavigation('/nope', PROD)).toEqual({ route: { name: 'home' }, replace: '/' });
  });
  it('知っている URL はそのまま', () => {
    expect(resolveNavigation('/trades', PROD)).toEqual({ route: { name: 'trades' } });
  });
});

describe('shouldInterceptClick（左クリックだけを横取りする）', () => {
  const base = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  it('修飾キーなしの左クリック → 横取りする', () => {
    expect(shouldInterceptClick(base)).toBe(true);
  });
  it.each([
    ['中クリック', { button: 1 }],
    ['Ctrl', { ctrlKey: true }],
    ['⌘', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['すでに止められた', { defaultPrevented: true }],
  ])('%s → ブラウザに任せる', (_name, patch) => {
    expect(shouldInterceptClick({ ...base, ...patch })).toBe(false);
  });
});

describe('画面の行き来（例の表 V1〜V6）', () => {
  it('V1: ホームで [記録する] を押す → 記録する画面。URL が変わる', () => {
    const b = new FakeBrowser('/');
    const nav = createNavigator(b, PROD);
    expect(nav.current.route).toEqual({ name: 'home' });
    let notified = 0;
    nav.subscribe(() => notified++);
    nav.push('/record');
    expect(nav.current.route).toEqual({ name: 'record' });
    expect(b.url).toBe('/record');
    expect(b.entries).toEqual(['/', '/record']);
    expect(notified).toBe(1);
    // 進んだ = 先頭へスクロールする行き来
    expect(nav.current.via).toBe('push');
  });

  it('V2: V1 の後にブラウザの戻る → ホーム（進むで記録するへ）', () => {
    const b = new FakeBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.push('/record');
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
    expect(b.url).toBe('/');
    // 戻る・進む = スクロールの位置はブラウザが戻す（アプリは先頭へ動かさない）
    expect(nav.current.via).toBe('pop');
    b.forward();
    expect(nav.current.route).toEqual({ name: 'record' });
    expect(nav.current.via).toBe('pop');
  });

  it('V3: 一覧の URL を直接開く・再読み込みする → 一覧', () => {
    const b = new FakeBrowser('/trades');
    expect(createNavigator(b, PROD).current.route).toEqual({ name: 'trades' });
    expect(createNavigator(b, PROD).current.via).toBe('init');
    // 再読み込み = 同じ URL で作り直す
    expect(createNavigator(b, PROD).current.route).toEqual({ name: 'trades' });
    expect(b.entries).toEqual(['/trades']);
  });

  it('V4: 詳細の URL を無い取引の ID で開く → 詳細の画面に「この取引は見つかりません」と一覧へのリンク', () => {
    const b = new FakeBrowser('/trades/no-such-trade');
    const nav = createNavigator(b, PROD);
    expect(nav.current.route).toEqual({ name: 'trade', id: 'no-such-trade' });
    const tree = JSON.stringify(TradeDetail({ id: 'no-such-trade' }));
    expect(tree).toContain('この取引は見つかりません');
    expect(tree).toContain('"href":"/trades"');
  });

  it('V5: 知らない URL を開く → ホーム。URL もホームに置き換わり、戻るで知らない URL に戻らない', () => {
    const b = new FakeBrowser('/trades');
    b.open('/no-such-page');
    const nav = createNavigator(b, PROD);
    expect(nav.current.route).toEqual({ name: 'home' });
    expect(b.url).toBe('/');
    expect(b.entries).not.toContain('/no-such-page');
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
    // 画面の中から知らない URL へ押しても同じ（積まずに置き換える）
    nav.push('/also-unknown');
    expect(b.entries).not.toContain('/also-unknown');
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('V6: ログイン以外のどの画面にも、ホーム・記録する・一覧・設定の 4 つの行き先がある', () => {
    expect(NAV_ITEMS.map((i) => hrefOf(i.route))).toEqual(['/', '/record', '/trades', '/settings']);
    const routes: Route[] = [
      { name: 'home' },
      { name: 'record' },
      { name: 'trades' },
      { name: 'trade', id: 'x' },
      { name: 'settings' },
      { name: 'parts' },
    ];
    for (const route of routes) {
      const tree = JSON.stringify(Shell({ route, children: null }));
      for (const href of ['/', '/record', '/trades', '/settings']) {
        expect(tree, `${route.name} に ${href}`).toContain(`"href":"${href}"`);
      }
    }
    // 今いる画面の印（詳細は一覧の印）
    const trade = JSON.stringify(Shell({ route: { name: 'trade', id: 'x' }, children: null }));
    expect(trade).toMatch(
      /"href":"\/trades"[^}]*"aria-current":"page"|"aria-current":"page"[^}]*"href":"\/trades"/,
    );
  });

  it('ログイン画面にはナビを出さない', () => {
    const tree = JSON.stringify(Shell({ route: { name: 'login' }, children: null }));
    expect(tree).not.toContain('"href":"/settings"');
  });

  it('購読をやめると知らせない', () => {
    const b = new FakeBrowser('/');
    const nav = createNavigator(b, PROD);
    let n = 0;
    const off = nav.subscribe(() => n++);
    off();
    nav.push('/trades');
    expect(n).toBe(0);
    nav.dispose();
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
  });
});

describe('直すの URL（Issue #9。/trades/<id>/edit）', () => {
  it('直すの URL を開く・戻り先にする・名前', () => {
    expect(parseRoute('/trades/abc_DEF-123/edit', PROD)).toEqual({
      name: 'tradeEdit',
      id: 'abc_DEF-123',
    });
    expect(parseRoute('/trades/abc/edit/', PROD)).toEqual({ name: 'tradeEdit', id: 'abc' });
    expect(hrefOf({ name: 'tradeEdit', id: 't-1' })).toBe('/trades/t-1/edit');
    expect(parseRoute(hrefOf({ name: 'tradeEdit', id: 't-1' }), PROD)).toEqual({
      name: 'tradeEdit',
      id: 't-1',
    });
    expect(safeNext('/trades/abc/edit', PROD)).toEqual({ name: 'tradeEdit', id: 'abc' });
    expect(titleOf({ name: 'tradeEdit', id: 'x' })).toBe('取引を直す — loss-note');
  });

  it.each([
    '/trades/a.b/edit',
    '/trades/a/edit/x',
    '/trades/a/editx',
    `/trades/${'x'.repeat(65)}/edit`,
  ])('知らない URL: %s → null', (path) => {
    expect(parseRoute(path, PROD)).toBeNull();
  });

  it('直すの画面でも 4 つの行き先があり、一覧の印', () => {
    const tree = JSON.stringify(Shell({ route: { name: 'tradeEdit', id: 'x' }, children: null }));
    for (const href of ['/', '/record', '/trades', '/settings']) {
      expect(tree).toContain(`"href":"${href}"`);
    }
    expect(tree).toMatch(
      /"href":"\/trades"[^}]*"aria-current":"page"|"aria-current":"page"[^}]*"href":"\/trades"/,
    );
  });
});
