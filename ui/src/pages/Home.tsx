// ホーム（Issue #9 契約 U-1。設計書 9.2）: 直近の判定（決済の新しい順に 5 件。一覧と同じ行）。
// 読むのは決済の新しい順の先頭 10 件だけ（Issue #87。全件を読まない）。
// 危ない勝ちは B と同じ「崩れ」の段で出し、勝ちの色を付けない（5.4・C34）。取引が無ければ空の状態。
// Home は hook を持たない（App のテストが 1 段だけ呼ぶ）。空の状態は Home が作って渡す
// 規律の振り返り（Issue #88）: 直近の流れの下・直近の判定の上に、期間を選んで計画どおり率・規律コスト・判定の内訳・
// 規律コストの曲線。期間は URL の検索部分（置き換え。履歴を積まない）。直近の判定とは別に読む（失敗を巻き込まない。KEEP-4）
// 直近の流れ（Issue #35）: 見出しの直下に、読んだ 10 件の判定の段の点の並びと「計画どおりが N 件続いています」。
// 新しく読まない（直近の判定と同じ読み込み）
import type { JSX } from 'preact';
import type { InstrumentRecord } from '../../../core/record';
import { signOutActive } from '../auth/session';
import { RowLink } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ReviewSection, type ReviewSlot } from '../components/ReviewSummary';
import { StreakSection } from '../components/StreakStrip';
import { TradeList } from '../components/TradeRow';
import { streakModel } from '../lib/streak';
import { HOME_LIMIT } from '../lib/trade-pages';
import { missingNotes, RECENT_COUNT, recentRows, visibleTrades } from '../lib/trade-view';
import type { TradesState } from '../lib/trades-controller';
import { useReview } from './Review';
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
            description="決済したら、その場で 30 秒。[記録] を押して、決済明細とチャートのスクショを貼り付け、LC と 3 つの質問に答えると判定が表示されます。"
          />
        }
      />
    </>
  );
}

const NO_INSTRUMENTS: readonly InstrumentRecord[] = [];

function HomeScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden } = useTrades({ pageSize: HOME_LIMIT });
  const review = useReview(state.phase === 'ready' ? state.instruments : NO_INSTRUMENTS, hidden);
  return (
    <HomeView
      state={state}
      hidden={hidden}
      empty={empty}
      review={review}
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
  /** 規律の振り返りの段（Issue #88。無ければ出さない） */
  readonly review?: ReviewSlot;
}

/** 直近の流れ・規律の振り返り・直近 5 件と「すべての取引 ›」（hook を持たない。［記録する］ は下のタブの ［＋ 記録］ だけ。#127） */
export function HomeView(p: HomeViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return <LoadState {...p} />;
  const visible = visibleTrades(state.trades, p.hidden);
  if (visible.length === 0) return p.empty;
  const rows = recentRows(visible, state.instruments, RECENT_COUNT, state.accounts);
  const streak = streakModel(state.trades, p.hidden);
  return (
    <>
      {streak ? <StreakSection model={streak} id="home-streak" /> : null}
      {p.review ? <ReviewSection {...p.review} /> : null}
      <section class="card section" aria-labelledby="home-recent-title">
        <h2 class="section__title" id="home-recent-title">
          直近の判定
        </h2>
        <TradeList rows={rows} label="直近の判定" notes={missingNotes(rows)} />
        {/* 取引のタブへ（押せる行。9.12。旧の [一覧を見る]） */}
        <RowLink href="/trades">すべての取引</RowLink>
      </section>
    </>
  );
}
