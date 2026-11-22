// キーボードが出ているか・フォーカスした欄をキーボードと貼り付いた帯で隠れない所へ寄せる量（#172。ui-guidelines 9.6）。
// 純関数だけ（DOM に触れない）。糊は keyboard-reveal.ts（visualViewport の resize と focusin を聞いて、ここで決めた量だけ
// スクロールする）。
//
// 2 つの出方:
// - overlay（iOS の Safari）: interactive-widget を見ず、窓（layout viewport）の高さはそのまま、visualViewport だけが縮む。
//   キーボードは窓の下の部分に重なり、下に貼り付いた帯はキーボードの裏に入る。窓の下の端まで中身が詰まった 1 画面の作りでは
//   スクロールする余地が無いので、キーボードが出ている間だけ下に余白を足す（CSS の :root[data-keyboard="overlay"]）
// - resize（Android の Chrome。interactive-widget=resizes-content）: 窓そのものがキーボードの分だけ縮む。下に貼り付いた帯は
//   キーボードの上に付くので、欄を帯の上へ寄せる
//
// 座標はすべて窓（layout viewport）の上の端からの px（getBoundingClientRect と同じ）。

/** キーボードとみなす縮みの下限（px）。iOS の入力の補助の帯・アドレスバーの出入り（60px 前後）を数えない */
export const KEYBOARD_MIN_PX = 120;
/** 寄せた欄の上下に残す余白（px） */
export const REVEAL_MARGIN_PX = 16;
/** 拡大（ピンチ）とみなす倍率の差。拡大中は visualViewport が縮むのでキーボードと区別できない → 決めない */
const SCALE_EPSILON = 0.01;

export type KeyboardMode = 'overlay' | 'resize';

export interface KeyboardSample {
  /** 文字を入れる欄にフォーカスがあるか（無ければキーボードは出ていないとみなす） */
  editing: boolean;
  /**
   * 主の入力が指（`pointer: coarse`）か。画面にキーボードが出る端末だけで決める（PC で窓の高さだけを縮めた・下に開発の道具を
   * 出したときに印を付けない。ui-guidelines 10.1「外付けのキーボード・PC では印が付かない」。#172 のレビュー）
   */
  coarse: boolean;
  /** 窓の高さ（documentElement.clientHeight） */
  layoutHeight: number;
  /** 同じ幅で見た窓の高さの最大（キーボードの無いときの高さ。nextBaseHeight） */
  baseHeight: number;
  /** visualViewport の高さ（無ければ窓の高さ） */
  viewportHeight: number;
  /** visualViewport の倍率（無ければ 1） */
  scale: number;
}

/** キーボードの出方。出ていなければ null */
export function keyboardMode(s: KeyboardSample): KeyboardMode | null {
  if (!s.editing || !s.coarse) return null;
  if (Math.abs(s.scale - 1) > SCALE_EPSILON) return null;
  if (s.layoutHeight - s.viewportHeight >= KEYBOARD_MIN_PX) return 'overlay';
  if (s.baseHeight - s.layoutHeight >= KEYBOARD_MIN_PX) return 'resize';
  return null;
}

export interface BaseHeight {
  width: number;
  height: number;
}

/**
 * キーボードの無いときの窓の高さ。欄を編集している間は、同じ幅で見た高さの最大を保つ（resize の出方では縮んだ高さを基準に
 * しない）。編集していない間は今の高さに測り直す（画面の分割・窓を縮めた後の高さを基準にし、後で欄を押しただけで印を付けない）。
 * 幅が変わったら（向き・折りたたみ・窓の大きさ）今の高さから測り直す
 */
export function nextBaseHeight(
  prev: BaseHeight | null,
  width: number,
  height: number,
  editing: boolean,
): BaseHeight {
  if (!prev || prev.width !== width || !editing) return { width, height };
  return { width, height: Math.max(prev.height, height) };
}

/** キーボードが上がる・下がる間とみなす時間（ms）。フォーカスした・印が替わった時から。この間に続けて来る resize で延ばす */
export const SETTLE_MS = 1000;
/** 落ち着く間に resize が来たときに延ばす時間（ms。Android はアニメーションの後に窓が縮むことがある。scroll では延ばさない） */
export const SETTLE_EXTEND_MS = 300;

/**
 * 欄を寄せ直すか（#172）。
 * - キーボードが上がる・下がる間（settling: フォーカスした・印が替わった直後と、その間に続けて来る resize）は、毎フレーム
 *   寄せ直す（最後の見える高さで欄が見えるように。寄せる量は revealDelta なので、見えていれば 0 = がたつかない）
 * - 落ち着いた後は、フォーカスした欄・印・見える高さ（下限以上）が替わったときだけ。Android のブラウザのタブでは本人の
 *   スクロールでアドレスバーが出入りする resize が続けて来る。そのたびに寄せると本人のスクロールと取り合う（レビュー N2）
 */
export function shouldReveal(
  prev: {
    readonly field: unknown;
    readonly mode: KeyboardMode | null;
    readonly height: number;
  } | null,
  next: { readonly field: unknown; readonly mode: KeyboardMode | null; readonly height: number },
  settling = false,
): boolean {
  if (next.mode === null || next.field === null) return false;
  if (!prev || settling) return true;
  return (
    prev.field !== next.field ||
    prev.mode !== next.mode ||
    Math.abs(prev.height - next.height) >= KEYBOARD_MIN_PX
  );
}

/** 落ち着く間の終わり（ms）。focus = フォーカスが替わった・印が替わった、event = 落ち着く間の中に来た resize */
export function nextSettleUntil(until: number, now: number, kind: 'focus' | 'event'): number {
  if (kind === 'focus') return now + SETTLE_MS;
  return now < until ? Math.max(until, now + SETTLE_EXTEND_MS) : until;
}

/** 縦の範囲（top < bottom。窓の上の端からの px） */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * 欄が見える範囲: 見えている領域（visualViewport の範囲）と、スクロールの容器の見える枠（clip。文書なら null）の重なりから、
 * 貼り付いた帯（covers。上の帯・下の ［記録する］ の帯など）が覆う分を除く。帯は範囲の上半分にあれば上から、下半分に
 * あれば下から削る（欄が帯の裏にあっても向きを取り違えない。見えている領域に掛からない帯 = キーボードの裏に入った帯は
 * 数えない）
 */
export function visibleSpan(view: Span, clip: Span | null, covers: readonly Span[]): Span {
  const top0 = clip ? Math.max(view.top, clip.top) : view.top;
  const bottom0 = clip ? Math.min(view.bottom, clip.bottom) : view.bottom;
  const mid = (top0 + bottom0) / 2;
  let top = top0;
  let bottom = bottom0;
  for (const c of covers) {
    if (c.bottom <= top0 || c.top >= bottom0) continue;
    if ((c.top + c.bottom) / 2 <= mid) top = Math.max(top, c.bottom);
    else bottom = Math.min(bottom, c.top);
  }
  return { top, bottom };
}

/**
 * 欄を見える範囲の中（上下に margin の余白）へ入れるスクロールの量（正 = 下へスクロールして欄を上へ動かす）。
 * 入っていれば 0。範囲が欄より狭ければ欄の上の端をそろえる（入れようとする所の先頭を見せる）
 */
export function revealDelta(field: Span, visible: Span, margin = REVEAL_MARGIN_PX): number {
  const room = visible.bottom - visible.top;
  const height = field.bottom - field.top;
  const m =
    room >= height + 2 * margin ? margin : Math.max(0, Math.min(margin, (room - height) / 2));
  const top = visible.top + m;
  const bottom = visible.bottom - m;
  if (height > bottom - top) return field.top - top;
  if (field.bottom > bottom) return field.bottom - bottom;
  if (field.top < top) return field.top - top;
  return 0;
}

/** スクロールの容器 1 段（内側から外側へ並べる） */
export interface RevealLevel {
  /** 容器の見える枠（文書そのものなら null） */
  clip: Span | null;
  /** この容器の中で貼り付いている帯（スクロールしても動かない） */
  covers: readonly Span[];
  scrollTop: number;
  /** スクロールできる最大（scrollHeight − clientHeight） */
  scrollMax: number;
}

/**
 * 内側の容器から順に、欄を見える範囲へ入れるスクロールの量（容器ごと。0 = 動かさない）。各段で動かせる範囲に収め、
 * 動かした分だけ欄の位置をずらして外側の段を決める
 */
export function planReveal(
  field: Span,
  view: Span,
  levels: readonly RevealLevel[],
  margin = REVEAL_MARGIN_PX,
): number[] {
  let f = field;
  const out: number[] = [];
  for (const level of levels) {
    const want = revealDelta(f, visibleSpan(view, level.clip, level.covers), margin);
    const d = Math.round(
      Math.max(-level.scrollTop, Math.min(Math.max(0, level.scrollMax - level.scrollTop), want)),
    );
    out.push(d === 0 ? 0 : d); // -0 を 0 に
    f = { top: f.top - d, bottom: f.bottom - d };
  }
  return out;
}

/** 文字を入れる欄か（キーボードが出るもの）。input の type と要素の名前で決める */
export function isTextEntry(tag: string, type: string | null, editable: boolean): boolean {
  if (editable) return true;
  const t = tag.toLowerCase();
  if (t === 'textarea' || t === 'select') return true;
  if (t !== 'input') return false;
  return !NON_TEXT_INPUTS.has((type ?? 'text').toLowerCase());
}

const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * 決定キー（Enter）で欄を移る・閉じるか。日本語の変換の確定（isComposing・keyCode 229）は数えない（一言の欄で変換を確定した
 * だけでキーボードが閉じないように）
 */
export function isEnterCommit(key: string, isComposing: boolean, keyCode: number): boolean {
  return key === 'Enter' && !isComposing && keyCode !== 229;
}

/** 送るボタンを押し始めてから送信までを「押した」と数える長さ（ms。指で押して離すまで。#183） */
export const SUBMIT_PRESS_MS = 2000;

/**
 * キーボードが出ている間の送信を通すか（#183。ui-guidelines 10.1）。印が無ければ通す。印の間は、送るボタン（本文の最後に
 * 置いた ［記録する］ / ［保存］）を指で押し始めてから SUBMIT_PRESS_MS 以内の送信だけを通し、欄の Enter によるフォームの
 * 暗黙の送信（押し始めが無い）は止める。pressedAt = 押し始めの時刻（無ければ null）
 */
export function submitAllowed(keyboard: boolean, pressedAt: number | null, now: number): boolean {
  if (!keyboard) return true;
  return pressedAt !== null && now >= pressedAt && now - pressedAt <= SUBMIT_PRESS_MS;
}
