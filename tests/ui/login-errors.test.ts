// C-7 ログインの失敗の文言（Issue #3 の例の表 L7）。例外の本文・コードは画面に出さない
import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from '../../ui/src/auth/errors';

describe('loginErrorMessage', () => {
  it.each(['auth/network-request-failed', 'auth/timeout'])(
    'L7: %s → 「ログインのサービスと通信できませんでした」',
    (code) => {
      expect(loginErrorMessage(code)).toBe('ログインのサービスと通信できませんでした');
    },
  );

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])(
    '自分で閉じた（%s）→ 文言なし',
    (code) => {
      expect(loginErrorMessage(code)).toBeNull();
    },
  );

  it('ポップアップが止められた → もう一度押すよう促す', () => {
    expect(loginErrorMessage('auth/popup-blocked')).toBe(
      'ポップアップがブロックされました。ブラウザでポップアップを許可して、もう一度押してください',
    );
  });

  it('起動時の初期化の失敗（app/unavailable）→ 設定を確かめる案内', () => {
    expect(loginErrorMessage('app/unavailable')).toBe(
      'ログインの準備ができませんでした。接続先の設定を確認してください',
    );
  });

  // auth/internal-error は設定の誤りでも返るので「つながりません」と言い切らない
  it.each([
    undefined,
    '',
    'auth/internal-error',
    'auth/operation-not-allowed',
    'something <b>else</b>',
  ])('そのほか（%s）→ 「ログインできませんでした」（コードを出さない）', (code) => {
    const m = loginErrorMessage(code);
    expect(m).toBe('ログインできませんでした');
  });
});
