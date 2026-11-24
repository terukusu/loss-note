import { describe, expect, it } from 'vitest';
import { readTokens } from './helpers/css-tokens';

/**
 * ホーム画面に追加して開ける（Issue #77・ADR-0018）。manifest・manifest のアイコン・index.html の head・サービスワーカーを
 * 置かないこと。本番で /manifest.webmanifest がこのファイルを返すことは api/tests/test_web.py と
 * .github/scripts/image-check.sh が見る。
 *
 * 色の値はテストに写さず tokens.css を読む（ダークの地の色を変えたら manifest・index.html の直し漏れがここで落ちる。例 E6）。
 * ファイルは Node の fs・zlib で読む（@types/node を足さないため型はここで最小限に書く。icons.test.ts と同じ）
 */
interface NodeFs {
  readFileSync(p: URL): Uint8Array;
  readFileSync(p: URL, enc: 'utf8'): string;
  readdirSync(p: URL, opts: { recursive: true }): string[];
}
interface NodeZlib {
  inflateSync(b: Uint8Array): Uint8Array;
}
const node = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: string): unknown };
  }
).process;
const fs = node.getBuiltinModule('node:fs') as NodeFs;
const zlib = node.getBuiltinModule('node:zlib') as NodeZlib;

const url = (path: string) => new URL(path, import.meta.url);
const text = (path: string) => fs.readFileSync(url(path), 'utf8');
const PUBLIC = '../../ui/public/';

const manifestText = text(`${PUBLIC}manifest.webmanifest`);
const manifest = JSON.parse(manifestText) as Record<string, unknown>;
const html = text('../../ui/index.html');

/** tokens.css のダークのテーマの --bg（原色まで解いた値。#229） */
const DARK_BG = (() => {
  const v = readTokens(text('../../ui/src/styles/tokens.css')).resolved.dark.get('--bg');
  if (!v) throw new Error('tokens.css にダークの --bg がありません');
  return v.toLowerCase();
})();

/** index.html の tag を属性の辞書で（属性の順・改行に依存しない） */
function tags(name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) =>
    Object.fromEntries(
      [...(m[1] ?? '').matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((a) => [
        (a[1] ?? '').toLowerCase(),
        a[2] ?? '',
      ]),
    ),
  );
}

// ── PNG（IHDR・IDAT を読み、フィルタを戻して画素にする。8 ビットの RGB / RGBA・インターレースなしだけ）
const be32 = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;
interface Png {
  width: number;
  height: number;
  colorType: number;
  chunks: string[];
  /** 行ごとの画素（RGB なら 3、RGBA なら 4 バイト / 画素） */
  pixels: Uint8Array;
  channels: number;
}
function readPng(b: Uint8Array): Png {
  expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: string[] = [];
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let colorType = -1;
  for (let o = 8; o + 8 <= b.length; ) {
    const len = be32(b, o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    const data = b.subarray(o + 8, o + 8 + len);
    chunks.push(type);
    if (type === 'IHDR') {
      width = be32(data, 0);
      height = be32(data, 4);
      expect(data[8], 'ビット深度').toBe(8);
      colorType = data[9] ?? -1;
      expect(data[12], 'インターレース').toBe(0);
    }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(channels, `色の種類 ${colorType}`).toBeGreaterThan(0);
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of idat) {
    joined.set(d, at);
    at += d.length;
  }
  const raw = zlib.inflateSync(joined);
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const c = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      pixels[y * stride + x] = ((line[x] ?? 0) + pred) & 0xff;
    }
  }
  return { width, height, colorType, chunks, pixels, channels };
}
const pngOf = (name: string) => readPng(fs.readFileSync(url(`${PUBLIC}${name}`)));
/** 印の白い線の画素（RGB がどれも 200 以上。地の藍は R・G が 120 未満） */
const isInk = (p: Png, x: number, y: number) => {
  const at = (y * p.width + x) * p.channels;
  return [0, 1, 2].every((i) => (p.pixels[at + i] ?? 0) >= 200);
};

describe('manifest（#77）', () => {
  it('AC-1: 名前・言語・id / start_url / scope・display', () => {
    expect(manifest.name).toBe('損失ノート');
    expect(manifest.short_name).toBe('損失ノート');
    expect(manifest.lang).toBe('ja');
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('AC-1: theme_color と background_color は tokens.css のダークの --bg（E6）', () => {
    expect(DARK_BG).toMatch(/^#[0-9a-f]{6}$/);
    expect(String(manifest.theme_color).toLowerCase()).toBe(DARK_BG);
    expect(String(manifest.background_color).toLowerCase()).toBe(DARK_BG);
  });

  it('AC-1: 外のオリジン・fullscreen・minimal-ui・サービスワーカー・共有の受け口の語が無い', () => {
    for (const word of [
      /https?:\/\//i,
      /\/\/[a-z0-9]/i,
      /fullscreen/i,
      /minimal-ui/i,
      /serviceworker/i,
      /share_target/i,
    ])
      expect(manifestText).not.toMatch(word);
  });

  it('AC-2: icons は通常の形とマスクできる形の 192・512 の 4 つ（同じオリジンのパス）', () => {
    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });
});

describe('manifest のアイコン（#77）', () => {
  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ])('AC-2: %s は %i 角の PNG で、角は透過・中心に印の白い線', (name, n) => {
    const p = pngOf(name);
    expect([p.width, p.height]).toEqual([n, n]);
    expect(p.chunks[0]).toBe('IHDR');
    expect(p.chunks.at(-1)).toBe('IEND');
    expect(p.colorType).toBe(6);
    expect(p.pixels[3], '左上の角の不透明度').toBe(0);
    let ink = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (isInk(p, x, y)) ink++;
    expect(ink).toBeGreaterThan(0);
  });

  it.each([
    ['icon-maskable-192.png', 192],
    ['icon-maskable-512.png', 512],
  ])(
    'AC-2: %s は %i 角の不透明な PNG で、白い線は中心から幅の 40% の円の中だけ（E5）',
    (name, n) => {
      const p = pngOf(name);
      expect([p.width, p.height]).toEqual([n, n]);
      // 透過しえない形だけを通す: 色の種類 2（RGB）かつ tRNS なし
      expect(p.colorType).toBe(2);
      expect(p.chunks).not.toContain('tRNS');
      const r = 0.4 * n;
      const c = n / 2;
      let inside = 0;
      let outside = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          if (!isInk(p, x, y)) continue;
          // 画素の中心からの距離
          if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r) inside++;
          else outside++;
        }
      expect(outside, '円の外の白い線の画素').toBe(0);
      expect(inside, '円の中の白い線の画素').toBeGreaterThan(0);
    },
  );
});

describe('index.html の head（#77）', () => {
  const links = tags('link');
  const metas = tags('meta');

  it('AC-3: manifest への参照 1 つ・theme-color 1 つ（ダークの --bg）・ホーム画面の名前', () => {
    expect(links.filter((l) => l.rel === 'manifest')).toEqual([
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ]);
    const theme = metas.filter((m) => m.name === 'theme-color');
    expect(theme).toHaveLength(1);
    expect(theme[0]?.content?.toLowerCase()).toBe(DARK_BG);
    expect(theme[0]?.media).toBeUndefined();
    expect(metas.filter((m) => m.name === 'apple-mobile-web-app-title')).toEqual([
      { name: 'apple-mobile-web-app-title', content: '損失ノート' },
    ]);
    // iOS は manifest の display を読む（ADR-0018）。全画面の meta は置かない
    expect(html).not.toMatch(/mobile-web-app-capable/i);
  });

  it('#127: 安全域まで面を敷く（viewport-fit=cover・状態のバーは black-translucent）・キーボードで窓を縮める（ui-guidelines 9.6）', () => {
    const viewport = metas.filter((m) => m.name === 'viewport');
    expect(viewport).toHaveLength(1);
    const parts = (viewport[0]?.content ?? '').split(',').map((p) => p.trim());
    expect(parts).toEqual([
      'width=device-width',
      'initial-scale=1',
      'viewport-fit=cover',
      'interactive-widget=resizes-content',
    ]);
    expect(metas.filter((m) => m.name === 'apple-mobile-web-app-status-bar-style')).toEqual([
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ]);
  });
});

describe('サービスワーカーを置かない（#77・ADR-0018）', () => {
  it('AC-3: ui/ の下のソースに serviceWorker の語が無い', () => {
    const files = fs
      .readdirSync(url('../../ui/'), { recursive: true })
      .filter((f) => /\.(ts|tsx|js|mjs|html|css|json|webmanifest|svg)$/i.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(text(`../../ui/${f}`), f).not.toMatch(/serviceWorker/i);
  });
});
