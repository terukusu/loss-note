// 判定の理由の文言（Issue #13 AC-4・契約 R-2。設計書 5.3 の「理由の表示」）。
// core/ は理由を構造（種類 + 値）で返し、文言はここで作る。種類ごとの関数を Record<ReasonKind, …> に置き、
// core に種類が増えたら型検査で落ちる（網羅の強制）。LC を不利な側へ動かしたことは L / S で同じ「広げた」と言う
// （価格の向きは広げた後の LC の入力の誤りの知らせだけ。#56）
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

type Of<K extends ReasonKind> = Extract<Reason, { readonly kind: K }>;

const TEXT: { readonly [K in ReasonKind]: (r: Of<K>, side: Side) => string } = {
  noLc: () => 'LC を決めずに入った',
  lcWidened: (r) =>
    r.from !== undefined && r.to !== undefined
      ? `LC を広げた（${formatPrice(r.from)} → ${formatPrice(r.to)}）`
      : 'LC を広げた',
  // チャートの時間足の比較から出た理由は「・チャートから」を添え、3 つのタップの申告と見分ける（Issue #12 AC-4）
  timeframeLonger: (r) =>
    r.from !== undefined && r.to !== undefined
      ? `時間足を変えた（${TIMEFRAME_NAME[r.from]} → ${TIMEFRAME_NAME[r.to]}${r.source === 'chart' ? '・チャートから' : ''}）`
      : '時間足を変えた',
  // レッグを持つ取引は決済したときの原資産を見せる（設計書 5.7 の 3。「LC で切らずに持ち続けた（原資産 37,300）」）
  heldPastLc: (r) =>
    r.underlying !== undefined
      ? `LC で切らずに持ち続けた（原資産 ${formatPrice(r.underlying)}）`
      : r.r !== undefined
        ? `LC で切らずに持ち続けた（${formatR(r.r)}）`
        : 'LC で切らずに持ち続けた',
  overRisk: (r) => `過剰リスク（${formatPct(r.riskPct)}）`,
  amountBasedLc: () => '金額ありきの LC',
  averagingDown: () => 'ナンピン',
  asPlannedLc: () => '決めた LC で切れた',
  stopFilled: () => '逆指値で切れた（証拠あり）',
  gapSlip: () => '窓・滑り',
  earlyExit: () => '早逃げ',
  riskNotChecked: (r) =>
    r.cause === 'noCapital'
      ? '資金が未設定のため、過剰リスクは判定していません'
      : '1R が出ないため、過剰リスクは判定していません',
};

/** 「最大損失まで」で負けた A の注記（#117・#114 の 3。LC の価格を置かない計画なので「決めた LC で」と言わない） */
export const MAX_LOSS_AS_PLANNED = '最大損失までの計画どおり';

/**
 * 理由の文言。side は文言の関数へ渡す向き（今はどの理由も向きで言葉を変えない。L / S で同じ言葉。#56）。
 * opts.maxLossPlan = オプションのポジションで「最大損失まで」が効いている（asPlannedLc の文言を替える）
 */
export function reasonText(
  reason: Reason,
  side: Side,
  opts: { readonly maxLossPlan?: boolean } = {},
): string {
  if (opts.maxLossPlan && reason.kind === 'asPlannedLc') return MAX_LOSS_AS_PLANNED;
  const fn = TEXT[reason.kind] as (r: Reason, s: Side) => string;
  return fn(reason, side);
}
