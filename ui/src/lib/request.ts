// /api への要求の窓口（記録する画面 #13 と設定の画面 #5 が共有する）。
// - 要求には時間の上限を置く。時間切れ・通信の失敗は network、401・ログインしていない（NotSignedIn）は auth
// - 応答の本文・例外の文字列は持ち出さない（失敗は種類だけ。画面は種類から決まった文言を選ぶ）
import { NotSignedIn } from './api';

/** /api への要求（ui/src/auth/session.ts の api と同じ形） */
export type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

export type FailureKind = 'auth' | 'network' | 'other';

/** 要求の時間の上限（ミリ秒） */
export const REQUEST_TIMEOUT_MS = 15_000;

/** ログインが切れた（401・ログインしていない）ときの決まった文言（記録・設定の画面で同じ） */
export const AUTH_EXPIRED = 'ログインが切れました。ログインし直してください。';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** 失敗の種類だけを持つ例外 */
export class Failed extends Error {
  constructor(readonly kind: FailureKind) {
    super(kind);
  }
}

export const kindOf = (e: unknown): FailureKind => (e instanceof Failed ? e.kind : 'other');

export interface RequestLimit {
  /** 時間の上限（省けば既定） */
  readonly ms?: number;
  /** 外から止める（止めたら待たずに network で終える） */
  readonly ctl?: AbortController;
}

export type RequestFn = (
  path: string,
  init?: RequestInit,
  limit?: RequestLimit,
) => Promise<Response>;

/** 時間の上限つきの要求を作る。時間切れ・通信の失敗は network、ログインしていなければ auth */
export function createRequest(api: ApiFn, timeoutMs: number = REQUEST_TIMEOUT_MS): RequestFn {
  return async (path, init = {}, limit = {}) => {
    const ctl = limit.ctl ?? new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, ng) => {
      timer = setTimeout(() => {
        ctl.abort();
        ng(new Failed('network'));
      }, limit.ms ?? timeoutMs);
      // 外から止めた（やめた・新しい読み取り）ときは待たずに終える
      limit.ctl?.signal.addEventListener('abort', () => ng(new Failed('network')), { once: true });
    });
    try {
      const res = await Promise.race([api(path, { ...init, signal: ctl.signal }), timeout]);
      if (res.status === 401) throw new Failed('auth');
      return res;
    } catch (e) {
      if (e instanceof Failed) throw e;
      if (e instanceof NotSignedIn) throw new Failed('auth');
      throw new Failed('network');
    } finally {
      clearTimeout(timer);
    }
  };
}

/** 応答を JSON で読む（状態が ok でない・読めない本文は Failed。本文の中身は持ち出さない） */
export async function getJson<T>(res: Response, ok: number): Promise<T> {
  if (res.status !== ok) throw new Failed('other');
  try {
    return (await res.json()) as T;
  } catch {
    throw new Failed('other');
  }
}
