// C-7 ログインの門（Issue #3 の例の表 L1〜L4・L6・R5）。純関数だけで確かめる（実ブラウザは ui:check の L1〜L7）
import { describe, expect, it } from 'vitest';
import { type AuthState, gate } from '../../ui/src/auth/gate';
import type { Route } from '../../ui/src/lib/routes';

const UNKNOWN: AuthState = { kind: 'unknown' };
const OUT: AuthState = { kind: 'signedOut' };
const IN: AuthState = { kind: 'signedIn' };
const PROD = { dev: false };

const trades: Route = { name: 'trades' };
const login: Route = { name: 'login' };

describe('gate（ログインの門）', () => {
  it('L1: ログインしていない状態で一覧の URL を開く → ログイン画面へ置き換え、一覧の中身は出さない', () => {
    const g = gate(OUT, trades, '/trades', '', PROD);
    expect(g.render).not.toBe('page');
    expect(g.replace).toBe('/login?next=%2Ftrades');
  });

  it('L1: クエリも戻り先に入れる。ホームは next を付けない', () => {
    expect(gate(OUT, { name: 'record' }, '/record', '?x=1', PROD).replace).toBe(
      '/login?next=%2Frecord%3Fx%3D1',
    );
    expect(gate(OUT, { name: 'home' }, '/', '', PROD).replace).toBe('/login');
  });

  it('ログインしていない状態のログイン画面 → ログイン画面を出す（置き換えない）', () => {
    expect(gate(OUT, login, '/login', '?next=%2Ftrades', PROD)).toEqual({ render: 'login' });
  });

  it('L2: ログインした後のログイン画面 → 開こうとした画面（next）へ置き換える', () => {
    expect(gate(IN, login, '/login', '?next=%2Ftrades', PROD)).toEqual({
      render: 'loading',
      replace: '/trades',
    });
    expect(gate(IN, login, '/login', '?next=%2Ftrades%2Fabc', PROD).replace).toBe('/trades/abc');
  });

  it('L2: next が外の URL・知らない画面・無いならホーム（オープンリダイレクトを作らない）', () => {
    for (const next of [
      'https%3A%2F%2Fevil.example',
      '%2F%2Fevil.example',
      '%2Fnope',
      '%2Flogin',
    ]) {
      expect(gate(IN, login, '/login', `?next=${next}`, PROD).replace, next).toBe('/');
    }
    expect(gate(IN, login, '/login', '', PROD).replace).toBe('/');
  });

  it('L3: ログアウトの後に戻るで前の画面の URL に着いても、中身を出さずログイン画面へ', () => {
    const g = gate(OUT, { name: 'settings' }, '/settings', '', PROD);
    expect(g.render).not.toBe('page');
    expect(g.replace).toBe('/login?next=%2Fsettings');
  });

  it('L4: 状態が分かるまでは、中身もログイン画面も出さない（再読み込みでちらつかない）', () => {
    expect(gate(UNKNOWN, trades, '/trades', '', PROD)).toEqual({ render: 'loading' });
    expect(gate(UNKNOWN, login, '/login', '', PROD)).toEqual({ render: 'loading' });
  });

  it('L4: ログイン済みならその画面', () => {
    expect(gate(IN, trades, '/trades', '', PROD)).toEqual({ render: 'page' });
    expect(gate(IN, { name: 'trade', id: 'x' }, '/trades/x', '', PROD)).toEqual({ render: 'page' });
  });

  it('ログインしていなければ、どの画面も中身を出さない', () => {
    const routes: [Route, string][] = [
      [{ name: 'home' }, '/'],
      [{ name: 'record' }, '/record'],
      [{ name: 'trades' }, '/trades'],
      [{ name: 'trade', id: 'a' }, '/trades/a'],
      [{ name: 'settings' }, '/settings'],
      [{ name: 'parts' }, '/dev/parts'],
    ];
    for (const [r, p] of routes) {
      const g = gate(OUT, r, p, '', { dev: true });
      expect(g.render, p).toBe('loading');
      expect(g.replace?.startsWith('/login'), p).toBe(true);
    }
  });
});
