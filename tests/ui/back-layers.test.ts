// 戻るで開いて閉じる層を一番上から閉じる（Issue #57。back-stack.ts の規則・back-layers.ts の糊・router.tsx との関係）。
// 履歴は偽物（1 つの履歴を画面の行き来の層と層の糊が共有する。go と popstate は flush で順に届く）
import { describe, expect, it } from 'vitest';
import { createBackLayers } from '../../ui/src/lib/back-layers';
import { BACK_INITIAL, backOf, backReduce, backTarget } from '../../ui/src/lib/back-stack';
import { createNavigator } from '../../ui/src/lib/router';

/** 偽の履歴（URL と state の項目の並び）と、遅れて届く出来事（go の popstate・defer） */
function fakeHistory(start = '/record', startState: unknown = null) {
  /** sr = その項目のスクロールの復元の仕方（history.scrollRestoration。積む項目は今の項目の値を引き継ぐ） */
  const entries: { url: string; state: unknown; sr: 'auto' | 'manual' }[] = [
    { url: start, state: startState, sr: 'auto' },
  ];
  /** 項目を移ったときにブラウザが窓のスクロールの位置を戻した回数（着いた項目が auto のとき） */
  let restores = 0;
  let index = 0;
  const pops = new Set<(state: unknown) => void>();
  let queue: (() => void)[] = [];
  let active = true;
  const go = (n: number) => {
    queue.push(() => {
      const to = Math.max(0, Math.min(entries.length - 1, index + n));
      if (to === index) return;
      index = to;
      if (entries[index]?.sr === 'auto') restores++;
      const s = entries[index]?.state;
      for (const f of [...pops]) f(s);
    });
  };
  const loc = () => {
    const u = entries[index]?.url ?? '/';
    const [pathname = '/', q] = u.split('?');
    return { pathname, search: q ? `?${q}` : '' };
  };
  return {
    entries: () => entries.slice(0, index + 1),
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get restores() {
      return restores;
    },
    /** 今の項目の scrollRestoration */
    get sr() {
      return entries[index]?.sr;
    },
    state: () => entries[index]?.state,
    /** i 番目の項目の scrollRestoration */
    srAt: (i: number) => entries[i]?.sr,
    setActive(v: boolean) {
      active = v;
    },
    /** 利用者の戻る */
    back: () => go(-1),
    /** 届いている出来事を 1 回分だけ流す */
    flushOne() {
      const q = queue;
      queue = [];
      for (const f of q) f();
    },
    /** 届いていない出来事をすべて流す */
    flush() {
      for (let i = 0; i < 50 && queue.length > 0; i++) {
        const q = queue;
        queue = [];
        for (const f of q) f();
      }
    },
    nav: {
      location: loc,
      pushState: (url: string) => {
        entries.splice(index + 1);
        entries.push({ url, state: null, sr: entries[index]?.sr ?? 'auto' });
        index++;
      },
      replaceState: (url: string) => {
        entries[index] = { url, state: null, sr: entries[index]?.sr ?? 'auto' };
      },
      onPopState: (fn: () => void) => {
        const f = () => fn();
        pops.add(f);
        return () => pops.delete(f);
      },
    },
    back_: {
      readState: () => entries[index]?.state,
      pushState: (s: Readonly<Record<string, unknown>>) => {
        entries.splice(index + 1);
        entries.push({
          url: entries[index]?.url ?? '/',
          state: s,
          sr: entries[index]?.sr ?? 'auto',
        });
        index++;
      },
      replaceState: (s: Readonly<Record<string, unknown>>) => {
        const e = entries[index];
        if (e) entries[index] = { ...e, state: s };
      },
      readScrollRestoration: () => entries[index]?.sr ?? 'auto',
      setScrollRestoration: (m: 'auto' | 'manual') => {
        const e = entries[index];
        if (e) entries[index] = { ...e, sr: m };
      },
      go,
      onPopState: (fn: (s: unknown) => void) => {
        pops.add(fn);
        return () => pops.delete(fn);
      },
      userActive: () => active,
      defer: (fn: () => void, _ms: number) => {
        let live = true;
        queue.push(() => {
          if (live) fn();
        });
        return () => {
          live = false;
        };
      },
    },
  };
}

function setup(start?: string, startState?: unknown) {
  const h = fakeHistory(start, startState);
  const layers = createBackLayers(h.back_);
  let screens = 0;
  const nav = createNavigator(
    h.nav,
    { dev: false },
    { onNavigate: () => layers.reset(), unwind: (done) => layers.unwind(done) },
  );
  nav.subscribe(() => screens++);
  return { h, layers, nav, screens: () => screens };
}

describe('back-stack（純関数）', () => {
  it('開くと後始末で 1 段積み、UI で閉じると go(−1)、その popstate では何も閉じない', () => {
    let s = backReduce(BACK_INITIAL, { type: 'open', id: 'a', activation: true }).state;
    let r = backReduce(s, { type: 'settle' });
    expect(r.effects).toEqual([{ kind: 'push', back: 1 }]);
    s = backReduce(r.state, { type: 'close', id: 'a' }).state;
    r = backReduce(s, { type: 'settle' });
    expect(r.effects).toEqual([{ kind: 'go', n: -1 }]);
    r = backReduce(r.state, { type: 'popstate', back: 0 });
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(BACK_INITIAL);
  });

  it('戻る（back が減る）で一番上を閉じる', () => {
    let s = backReduce(BACK_INITIAL, { type: 'open', id: 'a', activation: true }).state;
    s = backReduce(s, { type: 'settle' }).state;
    const r = backReduce(s, { type: 'popstate', back: 0 });
    expect(r.effects).toEqual([{ kind: 'close', ids: ['a'] }]);
    expect(backTarget(r.state)).toBe(0);
  });

  it('操作の外で開いた層は積まない', () => {
    const s = backReduce(BACK_INITIAL, { type: 'open', id: 'a', activation: false }).state;
    expect(backReduce(s, { type: 'settle' }).effects).toEqual([]);
  });

  it('同じ操作の中の「閉じて開く」は履歴を動かさない', () => {
    let s = backReduce(BACK_INITIAL, { type: 'open', id: 'a', activation: true }).state;
    s = backReduce(s, { type: 'settle' }).state;
    s = backReduce(s, { type: 'close', id: 'a' }).state;
    s = backReduce(s, { type: 'open', id: 'b', activation: true }).state;
    expect(backReduce(s, { type: 'settle' }).effects).toEqual([]);
  });

  it('進む・古い項目（back が増える）は何も開かず、いた所へ戻す', () => {
    expect(backReduce(BACK_INITIAL, { type: 'popstate', back: 1 }).effects).toEqual([
      { kind: 'go', n: -1 },
    ]);
  });

  it('pushState に失敗した段から上は積まない層にする', () => {
    let s = backReduce(BACK_INITIAL, { type: 'open', id: 'a', activation: true }).state;
    s = backReduce(s, { type: 'pushFailed', back: 1 }).state;
    expect(s.layers).toEqual([{ id: 'a', entry: false }]);
    expect(s.hist).toBe(0);
  });

  it('backOf: 無い・壊れた値は 0', () => {
    expect(backOf(null)).toBe(0);
    expect(backOf({ back: 2 })).toBe(2);
    expect(backOf({ back: -1 })).toBe(0);
    expect(backOf({ back: '1' })).toBe(0);
    expect(backOf({ back: 1.5 })).toBe(0);
  });
});

describe('back-layers と router（偽の履歴）', () => {
  it('開くと履歴が 1 段増え（URL は同じ）、戻るで層だけが閉じて画面は移らない', () => {
    const { h, layers, nav, screens } = setup();
    let closed = 0;
    layers.open('info-r', () => closed++);
    h.flush();
    expect(h.length).toBe(2);
    expect(h.entries().map((e) => e.url)).toEqual(['/record', '/record']);
    expect(layers.depth()).toBe(1);
    h.back();
    h.flush();
    expect(closed).toBe(1);
    expect(layers.top()).toBeNull();
    expect(h.index).toBe(0);
    expect(nav.current.route.name).toBe('record');
    expect(screens()).toBe(0);
  });

  it('UI（もう一度押す・Esc・外側）で閉じたら積んだ段を戻して数を合わせる。閉じ方は呼ばない・画面は移らない', () => {
    const { h, layers, screens } = setup();
    let closed = 0;
    layers.open('info-r', () => closed++);
    h.flush();
    layers.close('info-r');
    h.flush();
    expect(h.index).toBe(0);
    expect(layers.depth()).toBe(0);
    expect(closed).toBe(0);
    expect(screens()).toBe(0);
    // その後の戻るは画面の行き来に届く（層が残っていない）
    expect(layers.top()).toBeNull();
  });

  it('ほかの「i」に替える（前を閉じて次を開く）は 1 段のまま', () => {
    const { h, layers } = setup();
    layers.open('a', () => {});
    h.flush();
    layers.close('a');
    layers.open('b', () => {});
    h.flush();
    expect(h.index).toBe(1);
    expect(layers.top()).toBe('b');
  });

  it('利用者の操作の外で開いた層は履歴に積まない', () => {
    const { h, layers } = setup();
    h.setActive(false);
    layers.open('a', () => {});
    h.flush();
    expect(h.length).toBe(1);
  });

  it('層を開いたまま画面を移ると記録を捨てる（閉じた段を go で戻して画面を戻さない）', () => {
    const { h, layers, nav, screens } = setup();
    layers.open('a', () => {});
    h.flush();
    nav.push('/trades');
    layers.close('a'); // 前の画面の部品が外れる
    h.flush();
    expect(nav.current.route.name).toBe('trades');
    expect(h.entries().at(-1)?.url).toBe('/trades');
    expect(screens()).toBe(1);
  });

  it('ほかの URL への戻るは画面の行き来（router が描き直す）', () => {
    const { h, nav, screens } = setup();
    nav.push('/trades');
    h.back();
    h.flush();
    expect(nav.current.route.name).toBe('record');
    expect(nav.current.via).toBe('pop');
    expect(screens()).toBe(2);
  });

  it('B1: 層を積んでいる間は今の項目を manual にし、UI で閉じても戻るで閉じても窓のスクロールの位置を戻さない。0 段に戻ったら auto', () => {
    const { h, layers } = setup();
    layers.open('a', () => {});
    h.flush();
    expect(h.sr).toBe('manual');
    layers.close('a');
    h.flush();
    expect(h.restores).toBe(0);
    expect(h.sr).toBe('auto');
    layers.open('a', () => {});
    h.flush();
    h.back();
    h.flush();
    expect(h.restores).toBe(0);
    expect(h.sr).toBe('auto');
  });

  it('B1: たどった段を積んでいる間も manual。1 つずつ戻っても位置を戻さない', () => {
    const { h, layers } = setup();
    const closed: string[] = [];
    layers.open('a', () => closed.push('a'));
    h.flush();
    layers.open('a~1', () => closed.push('a~1'));
    h.flush();
    layers.open('a~2', () => closed.push('a~2'));
    h.flush();
    expect(h.index).toBe(3);
    for (const want of ['a~2', 'a~1', 'a']) {
      h.back();
      h.flush();
      expect(closed.at(-1)).toBe(want);
    }
    expect(h.index).toBe(0);
    expect(h.restores).toBe(0);
    expect(h.sr).toBe('auto');
  });

  it('層を開いたまま画面を移ると、移る前に今の項目を auto に戻す（画面の行き来の戻るの位置の復元は今までどおり）', () => {
    const { h, layers, nav } = setup();
    layers.open('a', () => {});
    h.flush();
    nav.push('/trades');
    expect(h.sr).toBe('auto');
    expect(h.entries().at(-1)?.url).toBe('/trades');
  });

  it('N3 a: 層の段（back > 0）の項目で起動・再読み込みしたら、その印を外す（後の戻るが空振りしない）', () => {
    const { h, layers } = setup('/record', { back: 1 });
    expect(h.state()).toEqual({ back: 0 });
    expect(layers.depth()).toBe(0);
  });

  it('B2（再レビュー）: 層を開いたまま画面を移って戻ると、元の画面の項目は auto に戻る（以後の戻るで位置が復元される）', () => {
    const { h, layers, nav } = setup();
    layers.open('a', () => {});
    h.flush();
    layers.open('a~1', () => {});
    h.flush();
    expect(h.srAt(0)).toBe('manual');
    // 開いたまま一覧へ（部品が外れる）
    nav.push('/trades');
    layers.close('a~1');
    layers.close('a');
    h.flush();
    // 戻る: 段の項目に着き、go で元の項目へ下りる
    h.back();
    h.flush();
    expect(h.index).toBe(0);
    expect(nav.current.route.name).toBe('record');
    expect(h.srAt(0)).toBe('auto');
    // その後、もう一度一覧へ移って戻ると位置が復元される（着いた項目が auto）
    const before = h.restores;
    nav.push('/trades');
    h.back();
    h.flush();
    expect(h.index).toBe(0);
    expect(h.restores).toBe(before + 1);
  });

  it('B2: manual のまま残った段 0 の項目で起動・再読み込みしても auto に戻す', () => {
    const h = fakeHistory('/record', null);
    h.back_.setScrollRestoration('manual');
    createBackLayers(h.back_);
    expect(h.sr).toBe('auto');
  });

  it('B2: 層の段（back > 0）の項目で再読み込み → 印を外し、その項目も下の元の項目も、戻った後は auto', () => {
    const h = fakeHistory('/record', null);
    h.back_.setScrollRestoration('manual');
    h.back_.pushState({ back: 1 });
    const layers = createBackLayers(h.back_);
    createNavigator(h.nav, { dev: false }, { onNavigate: () => layers.reset() });
    expect(h.state()).toEqual({ back: 0 });
    expect(h.sr).toBe('auto');
    h.back();
    h.flush();
    expect(h.index).toBe(0);
    expect(h.srAt(0)).toBe('auto');
  });

  it('B3（再レビュー 3）: 層を開いたまま削除（一覧へ置き換え）→ 段を戻してから置き換える。戻るで削除した取引へ戻らない', () => {
    const { h, layers, nav } = setup('/trades');
    nav.push('/trades/t1');
    layers.open('a', () => {});
    h.flush();
    layers.open('a~1', () => {});
    h.flush();
    expect(h.index).toBe(3);
    nav.replace('/trades');
    // 置き換えは段を戻し終えてから
    expect(nav.current.route.name).toBe('trade');
    h.flush();
    expect(nav.current.route.name).toBe('trades');
    expect(h.entries().map((e) => e.url)).toEqual(['/trades', '/trades']);
    expect(h.sr).toBe('auto');
    h.back();
    h.flush();
    expect(h.index).toBe(0);
    expect(nav.current.route.name).toBe('trades');
  });

  it('B3: 層を開いたまま編集を保存（詳細へ置き換え）→ 戻るで編集の画面へ戻らない', () => {
    const { h, layers, nav } = setup('/trades/t1');
    nav.push('/trades/t1/edit');
    layers.open('a', () => {});
    h.flush();
    nav.replace('/trades/t1');
    h.flush();
    expect(h.entries().map((e) => e.url)).toEqual(['/trades/t1', '/trades/t1']);
    expect(nav.current.route.name).toBe('trade');
  });

  it('B3: UI で閉じた直後（go の着地を待っている間）に置き換えても、着いてから置き換える', () => {
    const { h, layers, nav } = setup('/trades');
    nav.push('/trades/t1');
    layers.open('a', () => {});
    h.flush();
    layers.close('a');
    // 後始末だけ流し、go の popstate はまだ届いていない
    h.flushOne();
    nav.replace('/trades');
    h.flush();
    expect(h.entries().map((e) => e.url)).toEqual(['/trades', '/trades']);
  });

  it('B3: 層が無ければすぐ置き換える（今までどおり）', () => {
    const { h, nav } = setup('/trades/t1');
    nav.replace('/trades');
    expect(nav.current.route.name).toBe('trades');
    expect(h.entries().map((e) => e.url)).toEqual(['/trades']);
  });
});
