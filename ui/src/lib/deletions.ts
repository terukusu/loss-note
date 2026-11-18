// 取引を消す + [元に戻す]（Issue #9 契約 U-4。ADR-0007・docs/ui-guidelines.md P4・設計書 9.1）。DOM を持たない。
// - [消す] は確認を挟まずに、その取引をアプリの中の「消した印」（hidden）に入れて一覧・ホーム・詳細・直すから隠し、
//   トースト「取引を消しました」と [元に戻す] を出す。DELETE は取り消しの時間（undoMs = 8 秒）が過ぎてから 1 回だけ送る
// - [元に戻す] は印を外すだけ（要求を送らない。同じ ID・同じチャートのまま）
// - トーストにフォーカス・ポインタがある間は時間を止め（hold）、離れたら undoMs で置き直す（resume。WCAG 2.2.1）
// - 次の [消す]・ログアウト・タブが隠れた（flush）・トーストを閉じた（dismiss）ときは、待っている削除をすぐ送る
//   （keepalive。タブを閉じても届きやすくする）。届かなければ取引は残る（消える側に倒れない。ADR-0007）
// - 送り始めたら [元に戻す] のトーストは閉じる（押しても戻せない [元に戻す] を出さない）
// - DELETE が 204 / 404 なら消えたまま（このセッションの間は隠す）。ほかの失敗は印を外して戻し、失敗の決まった文言を出す。
//   失敗の知らせは [元に戻す] のトーストとは別に出す（次に消した取引の [元に戻す] を置き換えない）
// - ログアウトの後は reset で印と知らせを空にする（次の利用者に前の利用者の知らせを見せない）
// - 状態は記憶の中だけ（端末の保存先に書かない）。応答の本文・例外の文字を持たない
import { type ApiFn, createRequest } from './request';

/** 取り消しの時間（ミリ秒） */
export const UNDO_MS = 8_000;

export const TOAST_TEXT = {
  deleted: (label: string) => (label ? `${label} を削除しました` : '取引を削除しました'),
  failed: '削除できませんでした。もう一度 [削除] を押してください。',
} as const;

/** [元に戻す] を待っている取引（label = どの取引かが分かる短い名前。例: US30 L 11/09） */
export type ToastState = null | { readonly id: string; readonly label: string };

export interface DeletionsState {
  readonly hidden: ReadonlySet<string>;
  readonly toast: ToastState;
  /** 送った削除が失敗した（印を外して戻した）知らせ */
  readonly failed: boolean;
}

export type TimerId = unknown;

export interface DeletionsDeps {
  readonly api: ApiFn;
  readonly setTimer: (fn: () => void, ms: number) => TimerId;
  readonly clearTimer: (id: TimerId) => void;
  readonly undoMs?: number;
}

export interface Deletions {
  getState(): DeletionsState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: DeletionsState) => void): () => void;
  /** [消す]: 確認なしで隠し、取り消しの時間の後に DELETE を送る */
  remove(id: string, label?: string): void;
  /** [元に戻す]: 待っている削除をやめて印を外す（何も送らない） */
  undo(): void;
  /** トーストにフォーカス・ポインタがある: 時間を止める */
  hold(): void;
  /** 離れた: 取り消しの時間を置き直す */
  resume(): void;
  /** 待っている削除をすぐ送る（タブが隠れた・ログアウト・次の [消す]） */
  flush(): Promise<void>;
  /** [元に戻す] のトーストを閉じる（待っている削除はすぐ送る） */
  dismiss(): void;
  /** 失敗の知らせを閉じる（待っている削除は送らない） */
  dismissFailed(): void;
  /** ログアウトの後: 印・知らせを空にする（待っている削除は呼ぶ前に flush で送る） */
  reset(): void;
}

export function createDeletions(deps: DeletionsDeps): Deletions {
  const undoMs = deps.undoMs ?? UNDO_MS;
  const request = createRequest(deps.api);
  const listeners = new Set<(s: DeletionsState) => void>();
  let state: DeletionsState = { hidden: new Set(), toast: null, failed: false };
  /** 取り消しを待っている取引の ID */
  let pending: string | null = null;
  let timer: TimerId | null = null;
  let held = false;

  const set = (patch: Partial<DeletionsState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };
  const stopTimer = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const startTimer = () => {
    stopTimer();
    timer = deps.setTimer(() => {
      timer = null;
      void flush();
    }, undoMs);
  };
  const without = (id: string): Set<string> => {
    const next = new Set(state.hidden);
    next.delete(id);
    return next;
  };

  /** 1 件の DELETE（204 / 404 = 消えた。ほか = 戻す） */
  const send = async (id: string): Promise<void> => {
    let ok = false;
    try {
      const res = await request(`/api/trades/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        keepalive: true,
      });
      ok = res.status === 204 || res.status === 404;
    } catch {
      ok = false;
    }
    if (ok) return;
    // 失敗の知らせは別に出す（今の [元に戻す] のトースト = 次に消した取引のものは残す）
    set({ hidden: without(id), failed: true });
  };

  const flush = (): Promise<void> => {
    stopTimer();
    held = false;
    const id = pending;
    pending = null;
    if (id === null) return Promise.resolve();
    // 送り始めたら [元に戻す] は効かないので、トーストを閉じる
    if (state.toast?.id === id) set({ toast: null });
    return send(id);
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    remove(id, label = '') {
      if (pending === id || state.hidden.has(id)) return;
      // 前に待っている削除はすぐ送る（同時に待つのは 1 件）
      void flush();
      pending = id;
      const hidden = new Set(state.hidden);
      hidden.add(id);
      set({ hidden, toast: { id, label } });
      startTimer();
    },
    undo() {
      const id = pending;
      if (id === null) return;
      stopTimer();
      pending = null;
      held = false;
      set({ hidden: without(id), toast: null });
    },
    hold() {
      if (pending === null) return;
      held = true;
      stopTimer();
    },
    resume() {
      if (pending === null || !held) return;
      held = false;
      startTimer();
    },
    flush,
    dismiss() {
      if (pending !== null) {
        void flush();
        return;
      }
      if (state.toast !== null) set({ toast: null });
    },
    dismissFailed() {
      if (state.failed) set({ failed: false });
    },
    reset() {
      stopTimer();
      held = false;
      pending = null;
      set({ hidden: new Set(), toast: null, failed: false });
    },
  };
}
