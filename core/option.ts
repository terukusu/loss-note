// オプションのポジション（原資産の取引 + レッグ）の計算（設計書 4.7・5.7・C47〜C49・C54・ADR-0020）。
// 判定は 5.3・5.4 の同じ関数（judge.ts）を通り、ここはレッグに特有の数だけを出す: ポジションの損益（満期で消えたレッグを必ず足す）・
// 手数料を除いた損益・1R の (1) 見込み と (2) 実際の動きから・向き（LC の側）・決済の時点と注文の種類。
// 満期の損益・最大損失・1R の (3)・「最大損失まで」は #114。金額は口座の通貨。丸めずに返す。I/O・時刻・乱数なし
import { signOf } from './numeric';
import type { ExitOrderType, Leg, Side, TradeInput } from './trade';

/** レッグの本数の上限（4.7） */
export const MAX_LEGS = 10;

/** 買い = +1・売り = −1 */
export function legSign(l: Leg): 1 | -1 {
  return l.side === 'buy' ? 1 : -1;
}

/** レッグの導出の損益（価格の通貨）= sign × (決済値 − 建値) × 枚数 × 乗数。満期で消えたレッグは決済値 = 本源的価値 */
export function legPnlPrice(l: Leg, multiplier: number): number {
  return legSign(l) * (l.exit.price - l.entry.price) * l.quantity * multiplier;
}

/** 決済の為替（価格の通貨 = 口座の通貨なら 1。C43 のまま） */
function exitFx(t: TradeInput): number | undefined {
  return t.instrument.priceInAccountCurrency ? 1 : t.exit?.fxRate;
}

function sumPrice(legs: readonly Leg[], multiplier: number): number {
  return legs.reduce((sum, l) => sum + legPnlPrice(l, multiplier), 0);
}

/** すべてのレッグの価格の通貨の損益の合計（為替が出ないときの勝ち負けの境。4.7・C48）。レッグが無ければ無し */
export function positionPnlPriceCurrency(t: TradeInput): number | undefined {
  if (t.option === undefined) return undefined;
  return sumPrice(t.option.legs, t.instrument.multiplier);
}

/**
 * ポジションの損益（口座の通貨。判定と R の正。4.7）。
 * 明細の損益があれば、それ（決済したレッグの分）+ 満期で消えたレッグの導出の損益 × 為替。無ければすべてのレッグの導出の損益 × 為替。
 * 為替が出ず換算が要るときは無し（明細の損益だけで済ませない: 消えた買いで全体がマイナスのことがあるため）
 */
export function positionPnlYen(t: TradeInput): number | undefined {
  const o = t.option;
  if (o === undefined || t.exit === undefined) return undefined;
  const mult = t.instrument.multiplier;
  const fx = exitFx(t);
  if (t.statementPnlYen !== undefined) {
    const expired = o.legs.filter((l) => l.exit.kind === 'expired');
    if (expired.length === 0) return t.statementPnlYen;
    if (fx === undefined) return undefined;
    return t.statementPnlYen + sumPrice(expired, mult) * fx;
  }
  if (fx === undefined) return undefined;
  return sumPrice(o.legs, mult) * fx;
}

/**
 * 手数料を除いた損益（勝ち負けの境と R の分子。4.7・C48・C49）。明細の損益があれば
 * 明細の損益 + 手数料の合計 + 満期で消えたレッグの導出の損益（明細の損益は手数料を引いた実損なので足して戻す）、
 * 無ければすべてのレッグの導出の損益の合計（もともと手数料を含まないので手数料を足さない）。為替が出ず換算できなければ無し
 */
export function positionNetYen(t: TradeInput): number | undefined {
  const pnl = positionPnlYen(t);
  if (pnl === undefined) return undefined;
  return t.statementPnlYen === undefined ? pnl : pnl + (t.feesTotalYen ?? 0);
}

/** 1R の出どころ（判定の枠と詳細に 1 語で添える。C49）。#114 で expiry（満期の損益から）・maxLoss（最大損失）を足す */
export type OneRSource = 'plan' | 'actualMove';

export interface OptionOneR {
  /** 1R（口座の通貨。> 0） */
  readonly value: number;
  readonly source: OneRSource;
}

/**
 * オプションのポジションの 1R（C49）。(1) 見込み → (2) 実際の動きから → (3) 満期の損益から（#114）の順で 1 つ目に出たもの。
 * (2) は手数料を除いた損益がマイナスで、原資産が思惑と逆に LC までの幅の半分以上動いたときだけ
 * `|手数料を除いた損益| × |イン − LC| ÷ |決済 − イン|`（イン・決済・LC は原資産。LC は入る前の LC。C30）。
 * (1) は口座の通貨の値なので、為替が空で損益が出ないときも出す（R は損益が無いので出ない）。(2) は損益が要る。
 * 5.1 の補いの式は当てない
 */
export function optionOneR(t: TradeInput): OptionOneR | undefined {
  if (t.option === undefined || t.exit === undefined) return undefined;
  const plan = t.option.lcLossPlanYen;
  if (plan !== undefined && plan > 0) return { value: plan, source: 'plan' };
  const net = positionNetYen(t);
  if (net === undefined) return undefined;

  const entry = t.entries[0];
  const lc = entry.lc ?? t.lc;
  if (lc !== undefined && net < 0) {
    const width = Math.abs(entry.price - lc);
    const move = t.exit.price - entry.price;
    const against = signOf(t.side) * move < 0;
    if (width > 0 && against && Math.abs(move) >= 0.5 * width) {
      return { value: (Math.abs(net) * width) / Math.abs(move), source: 'actualMove' };
    }
  }
  return undefined;
}

/** 向き（C47 の LC の側）: LC が建てたときの原資産より下なら L・上なら S。LC が無い・同じ・有限でなければ無し（満期の損益の比べ方は #114） */
export function optionSideFromLc(
  entryUnderlying: number,
  lc: number | undefined,
): Side | undefined {
  if (lc === undefined || !Number.isFinite(lc) || !Number.isFinite(entryUnderlying))
    return undefined;
  if (lc < entryUnderlying) return 'L';
  if (lc > entryUnderlying) return 'S';
  return undefined;
}

/**
 * ポジションの決済の時点（C54）。closed = 自分で決済したレッグ、expiredSell = 満期で消えた売りのレッグ（SQ）、
 * expiredBuy = すべてが満期で消えた買いのとき（SQ）
 */
export interface ExitPoint {
  readonly kind: 'closed' | 'expiredSell' | 'expiredBuy';
  readonly legId: string;
  readonly time?: number;
}

function pointOf(l: Leg): ExitPoint {
  const kind =
    l.exit.kind === 'closed' ? 'closed' : l.side === 'sell' ? 'expiredSell' : 'expiredBuy';
  return { kind, legId: l.id, ...(l.exit.time === undefined ? {} : { time: l.exit.time }) };
}

/**
 * リスクが残っていたレッグを最後に閉じた時点（C54）。数えるのは決済したレッグと満期で消えた売りのレッグで、満期で消えた買いは
 * 数えない（損益にだけ入る）。数えるレッグが無ければ（すべてが消えた買い）SQ。同じ時刻なら満期で消えた売りを取る（救わない側）。
 * 数えるレッグが 2 本以上で時刻の無いものがあれば、順が決まらないので無し（C54。SQ の日をその日の何時と読むかは保存の形 #116）
 */
export function positionExitPoint(legs: readonly Leg[]): ExitPoint | undefined {
  const counted = legs.filter((l) => l.exit.kind === 'closed' || l.side === 'sell');
  const pool = counted.length > 0 ? counted : legs;
  const [only] = pool;
  if (only === undefined) return undefined;
  if (pool.length === 1) return pointOf(only);
  let best: Leg | undefined;
  for (const l of pool) {
    const time = l.exit.time;
    if (time === undefined) return undefined;
    const bestTime = best?.exit.time;
    if (best === undefined || bestTime === undefined || time > bestTime) {
      best = l;
    } else if (time === bestTime && pointOf(l).kind === 'expiredSell') {
      best = l;
    }
  }
  return best === undefined ? undefined : pointOf(best);
}

/**
 * ポジションの決済の注文の種類（C54）。時点が SQ（満期で消えた売り・すべてが消えた買い）なら expiry（満期（SQ））、
 * そうでなければ明細の値（無ければ unknown。expiry が渡っても unknown に戻す）。すべてのレッグが満期で消えた買いなら時刻によらず
 * expiry。時点が決まらないときは、満期で消えた売りがあれば expiry（証拠が無いので救わない側。C26・C54）
 */
export function positionExitOrderType(
  legs: readonly Leg[],
  fromStatement: ExitOrderType | undefined,
): ExitOrderType {
  const counted = legs.filter((l) => l.exit.kind === 'closed' || l.side === 'sell');
  if (counted.length === 0 && legs.length > 0) return 'expiry';
  const point = positionExitPoint(legs);
  const sq =
    point === undefined
      ? legs.some((l) => l.exit.kind === 'expired' && l.side === 'sell')
      : point.kind !== 'closed';
  if (sq) return 'expiry';
  return fromStatement === undefined || fromStatement === 'expiry' ? 'unknown' : fromStatement;
}
