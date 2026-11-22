// Issue #162 の例の表（E1〜E8）の保存した取引。値はすべて架空（実際の記録を写さない）。
// 共通は review-examples.ts と同じ: 銘柄 US30、円建て、資金 1,000,000 円、L、イン 100.00、LC 99.50（幅 0.5）、数量 10,000。
// R = (決済 − イン) ÷ 0.5。決済は 2026-11-13〜11-19 の 10:00（端末の時間帯。期間 = 7 日の中）
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { StoredTrade } from '../../../core/record';
import { exitAt } from './review-examples';
import { stored } from './trade-examples';

type Over = Parameters<typeof stored>[1];
type Kind = 'A' | 'safeWin' | 'B' | 'riskyWin' | 'C' | 'none';

/** 判定の作り方: A / 計画どおりの勝ち = そのまま、B = LC を広げた、危ない勝ち = 時間足を長い足へ、C = LC なし、none = LC がインより上（検査を通らない） */
function overOf(kind: Kind, exitPrice: number): Over {
  switch (kind) {
    case 'B':
      return { lcMove: { kind: 'widened', after: Math.min(99.5, exitPrice) } };
    case 'riskyWin':
      return { timeframeChange: 'longer' };
    case 'C':
      return { lc: undefined, lcDecidedBeforeEntry: false };
    case 'none':
      return { lc: 100.5 };
    default:
      return {};
  }
}

/** R → 決済の価格（R × 0.5 + 100） */
const priceOf = (r: number) => Math.round((100 + r * 0.5) * 1e6) / 1e6;

export function tagged(
  id: string,
  day: number,
  kind: Kind,
  r: number,
  tags: readonly EmotionTagId[],
  opts: { readonly source?: 'manual' | 'import'; readonly exitTime?: number } = {},
): StoredTrade {
  const price = priceOf(r);
  const n = Number(id.replace(/\D/g, '')) || 0;
  return stored(
    id,
    {
      source: opts.source ?? 'manual',
      exit: {
        time: opts.exitTime ?? exitAt(day),
        price,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      statementPnlYen: Math.round((price - 100) * 10_000),
      ...overOf(kind, price),
    },
    {
      createdAt: 1_763_000_000_000 + n,
      ...(tags.length > 0 ? { emotionTags: [...tags] } : {}),
    },
  );
}

/** E1 の期間の取引（T12 は消した印を付ける側・T13 は期間の外・I1・I2 は取り込み） */
export const E1: readonly StoredTrade[] = [
  tagged('t1', 0, 'A', -1.0, ['calm']),
  tagged('t2', 0, 'A', -0.9, ['calm']),
  tagged('t3', 1, 'safeWin', 2.0, ['calm']),
  tagged('t4', 1, 'A', -1.0, ['calm']),
  tagged('t5', 2, 'safeWin', 1.5, ['calm']),
  tagged('t6', 2, 'B', -1.6, ['recoup', 'wantPosition']),
  tagged('t7', 3, 'B', -2.0, ['recoup']),
  tagged('t8', 3, 'riskyWin', 1.0, ['recoup', 'overconfident']),
  tagged('t9', 4, 'C', -2.0, ['recoup', 'cantCut']),
  tagged('t10', 4, 'A', -1.0, []),
  tagged('t11', 5, 'B', -1.2, ['recoup', 'wantProfit']),
  tagged('t12', 5, 'B', -3.0, ['recoup']),
  // 期間（11/13〜11/19）の外: 11/10
  tagged('t13', -3, 'B', -2.0, ['recoup']),
  tagged('i1', 6, 'B', -1.5, ['recoup'], { source: 'import' }),
  tagged('i2', 6, 'A', -1.0, ['calm'], { source: 'import' }),
];

/** E1 で消した印（[元に戻す] を待っている） */
export const E1_HIDDEN: ReadonlySet<string> = new Set(['t12']);

/** E3: 怖い 5 件（A −1.0R 2・B −1.4R・計画どおりの勝ち +1.0R・判定の出ない 1） */
export const E3: readonly StoredTrade[] = [
  tagged('f1', 0, 'A', -1.0, ['fear']),
  tagged('f2', 1, 'A', -1.0, ['fear']),
  tagged('f3', 2, 'B', -1.4, ['fear']),
  tagged('f4', 3, 'safeWin', 1.0, ['fear']),
  tagged('f5', 4, 'none', -1.0, ['fear']),
];

/** E4: 祈り 5 件（A −1.0R 4・C（LC 無し・R が出ない）1） */
export const E4: readonly StoredTrade[] = [
  tagged('h1', 0, 'A', -1.0, ['hope']),
  tagged('h2', 1, 'A', -1.0, ['hope']),
  tagged('h3', 2, 'A', -1.0, ['hope']),
  tagged('h4', 3, 'A', -1.0, ['hope']),
  tagged('h5', 4, 'C', -2.0, ['hope']),
];

/** E5: タグの無い 3 件 */
export const E5: readonly StoredTrade[] = [
  tagged('n1', 0, 'A', -1.0, []),
  tagged('n2', 1, 'B', -1.4, []),
  tagged('n3', 2, 'safeWin', 1.5, []),
];

/** E6: 取り込みだけ（どれもタグつき） */
export const E6: readonly StoredTrade[] = [
  tagged('m1', 0, 'A', -1.0, ['calm'], { source: 'import' }),
  tagged('m2', 1, 'B', -1.5, ['recoup'], { source: 'import' }),
];

/** E8: 1 件に 1 つずつ（平常心 5・悔しい 2） */
export const E8: readonly StoredTrade[] = [
  ...[0, 1, 2, 3, 4].map((i) => tagged(`c${i + 1}`, i, 'A', -1.0, ['calm'])),
  tagged('g1', 5, 'B', -1.4, ['frustrated']),
  tagged('g2', 6, 'A', -1.0, ['frustrated']),
];
