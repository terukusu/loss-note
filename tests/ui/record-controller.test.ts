// 記録する画面の通信と状態（Issue #13 契約 R-3・AC-1・7・8・9・10・11）。偽の API（tests/ui/helpers/fake-api.ts）で確かめる。
// 値はすべて架空
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { NotSignedIn } from '../../ui/src/lib/api';
import { floorToMinute, toLocalInput } from '../../ui/src/lib/datetime';
import { formatR } from '../../ui/src/lib/format';
import { reasonText } from '../../ui/src/lib/reasons';
import {
  AUTH_EXPIRED,
  createRecordController,
  LOAD_FAILED,
  NETWORK_FAILED,
  type RecordController,
  SAVE_FAILED,
} from '../../ui/src/lib/record-controller';
import { applyDraft, type Draft, EMPTY_DRAFT, summarize } from '../../ui/src/lib/record-form';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import { E1, E2, E6, US30 } from './helpers/record-drafts';

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
    });
    expect(s.draft.exitTime).toBe('2026-04-05T14:37');
    // 開いたときの要求は 3 つ（取引・銘柄・設定）
    expect(fake.calls.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/instruments',
      'GET /api/settings',
      'GET /api/trades',
    ]);
  });

  it('取引が 0 件なら銘柄・数量は空', async () => {
    const c = await opened(createFakeApi({ instruments: [US30] }));
    expect(c.getState().draft).toEqual({ ...EMPTY_DRAFT, exitTime: '2026-04-05T14:37' });
  });

  it('読み込みに失敗したら決まった文言で、もう一度読み込める', async () => {
    const fake = createFakeApi({ fail: { 'GET /api/settings': 503 } });
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
    expect(beforeTexts).toContain('LC を下げた（99.5 → 99.2）');
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

  it('足りない欄があれば保存の要求は 0 件', async () => {
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
  });

  it('時間切れの後に入力を直したら、別の本文として送る', async () => {
    const fake = createFakeApi({ instruments: [US30], failOnce: { 'POST /api/trades': 'throw' } });
    const c = await opened(fake);
    fillFrom(c, E1);
    await c.save();
    c.update({ type: 'set', field: 'brokenCondition', value: '架空の一言' });
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(fake.calls.filter((x) => x.method === 'GET' && x.path === '/api/trades')).toHaveLength(
      1,
    );
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
