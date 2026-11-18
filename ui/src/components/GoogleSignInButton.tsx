// Google でログインするボタン（Sign in with Google のブランドガイドライン（Web）に沿う。Issue #52）。
// 配色はアプリのテーマに従う（ライト → Google のライト、ダーク → Google のダーク。--gsi-* のトークン）。
// 書体・大きさ・余白・形は components.css の .gsi。押している間は文字を変えて押せなくし、中身だけを薄くする
// （地・枠・ロゴの色と形は変えない）。読み上げの名前は見えている文字（ロゴは aria-hidden）
import { GoogleLogo } from './GoogleLogo';

/** 公式の日本語の表記（「Sign in with Google」） */
export const GOOGLE_SIGN_IN_LABEL = 'Google でログイン';
export const GOOGLE_SIGN_IN_BUSY = 'ログインしています…';

export interface GoogleSignInButtonProps {
  readonly busy: boolean;
  readonly onClick: () => void;
}

export function GoogleSignInButton({ busy, onClick }: GoogleSignInButtonProps) {
  return (
    <button type="button" class="gsi" disabled={busy} aria-busy={busy} onClick={onClick}>
      <span class="gsi__contents">
        <GoogleLogo />
        <span class="gsi__text">{busy ? GOOGLE_SIGN_IN_BUSY : GOOGLE_SIGN_IN_LABEL}</span>
      </span>
    </button>
  );
}
