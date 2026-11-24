import { expectPollAsync } from '../base.mjs';
import { ACCOUNTS_2, FAKE_US30, waitSaved } from '../fixtures.mjs';
import { recordGroup, zoomRecordGroup } from '../groups.mjs';
import {
  closeSheets,
  EX_E1,
  fillRecord,
  openFields,
  openRecord,
  openVerdict,
  seg,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「記録する（口座）」: 口座の欄（2〜4 つ）・その場で足す欄・明細から選んだ口座の状態と、ACC1・ACC2
 */
export const id = 'record-account';
export const title = '記録する（口座）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}

/** 手順（ACC1・ACC2） */
export async function flows(kit) {
  const { base, check, expectEq, recordContext } = kit;
  // ── 口座（Issue #47 PR-1。ACC1・ACC2・SET5）。幅 360 で、偽の記録の API で流す
  await check('ACC1', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: ACCOUNTS_2 });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      // 円建ての銘柄（リスク（%）を価格から出せる）
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 1 の資金 1,000,000円 に対して' })
        .waitFor();
      const riskOf = () =>
        p.locator('.verdict__stat', { hasText: 'リスク' }).locator('.num').textContent();
      expectEq(await riskOf(), '0.5%', '口座 1 のリスク');
      // 1 タップで口座 B へ（要約の下の Segment。#130）→ リスク・1 行がその場で変わる（1R 5,000 ÷ 200,000 = 2.5%）
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await p.locator('.vline__risk', { hasText: '2.5%' }).waitFor();
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
      expectEq(await riskOf(), '2.5%', '口座 B のリスク');
      await p.locator('.reasons__item', { hasText: '過剰リスク（2.5%）' }).waitFor();
      const h = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h, 0, '横スクロール');
      await closeSheets(p);
      await p.locator('#record-submit').click();
      await waitSaved(p, '口座 B に記録しました');
      expectEq(fake.posts.at(-1)?.accountId, 'acc-b', '本文の口座');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '口座 2 つ: Segment の 1 タップで口座 B → リスク 0.5% → 2.5%・過剰リスクの理由・判定の枠の 1 行がその場で変わる、横スクロール 0、「口座 B に記録しました」';
  });

  await check('ACC2', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 1000000 });
    const focused = () => p.evaluate(() => document.activeElement?.id ?? '');
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      const before = await p.locator('#record-entry').inputValue();
      // 口座 1 つ: 口座の欄は無く、[＋ 口座を追加] だけ（取引の欄のシートの中。#130）
      expectEq(await p.locator('[role="radiogroup"][aria-label="口座"]').count(), 0, '口座の欄');
      await openFields(p);
      await p.locator('#record-account-add').click();
      await expectPollAsync(
        async () => (await focused()) === 'record-account-new-name',
        '名前の欄へ',
      );
      // Esc で閉じて [＋ 口座を追加] へ戻る
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await focused()) === 'record-account-add', 'Esc の後');
      expectEq(await p.locator('.accountadd').count(), 0, '閉じた欄');
      // もう一度開き、Enter で足す（記録の送信にならない）
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 C');
      await p.locator('#record-account-new-capital').fill('300,000');
      await p.locator('#record-account-new-capital').press('Enter');
      await p.locator('[role="radiogroup"][aria-label="口座"]').waitFor();
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.getAttribute('name'))) ===
          'record-account',
        '選ばれた口座へ',
      );
      const checked = await p
        .locator('input[name="record-account"]:checked')
        .evaluate((e) => e.closest('label')?.textContent ?? '');
      expectEq(checked.trim(), '口座 C', '選ばれた口座');
      expectEq(fake.posts.length, 0, '記録の送信');
      const post = fake.writes.find((x) => x.key === 'POST /api/accounts');
      expectEq(
        JSON.stringify(post?.body),
        JSON.stringify({ name: '口座 C', capitalYen: 300000 }),
        '足す本文',
      );
      expectEq(await p.locator('#record-entry').inputValue(), before, '入れていた欄');
      expectEq(new URL(p.url()).pathname, '/record', '画面を移らない');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'その場で足す: 開くと名前の欄へ・Esc で閉じて [＋ 口座を追加] へ・Enter で足す（記録しない）→ 口座 C が選ばれた Segment が出てフォーカス、本文は名前と資金だけ、入れていた欄はそのまま';
  });
}
