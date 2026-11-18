// 取引の一覧のページ分けの通信と状態（Issue #87 AC-8〜AC-11・例 #8〜#10）。偽の記録の API に合成の取引（架空の値）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import { createTradesCache } from '../../ui/src/lib/trades-cache';
import {
  createTradesController,
  TRADES_MORE_FAILED,
  type TradesController,
} from '../../ui/src/lib/trades-controller';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import { L1, stored, T_1110, US30 } from './helpers/trade-examples';

/** 合成の取引 n 件（決済の時刻は 1 分ずつ古く。ID は並びと同じ順の番号） */
function synthetic(n: number): StoredTrade[] {
  return Array.from({ length: n }, (_, i) =>
    stored(
      `p${String(i).padStart(3, '0')}`,
      { exit: { ...L1.record.exit, time: T_1110 - i * 60_000 } },
      { createdAt: 1_700_000_000_000 + i },
    ),
  );
}

const tradeGets = (fake: FakeApi) =>
  fake.calls
    .filter((c) => c.method === 'GET' && c.path.startsWith('/api/trades'))
    .map((c) => c.path);

function ids(c: TradesController): string[] {
  const s = c.getState();
  return s.phase === 'ready' ? s.trades.map((t) => t.id) : [];
}

function more(c: TradesController): string {
  const s = c.getState();
  return s.phase === 'ready' ? s.more : s.phase;
}

describe('AC-8: 一覧は 50 件ずつ読む（例 #8）', () => {
  it('最初は 50 件の 1 回 → 続きで 100 → 120 で最後まで。最後の後は要求が増えない', async () => {
    const all = synthetic(120);
    const fake = createFakeApi({ trades: all, instruments: [US30] });
    const c = createTradesController({ api: fake.api, pageSize: 50 });
    await c.load();
    expect(ids(c)).toEqual(all.slice(0, 50).map((t) => t.id));
    expect(more(c)).toBe('idle');
    expect(tradeGets(fake)).toEqual(['/api/trades?limit=50']);

    await c.loadMore();
    expect(ids(c)).toHaveLength(100);
    expect(more(c)).toBe('idle');
    await c.loadMore();
    expect(ids(c)).toEqual(all.map((t) => t.id));
    expect(more(c)).toBe('done');
    const gets = tradeGets(fake);
    expect(gets).toHaveLength(3);
    expect(gets[1]).toMatch(/^\/api\/trades\?limit=50&cursor=/);

    await c.loadMore();
    expect(tradeGets(fake)).toHaveLength(3);
  });

  it('ちょうど 50 件なら 1 回で最後まで', async () => {
    const fake = createFakeApi({ trades: synthetic(50) });
    const c = createTradesController({ api: fake.api, pageSize: 50 });
    await c.load();
    expect(more(c)).toBe('done');
  });

  it('読んでいる間の 2 度目の loadMore は送らない', async () => {
    const fake = createFakeApi({ trades: synthetic(120) });
    const c = createTradesController({ api: fake.api, pageSize: 50 });
    await c.load();
    fake.hold();
    const a = c.loadMore();
    const b = c.loadMore();
    expect(more(c)).toBe('loading');
    fake.release();
    await Promise.all([a, b]);
    expect(tradeGets(fake)).toHaveLength(2);
    expect(ids(c)).toHaveLength(100);
  });
});

describe('AC-9: 続きの読みの失敗（例 #9）', () => {
  it('50 行は残り、決まった文言。もう一度で 100 行', async () => {
    const fake = createFakeApi({ trades: synthetic(120) });
    const c = createTradesController({ api: fake.api, pageSize: 50 });
    await c.load();
    const failing = createFakeApi({ trades: synthetic(120), fail: { 'GET /api/trades': 503 } });
    // 2 ページ目だけを失敗させる: 1 ページ目は fake、2 ページ目の要求は failing に送る
    let n = 0;
    const c2 = createTradesController({
      api: (path, init) => (n++ < 3 ? fake.api(path, init) : failing.api(path, init)),
      pageSize: 50,
    });
    await c2.load();
    await c2.loadMore();
    const s = c2.getState();
    expect(s.phase).toBe('ready');
    if (s.phase !== 'ready') return;
    expect(s.trades).toHaveLength(50);
    expect(s.more).toBe('failed');
    expect(s.moreError).toBe(TRADES_MORE_FAILED);
    expect(JSON.stringify(s)).not.toContain('偽物');
    // もう一度（今度は通る）
    n = 0;
    await c2.loadMore();
    expect(ids(c2)).toHaveLength(100);
    expect(more(c2)).toBe('idle');
    expect(c.getState().phase).toBe('ready');
  });

  it('ログインが切れた（401）は AUTH_EXPIRED', async () => {
    let n = 0;
    const ok = createFakeApi({ trades: synthetic(60) });
    const ng = createFakeApi({ trades: synthetic(60), fail: { 'GET /api/trades': 401 } });
    const c = createTradesController({
      api: (p, i) => (n++ < 3 ? ok.api(p, i) : ng.api(p, i)),
      pageSize: 50,
    });
    await c.load();
    await c.loadMore();
    const s = c.getState();
    expect(s.phase === 'ready' && s.more === 'failed' && s.moreError === AUTH_EXPIRED).toBe(true);
  });

  it('形の違う応答（next が無い）は失敗', async () => {
    const c = createTradesController({
      api: async (path) =>
        path.startsWith('/api/trades')
          ? new Response(JSON.stringify({ items: [] }), { status: 200 })
          : new Response(JSON.stringify({ items: [] }), { status: 200 }),
    });
    await c.load();
    expect(c.getState().phase).toBe('loadFailed');
  });
});

describe('AC-10: 戻るで一覧に戻る（例 #10）', () => {
  it('読み込み済みの 100 件が最初の状態から出て、裏の読み直しの後に差し替わる', async () => {
    const all = synthetic(120);
    const fake = createFakeApi({ trades: all });
    const cache = createTradesCache();
    const first = createTradesController({ api: fake.api, pageSize: 50, cache });
    await first.load();
    await first.loadMore();
    expect(ids(first)).toHaveLength(100);
    first.dispose();

    // 離れている間に 1 件直した（決済の時刻はそのまま、updatedAt だけ進む）
    const edited = { ...(fake.trades[10] as StoredTrade), updatedAt: 1_800_000_000_000 };
    fake.trades[10] = edited;
    const before = fake.calls.length;
    const back = createTradesController({ api: fake.api, pageSize: 50, cache, restore: true });
    // 最初の状態（load の前・要求の前）で 100 件
    expect(ids(back)).toHaveLength(100);
    expect(fake.calls.length).toBe(before);
    await back.load();
    const s = back.getState();
    expect(s.phase === 'ready' && s.trades).toBeTruthy();
    if (s.phase !== 'ready') return;
    expect(s.trades).toHaveLength(100);
    expect(s.trades.find((t) => t.id === edited.id)?.updatedAt).toBe(1_800_000_000_000);
    expect(tradeGets(fake).slice(-1)[0]).toBe('/api/trades?limit=100');
    // 続きは読み直したカーソルから
    await back.loadMore();
    expect(ids(back)).toEqual(all.map((t) => t.id));
    expect(more(back)).toBe('done');
  });

  it('戻るでなければ（restore なし）最初の 1 ページから読む', async () => {
    const fake = createFakeApi({ trades: synthetic(120) });
    const cache = createTradesCache();
    const first = createTradesController({ api: fake.api, pageSize: 50, cache });
    await first.load();
    await first.loadMore();
    const again = createTradesController({ api: fake.api, pageSize: 50, cache });
    expect(again.getState().phase).toBe('loading');
    await again.load();
    expect(ids(again)).toHaveLength(50);
  });

  it('読み直しが失敗しても、出している分と続きが残る', async () => {
    const fake = createFakeApi({ trades: synthetic(120) });
    const cache = createTradesCache();
    const first = createTradesController({ api: fake.api, pageSize: 50, cache });
    await first.load();
    const ng = createFakeApi({ fail: { 'GET /api/trades': 503 } });
    let fail = true;
    const back = createTradesController({
      api: (p, i) => (fail ? ng.api(p, i) : fake.api(p, i)),
      pageSize: 50,
      cache,
      restore: true,
    });
    await back.load();
    expect(ids(back)).toHaveLength(50);
    expect(more(back)).toBe('idle');
    fail = false;
    await back.loadMore();
    expect(ids(back)).toHaveLength(100);
  });

  it('戻った直後、読み直しの前・間の loadMore は送らない（末尾の検知が先に来ても、むだな要求を出さない）', async () => {
    const fake = createFakeApi({ trades: synthetic(120) });
    const cache = createTradesCache();
    const first = createTradesController({ api: fake.api, pageSize: 50, cache });
    await first.load();
    const back = createTradesController({ api: fake.api, pageSize: 50, cache, restore: true });
    const before = tradeGets(fake).length;
    await back.loadMore();
    expect(tradeGets(fake).length).toBe(before);
    fake.hold();
    const loading = back.load();
    await back.loadMore();
    fake.release();
    await loading;
    expect(tradeGets(fake).slice(before)).toEqual(['/api/trades?limit=100']);
    // 読み直し（100 件）の後の続きで最後まで
    await back.loadMore();
    expect(ids(back)).toHaveLength(120);
  });

  it('入れ物を空にした（ログアウト）後は戻しても最初から読む', async () => {
    const fake = createFakeApi({ trades: synthetic(60) });
    const cache = createTradesCache();
    const first = createTradesController({ api: fake.api, pageSize: 50, cache });
    await first.load();
    cache.setScrollY(1200);
    cache.clear();
    expect(cache.scrollY()).toBe(0);
    const back = createTradesController({ api: fake.api, pageSize: 50, cache, restore: true });
    expect(back.getState().phase).toBe('loading');
  });
});

describe('AC-11: ホーム・記録する画面は全件を読まない', () => {
  it('ホームの件数（10）で読むと、要求は limit=10 の 1 回', async () => {
    const fake = createFakeApi({ trades: synthetic(30) });
    const c = createTradesController({ api: fake.api, pageSize: 10 });
    await c.load();
    expect(tradeGets(fake)).toEqual(['/api/trades?limit=10']);
    expect(ids(c)).toHaveLength(10);
  });

  it('画面のソースで "/api/trades" の文字だけのパスは取引の作成（POST）の 1 か所だけ。ホームは HOME_LIMIT で読む', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(join(__dirname, '../../ui/src'));
    const hits: { file: string; after: string }[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/['"`]\/api\/trades['"`?]/g)) {
        hits.push({
          file: f.replace(/^.*ui\/src\//, ''),
          after: src.slice(m.index, m.index + 300),
        });
      }
    }
    // trade-pages.ts の tradesPath は必ず limit を付けて組み立てる（件数つきのパスの唯一の組み立て）
    // 例外: 設定の画面で口座の通貨を変える操作の最初の 1 回だけ、取引のある口座を知るために全件を読む（#47 PR-2。
    // 守りは API の 409）。口座ごとに「取引あり」を API が返す形にするのは別の Issue
    expect(hits.map((h) => h.file)).toEqual([
      'lib/record-controller.ts',
      'lib/settings-controller.ts',
      'lib/trade-pages.ts',
    ]);
    expect(hits[2]?.after).toMatch(/^`\/api\/trades\?\$\{q\.toString\(\)\}`/);
    expect(hits[0]?.after).toMatch(/method: 'POST'/);
    const settings = readFileSync(
      join(__dirname, '../../ui/src/lib/settings-controller.ts'),
      'utf8',
    );
    expect(
      settings.slice(
        settings.indexOf('const listInUse'),
        settings.indexOf("request('/api/trades')"),
      ),
    ).toMatch(/^const listInUse/);
    const home = readFileSync(join(__dirname, '../../ui/src/pages/Home.tsx'), 'utf8');
    expect(home).toMatch(/useTrades\(\{ pageSize: HOME_LIMIT \}\)/);
  });
});
