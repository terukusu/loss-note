import { join } from 'node:path';
import {
  AUTH_EMULATOR,
  loginViaPopup,
  measure,
  opts,
  SIZES,
  setupContext,
  TAP,
  THEME_KEY,
  THEMES,
  waitReady,
} from '../base.mjs';
import { pagesGroup, zoomPagesGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「ログイン」: ログインの画面と、ログインの門 L1〜L7・使えないアカウント F1・F2
 */
export const id = 'login';
export const title = 'ログイン';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
}

/** 手順（L1〜L6・F1・F2・L7） */
export async function flows(kit) {
  const { browser, base, signedIn, out, check, expectEq, path } = kit;
  // ── ログインの門（L1〜L7）。ログインしていない文脈から始める
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // ログイン画面・取引の一覧の見出しが一度でも描かれたかを記録する（L1・L4 のちらつきの確かめ）
    await c.addInitScript(() => {
      const seen = new Set();
      window.__uiCheckSeen = seen;
      new MutationObserver(() => {
        for (const h of document.querySelectorAll('main h1')) seen.add(h.textContent ?? '');
      }).observe(document, { childList: true, subtree: true });
    });
    const apiCalls = [];
    await c.route('**/api/**', (route) => {
      const auth = route.request().headers().authorization ?? '';
      apiCalls.push(auth);
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const seen = () => p.evaluate(() => [...window.__uiCheckSeen]);
    const callApi = () =>
      p.evaluate(async () => {
        const m = await import('/src/auth/session.ts');
        try {
          const r = await m.api('/api/health');
          return `status ${r.status}`;
        } catch (e) {
          return e instanceof Error ? e.name : 'error';
        }
      });
    try {
      await check('L1', async () => {
        await p.goto(`${base}/trades`);
        await waitReady(p, 'ログイン');
        const u = new URL(p.url());
        expectEq(`${u.pathname}${u.search}`, '/login?next=%2Ftrades', 'URL');
        const s = await seen();
        if (s.includes('取引')) throw new Error('一覧の中身が一度描かれた');
        return '一覧の URL → /login?next=%2Ftrades、一覧の中身は出ない';
      });
      // G1（Issue #52）: Google でログインするボタン。ダーク / ライト × 幅 360 / 1440 で、読み上げの名前で見つかり、
      // 当たり 44 以上・はみ出さない・配色はガイドラインの値（地・1px の枠・文字）・ロゴは 20px の 4 色・ロゴが文字の左
      await check('G1', async () => {
        const want = {
          dark: { bg: 'rgb(19, 19, 20)', line: 'rgb(142, 145, 143)', ink: 'rgb(227, 227, 227)' },
          light: { bg: 'rgb(255, 255, 255)', line: 'rgb(116, 119, 117)', ink: 'rgb(31, 31, 31)' },
        };
        const seenSizes = [];
        for (const theme of ['dark', 'light']) {
          for (const w of [360, 1440]) {
            await p.setViewportSize({ width: w, height: 800 });
            await p.evaluate(([k, t]) => localStorage.setItem(k, t), [THEME_KEY, theme]);
            await p.goto(`${base}/login`);
            await waitReady(p, 'ログイン');
            const btn = p.getByRole('button', { name: 'Google でログイン', exact: true });
            expectEq(await btn.count(), 1, `${theme} ${w}: ボタンの数`);
            const m = await btn.evaluate((el) => {
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              const logo = el.querySelector('svg');
              const text = el.querySelector('.gsi__text');
              const lr = logo?.getBoundingClientRect();
              const tr = text?.getBoundingClientRect();
              return {
                w: r.width,
                h: r.height,
                right: r.right,
                vw: document.documentElement.clientWidth,
                scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                bg: cs.backgroundColor,
                line: cs.borderTopColor,
                lineW: cs.borderTopWidth,
                ink: cs.color,
                fs: cs.fontSize,
                lh: cs.lineHeight,
                fills: [...(logo?.querySelectorAll('path') ?? [])].map((x) =>
                  x.getAttribute('fill'),
                ),
                logo: lr ? [lr.width, lr.height] : null,
                logoLeft: lr && tr ? lr.right <= tr.left : false,
                gap: lr && tr ? Math.round(tr.left - lr.right) : null,
              };
            });
            const label = `${theme} ${w}`;
            if (m.h < TAP || m.w < TAP) throw new Error(`${label}: 当たり ${m.w}×${m.h}`);
            if (m.right > m.vw + 0.5 || m.scroll > 0) throw new Error(`${label}: はみ出し`);
            expectEq(m.bg, want[theme].bg, `${label}: 地`);
            expectEq(m.line, want[theme].line, `${label}: 枠の色`);
            expectEq(m.lineW, '1px', `${label}: 枠の太さ`);
            expectEq(m.ink, want[theme].ink, `${label}: 文字の色`);
            expectEq(`${m.fs}/${m.lh}`, '14px/20px', `${label}: 文字`);
            expectEq(
              [...m.fills].sort().join(','),
              ['#34A853', '#4285F4', '#EA4335', '#FBBC05'].join(','),
              `${label}: ロゴの色`,
            );
            expectEq(m.logo?.join('x'), '20x20', `${label}: ロゴの大きさ`);
            if (!m.logoLeft) throw new Error(`${label}: ロゴが文字の左に無い`);
            expectEq(m.gap, 10, `${label}: ロゴと文字の間`);
            seenSizes.push(`${label} ${Math.round(m.w)}×${Math.round(m.h)}`);
          }
        }
        await p.setViewportSize({ width: 390, height: 844 });
        await p.evaluate((k) => localStorage.removeItem(k), THEME_KEY);
        // 続く L6・L2 のため、L1 と同じ状態（/login?next=%2Ftrades）に戻す
        await p.goto(`${base}/trades`);
        await waitReady(p, 'ログイン');
        return `Google のボタン: ガイドラインの配色・1px の枠・14/20・ロゴ 20px の 4 色・間 10px（${seenSizes.join(' / ')}）`;
      });
      await check('L6', async () => {
        const before = apiCalls.length;
        const r = await callApi();
        expectEq(r, 'NotSignedIn', '要求の結果');
        expectEq(apiCalls.length, before, '/api への要求の数');
        return 'ログインしていない → /api へ送らず NotSignedIn';
      });
      await check('L2', async () => {
        await loginViaPopup(p);
        await waitReady(p, '取引');
        expectEq(path(p), '/trades', 'URL');
        return 'エミュレーターの架空の利用者でログイン → /trades（開こうとした画面）';
      });
      await check('L5', async () => {
        const before = apiCalls.length;
        const r = await callApi();
        expectEq(r, 'status 200', '要求の結果');
        expectEq(apiCalls.length, before + 1, '/api への要求の数');
        const h = apiCalls[apiCalls.length - 1] ?? '';
        // トークンの値は出力しない（形だけ見る: Bearer + JWT の 3 つの部分）
        if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]*$/.test(h))
          throw new Error('Authorization が Bearer <ID トークン> でない');
        return '/api の要求に Authorization: Bearer <ID トークン>';
      });
      await check('L4', async () => {
        await p.reload();
        await waitReady(p, '取引');
        expectEq(path(p), '/trades', 'URL');
        const s = await seen();
        if (s.includes('ログイン')) throw new Error('再読み込みでログイン画面が描かれた');
        return '再読み込み → ログインのまま /trades（ログイン画面はちらつかない）';
      });
      await check('L3', async () => {
        await p.locator('nav a[href="/settings"]').click();
        await waitReady(p, '設定');
        await p.getByRole('button', { name: 'ログアウト' }).click();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', 'ログアウトの後');
        await p.evaluate(() => window.__uiCheckSeen.clear());
        await p.goBack();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', '戻るの後');
        const s = await seen();
        if (s.includes('設定') || s.includes('取引'))
          throw new Error('戻るで前の画面の中身が描かれた');
        return 'ログアウト → /login、戻る → ログイン画面のまま（中身は出ない）';
      });
      expectEq(errors.length, 0, 'ページのエラー');
    } catch (e) {
      out.push(['L*', false, e instanceof Error ? e.message.split('\n')[0] : String(e)]);
    } finally {
      await c.close();
    }
  }

  // ── 使えないアカウント（Issue #43 の例 L3・L4）。ログイン済みの文脈で、偽の /api がすべて 403 を返す
  //   F1: どの画面を開いても中身を出さず「このアカウントでは使えません」と [別のアカウントでログイン]。幅 360 と 1440 ×
  //       ダーク / ライトで横スクロール 0・当たり 44 以上・見出しは 2 行まで（--shots なら撮る）。ホームは /api を読まないが、
  //       ログインの確かめの 1 回で出る
  //   F2: [別のアカウントでログイン] → ログアウトしてログイン画面に置き換わる
  {
    const forbiddenCtx = async (w, hgt, theme) => {
      const c = await browser.newContext({
        viewport: { width: w, height: hgt },
        storageState: signedIn,
      });
      await setupContext(c, theme);
      // 記録の中身（取引の行）が一度でも描かれたかを記録する（画面の見出しは 403 が返るまでの間に出てよい。
      // 中身は API が 403 を返すので届かない）
      await c.addInitScript(() => {
        window.__uiCheckRows = 0;
        new MutationObserver(() => {
          window.__uiCheckRows += document.querySelectorAll('.traderow').length;
        }).observe(document, { childList: true, subtree: true });
      });
      await c.route('**/api/**', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: '{"error":"forbidden"}',
        }),
      );
      return c;
    };
    const TITLE = 'このアカウントでは使えません';
    await check('F1', async () => {
      const notes = [];
      for (const [w, hgt] of SIZES.filter(([sw]) => sw === 360 || sw === 1440)) {
        for (const theme of THEMES) {
          const c = await forbiddenCtx(w, hgt, theme);
          try {
            const p = await c.newPage();
            const errors = [];
            p.on('pageerror', (e) => errors.push(e.message));
            for (const at of ['/', '/trades', '/settings']) {
              await p.goto(`${base}${at}`);
              await waitReady(p, TITLE);
              expectEq(path(p), at, `${at} の URL（置き換えない）`);
              const rows = await p.evaluate(() => window.__uiCheckRows);
              if (rows > 0) throw new Error(`${at}: 取引の行が描かれた`);
              if ((await p.locator('nav.appnav').count()) > 0)
                throw new Error(`${at}: 行き先が出ている`);
              await p
                .getByRole('button', { name: '別のアカウントでログイン' })
                .waitFor({ state: 'visible' });
            }
            // 見出しの行数（句の中で折り返さず 2 行まで。デザインレビュー #43）
            const lines = await p.evaluate(() => {
              const h = document.querySelector('main h1');
              if (!h) return 0;
              const lh = Number.parseFloat(getComputedStyle(h).lineHeight);
              return Math.round(h.getBoundingClientRect().height / lh);
            });
            if (lines > 2) throw new Error(`${w} ${theme}: 見出しが ${lines} 行`);
            const m = await measure(p, w === 360, TAP);
            if (m.h > 0) throw new Error(`${w} ${theme}: 横スクロール ${m.h}px`);
            if (m.small.length > 0)
              throw new Error(`${w} ${theme}: 当たり<44 ${m.small.join('・')}`);
            if (m.clipped.length > 0)
              throw new Error(`${w} ${theme}: はみ出し ${m.clipped.join('・')}`);
            expectEq(errors.length, 0, 'ページのエラー');
            if (opts.shots) {
              await p.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-forbidden.png`),
                fullPage: true,
              });
            }
            notes.push(`${w}${theme === 'dark' ? 'D' : 'L'} 見出し ${lines} 行`);
          } finally {
            await c.close();
          }
        }
      }
      return `/・/trades・/settings → 使えない旨と [別のアカウントでログイン] だけ（横 0px。${notes.join('・')}）`;
    });
    await check('F2', async () => {
      const c = await forbiddenCtx(390, 844, 'dark');
      try {
        const p = await c.newPage();
        await p.goto(`${base}/trades`);
        await waitReady(p, TITLE);
        await p.getByRole('button', { name: '別のアカウントでログイン' }).click();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', 'ログアウトの後');
        return '[別のアカウントでログイン] → ログアウトして /login（ログイン画面）';
      } finally {
        await c.close();
      }
    });
  }

  await check('L7', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // エミュレーターが止まっている状態を、エミュレーターへの要求をすべて遮断して再現する
    await c.route(`${AUTH_EMULATOR}/**`, (route) => route.abort('connectionrefused'));
    const p = await c.newPage();
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, 'ログイン');
      const popupWait = p.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
      await p.getByRole('button', { name: 'Google でログイン' }).click();
      const popup = await popupWait;
      await p
        .getByRole('alert')
        .filter({ hasText: 'ログインのサービスと通信できませんでした' })
        .waitFor({ timeout: 30000 });
      if (popup && !popup.isClosed()) await popup.close();
      // 白い画面になっていない（見出しとボタンが残る）
      await waitReady(p, 'ログイン');
      await p.getByRole('button', { name: 'Google でログイン' }).waitFor();
    } finally {
      await c.close();
    }
    return 'エミュレーターに繋がらない → 「ログインのサービスと通信できませんでした」、画面は残る';
  });
}
