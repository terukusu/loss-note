import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTH_EMULATOR,
  expectPollAsync,
  measure,
  opts,
  RECORD_OVER_360,
  ROOT,
  settle,
  setupContext,
  TAP,
  THEMES,
  waitReady,
  zoomCss,
} from '../base.mjs';
import {
  ACC_B,
  ACC_ONE,
  ACCOUNTS_2,
  ACCOUNTS_3_LONG,
  CUT_ALLOWED,
  installFakeApi,
  READ_DONE,
  READ_E1,
  READ_E10,
  READ_REAL,
  seedSettings,
  setAccounts,
  TX_LATE,
  waitSaved,
} from '../fixtures.mjs';
import { pagesGroup, recordGroup, zoomPagesGroup, zoomRecordGroup } from '../groups.mjs';
import {
  closeSheets,
  deleteFromDetail,
  EX_E1,
  EX_E3,
  EX_E16,
  EX_S8,
  fillRecord,
  fillStatementTaps,
  makeChart,
  makeImage,
  openChartSheet,
  openEditChartSheet,
  openFields,
  openMore,
  openRecord,
  openVerdict,
  pasteChart,
  STATEMENT_SPEC,
  seg,
  settleSheet,
  toReview,
} from '../helpers.mjs';
import { waitSettingsSheet } from '../settings-states.mjs';

/**
 * 画面の検査の単位「記録する（入力と判定）」: 記録する画面の開いた直後・入力・判定・保存の後と、FOC1・R1〜R5・W1・
 * LN1・LN2・R11〜R14・LM1・LD1・KB1・RS1・LV2
 */
export const id = 'record';
export const title = '記録する（入力と判定）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
  await zoomRecordGroup(vp, id);
}

/** 手順（FOC1・R1・R2・R3・R4・R5・W1・LN1・LN2・R11・R12・LM1・LD1・KB1・R14・RS1・R13・LV2） */
export async function flows(kit) {
  const {
    browser,
    base,
    signedIn,
    check,
    expectEq,
    recordContext,
    lcLockState,
    kbdShim,
    kbdUp,
    kbdDown,
    bodyEndSubmit,
  } = kit;
  // FOC1（#52）: 幅 360 で、外側の枠がフォーカスを示す欄（数・文字・日時の欄 = .numfield の中の入力）と選択（.select）に
  // キーでフォーカスしたとき、内側の要素に共通の輪（outline）が出ず、外側の枠の光（box-shadow）だけが出る
  // （角丸の枠の外に四角い枠がずれて重ならない）。--shots なら LC の欄にフォーカスした状態を撮る
  await check('FOC1', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      await toReview(p);
      const targets = p.locator('.numfield input:not([disabled]), select.select:not([disabled])');
      const n = await targets.count();
      if (n < 3) throw new Error(`欄の数 ${n}`);
      const bad = [];
      let checked = 0;
      let visible = 0;
      for (let i = 0; i < n; i++) {
        const t = targets.nth(i);
        if (!(await t.isVisible())) continue;
        visible++;
        await t.focus();
        // キーで来たフォーカスにする（:focus-visible を確かに当てる）
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Tab');
        const m = await t.evaluate((el) => {
          const cs = getComputedStyle(el);
          const frame = el.closest('.numfield') ?? el;
          // 輪は透明（forced-colors のときだけ見える）。見える輪の色・幅が無いこと
          const invisible =
            cs.outlineStyle === 'none' ||
            cs.outlineWidth === '0px' ||
            cs.outlineColor === 'rgba(0, 0, 0, 0)' ||
            cs.outlineColor === 'transparent';
          return {
            id: el.id || el.tagName,
            focused: document.activeElement === el,
            focusVisible: el.matches(':focus-visible'),
            outline: invisible,
            ring: getComputedStyle(frame).boxShadow !== 'none',
          };
        });
        if (!m.focused) {
          bad.push(`${m.id}: フォーカスが移らない`);
          continue;
        }
        if (!m.focusVisible) bad.push(`${m.id}: :focus-visible が当たらない`);
        if (!m.outline) bad.push(`${m.id}: 内側に見える outline`);
        if (!m.ring) bad.push(`${m.id}: 外側の枠の光が無い`);
        checked++;
      }
      if (checked === 0 || checked !== visible) bad.push(`見た欄 ${checked} / 見える欄 ${visible}`);
      if (bad.length) throw new Error(bad.join(' / '));
      if (opts.shots) {
        await p.locator('#record-lc').focus();
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Tab');
        await p.locator('#record-lc').scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(opts.shots, '360x780-dark-record-focus-viewport.png') });
      }
      expectEq(errors.length, 0, 'ページのエラー');
      return `幅 360: ${checked} 個の欄・選択（:focus-visible）で、内側の見える outline 0・外側の枠の光あり`;
    } finally {
      await c.close();
    }
  });

  await check('R1', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await openRecord(p, base);
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      const t = await p.locator('#record-exit-time').inputValue();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`決済の時刻 ${t}`);
      // 1 段目には ［記録する］ が無い。タップと ［記録する］ は 2 段目（2026-11-21）
      expectEq(await p.locator('button[type="submit"]').count(), 0, '1 段目の [記録する]');
      await toReview(p);
      for (const g of ['L / S', 'LC を動かしたか', '時間足を変えたか']) {
        const n = await p.locator(`[role="radiogroup"][aria-label="${g}"] input:checked`).count();
        expectEq(n, 0, `${g} の選択`);
      }
      // LC を入る前に決めていたかは聞かない（LC の欄から決める。#202）
      expectEq(
        await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
        0,
        '決めていたかの問い',
      );
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
      // タップの前でも R は出る（下の帯の判定の 1 行は判定が出るまで状態の文。判定のシートの中の R を見る。#130）
      await openVerdict(p);
      await p.locator('.verdict .num--xl', { hasText: '−1.6R' }).waitFor({ timeout: 5000 });
      await closeSheets(p);
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      await openVerdict(p);
      const reasons = await p.locator('.reasons__item').allInnerTexts();
      if (!reasons.includes('LC を広げた（99.5 → 99.2）'))
        throw new Error(`理由 ${reasons.join(' / ')}`);
      // 資金が未設定の説明は、理由の一覧から分けた注記の 1 行（Issue #33 AC-8）
      await p
        .locator('.verdict__aside', { hasText: '資金が未設定のため、過剰リスクは判定していません' })
        .waitFor();
      expectEq(await p.locator('button[type="submit"]').isDisabled(), false, '[記録する] が押せる');
      await closeSheets(p);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E1 → B・「LC を広げた（99.5 → 99.2）」・−1.6R・注記「資金が未設定のため、過剰リスクは判定していません」';
  });

  await check('R3', async () => {
    const { c, p, fake } = await recordContext({ delayMs: 400 });
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').dblclick();
      await waitSaved(p, '記録しました');
      expectEq(fake.posts.length, 1, 'POST /api/trades の数');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      // 次の取引は 1 段目「スクショを入れる」から（2026-11-21）
      await p.locator('#record-manual').waitFor();
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
      await waitSaved(p, '記録しました');
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
        .filter({ hasText: '保存できませんでした。入力内容は残っています。' })
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

  // W1（#74 デザインレビューの撮れていなかった状態）: 空の状態（ホーム・一覧）・記録と編集の保存の通信の失敗・削除の失敗の
  // トースト・ログインが切れた一覧・ログインのサービスと通信できない・1440 の用語集の全体を、幅 360 と 1440 のダークで開き、
  // 文言が出ること・横スクロール 0・短いボタン（10 字以下）が 2 行に折れないこと（高さ 56px 以下）を見る。--shots なら全体を撮る
  await check('W1', async () => {
    const seen = [];
    const shortButtonsTall = (p) =>
      p.evaluate(() =>
        [...document.querySelectorAll('button, a.btn')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            const t = (b.textContent ?? '').trim();
            return r.width > 0 && r.height > 0 && t.length > 0 && t.length <= 10;
          })
          .filter((b) => b.getBoundingClientRect().height > 56)
          .map((b) => (b.textContent ?? '').trim()),
      );
    const measure = async (p, w, slug, text) => {
      await p.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
      const h = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (h > 0) throw new Error(`${w} ${slug}: 横スクロール ${h}px`);
      const tall = await shortButtonsTall(p);
      if (tall.length > 0) throw new Error(`${w} ${slug}: 2 行に折れたボタン ${tall.join(' / ')}`);
      if (opts.shots)
        await p.screenshot({
          path: join(opts.shots, `${w}x${w === 360 ? 780 : 900}-dark-w74-${slug}.png`),
          fullPage: true,
        });
      seen.push(`${w}:${slug}`);
    };
    const signedInPage = async (w, fakeOpts) => {
      const c = await browser.newContext({
        viewport: { width: w, height: w === 360 ? 780 : 900 },
        storageState: signedIn,
      });
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c, fakeOpts);
      const p = await c.newPage();
      return { c, p, fake };
    };
    for (const w of [360, 1440]) {
      // 空の状態（ホーム・一覧）
      {
        const { c, p } = await signedInPage(w, { trades: [] });
        try {
          await p.goto(`${base}/`);
          await waitReady(p, 'ホーム');
          await measure(p, w, 'home-empty', '2 つの質問に答えると判定が表示されます');
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await measure(p, w, 'trades-empty', 'まだ取引がありません');
        } finally {
          await c.close();
        }
      }
      // 記録の保存の通信の失敗
      {
        const { c, p } = await signedInPage(w);
        try {
          await openRecord(p, base);
          await fillRecord(p, EX_E1);
          await p.route('**/api/trades', (route) =>
            route.request().method() === 'POST'
              ? route.abort('connectionrefused')
              : route.fallback(),
          );
          await p.locator('button[type="submit"]').click();
          await measure(
            p,
            w,
            'record-network-failed',
            '通信できませんでした。入力内容は残っています。',
          );
        } finally {
          await c.close();
        }
      }
      // 編集の保存の通信の失敗
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.goto(`${base}/trades/x-e1/edit`);
          await waitReady(p, '取引を編集');
          await p.route('**/api/trades/x-e1', (route) =>
            route.request().method() === 'PUT'
              ? route.abort('connectionrefused')
              : route.fallback(),
          );
          await p.locator('#edit-submit').click();
          await measure(
            p,
            w,
            'edit-network-failed',
            '通信できませんでした。入力内容は残っています。',
          );
        } finally {
          await c.close();
        }
      }
      // 削除の失敗のトースト（[削除] → 8 秒後の DELETE が失敗）
      {
        const { c, p } = await signedInPage(w);
        try {
          // keepalive の DELETE はページの route に掛からないので、文脈の route（偽の API より後に足す = 先に当たる）で返す
          await c.route('**/api/trades/x-d1', (route) =>
            route.request().method() === 'DELETE'
              ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
              : route.fallback(),
          );
          await p.goto(`${base}/trades/x-d1`);
          await waitReady(p, 'US30 · L');
          await deleteFromDetail(p);
          // [元に戻す] にフォーカス・ポインタがある間は取り消しの時間が止まるので、外へ出す
          await p.locator('.toast').first().waitFor();
          await p.mouse.move(1, 1);
          await p.evaluate(() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          });
          await p
            .getByText('削除できませんでした', { exact: false })
            .first()
            .waitFor({ timeout: 20000 });
          await measure(
            p,
            w,
            'delete-failed',
            '削除できませんでした。もう一度 [削除] を押してください。',
          );
        } finally {
          await c.close();
        }
      }
      // ログインが切れた（一覧の読み込みが 401）
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.route('**/api/trades**', (route) =>
            route.request().method() === 'GET'
              ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
              : route.fallback(),
          );
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await measure(p, w, 'auth-expired', 'もう一度ログイン');
        } finally {
          await c.close();
        }
      }
      // 用語集の全体
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.goto(`${base}/glossary`);
          await waitReady(p, '用語集');
          await measure(p, w, 'glossary-full', '判定に関わる言葉の意味です。');
        } finally {
          await c.close();
        }
      }
      // ログインのサービスと通信できない（ログインの失敗）
      {
        const c = await browser.newContext({
          viewport: { width: w, height: w === 360 ? 780 : 900 },
        });
        await setupContext(c, 'dark');
        await c.route(`${AUTH_EMULATOR}/**`, (route) => route.abort('connectionrefused'));
        const p = await c.newPage();
        try {
          await p.goto(`${base}/login`);
          await waitReady(p, 'ログイン');
          const popupWait = p.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
          await p.getByRole('button', { name: 'Google でログイン' }).click();
          const popup = await popupWait;
          await p
            .getByRole('alert')
            .filter({ hasText: 'ログインのサービスと通信できませんでした' })
            .waitFor({ timeout: 30000 });
          if (popup && !popup.isClosed()) await popup.close();
          await measure(p, w, 'login-unreachable', 'ログインのサービスと通信できませんでした');
        } finally {
          await c.close();
        }
      }
    }
    return `${seen.length} 状態（空の状態・保存と削除の失敗・ログインが切れた・用語集の全体・ログインの失敗 × 360 / 1440）で文言が出て、横スクロール 0・短いボタンは 1 行`;
  });

  await check('LN1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      fake.read = { status: 200, rows: [READ_E1], holdMs: 2000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      await p.locator('.lcnone').first().click();
      await p.locator(READ_DONE).first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(300);
      const s = await lcLockState(p);
      expectEq(s.none, 'true', '読み取りの後の ［なし］');
      expectEq(s.readOnly, true, '読み取りの後の LC の欄（止めたまま）');
      expectEq(s.disabled, false, 'LC の欄の disabled');
      expectEq(s.value, '', 'LC の欄の値');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '［なし］ → 読み取りの完了 → 「なし」のまま（欄は止めたまま・値は空）';
  });
  await check('LN2', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      storageState: signedIn,
    });
    await installFakeApi(c, { trades: [] });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await openRecord(p, base);
      await toReview(p);
      await p.locator('.lcnone').first().tap();
      const before = await lcLockState(p);
      expectEq(before.none, 'true', '［なし］ を押した後');
      expectEq(before.readOnly, true, '止めた LC の欄');
      const note = await p
        .locator('#record-lc-lock')
        .textContent()
        .catch(() => null);
      expectEq(note, 'なし を選んでいます。押すと価格を入れられます', '読み上げの説明');
      // 押す前の欄の要素を覚え、押した後も同じ要素か（作り直すとフォーカスが外れる。#207）
      await p.evaluate(() => {
        window.__ln2Lc = document.querySelector('#record-lc');
      });
      await p.locator('#record-lc').tap();
      await p.waitForTimeout(150);
      const after = await lcLockState(p);
      expectEq(
        await p.evaluate(() => document.querySelector('#record-lc') === window.__ln2Lc),
        true,
        '欄をタップした後の LC の欄（同じ要素のまま）',
      );
      expectEq(after.none, 'false', '欄をタップした後の ［なし］');
      expectEq(after.readOnly, false, '欄をタップした後の LC の欄');
      expectEq(after.focused, true, 'LC の欄のフォーカス');
      expectEq(after.value, '', 'LC の欄の値');
      await p.keyboard.type('99.5');
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', '打った LC');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '［なし］ → 止めた欄をタップ → 「なし」が外れ、LC の欄にフォーカスして 99.5 を打てる';
  });

  // ── 密度と階層（Issue #33・#130）。R11 = タップの直後に判定の 1 行が見える / R12 = 1 画面に収まる / R13 = 数字の書体と並び
  // R11（#130 で置き換え。ui-guidelines 9.11 の「判定の枠を寄せる」→「判定は下の帯に常に 1 行」）: 最後のタップを押した直後、
  // スクロールの操作をしないで、下の帯の判定の 1 行（バッジと R）が窓の中に見え、押したタップも見えていてフォーカスが残る
  await check('R11', async () => {
    const scenes = [
      ['場面 B', EX_E1, 'B 悪い損失', true],
      // 危ない勝ちは R の代わりに帯の文（#227 AC-8・C59）。R の数字は帯に出さない
      ['場面 危', EX_E3, '危ない勝ち', 'caution'],
      ['場面 C', EX_E16, 'C 極悪な損失', false],
      ['例 8（S・広げた）', EX_S8, 'B 悪い損失', true],
    ];
    const runs = [
      [360, 780, 'dark'],
      [360, 780, 'light'],
      [1440, 900, 'dark'],
      [1440, 900, 'light'],
      [390, 844, 'dark', 'reduce'],
    ];
    let n = 0;
    for (const [w, h, theme, motion] of runs) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
        ...(motion ? { reducedMotion: motion } : {}),
      });
      try {
        await setupContext(c, theme);
        await installFakeApi(c);
        const p = await c.newPage();
        for (const [name, ex, label, withR] of scenes) {
          await openRecord(p, base);
          await fillRecord(p, ex, true, false);
          const last = seg(p, '時間足を変えたか', 'そのまま');
          // 押すタップを下の帯の上に出してから押す（縦の短い窓では帯の裏に隠れることがある）
          await last.evaluate((el) => {
            const bar = document.querySelector('.record__submit')?.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            if (bar && r.bottom > bar.top - 8) window.scrollBy(0, r.bottom - (bar.top - 8));
          });
          await settle(p);
          const y0 = await p.evaluate(() => window.scrollY);
          const box = await last.boundingBox();
          if (!box) throw new Error(`${name}: 最後のタップが描かれていない`);
          await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await p.locator('.vline .badge', { hasText: label }).waitFor({ timeout: 5000 });
          await settle(p);
          const ng = await p.evaluate(
            ({ withR }) => {
              const vh = window.innerHeight;
              const vw = window.innerWidth;
              const out = [];
              const parts = [['バッジ', '.vline .badge']];
              if (withR === true) parts.push(['R', '.vline .num']);
              if (withR === 'caution') {
                parts.push(['帯の文', '.vline__caution']);
                if (document.querySelector('.vline .num'))
                  out.push('危ない勝ちの帯に R の数字がある');
                const t = document.querySelector('.vline__caution')?.textContent ?? '';
                if (t !== 'LC で切っていれば −1.0R') out.push(`帯の文: ${t}`);
                if (document.documentElement.scrollWidth > vw + 0.5) out.push('横スクロール');
              }
              for (const [nm, sel] of parts) {
                const r = document.querySelector(sel)?.getBoundingClientRect();
                if (!r || r.height === 0) out.push(`${nm} が無い`);
                else if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5)
                  out.push(`${nm} ${Math.round(r.top)}〜${Math.round(r.bottom)}px が窓の外`);
              }
              return out;
            },
            { withR },
          );
          if ((await p.evaluate(() => window.scrollY)) !== y0)
            ng.push('押した後に画面がスクロールした（判定は下の帯にあるので寄せない）');
          const kept = await last.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const bar = document.querySelector('.record__submit')?.getBoundingClientRect();
            return {
              seen: r.top >= 0 && (!bar || r.bottom <= bar.top + 0.5),
              focus: el.contains(document.activeElement),
            };
          });
          if (!kept.seen) ng.push('押したタップが見えない（下の帯の裏）');
          if (!kept.focus) ng.push('フォーカスが押したタップから動いた');
          if (opts.shots) {
            await p.screenshot({
              path: join(
                opts.shots,
                `${w}x${h}-${theme}-r11-${ex === EX_E1 ? 'b' : ex === EX_E3 ? 'risky' : ex === EX_E16 ? 'c' : 's8'}.png`,
              ),
            });
          }
          if (ng.length > 0) throw new Error(`${w}x${h} ${theme} ${name}: ${ng.join(' / ')}`);
          n++;
        }
      } finally {
        await c.close();
      }
    }
    return `最後のタップを押した直後、スクロールせずに下の帯の判定の 1 行（バッジと R、危ない勝ちは R の代わりに「LC で切っていれば −1.0R」・横スクロール 0）が窓の中・押したタップも見えてフォーカスは動かない（${n} 件 = 4 場面 × 360 / 1440 × 両テーマ + 390（動きを減らす設定））`;
  });

  // R12（#130 で置き換え。2026-11-21 に 2 段へ。ui-guidelines 9.4・9.10 の「1 画面に収まる」）: 等倍の文字の 390×844 で、
  // 1 段目と 2 段目の 4 つの状態（読み取り中・読み取りの後・手入力・2 行の明細 + 口座 3 つ）とも縦のスクロール 0px（安全域 47 / 34
  // を入れても。#130 の「選ぶ前は 40px まで」は 1 段目が LC 以下を持たなくなったので 0px に締めた）。2 段目は LC・チャートの注意・
  // 判定の 1 行・[記録する]・3 つ目のタップ、1 段目は 2 つの注意・［スクショを選ぶ］・［明細なしで手入力］ が窓の中。
  // 読み取り中 → 読み取りの後で LC の欄の上端が動かない（流れ込むだけ）。送る前の注意は 1 段目に 3 行以下で畳まない。
  // 360×780 は縦のスクロール 120px 以下（全長の上限 R12 の置き換え）。口座 2・3 の形も 360×780 で 120px 以下。
  // 2 行の明細の 1 行目を記録した後（名前の上の 1 行の知らせが 2 行に折れる。#180）も 390×844 で 0px・360×780 で 120px 以下
  await check('R12', async () => {
    const out = [];
    // foot: 1 段目の下の端のボタン（要約が無ければ ［明細なしで手入力］、読めた後は ［振り返りへ進む］）
    const measureOne = (p, foot = '#record-manual') =>
      p.evaluate((foot) => {
        const vh = window.innerHeight;
        const se = document.scrollingElement;
        const seen = (sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return !!r && r.height > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5;
        };
        const notice = document.querySelector('.rin .statement__notice');
        const input = !!document.querySelector('form[data-stage="input"]');
        const cs = notice ? getComputedStyle(notice) : null;
        const lines = notice
          ? Math.round(notice.getBoundingClientRect().height / Number.parseFloat(cs.lineHeight))
          : 0;
        return {
          over: se.scrollHeight - vh,
          lc: document.getElementById('record-lc')?.getBoundingClientRect().top ?? null,
          input,
          seen: input
            ? {
                statementNotice: seen('.rin .statement__notice'),
                chartNotice: seen('.rin .charts__notice'),
                pick: seen('label[for="record-statement-file"]'),
                manual: seen(foot),
                // 明細の ［削除］ と削除の後の ［元に戻す］（あるときだけ。#184）
                remove: !document.querySelector('#record-statement-remove')
                  ? true
                  : seen('#record-statement-remove'),
                undo: !document.querySelector('#record-statement-undo')
                  ? true
                  : seen('#record-statement-undo'),
              }
            : {
                lc: seen('#record-lc'),
                chartNotice: seen('.rchartrow__notice'),
                line: seen('#record-verdict-line'),
                submit: seen('#record-submit'),
                taps: seen('[role="radiogroup"][aria-label="時間足を変えたか"]'),
              },
          noticeText: notice?.textContent ?? '',
          lines,
          hidden: !!notice?.closest('details, dialog'),
        };
      }, foot);
    const states = [
      ['1 段目', async () => {}],
      [
        // #184: 読めた後の 1 段目（［スクショを変更］・［削除］）と、削除の後（「明細を削除しました」・［元に戻す］）
        '1 段目（読み取りの後）',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await p.locator('#record-to-input').click();
          await p.locator('#record-statement-remove').waitFor();
        },
      ],
      [
        '1 段目（削除の後）',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await p.locator('#record-to-input').click();
          await p.locator('#record-statement-remove').click();
          await p.locator('#record-statement-undo').waitFor();
        },
      ],
      [
        '読み取り中',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.getByRole('status').filter({ hasText: '読み取り中' }).waitFor();
        },
      ],
      [
        '読み取りの後',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        },
      ],
      [
        // #164 のレビュー: 実際の桁（6 万台・小数 1 桁の価格、6 桁の損益、オーナーの例と同じ長さの名前）
        '実際の桁',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        },
      ],
      [
        '手入力',
        async (p) => {
          await p.locator('#record-manual').click();
          await p
            .locator('#record-fields-sheet[open]')
            .waitFor({ state: 'visible', timeout: 5000 });
          await settleSheet(p);
          await seg(p, 'L / S', 'S ショート').click();
          await closeSheets(p);
          await p.locator('.rsum__chip').first().waitFor();
        },
      ],
      [
        '2 行の明細・口座 3 つ',
        async (p, fake) => {
          fake.read = {
            status: 200,
            rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
            holdMs: 0,
          };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator('.rsum__accounts [role="radiogroup"]').waitFor({ timeout: 10000 });
        },
        ACCOUNTS_3_LONG,
      ],
      [
        // #180: 1 行目を記録した後の 2 行目（名前の上の 1 行の知らせが 2 行に折れる）
        '2 行の明細・口座 3 つ・次の行の後',
        async (p, fake) => {
          fake.read = {
            status: 200,
            rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
            holdMs: 0,
          };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          // 360×780 は口座 1・2・3 の形で流す（口座 1 は Segment が無いので、完了の文を待つ）
          await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
          await fillStatementTaps(p);
          await p.locator('#record-submit').click();
          await p
            .locator('.rsum__status--notice', { hasText: '1 / 2 行目を記録しました' })
            .waitFor({ timeout: 10000 });
          // 次の行は明細の見出しへフォーカスを移す。測りの前に窓の上の端へ戻す
          await p.evaluate(() => window.scrollTo(0, 0));
        },
        ACCOUNTS_3_LONG,
      ],
    ];
    // 安全域 0（Chromium の 390×844）と、ホーム画面に追加した iPhone の安全域（上 47・下 34。トークン --safe-* の差し替え）の
    // 両方で測る（どちらも 0px）
    for (const theme of THEMES)
      for (const safe of [false, true]) {
        const lcTops = {};
        for (const [name, fn, accounts] of states) {
          const c = await browser.newContext({
            viewport: { width: 390, height: 844 },
            storageState: signedIn,
            hasTouch: true,
          });
          try {
            await setupContext(c, theme);
            if (safe)
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
            const fake = await installFakeApi(c, accounts ? { accounts } : {});
            const p = await c.newPage();
            await openRecord(p, base);
            await fn(p, fake);
            await settle(p);
            const m = await measureOne(
              p,
              name === '1 段目（読み取りの後）' ? '#record-proceed' : '#record-manual',
            );
            lcTops[name] = m.lc;
            const where = `390×844${safe ? '（安全域 47 / 34）' : ''} ${theme} ${name}`;
            if (m.input !== name.startsWith('1 段目')) throw new Error(`${where}: 段が違う`);
            if (m.over > 0) throw new Error(`${where}: 縦のスクロール ${m.over}px（0px まで）`);
            for (const [k, v] of Object.entries(m.seen)) {
              if (!v) throw new Error(`${where}: ${k} が窓の中に無い`);
            }
            if (name === '1 段目') {
              for (const t of ['AI の提供元（Anthropic）に送', '切り取って', '保存しません'])
                if (!m.noticeText.includes(t)) throw new Error(`${theme}: 注意に「${t}」が無い`);
              if (m.lines > 3) throw new Error(`${theme}: 注意が ${m.lines} 行（3 行まで）`);
              if (m.hidden) throw new Error(`${theme}: 注意が畳まれている`);
              if (!(await p.locator('label[for="record-statement-file"]').isVisible()))
                throw new Error(`${theme}: [スクショを選ぶ] が見えない`);
            }
            out.push(`${theme}${safe ? ' 安全域' : ''} ${name} ${m.over}px`);
          } finally {
            await c.close();
          }
        }
        for (const after of ['読み取りの後', '実際の桁']) {
          const moved = Math.abs((lcTops.読み取り中 ?? 0) - (lcTops[after] ?? 0));
          if (moved > 1)
            throw new Error(
              `${theme}: 読み取りの結果が流れ込むと LC の欄が ${moved}px 動いた（${after}）`,
            );
        }
      }
    // 360×780: 縦のスクロール 120px 以下（口座 1・2・3 の形）
    const shapes = [
      { label: '口座 1', accounts: undefined },
      { label: '口座 2', accounts: ACCOUNTS_2 },
      { label: '口座 3', accounts: ACCOUNTS_3_LONG },
    ];
    for (const shape of shapes)
      for (const [name, fn] of states) {
        if (
          !name.startsWith('1 段目') &&
          name !== '読み取りの後' &&
          name !== '実際の桁' &&
          name !== '2 行の明細・口座 3 つ・次の行の後'
        )
          continue;
        const c = await browser.newContext({
          viewport: { width: 360, height: 780 },
          storageState: signedIn,
          hasTouch: true,
        });
        try {
          await setupContext(c, 'dark');
          const fake = await installFakeApi(c, shape.accounts ? { accounts: shape.accounts } : {});
          const p = await c.newPage();
          await openRecord(p, base);
          await fn(p, fake);
          await settle(p);
          const m = await measureOne(p);
          if (m.over > RECORD_OVER_360)
            throw new Error(
              `360×780 ${shape.label} ${name}: 縦のスクロール ${m.over}px（${RECORD_OVER_360}px まで）`,
            );
          out.push(`360 ${shape.label} ${name} ${m.over}px`);
        } finally {
          await c.close();
        }
      }
    return `1 画面に収まる: ${out.join(' / ')}`;
  });

  // LM1（#165・設計書 C56）: 2 段目で「LC を動かしたか」の 4 つ目「取消」と、LC の欄の行の切り替え「逆指値 未設定」を
  // シートを開かずに 1 タップずつ押せる。390×844: 取消で判定の 1 行が A → B、未設定を押すと取消が外れ（未選択）押された状態。
  // 360×780: LC の価格の欄の幅 150px 以上・LC の行と画面の横のはみ出し 0・4 択の項目の中の差は 1px 以下・当たり 44px 以上
  await check('LM1', async () => {
    const out = [];
    for (const [w, h] of [
      [390, 844],
      [360, 780],
    ]) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
        hasTouch: true,
      });
      try {
        await setupContext(c, 'dark');
        const fake = await installFakeApi(c, {});
        const p = await c.newPage();
        await openRecord(p, base);
        fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        await closeSheets(p);
        // イン 100・決済 99・LC 98.5 → −0.67R（架空）
        await p.locator('#record-lc').fill('98.5');
        await seg(p, 'LC を動かしたか', 'そのまま').click();
        await seg(p, '時間足を変えたか', 'そのまま').click();
        const line = async () => (await p.locator('#record-verdict-line').textContent()) ?? '';
        await expectPollAsync(
          async () => (await line()).includes('いい損失'),
          `${w}: そのままで A`,
        );
        await seg(p, 'LC を動かしたか', '取消').click();
        await expectPollAsync(async () => (await line()).includes('悪い損失'), `${w}: 取消で B`);
        // 次のレビューが撮影だけで見られるよう、取消・未設定の状態を撮る（#165 のデザインレビュー）
        if (opts.shots)
          await p.screenshot({ path: join(opts.shots, `${w}x${h}-dark-lm1-cancelled.png`) });
        const toggle = p.locator('#record-stop-not-placed');
        await toggle.click();
        expectEq(await toggle.getAttribute('aria-pressed'), 'true', `${w}: 未設定の押された状態`);
        const checked = await p
          .locator('[role="radiogroup"][aria-label="LC を動かしたか"] input:checked')
          .count();
        expectEq(checked, 0, `${w}: 未設定で取消が外れる`);
        // 黙って外さず、4 択の下に理由の 1 行。「取消」は選べない見た目（#165 のデザインレビュー 3）
        expectEq(
          ((await p.locator('#record-lc-move-stop-note').textContent()) ?? '').trim(),
          '逆指値が未設定のため「取消」は選べません',
          `${w}: 取消を選べない理由`,
        );
        expectEq(
          await p
            .locator('[role="radiogroup"][aria-label="LC を動かしたか"] .seg__item--off')
            .count(),
          1,
          `${w}: 選べない「取消」`,
        );
        if (opts.shots)
          await p.screenshot({ path: join(opts.shots, `${w}x${h}-dark-lm1-notplaced.png`) });
        const m = await p.evaluate(() => {
          const row = document.querySelector('.record__lc .lcrow');
          const t = document.getElementById('record-stop-not-placed')?.getBoundingClientRect();
          const items = [
            ...document.querySelectorAll(
              '[role="radiogroup"][aria-label="LC を動かしたか"] .seg__item',
            ),
          ];
          // 「逆指値 未設定」の「i」は欄の名前の行（#201）。名前の行の右端が LC の行の中に収まる
          const info = document.querySelector(
            '.record__lc .lcrow .field__head button[aria-label="「逆指値 未設定」の説明"]',
          );
          const rr = row?.getBoundingClientRect();
          const hint = document.getElementById('record-lc-hint')?.getBoundingClientRect();
          // LC の行の下の添え（#202）: 行の中に 1 行で収まる。行の数は文字の矩形の上端の数（line-height が normal でも数えられる）
          const lateEl = document.getElementById('record-lc-late');
          const late = lateEl?.getBoundingClientRect();
          const lineCount = (el) => {
            if (!el) return 0;
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          };
          const ir = info?.closest('.info-wrap')?.getBoundingClientRect();
          return {
            info: info ? 1 : 0,
            infoInRow: ir && rr ? ir.left >= rr.left - 12 && ir.right <= rr.right + 12 : false,
            hintOver: hint && rr ? Math.round(hint.right - rr.right) : 0,
            late: lateEl ? (lateEl.textContent ?? '') : null,
            lateOver: late && rr ? Math.round(late.right - rr.right) : 0,
            lateClip: lateEl ? lateEl.scrollWidth - lateEl.clientWidth : 0,
            lateLines: lineCount(lateEl),
            lateBelow: late && rr ? late.top >= rr.top : false,
            lcW: Math.round(
              document.getElementById('record-lc')?.getBoundingClientRect().width ?? 0,
            ),
            rowOver: row ? row.scrollWidth - row.clientWidth : -1,
            pageOverX: document.scrollingElement.scrollWidth - window.innerWidth,
            toggleH: t ? Math.round(t.height) : 0,
            toggleW: t ? Math.round(t.width) : 0,
            itemClip: Math.max(...items.map((e) => e.scrollWidth - e.clientWidth)),
            itemH: Math.min(...items.map((e) => Math.round(e.getBoundingClientRect().height))),
            items: items.length,
          };
        });
        expectEq(m.items, 4, `${w}: LC を動かしたかの選択肢の数`);
        expectEq(m.info, 1, `${w}: LC の欄の名前の行の「逆指値 未設定」の「i」`);
        if (!m.infoInRow) throw new Error(`${w}: 「i」が LC の行の外`);
        if (m.hintOver > 0) throw new Error(`${w}: 添え書きのはみ出し ${m.hintOver}px`);
        expectEq(
          m.late,
          'エントリー後に決めた価格は入れず「LC なし」へ',
          `${w}: LC の行の下の添え（#202）`,
        );
        if (m.lateOver > 0 || m.lateClip > 0)
          throw new Error(`${w}: LC の行の下の添えのはみ出し ${m.lateOver}px・中 ${m.lateClip}px`);
        if (m.lateLines !== 1)
          throw new Error(`${w}: LC の行の下の添えが ${m.lateLines} 行（1 行）`);
        if (!m.lateBelow) throw new Error(`${w}: LC の行の下の添えが LC の行の中にない`);
        // LC を入る前に決めていたかは聞かない（#202）
        expectEq(
          await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
          0,
          `${w}: 決めていたかの問い`,
        );
        if (m.lcW < 150) throw new Error(`${w}: LC の価格の欄の幅 ${m.lcW}px（150px 以上）`);
        if (m.rowOver !== 0) throw new Error(`${w}: LC の行のはみ出し ${m.rowOver}px`);
        if (m.pageOverX > 0) throw new Error(`${w}: 横スクロール ${m.pageOverX}px`);
        if (m.toggleH < 44) throw new Error(`${w}: 切り替えの高さ ${m.toggleH}px（44px 以上）`);
        if (m.itemClip > 1) throw new Error(`${w}: 4 択の項目の中のはみ出し ${m.itemClip}px`);
        if (m.itemH < 44) throw new Error(`${w}: 4 択の項目の高さ ${m.itemH}px`);
        // 「LC なし」で切り替えが隠れている間は「i」も出さない・外すと戻る（#201 のレビュー N3）
        const stopInfo = p.locator('.record__lc button[aria-label="「逆指値 未設定」の説明"]');
        const lcNone = p.locator('.record__lc .lcrow > .lcnone');
        await lcNone.click();
        await expectPollAsync(
          async () => (await stopInfo.count()) === 0,
          `${w}: LC なしで「i」なし`,
        );
        expectEq(await toggle.count(), 0, `${w}: LC なしで切り替えなし`);
        // LC なしの間は、同じ行で押した結果を言う（#202 のデザインレビュー 3）。1 行のまま
        const noneNote = await p.evaluate(() => {
          const el = document.getElementById('record-lc-late');
          if (!el) return null;
          const r = document.createRange();
          r.selectNodeContents(el);
          const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          return {
            text: (el.textContent ?? '').trim(),
            lines,
            clip: el.scrollWidth - el.clientWidth,
          };
        });
        expectEq(
          noneNote?.text,
          'LC を決めずに入った取引として記録します',
          `${w}: LC なしの間の添え`,
        );
        if (noneNote?.lines !== 1 || noneNote.clip > 0)
          throw new Error(
            `${w}: LC なしの間の添えが ${noneNote?.lines} 行・はみ出し ${noneNote?.clip}px`,
          );
        await lcNone.click();
        await expectPollAsync(
          async () => (await stopInfo.count()) === 1,
          `${w}: LC なしを外すと「i」`,
        );
        out.push(
          `${w}×${h} LC 欄 ${m.lcW}px・切り替え ${m.toggleW}×${m.toggleH}px・添え ${m.lateLines} 行`,
        );
      } finally {
        await c.close();
      }
    }
    return `取消と逆指値の未設定: ${out.join(' / ')}`;
  });

  // LD1（#202・設計書 C57）: 記録する画面の 2 段目は「LC を入る前に決めていたか」を聞かず、LC と 2 つのタップで判定まで届く
  // （帯の判定の 1 行が A）。編集の画面は、前からの「価格あり・決めていなかった」の取引だけ問いを出し、「決めていない」が選ばれた
  // 状態で開き、「決めていた」を選ぶと保存の帯が 危ない勝ち → 計画どおりの勝ち。390×844 と 1440×900 × ダーク / ライトで流し、
  // --shots で 2 つの画面を撮る
  await check('LD1', async () => {
    const out = [];
    for (const [w, h] of [
      [390, 844],
      [1440, 900],
    ]) {
      for (const theme of ['dark', 'light']) {
        const c = await browser.newContext({
          viewport: { width: w, height: h },
          storageState: signedIn,
          hasTouch: w < 720,
        });
        try {
          await setupContext(c, theme);
          const fake = await installFakeApi(c, { trades: [TX_LATE] });
          const p = await c.newPage();
          const errors = [];
          p.on('pageerror', (e) => errors.push(e.message));
          await openRecord(p, base);
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await closeSheets(p);
          expectEq(
            await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
            0,
            `${w} ${theme}: 記録する画面の決めていたかの問い`,
          );
          expectEq(
            (await p.locator('#record-lc-late').textContent())?.trim(),
            'エントリー後に決めた価格は入れず「LC なし」へ',
            `${w} ${theme}: LC の行の下の添え`,
          );
          // イン 100・決済 99・LC 98.5 → −0.67R（架空）。打つ 1・選ぶ 2 で判定
          await p.locator('#record-lc').fill('98.5');
          await seg(p, 'LC を動かしたか', 'そのまま').click();
          await seg(p, '時間足を変えたか', 'そのまま').click();
          await expectPollAsync(
            async () =>
              ((await p.locator('#record-verdict-line').textContent()) ?? '').includes('いい損失'),
            `${w} ${theme}: 2 つのタップで A`,
          );
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-ld1-record.png`) });
          // 編集の画面: 前からの「価格あり・決めていなかった」
          await p.goto(`${base}/trades/x-late/edit`);
          await waitReady(p, '取引を編集');
          await p.locator('#edit-submit').waitFor();
          const group = p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]');
          expectEq(await group.count(), 1, `${w} ${theme}: 編集の決めていたかの問い`);
          expectEq(
            await group.locator('input:checked').getAttribute('value'),
            'no',
            `${w} ${theme}: 開いたときの答え`,
          );
          expectEq(
            await p.locator('#record-lc').inputValue(),
            '99.5',
            `${w} ${theme}: 編集の LC の欄`,
          );
          // 添えの代わりに問いと理由の 1 行（食い違わない。#202 のデザインレビュー 2）。問いは LC の行のすぐ下（一言の欄より上）
          expectEq(await p.locator('#record-lc-late').count(), 0, `${w} ${theme}: 編集の添え`);
          expectEq(
            (await p.locator('#record-lc-decided-hint').textContent())?.trim(),
            '後から書いた LC として保存した記録です',
            `${w} ${theme}: 問いの理由の 1 行`,
          );
          const order = await p.evaluate(() => {
            const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
            return {
              row: y('.record__lc .lcrow'),
              ask: y('.record__lc .lcdecided'),
              broken: y('#record-broken'),
            };
          });
          if (!(order.row < order.ask && order.ask < order.broken))
            throw new Error(`${w} ${theme}: 問いの位置 ${JSON.stringify(order)}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-ld1-edit-late.png`) });
          await seg(p, 'LC を入る前に決めていたか', '決めていた').click();
          await expectPollAsync(
            async () =>
              ((await p.locator('#edit-change').textContent()) ?? '').includes('計画どおりの勝ち'),
            `${w} ${theme}: 決めていたで計画どおりの勝ち`,
          );
          const pageOverX = await p.evaluate(
            () => document.scrollingElement.scrollWidth - window.innerWidth,
          );
          if (pageOverX > 0) throw new Error(`${w} ${theme}: 横スクロール ${pageOverX}px`);
          expectEq(errors.length, 0, `${w} ${theme}: ページのエラー`);
          out.push(`${w}×${h} ${theme}`);
        } finally {
          await c.close();
        }
      }
    }
    return `記録は問い 2 つで A・編集の前からの記録だけ問い（決めていない → 決めていた で計画どおりの勝ち）: ${out.join(' / ')}`;
  });

  await check('KB1', async () => {
    const out = [];
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      await c.addInitScript(kbdShim);
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c, { accounts: ACCOUNTS_2 });
      const p = await c.newPage();
      await openRecord(p, base);
      fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await seg(p, 'LC を動かしたか', '広げた').click();
      await p.locator('#record-lc-after').waitFor({ state: 'visible', timeout: 5000 });
      const geo = (sel, viewH) =>
        p.evaluate(
          ([s, vh]) => {
            const r = (q) => {
              const e = document.querySelector(q);
              if (!e) return null;
              const b = e.getBoundingClientRect();
              return { top: b.top, bottom: b.bottom, h: b.height };
            };
            const barEl = document.querySelector('.record__submit--bar');
            return {
              f: r(s),
              app: r('.appbar'),
              bar: r('.record__submit--bar'),
              barPos: barEl ? getComputedStyle(barEl).position : null,
              submits: document.querySelectorAll('#record-submit').length,
              line: r('#record-verdict-line'),
              submit: r('#record-submit'),
              vh: vh ?? window.innerHeight,
              kb: document.documentElement.getAttribute('data-keyboard'),
              focus: document.activeElement?.id ?? '',
              y: window.scrollY,
              sh: document.documentElement.scrollHeight,
            };
          },
          [sel, viewH],
        );
      const fields = ['#record-lc', '#record-broken', '#record-lc-after'];
      for (const form of ['android', 'ios']) {
        for (const sel of fields) {
          await p.evaluate(() => window.scrollTo(0, 0));
          const before = await geo(sel, null);
          await p.locator(sel).focus();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 420 });
          else await p.evaluate(() => window.__kbdSet(420));
          await p.waitForTimeout(500);
          const g = await geo(sel, form === 'ios' ? 420 : null);
          const where = `${form} ${sel}`;
          const want = form === 'android' ? 'resize' : 'overlay';
          if (g.kb !== want) throw new Error(`${where}: 印が ${g.kb}（${want}）`);
          if (g.focus !== sel.slice(1)) throw new Error(`${where}: フォーカスが ${g.focus}`);
          // 帯は貼り付かず本文の最後（欄より後ろ）にあるので、見える範囲の下の端は窓（iOS は visualViewport）の下の端（#183）
          const above = g.f.top - g.app.bottom;
          const below = g.vh - g.f.bottom;
          if (above < 16 - 0.5 || below < 16 - 0.5)
            throw new Error(
              `${where}: 欄が見える所に無い（上の余白 ${above.toFixed(1)}px・下の余白 ${below.toFixed(1)}px）`,
            );
          if (g.barPos !== 'static')
            throw new Error(`${where}: キーボードの間に下の帯が貼り付いている（${g.barPos}）`);
          if (!g.bar || g.bar.top < g.f.bottom)
            throw new Error(`${where}: キーボードの間の帯が欄より前にある`);
          if (g.submits !== 1) throw new Error(`${where}: ［記録する］ が ${g.submits} 個`);
          if (opts.shots && sel === '#record-lc')
            await p.screenshot({ path: join(opts.shots, `kb1-${form}.png`) });
          out.push(`${form} ${sel.slice(8)} 上 ${Math.round(above)} / 下 ${Math.round(below)}`);
          await p.locator(sel).blur();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 844 });
          else await p.evaluate(() => window.__kbdSet(null));
          await p.waitForTimeout(400);
          const back = await geo(sel, null);
          if (back.kb !== null) throw new Error(`${where}: 閉じた後も印 ${back.kb}`);
          if (!(back.submit && back.submit.h > 0) || back.barPos !== 'sticky')
            throw new Error(
              `${where}: 閉じた後に ［記録する］ の帯が下の端に戻らない（${back.barPos}）`,
            );
          // 元の位置・形に戻る（スクロール 0・中身の高さがキーボードの前と同じ。iOS の余白 --kbd-room が残らない）
          if (back.y !== 0 || back.sh !== before.sh)
            throw new Error(
              `${where}: 閉じた後に元に戻らない（scrollY ${back.y}・中身の高さ ${back.sh} / 前 ${before.sh}）`,
            );
        }
      }
      // キーボードが段階的に上がる（窓 / visualViewport が 844 → 600 → 420）: 各段で欄が窓の中（上の帯の下・下に 16px 以上）。
      // 寄せはフォーカスした瞬間の 1 回で終わらず、resize のたびに寄せ直す（オーナー「ソフトキーがズルっと上がってきたら…」）
      for (const form of ['android', 'ios']) {
        for (const sel of ['#record-broken', '#record-lc-after']) {
          await p.evaluate(() => window.scrollTo(0, 0));
          await p.locator(sel).focus();
          const steps = [];
          for (const h of [600, 420]) {
            if (form === 'android') await p.setViewportSize({ width: 390, height: h });
            else await p.evaluate((v) => window.__kbdSet(v), h);
            await p.waitForTimeout(250);
            const g = await geo(sel, form === 'ios' ? h : null);
            const above = g.f.top - g.app.bottom;
            const below = g.vh - g.f.bottom;
            if (above < -0.5 || below < 16 - 0.5)
              throw new Error(
                `段階 ${form} ${sel} ${h}: 欄が窓の中に無い（上 ${above.toFixed(1)}px・下 ${below.toFixed(1)}px）`,
              );
            steps.push(`${h}:${Math.round(below)}`);
          }
          out.push(`段階 ${form} ${sel.slice(8)} 下 ${steps.join(' → ')}`);
          await p.locator(sel).blur();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 844 });
          else await p.evaluate(() => window.__kbdSet(null));
          await p.waitForTimeout(300);
        }
      }
      // 決定キー: LC（次へ）→ 一言、一言（完了）→ フォーカスが外れて帯が戻る（Android の形）
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.locator('#record-lc').focus();
      await p.setViewportSize({ width: 390, height: 420 });
      await p.waitForTimeout(400);
      const hints = await p.evaluate(() => [
        document.getElementById('record-lc')?.getAttribute('enterkeyhint'),
        document.getElementById('record-broken')?.getAttribute('enterkeyhint'),
      ]);
      if (hints[0] !== 'next' || hints[1] !== 'done')
        throw new Error(`enterkeyhint が ${hints.join(' / ')}（next / done）`);
      await p.keyboard.press('Enter');
      await p.waitForTimeout(400);
      const g1 = await geo('#record-broken', null);
      if (g1.focus !== 'record-broken')
        throw new Error(`LC の決定キーの後のフォーカスが ${g1.focus}`);
      if (g1.f.top - g1.app.bottom < 15.5 || g1.vh - g1.f.bottom < 15.5)
        throw new Error('LC の決定キーの後、一言の欄が見える所に無い');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(400);
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(400);
      const g2 = await geo('#record-broken', null);
      if (g2.focus === 'record-broken') throw new Error('一言の決定キーでフォーカスが外れない');
      if (g2.kb !== null || !(g2.bar && g2.bar.h > 0) || g2.barPos !== 'sticky')
        throw new Error('一言の決定キーの後に帯が戻らない');
      out.push('決定キー LC → 一言 → 閉じる');
    } finally {
      await c.close();
    }
    // キーボードを出したまま、本文の最後の ［記録する］ を押して保存する（#183。Android / iOS の形）。一言に打った値が本文に入る
    for (const form of ['android', 'ios']) {
      const c3 = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      try {
        await c3.addInitScript(kbdShim);
        await setupContext(c3, 'dark');
        const fake = await installFakeApi(c3, { accounts: ACCOUNTS_2 });
        const p = await c3.newPage();
        await openRecord(p, base);
        fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        await fillStatementTaps(p);
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.locator('#record-broken').focus();
        await kbdUp(p, form);
        await p.waitForTimeout(500);
        await p.locator('#record-broken').press('End');
        await p.keyboard.type('（KB1 追記）');
        const left = await bodyEndSubmit(p, `本文の最後 ${form}`, {
          submit: '#record-submit',
          bar: '.record__submit--bar',
          line: '#record-verdict-line',
          field: '#record-broken',
          vh: 420,
        });
        await p.locator('#record-submit').tap();
        await waitSaved(p, '記録しました');
        expectEq(fake.posts.length, 1, `本文の最後 ${form}: 保存の要求`);
        if (!JSON.stringify(fake.posts[0]).includes('押し目の安値を割ったら（KB1 追記）'))
          throw new Error(`本文の最後 ${form}: 押したときの一言の値が保存の本文に無い`);
        await kbdDown(p, form);
        out.push(`本文の最後の ［記録する］ で保存 ${form}（下の余白 ${left}）`);
      } finally {
        await c3.close();
      }
    }
    // 書きかけの案内・編集の画面の ［保存］ の帯・設定のシートの ［保存］ の帯（Android の形。#172 のレビュー N7）
    const c2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      await setupContext(c2, 'dark');
      const api = await installFakeApi(c2);
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
      const p = await c2.newPage();
      const shown = (sel) =>
        p.evaluate((s) => {
          const e = document.querySelector(s);
          return !!e && e.getBoundingClientRect().height > 0;
        }, sel);
      /** 帯の position（キーボードの間は static = 本文の最後、閉じたら sticky。#183） */
      const pos = (sel) =>
        p.evaluate((s) => {
          const e = document.querySelector(s);
          return e && e.getBoundingClientRect().height > 0 ? getComputedStyle(e).position : null;
        }, sel);
      const inView = (sel) =>
        p.evaluate((s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return !!r && r.top >= 16 - 0.5 && r.bottom <= window.innerHeight - 16 + 0.5;
        }, sel);
      const open = async (field) => {
        await p.locator(field).focus();
        await p.setViewportSize({ width: 390, height: 420 });
        await p.waitForTimeout(500);
      };
      const close = async (field) => {
        await p.locator(field).blur();
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(400);
      };
      // 書きかけの案内（記録する画面を離れて戻る）
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await toReview(p);
      await p.locator('#record-lc').fill('100.5');
      await p.goBack();
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p
        .locator('#record-resumed', { hasText: '前の入力の続きです' })
        .waitFor({ timeout: 5000 });
      await open('#record-lc');
      if (await shown('#record-resumed'))
        throw new Error('キーボードの間に書きかけの案内が出ている');
      if (!(await inView('#record-lc'))) throw new Error('書きかけの案内の形で LC の欄が見えない');
      await close('#record-lc');
      if (!(await shown('#record-resumed'))) throw new Error('閉じた後に書きかけの案内が戻らない');
      out.push('書きかけの案内を隠して戻す');
      // シートの欄の並びの決定キー（#174。ui-guidelines 10.1）: 取引の欄のシートを Enter だけで 銘柄 → 数量 → イン → 決済 と
      // 進み、決済の Enter（完了）でフォーカスが外れる。どの Enter でも記録の要求は送らない（PC の形 = 印なしの暗黙の送信も止まる）
      const active = () => p.evaluate(() => document.activeElement?.id ?? '');
      const postsBefore = api.posts.length;
      await openFields(p);
      await p.locator('#record-instrument').fill('US30');
      for (const [from, to] of [
        ['#record-instrument', 'record-quantity'],
        ['#record-quantity', 'record-entry'],
        ['#record-entry', 'record-exit'],
      ]) {
        await p.locator(from).press('Enter');
        expectEq(await active(), to, `決定キー: ${from} の次`);
      }
      expectEq(
        await p.locator('#record-exit').getAttribute('enterkeyhint'),
        'done',
        '決済の決定キー',
      );
      await p.locator('#record-exit').press('Enter');
      if ((await active()) === 'record-exit')
        throw new Error('決済の「完了」でフォーカスが外れない');
      await p.waitForTimeout(300);
      expectEq(api.posts.length, postsBefore, '取引の欄の決定キーで送った記録の要求');
      await closeSheets(p);
      out.push('取引の欄のシートの決定キー（銘柄 → 数量 → イン → 決済 → 完了・送らない）');
      // 編集の画面の ［保存］ の帯
      await p.goto(`${base}/trades/x-e1/edit`);
      await p.locator('#edit-submit').waitFor({ timeout: 15000 });
      await open('#record-lc');
      if ((await pos('.edit__submit')) !== 'static')
        throw new Error('キーボードの間に編集の画面の帯が貼り付いている');
      if (!(await inView('#record-lc'))) throw new Error('編集の画面で LC の欄が見えない');
      await close('#record-lc');
      if ((await pos('.edit__submit')) !== 'sticky')
        throw new Error('閉じた後に編集の画面の帯が下の端に戻らない');
      out.push('編集の ［保存］ の帯を本文の最後へ移して戻す');
      // キーボードを出したまま一言に打ち、本文の最後の ［保存］ を押して保存する（#183）
      await p.locator('#record-broken').fill('架空の条件（KB1 編集）');
      await open('#record-broken');
      const left = await bodyEndSubmit(p, '編集の本文の最後', {
        submit: '#edit-submit',
        bar: '.edit__submit',
        line: '#edit-verdict-line',
        field: '#record-broken',
        vh: 420,
      });
      const putsBefore = api.puts.length;
      await p.locator('#edit-submit').tap();
      await expectPollAsync(async () => api.puts.length > putsBefore, '編集の ［保存］ の要求');
      if (!JSON.stringify(api.puts.at(-1).body).includes('架空の条件（KB1 編集）'))
        throw new Error('編集の本文の最後: 押したときの一言の値が保存の本文に無い');
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(300);
      out.push(`編集の本文の最後の ［保存］ で保存（下の余白 ${left}）`);
      // 設定のシートの ［保存］ の帯
      await p.goto(`${base}/settings/accounts`);
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await open('#settings-account-name');
      if ((await pos('#settings-account-sheet .setform__actions')) !== 'static')
        throw new Error('キーボードの間にシートの ［保存］ の帯が貼り付いている');
      if (!(await inView('#settings-account-name'))) throw new Error('シートの欄が見えない');
      await close('#settings-account-name');
      if ((await pos('#settings-account-sheet .setform__actions')) !== 'sticky')
        throw new Error('閉じた後にシートの ［保存］ の帯が下の端に戻らない');
      out.push('シートの ［保存］ の帯を本文の最後へ移して戻す');
      // 設定の口座のシートの決定キー（#174）: 資金 → 許容リスク、許容リスクの「完了」で外れる。保存は送らない
      const writesBefore = api.writes.length;
      await p.locator('#settings-account-capital').press('Enter');
      expectEq(
        await p.evaluate(() => document.activeElement?.id ?? ''),
        'settings-account-risk',
        '決定キー: 資金の次',
      );
      await p.locator('#settings-account-risk').press('Enter');
      if ((await p.evaluate(() => document.activeElement?.id ?? '')) === 'settings-account-risk')
        throw new Error('許容リスクの「完了」でフォーカスが外れない');
      await p.waitForTimeout(300);
      expectEq(api.writes.length, writesBefore, '口座のシートの決定キーで送った保存の要求');
      out.push('口座のシートの決定キー（資金 → 許容リスク → 完了・送らない）');
    } finally {
      await c2.close();
    }
    return `キーボードで欄が隠れない（390×844 → 420）: ${out.join(' / ')}`;
  });

  // R14（#130 AC-11。ui-guidelines 9.5「形が替わっても View を包む DOM を同じに保つ」）: 記録する画面で LC に入力中に向きを
  // 変える（844×390 ⇄ 390×844）と、同じ LC の要素のまま値とフォーカスが残り、横スクロール 0。取引の欄のシートで銘柄に入力中に
  // 向きを変えても同じ
  await check('R14', async () => {
    const { c, p, errors } = await recordContext();
    const out = [];
    const keep = (id) =>
      p.evaluate((id) => {
        const el = document.getElementById(id);
        return {
          same: el?.getAttribute('data-ui-check-same') === '1',
          value: el instanceof HTMLInputElement ? el.value : null,
          focus: document.activeElement === el,
          h: document.documentElement.scrollWidth - window.innerWidth,
          form: document.documentElement.getAttribute('data-form') ?? '',
        };
      }, id);
    const mark = (id) =>
      p.evaluate((id) => document.getElementById(id)?.setAttribute('data-ui-check-same', '1'), id);
    try {
      for (const [from, to] of [
        [
          [844, 390],
          [390, 844],
        ],
        [
          [390, 844],
          [844, 390],
        ],
      ]) {
        await p.setViewportSize({ width: from[0], height: from[1] });
        await openRecord(p, base);
        await toReview(p);
        await p.locator('#record-lc').fill('99.5');
        await p.locator('#record-lc').focus();
        await mark('record-lc');
        await p.setViewportSize({ width: to[0], height: to[1] });
        await settle(p);
        const k = await keep('record-lc');
        const what = `${from.join('×')} → ${to.join('×')}`;
        if (!k.same) throw new Error(`${what}: LC の欄が作り直された`);
        expectEq(k.value, '99.5', `${what}: LC の値`);
        expectEq(k.focus, true, `${what}: LC のフォーカス`);
        expectEq(k.h, 0, `${what}: 横スクロール`);
        // 取引の欄のシート（銘柄）
        await openFields(p);
        await p.locator('#record-instrument').fill('架空指数B');
        await p.locator('#record-instrument').focus();
        await mark('record-instrument');
        await p.setViewportSize({ width: from[0], height: from[1] });
        await settle(p);
        const s = await keep('record-instrument');
        if (!s.same) throw new Error(`${what}（シート）: 銘柄の欄が作り直された`);
        expectEq(s.value, '架空指数B', `${what}（シート）: 銘柄の値`);
        expectEq(s.focus, true, `${what}（シート）: 銘柄のフォーカス`);
        expectEq(s.h, 0, `${what}（シート）: 横スクロール`);
        await closeSheets(p);
        out.push(`${what}（形 ${k.form}）`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `向きを変えても LC・取引の欄のシートの銘柄の要素・値・フォーカスが残る、横スクロール 0（${out.join(' / ')}）`;
  });

  // RS1（#130 のレビュー N2。ui-guidelines 9.3・9.7）: 記録する画面の 4 つのシート（取引の欄・タイムゾーン・判定・チャート）も、
  // 説明のシートと同じ規則で開いて閉じる。下から出て窓の中・最大 86%・開くと見出しへフォーカス・✕ で閉じると開いたボタンへ
  // フォーカスが戻る。取引の欄のシートは 段 1 → 段 2（ほかの欄）→ 戻る（段 1）→ 戻る（閉じる・［編集］ へフォーカス）
  await check('RS1', async () => {
    const out = [];
    const { c, p, fake, errors } = await recordContext();
    const openId = async () =>
      p.evaluate(() => [...document.querySelectorAll('dialog.sheet[open]')].map((d) => d.id));
    const box = async (id) =>
      p.evaluate((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight };
      }, id);
    const expectSheet = async (id, title, what) => {
      await p.locator(`#${id}[open]`).waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      const b = await box(id);
      if (b.top < -0.5 || b.bottom > b.vh + 0.5) throw new Error(`${what}: シートが窓の外`);
      if (b.h > b.vh * 0.86 + 1)
        throw new Error(`${what}: シートの高さ ${Math.round(b.h)}px が 86% を超える`);
      expectEq(
        (await p.locator(`#${id} .sheet__title`).textContent())?.trim(),
        title,
        `${what}: 見出し`,
      );
      expectEq(
        await p.evaluate(() => document.activeElement?.classList.contains('sheet__title')),
        true,
        `${what}: 開いたら見出しへフォーカス`,
      );
      out.push(`${what} ${Math.round((b.h / b.vh) * 100)}%`);
    };
    const focusId = () => p.evaluate(() => document.activeElement?.id ?? '');
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      fake.chartTimeframes = ['4h'];
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      // 取引の欄: 段 1 → 段 2 → 戻る → 戻る
      await p.locator('#record-edit-fields').click();
      await expectSheet('record-fields-sheet', '取引の欄', '取引の欄');
      await p.locator('#record-more').click();
      await expectPollAsync(
        async () =>
          (await p.locator('#record-fields-sheet .sheet__title').textContent())?.trim() ===
          'ほかの欄（任意）',
        '段 2 へ',
      );
      await p.goBack();
      await expectPollAsync(
        async () =>
          (await p.locator('#record-fields-sheet .sheet__title').textContent())?.trim() ===
          '取引の欄',
        '戻るで段 1',
      );
      expectEq(new URL(p.url()).pathname, '/record', '段 1 へ戻った後の URL');
      await p.goBack();
      await expectPollAsync(async () => (await openId()).length === 0, '戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '閉じた後の URL');
      await expectPollAsync(
        async () => (await focusId()) === 'record-edit-fields',
        '閉じたら ［編集］ へフォーカス',
      );
      // Esc で段 2 → 段 1 → 閉じる
      await p.locator('#record-edit-fields').click();
      await expectSheet('record-fields-sheet', '取引の欄', '取引の欄（2 回目）');
      await p.locator('#record-more').click();
      await p.locator('#record-fields-sheet #record-pnl').waitFor();
      await p.keyboard.press('Escape');
      await p.locator('#record-fields-sheet #record-instrument').waitFor();
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await openId()).length === 0, 'Esc で閉じる');
      // タイムゾーン・判定: ✕ で閉じると開いたボタンへ
      for (const [opener, id, title] of [
        ['#record-tz-open', 'record-tz-sheet', '明細の時刻のタイムゾーン'],
        ['#record-verdict-line', 'record-verdict-sheet', '判定'],
      ]) {
        await p.locator(opener).click();
        await expectSheet(id, title, title);
        await p.locator(`#${id} .sheet__close`).click();
        await expectPollAsync(async () => (await openId()).length === 0, `${title}: ✕ で閉じる`);
        await expectPollAsync(
          async () => (await focusId()) === opener.slice(1),
          `${title}: 閉じたら開いたボタンへ`,
        );
      }
      // チャート: チャートのある小さな枠から
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry').click();
      await expectSheet('record-chart-sheet', 'チャート', 'チャート');
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await openId()).length === 0, 'チャート: Esc で閉じる');
      await expectPollAsync(
        async () => (await focusId()) === 'record-mini-entry',
        'チャート: 閉じたら小さな枠へ',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `記録する画面の 4 つのシートが下から窓の中・86% 以下・見出しへフォーカス・閉じたら開いたボタンへ。取引の欄は 段 2 → 戻るで段 1 → 戻るで閉じる・Esc も 1 段ずつ（${out.join(' / ')}）`;
  });

  await check('R13', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
    });
    try {
      await setupContext(c, 'dark');
      await installFakeApi(c);
      const p = await c.newPage();
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      // 損益（円）を入れて R・リスク・損益の 3 つのラベルを並べる（架空の値）。判定のシートで測る（#130）
      await openMore(p);
      await p.locator('#record-pnl').fill('-8,000');
      await openVerdict(p);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      await p.locator('.verdict__stat dt', { hasText: '損益' }).waitFor({ timeout: 5000 });
      const m = await p.evaluate(() => {
        const r = document.querySelector('.verdict .num--xl');
        const cs = getComputedStyle(r);
        const tops = [...document.querySelectorAll('.verdict__stat dt')].map(
          (dt) => dt.getBoundingClientRect().top,
        );
        return { size: cs.fontSize, family: cs.fontFamily, text: r.textContent, tops };
      });
      // 判定の枠の R は主役の数字 44px（#131 で判定の枠を組み直した。#130 のデザインレビュー b6・ui-guidelines 9.9。それまでは 36px）
      expectEq(m.size, '44px', '大きな R の文字の大きさ');
      if (/mono/i.test(m.family)) throw new Error(`大きな R の書体が等幅 ${m.family}`);
      expectEq(m.text, '−1.6R', 'R の文字（負の符号は U+2212）');
      expectEq(m.tops.length, 3, 'ラベルの数');
      const spread = Math.max(...m.tops) - Math.min(...m.tops);
      if (spread > 1) throw new Error(`ラベルの上端の差 ${spread.toFixed(1)}px`);
      return `判定 B の R は 44px・本文の書体（${m.family.split(',')[0]}）、R・リスク・損益のラベルの上端の差 ${spread.toFixed(1)}px`;
    } finally {
      await c.close();
    }
  });

  // LV2（#212。ui-guidelines 10.3・10.6）: 記録する画面と編集の画面のいちばん長い値で、
  //   - 2 段目: 時刻の印「時刻が未確定」・チャートの行（エントリー時 = 選んだ値と読めた値が違う「チャートからは 15 分足」、
  //     決済時 = 読み取り中・追加 5 枚）・LC の欄の手がかり（逆指値の「i」つき）
  //   - 1 段目: チャートの小さな 2 枠（読み取り中・選んだ値と読めた値が違う）
  //   - 編集: チャートの小さな 2 枠（差し替え済み・削除（未保存））・LC の欄の手がかり
  // を 360×780 と 390×844（ダーク）で開き、どの要素にも「…」が出ない（省略してよい所の外）・値の要素が箱の中に全部ある・
  // 時間足と「追加 N 枚」の塊が中で折れない・横スクロール 0・部品のはみ出し 0、縦は 390×844 の 2 段目と 1 段目で 0px・
  // 360×780 の記録する画面は 120px 以下（R12 と同じ）を見る。文字の拡大（2 倍）でも「…」0・値の切れ 0・横スクロール 0
  // （縦は伸びてよい）。--shots なら撮る
  await check('LV2', async () => {
    const out = [];
    const fails = [];
    const VALUES =
      '.rsum__tzmark, .rchartrow__l1, .rchartrow__l2, .rchart__line, .record__lc .lcrow .field__hint, .rpart';
    const look = async (p, what, file, { over = null, zoom = false } = {}) => {
      const r = await p.evaluate(
        ({ allowed, values }) => {
          const cuts = [];
          for (const el of document.querySelectorAll('main *, header *, nav *, dialog *, form *')) {
            const cs = getComputedStyle(el);
            if (cs.textOverflow !== 'ellipsis' || cs.display === 'none') continue;
            // 読み上げだけの要素（.sr-only = 1px の箱）と入力の欄（ファイルを選ぶ欄の既定の省略）は見ない
            if (el.matches('.sr-only, input, select, textarea')) continue;
            if (el.scrollWidth <= el.clientWidth + 1) continue;
            if (allowed.some((sel) => el.matches(sel))) continue;
            const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName;
            cuts.push(`${cls}「${(el.textContent || '').trim().slice(0, 24)}」`);
          }
          const bad = [];
          for (const el of document.querySelectorAll(values)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (el.closest('dialog:not([open])')) continue;
            const name = `${el.className.split(' ')[0]}「${(el.textContent || '').trim()}」`;
            if (el.scrollWidth > el.clientWidth + 1) bad.push(`${name}横に切れる`);
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const cs = getComputedStyle(a);
              if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
              const b = a.getBoundingClientRect();
              if (
                r.left < b.left - 1 ||
                r.right > b.right + 1 ||
                r.top < b.top - 1 ||
                r.bottom > b.bottom + 1
              )
                bad.push(`${name}${(a.className || a.tagName).toString().split(' ')[0]} の外`);
              break;
            }
          }
          // 時間足・「追加 N 枚」の塊（.rpart--atom）は 1 行
          for (const el of document.querySelectorAll('.rpart--atom')) {
            const tops = new Set([...el.getClientRects()].map((x) => Math.round(x.top)));
            if (tops.size > 1) bad.push(`塊「${el.textContent}」が中で折れる`);
          }
          const se = document.scrollingElement;
          return { cuts, bad, over: se.scrollHeight - window.innerHeight };
        },
        { allowed: CUT_ALLOWED, values: VALUES },
      );
      const m = await measure(p, false, TAP);
      if (r.cuts.length > 0) fails.push(`${what}: 表に無い「…」${r.cuts.join('・')}`);
      if (r.bad.length > 0) fails.push(`${what}: ${r.bad.join('・')}`);
      if (m.h !== 0) fails.push(`${what}: 横スクロール ${m.h}px`);
      // 文字の拡大は「…」・値の切れ・横スクロールだけを見る（部品のはみ出しは拡大の検査の受け持ち）
      if (!zoom && m.clipped.length > 0) fails.push(`${what}: はみ出し ${m.clipped.join('・')}`);
      if (over !== null && r.over > over)
        fails.push(`${what}: 縦のスクロール ${r.over}px（${over}px まで）`);
      if (opts.shots) await p.screenshot({ path: join(opts.shots, file), fullPage: true });
      out.push(`${what} 縦 ${r.over}px`);
    };
    for (const zoom of [false, true])
      for (const [w, h] of [
        [360, 780],
        [390, 844],
      ]) {
        const tag = `${w}×${h}${zoom ? ' 拡大' : ''}`;
        const file = (s) => `${w}x${h}-dark-${zoom ? 'zoom-' : ''}lv2-${s}.png`;
        const limit = zoom ? null : w === 360 ? RECORD_OVER_360 : 0;
        const ctx = await browser.newContext({
          viewport: { width: w, height: h },
          storageState: signedIn,
          hasTouch: true,
        });
        try {
          await setupContext(ctx, 'dark');
          if (zoom)
            await ctx.addInitScript((css) => {
              const put = () => {
                const st = document.createElement('style');
                st.textContent = css;
                document.head.append(st);
              };
              if (document.head) put();
              else document.addEventListener('DOMContentLoaded', put);
            }, zoomCss());
          // 口座 3 つ（2 段目に口座の Segment の行が入る、いちばん高い形）
          const fake = await installFakeApi(ctx, { accounts: ACCOUNTS_3_LONG });
          // オプションのポジションの取引（合成の fixture option-legs.json の P1。OPT117 と同じ形）
          const fx = JSON.parse(
            readFileSync(join(ROOT, 'tests/fixtures/records/option-legs.json'), 'utf8'),
          ).items.find((x) => x.name === 'P1');
          const inst = { id: 'inst-xyzopt', ...fx.instrument, createdAt: 1, updatedAt: 1 };
          delete inst.underlying;
          fake.instruments.push(inst);
          fake.trades.push({
            id: 'x-opt1',
            schemaVersion: 2,
            createdAt: 1700000000020,
            updatedAt: 1700000000020,
            record: { ...fx.record, instrumentId: inst.id },
            snapshot: fx.snapshot,
          });
          const p = await ctx.newPage();
          const errors = [];
          p.on('pageerror', (e) => errors.push(e.message));
          // 2 段目: 時刻の印・チャートの行・LC の手がかり
          await openRecord(p, base);
          fake.read = { status: 200, rows: [READ_E10[0]], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator('.rsum__tzmark', { hasText: '時刻が未確定' }).waitFor({ timeout: 10000 });
          fake.chartTimeframes = ['15m'];
          fake.chartRead = { status: 200, kind: 'chart', holdMs: 5000 };
          await pasteChart(p, 'entry');
          await openChartSheet(p);
          await p.locator('#record-chart-entry-tf').selectOption('4h');
          await p.locator('#record-chart-entry .chart__suggest').waitFor({ timeout: 10000 });
          fake.chartRead = { status: 200, kind: 'chart', holdMs: 60000 };
          await closeSheets(p);
          await pasteChart(p, 'exit');
          await openChartSheet(p);
          for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
          for (const slot of ['x1', 'x2', 'x3', 'x4', 'x5']) await pasteChart(p, slot);
          await closeSheets(p);
          await p.evaluate(() => window.scrollTo(0, 0));
          const l1 = (await p.locator('.rchartrow__l1').textContent()) ?? '';
          const l2 = (await p.locator('.rchartrow__l2').textContent()) ?? '';
          if (!l1.includes('15 分足') || !l2.includes('読み取り中') || !l2.includes('追加 5 枚'))
            throw new Error(`${tag} チャートの行: ${l1} / ${l2}`);
          await settle(p);
          await look(p, `${tag} 2 段目`, file('stage2'), { over: limit, zoom });
          // 1 段目: チャートの小さな 2 枠
          await p.locator('#record-to-input').click();
          await p.locator('form[data-stage="input"]').waitFor();
          await settle(p);
          await look(p, `${tag} 1 段目`, file('stage1'), { over: limit, zoom });
          // 編集: 差し替え済み・削除（未保存）
          await p.goto(`${base}/trades/x-d1/edit`);
          await waitReady(p, '取引を編集');
          await p.locator('#edit-mini-entry canvas').waitFor({ timeout: 15000 });
          await openEditChartSheet(p);
          await p.getByRole('button', { name: '決済時のチャートを削除' }).click();
          const frame = p.locator('#edit-chart-entry');
          await frame.locator('.chart__name').click();
          await makeChart(p, 'paste');
          await frame.locator('.chart__mark', { hasText: '差し替え' }).waitFor();
          await closeSheets(p);
          await p.evaluate(() => window.scrollTo(0, 0));
          await settle(p);
          await look(p, `${tag} 編集`, file('edit'), { zoom });
          // 編集のオプションのポジション（LC の欄の名前がいちばん長い「入る前に決めた LC（原資産）」）
          await p.goto(`${base}/trades/x-opt1/edit`);
          await waitReady(p, '取引を編集');
          await p.locator('#record-lc').waitFor({ timeout: 15000 });
          await p.locator('.record__lc .field__label', { hasText: '（原資産）' }).waitFor();
          await settle(p);
          await look(p, `${tag} 編集（オプション）`, file('edit-option'), { zoom });
          if (errors.length > 0) fails.push(`${tag}: ページのエラー ${errors.length}`);
        } finally {
          await ctx.close();
        }
      }
    if (fails.length > 0) throw new Error(fails.join(' | '));
    return `いちばん長い値の記録する・編集: 表に無い「…」0・値の切れ 0・横スクロール 0（${out.join('・')}）`;
  });
}
