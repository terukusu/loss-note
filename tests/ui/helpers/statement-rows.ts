// Issue #15 の例の表（E1〜E13）の読み取りの応答の行と、偽の画像・変換器。値はすべて架空（実際の明細を写さない）。
// 行の形は API の応答（packages/statement-read/src/statement_read/normalize.py の normalize_row）のうち画面が使う 13 の鍵
// （損益・手数料の合計は明細の通貨のまま pnl・feesTotal と通貨 pnlCurrency。#66）
import type { ImageType } from '../../../ui/src/lib/image-limits';
import type { ReadRow, ReadTime } from '../../../ui/src/lib/statement-fill';
import type {
  Codec,
  DecodedImage,
  PreparedImage,
  PreviewHandle,
} from '../../../ui/src/lib/statement-image';

/** 日本時間の時刻（書かれた値・JST・epoch） */
export function jst(y: number, mo: number, d: number, h: number, mi: number): ReadTime {
  const p = (n: number) => String(n).padStart(2, '0');
  const written = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
  return {
    written,
    timeZone: 'JST',
    jst: written,
    epochMs: Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600 * 1000,
  };
}

/** 時間帯が明細に無い時刻（書かれた値だけ） */
export function unknownTz(written: string): ReadTime {
  return { written, timeZone: 'unknown', jst: null, epochMs: null };
}

/** E1: 架空指数A・L・イン 100.0・決済 99.0・数量 2・損益 −2,000 円・手数料 [100, 50]・注文の種類 不明 */
export const ROW_E1: ReadRow = {
  symbol: '架空指数A',
  side: 'L',
  entryPrice: 100,
  exitPrice: 99,
  quantity: 2,
  pnl: -2000,
  pnlCurrency: 'JPY',
  entryTime: jst(2026, 11, 10, 9, 5),
  exitTime: jst(2026, 11, 10, 10, 30),
  timeZoneNeedsCheck: false,
  fees: [100, 50],
  feesTotal: 150,
  exitOrderType: 'unknown',
};

/** E1 の決済の時刻・建てた時刻（epoch） */
export const E1_EXIT_MS = Date.UTC(2026, 10, 10, 1, 30);
export const E1_ENTRY_MS = Date.UTC(2026, 10, 10, 0, 5);

/** E4: 銘柄・決済の時刻が空 */
export const ROW_E4: ReadRow = { ...ROW_E1, symbol: null, exitTime: null };
/** E7: 逆指値 */
export const ROW_E7: ReadRow = { ...ROW_E1, exitOrderType: 'stop' };
/** E8: 成行 */
export const ROW_E8: ReadRow = { ...ROW_E1, exitOrderType: 'market' };
/** E9: 決済の時刻の時間帯が不明（建てた時刻は無し） */
export const ROW_E9: ReadRow = {
  ...ROW_E1,
  entryTime: null,
  exitTime: unknownTz('2026-11-10T10:30'),
  timeZoneNeedsCheck: true,
};
/** E10: 3 行（行 2 は S・架空指数C、行 3 は架空指数D） */
export const ROWS_E10: readonly ReadRow[] = [
  ROW_E1,
  {
    ...ROW_E1,
    symbol: '架空指数C',
    side: 'S',
    entryPrice: 200,
    exitPrice: 201.5,
    quantity: 1,
    pnl: -1500,
    fees: null,
    feesTotal: null,
  },
  { ...ROW_E1, symbol: '架空指数D', entryPrice: 50, exitPrice: 51, quantity: 3, pnl: 3000 },
];

export const statementBody = (rows: readonly unknown[], extra: object = {}) => ({
  kind: 'statement',
  rows,
  ...extra,
});

// ── 偽の画像（見出しだけ本物の形。中身は埋め草） ──

/** PNG の見出し（署名 + IHDR）+ 埋め草で size バイト */
export function pngBytes(w: number, h: number, size: number, fill = 0): Uint8Array {
  const b = new Uint8Array(Math.max(size, 33)).fill(fill);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

/** JPEG の見出し（SOI + SOF0）+ 埋め草で size バイト */
export function jpegBytes(w: number, h: number, size: number, fill = 0): Uint8Array {
  const b = new Uint8Array(Math.max(size, 21)).fill(fill);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  const v = new DataView(b.buffer);
  v.setUint16(7, h);
  v.setUint16(9, w);
  return b;
}

export const blobOf = (bytes: Uint8Array, type = 'image/png') =>
  new Blob([bytes as BlobPart], { type });

export interface FakePreview extends PreviewHandle {
  readonly closed: () => boolean;
}

export function fakePreview(width = 10, height = 10): FakePreview {
  let closed = false;
  return {
    width,
    height,
    draw() {},
    close() {
      closed = true;
    },
    closed: () => closed,
  };
}

export interface FakeCodec extends Codec {
  readonly decoded: number;
  readonly closedSources: number;
  readonly previews: FakePreview[];
  readonly encodes: { w: number; h: number; type: ImageType; quality?: number }[];
}

/**
 * 偽の変換器。decode は見出しの寸法を読む（読めなければ投げる = 画像として読めない）。encode は段ごとの大きさ
 * （sizeOf）の偽の PNG / JPEG を返す（埋め草は 0x5a で、元のバイト列と違う）
 */
export function fakeCodec(
  sizeOf: (
    step: { type: ImageType; quality?: number; maxEdge?: number },
    w: number,
    h: number,
  ) => number,
): FakeCodec {
  const state = {
    decoded: 0,
    closedSources: 0,
    previews: [] as FakePreview[],
    encodes: [] as { w: number; h: number; type: ImageType; quality?: number }[],
  };
  return {
    get decoded() {
      return state.decoded;
    },
    get closedSources() {
      return state.closedSources;
    },
    previews: state.previews,
    encodes: state.encodes,
    async decode(file: Blob): Promise<DecodedImage> {
      state.decoded++;
      const b = new Uint8Array(await file.arrayBuffer());
      const dims =
        b[0] === 0x89 && b.length >= 24
          ? { w: new DataView(b.buffer).getUint32(16), h: new DataView(b.buffer).getUint32(20) }
          : b[0] === 0xff && b[1] === 0xd8 && b.length >= 11
            ? { w: new DataView(b.buffer).getUint16(9), h: new DataView(b.buffer).getUint16(7) }
            : null;
      if (!dims) throw new Error('画像ではない（偽物）');
      return {
        width: dims.w,
        height: dims.h,
        close() {
          state.closedSources++;
        },
      };
    },
    async encode(_src, w, h, step) {
      state.encodes.push({
        w,
        h,
        type: step.type,
        ...(step.quality === undefined ? {} : { quality: step.quality }),
      });
      const size = sizeOf(step, w, h);
      return step.type === 'image/png' ? pngBytes(w, h, size, 0x5a) : jpegBytes(w, h, size, 0x5a);
    },
    async preview(_bytes, _type) {
      const p = fakePreview();
      state.previews.push(p);
      return p;
    },
  };
}

/** 描き直し済みの画像（controller のテストで prepare の代わりに返す） */
export function preparedImage(preview: PreviewHandle = fakePreview()): PreparedImage {
  return {
    bytes: pngBytes(1200, 800, 4096, 0x5a),
    contentType: 'image/png',
    width: 1200,
    height: 800,
    preview,
  };
}
