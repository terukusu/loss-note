// 取引の詳細の次の画面（#131。設計書 9.2・9.3「詳細の「すべての欄」の折りたたみ → 次の画面」・ui-guidelines 9.3）:
// - 「すべての欄」（`/trades/<id>/fields`）: 記録した欄のすべて（lib/trade-view.ts の recordFields。中身は今のまま）
// - 「総評」（`/trades/<id>/comment`）: 総評の文（取り込んだ取引の「【取り込み】元の判定 X」など）
// 上の帯は「‹ 前の画面（取引の詳細）」と題。取引は詳細と同じ controller で読み、チャートは読まない（要求を増やさない）。
// TradeFieldsPage・TradeCommentPage は hook を持たない（App が 1 段だけ呼ぶ）。View も hook を持たない
import '../styles/detail.css';
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { APP_NAME } from '../lib/app-name';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { commentOf } from '../lib/detail-view';
import { NavigatorContext } from '../lib/router';
import { titleOf } from '../lib/routes';
import { browserCodec } from '../lib/statement-image';
import { createTradeDetailController, type DetailState } from '../lib/trade-detail-controller';
import { recordFields, shortLabel } from '../lib/trade-view';
import { backTargetOf, notFoundState } from './TradeDetail';
import { LoadState } from './Trades';

export type NotesKind = 'fields' | 'comment';

const TITLE: Readonly<Record<NotesKind, string>> = { fields: 'すべての欄', comment: '総評' };

export function TradeFieldsPage({ id }: { readonly id: string }) {
  return <NotesScreen id={id} kind="fields" notFound={notFoundState()} />;
}

export function TradeCommentPage({ id }: { readonly id: string }) {
  return <NotesScreen id={id} kind="comment" notFound={notFoundState()} />;
}

function NotesScreen(p: {
  readonly id: string;
  readonly kind: NotesKind;
  readonly notFound: JSX.Element;
}) {
  const controller = useMemo(
    () =>
      createTradeDetailController({
        api,
        id: p.id,
        charts: false,
        preview: (bytes, type) => browserCodec.preview(bytes, type),
      }),
    [p.id],
  );
  const [state, setState] = useState<DetailState>(controller.getState());
  const del = useContext(DeletionsContext);
  const nav = useContext(NavigatorContext);
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  const label = state.phase === 'ready' ? shortLabel(state.trade, state.instrumentName) : null;
  useEffect(() => {
    document.title = label
      ? `${TITLE[p.kind]} ${label} — ${APP_NAME}`
      : titleOf({ name: p.kind === 'fields' ? 'tradeFields' : 'tradeComment', id: p.id });
  }, [label, p.kind, p.id]);
  return (
    <TradeNotesView
      id={p.id}
      kind={p.kind}
      back={backTargetOf(nav, `/trades/${p.id}`)}
      state={state}
      hidden={del?.state.hidden ?? NO_HIDDEN}
      notFound={p.notFound}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
    />
  );
}

export interface TradeNotesViewProps {
  readonly id: string;
  readonly kind: NotesKind;
  /** 上の帯の「‹ 前の画面」（無ければ「‹ 取引の詳細」で詳細へのリンク） */
  readonly back?: BackTarget;
  readonly state: DetailState;
  readonly hidden: ReadonlySet<string>;
  readonly notFound: JSX.Element;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** 次の画面の木（hook を持たない） */
export function TradeNotesView(p: TradeNotesViewProps) {
  const { state } = p;
  const back: BackTarget = p.back ?? { label: '取引の詳細', href: `/trades/${p.id}` };
  const bar = <TopBar back={back} title={TITLE[p.kind]} />;
  if (p.hidden.has(p.id) || state.phase === 'notFound') {
    return (
      <>
        {bar}
        {p.notFound}
      </>
    );
  }
  if (state.phase !== 'ready') {
    return (
      <>
        {bar}
        <LoadState {...p} />
      </>
    );
  }
  const t = state.trade;
  const label = shortLabel(t, state.instrumentName);
  if (p.kind === 'comment') {
    const comment = commentOf(t);
    return (
      <>
        {bar}
        <section class="card notes" aria-label={`${label} の総評`}>
          <p class="notes__sub">{label}</p>
          <p class="notes__text">{comment ?? '総評はありません。'}</p>
        </section>
      </>
    );
  }
  return (
    <>
      {bar}
      <section class="card notes" aria-label={`${label} のすべての欄`}>
        <p class="notes__sub">{label}</p>
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
      </section>
    </>
  );
}
