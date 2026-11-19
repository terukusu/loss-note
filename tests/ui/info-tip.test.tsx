// 「i」の説明の吹き出し（Issue #57 契約 UI-57・AC-3・AC-4・AC-9 の純関数と描く中身）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { InfoTipView } from '../../ui/src/components/InfoTip';
import { glossaryTerm } from '../../ui/src/lib/glossary';
import { plainText } from '../../ui/src/lib/glossary-text';
import {
  type Box,
  type InfoEvent,
  type InfoPlaceInput,
  infoContent,
  infoFocusCloses,
  infoName,
  infoNext,
  infoPlace,
  infoRefocus,
  infoReveal,
  infoTrail,
} from '../../ui/src/lib/info-tip';
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

describe('infoNext（開閉）', () => {
  it('AC-3: 押すと開き、もう一度押すと閉じる', () => {
    expect(infoNext(false, 'press')).toBe(true);
    expect(infoNext(true, 'press')).toBe(false);
  });

  it.each(['escape', 'back', 'outside', 'other'] as const)(
    'AC-4 ほか: %s はどちらからでも閉じる',
    (ev) => {
      expect(infoNext(true, ev)).toBe(false);
      expect(infoNext(false, ev)).toBe(false);
    },
  );

  it('フォーカスを戻すのは Esc・戻るで、フォーカスが吹き出しかボタンにあったときだけ', () => {
    const evs: InfoEvent[] = ['press', 'escape', 'back', 'outside', 'other'];
    expect(evs.filter((e) => infoRefocus(e, true))).toEqual(['escape', 'back']);
    expect(evs.filter((e) => infoRefocus(e, false))).toEqual([]);
  });
});

describe('infoFocusCloses（フォーカスが移った先で閉じるか。N15）', () => {
  // 包む要素（.info-wrap）の中身を ID の集合でまねる: 「i」のボタン・吹き出し・その中のリンクと戻るのボタン
  const inside = new Set(['info-button', 'info-pop', 'glink-lc', 'info-up', 'info-glossary']);
  const scope = { contains: (id: string) => inside.has(id) };

  it('「i」と吹き出しの外（[消す]・[保存]・ほかの欄）へのフォーカスで閉じる', () => {
    for (const id of ['delete-button', 'edit-submit', 'record-lc', 'appnav-trades']) {
      expect(infoFocusCloses(scope, id)).toBe(true);
    }
  });

  it('吹き出しの中（吹き出しそのもの・文の中のリンク・[‹ 前の説明]・「用語集で見る」）と「i」へのフォーカスでは閉じない', () => {
    for (const id of inside) expect(infoFocusCloses(scope, id)).toBe(false);
    // 包む要素が無い（外れた後）・移った先が無いときも閉じない
    expect(infoFocusCloses(null, 'delete-button')).toBe(false);
    expect(infoFocusCloses(scope, null)).toBe(false);
  });
});

describe('infoPlace（位置。窓の端で切れない・下に入らなければ上）', () => {
  const VIEW: Box = { left: 0, right: 360, top: 56, bottom: 700 };
  const btn = (left: number, top: number): Box => ({
    left,
    right: left + 44,
    top,
    bottom: top + 44,
  });
  const base = (over: Partial<InfoPlaceInput>): InfoPlaceInput => ({
    button: btn(16, 200),
    width: 200,
    height: 120,
    clip: null,
    view: VIEW,
    gap: 4,
    ...over,
  });

  it('左寄りのボタン・右に入る → start・下', () => {
    expect(infoPlace(base({}))).toEqual({ align: 'start', above: false });
  });

  it('右寄りのボタン → end（右端をボタンに）', () => {
    expect(infoPlace(base({ button: btn(300, 200) }))).toEqual({ align: 'end', above: false });
  });

  it('左右どちらに揃えても窓に入らない（幅 360 で 320 の吹き出し・中ほどのボタン）→ fit', () => {
    expect(infoPlace(base({ button: btn(120, 200), width: 320 }))).toEqual({
      align: 'fit',
      above: false,
    });
  });

  it('下に入らず上に入る → 上に開く', () => {
    expect(infoPlace(base({ button: btn(16, 600) }))).toEqual({ align: 'start', above: true });
  });

  it('下にも上にも入らない → 下のまま', () => {
    expect(infoPlace(base({ button: btn(16, 300), height: 600 })).above).toBe(false);
  });

  it('下の境目はちょうどなら入る（0.5px まで許す）', () => {
    // 444 + 4 + 252 = 700
    expect(infoPlace(base({ button: btn(16, 400), height: 252 })).above).toBe(false);
    expect(infoPlace(base({ button: btn(16, 400), height: 253 })).above).toBe(true);
  });

  it('切る祖先（判定の枠）の中では、その枠の上下で判定する（下に入らず上に入れば上・どちらにも入らなければ下）', () => {
    const clip: Box = { left: 16, right: 344, top: 100, bottom: 300 };
    expect(infoPlace(base({ clip, height: 80 }))).toEqual({ align: 'start', above: true });
    expect(infoPlace(base({ clip, height: 200 }))).toEqual({ align: 'start', above: false });
  });

  it('左右だけを切る祖先（判定の枠の overflow-x: clip）: 上下は窓で判定する', () => {
    const clip: Box = {
      left: 16,
      right: 344,
      top: Number.NEGATIVE_INFINITY,
      bottom: Number.POSITIVE_INFINITY,
    };
    expect(infoPlace(base({ clip, height: 400 }))).toEqual({ align: 'start', above: false });
    expect(infoPlace(base({ clip: { ...clip, left: Number.NaN } }))).toEqual({
      align: 'start',
      above: false,
    });
  });

  it('切る祖先の左右に入らない → fit', () => {
    const clip: Box = { left: 16, right: 200, top: 0, bottom: 1000 };
    expect(infoPlace(base({ clip, width: 250 })).align).toBe('fit');
  });

  it('測れない値は start・下（例外にしない）', () => {
    expect(infoPlace(base({ width: 0 }))).toEqual({ align: 'start', above: false });
    expect(infoPlace(base({ height: Number.NaN }))).toEqual({ align: 'start', above: false });
    expect(
      infoPlace(base({ button: { left: Number.POSITIVE_INFINITY, right: 1, top: 1, bottom: 1 } })),
    ).toEqual({ align: 'start', above: false });
  });

  it('性質: fit でない答えは、範囲（窓と切る祖先の重なり）の左右に収まる', () => {
    let seed = 57;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 500; k++) {
      const width = 40 + rnd() * 340;
      const b = btn(rnd() * 316, 60 + rnd() * 600);
      const r = infoPlace(base({ button: b, width, height: 20 + rnd() * 300 }));
      if (r.align === 'start') expect(b.left + width).toBeLessThanOrEqual(VIEW.right + 0.5);
      if (r.align === 'end') expect(b.right - width).toBeGreaterThanOrEqual(VIEW.left - 0.5);
    }
  });
});

describe('infoReveal（見える範囲へのスクロール）', () => {
  const V: Box = { left: 0, right: 360, top: 56, bottom: 700 };
  const pop = (top: number, bottom: number): Box => ({ left: 8, right: 352, top, bottom });
  it('下端がはみ出す分だけ下へ。上端を越えない。収まっていれば 0', () => {
    expect(infoReveal(pop(500, 800), V)).toBe(100);
    expect(infoReveal(pop(100, 900), V)).toBe(44);
    expect(infoReveal(pop(100, 600), V)).toBe(0);
    expect(infoReveal(pop(40, 900), V)).toBe(0);
    expect(infoReveal(pop(Number.NaN, 900), V)).toBe(0);
    // 上に開いた吹き出し（「i」が下）: 上端は吹き出し。下に開いた吹き出し（「i」が上）: 「i」を隠さない
    expect(infoReveal(pop(100, 900), V, 300)).toBe(44);
    expect(infoReveal(pop(100, 900), V, 80)).toBe(24);
  });
});

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

describe('infoPlace の優先の向き（3 つの質問は上を先に。デザインレビュー 1）', () => {
  const V: Box = { left: 0, right: 360, top: 56, bottom: 700 };
  const b: Box = { left: 16, right: 60, top: 400, bottom: 444 };
  const base = { button: b, width: 200, height: 120, clip: null, view: V, gap: 8 } as const;
  it('上に入れば上・入らなければ下・どちらにも入らなければ下', () => {
    expect(infoPlace({ ...base, prefer: 'above' }).above).toBe(true);
    expect(infoPlace({ ...base }).above).toBe(false);
    expect(
      infoPlace({ ...base, prefer: 'above', button: { ...b, top: 100, bottom: 144 } }).above,
    ).toBe(false);
    expect(infoPlace({ ...base, prefer: 'above', height: 900 }).above).toBe(false);
  });
});

describe('infoContent（中身）', () => {
  it('用語のデータから: 名前「「〈言葉〉」の説明」・箱の ID・先頭の短い説明・用語集の項目', () => {
    const c = infoContent({ term: 'timeframeChange' });
    expect(c.name).toBe('「時間足を変えたか」の説明');
    expect(c.panelId).toBe('info-timeframeChange');
    expect(c.lead).toBe(glossaryTerm('timeframeChange').summary);
    expect(c.title).toBeNull();
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
    expect(
      infoContent({ label: '明細の送り方', body: STATEMENT_NOTICE_MORE, id: 'p' }, ['lc']).title,
    ).toBe('LC');
  });
});

describe('InfoTipView（描く中身）', () => {
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

  it('AC-3: 閉じている = aria-expanded="false"・箱なし・aria-controls なし、開いている = "true"・箱あり（aria-controls の ID）', () => {
    const closed = tree(false);
    const b = all(closed, (e) => e.type === 'button')[0] as El;
    expect(b.props.type).toBe('button');
    expect(b.props['aria-expanded']).toBe('false');
    expect(b.props['aria-controls']).toBeUndefined();
    expect(b.props['aria-label']).toBe('「判定」の説明');
    expect(all(closed, hasClass('info__pop'))).toEqual([]);
    const opened = tree(true);
    const ob = all(opened, (e) => e.type === 'button')[0] as El;
    expect(ob.props['aria-expanded']).toBe('true');
    const pop = all(opened, hasClass('info__pop'));
    expect(pop).toHaveLength(1);
    expect(pop[0]?.props.id).toBe(ob.props['aria-controls']);
  });

  it('開いた中身: 短い説明（リンクの印は見せない）・5 つの判定の一覧・末尾に「用語集で見る」（/glossary#glossary-judgment）。ダイアログ・HTML の文字列・style を持たない', () => {
    const t = tree(true);
    const pop = all(t, hasClass('info__pop'))[0] as El;
    expect(text(pop)).toContain(plainText(glossaryTerm('judgment').summary));
    expect(text(pop)).not.toContain('[[');
    expect(all([pop], (e) => e.type === 'li')).toHaveLength(5);
    const last = pop.children.at(-1) as El;
    expect(text(last)).toBe('用語集で見る');
    expect(all([last], (e) => e.type === 'a')[0]?.props.href).toBe('/glossary#glossary-judgment');
    expect(
      all(
        t,
        (e) => e.type === 'dialog' || 'dangerouslySetInnerHTML' in e.props || 'style' in e.props,
      ),
    ).toEqual([]);
  });

  it('文の中の用語集の言葉はボタン（type="button"・見える文字が名前）。押すと onLink にその ID', () => {
    const got: string[] = [];
    const t = tree(true, { onLink: (id: string) => got.push(id) });
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

  it('たどった先では「‹ 〈1 つ前の言葉〉」と、別の行の見出し。押すと onUp（デザインの再レビュー 5）', () => {
    let up = 0;
    const t = tree(true, { trail: ['lc'], onUp: () => up++ });
    const pop = all(t, hasClass('info__pop'))[0] as El;
    expect(text(all([pop], hasClass('info__title')))).toBe('LC');
    const back = all([pop], hasClass('info__up'))[0] as El;
    expect(text(back)).toBe('判定');
    expect(back.props['aria-label']).toBe('判定の説明へ戻る');
    (back.props.onClick as () => void)();
    expect(up).toBe(1);
    const t2 = tree(true, { trail: ['lc', 'oneR'] });
    expect(text(all(t2, hasClass('info__up')))).toBe('LC');
    expect(text(all(t2, hasClass('info__title')))).toBe('1R');
    expect(all(tree(true), hasClass('info__up'))).toEqual([]);
  });

  it('判定の名前の前にバッジと同じ形の記号（読み上げから外す）', () => {
    const pop = all(tree(true), hasClass('info__pop'))[0] as El;
    const names = all([pop], hasClass('info__name'));
    expect(names.map((n) => all([n], hasClass('info__grade')).length)).toEqual([1, 1, 1, 1, 1]);
    for (const n of names) {
      expect((all([n], (e) => e.type === 'svg')[0] as El).props['aria-hidden']).toBe('true');
    }
  });

  it('入力のある画面（記録する・編集）でも「用語集で見る」を出す（書きかけは画面を移っても残る。#75 AC-8）', () => {
    for (const from of ['/record', '/trades/t1/edit', '/trades/t1']) {
      const links = all(tree(true, { from }), hasClass('info__glossary'));
      expect(links).toHaveLength(1);
      expect((links[0] as El).props.href).toBe(
        `/glossary?from=${encodeURIComponent(from)}#glossary-judgment`,
      );
    }
  });

  it('「用語集で見る」は来た画面のパスを ?from= に持つ', () => {
    const t = tree(true, { from: '/record' });
    const a = all(t, (e) => e.type === 'a')[0] as El;
    expect(a.props.href).toBe('/glossary?from=%2Frecord#glossary-judgment');
  });

  it('位置のクラス: end・fit・above、小さい「i」', () => {
    const cls = (over: Record<string, unknown>) =>
      String((all(tree(true, over), hasClass('info__pop'))[0] as El).props.class);
    expect(cls({})).toBe('info__pop');
    expect(cls({ align: 'end' })).toBe('info__pop info__pop--end');
    expect(cls({ align: 'fit', above: true })).toBe('info__pop info__pop--fit info__pop--above');
    const wrap = (over: Record<string, unknown>) =>
      String((tree(false, over)[0] as El).props.class);
    expect(wrap({})).toBe('info-wrap');
    expect(wrap({ size: 'sm' })).toBe('info-wrap info-wrap--sm');
  });

  it('AC-9: 明細の補足は開いたときだけ文が出る（用語集の項目へのつなぎは無い）', () => {
    const src = { label: '明細の送り方', body: STATEMENT_NOTICE_MORE, id: 'record-statement-info' };
    const closed = expand(
      <InfoTipView source={src} open={false} onPress={noop} buttonRef={null} />,
    );
    expect(text(closed)).not.toContain(STATEMENT_NOTICE_MORE);
    const opened = expand(<InfoTipView source={src} open onPress={noop} buttonRef={null} />);
    expect(text(opened)).toContain(STATEMENT_NOTICE_MORE);
    expect(text(opened)).not.toContain('用語集で見る');
  });
});
