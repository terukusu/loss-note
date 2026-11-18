import { describe, expect, it } from 'vitest';
import { GOOGLE_G_COLORS, GoogleLogo } from '../../ui/src/components/GoogleLogo';
import {
  GOOGLE_SIGN_IN_BUSY,
  GOOGLE_SIGN_IN_LABEL,
  GoogleSignInButton,
} from '../../ui/src/components/GoogleSignInButton';
import { Shell } from '../../ui/src/layout/Shell';
import { Link } from '../../ui/src/lib/router';
import { Login } from '../../ui/src/pages/Login';

/**
 * Google でログインするボタン（Sign in with Google のブランドガイドライン。Issue #52 AC-1・AC-4・AC-6）。
 * 配色・寸法の CSS は tests/ui/cssTokens.test.ts、実際の画面の当たり・幅は scripts/ui-check.mjs が見る
 */

interface VNode {
  type: unknown;
  props: { children?: unknown; [k: string]: unknown };
}

/** vnode を展開する（関数の部品は呼んで中身にする。DOM のライブラリを使わない。Link は hook を使うので a として描く） */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object' || !('type' in node)) return node;
  const v = node as VNode;
  if (v.type === Link)
    return { type: 'a', props: { ...v.props, children: expand(v.props.children) } };
  if (typeof v.type === 'function') return expand((v.type as (p: unknown) => unknown)(v.props));
  return { type: v.type, props: { ...v.props, children: expand(v.props.children) } };
}

function findAll(node: unknown, pred: (v: VNode) => boolean, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, pred, out);
  } else if (node && typeof node === 'object' && 'type' in node) {
    const v = node as VNode;
    if (pred(v)) out.push(v);
    findAll(v.props.children, pred, out);
  }
  return out;
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as VNode).props.children);
  }
  return '';
}

describe('GoogleLogo（G のロゴ）', () => {
  const tree = expand(GoogleLogo());
  const svg = findAll(tree, (v) => v.type === 'svg');
  const paths = findAll(tree, (v) => v.type === 'path');

  it('AC-1: 公式の 4 色を fill 属性で持ち、ほかの色は無い', () => {
    expect(paths.map((p) => p.props.fill).sort()).toEqual([...GOOGLE_G_COLORS].sort());
    expect(GOOGLE_G_COLORS).toEqual(['#4285F4', '#EA4335', '#FBBC05', '#34A853']);
  });

  it('AC-1: 外のもの（href・src）と style 属性を使わず、20px 四方で読み上げから隠す', () => {
    const all = findAll(tree, () => true);
    for (const v of all) {
      expect(Object.keys(v.props)).not.toContain('href');
      expect(Object.keys(v.props)).not.toContain('src');
      expect(Object.keys(v.props)).not.toContain('style');
    }
    expect(svg).toHaveLength(1);
    expect(svg[0]?.props['aria-hidden']).toBe('true');
    expect(svg[0]?.props.focusable).toBe('false');
    expect([svg[0]?.props.width, svg[0]?.props.height]).toEqual(['20', '20']);
    expect(svg[0]?.props.viewBox).toBe('0 0 48 48');
  });
});

describe('GoogleSignInButton', () => {
  it('AC-4: 文言は「Google でログイン」、押せる。ロゴ → 文字の順', () => {
    const tree = expand(GoogleSignInButton({ busy: false, onClick: () => {} }));
    const [btn] = findAll(tree, (v) => v.type === 'button');
    expect(GOOGLE_SIGN_IN_LABEL).toBe('Google でログイン');
    expect(textOf(btn)).toBe(GOOGLE_SIGN_IN_LABEL);
    expect(btn?.props.disabled).toBe(false);
    expect(btn?.props.type).toBe('button');
    expect(btn?.props.class).toBe('gsi');
    // 読み上げの名前は見えている文字（aria-label で上書きしない）
    expect(btn?.props['aria-label']).toBeUndefined();
    const kinds = findAll(btn, (v) => v.type === 'svg' || v.props.class === 'gsi__text').map(
      (v) => v.type,
    );
    expect(kinds).toEqual(['svg', 'span']);
  });

  it('AC-4: 押している間は「ログインしています…」で押せない。ロゴはそのまま', () => {
    const tree = expand(GoogleSignInButton({ busy: true, onClick: () => {} }));
    const [btn] = findAll(tree, (v) => v.type === 'button');
    expect(textOf(btn)).toBe(GOOGLE_SIGN_IN_BUSY);
    expect(GOOGLE_SIGN_IN_BUSY).toBe('ログインしています…');
    expect(btn?.props.disabled).toBe(true);
    expect(btn?.props['aria-busy']).toBe(true);
    const fills = findAll(btn, (v) => v.type === 'path').map((p) => p.props.fill);
    expect(fills.sort()).toEqual([...GOOGLE_G_COLORS].sort());
  });

  it('押すと onClick を呼ぶ', () => {
    let n = 0;
    const tree = expand(GoogleSignInButton({ busy: false, onClick: () => n++ }));
    const [btn] = findAll(tree, (v) => v.type === 'button');
    expect(btn).toBeDefined();
    (btn?.props.onClick as (() => void) | undefined)?.();
    expect(n).toBe(1);
  });
});

describe('ログインの画面と帯のアプリの名前（AC-4・AC-6）', () => {
  const base = { onSignIn: () => {}, busy: false, error: null, emulator: false };

  it('ログインの画面は Google のボタンを 1 つだけ持ち、見出しは印 + 「損失ノート」（読み上げは「損失ノートにログイン」）', () => {
    const tree = expand(Login(base));
    const buttons = findAll(tree, (v) => v.type === 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.props.class).toBe('gsi');
    expect(textOf(buttons[0])).toBe('Google でログイン');
    const h1 = findAll(tree, (v) => v.type === 'h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]?.props.tabIndex).toBe(-1);
    expect(textOf(h1[0])).toBe('損失ノートにログイン');
    const [tail] = findAll(h1[0], (v) => v.props.class === 'sr-only');
    expect(textOf(tail)).toBe('にログイン');
    // 見出しの行に印がある（帯・favicon と同じ印）
    const [brand] = findAll(tree, (v) => v.props.class === 'login__brand login__brand--hero');
    expect(findAll(brand, (v) => v.props.class === 'login__mark login__mark--lg')).toHaveLength(1);
    // 添え書きの「ログイン」は見出しと重ねて読ませない
    const [kicker] = findAll(tree, (v) => v.props.class === 'login__kicker');
    expect(kicker?.props['aria-hidden']).toBe('true');
    expect(JSON.stringify(tree)).not.toContain('loss-note');
  });

  it('手元のエミュレーターの注記はカードの外（カードの中は本番と同じ）', () => {
    const tree = expand(Login({ ...base, emulator: true }));
    const [card] = findAll(tree, (v) => v.props.class === 'login card');
    expect(findAll(card, (v) => v.props.class === 'login__env')).toHaveLength(0);
    expect(findAll(tree, (v) => v.props.class === 'login__env')).toHaveLength(1);
  });

  it('押している間のログインの画面は「ログインしています…」で押せない', () => {
    const tree = expand(Login({ ...base, busy: true }));
    const [btn] = findAll(tree, (v) => v.type === 'button');
    expect(textOf(btn)).toBe('ログインしています…');
    expect(btn?.props.disabled).toBe(true);
  });

  it('ログインした後の帯の印の横も「損失ノート」', () => {
    const tree = expand(Shell({ route: { name: 'home' }, emulator: false, children: null }));
    const [name] = findAll(tree, (v) => v.props.class === 'brand__name');
    expect(textOf(name)).toBe('損失ノート');
  });
});
