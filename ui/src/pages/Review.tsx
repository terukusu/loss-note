// 振り返りのタブ（`/review`。#127 = U1）。U1 の時点では、ホームの規律の振り返りの部品（Issue #88）をそのまま出す（ホームにも
// 残る。ADR-0021 の決定 11・ui-guidelines 9.11）。作り直してホームから外すのは U2（#128）。期間は URL の検索部分（置き換え。履歴を
// 積まない）で、ホームは `/?period=…`、振り返りのタブは `/review?period=…`。
// 銘柄の値と消した印は、直近の判定と同じ読み込み（決済の新しい順の先頭 10 件）から取る（ホームと同じ）
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InstrumentRecord } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ReviewSection, type ReviewSlot } from '../components/ReviewSummary';
import {
  homeHref,
  type PeriodSelection,
  parsePeriod,
  periodActions,
  periodRange,
  reviewHref,
} from '../lib/period';
import { createReviewController, type ReviewState } from '../lib/review-controller';
import { type ReviewModel, reviewModelFor } from '../lib/review-view';
import { type Navigator, NavigatorContext } from '../lib/router';
import { HOME_LIMIT } from '../lib/trade-pages';
import { visibleTrades } from '../lib/trade-view';
import type { TradesState } from '../lib/trades-controller';
import { LoadState, useTrades } from './Trades';

/** 今の URL の検索部分（置き換えで変わると描き直す） */
function useSearch(nav: Navigator | null): string {
  const [search, setSearch] = useState(nav?.current.search ?? '');
  useEffect(() => nav?.subscribe(() => setSearch(nav.current.search)), [nav]);
  return search;
}

/**
 * 振り返りの期間（URL）・範囲・読み込み・表示の形（hook の層。「今」はここで読む）。instruments と hidden は直近の判定の
 * 読み込みと消した印から。hrefOf は期間 → 置き換える URL（ホーム / 振り返りのタブ）
 */
export function useReview(
  instruments: readonly InstrumentRecord[],
  hidden: ReadonlySet<string>,
  hrefOf: (sel: PeriodSelection) => string = homeHref,
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
  // 開いているタブの根でタブを押した（retap）: 裏で読み直す（9.7 の 3。#127 N12）
  useEffect(
    () =>
      nav?.subscribe(() => {
        if (nav.current.via === 'retap') void controller.reload();
      }),
    [nav, controller],
  );
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
    ...periodActions(selection, Date.now, (next) => nav?.replace(hrefOf(next))),
    onReload: () => {
      void controller.reload();
    },
    onRelogin: () => {
      void signOutActive();
    },
  };
}

const NO_INSTRUMENTS: readonly InstrumentRecord[] = [];

export function Review() {
  return (
    <>
      <PageHeader title="振り返り" />
      <ReviewScreen
        empty={
          <EmptyState
            icon="review"
            title="まだ取引がありません"
            description="取引を記録すると、期間ごとの計画どおり率と規律コストがここに表示されます。"
          />
        }
      />
    </>
  );
}

function ReviewScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden } = useTrades({ pageSize: HOME_LIMIT });
  const review = useReview(
    state.phase === 'ready' ? state.instruments : NO_INSTRUMENTS,
    hidden,
    reviewHref,
  );
  return (
    <ReviewView
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

export interface ReviewViewProps {
  readonly state: TradesState;
  readonly hidden: ReadonlySet<string>;
  readonly empty: JSX.Element;
  readonly review: ReviewSlot;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** 規律の振り返り（hook を持たない。取引が 0 件なら空の状態） */
export function ReviewView(p: ReviewViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return <LoadState {...p} />;
  if (visibleTrades(state.trades, p.hidden).length === 0) return p.empty;
  return <ReviewSection {...p.review} />;
}
