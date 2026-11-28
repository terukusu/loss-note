// 両建てのまとまりを解く + [元に戻す]（#267・設計書 7.7・ADR-0007 の形）。DOM を持たない。アプリの殻に 1 つ（画面を移っても戻せる）。
// - ［解く］ は確認を挟まずに DELETE を送り（まとまりの画面の controller）、解けたらここに「解いたまとまりの本文」（メンバーと役割・
//   決済の上書き）を預けて、トースト「両建てを解きました」と [元に戻す] を出す
// - [元に戻す] は預けた本文で POST /api/position-groups を送り、上書きごと結び直す（新しいまとまりの ID で殻がその画面へ移る）。
//   取り消しの時間（UNDO_MS = 8 秒）が過ぎたら預けた本文を捨てる。フォーカス・ポインタ・下のシートの間は時間を止める（deletions と同じ）
// - 結び直せなかった（メンバーをほかで結んだ・消した・通信）ときは失敗の決まった文言（応答の本文・例外の文字を持たない）
// - 状態は記憶の中だけ（端末の保存先に書かない）。ログアウトで reset
import type { PositionGroupBody } from '../../../core/record';
import { type HoldReason, holdReason, type TimerId, UNDO_MS } from './deletions';
import { GROUPS_PATH } from './position-group';
import { type ApiFn, createRequest, JSON_HEADERS } from './request';

export const UNLINK_TOAST_TEXT = {
  done: (label: string) => (label ? `${label} の両建てを解きました` : '両建てを解きました'),
  failed: '結び直せませんでした。取引の詳細から、もう一度 ［両建てに結ぶ］ を押してください。',
} as const;

/** [元に戻す] を待っているまとまり（label = どのまとまりか。例: 両建て · US30 L） */
export type UnlinkToast = null | { readonly label: string };

export interface UnlinksState {
  readonly toast: UnlinkToast;
  /** 結び直しを送っている */
  readonly sending: boolean;
  readonly failed: boolean;
}

export interface Unlinks {
  getState(): UnlinksState;
  subscribe(fn: (s: UnlinksState) => void): () => void;
  /** 解けた: 本文を預けてトーストを出す */
  done(label: string, body: PositionGroupBody): void;
  /** [元に戻す]: 預けた本文で結び直す。結び直せたら新しいまとまりの ID、だめなら null */
  undo(): Promise<string | null>;
  hold(reason?: HoldReason): void;
  resume(reason?: HoldReason): void;
  dismiss(): void;
  dismissFailed(): void;
  reset(): void;
}

export function createUnlinks(deps: {
  readonly api: ApiFn;
  readonly setTimer: (fn: () => void, ms: number) => TimerId;
  readonly clearTimer: (id: TimerId) => void;
  readonly undoMs?: number;
}): Unlinks {
  const undoMs = deps.undoMs ?? UNDO_MS;
  const request = createRequest(deps.api);
  const listeners = new Set<(s: UnlinksState) => void>();
  let state: UnlinksState = { toast: null, sending: false, failed: false };
  let body: PositionGroupBody | null = null;
  let timer: TimerId | null = null;
  const holds = new Set<HoldReason>();
  const set = (patch: Partial<UnlinksState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };
  const stop = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const expire = () => {
    stop();
    body = null;
    set({ toast: null });
  };
  const arm = () => {
    stop();
    if (state.toast && holds.size === 0) timer = deps.setTimer(expire, undoMs);
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
    done(label, b) {
      body = b;
      set({ toast: { label }, failed: false });
      arm();
    },
    async undo() {
      const b = body;
      if (!b || state.sending) return null;
      stop();
      set({ sending: true });
      try {
        const res = await request(GROUPS_PATH, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(b),
        });
        if (res.status !== 201) throw new Error('relink');
        const saved = (await res.json()) as { id?: unknown };
        if (typeof saved?.id !== 'string') throw new Error('relink');
        body = null;
        set({ toast: null, sending: false });
        return saved.id;
      } catch {
        body = null;
        set({ toast: null, sending: false, failed: true });
        return null;
      }
    },
    hold(reason) {
      holds.add(holdReason(reason));
      stop();
    },
    resume(reason) {
      holds.delete(holdReason(reason));
      arm();
    },
    dismiss() {
      expire();
    },
    dismissFailed() {
      set({ failed: false });
    },
    reset() {
      stop();
      body = null;
      holds.clear();
      set({ toast: null, sending: false, failed: false });
    },
  };
}
