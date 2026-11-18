// 編集の画面のチャートの変更と付属のチャート（Issue #89 の例 1〜11・AC-1〜AC-8・AC-10）。
// 偽の記録の API（PUT の multipart・チャートの読み戻し・時間足の読み取りの台本）と偽の描き直しで流す。画像・値はすべて架空
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { CHART_READ_MARK } from '../../ui/src/lib/chart-read';
import {
  CHART_MSG,
  chartChangeCount,
  keptReadingSlots,
  keptReadingText,
  keptTimeframeText,
} from '../../ui/src/lib/chart-slots';
import { chartSaveTimeoutMs, EXTRA_FULL } from '../../ui/src/lib/charts';
import {
  createEditController,
  EDIT_CHARTS_CHANGED,
  EDIT_SAVE_FAILED,
  type EditController,
} from '../../ui/src/lib/edit-controller';
import { bandText, changeText } from '../../ui/src/lib/edit-form';
import { createRecordController } from '../../ui/src/lib/record-controller';
import type { ApiFn } from '../../ui/src/lib/request';
import type { PrepareResult } from '../../ui/src/lib/statement-image';
import { chartSlots } from '../../ui/src/lib/trade-view';
import { createFakeApi, type ReadScript } from './helpers/fake-api';
import { E2 as DRAFT_E2 } from './helpers/record-drafts';
import { blobOf, fakePreview, pngBytes, preparedImage } from './helpers/statement-rows';
import { E2, L1, pngHead, stored, US30 } from './helpers/trade-examples';

const PNG = { contentType: 'image/png' as const, size: 120 };
/** G1: L1（A・−1.0R）に エントリー時・決済時とも 4 時間足のチャート */
const G1: StoredTrade = stored(
  'g1',
  { ...L1.record, entryChartTimeframe: '4h', exitChartTimeframe: '4h' },
  { charts: { entry: PNG, exit: PNG } },
);
/** G2: L1 に エントリー時 4 時間足・決済時 日足のチャート（時間足を変えた・チャートから → B） */
const G2: StoredTrade = stored(
  'g2',
  { ...L1.record, entryChartTimeframe: '4h', exitChartTimeframe: '1d' },
  { charts: { entry: PNG, exit: PNG } },
);
/** G3: L1 に付属のチャート 1 枚（日足・一言） */
const G3: StoredTrade = stored(
  'g3',
  {
    ...L1.record,
    entryChartTimeframe: '4h',
    extraCharts: [{ slot: 'x2', timeframe: '1d', note: '上位足の環境' }],
  },
  { charts: { entry: PNG, x2: PNG } },
);

const img = () => blobOf(pngBytes(1200, 800, 2048));
const tf = (timeframe: string | null): ReadScript => ({
  status: 200,
  body: { kind: 'chart', timeframe },
});
const chartData = (t: StoredTrade) =>
  Object.fromEntries(Object.keys(t.charts ?? {}).map((s) => [`${t.id}-${s}`, pngHead(1200, 800)]));

async function opened(
  t: StoredTrade,
  chartReads: readonly ReadScript[] = [],
  fail?: Record<string, number>,
  prepare: () => Promise<PrepareResult> = async () => ({
    ok: true,
    image: preparedImage(fakePreview()),
  }),
  wrap: (api: ApiFn) => ApiFn = (api) => api,
) {
  const fake = createFakeApi({
    trades: [t],
    instruments: [US30],
    chartReads,
    chartData: chartData(t),
    ...(fail ? { fail } : {}),
  });
  const storedPreviews: ReturnType<typeof fakePreview>[] = [];
  const c = createEditController({
    api: wrap(fake.api),
    id: t.id,
    prepare,
    preview: async () => {
      const p = fakePreview();
      storedPreviews.push(p);
      return p;
    },
  });
  await c.load();
  return { fake, c, storedPreviews };
}

const writes = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((x) => x.method !== 'GET' && x.path !== '/api/chart-reads');
const reasons = (c: EditController) =>
  (c.getState().preview.judgment?.reasons ?? []).map((r) => r.kind);

describe('編集の画面のチャート（Issue #89）', () => {
  it('AC-1: 保存済みのチャートを読み戻してプレビューに置き、時間足の欄はそのまま', async () => {
    const { c, storedPreviews } = await opened(G1);
    const s = c.getState();
    expect(storedPreviews).toHaveLength(2);
    expect(s.charts?.entry).toMatchObject({ phase: 'ready', stored: true });
    expect(s.charts?.entry?.preview).toBe(storedPreviews[0]);
    expect(s.draft.exitChartTimeframe).toBe('4h');
    expect(s.preview.judgment?.grade).toBe('A');
  });

  it('例 1・AC-2・AC-4・AC-6: 決済時を差し替え → 読み取りで日足・B。保存まで送らず、保存は PUT 1 件（multipart）', async () => {
    const { fake, c } = await opened(G1, [tf('1d')]);
    await c.setChart('exit', img());
    const s = c.getState();
    expect(s.draft.exitChartTimeframe).toBe('1d');
    expect(s.charts?.exit).toMatchObject({ phase: 'ready', readMark: true });
    expect(s.charts?.exit?.stored).toBeUndefined();
    expect(s.preview.judgment?.grade).toBe('B');
    expect(reasons(c)).toContain('timeframeLonger');
    expect(changeText(s.before, s.preview)).toMatch(/^判定: A .* → B /);
    // 読み取りは変えた枠だけ（触らないエントリー時は送らない）。書き込みは 0 件
    expect(fake.calls.filter((x) => x.path === '/api/chart-reads')).toHaveLength(1);
    expect(writes(fake)).toEqual([]);
    expect(CHART_READ_MARK).toBe('チャートから');
    await c.save();
    const w = writes(fake);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ method: 'PUT', path: '/api/trades/g1' });
    expect(w[0]?.parts).toEqual(['record', 'exitChart']);
    expect((w[0]?.body as { exitChartTimeframe?: string } | undefined)?.exitChartTimeframe).toBe(
      '1d',
    );
    expect(fake.calls.some((x) => x.path.includes('/charts/') && x.method !== 'GET')).toBe(false);
    expect(c.getState().phase).toBe('saved');
  });

  it('例 2: 差し替えた後に離れる（[キャンセル]）→ 書き込み 0 件・プレビューを閉じる', async () => {
    const { fake, c, storedPreviews } = await opened(G1, [tf('1d')]);
    await c.setChart('exit', img());
    c.dispose();
    expect(writes(fake)).toEqual([]);
    expect(storedPreviews.every((p) => p.closed())).toBe(true);
    expect(fake.trades.find((t) => t.id === 'g1')).toEqual(G1);
  });

  it('例 3: 保存の失敗 → 決まった文言で編集に戻り、取引もチャートも前のまま', async () => {
    const { fake, c } = await opened(G1, [tf('1d')], { 'PUT /api/trades/g1': 503 });
    await c.setChart('exit', img());
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().error).toBe(EDIT_SAVE_FAILED);
    expect(fake.trades.find((t) => t.id === 'g1')).toEqual(G1);
    expect(c.getState().charts?.exit).toMatchObject({ phase: 'ready' });
  });

  it('例 4: 決済時を削除して保存 → 時間足も消え、B → A。removeChart を送る', async () => {
    const { fake, c } = await opened(G2);
    expect(c.getState().preview.judgment?.grade).toBe('B');
    c.removeChart('exit');
    const s = c.getState();
    expect(s.draft.exitChartTimeframe).toBeNull();
    expect(s.preview.judgment?.grade).toBe('A');
    expect(changeText(s.before, s.preview)).toMatch(/^判定: B .* → A /);
    await c.save();
    const put = writes(fake)[0];
    expect(put?.parts).toEqual(['record', 'removeChart']);
    const saved = fake.trades.find((t) => t.id === 'g2') as StoredTrade;
    expect(saved.charts).toEqual({ entry: PNG });
    expect(saved.record.exitChartTimeframe).toBeUndefined();
  });

  it('例 5・6・AC-5: チャートの無い枠の時間足は外す旨。チャートを足した枠は外さない', async () => {
    const { fake, c } = await opened(E2, [tf('1h')]);
    expect(c.getState().orphans.map((o) => o.slot)).toEqual(['entry', 'exit']);
    await c.setChart('exit', img());
    expect(c.getState().orphans.map((o) => o.slot)).toEqual(['entry']);
    expect(c.getState().draft.exitChartTimeframe).toBe('1h');
    await c.save();
    const body = writes(fake)[0]?.body as Record<string, unknown>;
    expect(body.exitChartTimeframe).toBe('1h');
    expect(body.entryChartTimeframe).toBeUndefined();
    const saved = fake.trades.find((t) => t.id === 'e2') as StoredTrade;
    expect(Object.keys(saved.charts ?? {})).toEqual(['exit']);
  });

  it('AC-4: 読み取りの前に選んだ値は上書きせず、案だけを出す', async () => {
    const { c } = await opened(E2, [tf('1d')]);
    const p = c.setChart('exit', img());
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '4h' });
    await p;
    expect(c.getState().draft.exitChartTimeframe).toBe('4h');
    expect(c.getState().charts?.exit?.readSuggest).toBe('1d');
    c.acceptChartTimeframe('exit');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
  });

  it('付属: 読み戻し・並び・一言・削除・保存の本文（例 7〜9）', async () => {
    const { fake, c } = await opened(G3, [tf('15m')]);
    expect(c.getState().extras).toEqual([{ slot: 'x2', timeframe: '1d', note: '上位足の環境' }]);
    expect(c.getState().charts?.x2).toMatchObject({ phase: 'ready', stored: true });
    const a = c.addExtraChart();
    expect(a).toBe('x1');
    await c.setChart('x1', img());
    c.setExtraNote('x1', '下位足のタイミング');
    expect(c.getState().extras.map((e) => [e.slot, e.timeframe, e.note])).toEqual([
      ['x2', '1d', '上位足の環境'],
      ['x1', '15m', '下位足のタイミング'],
    ]);
    // 付属は判定に使わない（例 11・AC-8）
    expect(reasons(c)).not.toContain('timeframeLonger');
    expect(c.getState().preview.judgment?.grade).toBe('A');
    c.removeChart('x2');
    await c.save();
    const put = writes(fake)[0];
    expect(put?.parts).toEqual(['record', 'removeChart', 'x1Chart']);
    expect((put?.body as { extraCharts?: unknown } | undefined)?.extraCharts).toEqual([
      { slot: 'x1', timeframe: '15m', note: '下位足のタイミング' },
    ]);
  });

  it('例 8・10: 付属は 5 枚まで。一言 41 字は保存しない', async () => {
    const { c } = await opened(L1);
    const added = [1, 2, 3, 4, 5].map(() => c.addExtraChart());
    expect(added).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
    expect(c.addExtraChart()).toBeNull();
    expect(EXTRA_FULL).toBe('追加のチャートは 5 枚までです。');
    // 画像の無い行は本文に入れない（足しただけ）
    expect(c.getState().read.canSave).toBe(true);
    c.setExtraNote('x1', 'あ'.repeat(41));
    expect(c.getState().read.canSave).toBe(false);
    c.setExtraNote('x1', 'あ'.repeat(40));
    expect(c.getState().read.canSave).toBe(true);
  });

  it('例 9: 2 枚目を削除して足すと末尾（空いた枠を使う）', async () => {
    const { c } = await opened(L1);
    c.addExtraChart();
    c.addExtraChart();
    c.addExtraChart();
    c.removeChart('x2');
    expect(c.addExtraChart()).toBe('x2');
    expect(c.getState().extras.map((e) => e.slot)).toEqual(['x1', 'x3', 'x2']);
  });
});

describe('記録する画面の付属のチャート（Issue #89 例 7）', () => {
  it('[＋ チャートを追加] → 選ぶ → 一言 → 記録で multipart に x1Chart と extraCharts', async () => {
    const fake = createFakeApi({ instruments: [US30], chartReads: [tf('1d')] });
    const c = createRecordController({
      api: fake.api,
      now: () => Date.UTC(2026, 3, 5, 5, 0),
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(DRAFT_E2)) values[k] = v;
    c.update({ type: 'fill', values });
    const before = c.getState().read.preview;
    const slot = c.addExtraChart();
    expect(slot).toBe('x1');
    await c.setChart('x1', img());
    c.setExtraNote('x1', '上位足の環境');
    expect(c.getState().extras).toEqual([{ slot: 'x1', timeframe: '1d', note: '上位足の環境' }]);
    // 判定は付属が無いときと同じ
    expect(c.getState().read.preview.judgment).toEqual(before.judgment);
    await c.save();
    const post = fake.calls.find((x) => x.method === 'POST' && x.path === '/api/trades');
    expect(post?.parts).toEqual(['record', 'x1Chart']);
    expect((post?.body as { extraCharts?: unknown } | undefined)?.extraCharts).toEqual([
      { slot: 'x1', timeframe: '1d', note: '上位足の環境' },
    ]);
    // 保存の後は枠が空に戻る
    expect(c.getState().extras).toBeUndefined();
  });
});

describe('詳細の付属のチャート（AC-10）', () => {
  it('エントリー時・決済時の後ろに追加した順で、一言と時間足つき', () => {
    const t = stored(
      't',
      {
        ...L1.record,
        extraCharts: [
          { slot: 'x3', note: '指標の画面' },
          { slot: 'x1', timeframe: '1w', note: '週足' },
        ],
      },
      { charts: { entry: PNG, x1: PNG, x3: PNG } },
    );
    expect(chartSlots(t).map((c) => [c.slot, c.name, c.has, c.timeframe, c.note])).toEqual([
      ['entry', 'エントリー時', true, null, undefined],
      ['exit', '決済時', false, null, undefined],
      ['x3', '追加のチャート 1', true, null, '指標の画面'],
      ['x1', '追加のチャート 2', true, '週足', '週足'],
    ]);
  });
});

const notImage = async (): Promise<PrepareResult> => ({ ok: false, error: 'not_image' });
const bodyOf = <T>(call: { body?: unknown } | undefined) => call?.body as T | undefined;

describe('レビュー後の修正（Issue #89 B1・デザイン 4・N6・N11）', () => {
  it('B1: 保存済みの枠に読めない画像 → 前のチャートと時間足のまま知らせ、保存で消さない', async () => {
    const { fake, c, storedPreviews } = await opened(G1, [], undefined, notImage);
    await c.setChart('exit', img());
    const s = c.getState();
    expect(s.charts?.exit).toMatchObject({
      phase: 'ready',
      stored: true,
      message: CHART_MSG.keptNotImage,
    });
    expect(s.charts?.exit?.preview).toBe(storedPreviews[1]);
    expect(storedPreviews[1]?.closed()).toBe(false);
    expect(s.draft.exitChartTimeframe).toBe('4h');
    c.update({ type: 'set', field: 'lc', value: '99.4' });
    await c.save();
    const put = writes(fake)[0];
    expect(put?.parts).toBeUndefined();
    expect(bodyOf<{ exitChartTimeframe?: string }>(put)?.exitChartTimeframe).toBe('4h');
    expect(Object.keys(fake.trades.find((t) => t.id === 'g1')?.charts ?? {})).toEqual([
      'entry',
      'exit',
    ]);
  });

  it('B1: 追加の枠でも、失敗したら時間足と一言が残る', async () => {
    const { fake, c } = await opened(G3, [], undefined, notImage);
    await c.setChart('x2', img());
    expect(c.getState().extras).toEqual([{ slot: 'x2', timeframe: '1d', note: '上位足の環境' }]);
    await c.save();
    const put = writes(fake)[0];
    expect(put?.parts).toBeUndefined();
    expect(bodyOf<{ extraCharts?: unknown }>(put)?.extraCharts).toEqual([
      { slot: 'x2', timeframe: '1d', note: '上位足の環境' },
    ]);
  });

  it('B1: 記録する画面でも、入れたチャートの差し替えに失敗したら前のチャートのまま', async () => {
    const fake = createFakeApi({ instruments: [US30], chartReads: [tf('4h')] });
    const results: PrepareResult[] = [
      { ok: true, image: preparedImage(fakePreview()) },
      { ok: false, error: 'too_large' },
    ];
    const c = createRecordController({
      api: fake.api,
      now: () => Date.UTC(2026, 3, 5, 5, 0),
      prepare: async () => results.shift() as PrepareResult,
    });
    await c.load();
    await c.setChart('entry', img());
    const first = c.getState().charts?.entry?.preview;
    await c.setChart('entry', img());
    expect(c.getState().charts?.entry).toMatchObject({
      phase: 'ready',
      message: CHART_MSG.keptRejected,
    });
    expect(c.getState().charts?.entry?.preview).toBe(first);
    expect(c.getState().draft.entryChartTimeframe).toBe('4h');
  });

  it('デザイン 4: 削除した保存済みの枠は残り、[元に戻す] で元のチャートと時間足に戻る。変更の数', async () => {
    const { fake, c, storedPreviews } = await opened(G2, [tf('15m')]);
    c.removeChart('exit');
    expect(c.getState().charts?.exit?.phase).toBe('removed');
    expect(chartChangeCount(c.getState().charts)).toBe(1);
    await c.setChart('entry', img());
    expect(c.getState().charts?.entry?.replaced).toBe(true);
    expect(chartChangeCount(c.getState().charts)).toBe(2);
    c.restoreChart('exit');
    c.restoreChart('entry');
    const s = c.getState();
    expect(s.charts?.exit?.preview).toBe(storedPreviews[1]);
    expect(s.charts?.entry?.preview).toBe(storedPreviews[0]);
    expect(s.draft.exitChartTimeframe).toBe('1d');
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.preview.judgment?.grade).toBe('B');
    expect(chartChangeCount(s.charts)).toBe(0);
    await c.save();
    expect(writes(fake)[0]?.parts).toBeUndefined();
  });

  it('デザイン 4: 削除した保存済みの追加の枠は行が残り、保存の本文からは外れる', async () => {
    const { fake, c } = await opened(G3);
    c.removeChart('x2');
    expect(c.getState().extras.map((e) => e.slot)).toEqual(['x2']);
    expect(c.getState().charts?.x2?.phase).toBe('removed');
    await c.save();
    const put = writes(fake)[0];
    expect(put?.parts).toEqual(['record', 'removeChart']);
    expect(bodyOf<{ extraCharts?: unknown }>(put)?.extraCharts).toBeUndefined();
  });

  it('N11: ほかの画面でチャートが変わった 400 は決まった文言', async () => {
    const conflict = () =>
      new Response(
        JSON.stringify({ error: 'invalid', issues: [{ field: 'x1Chart', kind: 'noEntry' }] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    const wrap =
      (api: ApiFn): ApiFn =>
      async (path, init) =>
        init?.method === 'PUT' ? conflict() : api(path, init);
    const { c } = await opened(G1, [tf('1d')], undefined, undefined, wrap);
    await c.setChart('exit', img());
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(c.getState().error).toBe(EDIT_CHARTS_CHANGED);
  });

  it('N6: チャートつきの保存の時間の上限は送る大きさで延びる', () => {
    const u = (n: number) => ({ bytes: new Uint8Array(n), contentType: 'image/png' as const });
    expect(chartSaveTimeoutMs({})).toBe(30_000);
    expect(chartSaveTimeoutMs({ entry: u(500_000) })).toBe(40_000);
    const seven = Object.fromEntries(
      ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5'].map((s) => [s, u(500_000)]),
    );
    expect(chartSaveTimeoutMs(seven)).toBe(30_000 + 4 * 10_000);
  });
});

/** 描き直しを手で進める偽物（呼ばれた順に、決めた結果で解く） */
function manualPrepare() {
  const waits: ((r: PrepareResult) => void)[] = [];
  return {
    prepare: () => new Promise<PrepareResult>((ok) => waits.push(ok)),
    resolve: (i: number, r: PrepareResult) => waits[i]?.(r),
  };
}
const okImage = (): PrepareResult => ({ ok: true, image: preparedImage(fakePreview()) });
const bad: PrepareResult = { ok: false, error: 'not_image' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const conflictOn =
  (field: string, kind: string) =>
  (api: ApiFn): ApiFn =>
  async (path, init) =>
    init?.method === 'PUT'
      ? new Response(JSON.stringify({ error: 'invalid', issues: [{ field, kind }] }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      : api(path, init);

describe('再レビュー後の修正（Issue #89 R1〜R5・デザインの再レビュー 1・2・7・8）', () => {
  it('R1: 差し替えの準備中にもう 1 枚貼り、その画像が使えない → 保存済みのまま。removeChart を送らない', async () => {
    const m = manualPrepare();
    const { fake, c, storedPreviews } = await opened(G1, [], undefined, m.prepare);
    const p1 = c.setChart('exit', img());
    const p2 = c.setChart('exit', img());
    await tick();
    m.resolve(1, bad);
    await p2;
    m.resolve(0, okImage());
    await p1;
    const s = c.getState();
    expect(s.charts?.exit).toMatchObject({ phase: 'ready', stored: true });
    expect(s.charts?.exit?.preview).toBe(storedPreviews[1]);
    expect(s.draft.exitChartTimeframe).toBe('4h');
    expect(chartChangeCount(s.charts)).toBe(0);
    await c.save();
    expect(writes(fake)[0]?.parts).toBeUndefined();
  });

  it('R1: 3 回貼って、3 回目が失敗なら（前の 2 回の結果によらず）保存済みのまま', async () => {
    const m = manualPrepare();
    const { fake, c } = await opened(G1, [], undefined, m.prepare);
    const ps = [c.setChart('exit', img()), c.setChart('exit', img()), c.setChart('exit', img())];
    await tick();
    m.resolve(0, okImage());
    m.resolve(2, bad);
    m.resolve(1, okImage());
    await Promise.all(ps);
    expect(c.getState().charts?.exit).toMatchObject({ phase: 'ready', stored: true });
    await c.save();
    expect(writes(fake)[0]?.parts).toBeUndefined();
  });

  it('R1: 使えない画像を 2 回続けて貼っても保存済みのまま', async () => {
    const { fake, c } = await opened(G1, [], undefined, notImage);
    await c.setChart('exit', img());
    await c.setChart('exit', img());
    expect(c.getState().charts?.exit).toMatchObject({ phase: 'ready', stored: true });
    await c.save();
    expect(writes(fake)[0]?.parts).toBeUndefined();
  });

  it('R1・R2: 削除した保存済みの枠に使えない画像 → 削除したまま（[元に戻す] と変更の数を保つ）', async () => {
    const { fake, c } = await opened(G2, [], undefined, notImage);
    c.removeChart('exit');
    await c.setChart('exit', img());
    const s = c.getState();
    expect(s.charts?.exit).toMatchObject({ phase: 'removed', message: CHART_MSG.notImage });
    expect(chartChangeCount(s.charts)).toBe(1);
    await c.save();
    expect(writes(fake)[0]?.parts).toEqual(['record', 'removeChart']);
  });

  it('R4: 付属の一言だけの保存（JSON）の 400 も決まった文言', async () => {
    const { c } = await opened(G3, [], undefined, undefined, conflictOn('extraCharts', 'noChart'));
    c.setExtraNote('x2', '直した一言');
    await c.save();
    expect(c.getState().error).toBe(EDIT_CHARTS_CHANGED);
  });

  it('デザイン 1: 2 枠を差し替えて読めなければ前に保存した時間足を残して知らせ、読めたら置き換える', async () => {
    const { c } = await opened(G2, [tf(null), tf('4h')]);
    await c.setChart('exit', img());
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
    expect(c.getState().charts?.exit?.readNote).toBe(keptTimeframeText('1d'));
    expect(c.getState().preview.judgment?.grade).toBe('B');
    await c.setChart('exit', img());
    expect(c.getState().draft.exitChartTimeframe).toBe('4h');
    expect(c.getState().charts?.exit?.readMark).toBe(true);
    const s = c.getState();
    expect(changeText(s.before, s.preview)).toMatch(/^判定: B .* → A /);
  });

  it('デザイン 1・8: 段と R が同じでも理由が変われば「理由が変わります」。帯はチャートの変更の数つき', () => {
    const tfReason = { kind: 'timeframeLonger', source: 'chart', from: '4h', to: '1d' };
    const before = {
      noLc: false,
      r: -1,
      judgment: { grade: 'B', reasons: [{ kind: 'lcWidened' }, tfReason] },
    };
    const after = {
      noLc: false,
      r: -1,
      judgment: { grade: 'B', reasons: [{ kind: 'lcWidened' }] },
    };
    expect(changeText(before as never, after as never)).toMatch(/のまま・理由が変わります$/);
    expect(changeText(before as never, before as never)).toMatch(/^判定は変わりません: /);
    expect(bandText('判定は変わりません: B 悪い損失 −1.6R', 1)).toBe(
      '判定は同じ（B 悪い損失 −1.6R）・チャート 1 か所を変更',
    );
    expect(bandText('判定: A いい損失 −1.0R → B 悪い損失 −1.0R', 0)).toBe(
      '判定: A いい損失 −1.0R → B 悪い損失 −1.0R',
    );
  });

  it('デザイン 2: 追加の枠は時間足が読めなくても知らせを出さない', async () => {
    const { c } = await opened(L1, [tf(null)]);
    const slot = c.addExtraChart() ?? 'x1';
    await c.setChart(slot, img());
    expect(c.getState().charts?.[slot]?.read).toBe('done');
    expect(c.getState().charts?.[slot]?.readNote).toBeNull();
  });

  it('デザイン 7: 削除した保存済みの追加の枠は 5 枚に数えず、その枠を新しい行に使う', async () => {
    const slots5 = ['x1', 'x2', 'x3', 'x4', 'x5'] as const;
    const five = stored(
      'g5',
      { ...L1.record, extraCharts: slots5.map((s) => ({ slot: s })) },
      { charts: Object.fromEntries(slots5.map((s) => [s, PNG])) },
    );
    const { fake, c } = await opened(five);
    expect(c.addExtraChart()).toBeNull();
    c.removeChart('x2');
    expect(c.addExtraChart()).toBe('x2');
    expect(c.getState().extras.map((e) => e.slot)).toEqual(['x1', 'x3', 'x4', 'x5', 'x2']);
    // 画像を選ばなければ削除のまま送る
    await c.save();
    expect(writes(fake)[0]?.parts).toEqual(['record', 'removeChart']);
  });
});

/** 付属 5 枚（一言つき）の取引（#89 の 3 回目の再レビュー N1） */
const SLOTS5 = ['x1', 'x2', 'x3', 'x4', 'x5'] as const;
const FIVE_NOTES: StoredTrade = stored(
  'g6',
  { ...L1.record, extraCharts: SLOTS5.map((s) => ({ slot: s, note: `資料 ${s}` })) },
  { charts: Object.fromEntries(SLOTS5.map((s) => [s, PNG])) },
);

describe('3 回目の再レビュー後の修正（Issue #89 N1・N2・N4）', () => {
  it('N2: 2 枠を差し替えて読み取りの途中で保存 → その枠は「指定なし」で保存し、帯で知らせる', async () => {
    const { fake, c } = await opened(G2);
    fake.holdChartReads();
    void c.setChart('exit', img());
    await tick();
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
    expect(keptReadingSlots(c.getState().charts)).toEqual(['exit']);
    expect(keptReadingText(['exit'])).toBe(
      '決済時の時間足は読み取りの途中なので指定なしで保存します',
    );
    await c.save();
    const body = bodyOf<{ exitChartTimeframe?: string; entryChartTimeframe?: string }>(
      writes(fake)[0],
    );
    expect(body?.exitChartTimeframe).toBeUndefined();
    expect(body?.entryChartTimeframe).toBe('4h');
    fake.releaseChartReads();
  });

  it('N2: 利用者が時間足を選んでいれば、読み取りの途中でもその値で保存する', async () => {
    const { fake, c } = await opened(G2);
    fake.holdChartReads();
    void c.setChart('exit', img());
    await tick();
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '1w' });
    expect(keptReadingSlots(c.getState().charts)).toEqual([]);
    await c.save();
    expect(bodyOf<{ exitChartTimeframe?: string }>(writes(fake)[0])?.exitChartTimeframe).toBe('1w');
    fake.releaseChartReads();
  });

  it('N2: 読み取りが失敗で終わったときだけ前の時間足を残す', async () => {
    const { fake, c } = await opened(G2, [{ status: 503 }]);
    await c.setChart('exit', img());
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
    expect(c.getState().charts?.exit?.readNote).toBe(keptTimeframeText('1d'));
    await c.save();
    expect(bodyOf<{ exitChartTimeframe?: string }>(writes(fake)[0])?.exitChartTimeframe).toBe('1d');
  });

  it('N1: [削除] → [元に戻す] で、一言と並びの位置も保存した値へ戻る', async () => {
    const { fake, c } = await opened(FIVE_NOTES);
    c.setExtraNote('x2', '直しかけ');
    c.removeChart('x2');
    c.restoreChart('x2');
    expect(c.getState().extras.map((e) => [e.slot, e.note])).toEqual(
      SLOTS5.map((s) => [s, `資料 ${s}`]),
    );
    await c.save();
    expect(bodyOf<{ extraCharts?: unknown }>(writes(fake)[0])?.extraCharts).toEqual(
      SLOTS5.map((s) => ({ slot: s, note: `資料 ${s}` })),
    );
  });

  it('N1・N4: [削除] → 同じ枠に追加 → 使えない画像 → 削除した枠として元の位置と一言へ戻り、知らせは枠と合う', async () => {
    const { c } = await opened(FIVE_NOTES, [], undefined, notImage);
    c.removeChart('x2');
    expect(c.addExtraChart()).toBe('x2');
    expect(c.getState().extras.map((e) => e.slot)).toEqual(['x1', 'x3', 'x4', 'x5', 'x2']);
    await c.setChart('x2', img());
    const s = c.getState();
    expect(s.charts?.x2).toMatchObject({ phase: 'removed', message: CHART_MSG.notImage });
    expect(s.extras.map((e) => [e.slot, e.note])).toEqual(SLOTS5.map((x) => [x, `資料 ${x}`]));
    c.restoreChart('x2');
    expect(c.getState().charts?.x2?.stored).toBe(true);
  });

  it('N1: 削除した枠に足した新しい画像の印は「追加（未保存）」', async () => {
    const { c } = await opened(FIVE_NOTES);
    c.removeChart('x2');
    c.addExtraChart();
    await c.setChart('x2', img());
    expect(c.getState().charts?.x2?.replaced).toBeUndefined();
  });
});
