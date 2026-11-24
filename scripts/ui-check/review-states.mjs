// 振り返りのタブの状態（reviewStates）。どの単位で測るかは units.mjs の reviewUnitOf
import {
  REVIEW_BIG,
  REVIEW_CLEAN,
  REVIEW_IMPORTS,
  REVIEW_INSIGHT,
  REVIEW_INSIGHT_LONG,
  REVIEW_MANY,
  REVIEW_NOGAP,
  REVIEW_OLD,
  REVIEW_REFLECT,
  REVIEW_S1,
  REVIEW_S2,
  REVIEW_STREAK,
} from './fixtures.mjs';
import { seg } from './helpers.mjs';

/**
 * 振り返りのタブ・数で見る・期間の取引の状態（[パス, 取引, 待つ要素, slug, 開いた後, 範囲の応答の状態, 待たせる ms]）。
 * どの単位で測るかは units.mjs の reviewUnitOf。recApi は偽の記録の API（開いた後の操作が使う）
 */
export function reviewStates(recApi) {
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const back5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);
  return [
    ['/review?period=7d', REVIEW_S1, '.curve', 'review-7d'],
    ['/review?period=1d', REVIEW_S1, '.review__ratecard', 'review-1d'],
    ['/review?period=1m', REVIEW_S1, '.curve', 'review-1m'],
    ['/review?period=3m', REVIEW_S1, '.curve', 'review-3m'],
    [
      `/review?period=custom&from=${ymd(today)}&to=${ymd(back5)}`,
      REVIEW_S1,
      '#review-to-error',
      'review-custom-error',
    ],
    [
      `/review?period=custom&from=${ymd(back5)}&to=${ymd(today)}`,
      REVIEW_S1,
      '.curve',
      'review-custom',
    ],
    [
      '/review?period=custom&from=2020-01-01&to=2020-01-31',
      REVIEW_S1,
      '.review__empty',
      'review-empty',
    ],
    ['/review?period=7d', REVIEW_S2, '.review__missing', 'review-few'],
    // レビュー後に足した状態（#88 Phase 4b）: 差が無い・大きな負け・取引の多い期間（合成 120 件）・読み込み中・
    // 「i」を開いた・キーボードのフォーカス
    ['/review?period=7d', REVIEW_NOGAP, '.curve', 'review-nogap'],
    ['/review?period=7d', REVIEW_BIG, '.curve', 'review-bigloss'],
    ['/review?period=3m', REVIEW_MANY, '.curve', 'review-many'],
    ['/review?period=7d', REVIEW_S1, '.review .loading', 'review-loading', null, 200, 4000],
    [
      '/review?period=7d',
      REVIEW_S1,
      '.curve',
      'review-info',
      async (pg) => {
        await pg.locator('.review button[aria-label="「規律コスト」の説明"]').click();
        await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
      },
    ],
    ['/review?period=7d', REVIEW_CLEAN, '.curve', 'review-clean'],
    ['/review?period=1d', REVIEW_OLD, '.review__empty', 'review-empty-1d'],
    ['/review?period=7d', REVIEW_OLD, '.review__empty', 'review-empty-7d'],
    ['/review?period=1m', REVIEW_OLD, '.review__empty', 'review-empty-1m'],
    ['/review?period=3m', REVIEW_OLD, '.review__empty', 'review-empty-3m'],
    [
      '/review?period=7d',
      REVIEW_S1,
      '.curve',
      'review-switching',
      async (pg) => {
        recApi.rangeHoldMs = 4000;
        await seg(pg, '期間', '1か月').click();
        await pg.locator('.review__body--busy').waitFor();
      },
    ],
    [
      '/review?period=7d',
      REVIEW_S1,
      '.curve',
      'review-info-rate',
      async (pg) => {
        await pg.locator('.review button[aria-label="「計画どおり率」の説明"]').click();
        await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
      },
    ],
    [
      '/review?period=7d',
      [...REVIEW_S1, ...REVIEW_IMPORTS],
      '.review__toggle',
      'review-focus-toggle',
      async (pg) => {
        await pg.locator('input[name="review-period"]:checked').focus();
        await pg.keyboard.press('Tab');
        await pg.waitForFunction(() => document.activeElement?.classList.contains('review__check'));
      },
    ],
    // 「数で見る」は次の画面（#128。その場で開く折りたたみをやめた）: 見出しから Tab で横に送る表の箱へ
    [
      '/review/table?period=7d',
      REVIEW_S1,
      '.review__table table',
      'review-focus-table',
      async (pg) => {
        await pg.locator('main h1').first().focus();
        for (let i = 0; i < 6; i++) {
          await pg.keyboard.press('Tab');
          const at = await pg.evaluate(() =>
            document.activeElement?.classList.contains('review__scroll'),
          );
          if (at) break;
        }
        await pg.waitForFunction(() =>
          document.activeElement?.classList.contains('review__scroll'),
        );
      },
    ],
    [
      '/review?period=7d',
      REVIEW_S1,
      '.curve',
      'review-focus',
      async (pg) => {
        // 見出しから Tab で期間の選択へ（#127 でホームの [記録する] を無くしたので、見出しを起点にする）
        await pg.locator('main h1').first().focus();
        for (let i = 0; i < 8; i++) {
          await pg.keyboard.press('Tab');
          const at = await pg.evaluate(() => document.activeElement?.getAttribute('name'));
          if (at === 'review-period') break;
        }
        await pg.waitForFunction(
          () => document.activeElement?.getAttribute('name') === 'review-period',
        );
      },
    ],
    [
      '/review?period=7d',
      [...REVIEW_S1, ...REVIEW_IMPORTS],
      '.review__toggle',
      'review-imports-off',
    ],
    [
      '/review?period=7d&imports=1',
      [...REVIEW_S1, ...REVIEW_IMPORTS],
      '.review__toggle',
      'review-imports-on',
    ],
    ['/review?period=7d', REVIEW_IMPORTS, '.review__toggle', 'review-imports-only'],
    // なぜ（#228。前は気づきのセグメント #162・#185・#221）: 心理の順位図（件数が十分な行・件数が少ない行・平常心）と、心理の付いた
    // 取引が無い期間・名前の長い心理・連勝の後・Good / More の切り口。前の URL `&view=insight` は置き換えて受ける（review-insight-legacy）
    ['/review?period=7d', REVIEW_INSIGHT, '.why .insight__row', 'review-insight'],
    ['/review?period=7d', REVIEW_S1, '.why', 'review-insight-none'],
    ['/review?period=7d', REVIEW_INSIGHT_LONG, '.why .insight__row', 'review-insight-long'],
    ['/review?period=7d', REVIEW_STREAK, '.winrun', 'review-insight-streak'],
    // Good / More と心理と連勝の後の付いた期間（#221 の合成の取引）: 心理・More・Good の切り口。EPIC #233 の終了条件 3 の長さを測る
    ['/review?period=7d', REVIEW_REFLECT, '.why .insight__row', 'review-insight-reflection'],
    ['/review?period=7d&why=more', REVIEW_REFLECT, '.why .insight__row', 'review-insight-more'],
    ['/review?period=7d&why=good', REVIEW_REFLECT, '.why .insight__row', 'review-insight-good'],
    [
      '/review?period=7d&view=insight',
      REVIEW_REFLECT,
      '.why .insight__row',
      'review-insight-legacy',
    ],
    // 期間の取引（#221）: 話題の行から・自分で書いた行から
    ['/review/trades?period=7d&more=oversized', REVIEW_REFLECT, '.traderow', 'review-trades-topic'],
    ['/review/trades?period=7d&notes=more', REVIEW_REFLECT, '.traderow', 'review-trades-notes'],
    // 期間の取引（#228）: 振り返りの「崩れの取引を見る ›」から
    ['/review/trades?period=7d&tier=off', REVIEW_INSIGHT, '.traderow', 'review-trades-off'],
    // 期間の取引（#185）: 心理の行から・連勝の後から・知らない心理
    ['/review/trades?period=7d&emotion=recoup', REVIEW_INSIGHT, '.traderow', 'review-trades'],
    [
      '/review/trades?period=7d&after=winStreak',
      REVIEW_STREAK,
      '.traderow',
      'review-trades-streak',
    ],
    [
      '/review/trades?period=7d&emotion=foo',
      REVIEW_INSIGHT,
      '.review__empty',
      'review-trades-empty',
    ],
    ['/review/table?period=7d', REVIEW_S1, '.review__table table', 'review-table'],
    ['/review/table?period=7d', [], '.review__empty', 'review-table-empty'],
    ['/review?period=7d', REVIEW_S1, '.review .notice--error', 'review-failed', null, 503],
  ];
}
