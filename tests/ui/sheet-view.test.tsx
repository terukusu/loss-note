// 下のシートの木（Issue #129。components/Sheet.tsx の SheetView。hook を持たない）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { SheetView, sheetClass } from '../../ui/src/components/Sheet';

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
const text = (n: Node | Node[]): string =>
  Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : text(n.children);
const hasClass = (c: string) => (e: El) =>
  String(e.props.class ?? '')
    .split(' ')
    .includes(c);

describe('SheetView', () => {
  const tree = (over: Record<string, unknown> = {}) =>
    expand(
      <SheetView id="s1" title="LC を動かしたか" onClose={() => {}} {...over}>
        <p>本文</p>
      </SheetView>,
    );

  it('AC-1: dialog（id）で、名前は見出し（aria-labelledby）。見出しは h2・tabindex=-1（開いたらフォーカスを移す先）', () => {
    const t = tree();
    const d = t[0] as El;
    expect(d.type).toBe('dialog');
    expect(d.props.id).toBe('s1');
    const h = all(t, (e) => e.type === 'h2')[0] as El;
    expect(d.props['aria-labelledby']).toBe(h.props.id);
    expect(h.props.tabIndex).toBe(-1);
    expect(text(h)).toBe('LC を動かしたか');
  });

  it('右上の ✕ はアイコンのボタン（読み上げ「閉じる」。9.3）で、押すと onClose。名前は変えられる', () => {
    let n = 0;
    const t = tree({ onClose: () => n++ });
    const close = all(t, hasClass('sheet__close'))[0] as El;
    expect(close.type).toBe('button');
    expect(close.props['aria-label']).toBe('閉じる');
    expect(all([close], (e) => e.type === 'svg')).toHaveLength(1);
    (close.props.onClick as () => void)();
    expect(n).toBe(1);
    const named = all(tree({ closeLabel: '説明を閉じる' }), hasClass('sheet__close'))[0] as El;
    expect(named.props['aria-label']).toBe('説明を閉じる');
  });

  it('つまみは見た目だけ（読み上げから外す）。中身はスクロールの段に入る。前に置くものは見出しの前', () => {
    const t = tree({ lead: <button type="button">戻る</button> });
    expect((all(t, hasClass('sheet__grip'))[0] as El).props['aria-hidden']).toBe('true');
    expect(text(all(t, hasClass('sheet__body')))).toBe('本文');
    const head = all(t, hasClass('sheet__head'))[0] as El;
    expect((head.children[0] as El).props.class).toBe('sheet__lead');
    expect((head.children[1] as El).type).toBe('h2');
    expect(all(tree(), hasClass('sheet__lead'))).toEqual([]);
  });

  it('見せ方のクラス（info = 説明と小さな操作 / form = 入力。広い形で吹き出しか中央か）・上を先に試す吹き出し。style を持たない（CSP）', () => {
    expect(sheetClass('info', undefined)).toBe('sheet sheet--info');
    expect(sheetClass('form', 'above')).toBe('sheet sheet--form sheet--above');
    expect((tree()[0] as El).props.class).toBe('sheet sheet--info');
    expect((tree({ kind: 'form' })[0] as El).props.class).toBe('sheet sheet--form');
    expect(all(tree(), (e) => 'style' in e.props || 'dangerouslySetInnerHTML' in e.props)).toEqual(
      [],
    );
  });
});
