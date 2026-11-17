// 数値の入力欄（契約 C-4）。打った文字列をそのまま親へ返す（解釈・検査は #13 の純関数）。
// 文字 16px 以上（iOS の自動拡大を避ける）・高さ 44px 以上。誤りは枠の色だけでなく文言で示す
export interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onInput: (raw: string) => void;
  readonly unit?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly placeholder?: string;
}

export function NumberField(p: NumberFieldProps) {
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  const describedBy = [p.hint ? hintId : '', p.error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div class={p.error ? 'field field--error' : 'field'}>
      <label class="field__label" for={p.id}>
        {p.label}
      </label>
      <div class="numfield">
        <input
          id={p.id}
          class="numfield__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellcheck={false}
          value={p.value}
          placeholder={p.placeholder}
          aria-invalid={p.error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onInput={(e) => p.onInput(e.currentTarget.value)}
        />
        {p.unit ? <span class="numfield__unit">{p.unit}</span> : null}
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
