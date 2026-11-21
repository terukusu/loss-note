// キーボードで入力の欄が隠れないようにする糊（#172。ui-guidelines 9.6）。規則と量は keyboard.ts の純関数。
// - visualViewport の resize・scroll・窓の resize・focusin / focusout を聞き、rAF で 1 フレーム 1 回にまとめて決める。
//   指で触る端末（pointer: coarse）だけ。キーボードが上がる・下がる間（落ち着く間。フォーカス・印が替わってから 1 秒、続けて来る
//   resize で延ばす。scroll は本人のスクロールでも来るので延ばさない）は毎フレーム寄せ直し、上がりきった最後の位置で欄が見える。落ち着いた後はフォーカスした欄・印・
//   見える高さが替わったときだけ（shouldReveal。本人のスクロールと取り合わない）
// - キーボードが出ている間は <html data-keyboard="overlay|resize">（overlay = iOS の Safari。CSS が全画面のシートと下のシートの
//   下に余白を足し、窓の下の端まで詰まった 1 画面でもスクロールで欄を上へ寄せられるようにする）
// - フォーカスした欄が見える範囲（visualViewport から上の帯・下の ［記録する］ の帯などの貼り付いた帯を除いた所）に
//   余白 16px で入っていなければ、内側のスクロールの容器から順に寄せる。下のシート（<dialog>）の中では文書をスクロールしない
// - キーボードが閉じたら印を外す。足した余白が消えて、1 画面の作りはスクロールの位置が元（0）に戻る
// - prefers-reduced-motion では滑らかにスクロールしない
// 位置は .style で書き換えない（P11。帯をキーボードに追わせない）。main.tsx が 1 回入れる。
import {
  type BaseHeight,
  isTextEntry,
  type KeyboardMode,
  keyboardMode,
  nextBaseHeight,
  nextSettleUntil,
  planReveal,
  type RevealLevel,
  type Span,
  shouldReveal,
} from './keyboard';

/** 貼り付いて欄を覆いうる帯（position が sticky / fixed のものだけ数える） */
const COVERS =
  '.appbar, .record__submit, .setform__actions, .emotions__actions, .review__period-bar';

/**
 * キーボードが出ている印があるか（記録する・編集の onSubmit が見る）。印の間は下の帯が隠れているので、決定キーを渡していない欄の
 * Enter（フォームの暗黙の送信）で保存を送らない（ui-guidelines 10.1「主の流れの決定キーでは保存を送らない」。#172 のレビュー N3）
 */
export function keyboardShown(root: Element | null | undefined): boolean {
  return root?.hasAttribute('data-keyboard') ?? false;
}

export function installKeyboardReveal(win: Window): () => void {
  const doc = win.document;
  const root = doc.documentElement;
  const vv = win.visualViewport;
  let base: BaseHeight | null = nextBaseHeight(null, root.clientWidth, root.clientHeight, false);
  let mode: KeyboardMode | null = null;
  let frame: number | undefined;
  /** キーボードが上がる・下がる間の終わり（performance.now の ms。nextSettleUntil） */
  let settleUntil = 0;
  /** 前の run の欄（替わったら落ち着く間を始める） */
  let lastField: HTMLElement | null = null;

  const editingElement = (): HTMLElement | null => {
    const a = doc.activeElement;
    if (!(a instanceof HTMLElement)) return null;
    return isTextEntry(a.tagName, a.getAttribute('type'), a.isContentEditable) ? a : null;
  };

  /** 前に寄せたときの欄・印・見える高さ（寄せ直すかを決める。shouldReveal） */
  let last: { field: HTMLElement | null; mode: KeyboardMode | null; height: number } | null = null;

  const run = () => {
    frame = undefined;
    const t = win.performance.now();
    const field = editingElement();
    const editing = field !== null;
    if (field !== lastField) {
      lastField = field;
      settleUntil = nextSettleUntil(settleUntil, t, 'focus');
    }
    base = nextBaseHeight(base, root.clientWidth, root.clientHeight, editing);
    const viewportHeight = vv ? vv.height : root.clientHeight;
    const next = keyboardMode({
      editing,
      coarse: win.matchMedia('(pointer: coarse)').matches,
      layoutHeight: root.clientHeight,
      baseHeight: base.height,
      viewportHeight,
      scale: vv ? vv.scale : 1,
    });
    if (next !== mode) {
      mode = next;
      settleUntil = nextSettleUntil(settleUntil, t, 'focus');
      // 帯が隠れる・戻るとレイアウトが変わる。下の getBoundingClientRect は替わった後の形で測る（同期のレイアウト）
      if (next) root.setAttribute('data-keyboard', next);
      else root.removeAttribute('data-keyboard');
    }
    const now = { field, mode: next, height: viewportHeight };
    const settling = t < settleUntil;
    const again = shouldReveal(last, now, settling);
    last = next ? now : null;
    if (again && field?.isConnected) reveal(field, settling);
    // 落ち着く間は、次の resize が来なくてももう 1 フレーム見る（帯を隠した後のレイアウト・キーボードの最後の位置で寄せ直す）
    if (settling && next) schedule();
  };

  /** 1 フレームに 1 回にまとめる（resize・scroll が続けて来ても rAF で間引く） */
  const schedule = () => {
    if (frame !== undefined) return;
    frame = win.requestAnimationFrame(run);
  };

  /** resize: 落ち着く間なら延ばして寄せ直す（キーボードの動き・窓の縮み） */
  const onViewport = () => {
    settleUntil = nextSettleUntil(settleUntil, win.performance.now(), 'event');
    schedule();
  };

  /**
   * visualViewport の scroll: 見直すだけで落ち着く間は延ばさない。iPhone では本人のスクロールでも来るので、延ばすとフォーカスの
   * 直後にスクロールし始めた本人を毎フレーム欄の位置へ引き戻し続ける（#172 の再レビュー R2）
   */
  const onViewportScroll = () => {
    schedule();
  };

  const reveal = (field: HTMLElement, settling: boolean) => {
    const containers = scrollContainers(field);
    const levels: RevealLevel[] = containers.map((c) => ({
      clip: c.el ? spanOf(c.el.getBoundingClientRect()) : null,
      covers: coversIn(c.el, field),
      scrollTop: c.el ? c.el.scrollTop : scroller().scrollTop,
      scrollMax: c.el
        ? c.el.scrollHeight - c.el.clientHeight
        : scroller().scrollHeight - root.clientHeight,
    }));
    const view: Span = vv
      ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height }
      : { top: 0, bottom: root.clientHeight };
    const deltas = planReveal(spanOf(field.getBoundingClientRect()), view, levels);
    // 落ち着く間は毎フレーム追うので滑らせない（キーボードの動きに合わせて移る）。動きを減らす設定でも滑らせない
    const behavior: ScrollBehavior =
      settling || win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    deltas.forEach((d, i) => {
      const level = levels[i];
      if (d === 0 || !level) return;
      // 動いている途中でも同じ終わりの位置になるよう、量ではなく行き先で頼む
      const top = level.scrollTop + d;
      const el = containers[i]?.el;
      if (el) el.scrollTo({ top, behavior });
      else win.scrollTo({ top, behavior });
    });
  };

  const scroller = (): Element => doc.scrollingElement ?? root;

  /** 欄から外へ向かうスクロールの容器（el = null は文書）。<dialog> の中なら dialog の外へは出ない */
  const scrollContainers = (field: HTMLElement): { el: HTMLElement | null }[] => {
    const out: { el: HTMLElement | null }[] = [];
    for (let p = field.parentElement; p && p !== doc.body && p !== root; p = p.parentElement) {
      if (isScrollable(p)) out.push({ el: p });
      if (p.tagName === 'DIALOG') return out;
    }
    out.push({ el: null });
    return out;
  };

  const isScrollable = (el: HTMLElement): boolean => {
    const oy = win.getComputedStyle(el).overflowY;
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight;
  };

  /** 容器（null = 文書）の中で貼り付いている帯。いちばん近いスクロールの容器がその容器のものだけ */
  const coversIn = (container: HTMLElement | null, field: HTMLElement): Span[] => {
    const scope: ParentNode = container ?? doc;
    const out: Span[] = [];
    for (const c of Array.from(scope.querySelectorAll<HTMLElement>(COVERS))) {
      if (c.contains(field)) continue;
      const pos = win.getComputedStyle(c).position;
      if (pos !== 'sticky' && pos !== 'fixed') continue;
      if (nearestContainer(c) !== container) continue;
      const r = c.getBoundingClientRect();
      if (r.height <= 0) continue;
      out.push(spanOf(r));
    }
    return out;
  };

  /** いちばん近いスクロールの容器（null = 文書。スクロールしない <dialog> の中は undefined = どの段にも数えない） */
  const nearestContainer = (el: HTMLElement): HTMLElement | null | undefined => {
    for (let p = el.parentElement; p && p !== doc.body && p !== root; p = p.parentElement) {
      if (isScrollable(p)) return p;
      if (p.tagName === 'DIALOG') return undefined;
    }
    return null;
  };

  const opts: AddEventListenerOptions = { passive: true };
  vv?.addEventListener('resize', onViewport, opts);
  vv?.addEventListener('scroll', onViewportScroll, opts);
  win.addEventListener('resize', onViewport, opts);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  return () => {
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewportScroll);
    win.removeEventListener('resize', onViewport);
    doc.removeEventListener('focusin', schedule);
    doc.removeEventListener('focusout', schedule);
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    root.removeAttribute('data-keyboard');
  };
}

function spanOf(r: DOMRect): Span {
  return { top: r.top, bottom: r.bottom };
}
