import { join } from 'node:path';
import {
  expectPollAsync,
  opts,
  settle,
  setupContext,
  THEMES,
  waitDetail,
  waitReady,
} from '../base.mjs';
import { exampleTrade, waitSaved } from '../fixtures.mjs';
import { accountsGroup, chartsGroup, fxGroup, pagesGroup, zoomPagesGroup } from '../groups.mjs';
import {
  closeSheet,
  closeSheets,
  deleteFromDetail,
  EX_E1,
  expectSheetInWindow,
  fillRecord,
  openFields,
  openFieldsScreen,
  openInfo,
  openRecord,
  settleSheet,
  sheetBox,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「取引の詳細」: 詳細（物差し・口座 2 つ・外貨建て・心理・Good / More・チャート 7 枚）と、
 * 置き換え RP1・詳細と編集の「i」DI1・T-D1〜T-D3・H58・D131
 */
export const id = 'detail';
export const title = '取引の詳細';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await accountsGroup(vp, id);
  await fxGroup(vp, id);
  await chartsGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
}

/** 手順（RP1・DI1・T-D1・H58・T-D2・T-D3・D131） */
export async function flows(kit) {
  const {
    base,
    check,
    expectEq,
    recordContext,
    popCount,
    verdictOf,
    drawn,
    OWNER_ACCOUNTS,
    resnapTrade,
  } = kit;
  // RP1（#57 再レビュー 3 の B3・N14）: 「i」を開いて閉じた直後（積んだ段を戻している途中）に画面を置き換える操作（[消す] = 一覧へ・
  // [保存] = 詳細へ）で移っても、戻るで消した取引・保存し終えた編集の画面へ戻らない（積んだ段を戻してから置き換える）。説明のシートは
  // モーダルで、開いている間は後ろを押せない（#129）ので、Esc で閉じてキーで押す・✕ で閉じて速くクリックするの両方
  await check('RP1', async () => {
    const out = [];
    for (const how of ['key', 'click']) {
      const { c, p, errors } = await recordContext();
      try {
        await p.setViewportSize({ width: 360, height: 780 });
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('#record-submit').click();
        await waitSaved(p, '記録しました');
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('main a[href^="/trades/"]').first().click();
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        const detail = new URL(p.url()).pathname;
        // 保存: 詳細 → 編集 →「i」を開いたまま [保存] → 詳細 → 戻る → 詳細（編集の画面ではない）
        await p.locator(`main a[href="${detail}/edit"]`).first().click();
        await waitReady(p, '取引を編集');
        await openInfo(p, '「LC を動かしたか」の説明');
        const save = p.locator('#edit-submit');
        if (how === 'key') {
          await p.keyboard.press('Escape');
          await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
          await save.focus();
          await p.keyboard.press('Enter');
        } else {
          await closeSheet(p);
          await save.click();
        }
        // 詳細の見出しは取引の名前（読み込み中だけ「取引の詳細」）なので、URL と判定の枠で着いたことを見る
        await expectPollAsync(async () => new URL(p.url()).pathname === detail, '保存の後に詳細へ');
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        // 保存の後は前の画面（詳細）へ戻る（9.7 の 6・#127。置き換えではないので、次の戻るは詳細の前 = 一覧。編集の画面へ戻らない）
        await p.goBack();
        await p.waitForTimeout(500);
        expectEq(
          new URL(p.url()).pathname,
          '/trades',
          `${how}: 保存の後の戻る（編集の画面へ戻らない）`,
        );
        // 削除: 詳細で「i」を開いたまま [消す] → 一覧 → 戻る → 一覧より前（消した取引の詳細ではない）
        await p.goto(`${base}${detail}`);
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        await openInfo(p, '「判定」の説明');
        if (how === 'key') {
          await p.keyboard.press('Escape');
          await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
          await deleteFromDetail(p, 'key');
        } else {
          await closeSheet(p);
          await deleteFromDetail(p);
        }
        await waitReady(p, '取引');
        await p.goBack();
        await p.waitForTimeout(500);
        const back = new URL(p.url()).pathname;
        if (back === detail)
          throw new Error(`${how}: 削除の後の戻るで消した取引（${back}）へ戻った`);
        expectEq(errors.length, 0, 'ページのエラー');
        out.push(`${how}: 保存の後の戻る = 一覧（編集へ戻らない）・削除の後の戻る = ${back}`);
      } finally {
        await c.close();
      }
    }
    return `「i」を開いて閉じた直後に置き換える（${out.join(' / ')}）`;
  });

  // DI1（#57 デザインレビューの撮れていなかった状態・レビュー N4）: 取引の詳細（物差し・タップの答えの札の「i」）と編集の画面の
  // 「i」を開き、説明のシートが窓に収まる。幅 320 の物差しの「i」のシートが縦長にならない（幅 200px 以上）
  await check('DI1', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [320, 700],
        [360, 780],
        [1440, 900],
      ]) {
        const { c, p, errors } = await recordContext();
        try {
          await setupContext(c, theme);
          await p.setViewportSize({ width: w, height: h });
          await openRecord(p, base);
          await fillRecord(p, EX_E1);
          await p.locator('#record-submit').click();
          await waitSaved(p, '記録しました');
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('main a[href^="/trades/"]').first().click();
          await waitDetail(p);
          const rr = await openInfo(p, '「LC の物差し」の説明');
          const width = Math.round(rr.right - rr.left);
          if (width < 200) throw new Error(`${theme} ${w}: 物差しの説明のシートの幅 ${width}px`);
          if (opts.shots && w !== 320)
            await p.screenshot({
              path: join(opts.shots, `${w}x${h}-${theme}-detail-info-ruler.png`),
            });
          // 開いている間は後ろを押せないので、閉じてから次の「i」を押す
          await p.keyboard.press('Escape');
          // 詳細の答えの札には「i」を置かない（#131 のデザインレビュー a1）。問いの説明は編集の画面の同じ問いの「i」で見る
          expectEq(
            await p.locator('.verdict ul.taps button.info').count(),
            0,
            `${theme} ${w}: 詳細の札の「i」`,
          );
          await p.locator('main a[href$="/edit"]').first().click();
          await waitReady(p, '取引を編集');
          await openInfo(p, '「時間足を変えたか」の説明');
          if (opts.shots && w !== 320)
            await p.screenshot({
              path: join(opts.shots, `${w}x${h}-${theme}-edit-info-tap.png`),
            });
          await p.keyboard.press('Escape');
          if (w !== 320) {
            await openInfo(p, '「LC を動かしたか」の説明');
            if (opts.shots)
              await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-edit-info.png`) });
          }
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${theme} ${w}${w === 320 ? `（物差しのシート ${width}px）` : ''}`);
        } finally {
          await c.close();
        }
      }
    return `詳細の物差し・編集の画面の 3 つのタップの「i」が窓に収まる・詳細の札に「i」なし（${out.join(' / ')}）`;
  });

  await check('T-D1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      const v = await verdictOf(p);
      expectEq(v.badge, 'B 悪い損失', '判定');
      if (!v.text.includes('−1.6R') || !v.text.includes('0.5%'))
        throw new Error(`判定の枠: ${v.text}`);
      for (const want of [
        'LC を広げた（99.5 → 99.2）',
        '時間足を変えた（4 時間足 → 日足・チャートから）',
      ]) {
        if (!v.reasons.includes(want)) throw new Error(`理由に「${want}」が無い`);
      }
      await expectPollAsync(async () => (await drawn(p)).every((d) => d.alpha > 0), '2 枚が描ける');
      const d = await drawn(p);
      expectEq(
        d.map((x) => x.label).join(' / '),
        'エントリー時のチャート（4 時間足）を大きく見る / 決済時のチャート（日足）を大きく見る',
        'チャートの名前',
      );
      const tfs = await p.locator('.dchart__cap').allTextContents();
      expectEq(tfs.join(' / '), 'エントリー時 · 4 時間足 / 決済時 · 日足', '時間足');
      // 2 枠は横に並ぶ（#131 AC-5。上端が揃い、左右に分かれる）
      const boxes = await p.locator('.dchart').evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left) };
        }),
      );
      if (boxes.length !== 2 || boxes[0].top !== boxes[1].top || boxes[0].left >= boxes[1].left)
        throw new Error(`2 枠が横に並ばない: ${JSON.stringify(boxes)}`);
      // 押すと全画面で見る層（黒い面・✕）。窓いっぱい・canvas が描ける・Esc で閉じて枠へフォーカスが戻る
      await p.locator('#detail-chart-exit').click();
      const viewer = p.locator('#detail-chart-viewer[open]');
      await viewer.waitFor({ state: 'visible', timeout: 5000 });
      await settle(p);
      const vr = await viewer.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const c = e.querySelector('canvas');
        const px = c?.getContext('2d')?.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          vw: window.innerWidth,
          vh: window.innerHeight,
          title: e.querySelector('h2')?.textContent ?? '',
          label: c?.getAttribute('aria-label') ?? '',
          alpha: px ? px[3] : 0,
        };
      });
      if (vr.w !== vr.vw || vr.h !== vr.vh)
        throw new Error(`層が窓いっぱいでない: ${JSON.stringify(vr)}`);
      expectEq(vr.title, '決済時 · 日足', '層の題');
      expectEq(vr.label, '決済時のチャート（日足）', '層の画像の名前');
      if (vr.alpha === 0) throw new Error('層の canvas が描けていない');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('#detail-chart-viewer[open]').count()) === 0,
        'Esc で層を閉じる',
      );
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'detail-chart-exit',
        '閉じたら枠へフォーカス',
      );
      expectEq(new URL(p.url()).pathname, '/trades/x-d1', '層を閉じても詳細のまま');
      expectEq(fake.chartGets.join(' '), 'x-d1-entry x-d1-exit', 'チャートの GET');
      expectEq(await p.locator('img').count(), 0, 'img の数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'B・−1.6R・0.5%・2 つの理由、2 枚のチャート（API のバイト列を canvas に描く）を横に並べ名前 · 時間足、押すと窓いっぱいの層（Esc で閉じて枠へ）';
  });

  // Issue #58: 詳細の見出しの下の行に保有時間（エントリーの時刻のある取引だけ）と、記録する画面の「取引」の枠の
  // エントリーの時刻（決済の時刻と並ぶ・「ほかの欄」に無い）。幅 360 で見出しの下の行がはみ出さない
  await check('H58', async () => {
    const { c, p, errors } = await recordContext();
    const out = [];
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-r3`);
      await waitReady(p, 'US30 · S');
      const when = (await p.locator('.detail__when').textContent()) ?? '';
      if (!when.includes('· 保有 2 日 4 時間')) throw new Error(`x-r3 の見出しの下: ${when}`);
      const over = await p.evaluate(() => {
        const e = document.querySelector('.detail__when');
        const r = e?.getBoundingClientRect();
        return r ? r.right - document.documentElement.clientWidth : 0;
      });
      if (over > 0.5) throw new Error(`見出しの下の行が ${over}px はみ出す`);
      // 360 はエントリーの時刻を頭に出さない・1440 は出す（デザインレビュー 5）
      if (await p.locator('.detail__entry').isVisible())
        throw new Error('360 でエントリーの時刻が見える');
      await p.setViewportSize({ width: 1440, height: 900 });
      const wide = (await p.locator('.detail__entry').textContent()) ?? '';
      if (!(await p.locator('.detail__entry').isVisible()) || !wide.startsWith('エントリー 2026/'))
        throw new Error(`1440 のエントリーの時刻: ${wide}`);
      await p.setViewportSize({ width: 360, height: 780 });
      out.push(`x-r3「${when}」（1440 は頭に「${wide.trim()}」）`);
      await p.goto(`${base}/trades/x-r1`);
      await waitReady(p, 'US30 · L');
      const none = (await p.locator('.detail__when').textContent()) ?? '';
      if (none.includes('保有')) throw new Error(`エントリーの時刻の無い x-r1 に保有: ${none}`);
      out.push(`x-r1「${none}」（保有なし）`);
      await openRecord(p, base);
      // 取引の欄は取引の欄のシートの中（#130）
      await openFields(p);
      const m = await p.evaluate(() => {
        const sec = document.querySelector('#record-fields-sheet');
        const ids = [...(sec?.querySelectorAll('input') ?? [])].map((i) => i.id);
        const more = document.querySelector('details.more');
        const label = document.querySelector('label[for="record-entry-time"]')?.textContent ?? '';
        const entry = document.querySelector('#record-entry-time')?.getBoundingClientRect();
        const exit = document.querySelector('#record-exit-time')?.getBoundingClientRect();
        return {
          ids,
          inMore: !!more?.querySelector('#record-entry-time'),
          label,
          below: entry && exit ? exit.top - entry.top : null,
        };
      });
      const iEntry = m.ids.indexOf('record-entry-time');
      if (iEntry < 0 || iEntry > m.ids.indexOf('record-exit-time'))
        throw new Error(`「取引」の欄の並び: ${m.ids.join(' ')}`);
      if (m.inMore) throw new Error('「ほかの欄」にエントリーの時刻がある');
      if (!m.label.includes('エントリーの時刻（任意）')) throw new Error(`欄の名前: ${m.label}`);
      out.push(
        `記録する画面の「取引」: ${m.ids.join(' ')}（360 でエントリー → 決済の縦の差 ${m.below}px）`,
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return out.join(' / ');
  });

  await check('T-D2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d2`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').first().waitFor();
      const figs = await p.locator('.dchart').allTextContents();
      if (!figs[1]?.includes('チャートなし')) throw new Error(`決済時の枠: ${figs[1]}`);
      expectEq(await p.locator('canvas.chartview__canvas').count(), 1, 'canvas の数');
      expectEq(fake.chartGets.join(' '), 'x-d2-entry', 'チャートの GET');
      const v = await verdictOf(p);
      if (v.reasons.some((r) => r.startsWith('時間足を変えた')))
        throw new Error('時間足を変えたが出た');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '決済時の枠は「チャートなし」（GET を送らない）、理由に時間足を変えたは出ない';
  });

  // Issue #34: LC の物差し（AC-4）・決済までの行動の答え（AC-7）・「すべての欄」の畳み（AC-8）。x-d1 は例の表 E2 と同じ形
  // （広げた後 99.2・決済 99.2）で、チャートからの時間足（4 時間足 → 日足）が判定に効く
  await check('T-D3', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      const list = p.locator('ul[aria-label="LC の物差し"]');
      await list.waitFor();
      expectEq(
        (await list.locator('li').allTextContents()).join(' / '),
        '広げた後の LC 99.2（−1.6R） / 決済 99.2（−1.6R） / 決めた LC 99.5（−1.0R） / イン 100 / LC を 0.6R 超えて決済',
        '物差しの一覧',
      );
      expectEq(
        await p.locator('.verdict svg.ruler__plot').getAttribute('aria-hidden'),
        'true',
        '物差しの図の aria-hidden',
      );
      // 判定の枠の中で、数の段の後・理由の前
      const order = await p
        .locator('.verdict')
        .evaluate((v) =>
          [...v.children]
            .map((e) => e.className)
            .filter((c) => /verdict__stats|^ruler$|^reasons$|^taps$/.test(c)),
        );
      expectEq(order.join(' '), 'verdict__stats ruler reasons taps', '判定の枠の中の順');
      // 広げた後の LC〜決めた LC の破線の太線と、越えた区間の実線の太線。目盛りは −1R・0・+1R
      expectEq(await p.locator('.verdict .ruler__widen').count(), 1, '広げた区間');
      expectEq(await p.locator('.verdict .ruler__over').count(), 1, '越えた区間');
      expectEq(
        (await p.locator('.verdict .ruler__tick').allTextContents()).join(' '),
        '−1R 0 +1R',
        '目盛り',
      );
      const rulerH = await p
        .locator('.verdict .ruler')
        .evaluate((e) => e.getBoundingClientRect().height);
      if (rulerH > 120) throw new Error(`物差しの段の高さ ${rulerH}px（120px 以下）`);
      // 判定の枠の中、理由の下に 決済までの行動の答えの札
      expectEq(
        await p.locator('.verdict ul.taps').getAttribute('aria-label'),
        '決済までの行動の答え',
        '札の一覧の名前',
      );
      // 札は短い問い（見える文字）、読み上げは問いの全文（#131 のデザインレビュー a1）
      const off = await p
        .locator('.verdict ul.taps li.taps__item--off .taps__text')
        .allTextContents();
      expectEq(off.join(' / '), 'LC: 広げた（99.2） / 時間足: 4 時間足 → 日足', '外れた答え');
      const offSpoken = await p
        .locator('.verdict ul.taps li.taps__item--off')
        .evaluateAll((es) =>
          es.map((e) => [...e.querySelectorAll('.sr-only')].map((x) => x.textContent).join('')),
        );
      expectEq(
        offSpoken.join(' / '),
        'LC を動かしたか: 広げた（99.2）計画から外れた / 時間足を変えたか: 4 時間足 → 日足計画から外れた',
        '外れた答えの読み上げ',
      );
      const note = await p.locator('.verdict').textContent();
      // 食い違いの 1 行はあなたの答えだけ（チャートの足は札が言う。#131 のデザインレビュー a2）
      if (!note?.includes('あなたの答え: そのまま') || note.includes('／ チャート:'))
        throw new Error('時間足の食い違いの 1 行が「あなたの答え: そのまま」でない');
      // 「すべての欄」は次の画面（#131 AC-6。その場で開かない）。上の帯は「‹ 取引の詳細」、戻ると詳細
      expectEq(await p.locator('main details').count(), 0, '詳細の折りたたみ');
      await openFieldsScreen(p);
      expectEq(new URL(p.url()).pathname, '/trades/x-d1/fields', '「すべての欄」の URL');
      expectEq(
        (await p.locator('.appbar__back').getAttribute('aria-label')) ?? '',
        '取引の詳細へ戻る',
        '次の画面の戻る',
      );
      const labels = await p.locator('.fields__label').allTextContents();
      // 先頭は口座の 3 行（口座の数によらない。#47 U18）、その後に記録する画面の欄の順
      if (
        labels.slice(0, 4).join(' / ') !==
          '口座 / 口座の資金（記録したとき） / 許容リスク（記録したとき） / 銘柄' ||
        !labels.includes('時間足を変えたか')
      )
        throw new Error(`すべての欄: ${labels.join(' / ')}`);
      await p.goBack();
      await waitDetail(p);
      expectEq(errors.length, 0, 'ページのエラー');
      return `物差しの一覧 5 行・図は読み上げから外す・数の段 → 物差し → 理由 → 札、広げた区間・越えた区間・目盛り、札の外れは 2 つ、「すべての欄」は次の画面（物差しの段の高さ ${Math.round(rulerH)}px @360）`;
    } finally {
      await c.close();
    }
  });

  // #131 AC-4・AC-7（ui-guidelines 9.2・設計書 9.2）: 等倍の文字の 390×844 × ダーク / ライトで、詳細の 1 画面目に判定のカードと
  // チャートの 2 枠（下端が下のタブより上）。測る取引はモックと同じ形の x-m1（決めた LC で決済した A・理由 2 つ・答えは計画どおり・
  // チャート 2 枚）。理由・外れた答え・食い違いの 1 行が多い取引（x-d1 = B・理由 2 つ・外れ 2 つ・食い違い）は中身を畳まないので
  // 1 画面を越えてよいが、チャートの枠が下のタブの上に 60px 以上のぞく（#131 のデザインレビュー）。R は数字の段 hero 40px（#236・C62）。撮るのはレビューに要る状態だけ（詳細・…のシート・比較・編集・
  // 編集の比較）
  await check('D131', async () => {
    const out = [];
    for (const theme of THEMES) {
      const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
      try {
        await setupContext(c, theme);
        fake.trades.push(resnapTrade('x-e6', 1700000000011, 1000000, 33));
        fake.trades.push(
          exampleTrade(
            'x-m1',
            1700000000012,
            { entryChartTimeframe: '4h', exitChartTimeframe: '4h' },
            {
              charts: {
                entry: { contentType: 'image/png', size: 1 },
                exit: { contentType: 'image/png', size: 1 },
              },
            },
          ),
        );
        await p.setViewportSize({ width: 390, height: 844 });
        const shot = async (slug) => {
          if (!opts.shots) return;
          await p.mouse.move(0, 0);
          await p.screenshot({ path: join(opts.shots, `390x844-${theme}-${slug}.png`) });
        };
        const chartsBottom = () =>
          p.evaluate(() =>
            Math.round(
              document.querySelector('.dcharts__grid')?.getBoundingClientRect().bottom ?? 0,
            ),
          );
        await p.goto(`${base}/trades/x-d1`);
        await waitDetail(p);
        await p.locator('canvas.chartview__canvas').nth(1).waitFor({ timeout: 15000 });
        const d1Bottom = await chartsBottom();
        // 理由・外れた札の多い取引は丸ごと入らなくてよいが、チャートの枠が下のタブの上に 60px 以上のぞく（続きがあると分かる。
        // #131 のデザインレビュー: 悪い損失ほどチャートを見返す）
        const d1 = await p.evaluate(() => ({
          top: Math.round(
            document.querySelector('.dcharts__grid')?.getBoundingClientRect().top ?? 1e9,
          ),
          nav: Math.round(document.querySelector('.appnav')?.getBoundingClientRect().top ?? 0),
        }));
        if (d1.top > d1.nav - 60)
          throw new Error(
            `${theme}: x-d1 のチャートの上端 ${d1.top}px が下のタブ（${d1.nav}px）の 60px 上より下`,
          );
        await shot('detail-d1');
        await p.goto(`${base}/trades/x-m1`);
        await waitDetail(p);
        await p.locator('canvas.chartview__canvas').nth(1).waitFor({ timeout: 15000 });
        const m = await p.evaluate(() => {
          const grid = document.querySelector('.dcharts__grid')?.getBoundingClientRect();
          const nav = document.querySelector('.appnav')?.getBoundingClientRect();
          const r = document.querySelector('.verdict__stats .num--hero');
          const u = document.querySelector('.verdict__stats .numu--hero .num-unit');
          return {
            chartsBottom: grid ? Math.round(grid.bottom) : null,
            navTop: nav ? Math.round(nav.top) : window.innerHeight,
            rSize: r ? getComputedStyle(r).fontSize : '',
            uSize: u ? getComputedStyle(u).fontSize : '',
            rowSizes: [...document.querySelectorAll('.verdict__stats .num--row')].map(
              (e) => getComputedStyle(e).fontSize,
            ),
            statsRows: (() => {
              const tops = [...document.querySelectorAll('.verdict__stats .verdict__stat')].map(
                (e) => Math.round(e.getBoundingClientRect().top),
              );
              return new Set(tops).size;
            })(),
            details: document.querySelectorAll('main details').length,
            overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, 0),
          };
        });
        if (m.chartsBottom === null || m.chartsBottom > m.navTop)
          throw new Error(
            `${theme}: チャートの 2 枠の下端 ${m.chartsBottom}px が下のタブ（${m.navTop}px）より下`,
          );
        // 判定の枠の R は数字の段 hero（40px）+ 単位 20px、リスク・損益は row（20px）（#236・C62）
        expectEq(m.rSize, '40px', `${theme}: 判定の R の大きさ`);
        expectEq(m.uSize, '20px', `${theme}: 判定の R の単位の大きさ`);
        if (m.rowSizes.length === 0 || m.rowSizes.some((s) => s !== '20px'))
          throw new Error(`${theme}: リスク・損益の大きさ ${m.rowSizes.join(',')}`);
        expectEq(m.statsRows, 1, `${theme}: R・リスク・損益の行の数`);
        expectEq(m.details, 0, `${theme}: 詳細の折りたたみ`);
        expectEq(m.overflow, 0, `${theme}: 横スクロール`);
        await shot('detail');
        // 操作のシート・比較のシート（違う値のある取引）
        await p.goto(`${base}/trades/x-e6`);
        await waitDetail(p);
        await p.locator('#detail-more').click();
        await p.locator('#detail-actions-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 操作のシート`);
        await shot('detail-actions');
        await p.locator('#detail-action-compare').click();
        await p.locator('#detail-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 比較のシート`);
        await shot('detail-compare');
        await closeSheets(p);
        // 編集（全画面のシート。下のタブを隠す）と比較のシート
        await p.locator('a[href="/trades/x-e6/edit"]').click();
        await waitReady(p, '取引を編集');
        await p.locator('#edit-submit').waitFor();
        expectEq(await p.locator('.appnav').isVisible(), false, `${theme}: 編集の下のタブ`);
        expectEq(await p.locator('main details').count(), 0, `${theme}: 編集の折りたたみ`);
        await shot('edit');
        await p.locator('#edit-compare').click();
        await p.locator('#edit-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 編集の比較のシート`);
        await shot('edit-compare');
        expectEq(errors.length, 0, 'ページのエラー');
        out.push(
          `${theme} チャートの下端 ${m.chartsBottom}px / 下のタブ ${m.navTop}px（x-d1 はチャートの上端 ${d1.top}px・下端 ${d1Bottom}px）`,
        );
      } finally {
        await c.close();
      }
    }
    return `詳細の 1 画面目に判定とチャート 2 枠・R 40px・リスク / 損益 20px・R / リスク / 損益が 1 行・折りたたみ 0、操作・比較のシートが窓の中（${out.join(' / ')}）`;
  });
}
