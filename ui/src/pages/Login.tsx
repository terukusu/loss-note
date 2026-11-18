// ログイン（Issue #3 R5）。手元は Auth のエミュレーターの Google ログイン（ポップアップで架空のアカウントを選ぶ）。
// 失敗はコードを出さず、決まった文言だけを出す（白い画面にしない。L7）
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { Icon } from '../components/Icon';
import { APP_NAME } from '../lib/app-name';

export interface LoginProps {
  readonly onSignIn: () => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly emulator: boolean;
}

/** 入口の画面（ログイン・使えないアカウント。#43）の印とアプリの名前の行 */
export function LoginBrand() {
  return (
    <div class="login__brand">
      <div class="login__mark">
        <Icon name="mark" />
      </div>
      <span class="login__name">{APP_NAME}</span>
    </div>
  );
}

/** 見出しの読み上げの続き（見た目の文字はアプリの名前だけ。「ログイン」は小さな添え書きとボタンが言う。#52） */
export const LOGIN_HEADING_TAIL = 'にログイン';

export function Login({ onSignIn, busy, error, emulator }: LoginProps) {
  return (
    <>
      <section class="login card">
        {/* 印 + アプリの名前が主役の見出し（#52 のデザインレビュー）。画面が変わったらこの h1 にフォーカスを移す */}
        <div class="login__brand login__brand--hero">
          <div class="login__mark login__mark--lg">
            <Icon name="mark" />
          </div>
          <h1 class="login__title" tabIndex={-1}>
            {APP_NAME}
            <span class="sr-only">{LOGIN_HEADING_TAIL}</span>
          </h1>
        </div>
        <p class="login__kicker" aria-hidden="true">
          ログイン
        </p>
        <p class="login__lead">
          エントリー時の計画と実際の決済を並べて、同じ負け方を繰り返さないためのノートです。
        </p>
        <div class="login__action">
          {/* Google のブランドガイドラインに沿ったボタン（#52）。アプリの汎用のボタンは使わない */}
          <GoogleSignInButton busy={busy} onClick={onSignIn} />
          {/* 約束の文言（押す直前に目に入る位置）。支えは API の ID トークンの検証と uid で絞った読み書き（#4・ADR-0004） */}
          <p class="login__note">記録は本人だけが見られます。</p>
          {error ? (
            <p class="login__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
      {/* 手元だけの注記はカードの外に小さく（カードの中を本番と同じにする。#52 のデザインレビュー） */}
      {emulator ? (
        <p class="login__env">
          手元のエミュレーターに接続しています。開いた画面で架空のアカウントを選んでください。
        </p>
      ) : null}
    </>
  );
}
