import { expectPoll, expectPollAsync, setupContext } from '../base.mjs';
import {
  installFakeApi,
  mustEq,
  READ_DONE,
  READ_E1,
  READ_E10,
  READ_REAL,
  waitSaved,
} from '../fixtures.mjs';
import { recordGroup, zoomRecordGroup } from '../groups.mjs';
import {
  closeSheets,
  fillStatementTaps,
  imageInfoOf,
  makeImage,
  openFields,
  openRecord,
  openVerdict,
  STATEMENT_SPEC,
  toInput,
  toReview,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「記録する（明細の読み取り）」: 読み取り中・読み取りの後・失敗の状態と、明細の読み取り R6〜R10・
 * 読み取りの終わり RD1
 */
export const id = 'record-read';
export const title = '記録する（明細の読み取り）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}

/** 手順（R6・R7・R8・R9・R10・RD1） */
export async function flows(kit) {
  const { browser, base, signedIn, check, expectEq, recordContext, synthetic } = kit;
  await check('R6', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await openRecord(p, base);
      // 画像の貼り付け 1 回 → 1 件
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 1, '貼り付けの後の要求');
      // ファイル選択 1 回 → 1 件（合成の明細の画像）。明細を選ぶ入口は 1 段目だけ（2026-11-21）
      await toInput(p);
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
      // 銘柄の欄は取引の欄のシートの中（#130）
      await openFields(p);
      await p.locator('#record-instrument').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await expectPoll(() => fake.reads.length === 3, '銘柄の欄に画像だけを貼った後の要求');
      await closeSheets(p);
      // E12: 画像として読めないファイル → 要求 0 件・決まった文言（選ぶ入口は 1 段目。2026-11-21）
      await toInput(p);
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
        await toInput(p);
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.appbar__meta', { hasText: '1 / 3 行目' }).waitFor({ timeout: 10000 });
      await p.locator('#record-tz-open').click();
      await p.getByRole('radio', { name: /日本時間（そのまま）/ }).check();
      // 選ぶと当てて閉じる（1 タップ。#130）
      await p.locator('#record-tz-sheet[open]').waitFor({ state: 'detached' });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.locator('.appbar__meta', { hasText: '2 / 3 行目' }).waitFor({ timeout: 10000 });
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-title',
        '次の行の明細の場所へのフォーカス（レビュー指摘 3。#130）',
      );
      // [この行をスキップ] は取引の欄のシートの中（#130）
      await openFields(p);
      await p.getByRole('button', { name: 'この行をスキップ' }).click();
      await p.locator('.appbar__meta', { hasText: '3 / 3 行目' }).waitFor();
      await p.getByRole('status').filter({ hasText: '次の行（3 / 3）' }).waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '飛ばした後の行の番号へのフォーカス',
      );
      await fillStatementTaps(p, '49');
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
      expectEq(fake.posts.length, 3, '保存の要求');
      const after = await snap();
      // 端末に書いてよいのは選んだタイムゾーンの ID の鍵 1 つだけ（#58 KEEP-7）
      const zone = await p.evaluate(() => localStorage.getItem('loss-note.statementTimeZone'));
      expectEq(zone, 'jst', '覚えたタイムゾーン');
      after.ls = after.ls.filter((k) => k !== 'loss-note.statementTimeZone');
      for (const k of ['ls', 'ss', 'idb', 'caches']) {
        expectEq(JSON.stringify(after[k]), JSON.stringify(before[k]), k);
      }
      expectEq(after.href, before.href, 'URL');
      // 履歴の state は画面の行き来の印（appDepth・appTab・appStack）だけ。印は利用者の最初の操作で書く（#127）ので、前後で
      // 印の鍵を除いて比べる（記録の中身を書かない）
      const withoutMark = (raw) => {
        const v = JSON.parse(raw ?? 'null');
        if (!v || typeof v !== 'object') return 'null';
        const { appDepth: _d, appTab: _t, appStack: _s, ...rest } = v;
        return Object.keys(rest).length === 0 ? 'null' : JSON.stringify(rest);
      };
      expectEq(withoutMark(after.state), withoutMark(before.state), '履歴の state（印を除く）');
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
      await toReview(p);
      await p.locator('#record-lc').fill('99.5');
      const msgs = [];
      for (const [status, want] of [
        [503, '今は読み取りを使えません。手入力してください。'],
        [400, 'この画像は読み取れません。別の画像を貼り付けるか、手入力してください。'],
        [502, '読み取れませんでした。もう一度貼り付けるか、手入力してください。'],
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
      await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-lc',
        'やめた後のフォーカス（レビュー指摘 2。#130 で LC へ）',
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-instrument').inputValue(), '架空指数A', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      // 読み取りの値は要約に流れ込む（取引の欄・ほかの欄はシートの中。#130）
      await p.locator('.rsum__l1', { hasText: '架空指数A' }).waitFor();
      expectEq(await p.locator('#record-fee').count(), 0, '手数料（ほかの欄はシートの段 2）');
      const typed = await fillStatementTaps(p);
      await p.locator('.vline .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('.vline .num', { hasText: '−1.0R' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
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

  // RD1（#166。ui-guidelines 9.4 の状態 2・9.8「読み取りが終わった」）: 2 段目の明細の行に、読み取りの終わり方ごとの文
  // （#1「読み取りました」・#2「2 行を読み取りました」・#4「· 入力が必要な欄 2」・#9「読み取りをキャンセルしました」）を
  // 名前の上の 1 行に出し、読み上げの領域 #record-statement-status は読み取り中から同じ要素のまま中身だけが替わる（AC-2）。
  // 読めた・失敗したときだけ明細の行に 1 回の動き（200ms 以下・繰り返さない。キャンセルは動かない。AC-3）、動きを減らす設定で
  // 時間 0（AC-4）、読み取り中に開いたシートを閉じた後も文が見えて 2 回目の動きが無い（AC-5）、次の行へ進むと知らせ 1 つだけ
  // （AC-6）、幅 360 で #4 の文が切れず横 0（AC-7）。次の行の知らせ（#180）: 記録した・スキップした後の知らせは完了の文と同じ
  // 名前の上の 1 行に 1 つだけ（要約の下の段落なし）・同じ読み上げの領域の中身が替わる・動きは増えない・フォーカスは明細の
  // 見出し・印「読み取り」・シートの後も残る・3 行の明細の 2 行目の後も・幅 360 で切れず横 0
  await check('RD1', async () => {
    const out = [];
    const open = async (opts = {}) => {
      const c = await browser.newContext({
        viewport: opts.viewport ?? { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        ...(opts.reduce ? { reducedMotion: 'reduce' } : {}),
      });
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c);
      const p = await c.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await openRecord(p, base);
      // 明細の行に動きの印が付いた回数と、そのときのカードの動きの長さ・繰り返し（MutationObserver で印の付いた瞬間に読む）
      await p.evaluate(() => {
        const w = { adds: 0, on: false, dur: [], iter: [] };
        window.__rd1 = w;
        new MutationObserver(() => {
          const sec = document.querySelector('.rstmt');
          const on = !!sec?.classList.contains('rstmt--flash');
          if (on && !w.on) {
            w.adds++;
            const card = sec.querySelector(':scope > .rstmt__card');
            const cs = card ? getComputedStyle(card) : null;
            w.dur.push(cs ? Number.parseFloat(cs.animationDuration) * 1000 : -1);
            w.iter.push(cs?.animationIterationCount ?? '');
          }
          w.on = on;
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      });
      return { c, p, fake, errors };
    };
    const flash = (p) => p.evaluate(() => ({ ...window.__rd1 }));
    const statusText = (p) =>
      p.evaluate(() => document.getElementById('record-statement-status')?.textContent ?? null);
    const seen = (p) =>
      p.evaluate(() => {
        const el = document.querySelector('.rsum__status');
        return el ? el.textContent : null;
      });
    // 終わった後: 印が外れ、カードに続く動きが無い
    const settled = async (p, what) => {
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => ({
        on: !!document.querySelector('.rstmt--flash'),
        anims: [...document.querySelectorAll('.rstmt__card')].flatMap((c) => c.getAnimations())
          .length,
      }));
      if (r.on || r.anims > 0) throw new Error(`${what}: 動きが続いている（${JSON.stringify(r)}）`);
    };
    const once = (f, what, max = 200) => {
      if (f.adds !== 1) throw new Error(`${what}: 動きの回数 ${f.adds}（1 回）`);
      if (!(f.dur[0] > 0 && f.dur[0] <= max))
        throw new Error(`${what}: 動きの長さ ${f.dur[0]}ms（${max}ms 以下）`);
      if (f.iter[0] !== '1') throw new Error(`${what}: 繰り返し ${f.iter[0]}`);
    };

    // #1 と AC-2・AC-3: 読み取り中の領域を握り、終わった後も同じ要素で中身が完了の文
    {
      const { c, p, fake, errors } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 1500 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        const h = await p.$('#record-statement-status');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#1: 読み上げの領域が描き直された');
        mustEq(kept[1], '読み取りました', '#1 の読み上げ');
        mustEq(await seen(p), '読み取りました', '#1 の見える文');
        once(await flash(p), '#1');
        await settled(p, '#1');
        mustEq(errors.length, 0, 'ページのエラー');
        out.push('#1 同じ領域・1 回');
      } finally {
        await c.close();
      }
    }
    // #9 と AC-2: キャンセルは同じ領域の中身が替わり、動かない
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 5000 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        const h = await p.$('#record-statement-status');
        await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
        await p.locator('.rstmt__card--retry').waitFor();
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#9: 読み上げの領域が描き直された');
        mustEq(kept[1], '読み取りをキャンセルしました', '#9 の読み上げ');
        mustEq(
          await p.locator('.rstmt__card--retry .rsum__l1').textContent(),
          '読み取りをキャンセルしました',
          '#9 の見える文',
        );
        mustEq((await flash(p)).adds, 0, '#9 の動き');
        out.push('#9 同じ領域・動きなし');
      } finally {
        await c.close();
      }
    }
    // #7 と AC-3: 失敗も 1 回だけ動く（文は今の警告のまま）
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 502, rows: [], holdMs: 300 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p
          .getByRole('alert')
          .filter({ hasText: '読み取れませんでした。もう一度貼り付けるか、手入力してください。' })
          .waitFor({ timeout: 10000 });
        once(await flash(p), '#7');
        await settled(p, '#7');
        mustEq(await statusText(p), '', '#7 の読み上げの領域');
        out.push('#7 1 回');
      } finally {
        await c.close();
      }
    }
    // #13 と AC-4: 動きを減らす設定では時間 0・文は同じ
    {
      const { c, p, fake } = await open({ reduce: true });
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 300 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        const f = await flash(p);
        mustEq(f.adds, 1, '#13 の印の回数');
        mustEq(f.dur[0], 0, '#13 の動きの長さ（ms）');
        mustEq(await seen(p), '読み取りました', '#13 の見える文');
        mustEq(await statusText(p), '読み取りました', '#13 の読み上げ');
        out.push('#13 0ms');
      } finally {
        await c.close();
      }
    }
    // #11 と AC-5: 読み取り中にシートを開き、開いたまま終わる → 閉じた後に文が見え、2 回目の動きが無い
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 2500 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        await openVerdict(p);
        await p
          .locator('#record-statement-status', { hasText: '読み取りました' })
          .waitFor({ state: 'attached', timeout: 10000 });
        await p.waitForTimeout(400);
        await closeSheets(p);
        await p.locator('.rsum__status--done').waitFor();
        mustEq(await seen(p), '読み取りました', '#11 の見える文');
        await p.waitForTimeout(400);
        mustEq((await flash(p)).adds, 1, '#11 の動きの回数');
        out.push('#11 閉じた後に文・動き 1 回');
      } finally {
        await c.close();
      }
    }
    // #2・#14 と AC-6: 2 行を読み、1 行目を記録して次の行へ → 知らせ 1 つだけ
    {
      const { c, p, fake } = await open();
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        mustEq(await seen(p), '2 行を読み取りました', '#2 の見える文');
        mustEq(await statusText(p), '2 行を読み取りました', '#2 の読み上げ');
        // #180 の AC-2: 完了の文 → 次の行の知らせの間、読み上げの領域は同じ要素のまま中身だけが替わる
        const h = await p.$('#record-statement-status');
        await fillStatementTaps(p);
        await p.locator('#record-submit').click();
        const notice = '1 / 2 行目を記録しました。次の行（2 / 2）です';
        await p.locator('.rsum__status--notice', { hasText: notice }).waitFor({ timeout: 10000 });
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#14: 読み上げの領域が描き直された');
        mustEq(kept[1], notice, '#14 の読み上げ（#180 の AC-2）');
        // 完了の文は出ず、知らせは名前の上の 1 行の 1 つだけ（要約の下の段落に出さない。#180 の AC-1）
        mustEq(await p.locator('.rsum__status--done').count(), 0, '#14 の完了の文');
        mustEq(await seen(p), notice, '#14 の名前の上の 1 行（#180 の AC-1）');
        mustEq(
          await p.evaluate(
            (t) =>
              [...document.querySelectorAll('.rstmt *:not(.sr-only)')].filter(
                (e) =>
                  e.textContent === t &&
                  ![...e.children].some((k) => k.textContent === t) &&
                  e.getClientRects().length > 0,
              ).length,
            notice,
          ),
          1,
          '#14 の見える知らせの数',
        );
        mustEq(await p.locator('.rstmt [role="status"]').count(), 1, '#14 の読み上げの領域の数');
        mustEq(await p.locator('.rsum__statusicon').count(), 0, '#14 の印（チェックを付けない）');
        // #180 の AC-3: 動きは増えず、フォーカスは明細の見出し、名前の右に印「読み取り」
        mustEq((await flash(p)).adds, 1, '#14 の動きの回数（次の行で動かない）');
        await expectPollAsync(
          async () =>
            (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-title',
          '#14 の次の行のフォーカス',
        );
        mustEq(
          await p.locator('.rsum__mark', { hasText: '読み取り' }).count(),
          1,
          '#14 の印「読み取り」',
        );
        // #180 の AC-5: シートを開いて閉じても残る
        await openFields(p);
        await closeSheets(p);
        mustEq(await seen(p), notice, '#14 のシートの後（#180 の AC-5）');
        out.push('#2・#14 知らせ 1 つ・同じ領域');
      } finally {
        await c.close();
      }
    }
    // #180 の例 #2・#3: 3 行の明細で 1 行目を記録・2 行目を記録、別の明細で 1 行目をスキップ。幅 360 で切れない（AC-4）
    {
      const { c, p, fake } = await open({ viewport: { width: 360, height: 780 } });
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }, { ...READ_E1, symbol: '架空指数D' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        for (const [i, want] of [
          [0, '1 / 3 行目を記録しました。次の行（2 / 3）です'],
          [1, '2 / 3 行目を記録しました。次の行（3 / 3）です'],
        ]) {
          await fillStatementTaps(p);
          await p.locator('#record-submit').click();
          await p.locator('.rsum__status--notice', { hasText: want }).waitFor({ timeout: 10000 });
          mustEq(await seen(p), want, `#2 の ${i + 1} 行目の後`);
          mustEq(await statusText(p), want, `#2 の ${i + 1} 行目の後の読み上げ`);
          const m = await p.evaluate(() => {
            const el = document.querySelector('.rsum__status--notice');
            const span = el?.querySelector('span');
            const r = el.getBoundingClientRect();
            const card = el.closest('.rstmt__card').getBoundingClientRect();
            return {
              cut:
                [el, span].some(
                  (x) =>
                    x &&
                    (x.scrollWidth > x.clientWidth + 1 ||
                      getComputedStyle(x).textOverflow === 'ellipsis'),
                ) || r.right > card.right + 0.5,
              h: document.documentElement.scrollWidth - window.innerWidth,
            };
          });
          if (m.cut) throw new Error(`#2 の ${i + 1} 行目の後: 知らせが切れている`);
          mustEq(m.h, 0, `#2 の ${i + 1} 行目の後の横スクロール（#180 の AC-4）`);
        }
        out.push('#180 の #2 幅 360 で切れない');
      } finally {
        await c.close();
      }
    }
    {
      const { c, p, fake } = await open();
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        await openFields(p);
        await p.getByRole('button', { name: 'この行をスキップ' }).click();
        const want = '1 / 2 行目をスキップしました。次の行（2 / 2）です';
        await p.locator('.rsum__status--notice', { hasText: want }).waitFor({ timeout: 10000 });
        mustEq(await statusText(p), want, '#3 の読み上げ');
        mustEq(await p.locator('.rstmt .statement__text').count(), 0, '#3 の要約の下の段落');
        out.push('#180 の #3 スキップ');
      } finally {
        await c.close();
      }
    }
    // #4 と AC-7: 幅 360 で「読み取りました · 入力が必要な欄 2」が切れず、横 0
    {
      const { c, p, fake } = await open({ viewport: { width: 360, height: 780 } });
      try {
        fake.read = {
          status: 200,
          rows: [{ ...READ_REAL, quantity: null, exitTime: null }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        mustEq(await seen(p), '読み取りました · 入力が必要な欄 2', '#4 の見える文');
        const m = await p.evaluate(() => {
          const el = document.querySelector('.rsum__status');
          const span = el?.querySelector('span');
          const r = el.getBoundingClientRect();
          const card = el.closest('.rstmt__card').getBoundingClientRect();
          return {
            cut:
              [el, span].some(
                (x) =>
                  x &&
                  (x.scrollWidth > x.clientWidth + 1 ||
                    getComputedStyle(x).textOverflow === 'ellipsis'),
              ) || r.right > card.right + 0.5,
            h: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        if (m.cut) throw new Error('#4: 完了の文が切れている');
        mustEq(m.h, 0, '#4 の横スクロール');
        mustEq(await p.locator('.rsum__chip').count(), 2, '#4 のチップ');
        mustEq(await p.locator('.rsum__statusicon--need').count(), 1, '#4 の印（中立の「!」）');
        // 欄を埋めると見える文の数は減るが、読み上げは終わった時点の文のまま（読み上げ直さない。コードレビュー 2）
        await openFields(p);
        await p.locator('#record-quantity').fill('1');
        await closeSheets(p);
        await p.locator('.rsum__status', { hasText: '入力が必要な欄 1' }).waitFor();
        mustEq(
          await statusText(p),
          '読み取りました · 入力が必要な欄 2',
          '#4 の欄を埋めた後の読み上げ',
        );
        out.push('#4 幅 360 で切れない・埋めても読み上げ直さない');
      } finally {
        await c.close();
      }
    }
    return out.join(' / ');
  });
}
