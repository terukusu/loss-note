// 画面の検査（`npm run ui:check`。Issue #3 の what 6・AC-6・8・9・10。docs/ui-guidelines.md P6・P7・P8）。
// Chromium（Playwright）で全画面を幅 360 / 390 / 768 / 1440px × ダーク / ライトで開き、横スクロールの量（px）と、
// 幅 360px の押せるものの当たりが 44×44px 未満の件数、折り返さない部品（ボタン・セグメント・バッジなど）の中の
// はみ出しの件数を数値で出す。行き来（例の表 V1〜V6）とテーマ（T2〜T4）も実ブラウザで流す。
// 戻るでスクロールの位置が戻ること（S1）、ログインの門（例の表 L1〜L7）も見る。1 つでも外れれば終了コード 1。CI には入れない（手元で流し、出力の要約を PR に貼る）。
//
// 前提: `npm ci` の後に一度 `npx playwright install chromium`（ブラウザは手元のキャッシュに入る。リポジトリには入らない）。
// Auth のエミュレーター（127.0.0.1:9099。`npm run emulators`）が動いていること（無ければ終了コード 2）。
// 架空の利用者はエミュレーターのログインの画面で自動生成する（実在のメールを使わない）。ログインの画面は
// Google の gapi の script（apis.google.com）を読むので、ネットに出られない環境ではログインできない。
// Vite の開発サーバーはこのスクリプトが空きポートに立てて、終わりに閉じる（手で `npm run dev` を立てなくてよい）。
//
//   npm run ui:check                       既定の検査
//   npm run ui:check -- --inject-wide 400  幅 400px に固定した要素を全画面に足して流す（検査が崩れを見逃さないことの確かめ。AC-9）
//   npm run ui:check -- --inject-clip      部品が切れる・はみ出す見本（親で切れるバッジ・親より広いボタン・縦に切れるボタン）を
//                                          全画面に足して流す（部品のはみ出しの検査が見逃さないことの確かめ。1 画面 3 件）
//   npm run ui:check -- --shots <dir>      各状態を <dir> に撮る（目で見る補助。画像はコミットしない）
//
// 終了コード: 0 = すべて ok / 1 = 外れあり / 2 = 引数の誤り・起動できない
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const USAGE = `使い方: npm run ui:check [-- --inject-wide <px>] [-- --inject-clip] [-- --shots <dir>]`;

/** 引数を読む。誤りは終了コード 2 */
function parseArgs(argv) {
  const opts = { injectWide: 0, injectClip: false, shots: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inject-clip') {
      opts.injectClip = true;
    } else if (a === '--inject-wide') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0)
        usageError('--inject-wide には正の整数（px）を渡してください');
      opts.injectWide = v;
    } else if (a === '--shots') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) usageError('--shots には出力先のディレクトリを渡してください');
      opts.shots = resolve(v);
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      usageError(`知らない引数: ${a}`);
    }
  }
  return opts;
}

function usageError(msg) {
  console.error(msg);
  console.error(USAGE);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));

/** 検査する画面（6 画面 + 部品の見本）。詳細は無い取引の ID（V4 の画面） */
const PAGES = [
  { path: '/login', h1: 'ログイン' },
  { path: '/', h1: 'ホーム' },
  { path: '/record', h1: '記録する' },
  { path: '/trades', h1: '取引の一覧' },
  { path: '/trades/no-such-trade', h1: '取引の詳細' },
  { path: '/settings', h1: '設定' },
  { path: '/dev/parts', h1: '部品の見本' },
];
const SIZES = [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
const THEMES = ['dark', 'light'];
const TAP = 44;
const THEME_KEY = 'loss-note.theme';
const NAV_HREFS = ['/', '/record', '/trades', '/settings'];
const AUTH_EMULATOR = 'http://127.0.0.1:9099';

/** エミュレーターのログインの画面（ポップアップ）で、架空のアカウントを自動生成してログインする */
async function loginViaPopup(page) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Google でログイン' }).click(),
  ]);
  await popup.locator('#add-account-button').click({ timeout: 20000 });
  await popup.locator('#autogen-button').click();
  await popup.locator('#sign-in').click();
  await popup.waitForEvent('close', { timeout: 20000 }).catch(() => {});
}

/** テーマを端末の記憶に入れ、--inject-wide なら幅の広い要素を足す */
async function setupContext(context, theme) {
  await context.addInitScript(
    ([key, t]) => {
      try {
        localStorage.setItem(key, t);
      } catch {}
    },
    [THEME_KEY, theme],
  );
  if (opts.injectClip) {
    await context.addInitScript(() => {
      const add = () => {
        const box = document.createElement('div');
        box.setAttribute('data-ui-check-clip', '');
        box.style.cssText = 'position:absolute;left:0;top:0;width:200px';
        // (1) overflow: hidden の狭い親で切れるバッジ
        const a = document.createElement('div');
        a.style.cssText = 'width:60px;overflow:hidden';
        const badge = document.createElement('span');
        badge.className = 'badge badge--plan';
        badge.textContent = '計画どおりの勝ちの見本';
        a.append(badge);
        // (2) 親より広がるボタン（隣に重なる）
        const b = document.createElement('div');
        b.style.cssText = 'width:60px';
        const btn = document.createElement('button');
        btn.className = 'btn btn--primary';
        btn.textContent = 'とても長いボタンの文字';
        b.append(btn);
        // (3) 文字が縦に切れるボタン
        const tall = document.createElement('button');
        tall.className = 'btn btn--secondary';
        tall.style.cssText =
          'height:20px;min-height:0;overflow:hidden;white-space:normal;width:44px';
        tall.textContent = '縦に長い文字の見本';
        box.append(a, b, tall);
        document.body.appendChild(box);
      };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    });
  }
  if (opts.injectWide) {
    await context.addInitScript((px) => {
      const add = () => {
        const el = document.createElement('div');
        el.setAttribute('data-ui-check-wide', '');
        el.style.cssText = `position:absolute;left:0;top:0;width:${px}px;height:1px`;
        document.body.appendChild(el);
      };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    }, opts.injectWide);
  }
}

async function emulatorUp() {
  try {
    const r = await fetch(`${AUTH_EMULATOR}/`);
    return r.ok;
  } catch {
    return false;
  }
}

/** tokens.css のダークの定義の --bg（T2 の期待値） */
function darkBg() {
  const css = readFileSync(join(ROOT, 'ui/src/styles/tokens.css'), 'utf8');
  const block = /:root,\s*:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  return /--bg:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1]?.toLowerCase() ?? '';
}

function freePort() {
  return new Promise((ok, ng) => {
    const s = createNetServer();
    s.once('error', ng);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** 横スクロール（px）と、幅 360 のときは 44×44 未満の押せるもの */
async function measure(page, withTargets, tap) {
  return page.evaluate(
    ({ withTargets, tap }) => {
      const d = document.documentElement;
      const b = document.body;
      const h = Math.max(d.scrollWidth - window.innerWidth, b.scrollWidth - b.clientWidth, 0);
      const small = [];
      if (withTargets) {
        const sel =
          'a[href], button, input, select, textarea, [role="radio"], [role="button"], [tabindex]:not([tabindex="-1"])';
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('[data-ui-check-wide]')) continue;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (r.width === 0 && r.height === 0) continue;
          if (r.width < tap - 0.5 || r.height < tap - 0.5) {
            const text = (el.textContent || el.getAttribute('aria-label') || '')
              .trim()
              .slice(0, 16);
            const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
            small.push(
              `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${text}」${Math.round(r.width)}×${Math.round(r.height)}`,
            );
          }
        }
      }
      // 部品のはみ出し（折り返さない部品の文字・部品そのものが切れる・隣に重なる）。次の 4 つを数える
      //   横 / 縦: 部品の中で文字が箱を超える（scrollWidth / scrollHeight > clientWidth / clientHeight）
      //   親の外: 部品が自分ごと広がり、親の箱の左右を超える（隣との重なり）
      //   切れ: 部品が、最も近い overflow が visible でない祖先の箱の外に出る（祖先で切られる）
      const clipped = [];
      const clipAncestor = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return a;
        }
        return null;
      };
      const outside = (r, b) =>
        r.left < b.left - 1 ||
        r.right > b.right + 1 ||
        r.top < b.top - 1 ||
        r.bottom > b.bottom + 1;
      for (const el of document.querySelectorAll(
        '.seg__item, .btn, .badge, .appnav__link, .envchip, .steps__item, .pagehead__title',
      )) {
        if (el.closest('[data-ui-check-wide]')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const name = `${el.className.split(' ')[0]}「${(el.textContent || '').trim().slice(0, 16)}」`;
        if (el.scrollWidth > el.clientWidth + 1) {
          clipped.push(`${name} 横 ${el.scrollWidth}>${el.clientWidth}`);
        }
        if (el.scrollHeight > el.clientHeight + 1) {
          clipped.push(`${name} 縦 ${el.scrollHeight}>${el.clientHeight}`);
        }
        const r = el.getBoundingClientRect();
        const parent = el.parentElement;
        if (parent) {
          const pr = parent.getBoundingClientRect();
          if (r.left < pr.left - 1 || r.right > pr.right + 1) {
            clipped.push(`${name} 親の外 ${Math.round(r.width)}px / 親 ${Math.round(pr.width)}px`);
          }
        }
        const c = clipAncestor(el);
        if (c && outside(r, c.getBoundingClientRect())) {
          clipped.push(
            `${name} 切れ（${c.className.split(' ')[0] || c.tagName.toLowerCase()} の外）`,
          );
        }
      }
      return { h, small, clipped };
    },
    { withTargets, tap },
  );
}

async function waitReady(page, h1) {
  await page
    .locator('main h1', { hasText: h1 })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - [...s].length));
}

async function main() {
  process.chdir(ROOT);
  if (!(await emulatorUp())) {
    console.error(
      `Auth のエミュレーター（${AUTH_EMULATOR}）に繋がりません。別の端末で \`npm run emulators\` を起動してください。`,
    );
    process.exit(2);
  }
  let chromium;
  let createServer;
  try {
    ({ chromium } = await import('playwright'));
    ({ createServer } = await import('vite'));
  } catch (e) {
    console.error(
      `読み込めません（npm ci を済ませてください）: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(2);
  }

  const port = await freePort();
  const server = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    await server.close();
    console.error(
      `Chromium を起動できません。一度 \`npx playwright install chromium\` を流してください。\n${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
    process.exit(2);
  }

  // ログインした状態（IndexedDB の中のログインの記録）を 1 回作り、各状態の文脈で使い回す
  let signedIn;
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await p.goto(`${base}/login`);
    await waitReady(p, 'ログイン');
    await loginViaPopup(p);
    await waitReady(p, 'ホーム');
    signedIn = await c.storageState({ indexedDB: true });
    await c.close();
  } catch (e) {
    await browser.close();
    await server.close();
    console.error(
      `エミュレーターでログインできません（ログインの画面は apis.google.com を読みます。ネットに出られるか確かめてください）: ${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
    process.exit(2);
  }

  if (opts.shots) mkdirSync(opts.shots, { recursive: true });
  const problems = [];
  let states = 0;
  let worstH = 0;
  let smallTotal = 0;
  let clippedTotal = 0;

  try {
    // ── 画面 × 幅 × テーマ（C1〜C3）
    console.log(
      `画面の検査: ${PAGES.length} 画面 × ${SIZES.length} 幅 × ${THEMES.length} テーマ${opts.injectWide ? `（幅 ${opts.injectWide}px の要素を足す）` : ''}`,
    );
    for (const theme of THEMES) {
      for (const [w, hgt] of SIZES) {
        const pageFor = new Map();
        const contexts = [];
        const errors = [];
        for (const forLoginPage of [false, true]) {
          const context = await browser.newContext({
            viewport: { width: w, height: hgt },
            reducedMotion: 'reduce',
            // ログイン画面だけはログインしていない文脈で開く（ログイン済みは戻り先へ置き換わる）
            ...(forLoginPage ? {} : { storageState: signedIn }),
          });
          contexts.push(context);
          await setupContext(context, theme);
          const page = await context.newPage();
          page.on('pageerror', (e) => errors.push(e.message));
          pageFor.set(forLoginPage, page);
        }
        for (const p of PAGES) {
          const page = pageFor.get(p.path === '/login');
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(p.path, 22)}`;
          try {
            await page.goto(base + p.path);
            await waitReady(page, p.h1);
            const m = await measure(page, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            clippedTotal += m.clipped.length;
            for (const s of m.clipped) {
              console.log(`    はみ出し: ${s}`);
              problems.push(`${label}: はみ出し ${s}`);
            }
            for (const s of m.small) {
              console.log(`    当たり<44: ${s}`);
              problems.push(`${label}: 当たり<44 ${s}`);
            }
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              const slug = p.path === '/' ? 'home' : p.path.slice(1).replace(/\//g, '-');
              await page.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
                fullPage: true,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        for (const c of contexts) await c.close();
      }
    }

    // ── 行き来・テーマ・ログインの手順。--inject-wide / --inject-clip のときは画面の崩れの確かめだけにする
    if (!opts.injectWide && !opts.injectClip) {
      console.log('');
      console.log('行き来 V1〜V6・スクロール S1 / テーマ T2〜T4 / ログイン L1〜L7');
      const flows = await runFlows(browser, base, signedIn);
      for (const [id, ok, detail] of flows) {
        console.log(`  ${pad(id, 4)} ${ok ? 'ok' : 'NG'}${detail ? `  ${detail}` : ''}`);
        if (!ok) problems.push(`${id}: ${detail}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log('');
  console.log(
    `要約: ${states} 状態、横スクロールの最大 ${worstH}px、幅 360 の当たり<44 ${smallTotal} 件、部品のはみ出し ${clippedTotal} 件、外れ ${problems.length} 件`,
  );
  if (opts.shots) console.log(`撮影: ${opts.shots}（コミットしない）`);
  if (problems.length > 0) {
    console.log('NG');
    process.exit(1);
  }
  console.log('ok');
}

/** 例の表の V1〜V6・S1・T2〜T4・L1〜L7 を実ブラウザで流す。[ID, ok, 詳細] の列を返す */
async function runFlows(browser, base, signedIn) {
  const out = [];
  const check = async (id, fn) => {
    try {
      const detail = await fn();
      out.push([id, true, detail ?? '']);
    } catch (e) {
      out.push([id, false, e instanceof Error ? e.message.split('\n')[0] : String(e)]);
    }
  };
  const expectEq = (got, want, what) => {
    if (got !== want)
      throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
  };
  const path = (page) => new URL(page.url()).pathname;

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: signedIn,
  });
  const page = await ctx.newPage();

  await check('V1', async () => {
    await page.goto(`${base}/`);
    await waitReady(page, 'ホーム');
    await page.locator('main .empty a[href="/record"]').click();
    await waitReady(page, '記録する');
    expectEq(path(page), '/record', 'URL');
    return 'ホーム → [記録する] → /record';
  });
  await check('V2', async () => {
    await page.goBack();
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    return '戻る → /';
  });
  await check('V3', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引の一覧');
    await page.reload();
    await waitReady(page, '取引の一覧');
    expectEq(path(page), '/trades', 'URL');
    return '直接開く・再読み込み → 一覧';
  });
  await check('V4', async () => {
    await page.goto(`${base}/trades/no-such-trade`);
    await waitReady(page, '取引の詳細');
    await page.getByText('この取引は見つかりません').waitFor();
    const link = page.locator('main a[href="/trades"]');
    if ((await link.count()) !== 1) throw new Error('一覧へのリンクが 1 つでない');
    await link.click();
    await waitReady(page, '取引の一覧');
    return '「この取引は見つかりません」→ 一覧へ';
  });
  await check('V5', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引の一覧');
    await page.goto(`${base}/no-such-page`);
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    await page.goBack();
    await waitReady(page, '取引の一覧');
    expectEq(path(page), '/trades', '戻った先');
    return '知らない URL → / に置き換え、戻る → /trades';
  });
  await check('S1', async () => {
    await page.goto(`${base}/dev/parts`);
    await waitReady(page, '部品の見本');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY >= 1100);
    const before = await page.evaluate(() => window.scrollY);
    await page.locator('nav a[href="/trades"]').click();
    await waitReady(page, '取引の一覧');
    expectEq(await page.evaluate(() => window.scrollY), 0, '進んだ先のスクロール');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page
      .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before, { timeout: 5000 })
      .catch(() => {});
    const after = await page.evaluate(() => window.scrollY);
    if (Math.abs(after - before) > 2)
      throw new Error(`戻った後のスクロール ${after}px（期待 ${before}px）`);
    return `進む → 先頭（0px）、戻る → 元の位置（${after}px）`;
  });
  await ctx.close();

  await check('V6', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
    });
    const p = await c.newPage();
    let taps = 0;
    try {
      for (const from of PAGES.filter((x) => x.path !== '/login')) {
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
          await p.waitForURL((u) => u.pathname === href, { timeout: 5000 });
          taps++;
        }
      }
    } finally {
      await c.close();
    }
    return `幅 360 の 6 画面 × 4 項目 = ${taps} 回、すべて 1 タップ`;
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
        if (s.includes('取引の一覧')) throw new Error('一覧の中身が一度描かれた');
        return '一覧の URL → /login?next=%2Ftrades、一覧の中身は出ない';
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
        await waitReady(p, '取引の一覧');
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
        await waitReady(p, '取引の一覧');
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
        if (s.includes('設定') || s.includes('取引の一覧'))
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
        .filter({ hasText: 'ログインのサービスにつながりません' })
        .waitFor({ timeout: 30000 });
      if (popup && !popup.isClosed()) await popup.close();
      // 白い画面になっていない（見出しとボタンが残る）
      await waitReady(p, 'ログイン');
      await p.getByRole('button', { name: 'Google でログイン' }).waitFor();
    } finally {
      await c.close();
    }
    return 'エミュレーターに繋がらない → 「ログインのサービスにつながりません」、画面は残る';
  });
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
