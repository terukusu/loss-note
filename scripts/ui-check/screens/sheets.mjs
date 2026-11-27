import { join } from 'node:path';
import {
  expectPollAsync,
  loginViaPopup,
  measure,
  opts,
  settle,
  setupContext,
  TAP,
  THEMES,
  waitDetail,
  waitReady,
} from '../base.mjs';
import { dialogsSeen, installFakeApi, waitSaved } from '../fixtures.mjs';
import { recordGroup, zoomRecordGroup } from '../groups.mjs';
import {
  closeSheet,
  closeSheets,
  deleteFromDetail,
  EX_E1,
  expectNoSheetShown,
  expectRestore,
  fillRecord,
  focusLabel,
  followLink,
  infoButton,
  OPEN_SHEET,
  openEditFields,
  openInfo,
  openRecord,
  openVerdict,
  pressBackdrop,
  settleSheet,
  sheetCount,
  sheetTitle,
  toReview,
  toReviewByPaste,
} from '../helpers.mjs';
import { openSettings } from '../settings-states.mjs';

/** 開いている下のシートのつまみの計算後の display と、題の行の上端とシートの上端の差（#229 AC-6） */
const gripOf = (p) =>
  p.evaluate((sel) => {
    const d = document.querySelector(sel);
    const g = d?.querySelector('.sheet__grip');
    const h = d?.querySelector('.sheet__head');
    const panel = d?.querySelector('.sheet__panel');
    if (!d || !g || !h || !panel) return { display: 'missing', headGap: -1 };
    return {
      display: getComputedStyle(g).display,
      headGap: Math.round(
        h.querySelector('.sheet__title').getBoundingClientRect().top -
          d.getBoundingClientRect().top,
      ),
    };
  }, OPEN_SHEET);

/**
 * 画面の検査の単位「説明と下のシート」: 記録する画面で説明のシートを開いた状態と、説明の「i」IT1〜IT3・
 * 下のシート SH1〜SH3・用語集 GL1・GL2・書きかけ DR1・DR2
 */
export const id = 'sheets';
export const title = '説明と下のシート';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}

/** 手順（IT1・IT2・IT3・SH1・SH2・SH3・GL1・DR1・DR2・GL2） */
export async function flows(kit) {
  const { browser, base, signedIn, check, expectEq, recordContext, infoState, popCount } = kit;
  await check('IT1', async () => {
    const { c, p, fake, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      // 3 つのタップは 2 段目（2026-11-21）
      await toReviewByPaste(p, fake);
      const b = infoButton(p, TF);
      expectEq(await infoState(p, TF), 'false', '押す前');
      expectEq(await b.getAttribute('aria-haspopup'), 'dialog', 'aria-haspopup');
      expectEq(await popCount(p), 0, '押す前のシート');
      await openInfo(p, TF);
      expectEq(await infoState(p, TF), 'true', '1 回目');
      expectEq(await sheetTitle(p), '時間足を変えたか', 'シートの見出し');
      const txt = await p.locator(OPEN_SHEET).textContent();
      for (const w of ['長い足へ', 'B 悪い損失', '短い足へ'])
        if (!txt?.includes(w)) throw new Error(`シートに「${w}」が無い`);
      // 開くとフォーカスはシートの見出しへ
      expectEq(
        await p.evaluate(() => document.activeElement?.classList.contains('sheet__title')),
        true,
        '開いた後のフォーカス',
      );
      // ✕ で閉じる → フォーカスは「i」
      await closeSheet(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '✕ で閉じる');
      expectEq(await infoState(p, TF), 'false', '✕ の後');
      expectEq(await focusLabel(p), TF, '✕ の後のフォーカス');
      // Esc: 閉じてフォーカスが「i」
      await b.focus();
      await p.keyboard.press('Enter');
      await expectPollAsync(async () => (await infoState(p, TF)) === 'true', 'Enter で開く');
      await settleSheet(p);
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      expectEq(await focusLabel(p), TF, 'Esc の後のフォーカス');
      // 外を押すと閉じる（後ろの欄には届かない）・フォーカスは「i」
      await openInfo(p, TF);
      await pressBackdrop(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '外を押して閉じる');
      expectEq(await focusLabel(p), TF, '外を押した後のフォーカス');
      // シートの中を押しても閉じない
      await openInfo(p, TF);
      await p.locator(`${OPEN_SHEET} .sheet__body`).click({ position: { x: 4, y: 4 } });
      await p.waitForTimeout(150);
      expectEq(await popCount(p), 1, '中を押した後のシート');
      // 同時に 1 つ: 開いている間、後ろの「i」は押せない（モーダルの外は inert）
      const reached = await infoButton(p, '「LC を動かしたか」の説明')
        .click({ timeout: 1000, trial: true })
        .then(() => true)
        .catch(() => false);
      expectEq(reached, false, '開いている間に後ろの「i」を押せる');
      expectEq(await popCount(p), 1, '同時に開いている数');
      await closeSheet(p);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '押して開く（aria-haspopup="dialog"・aria-expanded false → true・見出しへフォーカス）、✕・Esc・外を押すで閉じてフォーカスは「i」、中を押しても閉じない、開いている間は後ろの「i」を押せない（同時に 1 つ）、中身に「長い足へ・B 悪い損失・短い足へ」';
  });

  await check('IT2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      const snap = () =>
        p.evaluate(() => ({
          checked: [...document.querySelectorAll('input[type="radio"]:checked')].map(
            (e) => `${e.getAttribute('name')}=${e.getAttribute('value')}`,
          ),
          status: document.querySelector('.record__status, .record__missing')?.textContent ?? '',
          values: [
            ...document.querySelectorAll('input:not([type="radio"]):not([type="file"]), select'),
          ].map((e) => e.value),
          badge: document.querySelector('.verdict .badge')?.textContent ?? '',
          url: location.pathname,
        }));
      const before = await snap();
      if (!before.status) throw new Error('帯の文が無い');
      const MOVE = '「LC を動かしたか」の説明';
      await infoButton(p, MOVE).click();
      await p.locator(OPEN_SHEET).waitFor();
      await closeSheet(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '✕ で閉じる');
      await infoButton(p, MOVE).focus();
      await p.keyboard.press('Enter');
      await p.locator(OPEN_SHEET).waitFor();
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      const after = await snap();
      expectEq(JSON.stringify(after), JSON.stringify(before), '入力の状態');
      expectEq(fake.posts.length, 0, '保存の要求');
      expectEq(errors.length, 0, 'ページのエラー');
      return `未選択のまま「i」を押す・✕・Enter・Esc: 選択・帯の文（${before.status}）・欄の値・判定が同じ、保存の要求 0`;
    } finally {
      await c.close();
    }
  });

  await check('IT3', async () => {
    const { c, p, fake, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    // 3 つ目の問いの「i」（#202 で LC を入る前に決めていたかを聞かなくなったので、LC を動かしたかで見る）
    const DEC = '「LC を動かしたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      // 2 段目へは明細を貼って移る（シートを開くと履歴の段の出入りが混ざる。2026-11-21）
      await toReviewByPaste(p, fake);
      // 書きかけは 1 画面の LC で作る（取引の欄のシートを開くと履歴の段の出入りが混ざる。#130）
      await p.locator('#record-lc').fill('99.50');
      const len = () => p.evaluate(() => history.length);
      const y = () => p.evaluate(() => Math.round(window.scrollY));
      const base0 = await len();
      // 開いて戻る → シートだけが閉じる
      await openInfo(p, TF);
      await expectPollAsync(async () => (await len()) === base0 + 1, '開いたら履歴に 1 段');
      await p.goBack();
      await expectPollAsync(async () => (await popCount(p)) === 0, '戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '戻った後の URL');
      expectEq(await p.locator('main h1').first().textContent(), '記録する', '戻った後の画面');
      expectEq(await p.locator('#record-lc').inputValue(), '99.50', '下書き');
      expectEq(await focusLabel(p), TF, '戻るの後のフォーカス');
      // B1（レビュー）の置き換え（#129）: スクロールした所で開いて外を押す → シートだけが閉じ、窓の位置は変わらない
      await infoButton(p, DEC).scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, 120));
      await openInfo(p, DEC);
      const y2 = await y();
      await pressBackdrop(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '外を押して閉じる');
      await p.waitForTimeout(250);
      const y3 = await y();
      if (Math.abs(y3 - y2) > 2) throw new Error(`外を押した後に位置が ${y2} → ${y3}`);
      // B1: 開いて戻る → シートだけ閉じ、位置は変わらない
      await openInfo(p, DEC);
      const y4 = await y();
      await p.goBack();
      await expectPollAsync(
        async () => (await popCount(p)) === 0,
        '戻るで閉じる（スクロールの後）',
      );
      await p.waitForTimeout(250);
      const y5 = await y();
      if (Math.abs(y5 - y4) > 2) throw new Error(`戻るの後に位置が ${y4} → ${y5}`);
      expectEq(new URL(p.url()).pathname, '/record', 'スクロールの後の戻るの URL');
      // ✕ で閉じる → 積んだ段を戻して数を合わせる（その後の戻るは 1 回で前の画面へ。進む側には積んだ段の項目が残り、
      // 進むで入ると押し戻される = option-simulator と同じ規則。レビュー N3 b・N8 a）
      for (const [how, close] of [
        ['✕', closeSheet],
        ['Esc', (q) => q.keyboard.press('Escape')],
        ['外', pressBackdrop],
      ]) {
        await openInfo(p, TF);
        await close(p);
        await expectPollAsync(async () => (await popCount(p)) === 0, `${how} で閉じる`);
        await p.waitForTimeout(200);
        await p.goBack();
        await waitReady(p, 'ホーム');
        expectEq(new URL(p.url()).pathname, '/', `${how} で閉じた後の戻る`);
        await p.goForward();
        await waitReady(p, '記録する');
        await toReview(p);
      }
      // 開いたままシートの中の ［用語集で見る］ で画面を移る → 用語集。戻る 1 回で記録する画面（N8 b）
      await openInfo(p, TF);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      expectEq(new URL(p.url()).pathname, '/glossary', '開いたまま移った先');
      expectEq(await popCount(p), 0, '移った先のシート');
      await expectNoSheetShown(p, '用語集へ移った後');
      await p.goBack();
      await expectPollAsync(
        async () => new URL(p.url()).pathname === '/record',
        '戻る 1 回で記録する画面',
      );
      await waitReady(p, '記録する');
      expectEq(await popCount(p), 0, '戻った後のシート');
      // B2（再レビュー）: 開いたまま移って戻った後も、その画面の戻るの位置の復元は効く（scrollRestoration が manual で残らない）
      await expectRestore(p, '開いたまま一覧へ移って戻った後');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '開いて戻る → シートだけ閉じ、URL /record・画面・下書き・フォーカス（「i」）はそのまま。スクロールした所で開いて外を押す・戻る → 位置は変わらない（B1）。✕ / Esc / 外で閉じた後の戻るは 1 回でホームへ。開いたまま用語集へ移り、戻る 1 回で記録する画面';
  });

  // ── 下のシート（#129。ui-guidelines 9.3・9.6・9.10）。説明のシートで流す
  // SH1: 360×780・390×844 × ダーク / ライトと、文字の拡大 200%（ダーク）で「判定」の説明（判定の一覧つきの長い説明）を開く →
  //      下から出る（下端が窓の下端・左右いっぱい）・窓の中・最大 86%・中を最後までスクロールして ［用語集で見る］ が見える・
  //      ✕ の当たり 44・Tab を 12 回押してもシートの外の要素へ移らない（✕ と ［用語集で見る］ に届く）・✕ で閉じたら「i」へ。
  //      安全域を上 47・下 34 に差し替えた 390×844 で、シートの押せるものが安全域の内側。
  //      つまみは出さない（計算後の display が none）・題の行の上端はシートの上端から 12px 以上（#229 AC-6・設計書 C61）
  await check('SH1', async () => {
    const out = [];
    const runs = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [360, 780],
        [390, 844],
      ])
        runs.push({ theme, w, h, zoom: false, safe: false });
    for (const [w, h] of [
      [360, 780],
      [390, 844],
    ])
      runs.push({ theme: 'dark', w, h, zoom: true, safe: false });
    runs.push({ theme: 'dark', w: 390, h: 844, zoom: false, safe: true });
    const J = '「判定」の説明';
    for (const run of runs) {
      const { c, p, errors } = await recordContext();
      const label = `${run.w}x${run.h} ${run.theme}${run.zoom ? ' 拡大' : ''}${run.safe ? ' 安全域' : ''}`;
      try {
        await setupContext(c, run.theme, run.zoom);
        if (run.safe)
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
        await p.setViewportSize({ width: run.w, height: run.h });
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
        await openVerdict(p);
        const r = await openInfo(p, J);
        // 下から出る（下端が窓の下端・左右いっぱい）
        if (Math.abs(r.bottom - r.vh) > 1) throw new Error(`${label}: 下端 ${r.bottom} / ${r.vh}`);
        if (r.left > 0.5 || r.right < r.vw - 0.5)
          throw new Error(`${label}: 左右 ${r.left}〜${r.right} / ${r.vw}`);
        // つまみは出さない・題の行の上に余白（#229 AC-6）
        const grip = await gripOf(p);
        if (grip.display !== 'none')
          throw new Error(`${label}: つまみが出ている（${grip.display}）`);
        if (!(grip.headGap >= 12)) throw new Error(`${label}: 題の行の上の余白 ${grip.headGap}px`);
        // ✕ の当たり
        const x = await p.locator(`${OPEN_SHEET} .sheet__close`).boundingBox();
        if (!x || x.width < TAP - 0.5 || x.height < TAP - 0.5)
          throw new Error(`${label}: ✕ の当たり ${x?.width}×${x?.height}`);
        if (opts.shots && !run.safe)
          await p.screenshot({
            path: join(
              opts.shots,
              `${run.w}x${run.h}-${run.theme}${run.zoom ? '-zoom' : ''}-sheet-info.png`,
            ),
          });
        // 中を最後までスクロールすると ［用語集で見る］ が見える
        const end = await p.evaluate((sel) => {
          const d = document.querySelector(sel);
          const body = d?.querySelector('.sheet__body');
          const g = d?.querySelector('.info__glossary');
          if (!d || !body || !g) return null;
          body.scrollTop = body.scrollHeight;
          const br = body.getBoundingClientRect();
          const gr = g.getBoundingClientRect();
          return {
            inside: gr.top >= br.top - 0.5 && gr.bottom <= br.bottom + 0.5,
            scroll: body.scrollHeight - body.clientHeight,
            page: document.documentElement.scrollWidth - window.innerWidth,
          };
        }, OPEN_SHEET);
        if (!end) throw new Error(`${label}: シートの中身が無い`);
        if (!end.inside)
          throw new Error(`${label}: 最後までスクロールしても ［用語集で見る］ が見えない`);
        if (end.page > 0) throw new Error(`${label}: 横スクロール ${end.page}px`);
        if (opts.shots && run.w === 390 && run.zoom)
          await p.screenshot({ path: join(opts.shots, '390x844-dark-zoom-sheet-info-end.png') });
        // 中身がスクロールする形（文字の拡大）で下の方のリンクからたどる → 中身は先頭から・見出しは新しい言葉。Esc で戻っても
        // 先頭から（#129 のデザインレビュー a-3）
        if (run.zoom) {
          const bodyTop = () =>
            p.evaluate(
              (sel) => document.querySelector(`${sel} .sheet__body`)?.scrollTop ?? -1,
              OPEN_SHEET,
            );
          const link = p.locator(`${OPEN_SHEET} .sheet__body a.glink`).last();
          await link.scrollIntoViewIfNeeded();
          if ((await bodyTop()) <= 0)
            throw new Error(`${label}: 下の方のリンクで中身がスクロールしていない`);
          await link.click();
          await expectPollAsync(async () => (await sheetTitle(p)) !== '判定', `${label}: たどる`);
          expectEq(await bodyTop(), 0, `${label}: たどった後の中身の位置`);
          await p.locator(`${OPEN_SHEET} .sheet__body`).evaluate((b) => {
            b.scrollTop = b.scrollHeight;
          });
          await p.keyboard.press('Escape');
          await expectPollAsync(
            async () => (await sheetTitle(p)) === '判定',
            `${label}: Esc で戻る`,
          );
          expectEq(await bodyTop(), 0, `${label}: 戻った後の中身の位置`);
        }
        // 安全域: シートの押せるものが上 47・下 34 の内側
        if (run.safe) {
          const bad = await p.evaluate((sel) => {
            const d = document.querySelector(sel);
            const vh = window.innerHeight;
            const out = [];
            for (const el of d?.querySelectorAll('button, a') ?? []) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) continue;
              const body = el.closest('.sheet__body')?.getBoundingClientRect();
              // 中のスクロールで隠れている物は見ない（見えている物だけ）
              if (body && (b.bottom <= body.top || b.top >= body.bottom)) continue;
              if (b.top < 47 - 0.5 || b.bottom > vh - 34 + 0.5)
                out.push(
                  `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 10)} ${Math.round(b.top)}〜${Math.round(b.bottom)}`,
                );
            }
            return out;
          }, OPEN_SHEET);
          if (bad.length > 0) throw new Error(`${label}: 安全域に掛かる ${bad.join(' / ')}`);
        }
        // フォーカスを閉じ込める: Tab を 20 回押しても外の要素へ移らない（関係する言葉の札の分も回る。#144）
        const seen = new Set();
        for (let i = 0; i < 20; i++) {
          await p.keyboard.press('Tab');
          const f = await p.evaluate((sel) => {
            const d = document.querySelector(sel);
            const a = document.activeElement;
            if (!a || a === document.body) return { where: 'body', name: '' };
            return {
              where: d?.contains(a) ? 'inside' : 'outside',
              name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 12),
            };
          }, OPEN_SHEET);
          if (f.where === 'outside') throw new Error(`${label}: Tab でシートの外（${f.name}）へ`);
          seen.add(f.name);
        }
        for (const want of ['閉じる', '用語集で見る'])
          if (![...seen].some((n) => n.startsWith(want)))
            throw new Error(`${label}: Tab で「${want}」に届かない（${[...seen].join(' / ')}）`);
        // ✕ で閉じたら「i」へ
        await closeSheet(p);
        await expectPollAsync(async () => (await sheetCount(p)) === 0, `${label}: ✕ で閉じる`);
        expectEq(await focusLabel(p), J, `${label}: 閉じた後のフォーカス`);
        expectEq(errors.length, 0, `${label}: ページのエラー`);
        out.push(
          `${label}（高さ ${Math.round((r.height / r.vh) * 100)}%・中 ${end.scroll}px・題の上 ${grip.headGap}px）`,
        );
      } finally {
        await c.close();
      }
    }
    return `下から・窓の中・最大 86%・中を最後までスクロール・✕ 44・Tab で外へ出ない・閉じたら「i」・安全域の内側・つまみなし（${out.join(' / ')}）`;
  });

  // SH2（#129 AC-4）: 詳細で [削除] → 一覧に「〜を削除しました」+ [元に戻す] → 別の取引の詳細で説明のシートを開いたまま 9 秒 →
  //      トーストは残り DELETE 0 → 閉じてから 8.5 秒で DELETE 1
  await check('SH2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await deleteFromDetail(p);
      await waitReady(p, '取引');
      const toast = p.locator('.toast').filter({ hasText: 'を削除しました' });
      await toast.waitFor();
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「判定」の説明');
      await p.waitForTimeout(9000);
      expectEq(await toast.count(), 1, 'シートを開いている間のトースト');
      expectEq(fake.deletes.length, 0, 'シートを開いている間の DELETE');
      await closeSheet(p);
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '✕ で閉じる');
      await p.waitForTimeout(2000);
      expectEq(fake.deletes.length, 0, '閉じて 2 秒の DELETE（8 秒を置き直す）');
      await p.waitForTimeout(6500);
      await expectPollAsync(async () => fake.deletes.length === 1, '閉じて 8.5 秒で DELETE');
      expectEq(fake.deletes.join(' '), 'x-d1', 'DELETE の取引');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '削除のトーストが出ている間に説明のシートを開いて 9 秒: トーストは残り DELETE 0、閉じて 2 秒で 0・8.5 秒で 1（8 秒を置き直す）';
  });

  // SH3（#129 AC-8・9.3）: 形ごとの見せ方を <html data-form> で替える（属性を書くのは U9 #134。ここでは検査が付ける）。
  //      横（844×390・landscape）= 右のパネル（右端・高さいっぱい・幅 400 以下）、広い（1440×900・wide）= 説明は押した「i」の
  //      そばの吹き出し（幅 360 以下・窓の中・「i」との縦のすき間 16px 以下で左右が重なる）、入力のシート（.sheet--form）は中央の
  //      ダイアログ（幅 480 以下・中央）。どちらも同じ dialog の要素のまま
  await check('SH3', async () => {
    const out = [];
    const { c, p, errors } = await recordContext();
    const form = (f) => p.evaluate((v) => document.documentElement.setAttribute('data-form', v), f);
    try {
      // 横: 右のパネル
      await p.setViewportSize({ width: 844, height: 390 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await form('landscape');
      const lr = await openInfo(p, '「判定」の説明');
      if (Math.abs(lr.right - lr.vw) > 1 || lr.top > 0.5 || Math.abs(lr.bottom - lr.vh) > 1)
        throw new Error(
          `横: 右のパネルでない（${Math.round(lr.left)},${Math.round(lr.top)}〜${Math.round(lr.right)},${Math.round(lr.bottom)}）`,
        );
      if (lr.width > 400.5) throw new Error(`横: パネルの幅 ${lr.width}px`);
      if ((await gripOf(p)).display !== 'none') throw new Error('横: つまみが出ている');
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '844x390-dark-sheet-landscape.png') });
      out.push('つまみなし');
      await closeSheet(p);
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '横: ✕ で閉じる');
      out.push(`横 ${Math.round(lr.width)}×${Math.round(lr.height)} 右端`);
      // 広い: 押した「i」のそばの吹き出し
      await p.setViewportSize({ width: 1440, height: 900 });
      await form('wide');
      const name = '「判定」の説明';
      const wr = await openInfo(p, name);
      const btn = await infoButton(p, name).boundingBox();
      if (!btn) throw new Error('広い: 「i」が無い');
      if (wr.width > 360.5) throw new Error(`広い: 吹き出しの幅 ${wr.width}px`);
      if ((await gripOf(p)).display !== 'none') throw new Error('広い: つまみが出ている');
      const gap = Math.min(Math.abs(wr.top - (btn.y + btn.height)), Math.abs(btn.y - wr.bottom));
      const overlapX = Math.min(wr.right, btn.x + btn.width) - Math.max(wr.left, btn.x);
      if (gap > 16 || overlapX <= 0)
        throw new Error(
          `広い: 「i」のそばでない（すき間 ${Math.round(gap)}px・左右の重なり ${Math.round(overlapX)}px）`,
        );
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '1440x900-dark-sheet-wide-info.png') });
      out.push(`広い 説明 ${Math.round(wr.width)}px・すき間 ${Math.round(gap)}px`);
      // 広い: 入力のシートは中央のダイアログ（同じ要素のクラスを替えて見る）
      const fr = await p.evaluate(() => {
        const d = document.querySelector('dialog.sheet[open]');
        if (!d) return null;
        d.classList.replace('sheet--info', 'sheet--form');
        const r = d.getBoundingClientRect();
        const res = {
          w: r.width,
          cx: (r.left + r.right) / 2,
          cy: (r.top + r.bottom) / 2,
          vw: document.documentElement.clientWidth,
          vh: window.innerHeight,
          h: r.height,
        };
        d.classList.replace('sheet--form', 'sheet--info');
        return res;
      });
      if (!fr) throw new Error('広い: シートが無い');
      if (fr.w > 480.5 || Math.abs(fr.cx - fr.vw / 2) > 1 || Math.abs(fr.cy - fr.vh / 2) > 1)
        throw new Error(`広い: 入力のシートが中央でない（幅 ${fr.w}・中心 ${fr.cx},${fr.cy}）`);
      if (fr.h > fr.vh * 0.8 + 1) throw new Error(`広い: 入力のシートの高さ ${fr.h}px`);
      out.push(`広い 入力 ${Math.round(fr.w)}px 中央`);
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '広い: Esc で閉じる');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `data-form で見せ方を替える（${out.join(' / ')}）`;
  });

  // GL1（#57 オーナーの要望）: 「i」の中の用語集のリンクを 3 段たどり、戻るで 1 つずつ前の説明へ戻り、最後に吹き出しが閉じて
  // 記録する画面のまま。もう一度戻ると前の画面。[‹ 前の説明] と Esc でも 1 つずつ戻る。「用語集で見る」で用語集の画面のその項目へ
  await check('GL1', async () => {
    const { c, p, errors } = await recordContext();
    const J = '「判定」の説明';
    // シートの見出し（「i」の言葉そのものを見ている間は「判定」。#129）
    const title = () => sheetTitle(p);
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await toReview(p);
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      // 「判定」の説明は判定のシートの中（#130）。シートを開いてから履歴の段を数える
      await openVerdict(p);
      const len = () => p.evaluate(() => history.length);
      const base0 = await len();
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
      await followLink(p, 'R', 'R');
      await expectPollAsync(async () => (await len()) === base0 + 4, '履歴に 4 段（「i」+ 3 つ）');
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-gl1-depth3.png') });
      for (const want of ['1R', 'LC']) {
        await p.goBack();
        await expectPollAsync(async () => (await title()) === want, `戻るで「${want}」`);
      }
      await p.goBack();
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        '戻るで「判定」',
      );
      await p.goBack();
      await expectPollAsync(async () => (await popCount(p)) === 0, '最後の戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '閉じた後の URL');
      expectEq(await p.locator('#record-entry').inputValue(), '100.00', '下書き');
      await closeSheets(p);
      await p.waitForTimeout(300);
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await toReview(p);
      // [‹ 前の説明] と Esc でも 1 つずつ
      await openVerdict(p);
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '根拠が崩れる条件', '根拠が崩れる条件');
      await p.locator(`${OPEN_SHEET} .info__up`).click();
      await expectPollAsync(async () => (await title()) === 'LC', '[‹ 前の説明] で LC');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        'Esc で「判定」',
      );
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      // 2 段たどってから操作をはさまずに Esc を続けて 2 回 → 1 段ずつ戻って「判定」（close watcher の 2 回目でシートごと
      // 閉じない。#129 のレビュー N1）→ もう 1 回で閉じる
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
      await p.keyboard.press('Escape');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        'Esc を続けて 2 回で「判定」',
      );
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc の 3 回目で閉じる');
      // 関係する言葉の札（#144）: 押すとその言葉へたどる（画面は移らない）。Esc で 1 つ前へ
      await openInfo(p, J);
      await p.locator(`${OPEN_SHEET} .info__related a.chip`, { hasText: /^LC$/ }).click();
      await expectPollAsync(async () => (await title()) === 'LC', '札で「LC」へ');
      expectEq(new URL(p.url()).pathname, '/record', '札でたどった後の URL');
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-gl1-related.png') });
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        '札の後の Esc で「判定」',
      );
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, '札の後の Esc で閉じる');
      await closeSheets(p);
      await p.waitForTimeout(250);
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await toReview(p);
      // 記録する画面でも「用語集で見る」を出す（書きかけは画面を移っても残る。#75 R9。移って戻るは DR1）
      await openInfo(p, '「時間足を変えたか」の説明');
      expectEq(
        await p.locator(`${OPEN_SHEET} .info__glossary`).count(),
        1,
        '記録する画面の「用語集で見る」',
      );
      await p.keyboard.press('Escape');
      // 取引の詳細から「用語集で見る」→ 用語集の画面のその項目 → 戻るで詳細（元の項目は auto のまま）
      await fillRecord(p, EX_E1);
      await p.locator('#record-submit').click();
      await waitSaved(p, '記録しました');
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('main a[href^="/trades/"]').first().click();
      await waitDetail(p);
      // 詳細の答えの札には「i」を置かない（#131 のデザインレビュー a1）。詳細の「i」は判定・R・物差しなので、物差しの説明から
      const RULER = '「LC の物差し」の説明';
      await openInfo(p, RULER);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      expectEq(new URL(p.url()).hash, '#glossary-ruler', '用語集の項目');
      await settle(p);
      const seen = await p.evaluate(() => {
        const r = document.getElementById('glossary-ruler')?.getBoundingClientRect();
        return r ? r.top >= 0 && r.top < window.innerHeight / 2 : false;
      });
      expectEq(seen, true, '用語集の項目が見える');
      await p.goBack();
      await waitDetail(p);
      await p.waitForTimeout(300);
      expectEq(
        await p.evaluate(() => history.scrollRestoration),
        'auto',
        '「用語集で見る」から戻った後の scrollRestoration',
      );
      // 「用語集で見る」→ 用語集の中で 2 回たどる → 上の「‹ 取引の詳細」で 1 回で詳細へ（たどった段を飛ばす）
      await openInfo(p, RULER);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      let at = '#glossary-ruler';
      for (const step of ['1 回目', '2 回目']) {
        const from = at;
        await p.locator(`${from} a.glink`).first().click();
        await expectPollAsync(async () => {
          const h = new URL(p.url()).hash;
          return h.startsWith('#glossary-') && h !== from;
        }, `用語集の中で ${step}たどる`);
        at = new URL(p.url()).hash;
      }
      // シートの閉じる動きが終わり、移った先の窓にシートが残っていない（#129 のデザインレビュー a-1）
      await expectNoSheetShown(p, '用語集へ移った後');
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-glossary-from.png') });
      await p.locator('button.appbar__back', { hasText: '取引の詳細' }).click();
      await waitDetail(p);
      expectEq(new URL(p.url()).pathname.startsWith('/trades/'), true, '‹ 取引の詳細 の行き先');
      // 説明のシートから用語集へ移った後に下のタブを替えて戻る → ホーム（層の段を巻き戻してから積む。#129 のレビュー N6）
      await openInfo(p, RULER);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(new URL(p.url()).pathname, '/', '用語集から設定のタブ → 戻る');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '判定 → LC → 1R → R と 3 段たどる（履歴 +4）→ 戻るで 1R → LC → 判定 → 閉じる（記録する画面・下書きのまま）→ 次の戻るでホーム。[‹ 前の説明]・Esc でも 1 つずつ。記録する画面にも「用語集で見る」がある。詳細の「用語集で見る」で用語集の項目 → 戻るで詳細（auto）、用語集の中で 2 回たどってから「‹ 取引の詳細」で 1 回で詳細';
  });

  // DR1（#75）: 記録する画面の書きかけ。入力 → 「用語集で見る」で用語集へ（「記録の入力は残っています」）→ 戻ると同じ値。
  // [キャンセル] は見出しの右・360 で横スクロール 0・当たり 44 以上。押すと前の画面（一覧）+「記録の入力を破棄しました」と
  // [元に戻す]（フォーカス）→ 押すと記録する画面に同じ値。入力が無い [キャンセル] はトーストなしで一覧へ。
  // 入力がある間の再読み込みだけブラウザの確認（beforeunload）
  await check('DR1', async () => {
    const { c, p, errors } = await recordContext();
    const toast = (t) => p.locator('.toast', { hasText: t });
    const cancel = p.locator('.appbar--sheet button[aria-label="キャンセル"]');
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await toReview(p);
      await p.locator('#record-lc').fill('100.5');
      // キャンセルは全画面のシートの左上の ✕（読み上げの名前「キャンセル」。下の帯は 1 段・文 1 行のまま。#127・#33）・
      // 横スクロール・当たり
      const bar = await p.evaluate(() => {
        const cancelBtn = document.querySelector('.appbar--sheet button[aria-label="キャンセル"]');
        const cr = cancelBtn?.getBoundingClientRect();
        return {
          inHead: !!cancelBtn?.closest('.appbar__start'),
          inBar: !!document.querySelector('.record__submit button[aria-label*="キャンセル"]'),
          left: cr ? cr.left : 999,
          top: cr ? cr.top : 999,
          h: cr ? Math.min(cr.height, cr.width) : 0,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expectEq(bar.inHead && !bar.inBar, true, '✕ は上の帯の左');
      expectEq(bar.left < 60 && bar.top < 60, true, '✕ は左上');
      expectEq(bar.h >= 44, true, '✕ の当たり 44 以上');
      expectEq(bar.over <= 0, true, '360 の横スクロール 0');
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-bar.png') });
      // 「用語集で見る」で移って戻る → 書きかけが残る
      await openInfo(p, '「時間足を変えたか」の説明');
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      await toast('記録の入力は残っています').waitFor({ timeout: 5000 });
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-kept.png') });
      await p.goBack();
      await waitReady(p, '記録する');
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き');
      // 記録している間は下のタブを隠す（下の帯は 1 段。#127・A2。今いる画面のナビを押す #75 B1 は routes.test.ts）
      expectEq(await p.locator('nav.appnav').isVisible(), false, '記録している間の下のタブ');
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き（2）');
      // [キャンセル] → 一覧 + 破棄のトースト・[元に戻す] にフォーカス → 押すと同じ値
      await cancel.click();
      await waitReady(p, '取引');
      await toast('記録の入力を破棄しました').waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'toast-draft-undo',
        '[元に戻す] にフォーカス',
      );
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-discarded.png') });
      await p.locator('#toast-draft-undo').click();
      await waitReady(p, '記録する');
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '[元に戻す] の後の下書き');
      // 再読み込みは確認（beforeunload）を受けて進む
      const before = dialogsSeen.filter((t) => t === 'beforeunload').length;
      await p.reload();
      await waitReady(p, '記録する');
      expectEq(
        dialogsSeen.filter((t) => t === 'beforeunload').length,
        before + 1,
        '入力がある再読み込みの確認',
      );
      // 再読み込みで書きかけは消える（記憶の中だけ）→ 入力が無い [キャンセル] はトーストなしで前の画面（一覧）
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '', '再読み込みの後');
      await cancel.click();
      await waitReady(p, '取引');
      expectEq(await p.locator('.toast').count(), 0, '入力が無いキャンセルのトースト');
      // URL を直接開いた記録する画面（アプリの中の前の画面が無い）の [キャンセル] はホームへ置き換える
      await p.goto(`${base}/record`);
      await waitReady(p, '記録する');
      await toReview(p);
      await cancel.click();
      await waitReady(p, 'ホーム');
      expectEq(await p.locator('.toast').count(), 0, '入力が無いキャンセルのトースト');
      const quiet = dialogsSeen.filter((t) => t === 'beforeunload').length;
      await p.reload();
      await waitReady(p, 'ホーム');
      expectEq(
        dialogsSeen.filter((t) => t === 'beforeunload').length,
        quiet,
        '入力が無い再読み込み',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '入力 → 用語集へ（残っています）→ 戻ると同じ値。キャンセルは左上の ✕・当たり 44 以上・360 で横スクロール 0・下のタブを隠す。押すと一覧 + 破棄のトースト（[元に戻す] にフォーカス）→ [元に戻す] で同じ値。入力がある再読み込みだけ beforeunload の確認、入力が無い [キャンセル] はトーストなしで一覧・URL を直接開いたときはホーム';
  });

  // DR2（#75 レビュー後）: 書きかけの知らせと戻った後の画面を 360 / 1440 × ダーク / ライトで測って撮る。記録: 入力して離れる
  // （「残っています」・［＋ 記録］ の印の点）→ 戻る（見出しの下の「前の入力の続きです」）→ 左上の ✕（破棄のトースト。どの幅でも
  // 下の帯には置かない）→ 入力の無い ✕（トーストなし）。離れるのは幅 720 未満は戻る（下のタブは隠れている）、それ以上は取引の
  // タブ（#127）。編集: 変更して離れる（取引の名前つきの「残っています」）→ 詳細の [編集] の印の点 → 戻る（「前の変更の続きです」）
  // → ✕（破棄のトースト）
  await check('DR2', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, hgt] of [
        [360, 780],
        [1440, 900],
      ]) {
        const c = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
        });
        try {
          await setupContext(c, theme);
          await installFakeApi(c);
          const p = await c.newPage();
          const errors = [];
          p.on('pageerror', (e) => errors.push(e.message));
          const toast = (t) => p.locator('.toast', { hasText: t });
          const shot = async (name) => {
            const over = await p.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expectEq(over <= 0, true, `${w} ${theme} ${name} の横スクロール`);
            if (opts.shots)
              await p.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-dr2-${name}.png`),
              });
          };
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          await toReview(p);
          await p.locator('#record-lc').fill('100.5');
          // 離れる: 幅 720 未満は下のタブが隠れているので戻る、それ以上は取引のタブ（同じタブの押し直し = 根へ。#127）
          if (w >= 720) await p.locator('.appnav a[href="/trades"]').click();
          else await p.goBack();
          await waitReady(p, '取引');
          await toast('記録の入力は残っています').waitFor({ timeout: 5000 });
          expectEq(
            await p.locator('.appnav a[href="/record"] .draftdot').count(),
            1,
            'ナビの印の点',
          );
          // トーストは浮いた ［＋ 記録］ に重ならない（#127 デザイン a1）
          if (w < 720) {
            const over = await p.evaluate(() => {
              const t = document.querySelector('.toast')?.getBoundingClientRect();
              const f = document.querySelector('.appnav__fab')?.getBoundingClientRect();
              return t && f ? Math.max(0, t.bottom - f.top) : -1;
            });
            expectEq(over, 0, 'トーストと ［＋ 記録］ の重なり（px）');
          }
          await shot('kept');
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          // 幅 720 以上は記録している間も行き先が見える: 今いる画面の ［＋ 記録］ を押すと履歴を積まず、見出しへフォーカス
          // （#75 B1・R6。#127 のレビュー N10）
          if (w >= 720) {
            await toReview(p);
            const len = await p.evaluate(() => history.length);
            await p.locator('.appnav a[href="/record"]').click();
            await expectPollAsync(
              async () => (await p.evaluate(() => document.activeElement?.tagName)) === 'H1',
              '今いる画面の ［＋ 記録］ で見出しへフォーカス',
            );
            expectEq(
              await p.evaluate(() => history.length),
              len,
              '今いる画面の ［＋ 記録］ で履歴を積まない',
            );
          }
          await p
            .locator('#record-resumed', { hasText: '前の入力の続きです' })
            .waitFor({ timeout: 5000 });
          expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き');
          expectEq(
            await p.locator('.appnav a[href="/record"] .draftdot').count(),
            0,
            '戻った後の印',
          );
          // キャンセルはどの幅でも左上の ✕ だけ（下の帯に置かない。#127）
          expectEq(
            await p.locator('.appbar--sheet button[aria-label="キャンセル"]').isVisible(),
            true,
            '左上の ✕',
          );
          expectEq(
            await p.locator('.record__submit button[aria-label*="キャンセル"]').count(),
            0,
            '下の帯のキャンセル',
          );
          await shot('restored');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引');
          await toast('記録の入力を破棄しました').waitFor({ timeout: 5000 });
          await shot('discarded');
          await p.locator('.toast button[aria-label="通知を閉じる"]').first().click();
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          await toReview(p);
          expectEq(await p.locator('#record-resumed').count(), 0, '捨てた後は続きの 1 行なし');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引');
          await p.waitForTimeout(200);
          expectEq(await p.locator('.toast').count(), 0, '入力の無い [キャンセル] のトースト');
          await shot('empty-cancel');
          // 編集
          await p.goto(`${base}/trades/x-e1`);
          await waitDetail(p);
          await p.locator('a[href="/trades/x-e1/edit"]').click();
          await waitReady(p, '取引を編集');
          await p.locator('#edit-submit').waitFor({ state: 'visible', timeout: 15000 });
          // 決済の欄は取引の欄のシートの中（#131）。打ったらシートを閉じてから離れる（戻るは先にシートを閉じるため）
          await openEditFields(p);
          const ex = await p.locator('#record-exit').inputValue();
          await p.locator('#record-exit').fill(`${ex}1`);
          await closeSheets(p);
          // 離れる: 幅 720 未満は戻る（詳細へ）、それ以上は取引のタブ（根の一覧へ）→ 行を押して詳細へ（#127）
          if (w >= 720) {
            await p.locator('.appnav a[href="/trades"]').click();
            await waitReady(p, '取引');
          } else {
            await p.goBack();
            await waitDetail(p);
          }
          await toast('の編集の変更は残っています').waitFor({ timeout: 5000 });
          await shot('edit-kept');
          if (w >= 720) {
            await p.locator('a.traderow[href="/trades/x-e1"]').click();
            await waitDetail(p);
          }
          // 印は離れた画面（編集）の後始末で付くので、出るのを待つ
          await p
            .locator('a[href="/trades/x-e1/edit"] .draftdot')
            .waitFor({ state: 'attached', timeout: 5000 });
          expectEq(
            await p.locator('a[href="/trades/x-e1/edit"] .draftdot').count(),
            1,
            '[編集] の印の点',
          );
          await shot('detail-dot');
          await p.locator('a[href="/trades/x-e1/edit"]').click();
          await waitReady(p, '取引を編集');
          await p
            .locator('.draft__resumed', { hasText: '前の変更の続きです' })
            .waitFor({ timeout: 5000 });
          expectEq(await p.locator('#record-exit').inputValue(), `${ex}1`, '戻った後の編集');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitDetail(p);
          await toast('の編集の変更を破棄しました').waitFor({ timeout: 5000 });
          await shot('edit-discarded');
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${w}-${theme}`);
        } finally {
          await c.close();
        }
      }
    // N6: 入力したままログアウト → ログイン → 記録する画面は既定（書きかけは捨てる・印も無い）
    const { c, p, errors } = await recordContext();
    try {
      await p.goto(`${base}/record`);
      await waitReady(p, '記録する');
      await toReview(p);
      // 押して入れる（利用者の操作で履歴の組み直しが書かれる。#127）
      await p.locator('#record-lc').click();
      await p.locator('#record-lc').fill('100.5');
      // 記録している間は下のタブが隠れているので、戻る（ホーム）から設定のタブへ（#127）
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(
        await p.locator('.appnav a[href="/record"] .draftdot').count(),
        1,
        'ログアウト前の印',
      );
      await p.getByRole('button', { name: 'ログアウト' }).click();
      await waitReady(p, 'ログイン');
      await loginViaPopup(p);
      await waitReady(p, 'ホーム');
      expectEq(
        await p.locator('.appnav a[href="/record"] .draftdot').count(),
        0,
        'ログインの後の印',
      );
      // 設定のタブでログアウトした後のログイン: ホームのタブが選ばれ、履歴はホームの 1 段（#127 のレビュー B2）
      expectEq(
        await p.locator('.appnav a[aria-current="page"]').getAttribute('href'),
        '/',
        'ログインの後に選ばれたタブ',
      );
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '', 'ログインの後の下書き');
      expectEq(await p.locator('#record-resumed').count(), 0, 'ログインの後の続きの 1 行');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `${out.join('・')}: 残っています（［＋ 記録］ の点）→ 戻る（続きの 1 行・キャンセルは左上の ✕ だけ）→ 破棄 → 入力なしの ✕ はトーストなし。編集: 取引の名前つきの残っています → 詳細の [編集] の点 → 続きの 1 行 → 破棄。入力したままログアウト → ログイン → 既定の下書き`;
  });

  // GL2（#76）: 用語集の画面。設定から開く・文の中の言葉で 3 回たどり、戻るで 1 つずつ前の項目・最後に設定へ。
  // 360 / 1440 × 両テーマで横スクロール 0・当たり<44 0 件（文の中のリンクは例外）・はみ出し 0
  await check('GL2', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [360, 780],
        [1440, 900],
      ]) {
        const { c, p, errors } = await recordContext();
        try {
          await setupContext(c, theme);
          await p.setViewportSize({ width: w, height: h });
          await openSettings(p, base);
          await p.locator('#settings-link-glossary').click();
          await waitReady(p, '用語集');
          const m = await measure(p, w === 360, TAP);
          if (m.h > 0) throw new Error(`${theme} ${w}: 横スクロール ${m.h}px`);
          if (m.small.length > 0)
            throw new Error(`${theme} ${w}: 当たり<44 ${m.small.join(' / ')}`);
          if (m.clipped.length > 0)
            throw new Error(`${theme} ${w}: はみ出し ${m.clipped.join(' / ')}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-glossary.png`) });
          const hash = () => new URL(p.url()).hash;
          await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-lc', 'LC へ');
          await p.locator('#glossary-lc a.glink', { hasText: '1R' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-oneR', '1R へ');
          await p.locator('#glossary-oneR a.glink', { hasText: 'R' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-r', 'R へ');
          if (opts.shots && w === 360)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-glossary-r.png`) });
          for (const want of ['#glossary-oneR', '#glossary-lc', '']) {
            await p.goBack();
            await expectPollAsync(async () => hash() === want, `戻るで ${want || '先頭'}`);
          }
          expectEq(new URL(p.url()).pathname, '/glossary', '用語集のまま');
          await p.goBack();
          await waitReady(p, '設定');
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${theme} ${w}`);
        } finally {
          await c.close();
        }
      }
    return `設定 → 用語集（横 0・当たり<44 0・はみ出し 0）→ 判定 → LC → 1R → R → 戻るで 1R → LC → 先頭 → 設定（${out.join(' / ')}）`;
  });
}
