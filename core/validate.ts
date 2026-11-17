// 入力の検査（設計書 4.2・C11・Issue #2 の仮定 11）。問題が 1 つでもあれば計算しない
import type { TradeInput } from './trade';

export type Issue =
  | { readonly kind: 'lcDirection'; readonly entryIndex: number }
  | { readonly kind: 'lcMoveDirection' }
  | { readonly kind: 'invalidNumber'; readonly field: string };

function finite(v: number | undefined): boolean {
  return v === undefined || Number.isFinite(v);
}

function positive(v: number | undefined): boolean {
  return v === undefined || (Number.isFinite(v) && v > 0);
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

  // 下げた後の LC は入る前の LC より不利な側（L は下、S は上）
  if (t.lcMove.kind === 'widened' && t.lcMove.after !== undefined && t.lc !== undefined) {
    const { after } = t.lcMove;
    if (Number.isFinite(after) && Number.isFinite(t.lc)) {
      const ok = isLong ? after < t.lc : after > t.lc;
      if (!ok) issues.push({ kind: 'lcMoveDirection' });
    }
  }
  return issues;
}
