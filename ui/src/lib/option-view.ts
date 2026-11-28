// オプションのポジションの見せ方の純関数（#117。設計書 5.7・7.6・C47・C49・C50）。DOM・通信なし。
// - 判定の枠と詳細の 1R の出どころの 1 語・最大損失の 1 行・向きの食い違いの 1 行・足を直した 1 行
// - 詳細の足の行（損益つき。数字は無色 = 色の情報を持たない。C34）
// - 一覧の行の「足 3」

import type { OneRSource, OptionMaxLoss } from '../../../core/option';
import { legPnlPrice } from '../../../core/option';
import type { StoredTrade } from '../../../core/record';
import { toTradeInput } from '../../../core/record';
import type { Leg } from '../../../core/trade';
import { formatAmount, formatMoney, formatPlain, formatPrice } from './format';
import { LEG_SIDE_LABEL } from './legs-form';
import type { OptionSummary } from './record-form';

/** 1R の出どころの名前（C49。「すべての欄」の行の値。判定の枠は「1R は〈名前〉から」） */
export const ONE_R_SOURCE_LABEL: Readonly<Record<OneRSource, string>> = {
  plan: 'LC での損失の見込み',
  actualMove: '実際の動き',
  expiry: '満期の損益',
  maxLoss: '最大損失',
};

/** 向きの食い違い（C47。#114 の 2） */
export const SIDE_MISMATCH =
  'LC の向きと足の形の向きが合いません。エントリー時の原資産を確認してください';
/** 直す画面で足を直したとき（4.7） */
export const LEGS_EDITED = '足を編集したので、損益は足の合計です';
/** 「最大損失まで」で負けた A の注記（#114 の 3。core の asPlannedLc の文言を替える） */
export { MAX_LOSS_AS_PLANNED } from './reasons';

/** 最大損失の 1 行（C50。「最大損失 250,000円」/「最大損失は定まらない（売りの裸）」） */
export function maxLossText(m: OptionMaxLoss, currency: string): string {
  if (m.defined) {
    return m.yen === undefined
      ? '最大損失は為替を入力すると表示されます'
      : `最大損失 ${formatAmount(m.yen, currency)}`;
  }
  if (m.cause === 'unbounded') return '最大損失は定まらない（売りの裸）';
  if (m.cause === 'contractMonths') return '最大損失は定まらない（限月が違う）';
  return '最大損失は定まらない（満期で損失の出ない形）';
}

/** 1R の出どころの 1 行（1R が出たときだけ） */
export function oneRSourceText(source: OneRSource | undefined): string | null {
  if (source === undefined) return null;
  const label = ONE_R_SOURCE_LABEL[source];
  // 英数字の前は半角の空き（「1R は LC での損失の見込みから」）
  return `1R は${/^[A-Za-z0-9]/.test(label) ? ' ' : ''}${label}から`;
}

/**
 * 判定の枠の数の下に添える行。facts は 1R の出どころと最大損失を「 · 」でつないだ 1 行（離すと何の見込みか読み取りにくい。
 * デザインレビュー N3）、maxLossTip は最大損失の「i」を添えるか。判定が出ていない間（pending）は出さない
 */
export function optionVerdictLines(
  o: OptionSummary | undefined,
  currency: string,
  opts: { readonly legsEdited?: boolean } = {},
): {
  readonly facts: readonly string[];
  readonly maxLossTip: boolean;
  readonly warnings: readonly string[];
} {
  const parts: string[] = [];
  const warnings: string[] = [];
  if (o !== undefined) {
    const src = oneRSourceText(o.oneRSource);
    if (src !== null) parts.push(src);
    if (o.maxLoss !== undefined) parts.push(maxLossText(o.maxLoss, currency));
    if (o.sideMismatch) warnings.push(SIDE_MISMATCH);
  }
  if (opts.legsEdited) warnings.push(LEGS_EDITED);
  return {
    facts: parts.length === 0 ? [] : [parts.join(' · ')],
    maxLossTip: o?.maxLoss !== undefined,
    warnings,
  };
}

/** 詳細の足の 1 行（720px 未満は 2 行のカード、以上は 1 行の表で同じ値を使う） */
export interface LegRowView {
  readonly id: string;
  readonly contractMonth: string;
  readonly optionType: 'P' | 'C';
  readonly strike: string;
  readonly side: string;
  readonly quantity: string;
  readonly entry: string;
  readonly exit: string;
  readonly expired: boolean;
  /** 損益（口座の通貨。為替が出なければ「—」）。色は付けない（C34） */
  readonly pnl: string;
  /** カードの 1 行目「売り 2 · P 36,000 · 2027-01」 */
  readonly head: string;
  /** カードの 2 行目「120 → 60」 */
  readonly prices: string;
}

export function legRows(t: Pick<StoredTrade, 'record' | 'snapshot'>): readonly LegRowView[] {
  const legs = t.record.legs;
  if (legs === undefined) return [];
  const input = toTradeInput(t);
  const fx = input.instrument.priceInAccountCurrency ? 1 : input.exit?.fxRate;
  const currency = t.snapshot.accountCurrency ?? 'JPY';
  return legs.map((l: Leg) => {
    const pnl =
      fx === undefined
        ? '—'
        : formatMoney(legPnlPrice(l, input.instrument.multiplier) * fx, currency);
    const side = LEG_SIDE_LABEL[l.side];
    const quantity = formatPlain(l.quantity);
    const strike = formatPrice(l.strike);
    const entry = formatPrice(l.entry.price);
    const exit = formatPrice(l.exit.price);
    const expired = l.exit.kind === 'expired';
    return {
      id: l.id,
      contractMonth: l.contractMonth,
      optionType: l.optionType,
      strike,
      side,
      quantity,
      entry,
      exit,
      expired,
      pnl,
      head: `${side} ${quantity} · ${l.optionType} ${strike} · ${l.contractMonth}`,
      prices: `${entry} → ${exit}${expired ? ' 満期で消滅' : ''}`,
    };
  });
}

/** 一覧の行の 1 行目に添える「足 3」（足の無い取引は null） */
export function legCountText(t: Pick<StoredTrade, 'record'>): string | null {
  const n = t.record.legs?.length;
  return n === undefined ? null : `足 ${n}`;
}
