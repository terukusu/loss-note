import { join } from 'node:path';
import { opts, setupContext, waitReady } from '../base.mjs';
import { homeMonthTrades, installFakeApi, TX_H1 } from '../fixtures.mjs';
import {
  accountsGroup,
  pagesGroup,
  streakGroup,
  zoomHomeGroup,
  zoomPagesGroup,
} from '../groups.mjs';
import { toReview } from '../helpers.mjs';

/**
 * 画面の検査の単位「ホーム」: ホームの画面（口座 2 つ・直近の流れ ST1・今月の取引ありの文字の拡大）と、
 * ホームの行 T-H1・1 画面 HM1・押せるカード HM2
 */
export const id = 'home';
export const title = 'ホーム';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await accountsGroup(vp, id);
  await streakGroup(vp);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
  await zoomHomeGroup(vp);
}

/** 手順（T-H1・HM1・HM2） */
export async function flows(kit) {
  const { browser, base, signedIn, check, expectEq, path, recordContext } = kit;
  // T-H1（#128 で直近 3 件の詰めた行に）: 新しい順の 3 件、2 件目の危ない勝ちは B と同じ崩れの段。［記録する］ は下のタブだけ
  await check('T-H1', async () => {
    const { c, p, errors } = await recordContext({ trades: [...TX_H1].reverse() });
    try {
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('a.homerow').first().waitFor();
      const rows = await p.locator('a.homerow').evaluateAll((as) =>
        as.map((a) => ({
          href: a.getAttribute('href'),
          mark: a.querySelector('.homerow__mark')?.className ?? '',
          sub: a.querySelector('.homerow__sub')?.textContent ?? '',
        })),
      );
      expectEq(
        rows.map((r) => r.href).join(' '),
        '/trades/x-h0 /trades/x-h1 /trades/x-h2',
        '直近 3 件の並び',
      );
      if (!rows[1].sub.startsWith('危ない勝ち · ')) throw new Error(`2 件目: ${rows[1].sub}`);
      if (!rows[1].mark.includes('homerow__mark--break')) throw new Error('2 件目の段が崩れでない');
      // ホームの中に [記録する] を置かない（下のタブの ［＋ 記録］ の 1 か所。#127）。「すべての取引」の押せる行
      expectEq(await p.locator('main a[href="/record"]').count(), 0, 'ホームの中の [記録する]');
      await p.locator('main a.rowlink[href="/trades"]', { hasText: 'すべての取引' }).waitFor();
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'ホームに新しい順の 3 件（詰めた行）、2 件目の危ない勝ちは B と同じ崩れの段。[記録する] は下のタブだけ・「すべての取引」は押せる行';
  });

  // HM1（#128 AC-1・AC-2・AC-3・AC-5。ui-guidelines 9.4・9.10「1 画面に収まる」）: 等倍の文字のホームの縦のスクロール量
  // （scrollHeight − innerHeight）を 390×844 と 360×780 × ダーク / ライト × 取引 0 件・取引あり（今月の取引あり）・書きかけあり
  // で測る。期待はすべて 0px（低い窓は直近の取引を下の行から隠す。最低 1 行・書きかけの行があれば 2 件目から）。あわせて見える
  // 直近の行の数（390×844 = 3・360×780 = 2・360×780 の書きかけあり = 1）・今月の規律の数字の大きさ（数字の段 title
  // 28px + 単位 14px。#236・C62）・
  // 横スクロール 0。文字の拡大 200%（トークン 2 倍）では縦に伸びてよく（切らない = 直近の行の下端まで送れる）、横は 0
  await check('HM1', async () => {
    const homeTrades = [...homeMonthTrades(), ...TX_H1];
    const out = [];
    const fails = [];
    for (const theme of ['dark', 'light']) {
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
          await setupContext(c, theme);
          const api = await installFakeApi(c, { trades: homeTrades });
          const p = await c.newPage();
          const measureHome = () =>
            p.evaluate(() => {
              const se = document.scrollingElement;
              const last = document.querySelector('main .home')?.lastElementChild;
              return {
                v: se.scrollHeight - window.innerHeight,
                x: document.documentElement.scrollWidth - window.innerWidth,
                rows: [...document.querySelectorAll('.homerow')].filter((r) => r.offsetParent)
                  .length,
                xl: [...document.querySelectorAll('.homemonth .num--title')].map(
                  (e) => getComputedStyle(e).fontSize,
                ),
                units: [...document.querySelectorAll('.homemonth .numu--title .num-unit')].map(
                  (e) => getComputedStyle(e).fontSize,
                ),
                bottom: Math.round(last ? last.getBoundingClientRect().bottom : 0),
              };
            });
          const tag = `${w}x${h}-${theme}`;
          const expectZero = (m, state) => {
            if (m.x > 0) fails.push(`${tag} ${state}: 横スクロール ${m.x}px`);
            if (m.v > 0) fails.push(`${tag} ${state}: 縦スクロール ${m.v}px`);
          };
          // 取引あり
          await p.goto(`${base}/`);
          await waitReady(p, 'ホーム');
          await p.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
          let m = await measureHome();
          expectZero(m, '取引あり');
          const wantRows = h >= 820 ? 3 : 2;
          if (m.rows !== wantRows)
            fails.push(`${tag}: 見える直近の行 ${m.rows}（期待 ${wantRows}）`);
          if (m.xl.join(',') !== '28px,28px')
            fails.push(`${tag}: 今月の規律の数字 ${m.xl.join(',')}`);
          if (m.units.join(',') !== '14px,14px')
            fails.push(`${tag}: 今月の規律の単位 ${m.units.join(',')}`);
          out.push(`${tag} 取引あり 縦 ${m.v}px・中身の下端 ${m.bottom}px・行 ${m.rows}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${tag}-hm1-home.png`), fullPage: true });
          // 書きかけあり（記録する画面で LC を入れて戻る → 「記録の書きかけがあります ›」）
          await p.locator('#appnav-record').click();
          await toReview(p);
          await p.locator('#record-lc').fill('99.5');
          await p.goBack();
          await p.locator('.homedraft a.rowlink[href="/record"]').waitFor({ timeout: 15000 });
          await p.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
          m = await measureHome();
          expectZero(m, '書きかけ');
          // 低い窓（360×780）は書きかけの行があると 2 件目から隠す（最低 1 行。#128 デザイン AC-2）
          const wantDraftRows = h >= 820 ? 3 : 1;
          if (m.rows !== wantDraftRows)
            fails.push(`${tag} 書きかけ: 見える直近の行 ${m.rows}（期待 ${wantDraftRows}）`);
          out.push(`${tag} 書きかけ 縦 ${m.v}px・行 ${m.rows}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${tag}-hm1-draft.png`), fullPage: true });
          // 取引 0 件（書きかけは新しい文脈で無し）
          api.trades = [];
          const p2 = await c.newPage();
          await p2.goto(`${base}/`);
          await waitReady(p2, 'ホーム');
          await p2.getByText('最初の取引を記録しましょう').waitFor({ timeout: 15000 });
          m = await p2.evaluate(() => ({
            v: document.scrollingElement.scrollHeight - window.innerHeight,
            x: document.documentElement.scrollWidth - window.innerWidth,
          }));
          expectZero(m, '0 件');
          out.push(`${tag} 0 件 縦 ${m.v}px`);
          if (opts.shots)
            await p2.screenshot({ path: join(opts.shots, `${tag}-hm1-empty.png`), fullPage: true });
        } finally {
          await c.close();
        }
      }
    }
    // 文字の拡大 200%: 縦に伸びる（切らない）・横 0
    for (const [w, h] of [
      [360, 780],
      [390, 844],
    ]) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
      });
      try {
        await setupContext(c, 'dark', true);
        await installFakeApi(c, { trades: homeTrades });
        const p = await c.newPage();
        await p.goto(`${base}/`);
        await waitReady(p, 'ホーム');
        await p.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
        const z = await p.evaluate(() => {
          const se = document.scrollingElement;
          const last = [...document.querySelectorAll('.homerecent .rowlink')].at(-1);
          const b = last ? last.getBoundingClientRect().bottom + window.scrollY : 0;
          return {
            v: se.scrollHeight - window.innerHeight,
            x: document.documentElement.scrollWidth - window.innerWidth,
            reach: se.scrollHeight >= b,
          };
        });
        if (z.x > 0) fails.push(`拡大 ${w}x${h}: 横スクロール ${z.x}px`);
        if (!z.reach) fails.push(`拡大 ${w}x${h}: 「すべての取引」まで送れない（切れている）`);
        out.push(`拡大 ${w}x${h} 縦 ${z.v}px（伸びてよい）・横 ${z.x}px`);
      } finally {
        await c.close();
      }
    }
    if (fails.length > 0) throw new Error(fails.join(' / '));
    return out.join(' / ');
  });

  // HM2（#128 AC-6）: ホームの押せるカード。直近の流れ（点の上を押す）→ 取引のタブ、今月の規律（数字の上を押す）→ 振り返りの
  // タブを今月で（`/review?period=custom&from=<1 日>&to=<今日>`。タブは振り返り・戻るとホーム）、直近の行 → 詳細。
  // 見出しの行のリンクの当たりは 44px 以上
  await check('HM2', async () => {
    const { c, p, errors } = await recordContext({ trades: [...homeMonthTrades(), ...TX_H1] });
    try {
      await setupContext(c, 'dark');
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
      const hits = await p
        .locator('.homecard__link')
        .evaluateAll((as) =>
          as.map((a) => a.getBoundingClientRect()).map((r) => [r.width, r.height]),
        );
      for (const [wd, ht] of hits)
        if (wd < 44 || ht < 44) throw new Error(`カードのリンクの当たり ${wd}×${ht}`);
      // 直近の流れ: 点の並びの上を押す（カードの全面が当たり）
      // カードの全面に広げたリンク（::before）が点の上に重なるので、点の真ん中の座標を押す
      const dots = await p.locator('.streak__dots').boundingBox();
      await p.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
      await waitReady(p, '取引');
      expectEq(path(p), '/trades', '直近の流れ → 取引のタブ');
      expectEq(
        await p.locator('#appnav-trades').getAttribute('aria-current'),
        'page',
        '取引のタブ',
      );
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
      // 今月の規律: 数字の上を押す
      const num = await p.locator('.homemonth .num--title').first().boundingBox();
      await p.mouse.click(num.x + num.width / 2, num.y + num.height / 2);
      await waitReady(p, '振り返り');
      const now = new Date();
      const ymd = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      expectEq(
        new URL(p.url()).search,
        `?period=custom&from=${ymd(first)}&to=${ymd(now)}`,
        '今月の規律 → 振り返りの期間',
      );
      expectEq(
        await p.locator('#appnav-review').getAttribute('aria-current'),
        'page',
        '振り返りのタブ',
      );
      await p.locator('.review__meta').waitFor();
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('a.homerow').first().click();
      await p.locator('main h1', { hasText: '·' }).first().waitFor({ timeout: 15000 });
      if (!path(p).startsWith('/trades/')) throw new Error(`直近の行 → ${path(p)}`);
      // 幅 720 以上は上の帯に印と名前があるので、ホームの見出しの印と名前は見せない（2 回出さない。デザイン a6）
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      const brand = await p.evaluate(
        () =>
          [...document.querySelectorAll('.homehead__mark, .homehead__name')].filter(
            (e) => e.getBoundingClientRect().width > 0,
          ).length,
      );
      if (brand > 0) throw new Error(`1440 のホームの見出しの印と名前が見える（${brand} 個）`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '1440 は見出しの印と名前を隠す。直近の流れ（点の上）→ 取引のタブ、今月の規律（数字の上）→ 振り返りのタブを今月で・戻るとホーム、直近の行 → 詳細。カードのリンクの当たり 44 以上';
  });
}
