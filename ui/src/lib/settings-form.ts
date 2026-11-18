// 設定の画面の入力の読み取り（Issue #5 R1〜R5・#47。設計書 4.1・4.5・5.1・5.3・C8・C21・C36）。
// 資金と許容リスクの規則（readCapital・readRisk・riskWarning・allowanceText）は口座の下書き（accounts.ts）が使う。
// 下書き（欄ごとの文字列 + 選択）→ 欄ごとの誤り・警告・API に送る本文を返す純関数と、一覧・履歴の表示の整形。
// DOM・通信・現在時刻に触れない（同じ入力に同じ出力）。数の読み方は記録する画面と同じ parseNum、
// 名前の同一視は API の name_key と同じ nameKey、文字の規則（字数・制御文字）は record-form.ts と同じものを使う
import type {
  CapitalHistoryEntry,
  InstrumentBody,
  InstrumentRecord,
  ProductForm,
  UnderlyingKind,
} from '../../../core/record';
import { formatAmount, formatPlain } from './format';
import { nameKey } from './instrument-name';
import {
  DEFAULT_INSTRUMENT,
  hasBadChar,
  lengthOf,
  MAX_ABS,
  MSG,
  NAME_MAX,
  parseNum,
} from './record-form';

/** 許容リスクの範囲（%。API の RISK_TOLERANCE_RANGE と同じ）と、過剰リスクの線（判定 B。C8） */
export const RISK_MIN = 0.5;
export const RISK_MAX = 3;
export const OVER_RISK_PCT = 2;
const UNDERLYING_MAX = 40;

export const SETTINGS_MSG = {
  capitalNotNumber: '数を入れてください（例: 1,000,000）',
  capitalNotPositive: '0 より大きい数を入れてください',
  capitalNotInteger: '円の整数で入れてください',
  /** 外貨の口座の資金（#47 PR-2） */
  capitalTooManyDecimals: '小数 2 桁までで入力してください',
  capitalRequired: '資金を入れてください（未設定には戻せません）',
  tooLarge: MSG.tooLarge,
  risk: `${RISK_MIN} から ${RISK_MAX} までの数を入れてください`,
  riskWarning: `${OVER_RISK_PCT}% を超えています。このリスクで負けると、判定は B（過剰リスク）になります`,
  nameRequired: '名前を入れてください',
  nameInvalid: MSG.nameInvalid,
  duplicateName: '同じ名前の銘柄があります',
  underlyingInvalid: `${UNDERLYING_MAX} 字までで、制御文字を含めないでください`,
  currency: '英字 3 文字で入れてください（例: USD）',
  notNumber: '数を入れてください',
  notPositive: MSG.notPositive,
} as const;

/** 直したときの効き方（R6・C36。口座・銘柄の両方に出す） */
export const EFFECT_NOTE =
  '編集すると、これから記録する取引に効きます。記録済みの取引は変わりません';

export type ReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * 資金（R1）。円の口座は正の整数、外貨の口座は小数 2 桁まで（#47 PR-2）。1e12 まで。空は、未設定（saved = null）なら
 * 未設定のまま（null）、設定済みなら誤り（未設定には戻せない）
 */
export function readCapital(
  raw: string,
  saved: number | null,
  currency = 'JPY',
): ReadResult<number | null> {
  if (raw.trim() === '') {
    return saved === null
      ? { ok: true, value: null }
      : { ok: false, error: SETTINGS_MSG.capitalRequired };
  }
  const p = parseNum(raw);
  if (!p.ok) return { ok: false, error: SETTINGS_MSG.capitalNotNumber };
  if (!(p.value > 0)) return { ok: false, error: SETTINGS_MSG.capitalNotPositive };
  if (currency === 'JPY' && !Number.isInteger(p.value)) {
    return { ok: false, error: SETTINGS_MSG.capitalNotInteger };
  }
  if (currency !== 'JPY' && !Number.isInteger(Math.round(p.value * 100 * 1e6) / 1e6)) {
    return { ok: false, error: SETTINGS_MSG.capitalTooManyDecimals };
  }
  if (p.value > MAX_ABS) return { ok: false, error: SETTINGS_MSG.tooLarge };
  return { ok: true, value: p.value };
}

/** 許容リスク（R3）。0.5 以上 3 以下（%） */
export function readRisk(raw: string): ReadResult<number> {
  const p = parseNum(raw);
  if (!p.ok || p.value < RISK_MIN || p.value > RISK_MAX) {
    return { ok: false, error: SETTINGS_MSG.risk };
  }
  return { ok: true, value: p.value };
}

/** 2% を超える許容リスクの警告（保存はできる。判定の過剰リスクと食い違うことを知らせる） */
export function riskWarning(pct: number): string | null {
  return pct > OVER_RISK_PCT ? SETTINGS_MSG.riskWarning : null;
}

/** 誤りのある欄の知らせ（[保存] を押したのに誤りで送らなかったとき） */
export function errorFieldsText(labels: readonly string[]): string {
  return `誤りのある欄があります（${labels.join('・')}）。直してから、もう一度押してください。`;
}

/** 誤りのある欄（画面の並びの順） */
export function errorFieldsOf<F extends string>(
  errors: Readonly<Partial<Record<F, string>>>,
  order: Readonly<Record<F, string>>,
): F[] {
  return (Object.keys(order) as F[]).filter((f) => errors[f] !== undefined);
}

/**
 * 1 回の負けの上限（円）= 資金 × 許容リスク。上限なので 1 円未満を **切り捨て** る（四捨五入で 1 円多く見せない）。
 * 2 進の誤差（1,000,000 × 1.1 / 100 = 11000.000000000002・… 10999.999999999998）で 1 円下がらないよう、
 * 小さな寄せ（1e-6 円）を足してから切り捨てる（資金 1e12・許容リスク 3% の範囲で安全）
 */
export function allowanceYen(capitalYen: number, riskPct: number): number {
  return Math.floor((capitalYen * riskPct) / 100 + 1e-6);
}

/**
 * 口座の通貨の 1 回の負けの上限。JPY は allowanceYen（1 円未満を切り捨て）、外貨は 0.01 未満を切り捨て（#47 PR-2。
 * 例: 10,000.00 USD × 1% = 100.00 USD）
 */
export function allowanceIn(capital: number, riskPct: number, currency: string): number {
  if (currency === 'JPY') return allowanceYen(capital, riskPct);
  return Math.floor(capital * riskPct + 1e-6) / 100;
}

/** 資金 × 許容リスク = 1 回の負けの上限の文（資金が無ければ null）。金額は口座の通貨 */
export function allowanceText(
  capitalYen: number | null,
  riskPct: number,
  currency = 'JPY',
): string | null {
  if (capitalYen === null) return null;
  const v = allowanceIn(capitalYen, riskPct, currency);
  return `これから記録する取引にリスク（%）が出ます。許容リスク ${formatPlain(riskPct)}% なら、1 回の負けは ${formatAmount(v, currency)} までです`;
}

export type HistoryRow = CapitalHistoryEntry;

/** 資金の履歴を新しい順に（API は古い順に積む。口座ごと） */
export function historyRows(history: readonly CapitalHistoryEntry[]): HistoryRow[] {
  return [...history].reverse();
}

// ── 銘柄 ─────────────────────────────

export const UNDERLYING_KINDS: readonly UnderlyingKind[] = [
  'index',
  'fx',
  'commodity',
  'crypto',
  'stock',
  'other',
];
export const PRODUCT_FORMS: readonly ProductForm[] = ['spotCfd', 'future', 'option'];

export const UNDERLYING_KIND_LABEL: Readonly<Record<UnderlyingKind, string>> = {
  index: '株価指数',
  fx: 'FX',
  commodity: '商品',
  crypto: '仮想通貨',
  stock: '株式',
  other: 'その他',
};

export const PRODUCT_FORM_LABEL: Readonly<Record<ProductForm, string>> = {
  spotCfd: '現物・CFD',
  future: '先物',
  option: 'オプション',
};

/** 銘柄の 7 欄の下書き（文字の欄は打ったまま） */
export interface InstrumentDraft {
  readonly name: string;
  readonly underlying: string;
  readonly underlyingKind: UnderlyingKind;
  readonly productForm: ProductForm;
  /** 空 = 未設定 */
  readonly priceCurrency: string;
  readonly multiplier: string;
  readonly quantityStep: string;
}

export type InstrumentField = keyof InstrumentDraft;

/** 銘柄の欄の名前（画面の並びの順） */
export const INSTRUMENT_FIELD_LABEL: Readonly<Record<InstrumentField, string>> = {
  name: '名前',
  underlying: '原資産',
  underlyingKind: '原資産の種類',
  productForm: '商品の形',
  priceCurrency: '価格の通貨',
  multiplier: '乗数',
  quantityStep: '数量の刻み',
};

/** PUT の本文（7 欄。原資産が空なら省く） */
export type InstrumentPut = Required<Omit<InstrumentBody, 'underlying'>> &
  Pick<InstrumentBody, 'underlying'>;

export interface InstrumentReading {
  readonly errors: Readonly<Partial<Record<InstrumentField, string>>>;
  readonly body: InstrumentPut | null;
}

export const EMPTY_INSTRUMENT_READING: InstrumentReading = { errors: {}, body: null };

export function instrumentDraftOf(rec: InstrumentRecord): InstrumentDraft {
  return {
    name: rec.name,
    underlying: rec.underlying ?? '',
    underlyingKind: rec.underlyingKind,
    productForm: rec.productForm,
    priceCurrency: rec.priceCurrency ?? '',
    multiplier: formatPlain(rec.multiplier),
    quantityStep: formatPlain(rec.quantityStep),
  };
}

/** 名前（R4・R5）: trim・1〜40 字・制御文字なし・自分以外の銘柄と同じ名前（nameKey）でない */
function readName(
  raw: string,
  list: readonly InstrumentRecord[],
  selfId: string | null,
): ReadResult<string> {
  const name = raw.trim();
  if (name === '') return { ok: false, error: SETTINGS_MSG.nameRequired };
  if (lengthOf(name) > NAME_MAX || hasBadChar(name)) {
    return { ok: false, error: SETTINGS_MSG.nameInvalid };
  }
  const key = nameKey(name);
  if (list.some((i) => i.id !== selfId && nameKey(i.name) === key)) {
    return { ok: false, error: SETTINGS_MSG.duplicateName };
  }
  return { ok: true, value: name };
}

/** 正の数（乗数・数量の刻み） */
function readPositive(raw: string): ReadResult<number> {
  const p = parseNum(raw);
  if (!p.ok) return { ok: false, error: SETTINGS_MSG.notNumber };
  if (Math.abs(p.value) > MAX_ABS) return { ok: false, error: SETTINGS_MSG.tooLarge };
  if (!(p.value > 0)) return { ok: false, error: SETTINGS_MSG.notPositive };
  return { ok: true, value: p.value };
}

/** 口座の通貨（#47 PR-2）: 英字 3 文字は大文字に。空も誤り（口座の通貨は未設定にできない） */
export function readAccountCurrency(raw: string): ReadResult<string> {
  const c = readCurrency(raw);
  if (!c.ok) return c;
  if (c.value === null) return { ok: false, error: SETTINGS_MSG.currency };
  return { ok: true, value: c.value };
}

/** 価格の通貨: 空 = 未設定（null）、英字 3 文字は大文字に */
function readCurrency(raw: string): ReadResult<string | null> {
  const s = raw.normalize('NFKC').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^[A-Za-z]{3}$/.test(s)) return { ok: false, error: SETTINGS_MSG.currency };
  return { ok: true, value: s.toUpperCase() };
}

/** 銘柄の下書きを読む（selfId = 直している銘柄。名前の重複は自分以外と比べる） */
export function readInstrumentDraft(
  draft: InstrumentDraft,
  list: readonly InstrumentRecord[],
  selfId: string,
): InstrumentReading {
  const errors: Partial<Record<InstrumentField, string>> = {};
  const name = readName(draft.name, list, selfId);
  if (!name.ok) errors.name = name.error;
  const underlying = draft.underlying.trim();
  if (lengthOf(underlying) > UNDERLYING_MAX || hasBadChar(underlying)) {
    errors.underlying = SETTINGS_MSG.underlyingInvalid;
  }
  const currency = readCurrency(draft.priceCurrency);
  if (!currency.ok) errors.priceCurrency = currency.error;
  const multiplier = readPositive(draft.multiplier);
  if (!multiplier.ok) errors.multiplier = multiplier.error;
  const step = readPositive(draft.quantityStep);
  if (!step.ok) errors.quantityStep = step.error;
  if (!name.ok || !currency.ok || !multiplier.ok || !step.ok || errors.underlying) {
    return { errors, body: null };
  }
  return {
    errors,
    body: {
      name: name.value,
      ...(underlying === '' ? {} : { underlying }),
      underlyingKind: draft.underlyingKind,
      productForm: draft.productForm,
      priceCurrency: currency.value,
      multiplier: multiplier.value,
      quantityStep: step.value,
    },
  };
}

/** 名前だけで足す銘柄の名前（R5。ほかの欄は API が既定を入れる） */
export function readNewInstrumentName(
  raw: string,
  list: readonly InstrumentRecord[],
): ReadResult<string> {
  return readName(raw, list, null);
}

/** 一覧の並び（API と同じ: 名前の同一視の鍵 → 名前 → ID） */
export function sortInstruments(list: readonly InstrumentRecord[]): InstrumentRecord[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...list].sort(
    (a, b) => cmp(nameKey(a.name), nameKey(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id),
  );
}

/** 一覧の 1 行の要約（利用者の言葉。内部の識別子を出さない） */
export function instrumentSummary(rec: InstrumentRecord): string {
  return [
    UNDERLYING_KIND_LABEL[rec.underlyingKind],
    PRODUCT_FORM_LABEL[rec.productForm],
    // 記録する画面の 1 行と同じ言葉（口座の「通貨」と取り違えない。#47 PR-2 デザイン 5）
    rec.priceCurrency === null ? '価格の通貨 未設定' : `${rec.priceCurrency} 建て`,
    `乗数 ${formatPlain(rec.multiplier)}`,
    `刻み ${formatPlain(rec.quantityStep)}`,
    ...(rec.underlying ? [`原資産 ${rec.underlying}`] : []),
  ].join(' · ');
}

/** 自動で足したままの既定の値か（読み取り・手入力で名前だけで足された「仮の値」の銘柄。C21） */
export function isProvisional(rec: InstrumentRecord): boolean {
  const d = DEFAULT_INSTRUMENT;
  return (
    (rec.underlying ?? '') === '' &&
    rec.underlyingKind === d.underlyingKind &&
    rec.productForm === d.productForm &&
    rec.priceCurrency === d.priceCurrency &&
    rec.multiplier === d.multiplier &&
    rec.quantityStep === d.quantityStep
  );
}
