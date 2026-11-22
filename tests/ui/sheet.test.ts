// 下のシートの部品の規則（Issue #129。docs/ui-guidelines.md 9.3・9.7）。閉じ方・close watcher・フォーカスを戻すか・
// 積み重ねとトーストの時間の止め・外を押したかの純関数と、殻の積み重ねの記録
import { describe, expect, it } from 'vitest';
import {
  isBackdropHit,
  layerPlan,
  SHEET_EMPTY,
  type SheetDismiss,
  sheetCancel,
  sheetCloseEvent,
  sheetDismiss,
  sheetEscapeKey,
  sheetReturnFocus,
  sheetStackNext,
} from '../../ui/src/lib/sheet';
import { createSheetsHost } from '../../ui/src/lib/sheets-context';

describe('sheetCancel（dialog の cancel = Esc・Android の戻るの close watcher）', () => {
  it('取り消せる cancel は自分で扱う（preventDefault して Esc と同じ）', () => {
    expect(sheetCancel(true)).toBe('handle');
  });
  it('取り消せない cancel（操作なしの 2 回目の戻る）はブラウザに閉じさせ、close で UI の閉じと同じに扱う', () => {
    expect(sheetCancel(false)).toBe('native');
  });
});

describe('sheetDismiss（閉じるか、1 つ前へ戻るか）', () => {
  const reasons: SheetDismiss[] = ['button', 'escape', 'backdrop', 'back', 'native'];
  it('中で 1 段もたどっていなければ、どの閉じ方でも閉じる', () => {
    for (const r of reasons) expect(sheetDismiss(r, 0)).toBe('close');
  });
  it('たどった後: Esc（取り消せる close watcher を含む）は 1 つ前へ。✕・外・取り消せない close はシートごと閉じる', () => {
    expect(sheetDismiss('escape', 2)).toBe('up');
    expect(sheetDismiss('button', 2)).toBe('close');
    expect(sheetDismiss('backdrop', 1)).toBe('close');
    expect(sheetDismiss('native', 3)).toBe('close');
  });
  it('戻る（popstate）はシート自身の段から下りたとき = シートごと閉じる（たどった段は段ごとの層を糊が閉じる）', () => {
    expect(sheetDismiss('back', 0)).toBe('close');
    expect(sheetDismiss('back', 1)).toBe('close');
  });
  it('測れない段数（負・非有限）は閉じる', () => {
    expect(sheetDismiss('escape', -1)).toBe('close');
    expect(sheetDismiss('escape', Number.NaN)).toBe('close');
  });
});

describe('sheetReturnFocus（閉じたら開いたボタンへフォーカスを戻すか）', () => {
  it('開いたボタンがまだあり、フォーカスがシートの中か body に落ちていれば戻す', () => {
    expect(sheetReturnFocus({ openerConnected: true, focus: 'inside' })).toBe(true);
    expect(sheetReturnFocus({ openerConnected: true, focus: 'body' })).toBe(true);
  });
  it('画面が移って開いたボタンが外れた・ほかの要素へ移した後は戻さない', () => {
    expect(sheetReturnFocus({ openerConnected: false, focus: 'inside' })).toBe(false);
    expect(sheetReturnFocus({ openerConnected: true, focus: 'outside' })).toBe(false);
  });
});

describe('sheetStackNext（積み重ねとトーストの時間）', () => {
  it('0 → 1 で止め、1 → 0 で動かす。間の開閉では何もしない', () => {
    let s = sheetStackNext(SHEET_EMPTY, { type: 'open', id: 'a' });
    expect(s).toEqual({ stack: ['a'], hold: 'hold' });
    s = sheetStackNext(s.stack, { type: 'open', id: 'b' });
    expect(s).toEqual({ stack: ['a', 'b'], hold: null });
    s = sheetStackNext(s.stack, { type: 'close', id: 'b' });
    expect(s).toEqual({ stack: ['a'], hold: null });
    s = sheetStackNext(s.stack, { type: 'close', id: 'a' });
    expect(s).toEqual({ stack: [], hold: 'resume' });
  });
  it('同じ ID の二重の開き・開いていない ID の閉じは何もしない', () => {
    const s = sheetStackNext(['a'], { type: 'open', id: 'a' });
    expect(s).toEqual({ stack: ['a'], hold: null });
    expect(sheetStackNext(['a'], { type: 'close', id: 'x' })).toEqual({
      stack: ['a'],
      hold: null,
    });
    expect(sheetStackNext([], { type: 'close', id: 'x' })).toEqual({ stack: [], hold: null });
  });
  it('性質: どの順に開閉しても hold と resume は交互で、すべて閉じた後は空・最後は resume', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      let stack: readonly string[] = SHEET_EMPTY;
      const holds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = String.fromCharCode(97 + Math.floor(rnd() * 4));
        const r = sheetStackNext(stack, { type: rnd() < 0.5 ? 'open' : 'close', id });
        stack = r.stack;
        if (r.hold) holds.push(r.hold);
        expect(new Set(stack).size).toBe(stack.length);
      }
      for (const id of [...stack]) {
        const r = sheetStackNext(stack, { type: 'close', id });
        stack = r.stack;
        if (r.hold) holds.push(r.hold);
      }
      expect(stack).toEqual([]);
      holds.forEach((h, i) => {
        expect(h).toBe(i % 2 === 0 ? 'hold' : 'resume');
      });
      if (holds.length > 0) expect(holds.at(-1)).toBe('resume');
    }
  });
});

describe('isBackdropHit（後ろの暗い面を押した）', () => {
  const dialog = { id: 'dialog' };
  const inner = { id: 'inner' };
  it('押し始めと離した所がどちらも dialog そのもの（中身の外 = ::backdrop）なら外', () => {
    expect(isBackdropHit(dialog, dialog, dialog)).toBe(true);
  });
  it('中身の中で押した・中身から外へ引いて離した・外から中へ引いた は外ではない', () => {
    expect(isBackdropHit(inner, inner, dialog)).toBe(false);
    expect(isBackdropHit(inner, dialog, dialog)).toBe(false);
    expect(isBackdropHit(dialog, inner, dialog)).toBe(false);
    expect(isBackdropHit(null, dialog, dialog)).toBe(false);
  });
});

describe('createSheetsHost（殻の積み重ねの記録 → トーストの時間）', () => {
  it('1 つ目が開くと onHold、すべて閉じると onResume が 1 回ずつ', () => {
    const log: string[] = [];
    const host = createSheetsHost({
      onHold: () => log.push('hold'),
      onResume: () => log.push('resume'),
    });
    host.opened('info');
    host.opened('fields');
    expect(host.count()).toBe(2);
    host.closed('info');
    host.closed('info');
    host.closed('fields');
    expect(log).toEqual(['hold', 'resume']);
    expect(host.count()).toBe(0);
  });
});

describe('sheetEscapeKey（#129 のレビュー N1: Esc の keydown を自分で扱う）', () => {
  it('Escape だけを扱う。変換中・ほかが扱った keydown は見ない', () => {
    expect(sheetEscapeKey({ key: 'Escape' })).toBe(true);
    expect(sheetEscapeKey({ key: 'Escape', isComposing: true })).toBe(false);
    // 変換中に来る keyCode 229 も変換中（#175。isEnterCommit と同じ判定）
    expect(sheetEscapeKey({ key: 'Escape', keyCode: 229 })).toBe(false);
    expect(sheetEscapeKey({ key: 'Escape', isComposing: false, keyCode: 27 })).toBe(true);
    expect(sheetEscapeKey({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(sheetEscapeKey({ key: 'Enter' })).toBe(false);
    expect(sheetEscapeKey({ key: 'Esc' })).toBe(false);
  });
  it('続けて押しても毎回 escape として扱う → たどった段は 1 つずつ前へ、0 段で閉じる（close watcher の 2 回目に頼らない）', () => {
    let depth = 2;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (!sheetEscapeKey({ key: 'Escape' })) continue;
      const a = sheetDismiss('escape', depth);
      seen.push(a);
      if (a === 'up') depth--;
    }
    expect(seen).toEqual(['up', 'up', 'close']);
  });
});

describe('layerPlan（段ごとの層の数合わせ。#129 のレビュー N5）', () => {
  it('足りない段を下から積み、多い段を上から外す', () => {
    expect(layerPlan(0, 3)).toEqual({ open: [1, 2, 3], close: [] });
    expect(layerPlan(3, 1)).toEqual({ open: [], close: [3, 2] });
    expect(layerPlan(2, 2)).toEqual({ open: [], close: [] });
    expect(layerPlan(2, 0)).toEqual({ open: [], close: [2, 1] });
  });
  it('測れない値は 0 段とみなす', () => {
    expect(layerPlan(-1, 2)).toEqual({ open: [1, 2], close: [] });
    expect(layerPlan(2, Number.NaN)).toEqual({ open: [], close: [2, 1] });
  });
  it('性質: 偽の層の記録で、どの順に数を変えても積んだ段は 1..want のちょうど want 個', () => {
    const live = new Set<number>();
    let layered = 0;
    for (const want of [3, 1, 4, 0, 2, 2, 5, 0]) {
      const p = layerPlan(layered, want);
      for (const k of p.open) live.add(k);
      for (const k of p.close) live.delete(k);
      layered = want;
      expect([...live].sort()).toEqual(Array.from({ length: want }, (_, i) => i + 1));
    }
  });
});

describe('sheetCloseEvent（遅れて届く dialog の close。#131）', () => {
  it('こちらが呼んだ close がまだ届いていない・もう閉じた（open = false）シートの close は無視し、開いているシートに届いた頼んでいない close だけ native', () => {
    expect(sheetCloseEvent(1, true)).toBe('ignore');
    expect(sheetCloseEvent(0, false)).toBe('ignore');
    expect(sheetCloseEvent(2, false)).toBe('ignore');
    expect(sheetCloseEvent(0, true)).toBe('native');
  });

  it('閉じてすぐ開き直した（own 1・open true）: 遅れて届いた前の close で開き直したシートを閉じない（#131 のレビュー N7）', () => {
    expect(sheetCloseEvent(1, true)).toBe('ignore');
  });
});
