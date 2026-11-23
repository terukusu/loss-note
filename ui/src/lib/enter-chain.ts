// シートの中の続けて入れる欄の並びの決定キー（#174。ui-guidelines 10.1「決定キー」）。
// 並びは部品が欄の ID の配列で宣言する（表示しない欄は false / null で渡し、並びから落とす）。途中の欄は「次へ」（next）で
// 並びの次の欄へフォーカスを移し、最後の欄は「完了」（done）でフォーカスを外してキーボードを閉じる。どちらも保存を送らない。
// 選ぶ欄（Segment・select・押す形のトグル）と日時の欄は並びに入れない（キーボードを出さない欄。日時の欄は ENTER_DONE）。
// 変換の確定の Enter を除くのは NumberField・TextField（isEnterCommit）。ここは DOM を読まず、onEnter の中で渡された欄から
// 次の欄を探して focus / blur するだけ

export type EnterKeyHint = 'next' | 'done';

export interface EnterStep {
  readonly hint: EnterKeyHint;
  /** 次の欄の ID（最後の欄は null） */
  readonly next: string | null;
}

/** 並び（表示しない欄は偽）→ 欄の ID ごとの決定キー。同じ ID が 2 度出たら最初の位置を使う */
export function enterChain(
  ids: readonly (string | false | null | undefined)[],
): ReadonlyMap<string, EnterStep> {
  const shown = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  const order = shown.filter((id, i) => shown.indexOf(id) === i);
  const out = new Map<string, EnterStep>();
  order.forEach((id, i) => {
    const next = order[i + 1] ?? null;
    out.set(id, { hint: next === null ? 'done' : 'next', next });
  });
  return out;
}

/** NumberField・TextField に渡す決定キー（focus / blur だけを持つ欄の最小の形） */
export interface EnterTarget {
  readonly ownerDocument: { getElementById(id: string): { focus(): void } | null };
  blur(): void;
}

export interface EnterProps {
  readonly enterKeyHint: EnterKeyHint;
  readonly onEnter: (input: EnterTarget) => void;
}

/** 決定キーで何もせずフォーカスを外す（最後の欄・日時の欄） */
export const ENTER_DONE: EnterProps = { enterKeyHint: 'done', onEnter: (el) => el.blur() };

/**
 * 並びの欄の決定キー。並びに無い ID は {}（端末の既定のまま）。次の欄が見つからない（描き替わって消えた）ときは外す
 */
export function enterPropsOf(
  chain: ReadonlyMap<string, EnterStep>,
  id: string,
): EnterProps | Record<string, never> {
  const step = chain.get(id);
  if (!step) return {};
  const next = step.next;
  if (next === null) return ENTER_DONE;
  return {
    enterKeyHint: 'next',
    onEnter: (el) => {
      const target = el.ownerDocument.getElementById(next);
      if (target) target.focus();
      else el.blur();
    },
  };
}
