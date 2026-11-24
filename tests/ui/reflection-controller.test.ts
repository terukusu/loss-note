// Good / More の付け外しの通信と状態（Issue #123 の AC-9・R6・例 #10）。偽の API（本物と同じ検査の要点）で回す。値は架空
import { describe, expect, it } from 'vitest';
import { EMPTY_REFLECTION, MAX_REFLECTION_NOTES } from '../../core/reflection';
import { REFLECTION_SAVE_FAILED, REFLECTION_SAVE_GONE } from '../../ui/src/lib/reflection';
import {
  createReflectionController,
  REFLECTIONS_PATH,
} from '../../ui/src/lib/reflection-controller';
import { AUTH_EXPIRED, createRequest } from '../../ui/src/lib/request';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { createFakeApi } from './helpers/fake-api';
import { L1, L2, US30 } from './helpers/trade-examples';

const settle = () => new Promise((ok) => setTimeout(ok, 0));
const sends = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((c) => c.method === 'PUT' && c.path === REFLECTIONS_PATH);

const make = (fake: ReturnType<typeof createFakeApi>, ids = [L1.id], initial?: unknown) =>
  createReflectionController({ request: createRequest(fake.api), tradeIds: ids, initial });

describe('reflection-controller', () => {
  it('AC-9: チップを押した時点の値を送る（取引の ID と両側。話題は一覧の順）', async () => {
    const fake = createFakeApi({ trades: [L1, L2], instruments: [US30] });
    const saved: unknown[] = [];
    const c = createReflectionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id, L2.id],
      initial: undefined,
      onSaved: (r) => saved.push(r),
    });
    c.toggle('more', 'lcTooTight');
    expect(c.getState().value.more.topics).toEqual(['lcTooTight']);
    await settle();
    c.toggle('more', 'enteredEarly');
    await settle();
    expect(sends(fake).map((x) => x.body)).toEqual([
      {
        tradeIds: [L1.id, L2.id],
        good: { topics: [], notes: [] },
        more: { topics: ['lcTooTight'], notes: [] },
      },
      {
        tradeIds: [L1.id, L2.id],
        good: { topics: [], notes: [] },
        more: { topics: ['enteredEarly', 'lcTooTight'], notes: [] },
      },
    ]);
    expect(fake.trades.find((t) => t.id === L2.id)?.reflection?.more.topics).toEqual([
      'enteredEarly',
      'lcTooTight',
    ]);
    expect(saved).toHaveLength(2);
    expect(c.getState()).toMatchObject({ sending: false, error: null });
  });

  it('例 #2: 書きかけを行として足すと欄が空になり、足した順に送る。消すと詰まる', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = make(fake);
    c.setDraft('more', ' 出る前に TP を決める ');
    c.addNote('more');
    expect(c.getState().drafts.more).toBe('');
    await settle();
    c.setDraft('more', '架空の 2 行目');
    c.addNote('more');
    await settle();
    expect(fake.trades[0]?.reflection?.more.notes).toEqual([
      '出る前に TP を決める',
      '架空の 2 行目',
    ]);
    c.removeNote('more', 0);
    await settle();
    expect(fake.trades[0]?.reflection?.more.notes).toEqual(['架空の 2 行目']);
  });

  it('足せない行は理由を出して送らない。打ち直すと理由が消える', () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = make(fake);
    c.addNote('good');
    expect(c.getState().noteIssues.good).toBe('empty');
    c.setDraft('good', 'あ'.repeat(101));
    expect(c.getState().noteIssues.good).toBeNull();
    c.addNote('good');
    expect(c.getState().noteIssues.good).toBe('tooLong');
    expect(c.getState().drafts.good).toBe('あ'.repeat(101));
    expect(sends(fake)).toHaveLength(0);
    const full = make(fake, [L1.id], {
      good: {
        topics: [],
        notes: Array.from({ length: MAX_REFLECTION_NOTES }, (_, i) => `行 ${i}`),
      },
      more: { topics: [], notes: [] },
    });
    full.setDraft('good', '11 行目');
    full.addNote('good');
    expect(full.getState().noteIssues.good).toBe('full');
  });

  it('送っている間に変えたら、終わった後に最新の値を 1 本だけ送る', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = make(fake);
    fake.hold();
    c.toggle('good', 'cutEarly');
    c.toggle('good', 'readRight');
    c.toggle('more', 'oversized');
    expect(sends(fake)).toHaveLength(1);
    fake.release();
    await settle();
    await settle();
    expect(sends(fake)).toHaveLength(2);
    expect(fake.trades[0]?.reflection).toEqual({
      good: { topics: ['cutEarly', 'readRight'], notes: [] },
      more: { topics: ['oversized'], notes: [] },
    });
  });

  it('例 #10: 失敗したら最後に保存できた値へ戻り、失敗の文言が出る。書きかけは消さない', async () => {
    const fake = createFakeApi({
      trades: [L1],
      instruments: [US30],
      failOnce: { [`PUT ${REFLECTIONS_PATH}`]: 'throw' },
    });
    const c = make(fake, [L1.id], {
      good: { topics: ['cutEarly'], notes: [] },
      more: { topics: [], notes: [] },
    });
    c.setDraft('more', '架空の一言');
    c.toggle('more', 'reEntered');
    await settle();
    expect(c.getState()).toMatchObject({
      value: { good: { topics: ['cutEarly'] }, more: { topics: [] } },
      sending: false,
      error: REFLECTION_SAVE_FAILED,
      errorKind: 'network',
    });
    expect(c.getState().drafts.more).toBe('架空の一言');
    expect(fake.trades[0]?.reflection).toBeUndefined();
    c.toggle('more', 'reEntered');
    expect(c.getState().error).toBeNull();
    await settle();
    expect(c.getState().saved.more.topics).toEqual(['reEntered']);
  });

  it('500 は同じ失敗、404・409 は押し直しても通らない文言、ログインが切れたらログインの文言', async () => {
    for (const [status, msg] of [
      [500, REFLECTION_SAVE_FAILED],
      [404, REFLECTION_SAVE_GONE],
      [409, REFLECTION_SAVE_GONE],
      [401, AUTH_EXPIRED],
    ] as const) {
      const fake = createFakeApi({
        trades: [L1],
        instruments: [US30],
        fail: { [`PUT ${REFLECTIONS_PATH}`]: status },
      });
      const c = make(fake);
      c.toggle('good', 'cutEarly');
      await settle();
      expect(c.getState().value).toEqual(EMPTY_REFLECTION);
      expect(c.getState().error).toBe(msg);
    }
  });

  it('dispose の後は知らせず、操作しても送らない', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = make(fake);
    const seen: unknown[] = [];
    c.subscribe((s) => seen.push(s));
    c.toggle('good', 'cutEarly');
    c.dispose();
    const n = seen.length;
    await settle();
    expect(seen).toHaveLength(n);
    c.toggle('good', 'readRight');
    c.setDraft('good', 'x');
    c.addNote('good');
    expect(sends(fake)).toHaveLength(1);
  });
});

describe('詳細の controller の applyReflection', () => {
  it('読んだ取引の Good / More だけを差し替え、判定は変えない。空なら鍵ごと消す', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const d = createTradeDetailController({
      api: fake.api,
      id: L1.id,
      preview: async () => ({ width: 1, height: 1, draw: () => {}, close: () => {} }),
    });
    await d.load();
    const before = d.getState();
    if (before.phase !== 'ready') throw new Error('読めていない');
    const c = createReflectionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id],
      initial: before.trade.reflection,
      onSaved: (r) => d.applyReflection(r),
    });
    c.toggle('good', 'followedRules');
    await settle();
    const after = d.getState();
    if (after.phase !== 'ready') throw new Error('読めていない');
    expect(after.trade.reflection?.good.topics).toEqual(['followedRules']);
    expect(after.summary).toEqual(before.summary);
    await d.load();
    const again = d.getState();
    expect(again.phase === 'ready' && again.trade.reflection?.good.topics).toEqual([
      'followedRules',
    ]);
    c.toggle('good', 'followedRules');
    await settle();
    const cleared = d.getState();
    expect(cleared.phase === 'ready' && 'reflection' in cleared.trade).toBe(false);
  });
});

describe('［完了］で書きかけを足す', () => {
  it('書きかけがあれば行として足して true、足せなければ理由を出して false、空なら何もしない', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = make(fake);
    expect(c.commitDrafts()).toBe(true);
    expect(sends(fake)).toHaveLength(0);
    c.setDraft('good', ' 架空の一言 ');
    c.setDraft('more', '   ');
    expect(c.commitDrafts()).toBe(true);
    await settle();
    expect(fake.trades[0]?.reflection?.good.notes).toEqual(['架空の一言']);
    expect(c.getState().drafts).toEqual({ good: '', more: '   ' });
    c.setDraft('more', 'あ'.repeat(101));
    expect(c.commitDrafts()).toBe(false);
    expect(c.getState().noteIssues.more).toBe('tooLong');
  });
});
