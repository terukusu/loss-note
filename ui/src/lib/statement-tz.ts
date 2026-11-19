// 明細に時間帯の書かれていない時刻を、利用者が選んだ時間帯から日本時間に直す規則（Issue #58 の後半。純関数）。
// - 選択肢は決まった一覧（ID → IANA の名前）だけ。端末に覚える値も一覧の ID だけ（IANA の名前・明細の値を書かない）
// - 夏時間のある時間帯は、明細に書かれた日付と時刻からその時のずれ幅を決める。切り替えで存在しない時刻は gap、
//   2 回ある時刻は早い方（ルール 5）
// - 押す前に見せる日本時間（jstText）は端末の時間帯に依らない。欄の文字は今までどおり端末の時間帯（toLocalInput）
// - 選び直しても前の結果に重ねない（いつも明細に書かれた時刻から直す）
// 依存は Intl だけ（同じ入力に同じ出力）。保存先は引数で受ける（theme.ts の StorageLike と同じ形）
import { toLocalInput } from './datetime';
import type { Draft } from './record-form';
import type { FieldMark, Marks, ReadRow } from './statement-fill';
import type { StorageLike } from './theme';

/** 時間帯の ID（端末に覚える値） */
export type TzId =
  | 'jst'
  | 'gmt'
  | 'us-east'
  | 'us-central'
  | 'uk'
  | 'eu-central'
  | 'eu-east'
  | 'utc2'
  | 'utc3'
  | 'hk-sg';

export interface TzChoice {
  readonly id: TzId;
  /** 画面の名前 */
  readonly name: string;
  /** IANA の名前（Etc/GMT-N は符号が逆 = UTC+N） */
  readonly zone: string;
}

/** 最初に並べる 2 つ */
export const MAIN_ZONES: readonly TzChoice[] = [
  { id: 'jst', name: '日本時間（そのまま）', zone: 'Asia/Tokyo' },
  { id: 'gmt', name: 'GMT（+9 時間）', zone: 'UTC' },
];

/** [ほかのタイムゾーン…] の一覧（足すのは 1 行） */
export const OTHER_ZONES: readonly TzChoice[] = [
  { id: 'us-east', name: '米国東部（夏時間あり）', zone: 'America/New_York' },
  { id: 'us-central', name: '米国中部（夏時間あり）', zone: 'America/Chicago' },
  { id: 'uk', name: '英国（夏時間あり）', zone: 'Europe/London' },
  { id: 'eu-central', name: '欧州中部（夏時間あり）', zone: 'Europe/Berlin' },
  { id: 'eu-east', name: '東欧（夏時間あり）', zone: 'Europe/Athens' },
  { id: 'utc2', name: 'UTC+2（夏時間なし）', zone: 'Etc/GMT-2' },
  { id: 'utc3', name: 'UTC+3（夏時間なし）', zone: 'Etc/GMT-3' },
  { id: 'hk-sg', name: '香港・シンガポール（UTC+8）', zone: 'Asia/Hong_Kong' },
];

export const TZ_CHOICES: readonly TzChoice[] = [...MAIN_ZONES, ...OTHER_ZONES];

export function tzChoice(id: TzId): TzChoice {
  return TZ_CHOICES.find((c) => c.id === id) ?? (MAIN_ZONES[0] as TzChoice);
}

export const isTzId = (v: unknown): v is TzId => TZ_CHOICES.some((c) => c.id === v);

/** 一覧の [ほかのタイムゾーン…] の中の ID か */
export const isOtherZone = (id: TzId): boolean => OTHER_ZONES.some((c) => c.id === id);

/** 2100-01-01 の前まで（datetime.ts・API と同じ） */
const MAX_TIME_MS = 4_102_444_800_000;
const WRITTEN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** epoch → その時間帯の壁の時計（年・月・日・時・分） */
function wallOf(ms: number, zone: string): [number, number, number, number, number] {
  const parts = formatterOf(zone).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? Number.NaN);
  // 一部の実装は 0 時を 24 と書く
  return [get('year'), get('month'), get('day'), get('hour') % 24, get('minute')];
}

/** 壁の時計を UTC とみなした epoch − 実の epoch = その時のずれ幅 */
function offsetAt(ms: number, zone: string): number {
  const [y, mo, d, h, mi] = wallOf(ms, zone);
  return Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60_000) * 60_000;
}

export type WallResult =
  | { readonly kind: 'ok'; readonly ms: number }
  | { readonly kind: 'gap' }
  | { readonly kind: 'invalid' };

/**
 * 「YYYY-MM-DDTHH:MM」をその時間帯の壁の時計の時刻として読む。暦に無い・範囲の外は invalid、夏時間の切り替えで
 * 存在しない時刻は gap、2 回ある時刻は早い方。端末の時間帯に依らない
 */
export function wallToEpoch(written: string, id: TzId): WallResult {
  const m = WRITTEN.exec(written);
  if (!m) return { kind: 'invalid' };
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(asUtc);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi
  ) {
    return { kind: 'invalid' };
  }
  const zone = tzChoice(id).zone;
  const found: number[] = [];
  for (const probe of [asUtc - DAY_MS, asUtc + DAY_MS]) {
    const cand = asUtc - offsetAt(probe, zone);
    const [cy, cmo, cd, ch, cmi] = wallOf(cand, zone);
    if (cy === y && cmo === mo && cd === d && ch === h && cmi === mi && !found.includes(cand)) {
      found.push(cand);
    }
  }
  if (found.length === 0) return { kind: 'gap' };
  const ms = Math.min(...found);
  return ms >= 0 && ms < MAX_TIME_MS ? { kind: 'ok', ms } : { kind: 'invalid' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 日本時間の「2026/11/11 00:30」（端末の時間帯に依らない） */
export function jstText(ms: number): string {
  const [y, mo, d, h, mi] = wallOf(ms, 'Asia/Tokyo');
  return `${y}/${pad(mo)}/${pad(d)} ${pad(h)}:${pad(mi)}`;
}

/** 明細に書かれた時刻の表示（「2026-11-10T10:30」→「2026/11/10 10:30」） */
export function writtenText(written: string): string {
  const m = WRITTEN.exec(written);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : written;
}

/** 時間帯の確かめの対象になる欄（並びは画面の順 = エントリー → 決済） */
export type TzField = 'entryTime' | 'exitTime';
export const TZ_FIELDS: readonly TzField[] = ['entryTime', 'exitTime'];

/** 印 tz の欄（時間帯の確かめの対象） */
export function tzFieldsOf(marks: Marks): TzField[] {
  return TZ_FIELDS.filter((f) => marks[f] === 'tz');
}

/** 選んだ時間帯で直せる欄か（利用者が欄を直していない = 印が tz か、前にこの規則が入れた read） */
const replaceable = (m: FieldMark | undefined) => m === 'tz' || m === 'read';

export interface Applied {
  readonly draft: Draft;
  readonly marks: Marks;
  /** その時間帯に無い時刻だった欄（値も印も変えていない） */
  readonly gaps: readonly TzField[];
}

/**
 * 選んだ時間帯で、対象の欄（fields）のうち利用者が直していない欄を、明細に書かれた時刻から日本時間に直して入れる
 * （欄の文字は端末の時間帯。印は read）。gap・invalid の欄は変えない
 */
export function applyZone(
  draft: Draft,
  marks: Marks,
  row: ReadRow,
  id: TzId,
  fields: readonly TzField[],
): Applied {
  let d = draft;
  let mk = marks;
  const gaps: TzField[] = [];
  for (const f of fields) {
    const t = row[f];
    if (t === null || !replaceable(mk[f])) continue;
    const r = wallToEpoch(t.written, id);
    if (r.kind === 'gap') gaps.push(f);
    if (r.kind !== 'ok') continue;
    d = { ...d, [f]: toLocalInput(r.ms) };
    mk = { ...mk, [f]: 'read' };
  }
  return { draft: d, marks: mk, gaps };
}

/**
 * [ほかのタイムゾーン…] を開いた: 前に選んだ時間帯で入れた欄（印 read）を、明細に書かれた時刻と印 tz に戻す
 * （どの時間帯か決まっていない間は記録しない）
 */
export function unapplyZone(
  draft: Draft,
  marks: Marks,
  row: ReadRow,
  fields: readonly TzField[],
): { readonly draft: Draft; readonly marks: Marks } {
  let d = draft;
  let mk = marks;
  for (const f of fields) {
    const t = row[f];
    if (t === null || mk[f] !== 'read') continue;
    d = { ...d, [f]: t.written };
    mk = { ...mk, [f]: 'tz' };
  }
  return { draft: d, marks: mk };
}

// ── 画面の文（決まった文言だけ） ──

export const TZ_TEXT = {
  legend: '明細の時刻のタイムゾーン',
  /** 選ぶ前・選んだ後の説明（何が起きていて、どうするか） */
  lead: '明細の時刻にタイムゾーンが書かれていません。選んだタイムゾーンから日本時間に直して欄に入力します。',
  other: 'ほかのタイムゾーン…',
  otherSelect: 'ほかのタイムゾーン',
  otherPlaceholder: 'タイムゾーンを選択',
  gapOption: 'この時刻はありません（夏時間の切り替え）',
} as const;

/** 文の中の名前（英字で始まる名前だけ前に空白を置く。「選んだ GMT（+9 時間）で」「選んだ英国（夏時間あり）で」） */
const inline = (id: TzId) => {
  const name = tzChoice(id).name;
  return /^[A-Za-z]/.test(name) ? ` ${name}` : name;
};

/** 覚えたタイムゾーンで入れたときの 1 行 */
export function rememberedText(id: TzId): string {
  return id === 'jst'
    ? '前に選んだ日本時間（そのまま）で入力しました。違うときは変更してください。'
    : `前に選んだ${inline(id)}で日本時間に直しました。違うときは変更してください。`;
}

/** 覚えたタイムゾーンでは存在しない時刻だったときの 1 行（欄は直していない） */
export function rememberedGapText(id: TzId): string {
  return `前に選んだ${inline(id)}では、明細の時刻が夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。`;
}

/** その時間帯に無い時刻だったときの 1 行 */
export function gapText(id: TzId): string {
  return `明細の時刻は${inline(id)}では夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。`;
}

/** 欄ごとの 1 行（「決済の時刻: 明細 2026/11/10 10:30」） */
export function writtenLine(label: string, written: string): string {
  return `${label}: 明細 ${writtenText(written)}`;
}

/** 選択肢の横の日本時間（gap は理由、読めない時刻は空） */
export function resultText(written: string, id: TzId): string {
  const r = wallToEpoch(written, id);
  if (r.kind === 'ok') return jstText(r.ms);
  return r.kind === 'gap' ? TZ_TEXT.gapOption : '';
}

/** ほかのタイムゾーンを選んだときの一覧の下の 1 行（「米国東部（夏時間あり）→ 日本時間 2026/11/11 00:30」） */
export function otherResultLine(written: string, id: TzId): string {
  const t = resultText(written, id);
  return `${tzChoice(id).name} → 日本時間 ${t}`;
}

// ── 端末に覚える（時間帯の ID だけ。KEEP-7） ──

export const ZONE_KEY = 'loss-note.statementTimeZone';

/** 覚えた時間帯（無い・読めない・一覧に無い値は null） */
export function readZoneMemory(storage: StorageLike | null | undefined): TzId | null {
  try {
    const v = storage?.getItem(ZONE_KEY);
    return isTzId(v) ? v : null;
  } catch {
    return null;
  }
}

/** 覚えられたら true。例外は握って false */
export function writeZoneMemory(storage: StorageLike | null | undefined, id: TzId): boolean {
  if (!storage || !isTzId(id)) return false;
  try {
    storage.setItem(ZONE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
