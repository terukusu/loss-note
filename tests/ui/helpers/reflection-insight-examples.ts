// Issue #221 の例の表（E1〜E9）の保存した取引。値はすべて架空（実際の記録を写さない）。
// 共通は insight-examples.ts の tagged と同じ（R = (決済 − イン) ÷ 0.5。決済は期間 = 7 日の中）。Good / More は最上位の reflection

import type { StoredTrade } from '../../../core/record';
import type { Reflection, ReflectionTopicId } from '../../../core/reflection';
import { tagged } from './insight-examples';

type Kind = Parameters<typeof tagged>[2];

export interface Sides {
  readonly good?: readonly ReflectionTopicId[];
  readonly more?: readonly ReflectionTopicId[];
  readonly goodNotes?: readonly string[];
  readonly moreNotes?: readonly string[];
}

/** 判定の作り方は tagged と同じ。Good / More が両側とも空なら鍵を持たない（API の応答と同じ形） */
export function reflected(
  id: string,
  day: number,
  kind: Kind,
  r: number,
  s: Sides,
  opts: Parameters<typeof tagged>[5] = {},
): StoredTrade {
  const t = tagged(id, day, kind, r, [], opts);
  const reflection: Reflection = {
    good: { topics: s.good ?? [], notes: s.goodNotes ?? [] },
    more: { topics: s.more ?? [], notes: s.moreNotes ?? [] },
  };
  const n = [s.good, s.more, s.goodNotes, s.moreNotes].reduce((a, v) => a + (v?.length ?? 0), 0);
  return n === 0 ? t : { ...t, reflection };
}

/** E1 の期間の取引（X1 は消した印を付ける側・I1 は取り込み）。決済は T1 が最も古く、T11 が最も新しい */
export const R1: readonly StoredTrade[] = [
  reflected('t1', 0, 'A', -1.0, { good: ['cutEarly', 'followedRules'] }),
  reflected('t2', 0, 'B', -1.6, { more: ['enteredEarly', 'oversized'] }),
  reflected('t3', 1, 'B', -2.0, { more: ['oversized'] }),
  reflected('t4', 1, 'C', -2.0, { more: ['oversized', 'noExitPlan'] }),
  reflected('t5', 2, 'riskyWin', 1.0, { more: ['oversized'] }),
  reflected('t6', 2, 'B', -1.2, {
    more: ['oversized'],
    moreNotes: ['入る前に数量を 1R から逆算する', '同じ日に 2 回目は入らない'],
  }),
  reflected('t7', 3, 'A', -1.0, { good: ['cutEarly', 'followedRules'] }),
  reflected('t8', 3, 'safeWin', 2.0, { good: ['followedRules', 'letProfitRun'] }),
  reflected('t9', 4, 'A', -0.9, {
    good: ['cutEarly', 'followedRules'],
    goodNotes: ['前提が崩れたので LC の前に決済した'],
  }),
  reflected('t10', 4, 'A', -1.0, {}),
  reflected('t11', 5, 'safeWin', 1.5, { good: ['followedRules'] }),
  reflected('x1', 5, 'B', -3.0, { more: ['oversized'] }),
  reflected('i1', 6, 'B', -1.5, { more: ['oversized'] }, { source: 'import' }),
];

/** E1 で消した印（[元に戻す] を待っている） */
export const R1_HIDDEN: ReadonlySet<string> = new Set(['x1']);

/** E4: More に話題 1 つずつ（数量が多すぎた 2 件・LC が近すぎた 1 件） */
export const R4: readonly StoredTrade[] = [
  reflected('a1', 0, 'B', -1.4, { more: ['oversized'] }),
  reflected('a2', 1, 'A', -1.0, { more: ['lcTooTight'] }),
  reflected('a3', 2, 'A', -1.0, { more: ['oversized'] }),
];

/** E6: More だけ付いていて Good が無い */
export const R6: readonly StoredTrade[] = [
  reflected('m1', 0, 'B', -1.4, { more: ['oversized'] }),
  reflected('m2', 1, 'A', -1.0, {}),
];
