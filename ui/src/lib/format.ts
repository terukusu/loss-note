// R・円・口座の通貨の数字の表示（Issue #3 R3・契約 C-1・#47 PR-2。設計書 6.3・C29）。色は付けず、符号と単位で読ませる。
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
 * 符号の無い金額の表示（資金・1 回の負けの上限など。損益ではないので + を付けない。Issue #5）。
 * 例: 1,000,000円。1 円単位へ四捨五入（0 から遠い側）。有限でないときは「金額なし」
 */
export function formatAmountYen(yen: number): string {
  if (!Number.isFinite(yen)) return '金額なし';
  const n = roundAway(Math.abs(yen), 1);
  return `${yen < 0 && n !== 0 ? MINUS : ''}${group(n.toFixed(0))}円`;
}

/** 円の口座か（JPY は小数 0 桁・「円」。#47 PR-2） */
function isYen(currency: string): boolean {
  return currency === 'JPY';
}

/** 0 から遠い側へ小数 2 桁に丸め、3 桁区切りで書く（外貨の金額） */
function twoDecimals(abs: number): { text: string; zero: boolean } {
  const n = roundAway(abs, 100);
  const int = Math.floor(n / 100);
  const frac = String(n % 100).padStart(2, '0');
  return { text: `${group(String(int))}.${frac}`, zero: n === 0 };
}

/**
 * 口座の通貨の損益の表示（#47 PR-2・U29）。JPY は formatYen と同じ（−8,000円）。
 * ほかの通貨は「−50.00 USD」（小数 2 桁・3 桁区切り・半角の空き・3 文字・符号は U+2212・ちょうど 0 は ±）。
 * 有限でないときは「損益なし」
 */
export function formatMoney(value: number, currency: string): string {
  if (isYen(currency)) return formatYen(value);
  if (!Number.isFinite(value)) return '損益なし';
  return `${signOf(value)}${twoDecimals(Math.abs(value)).text} ${currency}`;
}

/**
 * 口座の通貨の符号の無い金額（資金・1R・1 回の負けの上限）。JPY は formatAmountYen と同じ（1,000,000円）。
 * ほかの通貨は「10,000.00 USD」。有限でないときは「金額なし」
 */
export function formatAmount(value: number, currency: string): string {
  if (isYen(currency)) return formatAmountYen(value);
  if (!Number.isFinite(value)) return '金額なし';
  const { text, zero } = twoDecimals(Math.abs(value));
  return `${value < 0 && !zero ? MINUS : ''}${text} ${currency}`;
}

/**
 * リスク（%）の表示（Issue #13 ルール 5・契約 R-2。設計書 5.1）。小数 1 桁へ **切り上げ**（2% を超えた取引が 2.0% と出て、
 * 過剰リスクの理由と食い違うのを防ぐ。多めに出るのはリスクの側に安全）。2 進の誤差で 1 段上がらないよう、
 * 先に 1e-9 を引いてから切り上げる（0.5 → 0.5%、2.0 → 2.0%、2.01 → 2.1%）。有限でないときは「リスクなし」
 */
export function formatPct(p: number): string {
  if (!Number.isFinite(p)) return 'リスクなし';
  return `${ceil1(p)}%`;
}

/** 小数 1 桁へ切り上げた文字（1e-9 を引いてから。−0 を「-0.0」にしない） */
function ceil1(x: number): string {
  const v = Math.ceil((x - 1e-9) * 10) / 10;
  return (v === 0 ? 0 : v).toFixed(1);
}

/**
 * 数量の比の数の部分（「提案の数量 4,000（2.5 倍）」の 2.5。#67 R3）。リスク（%）と同じ小数 1 桁への切り上げ（許容をわずかに超えた取引が
 * 「1.0 倍」に見えないように。比 × 許容リスク = リスク（%）なので、許容 1% の口座ではリスク（%）の表示と同じ数になる）。
 * 有限でないときは「比なし」
 */
export function formatTimes(ratio: number): string {
  if (!Number.isFinite(ratio)) return '比なし';
  return ceil1(ratio);
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

/**
 * 数の文字（`formatPlain` の形・`formatFxDerived` の形）の整数部だけを 3 桁ごとにカンマで区切り、負の符号を − (U+2212) にする
 * （#40）。小数部はそのまま（丸めない・区切らない）。数の形でない文字（Infinity・空）はそのまま返す
 */
export function groupDigits(text: string): string {
  const m = /^(-?)(\d+)(\.\d*)?$/.exec(text);
  if (!m) return text;
  return `${m[1] === '-' ? MINUS : ''}${group(m[2] ?? '')}${m[3] ?? ''}`;
}

/**
 * 表示の数（価格・数量・乗数・レートなど。#40）。保存した数のまま（丸めない。FX の 1.08345 は 1.08345）で、
 * 整数部だけ 3 桁区切り（38250 → 38,250）・負の符号は U+2212・指数表記にしない。入力の欄の値には使わない（`formatPlain`）
 */
export function formatNumber(n: number): string {
  return groupDigits(formatPlain(n));
}

/** 価格の表示（理由の「99.5 → 99.2」・詳細のイン・決済・LC など）。`formatNumber` と同じ（38,250・1.08345） */
export function formatPrice(n: number): string {
  return formatNumber(n);
}

/** 数量の表示（詳細・判定の枠の数量の 1 行など）。`formatNumber` と同じ（10,000・0.01） */
export function formatQuantity(n: number): string {
  return formatNumber(n);
}

/**
 * 割合の表示（計画どおり率。Issue #88 R3・C44）。整数の %・四捨五入（0.5 は上へ。2 進の誤差で 0.5 の境が下へ落ちないよう
 * 1e-9 を足してから丸める）。ただし 100% はすべてそろったとき（ratio = 1）だけ、0% は 1 件も無いとき（ratio = 0）だけ
 * （199 / 200 は 99%、1 / 201 は 1%。1 件の崩れを丸めで消さない）。0〜1 の外・有限でないときは「率なし」
 */
export function formatRate(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return '率なし';
  const n = Math.round(ratio * 100 + 1e-9);
  const clamped = ratio < 1 && n >= 100 ? 99 : ratio > 0 && n <= 0 ? 1 : n;
  return `${clamped}%`;
}

/**
 * 日付の短い書き方（振り返りの期間・曲線の両端・「数で見る」の表で 1 つの規則。#88）。端末の時間帯の暦日で、
 * 今年なら「11/13」、ほかの年なら「2025/11/13」
 */
export function formatDay(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/**
 * 日付の範囲（「11/13〜11/19」）。両端が今年なら月日だけ、どちらかが今年でなければ両端に年（「2025/12/20〜2026/1/19」）。
 * 同じ日なら 1 つ
 */
export function formatDayRange(firstMs: number, lastMs: number, nowMs: number): string {
  const a = new Date(firstMs);
  const b = new Date(lastMs);
  if (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  ) {
    return formatDay(firstMs, nowMs);
  }
  const year = new Date(nowMs).getFullYear();
  if (a.getFullYear() === year && b.getFullYear() === year) {
    return `${formatDay(firstMs, nowMs)}〜${formatDay(lastMs, nowMs)}`;
  }
  const full = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${full(a)}〜${full(b)}`;
}
