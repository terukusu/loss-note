// ホームの振り返りの通信と状態（Issue #88 契約 U-1・KEEP-4）。偽の記録の API に合成の取引（架空の値）
import { describe, expect, it } from 'vitest';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import {
  createReviewController,
  type ExitRange,
  REVIEW_LOAD_FAILED,
  rangePath,
} from '../../ui/src/lib/review-controller';
import { createFakeApi, RANGE_MAX } from './helpers/fake-api';
import { exitAt, S1 } from './helpers/review-examples';
import { L1, stored, US30 } from './helpers/trade-examples';

const R1: ExitRange = { from: exitAt(0), to: exitAt(3) };
const R2: ExitRange = { from: exitAt(3), to: exitAt(7) };

const gets = (calls: readonly { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'GET' && c.path.startsWith('/api/trades')).map((c) => c.path);

describe('createReviewController', () => {
  it('範囲の中の取引を一覧と同じ並び（決済の新しい順）で読む。同じ範囲は読み直さない', async () => {
    const fake = createFakeApi({ trades: S1, instruments: [US30] });
    const c = createReviewController({ api: fake.api });
    await c.load(R1);
    const s = c.getState();
    expect(s.phase).toBe('ready');
    if (s.phase !== 'ready') return;
    expect(s.trades.map((t) => t.id)).toEqual(['s1-3', 's1-2', 's1-1']);
    expect(s.range).toEqual(R1);
    await c.load({ ...R1 });
    expect(gets(fake.calls)).toEqual([rangePath(R1)]);
    expect(rangePath(R1)).toBe(`/api/trades?exitFrom=${R1.from}&exitTo=${R1.to}`);
  });

  it('件数の上限を超えた応答は truncated（先頭の上限の件数だけ。C44）', async () => {
    const many = Array.from({ length: RANGE_MAX + 3 }, (_, i) =>
      stored(`m${i}`, { exit: { ...L1.record.exit, time: exitAt(0) + i } }, { createdAt: i }),
    );
    const fake = createFakeApi({ trades: many });
    const c = createReviewController({ api: fake.api });
    await c.load(R1);
    const s = c.getState();
    expect(s.phase === 'ready' && [s.trades.length, s.truncated]).toEqual([RANGE_MAX, true]);
    const few = createFakeApi({ trades: S1 });
    const d = createReviewController({ api: few.api });
    await d.load(R1);
    expect(d.getState()).toMatchObject({ phase: 'ready', truncated: false });
  });

  it('範囲を替えたら前の応答を捨てる（後から届いても描かない）', async () => {
    const fake = createFakeApi({ trades: S1, instruments: [US30] });
    const c = createReviewController({ api: fake.api });
    fake.hold();
    const first = c.load(R1);
    const second = c.load(R2);
    fake.release();
    await Promise.all([first, second]);
    const s = c.getState();
    expect(s.phase === 'ready' && s.range).toEqual(R2);
    expect(s.phase === 'ready' && s.trades.map((t) => t.id)).toEqual([
      's1-7',
      's1-6',
      's1-5',
      's1-4',
    ]);
  });

  it('失敗は決まった文言（本文を持たない）・[再読み込み] で同じ範囲を読み直す', async () => {
    const fake = createFakeApi({
      trades: S1,
      instruments: [US30],
      failOnce: { 'GET /api/trades?range': 503 },
    });
    const c = createReviewController({ api: fake.api });
    await c.load(R1);
    const s = c.getState();
    expect(s).toEqual({
      phase: 'failed',
      range: R1,
      error: REVIEW_LOAD_FAILED,
      errorKind: 'other',
    });
    await c.reload();
    expect(c.getState().phase).toBe('ready');
  });

  it('通信の失敗は network、401 はログインが切れた文言', async () => {
    const net = createFakeApi({ trades: S1, fail: { 'GET /api/trades?range': 'throw' } });
    const a = createReviewController({ api: net.api });
    await a.load(R1);
    expect(a.getState()).toMatchObject({ phase: 'failed', errorKind: 'network' });
    const auth = createFakeApi({ trades: S1, fail: { 'GET /api/trades?range': 401 } });
    const b = createReviewController({ api: auth.api });
    await b.load(R1);
    expect(b.getState()).toMatchObject({ phase: 'failed', error: AUTH_EXPIRED, errorKind: 'auth' });
  });

  it('応答の形が違えば失敗。null（期間の誤り）は読まずに idle', async () => {
    const api = async () =>
      new Response(JSON.stringify({ nope: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const c = createReviewController({ api });
    await c.load(R1);
    expect(c.getState().phase).toBe('failed');
    await c.load(null);
    expect(c.getState()).toEqual({ phase: 'idle' });
    await c.reload();
    expect(c.getState()).toEqual({ phase: 'idle' });
  });

  it('離れたら後で届いた応答を捨てる', async () => {
    const fake = createFakeApi({ trades: S1 });
    const c = createReviewController({ api: fake.api });
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.phase));
    fake.hold();
    const p = c.load(R1);
    c.dispose();
    fake.release();
    await p;
    expect(seen).toEqual(['idle', 'loading']);
  });
});
