import { reviewGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「振り返り（気づきと期間の取引）」: 気づき（心理・連勝の後・Good / More）と期間の取引の状態
 */
export const id = 'review-insight';
export const title = '振り返り（気づきと期間の取引）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await reviewGroup(vp, id);
}
