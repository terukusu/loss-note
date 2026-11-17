// トースト（Issue #9 契約 U-4。docs/ui-guidelines.md P4・ADR-0007）。アプリの殻に 1 つ（画面を移っても残る）。
// 「<どの取引> を消しました」+ [元に戻す]（role="status" の領域）。送った削除の失敗は別の知らせ（role="alert"）で、
// 次に消した取引の [元に戻す] を置き換えない。読み上げの領域（aria-live）は常に置き、中身だけを入れ替える。
// フォーカス・ポインタがある間は取り消しの時間を止める（WCAG 2.2.1）。ダイアログにしない（確認を挟まない）。hook を持たない
import { TOAST_TEXT, type ToastState } from '../lib/deletions';
import { Button } from './Button';
import { Icon } from './Icon';

/** [消す] の後にフォーカスを移す先 */
export const TOAST_UNDO_ID = 'toast-undo';

export interface ToastProps {
  readonly toast: ToastState;
  readonly failed: boolean;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
  readonly onDismissFailed: () => void;
  readonly onHold: () => void;
  readonly onResume: () => void;
}

function CloseButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" class="toast__close" aria-label="知らせを閉じる" onClick={onClick}>
      <Icon name="cross" />
    </button>
  );
}

export function Toast(p: ToastProps) {
  const t = p.toast;
  return (
    <div class="toast-region">
      <div class="toast-region__live" role="status" aria-live="polite">
        {t ? (
          <div
            class="toast"
            onFocusIn={p.onHold}
            onFocusOut={p.onResume}
            onPointerEnter={p.onHold}
            onPointerLeave={p.onResume}
          >
            <p class="toast__text">{TOAST_TEXT.deleted(t.label)}</p>
            <Button id={TOAST_UNDO_ID} variant="ghost" icon="undo" onClick={p.onUndo}>
              元に戻す
            </Button>
            <CloseButton onClick={p.onDismiss} />
          </div>
        ) : null}
      </div>
      {p.failed ? (
        <div class="toast toast--error" role="alert">
          <p class="toast__text">{TOAST_TEXT.failed}</p>
          <CloseButton onClick={p.onDismissFailed} />
        </div>
      ) : null}
    </div>
  );
}
