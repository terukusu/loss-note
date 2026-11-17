// 数値の入力欄（契約 C-4）。打った文字列をそのまま親へ返す（解釈・検査は ui/src/lib/record-form.ts の純関数）。
// 文字 16px 以上（iOS の自動拡大を避ける）・高さ 44px 以上。誤りは枠の色だけでなく文言で示す。
// size="lg" は記録する画面の主の数字（イン・決済・LC）。inputMode="text" は符号つきの数（損益）に使う
// （iOS の小数のキーボードには − が無い）
export interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onInput: (raw: string) => void;
  readonly unit?: string;
  readonly hint?: string;
  readonly error?: string;
  /** 欄の印（明細の読み取りの「読み取り」「直した」など。#15）。ラベルの横に文字で出し、読み上げの説明に入れる */
  readonly mark?: string;
  readonly placeholder?: string;
  readonly size?: 'lg';
  readonly disabled?: boolean;
  readonly inputMode?: 'decimal' | 'text';
}

export function NumberField(p: NumberFieldProps) {
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  const markId = `${p.id}-mark`;
  const describedBy = [p.mark ? markId : '', p.hint ? hintId : '', p.error ? errorId : '']
    .filter(Boolean)
    .join(' ');
  const label = (
    <label class="field__label" for={p.id}>
      {p.label}
    </label>
  );
  return (
    <div class={p.error ? 'field field--error' : 'field'}>
      {p.mark ? (
        <div class="field__head">
          {label}
          <span id={markId} class="field__mark">
            {p.mark}
          </span>
        </div>
      ) : (
        label
      )}
      <div class={p.size === 'lg' ? 'numfield numfield--lg' : 'numfield'}>
        <input
          id={p.id}
          class="numfield__input"
          type="text"
          inputMode={p.inputMode ?? 'decimal'}
          autoComplete="off"
          spellcheck={false}
          value={p.value}
          placeholder={p.placeholder}
          disabled={p.disabled}
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
