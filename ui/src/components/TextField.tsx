// 文字・日時の入力欄（Issue #13 契約 R-4）。NumberField と同じ見た目・誤りの出し方（文言 + aria-invalid + aria-describedby）。
// 打った文字列をそのまま親へ返す（解釈・検査は純関数）。文字 16px 以上・高さ 44px 以上
export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onInput: (raw: string) => void;
  readonly type?: 'text' | 'datetime-local';
  /** 候補（<datalist> の ID） */
  readonly list?: string;
  readonly maxLength?: number;
  readonly hint?: string;
  readonly error?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function TextField(p: TextFieldProps) {
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  const describedBy = [p.hint ? hintId : '', p.error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div class={p.error ? 'field field--error' : 'field'}>
      <label class="field__label" for={p.id}>
        {p.label}
      </label>
      <div class="numfield textfield">
        <input
          id={p.id}
          class="numfield__input textfield__input"
          type={p.type ?? 'text'}
          autoComplete="off"
          spellcheck={false}
          list={p.list}
          maxLength={p.maxLength}
          value={p.value}
          placeholder={p.placeholder}
          disabled={p.disabled}
          aria-invalid={p.error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onInput={(e) => p.onInput(e.currentTarget.value)}
        />
      </div>
      {p.hint ? (
        <p id={hintId} class="field__hint">
          {p.hint}
        </p>
      ) : null}
      {p.error ? (
        <p id={errorId} class="field__error">
          {p.error}
        </p>
      ) : null}
    </div>
  );
}
