// 設定（#3 はテーマの切り替えとログアウトだけ。資金・許容リスクなどは #5）
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import type { Theme } from '../lib/theme';

export interface SettingsProps {
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
  readonly onSignOut: () => void;
  readonly signOutBusy: boolean;
  readonly signOutError: string | null;
}

export function Settings({ theme, onTheme, onSignOut, signOutBusy, signOutError }: SettingsProps) {
  return (
    <>
      <PageHeader title="設定" />
      <section class="card section">
        <h2 class="section__title">表示</h2>
        <Segment
          label="テーマ"
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'dark', label: 'ダーク', icon: 'moon' },
            { value: 'light', label: 'ライト', icon: 'sun' },
          ]}
        />
        <p class="field__hint">この端末に記憶します。</p>
      </section>
      <section class="card section">
        <h2 class="section__title">アカウント</h2>
        <div>
          <Button variant="secondary" icon="logout" onClick={onSignOut} disabled={signOutBusy}>
            {signOutBusy ? 'ログアウトしています…' : 'ログアウト'}
          </Button>
        </div>
        {signOutError ? (
          <p class="login__error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </section>
    </>
  );
}
