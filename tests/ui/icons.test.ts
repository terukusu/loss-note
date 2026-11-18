import { describe, expect, it } from 'vitest';

/**
 * アプリのアイコン（ブラウザーのタブ・iPhone のホーム画面。Issue #52）。ui/public/ の 3 つのファイルと index.html の link。
 * 本番で /favicon.ico がアイコンを返すことは api/tests/test_web.py と .github/scripts/image-check.sh が見る
 */
const fs = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(p: URL): Uint8Array;
        readFileSync(p: URL, enc: 'utf8'): string;
      };
    };
  }
).process.getBuiltinModule('node:fs');
const pub = (name: string) => new URL(`../../ui/public/${name}`, import.meta.url);

const u16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;
const be32 = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => PNG_SIG.every((v, i) => b[i] === v);
/** PNG の IHDR の幅・高さ */
const pngSize = (b: Uint8Array) => [be32(b, 16), be32(b, 20)];

/** 判定の段の色（tokens.css の --tier-*）。アイコンには使わない */
const TIER_COLORS = (() => {
  const css = fs.readFileSync(new URL('../../ui/src/styles/tokens.css', import.meta.url), 'utf8');
  return [...css.matchAll(/--tier-[a-z-]+:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) =>
    (m[1] ?? '').toLowerCase(),
  );
})();

describe('アイコン', () => {
  it('favicon.svg: 外のもの・script・style 属性を持たず、判定の段の色を使わない', () => {
    const svg = fs.readFileSync(pub('favicon.svg'), 'utf8');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).not.toMatch(
      /<script|\son[a-z]+\s*=|\sstyle\s*=|<style|href\s*=|url\(\s*['"]?(https?:)?\/\//i,
    );
    // xmlns の名前空間の文字列だけは URL の形を持つ
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//);
    expect(TIER_COLORS.length).toBeGreaterThan(0);
    const colors = [...svg.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.filter((c) => TIER_COLORS.includes(c))).toEqual([]);
  });

  it('画面の印（ログイン・帯）は favicon と同じ藍の 2 色・白の線で、テーマでそのまま、判定の段の色を使わない', () => {
    const svg = fs.readFileSync(pub('favicon.svg'), 'utf8');
    const stops = [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map((m) =>
      (m[1] ?? '').toLowerCase(),
    );
    const tokens = fs.readFileSync(
      new URL('../../ui/src/styles/tokens.css', import.meta.url),
      'utf8',
    );
    const valuesOf = (name: string) =>
      [...tokens.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) =>
        (m[1] ?? '').toLowerCase(),
      );
    for (const name of ['--mark-from', '--mark-to', '--mark-ink']) {
      const values = valuesOf(name);
      expect(values, name).toHaveLength(2);
      expect(new Set(values).size, name).toBe(1);
    }
    expect([valuesOf('--mark-from')[0], valuesOf('--mark-to')[0]]).toEqual(stops);
    const css = [
      fs.readFileSync(new URL('../../ui/src/styles/layout.css', import.meta.url), 'utf8'),
      fs.readFileSync(new URL('../../ui/src/styles/components.css', import.meta.url), 'utf8'),
    ].join('\n');
    for (const sel of ['.brand__mark {', '.login__mark {']) {
      const at = css.indexOf(sel);
      expect(at, sel).toBeGreaterThanOrEqual(0);
      const body = css.slice(at, css.indexOf('}', at));
      expect(body, sel).toContain('var(--mark-from)');
      expect(body, sel).toContain('var(--mark-ink)');
      expect(body, sel).not.toContain('--tier-');
      expect(body, sel).not.toContain('--accent');
    }
  });

  it('favicon.ico: PNG を入れた 16・32・48px の ICO', () => {
    const ico = fs.readFileSync(pub('favicon.ico'));
    expect([u16(ico, 0), u16(ico, 2), u16(ico, 4)]).toEqual([0, 1, 3]);
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const e = 6 + 16 * i;
      const len = u32(ico, e + 8);
      const off = u32(ico, e + 12);
      const png = ico.subarray(off, off + len);
      expect(isPng(png)).toBe(true);
      const [w, h] = pngSize(png);
      expect(w).toBe(ico[e]);
      expect(h).toBe(ico[e + 1]);
      sizes.push(w ?? 0);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('apple-touch-icon.png: 180×180 の不透明な PNG（色の種類 2 = RGB）', () => {
    const png = fs.readFileSync(pub('apple-touch-icon.png'));
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual([180, 180]);
    expect(png[25]).toBe(2);
  });

  it('index.html: 同じオリジンのアイコンへの link（SVG・ICO・apple-touch-icon）', () => {
    const html = fs.readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48" \/>/);
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });
});
