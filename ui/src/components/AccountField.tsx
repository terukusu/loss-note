// 口座の欄（Issue #47 PR-1。画面の決定 U1〜U4・U19）。記録する画面と直す画面が共有する。
// 口座の数で形を変える: 1 つ = 出さない / 2〜3 つ = Segment / 4 つ以上 = .select（P1 の規則）。名前は文字だけ・色なし（U20）。
// 長い名前は項目の中で 1 行の「…」（全文は項目の文字のまま = 読み上げの名前に入る）。hook を持たない。
// 明細から口座を選んだときは見出しの右に印「自動で選択」（ほかの欄の読み取りの印と同じ見た目。#66・R4）
import type { AccountRecord } from '../../../core/record';
import { accountChoiceKind, segmentGrowIndex, selectedNote } from '../lib/accounts';
import { AUTO_ACCOUNT_DESC } from '../lib/statement-account';
import { Segment } from './Segment';

export const ACCOUNT_FIELD_ID = 'record-account';

export interface AccountFieldProps {
  readonly accounts: readonly AccountRecord[];
  /** 選んでいる口座の ID */
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** 欄の下の 1 行（直す画面で口座を替えたとき。U19） */
  readonly hint?: string | null;
  /** 欄の印（前にこの明細で選んだ口座を自動で選んだとき「自動で選択」。記録する画面だけ。#66） */
  readonly mark?: string;
}

/** 自動で選んだ理由の読み上げの説明（見えない 1 文） */
const AUTO_DESC_ID = 'record-account-auto-desc';

export function AccountField(p: AccountFieldProps) {
  const kind = accountChoiceKind(p.accounts.length);
  if (kind === 'none') return null;
  const hint = p.hint ? (
    <p class="field__hint" id={`${ACCOUNT_FIELD_ID}-hint`}>
      {p.hint}
    </p>
  ) : null;
  const autoDesc = p.mark ? (
    <span class="sr-only" id={AUTO_DESC_ID}>
      {AUTO_ACCOUNT_DESC}
    </span>
  ) : null;
  if (kind === 'segment') {
    return (
      <div class="accountfield" id={`${ACCOUNT_FIELD_ID}-field`}>
        <Segment
          label="口座"
          id={ACCOUNT_FIELD_ID}
          name={ACCOUNT_FIELD_ID}
          truncate
          {...(p.mark ? { mark: p.mark } : {})}
          describedBy={
            [p.mark ? AUTO_DESC_ID : null, p.hint ? `${ACCOUNT_FIELD_ID}-hint` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          grow={segmentGrowIndex(p.accounts.map((a) => a.name))}
          note={selectedNote(p.accounts, p.value)}
          value={p.value}
          onChange={p.onChange}
          options={p.accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        {autoDesc}
        {hint}
      </div>
    );
  }
  const markId = `${ACCOUNT_FIELD_ID}-mark`;
  const describedBy =
    [
      p.mark ? markId : null,
      p.mark ? AUTO_DESC_ID : null,
      p.hint ? `${ACCOUNT_FIELD_ID}-hint` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div class="field accountfield" id={`${ACCOUNT_FIELD_ID}-field`}>
      {/* 名前の段は印の有無にかかわらず同じ形（#210。NumberField と同じ直し方）。形を替えると Preact が後ろの select を
          作り直し、「自動で選択」が出入りしたときにフォーカスが外れる */}
      <div class="field__head">
        <label class="field__label" for={ACCOUNT_FIELD_ID}>
          口座
        </label>
        {p.mark ? (
          <span id={markId} class="field__mark">
            {p.mark}
          </span>
        ) : null}
      </div>
      <select
        id={ACCOUNT_FIELD_ID}
        class="select"
        value={p.value}
        aria-describedby={describedBy}
        onChange={(ev) => p.onChange(ev.currentTarget.value)}
      >
        {p.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {autoDesc}
      {hint}
    </div>
  );
}
