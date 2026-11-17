// テーマ（Issue #3 R1・契約 C-6）。既定はダークで、OS の設定（prefers-color-scheme）は見ない。
// 選んだテーマは端末（localStorage）に記憶する。保存が使えない（プライベートブラウズなどで例外）ときは
// ダークで開き、切り替えはその場だけ効かせる（画面にエラーを出さない）。サーバーの設定へ移すのは #5 か縦切り 2
export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];
export const THEME_KEY = 'loss-note.theme';

/** localStorage と同じ形の最小限（テストで差し替える） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readTheme(storage: StorageLike | null | undefined): Theme {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

/** 保存できたら true。例外は握って false */
export function writeTheme(storage: StorageLike | null | undefined, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** ルートの要素に data-theme を付ける（CSS の :root[data-theme] が色を選ぶ。style 属性は使わない） */
export function applyTheme(
  root: { setAttribute(name: string, value: string): void },
  theme: Theme,
) {
  root.setAttribute('data-theme', theme);
}

/** window.localStorage の取得そのものが例外を投げる端末があるので、取り出しも包む */
export function safeStorage(get: () => StorageLike): StorageLike | null {
  try {
    return get();
  } catch {
    return null;
  }
}
