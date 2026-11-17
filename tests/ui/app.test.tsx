import { describe, expect, it } from 'vitest';
import { APP_NAME, App } from '../../ui/src/App';

describe('App', () => {
  it('アプリの名前を見出しに出す', () => {
    // DOM のライブラリを使わず、戻り値の VNode の木を JSON にして中身を見る
    const tree = JSON.stringify(App());
    expect(tree).toContain(APP_NAME);
    expect(tree).toContain('記録はまだありません');
  });
});
