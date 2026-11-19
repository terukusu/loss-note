// 記録する画面の通信と状態（Issue #13 契約 R-3・AC-1・7・8・9・10・11）。偽の API（tests/ui/helpers/fake-api.ts）で確かめる。
// 値はすべて架空
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { ACCOUNT_MSG } from '../../ui/src/lib/accounts';
import { NotSignedIn } from '../../ui/src/lib/api';
import { floorToMinute, toLocalInput } from '../../ui/src/lib/datetime';
import { formatR } from '../../ui/src/lib/format';
import { reasonText } from '../../ui/src/lib/reasons';
import {
  ACCOUNT_ADD_NETWORK_FAILED,
  ACCOUNT_ADDING,
  AUTH_EXPIRED,
  CHART_LOCKED,
  CHART_MSG,
  CHART_PREPARING,
  CHART_SAVE_TIMEOUT_MS,
  createRecordController,
  enterRecordScreen,
  LOAD_FAILED,
  NETWORK_FAILED,
  READ_BLOCKED,
  READ_PREPARE_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  type RecordController,
  ROWS_DONE,
  SAVE_FAILED,
  sentToAi,
  WARM_REFRESH_MS,
  watchVisible,
} from '../../ui/src/lib/record-controller';
import { applyDraft, type Draft, EMPTY_DRAFT, summarize } from '../../ui/src/lib/record-form';
import {
  READ_FIELDS,
  READ_MSG,
  READING_NOTICE,
  type ReadRow,
  TZ_MISSING,
} from '../../ui/src/lib/statement-fill';
import { type PrepareResult, prepareImage } from '../../ui/src/lib/statement-image';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi, type ReadScript } from './helpers/fake-api';
import { E1, E2, E6, US30 } from './helpers/record-drafts';
import {
  blobOf,
  E1_ENTRY_MS,
  E1_EXIT_MS,
  fakeCodec,
  fakePreview,
  jpegBytes,
  pngBytes,
  preparedImage,
  ROW_E1,
  ROW_E4,
  ROW_E7,
  ROW_E8,
  ROW_E9,
  ROWS_E10,
  statementBody,
} from './helpers/statement-rows';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const MINUS = '−';

function storedTrade(
  id: string,
  instrumentId: string,
  quantity: number,
  createdAt: number,
  exitTime: number,
): StoredTrade {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: null,
      riskTolerancePct: 1,
    },
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId,
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity }],
      exit: {
        time: exitTime,
        price: 99.5,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      fees: [],
    },
  };
}

const OTHER = { ...US30, id: 'inst-other', name: '架空指数B' };

async function opened(fake: FakeApi): Promise<RecordController> {
  const c = createRecordController({ api: fake.api, now: () => NOW });
  await c.load();
  return c;
}

/** 下書きの欄を例の値にそろえる（開いたときの既定の上に入れる） */
function fillFrom(c: RecordController, d: Draft) {
  const values: Partial<Draft> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== (EMPTY_DRAFT as unknown as Record<string, unknown>)[k])
      (values as Record<string, unknown>)[k] = v;
  }
  c.update({ type: 'fill', values });
}

const posts = (fake: FakeApi, path: string) =>
  fake.calls.filter((x) => x.method === 'POST' && x.path === path);

describe('開いたときの既定（AC-9・E14）', () => {
  it('最後に記録した取引（作った時刻が最大）の銘柄・数量、決済の時刻 = 開いた時刻（分まで）。L / S・タップ・LC は空', async () => {
    const fake = createFakeApi({
      instruments: [US30, OTHER],
      // 決済の時刻が新しいのは OTHER だが、最後に記録したのは US30・数量 2
      trades: [
        storedTrade('t-old', OTHER.id, 7, 1_000, 9_000_000),
        storedTrade('t-last', US30.id, 2, 2_000, 5_000_000),
      ],
    });
    const c = await opened(fake);
    const s = c.getState();
    expect(s.phase).toBe('editing');
    expect(s.draft).toEqual({
      ...EMPTY_DRAFT,
      instrumentName: 'US30',
      quantity: '2',
      exitTime: toLocalInput(floorToMinute(NOW)),
      accountId: 'default',
    });
    expect(s.draft.exitTime).toBe('2026-04-05T14:37');
    // 開いたときの要求は 3 つ（取引・銘柄・口座。#47 で設定の代わりに口座）
    expect(fake.calls.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/accounts',
      'GET /api/instruments',
      'GET /api/trades?order=created&limit=1',
    ]);
  });

  it('取引が 0 件なら銘柄・数量は空', async () => {
    const c = await opened(createFakeApi({ instruments: [US30] }));
    expect(c.getState().draft).toEqual({
      ...EMPTY_DRAFT,
      exitTime: '2026-04-05T14:37',
      accountId: 'default',
    });
  });

  it('読み込みに失敗したら決まった文言で、もう一度読み込める', async () => {
    const fake = createFakeApi({ fail: { 'GET /api/accounts': 503 } });
    const c = await opened(fake);
    expect(c.getState().phase).toBe('loadFailed');
    expect(c.getState().error).toBe(LOAD_FAILED);
    expect(JSON.stringify(c.getState())).not.toContain('偽物');
  });
});

describe('E1 を入れて保存し、読み直しても同じ（AC-1。EPIC #10 の終了条件 9）', () => {
  it('保存の前に B・理由・−1.6R → [記録する] → 一覧から読んだ取引で計算し直しても同じ', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, E1);
    const before = c.getState().read;
    expect(before.canSave).toBe(true);
    expect(before.preview.judgment?.grade).toBe('B');
    const beforeTexts = (before.preview.judgment?.reasons ?? []).map((r) => reasonText(r, 'L'));
    expect(beforeTexts).toContain('LC を広げた（99.5 → 99.2）');
    expect(formatR(before.preview.r)).toBe(`${MINUS}1.6R`);

    await c.save();
    const s = c.getState();
    expect(s.phase).toBe('saved');
    expect(posts(fake, '/api/trades')).toHaveLength(1);
    expect(posts(fake, '/api/instruments')).toHaveLength(0);

    // API の取引の一覧から読み直して計算し直す
    const res = await fake.api('/api/trades');
    const { items } = (await res.json()) as { items: StoredTrade[] };
    expect(items).toHaveLength(1);
    const again = summarize(items[0] as StoredTrade);
    expect(again.judgment).toEqual(before.preview.judgment);
    expect(again.r).toBe(before.preview.r);
    expect(again.riskNote).toBe(before.preview.riskNote);
    // 保存の後の表示も同じ
    expect(s.saved?.summary.judgment).toEqual(before.preview.judgment);
    expect(s.saved?.summary.r).toBe(before.preview.r);
    expect((items[0] as StoredTrade).record.instrumentId).toBe(US30.id);
  });
});

describe('入力の誤り・足りないときは送らない（AC-7）', () => {
  it('誤りがあれば保存の要求は 0 件', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'lc', value: '100.5' }));
    expect(c.getState().read.errors.lc).toBeDefined();
    await c.save();
    expect(fake.calls.filter((x) => x.method !== 'GET')).toEqual([]);
    expect(c.getState().phase).toBe('editing');
  });

  it('未入力の欄があれば保存の要求は 0 件', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'timeframeChange', value: null }));
    await c.save();
    expect(fake.calls.filter((x) => x.method !== 'GET')).toEqual([]);
  });
});

describe('銘柄（AC-8・E13）', () => {
  it('一覧に無い名前 → 既定の値で銘柄を 1 件足し、取引はその銘柄を指す', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'instrumentName', value: ' 架空指数A ' }));
    await c.save();
    const inst = posts(fake, '/api/instruments');
    expect(inst).toHaveLength(1);
    expect(inst[0]?.body).toEqual({ name: '架空指数A' });
    const added = fake.instruments.find((i) => i.name === '架空指数A');
    expect(added).toMatchObject({ multiplier: 1, quantityStep: 1, priceCurrency: null });
    expect(fake.trades[0]?.record.instrumentId).toBe(added?.id);
    expect(c.getState().instruments.map((i) => i.name)).toContain('架空指数A');
  });

  it('全角・大文字小文字・空白だけが違う名前（「ｕｓ３０ 」）は銘柄を増やさず US30 を指す', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'instrumentName', value: 'ｕｓ３０ ' }));
    await c.save();
    expect(posts(fake, '/api/instruments')).toHaveLength(0);
    expect(fake.trades[0]?.record.instrumentId).toBe(US30.id);
  });

  it('409（ほかで同じ名前が先に足された）なら一覧を取り直して、その銘柄を指す', async () => {
    const raced = { ...US30, id: 'inst-raced', name: '架空指数A' };
    const fake = createFakeApi({ instruments: [US30], conflictOnce: raced });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'instrumentName', value: '架空指数A' }));
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(fake.trades[0]?.record.instrumentId).toBe('inst-raced');
  });

  it('409 で取り直しても見つからなければ決まった文言', async () => {
    const fake = createFakeApi({ instruments: [US30], fail: { 'POST /api/instruments': 409 } });
    const c = await opened(fake);
    fillFrom(c, applyDraft(E1, { type: 'set', field: 'instrumentName', value: '架空指数A' }));
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().error).toBe(SAVE_FAILED);
    expect(posts(fake, '/api/trades')).toHaveLength(0);
  });
});

describe('保存の失敗と二度押し（AC-10・E15）', () => {
  it.each([
    [503, SAVE_FAILED],
    [400, SAVE_FAILED],
    ['throw', NETWORK_FAILED],
    [401, AUTH_EXPIRED],
  ] as const)(
    'POST /api/trades が %s → 決まった文言、入力は残る、応答の本文・例外の文字列は状態に無い',
    async (f, msg) => {
      const fake = createFakeApi({ instruments: [US30], fail: { 'POST /api/trades': f } });
      const c = await opened(fake);
      fillFrom(c, E1);
      const draftBefore = c.getState().draft;
      await c.save();
      const s = c.getState();
      expect(s.phase).toBe('editing');
      expect(s.error).toBe(msg);
      expect(s.errorKind).toBe(
        msg === AUTH_EXPIRED ? 'auth' : msg === NETWORK_FAILED ? 'network' : 'other',
      );
      expect(s.draft).toEqual(draftBefore);
      const dump = JSON.stringify(s);
      expect(dump).not.toContain('偽物');
      expect(dump).not.toContain('secret');
    },
  );

  it('失敗の後に入力を直すと、失敗の文言は消える', async () => {
    const fake = createFakeApi({ instruments: [US30], fail: { 'POST /api/trades': 503 } });
    const c = await opened(fake);
    fillFrom(c, E1);
    await c.save();
    c.update({ type: 'set', field: 'brokenCondition', value: '99.50 を割ったら崩れ' });
    expect(c.getState().error).toBeNull();
  });

  it('続けて 2 回押しても保存の要求は 1 件（実行中は同じ Promise）', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, E1);
    fake.hold();
    const a = c.save();
    const b = c.save();
    expect(a).toBe(b);
    expect(c.getState().phase).toBe('saving');
    // 保存中は入力を受けない
    c.update({ type: 'set', field: 'exitPrice', value: '1' });
    expect(c.getState().draft.exitPrice).toBe('99.20');
    fake.release();
    await Promise.all([a, b]);
    await c.save();
    expect(posts(fake, '/api/trades')).toHaveLength(1);
    expect(fake.trades).toHaveLength(1);
  });
});

describe('保存の後（[次の取引を記録]）', () => {
  it('空の入力に戻し、既定は今保存した取引の銘柄・数量と今の時刻。API を読み直さない', async () => {
    const fake = createFakeApi({ instruments: [US30], capitalYen: 1_000_000 });
    let now = NOW;
    const c = createRecordController({ api: fake.api, now: () => now });
    await c.load();
    fillFrom(
      c,
      applyDraft(E2, { type: 'fill', values: { instrumentName: '架空指数A', quantity: '3' } }),
    );
    await c.save();
    expect(c.getState().saved?.summary.judgment?.grade).toBe('A');
    const getsBefore = fake.calls.filter((x) => x.method === 'GET').length;
    now = NOW + 5 * 60_000;
    c.next();
    const s = c.getState();
    expect(s.phase).toBe('editing');
    expect(s.saved).toBeUndefined();
    expect(s.draft).toEqual({
      ...EMPTY_DRAFT,
      instrumentName: '架空指数A',
      quantity: '3',
      exitTime: '2026-04-05T14:42',
      accountId: 'default',
    });
    expect(fake.calls.filter((x) => x.method === 'GET').length).toBe(getsBefore);
  });
});

describe('購読', () => {
  it('状態が変わるたびに知らせ、やめた後は知らせない', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = createRecordController({ api: fake.api, now: () => NOW });
    const seen: string[] = [];
    const off = c.subscribe((s) => seen.push(s.phase));
    await c.load();
    expect(seen).toEqual(['loading', 'loading', 'editing']);
    off();
    c.update({ type: 'set', field: 'side', value: 'L' });
    expect(seen).toHaveLength(3);
  });
});

describe('端末に取引の値を書かない（AC-11）', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  afterEach(() => {
    for (const k of ['localStorage', 'sessionStorage', 'indexedDB']) {
      if (saved.has(k)) g[k] = saved.get(k);
      else delete g[k];
    }
    saved.clear();
  });

  it('読み込み → 入力 → 保存 → 次の取引の間、Web Storage・IndexedDB への書き込み・読み出しが 0 件', async () => {
    const touched: string[] = [];
    const spy = (name: string) =>
      new Proxy(
        {},
        {
          get(_t, prop) {
            touched.push(`${name}.${String(prop)}`);
            return () => undefined;
          },
          set(_t, prop) {
            touched.push(`${name}.${String(prop)}=`);
            return true;
          },
        },
      );
    for (const k of ['localStorage', 'sessionStorage', 'indexedDB']) {
      if (k in g) saved.set(k, g[k]);
      g[k] = spy(k);
    }
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(
      c,
      applyDraft(E1, { type: 'set', field: 'brokenCondition', value: '99.50 を割ったら崩れ' }),
    );
    await c.save();
    c.next();
    expect(c.getState().phase).toBe('editing');
    expect(touched).toEqual([]);
  });
});

describe('ログインが切れた・つながらない（レビュー指摘 4）', () => {
  it('読み込みが 401 → 「ログインが切れました」（auth）', async () => {
    const c = await opened(createFakeApi({ fail: { 'GET /api/trades': 401 } }));
    expect(c.getState().phase).toBe('loadFailed');
    expect(c.getState().error).toBe(AUTH_EXPIRED);
    expect(c.getState().errorKind).toBe('auth');
  });

  it('ログインしていない（NotSignedIn）も auth', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = createRecordController({
      api: (path, init) => {
        if (init?.method === 'POST') return Promise.reject(new NotSignedIn());
        return fake.api(path, init);
      },
      now: () => NOW,
    });
    await c.load();
    fillFrom(c, E1);
    await c.save();
    expect(c.getState().error).toBe(AUTH_EXPIRED);
  });

  it('時間切れ → 「つながりません」。届いていたら、押し直しても送り直さず、届いた取引を出す', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = createRecordController({ api: fake.api, now: () => NOW, timeoutMs: 20 });
    await c.load();
    fillFrom(c, E1);
    fake.hold();
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().error).toBe(NETWORK_FAILED);
    expect(c.getState().errorKind).toBe('network');
    // 遅れて API に届き、保存された
    fake.release();
    await new Promise((ok) => setTimeout(ok, 0));
    expect(fake.trades).toHaveLength(1);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(posts(fake, '/api/trades')).toHaveLength(1);
    expect(fake.trades).toHaveLength(1);
    expect(c.getState().saved?.trade.id).toBe(fake.trades[0]?.id);
  });

  it('通信の失敗で届いていなければ、押し直したときに送り直して 1 件だけ保存する', async () => {
    const fake = createFakeApi({ instruments: [US30], failOnce: { 'POST /api/trades': 'throw' } });
    const c = await opened(fake);
    fillFrom(c, E1);
    await c.save();
    expect(c.getState().error).toBe(NETWORK_FAILED);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(posts(fake, '/api/trades')).toHaveLength(2);
    expect(fake.trades).toHaveLength(1);
    // 届いたかの確かめは作った時刻の新しい順の先頭 10 件だけを読む（#87。全件を読まない）
    expect(
      fake.calls
        .filter((x) => x.method === 'GET' && x.path.startsWith('/api/trades'))
        .map((x) => x.path),
    ).toEqual(['/api/trades?order=created&limit=1', '/api/trades?order=created&limit=10']);
  });

  it('時間切れの後に入力を直したら、別の本文として送る', async () => {
    const fake = createFakeApi({ instruments: [US30], failOnce: { 'POST /api/trades': 'throw' } });
    const c = await opened(fake);
    fillFrom(c, E1);
    await c.save();
    c.update({ type: 'set', field: 'brokenCondition', value: '架空の一言' });
    await c.save();
    expect(c.getState().phase).toBe('saved');
    // 取引の一覧の読みは開いたときの 1 回だけ（別の本文なので、届いたかの確かめは読まない。#87 で件数つきのパス）
    const gets = fake.calls.filter((x) => x.method === 'GET' && x.path.startsWith('/api/trades'));
    expect(gets.map((x) => x.path)).toEqual(['/api/trades?order=created&limit=1']);
  });
});

describe('既定の数量は指数表記にしない（レビュー指摘 5）', () => {
  it('最後の数量が 1e-7 → 「0.0000001」で、誤りにならない', async () => {
    const c = await opened(
      createFakeApi({ instruments: [US30], trades: [storedTrade('t', US30.id, 1e-7, 5, 5)] }),
    );
    expect(c.getState().draft.quantity).toBe('0.0000001');
    expect(c.getState().read.errors.quantity).toBeUndefined();
  });
});

describe('「窓・滑りでしたか」の問いが消えたら答えも消す（レビュー指摘 9）', () => {
  it('E6 で「はい」→ 決済を 100 に直す → 答えは未回答、戻しても選ばれていない', async () => {
    const c = await opened(createFakeApi({ instruments: [US30] }));
    fillFrom(c, E6);
    c.update({ type: 'set', field: 'gapSlip', value: 'yes' });
    expect(c.getState().draft.gapSlip).toBe('yes');
    expect(c.getState().read.preview.judgment?.grade).toBe('A');
    c.update({ type: 'set', field: 'exitPrice', value: '100' });
    expect(c.getState().read.preview.showGapSlip).toBe(false);
    expect(c.getState().draft.gapSlip).toBe('unanswered');
    c.update({ type: 'set', field: 'exitPrice', value: '99.40' });
    expect(c.getState().read.preview.showGapSlip).toBe(true);
    expect(c.getState().draft.gapSlip).toBe('unanswered');
    expect(c.getState().read.preview.judgment?.grade).toBe('B');
  });
});

// ── 決済明細の読み取り（Issue #15）。偽の記録の API の POST /api/statement-reads と偽の描き直しで流す ──

const B = { ...US30, id: 'inst-b', name: '架空指数B' };

/** 開いたときの既定 = 前回の銘柄「架空指数B」・数量 1（Issue #15 の例の表の前提） */
async function openedForRead(
  reads: readonly ReadScript[],
  over: { prepare?: (f: Blob) => Promise<PrepareResult>; readTimeoutMs?: number } = {},
) {
  const fake = createFakeApi({
    instruments: [B],
    trades: [storedTrade('t-b', B.id, 1, 1_000, 2_000)],
    reads,
  });
  const previews: ReturnType<typeof fakePreview>[] = [];
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    prepare:
      over.prepare ??
      (async () => {
        const p = fakePreview();
        previews.push(p);
        return { ok: true, image: preparedImage(p) };
      }),
    ...(over.readTimeoutMs === undefined ? {} : { readTimeoutMs: over.readTimeoutMs }),
  });
  await c.load();
  return { fake, c, previews };
}

/** この流れで保存した取引（開く前からある t-b を除く） */
const added = (fake: FakeApi) => fake.trades.filter((t) => t.id !== 't-b');
const ok = (rows: readonly ReadRow[]): ReadScript => ({ status: 200, body: statementBody(rows) });
const readCalls = (fake: FakeApi) => fake.calls.filter((x) => x.path === '/api/statement-reads');
const img = () => blobOf(pngBytes(1200, 800, 2048));

/** 条件が成り立つまで待つ（マイクロタスク・タイマーを回す） */
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

/** 手で打つ欄 2 つ（LC・一言）と選ぶ欄 3 つ */
function typeFive(c: RecordController, lc = '99.0') {
  const texts = [
    { type: 'set', field: 'lc', value: lc },
    { type: 'set', field: 'brokenCondition', value: '押し目の安値を割ったら' },
  ] as const;
  const taps = [
    { type: 'set', field: 'lcDecided', value: true },
    { type: 'set', field: 'lcMove', value: 'none' },
    { type: 'set', field: 'timeframeChange', value: 'none' },
  ] as const;
  for (const a of [...texts, ...taps]) c.update(a);
  return { typed: texts.length, chosen: taps.length };
}

describe('読み取りの要求（AC-1）', () => {
  it('画像 1 枚で要求が 1 件（Content-Type は描き直した形式・500,000 B 以下）。もう 1 枚でもう 1 件', async () => {
    const codec = fakeCodec(() => 280_000);
    const { fake, c } = await openedForRead([ok([ROW_E1]), ok([ROW_E1])], {
      prepare: (f) => prepareImage(f, codec),
    });
    await c.readImage(blobOf(jpegBytes(1200, 800, 300_000), 'image/jpeg'));
    expect(readCalls(fake)).toEqual([
      { method: 'POST', path: '/api/statement-reads', contentType: 'image/png', bytes: 280_000 },
    ]);
    await c.readImage(img());
    expect(readCalls(fake)).toHaveLength(2);
    // 応答だけでは保存しない（AC-8）
    expect(posts(fake, '/api/trades')).toHaveLength(0);
  });

  it('E12: 画像として読めないファイル → 要求 0 件・決まった文言', async () => {
    const codec = fakeCodec(() => 1000);
    const { fake, c } = await openedForRead([], { prepare: (f) => prepareImage(f, codec) });
    await c.readImage(new Blob(['架空の文字のファイル'], { type: 'text/plain' }));
    expect(readCalls(fake)).toHaveLength(0);
    expect(c.getState().statement?.phase).toBe('failed');
    expect(c.getState().statement?.message).toBe(READ_MSG.notImage);
  });

  it('大きすぎて描き直せない → 要求 0 件・「この画像は読み取れません」', async () => {
    const codec = fakeCodec(() => 900_000);
    const { fake, c } = await openedForRead([], { prepare: (f) => prepareImage(f, codec) });
    await c.readImage(img());
    expect(readCalls(fake)).toHaveLength(0);
    expect(c.getState().statement?.message).toBe(READ_MSG.rejected);
  });
});

describe('待たずに入れる（AC-3・C23）', () => {
  it('読み取り中に LC・一言・3 つのタップを入れられ、保存は 0 件・理由「明細を読み取っています」。応答の後も残る', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    expect(c.getState().statement?.phase).toBe('reading');
    typeFive(c);
    const during = c.getState();
    expect(during.draft).toMatchObject({
      lc: '99.0',
      brokenCondition: '押し目の安値を割ったら',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange: 'none',
    });
    expect(during.read.canSave).toBe(false);
    expect(during.read.notice).toBe(READING_NOTICE);
    await c.save();
    expect(posts(fake, '/api/trades')).toHaveLength(0);
    fake.releaseReads();
    await p;
    const after = c.getState();
    expect(after.statement?.phase).toBe('ready');
    expect(after.draft).toMatchObject({
      lc: '99.0',
      brokenCondition: '押し目の安値を割ったら',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange: 'none',
    });
    expect(after.read.notice).toBeUndefined();
  });
});

describe('E1（AC-4。EPIC #10 の終了条件 10）', () => {
  it('9 欄に応答の値と「読み取り」の印 → 打つ 2・選ぶ 3 で判定 A・−1.0R → 保存した取引は応答の値・出どころ 明細', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    expect(c.getState().draft.instrumentName).toBe('架空指数B');
    expect(c.getState().draft.quantity).toBe('1');
    await c.readImage(img());
    const s = c.getState();
    expect(s.draft).toMatchObject({
      instrumentName: '架空指数A',
      side: 'L',
      entryPrice: '100',
      exitPrice: '99',
      quantity: '2',
      exitTime: toLocalInput(E1_EXIT_MS),
      entryTime: toLocalInput(E1_ENTRY_MS),
      pnlYen: '-2000',
      feeYen: '150',
    });
    for (const f of READ_FIELDS) expect(s.statement?.marks[f], f).toBe('read');
    const n = typeFive(c);
    expect(n).toEqual({ typed: 2, chosen: 3 });
    const read = c.getState().read;
    expect(read.canSave).toBe(true);
    expect(read.preview.judgment?.grade).toBe('A');
    expect(formatR(read.preview.r)).toBe(`${MINUS}1.0R`);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    const saved = added(fake)[0]?.record;
    expect(saved).toMatchObject({
      source: 'statement',
      side: 'L',
      lc: 99,
      brokenCondition: '押し目の安値を割ったら',
      stopOrderPlaced: 'unanswered',
      entries: [{ price: 100, quantity: 2, time: E1_ENTRY_MS }],
      exit: { time: E1_EXIT_MS, price: 99, orderType: 'unknown', reason: 'other' },
      statementPnlYen: -2000,
      fees: [{ amountYen: 150 }],
    });
    // 一覧に無い銘柄は名前だけで足す（C21）
    expect(posts(fake, '/api/instruments')[0]?.body).toEqual({ name: '架空指数A' });
    // 保存の後はプレビューも行も捨てる
    expect(c.getState().statement).toBeUndefined();
  });
});

describe('E4（AC-5）', () => {
  it('銘柄・決済の時刻は空で「読み取れませんでした」。既定を残さず、入れるまで保存できない', async () => {
    const { c } = await openedForRead([ok([ROW_E4])]);
    await c.readImage(img());
    typeFive(c);
    const s = c.getState();
    expect(s.draft.instrumentName).toBe('');
    expect(s.draft.exitTime).toBe('');
    expect(s.statement?.marks.instrumentName).toBe('unread');
    expect(s.statement?.marks.exitTime).toBe('unread');
    expect(s.read.missing).toEqual(['銘柄', '決済の時刻']);
    expect(s.read.canSave).toBe(false);
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数A' });
    c.update({ type: 'set', field: 'exitTime', value: '2026-11-10T10:30' });
    expect(c.getState().statement?.marks.instrumentName).toBe('edited');
    expect(c.getState().read.canSave).toBe(true);
  });
});

describe('E5・E6（AC-6）', () => {
  it('E5: 決済を 98.5 に直す → 印「直した」・保存の決済は 98.5', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    await c.readImage(img());
    typeFive(c);
    c.update({ type: 'set', field: 'exitPrice', value: '98.5' });
    expect(c.getState().statement?.marks.exitPrice).toBe('edited');
    await c.save();
    expect(added(fake)[0]?.record.exit.price).toBe(98.5);
  });

  it('E6: 貼った後・応答の前に入れたイン 101.0（印なし）と LC 99.0 が残る', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    c.update({ type: 'set', field: 'entryPrice', value: '101.0' });
    c.update({ type: 'set', field: 'lc', value: '99.0' });
    fake.releaseReads();
    await p;
    const s = c.getState();
    expect(s.draft.entryPrice).toBe('101.0');
    expect(s.statement?.marks.entryPrice).toBeUndefined();
    expect(s.draft.lc).toBe('99.0');
    expect(s.draft.exitPrice).toBe('99');
    expect(s.statement?.marks.exitPrice).toBe('read');
  });
});

describe('E7・E8（AC-7）', () => {
  it('E7: 逆指値 → LC・決めていた が既定（印「明細から」）。選ぶのは残り 2 つ。保存は 逆指値・入れた', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E7])]);
    await c.readImage(img());
    const s = c.getState();
    expect(s.draft.lcDecided).toBe(true);
    expect(s.draft.exitReason).toBe('lc');
    expect(s.statement?.marks.lcDecided).toBe('statement');
    c.update({ type: 'set', field: 'lc', value: '99.0' });
    c.update({ type: 'set', field: 'lcMove', value: 'none' });
    c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
    expect(c.getState().read.canSave).toBe(true);
    await c.save();
    const r = added(fake)[0]?.record;
    expect(r?.exit.orderType).toBe('stop');
    expect(r?.exit.reason).toBe('lc');
    expect(r?.stopOrderPlaced).toBe('placed');
    expect(r?.lcDecidedBeforeEntry).toBe(true);
  });

  it('E8: 成行 → 決めていたかは未選択・決済の理由 = その他。保存は 成行・未回答', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E8])]);
    await c.readImage(img());
    expect(c.getState().draft.lcDecided).toBeNull();
    expect(c.getState().draft.exitReason).toBe('other');
    typeFive(c);
    await c.save();
    const r = added(fake)[0]?.record;
    expect(r?.exit.orderType).toBe('market');
    expect(r?.exit.reason).toBe('other');
    expect(r?.stopOrderPlaced).toBe('unanswered');
  });
});

describe('E9（AC-8）', () => {
  it('時間帯の無い時刻は確かめるまで保存できず、[日本時間で合っている] の後は日本時間の 10:30 で保存', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E9])]);
    await c.readImage(img());
    expect(posts(fake, '/api/trades')).toHaveLength(0);
    typeFive(c);
    let s = c.getState();
    expect(s.draft.exitTime).toBe('2026-11-10T10:30');
    expect(s.statement?.marks.exitTime).toBe('tz');
    expect(s.read.canSave).toBe(false);
    expect(s.read.missing).toEqual([TZ_MISSING.exitTime]);
    await c.save();
    expect(posts(fake, '/api/trades')).toHaveLength(0);
    c.confirmTimeZone();
    s = c.getState();
    expect(s.statement?.marks.exitTime).toBe('read');
    expect(s.read.canSave).toBe(true);
    await c.save();
    expect(added(fake)[0]?.record.exit.time).toBe(Date.UTC(2026, 10, 10, 1, 30));
  });

  it('欄を直しても確かめたことになる（印「直した」）', async () => {
    const { c } = await openedForRead([ok([ROW_E9])]);
    await c.readImage(img());
    typeFive(c);
    c.update({ type: 'set', field: 'exitTime', value: '2026-11-10T11:00' });
    expect(c.getState().statement?.marks.exitTime).toBe('edited');
    expect(c.getState().read.canSave).toBe(true);
  });
});

describe('複数行（AC-9・C20）', () => {
  it('E10: 1 / 3 → 保存 → 2 / 3（行 2 の値・5 つは空）→ 飛ばす → 3 / 3 → 保存 → 保存済み。保存は 2 件', async () => {
    const { fake, c, previews } = await openedForRead([ok(ROWS_E10)]);
    await c.readImage(img());
    let s = c.getState();
    expect(s.statement?.index).toBe(0);
    expect(s.statement?.rows).toHaveLength(3);
    typeFive(c);
    await c.save();
    s = c.getState();
    expect(s.phase).toBe('editing');
    expect(s.statement?.index).toBe(1);
    expect(s.statement?.notice).toBe('1 / 3 行目を記録しました。次の行（2 / 3）です');
    expect(s.draft).toMatchObject({
      instrumentName: '架空指数C',
      side: 'S',
      entryPrice: '200',
      exitPrice: '201.5',
      quantity: '1',
      feeYen: '',
      lc: '',
      brokenCondition: '',
      lcDecided: null,
      lcMove: null,
      timeframeChange: null,
      lcAfter: '',
    });
    expect(s.statement?.marks.feeYen).toBe('unread');
    c.skipRow();
    s = c.getState();
    expect(s.statement?.index).toBe(2);
    expect(s.statement?.notice).toBe('2 / 3 行目をスキップしました。次の行（3 / 3）です');
    expect(s.draft.instrumentName).toBe('架空指数D');
    typeFive(c, '49');
    await c.save();
    s = c.getState();
    expect(s.phase).toBe('saved');
    expect(s.statement).toBeUndefined();
    expect(posts(fake, '/api/trades')).toHaveLength(2);
    expect(added(fake).map((t) => t.record.entries[0].price)).toEqual([100, 50]);
    expect(previews[0]?.closed()).toBe(true);
  });

  it('最後の行を飛ばす → 読み取りを終え、空の下書き（既定 = 今保存した取引）と「明細のすべての行を確認しました」', async () => {
    const { c, previews } = await openedForRead([ok(ROWS_E10.slice(0, 2))]);
    await c.readImage(img());
    typeFive(c);
    await c.save();
    c.skipRow();
    const s = c.getState();
    expect(s.statement?.phase).toBe('done');
    expect(s.statement?.notice).toBe(ROWS_DONE);
    expect(s.statement?.preview).toBeNull();
    expect(previews[0]?.closed()).toBe(true);
    expect(s.draft).toEqual({
      ...EMPTY_DRAFT,
      instrumentName: '架空指数A',
      quantity: '2',
      exitTime: toLocalInput(floorToMinute(NOW)),
      accountId: 'default',
    });
  });
});

describe('失敗（AC-10・E11）', () => {
  const SECRET = { detail: 'SECRET-本文' };
  it.each([
    [
      '(a) notStatement',
      { status: 200, body: { kind: 'notStatement', rows: [], ...SECRET } },
      READ_MSG.notStatement,
    ],
    ['(a) 0 行', { status: 200, body: statementBody([], SECRET) }, READ_MSG.notStatement],
    [
      '(b) 400',
      { status: 400, body: { error: 'image_rejected', reason: 'bytes', ...SECRET } },
      READ_MSG.rejected,
    ],
    [
      '(c) 503',
      { status: 503, body: { error: 'read_unavailable', ...SECRET } },
      READ_MSG.unavailable,
    ],
    [
      '(e) 429（1 日の上限。#44 の AC-9）',
      { status: 429, body: { error: 'read_limited', ...SECRET } },
      '今日の読み取りの上限に達しました。手入力してください。',
    ],
    ['(d) 502', { status: 502, body: { error: 'read_failed', ...SECRET } }, READ_MSG.failed],
    ['(d) 504', { status: 504, body: { error: 'read_timeout', ...SECRET } }, READ_MSG.failed],
    ['(d) 通信の失敗', 'throw', READ_MSG.failed],
    [
      '(d) 形の読めない 200',
      { status: 200, body: { kind: 'statement', rows: 'SECRET-本文' } },
      READ_MSG.failed,
    ],
  ] as const)(
    '%s → 決まった文言だけ。入れていた値は残り、手で保存できる',
    async (_n, script, msg) => {
      const { fake, c } = await openedForRead([script as ReadScript]);
      c.update({ type: 'set', field: 'lc', value: '99.5' });
      await c.readImage(img());
      const s = c.getState();
      expect(s.statement?.phase).toBe('failed');
      expect(s.statement?.message).toBe(msg);
      expect(s.draft.lc).toBe('99.5');
      expect(JSON.stringify(s)).not.toContain('SECRET');
      fillFrom(c, E1);
      expect(c.getState().read.canSave).toBe(true);
      await c.save();
      expect(c.getState().phase).toBe('saved');
      expect(added(fake)[0]?.record.source).toBe('manual');
    },
  );

  it('(d) 画面の待ちの打ち切り → 「読み取れませんでした」', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])], { readTimeoutMs: 20 });
    fake.holdReads();
    await c.readImage(img());
    expect(c.getState().statement?.message).toBe(READ_MSG.failed);
    fake.releaseReads();
    await new Promise((r) => setTimeout(r, 0));
    // 遅れて届いた応答は捨てる
    expect(c.getState().draft.instrumentName).toBe('架空指数B');
  });

  it('(e) 401 → 「ログインが切れました」（auth）。入れていた値は残る', async () => {
    const { c } = await openedForRead([{ status: 401, body: SECRET }]);
    c.update({ type: 'set', field: 'lc', value: '99.5' });
    await c.readImage(img());
    const s = c.getState();
    expect(s.error).toBe(AUTH_EXPIRED);
    expect(s.errorKind).toBe('auth');
    expect(s.draft.lc).toBe('99.5');
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });

  it('読み取りの待ちは API の締め切り（20 秒）+ 後始末（約 5 秒）より長い', () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);
  });

  it('準備の要求の待ちは API の準備の上限（立ち上がり 20 秒 + 静まり 5 秒。#99）より長く、60 秒より短い', () => {
    expect(READ_PREPARE_TIMEOUT_MS).toBeGreaterThan(25_000);
    expect(READ_PREPARE_TIMEOUT_MS).toBeLessThan(60_000);
  });
});

describe('やめる・貼り直す・離れる（E13・R9）', () => {
  it('E13: 読み取り中に [やめて手で入れる] → 後で届いた応答で欄は変わらない。手で保存できる', async () => {
    const { fake, c, previews } = await openedForRead([ok([ROW_E1])]);
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    c.cancelRead();
    expect(c.getState().statement).toBeUndefined();
    expect(previews[0]?.closed()).toBe(true);
    const before = c.getState().draft;
    fake.releaseReads();
    await p;
    expect(c.getState().draft).toEqual(before);
    expect(c.getState().statement).toBeUndefined();
    fillFrom(c, E1);
    await c.save();
    expect(c.getState().phase).toBe('saved');
  });

  it('もう一度貼る → 前の読み取りの応答は捨て、新しい応答だけを入れる', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E8]), ok([ROW_E7])]);
    fake.holdReads();
    const first = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    const second = c.readImage(img());
    await until(() => readCalls(fake).length === 2);
    fake.releaseReads();
    await Promise.all([first, second]);
    expect(c.getState().draft.exitOrderType).toBe('stop');
  });

  it('画面を離れた（dispose）→ プレビューを閉じ、届いた応答は捨てる', async () => {
    const { fake, c, previews } = await openedForRead([ok([ROW_E1])]);
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    c.dispose();
    fake.releaseReads();
    await p;
    expect(previews[0]?.closed()).toBe(true);
    expect(c.getState().statement).toBeUndefined();
    expect(c.getState().draft.instrumentName).toBe('架空指数B');
  });

  it('保存の後の画面で貼る → 次の取引として読み取る', async () => {
    const { c } = await openedForRead([ok([ROW_E1]), ok([ROW_E8])]);
    await c.readImage(img());
    typeFive(c);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    await c.readImage(img());
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().draft.exitOrderType).toBe('market');
  });
});

describe('端末に残さない（AC-12。EPIC #10 の終了条件 6(b)）', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const KEYS = ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'history', 'location'];
  const saved = new Map<string, unknown>();
  afterEach(() => {
    for (const k of KEYS) {
      if (saved.has(k)) g[k] = saved.get(k);
      else delete g[k];
    }
    saved.clear();
  });

  it('E1・E10 の流れ全体で、Web Storage・IndexedDB・Cache Storage・履歴・URL に触れた件数 0', async () => {
    const touched: string[] = [];
    const spy = (name: string) =>
      new Proxy(
        {},
        {
          get(_t, prop) {
            touched.push(`${name}.${String(prop)}`);
            return () => undefined;
          },
          set(_t, prop) {
            touched.push(`${name}.${String(prop)}=`);
            return true;
          },
        },
      );
    for (const k of KEYS) {
      if (k in g) saved.set(k, g[k]);
      g[k] = spy(k);
    }
    const { c } = await openedForRead([ok([ROW_E1]), ok(ROWS_E10)]);
    await c.readImage(img());
    typeFive(c);
    await c.save();
    c.next();
    await c.readImage(img());
    typeFive(c);
    await c.save();
    c.skipRow();
    typeFive(c, '49');
    await c.save();
    expect(c.getState().phase).toBe('saved');
    c.dispose();
    expect(touched).toEqual([]);
  });
});

describe('レビュー指摘の対応（#15 Phase 4）', () => {
  it('指摘 5: 2 枚目を貼っても、1 枚目の後に直した欄は上書きせず印も残す。1 枚目の逆指値の既定は戻す', async () => {
    const { c } = await openedForRead([ok([ROW_E7]), ok([ROW_E8])]);
    await c.readImage(img());
    expect(c.getState().draft.lcDecided).toBe(true);
    c.update({ type: 'set', field: 'exitPrice', value: '98.5' });
    await c.readImage(img());
    const s = c.getState();
    expect(s.draft.exitPrice).toBe('98.5');
    expect(s.statement?.marks.exitPrice).toBe('edited');
    // 2 枚目は成行: 1 枚目が既定で選んだ「決めていた」「LC」は戻り、本人の答えとして残らない
    expect(s.draft.lcDecided).toBeNull();
    expect(s.draft.exitReason).toBe('other');
    expect(s.statement?.marks.lcDecided).toBeUndefined();
    expect(s.draft.exitOrderType).toBe('market');
    expect(s.draft.stopOrderPlaced).toBe('unanswered');
  });

  it('指摘 5: 本人が選び直した「決めていた」は 2 枚目でも戻さない', async () => {
    const { c } = await openedForRead([ok([ROW_E7]), ok([ROW_E8])]);
    await c.readImage(img());
    c.update({ type: 'set', field: 'lcDecided', value: false });
    await c.readImage(img());
    expect(c.getState().draft.lcDecided).toBe(false);
  });

  it('指摘 6: 読み込み中・保存中に貼った画像は捨てずに知らせる（要求 0 件）。入力すると消える', async () => {
    const fake = createFakeApi({ instruments: [B], reads: [ok([ROW_E1])] });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage() }),
    });
    await c.readImage(img());
    expect(c.getState().readBlocked).toBe(READ_BLOCKED.notReady);
    await c.load();
    expect(c.getState().readBlocked).toBeNull();
    fillFrom(c, E1);
    fake.hold();
    const saving = c.save();
    await c.readImage(img());
    expect(c.getState().readBlocked).toBe(READ_BLOCKED.saving);
    fake.release();
    await saving;
    expect(readCalls(fake)).toHaveLength(0);
  });

  it('指摘 3: 1 行を保存した知らせは「次の行（2 / 3）」を含む', async () => {
    const { c } = await openedForRead([ok(ROWS_E10)]);
    await c.readImage(img());
    typeFive(c);
    await c.save();
    expect(c.getState().statement?.notice).toBe('1 / 3 行目を記録しました。次の行（2 / 3）です');
  });

  it('指摘 7: 読めない形式（unsupported）は「この画像は読み取れません」', async () => {
    const { fake, c } = await openedForRead([], {
      prepare: async () => ({ ok: false, error: 'unsupported' }),
    });
    await c.readImage(img());
    expect(c.getState().statement?.message).toBe(READ_MSG.rejected);
    expect(readCalls(fake)).toHaveLength(0);
  });
});

// ── 根拠の足のチャート（Issue #12 AC-1・2・5・6・R1・R4・R6・E12・E14・E15） ──

describe('根拠の足のチャート（Issue #12）', () => {
  const tradePosts = (fake: FakeApi) => posts(fake, '/api/trades');

  it('E15・AC-1: チャート 2 枚 + 明細 1 枚 → LC・一言・3 つ選ぶだけで判定と R が出て、1 要求で保存できる', async () => {
    const { fake, c, previews } = await openedForRead([ok([ROW_E1])]);
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    await c.readImage(img());
    const n = typeFive(c);
    const s = c.getState();
    expect(n).toEqual({ typed: 2, chosen: 3 });
    expect(s.read.missing).toEqual([]);
    expect(s.read.canSave).toBe(true);
    expect(s.read.preview.judgment?.grade).toBe('A');
    expect(s.read.preview.r).toBe(-1);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    const sent = tradePosts(fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.parts).toEqual(['record', 'entryChart', 'exitChart']);
    expect(fake.charts.size).toBe(2);
    expect(c.getState().saved?.trade.charts).toEqual({
      entry: { contentType: 'image/png', size: 4096 },
      exit: { contentType: 'image/png', size: 4096 },
    });
    // 明細の読み取りは明細の 1 枚だけ（チャートは送らない）
    expect(readCalls(fake)).toHaveLength(1);
    // 保存したら枠は空・プレビューは閉じる（明細のプレビューと 2 枚の枠で 3 つ）
    expect(c.getState().charts).toBeUndefined();
    expect(previews.every((p) => p.closed())).toBe(true);
  });

  it('E14・AC-2: 枠に入れたチャートは明細の読み取りに送らない / 枠の外の画像は明細へ（枠は空のまま）', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    await c.setChart('entry', img());
    expect(readCalls(fake)).toHaveLength(0);
    expect(c.getState().charts?.entry?.phase).toBe('ready');
    expect(c.getState().statement).toBeUndefined();
    await c.readImage(img());
    expect(readCalls(fake)).toHaveLength(1);
    expect(c.getState().charts?.exit).toBeUndefined();
  });

  it('KEEP-1: 明細だけなら今までどおり JSON で送る（画像の部分なし・チャート 0 枚）', async () => {
    const { fake, c } = await openedForRead([ok([ROW_E1])]);
    await c.readImage(img());
    typeFive(c);
    await c.save();
    const sent = tradePosts(fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.parts).toBeUndefined();
    expect(sent[0]?.body).toBeDefined();
    expect(fake.charts.size).toBe(0);
  });

  it('時間足はチャートのある枠でだけ本文に入り、判定に効く（E1: 4 時間足 → 日足・チャートから）', async () => {
    const { fake, c } = await openedForRead([]);
    fillFrom(c, { ...E1, timeframeChange: 'none', lcMove: 'none', lcAfter: '' });
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '4h' });
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '1d' });
    // チャートが無いうちは本文に入らない
    expect(c.getState().read.body?.entryChartTimeframe).toBeUndefined();
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    // 枠に入れると時間足は選び直し（前の値は残さない）
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '4h' });
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '1d' });
    const reasons = c.getState().read.preview.judgment?.reasons.map((r) => reasonText(r, 'L'));
    expect(reasons).toContain('時間足を変えた（4 時間足 → 日足・チャートから）');
    await c.save();
    const body = tradePosts(fake)[0]?.body as {
      entryChartTimeframe?: string;
      exitChartTimeframe?: string;
    };
    expect([body.entryChartTimeframe, body.exitChartTimeframe]).toEqual(['4h', '1d']);
  });

  it('E6・AC-3: 2 枚貼って時間足を選ばずに保存できる（本文に時間足なし）', async () => {
    const { fake, c } = await openedForRead([]);
    fillFrom(c, E2);
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    expect(c.getState().read.canSave).toBe(true);
    await c.save();
    const body = tradePosts(fake)[0]?.body as Record<string, unknown>;
    expect('entryChartTimeframe' in body || 'exitChartTimeframe' in body).toBe(false);
    expect(fake.charts.size).toBe(2);
  });

  it('同じ枠にもう 1 枚 = 置き換え（前のプレビューを閉じ、その枠の時間足は選び直し）', async () => {
    const { c, previews } = await openedForRead([]);
    await c.setChart('entry', img());
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '4h' });
    await c.setChart('entry', img());
    expect(previews[0]?.closed()).toBe(true);
    expect(previews[1]?.closed()).toBe(false);
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
    expect(c.getState().charts?.entry?.preview).toBe(previews[1]);
  });

  it('[外す]: 画像と時間足を消す（プレビューを閉じ、本文から時間足が消える）', async () => {
    const { c, previews } = await openedForRead([]);
    fillFrom(c, E2);
    await c.setChart('exit', img());
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '1d' });
    expect(c.getState().read.body?.exitChartTimeframe).toBe('1d');
    c.removeChart('exit');
    expect(c.getState().charts?.exit).toBeUndefined();
    expect(c.getState().draft.exitChartTimeframe).toBeNull();
    expect(c.getState().read.body?.exitChartTimeframe).toBeUndefined();
    expect(previews[0]?.closed()).toBe(true);
  });

  it('E12・AC-5（#27 で読み替え）: 2 枚貼って保存せずに離れる → 保存の要求 0（時間足の読み取りは枠ごとに 1 回送る）・サーバーのチャート 0 枚・プレビューは閉じる', async () => {
    const { fake, c, previews } = await openedForRead([]);
    const before = fake.calls.length;
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    c.dispose();
    // 保存の要求は 0。時間足の読み取り（#27）は枠に入れたときに 1 枠 1 回送る（保存はしない）
    const saves = fake.calls.filter((x) => x.path !== '/api/chart-reads');
    expect(saves.length).toBe(before);
    expect(fake.calls.filter((x) => x.path === '/api/chart-reads').length).toBe(2);
    expect(fake.charts.size).toBe(0);
    expect(previews.every((p) => p.closed())).toBe(true);
  });

  it('AC-6: 保存に失敗したら取引もチャートも増えず、下書きと 2 枚の枠は残る（もう一度押せば送れる）', async () => {
    const fake = createFakeApi({ instruments: [B], failOnce: { 'POST /api/trades': 503 } });
    const previews: ReturnType<typeof fakePreview>[] = [];
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => {
        const p = fakePreview();
        previews.push(p);
        return { ok: true, image: preparedImage(p) };
      },
    });
    await c.load();
    fillFrom(c, { ...E2, instrumentName: B.name });
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '4h' });
    await c.save();
    let s = c.getState();
    expect(s.phase).toBe('editing');
    expect(s.error).toBe(SAVE_FAILED);
    expect(fake.trades).toHaveLength(0);
    expect(fake.charts.size).toBe(0);
    expect(s.charts?.entry?.phase).toBe('ready');
    expect(s.charts?.exit?.phase).toBe('ready');
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.draft.lc).toBe(E2.lc);
    expect(previews.some((p) => p.closed())).toBe(false);
    await c.save();
    s = c.getState();
    expect(s.phase).toBe('saved');
    expect(fake.charts.size).toBe(2);
  });

  it('描き直し中は保存しない（理由を出す）。終われば保存できる', async () => {
    let open: (() => void) | null = null;
    const { c } = await openedForRead([], {
      prepare: async () => {
        await new Promise<void>((ok) => {
          open = ok;
        });
        return { ok: true, image: preparedImage() };
      },
    });
    fillFrom(c, E2);
    const p = c.setChart('entry', img());
    expect(c.getState().charts?.entry?.phase).toBe('preparing');
    expect(c.getState().read.canSave).toBe(false);
    expect(c.getState().read.notice).toBe(CHART_PREPARING);
    (open as (() => void) | null)?.();
    await p;
    expect(c.getState().read.canSave).toBe(true);
    expect(c.getState().read.notice).toBeUndefined();
  });

  it('描き直しの失敗は枠に決まった文言だけ（ファイル名・例外の文言を出さない）。保存は止めない', async () => {
    const { c } = await openedForRead([], {
      prepare: async () => {
        throw new Error('SECRET-例外の文言 chart.png');
      },
    });
    fillFrom(c, E2);
    await c.setChart('exit', img());
    expect(c.getState().charts?.exit).toEqual({
      phase: 'failed',
      preview: null,
      message: CHART_MSG.notImage,
    });
    expect(c.getState().read.canSave).toBe(true);
    const { c: c2 } = await openedForRead([], {
      prepare: async () => ({ ok: false, error: 'too_large' }),
    });
    await c2.setChart('entry', img());
    expect(c2.getState().charts?.entry?.message).toBe(CHART_MSG.rejected);
  });

  it('外した・置き換えた後に届いた古い描き直しは捨てる（プレビューは閉じる）', async () => {
    const opens: (() => void)[] = [];
    const made: ReturnType<typeof fakePreview>[] = [];
    const { c } = await openedForRead([], {
      prepare: async () => {
        await new Promise<void>((ok) => opens.push(ok));
        const p = fakePreview();
        made.push(p);
        return { ok: true, image: preparedImage(p) };
      },
    });
    const first = c.setChart('entry', img());
    c.removeChart('entry');
    opens[0]?.();
    await first;
    expect(c.getState().charts?.entry).toBeUndefined();
    expect(made[0]?.closed()).toBe(true);
  });

  it('明細の複数行: 1 行目をチャートつきで保存したら、次の行の枠は空（1 取引 = その取引のチャート）', async () => {
    const { fake, c } = await openedForRead([ok(ROWS_E10)]);
    await c.readImage(img());
    await c.setChart('entry', img());
    typeFive(c);
    await c.save();
    expect(c.getState().statement?.index).toBe(1);
    expect(c.getState().charts).toBeUndefined();
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
    typeFive(c, '202.0'); // 2 行目は S・イン 200
    await c.save();
    const sent = tradePosts(fake);
    expect(sent.map((x) => x.parts)).toEqual([['record', 'entryChart'], undefined]);
    expect(fake.charts.size).toBe(1);
  });

  it('チャートつきの保存だけ時間の上限を 30 秒に延ばす（約 1 MB を送る）', async () => {
    expect(CHART_SAVE_TIMEOUT_MS).toBe(30_000);
    const fake = createFakeApi({ instruments: [B] });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      timeoutMs: 20,
      prepare: async () => ({ ok: true, image: preparedImage() }),
    });
    await c.load();
    fillFrom(c, { ...E2, instrumentName: B.name });
    await c.setChart('entry', img());
    fake.hold();
    const saving = c.save();
    await new Promise((r) => setTimeout(r, 80));
    expect(c.getState().phase).toBe('saving');
    fake.release();
    await saving;
    expect(c.getState().phase).toBe('saved');
  });

  it('読み込み中・保存中に枠へ入れた画像は捨てずに知らせる', async () => {
    const fake = createFakeApi({ instruments: [B] });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage() }),
    });
    await c.setChart('entry', img());
    expect(c.getState().readBlocked).toBe(READ_BLOCKED.notReady);
    expect(c.getState().charts).toBeUndefined();
  });

  it('保存の後にチャートを入れると次の取引に移る', async () => {
    const { c } = await openedForRead([]);
    fillFrom(c, E2);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    await c.setChart('exit', img());
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().charts?.exit?.phase).toBe('ready');
  });

  it('レビュー指摘 3: 保存が届いたか分からない間は枠を変えない（知らせる）。もう一度押すと今の枠で送る', async () => {
    const fake = createFakeApi({ instruments: [B], failOnce: { 'POST /api/trades': 'throw' } });
    const previews: ReturnType<typeof fakePreview>[] = [];
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => {
        const p = fakePreview();
        previews.push(p);
        return { ok: true, image: preparedImage(p) };
      },
    });
    await c.load();
    fillFrom(c, { ...E2, instrumentName: B.name });
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    await c.save();
    expect(c.getState().error).toBe(NETWORK_FAILED);
    // 外す・足す・置き換えるは止めて知らせる（枠はそのまま）
    c.removeChart('exit');
    expect(c.getState().chartBlocked).toBe(CHART_LOCKED);
    expect(c.getState().charts?.exit?.phase).toBe('ready');
    await c.setChart('entry', img());
    expect(c.getState().chartBlocked).toBe(CHART_LOCKED);
    expect(previews).toHaveLength(2);
    expect(previews.some((p) => p.closed())).toBe(false);
    // もう一度押す: 届いていない（偽の API は保存の前に失敗）ので、今の 2 枚で送り直す
    await c.save();
    const s = c.getState();
    expect(s.phase).toBe('saved');
    expect(s.chartBlocked).toBeNull();
    const sent = posts(fake, '/api/trades');
    expect(sent.map((x) => x.parts)).toEqual([
      ['record', 'entryChart', 'exitChart'],
      ['record', 'entryChart', 'exitChart'],
    ]);
    expect(fake.trades).toHaveLength(1);
    expect(fake.charts.size).toBe(2);
    // 保存の後は枠を使える
    await c.setChart('exit', img());
    expect(c.getState().chartBlocked).toBeNull();
    expect(c.getState().charts?.exit?.phase).toBe('ready');
  });
});

describe('読み取りの準備（#65 AC-13）', () => {
  const PREPARE = '/api/statement-reads/prepare';

  it('warmRead なら開いたときに準備の要求を 1 回送る（AI へは送らない）', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = createRecordController({ api: fake.api, now: () => NOW, warmRead: true });
    await c.load();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    expect(posts(fake, '/api/statement-reads')).toHaveLength(0);
    expect(c.getState().phase).toBe('editing');
  });

  it('準備が失敗しても画面は編集できる状態で、文言を出さない', async () => {
    for (const f of [500, 'throw'] as const) {
      const fake = createFakeApi({ instruments: [US30], fail: { [`POST ${PREPARE}`]: f } });
      const c = createRecordController({ api: fake.api, now: () => NOW, warmRead: true });
      await c.load();
      await new Promise((r) => setTimeout(r, 0));
      expect(posts(fake, PREPARE)).toHaveLength(1);
      expect(c.getState().phase).toBe('editing');
      expect(c.getState().error).toBeNull();
    }
  });

  it('warmRead が無ければ送らない（既定）', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    await opened(fake);
    expect(posts(fake, PREPARE)).toHaveLength(0);
    const c = createRecordController({ api: fake.api, now: () => NOW });
    c.refreshWarm();
    expect(posts(fake, PREPARE)).toHaveLength(0);
  });

  /** 準備の応答を手で返せる api（ほかは偽の記録の API）。時計も手で進める */
  function gatedPrepare(reads: readonly ReadScript[] = []) {
    const fake = createFakeApi({ instruments: [B], trades: [], reads });
    const pending: Array<() => void> = [];
    const api: typeof fake.api = async (path, init) => {
      if (path === PREPARE && (init?.method ?? 'GET').toUpperCase() === 'POST') {
        fake.calls.push({ method: 'POST', path } as (typeof fake.calls)[number]);
        await new Promise<void>((r) => pending.push(r));
        return new Response(JSON.stringify({ ready: true }), { status: 200 });
      }
      return fake.api(path, init);
    };
    let t = NOW;
    const c = createRecordController({
      api,
      now: () => t,
      warmRead: true,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    const settle = async () => {
      for (const r of pending.splice(0)) r();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    return { fake, c, settle, advance: (ms: number) => (t += ms) };
  }

  it('#99 の続き: 明細の読み取りが API に届いた後に、次の 1 枚のために準備を送り直す（重ねない）', async () => {
    const { fake, c, settle } = gatedPrepare([
      { status: 200, body: statementBody([]) },
      { status: 502 },
    ]);
    await c.load();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    await settle();
    await c.readImage(img());
    // 読み取りの後に 1 回（開いたときの分は返った後）
    expect(posts(fake, PREPARE)).toHaveLength(2);
    // 送っている間にもう 1 枚読んでも重ねて送らない。返った後に 1 回だけ送り直す
    await c.readImage(img());
    expect(posts(fake, PREPARE)).toHaveLength(2);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(3);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(3);
    expect(c.getState().error).toBeNull();
  });

  it('#99 の続き: AI へ送る前に返る応答（400・403・413・429・503）の後は送り直さない', async () => {
    for (const status of [400, 403, 413, 429, 503]) {
      const { fake, c, settle } = gatedPrepare([{ status }]);
      await c.load();
      await settle();
      await c.readImage(img());
      await settle();
      expect(posts(fake, PREPARE)).toHaveLength(1);
    }
  });

  it('#99 の続き: ログインが切れた（401 は request が投げる）後は送り直さない', async () => {
    const { fake, c, settle } = gatedPrepare([{ status: 401 }]);
    await c.load();
    await settle();
    await c.readImage(img());
    await settle();
    expect(c.getState().error).toBe(AUTH_EXPIRED);
    expect(posts(fake, PREPARE)).toHaveLength(1);
  });

  it('#99 の続き: 画面の側の通信の失敗・時間切れで読み取りが投げた後も送り直す（API に届いたかもしれない）', async () => {
    const { fake, c, settle } = gatedPrepare(['throw']);
    await c.load();
    await settle();
    await c.readImage(img());
    await settle();
    expect(c.getState().statement?.phase).toBe('failed');
    expect(posts(fake, PREPARE)).toHaveLength(2);
  });

  it('#99 の続き: AI へ送った応答の判定 sentToAi', () => {
    for (const s of [200, 500, 502, 504]) expect(sentToAi(s)).toBe(true);
    for (const s of [400, 401, 403, 413, 429, 503]) expect(sentToAi(s)).toBe(false);
  });

  it('#99 の続き: watchVisible は見えるようになったときだけ呼び、外した後は呼ばない', () => {
    const target = new EventTarget();
    let visible = false;
    let calls = 0;
    const unwatch = watchVisible(
      target,
      () => visible,
      () => calls++,
    );
    target.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(0);
    visible = true;
    target.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(1);
    target.dispatchEvent(new Event('other'));
    expect(calls).toBe(1);
    unwatch();
    target.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(1);
  });

  it('#99 の続き: 画面に戻ったとき、前に送ってから WARM_REFRESH_MS 以上なら送り直す。離れた後は送らない', async () => {
    const { fake, c, settle, advance } = gatedPrepare();
    await c.load();
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    advance(WARM_REFRESH_MS - 1);
    c.refreshWarm();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    advance(1);
    c.refreshWarm();
    expect(posts(fake, PREPARE)).toHaveLength(2);
    // 送っている間に戻っても重ねない（返った後にも送り直さない。送っていた準備が先立てを立てる）
    advance(WARM_REFRESH_MS);
    c.refreshWarm();
    expect(posts(fake, PREPARE)).toHaveLength(2);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(2);
    // 離れた後は送らない
    c.dispose();
    advance(WARM_REFRESH_MS * 10);
    c.refreshWarm();
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(2);
  });

  it('#75: 書きかけを借り直して画面に戻ったら（読み込み直さず）準備を送る。前に送ってから WARM_REFRESH_MS 未満なら送らない', async () => {
    const { fake, c, settle, advance } = gatedPrepare();
    const started = new WeakSet<RecordController>();
    // 初めて出た: 読み込み（開いたときの準備 1 回）
    let leave = enterRecordScreen(c, started);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    const reads = () => fake.calls.filter((x) => x.method === 'GET').length;
    const loaded = reads();
    leave();
    // すぐ戻る（60 秒未満）: 送らない・読み込み直さない
    advance(WARM_REFRESH_MS - 1);
    leave = enterRecordScreen(c, started);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    expect(reads()).toBe(loaded);
    leave();
    // 離れて 60 秒以上たってから戻る: 送る（読み込み直さない）
    advance(WARM_REFRESH_MS);
    leave = enterRecordScreen(c, started);
    expect(posts(fake, PREPARE)).toHaveLength(2);
    await settle();
    expect(reads()).toBe(loaded);
    expect(c.getState().phase).toBe('editing');
    leave();
  });

  it('#75: 画面の外にいる間は準備を送らない（読み取りが後で返っても）。送れなかった分は戻ったときに間を置かず送る', async () => {
    const { fake, c, settle, advance } = gatedPrepare([{ status: 200, body: statementBody([]) }]);
    const started = new WeakSet<RecordController>();
    const leave = enterRecordScreen(c, started);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    // 読み取りの途中で画面を離れる（書きかけは置き場に残る = dispose しない）
    const reading = c.readImage(img());
    leave();
    await reading;
    await settle();
    expect(posts(fake, '/api/statement-reads')).toHaveLength(1);
    expect(posts(fake, PREPARE)).toHaveLength(1);
    // 画面の外では、見えるようになった合図が来ても（来ない作りだが）時間がたっても送らない
    advance(WARM_REFRESH_MS * 10);
    c.refreshWarm();
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    // 戻ったら送る（読み取りが先立てを使ったかもしれない分）
    const leave2 = enterRecordScreen(c, started);
    expect(posts(fake, PREPARE)).toHaveLength(2);
    await settle();
    leave2();
  });

  it('#75: 画面の外で送れなかった分は、前に送ってから WARM_REFRESH_MS 未満でも戻ったときに送る', async () => {
    const { fake, c, settle } = gatedPrepare([{ status: 200, body: statementBody([]) }]);
    const started = new WeakSet<RecordController>();
    const leave = enterRecordScreen(c, started);
    await settle();
    const reading = c.readImage(img());
    leave();
    await reading;
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(1);
    // 時計を進めずに戻る
    const leave2 = enterRecordScreen(c, started);
    expect(posts(fake, PREPARE)).toHaveLength(2);
    await settle();
    leave2();
    // 1 回送った後は、60 秒未満の戻りでは送らない（送れなかった分は返した）
    const leave3 = enterRecordScreen(c, started);
    await settle();
    expect(posts(fake, PREPARE)).toHaveLength(2);
    leave3();
  });
});

// ---- 口座（Issue #47 PR-1。B5・B6・U9・KEEP-3）。値・名前はすべて架空 ----

describe('口座（#47 B5・B6・U9・KEEP-3）', () => {
  const ACC_B = account('accB', '口座 B', 200_000);

  it('KEEP-3: 口座 1 つなら本文に口座を入れない（今と同じ本文）。口座 2 つ以上なら選んだ口座', async () => {
    const one = createFakeApi({ instruments: [US30], capitalYen: 1_000_000 });
    const c1 = await opened(one);
    fillFrom(c1, E6);
    await c1.save();
    expect(posts(one, '/api/trades')[0]?.body).not.toHaveProperty('accountId');

    const two = createFakeApi({ instruments: [US30], accounts: [defaultAccount(null), ACC_B] });
    const c2 = await opened(two);
    fillFrom(c2, E2);
    expect(c2.getState().draft.accountId).toBe('default');
    c2.update({ type: 'set', field: 'accountId', value: ACC_B.id });
    // 選んだ口座の資金でその場で計算し直す（E2: 決済 = LC・明細の損益 −5,000 → 1R 5,000 ÷ 200,000 = 2.5%）
    expect(c2.getState().read.preview.riskPct).toBeCloseTo(2.5, 12);
    await c2.save();
    expect(posts(two, '/api/trades')[0]?.body).toMatchObject({ accountId: ACC_B.id });
  });

  it('B5・AC-7: 記録する画面で「口座 C」・300,000 を足す → 名前と資金だけを送り、一覧に足して選ぶ。ほかの欄はそのまま', async () => {
    const fake = createFakeApi({ instruments: [US30], capitalYen: 1_000_000 });
    const c = await opened(fake);
    fillFrom(c, E2);
    const draftBefore = c.getState().draft;
    c.openAddAccount();
    expect(c.getState().addAccount?.errors).toEqual({});
    c.setNewAccount('name', '口座 C');
    c.setNewAccount('capital', '300,000');
    await c.addAccount();
    const s = c.getState();
    expect(posts(fake, '/api/accounts').map((x) => x.body)).toEqual([
      { name: '口座 C', capitalYen: 300_000 },
    ]);
    expect(s.addAccount).toBeUndefined();
    expect(s.accounts.map((a) => a.name)).toEqual(['口座 1', '口座 C']);
    const created = s.accounts.find((a) => a.name === '口座 C');
    expect(created?.riskTolerancePct).toBe(1);
    expect(s.draft).toEqual({ ...draftBefore, accountId: created?.id });
    // 1R 5,000 ÷ 300,000 × 100 = 1.666…% → 判定の枠はその口座の資金で
    expect(s.read.preview.riskPct).toBeCloseTo((5000 / 300_000) * 100, 9);
    // 設定の画面に移らない（設定の API に触れない）
    expect(fake.calls.some((x) => x.path === '/api/settings')).toBe(false);
  });

  it('U9: 送っている間は [記録する] を押せず、帯の文は「口座を足しています」', async () => {
    const fake = createFakeApi({ instruments: [US30], capitalYen: 1_000_000 });
    const c = await opened(fake);
    fillFrom(c, E6);
    expect(c.getState().read.canSave).toBe(true);
    c.openAddAccount();
    // 開いているだけの間は今のまま
    expect(c.getState().read.canSave).toBe(true);
    c.setNewAccount('name', '口座 C');
    fake.hold();
    const p = c.addAccount();
    expect(c.getState().addAccount?.saving).toBe(true);
    expect(c.getState().read.canSave).toBe(false);
    expect(c.getState().read.notice).toBe(ACCOUNT_ADDING);
    await c.save();
    expect(posts(fake, '/api/trades')).toHaveLength(0);
    fake.release();
    await p;
    expect(c.getState().read.canSave).toBe(true);
  });

  it('U8: 名前が空・重複は送らず欄の誤り。409（ほかの端末）も重複。通信の失敗は欄の中の知らせで値は残る', async () => {
    const fake = createFakeApi({
      instruments: [US30],
      failOnce: { 'POST /api/accounts': 'throw' },
    });
    const c = await opened(fake);
    c.openAddAccount();
    await c.addAccount();
    expect(c.getState().addAccount?.errors.name).toBe(ACCOUNT_MSG.nameRequired);
    c.setNewAccount('name', '口座　１');
    expect(c.getState().addAccount?.errors.name).toBe(ACCOUNT_MSG.duplicateName);
    await c.addAccount();
    expect(posts(fake, '/api/accounts')).toHaveLength(0);
    c.setNewAccount('name', '口座 C');
    await c.addAccount();
    expect(c.getState().addAccount?.message).toBe(ACCOUNT_ADD_NETWORK_FAILED);
    expect(c.getState().addAccount?.draft.name).toBe('口座 C');
    expect(JSON.stringify(c.getState())).not.toContain('偽物');
    // 届いていた（もう一度押して 409）→ 二重に足さず、その口座を選ぶ
    fake.accounts.push(account('accC', '口座 C', null));
    await c.addAccount();
    expect(c.getState().addAccount).toBeUndefined();
    expect(c.getState().draft.accountId).toBe('accC');
    // ほかの端末が同じ名前を先に足した（届いたか分からない要求は無い）→ 重複の文言
    c.openAddAccount();
    c.setNewAccount('name', '口座 Z');
    fake.accounts.push(account('accZ', '口座 Z', null));
    await c.addAccount();
    expect(c.getState().addAccount?.errors.name).toBe(ACCOUNT_MSG.duplicateName);
  });

  it('[やめる] で閉じ、下書きは変えない。送っている間は閉じない', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await opened(fake);
    fillFrom(c, E6);
    const before = c.getState().draft;
    c.openAddAccount();
    c.setNewAccount('name', '口座 C');
    c.closeAddAccount();
    expect(c.getState().addAccount).toBeUndefined();
    expect(c.getState().draft).toEqual(before);
    c.openAddAccount();
    c.setNewAccount('name', '口座 D');
    fake.hold();
    const p = c.addAccount();
    c.closeAddAccount();
    expect(c.getState().addAccount?.saving).toBe(true);
    fake.release();
    await p;
  });

  it('B6: 3 行の明細の 1 行目で口座 B を選んで記録 → 2・3 行目の既定も B', async () => {
    const fake = createFakeApi({
      instruments: [B],
      accounts: [defaultAccount(null), ACC_B],
      reads: [{ status: 200, body: statementBody(ROWS_E10) }],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    c.update({ type: 'set', field: 'accountId', value: ACC_B.id });
    typeFive(c);
    await c.save();
    expect(c.getState().statement?.index).toBe(1);
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    c.skipRow();
    expect(c.getState().statement?.index).toBe(2);
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(posts(fake, '/api/trades')[0]?.body).toMatchObject({ accountId: ACC_B.id });
  });
});

describe('外貨の口座で明細を貼る・口座を替える（#47 PR-2・R7・F13・AC-17）', () => {
  /** 口座 A（既定・JPY）と口座 D（USD）。最後の取引は口座 A */
  async function openedTwo(accountId?: string) {
    const fake = createFakeApi({
      instruments: [B],
      trades: [storedTrade('t-b', B.id, 1, 1_000, 2_000)],
      accounts: [
        defaultAccount(1_000_000),
        account('accD', '口座 D', 10_000, 1, { currency: 'USD' }),
      ],
      reads: [ok([ROW_E1])],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    if (accountId !== undefined) c.update({ type: 'set', field: 'accountId', value: accountId });
    return { fake, c };
  }

  it('F13: USD の口座で貼る → 損益・手数料は空・印なし、ほかの 7 欄は読み取りの値と印', async () => {
    const { c } = await openedTwo('accD');
    await c.readImage(img());
    const s = c.getState();
    expect(s.draft.pnlYen).toBe('');
    expect(s.draft.feeYen).toBe('');
    expect(s.statement?.marks.pnlYen).toBeUndefined();
    expect(s.statement?.marks.feeYen).toBeUndefined();
    for (const f of READ_FIELDS) {
      if (f === 'pnlYen' || f === 'feeYen') continue;
      expect(s.statement?.marks[f], f).toBe('read');
    }
    expect(s.draft).toMatchObject({
      instrumentName: '架空指数A',
      entryPrice: '100',
      quantity: '2',
    });
  });

  it('JPY の口座で貼ってから USD の口座へ → 空に戻る。JPY へ戻すと入る。手で打った損益は残る', async () => {
    const { c } = await openedTwo();
    await c.readImage(img());
    expect(c.getState().draft.pnlYen).toBe('-2000');
    c.update({ type: 'set', field: 'accountId', value: 'accD' });
    expect(c.getState().draft.pnlYen).toBe('');
    expect(c.getState().draft.feeYen).toBe('');
    expect(c.getState().statement?.marks.pnlYen).toBeUndefined();
    c.update({ type: 'set', field: 'accountId', value: 'default' });
    expect(c.getState().draft.pnlYen).toBe('-2000');
    expect(c.getState().draft.feeYen).toBe('150');
    expect(c.getState().statement?.marks.pnlYen).toBe('read');
    // USD の口座で損益を手で打つ → JPY へ替えても残る（手数料は入れ直す）
    c.update({ type: 'set', field: 'accountId', value: 'accD' });
    c.update({ type: 'set', field: 'pnlYen', value: '-13.5' });
    c.update({ type: 'set', field: 'accountId', value: 'default' });
    expect(c.getState().draft.pnlYen).toBe('-13.5');
    expect(c.getState().draft.feeYen).toBe('150');
  });

  it('USD の口座で記録した本文に損益・手数料が無く、snapshot は USD', async () => {
    const { fake, c } = await openedTwo('accD');
    await c.readImage(img());
    typeFive(c);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    const saved = added(fake)[0];
    expect(saved?.record.statementPnlYen).toBeUndefined();
    expect(saved?.record.fees).toEqual([]);
    expect(saved?.record.accountId).toBe('accD');
    expect(saved?.snapshot.accountCurrency).toBe('USD');
  });
});

describe('記録する画面: 通貨の組が変わったら打った為替を空にする（#47 PR-2 のレビュー指摘 2）', () => {
  const USD_I = { ...US30, id: 'inst-usd', name: '架空指数U', priceCurrency: 'USD' };
  const EUR_I = { ...US30, id: 'inst-eur', name: '架空指数E', priceCurrency: 'EUR' };
  async function openedFx() {
    const fake = createFakeApi({
      instruments: [USD_I, EUR_I],
      accounts: [
        defaultAccount(1_000_000),
        account('accE', '口座 E', 10_000, 1, { currency: 'EUR' }),
      ],
    });
    const c = createRecordController({ api: fake.api, now: () => NOW });
    await c.load();
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数U' });
    c.update({ type: 'set', field: 'fxRate', value: '150' });
    return c;
  }

  it('口座の通貨が変わったら空にする（1 USD = 150 EUR にしない）', async () => {
    const c = await openedFx();
    expect(c.getState().draft.fxRate).toBe('150');
    c.update({ type: 'set', field: 'accountId', value: 'accE' });
    expect(c.getState().draft.fxRate).toBe('');
  });

  it('銘柄の価格の通貨が変わったら空にする。同じ組のままの操作では残す', async () => {
    const c = await openedFx();
    c.update({ type: 'set', field: 'quantity', value: '100' });
    expect(c.getState().draft.fxRate).toBe('150');
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数E' });
    expect(c.getState().draft.fxRate).toBe('');
  });
});

describe('記録する画面: 銘柄の名前を打っている途中では為替を空にしない（#47 PR-2 の再レビュー 2）', () => {
  it('USD 建てで 150 → 名前を打ち直している途中は残り、EUR 建てに当たったら空', async () => {
    const fake = createFakeApi({
      instruments: [
        { ...US30, id: 'inst-usd', name: '架空指数U', priceCurrency: 'USD' },
        { ...US30, id: 'inst-eur', name: '架空指数E', priceCurrency: 'EUR' },
      ],
    });
    const c = createRecordController({ api: fake.api, now: () => NOW });
    await c.load();
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数U' });
    c.update({ type: 'set', field: 'fxRate', value: '150' });
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数' });
    expect(c.getState().draft.fxRate).toBe('150');
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数U' });
    expect(c.getState().draft.fxRate).toBe('150');
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数' });
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数E' });
    expect(c.getState().draft.fxRate).toBe('');
  });
});

describe('記録する画面の為替の基準（#47 PR-2 の 3 回目の再レビュー 1・3）', () => {
  const USD_I = { ...US30, id: 'inst-usd', name: '架空指数U', priceCurrency: 'USD' };
  const NONE_I = { ...US30, id: 'inst-none', name: '架空指数N', priceCurrency: null };
  const EUR_I = { ...US30, id: 'inst-eur', name: '架空指数E', priceCurrency: 'EUR' };

  it('USD 建て → 価格の通貨が未設定の銘柄 → EUR 建て: 未設定では残し、EUR で空にする（USD を未設定で上書きしない）', async () => {
    const fake = createFakeApi({ instruments: [USD_I, NONE_I, EUR_I] });
    const c = createRecordController({ api: fake.api, now: () => NOW });
    await c.load();
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数U' });
    c.update({ type: 'set', field: 'fxRate', value: '150' });
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数N' });
    expect(c.getState().draft.fxRate).toBe('150');
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数E' });
    expect(c.getState().draft.fxRate).toBe('');
  });

  it('明細の読み取りが銘柄を EUR 建てへ入れ替えたら、USD 建てで打った為替を空にする', async () => {
    const fake = createFakeApi({
      instruments: [USD_I, EUR_I],
      reads: [ok([{ ...ROW_E1, symbol: '架空指数E' }])],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数U' });
    c.update({ type: 'set', field: 'fxRate', value: '150' });
    await c.readImage(img());
    expect(c.getState().draft.instrumentName).toBe('架空指数E');
    expect(c.getState().draft.fxRate).toBe('');
  });
});
