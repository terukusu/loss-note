// 判定のバッジの表示の形（Issue #3 R2・契約 C-2。設計書 5.3・5.4・9.1）。
// 色は損益ではなく規律を表す: 計画どおり（A・計画どおりの勝ち）/ 崩れ（B・危ない勝ち）/ 極悪（C）/ 中立（判定なし）。
// ラベルの文字・段ごとに形の違う記号・段の色の 3 つで表し、色だけに頼らない
import type { Grade } from '../../../core/judge';

export type Tier = 'plan' | 'break' | 'worst' | 'neutral';
export const TIERS: readonly Tier[] = ['plan', 'break', 'worst', 'neutral'];

/** 段の記号（Icon の形の名前）。計画どおり = 丸、崩れ = 三角、極悪 = バツ、中立 = 横線 */
export type TierSymbol = 'circle' | 'triangle' | 'cross' | 'dash';
export const TIER_SYMBOL: Readonly<Record<Tier, TierSymbol>> = {
  plan: 'circle',
  break: 'triangle',
  worst: 'cross',
  neutral: 'dash',
};

/** 段の読み上げ・説明の名前 */
export const TIER_NAME: Readonly<Record<Tier, string>> = {
  plan: '計画どおり',
  break: '崩れ',
  worst: '極悪',
  neutral: '中立',
};

const BY_GRADE: Readonly<Record<Grade, { label: string; tier: Tier }>> = {
  A: { label: 'A いい損失', tier: 'plan' },
  safeWin: { label: '計画どおりの勝ち', tier: 'plan' },
  B: { label: 'B 悪い損失', tier: 'break' },
  riskyWin: { label: '危ない勝ち', tier: 'break' },
  C: { label: 'C 極悪な損失', tier: 'worst' },
};

export interface BadgeModel {
  readonly label: string;
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  readonly className: string;
}

export function badgeModel(grade: Grade | null): BadgeModel {
  const { label, tier } =
    grade === null ? { label: '判定なし', tier: 'neutral' as const } : BY_GRADE[grade];
  return { label, tier, symbol: TIER_SYMBOL[tier], className: `badge badge--${tier}` };
}
