// 画面の移りの動き（#136・ui-guidelines 9.8・設計書 C64）: 種類を決める純関数（例の表 #1〜#13）、糊（動きを減らす設定・
// View Transitions の無いブラウザ = #14・#15、描き終わりを待つ・印を外す）、router が渡す移りと戻るの出どころ
import { describe, expect, it } from 'vitest';
import { createNavigator, type NavEnv, type PopInfo } from '../../ui/src/lib/router';
import type { Route } from '../../ui/src/lib/routes';
import {
  type Motion,
  type MotionVia,
  motionOf,
  type PopCause,
  popCauseOf,
  type ScreenChange,
} from '../../ui/src/lib/screen-motion';
import { markState, type NavMark } from '../../ui/src/lib/tab-nav';
import {
  createScreenMotion,
  type MotionEnv,
  type TransitionHandle,
} from '../../ui/src/lib/view-transition';

const HOME: Route = { name: 'home' };
const TRADES: Route = { name: 'trades' };
const TRADE_A: Route = { name: 'trade', id: 'a' };
const REVIEW: Route = { name: 'review' };
const SETTINGS: Route = { name: 'settings' };
const RECORD: Route = { name: 'record' };
const LOGIN: Route = { name: 'login' };

const s = (route: Route, depth: number, href: string) => ({ route, depth, href });
const change = (
  from: ReturnType<typeof s>,
  to: ReturnType<typeof s>,
  via: MotionVia,
  cause: PopCause | null = null,
): ScreenChange => ({ from, to, via, cause });

const LIST = s(TRADES, 1, '/trades');
const DETAIL = s(TRADE_A, 2, '/trades/a');

/** 例の表（Issue #136 の「ルールと例」）#1〜#13: 純関数の動きの種類 */
const TABLE: readonly [number, string, ScreenChange, Motion][] = [
  [1, '一覧 → 詳細（行を押した）', change(LIST, DETAIL, 'push'), 'forward'],
  [2, '詳細 → 一覧（「‹」= アプリが戻した）', change(DETAIL, LIST, 'pop', 'app'), 'back'],
  [3, '詳細 → 一覧（Android の戻るのキー）', change(DETAIL, LIST, 'pop', 'browser'), 'back'],
  [4, '詳細 → 一覧（iPhone の端からのスワイプ）', change(DETAIL, LIST, 'pop', 'ua'), 'none'],
  [5, '詳細 → 一覧（印の無いブラウザの戻る）', change(DETAIL, LIST, 'pop', 'unknown'), 'none'],
  [6, 'ホーム → 設定のタブ', change(s(HOME, 0, '/'), s(SETTINGS, 1, '/settings'), 'tab'), 'fade'],
  [
    7,
    '取引のタブの詳細 → 振り返りのタブの根',
    change(DETAIL, s(REVIEW, 1, '/review'), 'tab'),
    'fade',
  ],
  [8, '詳細 → 一覧（取引のタブを押し直した）', change(DETAIL, LIST, 'pop', 'app'), 'back'],
  [9, '一覧 → 記録する', change(LIST, s(RECORD, 2, '/record'), 'push'), 'up'],
  [10, '記録する → 一覧（✕）', change(s(RECORD, 2, '/record'), LIST, 'pop', 'app'), 'down'],
  [
    11,
    '振り返りの期間を選んだ（置き換え）',
    change(s(REVIEW, 1, '/review'), s(REVIEW, 1, '/review?period=3m'), 'replace'),
    'none',
  ],
  [12, 'ログイン → ホーム', change(s(LOGIN, 0, '/login'), s(HOME, 0, '/'), 'replace'), 'none'],
  [13, '一覧の根で取引のタブを押し直した（先頭へ）', change(LIST, LIST, 'retap'), 'none'],
];

describe('例の表 #1〜#13（AC-1: 動きの種類）', () => {
  it.each(TABLE)('#%i %s', (_n, _name, c, want) => {
    expect(motionOf(c)).toBe(want);
  });

  it('動かさない端: 開いた・同じ URL への push・ログインの画面へ入る / 出る（push でも）', () => {
    expect(motionOf(change(LIST, LIST, 'init'))).toBe('none');
    expect(motionOf(change(LIST, s(TRADES, 1, '/trades'), 'push'))).toBe('none');
    expect(motionOf(change(s(LOGIN, 0, '/login'), s(HOME, 0, '/'), 'push'))).toBe('none');
    expect(motionOf(change(DETAIL, s(LOGIN, 0, '/login'), 'pop', 'app'))).toBe('none');
  });

  it('進む（ブラウザの進む・端末の動きの印 = 偽）は深さが増えるので forward。端末が動かした進むは動かさない', () => {
    expect(motionOf(change(LIST, DETAIL, 'pop', 'browser'))).toBe('forward');
    expect(motionOf(change(LIST, DETAIL, 'pop', 'ua'))).toBe('none');
  });

  it('全画面のシートの出入りはタブ・深さより先: シートからタブを替えると down、戻るで編集へ戻ると up', () => {
    expect(motionOf(change(s(RECORD, 2, '/record'), s(SETTINGS, 1, '/settings'), 'tab'))).toBe(
      'down',
    );
    const edit = s({ name: 'tradeEdit', id: 'a' }, 3, '/trades/a/edit');
    expect(motionOf(change(s({ name: 'tradeFields', id: 'a' }, 4, '/x'), edit, 'pop', 'app'))).toBe(
      'up',
    );
  });

  it('深さが同じで URL の違う push（知らない URL の置き換え）は薄く替える', () => {
    expect(motionOf(change(DETAIL, s(TRADE_A, 2, '/trades/b'), 'push'))).toBe('fade');
  });

  it('popCauseOf: 真 = ua、偽 = browser、無い = unknown', () => {
    expect([popCauseOf(true), popCauseOf(false), popCauseOf(undefined)]).toEqual([
      'ua',
      'browser',
      'unknown',
    ]);
  });
});

/** 糊の偽の文書: startViewTransition の呼び出しと印を記録する。描き終わりの保険の時計は手で進める */
class FakeDoc implements MotionEnv {
  marks: (Motion | null)[] = [];
  starts = 0;
  timers: (() => void)[] = [];
  /** 始めた動きの update（撮影へ進むと解ける Promise を返す） */
  updates: (() => Promise<void>)[] = [];
  finish: (() => void)[] = [];
  readyRejects: ((e: unknown) => void)[] = [];
  constructor(public opts: { reduced?: boolean; vt?: boolean; throws?: boolean } = { vt: true }) {}
  start(update: () => Promise<void>): TransitionHandle | null {
    if (!this.opts.vt) return null;
    if (this.opts.throws) throw new Error('InvalidStateError');
    this.starts++;
    this.updates.push(update);
    let done = () => {};
    const finished = new Promise<void>((ok) => {
      done = ok;
    });
    this.finish.push(done);
    const ready = new Promise<void>((_ok, ng) => this.readyRejects.push(ng));
    return { finished, ready };
  }
  reduced() {
    return this.opts.reduced === true;
  }
  mark(m: Motion | null) {
    this.marks.push(m);
  }
  defer(fn: () => void) {
    this.timers.push(fn);
  }
}

const FORWARD = TABLE[0]?.[2] as ScreenChange;
const flush = () => new Promise((ok) => setTimeout(ok, 0));

describe('糊（例の表 #14・#15 と AC-2・AC-3 の約束）', () => {
  it('#14 動きを減らす設定: 動きを始めず、すぐ知らせる（印も付けない）', () => {
    const d = new FakeDoc({ reduced: true, vt: true });
    const m = createScreenMotion(d);
    let n = 0;
    m.run(FORWARD, () => n++, {});
    expect([n, d.starts, d.marks]).toEqual([1, 0, []]);
  });

  it('#15 View Transitions の無いブラウザ: 動きなしですぐ知らせ、付けた印は外す', () => {
    const d = new FakeDoc({ vt: false });
    const m = createScreenMotion(d);
    let n = 0;
    m.run(FORWARD, () => n++, {});
    expect(n).toBe(1);
    expect(d.marks).toEqual(['forward', null]);
  });

  it('始められなかった（例外）ときも動きなしで知らせる', () => {
    const d = new FakeDoc({ vt: true, throws: true });
    const m = createScreenMotion(d);
    let n = 0;
    m.run(FORWARD, () => n++, {});
    expect(n).toBe(1);
    expect(d.marks.at(-1)).toBe(null);
  });

  it('none の移りは動きを始めない', () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    let n = 0;
    m.run(TABLE[3]?.[2] as ScreenChange, () => n++, {});
    expect([n, d.starts]).toEqual([1, 0]);
  });

  it('AC-2: 撮影へ進む（update の Promise が解ける）のは、その画面の描き終わりの知らせの後', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    const target = {};
    let n = 0;
    m.run(FORWARD, () => n++, target);
    expect(d.marks).toEqual(['forward']);
    let resolved = false;
    void d.updates[0]?.().then(() => {
      resolved = true;
    });
    expect(n).toBe(1);
    m.rendered({}); // 別の画面の描き終わりでは解けない
    await flush();
    expect(resolved).toBe(false);
    m.rendered(target);
    await flush();
    expect(resolved).toBe(true);
  });

  it('描き終わりの知らせが来なければ保険の時計で撮影へ進む', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    let resolved = false;
    m.run(FORWARD, () => {}, {});
    void d.updates[0]?.().then(() => {
      resolved = true;
    });
    for (const t of d.timers) t();
    await flush();
    expect(resolved).toBe(true);
  });

  it('AC-3: 終わったら印を外す。続けて次の動きが始まったら、前の動きの終わりでは外さない', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    m.run(FORWARD, () => {}, {});
    m.run(TABLE[1]?.[2] as ScreenChange, () => {}, {});
    // 飛ばされた前の動きの ready の reject は捨てる（ページのエラーにしない）
    d.readyRejects[0]?.(new Error('AbortError'));
    d.finish[0]?.();
    await flush();
    expect(d.marks).toEqual(['forward', 'back']);
    d.finish[1]?.();
    await flush();
    expect(d.marks).toEqual(['forward', 'back', null]);
  });

  it('飛ばされた動きの callback が後で呼ばれ、その前に後の画面が描けていたら、どちらの撮影もすぐ解ける（1 秒待たない）', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    const a = {};
    const b = {};
    const seen: string[] = [];
    // T1・T2 が続けて知らされ、どちらの callback もまだ呼ばれない
    m.run(FORWARD, () => seen.push('update-a'), a);
    m.run(FORWARD, () => seen.push('update-b'), b);
    // T1 の callback より先に、App が後の画面 b を描いた（router の今の画面は b）
    m.rendered(b);
    const got: string[] = [];
    void d.updates[0]?.().then(() => got.push('a'));
    void d.updates[1]?.().then(() => got.push('b'));
    await flush();
    expect(got.sort()).toEqual(['a', 'b']);
    expect(seen).toEqual(['update-a', 'update-b']);
    // 保険の時計は使っていない
    expect(d.timers).toEqual([]);
  });

  it('動きのある移りの後に同じタスクで動かさない移り（置き換え）が重なり、置き換えの画面が描けたら前の撮影も解ける', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    const a = {};
    const c = {};
    let resolved = false;
    m.run(FORWARD, () => {}, a);
    void d.updates[0]?.().then(() => {
      resolved = true;
    });
    m.run(TABLE[10]?.[2] as ScreenChange, () => {}, c);
    m.rendered(c);
    await flush();
    expect(resolved).toBe(true);
  });

  it('前に知らされた画面の描き終わりでは、後の画面の撮影は解けない', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    const a = {};
    const b = {};
    m.run(TABLE[10]?.[2] as ScreenChange, () => {}, a);
    m.run(FORWARD, () => {}, b);
    let resolved = false;
    void d.updates[0]?.().then(() => {
      resolved = true;
    });
    m.rendered(a);
    await flush();
    expect(resolved).toBe(false);
    m.rendered(b);
    await flush();
    expect(resolved).toBe(true);
  });

  it('続けて移ったとき、後の画面の描き終わりで前の撮影も解ける', async () => {
    const d = new FakeDoc();
    const m = createScreenMotion(d);
    const a = {};
    const b = {};
    m.run(FORWARD, () => {}, a);
    m.run(FORWARD, () => {}, b);
    const got: string[] = [];
    void d.updates[0]?.().then(() => got.push('a'));
    void d.updates[1]?.().then(() => got.push('b'));
    m.rendered(b);
    await flush();
    expect(got.sort()).toEqual(['a', 'b']);
  });
});

/** history の偽物（印つき・popstate に端末の動きの印を添えられる） */
class Hist implements NavEnv {
  entries: { url: string; state: unknown }[];
  index = 0;
  private listeners = new Set<(info?: PopInfo) => void>();
  /** 次の popstate に添える印 */
  nextInfo: PopInfo | undefined;
  constructor(first: string, state: unknown) {
    this.entries = [{ url: first, state }];
  }
  get url(): string {
    return this.entries[this.index]?.url ?? '';
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
  onPopState(fn: (info?: PopInfo) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  go(n: number) {
    const to = this.index + n;
    if (n === 0 || to < 0 || to >= this.entries.length) return;
    this.index = to;
    const info = this.nextInfo;
    this.nextInfo = undefined;
    for (const fn of [...this.listeners]) fn(info);
  }
  back() {
    this.go(-1);
  }
}

const homeMark: NavMark = { depth: 0, tab: 'home', stack: ['/'] };

function setup() {
  const h = new Hist('/', markState(homeMark));
  const seen: { motion: Motion; via: MotionVia; cause: PopCause | null }[] = [];
  let notified = 0;
  const nav = createNavigator(
    h,
    { dev: false },
    {
      transition: (c, update) => {
        seen.push({ motion: motionOf(c), via: c.via, cause: c.cause });
        update();
      },
    },
  );
  nav.subscribe(() => notified++);
  return { h, nav, seen, count: () => notified };
}

describe('router が渡す移り（AC-1・AC-4 の経路）', () => {
  it('進む → forward、アプリの「‹」（nav.back）→ 出どころ app の back（端末の印に依らない）', () => {
    const { h, nav, seen } = setup();
    nav.push('/trades/a');
    h.nextInfo = { ua: undefined };
    nav.back('/');
    expect(seen.map((x) => x.motion)).toEqual(['forward', 'back']);
    expect(seen[1]?.cause).toBe('app');
  });

  it('ブラウザの戻る: 印が真 = 動かさない、偽 = back、無い = 動かさない', () => {
    for (const [ua, want] of [
      [true, 'none'],
      [false, 'back'],
      [undefined, 'none'],
    ] as const) {
      const { h, nav, seen } = setup();
      nav.push('/trades/a');
      h.nextInfo = { ua };
      h.back();
      expect(seen.at(-1)?.motion, String(ua)).toBe(want);
    }
  });

  it('#7 タブの切り替え（履歴をホームまで戻して積み直す）: 画面への知らせは 1 回、動きは fade 1 回', () => {
    const { nav, seen, count } = setup();
    nav.tab('trades');
    nav.push('/trades/a');
    const before = seen.length;
    const n0 = count();
    nav.tab('review');
    expect(seen.slice(before).map((x) => x.motion)).toEqual(['fade']);
    expect(count() - n0).toBe(1);
  });

  it('#8 取引のタブを押し直す（根へ戻る）は back、#13 根で押し直すは動かさない', () => {
    const { nav, seen } = setup();
    nav.tab('trades');
    nav.push('/trades/a');
    nav.tab('trades');
    expect(seen.at(-1)).toMatchObject({ motion: 'back', cause: 'app' });
    nav.tab('trades');
    expect(seen.at(-1)?.motion).toBe('none');
  });

  it('置き換え（期間の切り替え）は知らせるが動きの糊を通さない = 動かさない', () => {
    const { nav, seen, count } = setup();
    nav.tab('review');
    const before = seen.length;
    const n0 = count();
    nav.replace('/review?period=3m');
    expect(seen.length).toBe(before);
    expect(count() - n0).toBe(1);
  });
});
