// トースト（Issue #9 契約 U-4。docs/ui-guidelines.md P4・ADR-0007）。アプリの殻に 1 つ（画面を移っても残る）。
// 「<どの取引> を消しました」+ [元に戻す]（role="status" の領域）。送った削除の失敗は別の知らせ（role="alert"）で、
// 次に消した取引の [元に戻す] を置き換えない。読み上げの領域（aria-live）は常に置き、中身だけを入れ替える。
// フォーカス・ポインタがある間は取り消しの時間を止める（WCAG 2.2.1）。ダイアログにしない（確認を挟まない）。hook を持たない
import { TOAST_TEXT, type ToastState } from '../lib/deletions';
import { DRAFT_TOAST_TEXT, type DraftToast } from '../lib/drafts';
import { Button } from './Button';
import { Icon } from './Icon';

/** [消す] の後にフォーカスを移す先 */
export const TOAST_UNDO_ID = 'toast-undo';

/** 書きかけを破棄した後にフォーカスを移す先（[元に戻す]。#75） */
export const DRAFT_UNDO_ID = 'toast-draft-undo';

export interface ToastProps {
  readonly toast: ToastState;
  readonly failed: boolean;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
  readonly onDismissFailed: () => void;
  readonly onHold: () => void;
  readonly onResume: () => void;
  /** 書きかけの知らせ（#75。破棄 = [元に戻す]、残っています = [記録に戻る] / [編集に戻る]）。省けば出さない */
  readonly draft?: DraftToast;
  readonly onDraftAction?: () => void;
  readonly onDraftDismiss?: () => void;
  readonly onDraftHold?: () => void;
  readonly onDraftResume?: () => void;
}

/** 書きかけの知らせの中身（hook を持たない） */
function DraftToastBody(p: ToastProps) {
  const d = p.draft;
  if (!d) return null;
  const discarded = d.type === 'discarded';
  return (
    <div
      class="toast"
      onFocusIn={p.onDraftHold}
      onFocusOut={p.onDraftResume}
      onPointerEnter={p.onDraftHold}
      onPointerLeave={p.onDraftResume}
    >
      <p class="toast__text">{d.text}</p>
      <Button
        {...(discarded ? { id: DRAFT_UNDO_ID, label: DRAFT_TOAST_TEXT.undoName[d.kind] } : {})}
        variant="tonal"
        icon={discarded ? 'undo' : 'back'}
        onClick={() => p.onDraftAction?.()}
      >
        {discarded ? '元に戻す' : DRAFT_TOAST_TEXT.back[d.kind]}
      </Button>
      <CloseButton onClick={() => p.onDraftDismiss?.()} />
    </div>
  );
}

function CloseButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" class="toast__close" aria-label="通知を閉じる" onClick={onClick}>
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
            <Button id={TOAST_UNDO_ID} variant="tonal" icon="undo" onClick={p.onUndo}>
              元に戻す
            </Button>
            <CloseButton onClick={p.onDismiss} />
          </div>
        ) : null}
        {/* 書きかけの知らせも同じ読み上げの領域に（#75。削除の知らせと並ぶ） */}
        <DraftToastBody {...p} />
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
