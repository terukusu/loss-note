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

export function Login({ onSignIn, busy, error, emulator }: LoginProps) {
  return (
    <section class="login card">
      <div class="login__mark">
        <Icon name="mark" />
      </div>
      <p class="pagehead__eyebrow">トレードの振り返り</p>
      <h1 class="login__title" tabIndex={-1}>
        ログイン
      </h1>
      <p class="login__lead">
        計画（エントリー時に決めたこと）と実行（実際の決済）を並べて、同じ負け方を繰り返さないための損失ノートです。
      </p>
      <div class="login__action">
        <Button size="lg" block onClick={onSignIn} disabled={busy}>
          {busy ? 'ログインしています…' : 'Google でログイン'}
        </Button>
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
