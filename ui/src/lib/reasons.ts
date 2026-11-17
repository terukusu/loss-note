// 判定の理由の文言（Issue #13 AC-4・契約 R-2。設計書 5.3 の「理由の表示」）。
// core/ は理由を構造（種類 + 値）で返し、文言はここで作る。種類ごとの関数を Record<ReasonKind, …> に置き、
// core に種類が増えたら型検査で落ちる（網羅の強制）。S の取引では LC を不利な側へ動かしたことを「上げた」と言う
import type { Reason, ReasonKind } from '../../../core/judge';
import type { Side, Timeframe } from '../../../core/trade';
import { formatPct, formatPrice, formatR } from './format';

/** 時間足の表示名 */
export const TIMEFRAME_NAME: Readonly<Record<Timeframe, string>> = {
  '1m': '1 分足',
  '5m': '5 分足',
  '15m': '15 分足',
  '30m': '30 分足',
  '1h': '1 時間足',
  '4h': '4 時間足',
  '1d': '日足',
  '1w': '週足',
  '1M': '月足',
};

/** LC を不利な側へ動かした、の動詞（L = 下げた / S = 上げた） */
export function widenVerb(side: Side): string {
  return side === 'L' ? '下げた' : '上げた';
}

type Of<K extends ReasonKind> = Extract<Reason, { readonly kind: K }>;

const TEXT: { readonly [K in ReasonKind]: (r: Of<K>, side: Side) => string } = {
  noLc: () => 'LC を決めずに入った',
  lcWidened: (r, side) => {
    const verb = `LC を${widenVerb(side)}`;
    return r.from !== undefined && r.to !== undefined
      ? `${verb}（${formatPrice(r.from)} → ${formatPrice(r.to)}）`
      : verb;
  },
  timeframeLonger: (r) =>
    r.from !== undefined && r.to !== undefined
      ? `時間足を変えた（${TIMEFRAME_NAME[r.from]} → ${TIMEFRAME_NAME[r.to]}）`
      : '時間足を変えた',
  heldPastLc: (r) => `LC で切らずに持ち続けた（${formatR(r.r)}）`,
  overRisk: (r) => `過剰リスク（${formatPct(r.riskPct)}）`,
  amountBasedLc: () => '金額ありきの LC',
  averagingDown: () => 'ナンピン',
  asPlannedLc: () => '決めた LC で切れた',
  stopFilled: () => '逆指値で切れた（証拠あり）',
  gapSlip: () => '窓・滑り',
  earlyExit: () => '早逃げ',
  riskNotChecked: (r) =>
    r.cause === 'noCapital'
      ? '資金が未設定なので過剰リスクは見ていない'
      : '1R が出ないので過剰リスクは見ていない',
};

export function reasonText(reason: Reason, side: Side): string {
  const fn = TEXT[reason.kind] as (r: Reason, s: Side) => string;
  return fn(reason, side);
}
