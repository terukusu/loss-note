import { recordGroup, zoomRecordGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「記録する（明細の複数行と 1 段目）」: 複数行・タイムゾーン・1 段目の明細の枠・削除と読み直しの状態
 */
export const id = 'record-rows';
export const title = '記録する（明細の複数行と 1 段目）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await recordGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomRecordGroup(vp, id);
}
