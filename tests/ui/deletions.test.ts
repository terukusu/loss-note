// 消す + [元に戻す]（Issue #9 契約 U-4・AC-5・AC-6・ADR-0007）。偽の時計・偽の API。値はすべて架空
import { describe, expect, it } from 'vitest';
import { createDeletions, TOAST_TEXT, UNDO_MS } from '../../ui/src/lib/deletions';
import { visibleTrades } from '../../ui/src/lib/trade-view';
import { createFakeApi, type FakeCall } from './helpers/fake-api';
import { D1, L1, L2 } from './helpers/trade-examples';

/** 偽の時計（進めると期限の来たタイマーを呼ぶ） */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get count() {
      return timers.size;
    },
  };
}

const flushMicro = () => new Promise((ok) => setTimeout(ok, 0));
const deletes = (calls: readonly FakeCall[]) => calls.filter((c) => c.method === 'DELETE');

function setup(opts: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi({ trades: [D1, L1, L2], ...opts });
  const timers = fakeTimers();
  const del = createDeletions({
    api: fake.api,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { fake, timers, del };
}

describe('AC-5: 確認を挟まずに消え、取り消しの時間の後に DELETE を 1 回', () => {
  it('remove の直後は隠すだけで要求を送らない。トーストにどの取引を消したか', () => {
    const { fake, del } = setup();
    del.remove('d1', 'US30 L 11/10');
    const s = del.getState();
    expect(s.hidden.has('d1')).toBe(true);
    expect(s.toast).toEqual({ id: 'd1', label: 'US30 L 11/10' });
    expect(s.failed).toBe(false);
    expect(TOAST_TEXT.deleted('US30 L 11/10')).toBe('US30 L 11/10 を削除しました');
    expect(TOAST_TEXT.deleted('')).toBe('取引を削除しました');
    expect(deletes(fake.calls)).toHaveLength(0);
    // 一覧の件数は N → N − 1
    expect(visibleTrades(fake.trades, s.hidden)).toHaveLength(2);
  });

  it('取り消しの時間（8 秒）が過ぎたら DELETE を 1 回（keepalive）。消えたまま・トーストは閉じる', async () => {
    const { fake, timers, del } = setup();
    expect(UNDO_MS).toBe(8000);
    del.remove('d1');
    timers.advance(UNDO_MS - 1);
    expect(deletes(fake.calls)).toHaveLength(0);
    timers.advance(1);
    await flushMicro();
    expect(deletes(fake.calls)).toEqual([{ method: 'DELETE', path: '/api/trades/d1' }]);
    expect(fake.trades.map((t) => t.id)).toEqual(['l1', 'l2']);
    expect(del.getState().hidden.has('d1')).toBe(true);
    expect(del.getState().toast).toBeNull();
    // 2 回目は送らない
    await del.flush();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('keepalive を付けて送る', async () => {
    const seen: RequestInit[] = [];
    const fake = createFakeApi({ trades: [D1] });
    const timers = fakeTimers();
    const del = createDeletions({
      api: (p, init) => {
        seen.push(init ?? {});
        return fake.api(p, init);
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    del.remove('d1');
    await del.flush();
    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.keepalive).toBe(true);
  });

  it('404（ほかの端末で消えていた）も消えたまま', async () => {
    const { fake, del } = setup({ fail: { 'DELETE /api/trades/d1': 404 } });
    del.remove('d1');
    await del.flush();
    expect(del.getState().hidden.has('d1')).toBe(true);
    expect(del.getState().toast).toBeNull();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('失敗（503・通信の誤り）は印を外して戻し、失敗の決まった文言（応答の本文を持たない）', async () => {
    for (const f of [503, 'throw'] as const) {
      const { del } = setup({ fail: { 'DELETE /api/trades/d1': f } });
      del.remove('d1');
      await del.flush();
      const s = del.getState();
      expect(s.hidden.has('d1')).toBe(false);
      expect(s.toast).toBeNull();
      expect(s.failed).toBe(true);
      expect(JSON.stringify(s)).not.toContain('偽物');
    }
    expect(TOAST_TEXT.failed).toBe('削除できませんでした。もう一度 [削除] を押してください。');
  });
});

describe('AC-6: [元に戻す]', () => {
  it('DELETE を送らず、同じ ID が一覧に戻る', async () => {
    const { fake, timers, del } = setup();
    del.remove('d1');
    del.undo();
    timers.advance(UNDO_MS * 2);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    expect(del.getState().hidden.size).toBe(0);
    expect(del.getState().toast).toBeNull();
    expect(visibleTrades(fake.trades, del.getState().hidden).map((t) => t.id)).toContain('d1');
    expect(fake.trades.find((t) => t.id === 'd1')).toBe(D1);
    expect(timers.count).toBe(0);
  });

  it('取り消しの時間が過ぎた後の undo は何もしない', async () => {
    const { timers, del } = setup();
    del.remove('d1');
    timers.advance(UNDO_MS);
    await flushMicro();
    del.undo();
    expect(del.getState().hidden.has('d1')).toBe(true);
  });
});

describe('時間の止め方と、すぐ送る場面', () => {
  it('hold の間は送らず、resume で 8 秒を置き直す（WCAG 2.2.1）', async () => {
    const { fake, timers, del } = setup();
    del.remove('d1');
    timers.advance(7000);
    del.hold();
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    del.resume();
    timers.advance(7999);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    timers.advance(1);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('#129 AC-4: シートを開いている間（hold("sheet")）は送らず、閉じたら 8 秒を置き直す。トーストの hold と別に数える', async () => {
    const { fake, timers, del } = setup();
    del.remove('d1');
    timers.advance(5000);
    del.hold('sheet');
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    // シートの間にトーストへポインタが入って出ても、シートが閉じるまでは動かない
    del.hold();
    del.resume();
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    del.resume('sheet');
    timers.advance(UNDO_MS - 1);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    timers.advance(1);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('#129 AC-4: シートを開いている間に出たトーストも止まり、閉じてから 8 秒。閉じていない resume("sheet") は何もしない', async () => {
    const { fake, timers, del } = setup();
    del.resume('sheet');
    del.hold('sheet');
    del.remove('d1');
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    // [元に戻す] で消えた後も、シートの止めは残る（次の [消す] も止まる）
    del.undo();
    del.remove('l1');
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    del.resume('sheet');
    timers.advance(UNDO_MS);
    await flushMicro();
    expect(deletes(fake.calls).map((c) => c.path)).toEqual(['/api/trades/l1']);
  });

  it('次の [消す] で前の削除はすぐ送り、新しいトーストに替わる（同時に待つのは 1 件）', async () => {
    const { fake, del } = setup();
    del.remove('d1');
    del.remove('l1');
    await flushMicro();
    expect(deletes(fake.calls).map((c) => c.path)).toEqual(['/api/trades/d1']);
    expect(del.getState().toast).toEqual({ id: 'l1', label: '' });
    expect([...del.getState().hidden].sort()).toEqual(['d1', 'l1']);
    // undo は今のトーストの取引だけを戻す
    del.undo();
    expect([...del.getState().hidden]).toEqual(['d1']);
  });

  it('flush（タブが隠れた・ログアウト）はすぐ送る', async () => {
    const { fake, del } = setup();
    del.remove('d1');
    await del.flush();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('dismiss（トーストを閉じる）はすぐ送ってトーストを消す。失敗のトーストは閉じるだけ', async () => {
    const { fake, del } = setup();
    del.remove('d1');
    del.dismiss();
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
    expect(del.getState().toast).toBeNull();

    const f = setup({ fail: { 'DELETE /api/trades/d1': 500 } });
    f.del.remove('d1');
    await f.del.flush();
    expect(f.del.getState().failed).toBe(true);
    f.del.dismissFailed();
    expect(f.del.getState().failed).toBe(false);
    expect(deletes(f.fake.calls)).toHaveLength(1);
  });

  it('レビュー指摘 1: 前の削除が失敗しても、次に消した取引の [元に戻す] は残り、失敗を閉じても次は送らない', async () => {
    const { fake, del } = setup({ fail: { 'DELETE /api/trades/d1': 503 } });
    del.remove('d1', 'A');
    del.remove('l1', 'B');
    await flushMicro();
    await flushMicro();
    const s = del.getState();
    expect(s.failed).toBe(true);
    expect(s.hidden.has('d1')).toBe(false);
    expect(s.toast).toEqual({ id: 'l1', label: 'B' });
    del.dismissFailed();
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
    del.undo();
    expect(del.getState().hidden.has('l1')).toBe(false);
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('レビュー指摘 2: 送り始めたら [元に戻す] のトーストを閉じる（応答を待つ間に戻せるように見せない）', async () => {
    const { fake, del } = setup();
    fake.hold();
    del.remove('d1', 'A');
    const p = del.flush();
    expect(del.getState().toast).toBeNull();
    fake.release();
    await p;
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('レビュー指摘 8: reset で印・知らせを空にし、待っている削除はやめる', async () => {
    const { fake, timers, del } = setup({ fail: { 'DELETE /api/trades/l1': 503 } });
    del.remove('l1');
    await del.flush();
    del.remove('d1');
    del.reset();
    expect(del.getState()).toEqual({ hidden: new Set(), toast: null, failed: false });
    timers.advance(UNDO_MS);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('同じ ID を 2 回消しても 1 件', async () => {
    const { fake, del } = setup();
    del.remove('d1');
    del.remove('d1');
    await del.flush();
    expect(deletes(fake.calls)).toHaveLength(1);
  });

  it('ID は encodeURIComponent して送る', async () => {
    const { fake, del } = setup();
    del.remove('a-b_c');
    await del.flush();
    expect(deletes(fake.calls)[0]?.path).toBe('/api/trades/a-b_c');
  });

  it('購読はすぐ今の状態を 1 回知らせ、やめた後は知らせない', () => {
    const { del } = setup();
    const seen: unknown[] = [];
    const off = del.subscribe((s) => seen.push(s.toast));
    expect(seen).toEqual([null]);
    del.remove('d1');
    off();
    del.undo();
    expect(seen).toHaveLength(2);
  });
});

describe('#129: 出来事の手から呼ばれた hold / resume', () => {
  it('onFocusIn / onFocusOut に渡して出来事を引数に呼ばれても、トーストの止めとして数えて時間を置き直す', async () => {
    const { fake, timers, del } = setup();
    del.remove('d1');
    const ev = { type: 'focusin' } as unknown as Parameters<typeof del.hold>[0];
    del.hold(ev);
    timers.advance(60_000);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(0);
    del.resume(ev);
    timers.advance(UNDO_MS);
    await flushMicro();
    expect(deletes(fake.calls)).toHaveLength(1);
  });
});
