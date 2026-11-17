// C-7 /api の窓口（Issue #3 の例の表 L5・L6・R5）。偽のトークン取得と偽の fetch を差す
import { describe, expect, it } from 'vitest';
import { apiFetch, NotSignedIn } from '../../ui/src/lib/api';

interface Call {
  url: string;
  headers: Headers;
  method: string | undefined;
}

function fakeFetch() {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method });
    return new Response('{"status":"ok"}', { status: 200 });
  };
  return { calls, fetch };
}

describe('apiFetch', () => {
  it('L5: ログイン中は Authorization: Bearer <ID トークン> を付ける', async () => {
    const f = fakeFetch();
    const res = await apiFetch(
      '/api/trades',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      { getIdToken: async () => 'synthetic-id-token', fetch: f.fetch },
    );
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe('/api/trades');
    expect(f.calls[0]?.method).toBe('POST');
    expect(f.calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-id-token');
    expect(f.calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('L5: 呼び出し側が渡した Authorization は使わず、ログイン中のトークンで上書きする', async () => {
    const f = fakeFetch();
    await apiFetch(
      '/api/x',
      { headers: { Authorization: 'Bearer other' } },
      { getIdToken: async () => 't1', fetch: f.fetch },
    );
    expect(f.calls[0]?.headers.get('Authorization')).toBe('Bearer t1');
  });

  it('正規化したパスで送る（/api/a/../b → /api/b、クエリは残す）', async () => {
    const f = fakeFetch();
    await apiFetch('/api/a/./../b?x=1', {}, { getIdToken: async () => 't', fetch: f.fetch });
    expect(f.calls[0]?.url).toBe('/api/b?x=1');
  });

  it('L6: ログインしていない（トークンが無い）なら、要求を送らずに NotSignedIn を投げる', async () => {
    const f = fakeFetch();
    await expect(
      apiFetch('/api/trades', {}, { getIdToken: async () => null, fetch: f.fetch }),
    ).rejects.toBeInstanceOf(NotSignedIn);
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    'https://evil.example/api/x',
    '//evil.example/api/x',
    '/apix',
    'api/x',
    '/other',
    '/api/../x',
    '/\\evil.example/api',
    '/api/%2e%2e/x',
    '/api/.%2E/x',
    '/api/%2E./x',
    '/api/.\t./x',
    '/api/\n../x',
    '/api/..%2fx',
    '/api%2f../x',
  ])('同一オリジンの /api/ 以外（%s）にはトークンを出さない（送らずに投げる）', async (path) => {
    const f = fakeFetch();
    let tokenAsked = false;
    await expect(
      apiFetch(
        path,
        {},
        {
          getIdToken: async () => {
            tokenAsked = true;
            return 't';
          },
          fetch: f.fetch,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(f.calls).toHaveLength(0);
    expect(tokenAsked).toBe(false);
  });
});
