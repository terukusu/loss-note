// 心理のタグの付け外しの通信と状態（Issue #156 の AC-6・AC-7・R5）。偽の API（本物と同じ検査の要点）で回す
import { describe, expect, it } from 'vitest';
import { createEmotionController, EMOTIONS_PATH } from '../../ui/src/lib/emotion-controller';
import { EMOTION_SAVE_FAILED, EMOTION_SAVE_GONE } from '../../ui/src/lib/emotion-tags';
import { AUTH_EXPIRED, createRequest } from '../../ui/src/lib/request';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { createFakeApi } from './helpers/fake-api';
import { L1, L2, L3, US30 } from './helpers/trade-examples';

const settle = () => new Promise((ok) => setTimeout(ok, 0));
const sends = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((c) => c.method === 'PUT' && c.path === EMOTIONS_PATH);

describe('emotion-controller', () => {
  it('AC-6: 押した時点で送り、閉じずに読み直すと付いている（例 #8）', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const saved: unknown[] = [];
    const c = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id],
      initial: [],
      onSaved: (t) => saved.push(t),
    });
    c.toggle('fear');
    expect(c.getState().selected).toEqual(['fear']);
    expect(sends(fake)).toHaveLength(1);
    await settle();
    expect(c.getState()).toMatchObject({ selected: ['fear'], saved: ['fear'], sending: false });
    expect(fake.trades.find((t) => t.id === L1.id)?.emotionTags).toEqual(['fear']);
    expect(saved).toEqual([['fear']]);
  });

  it('送る本文は集合（取引の ID と一覧の順のタグ）', async () => {
    const fake = createFakeApi({ trades: [L1, L2], instruments: [US30] });
    const c = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id, L2.id],
      initial: ['hope'],
    });
    c.toggle('fear');
    await settle();
    expect(sends(fake)[0]?.body).toEqual({ tradeIds: [L1.id, L2.id], tags: ['fear', 'hope'] });
  });

  it('送っている間に押したら、終わった後に最新の集合を 1 本だけ送る', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const c = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id],
      initial: [],
    });
    fake.hold();
    c.toggle('fear');
    c.toggle('hope');
    c.toggle('regret');
    expect(sends(fake)).toHaveLength(1);
    // 怖い（恐れ）→ 祈り・後悔 は一覧の順（後悔 → 祈り）
    expect(c.getState().selected).toEqual(['fear', 'regret', 'hope']);
    fake.release();
    await settle();
    await settle();
    expect(sends(fake).map((x) => (x.body as { tags: string[] }).tags)).toEqual([
      ['fear'],
      ['fear', 'regret', 'hope'],
    ]);
    expect(c.getState()).toMatchObject({ saved: ['fear', 'regret', 'hope'], sending: false });
    expect(fake.trades[0]?.emotionTags).toEqual(['fear', 'regret', 'hope']);
  });

  it('AC-7: 失敗したら最後に保存できた集合へ戻り、失敗の文言が出る（例 #9）', async () => {
    const fake = createFakeApi({
      trades: [L1],
      instruments: [US30],
      failOnce: { [`PUT ${EMOTIONS_PATH}`]: 'throw' },
    });
    const c = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id],
      initial: ['hope'],
    });
    c.toggle('distress');
    expect(c.getState().selected).toEqual(['distress', 'hope']);
    await settle();
    expect(c.getState()).toMatchObject({
      selected: ['hope'],
      saved: ['hope'],
      sending: false,
      error: EMOTION_SAVE_FAILED,
      errorKind: 'network',
    });
    // 取引は残り、前の集合のまま
    expect(fake.trades[0]?.id).toBe(L1.id);
    expect(fake.trades[0]?.emotionTags).toBeUndefined();
    // もう一度押すと文言は消えて送り直す
    c.toggle('distress');
    expect(c.getState().error).toBeNull();
    await settle();
    expect(c.getState().saved).toEqual(['distress', 'hope']);
  });

  it('500 は同じ失敗、404・409 は押し直しても通らない文言、ログインが切れたらログインの文言', async () => {
    for (const [status, msg] of [
      [500, EMOTION_SAVE_FAILED],
      [404, EMOTION_SAVE_GONE],
      [409, EMOTION_SAVE_GONE],
      [401, AUTH_EXPIRED],
    ] as const) {
      const fake = createFakeApi({
        trades: [L1],
        instruments: [US30],
        fail: { [`PUT ${EMOTIONS_PATH}`]: status },
      });
      const c = createEmotionController({
        request: createRequest(fake.api),
        tradeIds: [L1.id],
        initial: [],
      });
      c.toggle('fear');
      await settle();
      expect(c.getState().selected).toEqual([]);
      expect(c.getState().error).toBe(msg);
    }
  });

  it('dispose の後は知らせず、押しても送らない（送っている要求は止めない）', async () => {
    const fake = createFakeApi({ trades: [L3], instruments: [US30] });
    const c = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L3.id],
      initial: [],
    });
    const seen: unknown[] = [];
    c.subscribe((s) => seen.push(s));
    c.toggle('fear');
    c.dispose();
    const n = seen.length;
    await settle();
    expect(seen).toHaveLength(n);
    expect(fake.trades[0]?.emotionTags).toEqual(['fear']);
    c.toggle('hope');
    expect(sends(fake)).toHaveLength(1);
  });
});

describe('詳細の controller の applyEmotionTags（AC-8）', () => {
  it('読んだ取引のタグだけを差し替え、判定は変えない。空なら鍵ごと消す', async () => {
    const fake = createFakeApi({ trades: [L1], instruments: [US30] });
    const d = createTradeDetailController({
      api: fake.api,
      id: L1.id,
      preview: async () => ({ width: 1, height: 1, draw: () => {}, close: () => {} }),
    });
    await d.load();
    const before = d.getState();
    if (before.phase !== 'ready') throw new Error('読めていない');
    // シートと同じく、保存できたら詳細へ写す
    const e = createEmotionController({
      request: createRequest(fake.api),
      tradeIds: [L1.id],
      initial: [],
      onSaved: (t) => d.applyEmotionTags(t),
    });
    e.toggle('bargain');
    await settle();
    const after = d.getState();
    if (after.phase !== 'ready') throw new Error('読めていない');
    expect(after.trade.emotionTags).toEqual(['bargain']);
    expect(after.summary).toEqual(before.summary);
    expect(after.trade.record).toEqual(before.trade.record);
    // 読み直しても同じ（AC-8 の「読み直した取引」）
    await d.load();
    const again = d.getState();
    expect(again.phase === 'ready' && again.trade.emotionTags).toEqual(['bargain']);
    d.applyEmotionTags([]);
    const cleared = d.getState();
    expect(cleared.phase === 'ready' && 'emotionTags' in cleared.trade).toBe(false);
  });
});
