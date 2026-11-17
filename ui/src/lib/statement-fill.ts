// 決済明細の読み取りの応答を記録する画面の下書きに流し込む規則（Issue #15 のルール R4〜R8。純関数）。
// DOM・通信・今の時刻・保存先に触れない（時刻の欄の文字は端末の時間帯で datetime-local に写す。datetime.ts と同じ）。
// - 応答の形は画面の側でも確かめる（parseReadResponse。行は 12 の鍵だけを写し、型違い・範囲の外の欄は null）
// - 読み取りの欄 9 つに値を入れ「読み取り」の印。null は空にして「読み取れませんでした」（開いたときの既定を残さない）
// - 貼った後に利用者が触った欄は上書きしない。LC・一言・3 つのタップ（逆指値の既定を除く）・LC の根拠には触れない
// - 時間帯が明細に無い時刻は、書かれた時刻を入れて「時間帯が明細にありません」。確かめるまで保存しない
import type { ExitOrderType, Side } from '../../../core/trade';
import { toLocalInput } from './datetime';
import { formatPlain } from './format';
import type { Draft, DraftField, DraftReading } from './record-form';

/** API の応答の行の数の上限（ADR-0005） */
export const MAX_ROWS = 20;
const NAME_MAX = 40;
const MAX_ABS = 1e12;
/** 2100-01-01 の前まで（datetime.ts・API と同じ） */
const MAX_TIME_MS = 4_102_444_800_000;
const WRITTEN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ORDER_TYPES: readonly ExitOrderType[] = ['stop', 'market', 'limit', 'unknown'];

/** 応答の時刻（書かれた値・時間帯・日本時間・epoch。時間帯が不明なら jst・epochMs は null） */
export interface ReadTime {
  readonly written: string;
  readonly timeZone: string;
  readonly jst: string | null;
  readonly epochMs: number | null;
}

/** 応答の 1 行（API の normalize_row と同じ 12 の鍵） */
export interface ReadRow {
  readonly symbol: string | null;
  readonly side: Side | null;
  readonly entryPrice: number | null;
  readonly exitPrice: number | null;
  readonly quantity: number | null;
  readonly pnlYen: number | null;
  readonly entryTime: ReadTime | null;
  readonly exitTime: ReadTime | null;
  readonly timeZoneNeedsCheck: boolean;
  readonly fees: readonly number[] | null;
  readonly feesTotalYen: number | null;
  readonly exitOrderType: ExitOrderType;
}

export interface ReadResult {
  readonly kind: 'statement' | 'notStatement';
  readonly rows: readonly ReadRow[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ABS ? v : null;

const positive = (v: unknown): number | null => {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
};

/** 制御文字・書式文字（ZWJ を除く）・孤立したサロゲートを含むか */
function hasBadChar(s: string): boolean {
  for (const ch of s) {
    if (ch === '‍') continue;
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) return true;
    const c = ch.charCodeAt(0);
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return true;
  }
  return false;
}

function symbolOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '' || [...s].length > NAME_MAX || hasBadChar(s)) return null;
  return s;
}

function timeOf(v: unknown): ReadTime | null {
  if (!isObj(v)) return null;
  const { written, timeZone, jst, epochMs } = v;
  if (typeof written !== 'string' || !WRITTEN.test(written)) return null;
  let ms: number | null = null;
  if (epochMs !== null && epochMs !== undefined) {
    if (
      typeof epochMs !== 'number' ||
      !Number.isInteger(epochMs) ||
      epochMs < 0 ||
      epochMs >= MAX_TIME_MS
    ) {
      return null;
    }
    ms = epochMs;
  }
  return {
    written,
    timeZone: typeof timeZone === 'string' ? timeZone : 'unknown',
    jst: typeof jst === 'string' && WRITTEN.test(jst) ? jst : null,
    epochMs: ms,
  };
}

function rowOf(v: unknown): ReadRow | null {
  if (!isObj(v)) return null;
  const fees =
    Array.isArray(v.fees) && v.fees.every((x) => finite(x) !== null)
      ? (v.fees as number[]).slice()
      : null;
  const order = ORDER_TYPES.find((o) => o === v.exitOrderType) ?? 'unknown';
  return {
    symbol: symbolOf(v.symbol),
    side: v.side === 'L' || v.side === 'S' ? v.side : null,
    entryPrice: positive(v.entryPrice),
    exitPrice: positive(v.exitPrice),
    quantity: positive(v.quantity),
    pnlYen: finite(v.pnlYen),
    entryTime: timeOf(v.entryTime),
    exitTime: timeOf(v.exitTime),
    timeZoneNeedsCheck: v.timeZoneNeedsCheck === true,
    fees,
    feesTotalYen: finite(v.feesTotalYen),
    exitOrderType: order,
  };
}

/**
 * 応答の本文 → 読み取りの結果。kind が statement / notStatement で、rows が 0〜20 の配列（行はすべてオブジェクト）の
 * ときだけ。ほかは null（「読み取れませんでした」）。行は 12 の鍵だけを写し、ほかの鍵を持たない
 */
export function parseReadResponse(json: unknown): ReadResult | null {
  if (!isObj(json)) return null;
  if (json.kind !== 'statement' && json.kind !== 'notStatement') return null;
  if (!Array.isArray(json.rows) || json.rows.length > MAX_ROWS) return null;
  const rows: ReadRow[] = [];
  for (const r of json.rows) {
    const row = rowOf(r);
    if (row === null) return null;
    rows.push(row);
  }
  return { kind: json.kind, rows };
}

// ── 欄の印 ──

/** 欄の印: 読み取り / 読み取れませんでした / 直した / 時間帯が明細にありません / 明細から（逆指値の既定） */
export type FieldMark = 'read' | 'unread' | 'edited' | 'tz' | 'statement';
export type Marks = Readonly<Partial<Record<DraftField, FieldMark>>>;

export const MARK_LABEL: Readonly<Record<FieldMark, string>> = {
  read: '読み取り',
  unread: '読み取れませんでした',
  edited: '直した',
  tz: '時間帯が明細にありません',
  statement: '明細から',
};

/** 読み取りの欄（画面の並びの順） */
export const READ_FIELDS = [
  'instrumentName',
  'side',
  'entryPrice',
  'exitPrice',
  'quantity',
  'exitTime',
  'entryTime',
  'pnlYen',
  'feeYen',
] as const satisfies readonly DraftField[];

type ReadField = (typeof READ_FIELDS)[number];

const num = (n: number | null): string => (n === null ? '' : formatPlain(n));

/** 応答の時刻 → 欄の文字と印（時間帯が分かれば端末の時刻、分からなければ書かれた時刻のまま） */
function timeField(t: ReadTime | null): { value: string; mark: FieldMark } {
  if (t === null) return { value: '', mark: 'unread' };
  if (t.epochMs !== null) return { value: toLocalInput(t.epochMs), mark: 'read' };
  return { value: t.written, mark: 'tz' };
}

export interface Filled {
  readonly draft: Draft;
  readonly marks: Marks;
}

/**
 * 行の値を下書きに流し込む。touched（貼った後に利用者が触った欄）は値も印も変えない。
 * 逆指値 → 決済の理由 = LC・決めていた（触っていなければ。印「明細から」）・逆指値を入れた = 入れた。
 * それ以外 → 決めていたかは触らず、決済の理由 = その他（触っていなければ）・逆指値を入れたか = 未回答
 */
export function fillFromRow(draft: Draft, row: ReadRow, touched: ReadonlySet<DraftField>): Filled {
  const exit = timeField(row.exitTime);
  const entry = timeField(row.entryTime);
  const read: Record<ReadField, { value: Draft[ReadField]; mark: FieldMark }> = {
    instrumentName: { value: row.symbol ?? '', mark: row.symbol === null ? 'unread' : 'read' },
    side: { value: row.side, mark: row.side === null ? 'unread' : 'read' },
    entryPrice: { value: num(row.entryPrice), mark: row.entryPrice === null ? 'unread' : 'read' },
    exitPrice: { value: num(row.exitPrice), mark: row.exitPrice === null ? 'unread' : 'read' },
    quantity: { value: num(row.quantity), mark: row.quantity === null ? 'unread' : 'read' },
    exitTime: exit,
    entryTime: entry,
    pnlYen: { value: num(row.pnlYen), mark: row.pnlYen === null ? 'unread' : 'read' },
    feeYen: { value: num(row.feesTotalYen), mark: row.feesTotalYen === null ? 'unread' : 'read' },
  };
  const values: Record<string, unknown> = {};
  const marks: Partial<Record<DraftField, FieldMark>> = {};
  for (const f of READ_FIELDS) {
    if (touched.has(f)) continue;
    values[f] = read[f].value;
    marks[f] = read[f].mark;
  }
  const stop = row.exitOrderType === 'stop';
  if (stop) {
    if (!touched.has('lcDecided') && !draft.lcNone) {
      values.lcDecided = true;
      marks.lcDecided = 'statement';
    }
    if (!touched.has('exitReason')) {
      values.exitReason = 'lc';
      marks.exitReason = 'statement';
    }
  } else if (!touched.has('exitReason')) {
    values.exitReason = 'other';
  }
  return {
    draft: {
      ...draft,
      ...(values as Partial<Draft>),
      source: 'statement',
      exitOrderType: row.exitOrderType,
      stopOrderPlaced: stop ? 'placed' : 'unanswered',
    },
    marks,
  };
}

/** 利用者が欄を直した後の印（「明細から」は外す、ほかの印は「直した」。印の無い欄はそのまま） */
export function markEdited(marks: Marks, field: DraftField): Marks {
  const m = marks[field];
  if (m === undefined || m === 'edited') return marks;
  const { [field]: _old, ...rest } = marks;
  return m === 'statement' ? rest : { ...rest, [field]: 'edited' };
}

/**
 * 明細に書かれた時刻（YYYY-MM-DDTHH:MM）を日本時間として epoch（ms・UTC）に直す。端末の時間帯に依らない。
 * 暦にない日時・範囲の外は undefined
 */
export function confirmJst(written: string): number | undefined {
  const m = WRITTEN.exec(written);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(utc);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi
  ) {
    return undefined;
  }
  const t = utc - 9 * 3600 * 1000;
  return t >= 0 && t < MAX_TIME_MS ? t : undefined;
}

/** [日本時間で合っている]: 「時間帯が明細にありません」の欄を日本時間として端末の時刻の欄に写し直し、印を「読み取り」に */
export function confirmTimeZone(draft: Draft, marks: Marks, row: ReadRow): Filled {
  let d = draft;
  let mk = marks;
  for (const f of ['exitTime', 'entryTime'] as const) {
    const t = row[f];
    if (mk[f] !== 'tz' || t === null) continue;
    const ms = confirmJst(t.written);
    if (ms === undefined) continue;
    d = { ...d, [f]: toLocalInput(ms) };
    mk = { ...mk, [f]: 'read' };
  }
  return { draft: d, marks: mk };
}

/** 時間帯を確かめていない欄があるか */
export function needsTzCheck(marks: Marks): boolean {
  return marks.exitTime === 'tz' || marks.entryTime === 'tz';
}

export const READING_NOTICE = '明細を読み取っています';
export const TZ_MISSING = {
  exitTime: '決済の時刻（時間帯の確かめ）',
  entryTime: '建てた時刻（時間帯の確かめ）',
} as const;

/** 保存の門: 読み取り中・時間帯を確かめていない間は保存できない（理由を文で足す）。ほかは入力と同じ */
export function gateReading(
  read: DraftReading,
  g: { readonly reading: boolean; readonly marks: Marks },
): DraftReading {
  const tz = (['exitTime', 'entryTime'] as const).filter((f) => g.marks[f] === 'tz');
  if (!g.reading && tz.length === 0) return read;
  return {
    ...read,
    canSave: false,
    missing: [...read.missing, ...tz.map((f) => TZ_MISSING[f])],
    ...(g.reading ? { notice: READING_NOTICE } : {}),
  };
}

// ── 失敗の文言（決まった文言だけ。応答の本文・例外の文字列を持たない） ──

export const READ_MSG = {
  notStatement: '決済明細として読めませんでした。別の画像を貼るか、手で入れてください。',
  rejected: 'この画像は読み取れません。別の画像を貼るか、手で入れてください。',
  unavailable: '今は読み取りを使えません。手で入れてください。',
  failed: '読み取れませんでした。もう一度貼るか、手で入れてください。',
  notImage: '画像を読み込めませんでした。PNG か JPEG のスクショを貼ってください。',
} as const;

export type ReadFailure = 'rejected' | 'unavailable' | 'auth' | 'failed';

/** 読み取りの応答の状態 → 失敗の種類（400 → 断られた・503 → 使えない・401 → ログイン・ほか → 読み取れなかった） */
export function readFailureOf(status: number): ReadFailure {
  if (status === 400) return 'rejected';
  if (status === 503) return 'unavailable';
  if (status === 401) return 'auth';
  return 'failed';
}

/** 行の番号の表示（N ≥ 2 のとき） */
export function rowLabel(index: number, total: number): string {
  return `${index + 1} / ${total} 行目`;
}

export interface ClipItem<F> {
  readonly kind: string;
  readonly type: string;
  getAsFile(): F | null;
}

/** 貼り付けの的（イベントの target の形だけ。DOM の型に依らない） */
export interface PasteTarget {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/** 文字の欄（ファイル以外の input・textarea・contenteditable）か */
export function isTextTarget(t: PasteTarget | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable === true) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (t.type ?? 'text').toLowerCase();
  return ![
    'file',
    'button',
    'submit',
    'reset',
    'checkbox',
    'radio',
    'image',
    'range',
    'color',
  ].includes(type);
}

/**
 * 貼り付けの中の最初の画像のファイル。画像が無い・文字の欄に文字を含む貼り付けをした（target が文字の欄で、
 * クリップボードに文字がある）ときは null（横取りせず普通の貼り付けに任せる。R1。表計算からのコピーは文字と画像の
 * 両方を持つので、文字の欄では画像を送らない）。文字の欄でも画像だけなら明細として受ける
 */
export function imageFileFromClipboard<F>(
  items: ArrayLike<ClipItem<F>> | null | undefined,
  target?: PasteTarget | null,
): F | null {
  if (!items) return null;
  if (isTextTarget(target)) {
    // 文字の欄でも、クリップボードが画像だけなら明細として受ける。文字があれば普通の貼り付けに任せる
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.kind === 'string' && it.type.startsWith('text/')) return null;
    }
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
