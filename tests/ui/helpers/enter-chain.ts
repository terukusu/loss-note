// シートの欄の並びの決定キー（#174。ui/src/lib/enter-chain.ts）を、部品の木の input の props に偽のキーを渡して確かめる。
// DOM のライブラリを使わない（部品は hook を持たない）
import { expect } from 'vitest';

interface InputEl {
  readonly type: string;
  readonly props: Record<string, unknown>;
}

export interface EnterResult {
  /** focus された欄の ID */
  readonly focused: readonly string[];
  /** blur された回数 */
  readonly blurred: number;
  /** 既定の動き（フォームの暗黙の送信）を止めたか */
  readonly prevented: boolean;
}

/** 欄の onKeyDown に Enter（over で isComposing・keyCode を替える）を渡す。onKeyDown が無ければ何もしない */
export function pressEnter(el: InputEl, over: Record<string, unknown> = {}): EnterResult {
  const focused: string[] = [];
  let blurred = 0;
  let prevented = false;
  const doc = {
    getElementById: (id: string) => ({
      focus: () => {
        focused.push(id);
      },
    }),
  };
  const onKeyDown = el.props.onKeyDown as ((e: unknown) => void) | undefined;
  onKeyDown?.({
    key: 'Enter',
    keyCode: 13,
    isComposing: false,
    currentTarget: {
      readOnly: false,
      ownerDocument: doc,
      blur: () => {
        blurred++;
      },
    },
    preventDefault: () => {
      prevented = true;
    },
    ...over,
  });
  return { focused, blurred, prevented };
}

/**
 * 並び（ids の順）を確かめる: 途中の欄は「次へ」で Enter が次の欄へ focus、最後の欄は「完了」で Enter が blur（focus しない）。
 * どの欄も Enter で既定の動き（フォームの送信）を止める。変換の確定の Enter（isComposing・keyCode 229）は何もしない
 */
export function checkChain(
  find: (id: string) => InputEl | undefined,
  ids: readonly string[],
): void {
  ids.forEach((id, i) => {
    const el = find(id);
    if (!el) throw new Error(`欄が無い: ${id}`);
    expect(el.type, id).toBe('input');
    const next = ids[i + 1];
    expect(el.props.enterKeyHint, id).toBe(next === undefined ? 'done' : 'next');
    const r = pressEnter(el);
    expect(r, id).toEqual(
      next === undefined
        ? { focused: [], blurred: 1, prevented: true }
        : { focused: [next], blurred: 0, prevented: true },
    );
    for (const over of [{ isComposing: true }, { keyCode: 229 }])
      expect(pressEnter(el, over), `${id} 変換中`).toEqual({
        focused: [],
        blurred: 0,
        prevented: false,
      });
  });
}
