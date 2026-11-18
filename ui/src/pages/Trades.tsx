// 取引の一覧（Issue #9 契約 U-1。設計書 9.2）。記録した取引を決済の時刻の新しい順に並べ、各行に判定・R・リスク（%）・
// 銘柄・L / S・決済の日付。行から詳細へ。判定・R・リスクは保存した記録から計算する（記録したときの資金・銘柄の値。C36）。
// ページ分け（Issue #87・ADR-0016）: 最初に 50 件、末尾の印が見えそうになったら（IntersectionObserver）次の 50 件。
// [続きを読み込む] でも読める。読み込み中・失敗（[もう一度読み込む]）・最後まで（「全 N 件」）。戻るで開いたときは
// 読み込み済みの分と位置を殻の入れ物（trades-cache.ts）から戻し、裏で読み直す。
// 3 層: 純関数（lib/trade-view.ts）→ 通信と状態（lib/trades-controller.ts）→ この画面。Trades は hook を持たない
// （App のテストが 1 段だけ呼ぶ）。空の状態は Trades が作って渡す。消した印（[元に戻す] を待つ取引）は隠す
import type { JSX } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, signOutActive } from '../auth/session';
import { Button, buttonClass } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { TradeList, TradeNotes } from '../components/TradeRow';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { NavigatorContext } from '../lib/router';
import { countText, endText, LIST_PAGE, notesWhileLoading } from '../lib/trade-pages';
import { missingNotes, sortTrades, tradeRow, visibleTrades } from '../lib/trade-view';
import { TradesCacheContext } from '../lib/trades-cache';
import {
  createTradesController,
  type TradesController,
  type TradesState,
} from '../lib/trades-controller';

export function Trades() {
  return (
    <>
      <PageHeader title="取引の一覧" description="判定・R・リスクで、計画と実行を並べて見ます。" />
      <TradesScreen
        empty={
          <EmptyState
            icon="list"
            title="まだ取引がありません"
            description="記録した取引がここに並びます。"
          >
            <Button href="/record" icon="record">
              記録する
            </Button>
          </EmptyState>
        }
      />
    </>
  );
}

/** 一覧・ホームの controller を作って購読する（開くたびに読む。keep = 一覧: 戻るで開いたら読み込み済みの分を戻す） */
export function useTrades(opts: { readonly pageSize: number; readonly keep?: boolean }): {
  readonly state: TradesState;
  readonly controller: TradesController;
  readonly hidden: ReadonlySet<string>;
  /** 読み込み済みの分を戻して開いた */
  readonly restored: boolean;
} {
  const cacheCtx = useContext(TradesCacheContext);
  const nav = useContext(NavigatorContext);
  const cache = opts.keep ? cacheCtx : null;
  const restored = useMemo(
    () => cache !== null && nav?.current.via === 'pop' && cache.get() !== null,
    [],
  );
  const controller = useMemo(
    () => createTradesController({ api, pageSize: opts.pageSize, cache, restore: restored }),
    [],
  );
  const [state, setState] = useState<TradesState>(controller.getState());
  const del = useContext(DeletionsContext);
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  return { state, controller, hidden: del?.state.hidden ?? NO_HIDDEN, restored };
}

/** 末尾の印が見えそうになったら（画面の下 600px の手前）続きを読む */
const MORE_MARGIN = '0px 0px 600px 0px';

function TradesScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden, restored } = useTrades({ pageSize: LIST_PAGE, keep: true });
  const cache = useContext(TradesCacheContext);
  const observer = useMemo(
    () =>
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) void controller.loadMore();
            },
            { rootMargin: MORE_MARGIN },
          ),
    [controller],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);
  // 位置を覚える（離れるときの戻る・進むでブラウザが位置を変える前の値を持つため、スクロールのたびに）
  useEffect(() => {
    if (!cache) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        cache.setScrollY(window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cache]);
  // 戻るで開いたら、読み込み済みの分を描いた直後に覚えていた位置へ戻す
  const pendingScroll = useRef(restored);
  useLayoutEffect(() => {
    if (!pendingScroll.current || state.phase !== 'ready') return;
    pendingScroll.current = false;
    window.scrollTo(0, cache?.scrollY() ?? 0);
  }, [state.phase]);
  // [続きを読み込む] にフォーカスがあったまま最後まで読んでボタンが消えたら、読み足した最初の行（無ければ末尾の文）へ
  // フォーカスを移す（body に落とさない）。読み込み中・失敗の間は同じボタンが残るのでフォーカスはそのまま
  const more = state.phase === 'ready' ? state.more : null;
  const focusAfter = useRef<number | null>(null);
  // 最後にフォーカスを受けたのが [続きを読み込む] か（押す前に末尾の検知で読み込みが始まっていても分かるように）
  const moreFocused = useRef(false);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      moreFocused.current = (e.target as Element | null)?.id === TRADES_MORE_ID;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  useLayoutEffect(() => {
    if (more === 'loading') {
      focusAfter.current = document.querySelectorAll('a.traderow').length;
      return;
    }
    const from = focusAfter.current;
    focusAfter.current = null;
    if (from === null || more !== 'done' || !moreFocused.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    moreFocused.current = false;
    const target =
      document.querySelectorAll<HTMLElement>('a.traderow')[from] ??
      document.querySelector<HTMLElement>('.tradelist-end');
    target?.focus({ preventScroll: true });
  }, [more]);
  return (
    <TradesView
      state={state}
      hidden={hidden}
      empty={empty}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
      onMore={() => {
        void controller.loadMore();
      }}
      sentinelRef={(el) => {
        // 描くたびに付け直す（読み足した後も印が見えたままなら、すぐに次を読む）
        observer?.disconnect();
        if (el) observer?.observe(el);
      }}
    />
  );
}

export interface TradesViewProps {
  readonly state: TradesState;
  readonly hidden: ReadonlySet<string>;
  readonly empty: JSX.Element;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /** [続きを読み込む]・[もう一度読み込む]（続きの読みの失敗の後） */
  readonly onMore?: () => void;
  /** 末尾の印（続きがあって読んでいないときだけ描く。見えそうになったら続きを読む） */
  readonly sentinelRef?: (el: HTMLDivElement | null) => void;
}

/** [続きを読み込む] の ID（読み込み中・失敗の後も同じボタンを残し、フォーカスを保つ） */
export const TRADES_MORE_ID = 'trades-more';

/** 読み込み中・読めない・空・行の並び・続きの段（hook を持たない） */
export function TradesView(p: TradesViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return <LoadState {...p} />;
  const trades = sortTrades(visibleTrades(state.trades, p.hidden));
  if (trades.length === 0 && state.more === 'done') return p.empty;
  const rows = trades.map((t) => tradeRow(t, state.instruments, state.accounts));
  const done = state.more === 'done';
  // 「—」の理由は末尾の段の後（カードの最後）に 1 回。続きがある間は件数を出さない（読み込んだ分だけの数になるため）
  const notes = done ? missingNotes(rows) : notesWhileLoading(missingNotes(rows));
  const end = done && rows.length > LIST_PAGE ? endText(rows.length) : null;
  const status =
    state.more === 'loading'
      ? '続きを読み込んでいます'
      : state.more === 'failed'
        ? ''
        : done
          ? endText(rows.length)
          : countText(rows.length, false);
  return (
    <section class="card tradelist-card" aria-labelledby="trades-count">
      <p class="tradelist-card__count" id="trades-count">
        {countText(rows.length, done)}
      </p>
      <TradeList rows={rows} label="取引" notes={[]} />
      <MoreState {...p} />
      {end !== null ? (
        <p class="tradelist-end" tabIndex={-1}>
          {end}
        </p>
      ) : null}
      <TradeNotes notes={notes} />
      {/* 読み込みの始まりと終わり・件数を伝える（常に置いておき、中身だけを入れ替える） */}
      <p class="sr-only" role="status">
        {status}
      </p>
    </section>
  );
}

/** 一覧の末尾の段: 続きがある（印と [続きを読み込む]）・読み込み中（同じボタンを押せない形で）・失敗。最後まで読んだら出さない */
function MoreState(p: TradesViewProps) {
  const { state } = p;
  if (state.phase !== 'ready' || state.more === 'done') return null;
  const onMore = p.onMore ?? (() => {});
  const loading = state.more === 'loading';
  const failed = state.more === 'failed';
  if (failed && state.moreErrorKind === 'auth') {
    return (
      <div class="tradelist-more tradelist-more--failed">
        <p key="notice" class="notice notice--error" role="alert">
          {state.moreError}
        </p>
        <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
          もう一度ログイン
        </Button>
      </div>
    );
  }
  return (
    <div class={`tradelist-more${failed ? ' tradelist-more--failed' : ''}`}>
      {failed ? (
        <p key="notice" class="notice notice--error" role="alert">
          {state.moreError}
        </p>
      ) : null}
      {state.more === 'idle' ? (
        <div
          key="sentinel"
          class="tradelist-more__sentinel"
          ref={p.sentinelRef ?? null}
          aria-hidden="true"
        />
      ) : null}
      <button
        key="more"
        id={TRADES_MORE_ID}
        type="button"
        class={buttonClass({ variant: 'secondary' })}
        aria-disabled={loading ? 'true' : undefined}
        aria-busy={loading ? 'true' : undefined}
        onClick={() => {
          if (!loading) onMore();
        }}
      >
        <span>{loading ? '続きを読み込み中…' : failed ? '再読み込み' : '続きを読み込む'}</span>
      </button>
    </div>
  );
}

/** 読み込み中・読めない（一覧・ホーム・詳細・直すで同じ形） */
export function LoadState(p: {
  readonly state: {
    readonly phase: string;
    readonly error?: string | null;
    readonly errorKind?: string | undefined;
  };
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}) {
  if (p.state.phase === 'loadFailed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {p.state.error}
        </p>
        <div>
          {p.state.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              再読み込み
            </Button>
          )}
        </div>
      </section>
    );
  }
  return (
    <p class="loading" role="status">
      読み込み中…
    </p>
  );
}
