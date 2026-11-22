// 負けの判定 A / B / C と勝ちの判定（設計書 5.3・5.4・C29〜C31・C33）。
// 理由を 5.3 の表の順にすべて集め、判定はその最も重いもの。理由は構造（種類 + 値）で返し、文言は画面で作る

import { signOf, TOL } from './numeric';
import { isMaxLossPlan, positionNetYen, positionPnlPriceCurrency } from './option';
import { allLcs, priceMove } from './pnl';
import { isLongerTimeframe, type Timeframe, type TradeInput } from './trade';

export type Reason =
  | { readonly kind: 'noLc' }
  /** 置いた逆指値を持っている間に外した（C56。B） */
  | { readonly kind: 'lcCancelled' }
  | { readonly kind: 'lcWidened'; readonly from?: number; readonly to?: number }
  | {
      readonly kind: 'timeframeLonger';
      readonly source: 'tap' | 'chart';
      readonly from?: Timeframe;
      readonly to?: Timeframe;
    }
  /**
   * 持ち続けた。先物などは r（決済の R）、レッグを持つ取引は underlying（決済したときの原資産。R は出れば r。C48）
   */
  | { readonly kind: 'heldPastLc'; readonly r?: number; readonly underlying?: number }
  | { readonly kind: 'overRisk'; readonly riskPct: number }
  | { readonly kind: 'amountBasedLc' }
  | { readonly kind: 'averagingDown'; readonly entryIndex: number }
  | { readonly kind: 'asPlannedLc' }
  | { readonly kind: 'stopFilled' }
  | { readonly kind: 'gapSlip' }
  | { readonly kind: 'earlyExit' }
  | { readonly kind: 'riskNotChecked'; readonly cause: 'noCapital' | 'noOneR' };

export type ReasonKind = Reason['kind'];
export type Outcome = 'win' | 'loss';
/** 負けの A / B / C と、勝ちの危ない勝ち（riskyWin）・計画どおりの勝ち（safeWin） */
export type Grade = 'A' | 'B' | 'C' | 'riskyWin' | 'safeWin';

/** 理由の並び（5.3 の表の順、その後に注記） */
export const REASON_ORDER: readonly ReasonKind[] = [
  'noLc',
  'lcCancelled',
  'lcWidened',
  'timeframeLonger',
  'heldPastLc',
  'overRisk',
  'amountBasedLc',
  'averagingDown',
  'asPlannedLc',
  'stopFilled',
  'gapSlip',
  'earlyExit',
  'riskNotChecked',
];

/** 理由の重さ（note は判定の重さに数えない） */
export const REASON_WEIGHT: Readonly<Record<ReasonKind, 'C' | 'B' | 'note'>> = {
  noLc: 'C',
  lcCancelled: 'B',
  lcWidened: 'B',
  timeframeLonger: 'B',
  heldPastLc: 'B',
  overRisk: 'B',
  amountBasedLc: 'B',
  averagingDown: 'B',
  asPlannedLc: 'note',
  stopFilled: 'note',
  gapSlip: 'note',
  earlyExit: 'note',
  riskNotChecked: 'note',
};

/** 判定に使う数値（evaluate が計算して渡す） */
export interface JudgeNumbers {
  readonly r?: number;
  readonly pnlYen?: number;
  readonly oneRYen?: number;
  readonly riskPct?: number;
  readonly overRisk?: boolean;
}

export interface Judgment {
  readonly outcome: Outcome;
  readonly grade: Grade;
  readonly reasons: readonly Reason[];
}

/**
 * 勝ち負けの境（C29）: R があれば R ≥ 0 が勝ち、無ければ損益（円）≥ 0、それも無ければ価格の動き ≥ 0。
 * レッグを持つ取引は手数料を除いた損益（損益 + 手数料）の符号、損益が出なければレッグの価格の通貨の損益の合計の符号（C48）。
 * どちらも 0 は勝ちの側（誤差 1e-9 を許す）
 */
export function outcomeOf(t: TradeInput, nums: JudgeNumbers): Outcome | undefined {
  if (t.exit === undefined) return undefined;
  if (t.option !== undefined) {
    const value = positionNetYen(t) ?? positionPnlPriceCurrency(t);
    if (value === undefined) return undefined;
    return value >= -TOL ? 'win' : 'loss';
  }
  if (nums.r !== undefined) return nums.r >= -TOL ? 'win' : 'loss';
  if (nums.pnlYen !== undefined) return nums.pnlYen >= 0 ? 'win' : 'loss';
  const move = priceMove(t);
  if (move === undefined) return undefined;
  return move >= 0 ? 'win' : 'loss';
}

/**
 * 「持ち続けた」の比較先（C30）: 広げたなら広げた後の値（無ければ無し）、買い増しは最後のエントリーの LC、ほかは LC。
 * 取り消した（C56）は新しい線が無いので入る前の LC（買い増しは最後のエントリーの LC）と比べる
 */
function heldReference(t: TradeInput): number | undefined {
  if (t.lcMove.kind === 'widened') return t.lcMove.after;
  if (t.entries.length > 1) {
    const last = t.entries[t.entries.length - 1];
    return last?.lc ?? t.lc;
  }
  return t.lc;
}

/** 決済が比較先より不利で、逆指値の約定でなく、損失が 1R を超えたか（ignoreGap なら窓・滑りの救済を見ない） */
function heldPast(t: TradeInput, r: number | undefined, ignoreGap: boolean): boolean {
  const ref = heldReference(t);
  if (t.exit === undefined || ref === undefined || r === undefined) return false;
  const worse = signOf(t.side) * (t.exit.price - ref) < 0;
  if (!worse || t.exit.orderType === 'stop') return false;
  if (!ignoreGap && (t.exit.reason === 'gapSlip' || t.gapSlipAnswer === true)) return false;
  return r < -1 - TOL;
}

/**
 * レッグを持つ取引の「持ち続けた」（C48）: 決済したときの原資産が比較先（C30）を不利な側に越えた（誤差 1e-9）、かつ
 * 逆指値でない（満期（SQ）は逆指値とみなさない。C54）・窓・滑りでもない（ignoreGap なら見ない）。1R・損益の符号は見ない。
 * 「最大損失まで」は見ない（C50）
 */
function heldPastOption(t: TradeInput, ignoreGap: boolean): boolean {
  if (isMaxLossPlan(t)) return false; // 「最大損失まで」は持ち続けたを見ない（C50）
  const ref = heldReference(t);
  if (t.exit === undefined || ref === undefined) return false;
  const beyond = signOf(t.side) * (t.exit.price - ref) < -TOL;
  if (!beyond || t.exit.orderType === 'stop') return false;
  return ignoreGap || !(t.exit.reason === 'gapSlip' || t.gapSlipAnswer === true);
}

/** 2 つ目以降のエントリーで、それまでの数量の重み付き平均のインより不利に足したもの（ナンピン） */
function averagingDownIndexes(t: TradeInput): number[] {
  const s = signOf(t.side);
  const found: number[] = [];
  for (let i = 1; i < t.entries.length; i++) {
    const added = t.entries[i];
    if (added === undefined) continue;
    // Σ 数量_j × s(イン_j − 追加のイン) > 0 ⇔ 平均より不利（同じ値は 0 でナンピンにしない）
    let diff = 0;
    for (let j = 0; j < i; j++) {
      const e = t.entries[j];
      if (e !== undefined) diff += e.quantity * s * (e.price - added.price);
    }
    if (diff > 0) found.push(i);
  }
  return found;
}

function timeframeReason(t: TradeInput): Reason | undefined {
  if (t.timeframeChange === 'longer') {
    return {
      kind: 'timeframeLonger',
      source: 'tap',
      ...(t.timeframe ? { from: t.timeframe } : {}),
    };
  }
  const a = t.entryChartTimeframe;
  const b = t.exitChartTimeframe;
  if (a !== undefined && b !== undefined && isLongerTimeframe(a, b)) {
    return { kind: 'timeframeLonger', source: 'chart', from: a, to: b };
  }
  return undefined;
}

/** 判定の重さに数える理由（5.3 の表の順） */
function weightedReasons(t: TradeInput, nums: JudgeNumbers, outcome: Outcome): Reason[] {
  const reasons: Reason[] = [];
  // 取引の LC が無くても、すべてのエントリーに LC があれば LC あり（R・1R の計算と同じ定義）
  const hasLc = allLcs(t) !== undefined;
  // 「最大損失まで」（最大損失が定まる）は損失の上限を入る前に決めた計画なので、LC が無いことでは C にしない（C50）
  const planned = hasLc || isMaxLossPlan(t);
  if (!planned || !t.lcDecidedBeforeEntry) reasons.push({ kind: 'noLc' });
  if (t.lcMove.kind === 'cancelled') reasons.push({ kind: 'lcCancelled' });
  if (t.lcMove.kind === 'widened') {
    const { after } = t.lcMove;
    reasons.push({
      kind: 'lcWidened',
      ...(t.lc === undefined ? {} : { from: t.lc }),
      ...(after === undefined ? {} : { to: after }),
    });
  }
  const tf = timeframeReason(t);
  if (tf) reasons.push(tf);
  if (t.option !== undefined) {
    // 勝ちでも理由に入る（勝ちなら危ない勝ち「持ち続けた」。C48）
    if (t.exit !== undefined && heldPastOption(t, false)) {
      reasons.push({
        kind: 'heldPastLc',
        underlying: t.exit.price,
        ...(nums.r === undefined ? {} : { r: nums.r }),
      });
    }
  } else if (outcome === 'loss' && nums.r !== undefined && heldPast(t, nums.r, false)) {
    reasons.push({ kind: 'heldPastLc', r: nums.r });
  }
  if (nums.riskPct !== undefined && nums.overRisk === true) {
    reasons.push({ kind: 'overRisk', riskPct: nums.riskPct });
  }
  if (hasLc && t.lcBasis === 'amount') reasons.push({ kind: 'amountBasedLc' });
  for (const entryIndex of averagingDownIndexes(t))
    reasons.push({ kind: 'averagingDown', entryIndex });
  return reasons;
}

/** 負け: C の理由があれば C、B があれば B、なければ A。勝ち: C か B があれば危ない勝ち */
export function gradeOf(outcome: Outcome, reasons: readonly Reason[]): Grade {
  const hasC = reasons.some((r) => REASON_WEIGHT[r.kind] === 'C');
  const hasB = reasons.some((r) => REASON_WEIGHT[r.kind] === 'B');
  if (outcome === 'win') return hasC || hasB ? 'riskyWin' : 'safeWin';
  if (hasC) return 'C';
  return hasB ? 'B' : 'A';
}

/** 当たった理由をすべて（5.3 の表の順 + 注記）。未決済なら空 */
export function collectReasons(t: TradeInput, nums: JudgeNumbers): Reason[] {
  const outcome = outcomeOf(t, nums);
  if (outcome === undefined || t.exit === undefined) return [];
  const reasons = weightedReasons(t, nums, outcome);
  const grade = gradeOf(outcome, reasons);

  if (grade === 'A') {
    reasons.push(t.exit.orderType === 'stop' ? { kind: 'stopFilled' } : { kind: 'asPlannedLc' });
    // 決済が比較先より不利で、窓・滑り（理由または答え）で救った
    const rescued =
      t.option !== undefined
        ? heldPastOption(t, true) && !heldPastOption(t, false)
        : heldPast(t, nums.r, true) && !heldPast(t, nums.r, false);
    if (rescued) reasons.push({ kind: 'gapSlip' });
  }
  if (t.exit.reason === 'fearEarly') reasons.push({ kind: 'earlyExit' });
  if (t.capitalYen === undefined) reasons.push({ kind: 'riskNotChecked', cause: 'noCapital' });
  else if (nums.oneRYen === undefined) reasons.push({ kind: 'riskNotChecked', cause: 'noOneR' });
  return reasons;
}

/** 判定（未決済なら無し。仮定 13） */
export function judge(t: TradeInput, nums: JudgeNumbers): Judgment | undefined {
  const outcome = outcomeOf(t, nums);
  if (outcome === undefined) return undefined;
  const reasons = collectReasons(t, nums);
  return { outcome, grade: gradeOf(outcome, reasons), reasons };
}
