import { describe, expect, it } from 'vitest';
import { APP_NAME, Page, type PageProps } from '../../ui/src/App';
import type { Route } from '../../ui/src/lib/routes';

/** 画面の中身を 1 段だけ展開して JSON にする（DOM のライブラリを使わない） */
function pageTree(route: Route): string {
  const props: PageProps = { route, theme: 'dark', onTheme: () => {}, Parts: null };
  const vnode = Page(props) as { type: (p: unknown) => unknown; props: unknown };
  return JSON.stringify(vnode.type(vnode.props));
}

describe('App', () => {
  it('アプリの名前', () => {
    expect(APP_NAME).toBe('loss-note');
  });

  it.each([
    ['login', 'ログイン'],
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

  it('設定にテーマの切り替え（ダーク / ライト）がある', () => {
    const tree = pageTree({ name: 'settings' });
    expect(tree).toContain('ダーク');
    expect(tree).toContain('ライト');
  });
});
