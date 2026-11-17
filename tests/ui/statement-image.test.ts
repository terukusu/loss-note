// 画像を送る形に描き直す（Issue #15 AC-2・E2・E3・E12。ui/src/lib/statement-image.ts の prepareImage）。
// vitest には canvas が無いので偽の変換器で回す（実物の Chromium の canvas は npm run ui:check の流れで確かめる）
import { describe, expect, it } from 'vitest';
import {
  imageInfo,
  MAX_BYTES,
  MAX_EDGE,
  SOURCE_MAX_BYTES,
  sourceDims,
} from '../../ui/src/lib/image-limits';
import { prepareImage } from '../../ui/src/lib/statement-image';
import { blobOf, fakeCodec, jpegBytes, pngBytes } from './helpers/statement-rows';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

describe('E2: PNG 3,000 × 1,500・1,200,000 B', () => {
  const src = pngBytes(3000, 1500, 1_200_000);

  it('PNG の段が上限を超える → JPEG 0.92 の段。長辺 2,000（2:1 を保つ）・500,000 B 以下', async () => {
    const codec = fakeCodec((step) => (step.type === 'image/png' ? 800_000 : 350_000));
    const r = await prepareImage(blobOf(src), codec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const info = imageInfo(r.image.bytes);
    expect(info).toEqual({ type: 'image/jpeg', width: 2000, height: 1000 });
    expect(r.image.contentType).toBe('image/jpeg');
    expect(r.image.bytes.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(codec.encodes.map((e) => e.type)).toEqual(['image/png', 'image/jpeg']);
    // 元の画像は描き終えたら閉じる
    expect(codec.closedSources).toBe(1);
  });

  it('PNG の段が上限の内なら PNG のまま', async () => {
    const codec = fakeCodec(() => 300_000);
    const r = await prepareImage(blobOf(src), codec);
    expect(r.ok && imageInfo(r.image.bytes)).toEqual({
      type: 'image/png',
      width: 2000,
      height: 1000,
    });
  });

  it('5 つの段で超え、長辺 1,400 の段で収まる', async () => {
    const codec = fakeCodec((step) => (step.maxEdge === 1400 ? 450_000 : 600_000));
    const r = await prepareImage(blobOf(src), codec);
    expect(r.ok && imageInfo(r.image.bytes)).toEqual({
      type: 'image/jpeg',
      width: 1400,
      height: 700,
    });
  });
});

describe('E3: JPEG 1,200 × 800・300,000 B（上限の内側）', () => {
  it('それでも描き直し、送るバイト列は元と違う（長辺 ≤ 2,000・≤ 500,000 B・PNG か JPEG）', async () => {
    const src = jpegBytes(1200, 800, 300_000);
    const codec = fakeCodec(() => 280_000);
    const r = await prepareImage(blobOf(src, 'image/jpeg'), codec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(codec.encodes).toHaveLength(1);
    expect(sameBytes(r.image.bytes, src)).toBe(false);
    const info = imageInfo(r.image.bytes);
    expect(info?.type === 'image/png' || info?.type === 'image/jpeg').toBe(true);
    expect(Math.max(info?.width ?? 0, info?.height ?? 0)).toBeLessThanOrEqual(MAX_EDGE);
    expect(r.image.bytes.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(codec.previews).toHaveLength(1);
  });
});

describe('送らないもの', () => {
  it('E12: 画像として読めない（文字のファイル・壊れた画像）→ not_image', async () => {
    const codec = fakeCodec(() => 1000);
    const text = new Blob(['架空の文字のファイル'], { type: 'text/plain' });
    expect(await prepareImage(text, codec)).toEqual({ ok: false, error: 'not_image' });
    const broken = pngBytes(10, 10, 100).subarray(0, 10);
    expect(await prepareImage(blobOf(broken), codec)).toEqual({ ok: false, error: 'not_image' });
    expect(await prepareImage(new Blob([]), codec)).toEqual({ ok: false, error: 'not_image' });
    expect(codec.encodes).toEqual([]);
  });

  it('30 MB 超は復号の前に too_large（decode を呼ばない）', async () => {
    const codec = fakeCodec(() => 1000);
    const big = new Blob([new Uint8Array(SOURCE_MAX_BYTES + 1)], { type: 'image/png' });
    expect(await prepareImage(big, codec)).toEqual({ ok: false, error: 'too_large' });
    expect(codec.decoded).toBe(0);
  });

  it('見出しの寸法で 4,000 万画素超も復号の前に too_large', async () => {
    const codec = fakeCodec(() => 1000);
    const r = await prepareImage(blobOf(pngBytes(10000, 5000, 1000)), codec);
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(codec.decoded).toBe(0);
  });

  it('段を下げきっても超える → too_large。元の画像は閉じる', async () => {
    const codec = fakeCodec(() => 600_000);
    const r = await prepareImage(blobOf(pngBytes(1200, 800, 1000)), codec);
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(codec.encodes).toHaveLength(6);
    expect(codec.closedSources).toBe(1);
  });

  it('ブラウザが段の形式で作れなかった・寸法が上限の外のバイト列は使わず、次の段へ', async () => {
    const codec = fakeCodec(() => 1000);
    const real = codec.encode.bind(codec);
    let n = 0;
    codec.encode = async (src, w, h, step) => {
      n++;
      // 1 段目: PNG の段なのに JPEG を返す / 2 段目: 長辺 2,001 / 3 段目から普通
      if (n === 1) return jpegBytes(w, h, 1000);
      if (n === 2) return jpegBytes(2001, h, 1000);
      return real(src, w, h, step);
    };
    const r = await prepareImage(blobOf(pngBytes(1200, 800, 1000)), codec);
    expect(r.ok && r.image.contentType).toBe('image/jpeg');
    expect(n).toBe(3);
  });
});

describe('読めない形式・画素数の守り（レビュー指摘 7）', () => {
  /** WebP（VP8X）の見出し: 幅 w・高さ h */
  function webp(w: number, h: number): Uint8Array {
    const b = new Uint8Array(64);
    b.set(new TextEncoder().encode('RIFF'), 0);
    b.set(new TextEncoder().encode('WEBPVP8X'), 8);
    const put24 = (i: number, v: number) => b.set([v & 255, (v >> 8) & 255, (v >> 16) & 255], i);
    put24(24, w - 1);
    put24(27, h - 1);
    return b;
  }
  function gif(w: number, h: number): Uint8Array {
    const b = new Uint8Array(32);
    b.set(new TextEncoder().encode('GIF89a'), 0);
    b.set([w & 255, w >> 8, h & 255, h >> 8], 6);
    return b;
  }

  it('WebP・GIF も見出しの寸法で 4,000 万画素超を復号の前に断る', async () => {
    const codec = fakeCodec(() => 1000);
    expect(sourceDims(webp(10000, 5000))).toEqual({ width: 10000, height: 5000 });
    expect(sourceDims(gif(300, 200))).toEqual({ width: 300, height: 200 });
    expect(await prepareImage(blobOf(webp(10000, 5000), 'image/webp'), codec)).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(await prepareImage(blobOf(gif(65000, 65000), 'image/gif'), codec)).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(codec.decoded).toBe(0);
  });

  it('見出しで寸法が読めない形式も、復号の後に画素数で断る（描き直さない）', async () => {
    const codec = fakeCodec(() => 1000);
    codec.decode = async () => ({ width: 10000, height: 4001, close() {} });
    const heic = new Blob([new Uint8Array(100)], { type: 'image/heic' });
    expect(await prepareImage(heic, codec)).toEqual({ ok: false, error: 'too_large' });
    expect(codec.encodes).toEqual([]);
  });

  it('画像と名乗るが復号できない形式（HEIC など）→ unsupported（「この画像は読み取れません」）。壊れた PNG は not_image', async () => {
    const codec = fakeCodec(() => 1000);
    const heic = new Blob([new Uint8Array(100)], { type: 'image/heic' });
    expect(await prepareImage(heic, codec)).toEqual({ ok: false, error: 'unsupported' });
    const broken = pngBytes(10, 10, 100).subarray(0, 10);
    expect(await prepareImage(blobOf(broken), codec)).toEqual({ ok: false, error: 'not_image' });
  });
});

describe('PNG と名乗るが中身が文字のファイル', () => {
  it('not_image（「画像を読み込めませんでした」。E12）', async () => {
    const codec = fakeCodec(() => 1000);
    const fake = new Blob(['架空の文字'], { type: 'image/png' });
    expect(await prepareImage(fake, codec)).toEqual({ ok: false, error: 'not_image' });
  });
});
