import { pagesGroup, reviewGroup, zoomPagesGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「振り返り（説明・取り込み・数で見る）」: 説明のシート・フォーカス・取り込みの切り替え・取引の無い期間と、
 * 数で見るの画面の状態
 */
export const id = 'review-more';
export const title = '振り返り（説明・取り込み・数で見る）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await reviewGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
}
