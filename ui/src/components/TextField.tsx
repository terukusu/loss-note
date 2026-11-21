// 文字・日時の入力欄（Issue #13 契約 R-4）。NumberField と同じ見た目・誤りの出し方（文言 + aria-invalid + aria-describedby）。
// 打った文字列をそのまま親へ返す（解釈・検査は純関数）。文字 16px 以上・高さ 44px 以上。
// 空の欄は文字を薄くする（日時の欄の「yyyy/mm/dd --:--」が入れた値に見えないように。#58 デザインレビュー 3）
import { isEnterCommit } from '../lib/keyboard';
import { FieldLabelText } from './FieldLabelText';

export interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onInput: (raw: string) => void;
  readonly type?: 'text' | 'datetime-local' | 'date';
  /** 候補（<datalist> の ID） */
  readonly list?: string;
  readonly maxLength?: number;
  readonly hint?: string;
  readonly error?: string;
  /** 欄の印（明細の読み取りの「読み取り」「直した」など。#15）。ラベルの横に文字で出し、読み上げの説明に入れる */
  readonly mark?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** スマホのキーボード（限月は数字。#117 のデザインレビュー N4）。省けば文字 */
  readonly inputMode?: 'text' | 'numeric';
  /** スマホのキーボードの決定キーの表示（LC = 次へ・一言 = 完了。#172） */
  readonly enterKeyHint?: 'next' | 'done';
  /** 決定キー（変換の確定を除く）。渡したときだけ既定の動き（フォームの送信）を止めて呼ぶ（#172） */
  readonly onEnter?: (input: HTMLInputElement) => void;
}

export function TextField(p: TextFieldProps) {
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  const markId = `${p.id}-mark`;
  const describedBy = [p.mark ? markId : '', p.hint ? hintId : '', p.error ? errorId : '']
    .filter(Boolean)
    .join(' ');
  const label = (
    <label class="field__label" for={p.id}>
      <FieldLabelText text={p.label} />
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
      <div class="numfield textfield">
        <input
          id={p.id}
          class={
            p.value === ''
              ? 'numfield__input textfield__input textfield__input--empty'
              : 'numfield__input textfield__input'
          }
          type={p.type ?? 'text'}
          autoComplete="off"
          spellcheck={false}
          list={p.list}
          maxLength={p.maxLength}
          value={p.value}
          placeholder={p.placeholder}
          disabled={p.disabled}
          {...(p.inputMode ? { inputMode: p.inputMode } : {})}
          aria-invalid={p.error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onInput={(e) => p.onInput(e.currentTarget.value)}
          enterKeyHint={p.enterKeyHint}
          onKeyDown={
            p.onEnter
              ? (e) => {
                  if (!isEnterCommit(e.key, e.isComposing, e.keyCode)) return;
                  e.preventDefault();
                  p.onEnter?.(e.currentTarget);
                }
              : undefined
          }
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
