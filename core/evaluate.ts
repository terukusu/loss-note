// 取引の計算の入口（#13・#4 が使う）: 検査 → 数値 → 判定（設計書 5 章）
import { type Judgment, judge } from './judge';
import { isOverRisk, oneRYen, pnlYen, riskPct, rMultiple } from './pnl';
import { hasPrePlan } from './pre-plan';
import type { TradeInput } from './trade';
import { type Issue, validateTrade } from './validate';

export type Evaluation =
  | { readonly ok: false; readonly issues: readonly Issue[] }
  | {
      readonly ok: true;
      readonly pnlYen?: number;
      readonly r?: number;
      readonly oneRYen?: number;
      readonly riskPct?: number;
      readonly overRisk?: boolean;
      readonly prePlan: boolean;
      readonly judgment?: Judgment;
    };

export function evaluateTrade(t: TradeInput): Evaluation {
  const issues = validateTrade(t);
  if (issues.length > 0) return { ok: false, issues };

  const pnl = pnlYen(t);
  const r = rMultiple(t);
  const oneR = oneRYen(t);
  const pct = riskPct(t);
  const nums = {
    ...(pnl === undefined ? {} : { pnlYen: pnl }),
    ...(r === undefined ? {} : { r }),
    ...(oneR === undefined ? {} : { oneRYen: oneR }),
    ...(pct === undefined ? {} : { riskPct: pct, overRisk: isOverRisk(pct) }),
  };
  const judgment = judge(t, nums);
  return {
    ok: true,
    ...nums,
    prePlan: hasPrePlan(t),
    ...(judgment === undefined ? {} : { judgment }),
  };
}
