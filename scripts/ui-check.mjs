// 画面の検査（`npm run ui:check`。Issue #3 の what 6・AC-6・8・9・10。docs/ui-guidelines.md P6・P7・P8）。
// Chromium（Playwright）で全画面を幅 360 / 390 / 768 / 1440px × ダーク / ライトで開き、横スクロールの量（px）と、
// 幅 360px の押せるものの当たりが 44×44px 未満の件数、折り返さない部品（ボタン・セグメント・バッジなど）の中の
// はみ出しの件数を数値で出す。行き来（例の表 V1〜V6）とテーマ（T2〜T4）も実ブラウザで流す。
// 戻るでスクロールの位置が戻ること（S1）、ログインの門（例の表 L1〜L7）も見る。1 つでも外れれば終了コード 1。CI には入れない（手元で流し、出力の要約を PR に貼る）。
// 記録する画面（Issue #13）は、入力の途中・判定が出た状態（B・危ない勝ち・LC なしの C）・保存の後も同じ幅とテーマで測り、
// 手順 R1〜R5（開いたときの既定・E1 の判定・二度押し・端末に書かない・保存の失敗）を流す。
// 決済明細の読み取り（Issue #15）は、読み取り中・読み取りの後・複数行（時間帯の確かめ）・読み取りの失敗の状態を同じ幅とテーマで
// 測り、手順 R6〜R10（貼り付けとファイル選択で 1 件ずつ・文字の貼り付けで 0 件 / 実物の canvas で描き直した本文の形式・寸法・
// バイト数 / 端末に残さない / 失敗の文言 / E1 を貼って打つ 2・選ぶ 3 で判定と保存）を流す。読み取りの API も偽物（架空の行）で、
// 実際の AI は呼ばない。画像はページの中の canvas で作るか、合成の明細 tools/statement-eval/synthetic/ を使う。
// 根拠の足のチャート（Issue #12）は、2 枠にチャートがある状態（時間足の欄つき）を同じ幅とテーマで測り、手順 C1〜C3
// （枠を選んで貼る → チャート・枠の外に貼る → 明細 / 貼る → 保存 → 離れるの後に端末の保存先に画像が無い / 2 枚と明細で
// 打つ 2・選ぶ 3 → 1 要求の multipart で保存）を流す。チャートの画像もページの中の canvas で作る（架空）。
// 設定の画面（Issue #5）は、開いた直後（資金・履歴 3 件・銘柄 3 件）・銘柄を直している・誤りと警告・資金が未設定の状態を
// 同じ幅とテーマで測り、手順 SET1〜SET3（資金を保存して記録する画面でリスク 0.5% / 銘柄を直す・誤りは送らない・
// フォーカス / 名前だけで足す・許容リスクの警告と範囲 / 誤り・失敗の後のフォーカス）を流す。セグメントのチェックの記号が
// 文字に重なっていないかも、部品のはみ出しと一緒に数える。
// ログイン済みの文脈の /api は、このスクリプトの中の偽の記録の API（記憶の中だけ・架空の値）に置き換える
// （Flask と Firestore のエミュレーターを立てなくてよい。本物の API の経路は Issue #13 の手での確かめで見る）。
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

// ── 偽の記録の API（記憶の中だけ。値はすべて架空。形は api/src/loss_note_api/routes.py に合わせる） ──
const FAKE_US30 = {
  id: 'inst-us30',
  name: 'US30',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: null,
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

/** 前に記録した架空の取引（開いたときの既定 R1 の確かめ: 銘柄 US30・数量 2） */
function fakeTrade(id, instrumentId, quantity, createdAt) {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: null,
      riskTolerancePct: 1,
    },
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId,
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity }],
      exit: {
        time: createdAt,
        price: 99.5,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      fees: [],
    },
  };
}

// ── 偽の読み取りの応答の行（Issue #15 の例の表。値は架空。形は normalize_row と同じ 12 の鍵） ──
const pad2 = (n) => String(n).padStart(2, '0');
function jstTime(y, mo, d, h, mi) {
  const written = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
  return {
    written,
    timeZone: 'JST',
    jst: written,
    epochMs: Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600000,
  };
}
const READ_E1 = {
  symbol: '架空指数A',
  side: 'L',
  entryPrice: 100,
  exitPrice: 99,
  quantity: 2,
  pnlYen: -2000,
  entryTime: jstTime(2026, 11, 10, 9, 5),
  exitTime: jstTime(2026, 11, 10, 10, 30),
  timeZoneNeedsCheck: false,
  fees: [100, 50],
  feesTotalYen: 150,
  exitOrderType: 'unknown',
};
/** 3 行。行 1 は決済の時刻の時間帯が明細に無い（E9 + E10） */
const READ_E10 = [
  {
    ...READ_E1,
    entryTime: null,
    exitTime: { written: '2026-11-10T10:30', timeZone: 'unknown', jst: null, epochMs: null },
    timeZoneNeedsCheck: true,
  },
  { ...READ_E1, symbol: '架空指数C', side: 'S', entryPrice: 200, exitPrice: 201.5, quantity: 1 },
  { ...READ_E1, symbol: '架空指数D', entryPrice: 50, exitPrice: 51, quantity: 3, pnlYen: 3000 },
];
const SYNTHETIC_STATEMENT = 'tools/statement-eval/synthetic/s05.png';

/**
 * 文脈の /api/** を偽の記録の API に置き換える。opts.capitalYen（資金）、opts.failTrades（POST /api/trades の状態）、
 * opts.delayMs（POST /api/trades を待たせる）。返す api.posts で保存の要求を数える。
 * 設定（Issue #5）: api.settings は書き換えてよい（PUT /api/settings で変わる。資金が変わったときだけ履歴に足す）。
 * PUT /api/instruments/<id> は本文に無い欄を既定に戻し、名前が自分以外と同じなら 409。設定・銘柄の書き込みは api.writes に残す
 * POST /api/statement-reads は api.read（{ status, rows, holdMs }。後から書き換えてよい）で答え、要求の
 * Content-Type と本文のバイト列を api.reads に残す（このスクリプトの記憶の中だけ）
 */
async function installFakeApi(context, opts = {}) {
  const api = {
    instruments: [FAKE_US30],
    trades: [fakeTrade('t-last', FAKE_US30.id, 2, 1700000100000)],
    posts: [],
    chartPosts: [],
    read: { status: 200, rows: [READ_E1], holdMs: 0 },
    reads: [],
    settings: {
      capitalYen: opts.capitalYen ?? null,
      riskTolerancePct: 1,
      performanceUnit: 'R',
      capitalHistory: [],
    },
    writes: [],
  };
  let seq = 0;
  let clock = 1800000000000;
  const settings = () => api.settings;
  /** 名前の同一視（API の name_key と同じ） */
  const nameKey = (n) => n.normalize('NFKC').toUpperCase().toLowerCase().trim();
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    if (key === 'POST /api/statement-reads') {
      api.reads.push({
        contentType: req.headers()['content-type'] ?? '',
        body: req.postDataBuffer() ?? Buffer.alloc(0),
      });
      const r = api.read;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        return await json(
          route,
          r.status,
          r.status === 200
            ? { kind: 'statement', rows: r.rows }
            : { error: 'read_unavailable', detail: 'SECRET-本文' },
        );
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    // 取引の作成の multipart（#12）: 部分 record（JSON の文字）+ entryChart / exitChart（画像）
    const ctype = req.headers()['content-type'] ?? '';
    let body;
    let chartParts = null;
    if (ctype.startsWith('multipart/form-data')) {
      const fd = await new Response(req.postDataBuffer(), {
        headers: { 'Content-Type': ctype },
      }).formData();
      body = JSON.parse(String(fd.get('record')));
      chartParts = {};
      for (const slot of ['entry', 'exit']) {
        const f = fd.get(`${slot}Chart`);
        if (f && typeof f !== 'string') {
          chartParts[slot] = { type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
        }
      }
      api.chartPosts.push({ parts: [...fd.keys()], charts: chartParts });
    } else {
      body = req.postData() ? JSON.parse(req.postData()) : undefined;
    }
    if (key === 'GET /api/trades') return json(route, 200, { items: api.trades });
    if (key === 'GET /api/instruments') return json(route, 200, { items: api.instruments });
    if (key === 'GET /api/settings') return json(route, 200, settings());
    if (key === 'POST /api/instruments') {
      api.writes.push({ key, body });
      if (api.instruments.some((i) => nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const inst = {
        id: `inst-${++seq}`,
        name: body.name.trim(),
        underlyingKind: 'other',
        productForm: 'spotCfd',
        priceCurrency: null,
        multiplier: 1,
        quantityStep: 1,
        createdAt: clock,
        updatedAt: clock,
      };
      api.instruments.push(inst);
      return json(route, 201, inst);
    }
    if (key === 'PUT /api/settings') {
      api.writes.push({ key, body });
      if (opts.failSettings) return json(route, opts.failSettings, { error: 'unavailable' });
      const cap = body.capitalYen;
      const risk = body.riskTolerancePct;
      if (
        !(cap === null || (typeof cap === 'number' && cap > 0)) ||
        !(typeof risk === 'number' && risk >= 0.5 && risk <= 3) ||
        !['R', 'yen'].includes(body.performanceUnit)
      ) {
        return json(route, 400, { error: 'invalid' });
      }
      clock += 1;
      const cur = api.settings;
      api.settings = {
        capitalYen: cap,
        riskTolerancePct: risk,
        performanceUnit: body.performanceUnit,
        capitalHistory:
          cap === cur.capitalYen
            ? cur.capitalHistory
            : [...cur.capitalHistory, { valueYen: cap, at: clock }],
      };
      return json(route, 200, api.settings);
    }
    if (req.method() === 'PUT' && path.startsWith('/api/instruments/')) {
      api.writes.push({ key, body });
      const id = decodeURIComponent(path.slice('/api/instruments/'.length));
      const idx = api.instruments.findIndex((i) => i.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      if (api.instruments.some((i) => i.id !== id && nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const prev = api.instruments[idx];
      const next = {
        id,
        name: body.name.trim(),
        ...(body.underlying === undefined ? {} : { underlying: body.underlying }),
        underlyingKind: body.underlyingKind ?? 'other',
        productForm: body.productForm ?? 'spotCfd',
        priceCurrency: body.priceCurrency ?? null,
        multiplier: body.multiplier ?? 1,
        quantityStep: body.quantityStep ?? 1,
        createdAt: prev.createdAt,
        updatedAt: clock,
      };
      api.instruments[idx] = next;
      return json(route, 200, next);
    }
    if (key === 'POST /api/trades') {
      api.posts.push(body);
      if (opts.delayMs) await new Promise((ok) => setTimeout(ok, opts.delayMs));
      if (opts.failTrades) return json(route, opts.failTrades, { error: 'unavailable' });
      const inst = api.instruments.find((i) => i.id === body.instrumentId);
      if (!inst) return json(route, 400, { error: 'invalid' });
      clock += 1;
      const s = settings();
      const stored = {
        id: `trade-${++seq}`,
        schemaVersion: 1,
        createdAt: clock,
        updatedAt: clock,
        snapshot: {
          instrument: {
            multiplier: inst.multiplier,
            quantityStep: inst.quantityStep,
            priceCurrency: inst.priceCurrency,
            underlyingKind: inst.underlyingKind,
            productForm: inst.productForm,
          },
          capitalYen: s.capitalYen,
          riskTolerancePct: s.riskTolerancePct,
        },
        record: body,
        ...(chartParts && Object.keys(chartParts).length > 0
          ? {
              charts: Object.fromEntries(
                Object.entries(chartParts).map(([k, v]) => [
                  k,
                  { contentType: v.type, size: v.bytes.length },
                ]),
              ),
            }
          : {}),
      };
      api.trades.push(stored);
      return json(route, 201, stored);
    }
    if (key === 'GET /api/health') return json(route, 200, { status: 'ok' });
    return json(route, 404, { error: 'not_found' });
  });
  return api;
}

/** 記録する画面を開き、入力の欄が出るまで待つ */
async function openRecord(page, base) {
  await page.goto(`${base}/record`);
  await waitReady(page, '記録する');
  await page.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
}

const seg = (page, group, text) =>
  page.locator(`[role="radiogroup"][aria-label="${group}"] label.seg__item`, { hasText: text });

/** 記録する画面の例（Issue #13 の例の表。値は架空）。taps = false なら 3 つのタップの前で止める */
async function fillRecord(page, ex, taps = true) {
  await page.locator('#record-instrument').fill('US30');
  await seg(page, 'L / S', ex.side === 'S' ? 'S ショート' : 'L ロング').click();
  await page.locator('#record-entry').fill(ex.entry);
  await page.locator('#record-exit').fill(ex.exit);
  await page.locator('#record-quantity').fill('10000');
  if (ex.lc === 'none') await page.locator('button.lcnone').click();
  else await page.locator('#record-lc').fill(ex.lc);
  if (!taps) return;
  if (ex.lc !== 'none') {
    await seg(
      page,
      'LC を入る前に決めていたか',
      ex.decided ? '決めていた' : '決めていない',
    ).click();
    await seg(page, 'LC を動かしたか', ex.move).click();
    if (ex.after) await page.locator('#record-lc-after').fill(ex.after);
  }
  await seg(page, '時間足を変えたか', '変えず').click();
}

const EX_E1 = {
  side: 'L',
  entry: '100.00',
  exit: '99.20',
  lc: '99.50',
  decided: true,
  move: '下げた',
  after: '99.20',
};
const EX_E3 = {
  side: 'L',
  entry: '100.00',
  exit: '100.75',
  lc: '99.50',
  decided: false,
  move: 'そのまま',
};
const EX_E16 = { side: 'L', entry: '100.00', exit: '99.20', lc: 'none' };

/**
 * ページの中の canvas で架空の明細らしい画像を作る（白地・罫線・数字の行。noise = true なら一部に細かい模様を足して
 * PNG を大きくする）。to = 'paste' なら画面の document に画像の貼り付けを送り、'bytes' ならバイト列を返す
 */
async function makeImage(page, spec, to) {
  return page.evaluate(
    async ({ s, to }) => {
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      const g = c.getContext('2d');
      g.fillStyle = 'white';
      g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = 'black';
      g.font = `${Math.round(s.h / 24)}px sans-serif`;
      let seed = 15;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 1; i < 20; i++) {
        const y = Math.round((s.h / 20) * i);
        g.fillRect(0, y, s.w, 1);
        g.fillText(`架空指数A  L  100.0  99.0  2  -2,000  ${i}`, 10, y - 4);
      }
      if (s.noise) {
        const band = g.getImageData(0, 0, s.w, Math.round(s.h / 6));
        for (let i = 0; i < band.data.length; i += 4) {
          const v = Math.round(rnd() * 255);
          band.data[i] = v;
          band.data[i + 1] = 255 - v;
          band.data[i + 2] = (v * 7) & 255;
        }
        g.putImageData(band, 0, 0);
      }
      const blob = await new Promise((ok) => c.toBlob(ok, s.type, s.quality));
      if (to === 'paste') {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'statement', { type: s.type }));
        document.body.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return blob.size;
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { s: spec, to },
  );
}

const STATEMENT_SPEC = { w: 1200, h: 600, type: 'image/png' };

/** チャートの画像に付ける架空のファイル名（端末の保存先・URL に出ていないかを探す印） */
const CHART_MARKER = 'CHARTMARK-9d3f';

/**
 * ページの中の canvas で架空のローソク足のチャートを作る。to = 'paste' なら target（CSS selector。無ければ今フォーカスの
 * ある要素）に画像の貼り付けを送り、'bytes' ならバイト列を返す。ブラウザはフォーカスのある要素に paste を送る（枠を選んで貼る）
 */
async function makeChart(page, to, target = null) {
  return page.evaluate(
    async ({ to, target, marker }) => {
      const w = 1280;
      const h = 720;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#10141c';
      g.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      let price = h / 2;
      for (let i = 0; i < 60; i++) {
        const o = price;
        price += (rnd() - 0.5) * 40;
        const hi = Math.min(o, price) - rnd() * 20;
        const lo = Math.max(o, price) + rnd() * 20;
        const x = 20 + i * 20;
        g.fillStyle = price < o ? '#2ec5a0' : '#ff8fa0';
        g.fillRect(x + 6, hi, 2, lo - hi);
        g.fillRect(x, Math.min(o, price), 14, Math.max(2, Math.abs(price - o)));
      }
      g.fillStyle = '#a8b0bf';
      g.fillRect(0, h * 0.62, w, 1);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      if (to === 'paste') {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], `${marker}.png`, { type: 'image/png' }));
        const el = target ? document.querySelector(target) : document.activeElement;
        (el ?? document.body).dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return blob.size;
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { to, target, marker: CHART_MARKER },
  );
}

/** 枠を選んで（クリックでフォーカスして）チャートを貼り、プレビューが出るまで待つ */
async function pasteChart(page, slot) {
  const frame = page.locator(`#record-chart-${slot}`);
  await frame.locator('.chart__hint').click();
  await makeChart(page, 'paste');
  await frame.locator('canvas.chart__preview').waitFor({ timeout: 10000 });
}

/** 本文の形式と寸法（PNG の IHDR・JPEG の SOF。読めなければ null。image.py の image_info と同じ規則） */
function imageInfoOf(b) {
  if (b.length >= 24 && b[0] === 0x89 && b.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      while (i < b.length && b[i] === 0xff) i++;
      const m = b[i++];
      if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) continue;
      if (m === 0xd9 || m === 0xda || i + 2 > b.length) return null;
      const len = b.readUInt16BE(i);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'image/jpeg', w: b.readUInt16BE(i + 5), h: b.readUInt16BE(i + 3) };
      }
      i += len;
    }
  }
  return null;
}

/** 記録する画面の状態（幅 × テーマで測る）。fn は開いた画面をその状態にする（api は偽の API。読み取りの応答を決める） */
const RECORD_STATES = [
  { slug: 'record-1-open', name: '開いた直後', fn: async () => {} },
  { slug: 'record-2-typing', name: '入力の途中', fn: (p) => fillRecord(p, EX_E1, false) },
  {
    slug: 'record-3-judged-b',
    name: '判定 B',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
    },
  },
  {
    slug: 'record-4-risky-win',
    name: '危ない勝ち',
    fn: async (p) => {
      await fillRecord(p, EX_E3);
      await p.locator('.verdict .badge', { hasText: '危ない勝ち' }).waitFor();
    },
  },
  {
    slug: 'record-5-no-lc-c',
    name: 'LC なしの C',
    fn: async (p) => {
      await fillRecord(p, EX_E16);
      await p.locator('.verdict .badge', { hasText: 'C 極悪な損失' }).waitFor();
    },
  },
  {
    slug: 'record-6-saved',
    name: '保存の後',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor();
    },
  },
  {
    slug: 'record-7-reading',
    name: '明細の読み取り中',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('status').filter({ hasText: '明細を読み取っています' }).waitFor();
      await p.locator('canvas.statement__preview').waitFor();
    },
  },
  {
    slug: 'record-8-read',
    name: '読み取りの後',
    // 撮るのは印のついた「取引」の欄（枠のプレビューは record-9 で撮る）
    anchor: 'section[aria-labelledby="record-trade-title"]',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor();
    },
  },
  {
    slug: 'record-9-rows',
    name: '複数行・時間帯',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.statement__row', { hasText: '1 / 3 行目' }).waitFor();
      await p.getByRole('button', { name: '日本時間で合っている' }).waitFor();
    },
  },
  {
    slug: 'record-11-tall',
    name: '縦長のスクショ',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      // スマホの縦長のスクショ（1080 × 2340）。描き直すと 923 × 2000
      await makeImage(p, { w: 1080, h: 2340, type: 'image/png' }, 'paste');
      await p.locator('.field__mark').first().waitFor();
      // プレビューが枠に収まり、縦横比を保つ（縦に潰れない。レビュー指摘 8）
      const box = await p.evaluate(() => {
        const c = document.querySelector('canvas.statement__preview');
        const r = c.getBoundingClientRect();
        const parent = c.parentElement.getBoundingClientRect();
        return { w: r.width, h: r.height, aw: c.width, ah: c.height, pw: parent.width };
      });
      if (box.w > box.pw + 0.5) throw new Error(`プレビューが枠より広い ${box.w}px`);
      if (box.h > 320.5) throw new Error(`プレビューが高すぎる ${box.h}px`);
      if (Math.abs(box.w / box.h - box.aw / box.ah) > 0.02)
        throw new Error(`プレビューの縦横比 ${box.w}×${box.h}（画像 ${box.aw}×${box.ah}）`);
    },
  },
  {
    slug: 'record-12-charts',
    name: 'チャートあり',
    anchor: '.charts',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('#record-chart-entry-tf').selectOption('4h');
      await p.locator('#record-chart-exit-tf').selectOption('1d');
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // 枠を選んだ状態（輪と「ここに貼れます」）を撮る
      await p.locator('#record-chart-exit .chart__hint').click();
    },
  },
  {
    slug: 'record-10-read-failed',
    name: '読み取りの失敗',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 503, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('alert').filter({ hasText: '今は読み取りを使えません' }).waitFor();
    },
  },
];

// ── 設定の画面（Issue #5 の E16）。値はすべて架空 ──
const FAKE_N225 = {
  ...FAKE_US30,
  id: 'inst-n225',
  name: '日経225',
  underlying: '架空指数',
  priceCurrency: 'JPY',
};
const FAKE_XAU = {
  ...FAKE_US30,
  id: 'inst-xau',
  name: 'XAU',
  underlyingKind: 'commodity',
  priceCurrency: 'USD',
  multiplier: 100,
  quantityStep: 0.01,
};
/** 自動で足されたままの銘柄（仮の値） */
const FAKE_US30_AUTO = { ...FAKE_US30, underlyingKind: 'other' };

/** 資金 1,000,000円（履歴 3 件）・銘柄 3 件にする */
function seedSettings(api) {
  api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO, FAKE_N225, FAKE_XAU);
  api.settings = {
    capitalYen: 1000000,
    riskTolerancePct: 1,
    performanceUnit: 'R',
    capitalHistory: [
      { valueYen: 800000, at: 1799000000000 },
      { valueYen: 1200000, at: 1799500000000 },
      { valueYen: 1000000, at: 1799900000000 },
    ],
  };
}

/** 設定の画面を開き、資金の欄が出るまで待つ */
async function openSettings(page, base) {
  await page.goto(`${base}/settings`);
  await waitReady(page, '設定');
  await page.locator('#settings-capital').waitFor({ state: 'visible', timeout: 15000 });
}

/** 設定の画面の状態（幅 × テーマで測る）。prep は開く前に偽の API を整え、fn は開いた画面をその状態にする */
const SETTINGS_STATES = [
  {
    slug: 'settings-1-open',
    name: '開いた直後',
    prep: seedSettings,
    fn: async () => {},
  },
  {
    slug: 'settings-2-editing',
    name: '銘柄を直している',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を直す' }).click();
      await p.locator('#settings-inst-name').waitFor();
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('USD');
    },
  },
  {
    slug: 'settings-3-errors',
    name: '誤りと警告',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('#settings-capital').fill('1000.5');
      await p.locator('#settings-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
      await p.getByRole('button', { name: 'US30 を直す' }).click();
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-currency').fill('US');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.getByText('同じ名前の銘柄があります').waitFor();
    },
  },
  {
    slug: 'settings-4-unset',
    name: '資金が未設定',
    prep: (api) => {
      api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO);
    },
    fn: async (p) => {
      await p.getByText('資金を設定すると、記録した取引にリスク（%）が出ます').waitFor();
    },
  },
];

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
        '.seg__item, .btn, .badge, .appnav__link, .envchip, .lcnone, .pagehead__title',
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
      // 重なり: セグメントの選んだ項目のチェックの記号が、項目の文字に重なる（#5 のレビュー指摘 2）
      for (const mark of document.querySelectorAll('.seg__item .seg__check')) {
        const item = mark.closest('.seg__item');
        if (!item || item.closest('[data-ui-check-wide]')) continue;
        // 畳んだ欄（<details>）の中など、描かれていないものは見ない
        if (typeof mark.checkVisibility === 'function' && !mark.checkVisibility()) continue;
        const label = [...item.children].find((c) => c.tagName === 'SPAN');
        if (!label) continue;
        const range = document.createRange();
        range.selectNodeContents(label);
        const t = range.getBoundingClientRect();
        const m = mark.getBoundingClientRect();
        if (t.width === 0 || m.width === 0) continue;
        const overlap =
          Math.min(t.right, m.right) - Math.max(t.left, m.left) > 0.5 &&
          Math.min(t.bottom, m.bottom) - Math.max(t.top, m.top) > 0.5;
        if (overlap) clipped.push(`seg__check「${(label.textContent || '').trim()}」 文字に重なる`);
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
        let recApi;
        for (const forLoginPage of [false, true]) {
          const context = await browser.newContext({
            viewport: { width: w, height: hgt },
            reducedMotion: 'reduce',
            // ログイン画面だけはログインしていない文脈で開く（ログイン済みは戻り先へ置き換わる）
            ...(forLoginPage ? {} : { storageState: signedIn }),
          });
          contexts.push(context);
          await setupContext(context, theme);
          if (!forLoginPage) recApi = await installFakeApi(context);
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
        // 記録する画面の状態（Issue #13）
        const recPage = pageFor.get(false);
        for (const st of RECORD_STATES) {
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`/record（${st.name}）`, 22)}`;
          try {
            await openRecord(recPage, base);
            await st.fn(recPage, recApi);
            const m = await measure(recPage, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              // 判定の枠（明細の状態は明細の枠）を上の帯のすぐ下に寄せて、見える範囲を撮る
              // （全体を撮ると貼り付けた帯・ボタンが途中に重なる）
              await recPage.evaluate((sel) => {
                const v = document.querySelector(sel);
                if (v) window.scrollTo(0, v.getBoundingClientRect().top + window.scrollY - 76);
              }, st.anchor ?? '.verdict');
              await recPage.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${st.slug}.png`),
                fullPage: st.slug === 'record-1-open',
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        // 設定の画面の状態（Issue #5 の E16）。状態ごとに偽の API の設定・銘柄を元に戻してから開く
        for (const st of SETTINGS_STATES) {
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`/settings（${st.name}）`, 22)}`;
          try {
            recApi.instruments.splice(0, recApi.instruments.length, FAKE_US30);
            recApi.settings = {
              capitalYen: null,
              riskTolerancePct: 1,
              performanceUnit: 'R',
              capitalHistory: [],
            };
            st.prep(recApi);
            await openSettings(recPage, base);
            await st.fn(recPage, recApi);
            const m = await measure(recPage, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await recPage.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${st.slug}.png`),
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
      console.log(
        '行き来 V1〜V6・スクロール S1 / テーマ T2〜T4 / ログイン L1〜L7 / 記録する R1〜R5 / 明細の読み取り R6〜R10 / 設定 SET1〜SET4',
      );
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

/** 読み取りの後に手で入れる 5 つ（打つ: LC・一言 / 選ぶ: 決めていた・そのまま・変えず）。数を返す */
async function fillStatementTaps(page, lc = '99.0') {
  await page.locator('#record-lc').fill(lc);
  await page.locator('#record-broken').fill('押し目の安値を割ったら');
  await seg(page, 'LC を入る前に決めていたか', '決めていた').click();
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', '変えず').click();
  return { typed: 2, chosen: 3 };
}

/** 非同期の条件が成り立つまで待つ（5 秒で外れ） */
async function expectPollAsync(cond, what) {
  for (let i = 0; i < 50; i++) {
    if (await cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
}

/** 条件が成り立つまで待つ（10 秒で外れ） */
async function expectPoll(cond, what) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
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
  await installFakeApi(ctx);
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
    await installFakeApi(c);
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

  // ── 記録する（R1〜R5。Issue #13）。偽の記録の API で流す
  const recordContext = async (fakeOpts) => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    const fake = await installFakeApi(c, fakeOpts);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    return { c, p, fake, errors };
  };

  await check('R1', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await openRecord(p, base);
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      const t = await p.locator('#record-exit-time').inputValue();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`決済の時刻 ${t}`);
      for (const g of [
        'L / S',
        'LC を入る前に決めていたか',
        'LC を動かしたか',
        '時間足を変えたか',
      ]) {
        const n = await p.locator(`[role="radiogroup"][aria-label="${g}"] input:checked`).count();
        expectEq(n, 0, `${g} の選択`);
      }
      expectEq(
        await p.locator('button[type="submit"]').isDisabled(),
        true,
        '[記録する] が押せない',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '開いた → 銘柄 US30・数量 2・決済の時刻 = 今、L / S とタップは未選択、[記録する] は押せない';
  });

  await check('R2', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      // タップの前でも R は出る
      await p.locator('.verdict .num--xl', { hasText: '−1.6R' }).waitFor({ timeout: 5000 });
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      const reasons = await p.locator('.reasons__item').allInnerTexts();
      if (!reasons.includes('LC を下げた（99.5 → 99.2）'))
        throw new Error(`理由 ${reasons.join(' / ')}`);
      await p.getByText('資金を設定すると出ます').waitFor();
      expectEq(await p.locator('button[type="submit"]').isDisabled(), false, '[記録する] が押せる');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E1 → B・「LC を下げた（99.5 → 99.2）」・−1.6R・「資金を設定すると出ます」';
  });

  await check('R3', async () => {
    const { c, p, fake } = await recordContext({ delayMs: 400 });
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').dblclick();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.posts.length, 1, 'POST /api/trades の数');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      await p.locator('#record-entry').waitFor();
      expectEq(await p.locator('#record-entry').inputValue(), '', '次の取引のイン');
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', '次の取引の銘柄');
    } finally {
      await c.close();
    }
    return '[記録する] を素早く 2 回 → 保存の要求は 1 件、[次の取引を記録] で空の入力';
  });

  await check('R4', async () => {
    const { c, p } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      await fillRecord(p, EX_E1);
      await p.locator('#record-broken').fill('架空の崩れの条件');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      const after = await snap();
      expectEq(JSON.stringify(after.ls), JSON.stringify(before.ls), 'localStorage のキー');
      expectEq(JSON.stringify(after.ss), JSON.stringify(before.ss), 'sessionStorage のキー');
      expectEq(JSON.stringify(after.idb), JSON.stringify(before.idb), 'IndexedDB の名前');
      for (const v of ['99.2', '架空の崩れの条件']) {
        if (after.values.includes(v)) throw new Error(`Web Storage に ${v}`);
      }
    } finally {
      await c.close();
    }
    return '入力・保存の前後で Web Storage のキーと IndexedDB の名前が増えず、取引の値も無い';
  });

  await check('R5', async () => {
    const { c, p, errors } = await recordContext({ failTrades: 503 });
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p
        .getByRole('alert')
        .filter({ hasText: '保存できませんでした。入力はそのまま残っています。' })
        .waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-entry').inputValue(), '100.00', '入力が残る');
      const body = (await p.locator('main').textContent()) ?? '';
      if (body.includes('unavailable')) throw new Error('応答の本文が画面に出た');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '503 → 決まった文言、入力は残る、応答の本文は出ない';
  });

  // ── 決済明細の読み取り（R6〜R10。Issue #15）。偽の読み取りの API で流す（実際の AI は呼ばない）
  const synthetic = readFileSync(join(ROOT, SYNTHETIC_STATEMENT));

  await check('R6', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await openRecord(p, base);
      // 画像の貼り付け 1 回 → 1 件
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 1, '貼り付けの後の要求');
      // ファイル選択 1 回 → 1 件（合成の明細の画像）
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 's05.png', mimeType: 'image/png', buffer: synthetic });
      await expectPoll(() => fake.reads.length === 2, 'ファイル選択の後の要求');
      // E14: LC の欄にフォーカスして文字「99.0」を貼る → 要求は増えず、LC に入る
      await p.evaluate(() => navigator.clipboard.writeText('99.0'));
      await p.locator('#record-lc').fill('');
      await p.locator('#record-lc').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await p.waitForTimeout(300);
      expectEq(await p.locator('#record-lc').inputValue(), '99.0', 'LC の欄');
      expectEq(fake.reads.length, 2, '文字の貼り付けの後の要求');
      // 表計算のコピーのように文字と画像の両方を持つクリップボードを LC の欄に貼る → 横取りせず文字が入る（レビュー指摘 1）
      await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 20;
        c.getContext('2d').fillRect(0, 0, 10, 10);
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob(['98.5'], { type: 'text/plain' }),
            'image/png': png,
          }),
        ]);
      });
      await p.locator('#record-lc').fill('');
      await p.locator('#record-lc').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await p.waitForTimeout(300);
      expectEq(await p.locator('#record-lc').inputValue(), '98.5', '文字と画像を貼った LC の欄');
      // 合成の貼り付けでも同じ（文字の欄では preventDefault しない）
      const prevented = await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 20;
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        const dt = new DataTransfer();
        dt.setData('text/plain', '98.5');
        dt.items.add(new File([png], 'cells.png', { type: 'image/png' }));
        const ev = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        document.getElementById('record-lc').dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      expectEq(prevented, false, '文字の欄の貼り付けを横取りした');
      await p.waitForTimeout(300);
      expectEq(fake.reads.length, 2, '文字と画像の貼り付けの後の要求');
      // 文字の欄でもクリップボードが画像だけなら明細として受ける（再レビューの指摘 1）
      await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 600;
        c.height = 300;
        const g = c.getContext('2d');
        g.fillStyle = 'white';
        g.fillRect(0, 0, 600, 300);
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      });
      await p.locator('#record-instrument').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await expectPoll(() => fake.reads.length === 3, '銘柄の欄に画像だけを貼った後の要求');
      // E12: 画像として読めないファイル → 要求 0 件・決まった文言
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('架空の文字') });
      await p
        .getByRole('alert')
        .filter({ hasText: '画像を読み込めませんでした' })
        .waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 3, '読めないファイルの後の要求');
      for (const r of fake.reads) {
        if (!['image/png', 'image/jpeg'].includes(r.contentType))
          throw new Error(`Content-Type ${r.contentType}`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '画像の貼り付け 1 件・ファイル選択 1 件・LC の欄への文字の貼り付け 0 件（LC に 99.0）・文字と画像の貼り付けも 0 件（LC に 98.5）・銘柄の欄に画像だけを貼ると 1 件・読めないファイル 0 件';
  });

  await check('R7', async () => {
    const { c, p, fake } = await recordContext();
    const sizes = [];
    try {
      await openRecord(p, base);
      const cases = [
        { name: 'E2', spec: { w: 3000, h: 1500, type: 'image/png', noise: true }, ratio: 2 },
        { name: 'E3', spec: { w: 1200, h: 800, type: 'image/jpeg', quality: 0.9 }, ratio: 1.5 },
      ];
      for (const k of cases) {
        const src = Buffer.from(await makeImage(p, k.spec, 'bytes'));
        const before = fake.reads.length;
        await p
          .locator('#record-statement-file')
          .setInputFiles({ name: `${k.name}.img`, mimeType: k.spec.type, buffer: src });
        await expectPoll(() => fake.reads.length === before + 1, `${k.name} の要求`);
        const sent = fake.reads[before];
        const info = imageInfoOf(sent.body);
        if (!info) throw new Error(`${k.name}: 本文の形式が読めない`);
        if (info.type !== sent.contentType)
          throw new Error(`${k.name}: 形式と Content-Type が違う`);
        if (sent.body.length > 500000) throw new Error(`${k.name}: ${sent.body.length} B`);
        if (Math.max(info.w, info.h) > 2000) throw new Error(`${k.name}: ${info.w}×${info.h}`);
        if (Math.abs(info.w / info.h - k.ratio) > 0.01)
          throw new Error(`${k.name}: 縦横比 ${info.w}×${info.h}`);
        if (src.equals(sent.body)) throw new Error(`${k.name}: 元のバイト列のまま送った`);
        sizes.push(
          `${k.name} ${k.spec.w}×${k.spec.h} ${src.length.toLocaleString('en-US')} B → ${info.type.slice(6)} ${info.w}×${info.h} ${sent.body.length.toLocaleString('en-US')} B`,
        );
      }
    } finally {
      await c.close();
    }
    return sizes.join(' / ');
  });

  await check('R8', async () => {
    const { c, p, fake } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          caches: (await caches.keys()).sort(),
          href: location.href,
          state: JSON.stringify(history.state),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      // E1 を貼って保存 → 次の取引 → E10（3 行）を貼って 2 行を保存・1 行を飛ばす
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.statement__row', { hasText: '1 / 3 行目' }).waitFor({ timeout: 10000 });
      await p.getByRole('button', { name: '日本時間で合っている' }).click();
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.locator('.statement__row', { hasText: '2 / 3 行目' }).waitFor({ timeout: 10000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '次の行の番号へのフォーカス（レビュー指摘 3）',
      );
      await p.getByRole('button', { name: 'この行を飛ばす' }).click();
      await p.locator('.statement__row', { hasText: '3 / 3 行目' }).waitFor();
      await p.getByRole('status').filter({ hasText: '次の行（3 / 3）' }).waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '飛ばした後の行の番号へのフォーカス',
      );
      await fillStatementTaps(p, '49');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.posts.length, 3, '保存の要求');
      const after = await snap();
      for (const k of ['ls', 'ss', 'idb', 'caches']) {
        expectEq(JSON.stringify(after[k]), JSON.stringify(before[k]), k);
      }
      expectEq(after.href, before.href, 'URL');
      expectEq(after.state, before.state, '履歴の state');
      for (const v of ['架空指数A', '架空指数D', '押し目の安値']) {
        if (after.values.includes(v)) throw new Error(`Web Storage に ${v}`);
      }
      if (before.caches.length !== 0) throw new Error('Cache Storage が空でない');
    } finally {
      await c.close();
    }
    return 'E1・E10 の流れの前後で Web Storage・IndexedDB・Cache Storage・URL・履歴の state が同じ（保存 3 件）';
  });

  await check('R9', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      await p.locator('#record-lc').fill('99.5');
      const msgs = [];
      for (const [status, want] of [
        [503, '今は読み取りを使えません。手で入れてください。'],
        [400, 'この画像は読み取れません。別の画像を貼るか、手で入れてください。'],
        [502, '読み取れませんでした。もう一度貼るか、手で入れてください。'],
      ]) {
        fake.read = { status, rows: [], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.getByRole('alert').filter({ hasText: want }).waitFor({ timeout: 10000 });
        msgs.push(status);
      }
      fake.read = { status: 200, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p
        .getByRole('alert')
        .filter({ hasText: '決済明細として読めませんでした' })
        .waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', '入力が残る');
      const body = (await p.locator('main').textContent()) ?? '';
      if (body.includes('SECRET') || body.includes('read_unavailable'))
        throw new Error('応答の本文が画面に出た');
      // やめて手で入れる（E13）: 読み取り中にやめ、後で届いた応答で欄が変わらない
      fake.read = { status: 200, rows: [READ_E1], holdMs: 1500 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('button', { name: 'やめて手で入れる' }).click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-instrument',
        'やめた後のフォーカス（レビュー指摘 2）',
      );
      await p.waitForTimeout(2000);
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', 'やめた後の銘柄');
      expectEq(await p.locator('.field__mark').count(), 0, 'やめた後の印');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '503・400・502・0 行 → 決まった文言、入力は残る、本文は出ない。やめた後の応答は捨てる';
  });

  await check('R10', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await openRecord(p, base);
      const t0 = Date.now();
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 's05.png', mimeType: 'image/png', buffer: synthetic });
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-instrument').inputValue(), '架空指数A', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      expectEq(await p.locator('#record-fee').isVisible(), true, '手数料が開かずに見える');
      const typed = await fillStatementTaps(p);
      await p.locator('.verdict .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('.verdict .num--xl', { hasText: '−1.0R' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      const ms = Date.now() - t0;
      const sent = fake.posts[0];
      expectEq(sent.source, 'statement', '出どころ');
      expectEq(JSON.stringify(sent.fees), JSON.stringify([{ amountYen: 150 }]), '手数料');
      expectEq(sent.exit.orderType, 'unknown', '注文の種類');
      expectEq(errors.length, 0, 'ページのエラー');
      return `合成の明細を選ぶ → 打つ ${typed.typed}・選ぶ ${typed.chosen} → A・−1.0R → 保存（自動の操作で ${(ms / 1000).toFixed(1)} 秒）`;
    } finally {
      await c.close();
    }
  });

  // ── 根拠の足のチャート（C1〜C3。Issue #12）。偽の記録の API で流す
  await check('C1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      // エントリー時の枠を選んで貼る → 枠に入り、明細の読み取りの要求は 0
      await p.locator('#record-chart-entry .chart__hint').click();
      expectEq(
        await p.evaluate(() => document.activeElement?.id),
        'record-chart-entry',
        '枠をクリックしたときのフォーカス',
      );
      await makeChart(p, 'paste');
      await p.locator('#record-chart-entry canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 0, '枠に貼った後の明細の読み取りの要求');
      // Tab で決済時の枠へ移って貼る → 決済時の枠に入る
      await p.locator('#record-chart-exit').focus();
      await makeChart(p, 'paste');
      await p.locator('#record-chart-exit canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 0, '2 枚目の後の明細の読み取りの要求');
      // 時間足の欄はチャートのある枠だけ（2 枚あるので 2 つ）。[外す] で欄も消え、フォーカスは枠へ
      expectEq(await p.locator('.chart select').count(), 2, '時間足の欄の数');
      await p.locator('#record-chart-exit-tf').selectOption('1d');
      // レビュー指摘 1: 時間足の欄にフォーカスが残ったまま貼る → 目印（輪・「ここに貼れます」）は出ておらず、
      // チャートは置き換わらず時間足も消えない（明細の読み取りへ。目印と行き先が一致する）
      await p.locator('#record-chart-exit-tf').focus();
      const ringOnSelect = await p.evaluate(
        () => getComputedStyle(document.querySelector('#record-chart-exit .chart__ready')).display,
      );
      expectEq(ringOnSelect, 'none', '時間足の欄にフォーカスがあるときの「ここに貼れます」');
      const exitPreviewBefore = await p.evaluate(
        () => document.querySelector('#record-chart-exit canvas.chart__preview') !== null,
      );
      await makeChart(p, 'paste');
      await expectPoll(() => fake.reads.length === 1, '時間足の欄に貼った後の明細の読み取りの要求');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(exitPreviewBefore, true, '貼る前の決済時のプレビュー');
      expectEq(await p.locator('#record-chart-exit-tf').inputValue(), '1d', '貼った後の時間足');
      expectEq(await p.locator('canvas.chart__preview').count(), 2, '貼った後のチャートの枚数');
      // 枠そのものにフォーカスがあるときは目印が出る
      await p.locator('#record-chart-exit').focus();
      expectEq(
        await p.evaluate(
          () =>
            getComputedStyle(document.querySelector('#record-chart-exit .chart__ready')).display,
        ),
        'block',
        '枠にフォーカスがあるときの「ここに貼れます」',
      );
      await p
        .locator('#record-chart-exit')
        .getByRole('button', { name: '決済時のチャートを外す' })
        .click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-chart-exit',
        '[外す] の後のフォーカス',
      );
      expectEq(await p.locator('.chart select').count(), 1, '外した後の時間足の欄の数');
      // 枠の外（本文）に貼る → 明細の読み取りへ 1 件、チャートの枠は増えない
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await expectPoll(() => fake.reads.length === 2, '枠の外に貼った後の明細の読み取りの要求');
      expectEq(await p.locator('canvas.chart__preview').count(), 1, '枠の外に貼った後のチャート');
      // [チャートを選ぶ]（ファイル）でも決済時の枠に入る
      const bytes = Buffer.from(await makeChart(p, 'bytes'));
      await p
        .locator('#record-chart-exit-file')
        .setInputFiles({ name: `${CHART_MARKER}.png`, mimeType: 'image/png', buffer: bytes });
      await p.locator('#record-chart-exit canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 2, 'ファイルを選んだ後の明細の読み取りの要求');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '枠をクリック / Tab で選んで貼る → その枠（明細の要求 0）・時間足の欄にフォーカスで貼る → 目印なし・明細へ・チャートと時間足は不変・枠の外に貼る → 明細・[チャートを選ぶ] → 枠・[外す] → 欄が消えフォーカスは枠';
  });

  await check('C2', async () => {
    const { c, p, fake } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          caches: (await caches.keys()).sort(),
          href: location.href,
          state: JSON.stringify(history.state),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      await p.getByText('チャート 2 枚も保存しました').waitFor();
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      // もう 1 枚貼ってから一覧へ移る（保存しないチャートは送らない。E12）
      await pasteChart(p, 'entry');
      const postsBefore = fake.chartPosts.length;
      await p.locator(`nav a[href="/trades"]`).first().click();
      await waitReady(p, '取引の一覧');
      expectEq(fake.chartPosts.length, postsBefore, '離れた後のチャートの送信');
      const after = await snap();
      for (const k of ['ls', 'ss', 'idb', 'caches']) {
        expectEq(JSON.stringify(after[k]), JSON.stringify(before[k]), k);
      }
      if (after.ls.some((k) => k !== THEME_KEY)) throw new Error(`localStorage の鍵 ${after.ls}`);
      if (after.ss.length !== 0) throw new Error(`sessionStorage の鍵 ${after.ss}`);
      if (after.caches.length !== 0) throw new Error('Cache Storage が空でない');
      // 送った画像のバイト列の一部（base64・16 進）と印が、端末の保存先の値に無い
      const sent = fake.chartPosts[0]?.charts.entry?.bytes;
      if (!sent) throw new Error('チャートが送られていない');
      const needles = [
        CHART_MARKER,
        sent.subarray(64, 160).toString('base64'),
        sent.subarray(64, 96).toString('hex'),
      ];
      const idbText = await p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        const out = [];
        for (const d of dbs) {
          const db = await new Promise((ok, ng) => {
            const r = indexedDB.open(d.name);
            r.onsuccess = () => ok(r.result);
            r.onerror = () => ng(r.error);
          });
          for (const name of db.objectStoreNames) {
            const all = await new Promise((ok) => {
              const r = db.transaction(name).objectStore(name).getAll();
              r.onsuccess = () => ok(r.result);
              r.onerror = () => ok([]);
            });
            out.push(JSON.stringify(all));
          }
          db.close();
        }
        return out.join('\n');
      });
      for (const n of needles) {
        if (after.values.includes(n)) throw new Error('Web Storage にチャートの画像');
        if (idbText.includes(n)) throw new Error('IndexedDB にチャートの画像');
      }
      if (after.href.includes(CHART_MARKER) || (after.state ?? '').includes(CHART_MARKER))
        throw new Error('URL・履歴にチャート');
    } finally {
      await c.close();
    }
    return '貼る → 保存 → 次の取引で 1 枚 → 一覧へ: Web Storage の鍵はテーマだけ・IndexedDB の名前と Cache Storage は前と同じ・値に画像なし・離れた後の送信 0';
  });

  await check('C3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await openRecord(p, base);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      const typed = await fillStatementTaps(p);
      await p.locator('.verdict .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.chartPosts.length, 1, 'チャートつきの保存の要求');
      expectEq(fake.chartPosts[0].parts.join(','), 'record,entryChart,exitChart', '部分');
      for (const slot of ['entry', 'exit']) {
        const ch = fake.chartPosts[0].charts[slot];
        const info = imageInfoOf(ch.bytes);
        if (!info || info.type !== ch.type) throw new Error(`${slot}: 形式`);
        if (ch.bytes.length > 500000 || Math.max(info.w, info.h) > 2000)
          throw new Error(`${slot}: ${ch.bytes.length} B ${info.w}×${info.h}`);
      }
      expectEq(fake.reads.length, 1, '明細の読み取りの要求');
      expectEq(errors.length, 0, 'ページのエラー');
      return `チャート 2 枚 + 明細 1 枚 → 打つ ${typed.typed}・選ぶ ${typed.chosen} → A → 1 要求（record・entryChart・exitChart）で保存`;
    } finally {
      await c.close();
    }
  });

  // ── 設定（SET1〜SET3。Issue #5）。偽の記録の API で流す
  await check('SET1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      // 円建ての銘柄にしておく（1R・リスク（%）を価格から出せる。5.1）
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      await openSettings(p, base);
      await p.getByText('未設定', { exact: true }).waitFor();
      await p.locator('#settings-capital').fill('1,000,000');
      await p.getByText('1 回の負けは 10,000円 までです').waitFor();
      await p.locator('#settings-form button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '保存しました' }).waitFor({ timeout: 5000 });
      expectEq(fake.settings.capitalYen, 1000000, '保存した資金');
      await p.reload();
      await openSettings(p, base);
      await p.locator('.settings__stat dd', { hasText: '1,000,000円' }).waitFor();
      expectEq(await p.locator('#settings-history li').count(), 1, '履歴の件数');
      expectEq(await p.locator('#settings-capital').inputValue(), '1,000,000', '開き直した欄');
      // 記録する画面で 5.1 の例（L・イン 100.00・LC 99.50・数量 10,000・決済 99.40）→ リスク 0.5%
      await openRecord(p, base);
      await fillRecord(p, {
        side: 'L',
        entry: '100.00',
        exit: '99.40',
        lc: '99.50',
        decided: true,
        move: 'そのまま',
      });
      await p.locator('.verdict .num', { hasText: '0.5%' }).waitFor({ timeout: 5000 });
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '資金 1,000,000 を保存 → 開き直しても 1,000,000円・履歴 1 件 → 記録する画面でリスク 0.5%';
  });

  await check('SET2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base);
      // E9: [直す] → 名前の欄にフォーカス → 株価指数・usd・刻み 0.1 → 保存
      await p.getByRole('button', { name: 'US30 を直す' }).click();
      await p.locator('#settings-inst-name').waitFor();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'settings-inst-name',
        '開いた後のフォーカス',
      );
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('usd');
      await p.locator('#settings-inst-step').fill('0.1');
      await p.locator('form.instedit button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: 'US30 を保存しました' }).waitFor();
      const want = '株価指数 · 現物・CFD · 通貨 USD · 乗数 1 · 刻み 0.1';
      await p.locator('.instlist__item', { hasText: want }).waitFor();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-us30',
        '閉じた後のフォーカス',
      );
      await p.reload();
      await openSettings(p, base);
      await p.locator('.instlist__item', { hasText: want }).waitFor();
      // E10・E11: 重複の名前・乗数 0 → 送らずに欄の誤り
      const before = fake.writes.length;
      await p.getByRole('button', { name: 'XAU を直す' }).click();
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.locator('form.instedit button[type="submit"]').click();
      await p
        .locator('#settings-inst-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
      await p.locator('#settings-inst-multiplier-error').waitFor();
      expectEq(fake.writes.length, before, '誤りのときの書き込み');
      await p.getByRole('button', { name: 'やめる' }).click();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-xau',
        'やめた後のフォーカス',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E9 を直して保存 → 一覧・開き直しても同じ、E10・E11 は送らない、フォーカスは名前の欄 ⇄ [直す]';
  });

  await check('SET3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base);
      // E13: 名前だけで足す
      await p.locator('#settings-new-name').fill('GOLD');
      await p.getByRole('button', { name: '足す', exact: true }).click();
      await p.getByRole('status').filter({ hasText: 'GOLD を足しました' }).waitFor();
      const row = p.locator('.instlist__item', { hasText: 'GOLD' });
      await row.filter({ hasText: '仮の値' }).waitFor();
      await row.filter({ hasText: 'その他 · 現物・CFD · 通貨 未設定 · 乗数 1 · 刻み 1' }).waitFor();
      const post = fake.writes.find((x) => x.key === 'POST /api/instruments');
      expectEq(JSON.stringify(post?.body), JSON.stringify({ name: 'GOLD' }), '足す本文');
      // E7: 許容リスク 2.5 → 警告を出して保存できる
      await p.locator('#settings-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
      await p.locator('#settings-form button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '保存しました' }).waitFor();
      expectEq(fake.settings.riskTolerancePct, 2.5, '保存した許容リスク');
      // E8: 3.1 は送らない
      const before = fake.writes.length;
      await p.locator('#settings-risk').fill('3.1');
      await p.locator('#settings-form button[type="submit"]').click();
      await p.locator('#settings-risk-error').waitFor();
      expectEq(fake.writes.length, before, '範囲外のときの書き込み');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E13 GOLD を名前だけで足す（仮の値・既定の 5 欄）、E7 は警告つきで保存、E8 は送らない';
  });

  await check('SET4', async () => {
    const focused = (p) => p.evaluate(() => document.activeElement?.id ?? '');
    // 誤りのまま [保存] → 最初の誤りの欄へフォーカス、誤りのある欄を role="alert" で知らせる
    {
      const { c, p, fake, errors } = await recordContext({ failSettings: 503 });
      try {
        seedSettings(fake);
        await openSettings(p, base);
        await p.locator('#settings-risk').fill('3.1');
        await p.locator('#settings-capital').fill('0');
        await p.locator('#settings-save').click();
        await p
          .getByRole('alert')
          .filter({ hasText: '誤りのある欄があります（資金・許容リスク）' })
          .waitFor();
        await expectPollAsync(async () => (await focused(p)) === 'settings-capital', '誤りの欄へ');
        // 保存に失敗して戻った → 押した [保存] へ
        await p.locator('#settings-capital').fill('1000000');
        await p.locator('#settings-risk').fill('1');
        await p.locator('#settings-save').click();
        await p.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
        await expectPollAsync(async () => (await focused(p)) === 'settings-save', '[保存] へ');
        // 銘柄: 誤りのまま [保存] → 最初の誤りの欄（価格の通貨）
        await p.getByRole('button', { name: 'US30 を直す' }).click();
        await p.locator('#settings-inst-multiplier').fill('0');
        await p.locator('#settings-inst-currency').fill('US');
        await p.locator('#settings-inst-save').click();
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-inst-currency',
          '銘柄の誤りの欄へ',
        );
        expectEq(errors.length, 0, 'ページのエラー');
      } finally {
        await c.close();
      }
    }
    // 記録する画面: 保存に失敗して戻った → [記録する] へ
    {
      const { c, p, errors } = await recordContext({ failTrades: 503 });
      try {
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('#record-submit').click();
        await p.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
        await expectPollAsync(async () => (await focused(p)) === 'record-submit', '[記録する] へ');
        expectEq(errors.length, 0, 'ページのエラー');
      } finally {
        await c.close();
      }
    }
    return '誤りのまま押す → 最初の誤りの欄・知らせ、保存の失敗 → 押したボタン（設定の [保存]・記録する画面の [記録する]）';
  });

  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
