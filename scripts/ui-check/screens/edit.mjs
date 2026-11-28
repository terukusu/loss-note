import { expectPollAsync, waitDetail, waitReady } from '../base.mjs';
import { accountsGroup, chartsGroup, fxGroup, pagesGroup, zoomPagesGroup } from '../groups.mjs';
import {
  closeSheets,
  expectSheetInWindow,
  openVerdict,
  seg,
  settleSheet,
  sheetBox,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「取引の編集」: 編集の画面（口座 2 つ・外貨建て・チャートの差し替え）と、T-E1〜T-E5
 */
export const id = 'edit';
export const title = '取引の編集';

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

/** 手順（T-E1・T-E2・T-E3・T-E4・T-E5） */
export async function flows(kit) {
  const {
    base,
    check,
    expectEq,
    path,
    recordContext,
    verdictOf,
    OWNER_ACCOUNTS,
    resnapTrade,
    overflowX,
    shootPair,
    openCompare,
  } = kit;
  await check('T-E1', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 2000000 });
    try {
      await p.goto(`${base}/trades/x-e1`);
      await waitReady(p, 'US30 · L');
      await p.locator('a[href="/trades/x-e1/edit"]').click();
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', 'LC の欄');
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '編集前');
      await seg(p, 'LC を動かしたか', 'そのまま').click();
      expectEq(
        await p.locator('#edit-change').textContent(),
        '判定: B 悪い損失 −1.0R → A いい損失 −1.0R',
        '保存の帯の直す前 → 直した後',
      );
      const v = await verdictOf(p);
      expectEq(v.badge, 'A いい損失', 'プレビュー');
      if (!v.text.includes('−1.0R') || !v.text.includes('0.5%') || v.text.includes('0.3%'))
        throw new Error(`プレビュー: ${v.text}`);
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-e1', '保存の後の URL');
      await p.locator('.verdict .badge').first().waitFor();
      const after = await verdictOf(p);
      expectEq(after.badge, 'A いい損失', '保存の後');
      if (!after.text.includes('0.5%')) throw new Error(`保存の後: ${after.text}`);
      expectEq(fake.puts.length, 1, 'PUT の数');
      expectEq(JSON.stringify(fake.puts[0].body.lcMove), '{"kind":"none"}', 'LC を動かしたか');
      expectEq(fake.trades.find((t) => t.id === 'x-e1').snapshot.capitalYen, 1000000, '写した資金');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '直す前 B →「そのまま」でプレビューも保存後も A・−1.0R・0.5%（今の資金 2,000,000 円の 0.3% にならない）';
  });

  await check('T-E2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-e2`);
      await waitReady(p, 'US30 · L');
      await p.locator('.verdict .badge').first().waitFor();
      const before = await verdictOf(p);
      expectEq(before.badge, 'B 悪い損失', '編集前');
      if (!before.reasons.some((r) => r.includes('チャートから'))) throw new Error('直す前の理由');
      await p.goto(`${base}/trades/x-e2/edit`);
      await waitReady(p, '取引を編集');
      const notice = await p.locator('#edit-orphans').textContent();
      if (
        !notice?.includes('エントリー時: 4 時間足・決済時: 日足') ||
        !notice.includes('保存時に削除されます')
      )
        throw new Error(`外す旨: ${notice}`);
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.verdict .badge').first().waitFor();
      expectEq((await verdictOf(p)).badge, 'A いい損失', '保存の後');
      const body = fake.puts[0]?.body ?? {};
      expectEq(
        'entryChartTimeframe' in body || 'exitChartTimeframe' in body,
        false,
        '本文の時間足',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'チャートの無い枠の時間足を外す旨を出し、何も変えずに保存 → 200、保存の後 A';
  });

  await check('T-E3', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      fake.trades.push(resnapTrade('x-e3', 1700000000008, null, 30));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e3/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      // 比較は 1 行「今の値と比べる」（#131。カード・折りたたみは置かない）
      expectEq(await p.locator('main details, main section.resnap').count(), 0, '画面の中の枠');
      expectEq(
        ((await p.locator('#edit-compare').textContent()) ?? '').trim(),
        '今の値と比べる1 か所違います',
        '比較の行',
      );
      await openCompare(p);
      const panel = p.locator('#edit-compare-sheet .resnap');
      const ptext = (await panel.textContent()) ?? '';
      if (
        !ptext.includes('この取引には資金が保存されていないため、過剰リスクを判定していません。') ||
        !ptext.includes('200,000円') ||
        !ptext.includes('2.5%') ||
        !ptext.includes('「A いい損失」から「B 悪い損失」に変わります') ||
        ptext.includes('写')
      )
        throw new Error(`比較のシート: ${ptext}`);
      expectEq(
        await p.locator('input[name="edit-resnapshot"][value="recorded"]').isChecked(),
        true,
        '2 択の既定',
      );
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-owner-compare');
      // 判定のシートの注記のそばの ［今の値で再計算］（押すと比較のシートを開いて「今の値」へ）
      await openVerdict(p);
      const v0 = await verdictOf(p);
      expectEq(v0.badge, 'A いい損失', '開いたとき');
      if (!v0.text.includes('資金が未設定のため、過剰リスクは判定していません'))
        throw new Error(`注記: ${v0.text}`);
      const near = p.locator('#edit-verdict-sheet .verdict__action button');
      expectEq((await near.textContent())?.trim(), '今の値で再計算', '注記のそばのボタン');
      expectEq(await overflowX(p), 0, '360px の横スクロール（選ぶ前）');
      await shootPair(p, '#edit-verdict-sheet .verdict__action', 'edit-resnapshot-owner-before');
      await near.focus();
      await p.keyboard.press('Enter');
      await p.locator('#edit-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      // N-3: 押したボタンは消えるので、フォーカスは比較のシートの「今の値」へ
      await expectPollAsync(
        () =>
          p.evaluate(() => {
            const a = document.activeElement;
            return (
              a instanceof HTMLInputElement && a.name === 'edit-resnapshot' && a.value === 'current'
            );
          }),
        'フォーカスの行き先',
      );
      await expectPollAsync(
        async () => (await verdictOf(p)).badge === 'B 悪い損失',
        '選んだ後のプレビュー',
      );
      const v1 = await verdictOf(p);
      if (v1.text.includes('資金が未設定') || !v1.text.includes('2.5%'))
        throw new Error(`選んだ後: ${v1.text}`);
      expectEq(
        await p.locator('.verdict .verdict__action').count(),
        0,
        '選んだ後の注記のそばのボタン',
      );
      expectEq(
        await p.locator('#edit-change').textContent(),
        '今の値で再計算 · 判定: A いい損失 −1.0R → B 悪い損失 −1.0R',
        '保存の帯',
      );
      if (
        !((await p.locator('#edit-resnapshot-status').textContent()) ?? '').includes(
          '戻すには「記録したとき」',
        )
      )
        throw new Error('戻し方の文');
      expectEq(await overflowX(p), 0, '360px の横スクロール（選んだ後）');
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-owner-after');
      await closeSheets(p);
      expectEq(
        ((await p.locator('#edit-compare').textContent()) ?? '').trim(),
        '今の値と比べる今の値で計算中',
        '選んだ後の比較の行',
      );
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-e3', '保存の後の URL');
      expectEq(fake.puts.length, 1, 'PUT の数');
      expectEq(fake.puts[0].query, '?snapshot=current', 'PUT のクエリ');
      expectEq(
        fake.trades.find((t) => t.id === 'x-e3').snapshot.capitalYen,
        200000,
        '保存した資金',
      );
      await p.locator('.verdict .badge').first().waitFor();
      const after = await verdictOf(p);
      expectEq(after.badge, 'B 悪い損失', '保存の後');
      if (!after.text.includes('2.5%') || after.text.includes('資金が未設定'))
        throw new Error(`保存の後: ${after.text}`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '口座 2 つ・資金が空の取引: 行「今の値と比べる」→ 比較のシート（未設定 → 200,000円・— → 2.5%・A → B の 1 文）、判定のシートの [今の値で再計算] → Enter で比較のシートの「今の値」へ・B・帯「今の値で再計算 · 判定: A → B」→ 保存で ?snapshot=current・保存した資金 200,000 円・詳細 2.5%（360px 横スクロール 0）';
  });

  await check('T-E4', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      // 記録したとき 1,000,000 円（0.5% = A）、今 200,000 円（2.5% = B）。勧めない（文で勧めない・ボタンも無い）
      fake.trades.push(resnapTrade('x-e4', 1700000000009, 1000000, 31));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e4/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      expectEq(await p.locator('main details, main section.resnap').count(), 0, '画面の中の枠');
      expectEq(await p.locator('.verdict .verdict__action').count(), 0, '注記のそばのボタン');
      await openCompare(p);
      const ftext = (await p.locator('#edit-compare-sheet .resnap').textContent()) ?? '';
      if (
        !ftext.includes('1,000,000円') ||
        !ftext.includes('「A いい損失」から「B 悪い損失」に変わります')
      )
        throw new Error(`中身: ${ftext}`);
      await p.locator('input[name="edit-resnapshot"][value="current"]').check();
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '今の値のプレビュー');
      expectEq(await overflowX(p), 0, '360px の横スクロール');
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-fold-open');
      await p.locator('input[name="edit-resnapshot"][value="recorded"]').check();
      expectEq((await verdictOf(p)).badge, 'A いい損失', '戻した後');
      await closeSheets(p);
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(fake.puts[0].query, '', '戻した後の PUT にクエリなし');
      expectEq(
        fake.trades.find((t) => t.id === 'x-e4').snapshot.capitalYen,
        1000000,
        '資金は記録したときのまま',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '資金が入っていた取引: 行「今の値と比べる」→ 比較のシート（A → B の 1 文）・注記のそばのボタンなし →「今の値」で B →「記録したとき」で戻して保存はクエリなし・資金はそのまま';
  });

  // #131 AC-2・AC-3: 詳細の「…」→ 操作のシート →「今の値と比べる」→ 比較のシート（見るだけ・2 択なし）→ ［編集で今の値にする］ で
  // 編集が「今の値」を選んだ状態で開く。詳細で比べている間は保存の要求 0（#31 の P4）。保存で ?snapshot=current
  await check('T-E5', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    const out = [];
    try {
      fake.trades.push(resnapTrade('x-e5', 1700000000010, 1000000, 32));
      for (const [w, h] of [
        [390, 844],
        [1440, 900],
      ]) {
        await p.setViewportSize({ width: w, height: h });
        await p.goto(`${base}/trades/x-e5`);
        await waitDetail(p);
        await p.locator('#detail-more').click();
        const actions = p.locator('#detail-actions-sheet[open]');
        await actions.waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectEq(
          (await actions.locator('.rowlink .rowlink__text').allTextContents()).join(' / '),
          '今の値と比べる / 両建てに結ぶ / 削除',
          '操作のシートの行',
        );
        expectSheetInWindow(await sheetBox(p), `${w} 操作のシート`);
        await p.locator('#detail-action-compare').click();
        const compare = p.locator('#detail-compare-sheet[open]');
        await compare.waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${w} 比較のシート`);
        expectEq(await compare.locator('input[type="radio"]').count(), 0, '詳細の比較の 2 択');
        const t = (await compare.textContent()) ?? '';
        if (!t.includes('1,000,000円') || !t.includes('200,000円'))
          throw new Error(`比較のシート: ${t}`);
        expectEq(fake.puts.length, 0, '詳細で比べている間の PUT');
        await compare.getByRole('link', { name: '編集で今の値にする' }).click();
        await waitReady(p, '取引を編集');
        expectEq(`${path(p)}${new URL(p.url()).search}`, '/trades/x-e5/edit?values=current', 'URL');
        await expectPollAsync(
          async () =>
            ((await p.locator('#edit-compare').textContent()) ?? '').includes('今の値で計算中'),
          '「今の値」を選んで開く',
        );
        expectEq((await verdictOf(p)).badge, 'B 悪い損失', '今の値のプレビュー');
        expectEq(fake.puts.length, 0, '開いただけでは PUT しない');
        if (w === 1440) {
          await p.locator('#edit-submit').click();
          await waitDetail(p);
          expectEq(fake.puts.length, 1, 'PUT の数');
          expectEq(fake.puts[0].query, '?snapshot=current', 'PUT のクエリ');
        } else {
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitDetail(p);
        }
        out.push(`${w}: 操作 → 比較 → 編集（今の値）`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `詳細の比較は見るだけ（2 択なし・PUT 0）、［編集で今の値にする］ で「今の値」を選んだ編集・保存で ?snapshot=current（${out.join(' / ')}）`;
  });
}
