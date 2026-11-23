// 数値の入力欄（契約 C-4）。打った文字列をそのまま親へ返す（解釈・検査は ui/src/lib/record-form.ts の純関数）。
// 文字 16px 以上（iOS の自動拡大を避ける）・高さ 44px 以上。誤りは枠の色だけでなく文言で示す。
// size="lg" は記録する画面の主の数字（イン・決済・LC）。inputMode="text" は符号つきの数（損益）に使う
// （iOS の小数のキーボードには − が無い）
// locked（#171）: 薄い形のまま押せる止まった欄（readOnly。disabled はタップを受けない）。外すのは本人の操作だけ:
// 押す（click。読み上げのダブルタップも click）と、キーの Enter / Space / 文字の入力（keydown）。フォーカスだけでは外さない
// （Tab で通る・画面がプログラムで focus() する・読み上げのスワイプで移るだけでは選択を変えない。WCAG 3.2.1）。
// click では外して focus() し直す（iOS は読み取り専用の欄のフォーカスでキーボードを出さず、ユーザーの操作の中の focus() なら出すため）。
// 文字のキーは既定の入力を止めて、その 1 文字を打った値として親へ返す（LC の欄では価格を打つと「なし」は外れる = applyDraft）
// 決定キー（#172）: onEnter を渡した欄は、止まっていない間の Enter（変換の確定を除く）で既定の送信を止めて呼ぶ。止まった欄の
// Enter は「外す」（#171）が先（外れた後の Enter が onEnter）。キーの振り分けは純関数 numberFieldKeyOf
import type { ComponentChildren } from 'preact';
import { isEnterCommit, isImeKey } from '../lib/keyboard';
import { FieldLabelText } from './FieldLabelText';

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
  /** 欄の名前の横の「i」（言葉の説明の InfoTip。#201）。label の外（名前の段）に置く */
  readonly info?: ComponentChildren;
  readonly placeholder?: string;
  readonly size?: 'lg';
  readonly disabled?: boolean;
  readonly inputMode?: 'decimal' | 'text';
  /** 欄の外にある説明の要素の ID（2 列の下に通しで出す 1 行など。読み上げの説明に足す） */
  readonly describedBy?: string;
  /** 止まった欄（薄い形・押すと onUnlock。note は読み上げの説明に足す 1 文） */
  readonly locked?: NumberFieldLock;
  /** スマホのキーボードの決定キーの表示（LC = 次へ・一言 = 完了。#172） */
  readonly enterKeyHint?: 'next' | 'done';
  /** 決定キー（変換の確定を除く）。渡したときだけ既定の動き（フォームの送信）を止めて呼ぶ（#172） */
  readonly onEnter?: (input: HTMLInputElement) => void;
}

export interface NumberFieldLock {
  readonly note: string;
  readonly onUnlock: () => void;
}

/** 止まった欄を外すキー（Enter・Space = 押す、それ以外の 1 文字 = 打ち始め）。修飾キー・変換中は外さない */
export function unlockKeyOf(e: {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}): 'press' | 'type' | null {
  // 変換中の判定は決定キー（isEnterCommit）と同じ isImeKey: isComposing と keyCode 229（Safari の確定直後の keydown。#172 のレビュー N5）
  if (e.ctrlKey || e.metaKey || e.altKey || isImeKey(e.isComposing === true, e.keyCode ?? 0))
    return null;
  if (e.key === 'Enter' || e.key === ' ') return 'press';
  if (e.key.length === 1) return 'type';
  return null;
}

/**
 * 欄の keydown の振り分け（#171・#172）。止まっている間は「外す」（press = Enter・Space / type = 1 文字）が先で、決定キーで
 * 一言へ移らない。止まっていない（外れた後も）間の決定キー（変換の確定を除く）は、onEnter を渡したときだけ 'enter'
 */
export function numberFieldKeyOf(
  e: Parameters<typeof unlockKeyOf>[0],
  at: { readonly locked: boolean; readonly onEnter: boolean },
): 'press' | 'type' | 'enter' | null {
  if (at.locked) return unlockKeyOf(e);
  if (at.onEnter && isEnterCommit(e.key, e.isComposing ?? false, e.keyCode ?? 0)) return 'enter';
  return null;
}

/** 止まった欄を外す（DOM の readOnly も同期で外す = 同じ操作の中の focus() でキーボードが出る） */
function unlock(el: HTMLInputElement, lock: NumberFieldLock): boolean {
  if (!el.readOnly) return false;
  el.readOnly = false;
  lock.onUnlock();
  return true;
}

export function NumberField(p: NumberFieldProps) {
  const hintId = `${p.id}-hint`;
  const errorId = `${p.id}-error`;
  const markId = `${p.id}-mark`;
  const lockId = `${p.id}-lock`;
  const lock = p.locked;
  const describedBy = [
    lock ? lockId : '',
    p.mark ? markId : '',
    p.hint ? hintId : '',
    p.describedBy ?? '',
    p.error ? errorId : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = (
    <label class="field__label" for={p.id}>
      <FieldLabelText text={p.label} />
    </label>
  );
  return (
    <div class={p.error ? 'field field--error' : 'field'}>
      {p.mark || p.info ? (
        <div class="field__head">
          {label}
          {p.info ?? null}
          {p.mark ? (
            <span id={markId} class="field__mark">
              {p.mark}
            </span>
          ) : null}
        </div>
      ) : (
        label
      )}
      <div
        class={['numfield', p.size === 'lg' ? 'numfield--lg' : '', lock ? 'numfield--locked' : '']
          .filter(Boolean)
          .join(' ')}
      >
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
          readOnly={lock ? true : undefined}
          aria-invalid={p.error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          onInput={(e) => p.onInput(e.currentTarget.value)}
          enterKeyHint={p.enterKeyHint}
          {...(lock
            ? {
                onClick: (e: MouseEvent) => {
                  const el = e.currentTarget as HTMLInputElement;
                  if (!unlock(el, lock)) return;
                  el.blur();
                  el.focus();
                },
              }
            : {})}
          {...(lock || p.onEnter
            ? {
                onKeyDown: (e: KeyboardEvent) => {
                  const el = e.currentTarget as HTMLInputElement;
                  const act = numberFieldKeyOf(e, {
                    locked: lock !== undefined && el.readOnly,
                    onEnter: p.onEnter !== undefined,
                  });
                  if (act === null) return;
                  e.preventDefault();
                  if (act === 'enter') {
                    p.onEnter?.(el);
                    return;
                  }
                  if (lock) unlock(el, lock);
                  if (act === 'type') p.onInput(e.key);
                },
              }
            : {})}
        />
        {p.unit ? <span class="numfield__unit">{p.unit}</span> : null}
        {lock ? (
          <span id={lockId} class="sr-only">
            {lock.note}
          </span>
        ) : null}
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
