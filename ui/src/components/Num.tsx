// R・円の数字（契約 C-1）。色を付けず（本文の文字の色を継ぐ）、本文の書体の桁の揃う数字（tabular-nums）で符号と単位を必ず出す
import { formatMoney, formatR, formatYen } from '../lib/format';

type Size = 'md' | 'lg' | 'xl';

function cls(size: Size | undefined): string {
  return size && size !== 'md' ? `num num--${size}` : 'num';
}

/**
 * quiet = 静かな形（危ない勝ちの R。主役の数字の段に出さず、本文より小さく・2 番目の文字の色・普通の太さ。#227・C59）。
 * quiet のときは size を見ない
 */
export function RNum({
  value,
  size,
  quiet,
}: {
  readonly value: number | null;
  readonly size?: Size;
  readonly quiet?: boolean;
}) {
  return <span class={quiet ? 'num num--quiet' : cls(size)}>{formatR(value)}</span>;
}

export function YenNum({ value, size }: { readonly value: number; readonly size?: Size }) {
  return <span class={cls(size)}>{formatYen(value)}</span>;
}

/**
 * 口座の通貨の損益（#47 PR-2・U29）。数を .num に、単位（円・通貨の 3 文字）は .num の外に小さく
 * （.num-unit = --fs-sm・--ink-2）出す
 */
export function MoneyNum({
  value,
  currency,
  size,
  quiet,
}: {
  readonly value: number;
  readonly currency: string;
  readonly size?: Size;
  /** 静かな形（危ない勝ちの損益。RNum の quiet と同じ。#227・C59） */
  readonly quiet?: boolean;
}) {
  // 円も外貨も、単位は数の外に小さく（決定 2.6 を円にも当てる。#47 PR-2 デザイン 7）。円は空きなし「−8,000円」、
  // 外貨は半角の空き「−50.00 USD」（読み上げ・文字としては formatMoney と同じ）
  const text = formatMoney(value, currency);
  const suffix = currency === 'JPY' ? '円' : ` ${currency}`;
  const num = text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
  return (
    <span class="num-money">
      <span class={quiet ? 'num num--quiet' : cls(size)}>{num}</span>
      {num === text ? null : <span class="num-unit">{suffix}</span>}
    </span>
  );
}

/** 文の中の金額（「10,000円」「100.00 USD」）。数と単位を 1 つの塊にする（#47 PR-2 デザイン 8） */
const AMOUNT = /[−+±]?[\d,]+(?:\.\d+)?(?:円| [A-Z]{3}\b)/g;

/** 文の中の金額を、数と単位が行の境目で離れない塊（.num-money）にする。ほかの文字はそのまま（HTML にしない） */
export function AmountText({ text }: { readonly text: string }) {
  const out: (string | ReturnType<typeof AmountPart>)[] = [];
  let last = 0;
  for (const m of text.matchAll(AMOUNT)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<AmountPart key={i} value={m[0]} />);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function AmountPart({ value }: { readonly value: string }) {
  return <span class="num-money">{value}</span>;
}
