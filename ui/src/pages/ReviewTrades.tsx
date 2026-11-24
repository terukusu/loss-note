// 振り返りの次の画面「期間の取引」（`/review/trades?period=…&emotion=<ID>` / `&after=winStreak`。#185。設計書 9.2・9.4）。
// 気づきの心理の行・連勝の後のカード・Good / More の行（`&more=<ID>` / `&good=<ID>` / `&notes=more|good`。#221）と、取引の詳細の
// 心理のチップ（#188。期間は自動 = 範囲の行の頭に「この取引を含む 3 か月」）から開く。
// 振り返りの「崩れの取引を見る ›」（`&tier=off`）・次はの行（`&notes=more`）からも開く（#228）。
// 上の帯「‹ 前の画面」（振り返りから = 同じ期間の振り返り（More / Good の行からなら切り替えはその側）・詳細から = その詳細）・題（心理の名前 / 連勝の後）→ 期間の選択肢（振り返りと同じ部品）→
// 範囲の 1 行 → 押した行と同じ値の要約（名前つき）・上限の印 → 取引の一覧と同じ行（決済の新しい順。3 行目に付いている心理。
// 押すと詳細。詳細の戻るはこの画面）。詳細から来たときは押して来た元の取引の行に札「この取引」（URL の `&trade=`。#194）。
// 期間の範囲の読み込みは振り返りのタブと同じ hook（useReview）、銘柄・口座の名前は直近の取引の読み込みから。
// 3 層: 純関数（lib/review-trades.ts）→ 通信と状態（lib/review-controller.ts）→ hook を持たない View
import type { JSX } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import type { AccountRecord, InstrumentRecord } from '../../../core/record';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { PeriodDates, PeriodSegment } from '../components/PeriodPicker';
import type { ReviewSlot } from '../components/ReviewSummary';
import { TradeRow } from '../components/TradeRow';
import { reviewHref } from '../lib/period';
import {
  autoPeriodLead,
  isFromTrade,
  ORIGIN_BADGE,
  originOf,
  parseTrail,
  type ReviewTradesModel,
  reviewTradesHref,
  reviewTradesModelFor,
  type TrailFilter,
  trailTitle,
  whyOfTrail,
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
  const fromTrade = isFromTrade(nav?.current.search ?? '');
  const origin = originOf(nav?.current.search ?? '');
  // 期間を選び直しても元の取引は保つ（via は外れる = 範囲の行の頭の文は出さない。#194）
  const review = useReview(
    instruments,
    hidden,
    (sel) => (filter ? reviewTradesHref(sel, filter, { trade: origin }) : reviewHref(sel)),
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
        origin,
      }),
    [
      review.state,
      review.range,
      hidden,
      review.selection.imports,
      filter,
      instruments,
      accounts,
      origin,
    ],
  );
  return (
    <ReviewTradesView
      review={review}
      filter={filter}
      model={model}
      fromTrade={fromTrade}
      back={backTargetOf(nav, reviewHref(review.selection, whyOfTrail(filter)))}
    />
  );
}

export interface ReviewTradesViewProps {
  readonly review: ReviewSlot;
  readonly filter: TrailFilter | null;
  /** 表示の形（読み込み中・期間の誤り・範囲の食い違いは null） */
  readonly model: ReviewTradesModel | null;
  readonly back?: BackTarget;
  /** 取引の詳細の心理のチップから来た（期間を自動で決めた。範囲の行の頭に名前を添える。#188） */
  readonly fromTrade?: boolean;
}

/** 期間の取引（hook を持たない）: 範囲の 1 行・要約・行。読み込み中・失敗・該当なしは短い文 */
export function ReviewTradesView(p: ReviewTradesViewProps) {
  const r = p.review;
  const insightHref = reviewHref(r.selection, whyOfTrail(p.filter));
  const back: BackTarget = p.back ?? { label: '振り返り', href: insightHref };
  const m = p.model;
  const s = r.state;
  const lead = autoPeriodLead(r.selection, p.fromTrade ?? false);
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
            <TradeRow
              row={row}
              note={m.notes[row.id]}
              badge={row.id === m.origin ? ORIGIN_BADGE : undefined}
            />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      <TopBar back={back} title={m?.title ?? trailTitle(p.filter)} />
      <div class="review review--trail">
        {/* 期間を選び直せる（振り返りのタブと同じ部品。#188 デザインレビュー 2）。選ぶと同じ絞り方のまま URL を置き換える */}
        <div class="review__period-bar">
          <PeriodSegment
            selection={r.selection}
            range={r.range}
            onKey={r.onKey}
            onDates={r.onDates}
          />
        </div>
        <PeriodDates selection={r.selection} range={r.range} onKey={r.onKey} onDates={r.onDates} />
        {r.range.ok ? (
          <div class="review__trailhead" aria-live="polite">
            <p class="review__meta">{lead ? `${lead} · ${r.range.label}` : r.range.label}</p>
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
