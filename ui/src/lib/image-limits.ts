// 決済明細の画像を送る前の上限と、描き直しの段の規則（Issue #15。純関数。DOM・通信に触れない）。
// 上限は読み取りの API と同じ（packages/statement-read/src/statement_read/image.py の MAX_EDGE・MAX_BYTES。ADR-0005 の
// 決定 5）。画像は端末で canvas に描き直して PNG / JPEG に作り直す（メタデータを落とす）。canvas に触るのは
// statement-image.ts だけ。option-simulator の ui/view/imageScale.ts（ADR-0009）に倣う

/** 長辺の上限（px。API の MAX_EDGE） */
export const MAX_EDGE = 2000;
/** 送るバイト数の上限（API の MAX_BYTES） */
export const MAX_BYTES = 500_000;
/** 選んだファイルの大きさの上限（復号する前に断る。端末のメモリを守る） */
export const SOURCE_MAX_BYTES = 30_000_000;
/** 選んだ画像の画素数の上限（復号する前に見出しの寸法で断る） */
export const SOURCE_MAX_PIXELS = 40_000_000;

export type ImageType = 'image/png' | 'image/jpeg';

export interface ImageInfo {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

/** 長辺を max 以下に縮めた寸法（縦横比を保つ。短辺は四捨五入で 1 以上）。w・h は正の整数でなければ投げる */
export function fitLongEdge(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) {
    throw new Error('寸法は正の整数');
  }
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const s = max / long;
  return w >= h
    ? { w: max, h: Math.max(1, Math.round(h * s)) }
    : { w: Math.max(1, Math.round(w * s)), h: max };
}

export interface EncodeStep {
  readonly type: ImageType;
  /** JPEG の品質（0〜1） */
  readonly quality?: number;
  /** この段だけ長辺をさらに縮める（px） */
  readonly maxEdge?: number;
}

/** 試す段: PNG（文字の画面は小さく、にじまない）→ JPEG 0.92 → 0.85 → 0.75 → 0.65 → 長辺 1,400 px の JPEG 0.75 */
export const ENCODE_STEPS: readonly EncodeStep[] = [
  { type: 'image/png' },
  { type: 'image/jpeg', quality: 0.92 },
  { type: 'image/jpeg', quality: 0.85 },
  { type: 'image/jpeg', quality: 0.75 },
  { type: 'image/jpeg', quality: 0.65 },
  { type: 'image/jpeg', quality: 0.75, maxEdge: 1400 },
];

/** 段ごとのバイト数から使う段の番号（最初に 0 < n ≤ max の段。どれも超えたら null = 送らない） */
export function pickStep(sizes: readonly number[], max = MAX_BYTES): number | null {
  const i = sizes.findIndex((n) => n > 0 && n <= max);
  return i < 0 ? null : i;
}

const u16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32 = (b: Uint8Array, i: number) => u16(b, i) * 0x10000 + u16(b, i + 2);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  return sig.every((x, i) => b[at + i] === x);
}

/** 長さを持たない JPEG の marker（TEM・RST0〜7・SOI） */
function standalone(m: number): boolean {
  return m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7);
}

/** JPEG の SOF（寸法を持つ）。C4 = DHT・C8 = JPG・CC = DAC は SOF ではない */
function isSof(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

function jpegInfo(b: Uint8Array): ImageInfo | null {
  let i = 2;
  const n = b.length;
  while (i < n) {
    if (b[i] !== 0xff) return null;
    while (i < n && b[i] === 0xff) i++; // 詰め物の FF を飛ばす
    if (i >= n) return null;
    const marker = b[i] ?? 0;
    i++;
    if (standalone(marker)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // SOF より前に EOI・SOS
    if (i + 2 > n) return null;
    const length = u16(b, i);
    if (length < 2 || i + length > n) return null;
    if (isSof(marker)) {
      if (length < 7) return null;
      return { type: 'image/jpeg', width: u16(b, i + 5), height: u16(b, i + 3) };
    }
    i += length;
  }
  return null;
}

/**
 * バイト列の形式と寸法（PNG の IHDR・JPEG の SOF）。画素は復号しない。読めなければ null（投げない）。
 * API の image.py の image_info と同じ規則
 */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (startsWith(b, PNG_SIG)) {
    if (b.length < 24 || !startsWith(b, IHDR, 8)) return null;
    return { type: 'image/png', width: u32(b, 16), height: u32(b, 20) };
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) return jpegInfo(b);
  return null;
}

/**
 * 送ってよいバイト列か（API の check_limits が通すものだけ）: 1〜MAX_BYTES B・形式が type と同じ・寸法が読めて
 * 幅と高さが 1 以上・長辺が MAX_EDGE 以下。境目（ちょうど）は通す
 */
export function withinLimits(bytes: Uint8Array, type: ImageType): boolean {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return false;
  const info = imageInfo(bytes);
  if (!info || info.type !== type) return false;
  return info.width > 0 && info.height > 0 && Math.max(info.width, info.height) <= MAX_EDGE;
}

const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const tag = (b: Uint8Array, i: number) => String.fromCharCode(...b.subarray(i, i + 4));

/**
 * 選んだ画像の見出しの寸法（PNG・JPEG に加えて WebP の VP8 / VP8L / VP8X・GIF の論理画面）。画素は復号しない。
 * 読めなければ null（HEIC などは大きさの上限と、復号の後の画素数の検査で守る）
 */
export function sourceDims(b: Uint8Array): { width: number; height: number } | null {
  const info = imageInfo(b);
  if (info) return { width: info.width, height: info.height };
  if (b.length >= 10 && tag(b, 0) === 'GIF8') return { width: u16le(b, 6), height: u16le(b, 8) };
  if (b.length >= 30 && tag(b, 0) === 'RIFF' && tag(b, 8) === 'WEBP') {
    const kind = tag(b, 12);
    if (kind === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (kind === 'VP8L' && b[20] === 0x2f) {
      const v =
        ((b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)) >>> 0;
      return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

/** 画素数が上限を超えるか */
export function tooManyPixels(width: number, height: number): boolean {
  return width * height > SOURCE_MAX_PIXELS;
}

/** 復号する前に断るか（ファイルの大きさ・見出しの寸法の画素数が上限を超える）。寸法が読めなければ大きさだけ */
export function tooBigToDecode(size: number, head: Uint8Array): boolean {
  if (size > SOURCE_MAX_BYTES) return true;
  const d = sourceDims(head);
  return d !== null && tooManyPixels(d.width, d.height);
}

/** PNG・JPEG の署名か（壊れた PNG / JPEG と、読めない形式の画像を見分ける） */
export function isPngOrJpeg(head: Uint8Array): boolean {
  return startsWith(head, PNG_SIG) || startsWith(head, [0xff, 0xd8, 0xff]);
}
