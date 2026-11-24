// 心理のタグの選択肢の設定（#163・ADR-0023）の通信と状態。DOM なし。設定の画面「心理のタグ」と、心理を付けるシートの選択肢
// （保存の後・詳細）、設定の根の添えが使う。
// - 開いたら GET /api/settings/emotion-tags を 1 回読む（応答は出さないタグの集合）。失敗は決まった文言だけ
// - 押すと集合をすぐ見せて送る（押した時点で保存。シートの心理と同じ作法）。送るのは「出さない」集合の全体（置き換え）
// - 要求は 1 本ずつ。送っている間に押されたら、終わった後に最新の集合を 1 本だけ送る（後に届いた古い集合で上書きしない）
// - 失敗したら待っている送りを捨てて、最後に保存できた集合へ戻し、決まった文言を出す（AC-7）
// - 読めない・読み込み中の「出さない」集合は空として扱う（すべて出す。R6）のは使う側（hiddenOf）
import { type EmotionTagId, normalizeHidden, toggleHidden } from '../../../core/emotion-tags';
import { EMOTION_CHOICES_LOAD_FAILED, EMOTION_CHOICES_SAVE_FAILED } from './emotion-tags';
import {
  AUTH_EXPIRED,
  type FailureKind,
  getJson,
  JSON_HEADERS,
  kindOf,
  type RequestFn,
} from './request';

export const EMOTION_CHOICES_PATH = '/api/settings/emotion-tags';

export type EmotionChoicesState =
  | { readonly phase: 'loading' }
  | {
      readonly phase: 'failed';
      readonly error: string;
      readonly errorKind: FailureKind;
    }
  | {
      readonly phase: 'ready';
      /** 画面に見せる「出さない」集合（押した直後の値。一覧の順） */
      readonly hidden: readonly EmotionTagId[];
      /** 最後に保存できた集合 */
      readonly saved: readonly EmotionTagId[];
      readonly sending: boolean;
      /** 保存の失敗の文言（決まった文言だけ） */
      readonly error: string | null;
      readonly errorKind?: FailureKind;
    };

export interface EmotionChoicesController {
  getState(): EmotionChoicesState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: EmotionChoicesState) => void): () => void;
  /** 読む（読み込み中に重ねて呼ばれたら同じ Promise を返す） */
  load(): Promise<void>;
  /** 設定の画面でタグを押した（出す / 出さない。平常心は変えない） */
  toggle(id: EmotionTagId): void;
  /** 画面を離れた: 以後は知らせない（送っている要求は止めない） */
  dispose(): void;
}

/** シートに渡す「出さない」集合（読めない・読み込み中 = 空 = すべて出す。R6） */
export function hiddenOf(s: EmotionChoicesState): readonly EmotionTagId[] {
  return s.phase === 'ready' ? s.saved : [];
}

const same = (a: readonly EmotionTagId[], b: readonly EmotionTagId[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function createEmotionChoicesController(deps: {
  readonly request: RequestFn;
}): EmotionChoicesController {
  const listeners = new Set<(s: EmotionChoicesState) => void>();
  let state: EmotionChoicesState = { phase: 'loading' };
  let disposed = false;
  let loading: Promise<void> | null = null;

  const set = (next: EmotionChoicesState) => {
    state = next;
    if (disposed) return;
    for (const fn of listeners) fn(state);
  };

  const parse = (body: { hidden?: unknown } | null) => normalizeHidden(body?.hidden);

  const run = async () => {
    set({ phase: 'loading' });
    try {
      const body = await getJson<{ hidden?: unknown }>(
        await deps.request(EMOTION_CHOICES_PATH),
        200,
      );
      if (!body || !Array.isArray(body.hidden)) throw new Error('shape');
      const hidden = parse(body);
      set({ phase: 'ready', hidden, saved: hidden, sending: false, error: null });
    } catch (e) {
      const kind = kindOf(e);
      set({
        phase: 'failed',
        error: kind === 'auth' ? AUTH_EXPIRED : EMOTION_CHOICES_LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  const pump = async (): Promise<void> => {
    const s = state;
    if (s.phase !== 'ready' || s.sending || same(s.hidden, s.saved)) return;
    const sent = s.hidden;
    set({ ...s, sending: true });
    try {
      const res = await deps.request(EMOTION_CHOICES_PATH, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ hidden: sent }),
      });
      const saved = parse(await getJson<{ hidden?: unknown }>(res, 200));
      if (state.phase !== 'ready') return;
      set({ ...state, saved, sending: false });
      void pump();
    } catch (e) {
      if (state.phase !== 'ready') return;
      const kind = kindOf(e);
      set({
        phase: 'ready',
        hidden: state.saved,
        saved: state.saved,
        sending: false,
        error: kind === 'auth' ? AUTH_EXPIRED : EMOTION_CHOICES_SAVE_FAILED,
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
    load() {
      if (loading) return loading;
      loading = run().finally(() => {
        loading = null;
      });
      return loading;
    },
    toggle(id) {
      const s = state;
      if (disposed || s.phase !== 'ready') return;
      set({
        phase: 'ready',
        hidden: toggleHidden(s.hidden, id),
        saved: s.saved,
        sending: s.sending,
        error: null,
      });
      void pump();
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
