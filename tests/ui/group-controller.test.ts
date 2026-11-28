// 両建てのまとまりの通信と状態（#267。Issue の AC-2・AC-4・AC-6・AC-7・AC-8・AC-9）。偽の API（本物の入口と同じ検査の要点）で回す
import { describe, expect, it } from 'vitest';
import { createEditController, EDIT_SAVE_FAILED } from '../../ui/src/lib/edit-controller';
import {
  createGroupController,
  createPickerController,
  GROUP_IN_OTHER,
  loadGroupIndex,
} from '../../ui/src/lib/group-controller';
import { SIDE_LOCKED } from '../../ui/src/lib/position-group';
import { createRequest } from '../../ui/src/lib/request';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { createTradesController } from '../../ui/src/lib/trades-controller';
import { createFakeApi } from './helpers/fake-api';
import { cfd, ENTRY, future, h1, h2, INSTRUMENTS, MON } from './helpers/group-examples';

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((ok) => setTimeout(ok, 0));
};
const DAY = 86_400_000;
const noPreview = async () => {
  throw new Error('no chart');
};

describe('相手を選ぶシート（AC-2・AC-4）', () => {
  it('今の範囲の入口（エントリーの 7 日前〜決済の 7 日後）で候補を読み、選んで ［結ぶ］ と POST して ID を返す', async () => {
    const f = future('f1', { exitPrice: 38_600 });
    const c = cfd('c1', { price: 38_450, exitPrice: 38_620 });
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS] });
    const p = createPickerController({
      request: createRequest(fake.api),
      base: f,
      instruments: INSTRUMENTS,
    });
    await p.load();
    expect(fake.calls.map((x) => x.path)).toEqual([
      `/api/trades?exitFrom=${ENTRY - 7 * DAY}&exitTo=${MON + 7 * DAY + 1}`,
    ]);
    const s = p.getState();
    expect(s.phase === 'ready' && s.sections.opposite.map((t) => t.id)).toEqual(['c1']);
    p.toggle('c1');
    expect(p.members().map((m) => [m.trade.id, m.role])).toEqual([
      ['f1', 'main'],
      ['c1', 'hedge'],
    ]);
    const id = await p.link();
    expect(id).toBe(fake.groups[0]?.id);
    const post = fake.calls.find((x) => x.method === 'POST');
    expect(post).toMatchObject({
      path: '/api/position-groups',
      body: {
        members: [
          { tradeId: 'f1', role: 'main' },
          { tradeId: 'c1', role: 'hedge' },
        ],
      },
    });
    expect(fake.trades.map((t) => t.positionGroupId)).toEqual([id, id]);
  });

  it('［入れ替える］ で役割が逆になり、選び直すと既定に戻る', async () => {
    const f = future('f1', { exitPrice: 38_600 });
    const c = cfd('c1', { price: 38_450, exitPrice: 38_620 });
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS] });
    const p = createPickerController({
      request: createRequest(fake.api),
      base: c,
      instruments: INSTRUMENTS,
    });
    await p.load();
    p.toggle('f1');
    expect(p.members().map((m) => m.role)).toEqual(['hedge', 'main']);
    p.swap();
    expect(p.members().map((m) => m.role)).toEqual(['main', 'hedge']);
    p.toggle('f1');
    p.toggle('f1');
    expect(p.members().map((m) => m.role)).toEqual(['hedge', 'main']);
  });

  it('409 inOtherGroup は決まった文言で、状態は選んだまま（シートを閉じない）', async () => {
    const f = future('f1', { exitPrice: 38_600 });
    const c = cfd('c1', { price: 38_450, exitPrice: 38_620 });
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS] });
    const p = createPickerController({
      request: createRequest(fake.api),
      base: f,
      instruments: INSTRUMENTS,
    });
    await p.load();
    p.toggle('c1');
    // 開いた後に別のタブで c1 が別のまとまりに入った
    fake.trades[1] = { ...c, positionGroupId: 'gX' };
    expect(await p.link()).toBeNull();
    const s = p.getState();
    expect(s.phase === 'ready' && [s.error, s.selected, s.saving]).toEqual([
      GROUP_IN_OTHER,
      ['c1'],
      false,
    ]);
  });
});

describe('まとまりの画面（AC-5・AC-6・AC-7）', () => {
  it('まとまりの一覧とメンバーの取引を読み、判定を出す。上書きを PUT し、空で上書きを消す', async () => {
    const { f, c, g } = h1();
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS], groups: [g] });
    const ctl = createGroupController({ api: fake.api, id: g.id });
    await ctl.load();
    const s = ctl.getState();
    expect(s.phase === 'ready' && s.state.kind).toBe('ok');
    expect(await ctl.saveExit({ price: 38_440 })).toBe(true);
    const put = fake.calls.find((x) => x.method === 'PUT');
    expect(put).toMatchObject({
      path: `/api/position-groups/${g.id}`,
      body: {
        members: [
          { tradeId: 'f1', role: 'main' },
          { tradeId: 'c1', role: 'hedge' },
        ],
        exit: { price: 38_440 },
      },
    });
    const after = ctl.getState();
    expect(
      after.phase === 'ready' && after.state.kind === 'ok' && after.state.ev.ok && after.state.ev.r,
    ).toBeCloseTo(440 / 300, 9);
    expect(await ctl.saveExit(undefined)).toBe(true);
    expect(fake.calls.filter((x) => x.method === 'PUT').at(-1)?.body).toEqual({
      members: [
        { tradeId: 'f1', role: 'main' },
        { tradeId: 'c1', role: 'hedge' },
      ],
    });
    expect(fake.groups[0]?.exit).toBeUndefined();
  });

  it('解くと DELETE を送り、メンバーの逆参照が外れる（記録・心理のタグは残る）', async () => {
    const { f, c, g } = h1();
    const tagged = { ...f, emotionTags: ['fear' as const] };
    const fake = createFakeApi({ trades: [tagged, c], instruments: [...INSTRUMENTS], groups: [g] });
    const ctl = createGroupController({ api: fake.api, id: g.id });
    await ctl.load();
    expect(await ctl.unlink()).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/api/position-groups/${g.id}`,
    });
    expect(fake.groups).toEqual([]);
    expect(fake.trades.map((t) => t.positionGroupId)).toEqual([undefined, undefined]);
    expect(fake.trades[0]?.emotionTags).toEqual(['fear']);
  });

  it('無いまとまりは notFound、メンバーが消えたまとまりは broken', async () => {
    const { f, g } = h1();
    const fake = createFakeApi({ trades: [f], instruments: [...INSTRUMENTS], groups: [g] });
    const none = createGroupController({ api: fake.api, id: 'nope' });
    await none.load();
    expect(none.getState().phase).toBe('notFound');
    const ctl = createGroupController({ api: fake.api, id: g.id });
    await ctl.load();
    const s = ctl.getState();
    expect(s.phase === 'ready' && s.state.kind).toBe('broken');
  });

  it('心理のタグを保存できたら、すべてのメンバーに同じ集合を写す（6.5）', async () => {
    const { f, c, g } = h1();
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS], groups: [g] });
    const ctl = createGroupController({ api: fake.api, id: g.id });
    await ctl.load();
    ctl.applyEmotionTags(['fear']);
    const s = ctl.getState();
    if (s.phase !== 'ready') throw new Error('not ready');
    expect([...s.byId.values()].map((t) => t.emotionTags)).toEqual([['fear'], ['fear']]);
  });
});

describe('取引の詳細のまとまり（AC-8）', () => {
  it('メンバーの取引はまとまりを読み、崩れたまとまりは ［解く］ で DELETE して読み直す', async () => {
    const { f, g } = h1();
    const fake = createFakeApi({ trades: [f], instruments: [...INSTRUMENTS], groups: [g] });
    const ctl = createTradeDetailController({ api: fake.api, id: f.id, preview: noPreview });
    await ctl.load();
    const s = ctl.getState();
    expect(s.phase === 'ready' && s.group?.phase === 'ready' && s.group.state.kind).toBe('broken');
    expect(await ctl.unlinkGroup()).toBe(true);
    const after = ctl.getState();
    expect(after.phase === 'ready' && after.trade.positionGroupId).toBeUndefined();
    expect(after.phase === 'ready' && after.group?.phase).toBe('none');
  });

  it('まとまりにいない取引はまとまりを読まない（要求を送らない）', async () => {
    const f = future('f1', { exitPrice: 38_600 });
    const fake = createFakeApi({ trades: [f], instruments: [...INSTRUMENTS] });
    const ctl = createTradeDetailController({ api: fake.api, id: f.id, preview: noPreview });
    await ctl.load();
    expect(fake.calls.some((x) => x.path.startsWith('/api/position-groups'))).toBe(false);
  });

  it('編集でメンバーの向きを変えた保存の 409 は「両建てを解いてから向きを変えてください」で、編集に戻る', async () => {
    const { f, c, g } = h1();
    const fake = createFakeApi({ trades: [f, c], instruments: [...INSTRUMENTS], groups: [g] });
    const ec = createEditController({ api: fake.api, id: c.id });
    await ec.load();
    ec.update({ type: 'set', field: 'side', value: 'L' });
    await ec.save();
    expect(ec.getState()).toMatchObject({ phase: 'editing', error: SIDE_LOCKED });
    expect(SIDE_LOCKED).toBe('両建てを解いてから向きを変えてください');
    expect(SIDE_LOCKED).not.toBe(EDIT_SAVE_FAILED);
    expect(fake.trades[1]?.record.side).toBe('S');
  });
});

describe('一覧のまとまりの索引（AC-9）', () => {
  it('逆参照を持つ行があるときだけ読み、範囲の外のメンバーも読む', async () => {
    const a = h1();
    const b = h2();
    const fake = createFakeApi({
      trades: [a.f, a.c, b.f, b.c],
      instruments: [...INSTRUMENTS],
      groups: [a.g, b.g],
    });
    const index = await loadGroupIndex(createRequest(fake.api), [a.f, b.f, b.c]);
    expect(index?.groups.get(a.g.id)?.kind).toBe('ok');
    expect(fake.calls.map((x) => x.path)).toEqual(['/api/position-groups', '/api/trades/c1']);
    expect(
      await loadGroupIndex(createRequest(fake.api), [future('p', { exitPrice: 1 })]),
    ).toBeNull();
  });

  it('取引の一覧の状態にまとまりの索引を足す', async () => {
    const a = h1();
    const fake = createFakeApi({
      trades: [a.f, a.c],
      instruments: [...INSTRUMENTS],
      groups: [a.g],
    });
    const ctl = createTradesController({ api: fake.api, pageSize: 10 });
    await ctl.load();
    await settle();
    const s = ctl.getState();
    expect(s.phase === 'ready' && s.groups?.groups.get(a.g.id)?.kind).toBe('ok');
  });
});
