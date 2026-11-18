// 記録する画面で口座をその場で足す（Issue #47 PR-1 B5。画面の決定 U5〜U9・3.2）。
// [＋ 口座を足す]（「取引」の見出しの行の右端。口座の数によらず同じ場所）と、その下にインラインで開く 2 欄
// （名前・資金（任意））+ [足す] [やめる]。ダイアログ・画面の移動は無い。外側の記録の form の中に置くので form は入れ子に
// しない: Enter = [足す]（記録の送信にしない）、Esc = 閉じて [＋ 口座を足す] へフォーカスを戻す（戻すのは画面の側）。
// hook を持たない

import { NEW_ACCOUNT_CAPITAL_HINT } from '../lib/accounts';
import type { AddAccountState } from '../lib/record-controller';
import { Button } from './Button';
import { NumberField } from './NumberField';
import { TextField } from './TextField';

export const ADD_ACCOUNT_BUTTON_ID = 'record-account-add';
export const NEW_ACCOUNT_NAME_ID = 'record-account-new-name';
export const NEW_ACCOUNT_CAPITAL_ID = 'record-account-new-capital';

/**
 * [＋ 口座を足す]。開いている間は押した見た目（面・＋ を回して ×）で、押すと閉じる（[やめる] と同じ）。
 * 送っている間は押せない。＋ の記号は読み上げから外す（名前は「口座を足す」と開閉の状態。Phase 4b 指摘 5）
 */
export function AccountAddButton(p: {
  readonly open: boolean;
  readonly busy?: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  return (
    <button
      type="button"
      id={ADD_ACCOUNT_BUTTON_ID}
      class="btn btn--ghost section__action accountadd__toggle"
      aria-expanded={p.open ? 'true' : 'false'}
      disabled={p.busy === true}
      onClick={p.open ? p.onClose : p.onOpen}
    >
      <span class="accountadd__plus" aria-hidden="true">
        ＋
      </span>
      <span> 口座を足す</span>
    </button>
  );
}

export interface AccountAddFormProps {
  readonly state: AddAccountState;
  readonly onField: (field: 'name' | 'capital', value: string) => void;
  readonly onAdd: () => void;
  readonly onClose: () => void;
  readonly onRelogin: () => void;
}

export function AccountAddForm(p: AccountAddFormProps) {
  const s = p.state;
  const e = s.errors;
  return (
    <fieldset
      class="accountadd"
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName === 'INPUT') {
          ev.preventDefault();
          p.onAdd();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          p.onClose();
        }
      }}
    >
      <legend class="sr-only">口座を足す</legend>
      <TextField
        id={NEW_ACCOUNT_NAME_ID}
        label="名前"
        value={s.draft.name}
        onInput={(v) => p.onField('name', v)}
        placeholder="例: 口座 B"
        disabled={s.saving}
        {...(e.name ? { error: e.name } : {})}
      />
      <NumberField
        id={NEW_ACCOUNT_CAPITAL_ID}
        label="資金（任意）"
        unit="円"
        value={s.draft.capital}
        onInput={(v) => p.onField('capital', v)}
        hint={NEW_ACCOUNT_CAPITAL_HINT}
        disabled={s.saving}
        {...(e.capital ? { error: e.capital } : {})}
      />
      {s.message ? (
        <div class="notice notice--error" role="alert">
          <p>{s.message}</p>
          {s.auth ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              ログインし直す
            </Button>
          ) : null}
        </div>
      ) : null}
      <div class="accountadd__actions">
        <Button onClick={p.onAdd} disabled={s.saving}>
          {s.saving ? '足しています…' : '足す'}
        </Button>
        <Button variant="ghost" onClick={p.onClose} disabled={s.saving}>
          キャンセル
        </Button>
      </div>
    </fieldset>
  );
}
