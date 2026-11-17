// 起動時に Firebase の初期化が失敗したときの代わりのセッション（白い画面にしない。ADR-0003 の決定 8）
import { describe, expect, it } from 'vitest';
import { errorCode, loginErrorMessage } from '../../ui/src/auth/errors';
import { api, unavailableSession } from '../../ui/src/auth/session';
import { NotSignedIn } from '../../ui/src/lib/api';

describe('unavailableSession', () => {
  it('ログインしていない状態として振る舞い、ログインは設定を確かめる案内で失敗する', async () => {
    const s = unavailableSession();
    const states: string[] = [];
    s.subscribe((st) => states.push(st.kind));
    expect(states).toEqual(['signedOut']);
    const e = await s.signIn().catch((x: unknown) => x);
    expect(loginErrorMessage(errorCode(e))).toBe(
      'ログインの準備ができませんでした。接続先の設定を確かめてください',
    );
    expect(await s.getIdToken()).toBeNull();
  });

  it('/api への要求は送らずに NotSignedIn', async () => {
    unavailableSession();
    await expect(api('/api/health')).rejects.toBeInstanceOf(NotSignedIn);
  });
});
