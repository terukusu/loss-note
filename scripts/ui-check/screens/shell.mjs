import { join } from 'node:path';
import {
  darkBg,
  NAV_HREFS,
  opts,
  PAGES,
  SHEET_PATHS,
  settle,
  setupContext,
  THEMES,
  waitReady,
} from '../base.mjs';
import { installFakeApi } from '../fixtures.mjs';
import { pagesGroup, zoomPagesGroup } from '../groups.mjs';
import { closeSheet, OPEN_SHEET, openInfo, sheetCount, toReview } from '../helpers.mjs';

/**
 * 画面の検査の単位「アプリの殻」: 部品の見本（/dev/parts）と、行き来 V1〜V7・ホーム画面に追加 PWA1・スクロール S1・
 * 安全域 SA1・テーマ T2〜T4
 */
export const id = 'shell';
export const title = 'アプリの殻';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
}

/** 手順（V1・V2・V3・V4・V5・PWA1・S1・V6・V7・SA1・T2・T3・T4） */
export async function flows(kit) {
  const { browser, base, signedIn, check, expectEq, path } = kit;
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: signedIn,
  });
  // 行き来の手順は取引 0 件の偽の API で流す（V1 は下のタブの真ん中の ［＋ 記録］ を踏む。#127 でホームの [記録する] を無くした）
  await installFakeApi(ctx, { trades: [] });
  const page = await ctx.newPage();

  await check('V1', async () => {
    await page.goto(`${base}/`);
    await waitReady(page, 'ホーム');
    // ホームの中身に [記録する] を置かない（下のタブの 1 か所だけ。#127）
    expectEq(await page.locator('main a[href="/record"]').count(), 0, 'ホームの中の [記録する]');
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    expectEq(path(page), '/record', 'URL');
    return 'ホーム → ［＋ 記録］ → /record';
  });
  await check('V2', async () => {
    await page.goBack();
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    return '戻る → /';
  });
  await check('V3', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引');
    await page.reload();
    await waitReady(page, '取引');
    expectEq(path(page), '/trades', 'URL');
    return '直接開く・再読み込み → 一覧';
  });
  await check('V4', async () => {
    await page.goto(`${base}/trades/no-such-trade`);
    await waitReady(page, '取引の詳細');
    await page.getByText('この取引は見つかりません').waitFor();
    // 上の帯の「‹ 取引」と、空の状態の [一覧へ戻る]（#127）
    const link = page.locator('main .empty a[href="/trades"]');
    if ((await link.count()) !== 1) throw new Error('一覧へのボタンが 1 つでない');
    await link.click();
    await waitReady(page, '取引');
    return '「この取引は見つかりません」→ 一覧へ';
  });
  await check('V5', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引');
    await page.goto(`${base}/no-such-page`);
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    await page.goBack();
    await waitReady(page, '取引');
    expectEq(path(page), '/trades', '戻った先');
    return '知らない URL → / に置き換え、戻る → /trades';
  });
  // ホーム画面に追加（Issue #77 の AC-6・例 E8）: 開発サーバーは CSP を付けないので、/ の文書だけに本番の manifest-src の
  // 許可（api の BASE_CSP の manifest-src 'self' と同じ。本番の値は image-check.sh が見る）を付けて開き、Chromium が manifest を
  // エラーなしで読むこと（CDP の Page.getAppManifest）と、manifest の読み込みが CSP で止まらないことを見る
  await check('PWA1', async () => {
    const c = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      await c.route(`${base}/`, async (route) => {
        const res = await route.fetch();
        await route.fulfill({
          response: res,
          headers: { ...res.headers(), 'content-security-policy': "manifest-src 'self'" },
        });
      });
      const p = await c.newPage();
      const blocked = [];
      p.on('console', (m) => {
        if (/manifest/i.test(m.text()) && /Refused|Content Security Policy/i.test(m.text()))
          blocked.push(m.type());
      });
      const seen = new Map();
      p.on('response', (r) => seen.set(new URL(r.url()).pathname, r.status()));
      await p.goto(`${base}/`);
      await p.waitForLoadState('load');
      const cdp = await c.newCDPSession(p);
      let got = await cdp.send('Page.getAppManifest');
      for (let i = 0; i < 20 && !got.data; i++) {
        await p.waitForTimeout(250);
        got = await cdp.send('Page.getAppManifest');
      }
      expectEq(new URL(got.url).pathname, '/manifest.webmanifest', 'manifest の URL');
      expectEq(got.errors.length, 0, 'manifest のエラーの件数');
      const m = JSON.parse(got.data ?? '{}');
      expectEq(m.display, 'standalone', 'display');
      expectEq(m.start_url, '/', 'start_url');
      expectEq(blocked.length, 0, 'manifest の CSP の違反の件数');
      for (const icon of m.icons ?? []) {
        const r = await p.request.get(`${base}${icon.src}`);
        expectEq(r.status(), 200, icon.src);
      }
      expectEq(seen.get('/manifest.webmanifest'), 200, '/manifest.webmanifest の状態');
      return `manifest のエラー 0 件・CSP の違反 0 件・アイコン ${(m.icons ?? []).length} つが 200`;
    } finally {
      await c.close();
    }
  });
  await check('S1', async () => {
    await page.goto(`${base}/dev/parts`);
    await waitReady(page, '部品の見本');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY >= 1100);
    const before = await page.evaluate(() => window.scrollY);
    // 今のタブの中で進む（［＋ 記録］ = push。タブの切り替えは V7 で見る。#127）
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    expectEq(await page.evaluate(() => window.scrollY), 0, '進んだ先のスクロール');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page
      .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before, { timeout: 5000 })
      .catch(() => {});
    const after = await page.evaluate(() => window.scrollY);
    if (Math.abs(after - before) > 2)
      throw new Error(`戻った後のスクロール ${after}px（期待 ${before}px）`);
    // B2（#57 再レビュー・N12）: 「i」を開いたまま別の画面へ移って戻った後も、この画面の戻るの位置の復元が効く
    // （元の項目に scrollRestoration = manual が残らない）。部品の見本は読み込みの待ちが無いので、復元をそのまま測れる
    await page.evaluate(() => window.scrollTo(0, 0));
    // 説明のシートはモーダルなので、シートの中の ［用語集で見る］ で移る（#129）
    await openInfo(page, '「判定」の説明');
    await page.locator(`${OPEN_SHEET} .info__glossary`).click();
    await waitReady(page, '用語集');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page.waitForTimeout(300);
    const mode = await page.evaluate(() => history.scrollRestoration);
    expectEq(mode, 'auto', '戻った後の scrollRestoration');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY >= 1100);
    const before2 = await page.evaluate(() => window.scrollY);
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page
      .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before2, { timeout: 5000 })
      .catch(() => {});
    const after2 = await page.evaluate(() => window.scrollY);
    if (Math.abs(after2 - before2) > 2)
      throw new Error(
        `「i」を開いたまま移って戻った後の戻るのスクロール ${after2}px（期待 ${before2}px）`,
      );
    return `進む → 先頭（0px）、戻る → 元の位置（${after}px）。「i」を開いたまま移って戻った後も auto・戻る → 元の位置（${after2}px）`;
  });
  await ctx.close();

  await check('V6', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
    });
    await installFakeApi(c);
    const p = await c.newPage();
    let taps = 0;
    try {
      let sheets = 0;
      for (const from of PAGES.filter((x) => x.path !== '/login')) {
        // 全画面のシート（記録する・編集）の間は下のタブを隠し、左上に ✕（キャンセル）を出す（9.2・9.3・A2）
        if (SHEET_PATHS(from.path)) {
          await p.goto(base + from.path);
          await waitReady(p, from.h1);
          if (await p.locator('nav.appnav').isVisible())
            throw new Error(`${from.path} で下のタブが出ている`);
          const x = await p.locator('.appbar--sheet button[aria-label="キャンセル"]').boundingBox();
          if (!x || x.x > 60 || x.y > 60) throw new Error(`${from.path} の ✕ が左上に無い`);
          sheets++;
          continue;
        }
        for (const href of NAV_HREFS) {
          await p.goto(base + from.path);
          await waitReady(p, from.h1);
          const link = p.locator(`nav a[href="${href}"]`);
          const box = await link.boundingBox();
          if (!box) throw new Error(`${from.path} に ${href} が無い`);
          if (box.y < 0 || box.y + box.height > 780 || box.x < 0 || box.x + box.width > 360) {
            throw new Error(`${from.path} の ${href} が画面の外`);
          }
          await link.click();
          await p
            .waitForURL((u) => u.pathname === href, { timeout: 5000 })
            .catch(() => {
              throw new Error(`${from.path} → ${href}: URL が ${new URL(p.url()).pathname} のまま`);
            });
          taps++;
        }
      }
      return `幅 360 の ${PAGES.length - 1 - sheets} 画面 × 5 項目（タブ 4 つ + ［＋ 記録］）= ${taps} 回、すべて 1 タップ。全画面のシート ${sheets} 画面は下のタブを隠し、左上に ✕`;
    } finally {
      await c.close();
    }
  });

  // V7（#127。ui-guidelines 9.7 の表）: タブごとの積み重ねと戻る（縦の形 390×844）。印の無い起動だけ履歴を組み直す
  // （/trades/x-r1 を直接開く → 戻ると一覧 → もう 1 回でホーム。再読み込みでは積まない）・ホーム → 取引 → 行 → 設定（戻ると
  // ホーム）→ 取引で詳細が出てスクロールの位置が戻る・同じタブを押し直すと根・詳細で説明を開いたまま再読み込みすると層は
  // 開かず、戻る 1 回で一覧。広い形（1280×800）では、記録するを開いて書きかけのまま設定のタブへ → 閉じて「記録の入力は残って
  // います」、取引のタブへ戻ると一覧（記録するは取引の積み重ねに残らない）
  await check('V7', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
    });
    await installFakeApi(c);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const at = () => new URL(p.url()).pathname;
    const steps = [];
    try {
      // 印の無い起動（直接開いた）→ [/, /trades, /trades/x-r1]。再読み込みでは組み直さない
      await p.goto(`${base}/trades/x-r1`);
      await waitReady(p, 'US30 · L');
      const len0 = await p.evaluate(() => history.length);
      await p.reload();
      await waitReady(p, 'US30 · L');
      expectEq(await p.evaluate(() => history.length), len0, '再読み込みの後の履歴の数');
      // 組み直しは利用者の最初の操作で書く（操作の無いまま積んだ段は Chrome が戻るで飛ばす。触らずに戻ればアプリを出る）
      await p.locator('main h1').first().click();
      expectEq(await p.evaluate(() => history.length), len0 + 2, '操作の後の組み直し（+2 段）');
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '直接開いた詳細の戻る');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', 'もう 1 回の戻る');
      steps.push('直接開いた詳細 → 戻る 2 回でホーム（再読み込みで積まない）');
      // ホーム → 取引 → 行 → 設定 → 取引（詳細と位置が戻る）。詳細は #131 で 1 画面に詰めたので、スクロールの位置を測れる
      // 長さを作るため窓の高さだけ縮める（縦の形のまま。幅 390・高さ 600）
      await p.setViewportSize({ width: 390, height: 600 });
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await settle(p);
      const want = await p.evaluate(() =>
        Math.min(400, document.documentElement.scrollHeight - window.innerHeight),
      );
      if (want < 100) throw new Error(`詳細のスクロールできる量 ${want}px（100px 未満）`);
      await p.evaluate((v) => window.scrollTo(0, v), want);
      await p.waitForFunction((v) => window.scrollY >= v - 2, want);
      const y = await p.evaluate(() => window.scrollY);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '設定のタブ');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '設定の根の戻る');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(at(), '/trades/x-r1', '取引のタブで前に開いていた詳細');
      await p
        .waitForFunction((want) => Math.abs(window.scrollY - want) <= 2, y, { timeout: 5000 })
        .catch(() => {});
      const y2 = await p.evaluate(() => window.scrollY);
      if (Math.abs(y2 - y) > 2) throw new Error(`戻した位置 ${y2}px（期待 ${y}px）`);
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '積み直した詳細の戻る');
      await p.setViewportSize({ width: 390, height: 844 });
      steps.push(`取引 → 詳細 → 設定（戻るとホーム）→ 取引で詳細と位置 ${Math.round(y2)}px が戻る`);
      // 同じタブを押し直すと根へ
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '同じタブの押し直し');
      await p.goBack();
      await waitReady(p, 'ホーム');
      steps.push('同じタブを押し直すと根（戻るとホーム）');
      // 説明を開いたまま再読み込み → 層は開かず、戻る 1 回で一覧
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「LC の物差し」の説明');
      await p.waitForTimeout(200);
      await p.reload();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(300);
      expectEq(await sheetCount(p), 0, '再読み込みの後の説明');
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '層の段で再読み込みした後の戻る 1 回');
      steps.push('説明を開いたまま再読み込み → 開かない・戻る 1 回で一覧');
      // 説明を閉じた直後（層の段を戻している途中）にタブを替える → 層の段を戻してから替える。[/, /settings]・戻るとホーム
      // （#127 のレビュー N9。説明のシートはモーダルで、開いている間はタブを押せない。#129）
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「LC の物差し」の説明');
      await closeSheet(p);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      // 戻るは利用者の戻ると同じ history.back（Chrome が操作の無い段を飛ばすかも見る。#127 のレビュー N3）
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '説明を開いたまま設定のタブへ移った後の戻る');
      steps.push('説明を閉じた直後に設定のタブ → 戻るとホーム');
      // 用語集の中で言葉を 2 つたどる → 取引のタブ → 戻るとホーム。設定のタブの押し直しは根（#127 のレビュー B1）
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      await p.locator('a[href="/glossary"]').first().click();
      await waitReady(p, '用語集');
      await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
      await p.waitForTimeout(200);
      await p.locator('#glossary-lc a.glink', { hasText: '1R' }).first().click();
      await p.waitForTimeout(200);
      expectEq(new URL(p.url()).hash !== '', true, '用語集の中でたどった');
      // 取引のタブは前に開いていた詳細（記憶）が出る。押し直して根へ、戻るとホーム
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(at(), '/trades/x-r1', '用語集でたどった後の取引のタブ（記憶の詳細）');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '用語集でたどった後に取引のタブ → 根 → 戻る');
      // 設定のタブは前に開いていた用語集（記憶。たどった段は 1 段にまとめる）が出る
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '用語集');
      await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
      await p.waitForTimeout(200);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '用語集でたどった後の設定のタブの押し直し');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      steps.push(
        '用語集で言葉をたどった後: 取引のタブ（記憶の詳細）→ 押し直しで根 → 戻るとホーム・設定のタブの押し直しは根',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } catch (e) {
      // どの段で外れたか（済んだ段の数・今の URL・ページのエラー）を添える
      throw new Error(
        `縦の形の ${steps.length + 1} 段目（URL ${p.url().replace(base, '')}・エラー ${errors.join(' / ') || 'なし'}）: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      );
    } finally {
      await c.close();
    }
    // 広い形: 記録するを開いたままタブを替える → 閉じて書きかけを残す
    const w = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: signedIn,
    });
    await installFakeApi(w);
    const q = await w.newPage();
    try {
      await q.goto(`${base}/trades`);
      await waitReady(q, '取引');
      await q.locator('nav a[href="/record"]').click();
      await waitReady(q, '記録する');
      await toReview(q);
      await q.locator('#record-lc').fill('100.5');
      await q.locator('nav a[href="/settings"]').click();
      await waitReady(q, '設定');
      await q.locator('.toast', { hasText: '記録の入力は残っています' }).waitFor({ timeout: 5000 });
      await q.locator('nav a[href="/trades"]').click();
      await waitReady(q, '取引');
      expectEq(new URL(q.url()).pathname, '/trades', '取引のタブに戻った先');
      await q.locator('nav a[href="/record"]').click();
      await waitReady(q, '記録する');
      await toReview(q);
      expectEq(await q.locator('#record-lc').inputValue(), '100.5', '残した書きかけ');
      steps.push('広い形で記録するを開いたまま設定のタブ → 閉じて残す・取引のタブは一覧');
    } catch (e) {
      throw new Error(
        `広い形（URL ${q.url().replace(base, '')}）: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      );
    } finally {
      await w.close();
    }
    return steps.join(' / ');
  });

  // SA1（#127。ui-guidelines 9.6・9.10）: 安全域の差し替え（縦: 上 47・下 34）で、上の帯・下のタブ・記録する画面の下の帯の
  // 押せるものが安全域の外（内側）にあり、上の安全域に面が敷かれ、タブの根の大きな題が上の安全域の下にある。Chromium では
  // env() が 0 なので、トークン --safe-* を差し替えて見る（実機の確かめは手で）
  await check('SA1', async () => {
    const out = [];
    for (const theme of THEMES) {
      const c = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
      });
      try {
        await setupContext(c, theme);
        await c.addInitScript(() => {
          const put = () => {
            const st = document.createElement('style');
            st.textContent =
              ':root:root{--safe-top:47px;--safe-bottom:34px;--safe-left:0px;--safe-right:0px}';
            document.head.append(st);
          };
          if (document.head) put();
          else document.addEventListener('DOMContentLoaded', put);
        });
        await installFakeApi(c);
        const p = await c.newPage();
        for (const [path, h1, wait] of [
          ['/', 'ホーム', '.homerow'],
          ['/trades', '取引', '.traderow'],
          ['/trades/x-d1', 'US30 · L', 'canvas.chartview__canvas'],
          ['/record', '記録する', '#record-lc'],
          ['/review', '振り返り', '.review'],
          ['/settings', '設定', null],
        ]) {
          await p.goto(base + path);
          await waitReady(p, h1);
          // 記録するは 2 段目（下の帯がある段）で測る（2026-11-21）
          if (path === '/record') await toReview(p);
          else if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 });
          const r = await p.evaluate(() => {
            const vh = window.innerHeight;
            const bad = [];
            const sel =
              '.appnav a, .appbar a, .appbar button, .record__submit--bar button, .rootbar';
            for (const el of document.querySelectorAll(sel)) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) continue;
              if (getComputedStyle(el).visibility === 'hidden') continue;
              if (b.top < 47 - 0.5 || b.bottom > vh - 34 + 0.5) {
                const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
                bad.push(`${name.slice(0, 10)} ${Math.round(b.top)}〜${Math.round(b.bottom)}`);
              }
            }
            const face = document.querySelector('.statusbar-bg')?.getBoundingClientRect();
            // タブの根の大きな題（ホームは印と「損失ノート」の小さな見出し。#128）
            const big = document
              .querySelector('main .pagehead__title, main .homehead__title')
              ?.getBoundingClientRect();
            const bar = document.querySelector('main .appbar')?.getBoundingClientRect();
            return {
              bad,
              face: face ? Math.round(face.height) : 0,
              titleTop: big ? big.top : bar ? bar.top : -1,
              barTop: bar ? bar.top : null,
            };
          });
          const where = `${theme} ${path}`;
          if (r.bad.length > 0) throw new Error(`${where}: 安全域に重なる ${r.bad.join(' / ')}`);
          expectEq(r.face, 47, `${where} の上の安全域の面`);
          // 大きな題は上の安全域の下。上の帯は端（0）から敷き、中身（押せるもの）は上の安全域の下（上で見た）
          if (r.barTop === null && r.titleTop < 47)
            throw new Error(`${where}: 大きな題 ${Math.round(r.titleTop)}px が上の安全域に重なる`);
          if (opts.shots)
            await p.screenshot({
              path: join(
                opts.shots,
                `390x844-${theme}-safe-${path === '/' ? 'home' : path.slice(1).replace(/\//g, '-')}.png`,
              ),
            });
        }
        out.push(theme);
      } finally {
        await c.close();
      }
    }
    return `${out.join('・')} × 6 画面: 押せるものは安全域（上 47・下 34）の内側、上の安全域に面`;
  });

  await check('T2', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'light',
      storageState: signedIn,
    });
    const p = await c.newPage();
    try {
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      const r = await p.evaluate(() => {
        const html = document.documentElement;
        const attr = html.getAttribute('data-theme');
        html.removeAttribute('data-theme');
        const bare = getComputedStyle(html).getPropertyValue('--bg').trim().toLowerCase();
        return { attr, bare, light: matchMedia('(prefers-color-scheme: light)').matches };
      });
      expectEq(r.light, true, 'OS の設定がライト');
      expectEq(r.attr, 'dark', 'data-theme');
      expectEq(r.bare, darkBg(), 'data-theme なしの --bg');
    } finally {
      await c.close();
    }
    return 'OS がライトでもダーク（data-theme なしでも --bg がダーク）';
  });

  await check('T3', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    // 設定の画面は /api を読む（#5）。手元の API への proxy の失敗を出さないよう偽の API を入れる
    await installFakeApi(c);
    const p = await c.newPage();
    try {
      await p.goto(`${base}/settings`);
      await waitReady(p, '設定');
      await p.locator('label.seg__item', { hasText: 'ライト' }).click();
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '切り替え直後');
      await p.reload();
      await waitReady(p, '設定');
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '開き直した後');
      const checked = await p.locator('input[type="radio"][value="light"]').isChecked();
      expectEq(checked, true, 'ライトが選ばれている');
    } finally {
      await c.close();
    }
    return 'ライトを選んで開き直す → ライト';
  });

  await check('T4', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    await installFakeApi(c);
    await c.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await p.goto(`${base}/settings`);
      await waitReady(p, '設定');
      expectEq(await p.getAttribute('html', 'data-theme'), 'dark', '開いたとき');
      await p.locator('label.seg__item', { hasText: 'ライト' }).click();
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '切り替え後');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '保存が例外 → ダークで開き、切り替えはその場で効く';
  });
}
