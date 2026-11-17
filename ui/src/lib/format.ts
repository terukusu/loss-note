// R・円の数字の表示（Issue #3 R3・契約 C-1。設計書 6.3・C29）。色は付けず、符号と単位で読ませる。
// 丸めは 0 から遠い側（四捨五入）。2 進の誤差（1.15 × 10 = 11.4999…）で 0 に近い側へ落ちないよう、
// 小さな寄せ（1e-9）を足してから丸める（|R| < 1e6 の範囲で安全）。丸めて 0 になっても元の符号を残す

const MINUS = '−';

/** 元の値の符号の文字（正 = +、負 = −（U+2212）、ちょうど 0 と −0 = ±） */
function signOf(x: number): string {
  if (x > 0) return '+';
  if (x < 0) return MINUS;
  return '±';
}

/** 0 から遠い側へ丸めた整数（abs × scale） */
function roundAway(abs: number, scale: number): number {
  return Math.round(abs * scale + 1e-9);
}

/** 3 桁ごとにカンマで区切る（整数の文字列） */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** R 倍数の表示（例: +2.3R・−1.0R・±0.0R）。R が出ない・有限でないときは「R なし」 */
export function formatR(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return 'R なし';
  const n = roundAway(Math.abs(r), 10);
  return `${signOf(r)}${Math.floor(n / 10)}.${n % 10}R`;
}

/** 円の表示（例: +12,345円・−1,235円・±0円）。有限でないときは「損益なし」 */
export function formatYen(yen: number): string {
  if (!Number.isFinite(yen)) return '損益なし';
  const n = roundAway(Math.abs(yen), 1);
  return `${signOf(yen)}${group(n.toFixed(0))}円`;
}
