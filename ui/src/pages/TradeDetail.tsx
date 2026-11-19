// 取引の詳細（Issue #9 契約 U-2。設計書 7.5・9.2、ADR-0006 決定 4）: 判定・理由のすべて・R・損益（円）・リスク（%）、
// 判定の枠の中（理由の下）に 3 つのタップの答えの札（#34）、エントリー時と決済時のチャートを並べて各枠の時間足を添え、記録した欄を「すべての欄」に畳んで出す。[直す]・[消す]（確認を挟まない。[元に戻す] は
// アプリの殻のトースト。ADR-0007）。無い ID・ほかの利用者の取引・消した印の取引は「この取引は見つかりません」と一覧へのリンク。
// チャートは API から読んだバイト列を canvas に描く（object URL・data URL・img を使わない。CSP を広げない）。
// 見出しは取引が読めたら「銘柄 · L / S」と決済の日時（読めるまで・見つからないときは「取引の詳細」。h1 の要素は同じなので
// 画面の移りで当てたフォーカスは外れない）。[直す]・[消す] は見出しの行に置く。
// TradeDetail は hook を持たない（App・経路のテストが 1 段だけ呼ぶ）。「見つかりません」の面は TradeDetail が作って渡す
import { Fragment, type JSX } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { accountCurrencyOf } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { EXTRA_TITLE } from '../components/ChartPanel';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Verdict } from '../components/Verdict';
import { hasManyAccounts, tradeAccountName, verdictAsideText } from '../lib/accounts';
import { APP_NAME } from '../lib/app-name';
import { type AnySlot, isMainSlot } from '../lib/charts';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { DRAFT_DOT_TEXT, editKey } from '../lib/drafts';
import { DraftsKeptContext } from '../lib/drafts-context';
import { editBlock } from '../lib/edit-form';
import { Link, NavigatorContext } from '../lib/router';
import { titleOf } from '../lib/routes';
import { browserCodec } from '../lib/statement-image';
import { createTradeDetailController, type DetailState } from '../lib/trade-detail-controller';
import {
  type ChartSlotView,
  chartSlots,
  detailHeading,
  recordFields,
  shortLabel,
  tapAnswers,
  timeframeNote,
} from '../lib/trade-view';
import { LoadState } from './Trades';

/** 「この取引は見つかりません」と一覧へのリンク（詳細・直すで同じ。V4・KEEP-3） */
export function notFoundState(): JSX.Element {
  return (
    <EmptyState
      icon="list"
      title="この取引は見つかりません"
      description="削除されたか、URL が間違っている可能性があります。"
    >
      <Button href="/trades" variant="secondary" icon="back">
        一覧へ戻る
      </Button>
    </EmptyState>
  );
}

export function TradeDetail({ id }: { readonly id: string }) {
  return <TradeDetailScreen id={id} notFound={notFoundState()} />;
}

function TradeDetailScreen({
  id,
  notFound,
}: {
  readonly id: string;
  readonly notFound: JSX.Element;
}) {
  const controller = useMemo(
    () =>
      createTradeDetailController({
        api,
        id,
        preview: (bytes, type) => browserCodec.preview(bytes, type),
      }),
    [id],
  );
  const [state, setState] = useState<DetailState>(controller.getState());
  const del = useContext(DeletionsContext);
  const nav = useContext(NavigatorContext);
  const kept = useContext(DraftsKeptContext);
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  // 取引が読めたら、タブ・履歴の名前も見出しと同じにする
  const heading =
    state.phase === 'ready'
      ? detailHeading(state.trade, state.instrumentName, state.accounts)
      : null;
  useEffect(() => {
    if (heading) document.title = `${heading.title} ${heading.sub} — ${APP_NAME}`;
    else document.title = titleOf({ name: 'trade', id });
  }, [heading?.title, heading?.sub, id]);
  return (
    <TradeDetailView
      id={id}
      state={state}
      hidden={del?.state.hidden ?? NO_HIDDEN}
      notFound={notFound}
      editDraft={kept.has(editKey(id))}
      onDelete={() => {
        // 確認を挟まずに消す（取り消しはトーストの [元に戻す]。P4）。一覧へ置き換える（戻るで消した取引に戻らない）
        if (state.phase === 'ready') {
          del?.remove(id, shortLabel(state.trade, state.instrumentName));
        }
        nav?.replace('/trades');
      }}
      onReloadChart={(slot) => {
        void controller.reloadChart(slot);
      }}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
    />
  );
}

export interface TradeDetailViewProps {
  readonly id: string;
  readonly state: DetailState;
  readonly hidden: ReadonlySet<string>;
  readonly notFound: JSX.Element;
  readonly onDelete: () => void;
  readonly onReloadChart: (slot: AnySlot) => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /** この取引の編集の書きかけを残している（[編集] に印の点。#75） */
  readonly editDraft?: boolean;
}

/** 判定の枠（3 つのタップの答えの札を含む）・チャートの枠・すべての欄（畳む）・[直す] / [消す]（hook を持たない） */
export function TradeDetailView(p: TradeDetailViewProps) {
  const { state } = p;
  const plain = <PageHeader title="取引の詳細" />;
  if (p.hidden.has(p.id) || state.phase === 'notFound') {
    return (
      <>
        {plain}
        {p.notFound}
      </>
    );
  }
  if (state.phase !== 'ready') {
    return (
      <>
        {plain}
        <LoadState {...p} />
      </>
    );
  }
  const t = state.trade;
  const block = editBlock(t);
  const h = detailHeading(t, state.instrumentName, state.accounts);
  return (
    <>
      <PageHeader
        title={h.title}
        description={
          <>
            <Link href="/trades" class="detail__back">
              ‹ 一覧
            </Link>
            <span class="detail__when">
              {/* 幅 480px 以上だけ「エントリー … → 」を頭に（360 は見出しの下の行を 1 行に保つ。#58 デザインレビュー 5） */}
              {h.entry ? <span class="detail__entry">{h.entry} → </span> : null}
              {/* 区切り（決済の日時・保有・口座）の中では折らず、「·」は後ろの区切りの頭に付ける（判定の枠の数量の行と同じ） */}
              {h.sub.split(' · ').map((seg, i) => (
                <Fragment key={seg}>
                  {i > 0 ? ' ' : null}
                  <span class="detail__seg">{i > 0 ? `· ${seg}` : seg}</span>
                </Fragment>
              ))}
            </span>
          </>
        }
        actions={
          <>
            {block === null ? (
              <Button
                href={`/trades/${t.id}/edit`}
                variant="secondary"
                icon="edit"
                {...(p.editDraft ? { dot: DRAFT_DOT_TEXT } : {})}
              >
                編集
              </Button>
            ) : null}
            <Button variant="ghost" icon="trash" onClick={p.onDelete}>
              削除
            </Button>
          </>
        }
      />
      <DetailBody {...p} />
    </>
  );
}

function DetailBody(p: TradeDetailViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return null;
  const t = state.trade;
  const r = t.record;
  const block = editBlock(t);
  // 口座が 2 つ以上のときだけ、どの口座の資金（記録したとき）で割ったかの 1 行（U17）
  const accountLine = hasManyAccounts(state.accounts)
    ? verdictAsideText(tradeAccountName(t, state.accounts), t.snapshot.capitalYen, {
        recorded: true,
        currency: accountCurrencyOf(t.snapshot),
      })
    : undefined;
  return (
    <div class="detail">
      <Verdict
        summary={state.summary}
        side={r.side}
        titleId="detail-verdict-title"
        {...(accountLine === undefined ? {} : { account: accountLine })}
        taps={{ items: tapAnswers(t, state.summary.judgment), note: timeframeNote(t) }}
      />
      {block !== null ? <p class="detail__note">{block}</p> : null}
      <ChartsView {...p} />
      {/* 記録した欄はすべて「すべての欄」に畳む（既定で閉じる。記録する画面の「ほかの欄（任意）」と同じ部品。#34） */}
      <details class="card more">
        <summary class="more__summary">すべての欄</summary>
        <div class="more__body">
          <dl class="fields">
            {recordFields(t, state.instrumentName, state.summary.judgment, state.accounts).map(
              (f) => (
                <div key={f.label} class="fields__row">
                  <dt class="fields__label">{f.label}</dt>
                  <dd class="fields__value">{f.value}</dd>
                </div>
              ),
            )}
          </dl>
        </div>
      </details>
    </div>
  );
}

/**
 * エントリー時・決済時のチャートを並べる（ある枠は canvas と時間足、無い枠は「チャートなし」）。その後ろに小見出し
 * 「追加のチャート（判定には使いません）」で分けて、追加のチャート（#89。追加した順・一言と時間足つき）
 */
function ChartsView(p: TradeDetailViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return null;
  const all = chartSlots(state.trade);
  const main = all.filter((c) => isMainSlot(c.slot));
  const extras = all.filter((c) => !isMainSlot(c.slot));
  const figure = (c: ChartSlotView) => {
    const view = state.charts[c.slot] ?? { phase: 'loading' as const };
    const tf = c.timeframe ?? '指定なし';
    const extra = !isMainSlot(c.slot);
    return (
      <figure
        key={c.slot}
        class={extra ? 'chartview chartview--extra' : 'chartview'}
        aria-labelledby={`detail-chart-${c.slot}`}
      >
        {/* 追加のチャートは一言があれば一言を名前にする（番号は追加した順で、振り返りの手掛かりにならない） */}
        <figcaption class="chartview__name" id={`detail-chart-${c.slot}`}>
          {c.note ?? c.name}
        </figcaption>
        {!c.has ? (
          <p class="chartview__none">チャートなし</p>
        ) : (
          <>
            {view.phase === 'ready' ? (
              <canvas
                class="chart__preview chartview__canvas"
                width={view.preview.width}
                height={view.preview.height}
                role="img"
                aria-label={`${c.name}のチャート（${tf}）`}
                ref={(el: HTMLCanvasElement | null) => {
                  if (el) view.preview.draw(el);
                }}
              />
            ) : view.phase === 'failed' ? (
              <div class="chartview__failed">
                <p class="notice notice--error" role="alert">
                  チャートを読み込めませんでした
                </p>
                <Button variant="secondary" onClick={() => p.onReloadChart(c.slot)}>
                  再読み込み
                </Button>
              </div>
            ) : (
              <p class="loading" role="status">
                チャートを読み込んでいます…
              </p>
            )}
            <p class="chartview__tf">時間足: {tf}</p>
          </>
        )}
      </figure>
    );
  };
  return (
    <section class="card section" aria-labelledby="detail-charts-title">
      <h2 class="section__title" id="detail-charts-title">
        チャート
      </h2>
      <div class="charts__grid">{main.map(figure)}</div>
      {extras.length > 0 ? (
        <>
          <h3 class="charts__subtitle">{EXTRA_TITLE}</h3>
          <div class="charts__grid">{extras.map(figure)}</div>
        </>
      ) : null}
    </section>
  );
}
