// 数字の段と単位の文法（#236・設計書 C62・ui-guidelines 9.9）。DOM を持たない純関数
//
// 段は 4 つ: display 56px（振り返りの規律コストだけ・1 画面に 1 つ）/ hero 40px（1 件の取引の判定の枠の R）/
// title 28px（ホームの今月の規律・振り返りの計画どおり率・下の帯の R）/ row 20px（行の R・判定の枠のリスクと損益）。
// title 以上は単位（R・%・円・通貨の 3 文字）を数の外の別の塊にし、row は数と同じ塊のまま（0.5 倍だと 12px を下回るため）

export type NumTier = 'display' | 'hero' | 'title' | 'row';

/** 単位を数の外の別の塊にする段（大きさは数の 0.5 倍） */
export const UNIT_APART: Readonly<Record<NumTier, boolean>> = {
  display: true,
  hero: true,
  title: true,
  row: false,
};

/** 数（符号・桁区切り・小数）と単位（R・%・円・半角の空き + 通貨の 3 文字） */
const NUM_UNIT = /^([−+±-]?[\d,]+(?:\.\d+)?)(R|%|円| [A-Z]{3})$/;

/**
 * 表示の文字（formatR・formatPct・formatRate・formatMoney の出力）を数と単位に分ける。単位で終わらない文字（「R なし」
 * 「損益なし」など）は分けず、単位を '' にする。value + unit は元の文字と同じ（読み上げ・文字としての中身を変えない）
 */
export function splitNumUnit(text: string): { readonly value: string; readonly unit: string } {
  const m = NUM_UNIT.exec(text);
  if (!m) return { value: text, unit: '' };
  return { value: m[1] as string, unit: m[2] as string };
}

/** 段を決める。+ で始まる値は display に出さない（hero に下げる。大きい数字 = 計画どおりに出た数。C59・C62） */
export function tierOf(tier: NumTier, value: string): NumTier {
  return tier === 'display' && value.startsWith('+') ? 'hero' : tier;
}

/** 表示の形。unit が null = 数と単位が 1 つの塊（row の段・単位の無い文字） */
export interface NumView {
  readonly tier: NumTier;
  readonly value: string;
  readonly unit: string | null;
}

/** 分けた数と単位 → 表示の形 */
export function numViewOf(value: string, unit: string, tier: NumTier): NumView {
  const t = tierOf(tier, value);
  if (!UNIT_APART[t] || unit === '') return { tier: t, value: value + unit, unit: null };
  return { tier: t, value, unit };
}

/** 表示の文字 → 表示の形 */
export function numView(text: string, tier: NumTier): NumView {
  const { value, unit } = splitNumUnit(text);
  return numViewOf(value, unit, tier);
}
