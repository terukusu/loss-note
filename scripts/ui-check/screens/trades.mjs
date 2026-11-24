import { join } from 'node:path';
import {
  expectPollAsync,
  measure,
  opts,
  settle,
  setupContext,
  TAP,
  THEMES,
  waitDetail,
  waitReady,
} from '../base.mjs';
import {
  ACC_LONG,
  ACC_ONE,
  CUT_ALLOWED,
  EXAMPLE_TRADES,
  FAKE_LONG,
  installFakeApi,
  LV_NOTE,
  TX_L1,
  TX_L2,
  TX_L3,
  TX_LV,
} from '../fixtures.mjs';
import { accountsGroup, pagesGroup, toastGroup, zoomPagesGroup } from '../groups.mjs';
import { closeSheet, deleteFromDetail, OPEN_SHEET, openInfo } from '../helpers.mjs';

/**
 * 画面の検査の単位「取引の一覧」: 一覧（トースト・口座 2 つ）と、一覧の行 T-L4・ページ分け TL-P1〜TL-P5・月の区切り TL-M1・
 * 口座の名前 TL-A1・いちばん長い値 LV1・消す T-X1・T-X2
 */
export const id = 'trades';
export const title = '取引の一覧';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await toastGroup(vp);
  await accountsGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
}

/** 手順（T-L4・T-L5・TL-P1・TL-P2・TL-P3・TL-P4・TL-P5・TL-M1・TL-A1・LV1・T-X1・T-X2） */
export async function flows(kit) {
  const {
    browser,
    base,
    signedIn,
    check,
    expectEq,
    path,
    recordContext,
    rowsOf,
    verdictOf,
    drawn,
    noDialogs,
    manyTrades,
    scrollToBottom,
    countText,
    monthTrades,
    monthsOf,
    checkMonths,
    stuckOf,
    monthY,
  } = kit;
  await check('T-L4', async () => {
    const { c, p, errors } = await recordContext({ trades: [TX_L1, TX_L2, TX_L3] });
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(2).waitFor();
      const rows = await rowsOf(p);
      expectEq(rows.map((r) => r.href).join(' '), '/trades/x-l2 /trades/x-l3 /trades/x-l1', '並び');
      expectEq(rows[0].badge, '計画どおりの勝ち', 'L2 の判定');
      // #132 で期待を変えた: 行はホームの詰めた行と同じ規則（R が出ない行は「—」を 1 つだけ、リスクだけ出ない行はリスクの段を
      // 出さない）。「—」の理由は一覧の下の脚注をやめ、題の行の「i」（説明のシート）に 1 回（設計書 9.3）。理由の文と件数は同じ
      if (!rows[0].text.includes('+2.0R') || rows[0].text.includes('リスク'))
        throw new Error(`L2 の行: ${rows[0].text}`);
      expectEq(rows[1].badge, '危ない勝ち', 'L3 の判定');
      if (!rows[1].badgeClass.includes('traderow__mark--break'))
        throw new Error('L3 の段が崩れでない');
      if ((rows[1].text.match(/—/g) ?? []).length !== 1)
        throw new Error(`L3 の行: ${rows[1].text}`);
      expectEq(await p.locator('.tradelist__notes').count(), 0, '一覧の下の脚注');
      await openInfo(p, '「表示されない値」の説明');
      const notes = (await p.locator(OPEN_SHEET).textContent()) ?? '';
      for (const want of [
        'リスクの「—」: 資金を設定すると表示されます（1 件）',
        'R・リスクの「—」: LC が無いため表示されません（1 件）',
      ]) {
        if (!notes.includes(want)) throw new Error(`「—」の理由のシートに「${want}」が無い`);
      }
      await closeSheet(p);
      expectEq(rows[2].badge, 'A いい損失', 'L1 の判定');
      if (!rows[2].text.includes('−1.0R') || !rows[2].text.includes('リスク 0.5%'))
        throw new Error(`L1 の行: ${rows[2].text}`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '並び L2 → L3 → L1、各行の判定・R・リスク（出ない値は「—」を 1 つ、理由は題の行の「i」のシートに 1 回）が例どおり';
  });

  // T-L5（#227 AC-7・C59）: 危ない勝ちの行の R は静かな形。計画どおりの勝ちの行の R より小さい文字で、太字でない。
  // 行の R は数字の段 row（20px。#236・C62）。押した詳細の判定の枠は数字の段（hero の R・row のリスク / 損益）を持たず、
  // 崩れの文が数の段より先。
  // 360×780 × ダーク / ライト。--shots なら一覧と詳細を撮る
  await check('T-L5', async () => {
    const trades = [TX_L2, ...monthTrades(5)];
    let n = 0;
    for (const theme of THEMES) {
      const { c, p, errors } = await recordContext({ trades });
      try {
        await setupContext(c, theme);
        await p.setViewportSize({ width: 360, height: 780 });
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p
          .locator('a.traderow')
          .nth(trades.length - 1)
          .waitFor();
        const rs = await p.locator('a.traderow').evaluateAll((as) =>
          as.map((a) => {
            const r = a.querySelector('.traderow__r');
            const st = r ? getComputedStyle(r) : null;
            return {
              grade: a.querySelector('.traderow__grade')?.textContent ?? '',
              r: r?.textContent ?? '',
              quiet: r?.classList.contains('traderow__r--quiet') ?? false,
              size: st ? Number.parseFloat(st.fontSize) : 0,
              weight: st ? Number(st.fontWeight) : 0,
            };
          }),
        );
        const risky = rs.filter((r) => r.grade === '危ない勝ち' && /R$/.test(r.r));
        const safe = rs.find((r) => r.grade === '計画どおりの勝ち');
        if (safe && safe.size !== 20)
          throw new Error(`${theme}: 計画どおりの勝ちの行の R ${safe.size}px（数字の段 row 20px）`);
        if (risky.length === 0 || !safe)
          throw new Error(`行がそろっていない: ${JSON.stringify(rs)}`);
        for (const r of rs) {
          if (r.quiet !== (r.grade === '危ない勝ち' && /R$/.test(r.r)))
            throw new Error(`静かな形の印が危ない勝ちの行だけでない: ${JSON.stringify(r)}`);
        }
        for (const r of risky) {
          if (!(r.size < safe.size))
            throw new Error(
              `${theme}: 危ない勝ちの R ${r.size}px ≥ 計画どおりの勝ち ${safe.size}px`,
            );
          if (!(r.weight < 600)) throw new Error(`${theme}: 危ない勝ちの R の太さ ${r.weight}`);
        }
        if (opts.shots) {
          await p.screenshot({ path: join(opts.shots, `360x780-${theme}-trades-risky-quiet.png`) });
        }
        await p.locator('a.traderow', { hasText: '危ない勝ち' }).last().click();
        await waitDetail(p);
        const v = await p
          .locator('main .verdict')
          .first()
          .evaluate((el) => {
            const kids = [...el.querySelectorAll('*')];
            const at = (sel) => kids.findIndex((k) => k.matches(sel));
            return {
              xl: el.querySelectorAll('.num--display, .num--hero, .num--title, .num--row').length,
              breach: el.querySelector('.verdict__breach-what')?.textContent ?? '',
              cf: el.querySelector('.verdict__breach-if')?.textContent ?? '',
              order: at('.verdict__breach') < at('.verdict__stats'),
              dup: [...el.querySelectorAll('.reasons__item')].some((li) =>
                li.textContent?.startsWith('LC を広げた'),
              ),
            };
          });
        if (v.xl !== 0) throw new Error(`${theme}: 詳細の判定の枠に主役の段の数字が ${v.xl} 個`);
        if (!v.breach.startsWith('LC を広げた')) throw new Error(`${theme}: 崩れの文 ${v.breach}`);
        expectEq(v.cf, 'LC で切っていれば −1.0R', '反実の 1 行');
        if (!v.order) throw new Error(`${theme}: 崩れの文が数の段より後`);
        if (v.dup) throw new Error(`${theme}: 崩れの文が理由の一覧に重なっている`);
        if (opts.shots) {
          await p.screenshot({ path: join(opts.shots, `360x780-${theme}-detail-risky.png`) });
        }
        expectEq(errors.length, 0, 'ページのエラー');
        n++;
      } finally {
        await c.close();
      }
    }
    return `危ない勝ちの行の R だけが静かな形（計画どおりの勝ちの R より小さい・太字でない）、詳細の判定の枠は主役の段の数字 0・崩れの文と反実の 1 行が数の段より先・理由の一覧に重ねない（360×780 × ${n} テーマ）`;
  });

  await check('TL-P1', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(120) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      expectEq(await p.locator('a.traderow').count(), 50, '最初の行の数');
      expectEq(
        (await countText(p))?.trim(),
        '50 件を表示中（決済の新しい順・続きあり）',
        '最初の件数の文',
      );
      expectEq(fake.tradeGets.join(' | '), 'limit=50', '最初の要求');
      // 末尾へ送ると続きが自動で出る（ボタンを押さない）
      await scrollToBottom(p);
      await p.locator('a.traderow').nth(99).waitFor({ timeout: 5000 });
      await scrollToBottom(p);
      await p.getByText('全 120 件（決済の新しい順）').waitFor({ timeout: 5000 });
      expectEq(await p.locator('a.traderow').count(), 120, '最後の行の数');
      expectEq(await p.locator('.tradelist-more').count(), 0, '最後まで読んだ後の末尾の段');
      expectEq(
        (await p.locator('.tradelist-end').textContent())?.trim(),
        '全 120 件を表示しました',
        '末尾の文',
      );
      expectEq(
        (await p.locator('main [role="status"]').last().textContent())?.trim(),
        '全 120 件を表示しました',
        '読み上げの欄',
      );
      const gets = fake.tradeGets.length;
      expectEq(gets, 3, '一覧の要求の数');
      await scrollToBottom(p);
      await p.waitForTimeout(300);
      expectEq(fake.tradeGets.length, gets, '最後まで読んだ後の要求');
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '幅 360 の横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '120 件: 最初 50 行 → 末尾へ送ると 100 → 120 行で「全 120 件」・要求 3 回で止まる・幅 360 で横スクロール 0';
  });

  await check('TL-P2', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(120) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      await scrollToBottom(p);
      await p.locator('a.traderow').nth(99).waitFor({ timeout: 5000 });
      // 80 行目まで送ってから詳細を開き、戻る
      const row = p.locator('a.traderow').nth(79);
      await row.scrollIntoViewIfNeeded();
      await settle(p);
      const before = await p.evaluate(() => window.scrollY);
      const rowsBefore = await p.locator('a.traderow').count();
      await row.click();
      await waitReady(p, 'US30 · L');
      fake.tradesPageDelayMs = 1500;
      await p.goBack();
      await waitReady(p, '取引');
      // 読み直しを待たせている間も、読み込み済みの行と位置が出ている
      expectEq(await p.locator('a.traderow').count(), rowsBefore, '戻った直後の行の数');
      const after = await p.evaluate(() => window.scrollY);
      if (Math.abs(after - before) > 4)
        throw new Error(`戻った後の位置 ${after}px（期待 ${before}px）`);
      fake.tradesPageDelayMs = 0;
      await p.waitForTimeout(1800);
      expectEq(await p.locator('a.traderow').count(), rowsBefore, '読み直しの後の行の数');
      expectEq(errors.length, 0, 'ページのエラー');
      return `${rowsBefore} 行まで読んで 80 行目の詳細 → 戻る: ${rowsBefore} 行と位置（${after}px / ${before}px）が保たれ、読み直しの後も同じ`;
    } finally {
      await c.close();
    }
  });

  await check('TL-P3', async () => {
    const { c, p, errors } = await recordContext({ trades: manyTrades(70) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      // 続きの読みを失敗させる → 50 行は残り、文言と [再読み込み]
      const nextPage = (url) => url.pathname === '/api/trades' && url.searchParams.has('cursor');
      await p.route(nextPage, (r) =>
        r.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"unavailable"}',
        }),
      );
      await scrollToBottom(p);
      await p.getByText('続きを読み込めませんでした。').waitFor({ timeout: 5000 });
      expectEq(await p.locator('a.traderow').count(), 50, '失敗の後の行の数');
      if (opts.shots) {
        await p.screenshot({ path: join(opts.shots, '360x780-trades-more-failed.png') });
      }
      await p.unroute(nextPage);
      await p.getByRole('button', { name: '再読み込み' }).click();
      await p.getByText('全 70 件（決済の新しい順）').waitFor({ timeout: 5000 });
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '幅 360 の横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '続きの読みの失敗: 50 行が残り、文言と [再読み込み] → 押すと「全 70 件」・横スクロール 0';
  });

  // TL-P4（#87 のコードレビュー 1・2）: キーで [続きを読み込む] を押すと、読み込み中も同じボタンにフォーカスが残り
  // （aria-busy）、末尾の段の高さが変わらない。最後まで読むとフォーカスは読み足した最初の行へ移る（body に落ちない）
  await check('TL-P4', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(70) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      fake.tradesPageDelayMs = 1500;
      const btn = p.locator('#trades-more');
      const h0 = await p
        .locator('.tradelist-more')
        .evaluate((e) => e.getBoundingClientRect().height);
      await btn.focus();
      await p.keyboard.press('Enter');
      await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
      expectEq(
        await p.evaluate(() => document.activeElement?.id),
        'trades-more',
        '読み込み中のフォーカス',
      );
      const h1 = await p
        .locator('.tradelist-more')
        .evaluate((e) => e.getBoundingClientRect().height);
      if (Math.abs(h1 - h0) > 0.5) throw new Error(`末尾の段の高さ ${h0}px → ${h1}px`);
      await p.getByText('全 70 件（決済の新しい順）').waitFor({ timeout: 5000 });
      const active = await p.evaluate(() => ({
        tag: document.activeElement?.tagName,
        href: document.activeElement?.getAttribute('href'),
      }));
      expectEq(`${active.tag} ${active.href}`, 'A /trades/p050', '最後まで読んだ後のフォーカス');
      expectEq(errors.length, 0, 'ページのエラー');
      return `Enter → 読み込み中も同じボタンにフォーカス（高さ ${h0}px のまま）→ 最後まで読むと 51 行目へフォーカス`;
    } finally {
      await c.close();
    }
  });

  // TL-P5（#87 のデザインレビュー）: 続きを読んでいる・最後まで読んだ・件数の多い一覧・戻った位置・続きの読みの失敗を
  // 360 / 1440 × ダーク / ライトで測り（横スクロール 0）、--shots なら撮る
  await check('TL-P5', async () => {
    const out = [];
    for (const [w, hgt] of [
      [360, 780],
      [1440, 900],
    ]) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
          ...(w < 720 ? { hasTouch: true } : {}),
        });
        await setupContext(ctx, theme);
        const fake = await installFakeApi(ctx, { trades: manyTrades(120) });
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        const snap = async (slug) => {
          const overflow = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (overflow !== 0) throw new Error(`${w} ${theme} ${slug}: 横スクロール ${overflow}px`);
          if (opts.shots) {
            await p.screenshot({
              path: join(opts.shots, `${w}x${hgt}-${theme}-trades-${slug}.png`),
            });
          }
        };
        try {
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow').nth(49).waitFor();
          await snap('more-many');
          // 続きを読んでいる（応答を待たせる）
          fake.tradesPageDelayMs = 3000;
          await scrollToBottom(p);
          await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
          await p.evaluate(() =>
            document.querySelector('.tradelist-more')?.scrollIntoView({ block: 'end' }),
          );
          await snap('more-loading');
          fake.tradesPageDelayMs = 0;
          await p.locator('a.traderow').nth(99).waitFor({ timeout: 6000 });
          await scrollToBottom(p);
          await p.locator('.tradelist-end').waitFor({ timeout: 5000 });
          await scrollToBottom(p);
          await settle(p);
          await snap('more-end');
          // 80 行目の詳細から戻った位置
          const row = p.locator('a.traderow').nth(79);
          await row.scrollIntoViewIfNeeded();
          await settle(p);
          await row.click();
          await waitReady(p, 'US30 · L');
          await p.goBack();
          await waitReady(p, '取引');
          await p.waitForTimeout(300);
          await snap('more-restored');
          // 続きの読みの失敗（開き直して 2 ページ目を断る）
          const nextPage = (url) =>
            url.pathname === '/api/trades' && url.searchParams.has('cursor');
          await p.route(nextPage, (r) =>
            r.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":"unavailable"}',
            }),
          );
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow').nth(49).waitFor();
          await scrollToBottom(p);
          await p.getByText('続きを読み込めませんでした。').waitFor({ timeout: 5000 });
          await scrollToBottom(p);
          await settle(p);
          await snap('more-failed');
          if (errors.length > 0) throw new Error(`${w} ${theme}: ページのエラー ${errors.length}`);
          out.push(`${w}-${theme}`);
        } finally {
          await ctx.close();
        }
      }
    }
    return `${out.join('・')}: 件数の多い一覧・続きを読んでいる・最後まで・戻った位置・続きの読みの失敗で横スクロール 0`;
  });

  await check('TL-M1', async () => {
    const out = [];
    for (const theme of THEMES) {
      // 月の境は端末の時間帯で決まるので、期待の数を固定するため日本時間で開く
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        timezoneId: 'Asia/Tokyo',
      });
      await setupContext(ctx, theme);
      const fake = await installFakeApi(ctx, { trades: monthTrades(60) });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      const shot = async (slug) => {
        if (opts.shots) {
          await p.screenshot({ path: join(opts.shots, `390x844-${theme}-trades-${slug}.png`) });
        }
      };
      try {
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('a.traderow').nth(49).waitFor();
        await settle(p);
        await shot('list');
        const first = await monthsOf(p);
        if (first.length < 2) throw new Error(`最初のページの月 ${first.length}`);
        checkMonths(first, false, `${theme} 最初の 50 件`);
        // 期待の数（手で数えた値。i = 0〜59 のうち i % 3 = 2 か i % 5 = 4 は計画どおりでない。日本時間の月）
        expectEq(
          first.map((m) => `${m.title} ${m.sum}`).join(' / '),
          '2026年11月 7 件 · 計画どおり 4 / 2026年10月 20 件 · 計画どおり 10 / 2026年9月 20 件 · 計画どおり 12 / 2026年8月 3 件を表示中 · 続きあり',
          `${theme}: 最初の 50 件の月の数`,
        );
        // (2) 1 つ目の月の途中まで送る → 1 つ目の見出しだけが貼り付く（上の帯の下端と同じ位置）
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 0)) + 240);
        await settle(p);
        const s1 = await stuckOf(p);
        expectEq(s1.at.join(','), first[0].title, `${theme}: 1 つ目の月で貼り付く見出し`);
        if (s1.barBottom === null) throw new Error(`${theme}: 上の帯（.rootbar）が無い`);
        if (Math.abs(s1.barBottom - s1.top) > 1)
          throw new Error(`${theme}: 貼り付く位置 ${s1.top}px と上の帯の下端 ${s1.barBottom}px`);
        // 2 つ目の月の頭を少し過ぎるまで送る → 2 つ目の見出しが貼り付き、1 つ目は押し出されている
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 1)) - s1.top + 120);
        await settle(p);
        const s2 = await stuckOf(p);
        expectEq(s2.at.join(','), first[1].title, `${theme}: 2 つ目の月で貼り付く見出し`);
        // 月の境の手前（2 つ目の見出しが 1 つ目を押し出している途中）を撮る
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 1)) - s1.top - 20);
        await settle(p);
        await shot('month-boundary');
        // (3) 最後まで読む
        for (let k = 0; k < 5 && (await p.locator('.tradelist-more').count()) > 0; k++) {
          await scrollToBottom(p);
          await p.waitForTimeout(400);
        }
        await p.getByText('全 60 件（決済の新しい順）').waitFor({ timeout: 5000 });
        const all = await monthsOf(p);
        checkMonths(all, true, `${theme} 最後まで`);
        expectEq(
          all.map((m) => m.sum).join(' / '),
          '7 件 · 計画どおり 4 / 20 件 · 計画どおり 10 / 20 件 · 計画どおり 12 / 13 件 · 計画どおり 6',
          `${theme}: 最後まで読んだ月の数`,
        );
        expectEq(
          all.reduce((a, m) => a + m.rows, 0),
          60,
          `${theme}: 月の数の合計`,
        );
        // 続きの読み込み中（開き直して 2 ページ目の応答を待たせる）
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('a.traderow').nth(49).waitFor();
        fake.tradesPageDelayMs = 3000;
        await scrollToBottom(p);
        await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
        // 末尾まで送る（下のタブの上に読み込み中のボタンが見える位置）
        await scrollToBottom(p);
        await settle(p);
        await shot('more-loading');
        const busy = await stuckOf(p);
        expectEq(busy.at.length, 1, `${theme}: 読み込み中に貼り付く見出しの数`);
        fake.tradesPageDelayMs = 0;
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expectEq(overflow, 0, `${theme}: 横スクロール`);
        if (errors.length > 0) throw new Error(`${theme}: ページのエラー ${errors.length}`);
        out.push(`${theme} ${all.map((m) => m.sum).join(' / ')}`);
      } finally {
        await ctx.close();
      }
    }
    return `月の見出しの数が行と合い（続きの間は古い月だけ「続きあり」）、貼り付く見出しは上の帯の下に 1 つ: ${out.join('｜')}`;
  });

  // TL-A1（#132 デザイン a1）: 口座 2 つ（1 つは 10 字以上の長い名前）の一覧を 360×780・390×844 × ダーク / ライトで開き、
  // 口座の名前は 1 行目の「銘柄 · L / S」の後ろにだけあり、見えている口座は 4 字ぶん以上の幅（「…」だけの口座が 0）、
  // 見えない行は区切りごと次の行へ落ちている（1 行目の高さは 1 行のまま）、行の文字に「· ·」の並びが 0。--shots なら撮る
  await check('TL-A1', async () => {
    const out = [];
    const trades = EXAMPLE_TRADES.map((t, i) =>
      i % 2 === 0 ? { ...t, record: { ...t.record, accountId: ACC_LONG.id } } : t,
    );
    for (const [w, hgt] of [
      [360, 780],
      [390, 844],
    ]) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
          hasTouch: true,
        });
        await setupContext(ctx, theme);
        await installFakeApi(ctx, { trades, accounts: [ACC_ONE, ACC_LONG] });
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        try {
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow .traderow__account').first().waitFor();
          const rows = await p.locator('a.traderow').evaluateAll((as) =>
            as.map((a) => {
              const title = a.querySelector('.traderow__title').getBoundingClientRect();
              const head = a.querySelector('.traderow__head').getBoundingClientRect();
              const acc = a.querySelector('.traderow__account');
              const r = acc?.getBoundingClientRect();
              const fs = acc ? Number.parseFloat(getComputedStyle(acc).fontSize) : 0;
              return {
                text: a.textContent ?? '',
                sub: a.querySelector('.traderow__sub')?.textContent ?? '',
                lineH: title.height,
                headH: head.height,
                acc: acc
                  ? {
                      shown: r.top < title.bottom - 1 && r.bottom > title.top + 1,
                      inside: r.top >= title.top - 1,
                      width: r.width,
                      fs,
                    }
                  : null,
              };
            }),
          );
          const withAcc = rows.filter((r) => r.acc !== null);
          if (withAcc.length !== rows.length) throw new Error('口座の名前の無い行がある');
          let shown = 0;
          for (const r of rows) {
            if (r.text.includes('· ·') || r.text.includes('··'))
              throw new Error(`「· ·」: ${r.text}`);
            if (r.sub.includes('口座')) throw new Error(`2 行目に口座: ${r.sub}`);
            if (r.lineH > r.headH * 1.6) throw new Error(`1 行目が 2 行になった: ${r.text}`);
            if (r.acc?.shown) {
              shown++;
              if (r.acc.width < 4 * r.acc.fs - 0.5)
                throw new Error(
                  `口座の幅 ${r.acc.width}px（4 字 ${4 * r.acc.fs}px 未満）: ${r.text}`,
                );
            }
          }
          if (shown === 0) throw new Error('見えている口座が 0');
          const overflow = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expectEq(overflow, 0, `${w} ${theme}: 横スクロール`);
          if (opts.shots) {
            await p.screenshot({
              path: join(opts.shots, `${w}x${hgt}-${theme}-trades-accounts-long.png`),
              fullPage: true,
            });
          }
          if (errors.length > 0) throw new Error(`${w} ${theme}: ページのエラー ${errors.length}`);
          out.push(`${w}-${theme} ${shown}/${rows.length}`);
        } finally {
          await ctx.close();
        }
      }
    }
    return `口座は 1 行目だけ・見えるものは 4 字以上・「· ·」0（見えた口座/行: ${out.join('・')}）`;
  });

  // LV1（#176。ui-guidelines 10.3「いちばん長い実際の桁で確かめる」）: いちばん長い値の取引 3 件（TX_LV）と長い名前の口座で、
  // 360×780 のダークの一覧・ホーム・詳細（チャート 2 枚 + 40 字の一言の付属）を開き、
  //   - 省略してよい所（CUT_ALLOWED）の外の要素で、実際に「…」が出た件数（text-overflow が ellipsis で scrollWidth > clientWidth）が 0
  //   - 判定の名前・日時・時間足の要素（一覧の 2 行目・ホームの 2 行目・詳細の札）が箱の中に全部ある
  //   - 横スクロール 0px・部品のはみ出し 0 件（measure）
  // を見る。--shots なら撮る
  await check('LV1', async () => {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
      hasTouch: true,
    });
    await setupContext(ctx, 'dark');
    const fake = await installFakeApi(ctx, { trades: TX_LV, accounts: [ACC_ONE, ACC_LONG] });
    fake.instruments.push(FAKE_LONG);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const cutsOf = () =>
      p.evaluate((allowed) => {
        const out = [];
        for (const el of document.querySelectorAll('main *, header *, nav *, dialog *')) {
          const cs = getComputedStyle(el);
          if (cs.textOverflow !== 'ellipsis' || cs.display === 'none') continue;
          if (el.scrollWidth <= el.clientWidth + 1) continue;
          if (allowed.some((sel) => el.matches(sel))) continue;
          const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName;
          out.push(`${cls}「${(el.textContent || '').trim().slice(0, 20)}」`);
        }
        return out;
      }, CUT_ALLOWED);
    // 値の要素が自分の箱にも、切る祖先の箱にも収まる（折り返しは良い。切れ・はみ出しは外れ）
    const valuesCut = (sel) =>
      p.locator(sel).evaluateAll((els) =>
        els.flatMap((el) => {
          const bad = [];
          const r = el.getBoundingClientRect();
          // 隠した行（低い窓のホームの 3 件目 = display: none）は見ない
          if (r.width === 0 && r.height === 0) return [];
          if (el.scrollWidth > el.clientWidth + 1) bad.push('横に切れる');
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
              bad.push(`${(a.className || a.tagName).toString().split(' ')[0]} の外`);
            break;
          }
          return bad.map(
            (b) => `${el.className.split(' ')[0]}「${(el.textContent || '').trim()}」${b}`,
          );
        }),
      );
    const out = [];
    const fails = [];
    const look = async (what, slug, values) => {
      const cuts = await cutsOf();
      if (cuts.length > 0) fails.push(`${what}: 表に無い「…」${cuts.join('・')}`);
      const vc = await valuesCut(values);
      if (vc.length > 0) fails.push(`${what}: ${vc.join('・')}`);
      const m = await measure(p, false, TAP);
      if (m.h !== 0) fails.push(`${what}: 横スクロール ${m.h}px`);
      if (m.clipped.length > 0) fails.push(`${what}: はみ出し ${m.clipped.join('・')}`);
      if (opts.shots) {
        await p.screenshot({ path: join(opts.shots, `360x780-dark-${slug}.png`), fullPage: true });
      }
      out.push(`${what} …${cuts.length}`);
    };
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(2).waitFor();
      const grades = await p.locator('.traderow__grade').allTextContents();
      if (!grades.includes('計画どおりの勝ち')) throw new Error(`一覧の判定: ${grades.join('・')}`);
      // 一覧の時刻は月の見出しの下なので「12/31 23:59」（年は見出し「2025年12月」）。いちばん長い月日 + 時刻
      const when = await p.locator('.traderow__when').first().textContent();
      if (!(when ?? '').includes('12/31 23:59')) throw new Error(`一覧の時刻: ${when}`);
      await look('一覧', 'longest-trades', '.traderow__grade, .traderow__when');

      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('a.homerow').first().waitFor();
      await p.locator('.homerow__account').first().waitFor();
      await look('ホーム', 'longest-home', '.homerow__grade, .homerow__date');

      await p.goto(`${base}/trades/x-lv2`);
      await waitDetail(p);
      await p.locator('canvas.dchart__canvas').nth(2).waitFor();
      const caps = await p.locator('.dchart__cap').allTextContents();
      if (!caps.some((t) => t === `${LV_NOTE} · 15 分足`))
        throw new Error(`詳細の札: ${caps.join('・')}`);
      await look('詳細', 'longest-detail', '.dchart__cap, .dchart__tf');
      // 札の時間足は 1 つの塊（1 行）
      const tfLines = await p.locator('.dchart__tf').evaluateAll((els) =>
        els.map((el) => {
          const tops = new Set([...el.getClientRects()].map((r) => Math.round(r.top)));
          return tops.size;
        }),
      );
      if (tfLines.some((n) => n !== 1))
        fails.push(`詳細: 時間足が塊の中で折れる ${tfLines.join(',')}`);
      if (errors.length > 0) fails.push(`ページのエラー ${errors.length}`);
    } finally {
      await ctx.close();
    }
    if (fails.length > 0) throw new Error(fails.join(' | '));
    return `360×780 ダークのいちばん長い値: 表に無い「…」0・値の切れ 0・横スクロール 0・はみ出し 0（${out.join('・')}）`;
  });

  await check('T-X1', async () => {
    const { c, p, fake, errors } = await recordContext();
    let dialogs = 0;
    p.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').first().waitFor();
      const n = (await rowsOf(p)).length;
      await p.locator('a.traderow[href="/trades/x-d1"]').click();
      await waitReady(p, 'US30 · L');
      await deleteFromDetail(p);
      await waitReady(p, '取引');
      expectEq(path(p), '/trades', '消した後の URL');
      await p
        .locator('.toast')
        .filter({ hasText: 'US30 L' })
        .filter({ hasText: 'を削除しました' })
        .waitFor();
      // [消す] の後のフォーカスは [元に戻す]（8 秒の間にキーで届く。レビュー指摘 3）
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id ?? '')) === 'toast-undo',
        '[元に戻す] へフォーカス',
      );
      expectEq(dialogs, 0, 'ダイアログ');
      expectEq(await noDialogs(p), 0, '確認の画面');
      const rows = await rowsOf(p);
      expectEq(rows.length, n - 1, '一覧の件数');
      if (rows.some((r) => r.href === '/trades/x-d1')) throw new Error('消した取引が一覧に残る');
      // アプリの中で詳細の URL を開く（戻る・進むと同じ道）
      await p.evaluate(() => {
        window.history.pushState(null, '', '/trades/x-d1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitReady(p, '取引の詳細');
      await p.getByText('この取引は見つかりません').waitFor();
      expectEq(fake.deletes.length, 0, '取り消しの時間の間の DELETE');
      // 取り消しの時間（8 秒）が過ぎたら DELETE が 1 回。直接開いても見つからない
      await p.waitForTimeout(8500);
      await expectPollAsync(async () => fake.deletes.length === 1, 'DELETE が届く');
      expectEq(fake.deletes.join(' '), 'x-d1', 'DELETE の取引');
      await p.reload();
      await waitReady(p, '取引の詳細');
      await p.getByText('この取引は見つかりません').waitFor();
      expectEq(fake.deletes.length, 1, 'DELETE の数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '確認なしで消える、一覧 N → N − 1、アプリの中で開くと見つからない、8 秒後に DELETE 1 回・再読み込みでも見つからない';
  });

  await check('T-X2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await deleteFromDetail(p);
      await waitReady(p, '取引');
      await p.getByRole('button', { name: '元に戻す' }).click();
      await p.locator('a.traderow[href="/trades/x-d1"]').waitFor();
      await p.waitForTimeout(8500);
      expectEq(fake.deletes.length, 0, 'DELETE');
      await p.locator('a.traderow[href="/trades/x-d1"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-d1', '同じ ID');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await expectPollAsync(
        async () => (await drawn(p)).filter((d) => d.alpha > 0).length === 2,
        '2 枚',
      );
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '判定');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '[元に戻す] で DELETE を送らず、同じ ID が一覧に戻り、詳細に B と 2 枚のチャート';
  });
}
