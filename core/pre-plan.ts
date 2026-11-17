// 事前の計画あり（設計書 5.5）。計画を記録した時刻が最初のエントリーの時刻より前のときだけ
import type { TradeInput } from './trade';

export function hasPrePlan(t: TradeInput): boolean {
  const entryTime = t.entries[0].time;
  return t.plannedAt !== undefined && entryTime !== undefined && t.plannedAt < entryTime;
}
