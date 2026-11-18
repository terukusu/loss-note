// ホーム（Issue #9 契約 U-1。設計書 9.2）: [記録する] と直近の判定（決済の新しい順に 5 件。一覧と同じ行）。
// 読むのは決済の新しい順の先頭 10 件だけ（Issue #87。全件を読まない）。
// 危ない勝ちは B と同じ「崩れ」の段で出し、勝ちの色を付けない（5.4・C34）。取引が無ければ空の状態。
// Home は hook を持たない（App のテストが 1 段だけ呼ぶ）。空の状態は Home が作って渡す
import type { JSX } from 'preact';
import { signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { TradeList } from '../components/TradeRow';
import { HOME_LIMIT } from '../lib/trade-pages';
import { missingNotes, RECENT_COUNT, recentRows, visibleTrades } from '../lib/trade-view';
import type { TradesState } from '../lib/trades-controller';
import { LoadState, useTrades } from './Trades';

export function Home() {
  return (
    <>
      <PageHeader title="ホーム" />
      <HomeScreen
        empty={
          <EmptyState
            icon="record"
            title="最初の取引を記録しましょう"
            description="決済したら、その場で 30 秒。決済明細とチャートのスクショを貼り付けて、LC と 3 つの質問に答えると判定が表示されます。"
          >
            <Button href="/record" icon="record" size="lg">
              記録する
            </Button>
          </EmptyState>
        }
      />
    </>
  );
}

function HomeScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden } = useTrades({ pageSize: HOME_LIMIT });
  return (
    <HomeView
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

export interface HomeViewProps {
  readonly state: TradesState;
  readonly hidden: ReadonlySet<string>;
  readonly empty: JSX.Element;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** [記録する] と直近 5 件（hook を持たない） */
export function HomeView(p: HomeViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return <LoadState {...p} />;
  const visible = visibleTrades(state.trades, p.hidden);
  if (visible.length === 0) return p.empty;
  const rows = recentRows(visible, state.instruments, RECENT_COUNT, state.accounts);
  return (
    <>
      <div class="home__record">
        <Button href="/record" icon="record" size="lg" block>
          記録する
        </Button>
      </div>
      <section class="card section" aria-labelledby="home-recent-title">
        <h2 class="section__title" id="home-recent-title">
          直近の判定
        </h2>
        <TradeList rows={rows} label="直近の判定" notes={missingNotes(rows)} />
        <div>
          <Button href="/trades" variant="secondary" icon="list">
            一覧を見る
          </Button>
        </div>
      </section>
    </>
  );
}
