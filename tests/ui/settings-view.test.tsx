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
import { EFFECT_NOTE, NO_CAPITAL_NOTE, SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import { SettingsView, type SettingsViewProps } from '../../ui/src/pages/Settings';
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
    onField: noop,
    onSave: noop,
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

describe('資金と許容リスク', () => {
  it('未設定: 「未設定」と、資金を設定するとリスク（%）が出る説明', async () => {
    const t = text(render(await ready()));
    expect(t).toContain('未設定');
    expect(t).toContain(NO_CAPITAL_NOTE);
  });

  it('保存済み: 資金 1,000,000円・許容リスク 1%・1 回の負けの上限', async () => {
    const t = text(render(await ready({ capitalYen: 1_000_000 })));
    expect(t).toContain('1,000,000円');
    expect(t).toContain('1%');
    expect(t).toContain('1 回の負けは 10,000円 までです');
    expect(t).not.toContain(NO_CAPITAL_NOTE);
  });

  it('AC-3: 資金の履歴は新しい順に日時と金額', async () => {
    const tree = render(
      await ready({
        capitalYen: 900_000,
        capitalHistory: [
          { valueYen: 1_000_000, at: 1_800_000_000_000 },
          { valueYen: 800_000, at: 1_800_000_100_000 },
          { valueYen: 900_000, at: 1_800_000_200_000 },
        ],
      }),
    );
    const list = byId(tree, 'settings-history');
    expect(list?.type).toBe('ol');
    const rows = all(list ? [list] : [], (e) => e.type === 'li').map(text);
    expect(rows).toEqual([
      `${formatDateTime(1_800_000_200_000)}900,000円`,
      `${formatDateTime(1_800_000_100_000)}800,000円`,
      `${formatDateTime(1_800_000_000_000)}1,000,000円`,
    ]);
    const times = all(list ? [list] : [], (e) => e.type === 'time');
    expect(times).toHaveLength(3);
  });

  it('1 回の負けの上限は入れた値で出し、誤りがある間は出さない（レビュー指摘 1）', async () => {
    const live = text(
      render(await ready({ capitalYen: 1_000_000 }, (c) => c.setField('risk', '2.5'))),
    );
    expect(live).toContain('許容リスク 2.5% なら、1 回の負けは 25,000円 までです');
    const bad = text(
      render(
        await ready({ capitalYen: 1_000_000 }, (c) => {
          c.setField('capital', '1000.5');
          c.setField('risk', '2.5');
        }),
      ),
    );
    expect(bad).not.toContain('1 回の負けは');
    expect(bad).toContain('正しい値を入れると、1 回の負けの上限が出ます');
  });

  it('[保存]・[足す] にはフォーカスを戻す先の ID がある（レビュー指摘 6）', async () => {
    const tree = render(await ready({}, (c) => c.openInstrument(US30.id)));
    for (const id of ['settings-save', 'settings-inst-save', 'settings-add']) {
      expect(byId(tree, id)?.type, id).toBe('button');
    }
  });

  it('履歴が無ければ「まだありません」', async () => {
    expect(text(render(await ready()))).toContain('まだありません');
  });

  it('AC-4: 2.5 は警告の文、2 は出ない（文言で示す）', async () => {
    const warn = render(await ready({}, (c) => c.setField('risk', '2.5')));
    const w = all(warn, (e) => text(e.children) === SETTINGS_MSG.riskWarning && e.type === 'p');
    expect(w).toHaveLength(1);
    expect(w[0]?.props.role).toBe('status');
    const ok = render(await ready({}, (c) => c.setField('risk', '2')));
    expect(text(ok)).not.toContain(SETTINGS_MSG.riskWarning);
  });

  it('AC-2: 誤りは欄の下に文言、aria-invalid', async () => {
    const tree = render(await ready({ capitalYen: 1_000_000 }, (c) => c.setField('capital', '0')));
    const input = byId(tree, 'settings-capital');
    expect(input?.props['aria-invalid']).toBe('true');
    expect(text(byId(tree, 'settings-capital-error') ?? [])).toBe(SETTINGS_MSG.capitalNotPositive);
  });

  it('保存は form の submit（Enter でも押せる）で 1 つの [保存]', async () => {
    let saved = 0;
    const tree = render(await ready(), { onSave: () => saved++ });
    const form = all(tree, (e) => e.type === 'form' && e.props.id === 'settings-form')[0];
    const submit = all(form ? [form] : [], (e) => e.type === 'button' && e.props.type === 'submit');
    expect(submit.map(text)).toEqual(['保存']);
    if (!form) throw new Error('保存の form が無い');
    (form.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: noop });
    expect(saved).toBe(1);
  });

  it('保存中は [保存] を押せない', async () => {
    const s = await ready();
    const tree = render({ ...s, savingSettings: true });
    const submit = all(tree, (e) => e.type === 'button' && e.props.type === 'submit')[0];
    expect(submit?.props.disabled).toBe(true);
  });

  it('R / 円の切り替えは置かない（スコープ外）', async () => {
    const t = JSON.stringify(render(await ready()));
    expect(t).not.toContain('performanceUnit');
    expect(t).not.toContain('成績の表示');
  });
});

describe('銘柄', () => {
  it('AC-7: 「記録済みの取引は変わりません」が資金と銘柄の両方にある', async () => {
    const t = text(render(await ready()));
    expect(t.split(EFFECT_NOTE).length - 1).toBe(2);
  });

  it('一覧: 名前・要約・[直す]（読み上げの名前は「US30 を直す」）。仮の値の印', async () => {
    const tree = render(await ready());
    const items = all(
      tree,
      (e) => e.type === 'li' && String(e.props.class ?? '') === 'instlist__item',
    );
    expect(items.map((i) => text(i).slice(0, 4))).toEqual(['US30', '日経22']);
    expect(text(items[0] ?? [])).toContain('仮の値');
    expect(text(items[1] ?? [])).not.toContain('仮の値');
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
    const tree = render(await ready({ fail: { 'GET /api/settings': 500 } }));
    expect(text(tree)).toContain(SETTINGS_LOAD_FAILED);
    expect(all(tree, (e) => e.props.role === 'alert')).toHaveLength(1);
    expect(all(tree, (e) => e.type === 'button').map(text)).toContain('もう一度読み込む');
  });

  it('ログインが切れたら [ログインし直す]', async () => {
    const load = render(await ready({ fail: { 'GET /api/settings': 401 } }));
    expect(text(load)).toContain(AUTH_EXPIRED);
    expect(all(load, (e) => e.type === 'button').map(text)).toContain('ログインし直す');
    const save = render(
      await ready({ fail: { 'PUT /api/settings': 401 } }, async (c) => {
        c.setField('capital', '1000000');
        await c.saveSettings();
      }),
    );
    expect(text(save)).toContain(AUTH_EXPIRED);
    expect(all(save, (e) => e.type === 'button').map(text)).toContain('ログインし直す');
  });
});
