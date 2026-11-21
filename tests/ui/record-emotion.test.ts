// 保存の後のシートで心理を付ける（Issue #156 の AC-4・AC-5・R4）。記録の controller を偽の API で回し、保存の後（saved）に
// 移る回数と、付ける先（SavedView.trades）をそのまま emotion-controller に渡して、偽の API の取引に付くかを見る。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { createEmotionController } from '../../ui/src/lib/emotion-controller';
import {
  createRecordController,
  type RecordController,
  type RecordPhase,
} from '../../ui/src/lib/record-controller';
import { applyDraft, EMPTY_DRAFT } from '../../ui/src/lib/record-form';
import { opensEmotionSheet } from '../../ui/src/lib/record-screen';
import { createRequest } from '../../ui/src/lib/request';
import { createFakeApi, type FakeApi, type ReadScript } from './helpers/fake-api';
import { E1, US30 } from './helpers/record-drafts';
import {
  blobOf,
  fakePreview,
  pngBytes,
  preparedImage,
  ROWS_E10,
  statementBody,
} from './helpers/statement-rows';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const settle = () => new Promise((ok) => setTimeout(ok, 0));

/** 保存の後のシートを開いた回数（画面の hook と同じ判定 opensEmotionSheet を、状態の移りごとに数える） */
function watchSheet(c: RecordController) {
  let prev: RecordPhase = c.getState().phase;
  let opened = 0;
  c.subscribe((s) => {
    if (opensEmotionSheet(prev, s.phase)) opened += 1;
    prev = s.phase;
  });
  return () => opened;
}

async function openedForRead(reads: readonly ReadScript[]) {
  const fake = createFakeApi({ instruments: [US30], reads });
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
  });
  await c.load();
  return { fake, c };
}

function typeFive(c: RecordController, lc: string) {
  for (const a of [
    { type: 'set', field: 'lc', value: lc },
    { type: 'set', field: 'brokenCondition', value: '押し目の安値を割ったら' },
    { type: 'set', field: 'lcDecided', value: true },
    { type: 'set', field: 'lcMove', value: 'none' },
    { type: 'set', field: 'timeframeChange', value: 'none' },
  ] as const)
    c.update(a);
}

/** 保存の後のシートで押す（画面と同じく SavedView.trades の ID へ送る） */
async function tagSaved(fake: FakeApi, c: RecordController, ids: Parameters<typeof tag>[1]) {
  const saved = c.getState().saved;
  if (!saved) throw new Error('保存の後ではない');
  return tag(
    fake,
    ids,
    (saved.trades ?? [saved.trade]).map((t) => t.id),
  );
}

async function tag(
  fake: FakeApi,
  ids: readonly ('overconfident' | 'bargain' | 'recoup' | 'wantPosition')[],
  tradeIds: string[],
) {
  const e = createEmotionController({ request: createRequest(fake.api), tradeIds, initial: [] });
  for (const id of ids) e.toggle(id);
  for (let i = 0; i < 10 && e.getState().sending; i++) await settle();
  await settle();
  return e;
}

const tagsOf = (fake: FakeApi) =>
  fake.trades.map((t: StoredTrade) => [t.record.entries[0]?.price, t.emotionTags ?? []]);

describe('保存の後のシートの回数（AC-4）', () => {
  it('例 #1: 1 行の記録（手入力）で 1 回。付けたタグは一覧の順', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = createRecordController({ api: fake.api, now: () => NOW });
    await c.load();
    const opened = watchSheet(c);
    c.update({ type: 'fill', values: applyDraft(EMPTY_DRAFT, { type: 'fill', values: E1 }) });
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(opened()).toBe(1);
    expect(c.getState().saved?.trades?.map((t) => t.id)).toEqual([c.getState().saved?.trade.id]);
    await tagSaved(fake, c, ['recoup', 'wantPosition']);
    expect(fake.trades[0]?.emotionTags).toEqual(['wantPosition', 'recoup']);
    // 次の取引へ進んでもう 1 件記録すると、もう 1 回
    c.next();
    c.update({ type: 'fill', values: applyDraft(EMPTY_DRAFT, { type: 'fill', values: E1 }) });
    await c.save();
    expect(opened()).toBe(2);
  });

  it('例 #6: 3 行の明細は 1・2 行目の保存では開かず、3 行目の後に 1 回。3 件すべてに付く（AC-5）', async () => {
    const { fake, c } = await openedForRead([{ status: 200, body: statementBody(ROWS_E10) }]);
    const opened = watchSheet(c);
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    typeFive(c, '99.0');
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(opened()).toBe(0);
    typeFive(c, '202');
    await c.save();
    expect(c.getState().phase).toBe('editing');
    expect(opened()).toBe(0);
    typeFive(c, '49');
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(opened()).toBe(1);
    expect(c.getState().saved?.trades).toHaveLength(3);
    await tagSaved(fake, c, ['overconfident']);
    expect(tagsOf(fake)).toEqual([
      [100, ['overconfident']],
      [200, ['overconfident']],
      [50, ['overconfident']],
    ]);
  });

  it('例 #7: 2 行目をスキップすると、保存した 1・3 行目の 2 件にだけ付く（AC-5）', async () => {
    const { fake, c } = await openedForRead([{ status: 200, body: statementBody(ROWS_E10) }]);
    const opened = watchSheet(c);
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    typeFive(c, '99.0');
    await c.save();
    c.skipRow();
    typeFive(c, '49');
    await c.save();
    expect(opened()).toBe(1);
    expect(c.getState().saved?.trades?.map((t) => t.record.entries[0]?.price)).toEqual([100, 50]);
    await tagSaved(fake, c, ['bargain']);
    expect(tagsOf(fake)).toEqual([
      [100, ['bargain']],
      [50, ['bargain']],
    ]);
  });

  it('最後の行をスキップしたら開かない（保存した行には詳細から付ける。計画の論点 2）', async () => {
    const { c } = await openedForRead([{ status: 200, body: statementBody(ROWS_E10.slice(0, 2)) }]);
    const opened = watchSheet(c);
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    typeFive(c, '99.0');
    await c.save();
    c.skipRow();
    expect(c.getState().phase).toBe('editing');
    expect(opened()).toBe(0);
  });

  it('次の明細では前の明細の保存した行を持ち越さない', async () => {
    const { c } = await openedForRead([
      { status: 200, body: statementBody(ROWS_E10.slice(0, 1)) },
      { status: 200, body: statementBody(ROWS_E10.slice(2, 3)) },
    ]);
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    typeFive(c, '99.0');
    await c.save();
    c.next();
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    typeFive(c, '49');
    await c.save();
    expect(c.getState().saved?.trades?.map((t) => t.record.entries[0]?.price)).toEqual([50]);
  });

  it('opensEmotionSheet は saved に移ったときだけ', () => {
    expect(opensEmotionSheet('saving', 'saved')).toBe(true);
    expect(opensEmotionSheet('saved', 'saved')).toBe(false);
    expect(opensEmotionSheet('saving', 'editing')).toBe(false);
    expect(opensEmotionSheet('loading', 'editing')).toBe(false);
  });
});
