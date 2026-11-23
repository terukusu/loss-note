// 設定の画面の描画（Issue #5 契約・#47 の口座・#133 のまとめた一覧と次の画面・下のシート）。DOM のライブラリを使わず、部品の
// 関数を呼んで要素の木に展開して見る（View と部品は hook を持たない。Link は a、「i」は閉じた InfoTipView、下のシートは開いて
// いれば dialog に置き換える）。状態は偽の API で controller を動かして作る。値はすべて架空
import { h, type VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade } from '../../core/record';
import { Sheet } from '../../ui/src/components/Sheet';
import { formatDateTime } from '../../ui/src/lib/datetime';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import { Link } from '../../ui/src/lib/router';
import {
  createSettingsController,
  SETTINGS_LOAD_FAILED,
  type SettingsController,
  type SettingsState,
} from '../../ui/src/lib/settings-controller';
import { EFFECT_NOTE, SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import {
  ACCOUNTS_INFO,
  ACCOUNTS_LEAD,
  ACCOUNTS_LEAD_SET,
  settingsMenu,
} from '../../ui/src/lib/settings-menu';
import { Settings, SettingsLinks, SettingsLinksView } from '../../ui/src/pages/Settings';
import {
  ACCOUNT_SHEET_ID,
  SettingsAccountsView,
  type SettingsAccountsViewProps,
} from '../../ui/src/pages/SettingsAccounts';
import {
  INSTRUMENT_ADD_SHEET_ID,
  INSTRUMENT_SHEET_ID,
  PROVISIONAL_NOTE,
  SettingsInstrumentsView,
  type SettingsInstrumentsViewProps,
} from '../../ui/src/pages/SettingsInstruments';
import { account, defaultAccount } from './helpers/accounts';
import { checkChain } from './helpers/enter-chain';
import { createFakeApi, type FakeOptions } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { checkSubmitGate } from './helpers/submit-gate';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

const NONE: El = { type: '', props: {}, children: [] };

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  // Link は context（hook）を読むので a に置き換える
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  // 下のシート（hook を持つ）: 開いていれば dialog（id・題・中身）、閉じていれば何も出さない。
  // closedInfoTip（#130 で Sheet も SheetView に置き換える）より先に見る
  if (vn.type === (Sheet as unknown)) {
    const { children, ...props } = vn.props ?? {};
    if (props.open !== true) return [];
    return [
      {
        type: 'dialog',
        props: { id: props.id, title: props.title, kind: props.kind },
        children: expand(children),
      },
    ];
  }
  const info = closedInfoTip(vn);
  if (info) return expand(info);
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

const noop = () => {};
const cls = (e: El) => String(e.props.class ?? '');

function inst(id: string, name: string, over: Partial<InstrumentRecord> = {}): InstrumentRecord {
  return {
    id,
    name,
    underlyingKind: 'other',
    productForm: 'spotCfd',
    priceCurrency: null,
    multiplier: 1,
    quantityStep: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

const US30 = inst('i-us30', 'US30');
const N225 = inst('i-n225', '日経225', { underlyingKind: 'index', priceCurrency: 'JPY' });

async function ready(
  opts: FakeOptions = {},
  act: (c: SettingsController) => void | Promise<void> = noop,
): Promise<SettingsState> {
  const fake = createFakeApi({ instruments: [US30, N225], ...opts });
  const c = createSettingsController({ api: fake.api });
  await c.load();
  await act(c);
  return c.getState();
}

/** 口座の画面 */
function render(state: SettingsState, over: Partial<SettingsAccountsViewProps> = {}): Node[] {
  const props: SettingsAccountsViewProps = {
    state,
    onOpenAccount: noop,
    onCloseAccount: noop,
    onAccount: noop,
    onSaveAccount: noop,
    onReload: noop,
    onRelogin: noop,
    ...over,
  };
  return expand(h(SettingsAccountsView as never, props as never));
}

/** 銘柄の画面 */
function renderInst(
  state: SettingsState,
  over: Partial<SettingsInstrumentsViewProps> = {},
): Node[] {
  const props: SettingsInstrumentsViewProps = {
    state,
    onOpen: noop,
    onClose: noop,
    onInstrument: noop,
    onSaveInstrument: noop,
    onOpenAdd: noop,
    onCloseAdd: noop,
    onNewName: noop,
    onAdd: noop,
    onReload: noop,
    onRelogin: noop,
    ...over,
  };
  return expand(h(SettingsInstrumentsView as never, props as never));
}

const byId = (nodes: Node[], id: string) => all(nodes, (e) => e.props.id === id)[0];
const sheet = (nodes: Node[], id: string) =>
  all(nodes, (e) => e.type === 'dialog' && e.props.id === id)[0];
/** まとめた一覧（1 枚の面）の行の文字 */
const listRows = (nodes: Node[]) =>
  all(nodes, (e) => e.type === 'ul' && cls(e).split(' ').includes('setlist'))
    .flatMap((ul) => all([ul], (e) => e.type === 'li'))
    .map(text);

describe('設定の根（#133 の AC-1）', () => {
  const root = (over: Partial<Parameters<typeof Settings>[0]> = {}) =>
    Settings({
      theme: 'dark',
      onTheme: noop,
      onSignOut: noop,
      signOutBusy: false,
      signOutError: null,
      ...over,
    }) as VNode<{ children: VNode[] }>;
  /** 数の添えは controller を購読する SettingsLinks（hook）が描く。展開から外す */
  const rootTree = (over: Partial<Parameters<typeof Settings>[0]> = {}) =>
    expand(
      (root(over).props.children as VNode[]).map((c) => (c?.type === SettingsLinks ? null : c)),
    );

  it('大きな題「設定」の下に説明の文が無い。口座・記録の区切り → 表示 → アカウントの順', () => {
    const kids = root().props.children as VNode[];
    expect(kids.map((c) => c?.type).indexOf(SettingsLinks)).toBe(1);
    const tree = rootTree();
    expect(all(tree, (e) => cls(e).includes('pagehead__desc'))).toEqual([]);
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('設定');
    expect(all(tree, (e) => cls(e) === 'setgroup__title').map(text)).toEqual([
      '表示',
      'アカウント',
    ]);
    // テーマはセグメント（ダーク / ライト）、ログアウトは枠つきの面のボタン
    expect(text(tree)).toContain('ダーク');
    expect(text(tree)).toContain('ライト');
    expect(text(tree)).not.toContain('この端末に保存されます');
    const out = all(tree, (e) => e.type === 'button' && text(e) === 'ログアウト')[0] ?? NONE;
    expect(cls(out)).toContain('btn--secondary');
  });

  it('区切りの行は押せる行（a・右に ›）で、行き先と数の添え', () => {
    const tree = expand(
      SettingsLinksView({
        groups: settingsMenu({
          accounts: [defaultAccount(1_000_000), account('b', '口座 B', 500_000)],
          instruments: 3,
          usageToday: 3,
          glossary: 17,
        }),
      }),
    );
    expect(all(tree, (e) => cls(e) === 'setgroup__title').map(text)).toEqual(['口座', '記録']);
    const links = all(tree, (e) => e.type === 'a');
    expect(links.map((a) => [a.props.href, text(a)])).toEqual([
      ['/settings/accounts', '口座2 件'],
      ['/settings/instruments', '銘柄3 件'],
      ['/settings/ai-usage', 'AI の利用状況今日 3 回'],
      ['/glossary', '用語集17 語'],
    ]);
    for (const a of links) expect(cls(a)).toBe('rowlink');
  });

  it('読めていない数は添えを出さない（行は出す）', () => {
    const tree = expand(
      SettingsLinksView({
        groups: settingsMenu({ accounts: null, instruments: null, usageToday: null, glossary: 17 }),
      }),
    );
    expect(all(tree, (e) => cls(e) === 'rowlink__meta').map(text)).toEqual(['17 語']);
    expect(all(tree, (e) => e.type === 'a')).toHaveLength(4);
  });

  it('ログアウトの最中は押せず「ログアウトしています…」、失敗は role="alert"', () => {
    const tree = rootTree({ signOutBusy: true, signOutError: '失敗' });
    const b = all(tree, (e) => e.type === 'button' && text(e) === 'ログアウトしています…')[0];
    expect(b?.props.disabled).toBe(true);
    expect(all(tree, (e) => e.props.role === 'alert').map(text)).toEqual(['失敗']);
  });
});

describe('口座の画面（#133 の AC-3・#47 U12〜U15）', () => {
  it('上の帯「‹ 設定」と題「口座」、先頭の 1 行と「i」（冒頭の説明の移し先）', async () => {
    const tree = render(await ready());
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('口座');
    const back = all(tree, (e) => cls(e) === 'appbar__back')[0];
    expect(back?.props.href).toBe('/settings');
    expect(back?.props['aria-label']).toBe('設定へ戻る');
    const lead = all(tree, (e) => cls(e) === 'setlead')[0];
    expect(text(lead ?? [])).toContain(ACCOUNTS_LEAD);
    expect(
      all(lead ? [lead] : [], (e) => e.props['aria-label'] === `「${ACCOUNTS_INFO.label}」の説明`),
    ).toHaveLength(1);
  });

  it('U12・U13: 口座ごとの押せる行（名前・資金 · 許容・1 回の負け）と ［＋ 口座を追加］。一覧の中に欄は無い', async () => {
    const tree = render(
      await ready({
        accounts: [defaultAccount(1_000_000), account('accB', '口座 B', null)],
      }),
    );
    expect(listRows(tree)).toEqual([
      '口座 11,000,000円 · 許容 1%1 回の負けは 10,000円 まで',
      '口座 B資金 未設定 · 許容 1%資金を入力するとリスク（%）が表示されます',
      '口座を追加',
    ]);
    const row = byId(tree, 'settings-account-edit-accB') ?? NONE;
    expect(row.type).toBe('button');
    expect(row.props['aria-label']).toBe('口座 B を編集');
    expect(row.props['aria-haspopup']).toBe('dialog');
    expect(cls(row)).toBe('setrow');
    expect(all(tree, (e) => e.type === 'input' || e.type === 'form')).toEqual([]);
    expect(all(tree, (e) => e.type === 'dialog')).toEqual([]);
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
  });

  it('移した直後（口座 1 つ・「口座 1」）も 1 行。特別な案内は出さない', async () => {
    const tree = render(await ready({ capitalYen: 1_000_000 }));
    expect(
      all(
        tree,
        (e) => e.type === 'button' && String(e.props.id ?? '').startsWith('settings-account-edit-'),
      ),
    ).toHaveLength(1);
    expect(text(tree)).toContain('口座 1');
  });

  it('U14: 行を押すと編集のシート（名前・資金・許容リスク・効き方・畳まない資金の履歴・下に貼り付く ［保存］）', async () => {
    const tree = render(
      await ready(
        {
          capitalYen: 900_000,
          capitalHistory: [
            { valueYen: 1_000_000, at: 1_800_000_000_000 },
            { valueYen: 800_000, at: 1_800_000_100_000 },
            { valueYen: 900_000, at: 1_800_000_200_000 },
          ],
        },
        (c) => c.openAccount('default'),
      ),
    );
    const sh = sheet(tree, ACCOUNT_SHEET_ID) ?? NONE;
    expect(sh.props.title).toBe('口座 1 を編集');
    expect(sh.props.kind).toBe('form');
    const f = [sh];
    for (const id of [
      'settings-account-name',
      'settings-account-capital',
      'settings-account-risk',
    ]) {
      expect(byId(f, id)?.type, id).toBe('input');
    }
    // 閉じるはシートの ✕・Esc・外・戻る（［キャンセル］ は置かない）。主のボタンは ［保存］ の 1 つ
    expect(all(f, (e) => e.type === 'button').map(text)).toEqual(['保存']);
    expect(cls(byId(f, 'settings-account-save') ?? NONE)).toContain('btn--primary');
    // 常に出す文は減らす（#133 デザインレビュー a-2）: 効き方の文は口座の画面の「i」へ、資金の書き方の注記は置かない
    expect(text(f)).not.toContain(EFFECT_NOTE);
    expect(text(f)).not.toContain('円の整数で入力します');
    expect(text(f)).toContain('1 回の負けは 9,000円 までです');
    // ［保存］ の帯（貼り付く）はフォームの最後（資金の履歴の後）
    const form = all(f, (e) => e.type === 'form')[0] ?? NONE;
    const last = form.children.filter((c) => typeof c !== 'string').at(-1);
    expect(typeof last === 'string' ? '' : cls(last ?? NONE)).toBe('setform__actions');
    expect(all(f, (e) => e.type === 'details')).toEqual([]);
    expect(text(all(f, (e) => e.type === 'h3'))).toBe('資金の履歴（3 件）');
    const rows = all(f, (e) => e.type === 'li').map(text);
    expect(rows).toEqual([
      `${formatDateTime(1_800_000_200_000)}900,000円`,
      `${formatDateTime(1_800_000_100_000)}800,000円`,
      `${formatDateTime(1_800_000_000_000)}1,000,000円`,
    ]);
  });

  it('U14: 2% 超の警告（今の文言）・誤りは欄の下に文言と aria-invalid', async () => {
    const warn = render(
      await ready({}, (c) => {
        c.openAccount('default');
        c.updateAccount('risk', '2.5');
      }),
    );
    const w = all(warn, (e) => text(e.children) === SETTINGS_MSG.riskWarning && e.type === 'p');
    expect(w).toHaveLength(1);
    expect(w[0]?.props.role).toBe('status');
    const bad = render(
      await ready({ capitalYen: 1_000_000 }, (c) => {
        c.openAccount('default');
        c.updateAccount('capital', '0');
      }),
    );
    expect(byId(bad, 'settings-account-capital')?.props['aria-invalid']).toBe('true');
    expect(text(byId(bad, 'settings-account-capital-error') ?? [])).toBe(
      SETTINGS_MSG.capitalNotPositive,
    );
    expect(text(bad)).not.toContain('1 回の負けは 0円');
  });

  it('U15: ［＋ 口座を追加］（＋ のアイコンつきの行）で追加のシート（同じ欄・［追加］）', async () => {
    const closed = render(await ready());
    const add = byId(closed, 'settings-account-add') ?? NONE;
    expect(text(add)).toBe('口座を追加');
    expect(cls(add)).toBe('setrow setrow--add');
    expect(all([add], (e) => e.type === 'svg')).toHaveLength(1);
    const open = render(await ready({}, (c) => c.openAccount(null)));
    const sh = sheet(open, ACCOUNT_SHEET_ID) ?? NONE;
    expect(sh.props.title).toBe('口座を追加');
    expect(all([sh], (e) => e.type === 'button').map(text)).toEqual(['追加']);
  });

  it('U15: 足せたらシートが閉じ、名前の順の位置に行が入り、一覧の上に「口座 C を追加しました」', async () => {
    const tree = render(
      await ready(
        { accounts: [defaultAccount(null), account('accD', '口座 D', null)] },
        async (c) => {
          c.openAccount(null);
          c.updateAccount('name', '口座 C');
          await c.saveAccount();
        },
      ),
    );
    expect(all(tree, (e) => e.type === 'dialog')).toEqual([]);
    const names = all(tree, (e) => e.props.class === 'setrow__name').map(text);
    expect(names).toEqual(['口座 1', '口座 C', '口座 D']);
    const status = all(tree, (e) => e.props.role === 'status').map(text);
    expect(status).toContain('口座 C を追加しました。');
  });

  it('保存は form の submit（Enter でも押せる）。保存中は押せず、行も押せない', async () => {
    let saved = 0;
    const s = await ready({}, (c) => c.openAccount('default'));
    const tree = render(s, { onSaveAccount: () => saved++ });
    const form = all(
      tree,
      (e) => e.type === 'form' && e.props['aria-label'] === '口座 1 を編集',
    )[0];
    if (!form) throw new Error('口座の form が無い');
    (form.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: noop });
    expect(saved).toBe(1);
    expect(byId(tree, 'settings-account-save')?.type).toBe('button');
    const busy = render({
      ...s,
      account: { ...(s.account as NonNullable<typeof s.account>), saving: true },
    });
    expect(byId(busy, 'settings-account-save')?.props.disabled).toBe(true);
    expect(byId(busy, 'settings-account-edit-default')?.props.disabled).toBe(true);
  });

  it('シートの閉じ方: ✕・Esc・外は保存中なら閉じない、戻る・close watcher は保存中でも閉じる（force）', async () => {
    const calls: (boolean | undefined)[] = [];
    const s = await ready({}, (c) => c.openAccount('default'));
    const vn = SettingsAccountsView({
      state: s,
      onOpenAccount: noop,
      onCloseAccount: (force) => calls.push(force),
      onAccount: noop,
      onSaveAccount: noop,
      onReload: noop,
      onRelogin: noop,
    }) as VNode<{ children: VNode[] }>;
    const sheetVn = (vn.props.children as VNode[]).find((c) => c?.type === Sheet) as VNode<{
      onDismiss: (r: string) => void;
    }>;
    for (const r of ['button', 'escape', 'backdrop', 'back', 'native']) sheetVn.props.onDismiss(r);
    expect(calls).toEqual([false, false, false, true, true]);
  });

  it('R / 円の切り替えは置かない（スコープ外）', async () => {
    const t = JSON.stringify(render(await ready()));
    expect(t).not.toContain('performanceUnit');
    expect(t).not.toContain('成績の表示');
  });
});

describe('銘柄の画面（#133 の AC-4）', () => {
  it('上の帯「‹ 設定」と題「銘柄」。押せる行（名前・初期値のままの印・要約）と ［＋ 銘柄を追加］。追加の欄は押すまで無い', async () => {
    const tree = renderInst(await ready());
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('銘柄');
    const rows = listRows(tree);
    expect(rows.map((r) => r.slice(0, 4))).toEqual(['US30', '日経22', '銘柄を追']);
    expect(rows[0]).toContain('初期値のまま');
    expect(rows[1]).not.toContain('初期値のまま');
    const edit = all(tree, (e) => e.type === 'button' && e.props['aria-label'] === 'US30 を編集');
    expect(edit).toHaveLength(1);
    expect(edit[0]?.props.id).toBe('settings-edit-i-us30');
    expect(byId(tree, 'settings-new-name')).toBeUndefined();
    expect(all(tree, (e) => e.type === 'input' || e.type === 'form')).toEqual([]);
    // 一覧の上に説明の文を常に出さない（効き方は編集のシートの中）
    expect(text(tree)).not.toContain(EFFECT_NOTE);
  });

  it('銘柄の行の添えは 2 行（種類 · 形 · 通貨 / 乗数 · 刻み）。#133 デザインレビュー a-4', async () => {
    const tree = renderInst(await ready());
    const edit = all(
      tree,
      (e) => e.type === 'button' && e.props['aria-label'] === 'US30 を編集',
    )[0];
    const lines = all([edit ?? NONE], (e) => cls(e).split(' ').includes('setrow__line')).map(text);
    expect(lines).toEqual(['その他 · 現物・CFD · 価格の通貨 未設定', '乗数 1 · 刻み 1']);
  });

  it('口座の画面の先頭の 1 行: 資金が未設定の口座があるときだけ頼む文（a-5）', async () => {
    const lead = async (capitalYen: number | null) =>
      text(all(render(await ready({ capitalYen })), (e) => cls(e) === 'setlead'));
    expect(await lead(null)).toContain('入力してください');
    expect(await lead(1_000_000)).toContain(ACCOUNTS_LEAD_SET);
  });

  it('行を押すと編集のシートに 7 欄と ［保存］（［キャンセル］ は置かない）・効き方', async () => {
    const tree = renderInst(await ready({}, (c) => c.openInstrument(US30.id)));
    const sh = sheet(tree, INSTRUMENT_SHEET_ID) ?? NONE;
    expect(sh.props.title).toBe('US30 を編集');
    const f = [sh];
    const labels = all(f, (e) => e.type === 'label' || e.props.role === 'radiogroup').map(
      (e) => (e.props['aria-label'] as string | undefined) ?? text(e),
    );
    for (const l of [
      '名前',
      '原資産',
      '原資産の種類',
      '取引の形態',
      '価格の通貨',
      '乗数',
      '数量の刻み',
    ]) {
      expect(labels, l).toContain(l);
    }
    expect(all(f, (e) => e.type === 'button').map(text)).toEqual(['保存']);
    const sel = byId(f, 'settings-inst-kind');
    expect(sel?.type).toBe('select');
    expect(all(sel ? [sel] : [], (e) => e.type === 'option')).toHaveLength(6);
    expect(text(f)).toContain('名前を変えると');
    expect(text(f)).toContain(EFFECT_NOTE);
    // 初期値のままの銘柄だけ、その説明
    expect(text(f)).toContain(PROVISIONAL_NOTE);
    const n225 = renderInst(await ready({}, (c) => c.openInstrument(N225.id)));
    expect(text(n225)).not.toContain(PROVISIONAL_NOTE);
  });

  it('E10 の誤り: 名前の欄に「同じ名前の銘柄があります」', async () => {
    const tree = renderInst(
      await ready({}, (c) => {
        c.openInstrument(US30.id);
        c.updateInstrument('name', '日経２２５ ');
      }),
    );
    expect(text(byId(tree, 'settings-inst-name-error') ?? [])).toBe(SETTINGS_MSG.duplicateName);
  });

  it('［＋ 銘柄を追加］ → 追加のシート（名前・［追加］）。誤りはシートの中', async () => {
    const tree = renderInst(
      await ready({}, async (c) => {
        c.openAddInstrument();
        await c.addInstrument();
      }),
    );
    const sh = sheet(tree, INSTRUMENT_ADD_SHEET_ID) ?? NONE;
    expect(sh.props.title).toBe('銘柄を追加');
    const f = [sh];
    expect(byId(f, 'settings-new-name')?.type).toBe('input');
    expect(text(byId(f, 'settings-new-name-error') ?? [])).toBe(SETTINGS_MSG.nameRequired);
    expect(all(f, (e) => e.type === 'button').map(text)).toEqual(['追加']);
    expect(byId(f, 'settings-add')?.type).toBe('button');
  });

  it('足せたらシートが閉じ、一覧の上に知らせ', async () => {
    const tree = renderInst(
      await ready({}, async (c) => {
        c.openAddInstrument();
        c.setNewName('GOLD');
        await c.addInstrument();
      }),
    );
    expect(all(tree, (e) => e.type === 'dialog')).toEqual([]);
    expect(all(tree, (e) => e.props.role === 'status').map(text)).toContain(
      'GOLD を追加しました。',
    );
    expect(listRows(tree).map((r) => r.slice(0, 4))).toContain('GOLD');
  });

  it('銘柄が 0 件なら短い 1 行と ［＋ 銘柄を追加］', async () => {
    const tree = renderInst(await ready({ instruments: [] }));
    expect(text(tree)).toContain('まだありません');
    expect(listRows(tree)).toEqual(['銘柄を追加']);
  });
});

describe('読み込み・失敗', () => {
  it('読み込み中', () => {
    const c = createSettingsController({ api: createFakeApi().api });
    expect(text(render(c.getState()))).toContain('読み込んでいます…');
    expect(text(renderInst(c.getState()))).toContain('読み込んでいます…');
  });

  it('読み込みの失敗は role="alert" と [再読み込み]', async () => {
    const tree = render(await ready({ fail: { 'GET /api/accounts': 500 } }));
    expect(text(tree)).toContain(SETTINGS_LOAD_FAILED);
    expect(all(tree, (e) => e.props.role === 'alert')).toHaveLength(1);
    expect(all(tree, (e) => e.type === 'button').map(text)).toContain('再読み込み');
  });

  it('ログインが切れたら [もう一度ログイン]', async () => {
    const load = render(await ready({ fail: { 'GET /api/accounts': 401 } }));
    expect(text(load)).toContain(AUTH_EXPIRED);
    expect(all(load, (e) => e.type === 'button').map(text)).toContain('もう一度ログイン');
    const save = render(
      await ready({ fail: { 'PUT /api/accounts/default': 401 } }, async (c) => {
        c.openAccount('default');
        c.updateAccount('capital', '1000000');
        await c.saveAccount();
      }),
    );
    expect(text(save)).toContain(AUTH_EXPIRED);
    expect(all(save, (e) => e.type === 'button').map(text)).toContain('もう一度ログイン');
  });
});

describe('口座の通貨（#47 PR-2・U30・U31）', () => {
  const D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });
  const lockedTrade = {
    id: 't-d',
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'other',
        productForm: 'spotCfd',
      },
      capitalYen: 10_000,
      riskTolerancePct: 1,
      accountCurrency: 'USD',
    },
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId: 'i-us30',
      accountId: 'accD',
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity: 1 }],
      exit: { time: 1, price: 99.5, orderType: 'unknown', reason: 'other', gapSlip: 'unanswered' },
      fees: [],
    },
  } as StoredTrade;

  it('U30: 外貨の口座の行は「10,000.00 USD · 許容 1%」「1 回の負けは 100.00 USD まで」', async () => {
    const tree = render(await ready({ accounts: [defaultAccount(1_000_000), D] }));
    const t = text(tree);
    expect(t).toContain('10,000.00 USD · 許容 1%');
    expect(t).toContain('1 回の負けは 100.00 USD まで');
    expect(t).toContain('1,000,000円 · 許容 1%');
  });

  it('U30: 足す欄に「通貨」（既定 JPY）、資金の単位は入れた通貨に追従', async () => {
    const st = await ready({}, (c) => {
      c.openAccount(null);
      c.updateAccount('currency', 'usd');
    });
    const tree = render(st);
    const cur = byId(tree, 'settings-account-currency') as El;
    expect(cur.type).toBe('input');
    expect(cur.props.value).toBe('usd');
    const capitalField = all(tree, (e) =>
      String(e.props.class ?? '')
        .split(' ')
        .includes('field'),
    ).find((e) => all([e], (x) => x.props.id === 'settings-account-capital').length === 1) as El;
    expect(text(all([capitalField], (e) => e.props.class === 'numfield__unit'))).toBe('USD');
    const fresh = render(await ready({}, (c) => c.openAccount(null)));
    expect((byId(fresh, 'settings-account-currency') as El).props.value).toBe('JPY');
  });

  it('U31: 取引のある口座の直す欄は、通貨が文字「通貨: USD（取引があるので変更できません）」で欄ではない', async () => {
    const tree = render(
      await ready(
        { accounts: [defaultAccount(1_000_000), D], trades: [lockedTrade] },
        async (c) => {
          c.openAccount('accD');
          // 通貨を変える操作で取引を確かめ、取引のある口座なら文字になる（開いたときは読まない）
          c.updateAccount('currency', 'JPY');
          await c.settled();
        },
      ),
    );
    const cur = byId(tree, 'settings-account-currency') as El;
    expect(cur.type).toBe('p');
    expect(text(cur)).toBe('通貨: USD（取引があるので変更できません）');
    expect(
      all(tree, (e) => e.type === 'input' && e.props.id === 'settings-account-currency'),
    ).toEqual([]);
  });

  it('#174: 取引のある口座は通貨が文字なので、決定キーの並びは 名前 → 資金 → 許容リスク（完了）', async () => {
    const tree = render(
      await ready(
        { accounts: [defaultAccount(1_000_000), D], trades: [lockedTrade] },
        async (c) => {
          c.openAccount('accD');
          c.updateAccount('currency', 'JPY');
          await c.settled();
        },
      ),
    );
    const find = (id: string) => all(tree, (e) => e.type === 'input' && e.props.id === id)[0];
    checkChain(find, [
      'settings-account-name',
      'settings-account-capital',
      'settings-account-risk',
    ]);
  });

  it('資金の履歴は行の通貨で（USD の行は「10,000.00 USD」、通貨の無い行は円）', async () => {
    const withHistory = {
      ...D,
      capitalHistory: [
        { valueYen: 1_000_000, at: 1_700_000_000_000 },
        { valueYen: 10_000, at: 1_700_000_100_000, currency: 'USD' },
      ],
    };
    const tree = render(
      await ready({ accounts: [defaultAccount(1_000_000), withHistory] }, (c) =>
        c.openAccount('accD'),
      ),
    );
    const rows = all(tree, (e) => e.props.class === 'sethistory__row').map((e) => text(e));
    expect(rows.some((r) => r.endsWith('10,000.00 USD'))).toBe(true);
    expect(rows.some((r) => r.endsWith('1,000,000円'))).toBe(true);
  });
});

describe('文の中の金額は数と単位を 1 つの塊にする（#47 PR-2 デザイン 8）', () => {
  it('設定の口座の行: 「10,000.00 USD」「100.00 USD」「1,000,000円」が .num-money の塊', async () => {
    const tree = render(
      await ready({
        accounts: [
          defaultAccount(1_000_000),
          account('accD', '口座 D', 10_000, 1, { currency: 'USD' }),
        ],
      }),
    );
    const chunks = all(tree, (e) => e.props.class === 'num-money').map((e) => text(e));
    expect(chunks).toContain('10,000.00 USD');
    expect(chunks).toContain('100.00 USD');
    expect(chunks).toContain('1,000,000円');
    expect(chunks).toContain('10,000円');
    // 行の文字そのものは変わらない
    expect(text(tree)).toContain('1 回の負けは 100.00 USD まで');
  });
});

describe('設定のシートの決定キー（#174 の例の表 #7・#8・#11）', () => {
  const inputById = (tree: Node[]) => (id: string) =>
    all(tree, (e) => e.type === 'input' && e.props.id === id)[0];
  const formOf = (tree: Node[], label: string) => {
    const f = all(tree, (e) => e.type === 'form' && e.props['aria-label'] === label)[0];
    if (!f) throw new Error(`form が無い: ${label}`);
    return f;
  };

  it('#7 口座: 名前 → 通貨 → 資金 → 許容リスク（完了。保存は送らない）', async () => {
    let saved = 0;
    for (const target of ['default', null] as const) {
      const tree = render(await ready({}, (c) => c.openAccount(target)), {
        onSaveAccount: () => saved++,
      });
      checkChain(inputById(tree), [
        'settings-account-name',
        'settings-account-currency',
        'settings-account-capital',
        'settings-account-risk',
      ]);
    }
    expect(saved).toBe(0);
  });

  it('#8 銘柄: 名前 → 原資産 → 価格の通貨 → 乗数 → 数量の刻み（完了）。原資産の種類・取引の形態は飛ばす', async () => {
    let saved = 0;
    const tree = renderInst(await ready({}, (c) => c.openInstrument(US30.id)), {
      onSaveInstrument: () => saved++,
    });
    checkChain(inputById(tree), [
      'settings-inst-name',
      'settings-inst-underlying',
      'settings-inst-currency',
      'settings-inst-multiplier',
      'settings-inst-step',
    ]);
    expect(saved).toBe(0);
  });

  it('#11 キーボードの印の間は、口座・銘柄の編集のシートの暗黙の送信で保存せず、［保存］ を押したときだけ送る（#183 と同じ門）', async () => {
    let account = 0;
    const accTree = render(await ready({}, (c) => c.openAccount('default')), {
      onSaveAccount: () => account++,
    });
    checkSubmitGate(formOf(accTree, '口座 1 を編集'), () => account);
    let added = 0;
    const addTree = render(await ready({}, (c) => c.openAccount(null)), {
      onSaveAccount: () => added++,
    });
    checkSubmitGate(formOf(addTree, '口座を追加'), () => added);
    let inst = 0;
    const instTree = renderInst(await ready({}, (c) => c.openInstrument(US30.id)), {
      onSaveInstrument: () => inst++,
    });
    checkSubmitGate(formOf(instTree, 'US30 を編集'), () => inst);
  });

  it('KEEP-3: 銘柄の追加（欄が 1 つ）は今のまま、欄の Enter（暗黙の送信）で ［追加］ を送る。決定キーは付けない', async () => {
    let added = 0;
    const tree = renderInst(await ready({}, (c) => c.openAddInstrument()), {
      onAdd: () => added++,
    });
    const name = inputById(tree)('settings-new-name');
    expect(name?.props.enterKeyHint).toBeUndefined();
    expect(name?.props.onKeyDown).toBeUndefined();
    (formOf(tree, '銘柄を追加').props.onSubmit as (e: { preventDefault(): void }) => void)({
      preventDefault: noop,
    });
    expect(added).toBe(1);
  });
});
