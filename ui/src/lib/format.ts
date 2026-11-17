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

/**
 * リスク（%）の表示（Issue #13 ルール 5・契約 R-2。設計書 5.1）。小数 1 桁へ **切り上げ**（2% を超えた取引が 2.0% と出て、
 * 過剰リスクの理由と食い違うのを防ぐ。多めに出るのはリスクの側に安全）。2 進の誤差で 1 段上がらないよう、
 * 先に 1e-9 を引いてから切り上げる（0.5 → 0.5%、2.0 → 2.0%、2.01 → 2.1%）。有限でないときは「リスクなし」
 */
export function formatPct(p: number): string {
  if (!Number.isFinite(p)) return 'リスクなし';
  const v = Math.ceil((p - 1e-9) * 10) / 10;
  // −0 を「-0.0」にしない（toFixed は −0 を "0.0" にする）
  return `${(v === 0 ? 0 : v).toFixed(1)}%`;
}

/**
 * 数を指数表記にしない文字列（保存した数のまま。末尾の 0 は落ちる）。1e-7 → "0.0000001"。
 * 入力の欄の既定値（数量）と、明細の読み取りの値（#15）にも使う（指数表記は入力の欄で数として受けないため）。
 * 指数表記の桁を小数点の位置だけずらして書く（toFixed(20) は小数 20 桁で切れて、9.8186764633e-10 のような数の
 * 桁を落とすため。#15 の往復の性質テスト）
 */
export function formatPlain(n: number): string {
  const s = String(n);
  if (!/e/i.test(s) || !Number.isFinite(n)) return s;
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const sign = m[1] ?? '';
  const tail = m[3] ?? '';
  const digits = `${m[2] ?? ''}${tail}`;
  const exp = Number(m[4]);
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  return exp >= tail.length
    ? `${sign}${digits}${'0'.repeat(exp - tail.length)}`
    : `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}

/** 価格の表示（理由の「99.5 → 99.2」など）。保存した数のまま（桁をそろえるのは後の Issue） */
export function formatPrice(n: number): string {
  return formatPlain(n);
}
