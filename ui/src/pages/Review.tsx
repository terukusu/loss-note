// 振り返りのタブ（タブ 3。`/review`。#128 = U2。設計書 9.2 の振り返りの行・ui-guidelines 9.3・9.11）と、次の画面
// 「数で見る」（`/review/table`）。1 本の流れ（#228・C60。前の 規律 / 気づき のセグメントはやめた）: 期間（上に貼り付く）→ 範囲と件数 →
// いくら（規律コストの見出しと曲線・計画どおり率と内訳）→ なぜ（「何で崩れたか」の順位図。切り替え 心理 / More / Good は `&why=`・
// 連勝の後）→ どの取引（「崩れの取引を見る ›」・「数で見る ›」）→ 次は（More の自分で書いた行の最新 1 行）。なぜの行・連勝の後・
// 崩れの取引・次はの行は次の画面「期間の取引」へ（#185。`pages/ReviewTrades.tsx`）。前の URL `&view=insight` は view を外した URL に
// 置き換えて受ける。期間は URL の検索部分（置き換え。履歴を積まない。
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
  parseWhy,
  periodRange,
  periodSearch,
  reviewHref,
  reviewTableHref,
  type WhyKey,
} from '../lib/period';
import { createReviewController, type ReviewState } from '../lib/review-controller';
import { reviewNavActions } from '../lib/review-nav';
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
  hrefOf: (sel: PeriodSelection, why: WhyKey) => string = reviewHref,
  /**
   * 規律・なぜの表示の形を作るか（期間の取引の画面は使わないので作らない = 期間の全件の集計を省く。#185）。
   * canonical = 前の URL `&view=insight` を view を外した URL に置き換える（振り返りのタブだけ。#228）
   */
  opts: {
    readonly discipline?: boolean;
    readonly canonical?: boolean;
    /** なぜ・次はの形を作るか（既定 = discipline。「数で見る」は表だけなので作らない。#228 のレビュー） */
    readonly insight?: boolean;
  } = {},
): ReviewSlot {
  const discipline = opts.discipline ?? true;
  const wantsInsight = opts.insight ?? discipline;
  const nav = useContext(NavigatorContext);
  const search = useSearch(nav);
  const selection = useMemo(() => parsePeriod(search), [search]);
  // 「何で崩れたか」の切り替え（#228）。期間の操作は今の切り替えを保った URL へ置き換える
  const why = useMemo(() => parseWhy(search), [search]);
  // URL のつなぎ方（切り替え・期間の操作・前の URL の置き換え）は lib/review-nav.ts（テストが本物の navigator で通す）
  const actions = reviewNavActions(search, nav, {
    hrefOf,
    canonical: opts.canonical ?? false,
    now: Date.now,
  });
  const { canonical, redirect } = actions;
  useEffect(() => {
    // 前の気づきのセグメントの URL（#162 の `&view=insight`）は同じ期間・同じ切り替えの今の URL に置き換える（履歴を積まない）
    if (canonical !== null) redirect();
  }, [canonical, redirect]);
  // 「今」は期間を変えるたびに読み直す（開いたまま日をまたいでも、次の操作で今日に合う）。切り替え（`&why=`）だけの変化では
  // 読み直さない（表示の形を組み直さない。#228 のレビュー）
  const periodKey = periodSearch(selection);
  const now = useMemo(() => Date.now(), [periodKey]);
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
      discipline
        ? reviewModelFor(state, range, {
            hidden,
            includeImports: selection.imports,
            instruments,
            now,
          })
        : null,
    [discipline, state, range, hidden, selection.imports, instruments, now],
  );
  // 期間を切り替えて読んでいる間は、前の期間の表示を薄く残す（カードの高さを跳ばさない）
  const last = useRef<ReviewModel | null>(null);
  if (model) last.current = model;
  // なぜ（心理・Good / More・連勝の後）と次はの表示の形（規律と同じ対象・同じ読み込み。#162・#228）
  const insight = useMemo(
    () =>
      wantsInsight
        ? insightModelFor(state, range, { hidden, includeImports: selection.imports, now })
        : null,
    [wantsInsight, state, range, hidden, selection.imports, now],
  );
  const lastInsight = useRef<InsightModel | null>(null);
  if (insight) lastInsight.current = insight;
  return {
    selection,
    range,
    state,
    model,
    previous: model ? null : last.current,
    why,
    // なぜ・次はを作らない組み立て（数で見る・期間の取引）は undefined（段を出さない）
    ...(wantsInsight ? { insight, previousInsight: insight ? null : lastInsight.current } : {}),
    onWhy: actions.onWhy,
    tableHref: actions.tableHref,
    trailHref: actions.trailHref,
    onKey: actions.onKey,
    onDates: actions.onDates,
    onImports: actions.onImports,
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
    { canonical: true },
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

/** 振り返りの 1 本の流れ（hook を持たない。取引が 0 件なら空の状態） */
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
    { insight: false },
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
