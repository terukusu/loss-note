// 決済明細の画像を送る形に描き直す薄い層（Issue #15。設計書 7.5「画像の扱い」・ADR-0005 の決定 5）。
// canvas・createImageBitmap に触れるのはこのファイルの browserCodec だけ。規則（上限・段・寸法の読み取り）は
// image-limits.ts の純関数。変換器 Codec を差し込める形にして、テストは偽の変換器で回す（vitest には canvas が無い）。
// - 上限の内側の画像でも必ず描き直す（メタデータを落とす）。透明は白の上に描く
// - 作ったバイト列を送る前に imageInfo で確かめ、形式・寸法・バイト数が上限の外なら使わない（ブラウザの差の守り）
// - プレビューは送るものと同じバイト列を canvas に描く。object URL・data URL を作らない（CSP の img-src を広げない）
// - 画像は記憶の中だけ（端末の保存先に書かない）。元の画像は描き終えたら閉じ、プレビューは使い終わったら close する
import {
  ENCODE_STEPS,
  type EncodeStep,
  fitLongEdge,
  type ImageType,
  imageInfo,
  isPngOrJpeg,
  tooBigToDecode,
  tooManyPixels,
  withinLimits,
} from './image-limits';

/** 復号した元の画像（描き終えたら close） */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** 送るものと同じ画像のプレビュー（不透明な handle。DOM の canvas に描くだけ） */
export interface PreviewHandle {
  readonly width: number;
  readonly height: number;
  /** canvas に描く（同じ要素には 1 回だけ描く） */
  draw(canvas: HTMLCanvasElement): void;
  close(): void;
}

/** 復号・描き直し・プレビューの変換器 */
export interface Codec {
  /** 画像として読めなければ投げる */
  decode(file: Blob): Promise<DecodedImage>;
  /** src を w × h に白の上で描き、段の形式で作ったバイト列（作れなければ null） */
  encode(src: DecodedImage, w: number, h: number, step: EncodeStep): Promise<Uint8Array | null>;
  preview(bytes: Uint8Array, type: ImageType): Promise<PreviewHandle>;
}

export interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly contentType: ImageType;
  readonly width: number;
  readonly height: number;
  readonly preview: PreviewHandle;
}

/**
 * not_image = 画像として読めない（文字のファイル・壊れた PNG / JPEG）/ too_large = 大きすぎる /
 * unsupported = 画像だがこの端末で復号できない形式（HEIC など）
 */
export type PrepareError = 'not_image' | 'too_large' | 'unsupported';
export type PrepareResult =
  | { readonly ok: true; readonly image: PreparedImage }
  | { readonly ok: false; readonly error: PrepareError };

/** 見出しとして読む先頭のバイト数 */
const HEAD_BYTES = 65_536;

/**
 * 選んだ・貼った画像を送る形に作り直す。画像として読めない → not_image、大きすぎて復号の前に断った・
 * 段を下げきっても上限を超えた → too_large
 */
export async function prepareImage(file: Blob, codec: Codec): Promise<PrepareResult> {
  if (file.size === 0) return { ok: false, error: 'not_image' };
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  } catch {
    return { ok: false, error: 'not_image' };
  }
  if (tooBigToDecode(file.size, head)) return { ok: false, error: 'too_large' };
  let src: DecodedImage;
  try {
    src = await codec.decode(file);
  } catch {
    // PNG / JPEG 以外の画像と名乗るファイル（HEIC など）が復号できなければ、読めない形式として断る。
    // PNG / JPEG と名乗る・署名を持つのに復号できないもの、画像と名乗らないものは「画像を読み込めませんでした」
    const otherImage =
      file.type.startsWith('image/') && !['image/png', 'image/jpeg'].includes(file.type);
    const claimsImage = otherImage && !isPngOrJpeg(head);
    return { ok: false, error: claimsImage ? 'unsupported' : 'not_image' };
  }
  try {
    if (!(Number.isInteger(src.width) && Number.isInteger(src.height))) {
      return { ok: false, error: 'not_image' };
    }
    if (!(src.width > 0 && src.height > 0)) return { ok: false, error: 'not_image' };
    // 見出しで寸法が読めない形式も、描き直しの canvas を作る前に画素数で断る
    if (tooManyPixels(src.width, src.height)) return { ok: false, error: 'too_large' };
    for (const step of ENCODE_STEPS) {
      const { w, h } = fitLongEdge(src.width, src.height, step.maxEdge);
      let bytes: Uint8Array | null;
      try {
        bytes = await codec.encode(src, w, h, step);
      } catch {
        bytes = null;
      }
      if (!bytes || !withinLimits(bytes, step.type)) continue;
      const info = imageInfo(bytes);
      if (!info) continue;
      const preview = await codec.preview(bytes, step.type);
      return {
        ok: true,
        image: {
          bytes,
          contentType: step.type,
          width: info.width,
          height: info.height,
          preview,
        },
      };
    }
    return { ok: false, error: 'too_large' };
  } catch {
    return { ok: false, error: 'not_image' };
  } finally {
    src.close();
  }
}

// ── ブラウザの変換器（ここから下だけが DOM・canvas に触れる。ui:check が実物の Chromium で確かめる） ──

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas: AnyCanvas, step: EncodeStep): Promise<Blob | null> {
  const opts =
    step.quality === undefined ? { type: step.type } : { type: step.type, quality: step.quality };
  if ('convertToBlob' in canvas) return canvas.convertToBlob(opts).catch(() => null);
  return new Promise((ok) => canvas.toBlob((b) => ok(b), step.type, step.quality));
}

interface BitmapImage extends DecodedImage {
  readonly bitmap: ImageBitmap;
}

export const browserCodec: Codec = {
  async decode(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const img: BitmapImage = {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
    return img;
  },
  async encode(src, w, h, step) {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d') as Ctx2d | null;
    if (!ctx) return null;
    // JPEG は透明を持たないので白の上に描く（透明の PNG が黒くならない。PNG も同じ見え方に）
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage((src as BitmapImage).bitmap, 0, 0, w, h);
    const blob = await toBlob(canvas, step);
    // ブラウザが段の形式で作れなかった（PNG で返した）ものは使わない
    if (!blob || blob.type !== step.type) return null;
    return new Uint8Array(await blob.arrayBuffer());
  },
  async preview(bytes, type) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const drawn = new WeakSet<HTMLCanvasElement>();
    let closed = false;
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(canvas) {
        if (closed || drawn.has(canvas)) return;
        drawn.add(canvas);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      },
      close() {
        if (closed) return;
        closed = true;
        bitmap.close();
      },
    };
  },
};
