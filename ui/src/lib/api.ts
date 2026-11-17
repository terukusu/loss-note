// 画面から API（/api/...）への要求の窓口（Issue #3 R5・契約 C-7）。
// ログイン中の利用者の ID トークンを Authorization: Bearer で付ける（検証は API の側。#4）。
// ログインしていなければ要求を送らずに NotSignedIn を投げる。トークンは同一オリジンの /api/ にだけ付ける
export class NotSignedIn extends Error {
  constructor() {
    super('ログインしていません');
    this.name = 'NotSignedIn';
  }
}

export interface ApiDeps {
  /** ログイン中の ID トークン（ログインしていなければ null） */
  readonly getIdToken: () => Promise<string | null>;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const BASE = 'https://api-path.invalid';

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * 同一オリジンの /api/ の下に解決されるパスなら、正規化したパス（+ クエリ）を返す。ほかは null。
 * URL として解決してから判定する（符号化した ..（%2e%2e）・タブなどで /api の外に出るものを通さない）
 */
export function normalizeApiPath(path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  // 制御文字（URL の解決で黙って消える）と、符号化した区切り（%2f・%5c）は受けない
  if (hasControlChar(path) || /%2f|%5c/i.test(path)) return null;
  let u: URL;
  try {
    u = new URL(path, BASE);
  } catch {
    return null;
  }
  if (u.origin !== BASE || !u.pathname.startsWith('/api/')) return null;
  return `${u.pathname}${u.search}`;
}

export function isApiPath(path: string): boolean {
  return normalizeApiPath(path) !== null;
}

export async function apiFetch(path: string, init: RequestInit, deps: ApiDeps): Promise<Response> {
  const target = normalizeApiPath(path);
  if (target === null) throw new TypeError('API の要求は /api/ で始まるパスだけです');
  const token = await deps.getIdToken();
  if (!token) throw new NotSignedIn();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return deps.fetch(target, { ...init, headers });
}
