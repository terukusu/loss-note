// 計算の入力の型（設計書 3・4.1・4.2）。保存の形（#4）はこの型に写す。
// 価格は銘柄の価格の通貨、金額は口座の通貨（円の口座なら円。#47 PR-2。鍵の名前の `…Yen` は歴史的な名前で、
// 外貨の口座ではその通貨の金額）、時点はエポックからのミリ秒（時間帯の直しは済んだ値）。

export type Side = 'L' | 'S';

/** 短い順。比較は添字で行う（長い足へ = 添字が大きくなる）。足すときは順を保って挿入する */
export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** 足 b が足 a より長いか（どちらかが列挙に無ければ false） */
export function isLongerTimeframe(a: Timeframe, b: Timeframe): boolean {
  const ia = TIMEFRAMES.indexOf(a);
  const ib = TIMEFRAMES.indexOf(b);
  return ia >= 0 && ib >= 0 && ib > ia;
}

export interface InstrumentSpec {
  /** 価格が 1 動いたときの 1 数量あたりの損益（価格の通貨）。> 0 */
  readonly multiplier: number;
  /** 数量の刻み。> 0 */
  readonly quantityStep: number;
  /** 価格の通貨 = 口座の通貨なら true（為替は 1 で固定）。価格の通貨が未設定なら false（#47 PR-2） */
  readonly priceInAccountCurrency: boolean;
}

export interface Entry {
  /** 時点（エポックからのミリ秒） */
  readonly time?: number;
  /** イン（価格の通貨） */
  readonly price: number;
  /** > 0 */
  readonly quantity: number;
  /** そのときの LC。無ければ取引の lc を使う */
  readonly lc?: number;
}

/** 決済の注文の種類（既定 unknown。C26） */
export type ExitOrderType = 'stop' | 'market' | 'limit' | 'unknown';
/** 決済の理由（既定 other。C19） */
export type ExitReason =
  | 'lc'
  | 'gapSlip'
  | 'tp'
  | 'brokeManual'
  | 'fearEarly'
  | 'timeout'
  | 'other';

export interface Exit {
  readonly time?: number;
  readonly price: number;
  readonly orderType: ExitOrderType;
  readonly reason: ExitReason;
  /** 決済の為替（価格の通貨 1 単位 = 口座の通貨でいくら）。価格の通貨 = 口座の通貨なら使わない */
  readonly fxRate?: number;
}

/** LC を動かしたか。after = 下げた後の値（C30） */
export type LcMove =
  | { readonly kind: 'none' }
  | { readonly kind: 'tightened' }
  | { readonly kind: 'widened'; readonly after?: number };

export type TimeframeChange = 'none' | 'longer' | 'shorter';

export interface TradeInput {
  readonly side: Side;
  readonly instrument: InstrumentSpec;
  readonly entries: readonly [Entry, ...Entry[]];
  /** 入る前に決めた LC（R の分母。C30）。無いこともある */
  readonly lc?: number;
  /** LC の根拠（C3） */
  readonly lcBasis: 'chart' | 'amount';
  /** LC を入る前に決めていたか（C15） */
  readonly lcDecidedBeforeEntry: boolean;
  readonly lcMove: LcMove;
  readonly timeframeChange: TimeframeChange;
  /** 根拠にした足 */
  readonly timeframe?: Timeframe;
  /** チャートから読んだ足（7.5） */
  readonly entryChartTimeframe?: Timeframe;
  readonly exitChartTimeframe?: Timeframe;
  /** 無ければ未決済（判定しない） */
  readonly exit?: Exit;
  /** 明細の損益（口座の通貨。手数料込みの実損。C18） */
  readonly statementPnlYen?: number;
  /** 手数料の合計（口座の通貨。費用を正の数。無ければ 0。C32） */
  readonly feesTotalYen?: number;
  /** 「窓・滑りでしたか」。未回答 = いいえ */
  readonly gapSlipAnswer?: boolean;
  /** 計画時の為替。入る前の記録・買い増しの 1R で使う */
  readonly planFxRate?: number;
  /** 資金（口座の通貨）。未設定なら無し。> 0 */
  readonly capitalYen?: number;
  /** 許容リスク（%。1 = 1%）。> 0 */
  readonly riskTolerancePct: number;
  /** 計画を記録した時刻（時点） */
  readonly plannedAt?: number;
}
