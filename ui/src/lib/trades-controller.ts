// 取引の一覧・ホームの通信と状態（Issue #9 契約 U-1・Issue #87 のページ分け）。DOM を持たず、画面（pages/Trades.tsx・
// Home.tsx）は購読して描くだけ。
// - 開いたら取引の最初の 1 ページ（pageSize 件。決済の新しい順）と銘柄・口座（#47。行に口座の名前を出すか）を並行に読む。
//   全件は読まない（ホームは直近の分だけ、一覧は末尾に近づいたら loadMore で次のページ）
// - 続きの読みの失敗は、読み込み済みの行を残したまま more = failed（決まった文言）。もう一度 loadMore で読み直す
// - cache と restore（戻るで一覧に戻った）があれば、読み込み済みの分をすぐに出し、裏で同じ件数を読み直して差し替える
//   （失敗しても出している分を残す。カーソルは並びの位置なので、残した分の続きもそのまま読める）
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
  type RequestFn,
} from './request';
import {
  appendTrades,
  LIST_PAGE,
  pageOf,
  REFRESH_PAGE,
  type TradePage,
  tradesPath,
} from './trade-pages';
import type { TradesCache } from './trades-cache';

export const TRADES_LOAD_FAILED =
  '取引を読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const TRADES_MORE_FAILED = '続きを読み込めませんでした。通信状況を確認してください。';

/** 続きの読み（idle = まだある・loading = 読んでいる・failed = 失敗した・done = 最後まで読んだ） */
export type MorePhase = 'idle' | 'loading' | 'failed' | 'done';

export type TradesState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'loadFailed'; readonly error: string; readonly errorKind: FailureKind }
  | {
      readonly phase: 'ready';
      readonly trades: readonly StoredTrade[];
      readonly instruments: readonly InstrumentRecord[];
      readonly accounts: readonly AccountRecord[];
      readonly more: MorePhase;
      /** 続きの読みの失敗の文言（more = failed のときだけ） */
      readonly moreError?: string;
      readonly moreErrorKind?: FailureKind;
    };

export interface TradesController {
  getState(): TradesState;
  subscribe(fn: (s: TradesState) => void): () => void;
  load(): Promise<void>;
  /** 読み直す（読めていれば出している分のまま裏で差し替える。読めていなければ load と同じ。タブの押し直し。#127） */
  reload(): Promise<void>;
  /** 次のページを読む（まだあって、読んでいないときだけ。失敗の後はもう一度） */
  loadMore(): Promise<void>;
  /** 画面を離れた（後で届いた応答を捨てる） */
  dispose(): void;
}

/** 取引の 1 ページを読む（形が違えば Failed） */
async function readPage(request: RequestFn, path: string): Promise<TradePage> {
  const page = pageOf(await getJson<unknown>(await request(path), 200));
  if (!page) throw new Failed('other');
  return page;
}

export function createTradesController(deps: {
  readonly api: ApiFn;
  readonly timeoutMs?: number;
  /** 1 ページの件数（一覧 = LIST_PAGE、ホーム = HOME_LIMIT） */
  readonly pageSize?: number;
  /** 読み込み済みの分の入れ物（一覧だけ。trades-cache.ts） */
  readonly cache?: TradesCache | null;
  /** 戻るで開いた: 入れ物の分をすぐに出して、裏で読み直す */
  readonly restore?: boolean;
}): TradesController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const pageSize = deps.pageSize ?? LIST_PAGE;
  const cache = deps.cache ?? null;
  const listeners = new Set<(s: TradesState) => void>();
  let state: TradesState = { phase: 'loading' };
  let next: string | null = null;
  let gen = 0;
  /** 戻ったときの読み直しの間（続きの読みを待たせる） */
  let refreshing = false;
  // 戻るで開いた: 最初の描画から読み込み済みの分を出す（ブラウザの位置の戻しと、画面の位置の戻しが効くように）
  const snap = deps.restore === true ? cache?.get() : null;
  let pendingRefresh = false;
  if (snap) {
    next = snap.next;
    state = {
      phase: 'ready',
      trades: snap.trades,
      instruments: snap.instruments,
      accounts: snap.accounts,
      more: next === null ? 'done' : 'idle',
    };
    pendingRefresh = true;
  }
  const set = (s: TradesState) => {
    state = s;
    if (s.phase === 'ready') {
      cache?.set({ trades: s.trades, instruments: s.instruments, accounts: s.accounts, next });
    }
    for (const fn of listeners) fn(state);
  };
  const ready = (
    trades: readonly StoredTrade[],
    instruments: readonly InstrumentRecord[],
    accounts: readonly AccountRecord[],
  ): TradesState => ({
    phase: 'ready',
    trades,
    instruments,
    accounts,
    more: next === null ? 'done' : 'idle',
  });

  const readOthers = () =>
    Promise.all([
      request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
      request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
    ]).then(([i, a]) => {
      if (!Array.isArray(i?.items) || !Array.isArray(a?.items)) throw new Failed('other');
      return [i.items, a.items] as const;
    });

  /** 戻ったとき: 出している件数まで読み直して差し替える（失敗したら出している分のまま） */
  const refresh = async (my: number, count: number) => {
    refreshing = true;
    try {
      const othersP = readOthers();
      let trades: readonly StoredTrade[] = [];
      let cursor: string | null = null;
      do {
        const page = await readPage(request, tradesPath({ limit: REFRESH_PAGE, cursor }));
        trades = appendTrades(trades, page.items);
        cursor = page.next;
      } while (cursor !== null && trades.length < count);
      const [instruments, accounts] = await othersP;
      if (my !== gen) return;
      next = cursor;
      refreshing = false;
      set(ready(trades, instruments, accounts));
    } catch {
      if (my !== gen) return;
      refreshing = false;
    }
  };

  const self: TradesController = {
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
      refreshing = false;
      if (pendingRefresh && state.phase === 'ready') {
        pendingRefresh = false;
        await refresh(my, state.trades.length);
        return;
      }
      pendingRefresh = false;
      set({ phase: 'loading' });
      try {
        const [page, [instruments, accounts]] = await Promise.all([
          readPage(request, tradesPath({ limit: pageSize })),
          readOthers(),
        ]);
        if (my !== gen) return;
        next = page.next;
        set(ready(page.items, instruments, accounts));
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
    reload() {
      if (state.phase === 'ready') pendingRefresh = true;
      return self.load();
    },
    async loadMore() {
      const s = state;
      // 戻った直後の読み直しの前・間は読まない（読み直しが同じ分を読む。むだな要求を送らない）
      if (s.phase !== 'ready' || refreshing || pendingRefresh || next === null) return;
      if (s.more !== 'idle' && s.more !== 'failed') return;
      const my = gen;
      const cursor = next;
      const { moreError: _e, moreErrorKind: _k, ...rest } = s;
      set({ ...rest, more: 'loading' });
      try {
        const page = await readPage(request, tradesPath({ limit: pageSize, cursor }));
        const cur = state;
        if (my !== gen || cur.phase !== 'ready') return;
        next = page.next;
        set(ready(appendTrades(cur.trades, page.items), cur.instruments, cur.accounts));
      } catch (e) {
        const cur = state;
        if (my !== gen || cur.phase !== 'ready') return;
        const kind = kindOf(e);
        set({
          ...cur,
          more: 'failed',
          moreError: kind === 'auth' ? AUTH_EXPIRED : TRADES_MORE_FAILED,
          moreErrorKind: kind,
        });
      }
    },
    dispose() {
      gen++;
      listeners.clear();
    },
  };
  return self;
}
