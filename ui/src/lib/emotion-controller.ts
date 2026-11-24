// 心理のタグの付け外しの通信と状態（#156・設計書 9.4・ADR-0022）。DOM なし。保存の後のシートと詳細のシートが使う。
// - 押すと集合をすぐ見せて送る（押した時点で保存。R5）。送るのは集合（PUT /api/trade-emotions。取引の集合ごと置き換え）
// - 要求は 1 本ずつ。送っている間に押されたら、終わった後に最新の集合を 1 本だけ送る（後に届いた古い集合で上書きしない）
// - 失敗したら、待っている送りを捨てて最後に保存できた集合へ戻し、決まった文言を出す（AC-7）。押し直しても通らない失敗
//   （取引が消えた 404・この版の知らない形の 409）は別の文言。時間切れで打ち切ったが API では書けていた場合は、画面だけ前の
//   集合に戻る（次に押すと集合ごと送るので揃い、詳細を開き直せば保存された値が出る）
// - シートを閉じても送りは続く（controller は画面の hook の層が画面の間だけ持つ）。dispose の後は知らせない
import { type EmotionTagId, normalizeEmotions, toggleEmotion } from '../../../core/emotion-tags';
import { EMOTION_SAVE_FAILED, EMOTION_SAVE_GONE } from './emotion-tags';
import {
  AUTH_EXPIRED,
  type FailureKind,
  getJson,
  JSON_HEADERS,
  kindOf,
  type RequestFn,
} from './request';

export const EMOTIONS_PATH = '/api/trade-emotions';

export interface EmotionState {
  /** 画面に見せる集合（押した直後の値。一覧の順） */
  readonly selected: readonly EmotionTagId[];
  /** 最後に保存できた集合 */
  readonly saved: readonly EmotionTagId[];
  /** シートを開いたとき（controller を作ったとき）に付いていた集合。選択肢に出さない設定でも並べる（外せるように。#163 R3） */
  readonly opened: readonly EmotionTagId[];
  readonly sending: boolean;
  /** 失敗の文言（決まった文言だけ） */
  readonly error: string | null;
  readonly errorKind?: FailureKind;
}

export interface EmotionController {
  getState(): EmotionState;
  subscribe(fn: (s: EmotionState) => void): () => void;
  /** チップを押した（付ける / 外す。平常心は排他） */
  toggle(id: EmotionTagId): void;
  /** 画面を離れた: 以後は知らせない（送っている要求は止めない） */
  dispose(): void;
}

/** 押し直しても通らない失敗（404・409） */
class Gone extends Error {}

const same = (a: readonly EmotionTagId[], b: readonly EmotionTagId[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function createEmotionController(deps: {
  readonly request: RequestFn;
  /** 付ける取引（保存の後は同じ明細から保存した行すべて、詳細は 1 件） */
  readonly tradeIds: readonly string[];
  readonly initial: readonly EmotionTagId[];
  /** 保存できたとき（詳細の取引・保存の後の取引に写す） */
  readonly onSaved?: (tags: readonly EmotionTagId[]) => void;
}): EmotionController {
  const listeners = new Set<(s: EmotionState) => void>();
  const initial = normalizeEmotions(deps.initial);
  let state: EmotionState = {
    selected: initial,
    saved: initial,
    opened: initial,
    sending: false,
    error: null,
  };
  let disposed = false;

  const set = (patch: Partial<EmotionState>, dropKind = false) => {
    const next = { ...state, ...patch };
    if (dropKind) delete (next as { errorKind?: FailureKind }).errorKind;
    state = next;
    if (disposed) return;
    for (const fn of listeners) fn(state);
  };

  const pump = async (): Promise<void> => {
    if (state.sending || same(state.selected, state.saved)) return;
    const sent = state.selected;
    set({ sending: true });
    try {
      const res = await deps.request(EMOTIONS_PATH, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tradeIds: deps.tradeIds, tags: sent }),
      });
      if (res.status === 404 || res.status === 409) throw new Gone();
      const body = await getJson<{ tags?: unknown }>(res, 200);
      const saved = normalizeEmotions(body?.tags);
      set({ saved, sending: false });
      if (!disposed) deps.onSaved?.(saved);
      void pump();
    } catch (e) {
      const kind = kindOf(e);
      set({
        selected: state.saved,
        sending: false,
        error:
          kind === 'auth'
            ? AUTH_EXPIRED
            : e instanceof Gone
              ? EMOTION_SAVE_GONE
              : EMOTION_SAVE_FAILED,
        errorKind: kind,
      });
    }
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
    toggle(id) {
      if (disposed) return;
      set({ selected: toggleEmotion(state.selected, id), error: null }, true);
      void pump();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
