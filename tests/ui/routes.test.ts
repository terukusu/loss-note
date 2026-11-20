// C-5 画面の行き来（Issue #3 の例の表 V1〜V6・R4）と、タブごとの積み重ねと戻る（Issue #127。ui-guidelines 9.7 の表）。
// 履歴は偽物を差して window を使わない
import { describe, expect, it } from 'vitest';
import { Shell } from '../../ui/src/layout/Shell';
import { createNavigator, depthOf, type NavEnv } from '../../ui/src/lib/router';
import {
  hrefOf,
  isSheetRoute,
  parseRoute,
  RECORD_ENTRY,
  type Route,
  resolveNavigation,
  safeNext,
  screenKindOf,
  screenLabel,
  shouldInterceptClick,
  TAB_ITEMS,
  tabOfRoute,
  titleOf,
} from '../../ui/src/lib/routes';
import {
  bootStack,
  inPageStepState,
  markState,
  memoryOf,
  type NavMark,
  planRetap,
  planTabSwitch,
  readMark,
} from '../../ui/src/lib/tab-nav';
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
    ['/review', { name: 'review' }],
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
      { name: 'review' },
      { name: 'trade', id: 't-1' },
      { name: 'settings' },
      { name: 'parts' },
    ];
    for (const r of routes) expect(parseRoute(hrefOf(r), DEV)).toEqual(r);
  });

  it('画面の名前（document.title）は「<名前> — 損失ノート」', () => {
    expect(titleOf({ name: 'trades' })).toBe('取引 — 損失ノート');
    expect(titleOf({ name: 'review' })).toBe('振り返り — 損失ノート');
    expect(titleOf({ name: 'trade', id: 'x' })).toBe('取引の詳細 — 損失ノート');
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

/**
 * history.state を項目ごとに持ち、go・戻る・進む・スクロールの位置をまねる偽物（#127）。新しく開いた項目の state は null
 * （印なし = 起動で並びを組み直す）。go は着いた後に popstate を 1 回出す（実物は非同期だが、順は同じ）
 */
class MarkBrowser implements NavEnv {
  entries: { url: string; state: unknown }[];
  index = 0;
  /** 今の窓のスクロールの位置 */
  y = 0;
  private listeners = new Set<() => void>();
  constructor(first: string, state: unknown = null) {
    this.entries = [{ url: first, state }];
  }
  get url(): string {
    return this.entries[this.index]?.url ?? '';
  }
  /** いちばん下から今の項目までの URL（「進む」側の段を除く = 戻るでたどる並び） */
  get stack(): string[] {
    return this.entries.slice(0, this.index + 1).map((e) => e.url);
  }
  location() {
    const u = new URL(this.url, 'http://localhost');
    return { pathname: u.pathname, search: u.search };
  }
  readState() {
    return this.entries[this.index]?.state ?? null;
  }
  pushState(url: string, mark?: NavMark) {
    this.entries = [
      ...this.entries.slice(0, this.index + 1),
      { url, state: mark ? markState(mark) : null },
    ];
    this.index = this.entries.length - 1;
  }
  replaceState(url: string, mark?: NavMark) {
    this.entries[this.index] = { url, state: mark ? markState(mark) : null };
  }
  onPopState(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  go(n: number) {
    const to = this.index + n;
    if (n === 0 || to < 0 || to >= this.entries.length) return;
    this.index = to;
    for (const fn of [...this.listeners]) fn();
  }
  back() {
    this.go(-1);
  }
  forward() {
    this.go(1);
  }
  scrollY() {
    return this.y;
  }
  /** ページの中のリンク（用語集の #…）: ページが自分で state を書いて積む。popstate は出さない */
  pushRaw(url: string, state: unknown) {
    this.entries = [...this.entries.slice(0, this.index + 1), { url, state }];
    this.index = this.entries.length - 1;
  }
}

describe('画面の行き来（例の表 V1〜V6）', () => {
  it('V1: ホームで ［＋ 記録］ を押す → 記録する画面。URL が変わる', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    expect(nav.current.route).toEqual({ name: 'home' });
    let notified = 0;
    nav.subscribe(() => notified++);
    nav.push(RECORD_ENTRY.href);
    expect(nav.current.route).toEqual({ name: 'record' });
    expect(b.stack).toEqual(['/', '/record']);
    expect(notified).toBe(1);
    // 進んだ = 先頭へスクロールする行き来
    expect(nav.current.via).toBe('push');
  });

  it('V2: V1 の後にブラウザの戻る → ホーム（進むで記録するへ）', () => {
    const b = new MarkBrowser('/');
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

  it('V3: 一覧の URL を直接開く → 一覧（下にホームを敷く）。再読み込みでは組み直さない', () => {
    const b = new MarkBrowser('/trades');
    const nav = createNavigator(b, PROD);
    expect(nav.current.route).toEqual({ name: 'trades' });
    expect(nav.current.via).toBe('init');
    expect(b.stack).toEqual(['/', '/trades']);
    // 再読み込み = 同じ並びのまま作り直す（印がある）
    const again = createNavigator(b, PROD);
    expect(again.current.route).toEqual({ name: 'trades' });
    expect(b.entries.map((e) => e.url)).toEqual(['/', '/trades']);
  });

  it('V4: 詳細の URL を無い取引の ID で開く → 詳細の画面に「この取引は見つかりません」と一覧へのボタン', () => {
    const b = new MarkBrowser('/trades/no-such-trade');
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
    // 印の無い起動でも、知らない URL はホームの 1 段だけ
    const m = new MarkBrowser('/no-such-page');
    createNavigator(m, PROD);
    expect(m.stack).toEqual(['/']);
  });

  it('V6: ログイン以外のどの画面にも、4 つのタブ（ホーム・取引・振り返り・設定）と真ん中の ［＋ 記録］ がある', () => {
    expect(TAB_ITEMS.map((i) => [i.href, i.label])).toEqual([
      ['/', 'ホーム'],
      ['/trades', '取引'],
      ['/review', '振り返り'],
      ['/settings', '設定'],
    ]);
    expect(RECORD_ENTRY).toEqual({ href: '/record', label: '記録', name: '記録する' });
    const routes: Route[] = [
      { name: 'home' },
      { name: 'record' },
      { name: 'trades' },
      { name: 'review' },
      { name: 'trade', id: 'x' },
      { name: 'tradeEdit', id: 'x' },
      { name: 'settings' },
      { name: 'glossary' },
      { name: 'parts' },
    ];
    for (const route of routes) {
      const tree = JSON.stringify(Shell({ route, children: null }));
      for (const href of ['/', '/trades', '/review', '/settings']) {
        expect(tree, `${route.name} に ${href}`).toContain(`"href":"${href}"`);
      }
      expect(tree, `${route.name} に ［＋ 記録］`).toContain('"draft":false');
    }
    // 並びは ホーム・取引・（＋ 記録）・振り返り・設定
    const tree = JSON.stringify(Shell({ route: { name: 'home' }, children: null }));
    const order = [
      '"tab":"home"',
      '"tab":"trades"',
      '"draft":false',
      '"tab":"review"',
      '"tab":"settings"',
    ];
    const at = order.map((k) => tree.indexOf(k));
    expect(at.every((v) => v >= 0)).toBe(true);
    expect([...at].sort((a, c) => a - c)).toEqual(at);
  });

  it('今のタブの印は history.state の印のタブ（ホームの行から開いた詳細はホームの印）。全画面のシートではどのタブにも付けない', () => {
    const current = (route: Route, tab: 'home' | 'trades' | 'review' | 'settings') => {
      const tree = JSON.stringify(Shell({ route, children: null, tab }));
      return [...tree.matchAll(/"tab":"(\w+)"[^{}]*\},"current":true/g)].map((m) => m[1]);
    };
    expect(current({ name: 'trade', id: 'x' }, 'trades')).toEqual(['trades']);
    expect(current({ name: 'trade', id: 'x' }, 'home')).toEqual(['home']);
    expect(current({ name: 'review' }, 'review')).toEqual(['review']);
    expect(current({ name: 'record' }, 'trades')).toEqual([]);
    expect(current({ name: 'tradeEdit', id: 'x' }, 'trades')).toEqual([]);
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
    nav.push('/record');
    expect(n).toBe(0);
    nav.dispose();
    b.back();
    expect(nav.current.route).toEqual({ name: 'record' });
  });
});

describe('画面の種類・タブ・前の画面の名前（#127）', () => {
  it('URL から決まるタブ（9.7 の 5）', () => {
    const cases: [Route, string][] = [
      [{ name: 'home' }, 'home'],
      [{ name: 'record' }, 'home'],
      [{ name: 'trades' }, 'trades'],
      [{ name: 'trade', id: 'a' }, 'trades'],
      [{ name: 'tradeEdit', id: 'a' }, 'trades'],
      [{ name: 'review' }, 'review'],
      [{ name: 'settings' }, 'settings'],
      [{ name: 'glossary' }, 'settings'],
      [{ name: 'parts' }, 'home'],
    ];
    for (const [route, tab] of cases) expect(tabOfRoute(route), route.name).toBe(tab);
  });

  it('全画面のシートは記録する・編集だけ。画面の種類（根・次の画面・シート）', () => {
    expect(isSheetRoute({ name: 'record' })).toBe(true);
    expect(isSheetRoute({ name: 'tradeEdit', id: 'a' })).toBe(true);
    expect(isSheetRoute({ name: 'trade', id: 'a' })).toBe(false);
    expect(screenKindOf({ name: 'home' })).toBe('root');
    expect(screenKindOf({ name: 'review' })).toBe('root');
    expect(screenKindOf({ name: 'trade', id: 'a' })).toBe('push');
    expect(screenKindOf({ name: 'glossary' })).toBe('push');
    expect(screenKindOf({ name: 'record' })).toBe('sheet');
    expect(screenKindOf({ name: 'login' })).toBe('bare');
  });

  it('「‹ 前の画面の名前」の名前', () => {
    expect(screenLabel('/trades', PROD)).toBe('取引');
    expect(screenLabel('/', PROD)).toBe('ホーム');
    expect(screenLabel('/?period=30d', PROD)).toBe('ホーム');
    expect(screenLabel('/trades/a', PROD)).toBe('取引の詳細');
    expect(screenLabel('/review?period=7d', PROD)).toBe('振り返り');
    expect(screenLabel('/nope', PROD)).toBeNull();
    expect(screenLabel('/login', PROD)).toBeNull();
  });
});

describe('印の無い最初の起動の組み直し（9.7 の 5。純関数）', () => {
  it.each([
    ['/', ['/']],
    ['/?period=30d', ['/?period=30d']],
    ['/trades', ['/', '/trades']],
    ['/trades/a', ['/', '/trades', '/trades/a']],
    ['/trades/a/edit', ['/', '/trades', '/trades/a', '/trades/a/edit']],
    ['/record', ['/', '/record']],
    ['/review?period=7d', ['/', '/review?period=7d']],
    ['/settings', ['/', '/settings']],
    ['/glossary?from=%2Frecord', ['/', '/settings', '/glossary?from=%2Frecord']],
    ['/login?next=%2Ftrades', ['/login?next=%2Ftrades']],
    ['/nope', ['/nope']],
  ] as const)('%s → %j', (href, want) => {
    expect(bootStack(href, PROD)).toEqual(want);
  });

  it('印を読む: 正しい印・印なし・壊れた印・深さだけの古い印（#127 の前の版。組み直さずに URL から補う）', () => {
    const mark: NavMark = { depth: 2, tab: 'trades', stack: ['/', '/trades', '/trades/a'] };
    expect(readMark(markState(mark), '/trades/a', PROD)).toEqual(mark);
    // 層の段（back-layers が state を写して積む）も同じ印
    expect(readMark({ ...markState(mark), back: 1 }, '/trades/a', PROD)).toEqual(mark);
    expect(readMark(null, '/trades/a', PROD)).toBeNull();
    expect(readMark({ glossary: 1 }, '/glossary', PROD)).toBeNull();
    expect(readMark({ appDepth: -1 }, '/', PROD)).toBeNull();
    // 深さ = 段の数 − 1 を保つ（URL から組み直した並びの上の段で補う。#127 N6）
    expect(readMark({ appDepth: 1 }, '/trades/a', PROD)).toEqual({
      depth: 1,
      tab: 'trades',
      stack: ['/trades', '/trades/a'],
    });
    expect(readMark({ appDepth: 3 }, '/trades', PROD)?.stack).toEqual(['/', '/', '/', '/trades']);
    expect(readMark({ appDepth: 1, appTab: 'nope', appStack: ['/', '/x'] }, '/x', PROD)?.tab).toBe(
      'home',
    );
    expect(depthOf(markState(mark))).toBe(2);
  });
});

describe('タブの切り替え・押し直しの計画（純関数）', () => {
  const at = (stack: string[], tab: NavMark['tab']): NavMark => ({
    depth: stack.length - 1,
    tab,
    stack,
  });

  it('記憶はシートとホームの段を除く。位置は段ごと', () => {
    expect(
      memoryOf(
        at(['/', '/trades', '/trades/a', '/trades/a/edit'], 'trades'),
        [0, 120, 40, 0],
        PROD,
      ),
    ).toEqual({ hrefs: ['/trades', '/trades/a'], scrolls: [120, 40] });
    expect(memoryOf(at(['/', '/record'], 'home'), [300, 0], PROD)).toEqual({
      hrefs: ['/'],
      scrolls: [300],
    });
    expect(memoryOf(at(['/', '/trades/a'], 'home'), [], PROD)).toEqual({
      hrefs: ['/', '/trades/a'],
      scrolls: [0, 0],
    });
  });

  it('ほかのタブへ: ホームの段まで戻り、根と記憶を積み直す。いちばん上の位置を戻す', () => {
    const plan = planTabSwitch(at(['/', '/trades', '/trades/a'], 'trades'), 'settings', null);
    expect(plan.go).toBe(-2);
    expect(plan.replace).toBeNull();
    expect(plan.push.map((p) => p.href)).toEqual(['/settings']);
    expect(plan.top).toEqual({ depth: 1, tab: 'settings', stack: ['/', '/settings'] });
    const back = planTabSwitch(at(['/', '/settings'], 'settings'), 'trades', {
      hrefs: ['/trades', '/trades/a'],
      scrolls: [120, 40],
    });
    expect(back.go).toBe(-1);
    expect(back.push.map((p) => [p.href, p.mark.depth])).toEqual([
      ['/trades', 1],
      ['/trades/a', 2],
    ]);
    expect(back.scroll).toBe(40);
  });

  it('ホームへ: ホームの段まで戻り、ホームの記憶（行から開いた詳細）を積み直す', () => {
    const plan = planTabSwitch(at(['/', '/trades'], 'trades'), 'home', {
      hrefs: ['/', '/trades/x'],
      scrolls: [200, 0],
    });
    expect(plan.go).toBe(-1);
    expect(plan.push.map((p) => [p.href, p.mark.tab])).toEqual([['/trades/x', 'home']]);
    expect(planTabSwitch(at(['/', '/trades'], 'trades'), 'home', null)).toMatchObject({
      go: -1,
      replace: null,
      push: [],
      scroll: 0,
    });
  });

  it('同じタブを押し直す: 次の画面・シートを開いていれば根へ、根なら先頭へ', () => {
    expect(planRetap(at(['/', '/trades', '/trades/a'], 'trades'))).toEqual({ go: -1 });
    expect(planRetap(at(['/', '/trades', '/trades/a', '/trades/a/edit'], 'trades'))).toEqual({
      go: -2,
    });
    expect(planRetap(at(['/', '/trades'], 'trades'))).toBe('top');
    expect(planRetap(at(['/', '/trades/x'], 'home'))).toEqual({ go: -1 });
    expect(planRetap(at(['/'], 'home'))).toBe('top');
  });
});

describe('タブごとの積み重ねと戻る（ui-guidelines 9.7 の表の例。縦の形）', () => {
  /** ホーム → 取引 → 行 a */
  const toDetail = () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    nav.push('/trades/a');
    return { b, nav };
  };

  it('ホーム → 取引 → 行 a: [/, /trades, /trades/a]、戻ると /trades', () => {
    const { b, nav } = toDetail();
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
    expect(nav.current.mark.tab).toBe('trades');
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
  });

  it('続けて設定のタブ: [/, /settings]（取引の記憶 = /trades/a）、戻るとホーム', () => {
    const { b, nav } = toDetail();
    nav.tab('settings');
    expect(b.stack).toEqual(['/', '/settings']);
    expect(nav.current.via).toBe('tab');
    expect(nav.current.mark.tab).toBe('settings');
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('続けて取引のタブ: [/, /trades, /trades/a]（a が出る・位置を戻す）、戻ると /trades', () => {
    const { b, nav } = toDetail();
    b.y = 640;
    nav.tab('settings');
    b.y = 0;
    let notified = 0;
    nav.subscribe(() => notified++);
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
    expect(nav.current.route).toEqual({ name: 'trade', id: 'a' });
    expect(nav.current.via).toBe('tab');
    expect(nav.current.scroll).toBe(640);
    // 戻すあいだの popstate は画面に出さない（知らせは着いた後の 1 回だけ）
    expect(notified).toBe(1);
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
  });

  it('続けて取引のタブをもう一度: [/, /trades]（記憶を捨てる）、戻るとホーム', () => {
    const { b, nav } = toDetail();
    nav.tab('settings');
    nav.tab('trades');
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
    expect(nav.current.route).toEqual({ name: 'trades' });
    nav.tab('settings');
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('根で同じタブを押す: 履歴は変わらず、殻には retap（先頭へ送って裏で読み直す）', () => {
    const b = new MarkBrowser('/trades');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
    expect(nav.current.via).toBe('retap');
  });

  it('/trades/a を直接開く（印なし）: [/, /trades, /trades/a]、戻ると /trades、もう 1 回でホーム', () => {
    const b = new MarkBrowser('/trades/a');
    const nav = createNavigator(b, PROD);
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
    expect(nav.current.mark).toEqual({
      depth: 2,
      tab: 'trades',
      stack: ['/', '/trades', '/trades/a'],
    });
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('編集・記録する・用語集を直接開く: 下に詳細・ホーム・設定を敷く（全画面のシートの「前の画面」が必ずある）', () => {
    const e = new MarkBrowser('/trades/a/edit');
    const nav = createNavigator(e, PROD);
    expect(e.stack).toEqual(['/', '/trades', '/trades/a', '/trades/a/edit']);
    nav.back('/trades/a');
    expect(nav.current.route).toEqual({ name: 'trade', id: 'a' });
    const r = new MarkBrowser('/record');
    const navR = createNavigator(r, PROD);
    expect(r.stack).toEqual(['/', '/record']);
    navR.back('/');
    expect(navR.current.route).toEqual({ name: 'home' });
    const g = new MarkBrowser('/glossary');
    createNavigator(g, PROD);
    expect(g.stack).toEqual(['/', '/settings', '/glossary']);
  });

  it('[/, /trades, /trades/a] で詳細を再読み込み（印あり）: 組み直さず、そのまま。戻ると /trades', () => {
    const { b } = toDetail();
    const before = b.entries.map((e) => e.url);
    const nav = createNavigator(b, PROD);
    expect(b.entries.map((e) => e.url)).toEqual(before);
    expect(nav.current.mark.tab).toBe('trades');
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
  });

  it('ホームの根で戻る: [/] のまま（ホームの下に段を足さない = ブラウザ・OS に任せてアプリを出る）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    expect(b.entries.map((e) => e.url)).toEqual(['/']);
    expect(nav.current.mark.depth).toBe(0);
    // 取引の根の戻るはホームへ（アプリの外へ出さない）
    nav.tab('trades');
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
    expect(b.index).toBe(0);
  });

  it('取引のタブで記録するを開いて設定のタブへ: 記録するは閉じる（取引の記憶に残さない）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    nav.push('/record');
    expect(b.stack).toEqual(['/', '/trades', '/record']);
    expect(nav.current.mark.tab).toBe('trades');
    nav.tab('settings');
    expect(b.stack).toEqual(['/', '/settings']);
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
    expect(nav.current.route).toEqual({ name: 'trades' });
  });

  it('ホームの行から開いた詳細はホームのタブの積み重ね（ホームの印・戻るとホーム）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.push('/trades/x');
    expect(b.stack).toEqual(['/', '/trades/x']);
    expect(nav.current.mark.tab).toBe('home');
    nav.tab('settings');
    nav.tab('home');
    expect(b.stack).toEqual(['/', '/trades/x']);
    expect(nav.current.route).toEqual({ name: 'trade', id: 'x' });
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('ほかのタブの根への push（ホームの「すべての取引」）: そのタブへ根で替える（記憶を捨てる）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    nav.push('/trades/a');
    nav.tab('home');
    nav.push('/trades');
    expect(b.stack).toEqual(['/', '/trades']);
    expect(nav.current.mark.tab).toBe('trades');
    // 今のタブの根への push（詳細の「一覧へ戻る」）は根まで戻る（同じ一覧を 2 段積まない）
    nav.push('/trades/b');
    nav.push('/trades');
    expect(b.stack).toEqual(['/', '/trades']);
  });

  /** 用語集の中で言葉をたどる（Glossary.tsx と同じ state を積む） */
  const followTerm = (b: MarkBrowser, id: string) => {
    const next = `/glossary#glossary-${id}`;
    b.pushRaw(next, { ...inPageStepState(b.readState(), b.url, next, PROD), glossary: 1 });
  };

  it('B1（レビュー）: 設定 → 用語集 → 言葉を 2 つたどる → 取引のタブ: [/, /trades]、戻るとホーム', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('settings');
    nav.push('/glossary');
    followTerm(b, 'lc');
    followTerm(b, 'oneR');
    expect(b.stack).toEqual([
      '/',
      '/settings',
      '/glossary',
      '/glossary#glossary-lc',
      '/glossary#glossary-oneR',
    ]);
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
    // 設定のタブへ戻ると、たどった段は 1 段（用語集）にまとめて積み直す
    nav.tab('settings');
    expect(b.stack).toEqual(['/', '/settings', '/glossary']);
  });

  it('B1（レビュー）: 用語集の中でたどった後に設定のタブを押し直す → 根（/settings）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('settings');
    nav.push('/glossary');
    followTerm(b, 'lc');
    followTerm(b, 'oneR');
    // ページの中で戻る（URL のパスは同じ）でも、印の深さは今の段のもの
    b.back();
    expect(nav.current.mark.depth).toBe(3);
    nav.tab('settings');
    expect(b.stack).toEqual(['/', '/settings']);
    expect(nav.current.route).toEqual({ name: 'settings' });
  });

  it('B2（レビュー）: 設定のタブでログアウト → ログイン → ホームの印（タブ home・深さ 0）・履歴は [/]', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    nav.push('/trades/a');
    nav.tab('settings');
    nav.replace('/login');
    expect(b.stack).toEqual(['/login']);
    expect(nav.current.mark).toEqual({ depth: 0, tab: 'home', stack: ['/login'] });
    nav.replace('/');
    expect(b.stack).toEqual(['/']);
    expect(nav.current.mark).toEqual({ depth: 0, tab: 'home', stack: ['/'] });
    // タブの記憶も持ち越さない（取引のタブは根）
    nav.tab('trades');
    expect(b.stack).toEqual(['/', '/trades']);
  });

  it('N2（レビュー）: ログインしていないまま /trades/a を開く → ログイン → [/, /trades, /trades/a]', () => {
    const b = new MarkBrowser('/trades/a');
    const nav = createNavigator(b, PROD);
    nav.replace('/login?next=%2Ftrades%2Fa');
    expect(b.stack).toEqual(['/login?next=%2Ftrades%2Fa']);
    nav.replace('/trades/a');
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
    expect(nav.current.mark.tab).toBe('trades');
  });

  it('N1（レビュー）: タブを往復した後の戻るで、積み直した下の段（一覧）の位置を殻が戻す', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('trades');
    b.y = 900;
    nav.push('/trades/a');
    b.y = 300;
    nav.tab('settings');
    nav.tab('trades');
    expect(nav.current.scroll).toBe(300);
    b.back();
    expect(nav.current.route).toEqual({ name: 'trades' });
    expect(nav.current.via).toBe('pop');
    expect(nav.current.scroll).toBe(900);
  });

  it('タブの切り替えの前に、開いて閉じる層の段を巻き戻す', () => {
    const b = new MarkBrowser('/');
    let unwound = 0;
    const nav = createNavigator(b, PROD, {
      unwind: (done) => {
        unwound++;
        done();
        return true;
      },
    });
    nav.tab('settings');
    expect(unwound).toBe(1);
    expect(b.stack).toEqual(['/', '/settings']);
  });

  it('組み直しは利用者の最初の操作で書く（操作の無いまま積んだ段は Chrome が飛ばすため）。操作の前のタブも先に組み直す', () => {
    /** 利用者の最初の操作を待つ偽物 */
    class ActBrowser extends MarkBrowser {
      activate: (() => void) | null = null;
      onActivation(fn: () => void) {
        this.activate = fn;
      }
    }
    const b = new ActBrowser('/trades/a');
    const nav = createNavigator(b, PROD);
    // 書く前も、今の画面の印は組み直した後の形（タブ・深さ）
    expect(b.stack).toEqual(['/trades/a']);
    expect(nav.current.mark).toEqual({
      depth: 2,
      tab: 'trades',
      stack: ['/', '/trades', '/trades/a'],
    });
    b.activate?.();
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
    // 操作のフックを通らずにタブを押しても、先に組み直してから替える
    const c = new ActBrowser('/trades/a');
    createNavigator(c, PROD).tab('settings');
    expect(c.stack).toEqual(['/', '/settings']);
    // 操作の前の置き換え（ログインの門）は組み直しを捨てて 1 段のまま
    const d = new ActBrowser('/trades/a');
    const nav3 = createNavigator(d, PROD);
    nav3.replace('/login?next=%2Ftrades%2Fa');
    expect(d.stack).toEqual(['/login?next=%2Ftrades%2Fa']);
    expect(nav3.current.mark.depth).toBe(0);
    d.activate?.();
    expect(d.stack).toEqual(['/login?next=%2Ftrades%2Fa']);
  });

  it('go の popstate が来ないとき（ブラウザの都合）は、待ちを解いて続ける', () => {
    const b = new MarkBrowser('/');
    const timers: (() => void)[] = [];
    const env: NavEnv = {
      location: () => b.location(),
      pushState: (u, m) => b.pushState(u, m),
      replaceState: (u, m) => b.replaceState(u, m),
      onPopState: (fn) => b.onPopState(fn),
      readState: () => b.readState(),
      back: () => b.back(),
      // popstate を出さずに位置だけ動かす
      go: (n) => {
        b.index += n;
      },
      defer: (fn) => {
        timers.push(fn);
        return () => {};
      },
    };
    const nav = createNavigator(env, PROD);
    nav.tab('trades');
    nav.push('/trades/a');
    nav.tab('settings');
    expect(nav.current.route).toEqual({ name: 'trade', id: 'a' });
    while (timers.length > 0) timers.shift()?.();
    expect(nav.current.route).toEqual({ name: 'settings' });
    expect(b.stack).toEqual(['/', '/settings']);
  });
});

describe('前の画面へ（nav.back。#75 R1）', () => {
  it('アプリの中で進んで来た画面があれば戻る（履歴を増やさない）', () => {
    const b = new MarkBrowser('/trades');
    const nav = createNavigator(b, PROD);
    nav.push('/record');
    expect(nav.current.mark.depth).toBe(2);
    nav.back('/');
    expect(b.url).toBe('/trades');
    expect(nav.current.route).toEqual({ name: 'trades' });
    expect(nav.current.via).toBe('pop');
    expect(b.entries.map((e) => e.url)).toEqual(['/', '/trades', '/record']);
  });

  it('アプリの中に前の画面が無い履歴（印を持たない）は fallback へ置き換える（戻るでアプリの外へ出ない）', () => {
    const plain = new FakeBrowser('/trades');
    const nav = createNavigator(plain, PROD);
    nav.push('/record');
    nav.back('/');
    expect(plain.entries).toEqual(['/trades', '/']);
    expect(nav.current.via).toBe('replace');
  });

  it('置き換えは深さ・タブを保つ', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('review');
    nav.replace('/review?period=30d');
    expect(nav.current.mark).toEqual({
      depth: 1,
      tab: 'review',
      stack: ['/', '/review?period=30d'],
    });
    expect(b.stack).toEqual(['/', '/review?period=30d']);
  });

  it('開いて閉じる層の段があれば、巻き戻してから戻る', () => {
    const b = new MarkBrowser('/trades');
    let unwound = 0;
    const nav = createNavigator(b, PROD, {
      unwind: (done) => {
        unwound++;
        done();
        return true;
      },
    });
    nav.push('/record');
    // 進むも層の段を巻き戻してから積む（#129 のレビュー N6）
    expect(unwound).toBe(1);
    nav.back('/');
    expect(unwound).toBe(2);
    expect(b.url).toBe('/trades');
  });
});

describe('同じ画面への push（#75 B1）', () => {
  it('今と同じ URL への push は積まずに置き換える → [キャンセル] の back で前の画面へ移る', () => {
    const b = new MarkBrowser('/trades');
    const nav = createNavigator(b, PROD);
    let notified = 0;
    nav.subscribe(() => notified++);
    nav.push('/record');
    nav.push('/record');
    expect(b.stack).toEqual(['/', '/trades', '/record']);
    nav.back('/');
    expect(b.url).toBe('/trades');
    expect(nav.current.route).toEqual({ name: 'trades' });
    expect(notified).toBe(3);
  });

  it('検索部分が違えば積む（同じ画面でも別の見方）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.push('/?period=30d');
    expect(b.stack).toEqual(['/', '/?period=30d']);
  });
});

describe('書きかけの印の点（#75 デザイン 1）', () => {
  it('記録する画面の書きかけを残しているときだけ、［＋ 記録］ に点（読み上げ「入力の途中あり」）', () => {
    const plain = JSON.stringify(Shell({ route: { name: 'home' }, children: null }));
    expect(plain).toContain('"draft":false');
    expect(plain).not.toContain('"draft":true');
    const marked = JSON.stringify(
      Shell({ route: { name: 'home' }, children: null, recordDraft: true }),
    );
    expect(marked.match(/"draft":true/g)).toHaveLength(1);
  });
});

describe('同じ画面への push と層・殻への伝え方（#75 R5・R6）', () => {
  it('R5: 層の段が積まれていれば巻き戻してから置き換える → back で前の画面へ', () => {
    const b = new MarkBrowser('/trades');
    let unwound = 0;
    const nav = createNavigator(b, PROD, {
      unwind: (done) => {
        unwound++;
        done();
        return true;
      },
    });
    nav.push('/record');
    // 別の画面への push も巻き戻しを通る（#129 のレビュー N6）
    expect(unwound).toBe(1);
    nav.push('/record');
    expect(unwound).toBe(2);
    expect(b.stack).toEqual(['/', '/trades', '/record']);
    nav.back('/');
    expect(b.url).toBe('/trades');
  });

  it('R6: 今いる画面と同じ URL へ push すると、殻には push（見出しへフォーカス・先頭へスクロール）と伝える', () => {
    const b = new MarkBrowser('/trades/a');
    const nav = createNavigator(b, PROD);
    nav.push('/trades/a');
    expect(nav.current.via).toBe('push');
    expect(b.stack).toEqual(['/', '/trades', '/trades/a']);
  });
});

describe('振り返りの「数で見る」と今月の規律のカード（#128。ui-guidelines 9.3・9.4・9.7）', () => {
  it('/review/table は次の画面「数で見る」（振り返りのタブ）', () => {
    expect(parseRoute('/review/table', PROD)).toEqual({ name: 'reviewTable' });
    expect(parseRoute('/review/table/', PROD)).toEqual({ name: 'reviewTable' });
    expect(parseRoute('/review/nope', PROD)).toBeNull();
    expect(hrefOf({ name: 'reviewTable' })).toBe('/review/table');
    expect(tabOfRoute({ name: 'reviewTable' })).toBe('review');
    expect(screenKindOf({ name: 'reviewTable' })).toBe('push');
    expect(screenLabel('/review/table?period=7d', PROD)).toBe('数で見る');
    expect(titleOf({ name: 'reviewTable' })).toBe('数で見る — 損失ノート');
  });

  it('直接開いた /review/table?… は [/, /review?…, /review/table?…] に組み直す（同じ期間の根）', () => {
    expect(bootStack('/review/table?period=7d', PROD)).toEqual([
      '/',
      '/review?period=7d',
      '/review/table?period=7d',
    ]);
    expect(bootStack('/review/table', PROD)).toEqual(['/', '/review', '/review/table']);
    const b = new MarkBrowser('/review/table?period=1m');
    const nav = createNavigator(b, PROD);
    nav.tab('review');
    expect(b.stack).toEqual(['/', '/review?period=1m']);
  });

  it('振り返り → 数で見る: [/, /review?…, /review/table?…]、戻ると同じ期間の振り返り', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('review');
    nav.replace('/review?period=3m');
    nav.push('/review/table?period=3m');
    expect(b.stack).toEqual(['/', '/review?period=3m', '/review/table?period=3m']);
    expect(nav.current.mark.tab).toBe('review');
    b.back();
    expect(nav.current.route).toEqual({ name: 'review' });
    expect(nav.current.search).toBe('?period=3m');
  });

  it('ホームの今月の規律のカード: 期間つきの振り返りの根へ push → 振り返りのタブへ替える（積まない・記憶を捨てる）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    // 前に振り返りで「数で見る」を開いていた（記憶）
    nav.tab('review');
    nav.push('/review/table?period=7d');
    nav.tab('home');
    expect(b.stack).toEqual(['/']);
    const month = '/review?period=custom&from=2026-11-01&to=2026-11-19';
    nav.push(month);
    expect(b.stack).toEqual(['/', month]);
    expect(nav.current.mark.tab).toBe('review');
    expect(nav.current.via).toBe('tab');
    expect(nav.current.route).toEqual({ name: 'review' });
    b.back();
    expect(nav.current.route).toEqual({ name: 'home' });
  });

  it('振り返りのタブの中で期間つきの根へ push は今までどおり積む（タブは振り返りのまま）', () => {
    const b = new MarkBrowser('/');
    const nav = createNavigator(b, PROD);
    nav.tab('review');
    nav.push('/review?period=1m');
    expect(nav.current.mark.tab).toBe('review');
    expect(b.stack).toEqual(['/', '/review', '/review?period=1m']);
  });
});
