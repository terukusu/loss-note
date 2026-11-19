// 入力の検査（設計書 4.2・4.7・C11・Issue #2 の仮定 11）。問題が 1 つでもあれば計算しない
import { MAX_LEGS } from './option';
import type { TradeInput } from './trade';

export type Issue =
  | { readonly kind: 'lcDirection'; readonly entryIndex: number }
  | { readonly kind: 'lcMoveDirection' }
  | { readonly kind: 'invalidNumber'; readonly field: string }
  /**
   * レッグを持つ取引の形（4.7）: 本数が 1〜10 でない・ID が重なる・エントリーが 1 つでない・
   * 「最大損失まで」が LC か LC での損失の見込みと同時（riskPlan）
   */
  | {
      readonly kind: 'legs';
      readonly problem: 'count' | 'duplicateId' | 'entries' | 'riskPlan';
    };

function finite(v: number | undefined): boolean {
  return v === undefined || Number.isFinite(v);
}

function positive(v: number | undefined): boolean {
  return v === undefined || (Number.isFinite(v) && v > 0);
}

function nonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

/** レッグを持つ取引の検査（4.7。レッグの時刻がポジションの範囲に入るかは API が見る） */
function legIssues(t: TradeInput): Issue[] {
  const o = t.option;
  if (o === undefined) return [];
  const issues: Issue[] = [];
  const bad = (field: string) => issues.push({ kind: 'invalidNumber', field });
  if (o.legs.length < 1 || o.legs.length > MAX_LEGS)
    issues.push({ kind: 'legs', problem: 'count' });
  if (new Set(o.legs.map((l) => l.id)).size !== o.legs.length) {
    issues.push({ kind: 'legs', problem: 'duplicateId' });
  }
  if (t.entries.length !== 1) issues.push({ kind: 'legs', problem: 'entries' });
  if (!positive(o.lcLossPlanYen)) bad('option.lcLossPlanYen');
  // 「最大損失まで」は LC の価格と見込みを持たない（4.7・C50）
  const hasLc = t.lc !== undefined || t.entries.some((e) => e.lc !== undefined);
  if (o.riskPlan === 'maxLoss' && (hasLc || o.lcLossPlanYen !== undefined)) {
    issues.push({ kind: 'legs', problem: 'riskPlan' });
  }
  o.legs.forEach((l, i) => {
    if (!(Number.isFinite(l.strike) && l.strike > 0)) bad(`legs[${i}].strike`);
    if (!(Number.isFinite(l.quantity) && l.quantity > 0)) bad(`legs[${i}].quantity`);
    if (!nonNegative(l.entry.price)) bad(`legs[${i}].entry.price`);
    if (!finite(l.entry.time)) bad(`legs[${i}].entry.time`);
    if (!nonNegative(l.exit.price)) bad(`legs[${i}].exit.price`);
    if (!finite(l.exit.time)) bad(`legs[${i}].exit.time`);
  });
  return issues;
}

export function validateTrade(t: TradeInput): Issue[] {
  const issues: Issue[] = [];
  const bad = (field: string) => issues.push({ kind: 'invalidNumber', field });

  if (!positive(t.instrument.multiplier)) bad('instrument.multiplier');
  if (!positive(t.instrument.quantityStep)) bad('instrument.quantityStep');
  if (!finite(t.lc)) bad('lc');
  if (t.lcMove.kind === 'widened' && !finite(t.lcMove.after)) bad('lcMove.after');
  if (!finite(t.statementPnlYen)) bad('statementPnlYen');
  if (!finite(t.feesTotalYen)) bad('feesTotalYen');
  if (!positive(t.planFxRate)) bad('planFxRate');
  if (!positive(t.capitalYen)) bad('capitalYen');
  if (!positive(t.riskTolerancePct)) bad('riskTolerancePct');
  if (!finite(t.plannedAt)) bad('plannedAt');
  if (t.exit !== undefined) {
    if (!finite(t.exit.price)) bad('exit.price');
    if (!finite(t.exit.time)) bad('exit.time');
    if (!positive(t.exit.fxRate)) bad('exit.fxRate');
  }

  const isLong = t.side === 'L';
  t.entries.forEach((e, i) => {
    if (!finite(e.price)) bad(`entries[${i}].price`);
    if (!positive(e.quantity)) bad(`entries[${i}].quantity`);
    if (!finite(e.time)) bad(`entries[${i}].time`);
    if (!finite(e.lc)) bad(`entries[${i}].lc`);
    const lc = e.lc ?? t.lc;
    if (lc === undefined || !Number.isFinite(lc) || !Number.isFinite(e.price)) return;
    // L は LC がインより下、S は上。等しいのも不可（C11）
    const ok = isLong ? lc < e.price : lc > e.price;
    if (!ok) issues.push({ kind: 'lcDirection', entryIndex: i });
  });

  // 広げた後の LC は入る前の LC より不利な側（L は下、S は上）
  if (t.lcMove.kind === 'widened' && t.lcMove.after !== undefined && t.lc !== undefined) {
    const { after } = t.lcMove;
    if (Number.isFinite(after) && Number.isFinite(t.lc)) {
      const ok = isLong ? after < t.lc : after > t.lc;
      if (!ok) issues.push({ kind: 'lcMoveDirection' });
    }
  }
  issues.push(...legIssues(t));
  return issues;
}
