// 口座の欄（Issue #47 PR-1。画面の決定 U1〜U4・U19）。記録する画面と直す画面が共有する。
// 口座の数で形を変える: 1 つ = 出さない / 2〜3 つ = Segment / 4 つ以上 = .select（P1 の規則）。名前は文字だけ・色なし（U20）。
// 長い名前は項目の中で 1 行の「…」（全文は項目の文字のまま = 読み上げの名前に入る）。hook を持たない
import type { AccountRecord } from '../../../core/record';
import { accountChoiceKind, segmentGrowIndex, selectedNote } from '../lib/accounts';
import { Segment } from './Segment';

export const ACCOUNT_FIELD_ID = 'record-account';

export interface AccountFieldProps {
  readonly accounts: readonly AccountRecord[];
  /** 選んでいる口座の ID */
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** 欄の下の 1 行（直す画面で口座を替えたとき。U19） */
  readonly hint?: string | null;
}

export function AccountField(p: AccountFieldProps) {
  const kind = accountChoiceKind(p.accounts.length);
  if (kind === 'none') return null;
  const hint = p.hint ? (
    <p class="field__hint" id={`${ACCOUNT_FIELD_ID}-hint`}>
      {p.hint}
    </p>
  ) : null;
  if (kind === 'segment') {
    return (
      <div class="accountfield" id={`${ACCOUNT_FIELD_ID}-field`}>
        <Segment
          label="口座"
          id={ACCOUNT_FIELD_ID}
          name={ACCOUNT_FIELD_ID}
          truncate
          describedBy={p.hint ? `${ACCOUNT_FIELD_ID}-hint` : undefined}
          grow={segmentGrowIndex(p.accounts.map((a) => a.name))}
          note={selectedNote(p.accounts, p.value)}
          value={p.value}
          onChange={p.onChange}
          options={p.accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        {hint}
      </div>
    );
  }
  return (
    <div class="field accountfield" id={`${ACCOUNT_FIELD_ID}-field`}>
      <label class="field__label" for={ACCOUNT_FIELD_ID}>
        口座
      </label>
      <select
        id={ACCOUNT_FIELD_ID}
        class="select"
        value={p.value}
        aria-describedby={p.hint ? `${ACCOUNT_FIELD_ID}-hint` : undefined}
        onChange={(ev) => p.onChange(ev.currentTarget.value)}
      >
        {p.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {hint}
    </div>
  );
}
