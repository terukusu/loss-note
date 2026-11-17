// R・円の数字（契約 C-1）。色を付けず（本文の文字の色を継ぐ）、等幅で符号と単位を必ず出す
import { formatR, formatYen } from '../lib/format';

type Size = 'md' | 'lg' | 'xl';

function cls(size: Size | undefined): string {
  return size && size !== 'md' ? `num num--${size}` : 'num';
}

export function RNum({ value, size }: { readonly value: number | null; readonly size?: Size }) {
  return <span class={cls(size)}>{formatR(value)}</span>;
}

export function YenNum({ value, size }: { readonly value: number; readonly size?: Size }) {
  return <span class={cls(size)}>{formatYen(value)}</span>;
}
