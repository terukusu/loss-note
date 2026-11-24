// 心理のタグの選択肢の設定の通信と状態（Issue #163 の AC-7・R6）。偽の API（本物と同じ検査の要点）で回す。値は架空
import { describe, expect, it } from 'vitest';
import {
  createEmotionChoicesController,
  EMOTION_CHOICES_PATH,
  hiddenOf,
} from '../../ui/src/lib/emotion-choices-controller';
import {
  EMOTION_CHOICES_LOAD_FAILED,
  EMOTION_CHOICES_SAVE_FAILED,
  emotionChoicesCount,
  emotionChoicesMeta,
} from '../../ui/src/lib/emotion-tags';
import { AUTH_EXPIRED, createRequest } from '../../ui/src/lib/request';
import { createFakeApi } from './helpers/fake-api';

const settle = () => new Promise((ok) => setTimeout(ok, 0));
const sends = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((c) => c.method === 'PUT' && c.path === EMOTION_CHOICES_PATH);

const make = (fake: ReturnType<typeof createFakeApi>) =>
  createEmotionChoicesController({ request: createRequest(fake.api) });

describe('emotion-choices-controller', () => {
  it('読むと保存した「出さない」集合（例 #2）', async () => {
    const fake = createFakeApi({ emotionHidden: ['bargain', 'fomo'] });
    const c = make(fake);
    expect(hiddenOf(c.getState())).toEqual([]);
    await c.load();
    expect(c.getState()).toMatchObject({ phase: 'ready', hidden: ['fomo', 'bargain'] });
    expect(hiddenOf(c.getState())).toEqual(['fomo', 'bargain']);
  });

  it('AC-7: 押すと押した後の集合を送り、保存できた値になる', async () => {
    const fake = createFakeApi({ emotionHidden: ['fomo'] });
    const c = make(fake);
    await c.load();
    c.toggle('bargain');
    expect(c.getState()).toMatchObject({ hidden: ['fomo', 'bargain'], sending: true });
    await settle();
    expect(sends(fake).map((x) => x.body)).toEqual([{ hidden: ['fomo', 'bargain'] }]);
    expect(c.getState()).toMatchObject({ saved: ['fomo', 'bargain'], sending: false });
    expect(fake.emotionHidden()).toEqual(['fomo', 'bargain']);
    // 押し直すと出す（集合から外す）
    c.toggle('fomo');
    await settle();
    expect(fake.emotionHidden()).toEqual(['bargain']);
  });

  it('平常心は押しても送らない（R2）', async () => {
    const fake = createFakeApi();
    const c = make(fake);
    await c.load();
    c.toggle('calm');
    await settle();
    expect(sends(fake)).toEqual([]);
  });

  it('送っている間に押したら、終わった後に最新の集合を 1 本だけ送る', async () => {
    const fake = createFakeApi();
    const c = make(fake);
    await c.load();
    fake.hold();
    c.toggle('fomo');
    c.toggle('hope');
    c.toggle('anger');
    expect(sends(fake)).toHaveLength(1);
    fake.release();
    await settle();
    await settle();
    expect(sends(fake).map((x) => (x.body as { hidden: string[] }).hidden)).toEqual([
      ['fomo'],
      ['fomo', 'anger', 'hope'],
    ]);
    expect(fake.emotionHidden()).toEqual(['fomo', 'anger', 'hope']);
  });

  it('AC-7: 失敗したら最後に保存できた集合へ戻り、失敗の文言が出る', async () => {
    const fake = createFakeApi({
      emotionHidden: ['hope'],
      failOnce: { [`PUT ${EMOTION_CHOICES_PATH}`]: 'throw' },
    });
    const c = make(fake);
    await c.load();
    c.toggle('fomo');
    expect(c.getState()).toMatchObject({ hidden: ['fomo', 'hope'] });
    await settle();
    expect(c.getState()).toMatchObject({
      phase: 'ready',
      hidden: ['hope'],
      saved: ['hope'],
      sending: false,
      error: EMOTION_CHOICES_SAVE_FAILED,
      errorKind: 'network',
    });
    // 次に押すと文言は消える
    c.toggle('anger');
    expect(c.getState()).toMatchObject({ error: null });
  });

  it('500 の保存も同じ文言・401 はログインが切れた', async () => {
    const fake = createFakeApi({ failOnce: { [`PUT ${EMOTION_CHOICES_PATH}`]: 500 } });
    const c = make(fake);
    await c.load();
    c.toggle('fomo');
    await settle();
    expect(c.getState()).toMatchObject({ hidden: [], error: EMOTION_CHOICES_SAVE_FAILED });
    const fake2 = createFakeApi({ failOnce: { [`PUT ${EMOTION_CHOICES_PATH}`]: 401 } });
    const c2 = make(fake2);
    await c2.load();
    c2.toggle('fomo');
    await settle();
    expect(c2.getState()).toMatchObject({ error: AUTH_EXPIRED, errorKind: 'auth' });
  });

  it('R6・例 #7: 読めなければ失敗の文言で、シートに渡す集合は空（すべて出す）', async () => {
    const fake = createFakeApi({ failOnce: { [`GET ${EMOTION_CHOICES_PATH}`]: 503 } });
    const c = make(fake);
    await c.load();
    expect(c.getState()).toMatchObject({ phase: 'failed', error: EMOTION_CHOICES_LOAD_FAILED });
    expect(hiddenOf(c.getState())).toEqual([]);
    // 読めない間は押しても送らない
    c.toggle('fomo');
    expect(sends(fake)).toEqual([]);
    // 読み直せる
    await c.load();
    expect(c.getState().phase).toBe('ready');
  });

  it('応答の形が違えば読めない扱い（知らない ID・平常心は落とす）', async () => {
    const bad = createFakeApi();
    const api: typeof bad.api = async (path, init) =>
      path === EMOTION_CHOICES_PATH
        ? new Response(JSON.stringify({ hidden: 'fomo' }), { status: 200 })
        : bad.api(path, init);
    const c = createEmotionChoicesController({ request: createRequest(api) });
    await c.load();
    expect(c.getState().phase).toBe('failed');
    const odd: typeof bad.api = async () =>
      new Response(JSON.stringify({ hidden: ['calm', 'zzz', 'fomo'] }), { status: 200 });
    const c2 = createEmotionChoicesController({ request: createRequest(odd) });
    await c2.load();
    expect(hiddenOf(c2.getState())).toEqual(['fomo']);
  });

  it('dispose の後は知らせない', async () => {
    const fake = createFakeApi();
    const c = make(fake);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.phase));
    c.dispose();
    await c.load();
    expect(seen).toEqual(['loading']);
  });
});

describe('文字（AC-4 の根の添え）', () => {
  it('出している数 / 21 個。読めていなければ null', () => {
    expect(emotionChoicesMeta([])).toBe('21 / 21 個');
    expect(emotionChoicesMeta(['fomo', 'bargain'])).toBe('19 / 21 個');
    expect(emotionChoicesMeta(null)).toBeNull();
    expect(emotionChoicesCount(['fomo'])).toBe('21 個のうち 20 個を選択肢に出しています');
  });
});
