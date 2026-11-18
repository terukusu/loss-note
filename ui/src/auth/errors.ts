// ログインの失敗の文言（Issue #3 の例の表 L7・契約 C-7）。例外の本文・コードは画面に出さない
// auth/internal-error は接続の失敗だけでなく設定の誤りでも返るので、ここに入れない（一般的な案内に回す）
const UNREACHABLE = new Set(['auth/network-request-failed', 'auth/timeout']);
const CANCELLED = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

/** 起動時に Firebase の初期化が失敗したとき（session.ts の unavailableSession） */
export const UNAVAILABLE = 'ログインの準備ができませんでした。接続先の設定を確認してください';

/** ログアウトの失敗 */
export const SIGN_OUT_FAILED = 'ログアウトできませんでした。もう一度押してください';

/** 失敗のコード → 画面の文言。自分で閉じた・取り消したときは null（文言を出さない） */
export function loginErrorMessage(code: string | undefined): string | null {
  if (code && UNREACHABLE.has(code)) return 'ログインのサービスと通信できませんでした';
  if (code && CANCELLED.has(code)) return null;
  if (code === 'auth/popup-blocked')
    return 'ポップアップがブロックされました。ブラウザでポップアップを許可して、もう一度押してください';
  if (code === 'app/unavailable') return UNAVAILABLE;
  return 'ログインできませんでした';
}

/** 例外からコードだけを取り出す（Firebase の FirebaseError は code を持つ） */
export function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}
