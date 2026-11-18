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
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { Home, HomeView } from '../../ui/src/pages/Home';
import { notFoundState, TradeDetail, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeEdit, TradeEditView } from '../../ui/src/pages/TradeEdit';
import { Trades, TradesView } from '../../ui/src/pages/Trades';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi } from './helpers/fake-api';
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

/** 部品（関数）を呼んで、要素（文字列の type）だけの木にする。Link は a として止める（hook を使うため） */
function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
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
function noDialog(tree: Node[]) {
  expect(all(tree, (e) => e.type === 'dialog')).toEqual([]);
  expect(all(tree, (e) => e.props.role === 'dialog' || e.props.role === 'alertdialog')).toEqual([]);
}

const ready = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
});

function rowsOf(tree: Node[]) {
  return all(tree, hasClass('traderow')).map((a) => ({
    href: a.props.href,
    label: a.props['aria-label'],
    badge: text(all(a.children, hasClass('badge'))[0] ?? []),
    badgeClass: cls(all(a.children, hasClass('badge'))[0] as El),
    text: text(a),
  }));
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
    // 行には「—」だけ。理由は一覧の上に 1 回だけ
    expect(rows[0]?.text).toContain('—');
    expect(rows[0]?.text).not.toContain('資金を設定すると出ます');
    expect(rows[1]?.badge).toBe('危ない勝ち');
    expect(rows[1]?.badgeClass).toContain('badge--break');
    expect(rows[1]?.text).not.toContain('R なし');
    expect(rows[1]?.text).not.toContain('LC が無いので出ません');
    const notes = all(tree, hasClass('tradelist__notes')).map(text).join('');
    expect(notes).toContain('リスクの「—」: 資金を設定すると出ます（1 件）');
    expect(notes).toContain('R・リスクの「—」: LC が無いので出ません（1 件）');
    expect(rows[2]?.badge).toBe('A いい損失');
    expect(rows[2]?.text).toContain('−1.0R');
    expect(rows[2]?.text).toContain('0.5%');
    expect(text(tree)).toContain('全 3 件');
    // 行の読み上げの名前
    expect(rows[2]?.label).toContain('US30 L ロング A いい損失 R −1.0R リスク 0.5%');
    expect(rows[1]?.label).toContain('R LC が無いので出ません');
    // 列（日付・銘柄・L / S・判定・R・リスク）が行ごとに同じ順でそろう
    const row = all(tree, hasClass('traderow'))[0] as El;
    expect(row.children.map((c) => (typeof c === 'string' ? c : cls(c)))).toEqual([
      'traderow__date',
      'traderow__inst',
      'traderow__badge',
      'traderow__risk traderow__none',
    ]);
    // 1 行目の判定・R は 1 つのセルの中（幅 720 未満で口座が R の手前まで使える。720 以上は display: contents で列に戻る）
    const badgeCell = row.children[2] as El;
    expect(badgeCell.children.map((c) => (typeof c === 'string' ? c : cls(c))).at(-1)).toBe(
      'num traderow__r',
    );
    expect(row.children[0] && (row.children[0] as El).props.dateTime).toMatch(/^2026-11-1[23]$/);
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
    expect(text(empty)).toBe('空');
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
    expect(text(failed)).toContain('ログインし直す');
  });

  it('一覧の空の状態は [記録する]（/record）', () => {
    const tree = JSON.stringify(Trades());
    expect(tree).toContain('まだ取引がありません');
    expect(tree).toContain('"href":"/record"');
  });
});

describe('AC-7: ホーム（例 H1）', () => {
  it('[記録する] と新しい順の 5 件。2 件目は危ない勝ちで B と同じ段', () => {
    const tree = expand(
      <HomeView
        state={ready([...H1].reverse())}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const rows = rowsOf(tree);
    expect(rows.map((r) => r.href)).toEqual([
      '/trades/h0',
      '/trades/h1',
      '/trades/h2',
      '/trades/h3',
      '/trades/h4',
    ]);
    expect(rows[1]?.badge).toBe('危ない勝ち');
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
    expect(rows[1]?.badgeClass).toBe(b?.badgeClass);
    // 勝ちの色（計画どおりの段）を付けない
    expect(rows[1]?.badgeClass).not.toContain('badge--plan');
    const links = all(tree, (e) => e.type === 'a').map((a) => a.props.href);
    expect(links).toContain('/record');
    expect(links).toContain('/trades');
    expect(text(tree)).toContain('直近の判定');
  });

  it('取引が無ければ空の状態（[記録する]）', () => {
    const tree = expand(
      <HomeView
        state={ready([])}
        hidden={EMPTY}
        empty={emptyEl}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(text(tree)).toBe('空');
    const home = JSON.stringify(Home());
    expect(home).toContain('最初の取引を記録しましょう');
    expect(home).toContain('"href":"/record"');
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

describe('AC-2・AC-3: 詳細（例 D1・D2）', () => {
  it('AC-2: D1 に B・−1.6R・0.5% と 2 つの理由', () => {
    const tree = detailTree(D1);
    const verdict = all(tree, hasClass('verdict'))[0] as El;
    expect(text(all([verdict], hasClass('badge'))[0] as El)).toBe('B 悪い損失');
    expect(text(verdict)).toContain('−1.6R');
    expect(text(verdict)).toContain('0.5%');
    expect(text(verdict)).toContain('−8,000円');
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons).toContain('LC を下げた（99.5 → 99.2）');
    expect(reasons).toContain('時間足を変えた（4 時間足 → 日足・チャートから）');
  });

  it('AC-3: D1 は 2 枠とも canvas（画像）と時間足', () => {
    const tree = detailTree(D1);
    const canvases = all(tree, (e) => e.type === 'canvas');
    expect(canvases.map((c) => c.props['aria-label'])).toEqual([
      'エントリー時のチャート（4 時間足）',
      '決済時のチャート（日足）',
    ]);
    expect(canvases.every((c) => c.props.role === 'img')).toBe(true);
    const figs = all(tree, hasClass('chartview')).map(text);
    expect(figs[0]).toContain('時間足: 4 時間足');
    expect(figs[1]).toContain('時間足: 日足');
    expect(text(tree)).not.toContain('チャートなし');
    // img・object URL を使わない
    expect(all(tree, (e) => e.type === 'img')).toEqual([]);
  });

  it('AC-3: D2 は決済時の枠が「チャートなし」', () => {
    const tree = detailTree(D2);
    const figs = all(tree, hasClass('chartview'));
    expect(all([figs[0] as El], (e) => e.type === 'canvas')).toHaveLength(1);
    expect(text(figs[1] as El)).toContain('チャートなし');
    expect(all([figs[1] as El], (e) => e.type === 'canvas')).toHaveLength(0);
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons.some((r) => r.startsWith('時間足を変えた'))).toBe(false);
  });

  it('読めなかった枠は「チャートを読み込めませんでした」と [もう一度読み込む]（その枠だけ）', () => {
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
    const figs = all(tree, hasClass('chartview'));
    expect(text(figs[1] as El)).toContain('チャートを読み込めませんでした');
    const btn = all([figs[1] as El], (e) => e.type === 'button')[0] as El;
    (btn.props.onClick as () => void)();
    expect(seen).toEqual(['exit']);
  });

  it('[直す] は /trades/<id>/edit、[消す] は確認なしで onDelete', () => {
    let deleted = 0;
    const tree = detailTree(D1, { onDelete: () => deleted++ });
    expect(all(tree, (e) => e.type === 'a').map((a) => a.props.href)).toContain('/trades/d1/edit');
    const del = all(tree, (e) => e.type === 'button' && text(e) === '消す')[0] as El;
    (del.props.onClick as () => void)();
    expect(deleted).toBe(1);
    noDialog(tree);
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
      expect(all(tree, (e) => e.type === 'a').map((a) => a.props.href)).toEqual(['/trades']);
    }
    const plain = JSON.stringify(TradeDetail({ id: 'x' }));
    expect(plain).toContain('この取引は見つかりません');
  });
});

describe('AC-4: 直す（例 E1・E2）', () => {
  async function editTree(
    t: StoredTrade,
    act?: (c: ReturnType<typeof createEditController>) => void,
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
      />,
    );
  }
  const verdictText = (tree: Node[]) => text(all(tree, hasClass('verdict'))[0] as El);

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
    expect(text(submit)).toBe('保存する');
    // 明細の枠は出さない
    expect(text(after)).not.toContain('決済明細のスクショ');
    noDialog(after);
  });

  it('E2: チャートの無い枠の時間足を外す旨を判定の枠の上に出し、プレビューは A', async () => {
    const tree = await editTree(E2);
    const notice = all(tree, (e) => e.props.id === 'edit-orphans')[0] as El;
    expect(text(notice)).toBe(
      'チャートの無い枠の時間足（エントリー時: 4 時間足・決済時: 日足）は、保存のときに外します。チャートが無いと時間足の違いを確かめられないためです。',
    );
    expect(verdictText(tree)).toContain('A いい損失');
    // 時間足の選択はチャートのある枠だけ（E2 には無い）
    expect(all(tree, (e) => String(e.props.id ?? '').startsWith('edit-chart-'))).toEqual([]);
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

  it('トーストは role="status" の領域に「<どの取引> を消しました」と [元に戻す]（当たりは .btn）', () => {
    let undone = 0;
    const tree = toastTree({ id: 'd1', label: 'US30 L 11/10' }, { undo: () => undone++ });
    const live = all(tree, (e) => e.props.role === 'status')[0] as El;
    expect(live.props['aria-live']).toBe('polite');
    expect(text(live)).toContain('US30 L 11/10 を消しました');
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
    expect(text(alert)).toContain('消せませんでした');
    expect(text(failed)).toContain('B を消しました');
    const close = all([alert], (e) => e.type === 'button')[0] as El;
    expect(close.props['aria-label']).toBe('知らせを閉じる');
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
  it('詳細の見出しは「銘柄 · L / S」と決済の日時、一覧へ戻るリンク、[直す]・[消す] は見出しの行', () => {
    const tree = detailTree(D1);
    const h1 = all(tree, (e) => e.type === 'h1')[0] as El;
    expect(text(h1)).toBe('US30 · L ロング');
    const head = all(tree, hasClass('pagehead'))[0] as El;
    expect(text(head)).toMatch(/決済 2026\/11\/1[01] /);
    expect(all([head], (e) => e.type === 'a').map((a) => a.props.href)).toEqual([
      '/trades',
      '/trades/d1/edit',
    ]);
    expect(all([head], (e) => e.type === 'button').map(text)).toEqual(['消す']);
    // 判定の枠の脚注（銘柄・L / S・決済）は出さない
    expect(all(tree, hasClass('verdict__caption'))).toEqual([]);
    // 読めるまで・見つからないときは「取引の詳細」
    const loading = detailTree(D1, { state: { phase: 'loading' } });
    expect(text(all(loading, (e) => e.type === 'h1')[0] as El)).toBe('取引の詳細');
  });

  it('時間足の行は申告とチャートを並べ、判定に使った方に印（理由と食い違わない）', () => {
    const tree = detailTree(D1);
    const rows = all(tree, hasClass('fields__row')).map(text);
    expect(rows).toContain(
      '時間足を変えたか変えず（申告） / 4 時間足 → 日足（チャートから・判定に使用）',
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
    expect(text(before)).toContain('直す前');
    expect(text(before)).toContain('B 悪い損失');
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
    expect(all(tree, hasClass('traderow__account')).map(text)).toEqual(['口座 B']);
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
    const tree = detailTree(D1, { state: detailWith(D1, [defaultAccount(5)]) });
    expect(text(all(tree, hasClass('detail__when')))).not.toContain('口座');
    expect(all(tree, hasClass('verdict__account'))).toEqual([]);
    const rows = all(tree, hasClass('fields__row')).map(text);
    expect(rows).toContain('口座口座 1');
    expect(rows.some((r) => r.startsWith('口座の資金（記録したとき）'))).toBe(true);
    expect(rows.some((r) => r.startsWith('許容リスク（記録したとき）'))).toBe(true);
  });

  it('U19: 直す画面は口座 2 つ以上で同じ口座の欄（[＋ 口座を足す] は無い）。替えると 1 行、元へ戻すと消える', async () => {
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
      '口座 B の今の資金 200,000円 で計算し直します',
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
