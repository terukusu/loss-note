import { describe, expect, it } from 'vitest';
import { APP_NAME, Page, type PageProps } from '../../ui/src/App';
import { createForbiddenFlag, onAuthKind } from '../../ui/src/auth/forbidden';
import type { Route } from '../../ui/src/lib/routes';
import { Login } from '../../ui/src/pages/Login';

/** 画面の中身を 1 段だけ展開して JSON にする（DOM のライブラリを使わない） */
function pageTree(route: Route): string {
  const props: PageProps = {
    route,
    theme: 'dark',
    onTheme: () => {},
    onSignOut: () => {},
    Parts: null,
  };
  const vnode = Page(props) as { type: (p: unknown) => unknown; props: unknown };
  return JSON.stringify(vnode.type(vnode.props));
}

describe('App', () => {
  it('アプリの名前（画面に出す名前。Google のログインの画面の名前とそろえる。#52 AC-6）', () => {
    expect(APP_NAME).toBe('損失ノート');
  });

  // ホームの見出し（印 + 「損失ノート」、読み上げで「ホーム」。#128）は HomeView が描く（home-view.test.tsx）
  it.each([
    ['record', '記録する'],
    ['trades', '取引'],
    ['review', '振り返り'],
    ['settings', '設定'],
  ] as const)('%s の画面に見出し「%s」がある', (name, title) => {
    expect(pageTree({ name } as Route)).toContain(title);
  });

  it('ホームの空の状態は短い文と下の ［＋ 記録］ を指す一言（ボタンは足さない。［記録する］ は下のタブの 1 か所。#127）', () => {
    const tree = pageTree({ name: 'home' });
    expect(tree).toContain('最初の取引を記録しましょう');
    expect(tree).toContain('[記録] を押');
    expect(tree).not.toContain('"href":"/record"');
  });

  it('設定にテーマの切り替え（ダーク / ライト）とログアウトがある', () => {
    const tree = pageTree({ name: 'settings' });
    expect(tree).toContain('ダーク');
    expect(tree).toContain('ライト');
    expect(tree).toContain('ログアウト');
  });

  it('ログイン画面: ログインのボタン、失敗の文言は role="alert"、エミュレーターの説明', () => {
    const base = { onSignIn: () => {}, busy: false, error: null, emulator: false };
    const plain = JSON.stringify(Login(base));
    expect(plain).toContain('ログイン');
    // ボタンの中身（「Google でログイン」）は tests/ui/google-sign-in.test.ts が展開して見る（#52）
    expect(plain).not.toContain('"role":"alert"');
    expect(plain).not.toContain('エミュレーター');
    const failed = JSON.stringify(
      Login({ ...base, error: 'ログインのサービスと通信できませんでした', emulator: true }),
    );
    expect(failed).toContain('"role":"alert"');
    expect(failed).toContain('ログインのサービスと通信できませんでした');
    expect(failed).toContain('エミュレーター');
    expect(plain).toContain('記録は本人だけが見られます。');
    expect(failed).toContain('記録は本人だけが見られます。');
    // 入口の画面のアプリの名前（#43・#52 で「損失ノート」に）は tests/ui/google-sign-in.test.ts が展開して見る
  });
});

describe('殻の配線: 使えないアカウントの旗（#43 AC-7・R6）', () => {
  function probeSpy() {
    const calls: number[] = [];
    let n = 0;
    return {
      calls,
      probe: () => {
        calls.push(++n);
        return Promise.resolve();
      },
    };
  }

  it('ログインしたら旗を下ろしてから確かめの要求を 1 回送る。分かるまで（unknown）は何もしない', () => {
    const flag = createForbiddenFlag();
    const p = probeSpy();
    onAuthKind('unknown', flag, p.probe);
    expect(p.calls).toHaveLength(0);
    flag.markFrom(flag.generation());
    let setWhenProbed: boolean | null = null;
    onAuthKind('signedIn', flag, () => {
      setWhenProbed = flag.isSet();
      return p.probe();
    });
    expect(setWhenProbed).toBe(false);
    expect(p.calls).toHaveLength(1);
  });

  it('ログアウトしたら旗を下ろし、要求は送らない', () => {
    const flag = createForbiddenFlag();
    const p = probeSpy();
    flag.markFrom(flag.generation());
    onAuthKind('signedOut', flag, p.probe);
    expect(flag.isSet()).toBe(false);
    expect(p.calls).toHaveLength(0);
  });

  it('使えないアカウントの要求の 403 がログアウトの後に遅れて届いても、次のアカウントには出さない', () => {
    const flag = createForbiddenFlag();
    const p = probeSpy();
    onAuthKind('signedIn', flag, p.probe); // 使えないアカウントでログイン
    const stale = flag.generation(); // その間に送った要求
    onAuthKind('signedOut', flag, p.probe);
    onAuthKind('signedIn', flag, p.probe); // 許可されたアカウントでログイン（確かめは 200）
    flag.markFrom(stale); // 前の要求の 403 が遅れて届く
    expect(flag.isSet()).toBe(false);
  });

  it('確かめの要求の失敗（通信の失敗）は投げない', async () => {
    const flag = createForbiddenFlag();
    onAuthKind('signedIn', flag, () => Promise.reject(new Error('network')));
    await new Promise((ok) => setTimeout(ok, 0));
    expect(flag.isSet()).toBe(false);
  });
});

describe('設定のログアウトの失敗', () => {
  it('押している間は押せず、失敗は role="alert" の決まった文言', () => {
    const vnode = Page({
      route: { name: 'settings' },
      theme: 'dark',
      onTheme: () => {},
      onSignOut: () => {},
      signOutBusy: true,
      signOutError: 'ログアウトできませんでした。もう一度押してください',
      Parts: null,
    }) as { type: (p: unknown) => unknown; props: unknown };
    const tree = JSON.stringify(vnode.type(vnode.props));
    expect(tree).toContain('ログアウトしています…');
    expect(tree).toContain('"disabled":true');
    expect(tree).toContain('"role":"alert"');
    expect(tree).toContain('ログアウトできませんでした');
  });
});
