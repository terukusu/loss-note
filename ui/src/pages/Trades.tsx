// 取引の一覧（Issue #9 契約 U-1。設計書 9.2）。記録した取引を決済の時刻の新しい順に全件並べ、各行に判定・R・リスク（%）・
// 銘柄・L / S・決済の日付。行から詳細へ。判定・R・リスクは保存した記録から計算する（記録したときの資金・銘柄の値。C36）。
// 3 層: 純関数（lib/trade-view.ts）→ 通信と状態（lib/trades-controller.ts）→ この画面。Trades は hook を持たない
// （App のテストが 1 段だけ呼ぶ）。空の状態は Trades が作って渡す。消した印（[元に戻す] を待つ取引）は隠す
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { TradeList } from '../components/TradeRow';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { missingNotes, sortTrades, tradeRow, visibleTrades } from '../lib/trade-view';
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

/** 一覧・ホームの controller を作って購読する（開くたびに読み直す） */
export function useTrades(): {
  readonly state: TradesState;
  readonly controller: TradesController;
  readonly hidden: ReadonlySet<string>;
} {
  const controller = useMemo(() => createTradesController({ api }), []);
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
  return { state, controller, hidden: del?.state.hidden ?? NO_HIDDEN };
}

function TradesScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden } = useTrades();
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
    />
  );
}

export interface TradesViewProps {
  readonly state: TradesState;
  readonly hidden: ReadonlySet<string>;
  readonly empty: JSX.Element;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** 読み込み中・読めない・空・行の並び（hook を持たない） */
export function TradesView(p: TradesViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return <LoadState {...p} />;
  const trades = sortTrades(visibleTrades(state.trades, p.hidden));
  if (trades.length === 0) return p.empty;
  const rows = trades.map((t) => tradeRow(t, state.instruments, state.accounts));
  return (
    <section class="card tradelist-card" aria-labelledby="trades-count">
      <p class="tradelist-card__count" id="trades-count">
        全 {rows.length} 件（決済の新しい順）
      </p>
      <TradeList rows={rows} label="取引" notes={missingNotes(rows)} />
    </section>
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
              ログインし直す
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              もう一度読み込む
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
