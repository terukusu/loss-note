import { describe, expect, it } from 'vitest';

/**
 * 同梱の数字の書体（#237・設計書 C63・ADR-0026）のファイルの検査。woff2 の表の目録を読み、1 つの brotli の流れを
 * Node の zlib で開いて、cmap（入っている文字）・fvar（軸）・GSUB（機能）・name（ライセンスの表示）を読む。
 * 読むのは変形の無い表だけ（cmap・fvar・GSUB・name は woff2 で変形しない）。
 * @types/node を足さないため、Node の組み込みは型をここで最小限に書く（cssTokens.test.ts と同じ形）
 */
interface Bytes {
  readonly length: number;
  readonly [i: number]: number;
  subarray(start: number, end?: number): Bytes;
  toString(enc: 'latin1' | 'utf8'): string;
}
const proc = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(p: URL): Bytes };
      getBuiltinModule(id: 'node:zlib'): { brotliDecompressSync(b: Bytes): Bytes };
    };
  }
).process;
const fs = proc.getBuiltinModule('node:fs');
const zlib = proc.getBuiltinModule('node:zlib');

const FONT = new URL('../../ui/src/assets/fonts/inter-num.woff2', import.meta.url);
const LICENSE = new URL('../../ui/src/assets/fonts/LICENSE-OFL.txt', import.meta.url);

/** woff2 の表の目録の決まった並び（仕様 5.1 の Known Table Tags。添字 0〜62） */
const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT ' +
  'VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar ' +
  'fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
)
  .match(/.{4}\s?/g)
  ?.map((t) => t.slice(0, 4)) as string[];

const u16 = (b: Bytes, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32 = (b: Bytes, o: number) => u16(b, o) * 65536 + u16(b, o + 2);
const fixed = (b: Bytes, o: number) => {
  const v = u32(b, o);
  return (v >= 0x80000000 ? v - 0x100000000 : v) / 65536;
};
const tag = (b: Bytes, o: number) => b.subarray(o, o + 4).toString('latin1');

/** woff2 → 表の名前 → 中身（変形の無い表だけ正しい） */
function readWoff2(file: Bytes): { signature: string; tables: Map<string, Bytes> } {
  const signature = tag(file, 0);
  const numTables = u16(file, 12);
  const compressed = u32(file, 20);
  let o = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = file[o++] ?? 0;
      v = v * 128 + (c & 0x7f);
      if ((c & 0x80) === 0) return v;
    }
    throw new Error('UIntBase128 が長すぎる');
  };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[o++] ?? 0;
    let t = KNOWN_TAGS[flags & 0x3f] ?? '';
    if ((flags & 0x3f) === 63) {
      t = tag(file, o);
      o += 4;
    }
    const version = (flags >> 6) & 3;
    const orig = base128();
    const transformed = t === 'glyf' || t === 'loca' ? version === 0 : version !== 0;
    const length = transformed ? base128() : orig;
    dir.push({ tag: t, length });
  }
  const data = zlib.brotliDecompressSync(file.subarray(o, o + compressed));
  const tables = new Map<string, Bytes>();
  let at = 0;
  for (const d of dir) {
    tables.set(d.tag, data.subarray(at, at + d.length));
    at += d.length;
  }
  return { signature, tables };
}

/** cmap の Unicode の部分表（形式 4 か 12）から文字の集合 */
function codepoints(cmap: Bytes): Set<number> {
  const out = new Set<number>();
  const n = u16(cmap, 2);
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8;
    const platform = u16(cmap, rec);
    const encoding = u16(cmap, rec + 2);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const s = u32(cmap, rec + 4);
    const format = u16(cmap, s);
    if (format === 4) {
      const segs = u16(cmap, s + 6) / 2;
      const ends = s + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const ranges = deltas + segs * 2;
      for (let k = 0; k < segs; k++) {
        const end = u16(cmap, ends + k * 2);
        const start = u16(cmap, starts + k * 2);
        const delta = u16(cmap, deltas + k * 2);
        const rangeAt = ranges + k * 2;
        const range = u16(cmap, rangeAt);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const gid =
            range === 0
              ? (c + delta) & 0xffff
              : u16(cmap, rangeAt + range + (c - start) * 2) === 0
                ? 0
                : (u16(cmap, rangeAt + range + (c - start) * 2) + delta) & 0xffff;
          if (gid !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = u32(cmap, s + 12);
      for (let g = 0; g < groups; g++) {
        const at = s + 16 + g * 12;
        for (let c = u32(cmap, at); c <= u32(cmap, at + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

function axes(fvar: Bytes): Record<string, [number, number]> {
  const offset = u16(fvar, 4);
  const count = u16(fvar, 8);
  const size = u16(fvar, 10);
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < count; i++) {
    const at = offset + i * size;
    out[tag(fvar, at)] = [fixed(fvar, at + 4), fixed(fvar, at + 12)];
  }
  return out;
}

function features(gsub: Bytes): Set<string> {
  const list = u16(gsub, 6);
  const n = u16(gsub, list);
  const out = new Set<string>();
  for (let i = 0; i < n; i++) out.add(tag(gsub, list + 2 + i * 6));
  return out;
}

/** name の表の Windows（3）の記録: nameID → 文字 */
function names(name: Bytes): Map<number, string> {
  const count = u16(name, 2);
  const strings = u16(name, 4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (u16(name, r) !== 3) continue;
    const id = u16(name, r + 6);
    const len = u16(name, r + 8);
    const off = strings + u16(name, r + 10);
    let s = '';
    for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16(name, off + k));
    out.set(id, s);
  }
  return out;
}

/** ルール 1 の文字（#237 の本文「ルールと例」）: 数字・符号・空白・英大文字と、× … – — → − ± · */
const WANT = [
  ...' %+,-./0123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '±',
  '·',
  '×',
  '–',
  '—',
  '…',
  '→',
  '−',
]
  .map((c) => c.codePointAt(0) as number)
  .sort((a, b) => a - b);

describe('同梱の数字の書体（#237）', () => {
  const file = fs.readFileSync(FONT);
  const font = readWoff2(file);

  it('AC-2: woff2 で 20,480 バイト以下', () => {
    expect(font.signature).toBe('wOF2');
    expect(file.length).toBeLessThanOrEqual(20_480);
  });

  it('AC-2: 入っている文字がルール 1 の集合と一致する（U+2212 の負の符号・± を含む。日本語・円は入れない）', () => {
    const cmap = font.tables.get('cmap');
    expect(cmap).toBeDefined();
    const got = [...codepoints(cmap as Bytes)].sort((a, b) => a - b);
    expect(got.map((c) => c.toString(16))).toEqual(WANT.map((c) => c.toString(16)));
  });

  it('AC-2: 可変の軸は太さ 400〜700・opsz 14〜32', () => {
    expect(axes(font.tables.get('fvar') as Bytes)).toEqual({ opsz: [14, 32], wght: [400, 700] });
  });

  it('AC-2: 桁揃えの機能（tnum）を持つ', () => {
    expect(features(font.tables.get('GSUB') as Bytes).has('tnum')).toBe(true);
  });

  it('AC-7: 書体のファイル自身に著作権とライセンスの表示（名前の表の 0・13・14）が残る', () => {
    const n = names(font.tables.get('name') as Bytes);
    expect(n.get(0)).toContain('The Inter Project Authors');
    expect(n.get(13)).toContain('SIL Open Font License, Version 1.1');
    expect(n.get(14)).toMatch(/scripts\.sil\.org\/OFL/);
  });

  it('AC-7: 書体の隣に SIL OFL 1.1 の全文と著作権の表示がある', () => {
    const text = fs.readFileSync(LICENSE).toString('utf8');
    expect(text.split('\n')[0]).toContain('Copyright (c) 2016 The Inter Project Authors');
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
    // 全文の最後の節まである
    expect(text).toContain('OTHER DEALINGS IN THE FONT SOFTWARE.');
  });
});
