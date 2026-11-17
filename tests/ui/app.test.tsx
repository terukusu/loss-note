import { describe, expect, it } from 'vitest';
import { APP_NAME, Page, type PageProps } from '../../ui/src/App';
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
  it('アプリの名前', () => {
    expect(APP_NAME).toBe('loss-note');
  });

  it.each([
    ['home', 'ホーム'],
    ['record', '記録する'],
    ['trades', '取引の一覧'],
    ['settings', '設定'],
  ] as const)('%s の画面に見出し「%s」がある', (name, title) => {
    expect(pageTree({ name } as Route)).toContain(title);
  });

  it('ホームの空の状態に [記録する]（/record へのリンク）がある（V1）', () => {
    const tree = pageTree({ name: 'home' });
    expect(tree).toContain('最初の取引を記録しましょう');
    expect(tree).toContain('"href":"/record"');
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
    expect(plain).toContain('Google でログイン');
    expect(plain).not.toContain('"role":"alert"');
    expect(plain).not.toContain('エミュレーター');
    const failed = JSON.stringify(
      Login({ ...base, error: 'ログインのサービスにつながりません', emulator: true }),
    );
    expect(failed).toContain('"role":"alert"');
    expect(failed).toContain('ログインのサービスにつながりません');
    expect(failed).toContain('エミュレーター');
    // 利用者の分離（#4）が入るまで、本人だけが見られるという約束の文言は出さない
    expect(failed).not.toContain('本人だけ');
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
