// データの書き出し（#167・設計書 9.2 の設定の行・10.1・ADR-0025）の応答の検査・ファイルの名前・文言。DOM・通信を持たない。
// - 応答は GET /api/export の本文（API の export.export_body。一覧の API と同じ形の設定・口座・銘柄・取引）
// - JSON の書き出しは応答の文字をそのまま保存する（画面で形を変えない = API の形が正）。CSV は export-csv.ts が組み立てる
// - ファイルの名前は端末の時間帯の日付（画面の日時の表示と同じ）。例: loss-note-20261124.csv
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';

export const EXPORT_PATH = '/api/export';
export const EXPORT_FORMAT = 'loss-note-export';
/** この画面が知っている書き出しの形の版（API の export.VERSION） */
export const EXPORT_VERSION = 1;

export type ExportKind = 'json' | 'csv';

/** 端末に保存するファイル（保存の層 download.ts に渡す） */
export interface SavedFile {
  readonly name: string;
  readonly kind: ExportKind;
  readonly text: string;
}

export interface ExportData {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: number;
  readonly exportedAt: number;
  readonly settings: Readonly<Record<string, unknown>>;
  /** 心理のタグの選択肢の設定（#163。出さないタグの ID） */
  readonly emotionTagSettings: { readonly hidden: readonly string[] };
  readonly accounts: readonly AccountRecord[];
  readonly instruments: readonly InstrumentRecord[];
  readonly trades: readonly StoredTrade[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isTrade = (v: unknown): boolean =>
  isObject(v) &&
  typeof v.id === 'string' &&
  isObject(v.record) &&
  isObject(v.snapshot) &&
  Array.isArray(v.record.entries) &&
  isObject(v.record.exit);

const isNamed = (v: unknown): boolean =>
  isObject(v) && typeof v.id === 'string' && typeof v.name === 'string';

/** 応答の本文の形を確かめる（外れたら null = 書き出せなかったとして扱う。知らない版も null） */
export function parseExport(body: unknown): ExportData | null {
  if (!isObject(body)) return null;
  if (body.format !== EXPORT_FORMAT || body.version !== EXPORT_VERSION) return null;
  if (typeof body.exportedAt !== 'number' || !Number.isFinite(body.exportedAt)) return null;
  if (!isObject(body.settings)) return null;
  const choices = body.emotionTagSettings;
  if (!isObject(choices) || !Array.isArray(choices.hidden)) return null;
  if (!choices.hidden.every((id) => typeof id === 'string')) return null;
  const { accounts, instruments, trades } = body;
  if (!Array.isArray(accounts) || !accounts.every(isNamed)) return null;
  if (!Array.isArray(instruments) || !instruments.every(isNamed)) return null;
  if (!Array.isArray(trades) || !trades.every(isTrade)) return null;
  return body as unknown as ExportData;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 保存するファイルの名前（端末の時間帯の日付） */
export function exportFileName(kind: ExportKind, at: number): string {
  const d = new Date(at);
  return `loss-note-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${kind}`;
}

/** 保存するファイルの種類（Blob の type） */
export const EXPORT_MIME: Readonly<Record<ExportKind, string>> = {
  json: 'application/json',
  csv: 'text/csv;charset=utf-8',
};

/** 画面の文言 */
export const EXPORT_TEXT = {
  title: 'データの書き出し',
  lead: '記録を手元のファイルに書き出します。書き出すのはこのアカウントの記録だけです。',
  json: {
    label: 'JSON で書き出す',
    note: '設定・口座・銘柄・取引のすべて（心理のタグとその選択肢を含む）',
  },
  csv: {
    label: 'CSV で書き出す',
    note: '取引を 1 行 1 件で（判定・R・損益つき。表計算ソフトで開けます）',
  },
  excluded: 'チャートの画像は含まれません（形式と大きさだけを JSON に含めます）。',
  busy: '書き出しています…',
  failed: '書き出せませんでした。通信状況を確認して、もう一度押してください。',
} as const;

/** 書き出した後の文（ファイルの名前つき） */
export function exportDoneText(name: string): string {
  return `${name} を書き出しました`;
}
