import { reviewGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「振り返り（なぜ・次はと期間の取引）」: 1 本の流れの「何で崩れたか」（心理・More・Good の切り口）・連勝の後・
 * 次はこうする・前の URL `&view=insight` の置き換えと、期間の取引の状態（#228。前は気づきのセグメント #162）
 */
export const id = 'review-insight';
export const title = '振り返り（なぜ・次はと期間の取引）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await reviewGroup(vp, id);
}
