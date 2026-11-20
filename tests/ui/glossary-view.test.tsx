// 用語集の画面（Issue #76。#57 の PR で作る）。部品の関数を呼んで要素の木にする（GlossaryView は hook を持たない）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_GROUPS } from '../../ui/src/lib/glossary';
import { glossaryAnchor, plainText, relatedIds } from '../../ui/src/lib/glossary-text';
import { Link } from '../../ui/src/lib/router';
import { glossaryBack, hrefOf, parseRoute, tabOfRoute, titleOf } from '../../ui/src/lib/routes';
import { GlossaryView } from '../../ui/src/pages/Glossary';

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

const tree = expand(<GlossaryView />);
const sections = all(tree, hasClass('glossary__item'));

describe('用語集の画面', () => {
  it('見出しは「用語集」、項目は用語集のデータの順に 15、各項目の ID は #glossary-〈id〉', () => {
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('用語集');
    expect(sections.map((s) => s.props.id)).toEqual(GLOSSARY.map((g) => glossaryAnchor(g.id)));
    for (const [i, g] of GLOSSARY.entries()) {
      const s = sections[i] as El;
      expect(text(all([s], (e) => e.type === 'h3'))).toBe(g.term);
      expect(text(s)).toContain(plainText(g.summary));
    }
  });

  it('ページの中のリンクはすべて、この画面にある項目を指す（行き先の無いリンク 0 件）。リンクの印は見せない', () => {
    const ids = new Set(sections.map((s) => String(s.props.id)));
    const links = all(tree, (e) => e.type === 'a' && hasClass('glink')(e));
    expect(links.length).toBeGreaterThan(30);
    for (const a of links) {
      const href = String(a.props.href);
      expect(href.startsWith('#')).toBe(true);
      expect(ids.has(href.slice(1))).toBe(true);
    }
    expect(text(tree)).not.toMatch(/\[\[|\]\]/);
  });

  it('各項目の「関係する言葉」は文の中のリンク先（自分を除く）', () => {
    for (const [i, g] of GLOSSARY.entries()) {
      const rel = all([sections[i] as El], hasClass('glossary__related'));
      const want = relatedIds(g);
      if (want.length === 0) {
        expect(rel).toEqual([]);
        continue;
      }
      const hrefs = all(rel, (e) => e.type === 'a').map((a) => String(a.props.href));
      expect(hrefs).toEqual(want.map((id) => `#${glossaryAnchor(id)}`));
    }
  });

  it('言葉の一覧（nav）は 3 つの区切りに分かれ、すべての項目へ。本文も同じ区切りの見出し（h2）の下に項目（h3）', () => {
    const nav = all(tree, (e) => e.type === 'nav')[0] as El;
    expect(nav.props['aria-label']).toBe('言葉の一覧');
    expect(all([nav], (e) => e.type === 'a')).toHaveLength(GLOSSARY.length);
    expect(all([nav], hasClass('glossary__group-name')).map(text)).toEqual(
      GLOSSARY_GROUPS.map((g) => g.name),
    );
    expect(all(tree, (e) => e.type === 'h2').map(text)).toEqual(GLOSSARY_GROUPS.map((g) => g.name));
  });

  it('上の帯の戻るのボタン（‹ のアイコンと名前。#127）: 来た画面が無ければ「設定」（/settings）、来た画面があればその名前のボタン', () => {
    const toSettings = all(tree, hasClass('appbar__back'))[0] as El;
    expect(toSettings.type).toBe('a');
    expect(toSettings.props.href).toBe('/settings');
    expect(text(toSettings)).toBe('設定');
    expect(toSettings.props['aria-label']).toBe('設定へ戻る');
    // 題は上の帯の h1
    expect(all(tree, (e) => e.type === 'h1').map(text)).toEqual(['用語集']);
    let back = 0;
    const t2 = expand(<GlossaryView backLabel="記録する" onBack={() => back++} />);
    const b = all(t2, hasClass('appbar__back'))[0] as El;
    expect(b.type).toBe('button');
    expect(text(b)).toBe('記録する');
    expect(b.props['aria-label']).toBe('記録するへ戻る');
    (b.props.onClick as () => void)();
    expect(back).toBe(1);
  });

  it('今見ている項目に印（aria-current）', () => {
    const t3 = expand(<GlossaryView current="oneR" />);
    const cur = all(t3, (e) => e.props['aria-current'] === 'location');
    expect(cur.map((e) => e.props.id)).toEqual(['glossary-oneR']);
    expect(hasClass('glossary__item--current')(cur[0] as El)).toBe(true);
  });

  it('HTML の文字列・style・ダイアログを持たない（CSP）', () => {
    expect(
      all(
        tree,
        (e) => e.type === 'dialog' || 'dangerouslySetInnerHTML' in e.props || 'style' in e.props,
      ),
    ).toEqual([]);
  });
});

describe('用語集の経路', () => {
  it('/glossary は用語集の画面。題は「用語集 — 損失ノート」、行き先は設定の印', () => {
    expect(parseRoute('/glossary', { dev: false })).toEqual({ name: 'glossary' });
    expect(parseRoute('/glossary/', { dev: false })).toEqual({ name: 'glossary' });
    expect(hrefOf({ name: 'glossary' })).toBe('/glossary');
    expect(titleOf({ name: 'glossary' })).toBe('用語集 — 損失ノート');
    // 用語集は設定のタブ（直接開いたときの組み直しの先。#127）
    expect(tabOfRoute({ name: 'glossary' })).toBe('settings');
  });

  it('glossaryBack: ?from= が自分の画面ならその名前、外の URL・知らない画面・用語集・ログインは null', () => {
    const o = { dev: false };
    expect(glossaryBack('?from=%2Frecord', o)?.label).toBe('記録する');
    expect(glossaryBack('?from=%2Ftrades%2Ft1', o)?.label).toBe('取引の詳細');
    expect(glossaryBack('?from=%2Ftrades%2Ft1%2Fedit', o)?.label).toBe('取引を編集');
    for (const bad of [
      '',
      '?from=',
      '?from=https%3A%2F%2Fexample.com',
      '?from=%2F%2Fevil',
      '?from=%2Fnope',
      '?from=%2Fglossary',
      '?from=%2Flogin',
      '?from=%5Cx',
    ]) {
      expect(glossaryBack(bad, o)).toBeNull();
    }
  });
});
