// チャートの枠の部品（Issue #89 AC-1・AC-7・AC-9）。部品を呼んで要素の木にして見る。値・画像は架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { ChartPanel, type ChartPanelProps } from '../../ui/src/components/ChartPanel';
import { CHART_MSG, CHART_REMOVED } from '../../ui/src/lib/chart-slots';
import { EXTRA_FULL, type ExtraEntry } from '../../ui/src/lib/charts';
import { fakePreview } from './helpers/statement-rows';

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
  if (typeof vn.type === 'function') return expand((vn.type as (p: unknown) => unknown)(vn.props));
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

const base: ChartPanelProps = {
  idPrefix: 'edit',
  title: 'チャート（任意）',
  charts: {},
  extras: [],
  timeframes: { entry: null, exit: null },
};
const view = (p: Partial<ChartPanelProps>) => expand(<ChartPanel {...base} {...p} />);
const hasClass = (c: string) => (e: El) =>
  String(e.props.class ?? '')
    .split(' ')
    .includes(c);
const frames = (tree: Node[]) => all(tree, (e) => e.type === 'fieldset');
const button = (tree: Node[], label: string) =>
  all(
    tree,
    (e) =>
      e.type === 'button' &&
      (text(e).includes(label) || String(e.props['aria-label'] ?? '').includes(label)),
  );

describe('チャートの枠の部品（Issue #89）', () => {
  it('AC-9: 付属が無ければ 2 枠と「＋ チャートを追加」の 1 行だけ', () => {
    const tree = view({});
    expect(frames(tree)).toHaveLength(2);
    expect(all(tree, (e) => String(e.props.class ?? '').includes('charts__extras'))).toEqual([]);
    const add = button(tree, 'チャートを追加')[0] as El;
    expect(add.props.disabled).toBe(false);
  });

  it('AC-7: 付属の枠は追加した順に「追加のチャート n」と一言の欄。5 枚で [＋] は押せず理由を出す', () => {
    const extras: ExtraEntry[] = (['x3', 'x1', 'x2', 'x5', 'x4'] as const).map((slot) => ({
      slot,
      timeframe: null,
      note: '',
    }));
    const tree = view({ extras });
    const f = frames(tree);
    expect(f.map((e) => e.props['data-chart-slot'])).toEqual([
      'entry',
      'exit',
      'x3',
      'x1',
      'x2',
      'x5',
      'x4',
    ]);
    expect(text(all([f[2] as El], (e) => e.type === 'legend'))).toBe('追加のチャート 1');
    // 「判定には使いません」は小見出しに 1 回だけ。追加の枠は実線の枠
    expect(text(tree).split('判定には使いません').length - 1).toBe(1);
    expect(String((f[2] as El).props.class)).toContain('chart--extra');
    // 画像の無い行は一言の欄を出さない（保存されないため。#89 N7）
    expect(all([f[2] as El], (e) => e.props.id === 'edit-chart-x3-note')).toEqual([]);
    // 画像の無い付属の行も削除できる
    expect(button([f[2] as El], '削除')).toHaveLength(1);
    const add = button(tree, 'チャートを追加')[0] as El;
    expect(add.props.disabled).toBe(true);
    expect(text(tree)).toContain(EXTRA_FULL);
  });

  it('一言が 40 字を超えると欄の誤り', () => {
    const tree = view({
      extras: [{ slot: 'x1', timeframe: null, note: 'あ'.repeat(41) }],
      charts: { x1: { phase: 'ready', preview: fakePreview(), message: null } },
    });
    expect(text(tree)).toContain('一言は 40 字までです。');
  });

  it('AC-1: 編集の保存済みのチャート: 読み戻し中は時間足の欄と [削除]、読めなければ文言と差し替え', () => {
    const loading = view({
      charts: { exit: { phase: 'ready', preview: null, message: null, stored: true } },
      timeframes: { entry: null, exit: '4h' },
    });
    const exit = frames(loading)[1] as El;
    expect(text(exit)).toContain('チャートを読み込んでいます…');
    expect(all([exit], (e) => e.type === 'select')).toHaveLength(1);
    expect(button([exit], '削除')).toHaveLength(1);
    const failed = view({
      charts: {
        exit: { phase: 'failed', preview: null, message: CHART_MSG.loadFailed, stored: true },
      },
    });
    const f = frames(failed)[1] as El;
    expect(text(f)).toContain(CHART_MSG.loadFailed);
    expect(all([f], (e) => e.type === 'input' && e.props.type === 'file')).toHaveLength(1);
    const ready = view({
      charts: { entry: { phase: 'ready', preview: fakePreview(), message: null, stored: true } },
    });
    expect(all([frames(ready)[0] as El], (e) => e.type === 'canvas')).toHaveLength(1);
  });

  it('[削除]・[＋ チャートを追加]・一言の入力を渡す', () => {
    const got: string[] = [];
    const tree = view({
      extras: [{ slot: 'x1', timeframe: null, note: '' }],
      charts: { x1: { phase: 'ready', preview: fakePreview(), message: null } },
      onRemove: (s) => got.push(`remove:${s}`),
      onAddExtra: () => got.push('add'),
      onNote: (s, v) => got.push(`note:${s}:${v}`),
    });
    ((button(tree, '削除')[0] as El).props.onClick as () => void)();
    ((button(tree, 'チャートを追加')[0] as El).props.onClick as () => void)();
    const input = all(tree, (e) => e.props.id === 'edit-chart-x1-note')[0] as El;
    (input.props.onInput as (e: { currentTarget: { value: string } }) => void)({
      currentTarget: { value: '上位足' },
    });
    expect(got).toEqual(['remove:x1', 'add', 'note:x1:上位足']);
  });

  it('編集の画面: 変えた枠の印・削除した保存済みの枠は「保存で削除」と [元に戻す]・差し替えの失敗は前のまま知らせる', () => {
    const got: string[] = [];
    const tree = view({
      markChanges: true,
      charts: {
        entry: { phase: 'ready', preview: fakePreview(), message: null, replaced: true },
        exit: { phase: 'removed', preview: null, message: null },
        x1: { phase: 'ready', preview: fakePreview(), message: null },
        x2: {
          phase: 'ready',
          preview: fakePreview(),
          message: CHART_MSG.keptNotImage,
          stored: true,
        },
      },
      extras: [
        { slot: 'x1', timeframe: null, note: '' },
        { slot: 'x2', timeframe: '1d', note: '週足' },
      ],
      onRestore: (s) => got.push(`restore:${s}`),
    });
    const [entry, exit, x1, x2] = frames(tree) as [El, El, El, El];
    expect(text(all([entry], hasClass('chart__mark')))).toBe('差し替え済み');
    expect(text(all([x1], hasClass('chart__mark')))).toBe('追加（未保存）');
    expect(all([x2], hasClass('chart__mark'))).toEqual([]);
    expect(text(exit)).toContain(CHART_REMOVED);
    expect(button([exit], '削除')).toEqual([]);
    expect(all([exit], (e) => e.type === 'select')).toEqual([]);
    ((button([exit], '元に戻す')[0] as El).props.onClick as () => void)();
    expect(got).toEqual(['restore:exit']);
    expect(text(x2)).toContain('前のチャートのまま');
    expect(all([x2], (e) => e.type === 'canvas')).toHaveLength(1);
    // チャートのある枠は 1 手で差し替えられる
    expect(
      all([entry], (e) => e.type === 'input' && e.props.type === 'file').map(
        (f) => f.props['aria-label'],
      ),
    ).toEqual(['エントリー時のチャートを差し替える']);
    // 記録する画面（markChanges なし）では印を出さない
    const rec = view({
      charts: { x1: { phase: 'ready', preview: fakePreview(), message: null } },
      extras: [{ slot: 'x1', timeframe: null, note: '' }],
    });
    expect(all(rec, hasClass('chart__mark'))).toEqual([]);
  });
});
