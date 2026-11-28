// 取引の計算の入口（#13・#4 が使う）: 検査 → 数値 → 判定（設計書 5 章）
import { type Judgment, judge } from './judge';
import { type OneRSource, optionOneR, positionExitOrderType } from './option';
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
      /** 1R の出どころ（足を持つ取引で 1R が出たときだけ。C49） */
      readonly oneRSource?: OneRSource;
    };

/**
 * 足を持つ取引の決済の注文の種類は、入力をそのまま信じず足の決済の時点から導く（C54。時点が SQ なら満期（SQ）。
 * 明細の「逆指値」が残ったまま渡っても、SQ まで残した売りを救わない）
 */
function withDerivedOrderType(t: TradeInput): TradeInput {
  if (t.option === undefined || t.exit === undefined) return t;
  const orderType = positionExitOrderType(t.option.legs, t.exit.orderType);
  return orderType === t.exit.orderType ? t : { ...t, exit: { ...t.exit, orderType } };
}

export function evaluateTrade(input: TradeInput): Evaluation {
  const t = withDerivedOrderType(input);
  const issues = validateTrade(t);
  if (issues.length > 0) return { ok: false, issues };

  const pnl = pnlYen(t);
  const r = rMultiple(t);
  const optionR = t.option === undefined ? undefined : optionOneR(t);
  const oneR = t.option === undefined ? oneRYen(t) : optionR?.value;
  const pct = riskPct(t);
  const nums = {
    ...(pnl === undefined ? {} : { pnlYen: pnl }),
    ...(r === undefined ? {} : { r }),
    ...(oneR === undefined ? {} : { oneRYen: oneR }),
    ...(pct === undefined ? {} : { riskPct: pct, overRisk: isOverRisk(pct) }),
  };
  const judgment = judge(t, nums);
  const source = optionR?.source;
  return {
    ok: true,
    ...nums,
    prePlan: hasPrePlan(t),
    ...(judgment === undefined ? {} : { judgment }),
    ...(source === undefined ? {} : { oneRSource: source }),
  };
}
