// ホーム（Issue #9 契約 U-1。設計書 9.2）: [記録する] と直近の判定（決済の新しい順に 5 件。一覧と同じ行）。
// 読むのは決済の新しい順の先頭 10 件だけ（Issue #87。全件を読まない）。
// 危ない勝ちは B と同じ「崩れ」の段で出し、勝ちの色を付けない（5.4・C34）。取引が無ければ空の状態。
// Home は hook を持たない（App のテストが 1 段だけ呼ぶ）。空の状態は Home が作って渡す
// 規律の振り返り（Issue #88）: [記録する] の下・直近の判定の上に、期間を選んで計画どおり率・規律コスト・判定の内訳・
// 規律コストの曲線。期間は URL の検索部分（置き換え。履歴を積まない）。直近の判定とは別に読む（失敗を巻き込まない。KEEP-4）
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InstrumentRecord } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ReviewSection, type ReviewSlot } from '../components/ReviewSummary';
import { TradeList } from '../components/TradeRow';
import { homeHref, parsePeriod, periodActions, periodRange } from '../lib/period';
import { createReviewController, type ReviewState } from '../lib/review-controller';
import { type ReviewModel, reviewModelFor } from '../lib/review-view';
import { type Navigator, NavigatorContext } from '../lib/router';
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

const NO_INSTRUMENTS: readonly InstrumentRecord[] = [];

/** 今の URL の検索部分（置き換えで変わると描き直す） */
function useSearch(nav: Navigator | null): string {
  const [search, setSearch] = useState(nav?.current.search ?? '');
  useEffect(() => nav?.subscribe(() => setSearch(nav.current.search)), [nav]);
  return search;
}

/** 振り返りの期間（URL）・範囲・読み込み（hook の層。「今」はここで読む） */
/** 振り返りの期間・読み込み・表示の形（hook の層）。instruments と hidden は直近の判定の読み込みと消した印から */
function useReview(
  instruments: readonly InstrumentRecord[],
  hidden: ReadonlySet<string>,
): ReviewSlot {
  const nav = useContext(NavigatorContext);
  const search = useSearch(nav);
  const selection = useMemo(() => parsePeriod(search), [search]);
  // 「今」は期間を変えるたびに読み直す（開いたまま日をまたいでも、次の操作で今日に合う）
  const now = useMemo(() => Date.now(), [search]);
  const range = useMemo(() => periodRange(selection, now), [selection, now]);
  const controller = useMemo(() => createReviewController({ api }), []);
  const [state, setState] = useState<ReviewState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  const from = range.ok ? range.from : null;
  const to = range.ok ? range.to : null;
  useEffect(() => {
    void controller.load(from === null || to === null ? null : { from, to });
  }, [controller, from, to]);
  // 表示の形は状態・消した印・取り込み・銘柄が変わったときだけ作り直す（描画のたびに期間の全件を集計しない）
  const model = useMemo(
    () =>
      reviewModelFor(state, range, {
        hidden,
        includeImports: selection.imports,
        instruments,
        now,
      }),
    [state, range, hidden, selection.imports, instruments, now],
  );
  // 期間を切り替えて読んでいる間は、前の期間の表示を薄く残す（カードの高さを跳ばさない）
  const last = useRef<ReviewModel | null>(null);
  if (model) last.current = model;
  return {
    selection,
    range,
    state,
    model,
    previous: model ? null : last.current,
    ...periodActions(selection, Date.now, (next) => nav?.replace(homeHref(next))),
    onReload: () => {
      void controller.reload();
    },
    onRelogin: () => {
      void signOutActive();
    },
  };
}

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

/** [記録する]・規律の振り返り・直近 5 件（hook を持たない） */
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
      {p.review ? <ReviewSection {...p.review} /> : null}
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
