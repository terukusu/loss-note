// 画面 × 幅 × テーマで測る状態の塊。単位（screens/*.mjs）が自分の画面の分だけを呼ぶ
import { join } from 'node:path';
import {
  BAR_MAX,
  EDIT_BAR_MAX,
  expectPollAsync,
  measure,
  opts,
  PAGES,
  pad,
  settle,
  TAP,
  waitReady,
} from './base.mjs';
import {
  ACC_ONE,
  ACC_USD,
  ACCOUNTS_2,
  FAKE_AI_USAGE,
  FAKE_REAL,
  FAKE_US30,
  homeMonthTrades,
  REVIEW_S1,
  REVIEW_TRADES_TITLE,
  setAccounts,
  TX_C7,
  TX_EMO,
  TX_FX,
  TX_FXU,
  TX_H1,
  TX_REAL,
  TX_REFL,
  TX_WHY,
  TX_WHY_W1,
  TX_WHY_W5,
  withUsdInstrument,
} from './fixtures.mjs';
import {
  closeSheets,
  deleteFromDetail,
  expectRealSummary,
  injectBarSample,
  makeChart,
  openEditChartSheet,
  openFieldsScreen,
  openInfo,
  openRecord,
  seg,
} from './helpers.mjs';
import { RECORD_STATES } from './record-states.mjs';
import { reviewStates } from './review-states.mjs';
import { openSettings, SETTINGS_STATES } from './settings-states.mjs';
import {
  recordUnitOf,
  reviewUnitOf,
  unitOfPath,
  zoomRecordStates,
  zoomSettingsStates,
} from './units.mjs';

/** 画面 × 幅 × テーマ（C1〜C3）のうち、この単位の画面 */
export async function pagesGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, base, checkNest, T } = vp;
  const { problems } = vp.T;
  for (const p of PAGES.filter((x) => unitOfPath(x.path) === unit)) {
    const page = pageFor.get(p.path === '/login');
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(p.path, 22)}`;
    try {
      await page.goto(base + p.path);
      await waitReady(page, p.h1);
      if (p.wait) await page.locator(p.wait).first().waitFor({ timeout: 15000 });
      const m = await measure(page, w === 360, TAP);
      T.states++;
      // 直す画面の帯の高さ（Issue #33 KEEP-7。変える前の値以下）
      if (w === 360 && p.path.endsWith('/edit')) {
        console.log(`    直す画面の帯 ${m.bar ? `${m.bar.h}px` : '無し'}`);
        if (!m.bar || m.bar.h > EDIT_BAR_MAX + 0.5)
          problems.push(`${label}: 直す画面の帯 ${m.bar?.h ?? '無し'}px > ${EDIT_BAR_MAX}px`);
      }
      // 直す画面のチャートの 2 枠の下の端が、注意の文の上の端より上（重ならない。#208）
      if (p.path.endsWith('/edit')) {
        const gap = await page.evaluate(() => {
          const grid = document.querySelector('.rcharts .rcharts__grid');
          const note = document.querySelector('.rcharts .rcharts__notice');
          if (!grid || !note) return null;
          return note.getBoundingClientRect().top - grid.getBoundingClientRect().bottom;
        });
        if (gap === null) problems.push(`${label}: チャートの 2 枠か注意の文が無い`);
        else if (gap < 0)
          problems.push(`${label}: チャートの 2 枠と注意の文が ${-gap}px 重なる（#208）`);
      }
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
      const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
      console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
      if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
      T.clippedTotal += m.clipped.length;
      for (const s of m.clipped) {
        console.log(`    はみ出し: ${s}`);
        problems.push(`${label}: はみ出し ${s}`);
      }
      for (const s of m.small) {
        console.log(`    当たり<44: ${s}`);
        problems.push(`${label}: 当たり<44 ${s}`);
      }
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        const slug = p.path === '/' ? 'home' : p.path.slice(1).replace(/\//g, '-');
        await page.screenshot({
          path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
          fullPage: true,
        });
        // 幅 360 は、少し下へスクロールした見える範囲も撮る（下部の行き先の面を通して文字が透けないかを見る）
        if (w === 360 && (p.path === '/' || p.path === '/trades')) {
          await page.evaluate(() => window.scrollTo(0, 240));
          await page.screenshot({
            path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}-viewport.png`),
          });
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`${label} 開けない  NG`);
      problems.push(`${label}: 開けない ${msg}`);
    }
  }
}

/** トーストの出た一覧 */
export async function toastGroup(vp) {
  const { w, hgt, theme, pageFor, errors, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // トーストの出た一覧（Issue #9。詳細から [消す] → 一覧に「取引を削除しました」と [元に戻す]）。測った後に [元に戻す]
  {
    const tp = pageFor.get(false);
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad('/trades（トースト）', 22)}`;
    try {
      await tp.goto(`${base}/trades/x-d1`);
      await waitReady(tp, 'US30 · L');
      await deleteFromDetail(tp);
      await waitReady(tp, '取引');
      await tp.locator('.toast').waitFor({ timeout: 5000 });
      // [削除] を押した位置にポインターが残ると、幅の広い形（hover のある端末）では移った一覧の行に hover の面が出て
      // 枠に数えられる（押した位置と行の位置しだいで外れる揺れ）。ほかの状態と同じくポインターを外し、落ち着いてから測る（#237）
      await tp.mouse.move(0, 0);
      await settle(tp);
      const m = await measure(tp, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
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
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        await tp.screenshot({
          path: join(opts.shots, `${w}x${hgt}-${theme}-trades-toast.png`),
        });
      }
      await tp.getByRole('button', { name: '元に戻す' }).click();
      await tp.locator('.toast').waitFor({ state: 'detached', timeout: 5000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`${label} 開けない  NG`);
      problems.push(`${label}: 開けない ${msg}`);
    }
  }
}

/** 記録する画面の状態のうち、この単位の状態 */
export async function recordGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // 記録する画面の状態（Issue #13）
  const recPage = pageFor.get(false);
  for (const st of RECORD_STATES.filter((s) => recordUnitOf(s.slug) === unit)) {
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`/record（${st.name}）`, 22)}`;
    try {
      // 口座は状態ごとに入れ替える（無い状態 = 既定の口座 1 つ。設定から作り直す）
      setAccounts(recApi, []);
      st.prep?.(recApi);
      // チャートの読み取りの偽の応答を状態ごとに戻す（#27）
      recApi.chartTimeframes = [];
      recApi.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
      await openRecord(recPage, base);
      await st.fn(recPage, recApi);
      // --inject-clip: 帯の見本（長い文・改行・背の高い要素）を足し、帯の測りが見逃さないことを確かめる
      if (opts.injectClip && w === 360) await injectBarSample(recPage);
      const m = await measure(recPage, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
      const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
      const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
      console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
      if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
      // 貼り付きの帯は 1 段（Issue #33 AC-1: 360 で 64px 以下・状態の文は 1 行で切れない。保存の失敗の知らせの間は
      // 例外。保存の後は帯を持たない）
      if (w === 360) {
        const bar = m.bar;
        console.log(
          `    帯 ${bar ? `${bar.h}px・文 ${bar.lines} 行${bar.cut ? '・切れ' : ''}「${bar.text}」` : '無し'}・全長 ${m.scrollH}px`,
        );
        if (!bar) {
          // 1 段目「スクショを入れる」は判定の帯・［記録する］ を置かない（2026-11-21）
          const input = (await recPage.locator('form[data-stage="input"]').count()) > 0;
          if (!st.noBar && !input) problems.push(`${label}: 貼り付きの帯が無い`);
        } else if (!bar.error) {
          const why = [
            bar.h > BAR_MAX + 0.5 ? `高さ ${bar.h}px > ${BAR_MAX}px` : '',
            bar.lines > 1 ? `文 ${bar.lines} 行` : '',
            bar.cut ? `文が切れる「${bar.text}」` : '',
          ].filter(Boolean);
          T.barTotal += why.length;
          for (const x of why) console.log(`    帯: ${x}`);
          if (why.length > 0) problems.push(`${label}: 帯 ${why.join('・')}`);
        }
      }
      for (const x of m.clipped) {
        console.log(`    はみ出し: ${x}`);
        problems.push(`${label}: はみ出し ${x}`);
      }
      for (const x of m.small) {
        console.log(`    当たり<44: ${x}`);
        problems.push(`${label}: 当たり<44 ${x}`);
      }
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        // 判定の枠（明細の状態は明細の枠）を上の帯のすぐ下に寄せて、見える範囲を撮る
        // （全体を撮ると貼り付けた帯・ボタンが途中に重なる）
        await recPage.evaluate((sel) => {
          const v = document.querySelector(sel);
          if (v) window.scrollTo(0, v.getBoundingClientRect().top + window.scrollY - 76);
        }, st.anchor ?? '.verdict');
        // 説明のシートの状態は、開いたままか確かめてから撮る（#57・#129）
        if (st.reopen) await openInfo(recPage, st.reopen, true);
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
}

/** 設定の画面の状態のうち、この単位の画面の状態 */
export async function settingsGroup(vp, unit) {
  const { w, hgt, theme, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  const recPage = vp.pageFor.get(false);
  // 設定の画面の状態（Issue #5 の E16）。状態ごとに偽の API の設定・銘柄を元に戻してから開く
  for (const st of SETTINGS_STATES.filter((s) => unitOfPath(s.path) === unit)) {
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${st.path}（${st.name}）`, 22)}`;
    try {
      recApi.instruments.splice(0, recApi.instruments.length, FAKE_US30);
      recApi.settings = {
        capitalYen: null,
        riskTolerancePct: 1,
        performanceUnit: 'R',
        capitalHistory: [],
      };
      setAccounts(recApi, []);
      recApi.aiUsage = { status: 200, body: FAKE_AI_USAGE };
      st.prep(recApi);
      await openSettings(recPage, base, st.path);
      await st.fn(recPage, recApi);
      const m = await measure(recPage, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
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
      checkNest(label, m);
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
}

/** 口座 2 つの一覧・ホーム・詳細・直すのうち、この単位の画面 */
export async function accountsGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // 一覧・ホーム・詳細・直す（口座 2 つ。Issue #47 D1・U16・U17・U19）。測った後に口座を戻す。
  // 直す画面は口座を替えて、欄の下の 1 行（今の資金で計算し直す）が出た形を測る
  // #132: 口座の名前は幅によらず 1 行目の銘柄・L / S の後ろ（デザイン a1）
  const ACCOUNT_ROW = '.traderow__account:visible';
  for (const [path, h1, wait, slug, after] of [
    ['/trades', '取引', ACCOUNT_ROW, 'trades-accounts'],
    // ホームの詰めた行は 2 行目に口座の名前（#128）
    ['/', 'ホーム', '.homerow__sub:has-text(" · 口座")', 'home-accounts'],
    ['/trades/x-d1', 'US30 · L', '.verdict__account', 'trade-x-d1-accounts'],
    // 保有時間と口座が並ぶ見出しの下の行（#58 デザインレビュー: 360 で 1 行に収まるか）
    ['/trades/x-r3', 'US30 · S', '.verdict__account', 'trade-x-r3-accounts'],
    [
      '/trades/x-d1/edit',
      '取引を編集',
      '#record-account-field',
      'trade-x-d1-edit-accounts',
      async (pg) => {
        await seg(pg, '口座', '口座 B').click();
        await pg.locator('#record-account-hint').waitFor();
        await pg.locator('#record-account-field').scrollIntoViewIfNeeded();
      },
    ],
  ].filter(([path]) => unitOfPath(path) === unit)) {
    const tp = pageFor.get(false);
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${path}（口座 2 つ）`, 22)}`;
    try {
      setAccounts(recApi, ACCOUNTS_2);
      await tp.goto(base + path);
      await waitReady(tp, h1);
      await tp.locator(wait).first().waitFor({ timeout: 15000 });
      if (after) await after(tp);
      // 前の状態のタップの位置に行が来ると :hover の面が付き、枠として数えてしまう。ポインタを外してから測る
      await tp.mouse.move(0, 0);
      const m = await measure(tp, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
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
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        await tp.screenshot({
          path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
          fullPage: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`${label} 開けない  NG`);
      problems.push(`${label}: 開けない ${msg}`);
    } finally {
      setAccounts(recApi, []);
    }
  }
}

/** 振り返りのタブの状態のうち、この単位の状態と、RV1（単位 review だけ） */
export async function reviewGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // 振り返りのタブの規律の振り返り（Issue #88 AC-12。#128 でホームから `/review` へ移した。期待は同じ）: 期間ごと・件数が
  // 少ない・0 件・期間の誤り・取り込みを含める / 外す・「数で見る」の画面。取引を一時だけ S1（架空の値）に替えて測り、後で戻す
  {
    const REVIEW_STATES = reviewStates(recApi).filter(
      ([, , , slug]) => reviewUnitOf(slug) === unit,
    );
    for (const [path, trades, wait, slug, after, rangeStatus, holdMs] of REVIEW_STATES) {
      const tp = pageFor.get(false);
      const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`振り返り ${slug.replace('review-', '')}`, 22)}`;
      const saved = recApi.trades;
      try {
        recApi.trades = [...trades];
        recApi.rangeStatus = rangeStatus ?? 200;
        recApi.rangeHoldMs = holdMs ?? 0;
        await tp.goto(base + path);
        await waitReady(
          tp,
          path.startsWith('/review/table')
            ? '数で見る'
            : path.startsWith('/review/trades')
              ? REVIEW_TRADES_TITLE[slug]
              : '振り返り',
        );
        await tp.locator(wait).first().waitFor({ timeout: 15000 });
        if (after) await after(tp);
        await tp.mouse.move(0, 0);
        const m = await measure(tp, w === 360, TAP);
        T.states++;
        T.worstH = Math.max(T.worstH, m.h);
        T.smallTotal += m.small.length;
        T.clippedTotal += m.clipped.length;
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
        checkNest(label, m);
        // 振り返りの 1 本の流れ（#228）: なぜ〜次はの高さ（「何で崩れたか」の上端から流れの下端まで）。幅 360 では 2 画面以内
        // （EPIC #233 の終了条件 3）。前の URL `&view=insight` は view を外した URL に置き換わる
        if (!path.startsWith('/review/')) {
          const flow = await tp.evaluate(() => {
            const why = document.querySelector('.review .why');
            const cards = document.querySelector('.review .review__cards');
            if (!why || !cards) return null;
            return Math.round(
              cards.getBoundingClientRect().bottom - why.getBoundingClientRect().top,
            );
          });
          if (flow !== null) {
            const limit = 2 * hgt;
            const over = w === 360 && flow > limit;
            console.log(`    なぜ〜次は ${flow}px（2 画面 = ${limit}px）${over ? '  NG' : ''}`);
            if (over) problems.push(`${label}: なぜ〜次は ${flow}px（2 画面 ${limit}px を超える）`);
          }
          // 数字の段（#236・C62 の AC-2）: display（56px + 単位 28px）は規律コストの見出しの 1 つだけで + で始まらない、
          // 計画どおり率は title（28px + 単位 14px）
          const nums = await tp.evaluate(() => {
            const q = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent);
            const size = (e) => getComputedStyle(e).fontSize;
            return {
              display: q('.num--display').map((e) => ({ t: e.textContent ?? '', s: size(e) })),
              inHead: q('.review__headline .num--display').length,
              dUnit: q('.numu--display .num-unit').map(size),
              title: q('.review__ratecard .num--title').map(size),
              tUnit: q('.review__ratecard .numu--title .num-unit').map(size),
            };
          });
          const numNg = [];
          if (nums.display.length > 1) numNg.push(`display が ${nums.display.length} 個`);
          if (nums.display.length !== nums.inHead)
            numNg.push('display が規律コストの見出しの外にある');
          for (const d of nums.display) {
            if (d.s !== '56px') numNg.push(`display ${d.t} ${d.s}`);
            if (d.t.startsWith('+')) numNg.push(`display に + の値 ${d.t}`);
          }
          if (nums.dUnit.some((s) => s !== '28px')) numNg.push(`display の単位 ${nums.dUnit}`);
          if (nums.title.some((s) => s !== '28px')) numNg.push(`計画どおり率 ${nums.title}`);
          if (nums.tUnit.some((s) => s !== '14px')) numNg.push(`計画どおり率の単位 ${nums.tUnit}`);
          if (nums.display.length > 0)
            console.log(
              `    数字の段 display ${nums.display.map((d) => `${d.t} ${d.s}`).join(',')} / 単位 ${nums.dUnit} / 率 ${nums.title} + ${nums.tUnit}${numNg.length ? '  NG' : ''}`,
            );
          for (const x of numNg) problems.push(`${label}: 数字の段 ${x}`);
          if (slug === 'review-insight-legacy') {
            const url = await tp.evaluate(() => location.pathname + location.search);
            if (url !== '/review?period=7d') {
              console.log(`    前の URL の置き換え: ${url}  NG`);
              problems.push(`${label}: 前の URL の置き換え ${url}（期待 /review?period=7d）`);
            }
          }
        }
        for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
        if (opts.shots) {
          await tp.screenshot({
            path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
            fullPage: true,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.log(`${label} 開けない  NG`);
        problems.push(`${label}: 開けない ${msg}`);
      } finally {
        recApi.trades = saved;
        recApi.rangeStatus = 200;
        recApi.rangeHoldMs = 0;
      }
    }
    // RV1（幅 360・ダークで 1 回。#128 で振り返りのタブ `/review` へ）: 5 つの期間を順に押す → URL の検索部分が置き換わり
    // （履歴の数が増えない）、フォーカスは押した選択肢に残る（見出しへ移らない）。開き直すと同じ期間。7 日の S1 の数字が出る。
    // 「数で見る ›」は同じ期間の次の画面（`/review/table?period=3m`）で、戻ると同じ期間の振り返り
    if (unit === 'review' && w === 360 && theme === 'dark') {
      // 新しいページで開く（履歴の数を前の状態の行き来から切り離す。#226）
      const tp = await pageFor.get(false).context().newPage();
      tp.on('pageerror', (e) => errors.push(e.message));
      const saved = recApi.trades;
      const expectEq = (got, want, what) => {
        if (got !== want)
          throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
      };
      try {
        recApi.trades = [...REVIEW_S1];
        await tp.goto(`${base}/review`);
        await waitReady(tp, '振り返り');
        await tp.locator('.review .curve').waitFor({ timeout: 15000 });
        const text7 = (await tp.locator('.review').textContent()) ?? '';
        for (const want of ['57%', '4 / 7 件', '崩れで −0.6R', '守っていれば +0.9R · 実際 +0.3R']) {
          expectEq(text7.includes(want), true, `RV1: 7 日の S1 に「${want}」`);
        }
        const len0 = await tp.evaluate(() => history.length);
        for (const [key, name] of [
          ['1d', '1日'],
          ['1m', '1か月'],
          ['3m', '3か月'],
          ['custom', '指定'],
          ['7d', '7日'],
        ]) {
          await seg(tp, '期間', name).click();
          await tp.waitForFunction((k) => location.search.includes(`period=${k}`), key);
          // 最初の押下で起動の組み直しの 1 段が積まれ、残りの押下は置き換えだけ（下の最後の数と合わせて見る。#226）
          if (key === '1d')
            expectEq(
              await tp.evaluate(() => history.length),
              len0 + 1,
              'RV1: 最初の押下の後の履歴の数（起動の組み直しの 1 段）',
            );
          await tp.locator('.review__meta, #review-to-error').first().waitFor();
          const focused = await tp.evaluate(
            () => document.activeElement?.getAttribute('value') ?? document.activeElement?.tagName,
          );
          expectEq(focused, key, `RV1: ${name} を押した後のフォーカス`);
          // 貼り付く期間の帯は 5 つの選択肢の行だけ（指定の日付の欄は帯の外で流れる。#128 デザイン a5）
          if (key === 'custom') {
            const bar = await tp.evaluate(() => {
              const b = document.querySelector('.review__period-bar');
              return {
                h: b ? Math.round(b.getBoundingClientRect().height) : 0,
                dates: b ? b.querySelectorAll('input[type="date"]').length : -1,
                outside: document.querySelectorAll('.review__dates input[type="date"]').length,
              };
            });
            expectEq(bar.dates, 0, 'RV1: 貼り付く帯の中の日付の欄');
            expectEq(bar.outside, 2, 'RV1: 帯の外の日付の欄');
            if (bar.h > 80) throw new Error(`RV1: 貼り付く帯の高さ ${bar.h}px（期待 80 以下）`);
          }
        }
        // 期間の 5 回の押下は置き換えだけ。増えるのは最初の操作で書く起動の組み直しの 1 段（印の無い /review → [/, /review]。
        // ui-guidelines 9.7 の 5）だけ。前は同じページで多くの状態を開いた後で履歴が上限（50）に届いていて、この 1 段が数に出なかった（#226）
        expectEq(
          await tp.evaluate(() => history.length),
          len0 + 1,
          'RV1: 履歴の数（置き換えだけ + 起動の組み直しの 1 段）',
        );
        await seg(tp, '期間', '3か月').click();
        await tp.waitForFunction(() => location.search.includes('period=3m'));
        // 切り替えの途中は前の図を薄く残すので、図ではなく範囲の行に件数が出る（読み終えた）まで待つ
        await tp.waitForFunction(
          () => document.querySelector('.review__meta')?.textContent?.includes('件') === true,
        );
        const meta = await tp.locator('.review__meta').textContent();
        await tp.reload();
        await waitReady(tp, '振り返り');
        await tp.waitForFunction(
          () => document.querySelector('.review__meta')?.textContent?.includes('件') === true,
        );
        expectEq(
          await tp.locator('.review__meta').textContent(),
          meta,
          'RV1: 再読み込みで同じ期間',
        );
        expectEq(
          await tp.locator('input[name="review-period"]:checked').getAttribute('value'),
          '3m',
          'RV1: 再読み込みで選ばれた期間',
        );
        // 「数で見る ›」→ 同じ期間の次の画面（表）→ 戻ると同じ期間の振り返り（#128）
        await tp.locator('.review__more a.rowlink', { hasText: '数で見る' }).click();
        await waitReady(tp, '数で見る');
        expectEq(
          await tp.evaluate(() => location.pathname + location.search),
          '/review/table?period=3m',
          'RV1: 数で見るの URL',
        );
        await tp.locator('.review__table table').waitFor({ timeout: 15000 });
        expectEq(
          await tp.locator('.review__meta').textContent(),
          meta,
          'RV1: 数で見るの範囲と件数',
        );
        expectEq(
          await tp.locator('.appbar__back').first().getAttribute('aria-label'),
          '振り返りへ戻る',
          'RV1: 上の帯の戻る',
        );
        await tp.locator('.appbar__back').first().click();
        await waitReady(tp, '振り返り');
        expectEq(
          await tp.evaluate(() => location.pathname + location.search),
          '/review?period=3m',
          'RV1: 戻った振り返りの期間',
        );
        console.log('RV1 期間の置き換え・フォーカス・再読み込み・数で見る ok');
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.log(`RV1 NG ${msg}`);
        problems.push(`RV1: ${msg}`);
      } finally {
        recApi.trades = saved;
        await tp.close();
        for (const e of errors.splice(0)) problems.push(`RV1: ページのエラー ${e}`);
      }
    }
  }
}

/** ST1（ホームの直近の流れ） */
export async function streakGroup(vp) {
  const { w, theme, pageFor, base } = vp;
  const { problems } = vp.T;
  // ST1（幅 360・ダークで 1 回。Issue #35・#128）: ホームの直近の流れは点 10 個が 1 行に並び（同じ高さ・カードの中）、
  // 並びの名前が「直近 10 件の判定（古い順）」、見出しの文が出る。ホームの並びは 見出し → 直近の流れ → 今月の規律 →
  // 直近の取引（#128）。一覧の上には直近の流れを置かない（#128。設計書 9.2・9.3）
  if (w === 360 && theme === 'dark') {
    const tp = pageFor.get(false);
    try {
      await tp.goto(`${base}/`);
      await waitReady(tp, 'ホーム');
      await tp.locator('.streak__item').first().waitFor({ timeout: 15000 });
      const r = await tp.evaluate(() => {
        const card = document.querySelector('.streak');
        const items = [...document.querySelectorAll('.streak__item')];
        const cb = card?.getBoundingClientRect();
        const tops = new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)));
        const outside = items.filter((li) => {
          const b = li.getBoundingClientRect();
          return !cb || b.left < cb.left || b.right > cb.right;
        }).length;
        const KINDS = ['homehead', 'homedraft', 'streak', 'homemonth', 'homerecent', 'review'];
        const order = [...document.querySelectorAll(KINDS.map((k) => `main .${k}`).join(', '))].map(
          (e) => KINDS.find((k) => e.classList.contains(k)),
        );
        return {
          n: items.length,
          rows: tops.size,
          outside,
          label: document.querySelector('.streak__dots')?.getAttribute('aria-label'),
          headline: document.querySelector('.streak__headline')?.textContent ?? '',
          order,
        };
      });
      const where = 'ST1 /';
      if (r.n !== 10) throw new Error(`${where}: 点の数 ${r.n}（期待 10）`);
      if (r.rows !== 1) throw new Error(`${where}: 点の行 ${r.rows}（期待 1）`);
      if (r.outside !== 0) throw new Error(`${where}: カードの外の点 ${r.outside}`);
      if (r.label !== '直近 10 件の判定（古い順）')
        throw new Error(`${where}: 並びの名前 ${r.label}`);
      if (!/続いています|直近の取引は/.test(r.headline))
        throw new Error(`${where}: 見出しの文 ${r.headline}`);
      if (r.order.join(',') !== 'homehead,streak,homemonth,homerecent')
        throw new Error(`${where}: 並び ${r.order.join(',')}`);
      await tp.goto(`${base}/trades`);
      await waitReady(tp, '取引');
      await tp.locator('.traderow').first().waitFor({ timeout: 15000 });
      const onList = await tp.locator('main .streak').count();
      if (onList !== 0) throw new Error(`ST1 /trades: 直近の流れ ${onList} 個（期待 0）`);
      console.log('ST1 直近の流れ（点 10 個が 1 行・名前・見出し・ホームの並び・一覧に無い） ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`ST1 NG ${msg}`);
      problems.push(`ST1: ${msg}`);
    }
  }
}

/** 詳細と編集（外貨建て・心理・Good / More）のうち、この単位の画面 */
export async function fxGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // 詳細と編集（外貨建て。#47 PR-2 U32・U33・U34）: 外貨の取引を一時だけ足して測る
  for (const fx of [
    {
      path: '/trades/x-fx',
      h1: '架空指数U · L',
      slug: 'trade-x-fx',
      name: '外貨建て',
      trade: TX_FX,
      // 「すべての欄」は次の画面（#131）
      after: async (pg) => {
        await openFieldsScreen(pg);
        await pg.locator('.fields__row', { hasText: '1 USD = 150円' }).waitFor();
      },
    },
    {
      path: '/trades/x-fxu',
      h1: '架空指数U · L',
      slug: 'trade-x-fxu',
      name: 'USD の口座の取引',
      trade: TX_FXU,
      after: async (pg) => {
        await openFieldsScreen(pg);
        await pg.locator('.fields__row', { hasText: '50.00 USD' }).first().waitFor();
      },
    },
    // 心理のカード（#156）: タグが付いた詳細と、［変更］ で開いたシート
    {
      path: '/trades/x-emo',
      h1: '架空指数U · L',
      slug: 'trade-x-emotion',
      name: '心理のカード',
      trade: TX_EMO,
      after: async (pg) => {
        // 付いているタグは押せるチップ（#188。同じ心理の期間の取引へのリンク）
        await pg.locator('.emotioncard a.chip', { hasText: '調子に乗った' }).waitFor();
        await pg.locator('.emotioncard').scrollIntoViewIfNeeded();
      },
    },
    // 心理のチップから同じ心理の「期間の取引」へ（#188）: 取引のタブに積み、上の帯は「‹ 取引の詳細」、押した取引が一覧に入る
    {
      path: '/trades/x-emo',
      h1: '架空指数U · L',
      slug: 'trade-x-emotion-trail',
      name: '心理のチップ → 期間の取引',
      trade: TX_EMO,
      after: async (pg) => {
        await pg.locator('.emotioncard a.chip', { hasText: '取り戻したい' }).click();
        await waitReady(pg, '取り戻したい');
        await pg.locator('.traderow').first().waitFor({ timeout: 15000 });
        const back = (await pg.locator('main .appbar__backlabel').first().textContent()) ?? '';
        if (back.trim() !== '取引の詳細') throw new Error(`戻るの名前 ${back}（期待 取引の詳細）`);
        const mine = await pg.locator('.traderow[href="/trades/x-emo"]').count();
        if (mine !== 1) throw new Error(`押した取引の行 ${mine}（期待 1）`);
        const q = new URL(pg.url()).searchParams;
        if (q.get('emotion') !== 'recoup' || q.get('via') !== 'trade' || q.get('trade') !== 'x-emo')
          throw new Error(`行き先 ${q.toString()}`);
        // 押して来た元の取引の行にだけ札「この取引」（#194）
        const badges = await pg.locator('main .traderow__badge').count();
        const mineBadge = await pg
          .locator('.traderow[href="/trades/x-emo"] .traderow__badge', {
            hasText: 'この取引',
          })
          .count();
        if (badges !== 1 || mineBadge !== 1)
          throw new Error(`札 ${badges}・元の取引の行の札 ${mineBadge}（期待 1・1）`);
        // 期間が自動で決まったことを範囲の行で言い、期間の選択肢がある（#188 デザインレビュー 1・2）
        const meta = (await pg.locator('main .review__meta').first().textContent()) ?? '';
        if (!/^この取引(を含む|までの) 3 か月 · /.test(meta.trim()))
          throw new Error(`範囲の行 ${meta}`);
        await pg.locator('main .review__period-bar input[name="review-period"]').first().waitFor({
          state: 'attached',
        });
      },
    },
    // 期間を選び直しても元の取引の ID は URL に残り、via は外れる（#194 の AC-4）。
    // 「1か月」= x-emo が範囲の外で札なし（E6）→「3か月」に戻す = 選び直した後も札が出る（E5。撮るのはこの形）
    {
      path: '/trades/x-emo',
      h1: '架空指数U · L',
      slug: 'trade-x-emotion-trail-period',
      name: '期間の取引で期間を選び直す',
      trade: TX_EMO,
      after: async (pg) => {
        await pg.locator('.emotioncard a.chip', { hasText: '取り戻したい' }).click();
        await waitReady(pg, '取り戻したい');
        await pg.locator('.traderow').first().waitFor({ timeout: 15000 });
        const pick = async (label, key) => {
          await pg.locator('main .review__period-bar label', { hasText: label }).first().click();
          await pg.waitForFunction(
            (k) => new URLSearchParams(location.search).get('period') === k,
            key,
          );
          const q = new URL(pg.url()).searchParams;
          if (q.get('trade') !== 'x-emo' || q.get('via') !== null || q.get('emotion') !== 'recoup')
            throw new Error(`選び直した URL ${q.toString()}`);
        };
        await pick('1か月', '1m');
        await pg.locator('main .review__empty, main .traderow').first().waitFor();
        const outside = await pg.locator('main .traderow__badge').count();
        if (outside !== 0) throw new Error(`範囲の外の札 ${outside}（期待 0）`);
        await pick('3か月', '3m');
        await pg
          .locator('.traderow[href="/trades/x-emo"] .traderow__badge', {
            hasText: 'この取引',
          })
          .waitFor({ timeout: 15000 });
        const badges = await pg.locator('main .traderow__badge').count();
        if (badges !== 1) throw new Error(`選び直した後の札 ${badges}（期待 1）`);
        // via が外れたので範囲の行は日付だけ
        const meta = (await pg.locator('main .review__meta').first().textContent()) ?? '';
        if (meta.includes('この取引')) throw new Error(`範囲の行 ${meta}`);
      },
    },
    {
      path: '/trades/x-emo',
      h1: '架空指数U · L',
      slug: 'trade-x-emotion-sheet',
      name: '心理のシート',
      trade: TX_EMO,
      after: async (pg) => {
        await pg.locator('.emotioncard').getByRole('button', { name: '心理を変更' }).click();
        const sheet = pg.locator('#detail-emotion-sheet[open]');
        await sheet.waitFor();
        await sheet.getByRole('button', { name: '値ごろ感', exact: true }).click();
        await sheet
          .locator('.chip--toggle[aria-pressed="true"]', { hasText: '値ごろ感' })
          .waitFor();
      },
    },
    // #123: 詳細の Good / More のカード（話題の札と自分で書いた行）
    {
      path: '/trades/x-refl',
      h1: '架空指数U · L',
      slug: 'trade-x-reflection-card',
      name: 'Good / More のカード',
      trade: TX_REFL,
      after: async (pg) => {
        const card = pg.locator('.reflectioncard');
        await card.waitFor();
        const tags = await card.locator('.emotioncard__tag').count();
        if (tags !== 5) throw new Error(`Good / More の札 ${tags}（期待 5）`);
        // #248（C69）: 計画どおり（A）の取引は「なぜ守れたか」で Good → More
        const title = (await pg.locator('.dwhy__title').textContent()) ?? '';
        if (title.trim() !== 'なぜ守れたか') throw new Error(`なぜのカードの題 ${title}`);
        const sides = await card
          .locator('.reflectioncard__sname')
          .evaluateAll((els) => els.map((e) => (e.firstChild?.textContent ?? '').trim()));
        if (sides.join(',') !== 'Good,More')
          throw new Error(`Good / More の並び ${sides.join(',')}`);
        await card.scrollIntoViewIfNeeded();
      },
    },
    // #248（C69）: 崩れ（B）で何も残していない取引の「なぜ」のカード: 題・案内の 1 行・総評の添え・判定 → チャート → なぜ →
    // すべての欄 の順（横スクロールは全幅で測る）
    {
      path: '/trades/x-why',
      h1: 'US30 · L',
      slug: 'trade-x-why',
      name: 'なぜのカード（崩れ）',
      trade: TX_WHY,
      after: async (pg) => {
        const why = pg.locator('section.dwhy');
        await why.waitFor();
        if ((await pg.locator('section.dwhy').count()) !== 1)
          throw new Error('なぜのカードが 1 枚でない');
        const title = ((await why.locator('.dwhy__title').textContent()) ?? '').trim();
        if (title !== 'なぜ崩れたか') throw new Error(`題 ${title}`);
        // 案内は題の横の「i」の中（#254・C70）。題の下に文を置かない
        await why
          .locator('.dwhy__title button.info[aria-label="「なぜ崩れたか」の説明"]')
          .waitFor();
        if ((await why.getByText('「何で崩れたか」に数えられます').count()) !== 0)
          throw new Error('案内の文が画面に出ている');
        const parts = await why
          .locator('h3')
          .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
        if (parts.join(',') !== '心理,Good / More') throw new Error(`段の並び ${parts.join(',')}`);
        const preview = why.locator('.dwhy__comment a.rowlink .dwhy__preview');
        const pv = ((await preview.textContent()) ?? '').trim();
        if (!pv.startsWith('架空の総評:') || pv.includes('2 行目'))
          throw new Error(`総評の添え ${pv}`);
        // 判定のカード → チャート → なぜ → すべての欄 の順（文書の順）
        const seq = await pg.evaluate(() =>
          ['.verdict', '.dcharts', 'section.dwhy', '.detail__links'].map((sel) => {
            const all = [...document.querySelectorAll('main *')];
            return all.indexOf(document.querySelector(`main ${sel}`));
          }),
        );
        if (seq.some((i) => i < 0) || seq.some((v, i) => i > 0 && v <= seq[i - 1]))
          throw new Error(`並び ${seq.join(',')}`);
        await why.scrollIntoViewIfNeeded();
      },
    },
    // #248 AC-7 の W1: 崩れ（B）で心理と Good / More の両側 → More → Good・案内なし
    {
      path: '/trades/x-why-w1',
      h1: 'US30 · L',
      slug: 'trade-x-why-w1',
      name: 'なぜのカード（W1）',
      trade: TX_WHY_W1,
      after: async (pg) => {
        const why = pg.locator('section.dwhy');
        await why.locator('.emotioncard a.chip', { hasText: '取り戻したい' }).waitFor();
        const title = ((await why.locator('.dwhy__title').textContent()) ?? '').trim();
        if (title !== 'なぜ崩れたか') throw new Error(`題 ${title}`);
        if ((await why.locator('.dwhy__title button.info').count()) !== 0)
          throw new Error('案内の「i」が出ている');
        const sides = await why
          .locator('.reflectioncard__sname')
          .evaluateAll((els) => els.map((e) => (e.firstChild?.textContent ?? '').trim()));
        if (sides.join(',') !== 'More,Good')
          throw new Error(`Good / More の並び ${sides.join(',')}`);
        await why.scrollIntoViewIfNeeded();
      },
    },
    // #248 AC-7 の W5: 取り込んだ C と総評 → 題「なぜ崩れたか」・案内なし・総評の添え
    {
      path: '/trades/x-why-w5',
      h1: 'US30 · L',
      slug: 'trade-x-why-w5',
      name: 'なぜのカード（W5）',
      trade: TX_WHY_W5,
      after: async (pg) => {
        const why = pg.locator('section.dwhy');
        await why.waitFor();
        const title = ((await why.locator('.dwhy__title').textContent()) ?? '').trim();
        if (title !== 'なぜ崩れたか') throw new Error(`題 ${title}`);
        if ((await why.locator('.dwhy__title button.info').count()) !== 0)
          throw new Error('案内の「i」が出ている');
        const pv = ((await why.locator('.dwhy__preview').textContent()) ?? '').trim();
        if (pv !== '【取り込み】元の判定 C') throw new Error(`総評の添え ${pv}`);
        await why.scrollIntoViewIfNeeded();
      },
    },
    // #123: Good / More のシート（チップを押す・行を足す。足した行は欄の上に並び、欄は空に戻る）
    {
      path: '/trades/x-refl',
      h1: '架空指数U · L',
      slug: 'trade-x-reflection-sheet',
      name: 'Good / More のシート',
      trade: TX_REFL,
      after: async (pg) => {
        await pg
          .locator('.reflectioncard')
          .getByRole('button', { name: 'Good / More を変更' })
          .click();
        const sheet = pg.locator('#detail-reflection-sheet[open]');
        await sheet.waitFor();
        await sheet.getByRole('button', { name: '利を伸ばせた', exact: true }).click();
        await sheet
          .locator('.chip--toggle[aria-pressed="true"]', { hasText: '利を伸ばせた' })
          .waitFor();
        const field = sheet.locator('#detail-reflection-good-note');
        await field.fill('架空の一言: LC を動かさずに待てた');
        await field.press('Enter');
        await sheet
          .locator('.reflection__notetext', { hasText: 'LC を動かさずに待てた' })
          .waitFor();
        if ((await field.inputValue()) !== '') throw new Error('足した後も欄が空でない');
        await field.blur();
      },
    },
    {
      // #164 のレビュー: 編集の画面の要約も実際の桁で測る
      path: '/trades/x-real/edit',
      h1: '取引を編集',
      slug: 'trade-x-real-edit',
      name: '編集（実際の桁）',
      trade: TX_REAL,
      instrument: FAKE_REAL,
      after: async (pg) => {
        await expectRealSummary(pg, '#edit-summary');
      },
    },
    {
      path: '/trades/x-fx/edit',
      h1: '取引を編集',
      slug: 'trade-x-fx-edit-usd',
      name: '編集で USD の口座へ',
      trade: TX_FX,
      after: async (pg) => {
        await seg(pg, '口座', '口座 D').click();
        await pg.locator('#record-account-hint', { hasText: '通貨が違うので' }).waitFor();
        await pg.locator('#record-account-field').scrollIntoViewIfNeeded();
      },
    },
  ].filter((x) => unitOfPath(x.path) === unit)) {
    const tp = pageFor.get(false);
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${fx.path}（${fx.name}）`, 22)}`;
    withUsdInstrument(recApi);
    setAccounts(recApi, [ACC_ONE, ACC_USD]);
    if (fx.instrument && !recApi.instruments.some((i) => i.id === fx.instrument.id))
      recApi.instruments.push(fx.instrument);
    recApi.trades.push(fx.trade);
    try {
      await tp.goto(base + fx.path);
      await waitReady(tp, fx.h1);
      // 編集の判定の枠は判定のシートの中（閉じていても木にある。#131）
      await tp.locator('.verdict').first().waitFor({ state: 'attached', timeout: 15000 });
      await fx.after(tp);
      await tp.mouse.move(0, 0);
      const m = await measure(tp, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
      const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
      const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
      console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
      if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
      for (const x of m.clipped) problems.push(`${label}: はみ出し ${x}`);
      for (const x of m.small) problems.push(`${label}: 当たり<44 ${x}`);
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        await tp.screenshot({
          path: join(opts.shots, `${w}x${hgt}-${theme}-${fx.slug}.png`),
          fullPage: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`${label} 開けない  NG`);
      problems.push(`${label}: 開けない ${msg}`);
    } finally {
      // 心理のタグの PUT（#156）は取引を置き換えるので、ID で探して外す
      const at = recApi.trades.findIndex((t) => t.id === fx.trade.id);
      if (at >= 0) recApi.trades.splice(at, 1);
      if (fx.instrument) {
        const ii = recApi.instruments.findIndex((i) => i.id === fx.instrument.id);
        if (ii >= 0) recApi.instruments.splice(ii, 1);
      }
      setAccounts(recApi, []);
    }
  }
}

/** 追加のチャートの詳細と編集のうち、この単位の画面 */
export async function chartsGroup(vp, unit) {
  const { w, hgt, theme, pageFor, errors, recApi, base, checkNest, T } = vp;
  const { problems } = vp.T;
  // Issue #89: 追加のチャートの詳細（7 枚）と、編集の画面の差し替え・削除・追加の直後
  for (const cs of [
    {
      path: '/trades/x-c7',
      h1: 'US30 · L',
      slug: 'trade-x-c7',
      name: '詳細 7 枚',
      wait: 'canvas.chartview__canvas >> nth=6',
      after: async () => {},
    },
    {
      path: '/trades/x-d1/edit',
      h1: '取引を編集',
      slug: 'edit-chart-replace',
      name: '編集 差し替え',
      wait: '#edit-chart-exit canvas',
      after: async (pg) => {
        const frame = pg.locator('#edit-chart-exit');
        await frame.locator('.chart__name').click();
        await makeChart(pg, 'paste');
        await frame.locator('.chart__mark', { hasText: '差し替え' }).waitFor();
        await pg.locator('#edit-change', { hasText: 'チャート 1 か所を変更' }).waitFor();
        await frame.scrollIntoViewIfNeeded();
      },
    },
    {
      path: '/trades/x-c7/edit',
      h1: '取引を編集',
      slug: 'edit-chart-remove',
      name: '編集 削除',
      wait: '#edit-chart-x2 canvas',
      after: async (pg) => {
        await pg.getByRole('button', { name: '追加のチャート 1のチャートを削除' }).click();
        await pg.locator('#edit-chart-x2-restore').waitFor();
        await pg.locator('#edit-chart-x2').scrollIntoViewIfNeeded();
      },
    },
    {
      path: '/trades/x-d1/edit',
      h1: '取引を編集',
      slug: 'edit-chart-add',
      name: '編集 追加',
      wait: '#edit-chart-exit canvas',
      after: async (pg) => {
        await pg.locator('#edit-chart-add').click();
        const frame = pg.locator('#edit-chart-x1');
        await frame.locator('.chart__name').click();
        await makeChart(pg, 'paste');
        await frame.locator('.chart__mark', { hasText: '追加' }).waitFor();
        await frame.scrollIntoViewIfNeeded();
      },
    },
    // 再レビューで撮れていなかった状態（[元に戻す] の後・2 枠の削除・差し替えの失敗・保存の後。フォーカスの移りも写る）
    {
      path: '/trades/x-c7/edit',
      h1: '取引を編集',
      slug: 'edit-chart-restore',
      name: '編集 元に戻す',
      wait: '#edit-chart-x2 canvas',
      after: async (pg) => {
        await pg.getByRole('button', { name: '追加のチャート 1のチャートを削除' }).click();
        await pg.locator('#edit-chart-x2-restore').click();
        await pg.locator('#edit-chart-x2 canvas').waitFor();
        await expectPollAsync(
          async () => (await pg.evaluate(() => document.activeElement?.id)) === 'edit-chart-x2',
          '[元に戻す] の後のフォーカス',
        );
      },
    },
    {
      path: '/trades/x-d1/edit',
      h1: '取引を編集',
      slug: 'edit-chart-remove-main',
      name: '編集 決済時を削除',
      wait: '#edit-chart-exit canvas',
      after: async (pg) => {
        await pg.getByRole('button', { name: '決済時のチャートを削除' }).click();
        await pg.locator('#edit-chart-exit .chart__mark', { hasText: '削除（未保存）' }).waitFor();
        await expectPollAsync(
          async () =>
            (await pg.evaluate(() => document.activeElement?.id)) === 'edit-chart-exit-restore',
          '[削除] の後のフォーカス',
        );
      },
    },
    {
      path: '/trades/x-d1/edit',
      h1: '取引を編集',
      slug: 'edit-chart-replace-failed',
      name: '編集 差し替えの失敗',
      wait: '#edit-chart-exit canvas',
      after: async (pg) => {
        await pg.locator('#edit-chart-exit-file').setInputFiles({
          name: 'not-a-chart.png',
          mimeType: 'image/png',
          buffer: Buffer.from('これは画像ではない（架空）'),
        });
        await pg.locator('#edit-chart-exit', { hasText: '前のチャートのまま' }).waitFor();
        await pg.locator('#edit-chart-exit canvas').waitFor();
        await pg.locator('#edit-chart-exit').scrollIntoViewIfNeeded();
      },
    },
    {
      path: '/trades/x-c7/edit',
      h1: '取引を編集',
      slug: 'trade-x-c7-saved',
      name: '保存の後の詳細',
      wait: '#edit-chart-x1 canvas',
      after: async (pg) => {
        const frame = pg.locator('#edit-chart-x1');
        await frame.locator('.chart__name').click();
        await makeChart(pg, 'paste');
        await frame.locator('.chart__mark', { hasText: '差し替え済み' }).waitFor();
        // ［保存］ は下の帯（チャートのシートを閉じてから。#131）
        await closeSheets(pg);
        await pg.locator('#edit-submit').click();
        await pg.locator('h1', { hasText: 'US30 · L' }).waitFor();
        await pg.locator('canvas.chartview__canvas >> nth=6').waitFor({ timeout: 15000 });
      },
    },
  ].filter((x) => unitOfPath(x.path) === unit)) {
    const tp = pageFor.get(false);
    const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${cs.path}（${cs.name}）`, 22)}`;
    recApi.trades.push(TX_C7);
    recApi.chartTimeframes = [];
    try {
      await tp.goto(base + cs.path);
      await waitReady(tp, cs.h1);
      // 編集のチャートの詳細はチャートのシート（#131。小さな 2 枠のチャートのある枠から開く）
      if (cs.path.endsWith('/edit')) await openEditChartSheet(tp);
      await tp.locator(cs.wait).first().waitFor({ timeout: 15000 });
      await cs.after(tp);
      await tp.mouse.move(0, 0);
      const m = await measure(tp, w === 360, TAP);
      T.states++;
      T.worstH = Math.max(T.worstH, m.h);
      T.smallTotal += m.small.length;
      T.clippedTotal += m.clipped.length;
      const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
      const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
      console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
      if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
      for (const x of m.clipped) problems.push(`${label}: はみ出し ${x}`);
      for (const x of m.small) problems.push(`${label}: 当たり<44 ${x}`);
      checkNest(label, m);
      for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
      if (opts.shots) {
        await tp.screenshot({
          path: join(opts.shots, `${w}x${hgt}-${theme}-${cs.slug}.png`),
          fullPage: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
      console.log(`${label} 開けない  NG`);
      problems.push(`${label}: 開けない ${msg}`);
    } finally {
      // 保存の場面は取引を置き換えるので、ID で外す
      const at = recApi.trades.findIndex((t) => t.id === TX_C7.id);
      if (at >= 0) recApi.trades.splice(at, 1);
    }
  }
}

/** 文字の拡大: この単位の画面 */
export async function zoomPagesGroup(vp, unit) {
  const { pageFor, base } = vp;
  const { zoomState } = vp;
  for (const p of PAGES.filter((x) => unitOfPath(x.path) === unit)) {
    const page = pageFor.get(p.path === '/login');
    const slug = p.path === '/' ? 'home' : p.path.slice(1).replace(/\//g, '-');
    await zoomState(page, p.path, slug, async () => {
      await page.goto(base + p.path);
      await waitReady(page, p.h1);
      if (p.wait) await page.locator(p.wait).first().waitFor({ timeout: 15000 });
    });
  }
}

/** 文字の拡大: 記録する画面の状態のうち、この単位の状態 */
export async function zoomRecordGroup(vp, unit) {
  const { pageFor, recApi, base } = vp;
  const { zoomState } = vp;
  const recPage = pageFor.get(false);
  for (const st of zoomRecordStates(unit)) {
    await zoomState(recPage, `/record（${st.name}）`, st.slug, async () => {
      setAccounts(recApi, []);
      st.prep?.(recApi);
      recApi.chartTimeframes = [];
      recApi.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
      await openRecord(recPage, base);
      await st.fn(recPage, recApi);
    });
  }
}

/** 文字の拡大: 設定の画面の状態のうち、この単位の状態 */
export async function zoomSettingsGroup(vp, unit) {
  const { recApi, base } = vp;
  const { zoomState } = vp;
  const recPage = vp.pageFor.get(false);
  for (const st of zoomSettingsStates(unit)) {
    await zoomState(recPage, `${st.path}（${st.name}）`, st.slug, async () => {
      recApi.instruments.splice(0, recApi.instruments.length, FAKE_US30);
      recApi.settings = {
        capitalYen: null,
        riskTolerancePct: 1,
        performanceUnit: 'R',
        capitalHistory: [],
      };
      setAccounts(recApi, []);
      recApi.aiUsage = { status: 200, body: FAKE_AI_USAGE };
      st.prep(recApi);
      await openSettings(recPage, base, st.path);
      await st.fn(recPage, recApi);
    });
  }
}

/** 文字の拡大: 振り返り（7 日）と数で見る */
export async function zoomReviewGroup(vp) {
  const { recApi, base, zoomState } = vp;
  const recPage = vp.pageFor.get(false);
  const saved = recApi.trades;
  recApi.trades = [...REVIEW_S1];
  await zoomState(recPage, '/review（7 日）', 'review-7d', async () => {
    await recPage.goto(`${base}/review?period=7d`);
    await waitReady(recPage, '振り返り');
    await recPage.locator('.curve').first().waitFor({ timeout: 15000 });
  });
  await zoomState(recPage, '/review/table（7 日）', 'review-table', async () => {
    await recPage.goto(`${base}/review/table?period=7d`);
    await waitReady(recPage, '数で見る');
    await recPage.locator('.review__table table').waitFor({ timeout: 15000 });
  });
  recApi.trades = saved;
}

/** 文字の拡大: ホーム（今月の取引あり） */
export async function zoomHomeGroup(vp) {
  const { recApi, base, zoomState } = vp;
  const recPage = vp.pageFor.get(false);
  const saved = recApi.trades;
  // ホーム（今月の取引あり。主役の数字・小さな曲線・詰めた行が縦に伸びる。横は 0）
  recApi.trades = [...homeMonthTrades(), ...TX_H1];
  await zoomState(recPage, '/（今月の取引あり）', 'home-month', async () => {
    await recPage.goto(`${base}/`);
    await waitReady(recPage, 'ホーム');
    await recPage.locator('.homemonth .num--title').first().waitFor({ timeout: 15000 });
  });
  recApi.trades = saved;
}
