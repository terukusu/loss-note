// AI の利用状況（Issue #62）の通信と状態。DOM を持たない。部品（components/AiUsage.tsx）は購読して描くだけ。
// - 開いたら GET /api/ai-usage を 1 回読む。失敗は決まった文言だけ（応答の本文・例外の文字列を持たない）
// - 401・ログインしていない = ログインが切れた。ほか（503・形の違う本文・通信の失敗）は読み込めなかった
// - 読み込み中に重ねて呼ばれたら同じ Promise を返す（二重に送らない）。状態は記憶の中だけ
import {
  type AiUsageBody,
  parseAiUsage,
  USAGE_LOAD_FAILED,
  type UsageView,
  usageView,
} from './ai-usage';
import { type ApiFn, AUTH_EXPIRED, createRequest, getJson, kindOf } from './request';

export const AI_USAGE_PATH = '/api/ai-usage';

export type AiUsageState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly view: UsageView }
  | { readonly phase: 'failed'; readonly text: string; readonly auth: boolean };

export interface AiUsageController {
  getState(): AiUsageState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: AiUsageState) => void): () => void;
  load(): Promise<void>;
}

export function createAiUsageController(deps: { readonly api: ApiFn }): AiUsageController {
  const request = createRequest(deps.api);
  let state: AiUsageState = { phase: 'loading' };
  const subs = new Set<(s: AiUsageState) => void>();
  let running: Promise<void> | null = null;

  const set = (next: AiUsageState) => {
    state = next;
    for (const fn of subs) fn(state);
  };

  const run = async () => {
    set({ phase: 'loading' });
    try {
      const body = parseAiUsage(await getJson<unknown>(await request(AI_USAGE_PATH), 200));
      if (body === null) throw new Error('shape');
      set({ phase: 'ready', view: usageView(body as AiUsageBody) });
    } catch (e) {
      const auth = kindOf(e) === 'auth';
      set({ phase: 'failed', text: auth ? AUTH_EXPIRED : USAGE_LOAD_FAILED, auth });
    }
  };

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    load() {
      if (running) return running;
      running = run().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
