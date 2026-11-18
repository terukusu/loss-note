// 設定の画面の描画 SettingsView（Issue #5 契約・AC-1〜AC-7）。DOM のライブラリを使わず、部品の関数を呼んで
// 要素の木に展開して見る（SettingsView と部品は hook を持たない）。状態は偽の API で controller を動かして作る。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { formatDateTime } from '../../ui/src/lib/datetime';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import {
  createSettingsController,
  SETTINGS_LOAD_FAILED,
  type SettingsController,
  type SettingsState,
} from '../../ui/src/lib/settings-controller';
import { EFFECT_NOTE, SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import { SettingsView, type SettingsViewProps } from '../../ui/src/pages/Settings';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeOptions } from './helpers/fake-api';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
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

function render(state: SettingsState, over: Partial<SettingsViewProps> = {}): Node[] {
  const props: SettingsViewProps = {
    state,
    onOpenAccount: noop,
    onCloseAccount: noop,
    onAccount: noop,
    onSaveAccount: noop,
    onOpen: noop,
    onClose: noop,
    onInstrument: noop,
    onSaveInstrument: noop,
    onNewName: noop,
    onAdd: noop,
    onReload: noop,
    onRelogin: noop,
    ...over,
  };
  return expand(SettingsView(props));
}

const byId = (nodes: Node[], id: string) => all(nodes, (e) => e.props.id === id)[0];

describe('口座（#47 U12〜U15）', () => {
  it('U12・U13: 「資金と許容リスク」の枠が「口座」の一覧に替わり、大きな数字の 2 枚は無い', async () => {
    const tree = render(
      await ready({
        accounts: [defaultAccount(1_000_000), account('accB', '口座 B', null)],
      }),
    );
    const t = text(tree);
    expect(t).not.toContain('資金と許容リスク');
    expect(all(tree, (e) => String(e.props.class ?? '').includes('settings__stat'))).toEqual([]);
    const rows = all(tree, (e) => e.props.class === 'instlist__row')
      .map(text)
      .filter((x) => x.includes('口座'));
    expect(rows).toEqual([
      '口座 11,000,000円 · 許容 1%1 回の負けは 10,000円 まで直す',
      '口座 B資金 未設定 · 許容 1%資金を入れるとリスク（%）が出ます直す',
    ]);
    // [直す] の読み上げの名前
    expect(byId(tree, 'settings-account-edit-accB')?.props['aria-label']).toBe('口座 B を直す');
  });

  it('移した直後（口座 1 つ・「口座 1」）も 1 行。特別な案内は出さない', async () => {
    const tree = render(await ready({ capitalYen: 1_000_000 }));
    expect(
      all(tree, (e) => String(e.props.id ?? '').startsWith('settings-account-edit-')),
    ).toHaveLength(1);
    expect(text(tree)).toContain('口座 1');
  });

  it('U14: [直す] で行がその場で開く（名前・資金・許容リスク・[保存] [やめる]・効き方・畳んだ資金の履歴）', async () => {
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
    const form = all(
      tree,
      (e) => e.type === 'form' && e.props['aria-label'] === '口座 1 を直す',
    )[0];
    expect(form).toBeDefined();
    const f = form ? [form] : [];
    for (const id of [
      'settings-account-name',
      'settings-account-capital',
      'settings-account-risk',
    ]) {
      expect(byId(f, id)?.type, id).toBe('input');
    }
    expect(all(f, (e) => e.type === 'button').map(text)).toEqual(['保存', 'やめる']);
    expect(text(f)).toContain(EFFECT_NOTE);
    expect(text(f)).toContain('1 回の負けは 9,000円 までです');
    const details = all(f, (e) => e.type === 'details')[0];
    expect(details?.props.open).toBeUndefined();
    expect(text(all(f, (e) => e.type === 'summary'))).toBe('資金の履歴（3 件）');
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

  it('U15: [＋ 口座を足す]（行の全幅）で同じ欄が開き、[足す] [やめる]。開いている間は [＋ 口座を足す] を出さない', async () => {
    const closed = render(await ready());
    expect(text(byId(closed, 'settings-account-add') ?? [])).toBe('＋ 口座を足す');
    const open = render(await ready({}, (c) => c.openAccount(null)));
    expect(byId(open, 'settings-account-add')).toBeUndefined();
    const form = all(open, (e) => e.type === 'form' && e.props['aria-label'] === '口座を足す')[0];
    expect(all(form ? [form] : [], (e) => e.type === 'button').map(text)).toEqual([
      '足す',
      'やめる',
    ]);
  });

  it('U15: 足せたら名前の順の位置に行が入り、「口座 C を足しました」', async () => {
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
    const names = all(tree, (e) => e.props.class === 'instlist__name')
      .map(text)
      .filter((x) => x.startsWith('口座'));
    expect(names).toEqual(['口座 1', '口座 C', '口座 D']);
    const status = all(tree, (e) => e.props.role === 'status').map(text);
    expect(status).toContain('口座 C を足しました。');
  });

  it('[保存]・[足す] にはフォーカスを戻す先の ID がある（レビュー指摘 6）', async () => {
    const tree = render(
      await ready({}, (c) => {
        c.openInstrument(US30.id);
        c.openAccount('default');
      }),
    );
    for (const id of ['settings-account-save', 'settings-inst-save', 'settings-add']) {
      expect(byId(tree, id)?.type, id).toBe('button');
    }
  });

  it('保存は form の submit（Enter でも押せる）。保存中は押せない', async () => {
    let saved = 0;
    const s = await ready({}, (c) => c.openAccount('default'));
    const tree = render(s, { onSaveAccount: () => saved++ });
    const form = all(
      tree,
      (e) => e.type === 'form' && e.props['aria-label'] === '口座 1 を直す',
    )[0];
    if (!form) throw new Error('口座の form が無い');
    (form.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: noop });
    expect(saved).toBe(1);
    const busy = render({
      ...s,
      account: { ...(s.account as NonNullable<typeof s.account>), saving: true },
    });
    expect(byId(busy, 'settings-account-save')?.props.disabled).toBe(true);
  });

  it('R / 円の切り替えは置かない（スコープ外）', async () => {
    const t = JSON.stringify(render(await ready()));
    expect(t).not.toContain('performanceUnit');
    expect(t).not.toContain('成績の表示');
  });
});

describe('銘柄', () => {
  it('AC-7: 「記録済みの取引は変わりません」が銘柄の枠と、口座の直す欄にある', async () => {
    const t = text(render(await ready()));
    expect(t.split(EFFECT_NOTE).length - 1).toBe(1);
    const open = text(render(await ready({}, (c) => c.openAccount('default'))));
    expect(open.split(EFFECT_NOTE).length - 1).toBe(2);
  });

  it('一覧: 名前・要約・[直す]（読み上げの名前は「US30 を直す」）。仮の値の印', async () => {
    const tree = render(await ready());
    const items = all(
      tree,
      (e) => e.type === 'li' && String(e.props.class ?? '') === 'instlist__item',
    );
    const insts = items.filter((i) => !text(i).startsWith('口座'));
    expect(insts.map((i) => text(i).slice(0, 4))).toEqual(['US30', '日経22']);
    expect(text(insts[0] ?? [])).toContain('仮の値');
    expect(text(insts[1] ?? [])).not.toContain('仮の値');
    const edit = all(tree, (e) => e.type === 'button' && e.props['aria-label'] === 'US30 を直す');
    expect(edit).toHaveLength(1);
  });

  it('開いた行に 7 欄と [保存] [やめる]', async () => {
    const tree = render(await ready({}, (c) => c.openInstrument(US30.id)));
    const labels = all(tree, (e) => e.type === 'label' || e.props.role === 'radiogroup').map(
      (e) => (e.props['aria-label'] as string | undefined) ?? text(e),
    );
    for (const l of [
      '名前',
      '原資産',
      '原資産の種類',
      '商品の形',
      '価格の通貨',
      '乗数',
      '数量の刻み',
    ]) {
      expect(labels, l).toContain(l);
    }
    const buttons = all(tree, (e) => e.type === 'button').map(text);
    expect(buttons).toContain('保存');
    expect(buttons).toContain('やめる');
    // 6 択は select
    const sel = byId(tree, 'settings-inst-kind');
    expect(sel?.type).toBe('select');
    expect(all(sel ? [sel] : [], (e) => e.type === 'option')).toHaveLength(6);
    // 名前を変えると別の銘柄として足されることのヒント
    expect(text(tree)).toContain('名前を変えると');
  });

  it('E10 の誤り: 名前の欄に「同じ名前の銘柄があります」', async () => {
    const tree = render(
      await ready({}, (c) => {
        c.openInstrument(US30.id);
        c.updateInstrument('name', '日経２２５ ');
      }),
    );
    expect(text(byId(tree, 'settings-inst-name-error') ?? [])).toBe(SETTINGS_MSG.duplicateName);
  });

  it('足す欄と [足す]', async () => {
    const tree = render(await ready());
    expect(byId(tree, 'settings-new-name')?.type).toBe('input');
    expect(all(tree, (e) => e.type === 'button').map(text)).toContain('足す');
  });
});

describe('読み込み・失敗', () => {
  it('読み込み中', () => {
    const c = createSettingsController({ api: createFakeApi().api });
    expect(text(render(c.getState()))).toContain('読み込み中');
  });

  it('読み込みの失敗は role="alert" と [もう一度読み込む]', async () => {
    const tree = render(await ready({ fail: { 'GET /api/accounts': 500 } }));
    expect(text(tree)).toContain(SETTINGS_LOAD_FAILED);
    expect(all(tree, (e) => e.props.role === 'alert')).toHaveLength(1);
    expect(all(tree, (e) => e.type === 'button').map(text)).toContain('もう一度読み込む');
  });

  it('ログインが切れたら [ログインし直す]', async () => {
    const load = render(await ready({ fail: { 'GET /api/accounts': 401 } }));
    expect(text(load)).toContain(AUTH_EXPIRED);
    expect(all(load, (e) => e.type === 'button').map(text)).toContain('ログインし直す');
    const save = render(
      await ready({ fail: { 'PUT /api/accounts/default': 401 } }, async (c) => {
        c.openAccount('default');
        c.updateAccount('capital', '1000000');
        await c.saveAccount();
      }),
    );
    expect(text(save)).toContain(AUTH_EXPIRED);
    expect(all(save, (e) => e.type === 'button').map(text)).toContain('ログインし直す');
  });
});
