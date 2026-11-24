import { pagesGroup, reviewGroup, zoomPagesGroup, zoomReviewGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「振り返り（期間）」: 振り返りのタブの期間ごと・件数・読み込み中・失敗の状態と、期間の置き換え RV1
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
