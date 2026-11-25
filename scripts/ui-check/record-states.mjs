// 記録する画面の状態（RECORD_STATES）。どの単位で測るかは units.mjs の RECORD_UNIT
import { expectPollAsync, settle } from './base.mjs';
import {
  ACC_B,
  ACC_C,
  ACC_D,
  ACC_ONE,
  ACC_USD,
  ACCOUNTS_2,
  ACCOUNTS_3_LONG,
  ACCOUNTS_4,
  ACCOUNTS_ALNUM,
  FAKE_EUR_IDX,
  mustEq,
  PROFILE_B,
  PROFILE_NEW,
  READ_DONE,
  READ_E1,
  READ_E10,
  READ_REAL,
  READ_USD,
  setAccounts,
  waitSaved,
  withUsdInstrument,
} from './fixtures.mjs';
import {
  closeSheets,
  EX_E1,
  EX_E3,
  EX_E16,
  EX_SAFE,
  expectRealSummary,
  fillFx,
  fillRecord,
  fillStatementTaps,
  followLink,
  makeImage,
  openChartSheet,
  openFields,
  openInfo,
  openMore,
  openVerdict,
  pasteChart,
  STATEMENT_SPEC,
  seg,
  settleSheet,
  summaryCuts,
} from './helpers.mjs';

/** 記録する画面の状態（幅 × テーマで測る）。fn は開いた画面をその状態にする（api は偽の API。読み取りの応答を決める） */
export const RECORD_STATES = [
  { slug: 'record-1-open', name: '開いた直後', fn: async () => {} },
  { slug: 'record-2-typing', name: '入力の途中', fn: (p) => fillRecord(p, EX_E1, false) },
  {
    slug: 'record-3-judged-b',
    name: '判定 B',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
    },
  },
  {
    slug: 'record-4-risky-win',
    name: '危ない勝ち',
    fn: async (p) => {
      await fillRecord(p, EX_E3);
      await p.locator('.vline .badge', { hasText: '危ない勝ち' }).waitFor();
    },
  },
  {
    slug: 'record-5-no-lc-c',
    name: 'LC なしの C',
    fn: async (p) => {
      await fillRecord(p, EX_E16);
      await p.locator('.vline .badge', { hasText: 'C 極悪な損失' }).waitFor();
    },
  },
  {
    // 保存の後は心理のシート「記録しました」が開く（#156。何も選んでいない = ［あとで］）
    slug: 'record-6-saved',
    name: '保存の後',
    noBar: true,
    anchor: '#record-emotion-sheet',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.locator('#record-emotion-sheet[open]').waitFor();
      await p
        .locator('#record-emotion-sheet .emotions__actions button', { hasText: 'あとで' })
        .waitFor();
    },
  },
  {
    // 候補は既定の巡り（偽の取引に心理が無い。#230 の例 #2 = 平常心・怖い・儲けたい・取り戻したい）
    slug: 'record-6b-saved-emotion',
    name: '保存の後・心理 3 つ',
    noBar: true,
    anchor: '#record-emotion-sheet',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      const sheet = p.locator('#record-emotion-sheet[open]');
      await sheet.waitFor();
      for (const name of ['怖い', '儲けたい', '取り戻したい']) {
        // 選ぶ前後でチップの外寸が同じ（✓ の分だけ幅が増えて後ろのチップが動かない。#156 のデザインレビュー 2）
        const chip = sheet.getByRole('button', { name, exact: true });
        const before = await chip.boundingBox();
        await chip.click();
        await sheet.locator('.chip--toggle[aria-pressed="true"]', { hasText: name }).waitFor();
        // 押し込み（:active の scale）の戻りの動きが終わってから測る
        await settle(p);
        const after = await chip.boundingBox();
        if (before && after && Math.abs(before.width - after.width) > 0.5)
          throw new Error(`${name}: 選ぶと幅が ${before.width}px → ${after.width}px`);
      }
      await sheet.locator('.emotions__actions button', { hasText: '完了' }).waitFor();
    },
  },
  {
    // ［ほかの心理（17）］ を押して残りを候補の下に出した（#230 R5。シートの中がスクロールし、下の帯が貼り付く）
    slug: 'record-6d-saved-more',
    name: '保存の後・ほかの心理',
    noBar: true,
    anchor: '#record-emotion-sheet',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      const sheet = p.locator('#record-emotion-sheet[open]');
      await sheet.waitFor();
      await sheet.getByRole('button', { name: 'ほかの心理（17）' }).click();
      await sheet.getByRole('button', { name: '値ごろ感', exact: true }).waitFor();
      await settle(p);
    },
  },
  {
    slug: 'record-6c-saved-closed',
    name: '保存の後・シートを閉じた',
    noBar: true,
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.locator('#record-emotion-sheet[open]').waitFor();
      await p
        .locator('#record-emotion-sheet .emotions__actions button', { hasText: 'あとで' })
        .click();
      await p.locator('#record-emotion-sheet:not([open])').waitFor({ state: 'attached' });
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor();
    },
  },
  {
    slug: 'record-7-reading',
    name: '明細の読み取り中',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('status').filter({ hasText: '読み取り中' }).waitFor();
      // プレビューは取引の欄のシートの中（1 画面は要約の骨組み。#130）
      await p.locator('canvas.statement__preview').waitFor({ state: 'attached' });
    },
  },
  {
    slug: 'record-8-read',
    name: '読み取りの後',
    // 1 画面（要約 3 行・LC から判定まで）を撮る。印のついた取引の欄は record-8b（シート）で撮る
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
    },
  },
  {
    slug: 'record-8b-read-fields',
    name: '読み取りの後（取引の欄）',
    anchor: '#record-fields-sheet',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openFields(p);
      await p.locator('#record-fields-sheet .field__mark').first().waitFor();
    },
  },
  // 読み取りの終わりの知らせ（#166）: 入力が必要な欄つきの完了の文・失敗・キャンセル・複数行の次の行の知らせ
  {
    slug: 'record-8c-read-missing',
    name: '読み取りの後（入力が必要な欄 2）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [{ ...READ_E1, quantity: null, exitTime: null }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '入力が必要な欄 2' }).waitFor();
    },
  },
  {
    slug: 'record-8d-read-failed',
    name: '読み取りの失敗',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 502, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rstmt__card--retry [role="alert"]').waitFor();
    },
  },
  {
    slug: 'record-8e-read-cancelled',
    name: '読み取りのキャンセル',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
      await p.locator('.rstmt__card--retry', { hasText: '読み取りをキャンセルしました' }).waitFor();
    },
  },
  {
    slug: 'record-8f-rows-next',
    name: '複数行の次の行の知らせ',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '2 行を読み取りました' }).waitFor();
      await fillStatementTaps(p);
      await p.locator('#record-submit').click();
      await p.locator('.rsum__status--notice', { hasText: '1 / 2 行目を記録しました' }).waitFor();
    },
  },
  {
    // #180: 3 行の明細で 1 行目・2 行目を記録した後の 2 行目の知らせ（名前の上の 1 行）
    slug: 'record-8g-rows-next2',
    name: '複数行の 2 行目の後',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }, { ...READ_E1, symbol: '架空指数D' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '3 行を読み取りました' }).waitFor();
      for (const want of ['1 / 3 行目を記録しました', '2 / 3 行目を記録しました']) {
        await fillStatementTaps(p);
        await p.locator('#record-submit').click();
        await p.locator('.rsum__status--notice', { hasText: want }).waitFor();
      }
    },
  },
  {
    slug: 'record-9-rows',
    name: '複数行・時間帯',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 行の進み具合は上の帯の右（9.3）。タイムゾーンのシートは自動では開かない（要約の行に印と ［タイムゾーンを選ぶ］。#130）
      await p.locator('.appbar__meta', { hasText: '1 / 3 行目' }).waitFor();
      await p.locator('.rsum__tzmark', { hasText: '時刻が未確定' }).waitFor();
      mustEq(
        await p.locator('#record-tz-sheet[open]').count(),
        0,
        '自動で開いたタイムゾーンのシート',
      );
      await p.locator('#record-tz-open').click();
      // タイムゾーンの選択肢（選ぶ前。#58）: 選択肢ごとに欄に入る日本時間
      await p.getByRole('radio', { name: /GMT（\+9 時間） ?2026\/11\/10 19:30/ }).waitFor();
    },
  },
  {
    slug: 'record-9-tz-other',
    name: 'ほかのタイムゾーン',
    anchor: '.statement__tz',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-tz-open').click();
      await p.getByRole('radio', { name: /ほかのタイムゾーン/ }).check();
      const sel = p.getByRole('combobox', { name: 'ほかのタイムゾーン' });
      await sel.waitFor();
      await sel.selectOption('us-east');
      await expectPollAsync(
        async () => (await p.locator('#record-exit-time').inputValue()) === '2026-11-11T00:30',
        '米国東部で直した決済の時刻',
      );
    },
  },
  {
    slug: 'record-9-tz-remembered',
    name: '覚えたタイムゾーン',
    anchor: '.statement__tz',
    fn: async (p, api) => {
      await p.evaluate(() => localStorage.setItem('loss-note.statementTimeZone', 'gmt'));
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 覚えたタイムゾーンで入れたときは要約の行に印を出さず、［タイムゾーンを選ぶ］ だけ（#58・#130）
      await p.locator('#record-tz-open').waitFor();
      mustEq(await p.locator('.rsum__tzmark').count(), 0, '覚えたタイムゾーンの印');
      await p.locator('#record-tz-open').click();
      await p.getByText('前に選んだ GMT（+9 時間）で日本時間に直しました。').waitFor();
      await expectPollAsync(
        async () => (await p.locator('#record-exit-time').inputValue()) === '2026-11-10T19:30',
        '覚えた GMT で直した決済の時刻',
      );
    },
  },
  {
    slug: 'record-11-tall',
    name: '縦長のスクショ',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      // スマホの縦長のスクショ（1080 × 2340）。描き直すと 923 × 2000。プレビューは取引の欄のシートの先頭（#130）
      await makeImage(p, { w: 1080, h: 2340, type: 'image/png' }, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openFields(p);
      // プレビューが枠に収まり、縦横比を保つ（縦に潰れない。レビュー指摘 8）
      const box = await p.evaluate(() => {
        const c = document.querySelector('canvas.statement__preview');
        const r = c.getBoundingClientRect();
        const parent = c.parentElement.getBoundingClientRect();
        return { w: r.width, h: r.height, aw: c.width, ah: c.height, pw: parent.width };
      });
      if (box.w > box.pw + 0.5) throw new Error(`プレビューが枠より広い ${box.w}px`);
      if (box.h > 320.5) throw new Error(`プレビューが高すぎる ${box.h}px`);
      if (Math.abs(box.w / box.h - box.aw / box.ah) > 0.02)
        throw new Error(`プレビューの縦横比 ${box.w}×${box.h}（画像 ${box.aw}×${box.ah}）`);
    },
  },
  {
    slug: 'record-12-charts',
    name: 'チャートあり',
    anchor: '.charts',
    fn: async (p, api) => {
      // 読み取りで埋めた直後（印「チャートから」つき。#27）
      api.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('#record-chart-exit-tf-mark').waitFor({ state: 'attached' });
      // 2 段目のチャートの行の 2 行目に読めた決済時の時間足（2026-11-21）
      await p.locator('#record-mini-entry', { hasText: '決済時 · 日足' }).waitFor();
      await openVerdict(p);
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // チャートのシートで、枠を選んだ状態（輪と「貼り付けると差し替えられます」）を撮る
      await openChartSheet(p);
      await p.locator('#record-chart-exit .chart__name').click();
    },
  },
  {
    slug: 'record-15-chart-reading',
    name: 'チャートの読み取り中',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 200, kind: 'chart', holdMs: 20000 };
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      // 2 段目のチャートの行（チャートのシートの中は「時間足を読み取っています…」。#130・2026-11-21）
      await p.locator('#record-mini-entry', { hasText: '時間足を読み取り中' }).waitFor();
      // 読み取り中も [記録する] は押せる（帯は「待たずに記録できます」）
      if (await p.locator('#record-submit').isDisabled())
        throw new Error('読み取り中に [記録する] が押せない');
      await p.locator('.record__status', { hasText: '待たずに記録できます' }).waitFor();
    },
  },
  {
    slug: 'record-16-chart-not-chart',
    name: 'チャートと読めない',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 200, kind: 'not_chart', holdMs: 0 };
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.getByText('チャートとして読み取れませんでした').waitFor();
    },
  },
  {
    slug: 'record-17-chart-failed',
    name: 'チャートの読み取りの失敗',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 503, kind: 'chart', holdMs: 0 };
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.getByText('今は時間足の読み取りを使えません').waitFor();
    },
  },
  {
    slug: 'record-18-chart-suggest',
    name: '選んだ値と読めた値が違う',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartTimeframes = ['1d'];
      api.chartRead = { status: 200, kind: 'chart', holdMs: 1500 };
      // 2026-11-21: 1 段目の空のチャートの枠はエントリー時だけ（決済時は入れてから見せる）。案の出し方は枠によらず同じなので
      // エントリー時の枠で見る
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.locator('#record-chart-entry-tf').selectOption('4h');
      await p.locator('#record-chart-entry .chart__suggest').waitFor({ timeout: 10000 });
      await p.getByRole('button', { name: '日足にする' }).waitFor();
    },
  },
  {
    slug: 'record-19-chart-conflict',
    name: 'タップとチャートの食い違い',
    fn: async (p, api) => {
      api.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('#record-mini-entry', { hasText: '決済時 · 日足' }).waitFor();
      // タップの下の 1 行（2 段目）と、判定のシートの理由の 2 行目
      await p.locator('.record__taps .field__hint', { hasText: 'チャートでは' }).waitFor();
      await openVerdict(p);
      await p.locator('.reasons__sub', { hasText: 'あなたの答え: そのまま' }).waitFor();
    },
  },
  // Issue #89: 追加のチャート（見出しの行の [＋ 追加] → 枠を足して貼る）
  {
    slug: 'record-30-extra-1',
    name: '追加のチャート 1 枚',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartTimeframes = ['1d'];
      // 追加の枠はチャートのシートの中（シートはチャートのある小さな枠から開く。#130）
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x1');
      await p.locator('#record-chart-x1-note').fill('上位足の環境');
      await p.locator('.charts__subtitle', { hasText: '判定には使いません' }).waitFor();
    },
  },
  {
    slug: 'record-31-extra-full',
    name: '追加のチャート 5 枚',
    anchor: '.charts__subtitle',
    fn: async (p) => {
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
      for (const slot of ['x1', 'x2', 'x3', 'x4', 'x5']) await pasteChart(p, slot);
      if (!(await p.locator('#record-chart-add').isDisabled()))
        throw new Error('5 枚で [＋ 追加] が押せる');
      await p.getByText('追加のチャートは 5 枚までです。').waitFor();
    },
  },
  {
    slug: 'record-32-extra-note-err',
    name: '一言が字数を超えた',
    anchor: '.charts__subtitle',
    fn: async (p) => {
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x1');
      await p.locator('#record-chart-x1-note').fill('あ'.repeat(41));
      // 欄の誤り（保存しないことは controller のテストで見る）
      await p
        .locator('#record-chart-x1-note-error', { hasText: '一言は 40 字までです。' })
        .waitFor();
    },
  },
  {
    slug: 'record-33-extra-fifth',
    name: '追加のチャートの 5 枚目',
    anchor: '#record-chart-x4',
    fn: async (p) => {
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x5');
      if (!(await p.locator('#record-chart-add').isDisabled()))
        throw new Error('5 枚で [＋ 追加] が押せる');
    },
  },
  // 2026-11-21: 記録する画面の 2 段（モックと同じ 6 状態。1 段目の空 = record-1-open・2 段目の読み取り中 = record-7-reading）
  {
    slug: 'record-40-stage1-statement',
    name: '1 段目（明細あり）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 明細を選ぶとすぐ 2 段目（読み取りを待たない）。上の帯の ［スクショ］ で 1 段目へ戻る
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 10000 });
      await p.locator('#record-to-input').click();
      await p.locator('.rin__card--filled .rin__desc', { hasText: '読み取り中' }).waitFor();
      await p.locator('#record-proceed').waitFor();
    },
  },
  // #184: 明細の削除・［元に戻す］・読み直しの途中・読み直しが失敗して前の明細に戻った状態
  {
    slug: 'record-45-stage1-removed',
    name: '1 段目（明細の削除の後）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      await p.locator('#record-statement-remove').click();
      await p
        .locator('.rin__removed', {
          hasText: '明細の値を削除しました。LC・一言・タップ・チャートは残っています',
        })
        .waitFor();
      if ((await p.locator('#record-statement-remove').count()) !== 0)
        throw new Error('削除の後も ［削除］ が残っている');
      // 押したボタンは消えるので、フォーカスは同じ枠の ［元に戻す］ へ
      await p.waitForFunction(() => document.activeElement?.id === 'record-statement-undo', null, {
        timeout: 3000,
      });
    },
  },
  {
    slug: 'record-46-stage1-undo',
    name: '1 段目（削除を元に戻す）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      const reads = api.reads.length;
      await p.locator('#record-statement-remove').click();
      await p.locator('#record-statement-undo').click();
      await p.locator('#record-statement-remove').waitFor();
      await p.locator('.rin__card--filled .rin__desc', { hasText: '読み取りました' }).waitFor();
      if (api.reads.length !== reads) throw new Error('削除・［元に戻す］ で読み取りの要求が出た');
    },
  },
  {
    slug: 'record-47-reread-reading',
    name: '2 段目（読み直しの途中）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--reading', { hasText: '別の明細を読み取り中…' }).waitFor({
        timeout: 10000,
      });
    },
  },
  {
    slug: 'record-48-reread-failed',
    name: '2 段目（読み直しの失敗で前の明細）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      api.read = { status: 503, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      const alert = p.locator('.rstmt [role="alert"]', { hasText: '今は読み取りを使えません' });
      await alert.waitFor({ timeout: 10000 });
      const said = await alert.textContent();
      if (!said?.includes('前の明細に戻しました。') || said.includes('手入力'))
        throw new Error(`前の明細に戻した文になっていない: ${said}`);
      // 前の明細の要約（読み取りの印つき）が出たまま
      await p.locator('#record-summary').waitFor();
    },
  },
  {
    slug: 'record-44-stage1-chart',
    name: '1 段目（明細とチャートあり）',
    anchor: '.rin',
    fn: async (p, api) => {
      // 明細とエントリー時のチャートが入った 1 段目（デザインレビュー a4）
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      api.chartTimeframes = ['1h'];
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry', { hasText: '1 時間足' }).waitFor({ timeout: 10000 });
      await p.locator('#record-proceed').waitFor();
    },
  },
  {
    // #164: 長い銘柄の名前も切らずに折り返す。向き・数量・イン → 決済・決済の時刻・明細の損益に見出し
    slug: 'record-45-read-long-name',
    name: '2 段目（長い銘柄の名前）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [{ ...READ_E1, symbol: '架空ミニ指数先物 2026年12月限 ラージ' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      const l2 = (await p.locator('#record-summary .rsum__l2').textContent()) ?? '';
      if (!/^L · 数量 2 · イン 100 → 決済 99$/.test(l2.replace(/\s+/g, ' ').trim()))
        throw new Error(`要約の 2 行目「${l2}」`);
      const l3 = (await p.locator('#record-summary .rsum__l3').textContent()) ?? '';
      if (!/^11\/10 \d\d:\d\d 決済 · 明細の損益 −2,000円$/.test(l3.replace(/\s+/g, ' ').trim()))
        throw new Error(`要約の 3 行目「${l3}」`);
      const cuts = await summaryCuts(p);
      if (cuts.length > 0) throw new Error(`要約の文字が切れる: ${cuts.join('、')}`);
    },
  },
  {
    // #164 のレビュー: 実際の桁の架空の値（6 万台の小数 1 桁の価格・6 桁の損益・オーナーの例と同じ長さの名前）。
    // 2・3 行目は ［編集］ の下まで全幅で、幅 390 以上では 1 行ずつ。行の頭に「·」「→」が来ない。何も切れない
    slug: 'record-46-read-real-digits',
    name: '2 段目（実際の桁）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await expectRealSummary(p, '#record-summary');
    },
  },
  {
    slug: 'record-41-read-judged',
    name: '2 段目（読み取りの後・判定）',
    anchor: '.rinput',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      api.chartTimeframes = ['1h'];
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry', { hasText: '1 時間足' }).waitFor({ timeout: 10000 });
      await p.locator('#record-lc').fill('99');
      await p.locator('#record-broken').fill('押し目の安値を割ったら');
      await seg(p, 'LC を動かしたか', 'そのまま').click();
      await seg(p, '時間足を変えたか', 'そのまま').click();
      await p.locator('.vline .badge').waitFor();
    },
  },
  {
    slug: 'record-42-manual',
    name: '2 段目（手入力）',
    anchor: '.rinput',
    fn: async (p) => {
      // ［明細なしで手入力］ は 2 段目へ移って取引の欄のシートを開く。閉じると要約と「未入力」のチップ
      await p.locator('#record-manual').click();
      await p.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      await seg(p, 'L / S', 'S ショート').click();
      await closeSheets(p);
      await p.locator('.rsum__chip').first().waitFor();
    },
  },
  {
    slug: 'record-43-rows-accounts',
    name: '2 段目（2 行・口座 3 つ）',
    anchor: '.rinput',
    prep: (api) => setAccounts(api, ACCOUNTS_3_LONG),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.appbar__sub', { hasText: '1 / 2 行目' }).waitFor();
      await p.locator('.rsum__accounts [role="radiogroup"]').waitFor();
    },
  },
  {
    slug: 'record-13-error',
    name: '誤り 1 欄',
    fn: async (p) => {
      // 帯の長い文の例 3（「誤り 1 欄・あと N 欄」）。決済の欄は取引の欄のシートの中（#130）
      await openFields(p);
      await p.locator('#record-exit').fill('x');
      await closeSheets(p);
      await p.locator('.record__status', { hasText: '誤り 1 欄' }).waitFor();
    },
  },
  {
    slug: 'record-14-safe-win',
    name: '計画どおりの勝ち',
    fn: async (p) => {
      // 帯の判定の要約でいちばん長い「計画どおりの勝ち · +2.0R」
      await fillRecord(p, EX_SAFE);
      await p.locator('.record__status', { hasText: '計画どおりの勝ち · +2.0R' }).waitFor();
    },
  },
  {
    slug: 'record-15-accounts-2',
    name: '口座 2 つ',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await seg(p, '口座', '口座 B').click();
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
    },
  },
  {
    // 口座 2 つの要約の下の Segment（#130。［明細なしで手入力］ の後の要約）
    slug: 'record-15b-accounts-2-top',
    name: '口座 2 つ（要約の下）',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="acc-b"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 口座 2 つで選択を替えた 2 枚目（✓ の幅を先に取り、境目が動かないこと。再レビュー N2）
    slug: 'record-15c-accounts-2-top-default',
    name: '口座 2 つ（要約の下・口座 1）',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await seg(p, '口座', '口座 1').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="default"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 「ほかの欄（任意）」を開いた形（取引の欄のシートの段 2。決済の理由の .select の見た目。#130）
    slug: 'record-20-more-open',
    name: 'ほかの欄を開いた',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openMore(p);
      await p.locator('#record-exit-reason').waitFor();
      await p.locator('#record-exit-reason').scrollIntoViewIfNeeded();
    },
  },
  {
    slug: 'record-16-accounts-3-long',
    name: '口座 3 つ・長い名前',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_3_LONG),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
      await p.locator('.seg--truncate .seg__text', { hasText: '架空の長い名前' }).waitFor();
      await p.locator('.seg--truncate .seg__item', { hasText: '架空の長い名前' }).click();
    },
  },
  {
    slug: 'record-17-accounts-4',
    name: '口座 4 つ（select）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_4),
    fn: async (p) => {
      // 口座 4 つ以上は取引の欄のシートの select（要約の先頭の札から開く。#130）
      await openFields(p);
      await p.locator('select#record-account').selectOption('acc-c');
      await fillRecord(p, EX_E1);
      await p.locator('.rsum__account', { hasText: '口座 C' }).waitFor();
      await openVerdict(p);
      await p.locator('.verdict__account', { hasText: '口座 C（資金は未設定）' }).waitFor();
    },
  },
  {
    slug: 'record-18-add-open',
    name: '口座を追加する欄',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 C');
      await p.locator('#record-account-new-capital').fill('300,000');
    },
  },
  {
    slug: 'record-19-add-error',
    name: '口座を追加する欄の誤り',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 1');
      await p.locator('#record-account-new-capital').fill('0');
      await p.locator('.accountadd').getByRole('button', { name: '追加', exact: true }).click();
      await p
        .locator('#record-account-new-name-error', { hasText: '同じ名前の口座があります' })
        .waitFor();
    },
  },
  // 通貨と為替（Issue #47 PR-2・U23〜U26・U34）
  {
    slug: 'record-21-fx',
    name: '為替の欄（USD 建て）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('150');
      await p.locator('#record-fx-line', { hasText: '1 USD = 150円' }).waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'USD 建て' }).waitFor();
    },
  },
  {
    slug: 'record-22-fx-7digits',
    name: '為替 7 桁',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('1234567');
      await p.locator('#record-fx-line', { hasText: '1 USD = 1,234,567円' }).waitFor();
    },
  },
  {
    slug: 'record-23-fx-derived',
    name: '明細から逆算した為替',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p, '99.40');
      await openMore(p);
      await p.locator('#record-pnl').fill('-9100');
      await p.locator('#record-fee').fill('100');
      await p.getByRole('button', { name: '取引の欄へ戻る' }).click();
      await p.locator('#record-fx-line', { hasText: '明細から 1 USD = 150.00円' }).waitFor();
    },
  },
  {
    slug: 'record-24-fx-error',
    name: '為替の誤り',
    // 撮るのは為替の欄そのもの（.field--error と文言）
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('0');
      await p.locator('.record__status', { hasText: '誤り 1 欄' }).waitFor();
    },
  },
  {
    // #56: ショートで「広げた」を選び、広げた後の LC を向きの逆（入る前の LC より下）に入れた誤り。架空の値
    slug: 'record-28-widen-s-error',
    name: '広げた後の LC の誤り（S）',
    anchor: '.record__taps',
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-instrument').fill('US30');
      await seg(p, 'L / S', 'S ショート').click();
      await p.locator('#record-entry').fill('150.00');
      await p.locator('#record-exit').fill('150.20');
      await p.locator('#record-quantity').fill('10000');
      await closeSheets(p);
      await p.locator('#record-lc').fill('150.50');
      await seg(p, 'LC を動かしたか', '広げた').click();
      await p.locator('#record-lc-after').fill('150.20');
      await seg(p, '時間足を変えたか', 'そのまま').click();
      await p
        .locator('#record-lc-after-error', {
          hasText: '広げた後の LC は、入る前の LC より上にしてください',
        })
        .waitFor();
      const label = (await p.locator('label[for="record-lc-after"]').textContent()) ?? '';
      mustEq(label, '広げた後の LC（任意）', '欄の名前');
    },
  },
  {
    // #58 コードレビュー 5: 円以外の口座で価格の通貨が未設定の銘柄（為替の欄は出ず、半幅の銘柄の下に「価格の通貨 未設定」）
    slug: 'record-29-usd-unset',
    name: 'USD の口座・価格の通貨 未設定',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-instrument').fill('US30');
      await p.locator('#record-quantity').fill('10000');
      await p.locator('#record-instrument-hint', { hasText: '価格の通貨 未設定' }).waitFor();
      mustEq(await p.locator('#record-fx').count(), 0, '為替の欄の数');
    },
  },
  {
    slug: 'record-25-fx-none',
    name: '為替も損益も無い',
    // 資金のある口座で（資金が未設定だと注記は「資金を設定すると…」になる）
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [ACC_ONE]);
    },
    fn: async (p) => {
      await fillFx(p);
      await openVerdict(p);
      await p.locator('.verdict__why', { hasText: '為替か損益を入力すると表示されます' }).waitFor();
    },
  },
  {
    // 為替が空で明細の損益も無い取引の欄（「1 USD = ?円（空でも記録できます）」）
    slug: 'record-25b-fx-empty',
    name: '為替が空（取引の欄）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [ACC_ONE]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p
        .locator('#record-fx-line', { hasText: '1 USD = ?円（空でも記録できます）' })
        .waitFor();
    },
  },
  {
    slug: 'record-26-usd-account',
    name: 'USD の口座',
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [{ ...ACC_USD, id: 'default' }]);
    },
    fn: async (p) => {
      await fillFx(p);
      await openVerdict(p);
      await p.locator('.verdict', { hasText: '50.00' }).waitFor();
    },
  },
  {
    // USD の口座の取引の枠の上（EUR 建て: 銘柄の下の「EUR 建て」・為替の単位「USD」・「1 EUR = ? USD」）
    slug: 'record-27-usd-eur',
    name: 'USD の口座・EUR 建て',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => {
      withUsdInstrument(api);
      if (!api.instruments.some((i) => i.id === FAKE_EUR_IDX.id))
        api.instruments.push(FAKE_EUR_IDX);
      setAccounts(api, [{ ...ACC_USD, id: 'default' }]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-instrument').fill(FAKE_EUR_IDX.name);
      await p.locator('#record-fx-line', { hasText: '1 EUR = ? USD' }).waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'EUR 建て' }).waitFor();
    },
  },
  {
    // USD の口座で JPY の明細を貼った（#66 C5: 損益・手数料は空、その下に「明細の損益は JPY です（口座 D は USD）」）
    slug: 'record-28-usd-statement',
    name: 'USD の口座で明細',
    anchor: '#record-fields-sheet',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
      await p.locator('#record-money-note', { hasText: '明細の損益は JPY です' }).waitFor();
    },
  },
  {
    // 口座 2 つ・明細の特徴の覚えあり（#66 AC-11・R4: 提案の口座 B が選ばれ、口座の欄に印「自動で選択」）
    slug: 'record-29-account-suggested',
    name: '明細から口座',
    anchor: '.rstmt',
    // 提案の口座の ID は API の ID の形（英数だけ）。画面は形の外れた ID を提案に使わない
    prep: (api) => setAccounts(api, [ACC_ONE, { ...ACC_B, id: 'accB' }]),
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [READ_E1],
        holdMs: 0,
        profile: { key: 'c'.repeat(32), accountId: 'accB' },
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      await p
        .locator('[role="radiogroup"][aria-label="口座"] input:checked[value="accB"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 初めての明細（#66 デザイン 1: 覚えが無い → 口座の欄の下に「この明細の口座を選んでください…」・印なし）
    slug: 'record-31-account-first',
    name: '初めての明細',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_NEW };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p
        .locator('#record-account-hint', { hasText: 'この明細の口座を選んでください' })
        .waitFor();
      await p.locator(READ_DONE).first().waitFor();
      mustEq(await p.locator('#record-account-mark').count(), 0, '初めての明細の口座の印');
    },
  },
  {
    // 自動で選んだ後に選び直した（#66 R4: 印「自動で選択」が消える・「直した」にしない）
    slug: 'record-32-account-rechosen',
    name: '選び直した口座',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      await seg(p, '口座', '口座 1').click();
      await p.locator('#record-account-mark').waitFor({ state: 'detached' });
    },
  },
  {
    // 覚えた口座の通貨が明細と違う（#66 デザイン 3・4: 選ぶが印は付けず、合う通貨の口座を口座の欄の下で案内）
    slug: 'record-33-account-currency-mismatch',
    name: '覚えた口座の通貨が違う',
    anchor: '.rstmt',
    prep: (api) => {
      setAccounts(api, [...ACCOUNTS_ALNUM, { ...ACC_USD, id: 'accUsd' }]);
      withUsdInstrument(api);
    },
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_USD], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-hint', { hasText: 'USD の口座は 口座 D です' }).waitFor();
      mustEq(await p.locator('#record-account-mark').count(), 0, '通貨の違う提案の口座の印');
    },
  },
  {
    // 口座 4 つ（select）+ 自動で選んだ（#66 デザイン 8）
    slug: 'record-34-accounts-4-suggested',
    name: '口座 4 つで自動で選択',
    anchor: '#record-fields-sheet',
    prep: (api) =>
      setAccounts(api, [...ACCOUNTS_ALNUM, { ...ACC_C, id: 'accC' }, { ...ACC_D, id: 'accD' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 口座 4 つ以上は要約の先頭の札、select と印は取引の欄のシートの中（#130）
      await p.locator('.rsum__account', { hasText: '口座 B' }).waitFor();
      await openFields(p);
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      mustEq(await p.locator('select#record-account').inputValue(), 'accB', 'select の口座');
    },
  },
  {
    // 明細から記録した後（#66 デザイン 5: 覚えたことを保存の後の 1 行で 1 回だけ伝える）
    slug: 'record-35-learned-saved',
    name: '明細から記録した後',
    noBar: true,
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_NEW };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      // 心理のシート（#156）を閉じてから、保存の後の 1 行を見る
      await waitSaved(p, '記録しました');
      await p.getByText('次からこの明細は', { exact: false }).waitFor();
      mustEq(api.profiles.length, 1, '覚えの送信');
    },
  },
  {
    // USD の口座に USD の明細（#66 C4: 損益・手数料が入る・注記なし）
    slug: 'record-36-usd-statement-usd',
    name: 'USD の口座に USD の明細',
    anchor: '#record-fields-sheet',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_USD], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
      await expectPollAsync(
        async () => (await p.locator('#record-pnl').inputValue()) === '-62',
        'USD の損益',
      );
      mustEq(await p.locator('#record-money-note').count(), 0, '注記');
    },
  },
  {
    // 円の口座に USD の明細（#66 AC-11・C3: 損益・手数料は入らず、その下に「明細の損益は USD です（口座 1 は JPY）」）
    slug: 'record-30-currency-mismatch',
    name: '明細の通貨が違う',
    anchor: '#record-fields-sheet',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [{ ...READ_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
      await p.locator('#record-money-note', { hasText: '明細の損益は USD です' }).waitFor();
    },
  },
  {
    slug: 'record-10-read-failed',
    name: '読み取りの失敗',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 503, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('alert').filter({ hasText: '今は読み取りを使えません' }).waitFor();
    },
  },
  // 言葉の説明の「i」を 1 つ開いた状態（Issue #57 AC-10）。説明のシートが窓の左右・上下に収まることも見る（H3・#129）
  {
    // #56 デザインレビュー: 「LC を動かしたか」の説明（狭めた / 広げた の文）
    slug: 'record-11b-info-lcmove',
    name: '説明（LC を動かしたか）',
    reopen: '「LC を動かしたか」の説明',
    anchor: '.record__taps',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「LC を動かしたか」の説明');
      await p.getByText('広げた（リスクが増える向き）', { exact: false }).first().waitFor();
    },
  },
  {
    // #201: LC の欄の名前の横の「i」で「逆指値 未設定」の説明（「LC なし」との違い・取消へのリンク）
    slug: 'record-11c-info-stop',
    name: '説明（逆指値 未設定）',
    reopen: '「逆指値 未設定」の説明',
    anchor: '.record__lc',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「逆指値 未設定」の説明');
      await p
        .getByText('「LC なし」（LC を入る前に決めていなかった）とは違います', { exact: false })
        .first()
        .waitFor();
    },
  },
  {
    slug: 'record-11-info-tap',
    name: '説明（時間足）',
    reopen: '「時間足を変えたか」の説明',
    anchor: '.record__taps',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「時間足を変えたか」の説明');
    },
  },
  {
    slug: 'record-12-info-judge',
    name: '説明（判定）',
    reopen: '「判定」の説明',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await openInfo(p, '「判定」の説明');
    },
  },
  {
    slug: 'record-13-info-r',
    name: '説明（R）',
    reopen: '「R」の説明',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await openInfo(p, '「R」の説明');
    },
  },
  {
    slug: 'record-14-info-ruler',
    name: '説明（物差し）',
    reopen: '「LC の物差し」の説明',
    // 判定の枠を上の帯のすぐ下に寄せて撮る
    anchor: '.verdict',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await openInfo(p, '「LC の物差し」の説明');
    },
  },
  {
    slug: 'record-15-info-statement',
    name: '説明（明細）',
    reopen: '「明細の送り方」の説明',
    // 明細の注意は 1 段目の明細の枠の下（2026-11-21）
    anchor: '.rin',
    fn: async (p) => {
      await openInfo(p, '「明細の送り方」の説明');
    },
  },
  // 用語集のリンクを 2 段たどった状態（判定 → LC → 1R。#57 オーナーの要望）
  {
    slug: 'record-16-info-link2',
    name: '説明（2 段たどる）',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      // 判定は判定のシートの中（#130）。開いてから説明を開いてたどる
      await openVerdict(p);
      await openInfo(p, '「判定」の説明');
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
    },
  },
];

/** 層を開いたまま移って戻った後、元の項目の scrollRestoration が auto に戻っている（#57 再レビュー B2・N12） */
/**
 * 詳細で消す（#131: 削除は上の帯の「…」の操作のシートの中。確認は挟まない）。how = 'key' はキーで「…」を開き、シートの
 * 「削除」へフォーカスして Enter
 */
