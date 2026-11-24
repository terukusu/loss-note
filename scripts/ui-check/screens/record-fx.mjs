import { join } from 'node:path';
import { opts, waitReady } from '../base.mjs';
import {
  ACCOUNTS_2,
  EXAMPLE_TRADES,
  exampleTrade,
  FAKE_US30,
  fakeTrade,
  SNAP,
  waitSaved,
  withUsdInstrument,
} from '../fixtures.mjs';
import { recordGroup, zoomRecordGroup } from '../groups.mjs';
import {
  closeSheets,
  EX_E1,
  EX_SAFE,
  fillFx,
  fillRecord,
  openFields,
  openFieldsScreen,
  openRecord,
  openVerdict,
  seg,
} from '../helpers.mjs';

/**
 * 画面の検査の単位「記録する（通貨と為替）」: 為替の欄・USD の口座の状態と、為替 FX1・数量の比 SZ1
 */
export const id = 'record-fx';
export const title = '記録する（通貨と為替）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}

/** 手順（FX1・SZ1） */
export async function flows(kit) {
  const { base, check, expectEq, recordContext } = kit;
  // ── 通貨と為替（Issue #47 PR-2。FX1）。幅 360 で、USD 建ての銘柄を選ぶと為替の欄が出て、円建てに戻すと消える（AC-21）
  await check('FX1', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 1000000 });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      withUsdInstrument(fake);
      await openRecord(p, base);
      await fillFx(p);
      await p.locator('#record-fx').waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'USD 建て' }).waitFor();
      const h1 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h1, 0, '横スクロール（為替の欄あり）');
      await p.locator('#record-fx').fill('150');
      await p.locator('#record-fx-line', { hasText: '1 USD = 150円' }).waitFor();
      // 円建ての銘柄へ戻す → 為替の欄・建ての 1 行が消える（消えた欄の値は本文に入れない）
      await p.locator('#record-instrument').fill('US30');
      await p.locator('#record-fx').waitFor({ state: 'detached' });
      expectEq(await p.locator('#record-instrument-hint').count(), 0, '建ての 1 行');
      const h2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h2, 0, '横スクロール（為替の欄なし）');
      // 数量を円建ての例に合わせて記録する（本文に為替が無い）
      await p.locator('#record-quantity').fill('10000');
      await closeSheets(p);
      await p.locator('#record-submit').click();
      await waitSaved(p, '記録しました');
      expectEq(JSON.stringify(fake.posts.at(-1)?.exit?.fxRate), undefined, '本文の為替');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'USD 建てで為替の欄と「USD 建て」が出て、円建てに戻すと消える。横スクロール 0、本文に為替なし';
  });

  // SZ1（#67 AC-8）: 判定の枠の数量と提案の数量の行が、記録する画面・取引の詳細・編集の画面に出て、区切り（「数量 10,000 ·」
  // 「適正の数量 4,000（2.5 倍）」）の中で折れず、幅 360 でも区切りの間でだけ折れ、色が注記と同じ --ink-3（判定の色を使わない）、
  // 数の段の直後、横スクロール 0。場面: 0.5 倍・Z2（2.5 倍）・ちょうど 1.0 倍・Z9（最小の数量でも許容リスクを超える）・2 桁と 3 桁の
  // 比・提案の数量が小数 / 7 桁・1R が出ない（行なし）・エントリー 2 つ（詳細）・編集の画面で口座を付け替え。--shots なら各場面の
  // 判定の枠を 360 ダーク・360 ライト・1440 ダークで撮る。値はすべて架空
  await check('SZ1', async () => {
    /** エントリー 2 つ（100.00 × 5,000・99.80 × 5,000、LC 99.50、円建て）→ 1R 4,000 ÷ 10,000 = 0.4 倍 */
    const TX_Z14 = exampleTrade(
      'x-z14',
      1700000000099,
      {
        entries: [
          { price: 100, quantity: 5000 },
          { price: 99.8, quantity: 5000 },
        ],
        statementPnlYen: -4000,
      },
      { snapshot: { ...SNAP, instrument: { ...SNAP.instrument, priceCurrency: 'JPY' } } },
    );
    const { c, p, fake, errors } = await recordContext({
      accounts: ACCOUNTS_2,
      trades: [fakeTrade('t-last', FAKE_US30.id, 2, 1700000100000), ...EXAMPLE_TRADES, TX_Z14],
    });
    const seen = [];
    /** 数量の行の文字・行の数・区切りごとの行の数・色・横スクロール・数の段の直後か */
    const lineOf = () =>
      p.locator('.verdict__sizing').evaluate((e) => {
        const cs = getComputedStyle(e);
        const probe = document.createElement('span');
        probe.style.color = 'var(--ink-3)';
        document.body.append(probe);
        const ink3 = getComputedStyle(probe).color;
        probe.remove();
        const lh = Number.parseFloat(cs.lineHeight);
        const lines = (el) => Math.round(el.getBoundingClientRect().height / lh);
        return {
          text: e.textContent,
          lines: lines(e),
          // 区切りの中の行の数（区切りは inline-block なので、文字の範囲の行の上端の数で数える。#79）
          segLines: [...e.querySelectorAll('.verdict__seg')].map((s) => {
            const r = document.createRange();
            r.selectNodeContents(s);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          }),
          ink3: cs.color === ink3,
          h: document.documentElement.scrollWidth - window.innerWidth,
          afterStats: e.previousElementSibling?.classList.contains('verdict__stats') ?? false,
        };
      });
    /** 判定の枠を 360 ダーク・360 ライト・1440 ダークで撮る（--shots のときだけ） */
    /** 記録する画面では判定は判定のシートの中（#130） */
    // 判定の枠が判定のシートの中にある画面（記録する・編集。#130・#131）
    const onRecord = () => {
      const path = new URL(p.url()).pathname;
      return path === '/record' || path.endsWith('/edit');
    };
    const shoot = async (slug) => {
      if (!opts.shots) return;
      if (onRecord() && (await p.locator('.sheet[open] .verdict').count()) === 0)
        await openVerdict(p);
      const v = p.locator('.verdict');
      await v.scrollIntoViewIfNeeded();
      await v.screenshot({ path: join(opts.shots, `sz1-360-dark-${slug}.png`) });
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await v.screenshot({ path: join(opts.shots, `sz1-360-light-${slug}.png`) });
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await p.setViewportSize({ width: 1440, height: 900 });
      await v.scrollIntoViewIfNeeded();
      await v.screenshot({ path: join(opts.shots, `sz1-1440-dark-${slug}.png`) });
      await p.setViewportSize({ width: 360, height: 780 });
    };
    const expectLine = async (want, what, slug) => {
      if (onRecord()) await openVerdict(p);
      await p.locator('.verdict__sizing', { hasText: want }).waitFor();
      const l = await lineOf();
      expectEq(l.text, want, `${what} の文字`);
      expectEq(
        l.segLines.every((n) => n === 1),
        true,
        `${what} の区切りの中で折れない ${l.segLines}`,
      );
      if (l.lines > l.segLines.length)
        throw new Error(`${what} の行の数 ${l.lines}（区切り ${l.segLines.length}）`);
      expectEq(l.ink3, true, `${what} の色が --ink-3`);
      expectEq(l.h, 0, `${what} の横スクロール`);
      expectEq(l.afterStats, true, `${what} が数の段の直後`);
      seen.push(`${what} ${l.lines} 行`);
      await shoot(slug);
    };
    /** 記録する画面を開き直して、銘柄の値・下書きを入れる */
    const fresh = async (inst) => {
      fake.instruments[0] = { ...FAKE_US30, ...inst };
      await openRecord(p, base);
    };
    const fillAt = async (ex, quantity, account = '口座 1') => {
      await fillRecord(p, ex);
      await openFields(p);
      await p.locator('#record-quantity').fill(quantity);
      await closeSheets(p);
      await seg(p, '口座', account).click();
    };
    const AT = (entry, lc) => ({ ...EX_SAFE, entry, exit: lc, lc });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      // 円建て・乗数 1。口座 1（1,000,000・1%）: 1R 0.50 × 10,000 = 5,000 → 0.5 倍、提案 20,000
      await fresh({ priceCurrency: 'JPY' });
      await fillRecord(p, EX_E1);
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '口座 1', 'record-05');
      // Z2: 口座 B（200,000・1%）→ 2.5 倍、10,000 × 2,000 ÷ 5,000 = 4,000
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await expectLine('数量 10,000 · 適正の数量 4,000（実際は 2.5 倍）', 'Z2', 'record-z2');
      // ちょうど 1.0 倍: 数量 20,000 → 1R 10,000 ÷ 10,000
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(EX_E1, '20000');
      await expectLine('数量 20,000 · 適正の数量 20,000（実際は 1.0 倍）', '1.0 倍', 'record-z4');
      // 7 桁: 数量 1,234,567・LC 99.99 → 1R 12,345.67 → 1.23… → 1.3 倍、提案 1,234,567 × 10,000 ÷ 12,345.67 = 1,000,000
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(AT('100.00', '99.99'), '1234567');
      await expectLine(
        '数量 1,234,567 · 適正の数量 1,000,000（実際は 1.3 倍）',
        '7 桁',
        'record-7digits',
      );
      // 12 桁（#40 レビュー 4）: 数量 123,456,789,012・イン 100,000・LC 50,000 → 提案 0。1 つの区切りが幅 360 の枠より長いので、
      // 区切りの中で折れてよいが、枠からはみ出さない（横スクロール 0・区切りの右端が行の右端の内側）
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(AT('100000', '50000'), '123456789012');
      {
        const want =
          '数量 123,456,789,012（許容リスクの 617283945060.0 倍） · 最小の数量でも許容リスクを超えます';
        await openVerdict(p);
        await p.locator('.verdict__sizing', { hasText: want }).waitFor();
        const l = await lineOf();
        expectEq(l.text, want, '12 桁 の文字');
        expectEq(l.h, 0, '12 桁 の横スクロール');
        const over = await p.locator('.verdict__sizing').evaluate((e) => {
          const right = e.getBoundingClientRect().right;
          return [...e.querySelectorAll('.verdict__seg')].map((s) =>
            Math.round(s.getBoundingClientRect().right - right),
          );
        });
        expectEq(
          over.every((d) => d <= 0),
          true,
          `12 桁 の区切りが行からはみ出さない ${over}`,
        );
        seen.push(`12 桁 ${l.lines} 行（はみ出し 0）`);
        await shoot('record-12digits');
      }
      // 小数: 乗数 100,000・刻み 0.01・イン 150.00・LC 149.50・数量 0.37 → 1R 18,500 → 1.85 → 1.9 倍、提案 0.2
      await fresh({ priceCurrency: 'JPY', multiplier: 100000, quantityStep: 0.01 });
      await fillAt(AT('150.00', '149.50'), '0.37');
      await expectLine('数量 0.37 · 適正の数量 0.2（実際は 1.9 倍）', '小数', 'record-decimal');
      // 乗数 100: Z9（イン 38,000・LC 37,600・数量 1 → 1R 40,000 → 4.0 倍、0.25 → 0）
      await fresh({ priceCurrency: 'JPY', multiplier: 100 });
      await fillAt(AT('38000', '37600'), '1');
      await expectLine(
        '数量 1（許容リスクの 4.0 倍） · 最小の数量でも許容リスクを超えます',
        'Z9',
        'record-z9',
      );
      // 2 桁: 数量 12 → 1R 480,000 ÷ 10,000 = 48.0 倍 / 3 桁: 口座 B（許容額 2,000）→ 240.0 倍
      await openFields(p);
      await p.locator('#record-quantity').fill('12');
      await closeSheets(p);
      await expectLine(
        '数量 12（許容リスクの 48.0 倍） · 最小の数量でも許容リスクを超えます',
        '2 桁',
        'record-48x',
      );
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await expectLine(
        '数量 12（許容リスクの 240.0 倍） · 最小の数量でも許容リスクを超えます',
        '3 桁',
        'record-240x',
      );
      // 1R が出ない: 価格の通貨が未設定（為替が要る）で明細の損益も無い → 行を出さない
      await fresh({});
      await fillAt(EX_E1, '10000');
      await p.locator('.vline .badge').first().waitFor();
      expectEq(await p.locator('.verdict__sizing').count(), 0, '1R が出ないときの行');
      seen.push('1R なし 0 行');
      await shoot('record-no-1r');
      // 詳細（x-d1: 1R = 8,000 × 0.50 ÷ 0.80 = 5,000、資金 1,000,000・1%）と「すべての欄」の 2 行
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '詳細', 'detail');
      // 「すべての欄」は次の画面（#131）
      await openFieldsScreen(p);
      const rows = await p.locator('.fields__row').allTextContents();
      expectEq(
        rows
          .filter((r) => r.startsWith('適正の数量') || r.startsWith('許容リスクに対する数量'))
          .join(' / '),
        '適正の数量20,000 / 許容リスクに対する数量0.5 倍',
        'すべての欄の 2 行',
      );
      if (opts.shots) {
        await p
          .locator('.notes')
          .screenshot({ path: join(opts.shots, 'sz1-360-dark-detail-fields.png') });
      }
      // エントリー 2 つ（詳細）: 数量は合計・比だけ
      await p.goto(`${base}/trades/x-z14`);
      await waitReady(p, 'US30 · L');
      await expectLine('数量 10,000（許容リスクの 0.4 倍）', 'エントリー 2 つ', 'detail-z14');
      // 編集の画面: 口座 B に付け替える → 2.5 倍・適正の数量 4,000
      await p.goto(`${base}/trades/x-d1/edit`);
      await waitReady(p, '取引を編集');
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '編集の画面', 'edit-a');
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await expectLine(
        '数量 10,000 · 適正の数量 4,000（実際は 2.5 倍）',
        '編集の画面の口座 B',
        'edit-b',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `幅 360: 区切りの中で折れない・--ink-3・数の段の直後・横スクロール 0（${seen.join(' / ')}）。すべての欄の 2 行`;
  });
}
