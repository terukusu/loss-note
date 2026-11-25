import { expectPoll, expectPollAsync, THEME_KEY, waitReady } from '../base.mjs';
import { READ_DONE, READ_E1, waitSaved } from '../fixtures.mjs';
import { recordGroup, zoomRecordGroup } from '../groups.mjs';
import {
  CHART_MARKER,
  EX_E1,
  fillRecord,
  fillStatementTaps,
  imageInfoOf,
  makeChart,
  makeImage,
  openChartSheet,
  openRecord,
  openVerdict,
  pasteChart,
  STATEMENT_SPEC,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「記録する（チャート）」: チャートの枠・時間足の読み取り・付属のチャートの状態と、CR1・C1〜C3・
 * まとめて選ぶ BP1・BP2・BP3（#232）
 */
export const id = 'record-chart';
export const title = '記録する（チャート）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}

/** 手順（CR1・C1・C2・C3・BP1・BP2・BP3） */
export async function flows(kit) {
  const { base, check, expectEq, recordContext, synthetic } = kit;
  // ── チャートの時間足の読み取り（CR1。Issue #27）。偽の記録の API が 4 時間足・日足を返す
  await check('CR1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      // チャートの注意は 1 段目のチャートの枠の下（2026-11-21）
      await p.locator('.rin .charts__notice', { hasText: 'AI（Anthropic）に送ります' }).waitFor();
      fake.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await expectPollAsync(
        async () => (await p.locator('#record-chart-exit-tf').inputValue()) === '1d',
        '読み取りで埋まった決済時の時間足',
      );
      expectEq(
        await p.locator('#record-chart-entry-tf').inputValue(),
        '4h',
        'エントリー時の時間足',
      );
      expectEq(await p.locator('#record-chart-entry-tf-mark').textContent(), 'チャートから', '印');
      expectEq(fake.chartReads, 2, '時間足の読み取りの要求');
      expectEq(fake.reads.length, 0, '明細の読み取りの要求');
      await openVerdict(p);
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // 利用者が直すと印が消える（時間足の欄はチャートのシートの中。#130）
      await openChartSheet(p);
      await p.locator('#record-chart-entry-tf').selectOption('1h');
      expectEq(await p.locator('#record-chart-entry-tf-mark').count(), 0, '直した後の印');
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'チャートを 2 枠に貼る → 時間足の読み取り 2 回・欄に 4 時間足 / 日足と印・判定に「チャートから」・直すと印が消える・横スクロール 0';
  });

  // ── 根拠の足のチャート（C1〜C3。Issue #12）。偽の記録の API で流す
  await check('C1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      // 1 画面の小さな枠（空 = ファイルの欄）に貼る → 枠に入り、明細の読み取りの要求は 0（#130）
      await pasteChart(p, 'entry');
      expectEq(fake.reads.length, 0, '小さな枠に貼った後の明細の読み取りの要求');
      // チャートのシート: エントリー時の枠を選んで貼る → 枠に入り（差し替え）、明細の読み取りの要求は 0
      await openChartSheet(p);
      await p.locator('#record-chart-entry .chart__name').click();
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
      // 時間足の欄はチャートのある枠だけ（2 枚あるので 2 つ）。[削除] で欄も消え、フォーカスは枠へ
      expectEq(await p.locator('.chart select').count(), 2, '時間足の欄の数');
      await p.locator('#record-chart-exit-tf').selectOption('1d');
      // レビュー指摘 1: 時間足の欄にフォーカスが残ったまま貼る → 目印（輪・「ここに貼り付け」）は出ておらず、
      // チャートは置き換わらず時間足も消えない（明細の読み取りへ。目印と行き先が一致する）
      await p.locator('#record-chart-exit-tf').focus();
      const ringOnSelect = await p.evaluate(
        () => getComputedStyle(document.querySelector('#record-chart-exit .chart__ready')).display,
      );
      expectEq(ringOnSelect, 'none', '時間足の欄にフォーカスがあるときの「ここに貼り付け」');
      const exitPreviewBefore = await p.evaluate(
        () => document.querySelector('#record-chart-exit canvas.chart__preview') !== null,
      );
      await makeChart(p, 'paste');
      await expectPoll(() => fake.reads.length === 1, '時間足の欄に貼った後の明細の読み取りの要求');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
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
        '枠にフォーカスがあるときの「ここに貼り付け」',
      );
      await p
        .locator('#record-chart-exit')
        .getByRole('button', { name: '決済時のチャートを削除' })
        .click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-chart-exit',
        '[削除] の後のフォーカス',
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
    return '枠をクリック / Tab で選んで貼る → その枠（明細の要求 0）・時間足の欄にフォーカスで貼る → 目印なし・明細へ・チャートと時間足は不変・枠の外に貼る → 明細・[チャートを選ぶ] → 枠・[削除] → 欄が消えフォーカスは枠';
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
      await waitSaved(p, '記録しました');
      await p.getByText('チャート 2 枚も保存しました').waitFor();
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      // もう 1 枚貼ってから一覧へ移る（保存しないチャートは送らない。E12）
      await pasteChart(p, 'entry');
      const postsBefore = fake.chartPosts.length;
      // 記録している間は下のタブが隠れているので、戻るで離れる（#127）
      await p.goBack();
      await waitReady(p, 'ホーム');
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      const typed = await fillStatementTaps(p);
      await p.locator('.vline .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
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

  // ── スクショをまとめて選ぶ（BP1・BP2。#232・C67）。写真（ファイル）の選択の画面を開いた回数を数える（EPIC #233 の終了条件 5:
  // 1 段目から明細 1 枚 + チャート 2 枚を入れるまで。前は 3 回 = 明細の枠 → 2 段目のチャートの行 → チャートのシートの決済時）
  const countChoosers = (p) => {
    const seen = { n: 0, last: null };
    p.on('filechooser', (fc) => {
      seen.n++;
      seen.last = fc;
    });
    return seen;
  };
  await check('BP1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      fake.chartTimeframes = ['4h', '1d'];
      await openRecord(p, base);
      const chart = Buffer.from(await makeChart(p, 'bytes'));
      const choosers = countChoosers(p);
      // 1 段目の明細の枠の ［スクショを選ぶ］ を押す → 選択の画面で 3 枚を選んだ順に返す
      const opened = p.waitForEvent('filechooser');
      await p.locator('label[for="record-statement-file"]').click();
      const fc = await opened;
      expectEq(fc.isMultiple(), true, '選択の画面で複数を選べる');
      await fc.setFiles([
        { name: 's05.png', mimeType: 'image/png', buffer: synthetic },
        { name: `${CHART_MARKER}-1.png`, mimeType: 'image/png', buffer: chart },
        { name: `${CHART_MARKER}-2.png`, mimeType: 'image/png', buffer: chart },
      ]);
      // 2 段目へ: 明細の要約・チャートの行（エントリー時 · 4 時間足 / 決済時 · 日足）
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await p
        .locator('#record-mini-entry', { hasText: '決済時 · 日足' })
        .waitFor({ timeout: 10000 });
      await p.locator('#record-mini-entry', { hasText: '4 時間足' }).waitFor();
      expectEq(fake.reads.length, 1, '明細の読み取りの要求');
      expectEq(fake.chartReads, 2, '時間足の読み取りの要求');
      expectEq(await p.locator('#record-bulk-swap').count(), 0, '入れ替えの案内（明細が読めた）');
      // チャートのシートにエントリー時・決済時の 2 枚
      await openChartSheet(p);
      expectEq(
        await p.locator('.chart canvas.chart__preview').count(),
        2,
        'シートのチャートの枚数',
      );
      expectEq(choosers.n, 1, '写真の選択の画面を開いた回数');
      expectEq(errors.length, 0, 'ページのエラー');
      return `1 段目の ［スクショを選ぶ］ で 3 枚 → 明細・エントリー時・決済時。選択の画面 ${choosers.n} 回・明細の要求 1・時間足の要求 2`;
    } finally {
      await c.close();
    }
  });

  await check('BP2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      // 逆に選んだ（チャート → 明細）: 明細は「明細として読めない」、エントリー時は「チャートでない」
      fake.read = { status: 200, rows: [], holdMs: 0 };
      fake.chartRead = { status: 200, kind: 'not_chart', holdMs: 0 };
      await openRecord(p, base);
      const chart = Buffer.from(await makeChart(p, 'bytes'));
      await p.locator('#record-statement-file').setInputFiles([
        { name: `${CHART_MARKER}.png`, mimeType: 'image/png', buffer: chart },
        { name: 's05.png', mimeType: 'image/png', buffer: synthetic },
      ]);
      const swap = p.locator('#record-bulk-swap');
      await swap.waitFor({ timeout: 10000 });
      expectEq(
        await p.locator('.rbulk__text').first().textContent(),
        '明細とチャートが逆かもしれません',
        '入れ替えの案内',
      );
      expectEq(
        await swap.getAttribute('aria-label'),
        '明細とエントリー時のチャートを入れ替える',
        '読み上げの名前',
      );
      // 案内の行は明細の行とチャートの行の間（2 段目の入れたもののカードの中）
      const order = await p.evaluate(() =>
        [...document.querySelector('.rinput').children].map((e) => e.className.split(' ')[0]),
      );
      expectEq(order.indexOf('rbulk') - order.indexOf('rstmt'), 1, '案内の行の位置');
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '横スクロール');
      // 押す → 選択の画面を開かずに入れ替えて読み直す（明細の要求 +1・時間足の要求 +1）
      // 読み直しを少し待たせて、読み取り中のフォーカス（明細の行の見出し）と、読めた後のフォーカス（LC。今の読み取りの規則）を見る
      fake.read = { status: 200, rows: [READ_E1], holdMs: 1500 };
      fake.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
      fake.chartTimeframes = ['4h'];
      const choosers = countChoosers(p);
      await swap.click();
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-title',
        '入れ替えた直後のフォーカス（明細の行の見出し）',
      );
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await p.locator('#record-mini-entry', { hasText: '4 時間足' }).waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 2, '明細の読み取りの要求');
      expectEq(fake.chartReads, 2, '時間足の読み取りの要求');
      expectEq(choosers.n, 0, '入れ替えで開いた選択の画面');
      expectEq(await swap.count(), 0, '入れ替えた後の案内');
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-lc',
        '読めた後のフォーカス（LC）',
      );
      expectEq(errors.length, 0, 'ページのエラー');
      return '逆に選ぶ → 明細とチャートの間に案内と ［入れ替える］（横スクロール 0）→ 押すと選択なしで読み直し（明細 +1・時間足 +1）・案内が消え・フォーカスは明細の行の見出し → 読めたら LC';
    } finally {
      await c.close();
    }
  });

  // 取り違えた組を 1 段目でまとめて選び直す（BP3。#232 のレビュー 1・C67）: 前の組の枠（本人が触っていない）は外して入れ直す
  await check('BP3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [], holdMs: 0 };
      fake.chartRead = { status: 200, kind: 'not_chart', holdMs: 0 };
      await openRecord(p, base);
      const chart = Buffer.from(await makeChart(p, 'bytes'));
      await p.locator('#record-statement-file').setInputFiles([
        { name: `${CHART_MARKER}.png`, mimeType: 'image/png', buffer: chart },
        { name: 's05.png', mimeType: 'image/png', buffer: synthetic },
      ]);
      await p.locator('#record-bulk-swap').waitFor({ timeout: 10000 });
      // ［スクショ］ で 1 段目へ戻り、正しい順で 3 枚を選び直す
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      fake.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
      fake.chartTimeframes = ['4h', '1d'];
      await p.locator('#record-to-input').click();
      const choosers = countChoosers(p);
      const opened = p.waitForEvent('filechooser');
      await p.locator('label[for="record-statement-file"]').click();
      await (await opened).setFiles([
        { name: 's05.png', mimeType: 'image/png', buffer: synthetic },
        { name: `${CHART_MARKER}-1.png`, mimeType: 'image/png', buffer: chart },
        { name: `${CHART_MARKER}-2.png`, mimeType: 'image/png', buffer: chart },
      ]);
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await p
        .locator('#record-mini-entry', { hasText: '決済時 · 日足' })
        .waitFor({ timeout: 10000 });
      await p.locator('#record-mini-entry', { hasText: '4 時間足' }).waitFor();
      expectEq(await p.locator('#record-bulk-swap').count(), 0, '選び直した後の入れ替えの案内');
      // 前の組のエントリー時（中身は明細の画像）は残らず、追加のチャートも増えない
      await openChartSheet(p);
      expectEq(
        await p.locator('.chart canvas.chart__preview').count(),
        2,
        'シートのチャートの枚数',
      );
      expectEq(choosers.n, 1, '選び直しで開いた選択の画面');
      expectEq(errors.length, 0, 'ページのエラー');
      return '逆に選ぶ → ［スクショ］ で 1 段目 → 3 枚を選び直す → 明細・エントリー時 4 時間足・決済時 日足（前の組の枠は入れ直し・追加 0）・選択の画面 1 回';
    } finally {
      await c.close();
    }
  });
}
