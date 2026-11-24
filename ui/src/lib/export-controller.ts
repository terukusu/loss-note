// データの書き出し（#167）の通信と状態。DOM を持たない。保存は差し込み（save = download.ts の saveTextFile）。
// - 押したら GET /api/export を 1 回。形を確かめ、JSON は応答の文字をそのまま・CSV は export-csv.ts で組み立てて save に渡す
// - 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）。401・ログインしていない = ログインが切れた。ほかは書き出せなかった
// - 書き出している間に重ねて押されたら何もしない（二重に送らない）。終わったらもう一度押せる
import { exportCsv } from './export-csv';
import {
  EXPORT_PATH,
  EXPORT_TEXT,
  type ExportKind,
  exportDoneText,
  exportFileName,
  parseExport,
  type SavedFile,
} from './export-data';
import { type ApiFn, AUTH_EXPIRED, createRequest, Failed, kindOf } from './request';

/** 書き出しの時間の上限（全件を 1 回で読むので、ほかの要求より長くする） */
export const EXPORT_TIMEOUT_MS = 60_000;

export type ExportState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy'; readonly kind: ExportKind }
  | { readonly phase: 'done'; readonly kind: ExportKind; readonly text: string }
  | {
      readonly phase: 'failed';
      readonly kind: ExportKind;
      readonly text: string;
      readonly auth: boolean;
    };

export interface ExportController {
  getState(): ExportState;
  subscribe(fn: (s: ExportState) => void): () => void;
  run(kind: ExportKind): Promise<void>;
}

export function createExportController(deps: {
  readonly api: ApiFn;
  readonly save: (file: SavedFile) => void;
}): ExportController {
  const request = createRequest(deps.api, EXPORT_TIMEOUT_MS);
  let state: ExportState = { phase: 'idle' };
  const subs = new Set<(s: ExportState) => void>();
  const set = (next: ExportState) => {
    state = next;
    for (const fn of subs) fn(state);
  };

  const run = async (kind: ExportKind) => {
    set({ phase: 'busy', kind });
    try {
      const res = await request(EXPORT_PATH);
      if (res.status !== 200) throw new Failed('other');
      let raw: string;
      let body: unknown;
      try {
        raw = await res.text();
        body = JSON.parse(raw);
      } catch {
        throw new Failed('other');
      }
      const data = parseExport(body);
      if (data === null) throw new Failed('other');
      const name = exportFileName(kind, data.exportedAt);
      deps.save({ name, kind, text: kind === 'json' ? raw : exportCsv(data) });
      set({ phase: 'done', kind, text: exportDoneText(name) });
    } catch (e) {
      const auth = kindOf(e) === 'auth';
      set({ phase: 'failed', kind, text: auth ? AUTH_EXPIRED : EXPORT_TEXT.failed, auth });
    }
  };

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    run(kind) {
      if (state.phase === 'busy') return Promise.resolve();
      return run(kind);
    },
  };
}
