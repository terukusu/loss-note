// 使えないアカウントの画面（Issue #43 R6・例 L3・L4）。/api/* が 403 を返したとき、アプリの殻がどの画面の代わりにも描く。
// 記録の中身・メール・行き先を出さず、決まった文言と「別のアカウントでログイン」だけを出す（押すとログアウトして
// ログイン画面に戻る）。hook を持たない（テストで直接呼べる）。枠と部品はログイン画面と同じ（印とアプリの名前の行も）
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { LoginBrand } from './Login';

/** 見出しは 2 つの句。句の中では折り返さない（360 で「この」だけが 1 行に残らない） */
export const FORBIDDEN_TITLE_HEAD = 'このアカウントでは';
export const FORBIDDEN_TITLE_TAIL = '使えません';
export const FORBIDDEN_TITLE = `${FORBIDDEN_TITLE_HEAD}${FORBIDDEN_TITLE_TAIL}`;
export const FORBIDDEN_LEAD = 'ほかのアカウントでログインし直してください。';
/** 理由（内部の言葉「許可リスト」は使わない。メールは出さない） */
export const FORBIDDEN_REASON = '使えるのは登録されたアカウントだけです。';
export const FORBIDDEN_ACTION = '別のアカウントでログイン';

export interface ForbiddenProps {
  readonly onSignOut: () => void;
  readonly signOutBusy: boolean;
  readonly signOutError: string | null;
}

export function Forbidden({ onSignOut, signOutBusy, signOutError }: ForbiddenProps) {
  return (
    <section class="login card">
      <LoginBrand />
      {/* 状態の画面であることを中立の記号で分ける（段の色・強調の色は使わない。P2） */}
      <div class="login__status">
        <Icon name="lock" />
      </div>
      <h1 class="login__title login__title--status" tabIndex={-1}>
        {FORBIDDEN_TITLE_HEAD}
        <wbr />
        {FORBIDDEN_TITLE_TAIL}
      </h1>
      <p class="login__lead">{FORBIDDEN_LEAD}</p>
      <p class="login__note">{FORBIDDEN_REASON}</p>
      <div class="login__action">
        <Button size="lg" block onClick={onSignOut} disabled={signOutBusy}>
          {signOutBusy ? 'ログアウトしています…' : FORBIDDEN_ACTION}
        </Button>
        {signOutError ? (
          <p class="login__error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
