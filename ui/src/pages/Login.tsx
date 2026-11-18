// ログイン（Issue #3 R5）。手元は Auth のエミュレーターの Google ログイン（ポップアップで架空のアカウントを選ぶ）。
// 失敗はコードを出さず、決まった文言だけを出す（白い画面にしない。L7）
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';

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
      <span class="login__name">loss-note</span>
    </div>
  );
}

export function Login({ onSignIn, busy, error, emulator }: LoginProps) {
  return (
    <section class="login card">
      <LoginBrand />
      <h1 class="login__title" tabIndex={-1}>
        ログイン
      </h1>
      <p class="login__lead">
        エントリー時の計画と実際の決済を並べて、同じ負け方を繰り返さないための損失ノートです。
      </p>
      <div class="login__action">
        <Button size="lg" block onClick={onSignIn} disabled={busy}>
          {busy ? 'ログインしています…' : 'Google でログイン'}
        </Button>
        {/* 約束の文言（押す直前に目に入る位置）。支えは API の ID トークンの検証と uid で絞った読み書き（#4・ADR-0004） */}
        <p class="login__note">記録は本人だけが見られます。</p>
        {error ? (
          <p class="login__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {emulator ? (
        <p class="login__env">
          手元のエミュレーターに接続しています。開いた画面で架空のアカウントを選んでください。
        </p>
      ) : null}
    </section>
  );
}
