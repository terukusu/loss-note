// LC の物差し（Issue #34 契約 P-1。設計書 5.1・C30）。イン・決めた LC・広げた後の LC・決済・TP を R の軸に置く。
// R = s ×（価格 − イン）÷ |イン − LC|（LC は R の分母の LC = 入る前に決めた LC。エントリーの LC があればそれ。pnl.ts と同じ）。
// 線は L / S によらず左 = 損の側。範囲は下端 max(−3, min(−1, 最小の R))〜上端 min(3, max(1, 最大の R))、外の点は端に置く。
// 決済の R は rMultiple（判定の枠の R と同じ値）。丸めない（表示の丸めは画面）。I/O・時刻・乱数なし
// #231（設計書 C66）: LC の価格の無いオプションのポジション（「最大損失まで」・LC での損失の見込みだけ）は R の軸で −1R に
// 計画の上限（価格なし）を置く（`bound`）。LC なしの取引は R が無いので、価格の位置の図（`noLcRulerOf`）
import { signOf, TOL } from './numeric';
import { optionOneR } from './option';
import { rMultiple } from './pnl';
import type { TradeInput } from './trade';

export type RulerPointKind = 'entry' | 'plannedLc' | 'movedLc' | 'exit' | 'tp';

export interface RulerPoint {
  readonly kind: RulerPointKind;
  /** 価格（入力のまま）。計画の上限（`Ruler.bound`）の −1R の点だけ無し */
  readonly price?: number;
  /** R 倍数 */
  readonly r: number;
  /** 線の上の位置（0 = 左端 = 損の側、1 = 右端）。範囲の外の点は端 */
  readonly pos: number;
  /** 表示の範囲の外（端に置いて印を付ける） */
  readonly outOfRange: boolean;
}

/** LC の価格の無いオプションのポジションの −1R（C49・C50）: 最大損失 / LC での損失の見込み */
export type RulerBound = 'maxLoss' | 'lossPlan';

export interface Ruler {
  /** R の軸の図（LC なしの価格の図 `NoLcRuler` と見分ける） */
  readonly basis: 'r';
  /** −1R が LC の価格ではなく計画の上限（オプションのポジション。#231）。無ければ決めた LC */
  readonly bound?: RulerBound;
  /** 表示の範囲の下端（R。−3〜−1） */
  readonly lo: number;
  /** 表示の範囲の上端（R。1〜3） */
  readonly hi: number;
  /** 点（R の小さい順。同じ R は 決めた LC → 広げた後の LC → イン → TP → 決済） */
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
 * 決済・広げた後の LC の R が有限でなければ無し、TP の R が有限でない・利の側でなければ TP の点を出さない
 */
export function rulerOf(t: TradeInput, tp?: number): Ruler | undefined {
  if (t.entries.length !== 1 || t.exit === undefined) return undefined;
  const entry = t.entries[0];
  const lc = entry.lc ?? t.lc;
  if (lc === undefined) return boundRulerOf(t);
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

  return finish(raw, t.lcDecidedBeforeEntry, exitR);
}

/** 点を範囲と位置に置いて並べる（R の軸の図の共通） */
function finish(
  raw: readonly { kind: RulerPointKind; price?: number; r: number }[],
  lcDecidedBeforeEntry: boolean,
  exitR: number,
  bound?: RulerBound,
): Ruler {
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
    basis: 'r',
    ...(bound === undefined ? {} : { bound }),
    lo,
    hi,
    points,
    lcDecidedBeforeEntry,
    ...(exitR < -1 - TOL ? { overshootR: -1 - exitR } : {}),
  };
}

/**
 * LC の価格の無いオプションのポジション（#231・C66）: 1R が最大損失（「最大損失まで」）か LC での損失の見込みのときだけ、
 * −1R に計画の上限（価格なし）・0 に イン（原資産）・決済の R に 決済（原資産）。R が出なければ無し。TP は R に直せないので出さない。
 * 最大損失は入る前に決めた計画（C50）、見込みだけ（LC なし）は決めていない側の線にする
 */
function boundRulerOf(t: TradeInput): Ruler | undefined {
  if (t.option === undefined || t.exit === undefined) return undefined;
  const source = optionOneR(t)?.source;
  if (source !== 'maxLoss' && source !== 'plan') return undefined;
  const exitR = rMultiple(t);
  if (exitR === undefined || !Number.isFinite(exitR)) return undefined;
  const entry = t.entries[0];
  const bound: RulerBound = source === 'maxLoss' ? 'maxLoss' : 'lossPlan';
  return finish(
    [
      { kind: 'entry', price: entry.price, r: 0 },
      { kind: 'plannedLc', r: -1 },
      { kind: 'exit', price: t.exit.price, r: exitR },
    ],
    bound === 'maxLoss' ? true : t.lcDecidedBeforeEntry,
    exitR,
    bound,
  );
}

export type NoLcPointKind = 'noLc' | 'entry' | 'exit' | 'tp';

export interface NoLcPoint {
  readonly kind: NoLcPointKind;
  /** 価格（入力のまま）。「LC なし」の印だけ無し */
  readonly price?: number;
  /** 線の上の位置（0 = 左端 = 損の側、1 = 右端） */
  readonly pos: number;
}

/** LC なしの取引の図（#231・C66）。R が無いので価格の位置で並べ、損の側の端に「LC なし」の印 */
export interface NoLcRuler {
  readonly basis: 'price';
  /** 点（左 = 損の側から。同じ位置は LC なし → イン → TP → 決済） */
  readonly points: readonly NoLcPoint[];
}

/** LC なしの図の範囲（イン からの動きを決済・TP の遠い方で割った値。端に「LC なし」の印の空き） */
const NO_LC_RANGE = 1.25;
const NO_LC_ORDER: Readonly<Record<NoLcPointKind, number>> = { noLc: 0, entry: 1, tp: 2, exit: 3 };

/**
 * LC なしの取引の図（#231・C66）。エントリーが 1 つ・決済あり・LC（取引・エントリー）が無いときだけ。
 * 位置 = (u + 1.25) ÷ 2.5、u = s ×（価格 − イン）÷ D、D = max(|決済 − イン|, 利の側の TP までの幅)（D = 0 なら 1）。
 * 「LC なし」の印は位置 0（損の側の端）。TP は利の側にあるときだけ。オプションのポジションは無し（R の出ないポジションは図なし）
 */
export function noLcRulerOf(t: TradeInput, tp?: number): NoLcRuler | undefined {
  // オプションのポジションは R が出なければ図を出さない（#231 のルール 6。LC の価格の無いものは `rulerOf` の bound だけ）
  if (t.option !== undefined) return undefined;
  if (t.entries.length !== 1 || t.exit === undefined) return undefined;
  const entry = t.entries[0];
  if (entry.lc !== undefined || t.lc !== undefined) return undefined;
  const s = signOf(t.side);
  const exitMove = s * (t.exit.price - entry.price);
  if (!Number.isFinite(exitMove)) return undefined;
  const tpMove =
    tp !== undefined && Number.isFinite(tp) && s * (tp - entry.price) > TOL
      ? s * (tp - entry.price)
      : undefined;
  const far = Math.max(Math.abs(exitMove), tpMove ?? 0);
  const d = far > TOL ? far : 1;
  const at = (move: number) =>
    Math.min(1, Math.max(0, (move / d + NO_LC_RANGE) / (2 * NO_LC_RANGE)));
  const points: NoLcPoint[] = [
    { kind: 'noLc', pos: 0 },
    { kind: 'entry', price: entry.price, pos: at(0) },
    { kind: 'exit', price: t.exit.price, pos: at(exitMove) },
    ...(tpMove === undefined
      ? []
      : [{ kind: 'tp' as const, price: tp as number, pos: at(tpMove) }]),
  ];
  points.sort((a, b) =>
    Math.abs(a.pos - b.pos) <= TOL ? NO_LC_ORDER[a.kind] - NO_LC_ORDER[b.kind] : a.pos - b.pos,
  );
  return { basis: 'price', points };
}
