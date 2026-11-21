// 一覧・ホーム・詳細・直す・トーストの描画（Issue #9 AC-1〜AC-7・契約 U-1〜U-4）。DOM のライブラリを使わず、部品の関数を
// 呼んで要素の木に展開して見る（View と部品は hook を持たない。アプリの中のリンク Link は a として止める）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { AccountRecord, StoredTrade } from '../../core/record';
import { Toast } from '../../ui/src/components/Toast';
import { createDeletions, type ToastState } from '../../ui/src/lib/deletions';
import { createEditController } from '../../ui/src/lib/edit-controller';
import { EDIT_BLOCKED } from '../../ui/src/lib/edit-form';
import { summarize } from '../../ui/src/lib/record-form';
import { Link } from '../../ui/src/lib/router';
import type { PreviewHandle } from '../../ui/src/lib/statement-image';
import type { ChartView, DetailState } from '../../ui/src/lib/trade-detail-controller';
import { LIST_PAGE } from '../../ui/src/lib/trade-pages';
import { TRADES_MORE_FAILED, type TradesState } from '../../ui/src/lib/trades-controller';
import { Home, HomeView } from '../../ui/src/pages/Home';
import { notFoundState, TradeDetail, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeEdit, TradeEditView } from '../../ui/src/pages/TradeEdit';
import { TradeNotesView } from '../../ui/src/pages/TradeNotes';
import { TRADES_MORE_ID, Trades, TradesView } from '../../ui/src/pages/Trades';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import {
  CAPITAL_NOW,
  D1,
  D2,
  E1,
  E2,
  H1,
  INSTRUMENTS,
  L1,
  L2,
  L3,
  US30,
} from './helpers/trade-examples';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

/** 展開の途中で見た「i」の出どころ（説明のシートの中身を確かめる。#132） */
const tipSources: Record<string, unknown>[] = [];

/** 部品（関数）を呼んで、要素（文字列の type）だけの木にする。Link は a として止める（hook を使うため） */
function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  const tip = closedInfoTip(vn);
  if (tip) {
    tipSources.push(vn.props);
    return expand(tip);
  }
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  if (typeof vn.type === 'function') {
    const fn = vn.type as (p: unknown) => unknown;
    return expand(fn(vn.props));
  }
  const { children, ...props } = vn.props ?? {};
  return [{ type: String(vn.type), props, children: expand(children) }];
}

function all(nodes: Node[], pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) out.push(n);
    all(n.children, pred, out);
  }
  return out;
}

function text(n: Node | Node[]): string {
  if (Array.isArray(n)) return n.map(text).join('');
  return typeof n === 'string' ? n : text(n.children);
}

const cls = (e: El) => String(e.props.class ?? '');
const hasClass = (c: string) => (e: El) => cls(e).split(' ').includes(c);
const noop = () => {};
const EMPTY = new Set<string>();
const emptyEl = <p class="empty-marker">空</p>;

/** 確認の画面（ダイアログ）が木に無い */
/** 確認のダイアログを出さない（下のシート = class sheet の dialog は重ね方の部品なので数えない。#131） */
function noDialog(tree: Node[]) {
  expect(all(tree, (e) => e.type === 'dialog' && !hasClass('sheet')(e))).toEqual([]);
  expect(all(tree, (e) => e.props.role === 'dialog' || e.props.role === 'alertdialog')).toEqual([]);
}

const ready = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
  more: 'done',
});

/** 一覧の行（#132: 判定の名前は 2 行目の traderow__grade、段は左の記号の札 traderow__mark の class） */
function rowsOf(tree: Node[]) {
  return all(tree, hasClass('traderow')).map((a) => ({
    href: a.props.href,
    label: a.props['aria-label'],
    badge: text(all(a.children, hasClass('traderow__grade'))[0] ?? []),
    badgeClass: cls(all(a.children, hasClass('traderow__mark'))[0] as El),
    text: text(a),
  }));
}

/** 「—」の理由の「i」（題の行。#132）の出どころ。無ければ undefined */
function missingTip(v: unknown): Record<string, unknown> | undefined {
  tipSources.length = 0;
  expand(v);
  return tipSources.find((t) => t.id === 'info-trades-missing');
}

describe('AC-1: 一覧（例 L1〜L4）', () => {
  it('3 行の並び L2 → L3 → L1 と各行の判定・R・リスク（出ないときの文言）', () => {
    const tree = expand(
      <TradesView
        state={ready([L1, L2, L3])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const rows = rowsOf(tree);
    expect(rows.map((r) => r.href)).toEqual(['/trades/l2', '/trades/l3', '/trades/l1']);
    expect(rows[0]?.badge).toBe('計画どおりの勝ち');
    expect(rows[0]?.text).toContain('+2.0R');
    // リスクだけ出ない行はリスクの段を出さない。理由の文は行に出さない（題の行の「i」）
    expect(rows[0]?.text).not.toContain('リスク');
    expect(rows[0]?.text).not.toContain('資金を設定すると表示されます');
    expect(rows[1]?.badge).toBe('危ない勝ち');
    expect(rows[1]?.badgeClass).toContain('traderow__mark--break');
    // R が出ない行は「—」を 1 つだけ
    expect((rows[1]?.text.match(/—/g) ?? []).length).toBe(1);
    expect(rows[1]?.text).not.toContain('LC が無いため表示されません');
    expect(all(tree, hasClass('tradelist__notes'))).toEqual([]);
    expect(rows[2]?.badge).toBe('A いい損失');
    expect(rows[2]?.badgeClass).toContain('traderow__mark--plan');
    expect(rows[2]?.text).toContain('−1.0R');
    expect(rows[2]?.text).toContain('リスク 0.5%');
    expect(text(tree)).toContain('全 3 件');
    // 行の読み上げの名前（出ない値は理由の文言）
    expect(rows[2]?.label).toContain('US30 L ロング A いい損失 R −1.0R リスク 0.5%');
    expect(rows[1]?.label).toContain('R LC が無いため表示されません');
    // 行の形: 記号の札・2 行（銘柄 · L / S と 判定の名前 · 時刻）・R とリスク（› は擬似要素）
    const row = all(tree, hasClass('traderow'))[0] as El;
    expect(row.children.map((c) => (typeof c === 'string' ? c : cls(c)))).toEqual([
      'traderow__mark traderow__mark--plan',
      'traderow__main',
      'traderow__nums',
    ]);
    const sub = all([row], hasClass('traderow__sub'))[0] as El;
    expect(sub.children.map((c) => (typeof c === 'string' ? c : cls(c)))).toEqual([
      'traderow__grade',
      'traderow__when',
    ]);
    const when = all([row], hasClass('traderow__when'))[0] as El;
    expect(when.type).toBe('time');
    // datetime は表示の時刻と合わせる（端末の時間帯の YYYY-MM-DDTHH:mm。#132 N2）
    expect(when.props.dateTime).toMatch(/^2026-11-1[23]T\d\d:\d\d$/);
    expect(text(when)).toMatch(/^11\/1[23] \d\d:\d\d$/);
    expect(text(all([row], hasClass('traderow__title')))).toBe('US30S');
  });

  it('題「取引」の右に件数、題の下に説明の文を置かない（#127 デザイン b5）。「—」の理由は題の行の「i」', () => {
    const el = (
      <TradesView
        state={ready([L1, L2, L3])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />
    );
    const tree = expand(el);
    expect(all(tree, hasClass('pagehead__desc'))).toEqual([]);
    expect(text(all(tree, hasClass('pagehead__title')))).toBe('取引');
    expect(text(all(tree, hasClass('tradeshead__count')))).toBe('全 3 件（決済の新しい順）');
    const info = all(tree, (e) => e.type === 'button' && e.props.class === 'info');
    expect(info.map((b) => b.props['aria-label'])).toEqual(['「表示されない値」の説明']);
    expect(missingTip(el)?.body).toEqual([
      'リスクの「—」: 資金を設定すると表示されます（1 件）',
      'R・リスクの「—」: LC が無いため表示されません（1 件）',
    ]);
    // 「—」の無い一覧は「i」を出さない
    const clean = (
      <TradesView
        state={ready([L1])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />
    );
    expect(missingTip(clean)).toBeUndefined();
  });

  it('月の区切り: 決済の月ごとの見出し（h2）と「N 件 · 計画どおり M」、月ごとのまとめた一覧', () => {
    const oct = (t: StoredTrade, id: string): StoredTrade => ({
      ...t,
      id,
      record: {
        ...t.record,
        exit: { ...t.record.exit, time: new Date(2026, 9, 20, 12).getTime() },
      },
    });
    const tree = expand(
      <TradesView
        state={ready([L1, L2, L3, oct(L1, 'o1')])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const months = all(tree, hasClass('tradelist-month'));
    expect(months.map((m) => text(all([m], hasClass('tradelist-month__title'))))).toEqual([
      '2026年11月',
      '2026年10月',
    ]);
    expect(months.map((m) => text(all([m], hasClass('tradelist-month__sum'))))).toEqual([
      '3 件 · 計画どおり 2',
      '1 件 · 計画どおり 1',
    ]);
    const h2 = all([months[0] as El], (e) => e.type === 'h2')[0] as El;
    expect((months[0] as El).props['aria-labelledby']).toBe(h2.props.id);
    expect(all([months[0] as El], hasClass('traderow'))).toHaveLength(3);
    const list = all([months[1] as El], (e) => e.type === 'ul')[0] as El;
    expect(list.props['aria-label']).toBe('2026年10月の取引');
  });

  it('取引が無い → 渡した空の状態。読み込み中・読めない', () => {
    const empty = expand(
      <TradesView
        state={ready([])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    // 題「取引」は空の状態でも残す（見出しへのフォーカスを作り直さない）
    expect(text(empty)).toBe('取引空');
    const loading = expand(
      <TradesView
        state={{ phase: 'loading' }}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(text(loading)).toContain('読み込み中');
    const failed = expand(
      <TradesView
        state={{ phase: 'loadFailed', error: '取引を読み込めませんでした。', errorKind: 'auth' }}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(all(failed, (e) => e.props.role === 'alert')).toHaveLength(1);
    expect(text(failed)).toContain('もう一度ログイン');
  });

  it('一覧の空の状態は短い文と下の ［＋ 記録］ を指す一言（ボタンは足さない。#127）', () => {
    const tree = JSON.stringify(Trades());
    expect(tree).toContain('まだ取引がありません');
    expect(tree).toContain('[記録] を押');
    expect(tree).not.toContain('"href":"/record"');
  });
});

describe('AC-7: ホーム（例 H1。#128 で直近 3 件の詰めた行）', () => {
  it('新しい順の 3 件と「すべての取引」の押せる行（[記録する] は下のタブだけ。#127）。2 件目は危ない勝ちで B と同じ段', () => {
    const tree = expand(
      <HomeView
        state={ready([...H1].reverse())}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const rows = all(tree, hasClass('homerow'));
    expect(rows.map((r) => r.props.href)).toEqual(['/trades/h0', '/trades/h1', '/trades/h2']);
    const sub = text(all(rows[1]?.children ?? [], hasClass('homerow__sub')));
    expect(sub.startsWith('危ない勝ち · ')).toBe(true);
    const mark = cls(all(rows[1]?.children ?? [], hasClass('homerow__mark'))[0] as El);
    const bTree = expand(
      <TradesView
        state={ready([D1])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const b = rowsOf(bTree)[0];
    expect(b?.badge).toBe('B 悪い損失');
    // 危ない勝ちは B と同じ崩れの段（勝ちの色 = 計画どおりの段を付けない）
    expect(b?.badgeClass).toContain('traderow__mark--break');
    expect(mark).toContain('homerow__mark--break');
    expect(mark).not.toContain('homerow__mark--plan');
    const links = all(tree, (e) => e.type === 'a').map((a) => a.props.href);
    expect(links).not.toContain('/record');
    const more = all(
      tree,
      (e) => e.type === 'a' && e.props.href === '/trades' && hasClass('rowlink')(e),
    );
    expect(more.map(text)).toEqual(['すべての取引']);
    expect(text(tree)).toContain('直近の取引');
  });

  it('取引が無ければ見出しと空の状態（下の ［＋ 記録］ を指す一言。ボタンは足さない）', () => {
    const tree = expand(
      <HomeView
        state={ready([])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(text(tree).endsWith('空')).toBe(true);
    expect(all(tree, (e) => e.type === 'a')).toEqual([]);
    const home = JSON.stringify(Home());
    expect(home).toContain('最初の取引を記録しましょう');
    expect(home).not.toContain('"href":"/record"');
  });
});

/** 偽の preview（canvas に描くだけ） */
const handle: PreviewHandle = { width: 320, height: 200, draw: noop, close: noop };

function detailState(
  t: StoredTrade,
  charts?: Partial<Record<'entry' | 'exit', ChartView>>,
): DetailState {
  return {
    phase: 'ready',
    trade: t,
    instruments: INSTRUMENTS,
    accounts: [],
    instrumentName: 'US30',
    summary: summarize(t),
    charts: {
      entry: t.charts?.entry ? { phase: 'ready', preview: handle } : { phase: 'none' },
      exit: t.charts?.exit ? { phase: 'ready', preview: handle } : { phase: 'none' },
      ...charts,
    },
  };
}

function detailTree(t: StoredTrade, over: Partial<Parameters<typeof TradeDetailView>[0]> = {}) {
  return expand(
    <TradeDetailView
      id={t.id}
      state={detailState(t)}
      hidden={EMPTY}
      notFound={notFoundState()}
      onDelete={noop}
      onReloadChart={noop}
      onReload={noop}
      onRelogin={noop}
      {...over}
    />,
  );
}

/** 詳細の次の画面「すべての欄」（#131。詳細と同じ状態で描く） */
function fieldsTree(t: StoredTrade, over: Partial<Parameters<typeof TradeDetailView>[0]> = {}) {
  return expand(
    <TradeNotesView
      id={t.id}
      kind="fields"
      state={over.state ?? detailState(t)}
      hidden={over.hidden ?? EMPTY}
      notFound={notFoundState()}
      onReload={noop}
      onRelogin={noop}
    />,
  );
}

/** 詳細と「すべての欄」の 2 画面の木（判定の枠の 1 行と「すべての欄」の行を並べて見るテスト） */
const fullTree = (t: StoredTrade, over: Partial<Parameters<typeof TradeDetailView>[0]> = {}) => [
  ...detailTree(t, over),
  ...fieldsTree(t, over),
];

describe('AC-2・AC-3: 詳細（例 D1・D2）', () => {
  it('#57 AC-2・例 I10: 詳細の判定の枠に「判定」「R」「LC の物差し」の「i」。答えの札の「i」は置かない（#131 のデザインレビュー a1 で #57 のデザインレビュー 8 を取り下げた。問いの説明は記録する・編集の画面）', () => {
    const names = all(detailTree(D1), (e) => e.type === 'button' && hasClass('info')(e)).map((e) =>
      String(e.props['aria-label']),
    );
    expect([...names].sort()).toEqual(
      ['「判定」の説明', '「R」の説明', '「LC の物差し」の説明'].sort(),
    );
  });

  it('AC-2: D1 に B・−1.6R・0.5% と 2 つの理由', () => {
    const tree = detailTree(D1);
    const verdict = all(tree, hasClass('verdict'))[0] as El;
    expect(text(all([verdict], hasClass('badge'))[0] as El)).toBe('B 悪い損失');
    expect(text(verdict)).toContain('−1.6R');
    expect(text(verdict)).toContain('0.5%');
    expect(text(verdict)).toContain('−8,000円');
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons).toContain('LC を広げた（99.5 → 99.2）');
    expect(reasons).toContain('時間足を変えた（4 時間足 → 日足・チャートから）');
  });

  it('AC-3（#131 AC-5）: D1 は 2 枠を横に並べ、押すと全画面で見る層（canvas と名前 · 時間足）', () => {
    const opened: unknown[] = [];
    const tree = detailTree(D1, { onSheet: (x) => opened.push(x) });
    const tiles = all(tree, (e) => e.type === 'button' && hasClass('dchart')(e));
    expect(tiles.map((b) => b.props['aria-label'])).toEqual([
      'エントリー時のチャート（4 時間足）を大きく見る',
      '決済時のチャート（日足）を大きく見る',
    ]);
    expect(all(tree, hasClass('dchart__cap')).map(text)).toEqual([
      'エントリー時 · 4 時間足',
      '決済時 · 日足',
    ]);
    // サムネイルの canvas は読み上げから外し、層の canvas が画像（role=img）
    expect(all(tree, (e) => e.type === 'canvas' && hasClass('dchart__canvas')(e))).toHaveLength(2);
    ((tiles[1] as El).props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'chart', slot: 'exit' }]);
    const viewer = detailTree(D1, { sheet: { kind: 'chart', slot: 'exit' } });
    const layer = all(viewer, (e) => e.props['data-sheet'] === 'detail-chart-viewer')[0] as El;
    expect(layer.props['data-open']).toBe('true');
    const big = all([layer], (e) => e.type === 'canvas')[0] as El;
    expect(big.props.role).toBe('img');
    expect(big.props['aria-label']).toBe('決済時のチャート（日足）');
    expect(text(all([layer], (e) => e.type === 'h2')[0] as El)).toBe('決済時 · 日足');
    expect(text(tree)).not.toContain('チャートなし');
    // img・object URL を使わない
    expect(all(tree, (e) => e.type === 'img')).toEqual([]);
  });

  it('AC-3: D2 は決済時の枠が「チャートなし」', () => {
    const tree = detailTree(D2);
    const figs = all(tree, hasClass('dchart'));
    expect(all([figs[0] as El], (e) => e.type === 'canvas')).toHaveLength(1);
    expect(text(figs[1] as El)).toContain('チャートなし');
    expect(all([figs[1] as El], (e) => e.type === 'canvas')).toHaveLength(0);
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons.some((r) => r.startsWith('時間足を変えた'))).toBe(false);
  });

  it('読めなかった枠は「チャートを読み込めませんでした」と [再読み込み]（その枠だけ）', () => {
    const seen: string[] = [];
    const tree = expand(
      <TradeDetailView
        id="d1"
        state={detailState(D1, { exit: { phase: 'failed' } })}
        hidden={EMPTY}
        notFound={notFoundState()}
        onDelete={noop}
        onReloadChart={(s) => seen.push(s)}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const figs = all(tree, hasClass('dchart'));
    expect(text(figs[1] as El)).toContain('チャートを読み込めませんでした');
    const btn = all([figs[1] as El], (e) => e.type === 'button')[0] as El;
    (btn.props.onClick as () => void)();
    expect(seen).toEqual(['exit']);
  });

  it('[編集] は /trades/<id>/edit、「…」の操作のシートの「削除」は確認なしで onDelete（#131 AC-2）', () => {
    let deleted = 0;
    const opened: unknown[] = [];
    const tree = detailTree(D1, { onDelete: () => deleted++, onSheet: (x) => opened.push(x) });
    expect(all(tree, (e) => e.type === 'a').map((a) => a.props.href)).toContain('/trades/d1/edit');
    // 本文に [削除] は無い（上の帯の「…」の操作のシートの中だけ）
    const more = all(tree, (e) => e.type === 'button' && e.props['aria-label'] === '操作')[0] as El;
    (more.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'actions' }]);
    const sheet = all(tree, (e) => e.props['data-sheet'] === 'detail-actions-sheet')[0] as El;
    expect(sheet.props['data-open']).toBe('false');
    const open = detailTree(D1, { onDelete: () => deleted++, sheet: { kind: 'actions' } });
    const actions = all(open, (e) => e.props['data-sheet'] === 'detail-actions-sheet')[0] as El;
    expect(actions.props['data-open']).toBe('true');
    // D1 は記録したときの値と今の銘柄の値が違う（「今の値と比べる」→「削除」の順。違わない取引は「削除」だけ = detail-view のテスト）
    const rows = all([actions], (e) => e.type === 'button' && hasClass('rowlink')(e));
    expect(rows.map(text)).toEqual(['今の値と比べる1 か所違います', '削除8 秒は元に戻せます']);
    ((rows[1] as El).props.onClick as () => void)();
    expect(deleted).toBe(1);
    noDialog(tree);
  });

  it('#131 AC-6: 「すべての欄」「総評」は次の画面への押せる行（その場で開かない）', () => {
    const tree = detailTree(D1);
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
    const links = all(tree, (e) => e.type === 'a' && hasClass('rowlink')(e));
    expect(links.map((a) => [a.props.href, text(a)])).toEqual([
      ['/trades/d1/fields', 'すべての欄'],
    ]);
    const withComment: StoredTrade = {
      ...D1,
      record: { ...D1.record, exit: { ...D1.record.exit, review: '【取り込み】元の判定 B' } },
    };
    const t2 = detailTree(withComment);
    expect(
      all(t2, (e) => e.type === 'a' && hasClass('rowlink')(e)).map((a) => a.props.href),
    ).toEqual(['/trades/d1/fields', '/trades/d1/comment']);
    const comment = expand(
      <TradeNotesView
        id="d1"
        kind="comment"
        state={detailState(withComment)}
        hidden={EMPTY}
        notFound={notFoundState()}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(text(all(comment, (e) => e.type === 'h1')[0] as El)).toBe('総評');
    expect(text(all(comment, hasClass('notes__text'))[0] as El)).toBe('【取り込み】元の判定 B');
    const fields = fieldsTree(D1);
    expect(text(all(fields, (e) => e.type === 'h1')[0] as El)).toBe('すべての欄');
    // 上の帯の戻るは詳細（殻の無い描画では詳細へのリンク）
    expect(all(fields, (e) => e.type === 'a').map((a) => a.props.href)).toEqual(['/trades/d1']);
    expect(all(fields, hasClass('fields__row')).length).toBeGreaterThan(10);
  });

  it('建てが複数の取引は [直す] を出さず、直せない旨', () => {
    const multi: StoredTrade = {
      ...L1,
      record: { ...L1.record, entries: [L1.record.entries[0], L1.record.entries[0]] },
    };
    const tree = detailTree(multi);
    expect(all(tree, (e) => e.type === 'a' && String(e.props.href).endsWith('/edit'))).toEqual([]);
    expect(text(tree)).toContain(EDIT_BLOCKED);
  });

  it('KEEP-3: 無い ID・消した印の取引は「この取引は見つかりません」と一覧へのリンク', () => {
    for (const tree of [
      detailTree(D1, { state: { phase: 'notFound' } }),
      detailTree(D1, { hidden: new Set(['d1']) }),
    ]) {
      expect(text(tree)).toContain('この取引は見つかりません');
      // 上の帯の「‹ 取引」と、空の状態の [一覧へ戻る]（どちらも一覧へ。#127）
      expect(all(tree, (e) => e.type === 'a').map((a) => a.props.href)).toEqual([
        '/trades',
        '/trades',
      ]);
    }
    const plain = JSON.stringify(TradeDetail({ id: 'x' }));
    expect(plain).toContain('この取引は見つかりません');
  });
});

describe('AC-4: 直す（例 E1・E2）', () => {
  async function editTree(
    t: StoredTrade,
    act?: (c: ReturnType<typeof createEditController>) => void,
    sheet?: Parameters<typeof TradeEditView>[0]['sheet'],
  ) {
    const fake = createFakeApi({ trades: [t], instruments: [US30], capitalYen: CAPITAL_NOW });
    const c = createEditController({ api: fake.api, id: t.id });
    await c.load();
    act?.(c);
    return expand(
      <TradeEditView
        id={t.id}
        state={c.getState()}
        hidden={EMPTY}
        notFound={notFoundState()}
        onUpdate={c.update}
        onSave={noop}
        onReload={noop}
        onRelogin={noop}
        sheet={sheet ?? null}
      />,
    );
  }
  const verdictText = (tree: Node[]) => text(all(tree, hasClass('verdict'))[0] as El);
  const sheetOf = (tree: Node[], id: string) =>
    all(tree, (e) => e.props['data-sheet'] === id)[0] as El;

  it('#58 AC-2・KEEP-4: 直す画面でも取引の欄のシートにエントリーの時刻（任意）が決済の時刻の前にあり、「ほかの欄」に無い。時刻の無い取引は空の欄', async () => {
    const tree = await editTree(E1);
    const inputs = (n: El) => all([n], (e) => e.type === 'input').map((e) => String(e.props.id));
    const section = sheetOf(tree, 'edit-fields-sheet');
    const ids = inputs(section);
    expect(ids.indexOf('record-entry-time')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('record-entry-time')).toBeLessThan(ids.indexOf('record-exit-time'));
    const more = sheetOf(
      await editTree(E1, undefined, { kind: 'fields', step: 'more' }),
      'edit-fields-sheet',
    );
    expect(inputs(more)).toContain('record-pnl');
    expect(inputs(more)).not.toContain('record-entry-time');
    expect(text(all(tree, (e) => e.type === 'label' && e.props.for === 'record-entry-time'))).toBe(
      'エントリーの時刻（任意）',
    );
    // E1 はエントリーの時刻の無い保存済みの取引（空の欄で開ける）
    expect(E1.record.entries[0].time).toBeUndefined();
    const entry = all(
      tree,
      (e) => e.type === 'input' && e.props.id === 'record-entry-time',
    )[0] as El;
    expect(entry.props.value).toBe('');
  });

  it('#131 AC-7: 記録する画面と同じ形（要約 + ［編集］・チャートの 2 枠・LC・3 つのタップ・下の帯に判定の 1 行と ［保存］）。折りたたみは無い', async () => {
    const opened: unknown[] = [];
    const fake = createFakeApi({ trades: [E1], instruments: [US30], capitalYen: CAPITAL_NOW });
    const c = createEditController({ api: fake.api, id: E1.id });
    await c.load();
    const tree = expand(
      <TradeEditView
        id={E1.id}
        state={c.getState()}
        hidden={EMPTY}
        notFound={notFoundState()}
        onUpdate={c.update}
        onSave={noop}
        onReload={noop}
        onRelogin={noop}
        onSheet={(x) => opened.push(x)}
      />,
    );
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
    // 要約は 3 行（名前 / 向き・数量・イン → 決済 / 決済の時刻・明細の損益。#164）
    const summary = all(tree, (e) => e.props.id === 'edit-summary')[0] as El;
    expect(text(all([summary], hasClass('rsum__l1')))).toBe('US30');
    expect(text(all([summary], hasClass('rsum__l2')))).toContain('L · 数量 10,000 · イン 100');
    expect(text(all([summary], hasClass('rsum__l3')))).toContain('明細の損益 −5,000円');
    const edit = all(tree, (e) => e.props.id === 'edit-edit-fields')[0] as El;
    (edit.props.onClick as () => void)();
    expect(all(tree, (e) => e.props.id === 'edit-mini-entry')).toHaveLength(1);
    expect(all(tree, (e) => e.props.id === 'edit-mini-exit')).toHaveLength(1);
    expect(all(tree, (e) => e.props.id === 'record-lc')).toHaveLength(1);
    const bar = all(tree, hasClass('record__submit--bar'))[0] as El;
    const buttons = all([bar], (e) => e.type === 'button');
    expect(buttons.map((b) => b.props.id)).toEqual(['edit-verdict-line', 'edit-submit']);
    ((buttons[0] as El).props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'fields', step: 'main' }, { kind: 'verdict' }]);
    // 判定の枠は判定のシートの中（閉じていても木にある）
    const verdict = sheetOf(tree, 'edit-verdict-sheet');
    expect(verdict.props['data-open']).toBe('false');
    expect(all([verdict], hasClass('verdict'))).toHaveLength(1);
  });

  it('#127（#75 AC-4 の置き換え）: キャンセルは上の帯の左上の ✕（読み上げ「キャンセル」）。保存中は押せない', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30], capitalYen: CAPITAL_NOW });
    const c = createEditController({ api: fake.api, id: E1.id });
    await c.load();
    let cancelled = 0;
    const draw = (state: ReturnType<typeof c.getState>) =>
      expand(
        <TradeEditView
          id={E1.id}
          state={state}
          hidden={EMPTY}
          notFound={notFoundState()}
          onUpdate={c.update}
          onSave={noop}
          onReload={noop}
          onRelogin={noop}
          onCancel={() => cancelled++}
        />,
      );
    const cancelOf = (tree: Node[]) =>
      all(tree, (e) => e.type === 'button' && e.props['aria-label'] === 'キャンセル')[0] as El;
    const tree = draw(c.getState());
    // キャンセルは上の帯の左上の ✕（#127。9.3・9.12）。[保存] の帯には置かない（帯は判定の 1 行と [保存] だけ）
    const actions = all(tree, hasClass('edit__submit'))[0] as El;
    const buttons = all([actions], (e) => e.type === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons[1]?.props.type).toBe('submit');
    expect(all([actions], (e) => e.props['aria-label'] === 'キャンセル')).toEqual([]);
    const bar = all(tree, hasClass('appbar--sheet'))[0] as El;
    expect(all([bar], (e) => e.type === 'button')[0]).toBe(cancelOf(tree));
    expect(text(all([bar], (e) => e.type === 'h1')[0] as El)).toBe('取引を編集');
    expect(cancelOf(tree).props.disabled).toBe(false);
    (cancelOf(tree).props.onClick as () => void)();
    expect(cancelled).toBe(1);
    expect(cancelOf(draw({ ...c.getState(), phase: 'saving' })).props.disabled).toBe(true);
    // 破棄する操作なので「戻る」の山形ではなく ✕（文字は見せず、アイコンだけ）
    expect(text(cancelOf(tree))).toBe('');
    expect(all([cancelOf(tree)], (e) => e.type === 'svg')).toHaveLength(1);
    // 借り直した書きかけは「前の変更の続きです」（借り直していなければ出さない）
    const resumed = (t: Node[]) => all(t, hasClass('draft__resumed'));
    expect(resumed(tree)).toEqual([]);
    const now = 2_000_000_000;
    const again = expand(
      <TradeEditView
        id={E1.id}
        state={c.getState()}
        hidden={EMPTY}
        notFound={notFoundState()}
        onUpdate={c.update}
        onSave={noop}
        onReload={noop}
        onRelogin={noop}
        onCancel={noop}
        resumedAt={now - 2 * 3_600_000}
        now={now}
      />,
    );
    expect(text(resumed(again)[0] as El)).toBe(
      '前の変更の続きです（2 時間前）。破棄するときは左上の ✕（キャンセル）を押してください。',
    );
  });

  it('#57 AC-1・AC-2: 直す画面の 3 つのタップと判定の枠（判定・R・LC の物差し）に「i」', async () => {
    const tree = await editTree(E1);
    const names = all(tree, (e) => e.type === 'button' && hasClass('info')(e)).map((e) =>
      String(e.props['aria-label']),
    );
    for (const q of [
      'LC を入る前に決めていたか',
      'LC を動かしたか',
      '時間足を変えたか',
      '判定',
      'R',
      'LC の物差し',
    ]) {
      expect(names.filter((n) => n === `「${q}」の説明`)).toHaveLength(1);
    }
  });

  it('#171: 直す画面でも「なし」で止まった LC の欄を押すと「なし」を外し、価格は空で入力できる', async () => {
    let c: ReturnType<typeof createEditController> | undefined;
    const tree = await editTree(E1, (x) => {
      c = x;
      x.update({ type: 'set', field: 'lcNone', value: true });
    });
    const lc = all(tree, (e) => e.type === 'input' && e.props.id === 'record-lc')[0] as El;
    expect(lc.props.readOnly).toBe(true);
    expect(lc.props.disabled).toBeFalsy();
    expect(text(all(tree, (e) => e.props.id === 'record-lc-lock')[0] as El)).toBe(
      'なし を選んでいます。押すと価格を入れられます',
    );
    const el = { readOnly: true, blur: noop, focus: noop };
    (lc.props.onClick as (e: unknown) => void)({ currentTarget: el });
    expect(c?.getState().draft).toMatchObject({ lcNone: false, lc: '' });
  });

  it('E1: 保存した値が入り、直す前 B →「そのまま」でプレビュー A・−1.0R・0.5%', async () => {
    const before = await editTree(E1);
    expect(verdictText(before)).toContain('B 悪い損失');
    const lc = all(before, (e) => e.props.id === 'record-lc')[0] as El;
    expect(lc).toBeDefined();
    const after = await editTree(E1, (c) =>
      c.update({ type: 'set', field: 'lcMove', value: 'none' }),
    );
    expect(verdictText(after)).toContain('A いい損失');
    expect(verdictText(after)).toContain('−1.0R');
    expect(verdictText(after)).toContain('0.5%');
    expect(verdictText(after)).not.toContain('0.3%');
    const submit = all(after, (e) => e.props.id === 'edit-submit')[0] as El;
    expect(submit.props.disabled).toBe(false);
    expect(text(submit)).toBe('保存');
    // 明細の枠は出さない
    expect(text(after)).not.toContain('決済明細のスクショ');
    noDialog(after);
  });

  it('E2: チャートの無い枠の時間足を外す旨を判定の枠の上に出し、プレビューは A', async () => {
    const tree = await editTree(E2);
    const notice = all(tree, (e) => e.props.id === 'edit-orphans')[0] as El;
    expect(text(notice)).toBe(
      'チャートが無い時間足（エントリー時: 4 時間足・決済時: 日足）は、保存時に削除されます。チャートが無いと時間足の違いを確認できないためです。',
    );
    expect(verdictText(tree)).toContain('A いい損失');
    // 時間足の選択はチャートのある枠だけ（E2 には無い）。枠は出て、チャートを追加できる（#89）
    expect(
      all(tree, (e) => e.type === 'select' && String(e.props.id ?? '').startsWith('edit-chart-')),
    ).toEqual([]);
    expect(all(tree, (e) => e.props.id === 'edit-chart-exit-file')).toHaveLength(1);
  });

  it('チャートのある枠（D1）は時間足だけを選び直せる', async () => {
    const tree = await editTree(D1);
    const ids = all(tree, (e) => e.type === 'select').map((e) => e.props.id);
    expect(ids).toContain('edit-chart-entry-tf');
    expect(ids).toContain('edit-chart-exit-tf');
    expect(all(tree, (e) => e.props.id === 'edit-orphans')).toEqual([]);
  });

  it('直せない・見つからない・消した印', async () => {
    const multi: StoredTrade = {
      ...L1,
      id: 'm1',
      record: { ...L1.record, entries: [L1.record.entries[0], L1.record.entries[0]] },
    };
    expect(text(await editTree(multi))).toContain(EDIT_BLOCKED);
    const hidden = expand(
      <TradeEditView
        id="e1"
        state={
          await (async () => {
            const fake = createFakeApi({ trades: [E1], instruments: [US30] });
            const c = createEditController({ api: fake.api, id: 'e1' });
            await c.load();
            return c.getState();
          })()
        }
        hidden={new Set(['e1'])}
        notFound={notFoundState()}
        onUpdate={noop}
        onSave={noop}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(text(hidden)).toContain('この取引は見つかりません');
    expect(JSON.stringify(TradeEdit({ id: 'x' }))).toContain('この取引は見つかりません');
  });
});

describe('AC-5・AC-6: 消す + [元に戻す]（トーストと画面）', () => {
  const toastTree = (
    toast: ToastState,
    on: Partial<Record<'undo' | 'dismiss' | 'dismissFailed', () => void>> = {},
    failed = false,
  ) =>
    expand(
      <Toast
        toast={toast}
        failed={failed}
        onUndo={on.undo ?? noop}
        onDismiss={on.dismiss ?? noop}
        onDismissFailed={on.dismissFailed ?? noop}
        onHold={noop}
        onResume={noop}
      />,
    );

  it('トーストは role="status" の領域に「<どの取引> を削除しました」と [元に戻す]（当たりは .btn）', () => {
    let undone = 0;
    const tree = toastTree({ id: 'd1', label: 'US30 L 11/10' }, { undo: () => undone++ });
    const live = all(tree, (e) => e.props.role === 'status')[0] as El;
    expect(live.props['aria-live']).toBe('polite');
    expect(text(live)).toContain('US30 L 11/10 を削除しました');
    expect(all(tree, (e) => e.props.id === 'toast-undo')).toHaveLength(1);
    const undo = all(tree, (e) => e.type === 'button' && text(e) === '元に戻す')[0] as El;
    expect(cls(undo)).toContain('btn');
    (undo.props.onClick as () => void)();
    expect(undone).toBe(1);
    noDialog(tree);
  });

  it('失敗は role="alert" の決まった文言で、[元に戻す] のトーストと並んで出る。何も無ければ領域だけ', () => {
    let closed = 0;
    const failed = toastTree({ id: 'l1', label: 'B' }, { dismissFailed: () => closed++ }, true);
    const alert = all(failed, (e) => e.props.role === 'alert')[0] as El;
    expect(text(alert)).toContain('削除できませんでした');
    expect(text(failed)).toContain('B を削除しました');
    const close = all([alert], (e) => e.type === 'button')[0] as El;
    expect(close.props['aria-label']).toBe('通知を閉じる');
    (close.props.onClick as () => void)();
    expect(closed).toBe(1);
    const none = toastTree(null);
    expect(text(none)).toBe('');
    expect(all(none, (e) => e.props.role === 'status')).toHaveLength(1);
  });

  it('X1 → X2: 消すと一覧の件数が 1 減って詳細は「見つかりません」、[元に戻す] で同じ ID・B・2 枚のチャート', () => {
    const fake = createFakeApi({ trades: [D1, L1, L2] });
    const del = createDeletions({ api: fake.api, setTimer: () => 0, clearTimer: noop });
    const list = () =>
      rowsOf(
        expand(
          <TradesView
            state={ready(fake.trades)}
            hidden={del.getState().hidden}
            empty={emptyEl}
            onReload={noop}
            onRelogin={noop}
          />,
        ),
      );
    expect(list()).toHaveLength(3);
    del.remove('d1');
    expect(list()).toHaveLength(2);
    expect(list().map((r) => r.href)).not.toContain('/trades/d1');
    expect(text(detailTree(D1, { hidden: del.getState().hidden }))).toContain(
      'この取引は見つかりません',
    );
    expect(fake.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    del.undo();
    expect(list().map((r) => r.href)).toContain('/trades/d1');
    const back = detailTree(D1, { hidden: del.getState().hidden });
    expect(text(all(back, hasClass('badge'))[0] as El)).toBe('B 悪い損失');
    expect(all(back, (e) => e.type === 'canvas')).toHaveLength(2);
    expect(fake.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
});

describe('レビュー後: 詳細の見出し・時間足の行・直す前 → 直した後', () => {
  it('詳細の上の帯は「‹ 取引」・題「銘柄 · L / S」・[編集]・「…」（#127・#131）。その下の行は決済の日時だけ', () => {
    const tree = detailTree(D1);
    const h1 = all(tree, (e) => e.type === 'h1')[0] as El;
    expect(text(h1)).toBe('US30 · L ロング');
    const bar = all(tree, hasClass('appbar'))[0] as El;
    expect(all([bar], (e) => e.type === 'a').map((a) => a.props.href)).toEqual([
      '/trades',
      '/trades/d1/edit',
    ]);
    expect(all([bar], (e) => e.type === 'a').map(text)).toEqual(['取引', '編集']);
    expect(
      all([bar], (e) => e.type === 'button').map((b) => b.props['aria-label'] ?? text(b)),
    ).toEqual(['操作']);
    const head = all(tree, hasClass('detail__head'))[0] as El;
    expect(text(head)).toMatch(/決済 2026\/11\/1[01] /);
    expect(all([head], (e) => e.type === 'button')).toEqual([]);
    // 判定の枠の脚注（銘柄・L / S・決済）は出さない
    expect(all(tree, hasClass('verdict__caption'))).toEqual([]);
    // 読めるまで・見つからないときは「取引の詳細」
    const loading = detailTree(D1, { state: { phase: 'loading' } });
    expect(text(all(loading, (e) => e.type === 'h1')[0] as El)).toBe('取引の詳細');
  });

  it('時間足の行は申告とチャートを並べ、判定に使った方に印（理由と食い違わない）', () => {
    const tree = fieldsTree(D1);
    const rows = all(tree, hasClass('fields__row')).map(text);
    expect(rows).toContain(
      '時間足を変えたかそのまま（あなたの答え） / 4 時間足 → 日足（チャートから・判定に使用）',
    );
  });

  it('直す画面: 判定の枠に直す前、保存の帯に「判定: 直す前 → 直した後」', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const c = createEditController({ api: fake.api, id: 'e1' });
    await c.load();
    const view = () =>
      expand(
        <TradeEditView
          id="e1"
          state={c.getState()}
          hidden={EMPTY}
          notFound={notFoundState()}
          onUpdate={c.update}
          onSave={noop}
          onReload={noop}
          onRelogin={noop}
        />,
      );
    const change = () => text(all(view(), (e) => e.props.id === 'edit-change')[0] as El);
    expect(change()).toBe('判定は変わりません: B 悪い損失 −1.0R');
    c.update({ type: 'set', field: 'lcMove', value: 'none' });
    expect(change()).toBe('判定: B 悪い損失 −1.0R → A いい損失 −1.0R');
    const before = all(view(), hasClass('verdict__before'))[0] as El;
    expect(text(before)).toContain('編集前');
    expect(text(before)).toContain('B 悪い損失');
  });

  it('#74: 編集の画面の判定の見出しは「編集後の判定」、編集前の行に「→ 編集後（下）」を出さない。詳細の見出しは「判定」', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const c = createEditController({ api: fake.api, id: 'e1' });
    await c.load();
    const tree = expand(
      <TradeEditView
        id="e1"
        state={c.getState()}
        hidden={EMPTY}
        notFound={notFoundState()}
        onUpdate={c.update}
        onSave={noop}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const titles = all(tree, hasClass('verdict__title')).map((e) => text(e));
    expect(titles).toEqual(['編集後の判定']);
    expect(text(all(tree, hasClass('verdict__before'))[0] as El)).not.toContain('編集後');
    const detail = all(detailTree(E1), hasClass('verdict__title')).map((e) => text(e));
    expect(detail).toEqual(['判定']);
  });
});

// ---- 口座（Issue #47 PR-1。D1・U16〜U19・AC-10）。値・名前はすべて架空 ----

const readyWith = (
  trades: readonly StoredTrade[],
  accounts: readonly AccountRecord[],
): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts,
  more: 'done',
});
const detailWith = (t: StoredTrade, accounts: readonly AccountRecord[]): DetailState => ({
  ...(detailState(t) as Extract<DetailState, { phase: 'ready' }>),
  accounts,
});

/** 口座の radiogroup の aria-describedby（1 行が無いときは付かない） */
function group0Described(t: Parameters<typeof all>[0]): unknown {
  return all(t, (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '口座')[0]?.props[
    'aria-describedby'
  ];
}

describe('口座（#47 D1・U16〜U19）', () => {
  const TWO = [defaultAccount(1_000_000), account('accB', '口座 B', 200_000)];
  const inB = (t: StoredTrade): StoredTrade => ({
    ...t,
    record: { ...t.record, accountId: 'accB' },
  });

  it('D1・AC-10: 口座 2 個 → 各行の銘柄・L / S の後ろに口座の名前（読み上げにも）。付いていない取引は「口座 1」', () => {
    const tree = expand(
      <TradesView
        state={readyWith([L1, inB(L2)], TWO)}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const names = all(tree, hasClass('traderow__account')).map(text);
    expect(names).toEqual(['口座 B', '口座 1']);
    const labels = rowsOf(tree).map((r) => String(r.label));
    expect(labels[0]).toMatch(/ショート 口座 B |ロング 口座 B /);
    expect(labels[1]).toMatch(/ショート 口座 1 |ロング 口座 1 /);
  });

  it('D1: 口座 1 個 → 行に口座の名前を出さない（今と同じ）', () => {
    const tree = expand(
      <TradesView
        state={readyWith([L1, L2], [defaultAccount(1_000_000)])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(all(tree, hasClass('traderow__account'))).toEqual([]);
    expect(rowsOf(tree).every((r) => !String(r.label).includes('口座'))).toBe(true);
  });

  it('U16: ホームの直近の行も同じ', () => {
    const tree = expand(
      <HomeView
        state={readyWith([inB(L1)], TWO)}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    // ホームの詰めた行は 2 行目に「判定の名前 · 口座 · 日付」（#128）
    expect(all(tree, hasClass('homerow__sub')).map(text)[0]).toContain(' · 口座 B · ');
  });

  it('U17: 詳細の見出しの下「決済 … · 口座 B」と判定の枠の「口座 B の資金 1,000,000円（記録したとき）に対して」', () => {
    const t = inB(D1);
    const tree = detailTree(t, { state: detailWith(t, TWO) });
    expect(text(all(tree, hasClass('detail__when')))).toMatch(/^決済 .* · 口座 B$/);
    const capital = t.snapshot.capitalYen as number;
    expect(all(tree, hasClass('verdict__account')).map(text)).toEqual([
      `口座 B の資金 ${capital.toLocaleString('en-US')}円（記録したとき）に対して`,
    ]);
  });

  it('U17・U18: 口座 1 個 → 見出し・判定の枠は今のまま。「すべての欄」には口座と記録したときの資金・許容リスク', () => {
    const tree = fullTree(D1, { state: detailWith(D1, [defaultAccount(5)]) });
    expect(text(all(tree, hasClass('detail__when')))).not.toContain('口座');
    expect(all(tree, hasClass('verdict__account'))).toEqual([]);
    const rows = all(tree, hasClass('fields__row')).map(text);
    expect(rows).toContain('口座口座 1');
    expect(rows.some((r) => r.startsWith('口座の資金（記録したとき）'))).toBe(true);
    expect(rows.some((r) => r.startsWith('許容リスク（記録したとき）'))).toBe(true);
  });

  it('U19: 直す画面は口座 2 つ以上で同じ口座の欄（[＋ 口座を追加] は無い）。替えると 1 行、元へ戻すと消える', async () => {
    const fake = createFakeApi({
      trades: [L1],
      instruments: [US30],
      accounts: TWO,
    });
    const c = createEditController({ api: fake.api, id: L1.id });
    await c.load();
    const tree = () =>
      expand(
        <TradeEditView
          id={L1.id}
          state={c.getState()}
          hidden={EMPTY}
          notFound={notFoundState()}
          onUpdate={c.update}
          onSave={noop}
          onReload={noop}
          onRelogin={noop}
        />,
      );
    const t0 = tree();
    const group = all(
      t0,
      (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '口座',
    )[0];
    expect(
      all(group ? [group] : [], (e) => e.type === 'input' && e.props.checked === true).map(
        (e) => e.props.value,
      ),
    ).toEqual(['default']);
    expect(all(t0, (e) => e.props.id === 'record-account-add')).toEqual([]);
    expect(all(t0, (e) => e.props.id === 'record-account-hint')).toEqual([]);
    c.update({ type: 'set', field: 'accountId', value: 'accB' });
    expect(text(all(tree(), (e) => e.props.id === 'record-account-hint'))).toBe(
      '口座 B の今の資金 200,000円 で再計算します',
    );
    // 2〜3 つの Segment の形でも、1 行を radiogroup の読み上げの説明に結ぶ（select の形と同じ）
    const group1 = all(
      tree(),
      (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '口座',
    )[0];
    expect(group1?.props['aria-describedby']).toBe('record-account-hint');
    expect(group0Described(t0)).toBeUndefined();
    c.update({ type: 'set', field: 'accountId', value: 'default' });
    expect(all(tree(), (e) => e.props.id === 'record-account-hint')).toEqual([]);
  });
});

// ---- 数量の比と提案の数量（Issue #67 AC-7・AC-8）。値・名前はすべて架空 ----

describe('詳細の数量の比と提案の数量（#67）', () => {
  it('L1（1R 5,000・資金 1,000,000・1%）: 判定の枠に 1 行、「すべての欄」に 2 行。口座 2 つなら口座の 1 行の前', () => {
    const TWO = [defaultAccount(1_000_000), account('accB', '口座 B', 200_000)];
    const tree = fullTree(L1, { state: detailWith(L1, TWO) });
    expect(all(tree, hasClass('verdict__sizing')).map(text)).toEqual([
      '数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）',
    ]);
    const verdict = all(tree, hasClass('verdict'))[0] as El;
    const order = verdict.children
      .filter((c): c is El => typeof c !== 'string')
      .map((c) => cls(c).split(' ').at(-1));
    expect(order.indexOf('verdict__account')).toBe(order.indexOf('verdict__sizing') + 1);
    const rows = all(tree, hasClass('fields__row')).map(text);
    expect(rows).toContain('適正の数量20,000');
    expect(rows).toContain('許容リスクに対する数量0.5 倍');
    // 区切りの中は折らない（「数量 10,000」「· 適正の数量 20,000（0.5 倍）」の 2 つ。「·」は行末に残さない。#58 デザインレビュー 6）
    expect(all(tree, hasClass('verdict__seg')).map(text)).toEqual([
      '数量 10,000',
      '· 適正の数量 20,000（実際は 0.5 倍）',
    ]);
  });

  it('資金が未設定の取引は 1 行も 2 行も出さない', () => {
    const t = { ...L1, snapshot: { ...L1.snapshot, capitalYen: null } };
    const tree = fullTree(t);
    expect(all(tree, hasClass('verdict__sizing'))).toEqual([]);
    expect(all(tree, hasClass('fields__row')).map(text).join('')).not.toContain(
      '許容リスクに対する数量',
    );
  });
});

describe('通貨と為替の画面（#47 PR-2・U32・U33・D2）', () => {
  it('U33: 直す画面で通貨の違う口座へ替えると、1 行に「通貨が違うので…」と出て「ほかの欄 ›」の添えが「空に戻しました」、損益・手数料の欄が空（#131: その場で開かない）', async () => {
    const t = {
      ...L1,
      snapshot: { ...L1.snapshot, accountCurrency: 'JPY' },
      record: { ...L1.record, fees: [{ amountYen: 100 }] },
    } as StoredTrade;
    const fake = createFakeApi({
      trades: [t],
      instruments: [US30],
      accounts: [
        defaultAccount(1_000_000),
        account('accD', '口座 D', 10_000, 1, { currency: 'USD' }),
      ],
    });
    const c = createEditController({ api: fake.api, id: t.id });
    await c.load();
    const tree = () =>
      expand(
        <TradeEditView
          id={t.id}
          state={c.getState()}
          hidden={EMPTY}
          notFound={notFoundState()}
          onUpdate={c.update}
          onSave={noop}
          onReload={noop}
          onRelogin={noop}
          sheet={{ kind: 'fields', step: more ? 'more' : 'main' }}
        />,
      );
    const meta = (t: Node[]) =>
      text(
        all(t, (e) => e.props.id === 'edit-more').flatMap((e) =>
          all([e], hasClass('rowlink__meta')),
        ),
      );
    let more = false;
    expect(meta(tree())).toBe('2 欄');
    c.update({ type: 'set', field: 'accountId', value: 'accD' });
    const t1 = tree();
    expect(text(all(t1, (e) => e.props.id === 'record-account-hint'))).toBe(
      '口座 D の今の資金 10,000.00 USD で再計算します。通貨が違うので、損益と手数料を空に戻しました',
    );
    expect(meta(t1)).toBe('空に戻しました');
    more = true;
    const t1m = tree();
    const value = (id: string) =>
      all(t1m, (e) => e.type === 'input' && e.props.id === id)[0]?.props.value;
    expect(value('record-pnl')).toBe('');
    expect(value('record-fee')).toBe('');
    // 元の口座へ戻すと値が戻り、1 行も消える
    c.update({ type: 'set', field: 'accountId', value: 'default' });
    const t2 = tree();
    expect(all(t2, (e) => e.props.id === 'record-account-hint')).toEqual([]);
    expect(meta(t2)).not.toBe('空に戻しました');
    expect(all(t2, (e) => e.type === 'input' && e.props.id === 'record-pnl')[0]?.props.value).toBe(
      '-5000',
    );
  });

  it('D2: F1 の取引の詳細の「すべての欄」に「価格の通貨 USD 建て」「為替 150（1 USD = 150円）」「1R 7,500円」', () => {
    const { statementPnlYen: _s, ...rec } = L1.record;
    const f1 = {
      ...L1,
      snapshot: {
        ...L1.snapshot,
        accountCurrency: 'JPY',
        instrument: { ...L1.snapshot.instrument, priceCurrency: 'USD' },
      },
      record: {
        ...rec,
        entries: [{ price: 100, quantity: 100 }],
        exit: { ...rec.exit, fxRate: 150 },
      },
    } as StoredTrade;
    const rows = all(fieldsTree(f1), hasClass('fields__row')).map(text);
    expect(rows).toContain('価格の通貨USD');
    expect(rows).toContain('為替1 USD = 150円');
    expect(rows).toContain('1R7,500円');
  });
});

// ---- ページ分け（Issue #87 AC-8・AC-9・例 #8・#9・#11 とレビューの指摘）。値はすべて架空 ----

describe('一覧の末尾の段（Issue #87）', () => {
  const view = (state: TradesState, hidden: ReadonlySet<string> = EMPTY, more = noop) =>
    expand(
      <TradesView
        state={state}
        hidden={hidden}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
        onMore={more}
        sentinelRef={noop}
      />,
    );
  const withMore = (
    more: 'idle' | 'loading' | 'failed',
    extra = {},
    trades: readonly StoredTrade[] = [L1, L2, L3],
  ): TradesState => ({
    ...(ready(trades) as Extract<TradesState, { phase: 'ready' }>),
    more,
    ...extra,
  });
  const tail = (tree: Node[]) => all(tree, hasClass('tradelist-more'));
  const moreButton = (tree: Node[]) =>
    all(tree, (e) => e.type === 'button' && e.props.id === TRADES_MORE_ID);
  const status = (tree: Node[]) =>
    all(tree, (e) => e.props.role === 'status').map((e) => ({ cls: cls(e), text: text(e) }));
  const card = (tree: Node[]) => all(tree, hasClass('tradelist-card'))[0] as El;
  /** カードの子の並び（class の先頭の語） */
  const order = (tree: Node[]) =>
    card(tree).children.map((c) => (typeof c === 'string' ? c : cls(c).split(' ')[0]));
  /** 架空の取引 n 件（判定は L1 と同じ） */
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...L1, id: `m${String(i).padStart(3, '0')}` }));

  it('続きがある: 「続きあり」の件数・末尾の印と [続きを読み込む]（押すと onMore）', () => {
    let pressed = 0;
    const tree = view(withMore('idle'), EMPTY, () => {
      pressed++;
    });
    expect(text(tree)).toContain('3 件を表示中（決済の新しい順・続きあり）');
    expect(text(tree)).not.toContain('全 3 件');
    const t = tail(tree)[0] as El;
    expect(all([t], hasClass('tradelist-more__sentinel'))).toHaveLength(1);
    const btn = moreButton(tree)[0] as El;
    expect(text(btn)).toBe('続きを読み込む');
    expect(btn.props['aria-disabled']).toBeUndefined();
    (btn.props.onClick as () => void)();
    expect(pressed).toBe(1);
  });

  it('読み込み中: 同じボタン（同じ ID）を押せない形で残す（フォーカスが落ちない・高さが変わらない）。印は描かない', () => {
    let pressed = 0;
    const tree = view(withMore('loading'), EMPTY, () => {
      pressed++;
    });
    expect(rowsOf(tree)).toHaveLength(3);
    const btn = moreButton(tree)[0] as El;
    expect(text(btn)).toBe('続きを読み込み中…');
    expect(btn.props['aria-disabled']).toBe('true');
    expect(btn.props['aria-busy']).toBe('true');
    (btn.props.onClick as () => void)();
    expect(pressed).toBe(0);
    expect(all(tree, hasClass('tradelist-more__sentinel'))).toHaveLength(0);
  });

  it('失敗（例 #9）: 行は残り、短い決まった文言（role=alert）と同じボタンの [再読み込み]', () => {
    let pressed = 0;
    const tree = view(
      withMore('failed', { moreError: TRADES_MORE_FAILED, moreErrorKind: 'network' }),
      EMPTY,
      () => {
        pressed++;
      },
    );
    expect(TRADES_MORE_FAILED).toBe('続きを読み込めませんでした。通信状況を確認してください。');
    expect(rowsOf(tree)).toHaveLength(3);
    const t = tail(tree)[0] as El;
    expect(all([t], (e) => e.props.role === 'alert').map(text)).toEqual([TRADES_MORE_FAILED]);
    const btn = moreButton(tree)[0] as El;
    expect(text(btn)).toBe('再読み込み');
    (btn.props.onClick as () => void)();
    expect(pressed).toBe(1);
    expect(all([t], hasClass('tradelist-more__sentinel'))).toHaveLength(0);
    const auth = view(withMore('failed', { moreError: 'x', moreErrorKind: 'auth' }));
    expect(text(tail(auth)[0] as El)).toContain('もう一度ログイン');
  });

  it('最後まで: 先頭に「全 N 件」。1 ページに収まる一覧は末尾の文を出さない', () => {
    const tree = view(ready([L1, L2, L3]));
    expect(text(tree)).toContain('全 3 件（決済の新しい順）');
    expect(tail(tree)).toHaveLength(0);
    expect(all(tree, hasClass('tradelist-end'))).toHaveLength(0);
  });

  it('2 ページ以上読んで最後まで: 末尾に「全 N 件を表示しました」（フォーカスを受けられる）', () => {
    const tree = view(ready(many(LIST_PAGE + 1)));
    const end = all(tree, hasClass('tradelist-end'));
    expect(end.map(text)).toEqual([`全 ${LIST_PAGE + 1} 件を表示しました`]);
    expect(end[0]?.props.tabIndex).toBe(-1);
  });

  it('読み上げの欄（role=status）は常に 1 つあり、中身だけが状態で替わる', () => {
    expect(status(view(withMore('idle')))).toEqual([
      { cls: 'sr-only', text: '3 件を表示中（決済の新しい順・続きあり）' },
    ]);
    expect(status(view(withMore('loading')))).toEqual([
      { cls: 'sr-only', text: '続きを読み込んでいます' },
    ]);
    expect(status(view(withMore('failed', { moreError: 'x', moreErrorKind: 'network' })))).toEqual([
      { cls: 'sr-only', text: '' },
    ]);
    expect(status(view(ready([L1, L2, L3])))).toEqual([
      { cls: 'sr-only', text: '全 3 件を表示しました' },
    ]);
  });

  it('月の束の後に末尾の段。「—」の理由は題の行の「i」で、続きがある間は件数の括弧を出さない（#132）', () => {
    const loading = view(withMore('idle'));
    expect(order(loading)).toEqual(['tradelist-month', 'tradelist-more', 'sr-only']);
    expect(all(loading, hasClass('tradelist__notes'))).toEqual([]);
    const tipIdle = missingTip(
      <TradesView
        state={withMore('idle')}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
        onMore={noop}
        sentinelRef={noop}
      />,
    );
    const notes = ((tipIdle?.body ?? []) as string[]).join('');
    expect(notes).toContain('リスクの「—」: 資金を設定すると表示されます');
    expect(notes).not.toMatch(/件）/);
    // 続きがある間、いちばん古い月の数は「N 件を表示中 · 続きあり」
    expect(text(all(loading, hasClass('tradelist-month__sum')))).toBe('3 件を表示中 · 続きあり');
    const tipDone = missingTip(
      <TradesView
        state={ready([L1, L2, L3])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(((tipDone?.body ?? []) as string[]).join('')).toContain(
      'リスクの「—」: 資金を設定すると表示されます（1 件）',
    );
    expect(order(view(ready(many(LIST_PAGE + 1))))).toEqual([
      'tradelist-month',
      'tradelist-end',
      'sr-only',
    ]);
  });

  it('例 #11: [元に戻す] を待つ取引は隠れたまま。見える行が 0 でも続きがあれば空の状態にしない', () => {
    const hidden = new Set(['l2']);
    const tree = view(withMore('idle'), hidden);
    expect(rowsOf(tree).map((r) => r.href)).not.toContain('/trades/l2');
    expect(text(tree)).toContain('2 件を表示中');
    const none = view(withMore('idle', {}, [L2]), hidden);
    expect(all(none, hasClass('empty-marker'))).toEqual([]);
    expect(tail(none)).toHaveLength(1);
  });
});
