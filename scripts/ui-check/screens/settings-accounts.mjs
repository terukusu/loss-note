import { pagesGroup, settingsGroup, zoomPagesGroup, zoomSettingsGroup } from '../groups.mjs';

/**
 * 画面の検査の単位「設定（口座と銘柄）」: 設定の口座・銘柄の画面の状態（直す・足すのシート・誤り・資金が未設定）
 */
export const id = 'settings-accounts';
export const title = '設定（口座と銘柄）';

/** 画面 × 幅 × テーマで測る状態 */
export async function states(vp) {
  await pagesGroup(vp, id);
  await settingsGroup(vp, id);
}

/** 文字の拡大 200% で測る状態 */
export async function zoom(vp) {
  await zoomPagesGroup(vp, id);
  await zoomSettingsGroup(vp, id);
}
