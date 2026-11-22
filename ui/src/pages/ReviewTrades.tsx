// 振り返りの次の画面「期間の取引」（`/review/trades?period=…&emotion=<ID>` / `&after=winStreak`。#185。設計書 9.2・9.4）。
// 気づきの心理の行・連勝の後のカードから開く。上の帯「‹ 振り返り」（戻ると同じ期間の気づき）・題（心理の名前 / 連勝の後）→
// 範囲の 1 行 → 押した行と同じ値の要約（名前つき）・上限の印 → 取引の一覧と同じ行（決済の新しい順。3 行目に付いている心理。
// 押すと詳細。詳細の戻るはこの画面）。
// 期間の範囲の読み込みは振り返りのタブと同じ hook（useReview）、銘柄・口座の名前は直近の取引の読み込みから。
// 3 層: 純関数（lib/review-trades.ts）→ 通信と状態（lib/review-controller.ts）→ hook を持たない View
import type { JSX } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { AccountRecord, InstrumentRecord } from '../../../core/record';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button } from '../components/Button';
import type { ReviewSlot } from '../components/ReviewSummary';
import { TradeRow } from '../components/TradeRow';
import { reviewHref } from '../lib/period';
import {
  parseTrail,
  type ReviewTradesModel,
  reviewTradesHref,
  reviewTradesModelFor,
  type TrailFilter,
  trailTitle,
} from '../lib/review-trades';
import { NavigatorContext } from '../lib/router';
import { HOME_LIMIT } from '../lib/trade-pages';
import '../styles/review.css';
import '../styles/review-tab.css';
import '../styles/trades.css';
import { useReview } from './Review';
import { backTargetOf } from './TradeDetail';
import { LoadState, useTrades } from './Trades';

const NO_INSTRUMENTS: readonly InstrumentRecord[] = [];
const NO_ACCOUNTS: readonly AccountRecord[] = [];

export function ReviewTradesPage() {
  const nav = useContext(NavigatorContext);
  const { state, hidden } = useTrades({ pageSize: HOME_LIMIT });
  const ready = state.phase === 'ready';
  const instruments = ready ? state.instruments : NO_INSTRUMENTS;
  const accounts = ready ? state.accounts : NO_ACCOUNTS;
  const filter = useMemo(() => parseTrail(nav?.current.search ?? ''), [nav?.current.search]);
  const review = useReview(
    instruments,
    hidden,
    (sel) => (filter ? reviewTradesHref(sel, filter) : reviewHref(sel, 'insight')),
    { discipline: false },
  );
  const model = useMemo(
    () =>
      reviewTradesModelFor(review.state, review.range, {
        hidden,
        includeImports: review.selection.imports,
        filter,
        instruments,
        accounts,
      }),
    [review.state, review.range, hidden, review.selection.imports, filter, instruments, accounts],
  );
  return (
    <ReviewTradesView
      review={review}
      filter={filter}
      model={model}
      back={backTargetOf(nav, reviewHref(review.selection, 'insight'))}
    />
  );
}

export interface ReviewTradesViewProps {
  readonly review: ReviewSlot;
  readonly filter: TrailFilter | null;
  /** 表示の形（読み込み中・期間の誤り・範囲の食い違いは null） */
  readonly model: ReviewTradesModel | null;
  readonly back?: BackTarget;
}

/** 期間の取引（hook を持たない）: 範囲の 1 行・要約・行。読み込み中・失敗・該当なしは短い文 */
export function ReviewTradesView(p: ReviewTradesViewProps) {
  const r = p.review;
  const insightHref = reviewHref(r.selection, 'insight');
  const back: BackTarget = p.back ?? { label: '振り返り', href: insightHref };
  const m = p.model;
  const s = r.state;
  let body: JSX.Element;
  if (!r.range.ok) body = <p class="review__note">{r.range.error}</p>;
  else if (s.phase === 'failed') {
    body = (
      <section class="card section review__card">
        <LoadState
          state={{ phase: 'loadFailed', error: s.error, errorKind: s.errorKind }}
          onReload={r.onReload}
          onRelogin={r.onRelogin}
        />
      </section>
    );
  } else if (!m) {
    body = (
      <p class="loading" role="status">
        読み込んでいます…
      </p>
    );
  } else if (m.empty) {
    body = (
      <section class="card section review__card review__empty-box">
        <p class="review__empty">{m.emptyText}</p>
        <div>
          <Button variant="secondary" href={insightHref}>
            振り返りへ
          </Button>
        </div>
      </section>
    );
  } else {
    body = (
      <ul class="tradelist" aria-label={`${m.title}の取引`}>
        {m.rows.map((row) => (
          <li key={row.id} class="tradelist__item">
            <TradeRow row={row} note={m.notes[row.id]} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <TopBar back={back} title={m?.title ?? trailTitle(p.filter)} />
      <div class="review review--trail">
        {r.range.ok ? (
          <div class="review__trailhead" aria-live="polite">
            <p class="review__meta">{r.range.label}</p>
            {m && m.summaryParts.length > 0 ? (
              <p class="review__trailsum">
                {m.summaryParts.map((part) => (
                  <span key={part} class="review__trailpart">
                    {part}
                  </span>
                ))}
              </p>
            ) : null}
            {m?.truncatedText ? <p class="review__note">{m.truncatedText}</p> : null}
          </div>
        ) : null}
        {body}
      </div>
    </>
  );
}
