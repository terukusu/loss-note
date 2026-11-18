// ログインの薄い層（Firebase Authentication。手元はエミュレーター。設計書 10 章・ADR-0003）。
// 画面は firebase/app と firebase/auth だけを読み込む（Firestore・Storage は読まない。KEEP-3）。
// ポップアップの仕組み（Google の gapi の script と iframe）は、ログインのボタンを押したときにだけ読み込む
// （初期化では読まない = ログイン済みの再読み込みや、ログイン画面を開いただけでは外へ取りに行かない）
import { initializeApp } from 'firebase/app';
import {
  type Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { apiFetch } from '../lib/api';
import type { AuthConfig } from './config';
import { createForbiddenFlag, type ForbiddenFlag } from './forbidden';
import type { AuthState } from './gate';
import { raceUnreachable, reachable } from './race';

export interface AuthSession {
  /** 認証の状態の購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (state: AuthState) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  getIdToken(): Promise<string | null>;
}

let active: AuthSession | null = null;

export function createFirebaseSession(config: AuthConfig): AuthSession {
  const app = initializeApp({
    projectId: config.projectId,
    apiKey: config.apiKey,
    authDomain: config.authDomain,
  });
  const auth: Auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  });
  if (config.emulatorUrl) {
    // SDK の既定の警告の帯は style 属性で固定した要素を body に足すので止め、アプリの枠に印を出す
    connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
  }
  let state: AuthState = { kind: 'unknown' };
  const listeners = new Set<(s: AuthState) => void>();
  onAuthStateChanged(auth, (user) => {
    state = user ? { kind: 'signedIn' } : { kind: 'signedOut' };
    for (const fn of listeners) fn(state);
  });
  const session: AuthSession = {
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    async signIn() {
      // ポップアップはクリックの直後に開く（待ってから開くとブラウザに止められる）
      const op = signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
      // エミュレーターが止まっていると SDK は失敗を返さずに待ち続けるので、届くかを並行して確かめ、
      // 届かなければ「つながらない」で打ち切る（L7。開いたポップアップは利用者が閉じる。race.ts）
      const emu = config.emulatorUrl;
      await (emu ? raceUnreachable(op, () => reachable(emu)) : op);
    },
    async signOut() {
      await signOut(auth);
    },
    async getIdToken() {
      return (await auth.currentUser?.getIdToken()) ?? null;
    },
  };
  active = session;
  return session;
}

/**
 * 起動時に Firebase の初期化が例外を投げたとき（接続先の設定の誤りなど）の代わり。
 * ログインしていない状態として振る舞い、ログインは「設定を確かめて」の案内で失敗する（白い画面にしない）
 */
export function unavailableSession(): AuthSession {
  const fail = () =>
    Promise.reject(
      Object.assign(new Error('ログインの準備ができていません'), { code: 'app/unavailable' }),
    );
  const session: AuthSession = {
    subscribe(fn) {
      fn({ kind: 'signedOut' });
      return () => {};
    },
    signIn: fail,
    signOut: fail,
    getIdToken: async () => null,
  };
  active = session;
  return session;
}

/** 今のログインを終える（API が 401 を返した = ログインが切れたとき。門がログイン画面へ置き換える） */
export function signOutActive(): Promise<void> {
  return active?.signOut() ?? Promise.resolve();
}

/** 使えないアカウントの旗（/api/* の 403 で立つ。アプリの殻が購読する。#43） */
export const forbiddenFlag: ForbiddenFlag = createForbiddenFlag();

/** 画面から /api への要求（ログイン中の ID トークンを付ける）。最初に使うのは #13 / #4 */
export function api(path: string, init: RequestInit = {}): Promise<Response> {
  // 送る前の世代を控え、遅れて届いた前のアカウントの 403 では旗を立てない
  const generation = forbiddenFlag.generation();
  return apiFetch(path, init, {
    getIdToken: () => active?.getIdToken() ?? Promise.resolve(null),
    fetch: (input, i) => fetch(input, i),
    onForbidden: () => forbiddenFlag.markFrom(generation),
  });
}
