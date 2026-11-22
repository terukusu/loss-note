// Issue #185 の例 B（連勝の後）の保存した取引。値はすべて架空（実際の記録を写さない）。
// 形は insight-examples.ts の tagged() と同じ（US30・円建て・L・イン 100.00・LC 99.50・数量 10,000。R = (決済 − 100) ÷ 0.5）。
// 決済は期間（7 日 = 2026-11-13〜11-19）の中で、並びの順に 1 分ずつずらす（O1 だけ期間の外の 11/10）
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { StoredTrade } from '../../../core/record';
import { tagged } from './insight-examples';
import { exitAt } from './review-examples';

type Kind = Parameters<typeof tagged>[2];

/** 並びの k 番目（0 始まり）の決済の時刻 */
const at = (k: number) => exitAt(1) + k * 60_000;

/** 並び → 取引（ID = 接頭辞 + 1 始まりの番号。over の番号に「調子に乗った」） */
export function sequence(
  prefix: string,
  kinds: readonly (readonly [Kind, number])[],
  over: readonly number[] = [],
): StoredTrade[] {
  return kinds.map(([kind, r], k) =>
    tagged(`${prefix}${k + 1}`, 0, kind, r, over.includes(k + 1) ? ['overconfident'] : [], {
      exitTime: at(k),
    }),
  );
}

const tag = (
  id: string,
  k: number,
  kind: Kind,
  r: number,
  tags: readonly EmotionTagId[] = [],
  source: 'manual' | 'import' = 'manual',
) => tagged(id, 0, kind, r, tags, { exitTime: at(k), source });

/**
 * 例 B の S の期間: O1（期間の外）· S1 W · S2 危ない勝ち · D1 B（消した印）· S3 B · S4 W · S5 W · S6 B · S7 A · S8 C ·
 * S9 W · I1 W（取り込み）· S10 A
 */
export const B: readonly StoredTrade[] = [
  tagged('o1', -3, 'safeWin', 1.0, []),
  tag('s1', 1, 'safeWin', 1.0, ['calm']),
  tag('s2', 2, 'riskyWin', 1.0),
  tag('d1', 3, 'B', -1.2),
  tag('s3', 4, 'B', -1.6, ['overconfident']),
  tag('s4', 5, 'safeWin', 1.0),
  tag('s5', 6, 'safeWin', 1.0, ['overconfident']),
  tag('s6', 7, 'B', -2.0, ['wantPosition', 'overconfident']),
  tag('s7', 8, 'A', -1.0, ['calm']),
  tag('s8', 9, 'C', -2.0, ['hope']),
  tag('s9', 10, 'safeWin', 1.0),
  tag('i1', 11, 'safeWin', 1.0, [], 'import'),
  tag('s10', 12, 'A', -1.0, ['overconfident']),
];
export const B_HIDDEN: ReadonlySet<string> = new Set(['d1']);

const W = ['safeWin', 1.0] as const;

/** B3: W W B(−1.5R) W W A W W B(−2.0R) W W A W W A(−0.8R)。3・9 件目に「調子に乗った」 */
export const B3 = sequence(
  'x',
  [W, W, ['B', -1.5], W, W, ['A', -1.0], W, W, ['B', -2.0], W, W, ['A', -1.0], W, W, ['A', -0.8]],
  [3, 9],
);
/** B4: W W W W（タグなし） */
export const B4 = sequence('y', [W, W, W, W]);
/** B5: W A W 判定なし W W。5 件目に「調子に乗った」 */
export const B5 = sequence('z', [W, ['A', -1.0], W, ['none', -1.0], W, W], [5]);
