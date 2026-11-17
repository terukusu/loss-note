// ログイン（PR-1 は見出しと説明だけ。ログインの操作は #3 の PR-2）
import { Icon } from '../components/Icon';

export function Login() {
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
    </section>
  );
}
