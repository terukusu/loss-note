// 記録する画面でスクショをまとめて選ぶ（Issue #232・設計書 C67 の AC-2〜AC-7・KEEP-1）。偽の記録の API と偽の描き直しで流す。
// 画像は大きさで見分ける架空の PNG（明細 A = 1,001 B、チャート P = 2,002 B、R = 3,003 B …。描き直しは大きさをそのまま送る）
import { describe, expect, it } from 'vitest';
import { CHART_READ_MSG } from '../../ui/src/lib/chart-read';
import { createRecordController } from '../../ui/src/lib/record-controller';
import { READ_MSG } from '../../ui/src/lib/statement-fill';
import { createFakeApi, type ReadScript } from './helpers/fake-api';
import { US30 } from './helpers/record-drafts';
import { blobOf, fakePreview, pngBytes, ROW_E1, statementBody } from './helpers/statement-rows';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const A = 1001;
const P = 2002;
const R = 3003;
const S = 4004;
const img = (size: number) => blobOf(pngBytes(1200, 800, size));
const readOk: ReadScript = { status: 200, body: statementBody([ROW_E1]) };
const readNone: ReadScript = { status: 200, body: statementBody([]) };
const tf = (timeframe: string | null): ReadScript => ({
  status: 200,
  body: { kind: 'chart', timeframe },
});
const notChart: ReadScript = { status: 200, body: { kind: 'not_chart', timeframe: null } };

async function opened(opts: { reads?: ReadScript[]; chartReads?: ReadScript[] } = {}) {
  const fake = createFakeApi({
    instruments: [US30],
    ...(opts.reads ? { reads: opts.reads } : {}),
    ...(opts.chartReads ? { chartReads: opts.chartReads } : {}),
  });
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    // 送るバイト数 = 選んだ画像の大きさ（どの画像がどこへ送られたかを見分ける）
    prepare: async (file) => ({
      ok: true,
      image: {
        bytes: pngBytes(1200, 800, file.size),
        contentType: 'image/png',
        width: 1200,
        height: 800,
        preview: fakePreview(),
      },
    }),
  });
  await c.load();
  return { fake, c };
}

/** AI の読み取りの要求の並び（明細 = S・チャート = C と送ったバイト数） */
const aiCalls = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls
    .filter((x) => x.path === '/api/statement-reads' || x.path === '/api/chart-reads')
    .map((x) => `${x.path === '/api/statement-reads' ? 'S' : 'C'}${x.bytes}`);

/** 待っている読み取り（明細の後のチャート）が終わるまで回す */
async function settle() {
  for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('まとめて選ぶ（#232）', () => {
  it('AC-2 #1・AC-3: 3 枚 → 明細 A・エントリー時 P・決済時 R。AI の要求は 明細 → チャート → チャート の 1 つずつ', async () => {
    const { fake, c } = await opened({ reads: [readOk], chartReads: [tf('4h'), tf('1d')] });
    fake.holdReads();
    const p = c.pickMany([img(A), img(P), img(R)]);
    // 明細を選んだらすぐ 2 段目（読み取りを待たない。C23）
    expect(c.getState().stage).toBe('review');
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    // 明細の読み取り中はチャートを送らない（明細が先）
    expect(aiCalls(fake)).toEqual([`S${A}`]);
    fake.releaseReads();
    await p;
    await settle();
    expect(aiCalls(fake)).toEqual([`S${A}`, `C${P}`, `C${R}`]);
    const s = c.getState();
    expect(s.statement?.phase).toBe('ready');
    expect(s.charts?.entry?.phase).toBe('ready');
    expect(s.charts?.exit?.phase).toBe('ready');
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.draft.exitChartTimeframe).toBe('1d');
    expect(s.bulkSlots).toEqual(['entry', 'exit']);
    expect(s.bulkDropped ?? 0).toBe(0);
  });

  it('AC-3: 決済時の描き直しが先に終わっても、時間足の読み取りは枠の順（エントリー時 → 決済時）', async () => {
    const fake = createFakeApi({
      instruments: [US30],
      reads: [readOk],
      chartReads: [tf('4h'), tf('1d')],
    });
    // P（エントリー時）の描き直しだけ遅らせる
    let releaseP: () => void = () => {};
    const gateP = new Promise<void>((ok) => {
      releaseP = ok;
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async (file) => {
        if (file.size === P) await gateP;
        return {
          ok: true,
          image: {
            bytes: pngBytes(1200, 800, file.size),
            contentType: 'image/png',
            width: 1200,
            height: 800,
            preview: fakePreview(),
          },
        };
      },
    });
    await c.load();
    const p = c.pickMany([img(A), img(P), img(R)]);
    await settle();
    // 明細は読めた・決済時は描き直し済み。エントリー時の描き直しが残っている間はチャートを送らない
    expect(aiCalls(fake)).toEqual([`S${A}`]);
    releaseP();
    await p;
    await settle();
    expect(aiCalls(fake)).toEqual([`S${A}`, `C${P}`, `C${R}`]);
    expect(c.getState().draft.entryChartTimeframe).toBe('4h');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
  });

  it('描き直しに失敗した枠があっても、ほかの枠の読み取りは送る', async () => {
    const fake = createFakeApi({ instruments: [US30], reads: [readOk], chartReads: [tf('1d')] });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async (file) =>
        file.size === P
          ? { ok: false, error: 'not_image' }
          : {
              ok: true,
              image: {
                bytes: pngBytes(1200, 800, file.size),
                contentType: 'image/png',
                width: 1200,
                height: 800,
                preview: fakePreview(),
              },
            },
    });
    await c.load();
    await c.pickMany([img(A), img(P), img(R)]);
    await settle();
    expect(aiCalls(fake)).toEqual([`S${A}`, `C${R}`]);
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
  });

  it('KEEP-1・AC-2 #2: 1 枚だけ → readImage と同じ（明細の読み取り 1 件・チャートなし・組なし）', async () => {
    const { fake, c } = await opened({ reads: [readOk] });
    await c.pickMany([img(A)]);
    await settle();
    expect(aiCalls(fake)).toEqual([`S${A}`]);
    expect(c.getState().stage).toBe('review');
    expect(c.getState().charts?.entry).toBeUndefined();
    expect(c.getState().bulkSlots ?? []).toEqual([]);
  });

  it('AC-2 #3: エントリー時に前からチャート → 2 枚目は決済時へ、前のチャートはそのまま', async () => {
    const { fake, c } = await opened({ reads: [readOk], chartReads: [tf('1h'), tf('4h')] });
    await c.setChart('entry', img(S));
    await c.pickMany([img(A), img(P)]);
    await settle();
    expect(aiCalls(fake)).toEqual([`C${S}`, `S${A}`, `C${P}`]);
    expect(c.getState().draft.entryChartTimeframe).toBe('1h');
    expect(c.getState().draft.exitChartTimeframe).toBe('4h');
    expect(c.getState().bulkSlots).toEqual(['exit']);
  });

  it('AC-2 #4・#5: 4 枚目からは追加のチャート、入らない分は数える', async () => {
    const { c } = await opened({ reads: [readOk] });
    await c.pickMany([img(A), img(P), img(R), img(S)]);
    await settle();
    expect(c.getState().extras?.map((e) => e.slot)).toEqual(['x1']);
    expect(c.getState().charts?.x1?.phase).toBe('ready');

    const nine = await opened({ reads: [readOk] });
    await nine.c.pickMany(Array.from({ length: 9 }, (_, i) => img(1000 + i * 10)));
    await settle();
    const s = nine.c.getState();
    expect(s.extras).toHaveLength(5);
    expect(s.bulkSlots).toEqual(['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5']);
    expect(s.bulkDropped).toBe(1);
  });

  it('AC-4 #6・AC-6: 逆に選んだ（P, A）→ 入れ替えの相手はエントリー時。押すと選択なしで入れ替えて 1 件ずつ読み直す', async () => {
    const { fake, c } = await opened({
      reads: [readNone, readOk],
      chartReads: [notChart, tf('4h')],
    });
    await c.pickMany([img(P), img(A)]);
    await settle();
    let s = c.getState();
    expect(s.statement).toMatchObject({ phase: 'failed', message: READ_MSG.notStatement });
    expect(s.charts?.entry?.readNote).toBe(CHART_READ_MSG.notChart);
    expect(s.bulkSlots).toEqual(['entry']);
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${A}`]);
    await c.swapBulk();
    await settle();
    s = c.getState();
    // 明細の要求 +1（元の 2 枚目 = A）・チャートの要求 +1（元の 1 枚目 = P）
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${A}`, `S${A}`, `C${P}`]);
    expect(s.statement?.phase).toBe('ready');
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.charts?.entry?.readNote ?? null).toBeNull();
    // 1 回だけ（#10）
    expect(s.bulkSlots).toEqual([]);
  });

  it('AC-4 #7: P, R, A（エントリー時はチャート・決済時がチャートでない）→ 決済時と入れ替える', async () => {
    const { fake, c } = await opened({
      reads: [readNone, readOk],
      chartReads: [tf('1h'), notChart, tf('1d')],
    });
    await c.pickMany([img(P), img(R), img(A)]);
    await settle();
    expect(c.getState().bulkSlots).toEqual(['entry', 'exit']);
    await c.swapBulk();
    await settle();
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${R}`, `C${A}`, `S${A}`, `C${P}`]);
    expect(c.getState().draft.entryChartTimeframe).toBe('1h');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
  });

  it('AC-5 #8: 明細が読めた → 入れ替えを押しても何もしない', async () => {
    const { fake, c } = await opened({ reads: [readOk], chartReads: [notChart] });
    await c.pickMany([img(A), img(P)]);
    await settle();
    const before = aiCalls(fake).length;
    await c.swapBulk();
    await settle();
    expect(aiCalls(fake)).toHaveLength(before);
  });

  it('AC-5 #9: チャートと読めた枠しか無い → 何もしない', async () => {
    const { fake, c } = await opened({ reads: [readNone], chartReads: [tf('4h')] });
    await c.pickMany([img(P), img(R)]);
    await settle();
    await c.swapBulk();
    await settle();
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${R}`]);
  });

  it('AC-5 #12: 明細が上限で失敗 → 何もしない', async () => {
    const { fake, c } = await opened({
      reads: [{ status: 429, body: { error: 'read_limited' } }],
      chartReads: [notChart],
    });
    await c.pickMany([img(P), img(A)]);
    await settle();
    expect(c.getState().statement?.message).toBe(READ_MSG.limited);
    await c.swapBulk();
    await settle();
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${A}`]);
  });

  it('AC-7 #10: 入れ替えた後も読めない → 2 度目は出さない', async () => {
    const { fake, c } = await opened({
      reads: [readNone, readNone],
      chartReads: [notChart, notChart],
    });
    await c.pickMany([img(P), img(A)]);
    await settle();
    await c.swapBulk();
    await settle();
    expect(c.getState().bulkSlots).toEqual([]);
    const n = aiCalls(fake).length;
    await c.swapBulk();
    await settle();
    expect(aiCalls(fake)).toHaveLength(n);
  });

  it('AC-7 #11: 本人が相手の枠を差し替えた・削除した → 組から外れる', async () => {
    const { c } = await opened({ reads: [readNone], chartReads: [notChart, tf('4h')] });
    await c.pickMany([img(P), img(A), img(R)]);
    await settle();
    expect(c.getState().bulkSlots).toEqual(['entry', 'exit']);
    await c.setChart('entry', img(S));
    expect(c.getState().bulkSlots).toEqual(['exit']);
    c.removeChart('exit');
    expect(c.getState().bulkSlots).toEqual([]);
  });

  it('AC-7: 本人が明細を選び直した・手入力に切り替えた → 組を解く', async () => {
    const one = await opened({ reads: [readNone, readNone], chartReads: [notChart] });
    await one.c.pickMany([img(P), img(A)]);
    await settle();
    await one.c.readImage(img(S));
    await settle();
    expect(one.c.getState().bulkSlots).toEqual([]);

    const two = await opened({ reads: [readNone], chartReads: [notChart] });
    await two.c.pickMany([img(P), img(A)]);
    await settle();
    two.c.startManual();
    expect(two.c.getState().bulkSlots).toEqual([]);
  });

  it('AC-7: 読めた明細を削除した → 組を解く', async () => {
    const { c } = await opened({ reads: [readOk], chartReads: [tf('4h')] });
    await c.pickMany([img(A), img(P)]);
    await settle();
    expect(c.getState().bulkSlots).toEqual(['entry']);
    c.removeStatement();
    expect(c.getState().bulkSlots).toEqual([]);
  });

  it('レビュー 1: 取り違えた組の後に正しい順でまとめて選び直す → 前の組の枠は外して入れ直す（追加は増えない）', async () => {
    const { fake, c } = await opened({
      reads: [readNone, readOk],
      chartReads: [notChart, tf('4h'), tf('1d')],
    });
    await c.pickMany([img(P), img(A)]);
    await settle();
    expect(c.getState().bulkSlots).toEqual(['entry']);
    c.setStage('input');
    await c.pickMany([img(A), img(P), img(R)]);
    await settle();
    const s = c.getState();
    expect(aiCalls(fake)).toEqual([`S${P}`, `C${A}`, `S${A}`, `C${P}`, `C${R}`]);
    expect(s.statement?.phase).toBe('ready');
    expect(s.draft.entryChartTimeframe).toBe('4h');
    expect(s.draft.exitChartTimeframe).toBe('1d');
    expect(s.extras ?? []).toEqual([]);
    expect(s.bulkSlots).toEqual(['entry', 'exit']);
  });

  it('レビュー 1: 本人が 1 枚ずつ入れた枠は、まとめて選び直しても飛ばす（例 #3）', async () => {
    const { c } = await opened({
      reads: [readNone, readOk],
      chartReads: [tf('1h'), notChart, tf('1d')],
    });
    await c.setChart('entry', img(S));
    await c.pickMany([img(P), img(A)]);
    await settle();
    expect(c.getState().bulkSlots).toEqual(['exit']);
    await c.pickMany([img(A), img(R)]);
    await settle();
    expect(c.getState().draft.entryChartTimeframe).toBe('1h');
    expect(c.getState().draft.exitChartTimeframe).toBe('1d');
    expect(c.getState().bulkSlots).toEqual(['exit']);
  });

  it('入らなかった枚数の 1 行は、次に本人が明細を選んだら消える', async () => {
    const { c } = await opened({ reads: [readOk, readOk] });
    await c.pickMany(Array.from({ length: 9 }, (_, i) => img(1000 + i * 10)));
    await settle();
    expect(c.getState().bulkDropped).toBe(1);
    await c.readImage(img(A));
    expect(c.getState().bulkDropped).toBe(0);
  });
});
