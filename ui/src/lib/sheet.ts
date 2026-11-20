// 下のシート（部品 components/Sheet.tsx。#129・docs/ui-guidelines.md 9.3・9.7・ADR-0021）の規則。純関数（DOM・
// history・時刻に触らない）。部品は <dialog> の showModal()（最上層・フォーカスを閉じ込める・後ろを操作できない）で、
// 戻るの層（back-stack.ts）に 1 段積む。
// - 閉じ方 SheetDismiss: button = 右上の ✕、escape = Esc と、取り消せる dialog の cancel（Android の Chrome は showModal() の間の
//   戻るを dialog の cancel に回し、popstate を出さない = close watcher）、backdrop = 後ろの暗い面を押した、back = 戻るの
//   popstate（糊が層を閉じた）、native = 取り消せない cancel の後や、こちらが頼んでいない dialog の close（UI で閉じたのと同じ。
//   糊が積んだ段を history.go で戻して数を合わせる）
// - シートの中でたどった段（「i」の説明の用語集のリンク。#57）は段ごとに層を積み、戻る・Esc で 1 つ前へ。✕・外を押す・
//   取り消せない close watcher はシートごと閉じる
// - 閉じたら、開いたボタンへフォーカスを戻す（画面が移ってボタンが外れた・ほかへ移したときは戻さない）
// - 開いているシートの数が 0 → 1 でトーストの取り消しの時間を止め、1 → 0 で動かす（モーダルの間はトーストを押せないため。9.3）

export type SheetDismiss = 'button' | 'escape' | 'backdrop' | 'back' | 'native';

/** dialog の cancel を自分で扱うか（取り消せる = preventDefault して Esc と同じ）、ブラウザに閉じさせるか（close で native） */
export function sheetCancel(cancelable: boolean): 'handle' | 'native' {
  return cancelable ? 'handle' : 'native';
}

/**
 * 閉じ方と、シートの中でたどった段数（0 = 開いたときの中身）から、シートを閉じるか 1 つ前へ戻るか。Esc（取り消せる close
 * watcher を含む）は 1 つ前へ、✕・外・取り消せない close watcher はシートごと閉じる。戻る（back）はシート自身の段から下りた
 * ときに来るのでシートごと閉じる（たどった段は段ごとに層を積み、その段の戻るは呼ぶ側の閉じ方が 1 つ前へ戻す）
 */
export function sheetDismiss(reason: SheetDismiss, depth: number): 'up' | 'close' {
  if (!(Number.isFinite(depth) && depth > 0)) return 'close';
  return reason === 'escape' ? 'up' : 'close';
}

export interface ReturnFocusInput {
  /** 開いたボタンが文書の中にまだある */
  readonly openerConnected: boolean;
  /** 閉じた後のフォーカスの在りか（シートの中 / body に落ちた / ほかの要素） */
  readonly focus: 'inside' | 'body' | 'outside';
}

/** 閉じたら開いたボタンへフォーカスを戻すか */
export function sheetReturnFocus(i: ReturnFocusInput): boolean {
  return i.openerConnected && i.focus !== 'outside';
}

export const SHEET_EMPTY: readonly string[] = [];

export type SheetStackEvent = { readonly type: 'open' | 'close'; readonly id: string };

export interface SheetStackResult {
  readonly stack: readonly string[];
  /** トーストの取り消しの時間を止める（0 → 1）・動かす（1 → 0）・そのまま */
  readonly hold: 'hold' | 'resume' | null;
}

/** 開いているシートの積み重ね（下から開いた順） */
export function sheetStackNext(stack: readonly string[], e: SheetStackEvent): SheetStackResult {
  if (e.type === 'open') {
    if (stack.includes(e.id)) return { stack, hold: null };
    return { stack: [...stack, e.id], hold: stack.length === 0 ? 'hold' : null };
  }
  if (!stack.includes(e.id)) return { stack, hold: null };
  const next = stack.filter((id) => id !== e.id);
  return { stack: next, hold: next.length === 0 ? 'resume' : null };
}

/**
 * 後ろの暗い面を押したか。dialog の ::backdrop を押すと出来事の的は dialog そのもの（中身は内側の要素が覆う）。押し始めと
 * 離した所の両方が dialog のときだけ（中の文字を選んで外へ引いたときは閉じない）
 */
export function isBackdropHit<T>(down: T | null, up: T | null, dialog: T): boolean {
  return down === dialog && up === dialog;
}

export interface KeyLike {
  readonly key: string;
  /** 入力の変換中（IME）。変換を取り消す Esc はシートを閉じない */
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
}

/**
 * dialog の中の keydown の Escape を自分で扱うか（#129 のレビュー N1）。Esc の close watcher は、利用者の操作をはさまずに
 * 続けて押すと 2 回目の cancel を取り消させない（シートごと閉じる）ので、keydown を取り消して close request を出さずに
 * Esc の閉じ方（たどった段なら 1 つ前へ）を呼ぶ。変換中・ほかが扱った keydown は見ない
 */
export function sheetEscapeKey(e: KeyLike): boolean {
  return e.key === 'Escape' && e.isComposing !== true && e.defaultPrevented !== true;
}

/**
 * 段ごとの層（1..want 段目）の数合わせ（#129 のレビュー N5）。layered = 積んである段数、want = 積みたい段数。open = 下から積む
 * 段の番号、close = 上から外す段の番号
 */
export function layerPlan(
  layered: number,
  want: number,
): { readonly open: readonly number[]; readonly close: readonly number[] } {
  const have = Number.isInteger(layered) && layered > 0 ? layered : 0;
  const goal = Number.isInteger(want) && want > 0 ? want : 0;
  const open: number[] = [];
  const close: number[] = [];
  for (let k = have + 1; k <= goal; k++) open.push(k);
  for (let k = have; k > goal; k--) close.push(k);
  return { open, close };
}
