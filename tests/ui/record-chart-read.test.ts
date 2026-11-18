// 記録する画面のチャートの時間足の読み取り（Issue #27 の画面の例 U1〜U8 と、5.6 #20 へのつなぎ）。
// 偽の記録の API（POST /api/chart-reads の台本）と偽の描き直しで流す。画像・値はすべて架空
import { describe, expect, it } from 'vitest';
import { CHART_READ_MSG } from '../../ui/src/lib/chart-read';
import { reasonText } from '../../ui/src/lib/reasons';
import {
  AUTH_EXPIRED,
  createRecordController,
  type RecordController,
} from '../../ui/src/lib/record-controller';
import { type Draft, EMPTY_DRAFT } from '../../ui/src/lib/record-form';
import { createFakeApi, type ReadScript } from './helpers/fake-api';
import { E2, US30 } from './helpers/record-drafts';
import { blobOf, fakePreview, pngBytes, preparedImage } from './helpers/statement-rows';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const img = () => blobOf(pngBytes(1200, 800, 2048));
const tf = (timeframe: string | null): ReadScript => ({
  status: 200,
  body: { kind: 'chart', timeframe },
});

async function opened(chartReads: readonly ReadScript[]) {
  const fake = createFakeApi({ instruments: [US30], chartReads });
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
  return { fake, c, previews };
}

function fillFrom(c: RecordController, d: Draft) {
  const values: Partial<Draft> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== (EMPTY_DRAFT as unknown as Record<string, unknown>)[k])
      (values as Record<string, unknown>)[k] = v;
  }
  c.update({ type: 'fill', values });
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

const chartReadCalls = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((x) => x.path === '/api/chart-reads');

describe('チャートの時間足の読み取り（Issue #27 の画面の例）', () => {
  it('U1: 枠に入れると追加の操作なしで送り、空の欄を読んだ値で埋めて印を付ける', async () => {
    const { fake, c } = await opened([tf('4h')]);
    await c.setChart('entry', img());
    const calls = chartReadCalls(fake);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', contentType: 'image/png', bytes: 4096 });
    const s = c.getState();
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.charts?.entry).toMatchObject({ phase: 'ready', read: 'done', readMark: true });
    expect(s.charts?.entry?.readNote ?? null).toBeNull();
  });

  it('U2: 読み取り中に利用者が日足を選ぶ → 届いた 4 時間足で上書きしない', async () => {
    const { fake, c } = await opened([tf('4h')]);
    fake.holdChartReads();
    const p = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '1d' });
    fake.releaseChartReads();
    await p;
    const s = c.getState();
    expect(s.draft.entryChartTimeframe).toBe('1d');
    expect(s.charts?.entry?.readMark ?? false).toBe(false);
    expect(s.charts?.entry?.read).toBe('done');
  });

  it('U3: 読み取り中に同じ枠を差し替える → 古い応答は捨て、新しいチャートの応答で埋める', async () => {
    const { fake, c, previews } = await opened([tf('4h'), tf('1h')]);
    fake.holdChartReads();
    const first = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    fake.releaseChartReads();
    // 古い要求の応答が届く前に差し替える（差し替えで古い要求は止まる）
    const second = c.setChart('entry', img());
    await Promise.all([first, second]);
    const s = c.getState();
    expect(previews[0]?.closed()).toBe(true);
    expect(s.charts?.entry?.preview).toBe(previews[1]);
    expect(s.draft.entryChartTimeframe).toBe('1h');
    expect(s.charts?.entry?.readMark).toBe(true);
  });

  it('U3: 外した後に届いた応答も捨てる（欄は空のまま）', async () => {
    const { fake, c } = await opened([tf('4h')]);
    fake.holdChartReads();
    const p = c.setChart('exit', img());
    await until(() => c.getState().charts?.exit?.read === 'reading');
    c.removeChart('exit');
    fake.releaseChartReads();
    await p;
    expect(c.getState().charts?.exit).toBeUndefined();
    expect(c.getState().draft.exitChartTimeframe).toBeNull();
  });

  it('U4: 応答の時間足が空 → 欄は空のまま知らせる', async () => {
    const { c } = await opened([tf(null)]);
    await c.setChart('entry', img());
    const s = c.getState();
    expect(s.draft.entryChartTimeframe).toBeNull();
    expect(s.charts?.entry?.readNote).toBe(CHART_READ_MSG.noTimeframe);
    expect(s.charts?.entry?.readMark ?? false).toBe(false);
  });

  it('U5: チャートでない → 欄は空、知らせる。枠の画像はそのまま', async () => {
    const { c } = await opened([{ status: 200, body: { kind: 'not_chart', timeframe: null } }]);
    await c.setChart('exit', img());
    const s = c.getState();
    expect(s.draft.exitChartTimeframe).toBeNull();
    expect(s.charts?.exit?.phase).toBe('ready');
    expect(s.charts?.exit?.readNote).toBe(CHART_READ_MSG.notChart);
  });

  it('U6: 読み取り中も [記録する] を押せる。記録した時点の読み取りは止めて結果を捨てる（時間足は空のまま）', async () => {
    const { fake, c } = await opened([tf('4h')]);
    fillFrom(c, E2);
    fake.holdChartReads();
    const p = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    expect(c.getState().read.canSave).toBe(true);
    expect(c.getState().read.notice).toBe(CHART_READ_MSG.reading);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(c.getState().saved?.trade.record.entryChartTimeframe).toBeUndefined();
    expect(fake.charts.size).toBe(1);
    fake.releaseChartReads();
    await p;
    // 後で届いた応答は捨てる（保存の後の画面は変わらない）
    expect(c.getState().phase).toBe('saved');
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
  });

  it('U6: 利用者が選んだ時間足は、読み取りを待たずにそのまま記録される', async () => {
    const { fake, c } = await opened([tf('4h')]);
    fillFrom(c, E2);
    fake.holdChartReads();
    const p = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '1h' });
    await c.save();
    expect(c.getState().saved?.trade.record.entryChartTimeframe).toBe('1h');
    fake.releaseChartReads();
    await p;
  });

  it.each([
    ['上限 429', { status: 429, body: { error: 'read_limited' } }, CHART_READ_MSG.limited],
    ['形の外 502', { status: 502, body: { error: 'read_invalid_result' } }, CHART_READ_MSG.failed],
    ['時間切れ 504', { status: 504, body: { error: 'read_timeout' } }, CHART_READ_MSG.failed],
    [
      '使えない 503',
      { status: 503, body: { error: 'read_unavailable' } },
      CHART_READ_MSG.unavailable,
    ],
    ['通信の失敗', 'throw', CHART_READ_MSG.failed],
    [
      '形の外の本文',
      { status: 200, body: { kind: 'chart', timeframe: '4H' } },
      CHART_READ_MSG.failed,
    ],
  ] as const)(
    'U7: 読み取りの失敗（%s）→ 欄は空・決まった文言・保存できる',
    async (_n, script, msg) => {
      const { fake, c } = await opened([script as ReadScript]);
      fillFrom(c, E2);
      await c.setChart('entry', img());
      const s = c.getState();
      expect(s.draft.entryChartTimeframe).toBeNull();
      expect(s.charts?.entry?.readNote).toBe(msg);
      expect(JSON.stringify(s)).not.toContain('SECRET');
      expect(s.read.canSave).toBe(true);
      await c.save();
      expect(c.getState().phase).toBe('saved');
      expect(fake.charts.size).toBe(1);
    },
  );

  it('U7: ログインが切れた（401）→ 欄は空・ログインの案内', async () => {
    const { c } = await opened([{ status: 401, body: { error: 'unauthorized' } }]);
    await c.setChart('entry', img());
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
    expect(c.getState().error).toBe(AUTH_EXPIRED);
  });

  it('U8: 読んだ 4 時間足を利用者が日足に直す → 欄は日足、印は消える', async () => {
    const { c } = await opened([tf('4h')]);
    await c.setChart('entry', img());
    expect(c.getState().charts?.entry?.readMark).toBe(true);
    c.update({ type: 'set', field: 'entryChartTimeframe', value: '1d' });
    expect(c.getState().draft.entryChartTimeframe).toBe('1d');
    expect(c.getState().charts?.entry?.readMark).toBe(false);
  });

  it('差し替えると時間足は空に戻ってから、新しいチャートの読み取りで埋まる（#12 の選び直しのまま）', async () => {
    const { c } = await opened([tf('4h'), tf(null)]);
    await c.setChart('entry', img());
    expect(c.getState().draft.entryChartTimeframe).toBe('4h');
    await c.setChart('entry', img());
    expect(c.getState().draft.entryChartTimeframe).toBeNull();
    expect(c.getState().charts?.entry?.readNote).toBe(CHART_READ_MSG.noTimeframe);
  });

  it('5.6 #20: エントリー時 4 時間足・決済時 日足（どちらも読み取り）、タップは「そのまま」→ B（時間足を変えた・チャートから）', async () => {
    const { fake, c } = await opened([tf('4h'), tf('1d')]);
    fillFrom(c, E2);
    c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
    await c.setChart('entry', img());
    await c.setChart('exit', img());
    const s = c.getState();
    expect(s.read.preview.judgment?.grade).toBe('B');
    const reasons = (s.read.preview.judgment?.reasons ?? []).map((r) => reasonText(r, 'L'));
    expect(reasons).toContain('時間足を変えた（4 時間足 → 日足・チャートから）');
    await c.save();
    const saved = c.getState().saved?.trade;
    expect(saved?.record.entryChartTimeframe).toBe('4h');
    expect(saved?.record.exitChartTimeframe).toBe('1d');
    expect(fake.charts.size).toBe(2);
  });

  it('U2・U9: 選んだ値と読めた値が違えば上書きせず案を出し、[〈値〉にする] の 1 タップで直せる（印が付く）', async () => {
    const { fake, c } = await opened([tf('1d')]);
    fake.holdChartReads();
    const p = c.setChart('exit', img());
    await until(() => c.getState().charts?.exit?.read === 'reading');
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '4h' });
    fake.releaseChartReads();
    await p;
    expect(c.getState().draft.exitChartTimeframe).toBe('4h');
    expect(c.getState().charts?.exit?.readSuggest).toBe('1d');
    c.acceptChartTimeframe('exit');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
    expect(c.getState().charts?.exit?.readMark).toBe(true);
    expect(c.getState().charts?.exit?.readSuggest ?? null).toBeNull();
  });

  it('U9: 案と同じ値を自分で選ぶと案は消える', async () => {
    const { fake, c } = await opened([tf('1d')]);
    fake.holdChartReads();
    const p = c.setChart('exit', img());
    await until(() => c.getState().charts?.exit?.read === 'reading');
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '4h' });
    fake.releaseChartReads();
    await p;
    c.update({ type: 'set', field: 'exitChartTimeframe', value: '1d' });
    expect(c.getState().charts?.exit?.readSuggest ?? null).toBeNull();
  });

  it('B1・案 2: AI の読み取りは 1 つずつ。2 枠は順に送り、明細の読み取り中はチャートを待たせる', async () => {
    const { fake, c } = await opened([tf('4h'), tf('1d')]);
    fake.holdChartReads();
    const a = c.setChart('entry', img());
    const b = c.setChart('exit', img());
    await until(() => c.getState().charts?.exit?.read === 'reading');
    // 送っているのはエントリー時の 1 つだけ
    expect(chartReadCalls(fake)).toHaveLength(1);
    fake.releaseChartReads();
    await Promise.all([a, b]);
    expect(chartReadCalls(fake)).toHaveLength(2);
    expect(c.getState().draft.entryChartTimeframe).toBe('4h');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
  });

  it('B1・案 2: 明細の読み取り中に貼ったチャートは、明細の応答の後に送る（明細が先）', async () => {
    const fake = createFakeApi({ instruments: [US30], chartReads: [tf('4h')] });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    fake.holdReads();
    const st = c.readImage(img());
    await until(() => c.getState().statement?.phase === 'reading');
    const ch = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    expect(chartReadCalls(fake)).toHaveLength(0);
    fake.releaseReads();
    await Promise.all([st, ch]);
    const order = fake.calls
      .filter((x) => x.path === '/api/statement-reads' || x.path === '/api/chart-reads')
      .map((x) => x.path);
    expect(order).toEqual(['/api/statement-reads', '/api/chart-reads']);
  });

  it('B1・案 2: 送っているチャートがあれば、明細はその後に送る（同時に 2 つ送らない）', async () => {
    const { fake, c } = await opened([tf('4h')]);
    fake.holdChartReads();
    const ch = c.setChart('entry', img());
    await until(() => chartReadCalls(fake).length === 1);
    const st = c.readImage(img());
    await until(() => c.getState().statement?.phase === 'reading');
    expect(fake.calls.filter((x) => x.path === '/api/statement-reads')).toHaveLength(0);
    fake.releaseChartReads();
    await Promise.all([st, ch]);
    expect(fake.calls.filter((x) => x.path === '/api/statement-reads')).toHaveLength(1);
  });

  it('N4: 送る前に差し替えたチャートは送らない（待っている枠の読み取りは 1 回だけ）', async () => {
    const { fake, c } = await opened([tf('4h'), tf('1d'), tf('1h')]);
    fake.holdChartReads();
    const a = c.setChart('entry', img());
    await until(() => chartReadCalls(fake).length === 1);
    const b1 = c.setChart('exit', img());
    const b2 = c.setChart('exit', img());
    fake.releaseChartReads();
    await Promise.all([a, b1, b2]);
    expect(chartReadCalls(fake)).toHaveLength(2);
  });

  it('R1: 記録が失敗して編集に戻ったら、止めた時間足の読み取りを送り直して欄を埋める', async () => {
    const fake = createFakeApi({
      instruments: [US30],
      chartReads: [tf('1h'), tf('4h')],
      failOnce: { 'POST /api/trades': 503 },
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    fillFrom(c, E2);
    fake.holdChartReads();
    const p = c.setChart('entry', img());
    await until(() => c.getState().charts?.entry?.read === 'reading');
    await c.save();
    expect(c.getState().phase).toBe('editing');
    // 送り直した（読み取り中に戻り、待ち行列から 2 回目を送る）
    expect(c.getState().charts?.entry?.read).toBe('reading');
    await until(() => chartReadCalls(fake).length === 2);
    fake.releaseChartReads();
    await p;
    await until(() => c.getState().charts?.entry?.read === 'done');
    // 止めた 1 回目の応答（1 時間足）は捨て、送り直した応答（4 時間足）で埋める
    expect(c.getState().draft.entryChartTimeframe).toBe('4h');
    expect(c.getState().charts?.entry?.readMark).toBe(true);
  });
});
