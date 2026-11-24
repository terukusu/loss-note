// Good / More の付け外しの通信と状態（#123・設計書 9.4・ADR-0024）。DOM なし。詳細のシートが使う（保存の後のシートは Issue 220）。
// 心理のタグの controller（emotion-controller.ts）と同じ規則:
// - チップを押す・行を足す・消すと、その時点の Good / More をすぐ見せて送る（PUT /api/trade-reflections。取引の集合ごと置き換え）
// - 要求は 1 本ずつ。送っている間に変えたら、終わった後に最新の値を 1 本だけ送る（後に届いた古い値で上書きしない）
// - 失敗したら最後に保存できた値へ戻し、決まった文言を出す（404・409 は押し直しても通らないので別の文言）
// - 書きかけの文字（「自分で書く」の欄）と、足せない理由も持つ。足せたら欄を空にする。失敗で戻っても書きかけは消さない
// - シートを閉じても送りは続く。dispose の後は知らせない
import {
  addNote,
  EMPTY_REFLECTION,
  type NoteIssue,
  normalizeReflection,
  type Reflection,
  type ReflectionSide,
  type ReflectionTopicId,
  removeNote,
  sameReflection,
  toggleTopic,
} from '../../../core/reflection';
import { REFLECTION_SAVE_FAILED, REFLECTION_SAVE_GONE } from './reflection';
import {
  AUTH_EXPIRED,
  type FailureKind,
  getJson,
  JSON_HEADERS,
  kindOf,
  type RequestFn,
} from './request';

export const REFLECTIONS_PATH = '/api/trade-reflections';

type PerSide<T> = { readonly good: T; readonly more: T };

export interface ReflectionState {
  /** 画面に見せる値（押した・足した直後の値） */
  readonly value: Reflection;
  /** 最後に保存できた値 */
  readonly saved: Reflection;
  /** 「自分で書く」の欄の書きかけ */
  readonly drafts: PerSide<string>;
  /** 行を足せない理由（欄の下に出す。打ち直すと消える） */
  readonly noteIssues: PerSide<NoteIssue | 'full' | null>;
  readonly sending: boolean;
  /** 保存の失敗の文言（決まった文言だけ） */
  readonly error: string | null;
  readonly errorKind?: FailureKind;
}

export interface ReflectionController {
  getState(): ReflectionState;
  subscribe(fn: (s: ReflectionState) => void): () => void;
  toggle(side: ReflectionSide, id: ReflectionTopicId): void;
  setDraft(side: ReflectionSide, text: string): void;
  /** 書きかけを行として足す（足せなければ理由を出し、送らない） */
  addNote(side: ReflectionSide): void;
  removeNote(side: ReflectionSide, index: number): void;
  /**
   * ［完了］: 書きかけ（空白だけでない欄）を行として足す。足せない欄があれば理由を出して false（シートを閉じない）。
   * 書きかけを黙って捨てない（閉じた後に残っていると思わせない）
   */
  commitDrafts(): boolean;
  dispose(): void;
}

class Gone extends Error {}

const withSide = <T>(x: PerSide<T>, side: ReflectionSide, v: T): PerSide<T> =>
  side === 'good' ? { good: v, more: x.more } : { good: x.good, more: v };

export function createReflectionController(deps: {
  readonly request: RequestFn;
  /** 付ける取引（詳細は 1 件。保存の後のシートは同じ明細から保存した行すべて = Issue 220） */
  readonly tradeIds: readonly string[];
  readonly initial: unknown;
  /** 保存できたとき（詳細の取引に写す） */
  readonly onSaved?: (r: Reflection) => void;
}): ReflectionController {
  const listeners = new Set<(s: ReflectionState) => void>();
  const initial = deps.initial === undefined ? EMPTY_REFLECTION : normalizeReflection(deps.initial);
  let state: ReflectionState = {
    value: initial,
    saved: initial,
    drafts: { good: '', more: '' },
    noteIssues: { good: null, more: null },
    sending: false,
    error: null,
  };
  let disposed = false;

  const set = (patch: Partial<ReflectionState>, dropKind = false) => {
    const next = { ...state, ...patch };
    if (dropKind) delete (next as { errorKind?: FailureKind }).errorKind;
    state = next;
    if (disposed) return;
    for (const fn of listeners) fn(state);
  };

  const pump = async (): Promise<void> => {
    if (state.sending || sameReflection(state.value, state.saved)) return;
    const sent = state.value;
    set({ sending: true });
    try {
      const res = await deps.request(REFLECTIONS_PATH, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tradeIds: deps.tradeIds, good: sent.good, more: sent.more }),
      });
      if (res.status === 404 || res.status === 409) throw new Gone();
      const body = await getJson<unknown>(res, 200);
      const saved = normalizeReflection(body);
      set({ saved, sending: false });
      if (!disposed) deps.onSaved?.(saved);
      void pump();
    } catch (e) {
      const kind = kindOf(e);
      set({
        value: state.saved,
        sending: false,
        error:
          kind === 'auth'
            ? AUTH_EXPIRED
            : e instanceof Gone
              ? REFLECTION_SAVE_GONE
              : REFLECTION_SAVE_FAILED,
        errorKind: kind,
      });
    }
  };

  const change = (value: Reflection) => {
    set({ value, error: null }, true);
    void pump();
  };

  const add = (side: ReflectionSide) => {
    if (disposed) return;
    const res = addNote(state.value, side, state.drafts[side]);
    if (res.issue !== null) {
      set({ noteIssues: withSide(state.noteIssues, side, res.issue) });
      return;
    }
    set({
      drafts: withSide(state.drafts, side, ''),
      noteIssues: withSide(state.noteIssues, side, null),
    });
    change(res.value);
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
    toggle(side, id) {
      if (disposed) return;
      change(toggleTopic(state.value, side, id));
    },
    setDraft(side, text) {
      if (disposed) return;
      set({
        drafts: withSide(state.drafts, side, text),
        noteIssues: withSide(state.noteIssues, side, null),
      });
    },
    addNote(side) {
      add(side);
    },
    removeNote(side, index) {
      if (disposed) return;
      change(removeNote(state.value, side, index));
    },
    commitDrafts() {
      if (disposed) return true;
      let ok = true;
      for (const side of ['good', 'more'] as const) {
        if (state.drafts[side].trim() === '') continue;
        add(side);
        if (state.noteIssues[side] !== null) ok = false;
      }
      return ok;
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
