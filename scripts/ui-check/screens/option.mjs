import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectPollAsync, opts, ROOT, setupContext, waitDetail, waitReady } from '../base.mjs';
import { jstTime, READ_DONE } from '../fixtures.mjs';
import {
  closeSheets,
  expectSheetInWindow,
  makeImage,
  openEditFields,
  openFields,
  openRecord,
  STATEMENT_SPEC,
  settleSheet,
  sheetBox,
  summaryCuts,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「オプションのポジション」: レッグの記録・詳細・編集 OPT117 と、明細のオプションの行 OPT118・OPT118N
 */
export const id = 'option';
export const title = 'オプションのポジション';

/** 手順（OPT117・OPT118・OPT118N） */
export async function flows(kit) {
  const { base, check, expectEq, recordContext } = kit;
  // OPT117（#117）: オプションのポジションのレッグ。架空の銘柄（商品の形 = オプション）と、合成の fixture（option-legs.json の P1）の
  // 取引で、記録する画面の 2 段目の取引の欄のシートの段 leg（［＋ レッグ］）・詳細のレッグの表・編集の段 leg を開き、シートが窓の中・
  // 横のスクロール 0 を見る。編集は何も変えずに保存し、PUT の本文にレッグが載る（#116 の 409 legsMissing を避ける）。
  // --shots なら 3 つ（記録の段 leg・詳細・編集の段 leg）だけ撮る（ダーク）
  await check('OPT117', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      const fx = JSON.parse(
        readFileSync(join(ROOT, 'tests/fixtures/records/option-legs.json'), 'utf8'),
      ).items.find((x) => x.name === 'P1');
      const inst = {
        id: 'inst-xyzopt',
        ...fx.instrument,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };
      delete inst.underlying;
      fake.instruments.push(inst);
      // 10 本（架空。P1 の 3 本を写して行使価格をずらす）
      const ten = Array.from({ length: 10 }, (_, i) => {
        const b = fx.record.legs[i % fx.record.legs.length];
        return { ...b, id: `l${i + 1}`, strike: b.strike + 100 * i };
      });
      fake.trades.push({
        id: 'x-opt10',
        schemaVersion: 2,
        createdAt: 1700000000021,
        updatedAt: 1700000000021,
        record: { ...fx.record, instrumentId: inst.id, legs: ten },
        snapshot: fx.snapshot,
      });
      fake.trades.push({
        id: 'x-opt1',
        schemaVersion: 2,
        createdAt: 1700000000020,
        updatedAt: 1700000000020,
        record: { ...fx.record, instrumentId: inst.id },
        snapshot: fx.snapshot,
      });
      const shot = async (slug) => {
        if (!opts.shots) return;
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, `390x844-dark-${slug}.png`) });
      };
      // 記録する・編集の取引の欄のシート（OPEN_SHEET は record-*-sheet を除くので、id で見る）
      const titleOf = async (id) =>
        ((await p.locator(`#${id}[open] .sheet__title`).textContent()) ?? '').trim();
      const hscroll = () =>
        p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      // 記録する画面: ［明細なしで手入力］ → 銘柄をオプションに → レッグの一覧 → ［＋ レッグ］ で段 leg
      await openRecord(p, base);
      await openFields(p);
      await p.locator('#record-instrument').fill(inst.name);
      await p.locator('#record-legs-add').waitFor({ state: 'visible', timeout: 5000 });
      expectEq(
        await p.locator('#record-fields-sheet[open] #record-quantity').count(),
        0,
        '数量の欄',
      );
      await p.locator('#record-legs-add').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 1',
        '段 leg の題',
      );
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '記録の段 leg');
      expectEq(await hscroll(), 0, '記録の横のスクロール');
      // 1 本の欄は幅 390 でも 2 列で、決済と ［満期で消滅］ まで 1 画面に入る（デザインレビュー N1）
      const below = await p.evaluate(() =>
        ['leg-0-expired', 'leg-0-exit']
          .map((id) => document.getElementById(id)?.getBoundingClientRect())
          .filter((r) => !r || r.bottom > window.innerHeight)
          .map((r) => (r ? Math.round(r.bottom) : 'なし')),
      );
      expectEq(below.length, 0, `決済・満期で消滅が窓の下（${below.join(' / ')}）`);
      await shot('opt-record-leg');
      const toMain = async () => {
        await p.keyboard.press('Escape');
        await expectPollAsync(
          async () => (await titleOf('record-fields-sheet')) === '取引の欄',
          '段 1 へ戻る',
        );
      };
      await toMain();
      // 10 本まで足す（AC-13: 10 本でも横にスクロールしない。11 本目は押せない）
      for (let i = 1; i < 10; i++) {
        await p.locator('#record-legs-add').click();
        await expectPollAsync(
          async () => (await titleOf('record-fields-sheet')) === `レッグ ${i + 1}`,
          `レッグ ${i + 1} の段`,
        );
        await toMain();
      }
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, 'レッグの行');
      expectEq(await p.locator('#record-legs-add').isDisabled(), true, '11 本目の ［＋ レッグ］');
      expectEq(await hscroll(), 0, '10 本の横のスクロール');
      // 消して ［元に戻す］（P4。デザインレビュー B1）
      await p.locator('#record-legs-9').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 10',
        'レッグ 10 の段',
      );
      await p.locator('#leg-9-remove').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === '取引の欄',
        '消した後は段 1',
      );
      await p.locator('#record-legs-undo').waitFor({ state: 'visible', timeout: 5000 });
      expectEq(await p.locator('#record-legs .legs__item').count(), 9, '消した後の行');
      await p.locator('#record-legs-undo').scrollIntoViewIfNeeded();
      await settleSheet(p);
      await shot('opt-record-undo');
      await p.locator('#record-legs-undo').click();
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, '戻した後の行');
      // 再レビュー B2: 消してから ［＋ レッグ］ で 10 本に戻すと、［元に戻す］ は押せず理由を出す（11 本目を作らない）
      await p.locator('#record-legs-9').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 10',
        'レッグ 10 の段（2 回目）',
      );
      await p.locator('#leg-9-remove').click();
      await p.locator('#record-legs-undo').waitFor({ state: 'visible', timeout: 5000 });
      await p.locator('#record-legs-add').click();
      await toMain();
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, '足し直した後の行');
      expectEq(await p.locator('#record-legs-undo').isDisabled(), true, '10 本の ［元に戻す］');
      await p.locator('#record-legs-undo').scrollIntoViewIfNeeded();
      await settleSheet(p);
      await shot('opt-record-undo-full');
      await closeSheets(p);
      // 10 本の取引の詳細: 幅 390 はカード、1440 は表。どちらも横 0
      await p.goto(`${base}/trades/x-opt10`);
      await waitDetail(p);
      await p.locator('.legtable').waitFor({ state: 'visible', timeout: 10000 });
      expectEq(await p.locator('.legtable__card').count(), 10, '10 本のカード');
      expectEq(await hscroll(), 0, '10 本の詳細の横（390）');
      await p.setViewportSize({ width: 1440, height: 900 });
      await expectPollAsync(
        async () => await p.locator('.legtable__table').isVisible(),
        '1440 は表',
      );
      expectEq(await hscroll(), 0, '10 本の詳細の横（1440）');
      await p.locator('.legtable').scrollIntoViewIfNeeded();
      if (opts.shots) {
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, '1440x900-dark-opt-detail-10.png') });
      }
      await p.setViewportSize({ width: 390, height: 844 });
      // 詳細: 判定のカードの下にレッグの表
      await p.goto(`${base}/trades/x-opt1`);
      await waitDetail(p);
      await p.locator('.legtable').waitFor({ state: 'visible', timeout: 10000 });
      expectEq(await hscroll(), 0, '詳細の横のスクロール');
      await p.locator('.legtable').scrollIntoViewIfNeeded();
      await shot('opt-detail');
      // 編集: 取引の欄のシートのレッグの行 → 段 leg。閉じて何も変えずに保存 → PUT にレッグ
      await p.goto(`${base}/trades/x-opt1/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      await openEditFields(p);
      await p.locator('#record-legs-1').click();
      await expectPollAsync(
        async () => (await titleOf('edit-fields-sheet')) === 'レッグ 2',
        '編集の段 leg の題',
      );
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#edit-fields-sheet[open]'), '編集の段 leg');
      expectEq(await hscroll(), 0, '編集の横のスクロール');
      await shot('opt-edit-leg');
      await closeSheets(p);
      await p.locator('#edit-submit').click();
      await expectPollAsync(async () => fake.puts.length === 1, 'PUT が届く');
      const legs = fake.puts[0].body?.legs;
      expectEq(Array.isArray(legs) ? legs.length : -1, fx.record.legs.length, 'PUT のレッグの数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '記録の段 leg（2 列で決済・満期で消滅まで窓の中）・10 本で横 0 と 11 本目は押せない・消して ［元に戻す］、詳細のレッグの表（390 カード / 1440 表・10 本で横 0）・編集の段 leg が窓の中で横 0、編集の保存の PUT にレッグ 3 本';
  });

  // OPT118（#118）: 明細のオプションの行 → ポジションの下書き。偽の読み取りが架空のオプションの行 3 本（同じ日の 2 本 = 1 件、
  // 別の日の 1 本 = 次の件。1 本目は年を補った限月）を返し、2 段目の要約・取引の欄のシートのレッグの一覧（印「読み取り ·
  // 年を補った」・「明細の次のポジション ［このポジションに入れる］」）を見る。［別のポジションにする］ → ［このポジションに入れる］
  // で 1 件に戻る。シートが窓の中・横 0。--shots なら 2 つ（2 段目・取引の欄のシート。ダーク）だけ撮る
  await check('OPT118', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      fake.instruments.push({
        id: 'inst-xyzop',
        name: '架空指数XYZOP',
        underlyingKind: 'index',
        productForm: 'option',
        priceCurrency: 'JPY',
        multiplier: 1000,
        quantityStep: 1,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      });
      const opt = (o) => ({
        symbol: `架空指数XYZOP ${o.pc === 'put' ? 'P' : 'C'} ${o.strike}`,
        side: o.side === 'sell' ? 'S' : 'L',
        entryPrice: o.entry,
        exitPrice: o.exit,
        quantity: o.qty,
        pnl: o.pnl,
        pnlCurrency: 'JPY',
        entryTime: o.opened,
        exitTime: o.closed,
        timeZoneNeedsCheck: false,
        fees: [o.fee],
        feesTotal: o.fee,
        exitOrderType: o.order ?? 'unknown',
        option: {
          underlying: '架空指数XYZOP',
          expiry: '2027-01',
          expiryYearInferred: o.inferred ?? false,
          putCall: o.pc,
          strike: o.strike,
          side: o.side,
          position: o.position,
        },
      });
      fake.read = {
        status: 200,
        holdMs: 0,
        rows: [
          opt({
            pc: 'put',
            strike: 36000,
            side: 'sell',
            qty: 2,
            entry: 240,
            exit: 110,
            pnl: 259000,
            fee: 1000,
            opened: jstTime(2026, 12, 8, 9, 40),
            closed: jstTime(2026, 12, 22, 13, 15),
            position: 0,
            inferred: true,
          }),
          opt({
            pc: 'put',
            strike: 35500,
            side: 'buy',
            qty: 2,
            entry: 150,
            exit: 70,
            pnl: -161000,
            fee: 1000,
            opened: jstTime(2026, 12, 8, 9, 41),
            closed: jstTime(2026, 12, 22, 13, 16),
            position: 0,
            order: 'stop',
          }),
          opt({
            pc: 'call',
            strike: 41000,
            side: 'buy',
            qty: 1,
            entry: 60,
            exit: 35,
            pnl: -25300,
            fee: 300,
            opened: jstTime(2026, 12, 9, 10, 20),
            closed: jstTime(2026, 12, 18, 14, 5),
            position: 1,
          }),
        ],
      };
      const shot = async (slug) => {
        if (!opts.shots) return;
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, `390x844-dark-${slug}.png`) });
      };
      const hscroll = () =>
        p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      // 2 段目: 上の帯に「1 / 2 件目」（取引とポジションを合わせて数える）、要約に「レッグ 2」
      await p.getByText('1 / 2 件目').first().waitFor({ timeout: 5000 });
      expectEq(
        ((await p.locator('#record-summary').textContent()) ?? '').includes('レッグ 2'),
        true,
        '要約のレッグ',
      );
      expectEq(await hscroll(), 0, '2 段目の横のスクロール');
      // 年を補った限月の札（注意の色）が要約に出る。要約の名前・「L · レッグ 2」は切れない（デザインレビュー 1・5・#164）
      await p.locator('#record-summary .field__mark--warn').waitFor({ timeout: 5000 });
      expectEq((await summaryCuts(p)).join('、'), '', '要約の切れた文字');
      await shot('opt118-review');
      // 取引の欄のシート: レッグ 2 本の印・次のポジションの行
      await openFields(p);
      await p.locator('#record-legs-merge').scrollIntoViewIfNeeded();
      await settleSheet(p);
      const metas = await p.locator('#record-legs .rowlink__meta').allTextContents();
      expectEq(metas.join(' | '), '読み取り | 読み取り', 'レッグの印');
      expectEq(await p.locator('#record-legs .field__mark--warn').count(), 1, '年の札');
      const nextText = (await p.locator('#record-legs .legs__next').textContent()) ?? '';
      expectEq(
        nextText.includes('エントリー 12/9') && nextText.includes('買い 1 · C 41,000 · 2027-01'),
        true,
        `次のポジションの見出し（${nextText}）`,
      );
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '取引の欄のシート');
      expectEq(await hscroll(), 0, 'シートの横のスクロール');
      await shot('opt118-legs');
      // ［別のポジションにする］（レッグ 2 の段）→ 1 本に。［このポジションに入れる］ で 2 本に戻る（7.6）
      await p.locator('#record-legs-1').click();
      await p.locator('#leg-1-split').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), 'レッグ 1 本の段');
      expectEq(await hscroll(), 0, 'レッグの段の横のスクロール');
      await shot('opt118-leg');
      await p.locator('#leg-1-split').click();
      await expectPollAsync(
        async () => (await p.locator('#record-legs .legs__item').count()) === 1,
        '分けた後のレッグ',
      );
      await p.getByText('1 / 3 件目').first().waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id ?? '')) === 'record-legs-merge',
        '分けた後のフォーカス',
      );
      await p.locator('.legs__notice').waitFor({ timeout: 5000 });
      await p.locator('#record-legs-merge').click();
      await expectPollAsync(
        async () => (await p.locator('#record-legs .legs__item').count()) === 2,
        '入れた後のレッグ',
      );
      // 2 件目（別の日のポジション 1 本）: 1 件目をスキップして移る
      await p.getByRole('button', { name: 'このポジションをスキップ' }).click();
      await p.getByText('2 / 2 件目').first().waitFor({ timeout: 5000 });
      await closeSheets(p);
      expectEq(
        ((await p.locator('#record-summary').textContent()) ?? '').includes('レッグ 1'),
        true,
        '2 件目の要約',
      );
      expectEq(await hscroll(), 0, '2 件目の横のスクロール');
      await shot('opt118-second');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '明細のオプションの行 3 本 → 2 件（ポジション 2 本 + 1 本）・「1 / 2 件目」・要約「レッグ 2」（切れない）と年の札・次のポジションの見出し（エントリーの日・レッグの 1 行）、レッグの段、［別のポジションにする］ → 3 件・知らせ → ［このポジションに入れる］ で 2 本に戻る、2 件目、シートが窓の中・横 0';
  });

  // OPT118N（#118 の見直し）: オプションの銘柄が一覧に無い明細のポジション。2 段目の要約に「未入力 乗数」、押すと取引の欄の
  // シートの乗数の欄へ（placeholder の例・価格の通貨の 1 行は全幅）。--shots なら 1 枚（シートの乗数の欄。ダーク）
  await check('OPT118N', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      const leg = (o) => ({
        symbol: `架空225 ${o.pc === 'put' ? 'P' : 'C'} ${o.strike}`,
        side: o.side === 'sell' ? 'S' : 'L',
        entryPrice: o.entry,
        exitPrice: o.exit,
        quantity: 1,
        pnl: o.pnl,
        pnlCurrency: 'JPY',
        entryTime: jstTime(2026, 12, 8, 9, 40),
        exitTime: jstTime(2026, 12, 22, 13, 15),
        timeZoneNeedsCheck: false,
        fees: [500],
        feesTotal: 500,
        exitOrderType: 'unknown',
        option: {
          underlying: '架空225',
          expiry: '2027-01',
          expiryYearInferred: false,
          putCall: o.pc,
          strike: o.strike,
          side: o.side,
          position: 0,
        },
      });
      fake.read = {
        status: 200,
        holdMs: 0,
        rows: [
          leg({ pc: 'put', strike: 36000, side: 'sell', entry: 240, exit: 110, pnl: 129500 }),
          leg({ pc: 'put', strike: 35500, side: 'buy', entry: 150, exit: 70, pnl: -80500 }),
        ],
      };
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      const chip = p.locator('.rsum__named button', { hasText: '乗数' });
      await chip.waitFor({ state: 'visible', timeout: 5000 });
      expectEq(((await chip.textContent()) ?? '').includes('未入力'), true, '「未入力 乗数」');
      await chip.click();
      await p.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id ?? '')) === 'record-new-multiplier',
        '乗数の欄へフォーカス',
      );
      expectEq(
        await p.locator('#record-new-multiplier').getAttribute('placeholder'),
        '例: 1000',
        '乗数の例',
      );
      const hint = (await p.locator('#record-new-multiplier-what').textContent()) ?? '';
      expectEq(hint.includes('価格の通貨 JPY'), true, `価格の通貨の 1 行（${hint}）`);
      const wide = await p.evaluate(() => {
        const h = document.getElementById('record-new-multiplier-what')?.getBoundingClientRect();
        const b = document
          .querySelector('#record-fields-sheet[open] .record__sheetbody')
          ?.getBoundingClientRect();
        return h && b ? h.width / b.width : 0;
      });
      expectEq(wide > 0.8, true, `案内の 1 行が全幅（${wide.toFixed(2)}）`);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '取引の欄のシート');
      expectEq(
        await p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        0,
        '横のスクロール',
      );
      if (opts.shots) {
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, '390x844-dark-opt118-new-instrument.png') });
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'オプションの銘柄が無い明細のポジション: 要約の「未入力 乗数」→ 乗数の欄へフォーカス・例「1000」・「価格の通貨 JPY」の 1 行が全幅、シートが窓の中・横 0';
  });
}
