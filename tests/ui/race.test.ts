// ログインの打ち切り（ADR-0003 の決定 8・例の表 L7）。ログインの操作と「届くか」を差し替えて 3 つの分岐を固定する
import { describe, expect, it } from 'vitest';
import { errorCode, loginErrorMessage } from '../../ui/src/auth/errors';
import { raceUnreachable, reachable } from '../../ui/src/auth/race';

const never = <T>() => new Promise<T>(() => {});

describe('raceUnreachable', () => {
  it('届かない → 操作が返らなくても network-request-failed で打ち切る（L7 の文言になる）', async () => {
    const e = await raceUnreachable(never<void>(), async () => false).catch((x: unknown) => x);
    expect(errorCode(e)).toBe('auth/network-request-failed');
    expect(loginErrorMessage(errorCode(e))).toBe('ログインのサービスにつながりません');
  });

  it('届くかの確かめ自体が失敗 → 打ち切る', async () => {
    const e = await raceUnreachable(never<void>(), () => Promise.reject(new Error('x'))).catch(
      (x: unknown) => x,
    );
    expect(errorCode(e)).toBe('auth/network-request-failed');
  });

  it('操作の失敗が先 → その失敗のコードのまま（例: 自分で閉じた）', async () => {
    const op = Promise.reject(
      Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }),
    );
    const e = await raceUnreachable(op, () => never<boolean>()).catch((x: unknown) => x);
    expect(errorCode(e)).toBe('auth/popup-closed-by-user');
  });

  it('届く → 操作の結果を待って返す（打ち切らない）', async () => {
    let resolve: (v: string) => void = () => {};
    const op = new Promise<string>((r) => {
      resolve = r;
    });
    const p = raceUnreachable(op, async () => true);
    await Promise.resolve();
    resolve('signed-in');
    await expect(p).resolves.toBe('signed-in');
  });

  it('打ち切った後に操作が失敗しても、拾われない失敗にならない', async () => {
    let reject: (e: unknown) => void = () => {};
    const op = new Promise<void>((_, r) => {
      reject = r;
    });
    await raceUnreachable(op, async () => false).catch(() => {});
    reject(new Error('later'));
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('reachable', () => {
  it('応答があれば true、例外なら false、URL は末尾に / を付けて no-cors で聞く', async () => {
    const asked: [string, RequestInit | undefined][] = [];
    expect(
      await reachable('http://127.0.0.1:9099', async (u, i) => {
        asked.push([u, i]);
        return {};
      }),
    ).toBe(true);
    expect(asked[0]?.[0]).toBe('http://127.0.0.1:9099/');
    expect(asked[0]?.[1]?.mode).toBe('no-cors');
    expect(
      await reachable('http://127.0.0.1:9099', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe(false);
  });
});
