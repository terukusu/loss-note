// 「i」の説明（Issue #57 契約 UI-57・AC-3・AC-4・AC-9。#129 で吹き出しから説明のシートへ）の純関数と描く中身
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { InfoSheetBody, InfoUp } from '../../ui/src/components/InfoSheet';
import { InfoTipView } from '../../ui/src/components/InfoTip';
import { glossaryTerm } from '../../ui/src/lib/glossary';
import { plainText } from '../../ui/src/lib/glossary-text';
import { infoContent, infoName, infoTrail } from '../../ui/src/lib/info-tip';
import { Link } from '../../ui/src/lib/router';
import { STATEMENT_NOTICE_MORE } from '../../ui/src/pages/Record';

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
  // Link は context（hook）を読むので a に置き換える
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
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
const noop = () => {};

describe('infoTrail（たどった言葉）', () => {
  it('リンクで 1 つずつ積み、同じ言葉は重ねない', () => {
    let t = infoTrail([], { type: 'link', id: 'lc' });
    t = infoTrail(t, { type: 'link', id: 'oneR' });
    t = infoTrail(t, { type: 'link', id: 'oneR' });
    expect(t).toEqual(['lc', 'oneR']);
    // 前に見た言葉へもう一度たどるのは積む（戻るで同じ順に戻れる）
    expect(infoTrail(t, { type: 'link', id: 'lc' })).toEqual(['lc', 'oneR', 'lc']);
  });

  it('up は depth 段目まで戻す（範囲の外は丸める）・clear は空', () => {
    const t = ['lc', 'oneR', 'r'] as const;
    expect(infoTrail(t, { type: 'up', depth: 2 })).toEqual(['lc', 'oneR']);
    expect(infoTrail(t, { type: 'up', depth: 0 })).toEqual([]);
    expect(infoTrail(t, { type: 'up', depth: -1 })).toEqual([]);
    expect(infoTrail(t, { type: 'up', depth: 9 })).toEqual(['lc', 'oneR', 'r']);
    expect(infoTrail(t, { type: 'clear' })).toEqual([]);
  });

  it('性質: 何回たどっても、1 つずつ戻すと同じ並びを逆にたどり、最後は空', () => {
    let seed = 76;
    const ids = ['lc', 'oneR', 'r', 'tp', 'risk', 'judgment'] as const;
    for (let k = 0; k < 50; k++) {
      let t: readonly (typeof ids)[number][] = [];
      const seen: (readonly string[])[] = [t];
      const n = 1 + (k % 7);
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const next = infoTrail(t, { type: 'link', id: ids[seed % ids.length] ?? 'lc' });
        if (next !== t) seen.push(next);
        t = next as typeof t;
      }
      for (let i = seen.length - 1; i > 0; i--) {
        expect(t).toEqual(seen[i]);
        t = infoTrail(t, { type: 'up', depth: t.length - 1 }) as typeof t;
      }
      expect(t).toEqual([]);
    }
  });
});

describe('infoContent（中身）', () => {
  it('用語のデータから: 名前「「〈言葉〉」の説明」・箱の ID・先頭の短い説明・用語集の項目', () => {
    const c = infoContent({ term: 'timeframeChange' });
    expect(c.name).toBe('「時間足を変えたか」の説明');
    expect(c.panelId).toBe('info-timeframeChange');
    expect(c.lead).toBe(glossaryTerm('timeframeChange').summary);
    // シートの見出しは今見ている言葉（「i」の言葉そのもの）
    expect(c.title).toBe('時間足を変えたか');
    expect(c.back).toBeNull();
    expect(c.glossary).toBe('timeframeChange');
    expect(c.depth).toBe(0);
    expect(infoContent({ term: 'r', id: 'x-r' }).panelId).toBe('x-r');
  });

  it('たどった先: 名前と箱の ID は「i」のまま、中身と見出しは末尾の言葉', () => {
    const c = infoContent({ term: 'judgment' }, ['lc', 'oneR']);
    expect(c.name).toBe('「判定」の説明');
    expect(c.panelId).toBe('info-judgment');
    expect(c.title).toBe('1R');
    expect(c.back).toBe('LC');
    expect(c.lead).toBe(glossaryTerm('oneR').summary);
    expect(c.glossary).toBe('oneR');
    expect(c.depth).toBe(2);
  });

  it('言葉と文から（明細の補足）: 用語集の項目は無い。たどった先は用語のデータ', () => {
    const c = infoContent({ label: '明細の送り方', body: STATEMENT_NOTICE_MORE, id: 'p' });
    expect(c.name).toBe(infoName('明細の送り方'));
    expect(c.body).toEqual([STATEMENT_NOTICE_MORE]);
    expect(c.lead).toBeNull();
    expect(c.glossary).toBeNull();
    expect(c.title).toBe('明細の送り方');
    expect(
      infoContent({ label: '明細の送り方', body: STATEMENT_NOTICE_MORE, id: 'p' }, ['lc']).title,
    ).toBe('LC');
  });
});

describe('InfoTipView（「i」のボタン。#129）', () => {
  const tree = (open: boolean, over: Record<string, unknown> = {}) =>
    expand(
      <InfoTipView
        source={{ term: 'judgment' }}
        open={open}
        onPress={noop}
        buttonRef={null}
        {...over}
      />,
    );

  it('AC-3・#129 AC-9: type="button"・名前「「判定」の説明」・aria-haspopup="dialog"。閉じている = aria-expanded="false"・aria-controls なし、開いている = "true"・シートの ID', () => {
    const closed = tree(false);
    const b = all(closed, (e) => e.type === 'button')[0] as El;
    expect(b.props.type).toBe('button');
    expect(b.props['aria-label']).toBe('「判定」の説明');
    expect(b.props['aria-haspopup']).toBe('dialog');
    expect(b.props['aria-expanded']).toBe('false');
    expect(b.props['aria-controls']).toBeUndefined();
    const ob = all(tree(true), (e) => e.type === 'button')[0] as El;
    expect(ob.props['aria-expanded']).toBe('true');
    expect(ob.props['aria-controls']).toBe('info-judgment');
  });

  it('#129: ボタンの木にシート（dialog）・説明の文を持たない（欄の見出し・押せるカードの中に dialog を置かない）。style を持たない', () => {
    const t = tree(true);
    expect(all(t, (e) => e.type === 'dialog' || 'style' in e.props)).toEqual([]);
    expect(text(t)).toBe('');
    expect(all(t, (e) => e.type === 'button')).toHaveLength(1);
  });

  it('押すと onPress。小さい「i」のクラス', () => {
    let n = 0;
    const b = all(tree(false, { onPress: () => n++ }), (e) => e.type === 'button')[0] as El;
    (b.props.onClick as () => void)();
    expect(n).toBe(1);
    expect(String((tree(false)[0] as El).props.class)).toBe('info-wrap');
    expect(String((tree(false, { size: 'sm' })[0] as El).props.class)).toBe(
      'info-wrap info-wrap--sm',
    );
  });
});

describe('InfoSheetBody（説明のシートの中身。#129）', () => {
  const body = (trail: readonly string[] = [], over: Record<string, unknown> = {}) =>
    expand(
      <InfoSheetBody
        content={infoContent({ term: 'judgment' }, trail as never)}
        onLink={noop}
        {...over}
      />,
    );

  it('短い説明（リンクの印は見せない）・5 つの判定の一覧・末尾に ［用語集で見る］。HTML の文字列・style を持たない', () => {
    const t = body();
    expect(text(t)).toContain(plainText(glossaryTerm('judgment').summary));
    expect(text(t)).not.toContain('[[');
    expect(all(t, (e) => e.type === 'li')).toHaveLength(5);
    const root = t[0] as El;
    expect(text(root.children.at(-1) as El)).toBe('用語集で見る');
    expect(all(t, (e) => 'dangerouslySetInnerHTML' in e.props || 'style' in e.props)).toEqual([]);
  });

  it('#129 AC-11: ［用語集で見る］ は 2 番目の重さのボタン（btn--secondary・全幅。文字だけのリンクの見た目にしない）', () => {
    const a = all(body([], { from: '/record' }), hasClass('info__glossary'))[0] as El;
    expect(a.type).toBe('a');
    const cls = String(a.props.class).split(' ');
    expect(cls).toEqual(expect.arrayContaining(['btn', 'btn--secondary', 'btn--block']));
    expect(a.props.href).toBe('/glossary?from=%2Frecord#glossary-judgment');
  });

  it('入力のある画面（記録する・編集）でも ［用語集で見る］ を出し、来た画面のパスを ?from= に持つ（#75 AC-8）', () => {
    for (const from of ['/record', '/trades/t1/edit', '/trades/t1']) {
      const links = all(body([], { from }), hasClass('info__glossary'));
      expect(links).toHaveLength(1);
      expect((links[0] as El).props.href).toBe(
        `/glossary?from=${encodeURIComponent(from)}#glossary-judgment`,
      );
    }
  });

  it('文の中の用語集の言葉はボタン（type="button"・見える文字が名前）。押すと onLink にその ID', () => {
    const got: string[] = [];
    const t = body([], { onLink: (id: string) => got.push(id) });
    const links = all(t, (e) => e.type === 'button' && hasClass('glink')(e));
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const l of links) {
      expect(l.props.type).toBe('button');
      expect(text(l).length).toBeGreaterThan(0);
      (l.props.onClick as () => void)();
    }
    expect(got).toContain('lc');
    expect(got).toContain('lcMove');
  });

  it('たどった先は末尾の言葉の中身。［‹ 〈1 つ前の言葉〉］ は読み上げ「〈言葉〉の説明へ戻る」で、押すと onUp', () => {
    const t = body(['lc', 'oneR']);
    expect(text(t)).toContain(plainText(glossaryTerm('oneR').summary));
    let up = 0;
    const b = expand(<InfoUp back="LC" onUp={() => up++} />)[0] as El;
    expect(b.type).toBe('button');
    expect(b.props.type).toBe('button');
    expect(b.props['aria-label']).toBe('LCの説明へ戻る');
    expect(text(b)).toBe('LC');
    (b.props.onClick as () => void)();
    expect(up).toBe(1);
  });

  it('判定の名前の前にバッジと同じ形の記号（読み上げから外す）', () => {
    const names = all(body(), hasClass('info__name'));
    expect(names.map((n) => all([n], hasClass('info__grade')).length)).toEqual([1, 1, 1, 1, 1]);
    for (const n of names) {
      expect((all([n], (e) => e.type === 'svg')[0] as El).props['aria-hidden']).toBe('true');
    }
  });

  it('AC-9: 明細の補足は文だけ（用語集の項目へのつなぎは無い）', () => {
    const src = { label: '明細の送り方', body: STATEMENT_NOTICE_MORE, id: 'statement-info' };
    const t = expand(<InfoSheetBody content={infoContent(src)} />);
    expect(text(t)).toContain(STATEMENT_NOTICE_MORE);
    expect(text(t)).not.toContain('用語集で見る');
    const closed = expand(
      <InfoTipView source={src} open={false} onPress={noop} buttonRef={null} />,
    );
    expect(text(closed)).not.toContain(STATEMENT_NOTICE_MORE);
  });
});
