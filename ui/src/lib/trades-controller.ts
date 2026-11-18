// 取引の一覧・ホームの通信と状態（Issue #9 契約 U-1）。DOM を持たず、画面（pages/Trades.tsx・Home.tsx）は購読して描くだけ。
// 開いたら取引・銘柄・口座（#47。行に口座の名前を出すか）を並行に読む（全件。ページ分けは別 Issue）。
// 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）。
// 消した印（[元に戻す] を待つ取引）で隠すのは画面の側（deletions.ts の hidden を visibleTrades に通す）
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import {
  type ApiFn,
  AUTH_EXPIRED,
  createRequest,
  Failed,
  type FailureKind,
  getJson,
  kindOf,
  REQUEST_TIMEOUT_MS,
} from './request';

export const TRADES_LOAD_FAILED =
  '取引を読み込めませんでした。通信を確かめて、もう一度読み込んでください。';

export type TradesState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'loadFailed'; readonly error: string; readonly errorKind: FailureKind }
  | {
      readonly phase: 'ready';
      readonly trades: readonly StoredTrade[];
      readonly instruments: readonly InstrumentRecord[];
      readonly accounts: readonly AccountRecord[];
    };

export interface TradesController {
  getState(): TradesState;
  subscribe(fn: (s: TradesState) => void): () => void;
  load(): Promise<void>;
  /** 画面を離れた（後で届いた応答を捨てる） */
  dispose(): void;
}

export function createTradesController(deps: {
  readonly api: ApiFn;
  readonly timeoutMs?: number;
}): TradesController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: TradesState) => void>();
  let state: TradesState = { phase: 'loading' };
  let gen = 0;
  const set = (s: TradesState) => {
    state = s;
    for (const fn of listeners) fn(state);
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
    async load() {
      const my = ++gen;
      set({ phase: 'loading' });
      try {
        const [t, i, a] = await Promise.all([
          request('/api/trades').then((r) => getJson<{ items: StoredTrade[] }>(r, 200)),
          request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
          request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
        ]);
        if (!Array.isArray(t?.items) || !Array.isArray(i?.items) || !Array.isArray(a?.items)) {
          throw new Failed('other');
        }
        if (my !== gen) return;
        set({ phase: 'ready', trades: t.items, instruments: i.items, accounts: a.items });
      } catch (e) {
        if (my !== gen) return;
        const kind = kindOf(e);
        set({
          phase: 'loadFailed',
          error: kind === 'auth' ? AUTH_EXPIRED : TRADES_LOAD_FAILED,
          errorKind: kind,
        });
      }
    },
    dispose() {
      gen++;
      listeners.clear();
    },
  };
}
