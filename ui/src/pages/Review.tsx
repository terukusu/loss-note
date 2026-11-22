// 振り返りのタブ（タブ 3。`/review`。#128 = U2。設計書 9.2 の振り返りの行・ui-guidelines 9.3・9.11）と、次の画面
// 「数で見る」（`/review/table`）。規律の振り返り（#88・C44）をホームから移して作り直した: 期間（上に貼り付く）→ 範囲と件数 →
// 1 枚目（規律コストの見出しと曲線）→ 2 枚目（計画どおり率と内訳）→「数で見る ›」。上のセグメント 規律 / 気づき（#162）の気づきは
// 心理ごとの集計（`&view=insight`。期間・取り込みは共通）。期間は URL の検索部分（置き換え。履歴を積まない。
// `/review?period=…`）で、「数で見る」も同じ検索部分（`/review/table?period=…`。戻ると同じ期間の振り返り）。
// 銘柄の値と消した印は、直近の取引と同じ読み込み（決済の新しい順の先頭 10 件）から取る（#88 のまま）。
// 3 層: 純関数（lib/period.ts・lib/review-view.ts）→ 通信と状態（lib/review-controller.ts）→ hook を持たない View
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InstrumentRecord } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { ReviewSection, type ReviewSlot, ReviewTable } from '../components/ReviewSummary';
import { type InsightModel, insightModelFor } from '../lib/insight-view';
import {
  type PeriodSelection,
  parsePeriod,
  parseReviewView,
  periodActions,
  periodRange,
  type ReviewViewKey,
  reviewHref,
  reviewTableHref,
} from '../lib/period';
import { createReviewController, type ReviewState } from '../lib/review-controller';
import { NO_CURVE, type ReviewModel, reviewModelFor } from '../lib/review-view';
import { type Navigator, NavigatorContext } from '../lib/router';
import { HOME_LIMIT } from '../lib/trade-pages';
import { visibleTrades } from '../lib/trade-view';
import type { TradesState } from '../lib/trades-controller';
import '../styles/review-tab.css';
import { backTargetOf } from './TradeDetail';
import { LoadState, useTrades } from './Trades';

/** 今の URL の検索部分（置き換えで変わると描き直す） */
function useSearch(nav: Navigator | null): string {
  const [search, setSearch] = useState(nav?.current.search ?? '');
  useEffect(() => nav?.subscribe(() => setSearch(nav.current.search)), [nav]);
  return search;
}

/**
 * 振り返りの期間（URL）・範囲・読み込み・表示の形（hook の層。「今」はここで読む）。instruments と hidden は直近の取引の
 * 読み込みと消した印から。hrefOf は期間 → 置き換える URL（振り返りのタブ / 数で見る）
 */
export function useReview(
  instruments: readonly InstrumentRecord[],
  hidden: ReadonlySet<string>,
  hrefOf: (sel: PeriodSelection, view: ReviewViewKey) => string = reviewHref,
): ReviewSlot {
  const nav = useContext(NavigatorContext);
  const search = useSearch(nav);
  const selection = useMemo(() => parsePeriod(search), [search]);
  // 規律 / 気づき（#162）。期間の操作は今のセグメントを保った URL へ置き換える（期間は 2 つで共通）
  const view = useMemo(() => parseReviewView(search), [search]);
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
  // 気づきの表示の形は気づきを開いているときだけ作る（規律と同じ対象・同じ読み込み。#162）
  const insight = useMemo(
    () =>
      view === 'insight'
        ? insightModelFor(state, range, { hidden, includeImports: selection.imports })
        : null,
    [view, state, range, hidden, selection.imports],
  );
  const lastInsight = useRef<InsightModel | null>(null);
  if (insight) lastInsight.current = insight;
  return {
    selection,
    range,
    state,
    model,
    previous: model ? null : last.current,
    view,
    insight,
    previousInsight: insight ? null : lastInsight.current,
    onView: (next) => {
      if (next !== view) nav?.replace(reviewHref(selection, next));
    },
    tableHref: reviewTableHref(selection),
    ...periodActions(selection, Date.now, (next) => nav?.replace(hrefOf(next, view))),
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
  const review = useReview(state.phase === 'ready' ? state.instruments : NO_INSTRUMENTS, hidden);
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

/** 次の画面「数で見る」（`/review/table?period=…`。上の帯「‹ 振り返り」。戻ると同じ期間の振り返り） */
export function ReviewTablePage() {
  const nav = useContext(NavigatorContext);
  const { state, hidden } = useTrades({ pageSize: HOME_LIMIT });
  const review = useReview(
    state.phase === 'ready' ? state.instruments : NO_INSTRUMENTS,
    hidden,
    reviewTableHref,
  );
  return <ReviewTableView review={review} back={backTargetOf(nav, reviewHref(review.selection))} />;
}

export interface ReviewTableViewProps {
  readonly review: ReviewSlot;
  readonly back?: BackTarget;
}

/** 数で見る（hook を持たない）: 範囲と件数・表（R の出た取引。決済の古い順）。読み込み中・失敗・0 件は短い文 */
export function ReviewTableView(p: ReviewTableViewProps) {
  const r = p.review;
  const back: BackTarget = p.back ?? { label: '振り返り', href: reviewHref(r.selection) };
  const m = r.model;
  const s = r.state;
  let body: JSX.Element;
  if (!r.range.ok) body = <p class="review__note">{r.range.error}</p>;
  else if (s.phase === 'failed') {
    body = (
      <LoadState
        state={{ phase: 'loadFailed', error: s.error, errorKind: s.errorKind }}
        onReload={r.onReload}
        onRelogin={r.onRelogin}
      />
    );
  } else if (!m) {
    body = (
      <p class="loading" role="status">
        読み込んでいます…
      </p>
    );
  } else if (m.empty) body = <p class="review__empty">{m.emptyText}</p>;
  else if (m.rows.length === 0) body = <p class="review__note">{NO_CURVE}</p>;
  else body = <ReviewTable m={m} />;
  return (
    <>
      <TopBar back={back} title="数で見る" />
      <div class="review review--table">
        {r.range.ok ? (
          <p class="review__meta" aria-live="polite">
            {r.range.label}
            {m ? ` · ${m.countText}` : ''}
          </p>
        ) : null}
        <section class="card section review__card">{body}</section>
      </div>
    </>
  );
}
