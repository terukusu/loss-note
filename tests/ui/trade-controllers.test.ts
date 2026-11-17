// 一覧・詳細・直すの controller（Issue #9 契約 U-1〜U-3・AC-2〜AC-4）。偽の API。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  createEditController,
  EDIT_LOAD_FAILED,
  EDIT_NETWORK_FAILED,
  EDIT_SAVE_FAILED,
} from '../../ui/src/lib/edit-controller';
import { EDIT_BLOCKED } from '../../ui/src/lib/edit-form';
import type { ImageType } from '../../ui/src/lib/image-limits';
import { reasonText } from '../../ui/src/lib/reasons';
import { summarize } from '../../ui/src/lib/record-form';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import type { PreviewHandle } from '../../ui/src/lib/statement-image';
import {
  createTradeDetailController,
  DETAIL_LOAD_FAILED,
} from '../../ui/src/lib/trade-detail-controller';
import { createTradesController, TRADES_LOAD_FAILED } from '../../ui/src/lib/trades-controller';
import { createFakeApi } from './helpers/fake-api';
import { CAPITAL_NOW, D1, D2, E1, E2, L1, L2, L3, pngHead, US30 } from './helpers/trade-examples';

const ENTRY_BYTES = pngHead(320, 200, 11);
const EXIT_BYTES = pngHead(640, 400, 17);
const chartData = { 'd1-entry': ENTRY_BYTES, 'd1-exit': EXIT_BYTES, 'd2-entry': ENTRY_BYTES };

/** 偽の preview（受けたバイト列を残す。close を数える） */
function fakePreviewer() {
  const got: { bytes: Uint8Array; type: ImageType; closed: boolean }[] = [];
  const preview = async (bytes: Uint8Array, type: ImageType): Promise<PreviewHandle> => {
    const rec = { bytes, type, closed: false };
    got.push(rec);
    return {
      width: 1,
      height: 1,
      draw: () => {},
      close: () => {
        rec.closed = true;
      },
    };
  };
  return { got, preview };
}

const settle = () => new Promise((ok) => setTimeout(ok, 0));

describe('一覧・ホームの controller', () => {
  it('取引と銘柄を並行に読み、ready', async () => {
    const fake = createFakeApi({ trades: [L1, L2, L3], instruments: [US30] });
    const c = createTradesController({ api: fake.api });
    await c.load();
    const s = c.getState();
    expect(s.phase).toBe('ready');
    if (s.phase !== 'ready') return;
    expect(s.trades.map((t) => t.id)).toEqual(['l2', 'l3', 'l1']);
    expect(s.instruments).toEqual([US30]);
    expect(fake.calls.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/instruments',
      'GET /api/trades',
    ]);
  });

  it('失敗は決まった文言（401 = ログインが切れた）。応答の本文を持たない', async () => {
    for (const [f, msg, kind] of [
      [503, TRADES_LOAD_FAILED, 'other'],
      ['throw', TRADES_LOAD_FAILED, 'network'],
      [401, AUTH_EXPIRED, 'auth'],
    ] as const) {
      const fake = createFakeApi({ fail: { 'GET /api/trades': f } });
      const c = createTradesController({ api: fake.api });
      await c.load();
      expect(c.getState()).toEqual({ phase: 'loadFailed', error: msg, errorKind: kind });
      expect(JSON.stringify(c.getState())).not.toContain('偽物');
    }
  });

  it('dispose の後に届いた応答は捨てる', async () => {
    const fake = createFakeApi({ trades: [L1] });
    fake.hold();
    const c = createTradesController({ api: fake.api });
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.phase));
    const p = c.load();
    c.dispose();
    fake.release();
    await p;
    expect(seen).toEqual(['loading', 'loading']);
  });
});

describe('詳細の controller（AC-2・AC-3）', () => {
  it('AC-2: D1 の判定・R・リスクと 2 つの理由', async () => {
    const fake = createFakeApi({ trades: [D1], instruments: [US30], chartData });
    const pv = fakePreviewer();
    const c = createTradeDetailController({ api: fake.api, id: 'd1', preview: pv.preview });
    await c.load();
    const s = c.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(s.summary.judgment?.grade).toBe('B');
    expect(s.summary.r).toBeCloseTo(-1.6, 9);
    expect(s.summary.riskPct).toBeCloseTo(0.5, 9);
    expect(s.summary.judgment?.reasons.map((r) => reasonText(r, 'L'))).toEqual([
      'LC を下げた（99.5 → 99.2）',
      '時間足を変えた（4 時間足 → 日足・チャートから）',
    ]);
    expect(s.instrumentName).toBe('US30');
  });

  it('AC-3: D1 は 2 枠とも API から読んだバイト列を preview に渡す', async () => {
    const fake = createFakeApi({ trades: [D1], instruments: [US30], chartData });
    const pv = fakePreviewer();
    const c = createTradeDetailController({ api: fake.api, id: 'd1', preview: pv.preview });
    await c.load();
    const s = c.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(s.charts.entry.phase).toBe('ready');
    expect(s.charts.exit.phase).toBe('ready');
    expect(pv.got.map((g) => [Array.from(g.bytes), g.type])).toEqual([
      [Array.from(ENTRY_BYTES), 'image/png'],
      [Array.from(EXIT_BYTES), 'image/png'],
    ]);
    expect(fake.calls.filter((x) => x.path.includes('/charts/')).map((x) => x.path)).toEqual([
      '/api/trades/d1/charts/entry',
      '/api/trades/d1/charts/exit',
    ]);
    // 離れたら close
    c.dispose();
    expect(pv.got.every((g) => g.closed)).toBe(true);
  });

  it('AC-3: D2 は決済時の枠が none で、チャートの GET を送らない', async () => {
    const fake = createFakeApi({ trades: [D2], instruments: [US30], chartData });
    const pv = fakePreviewer();
    const c = createTradeDetailController({ api: fake.api, id: 'd2', preview: pv.preview });
    await c.load();
    const s = c.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(s.charts.entry.phase).toBe('ready');
    expect(s.charts.exit).toEqual({ phase: 'none' });
    expect(fake.calls.filter((x) => x.path.includes('/charts/')).map((x) => x.path)).toEqual([
      '/api/trades/d2/charts/entry',
    ]);
    expect(s.summary.judgment?.reasons.map((r) => r.kind)).not.toContain('timeframeLonger');
  });

  it('チャートが読めない（404・画像でない・preview の失敗）枠は failed。reloadChart でその枠だけ読み直す', async () => {
    const fake = createFakeApi({
      trades: [D1],
      instruments: [US30],
      chartData: { 'd1-entry': ENTRY_BYTES, 'd1-exit': new Uint8Array([1, 2, 3]) },
      failOnce: { 'GET /api/trades/d1/charts/entry': 500 },
    });
    const pv = fakePreviewer();
    const c = createTradeDetailController({ api: fake.api, id: 'd1', preview: pv.preview });
    await c.load();
    let s = c.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(s.charts.entry).toEqual({ phase: 'failed' });
    expect(s.charts.exit).toEqual({ phase: 'failed' });
    expect(pv.got).toHaveLength(0);
    await c.reloadChart('entry');
    s = c.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(s.charts.entry.phase).toBe('ready');
    expect(s.charts.exit).toEqual({ phase: 'failed' });
  });

  it('404（無い ID・ほかの利用者の取引）は notFound', async () => {
    const fake = createFakeApi({ trades: [D1] });
    const c = createTradeDetailController({
      api: fake.api,
      id: 'no-such',
      preview: fakePreviewer().preview,
    });
    await c.load();
    expect(c.getState()).toEqual({ phase: 'notFound' });
  });

  it('読めない → 決まった文言', async () => {
    const fake = createFakeApi({ trades: [D1], fail: { 'GET /api/trades/d1': 503 } });
    const c = createTradeDetailController({
      api: fake.api,
      id: 'd1',
      preview: fakePreviewer().preview,
    });
    await c.load();
    expect(c.getState()).toEqual({
      phase: 'loadFailed',
      error: DETAIL_LOAD_FAILED,
      errorKind: 'other',
    });
  });

  it('dispose の後に届いたチャートは close して捨てる', async () => {
    const fake = createFakeApi({ trades: [D1], instruments: [US30], chartData });
    const pv = fakePreviewer();
    let release: () => void = () => {};
    const gate = new Promise<void>((ok) => {
      release = ok;
    });
    const c = createTradeDetailController({
      api: fake.api,
      id: 'd1',
      preview: async (b, t) => {
        await gate;
        return pv.preview(b, t);
      },
    });
    const p = c.load();
    await settle();
    await settle();
    c.dispose();
    release();
    await p;
    expect(pv.got.length).toBeGreaterThan(0);
    expect(pv.got.every((g) => g.closed)).toBe(true);
  });
});

const put = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((x) => x.method === 'PUT');

describe('直すの controller（AC-4）', () => {
  it('E1: 「そのまま」でプレビュー A・−1.0R・0.5%（今の資金 2,000,000 円の 0.3% にならない）、保存後も同じ', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30], capitalYen: CAPITAL_NOW });
    const c = createEditController({ api: fake.api, id: 'e1' });
    await c.load();
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().preview.judgment?.grade).toBe('B');
    c.update({ type: 'set', field: 'lcMove', value: 'none' });
    const s = c.getState();
    expect(s.preview.judgment?.grade).toBe('A');
    expect(s.preview.r).toBeCloseTo(-1, 9);
    expect(s.preview.riskPct).toBeCloseTo(0.5, 9);
    await c.save();
    const after = c.getState();
    expect(after.phase).toBe('saved');
    expect(put(fake)).toHaveLength(1);
    const saved = after.trade as StoredTrade;
    expect(saved.snapshot).toEqual(E1.snapshot);
    const sum = summarize(saved);
    expect(sum.judgment?.grade).toBe('A');
    expect(sum.r).toBeCloseTo(-1, 9);
    expect(sum.riskPct).toBeCloseTo(0.5, 9);
    // 設定の GET はしない（今の設定を使わない）
    expect(fake.calls.some((x) => x.path === '/api/settings')).toBe(false);
  });

  it('E2: チャートの無い枠の時間足を出し、何も変えずに保存で 200、保存後 A', async () => {
    const fake = createFakeApi({ trades: [E2], instruments: [US30] });
    const c = createEditController({ api: fake.api, id: 'e2' });
    await c.load();
    const s = c.getState();
    expect(s.orphans).toEqual([
      { slot: 'entry', timeframe: '4h' },
      { slot: 'exit', timeframe: '1d' },
    ]);
    expect(s.preview.judgment?.grade).toBe('A');
    await c.save();
    expect(c.getState().phase).toBe('saved');
    const body = put(fake)[0]?.body as Record<string, unknown>;
    expect(body.entryChartTimeframe).toBeUndefined();
    expect(body.exitChartTimeframe).toBeUndefined();
    expect(summarize(c.getState().trade as StoredTrade).judgment?.grade).toBe('A');
  });

  it('銘柄を一覧に無い名前に変えると足してから PUT（snapshot の銘柄の値だけ写し直す）', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const c = createEditController({ api: fake.api, id: 'e1' });
    await c.load();
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数Z' });
    await c.save();
    const methods = fake.calls
      .filter((x) => x.method !== 'GET')
      .map((x) => `${x.method} ${x.path}`);
    expect(methods).toEqual(['POST /api/instruments', 'PUT /api/trades/e1']);
    const saved = c.getState().trade as StoredTrade;
    expect(saved.record.instrumentId).toBe('inst-new-1');
    expect(saved.snapshot.capitalYen).toBe(E1.snapshot.capitalYen);
  });

  it('二度押しは 1 回', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const c = createEditController({ api: fake.api, id: 'e1' });
    await c.load();
    fake.hold();
    const a = c.save();
    const b = c.save();
    expect(a).toBe(b);
    fake.release();
    await a;
    expect(put(fake)).toHaveLength(1);
  });

  it('失敗の文言（400・503 / 通信 / 401）。入力は残り、もう一度押せる', async () => {
    for (const [f, msg] of [
      [400, EDIT_SAVE_FAILED],
      [503, EDIT_SAVE_FAILED],
      ['throw', EDIT_NETWORK_FAILED],
      [401, AUTH_EXPIRED],
    ] as const) {
      const fake = createFakeApi({
        trades: [E1],
        instruments: [US30],
        failOnce: { 'PUT /api/trades/e1': f },
      });
      const c = createEditController({ api: fake.api, id: 'e1' });
      await c.load();
      c.update({ type: 'set', field: 'lcMove', value: 'none' });
      await c.save();
      const s = c.getState();
      expect(s.phase).toBe('editing');
      expect(s.error).toBe(msg);
      expect(s.draft.lcMove).toBe('none');
      expect(JSON.stringify(s)).not.toContain('偽物');
      await c.save();
      expect(c.getState().phase).toBe('saved');
    }
  });

  it('404 は notFound、建てが複数は blocked、読めないは決まった文言', async () => {
    const multi: StoredTrade = {
      ...L1,
      id: 'm1',
      record: { ...L1.record, entries: [L1.record.entries[0], L1.record.entries[0]] },
    };
    const fake = createFakeApi({ trades: [multi], instruments: [US30] });
    const a = createEditController({ api: fake.api, id: 'nope' });
    await a.load();
    expect(a.getState().phase).toBe('notFound');
    const b = createEditController({ api: fake.api, id: 'm1' });
    await b.load();
    expect(b.getState().phase).toBe('blocked');
    expect(b.getState().block).toBe(EDIT_BLOCKED);
    const bad = createFakeApi({ trades: [L1], fail: { 'GET /api/trades/l1': 503 } });
    const c = createEditController({ api: bad.api, id: 'l1' });
    await c.load();
    expect(c.getState().phase).toBe('loadFailed');
    expect(c.getState().error).toBe(EDIT_LOAD_FAILED);
    // 保存できない状態では送らない
    await c.save();
    expect(bad.calls.some((x) => x.method === 'PUT')).toBe(false);
  });
});
