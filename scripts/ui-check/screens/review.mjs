import { waitReady } from '../base.mjs';
import { REVIEW_GROUP } from '../fixtures.mjs';
import { pagesGroup, reviewGroup, zoomPagesGroup, zoomReviewGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「振り返り（期間）」: 振り返りのタブの期間ごと・件数・読み込み中・失敗の状態と、期間の置き換え RV1、
 * 両建てのまとまりを 1 件に数える RG1（#268）
 */
export const id = 'review';
export const title = '振り返り（期間）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await reviewGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
  await zoomReviewGroup(vp);
}

/** 手順（RG1） */
export async function flows(kit) {
  const { base, check, expectEq, recordContext } = kit;
  // RG1（#268 AC-1・AC-9。設計書 6.5）: 両建てのまとまり 1 件のある 7 日の振り返りは 8 件（S1 の 7 件 + まとまり 1 件）で、
  // 決済の代わり（LC なし）を「LC が無い」に数えない（曲線の外は S1 の rv-5 の 1 件だけ）。横スクロール 0
  await check('RG1', async () => {
    const { c, p, errors } = await recordContext({ trades: REVIEW_GROUP });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/review?period=7d`);
      await waitReady(p, '振り返り');
      await p.locator('.curve').first().waitFor({ timeout: 15000 });
      const r = await p.evaluate(() => ({
        text: document.querySelector('main')?.textContent ?? '',
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      if (!r.text.includes('8 件')) throw new Error('件数が 8 件でない');
      if (!r.text.includes('LC が無い 1 件は曲線に入れていません')) {
        throw new Error('曲線の外の件数が 1 件でない');
      }
      expectEq(r.over, 0, '横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'まとまり 1 件のある期間は 8 件・決済の代わりを LC が無いに数えない・横スクロール 0';
  });
}
