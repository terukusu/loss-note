// LC の物差し（Issue #34 契約 P-1。設計書 5.1・C30）。イン・決めた LC・動かした LC・決済・TP を R の軸に置く。
// R = s ×（価格 − イン）÷ |イン − LC|（LC は R の分母の LC = 入る前に決めた LC。エントリーの LC があればそれ。pnl.ts と同じ）。
// 線は L / S によらず左 = 損の側。範囲は下端 max(−3, min(−1, 最小の R))〜上端 min(3, max(1, 最大の R))、外の点は端に置く。
// 決済の R は rMultiple（判定の枠の R と同じ値）。丸めない（表示の丸めは画面）。I/O・時刻・乱数なし
import { signOf, TOL } from './numeric';
import { rMultiple } from './pnl';
import type { TradeInput } from './trade';

export type RulerPointKind = 'entry' | 'plannedLc' | 'movedLc' | 'exit' | 'tp';

export interface RulerPoint {
  readonly kind: RulerPointKind;
  /** 価格（入力のまま） */
  readonly price: number;
  /** R 倍数 */
  readonly r: number;
  /** 線の上の位置（0 = 左端 = 損の側、1 = 右端）。範囲の外の点は端 */
  readonly pos: number;
  /** 表示の範囲の外（端に置いて印を付ける） */
  readonly outOfRange: boolean;
}

export interface Ruler {
  /** 表示の範囲の下端（R。−3〜−1） */
  readonly lo: number;
  /** 表示の範囲の上端（R。1〜3） */
  readonly hi: number;
  /** 点（R の小さい順。同じ R は 決めた LC → 動かした LC → イン → TP → 決済） */
  readonly points: readonly RulerPoint[];
  /** 決済が決めた LC を越えた幅（R。−1 − 決済の R）。越えていなければ無し */
  readonly overshootR?: number;
  /**
   * LC を入る前に決めていたか（C15。false = R の分母の LC は入った後に決めた値。物差しでは −1R の線を「後から」と描き分け、
   * 計画どおりの勝ちと見分ける。R の分母としての意味は変えない）
   */
  readonly lcDecidedBeforeEntry: boolean;
}

/** 同じ R の点の並び（計画の点を先、決済を後。ルール 4） */
const KIND_ORDER: Readonly<Record<RulerPointKind, number>> = {
  plannedLc: 0,
  movedLc: 1,
  entry: 2,
  tp: 3,
  exit: 4,
};

const RANGE_MAX = 3;

/**
 * LC の物差し。エントリーが 1 つ・決済あり・R の分母の LC があり幅 > 0 のときだけ返す（ほかは無し。ルール 3）。
 * 決済・動かした LC の R が有限でなければ無し、TP の R が有限でない・利の側でなければ TP の点を出さない
 */
export function rulerOf(t: TradeInput, tp?: number): Ruler | undefined {
  if (t.entries.length !== 1 || t.exit === undefined) return undefined;
  const entry = t.entries[0];
  const lc = entry.lc ?? t.lc;
  if (lc === undefined) return undefined;
  const width = Math.abs(entry.price - lc);
  if (!(width > 0) || !Number.isFinite(width)) return undefined;
  const s = signOf(t.side);
  const rOf = (price: number) => (s * (price - entry.price)) / width;

  const exitR = rMultiple(t);
  if (exitR === undefined || !Number.isFinite(exitR)) return undefined;

  const raw: { kind: RulerPointKind; price: number; r: number }[] = [
    { kind: 'entry', price: entry.price, r: 0 },
    { kind: 'plannedLc', price: lc, r: -1 },
    { kind: 'exit', price: t.exit.price, r: exitR },
  ];
  if (t.lcMove.kind === 'widened' && t.lcMove.after !== undefined) {
    const r = rOf(t.lcMove.after);
    if (!Number.isFinite(r)) return undefined;
    raw.push({ kind: 'movedLc', price: t.lcMove.after, r });
  }
  if (tp !== undefined && Number.isFinite(tp)) {
    const r = rOf(tp);
    if (Number.isFinite(r) && r > TOL) raw.push({ kind: 'tp', price: tp, r });
  }

  const rs = raw.map((p) => p.r);
  const lo = Math.max(-RANGE_MAX, Math.min(-1, ...rs));
  const hi = Math.min(RANGE_MAX, Math.max(1, ...rs));
  const span = hi - lo;
  const points = raw
    .map(
      (p): RulerPoint => ({
        ...p,
        pos: Math.min(1, Math.max(0, (p.r - lo) / span)),
        outOfRange: p.r < lo - TOL || p.r > hi + TOL,
      }),
    )
    .sort((a, b) =>
      Math.abs(a.r - b.r) <= TOL ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.r - b.r,
    );
  return {
    lo,
    hi,
    points,
    lcDecidedBeforeEntry: t.lcDecidedBeforeEntry,
    ...(exitR < -1 - TOL ? { overshootR: -1 - exitR } : {}),
  };
}
