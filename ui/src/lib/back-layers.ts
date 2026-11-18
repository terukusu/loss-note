// 開いて閉じる層（「i」の吹き出し。後の説明カード・確かめも同じ部品に乗る）を、戻るで一番上から 1 つ閉じる糊（Issue #57）。
// 規則は back-stack.ts の純関数。履歴は BackEnv で差し替えられる（テストは偽物、main.tsx だけが実物の window を渡す）。
// - 層が開くと履歴に 1 段積む（URL を変えない。history.state.back）。戻るでその段から下りたら層を閉じる（Esc と同じ閉じ方）
// - 層を UI（もう一度押す・Esc・外側を押す）で閉じたら、積んだ段を history.go で戻して数を合わせる
// - 履歴の操作は後始末（defer 0 で 1 回）にまとめる
// - 画面の行き来（router.tsx の push / replace・ほかの URL への戻る）では reset で層の記録を捨てる（閉じた層の段を
//   go で戻さない = 画面を戻さない）。router は URL の変わらない popstate（層の段の出入り）では画面を変えない
import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  BACK_INITIAL,
  type BackEffect,
  type BackEvent,
  backOf,
  backReduce,
  backTop,
} from './back-stack';

/** 履歴の最小限 */
export interface BackEnv {
  /** 今の history.state */
  readState(): unknown;
  /** URL を変えずに 1 段積む（失敗は例外） */
  pushState(state: Readonly<Record<string, unknown>>): void;
  /** 今の項目の state を置き換える（URL を変えない） */
  replaceState(state: Readonly<Record<string, unknown>>): void;
  /**
   * 今の項目のスクロールの復元の仕方（history.scrollRestoration）。段を積んでいる間は manual にして、層の段の出入りで
   * ブラウザが窓のスクロールの位置を戻さないようにする（#57 レビュー B1）。積む段は今の項目の値を引き継ぐ
   */
  setScrollRestoration(mode: 'auto' | 'manual'): void;
  /** 今の項目のスクロールの復元の仕方（項目ごとの値。糊は変数で覚えず、毎回これを読む。#57 再レビュー B2） */
  readScrollRestoration(): 'auto' | 'manual';
  go(n: number): void;
  /** 戻る・進む（popstate）の購読。届いた state を渡す。やめる関数を返す */
  onPopState(fn: (state: unknown) => void): () => void;
  /** 利用者の操作の中か（navigator.userActivation.isActive。操作の外で開いた層は履歴に積まない） */
  userActive(): boolean;
  /** ms 後に呼ぶ。取り消す関数を返す */
  defer(fn: () => void, ms: number): () => void;
}

export interface BackLayers {
  /** 層を開く（同じ id が開いていれば閉じ方だけ替える）。onClose は戻るで閉じるときの閉じ方 */
  open(id: string, onClose: () => void): void;
  /** 層を閉じる（UI で閉じた・アンマウント）。戻るで既に外れていれば何もしない */
  close(id: string): void;
  /** 画面が移った: 層の記録を捨てる（履歴は動かさない） */
  reset(): void;
  /**
   * 画面を置き換える前（router の replace）: 積んだ段を go で戻し、元の項目に着いてから done を呼ぶ（true を返す）。段が無ければ
   * 何もせず false（呼ぶ側がすぐ置き換える）。置き換えで段の項目だけが置き換わり、元の画面（削除した取引・保存し終えた編集）が
   * 履歴に残るのを防ぐ（#57 再レビュー B3）
   */
  unwind(done: () => void): boolean;
  /** 一番上の層の id */
  top(): string | null;
  /** 履歴に積んでいる段の数（テスト・検査用） */
  depth(): number;
  dispose(): void;
}

/** go の popstate が来ないときに保留を解くまでの時間（ms） */
const UNSTICK_MS = 1000;

export function createBackLayers(env: BackEnv): BackLayers {
  let state = BACK_INITIAL;
  const closers = new Map<string, () => void>();
  let cancelSettle: (() => void) | null = null;
  let cancelUnstick: (() => void) | null = null;
  /**
   * 今の項目の scrollRestoration を書く（値は項目ごとなので、変数で覚えずに今の項目の実際の値を読んで比べる。
   * 層を開いたまま画面を移った後、元の項目へ戻ったときにも manual が残らない。#57 再レビュー B2）
   */
  const setMode = (mode: 'auto' | 'manual') => {
    try {
      if (env.readScrollRestoration() !== mode) env.setScrollRestoration(mode);
    } catch {
      // 使えない環境では何もしない
    }
  };
  /** 段がすべて戻り（今の項目が段 0）、層も go の着地の待ちも無ければ、今の項目を auto に戻す */
  const settleScroll = () => {
    if (
      state.hist === 0 &&
      state.awaiting === null &&
      state.layers.length === 0 &&
      backOf(env.readState()) === 0
    )
      setMode('auto');
  };

  const baseState = (): Record<string, unknown> => {
    const s = env.readState();
    return typeof s === 'object' && s !== null ? { ...(s as Record<string, unknown>) } : {};
  };

  const dispatch = (e: BackEvent) => {
    const r = backReduce(state, e);
    state = r.state;
    apply(r.effects);
  };

  const apply = (effects: readonly BackEffect[]) => {
    for (const ef of effects) {
      if (ef.kind === 'push') {
        // 1 段目を積む前に今の項目を manual にする（積む段もそれを引き継ぐ）
        if (ef.back === 1) setMode('manual');
        try {
          env.pushState({ ...baseState(), back: ef.back });
        } catch {
          // 回数の上限など: その段から上を積まない層にする（例外を外へ出さない）
          dispatch({ type: 'pushFailed', back: ef.back });
          return;
        }
      } else if (ef.kind === 'go') {
        env.go(ef.n);
        cancelUnstick?.();
        cancelUnstick = env.defer(() => {
          cancelUnstick = null;
          if (state.awaiting !== null) dispatch({ type: 'unstick' });
        }, UNSTICK_MS);
      } else {
        for (const id of ef.ids) {
          const f = closers.get(id);
          closers.delete(id);
          f?.();
        }
      }
    }
  };

  const scheduleSettle = () => {
    if (cancelSettle) return;
    cancelSettle = env.defer(() => {
      cancelSettle = null;
      dispatch({ type: 'settle' });
      settleScroll();
    }, 0);
  };

  /** unwind の待ち（元の項目に着いたら呼ぶ） */
  let pendingUnwind: (() => void) | null = null;
  const finishUnwind = () => {
    cancelUnstick?.();
    cancelUnstick = null;
    state = BACK_INITIAL;
    setMode('auto');
    const f = pendingUnwind;
    pendingUnwind = null;
    f?.();
  };

  const off = env.onPopState((s) => {
    const back = backOf(s);
    if (pendingUnwind) {
      // 置き換えの前の巻き戻し: 段の項目にまだいれば残りを戻し、元の項目（段 0）に着いたら置き換える
      if (back > 0) env.go(-back);
      else finishUnwind();
      return;
    }
    if (cancelUnstick && state.awaiting !== null && back === state.awaiting) {
      cancelUnstick();
      cancelUnstick = null;
    }
    dispatch({ type: 'popstate', back });
    settleScroll();
    scheduleSettle();
  });

  // 起動・再読み込みの直後: 前に開いていた層の段（back > 0）の項目にいたら、その印を外す（再読み込みの後の戻るが
  // 同じ画面のまま空振りしないように。#57 レビュー N3 a）
  if (backOf(env.readState()) > 0) {
    try {
      env.replaceState({ ...baseState(), back: 0 });
    } catch {
      // 置き換えられなければそのまま
    }
  }
  // 起動・再読み込みの直後も、前に manual のまま残った項目なら auto に戻す
  setMode('auto');

  return {
    open(id, onClose) {
      closers.set(id, onClose);
      dispatch({ type: 'open', id, activation: env.userActive() });
      scheduleSettle();
    },
    close(id) {
      if (!closers.has(id) && !state.layers.some((l) => l.id === id)) return;
      closers.delete(id);
      dispatch({ type: 'close', id });
      scheduleSettle();
    },
    reset() {
      cancelSettle?.();
      cancelSettle = null;
      cancelUnstick?.();
      cancelUnstick = null;
      closers.clear();
      state = BACK_INITIAL;
      setMode('auto');
    },
    unwind(done) {
      cancelSettle?.();
      cancelSettle = null;
      closers.clear();
      const waiting = state.awaiting !== null;
      const at = backOf(env.readState());
      if (!waiting && at === 0) {
        state = BACK_INITIAL;
        setMode('auto');
        return false;
      }
      pendingUnwind = done;
      state = { layers: [], hist: 0, awaiting: 0 };
      // 自分の go の着地を待っている間は重ねて go しない（着いた項目で残りを戻す）
      if (!waiting) env.go(-at);
      cancelUnstick?.();
      // popstate が来ないとき（ブラウザの都合）でも置き換えは止めない
      cancelUnstick = env.defer(() => {
        cancelUnstick = null;
        if (pendingUnwind) finishUnwind();
      }, UNSTICK_MS);
      return true;
    },
    top: () => backTop(state),
    depth: () => state.hist,
    dispose() {
      off();
      cancelSettle?.();
      cancelUnstick?.();
      closers.clear();
    },
  };
}

export function windowBackEnv(win: Window): BackEnv {
  return {
    readState: () => win.history.state,
    // 2 引数（URL を変えない）
    pushState: (s) => win.history.pushState(s, ''),
    replaceState: (s) => win.history.replaceState(s, ''),
    readScrollRestoration: () => win.history.scrollRestoration,
    setScrollRestoration: (m) => {
      win.history.scrollRestoration = m;
    },
    go: (n) => win.history.go(n),
    onPopState: (fn) => {
      const h = (e: PopStateEvent) => fn(e.state);
      win.addEventListener('popstate', h);
      return () => win.removeEventListener('popstate', h);
    },
    userActive: () => win.navigator.userActivation?.isActive ?? false,
    defer: (fn, ms) => {
      const t = win.setTimeout(fn, ms);
      return () => win.clearTimeout(t);
    },
  };
}

/** アプリに 1 つの層の記録（main.tsx が installBackLayers で入れる。入っていない = テスト・部品の見本では何もしない） */
let installed: BackLayers | null = null;

export function installBackLayers(layers: BackLayers | null): void {
  installed?.dispose();
  installed = layers;
}

export function backLayers(): BackLayers | null {
  return installed;
}

/** open の間だけ層を積む。onClose は戻るで閉じるとき（Esc と同じ閉じ方）。最新の onClose を呼ぶ */
export function useBackLayer(id: string, open: boolean, onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useLayoutEffect(() => {
    const layers = installed;
    if (!open || !layers) return;
    layers.open(id, () => ref.current());
    return () => layers.close(id);
  }, [id, open]);
}
