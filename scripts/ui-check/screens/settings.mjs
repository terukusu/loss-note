import { readFileSync } from 'node:fs';
import {
  AUTH_EMULATOR,
  expectPollAsync,
  settleLayers,
  waitLayerPushed,
  waitReady,
} from '../base.mjs';
import { ACC_D, ACC_ONE, FAKE_US30, installFakeApi, seedSettings } from '../fixtures.mjs';
import { pagesGroup, settingsGroup, zoomPagesGroup, zoomSettingsGroup } from '../groups.mjs';
import { EX_E1, fillRecord, openRecord } from '../helpers.mjs';
import { openSettings, waitSettingsSheet } from '../settings-states.mjs';

/**
 * 画面の検査の単位「設定」: 設定の根・AI の利用状況・心理のタグ・データの書き出しの状態と、データの書き出し EX1・
 * 設定 SET1〜SET6
 */
export const id = 'settings';
export const title = '設定';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await settingsGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
  await zoomSettingsGroup(vp, id);
}

/** 手順（EX1・SET1・SET2・SET3・SET4・SET5・SET6） */
export async function flows(kit) {
  const { browser, base, signedIn, check, expectEq, recordContext } = kit;
  // データの書き出し（#167 の AC-7・ADR-0025）: 書き出しの画面の文書に本番の CSP（api の BASE_CSP）を付けて開き、JSON・CSV の
  // ボタンでファイルが 1 つずつダウンロードされ、CSP の違反が 0 件であることを見る。開発サーバーの都合で足すのは、Vite が CSS を
  // style 要素で入れる分の style-src 'unsafe-inline' と、HMR の ws・Auth のエミュレーターへの connect-src だけ（本番の値は
  // image-check.sh・test_web.py が見る）。ダウンロードの遷移が CSP（img-src・connect-src・form-action）に掛からないことの確かめ
  await check('EX1', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
      acceptDownloads: true,
    });
    try {
      const fake = await installFakeApi(c);
      const port = new URL(base).port;
      const csp = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self'",
        "font-src 'self'", // 同梱の数字の書体（#237。本番の BASE_CSP と同じ）
        `connect-src 'self' ws://127.0.0.1:${port} ${AUTH_EMULATOR}`,
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ');
      await c.route(`${base}/settings/export`, async (route) => {
        const res = await route.fetch();
        await route.fulfill({
          response: res,
          headers: { ...res.headers(), 'content-security-policy': csp },
        });
      });
      await c.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
        );
      });
      const p = await c.newPage();
      await p.goto(`${base}/settings/export`);
      await waitReady(p, 'データの書き出し');
      const got = [];
      for (const kind of ['json', 'csv']) {
        const [dl] = await Promise.all([
          p.waitForEvent('download', { timeout: 10000 }),
          p.locator(`#settings-export-${kind}`).click(),
        ]);
        const name = dl.suggestedFilename();
        if (!new RegExp(`^loss-note-\\d{8}\\.${kind}$`).test(name))
          throw new Error(`ファイルの名前: ${name}`);
        const text = readFileSync(await dl.path(), 'utf8');
        if (kind === 'json') {
          const body = JSON.parse(text);
          expectEq(body.format, 'loss-note-export', 'JSON の形式');
          expectEq(body.trades.length, fake.trades.length, 'JSON の取引の件数');
        } else {
          expectEq(text.startsWith('\uFEFF決済の時刻,'), true, 'CSV の BOM と見出し');
          expectEq(
            text.trimEnd().split('\r\n').length >= fake.trades.length + 1,
            true,
            'CSV の行の数',
          );
        }
        await p.getByRole('status').filter({ hasText: name }).waitFor({ timeout: 5000 });
        got.push(name);
      }
      expectEq(fake.exportGets, 2, '書き出しの要求の回数');
      const violations = await p.evaluate(() => window.__cspViolations);
      expectEq(violations.length, 0, `CSP の違反（${violations.join(' / ')}）`);
      const wide = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(wide <= 0, true, `幅 360 の横スクロール（${wide}px）`);
      return `ダウンロード ${got.join('・')}・CSP の違反 0 件・横スクロール 0`;
    } finally {
      await c.close();
    }
  });
  // ── 設定（SET1〜SET5。Issue #5・#47 の口座）。偽の記録の API で流す
  await check('SET1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      // 円建ての銘柄にしておく（1R・リスク（%）を価格から出せる。5.1）
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      await openSettings(p, base, '/settings/accounts');
      await p.locator('.setrow', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-capital').fill('1,000,000');
      await p.getByText('1 回の負けは 10,000円 までです').waitFor();
      await p.locator('#settings-account-save').click();
      await p
        .getByRole('status')
        .filter({ hasText: '口座 1 を保存しました' })
        .waitFor({ timeout: 5000 });
      expectEq(fake.accounts.find((a) => a.id === 'default')?.capitalYen, 1000000, '保存した資金');
      expectEq(
        fake.writes.some((x) => x.key === 'PUT /api/settings'),
        false,
        '設定の API に書かない',
      );
      await p.reload();
      await openSettings(p, base, '/settings/accounts');
      await p.locator('.setrow', { hasText: '1,000,000円 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('.sethistory__title', { hasText: '資金の履歴（1 件）' }).waitFor();
      expectEq(
        await p.locator('#settings-account-capital').inputValue(),
        '1,000,000',
        '開き直した欄',
      );
      // 記録する画面で 5.1 の例（L・イン 100.00・LC 99.50・数量 10,000・決済 99.40）→ リスク 0.5%
      await openRecord(p, base);
      await fillRecord(p, {
        side: 'L',
        entry: '100.00',
        exit: '99.40',
        lc: '99.50',
        move: 'そのまま',
      });
      await p.locator('.vline .num', { hasText: '0.5%' }).waitFor({ timeout: 5000 });
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
      await openSettings(p, base, '/settings/instruments');
      // E9: 行を押す → 編集のシート → 株価指数・usd・刻み 0.1 → 保存。
      // #133: 開いた後のフォーカスは名前の欄からシートの見出しへ（下のシートの規則。ui-guidelines 9.3・部品 Sheet）
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').waitFor();
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-inst-sheet-title',
        '開いた後のフォーカス（シートの見出し）',
      );
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('usd');
      await p.locator('#settings-inst-step').fill('0.1');
      await p.locator('form.setform button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: 'US30 を保存しました' }).waitFor();
      // 行の添えは 2 行（#133 デザインレビュー a-4）
      await p
        .locator('.setrow', { hasText: '株価指数 · 現物・CFD · USD 建て' })
        .filter({ hasText: '乗数 1 · 刻み 0.1' })
        .waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '保存の後のシート');
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-us30',
        '閉じた後のフォーカス',
      );
      await p.reload();
      await openSettings(p, base, '/settings/instruments');
      await p
        .locator('.setrow', { hasText: '株価指数 · 現物・CFD · USD 建て' })
        .filter({ hasText: '乗数 1 · 刻み 0.1' })
        .waitFor();
      // E10・E11: 重複の名前・乗数 0 → 送らずに欄の誤り
      const before = fake.writes.length;
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.locator('form.setform button[type="submit"]').click();
      await p
        .locator('#settings-inst-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
      await p.locator('#settings-inst-multiplier-error').waitFor();
      expectEq(fake.writes.length, before, '誤りのときの書き込み');
      // #133: やめるはシートの ✕・Esc・外・戻る（［キャンセル］ は置かない）。Esc で閉じる → 押した行へフォーカス
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        'Esc で閉じる',
      );
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-xau',
        'やめた後のフォーカス',
      );
      // Esc で閉じた層の段をアプリが history.go で戻し終えるまで待つ（次のシートの段と重ねない。#240 と同じ形）
      await settleLayers(p);
      // 戻るで閉じる: シートだけが閉じ、画面は銘柄のまま。もう 1 回の戻るで設定の根へ（9.7）
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      // シートの段が履歴に積まれてから戻る（積まれる前の戻るは画面を戻す。waitLayerPushed）
      await waitLayerPushed(p);
      await p.goBack();
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        '戻るで閉じる',
      );
      expectEq(new URL(p.url()).pathname, '/settings/instruments', '戻るで閉じた後の画面');
      // 開き直した下書きは保存した値から（閉じたら捨てる）
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      expectEq(await p.locator('#settings-inst-name').inputValue(), 'XAU', '開き直した名前');
      // ✕（読み上げ「閉じる」）で閉じる
      await p.locator('dialog#settings-inst-sheet').getByRole('button', { name: '閉じる' }).click();
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        '✕ で閉じる',
      );
      expectEq(fake.writes.length, before, '閉じただけの書き込み');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E9 を直して保存 → シートが閉じ一覧・開き直しても同じ、E10・E11 は送らない、Esc・戻る・✕ で閉じる（下書きは捨てる）、フォーカスはシートの見出し ⇄ 行';
  });

  await check('SET3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base, '/settings/instruments');
      // #133: 追加の欄は押すまで無い（［＋ 銘柄を追加］ で追加のシート）
      expectEq(await p.locator('#settings-new-name').count(), 0, '押す前の追加の欄');
      // E13: 名前だけで足す
      await p.locator('#settings-inst-add').click();
      await waitSettingsSheet(p, 'settings-inst-add-sheet');
      await p.locator('#settings-new-name').fill('GOLD');
      await p.getByRole('button', { name: '追加', exact: true }).click();
      await p.getByRole('status').filter({ hasText: 'GOLD を追加しました' }).waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '足した後のシート');
      const row = p.locator('.setrow', { hasText: 'GOLD' });
      await row.filter({ hasText: '初期値のまま' }).waitFor();
      await row
        .filter({ hasText: 'その他 · 現物・CFD · 価格の通貨 未設定' })
        .filter({ hasText: '乗数 1 · 刻み 1' })
        .waitFor();
      const post = fake.writes.find((x) => x.key === 'POST /api/instruments');
      expectEq(JSON.stringify(post?.body), JSON.stringify({ name: 'GOLD' }), '足す本文');
      // E7（A7）: 口座 1 の許容リスク 2.5 → 警告を出して保存できる
      await openSettings(p, base, '/settings/accounts');
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
      await p.locator('#settings-account-save').click();
      await p.getByRole('status').filter({ hasText: '口座 1 を保存しました' }).waitFor();
      expectEq(
        fake.accounts.find((a) => a.id === 'default')?.riskTolerancePct,
        2.5,
        '保存した許容リスク',
      );
      // E8: 3.1 は送らない
      const before = fake.writes.length;
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-risk').fill('3.1');
      await p.locator('#settings-account-save').click();
      await p.locator('#settings-account-risk-error').waitFor();
      expectEq(fake.writes.length, before, '範囲外のときの書き込み');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E13 GOLD を名前だけで足す（初期値のまま・既定の 5 欄）、E7 は警告つきで保存、E8 は送らない';
  });

  await check('SET4', async () => {
    const focused = (p) => p.evaluate(() => document.activeElement?.id ?? '');
    // 誤りのまま [保存] → 最初の誤りの欄へフォーカス。口座の欄は欄の下の文言だけで、要約の知らせは出さない
    // （記録する画面の足す欄と同じ。#47 再レビュー 4）
    {
      const { c, p, fake, errors } = await recordContext({ failAccounts: 503 });
      try {
        seedSettings(fake);
        await openSettings(p, base, '/settings/accounts');
        await p.getByRole('button', { name: '口座 1 を編集' }).click();
        await waitSettingsSheet(p, 'settings-account-sheet');
        await p.locator('#settings-account-risk').fill('3.1');
        await p.locator('#settings-account-capital').fill('0');
        await p.locator('#settings-account-save').click();
        await p.locator('form.setform .field--error').nth(1).waitFor();
        expectEq(
          await p.getByRole('alert').filter({ hasText: '誤りのある欄があります' }).count(),
          0,
          '口座の欄の要約の知らせ',
        );
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-capital',
          '誤りの欄へ',
        );
        // 保存に失敗して戻った → 押した [保存] へ
        await p.locator('#settings-account-capital').fill('1000000');
        await p.locator('#settings-account-risk').fill('1');
        await p.locator('#settings-account-save').click();
        await p.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-save',
          '[保存] へ',
        );
        // やめる（#133: シートを Esc で閉じる）と口座の行へ戻る
        await p.keyboard.press('Escape');
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-edit-default',
          'やめた後のフォーカス',
        );
        // 銘柄: 誤りのまま [保存] → 最初の誤りの欄（価格の通貨）。シートの戻るの段を戻し終えてから移る
        await expectPollAsync(
          async () => p.evaluate(() => !history.state?.back),
          'シートの戻るの段を戻し終える',
        );
        await openSettings(p, base, '/settings/instruments');
        await p.getByRole('button', { name: 'US30 を編集' }).click();
        await waitSettingsSheet(p, 'settings-inst-sheet');
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

  await check('SET5', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: [ACC_ONE, ACC_D] });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openSettings(p, base, '/settings/accounts');
      await p.locator('#settings-account-add').click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-name').fill('口座 C');
      await p.locator('#settings-account-save').click();
      await p.getByRole('status').filter({ hasText: '口座 C を追加しました' }).waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '足した後のシート');
      const names = await p.locator('.setrow__name').allTextContents();
      expectEq(
        names.filter((n) => n.startsWith('口座')).join(' / '),
        '口座 1 / 口座 C / 口座 D',
        '名前の順',
      );
      const added = fake.accounts.find((a) => a.name === '口座 C');
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) ===
          `settings-account-edit-${added?.id}`,
        '新しい行の [直す] へ',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '設定で「口座 C」を足す → 名前の順の位置に入り、「口座 C を追加しました」、フォーカスは新しい行の [直す]';
  });

  // SET6（#133 の AC-1・AC-2・AC-7）: 設定の根のまとめた一覧（題の下に説明の文なし・区切り 5 つ・数の添え）→ 次の画面（口座・銘柄・
  // AI の利用状況・用語集）→ 戻るで根。直接開くと下に根を敷く（[/, /settings, /settings/accounts]）。AI の利用状況が読めなくても、
  // 根の行と口座の編集の [保存] は使える（#62 AC-7。別の画面になったので状態の検査から移した）
  await check('SET6', async () => {
    const { c, p, fake, errors } = await recordContext();
    const at = () => new URL(p.url()).pathname;
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      seedSettings(fake);
      fake.aiUsage = { status: 503, body: { error: 'read_unavailable' } };
      const usageAnswered = p.waitForResponse((r) => r.url().includes('/api/ai-usage'));
      await openSettings(p, base);
      expectEq(await p.locator('main .pagehead__desc').count(), 0, '題の下の説明の文');
      expectEq(
        (await p.locator('.setgroup__title').allTextContents()).join(' / '),
        '口座 / 記録 / 表示 / アプリ / アカウント',
        '区切り',
      );
      expectEq(
        (await p.locator('#settings-link-instruments .rowlink__meta').textContent())?.trim(),
        '3 件',
        '銘柄の添え',
      );
      // 口座の添えは中身（口座が 1 つ = 資金 · 許容。#133 デザインレビュー a-3）
      expectEq(
        (await p.locator('#settings-link-accounts .rowlink__meta').textContent())?.trim(),
        '1,000,000円 · 許容 1%',
        '口座の添え',
      );
      // AI が読めない: 添えは出さず、行は出す（応答が届いて描き直した後に数える）
      await usageAnswered;
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      expectEq(
        await p.locator('#settings-link-aiUsage .rowlink__meta').count(),
        0,
        'AI の添え（読めない）',
      );
      const visited = [];
      for (const [id, path, h1] of [
        ['accounts', '/settings/accounts', '口座'],
        ['instruments', '/settings/instruments', '銘柄'],
        ['aiUsage', '/settings/ai-usage', 'AI の利用状況'],
        ['glossary', '/glossary', '用語集'],
      ]) {
        await p.locator(`#settings-link-${id}`).click();
        await waitReady(p, h1);
        expectEq(at(), path, `${h1} の URL`);
        expectEq(
          (await p.locator('main .appbar__backlabel').first().textContent())?.trim(),
          '設定',
          `${h1} の「‹ 設定」`,
        );
        expectEq(
          await p.locator('.appnav a[aria-current="page"]').getAttribute('href'),
          '/settings',
          `${h1} のタブ`,
        );
        await p.goBack();
        await waitReady(p, '設定');
        visited.push(h1);
      }
      // 直接開く → 触った後の戻るで根、もう 1 回でホーム（9.7 の 5）
      await p.goto(`${base}/settings/accounts`);
      await waitReady(p, '口座');
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      if (!(await p.locator('#settings-account-save').isEnabled())) {
        throw new Error('利用状況が読めないときに口座の [保存] が押せない（#62 AC-7）');
      }
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        'Esc で閉じる',
      );
      await expectPollAsync(
        async () => p.evaluate(() => !history.state?.back),
        'シートの戻るの段を戻し終える',
      );
      await p.goBack();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '直接開いた口座の画面の戻る');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '根の戻る');
      // ［保存］ はシートの下に貼り付き、開いた直後（スクロールなし）から全部見える。資金の履歴の端まで
      // スクロールしても見えたまま（#133 デザインレビュー a-1）。口座（資金の履歴 3 件）・銘柄（7 欄）× 幅 360 / 390
      const inView = (sel) =>
        p.locator(sel).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const body = el.closest('.sheet__body')?.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.bottom <= window.innerHeight &&
            (!body || (r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5))
          );
        });
      const shown = [];
      for (const [w, h] of [
        [360, 780],
        [390, 844],
      ]) {
        await p.setViewportSize({ width: w, height: h });
        for (const [path, button, sheetId, save] of [
          [
            '/settings/accounts',
            '口座 1 を編集',
            'settings-account-sheet',
            '#settings-account-save',
          ],
          ['/settings/instruments', 'US30 を編集', 'settings-inst-sheet', '#settings-inst-save'],
        ]) {
          await openSettings(p, base, path);
          await p.getByRole('button', { name: button }).click();
          await waitSettingsSheet(p, sheetId);
          await p.waitForFunction((id) => document.activeElement?.id === `${id}-title`, sheetId);
          // 出てくる動き（下から）が終わってから測る
          await p
            .locator(`#${sheetId}`)
            .evaluate((d) =>
              Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
            );
          expectEq(
            await p.locator(`#${sheetId} .sheet__body`).evaluate((b) => b.scrollTop),
            0,
            `${w} ${button} の開いた直後のスクロール`,
          );
          expectEq(await inView(save), true, `${w} ${button} の開いた直後の [保存]`);
          await p.locator(`#${sheetId} .sheet__body`).evaluate((b) => {
            b.scrollTop = b.scrollHeight;
          });
          expectEq(await inView(save), true, `${w} ${button} の下までスクロールした [保存]`);
          await p.keyboard.press('Escape');
          await expectPollAsync(
            async () => p.evaluate(() => !history.state?.back),
            'シートの戻るの段を戻し終える',
          );
          shown.push(`${w}:${button}`);
        }
      }
      expectEq(errors.length, 0, 'ページのエラー');
      return `根（説明の文なし・区切り 5 つ・添え）→ ${visited.join('・')} → 戻るで根、直接開いた口座 → 戻るで根 → ホーム、AI が読めなくても [保存] は押せる、[保存] は開いた直後も下まで送っても見える（${shown.length} 件）`;
    } finally {
      await c.close();
    }
  });
}
