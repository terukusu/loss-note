// 使えないアカウント（Issue #43 R6・例 L3・L4・AC-7）: 旗（DOM なし）と画面の vnode。実ブラウザは ui:check
import { describe, expect, it } from 'vitest';
import { createForbiddenFlag } from '../../ui/src/auth/forbidden';
import {
  FORBIDDEN_ACTION,
  FORBIDDEN_LEAD,
  FORBIDDEN_REASON,
  FORBIDDEN_TITLE,
  FORBIDDEN_TITLE_HEAD,
  FORBIDDEN_TITLE_TAIL,
  Forbidden,
} from '../../ui/src/pages/Forbidden';

interface VNode {
  type: unknown;
  props: { children?: unknown; onClick?: () => void; [k: string]: unknown };
}

/** vnode を展開する（関数の部品は呼んで中身にする。DOM のライブラリを使わない） */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object' || !('type' in node)) return node;
  const v = node as VNode;
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

describe('createForbiddenFlag', () => {
  it('購読するとすぐ今の値を知らせ、変わったときだけ知らせる', () => {
    const flag = createForbiddenFlag();
    const seen: boolean[] = [];
    const stop = flag.subscribe((s) => seen.push(s));
    expect(seen).toEqual([false]);
    flag.markFrom(flag.generation());
    flag.markFrom(flag.generation());
    expect(flag.isSet()).toBe(true);
    flag.reset();
    flag.reset();
    expect(seen).toEqual([false, true, false]);
    stop();
    flag.markFrom(flag.generation());
    expect(seen).toEqual([false, true, false]);
    expect(flag.isSet()).toBe(true);
  });

  it('旗ごとに別（記憶の中だけ）', () => {
    const a = createForbiddenFlag();
    const b = createForbiddenFlag();
    a.markFrom(a.generation());
    expect(b.isSet()).toBe(false);
  });

  it('下ろした後に、前の世代で送った要求の 403 が遅れて届いても立てない', () => {
    const flag = createForbiddenFlag();
    const before = flag.generation(); // 使えないアカウントのときに送った要求
    flag.reset(); // ログアウト
    flag.reset(); // 次のアカウントでログイン
    flag.markFrom(before); // 遅れて届いた 403
    expect(flag.isSet()).toBe(false);
    flag.markFrom(flag.generation()); // 今の世代の 403 なら立つ
    expect(flag.isSet()).toBe(true);
  });
});

describe('Forbidden（使えないアカウントの画面）', () => {
  const base = { onSignOut: () => {}, signOutBusy: false, signOutError: null };

  it('L3: 決まった文言とログアウトのボタンがあり、記録の中身・行き先・role="alert" は無い', () => {
    const tree = expand(Forbidden(base));
    const text = JSON.stringify(tree);
    expect(text).toContain(FORBIDDEN_TITLE_HEAD);
    expect(text).toContain(FORBIDDEN_TITLE_TAIL);
    expect(text).toContain(FORBIDDEN_LEAD);
    expect(text).toContain(FORBIDDEN_REASON);
    expect(text).toContain('損失ノート');
    expect(text).not.toContain('loss-note');
    expect(FORBIDDEN_TITLE).toBe('このアカウントでは使えません');
    expect(FORBIDDEN_LEAD).toBe('ほかのアカウントでログインし直してください。');
    expect(FORBIDDEN_REASON).toBe('使えるのは登録されたアカウントだけです。');
    expect(text).not.toContain('許可リスト');
    const h1 = findAll(tree, (v) => v.type === 'h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]?.props.tabIndex).toBe(-1);
    // 見出しは 2 つの句の間でだけ折り返せる（<wbr> が 1 つ、その前後が句）
    expect(JSON.stringify(h1[0])).toContain('"type":"wbr"');
    const buttons = findAll(tree, (v) => v.type === 'button');
    expect(buttons).toHaveLength(1);
    expect(JSON.stringify(buttons[0])).toContain(FORBIDDEN_ACTION);
    expect(FORBIDDEN_ACTION).toBe('別のアカウントでログイン');
    expect(findAll(tree, (v) => v.type === 'a')).toHaveLength(0);
    expect(text).not.toContain('"role":"alert"');
    expect(text).not.toContain('@');
  });

  it('L4: ボタンを押すと onSignOut を呼ぶ', () => {
    let n = 0;
    const tree = expand(Forbidden({ ...base, onSignOut: () => n++ }));
    const [button] = findAll(tree, (v) => v.type === 'button');
    button?.props.onClick?.();
    expect(n).toBe(1);
  });

  it('ログアウト中は押せず、失敗は role="alert" の文言', () => {
    const text = JSON.stringify(
      expand(
        Forbidden({
          onSignOut: () => {},
          signOutBusy: true,
          signOutError: 'ログアウトできませんでした。もう一度押してください',
        }),
      ),
    );
    expect(text).toContain('ログアウトしています…');
    expect(text).toContain('"disabled":true');
    expect(text).toContain('"role":"alert"');
    expect(text).toContain('ログアウトできませんでした');
  });
});
