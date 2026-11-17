// 画像の上限と描き直しの段の純関数（Issue #15 AC-2。ui/src/lib/image-limits.ts）。画像は合成の見出しだけ
import { describe, expect, it } from 'vitest';
import {
  ENCODE_STEPS,
  fitLongEdge,
  imageInfo,
  MAX_BYTES,
  MAX_EDGE,
  pickStep,
  SOURCE_MAX_BYTES,
  tooBigToDecode,
  withinLimits,
} from '../../ui/src/lib/image-limits';
import { jpegBytes, pngBytes } from './helpers/statement-rows';

const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(p: URL, enc: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');

/** 種つきの乱数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('API の上限と同じ', () => {
  it('image.py の MAX_EDGE・MAX_BYTES と一致する', () => {
    const py = fs.readFileSync(
      new URL('../../packages/statement-read/src/statement_read/image.py', import.meta.url),
      'utf8',
    );
    expect(Number(/^MAX_EDGE = (\d+)/m.exec(py)?.[1])).toBe(MAX_EDGE);
    expect(Number(/^MAX_BYTES = ([\d_]+)/m.exec(py)?.[1]?.replace(/_/g, ''))).toBe(MAX_BYTES);
  });
});

describe('fitLongEdge', () => {
  it.each([
    [3000, 1500, 2000, 1000],
    [1500, 3000, 1000, 2000],
    [2000, 1000, 2000, 1000],
    [1200, 800, 1200, 800],
    [10000, 1, 2000, 1],
  ])('%i×%i → %i×%i', (w, h, ew, eh) => {
    expect(fitLongEdge(w, h)).toEqual({ w: ew, h: eh });
  });

  it('段の長辺（1,400）でも縮める', () => {
    expect(fitLongEdge(3000, 1500, 1400)).toEqual({ w: 1400, h: 700 });
  });

  it('正の整数でなければ投げる', () => {
    for (const [w, h] of [
      [0, 10],
      [10, -1],
      [1.5, 10],
      [Number.NaN, 10],
    ] as const) {
      expect(() => fitLongEdge(w, h)).toThrow();
    }
  });

  it('性質: 長辺 ≤ 2,000・縦横比の誤差は 1 px 以内・短辺 ≥ 1（種つき乱数 2,000 件）', () => {
    const r = rng(15);
    for (let i = 0; i < 2000; i++) {
      const w = 1 + Math.floor(r() * 12000);
      const h = 1 + Math.floor(r() * 12000);
      const f = fitLongEdge(w, h);
      expect(Math.max(f.w, f.h)).toBeLessThanOrEqual(MAX_EDGE);
      expect(Math.min(f.w, f.h)).toBeGreaterThanOrEqual(1);
      if (Math.max(w, h) <= MAX_EDGE) expect(f).toEqual({ w, h });
      else if (w >= h) expect(Math.abs(f.h - (h * f.w) / w)).toBeLessThanOrEqual(1);
      else expect(Math.abs(f.w - (w * f.h) / h)).toBeLessThanOrEqual(1);
    }
  });
});

describe('段（ENCODE_STEPS・pickStep）', () => {
  it('PNG → JPEG 0.92 → 0.85 → 0.75 → 0.65 → 長辺 1,400 の JPEG 0.75', () => {
    expect(ENCODE_STEPS).toEqual([
      { type: 'image/png' },
      { type: 'image/jpeg', quality: 0.92 },
      { type: 'image/jpeg', quality: 0.85 },
      { type: 'image/jpeg', quality: 0.75 },
      { type: 'image/jpeg', quality: 0.65 },
      { type: 'image/jpeg', quality: 0.75, maxEdge: 1400 },
    ]);
  });

  it('最初に 0 < n ≤ 500,000 の段。ちょうど 500,000 は通す。どれも超えれば null', () => {
    expect(pickStep([800_000, 500_000, 1])).toBe(1);
    expect(pickStep([0, 400_000])).toBe(1);
    expect(pickStep([500_001, 600_000])).toBeNull();
    expect(pickStep([])).toBeNull();
  });
});

describe('imageInfo（image.py の image_info と同じ規則）', () => {
  it('合成の PNG・JPEG の見出しから形式と寸法', () => {
    expect(imageInfo(pngBytes(3000, 1500, 100))).toEqual({
      type: 'image/png',
      width: 3000,
      height: 1500,
    });
    expect(imageInfo(jpegBytes(1200, 800, 100))).toEqual({
      type: 'image/jpeg',
      width: 1200,
      height: 800,
    });
  });

  it('SOF の前の APP0・詰め物の FF を飛ばす', () => {
    const app0 = [0xff, 0xd8, 0xff, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const sof = [
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(imageInfo(new Uint8Array([...app0, ...sof]))).toEqual({
      type: 'image/jpeg',
      width: 512,
      height: 256,
    });
  });

  it('切れたバイト列・ほかの形式・SOF の前の SOS は null（投げない）', () => {
    expect(imageInfo(pngBytes(10, 10, 100).subarray(0, 20))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]))).toBeNull();
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 0x11]))).toBeNull();
    expect(imageInfo(new TextEncoder().encode('GIF89a......................'))).toBeNull();
    expect(imageInfo(new Uint8Array())).toBeNull();
    // IHDR でない PNG
    const bad = pngBytes(10, 10, 40);
    bad[12] = 0x58;
    expect(imageInfo(bad)).toBeNull();
  });
});

describe('withinLimits（API の check_limits が通すもの）', () => {
  it('境目（500,000 B・長辺 2,000）は通す', () => {
    expect(withinLimits(pngBytes(2000, 1000, 500_000), 'image/png')).toBe(true);
    expect(withinLimits(jpegBytes(1000, 2000, 500_000), 'image/jpeg')).toBe(true);
  });

  it('超える・形式の違い・寸法 0・空は通さない', () => {
    expect(withinLimits(pngBytes(2000, 1000, 500_001), 'image/png')).toBe(false);
    expect(withinLimits(pngBytes(2001, 1000, 1000), 'image/png')).toBe(false);
    expect(withinLimits(pngBytes(10, 10, 1000), 'image/jpeg')).toBe(false);
    expect(withinLimits(pngBytes(0, 10, 1000), 'image/png')).toBe(false);
    expect(withinLimits(new Uint8Array(), 'image/png')).toBe(false);
  });
});

describe('tooBigToDecode', () => {
  it('30 MB 超・見出しで 4,000 万画素超は断る。読めない見出しは大きさだけで見る', () => {
    expect(tooBigToDecode(SOURCE_MAX_BYTES + 1, new Uint8Array())).toBe(true);
    expect(tooBigToDecode(1000, pngBytes(8000, 5001, 100))).toBe(true);
    expect(tooBigToDecode(1000, pngBytes(8000, 5000, 100))).toBe(false);
    expect(tooBigToDecode(SOURCE_MAX_BYTES, new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
