// R・円の数字（契約 C-1）。色を付けず（本文の文字の色を継ぐ）、本文の書体の桁の揃う数字（tabular-nums）で符号と単位を必ず出す。
// 大きさは数字の 4 段（display / hero / title / row）と単位の文法（#236・設計書 C62。分け方は lib/num-tier.ts）
import { formatMoney, formatR, formatYen } from '../lib/format';
import { type NumTier, type NumView, numView, numViewOf } from '../lib/num-tier';

export type { NumTier };

/**
 * 段つきの数字。title 以上は単位を数の外の別の塊（.num-unit。数の 0.5 倍・太さ 500・2 番目の文字の色・同じ基線）にし、
 * 数と単位の間で折り返さない（.numu）。row は数と同じ塊。文字としての中身（読み上げ）は元の文字のまま
 */
function ViewNum({ view }: { readonly view: NumView }) {
  if (view.unit === null) return <span class={`num num--${view.tier}`}>{view.value}</span>;
  return (
    <span class={`numu numu--${view.tier}`}>
      <span class={`num num--${view.tier}`}>{view.value}</span>
      <span class="num-unit">{view.unit}</span>
    </span>
  );
}

/**
 * 表示の文字（formatR・formatPct などの出力）を段で出す。tier が無ければ周りの文字の大きさ（文の中の数字）。
 * quiet = 静かな形（危ない勝ち。段に入れず、本文より小さく・普通の太さ。色は置き場が 2 番目の文字の色にする。#227・C59）。
 * quiet のときは tier を見ない
 */
export function TierNum({
  text,
  tier,
  quiet,
}: {
  readonly text: string;
  readonly tier?: NumTier | undefined;
  readonly quiet?: boolean | undefined;
}) {
  if (quiet) return <span class="num num--quiet">{text}</span>;
  if (tier === undefined) return <span class="num">{text}</span>;
  return <ViewNum view={numView(text, tier)} />;
}

/** 分けてある数と単位（ホームの今月の規律の形 `{value, unit}`）を段で出す */
export function SplitNum({
  value,
  unit,
  tier,
}: {
  readonly value: string;
  readonly unit: string;
  readonly tier: NumTier;
}) {
  return <ViewNum view={numViewOf(value, unit, tier)} />;
}

export function RNum({
  value,
  tier,
  quiet,
}: {
  readonly value: number | null;
  readonly tier?: NumTier;
  readonly quiet?: boolean;
}) {
  return <TierNum text={formatR(value)} tier={tier} quiet={quiet} />;
}

export function YenNum({ value, tier }: { readonly value: number; readonly tier?: NumTier }) {
  return <TierNum text={formatYen(value)} tier={tier} />;
}

/**
 * 口座の通貨の損益（#47 PR-2・U29）。円は空きなし「−8,000円」、外貨は半角の空き「−50.00 USD」（formatMoney と同じ）。
 * 単位の置き方は段の文法に従う（row 以下は数と同じ塊。#236）
 */
export function MoneyNum({
  value,
  currency,
  tier,
  quiet,
}: {
  readonly value: number;
  readonly currency: string;
  readonly tier?: NumTier;
  /** 静かな形（危ない勝ちの損益。RNum の quiet と同じ。#227・C59） */
  readonly quiet?: boolean;
}) {
  return <TierNum text={formatMoney(value, currency)} tier={tier} quiet={quiet} />;
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
