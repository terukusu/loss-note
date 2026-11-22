// キーボードの出方と、フォーカスした欄を隠れない所へ寄せる量（#172。ui/src/lib/keyboard.ts）。
// 数は 390×844 の縦のスマホ（上の安全域 47・上の帯 48 → 帯の下の端 95、下の帯 = 判定の 1 行 + ［記録する］ で高さ 110）
import { describe, expect, it } from 'vitest';
import {
  isEnterCommit,
  isTextEntry,
  KEYBOARD_MIN_PX,
  keyboardMode,
  nextBaseHeight,
  nextSettleUntil,
  planReveal,
  REVEAL_MARGIN_PX,
  revealDelta,
  SETTLE_EXTEND_MS,
  SETTLE_MS,
  SUBMIT_PRESS_MS,
  shouldReveal,
  submitAllowed,
  visibleSpan,
} from '../../ui/src/lib/keyboard';

const APPBAR = { top: 0, bottom: 95 };
/** LC の欄（2 段目の中ほど。キーボードの無い 844 の窓では見えている） */
const LC = { top: 430, bottom: 478 };

describe('keyboardMode', () => {
  const base = {
    editing: true,
    coarse: true,
    layoutHeight: 844,
    baseHeight: 844,
    viewportHeight: 844,
    scale: 1,
  };

  it('窓も visualViewport も縮んでいなければ出ていない', () => {
    expect(keyboardMode(base)).toBeNull();
  });

  it('iOS の Safari: 窓はそのまま visualViewport だけが縮む → overlay', () => {
    expect(keyboardMode({ ...base, viewportHeight: 844 - 336 })).toBe('overlay');
  });

  it('Android の Chrome（resizes-content）: 窓が縮む → resize', () => {
    expect(keyboardMode({ ...base, layoutHeight: 500, viewportHeight: 500 })).toBe('resize');
  });

  it('入力の欄にフォーカスが無ければ出ていない（縮んでいても）', () => {
    expect(keyboardMode({ ...base, editing: false, viewportHeight: 500 })).toBeNull();
    expect(
      keyboardMode({ ...base, editing: false, layoutHeight: 500, viewportHeight: 500 }),
    ).toBeNull();
  });

  it('入力の補助の帯・アドレスバーくらいの縮み（下限未満）は数えない', () => {
    expect(keyboardMode({ ...base, viewportHeight: 844 - (KEYBOARD_MIN_PX - 1) })).toBeNull();
    expect(keyboardMode({ ...base, viewportHeight: 844 - KEYBOARD_MIN_PX })).toBe('overlay');
    expect(keyboardMode({ ...base, layoutHeight: 844 - 60, viewportHeight: 844 - 60 })).toBeNull();
  });

  it('PC（主の入力が指でない）では、窓の高さだけを縮めても・visualViewport が縮んでも付けない', () => {
    expect(
      keyboardMode({ ...base, coarse: false, layoutHeight: 500, viewportHeight: 500 }),
    ).toBeNull();
    expect(keyboardMode({ ...base, coarse: false, viewportHeight: 500 })).toBeNull();
  });

  it('拡大（ピンチ）の間は決めない', () => {
    expect(keyboardMode({ ...base, viewportHeight: 422, scale: 2 })).toBeNull();
  });
});

describe('nextBaseHeight', () => {
  it('編集している間は同じ幅の最大を保つ（キーボードで縮んだ高さを基準にしない）', () => {
    let b = nextBaseHeight(null, 390, 844, false);
    b = nextBaseHeight(b, 390, 500, true);
    expect(b).toEqual({ width: 390, height: 844 });
  });

  it('編集していない間に縮んだ高さは基準を下げる（画面の分割・窓を縮めた後に欄を押しても印を付けない）', () => {
    let b = nextBaseHeight(null, 390, 844, false);
    b = nextBaseHeight(b, 390, 600, false);
    expect(b).toEqual({ width: 390, height: 600 });
    b = nextBaseHeight(b, 390, 600, true);
    expect(
      keyboardMode({
        editing: true,
        coarse: true,
        layoutHeight: 600,
        baseHeight: b.height,
        viewportHeight: 600,
        scale: 1,
      }),
    ).toBeNull();
  });

  it('幅が変わったら測り直す（向きを変えた）', () => {
    const b = nextBaseHeight({ width: 390, height: 844 }, 844, 390, true);
    expect(b).toEqual({ width: 844, height: 390 });
  });
});

describe('shouldReveal', () => {
  const f1 = {};
  const f2 = {};
  it('印が無い・欄が無いときは寄せない', () => {
    expect(shouldReveal(null, { field: f1, mode: null, height: 844 })).toBe(false);
    expect(shouldReveal(null, { field: null, mode: 'resize', height: 420 })).toBe(false);
  });

  it('初めて・欄が替わった・印が替わった・高さが下限以上に変わったときだけ寄せる', () => {
    const a = { field: f1, mode: 'resize' as const, height: 420 };
    expect(shouldReveal(null, a)).toBe(true);
    expect(shouldReveal(a, { ...a, field: f2 })).toBe(true);
    expect(shouldReveal(a, { ...a, mode: 'overlay' })).toBe(true);
    expect(shouldReveal(a, { ...a, height: 420 - KEYBOARD_MIN_PX })).toBe(true);
  });

  it('アドレスバーの出入り（下限未満の高さの変化）では寄せ直さない（本人のスクロールと取り合わない）', () => {
    const a = { field: f1, mode: 'resize' as const, height: 420 };
    expect(shouldReveal(a, { ...a, height: 476 })).toBe(false);
    expect(shouldReveal(a, a)).toBe(false);
  });
});

describe('visibleSpan', () => {
  it('上の帯は上から、下の帯は下から削る', () => {
    const bar = { top: 390, bottom: 500 };
    expect(visibleSpan({ top: 0, bottom: 500 }, null, [APPBAR, bar])).toEqual({
      top: 95,
      bottom: 390,
    });
  });

  it('見えている領域に掛からない帯（キーボードの裏の帯）は数えない', () => {
    const behind = { top: 734, bottom: 844 };
    expect(visibleSpan({ top: 0, bottom: 508 }, null, [APPBAR, behind])).toEqual({
      top: 95,
      bottom: 508,
    });
  });

  it('スクロールの容器の枠と重ねる', () => {
    expect(visibleSpan({ top: 0, bottom: 508 }, { top: 300, bottom: 844 }, [])).toEqual({
      top: 300,
      bottom: 508,
    });
  });
});

describe('revealDelta', () => {
  it('余白 16px で入っていれば動かさない', () => {
    expect(revealDelta(LC, { top: 95, bottom: 478 + REVEAL_MARGIN_PX })).toBe(0);
  });

  it('下にはみ出す分だけ上へ寄せる（下に 16px の余白）', () => {
    expect(revealDelta(LC, { top: 95, bottom: 400 })).toBe(478 - (400 - 16));
  });

  it('上の帯の下に隠れたら下へ戻す', () => {
    expect(revealDelta({ top: 60, bottom: 108 }, { top: 95, bottom: 500 })).toBe(60 - (95 + 16));
  });

  it('範囲が欄より狭ければ欄の上の端をそろえる', () => {
    const tall = { top: 300, bottom: 600 }; // 一言の欄が伸びた
    expect(revealDelta(tall, { top: 95, bottom: 300 })).toBe(300 - 95);
  });
});

describe('planReveal', () => {
  const doc = (scrollTop: number, scrollMax: number, covers = [APPBAR]) => ({
    clip: null,
    covers,
    scrollTop,
    scrollMax,
  });

  it('Android（窓が 844 → 500）: LC を下の帯（判定の 1 行 + ［記録する］）の上へ寄せる', () => {
    const bar = { top: 390, bottom: 500 };
    const [d] = planReveal(LC, { top: 0, bottom: 500 }, [doc(0, 344, [APPBAR, bar])]);
    expect(d).toBe(478 - (390 - 16));
    const after = { top: LC.top - (d ?? 0), bottom: LC.bottom - (d ?? 0) };
    expect(after.bottom).toBeLessThanOrEqual(bar.top - 16);
    expect(after.top).toBeGreaterThanOrEqual(APPBAR.bottom);
  });

  it('iOS（visualViewport だけ 844 → 508。帯はキーボードの裏）: 余白を足した文書をスクロールして LC を見える範囲へ', () => {
    // 下の ［振り返る］ の欄（一言）が見える範囲の下の端より下
    const note = { top: 520, bottom: 568 };
    const behind = { top: 734, bottom: 844 };
    // 余白（60lvh ≒ 506px）を足したので文書はスクロールできる
    const [d] = planReveal(note, { top: 0, bottom: 508 }, [doc(0, 506, [APPBAR, behind])]);
    expect(d).toBe(568 - (508 - 16));
    // 余白が無い（1 画面でスクロールできない）と寄せられない = 足す理由
    expect(planReveal(note, { top: 0, bottom: 508 }, [doc(0, 0, [APPBAR, behind])])).toEqual([0]);
  });

  it('iOS で Safari が自分で visualViewport を動かした後（offsetTop > 0）も、見えている領域の座標で決める', () => {
    const view = { top: 200, bottom: 708 };
    // 欄は見えている → 動かさない
    expect(planReveal({ top: 600, bottom: 648 }, view, [doc(0, 506)])).toEqual([0]);
  });

  it('下のシートの中: 内側（シートの本文）だけを動かし、動かせる範囲に収める', () => {
    const body = { clip: { top: 300, bottom: 844 }, covers: [], scrollTop: 0, scrollMax: 120 };
    const field = { top: 700, bottom: 748 };
    const [d] = planReveal(field, { top: 0, bottom: 508 }, [body]);
    expect(d).toBe(120);
  });

  it('内側で足りない分を外側の文書で動かす', () => {
    const inner = { clip: { top: 95, bottom: 844 }, covers: [], scrollTop: 0, scrollMax: 50 };
    const field = { top: 600, bottom: 648 };
    const out = planReveal(field, { top: 0, bottom: 500 }, [inner, doc(0, 400)]);
    expect(out).toEqual([50, 648 - 50 - (500 - 16)]);
  });

  it('上へ戻すときも今の位置より上へは行かない', () => {
    expect(planReveal({ top: 60, bottom: 108 }, { top: 0, bottom: 844 }, [doc(5, 300)])).toEqual([
      -5,
    ]);
  });
});

describe('isTextEntry', () => {
  it('文字を入れる欄だけ', () => {
    expect(isTextEntry('INPUT', 'text', false)).toBe(true);
    expect(isTextEntry('INPUT', null, false)).toBe(true);
    expect(isTextEntry('INPUT', 'number', false)).toBe(true);
    expect(isTextEntry('INPUT', 'datetime-local', false)).toBe(true);
    expect(isTextEntry('TEXTAREA', null, false)).toBe(true);
    expect(isTextEntry('SELECT', null, false)).toBe(true);
    expect(isTextEntry('DIV', null, true)).toBe(true);
    expect(isTextEntry('INPUT', 'radio', false)).toBe(false);
    expect(isTextEntry('INPUT', 'checkbox', false)).toBe(false);
    expect(isTextEntry('INPUT', 'file', false)).toBe(false);
    expect(isTextEntry('BUTTON', null, false)).toBe(false);
  });
});

describe('isEnterCommit', () => {
  it('決定キーだけ。日本語の変換の確定は数えない', () => {
    expect(isEnterCommit('Enter', false, 13)).toBe(true);
    expect(isEnterCommit('Enter', true, 13)).toBe(false);
    expect(isEnterCommit('Enter', false, 229)).toBe(false);
    expect(isEnterCommit('Tab', false, 9)).toBe(false);
  });
});

describe('キーボードが上がる間の寄せ直し（#172。オーナー「ソフトキーがズルっと上がってきたら…みえるいちまですくろーる」）', () => {
  it('落ち着く間は高さの小さな変化でも寄せ直す。落ち着いた後は寄せ直さない', () => {
    const a = { field: {}, mode: 'resize' as const, height: 600 };
    const b = { ...a, height: 560 };
    expect(shouldReveal(a, b, true)).toBe(true);
    expect(shouldReveal(a, b, false)).toBe(false);
    expect(shouldReveal(a, { ...b, mode: null }, true)).toBe(false);
  });

  it('落ち着く間: フォーカスで始まり、その間の resize・scroll で延び、過ぎた後の resize では始まらない', () => {
    let u = nextSettleUntil(0, 1000, 'focus');
    expect(u).toBe(1000 + SETTLE_MS);
    u = nextSettleUntil(u, 1000 + SETTLE_MS - 10, 'event');
    expect(u).toBe(1000 + SETTLE_MS - 10 + SETTLE_EXTEND_MS);
    expect(nextSettleUntil(u, u + 1, 'event')).toBe(u);
  });

  it('resize が 3 回続けて来る（Android: 844 → 700 → 560 → 420）: 各回で寄せ直し、最後の見える高さで欄の下に 16px 以上の余白', () => {
    // 文書の中の欄の位置（上から 600〜648px）。上の帯 0〜95 は貼り付き。帯は隠れている
    const fieldInDoc = { top: 600, bottom: 648 };
    const docHeight = 1100;
    let scrollTop = 0;
    let prev: { field: unknown; mode: 'resize'; height: number } | null = null;
    for (const h of [700, 560, 420]) {
      const next = { field: fieldInDoc, mode: 'resize' as const, height: h };
      expect(shouldReveal(prev, next, true)).toBe(true);
      prev = next;
      const field = { top: fieldInDoc.top - scrollTop, bottom: fieldInDoc.bottom - scrollTop };
      const [d] = planReveal(field, { top: 0, bottom: h }, [
        { clip: null, covers: [APPBAR], scrollTop, scrollMax: docHeight - h },
      ]);
      scrollTop += d ?? 0;
      const after = { top: fieldInDoc.top - scrollTop, bottom: fieldInDoc.bottom - scrollTop };
      expect(after.top).toBeGreaterThanOrEqual(APPBAR.bottom + REVEAL_MARGIN_PX);
      expect(h - after.bottom).toBeGreaterThanOrEqual(REVEAL_MARGIN_PX);
    }
    expect(scrollTop).toBe(648 - (420 - 16));
  });

  it('iOS: visualViewport の resize が何回か来る（844 → 600 → 508 → 508）: 見えていれば動かさない（がたつかない）', () => {
    const fieldInDoc = { top: 480, bottom: 528 };
    let scrollTop = 0;
    const moves: number[] = [];
    for (const h of [600, 508, 508]) {
      const field = { top: fieldInDoc.top - scrollTop, bottom: fieldInDoc.bottom - scrollTop };
      const [d] = planReveal(field, { top: 0, bottom: h }, [
        { clip: null, covers: [APPBAR], scrollTop, scrollMax: 506 },
      ]);
      moves.push(d ?? 0);
      scrollTop += d ?? 0;
    }
    // 600 では見えている（0）、508 で 1 回だけ寄せ、同じ高さの 3 回目は動かさない
    expect(moves).toEqual([0, 528 - (508 - 16), 0]);
  });
});

describe('submitAllowed（#183: キーボードの間の送信）', () => {
  it('印が無ければ、押し始めが無くても送る（帯が下の端に貼り付いている間の Enter・クリック）', () => {
    expect(submitAllowed(false, null, 10_000)).toBe(true);
  });

  it('印の間は、送るボタンを押し始めてから SUBMIT_PRESS_MS 以内の送信だけを通す。欄の Enter の暗黙の送信（押し始めなし）は止める', () => {
    expect(submitAllowed(true, null, 10_000)).toBe(false);
    expect(submitAllowed(true, 10_000, 10_120)).toBe(true);
    expect(submitAllowed(true, 10_000, 10_000 + SUBMIT_PRESS_MS)).toBe(true);
    expect(submitAllowed(true, 10_000, 10_001 + SUBMIT_PRESS_MS)).toBe(false);
    // 時計が戻った（押し始めが未来）なら通さない
    expect(submitAllowed(true, 10_000, 9_000)).toBe(false);
  });
});
