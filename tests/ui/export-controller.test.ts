// データの書き出しの通信と状態（Issue #167 の AC-8・例 E9）と、書き出しの画面の描画（AC-6 の行き先）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { NotSignedIn } from '../../ui/src/lib/api';
import { createExportController, type ExportState } from '../../ui/src/lib/export-controller';
import { BOM, CSV_COLUMNS } from '../../ui/src/lib/export-csv';
import {
  EXPORT_FORMAT,
  EXPORT_PATH,
  EXPORT_TEXT,
  exportFileName,
  type SavedFile,
} from '../../ui/src/lib/export-data';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import { Link } from '../../ui/src/lib/router';
import { SettingsExportView } from '../../ui/src/pages/SettingsExport';
import { defaultAccount } from './helpers/accounts';
import { L1, T_1112, US30 } from './helpers/trade-examples';

const BODY = {
  format: EXPORT_FORMAT,
  version: 1,
  exportedAt: T_1112,
  settings: {
    capitalYen: 1_000_000,
    riskTolerancePct: 1,
    performanceUnit: 'R',
    capitalHistory: [],
  },
  emotionTagSettings: { hidden: [] },
  accounts: [defaultAccount(1_000_000)],
  instruments: [US30],
  trades: [L1],
};
const RAW = JSON.stringify(BODY);

function setup(respond: () => Promise<Response> | Response) {
  const calls: string[] = [];
  const saved: SavedFile[] = [];
  const c = createExportController({
    api: async (path) => {
      calls.push(path);
      return respond();
    },
    save: (f) => saved.push(f),
  });
  const states: ExportState[] = [];
  c.subscribe((s) => states.push(s));
  return { c, calls, saved, states };
}

describe('書き出しの controller（AC-8）', () => {
  it('JSON: GET /api/export を 1 回、応答の文字をそのまま日付の名前で保存し、名前つきの文', async () => {
    const { c, calls, saved } = setup(() => new Response(RAW, { status: 200 }));
    await c.run('json');
    expect(calls).toEqual([EXPORT_PATH]);
    expect(saved).toEqual([{ name: exportFileName('json', T_1112), kind: 'json', text: RAW }]);
    expect(c.getState()).toEqual({
      phase: 'done',
      kind: 'json',
      text: `${exportFileName('json', T_1112)} を書き出しました`,
    });
  });

  it('CSV: 同じ応答から CSV を組み立てて保存（見出し + 1 行）', async () => {
    const { c, saved } = setup(() => new Response(RAW, { status: 200 }));
    await c.run('csv');
    const [file] = saved;
    expect(file?.name).toBe(exportFileName('csv', T_1112));
    expect(file?.kind).toBe('csv');
    expect(file?.text.startsWith(`${BOM}${CSV_COLUMNS.join(',')}\r\n`)).toBe(true);
    expect(file?.text.trimEnd().split('\r\n')).toHaveLength(2);
  });

  it('E9: 503 は決まった文言で、保存しない。もう一度押せる（2 回目は成功）', async () => {
    let status = 503;
    const { c, saved, calls } = setup(() =>
      status === 200
        ? new Response(RAW, { status })
        : new Response('{"error":"unavailable"}', { status }),
    );
    await c.run('csv');
    expect(c.getState()).toEqual({
      phase: 'failed',
      kind: 'csv',
      text: EXPORT_TEXT.failed,
      auth: false,
    });
    expect(saved).toEqual([]);
    status = 200;
    await c.run('csv');
    expect(calls).toHaveLength(2);
    expect(c.getState().phase).toBe('done');
    expect(saved).toHaveLength(1);
  });

  it.each([
    ['形の違う本文', () => new Response('{"format":"x"}', { status: 200 })],
    ['JSON でない本文', () => new Response('<html>', { status: 200 })],
    ['通信の失敗', () => Promise.reject(new TypeError('network'))],
  ])('%s は書き出せなかった（応答の中身を文に出さない）', async (_n, respond) => {
    const { c, saved } = setup(respond);
    await c.run('json');
    const s = c.getState();
    expect(s.phase === 'failed' && s.text).toBe(EXPORT_TEXT.failed);
    expect(saved).toEqual([]);
  });

  it('401・ログインしていない = ログインが切れた', async () => {
    for (const respond of [
      () => new Response('{}', { status: 401 }),
      () => Promise.reject(new NotSignedIn()),
    ]) {
      const { c } = setup(respond);
      await c.run('json');
      expect(c.getState()).toEqual({
        phase: 'failed',
        kind: 'json',
        text: AUTH_EXPIRED,
        auth: true,
      });
    }
  });

  it('書き出している間に重ねて押しても二重に送らない', async () => {
    let release: (r: Response) => void = () => {};
    const { c, calls, states } = setup(() => new Promise<Response>((ok) => (release = ok)));
    const first = c.run('json');
    await c.run('csv');
    expect(calls).toHaveLength(1);
    expect(c.getState()).toEqual({ phase: 'busy', kind: 'json' });
    release(new Response(RAW, { status: 200 }));
    await first;
    expect(states.map((s) => s.phase)).toEqual(['idle', 'busy', 'done']);
  });
});

// ── 画面（hook を持たない View を要素の木に展開して見る） ──
interface El {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  // Link は context（hook）を読むので a に置き換える
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  if (typeof vn.type === 'function') {
    return expand((vn.type as (p: unknown) => unknown)(vn.props));
  }
  const { children, ...props } = vn.props ?? {};
  return [{ type: vn.type, props, children: expand(children) }];
}
const all = (nodes: Node[], pred: (e: El) => boolean): El[] =>
  nodes.flatMap((n) =>
    typeof n === 'string' ? [] : [...(pred(n) ? [n] : []), ...all(n.children, pred)],
  );
const text = (n: Node | Node[]): string =>
  Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : text(n.children);

const view = (state: ExportState) =>
  expand(
    SettingsExportView({
      back: { label: '設定', href: '/settings' },
      state,
      onExport: () => {},
      onRelogin: () => {},
    }),
  );
const buttons = (tree: Node[]) => all(tree, (e) => e.type === 'button');

describe('書き出しの画面（AC-6・AC-8）', () => {
  it('題「データの書き出し」と JSON・CSV のボタン、画像を含まない旨', () => {
    const tree = view({ phase: 'idle' });
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('データの書き出し');
    expect(buttons(tree).map(text)).toEqual(['JSON で書き出す', 'CSV で書き出す']);
    expect(text(tree)).toContain(EXPORT_TEXT.excluded);
    expect(buttons(tree).every((b) => !b.props.disabled)).toBe(true);
  });

  it('書き出している間はどちらも押せず、押したほうが「書き出しています…」', () => {
    const tree = view({ phase: 'busy', kind: 'csv' });
    expect(buttons(tree).map(text)).toEqual(['JSON で書き出す', '書き出しています…']);
    expect(buttons(tree).every((b) => b.props.disabled === true)).toBe(true);
  });

  it('終わった文は role="status"、失敗は role="alert"（ログインが切れたら ［もう一度ログイン］）', () => {
    const done = view({
      phase: 'done',
      kind: 'json',
      text: 'loss-note-20261124.json を書き出しました',
    });
    expect(text(all(done, (e) => e.props.role === 'status'))).toBe(
      'loss-note-20261124.json を書き出しました',
    );
    const failed = view({ phase: 'failed', kind: 'json', text: EXPORT_TEXT.failed, auth: false });
    expect(text(all(failed, (e) => e.props.role === 'alert'))).toBe(EXPORT_TEXT.failed);
    expect(buttons(failed).every((b) => !b.props.disabled)).toBe(true);
    const auth = view({ phase: 'failed', kind: 'json', text: AUTH_EXPIRED, auth: true });
    expect(buttons(auth).map(text)).toContain('もう一度ログイン');
  });
});
