// 銘柄の名前の同一視（Issue #13 AC-8。設計書 4.1）。API の schema.name_key と同じ規則:
// NFKC → casefold（Python）→ 前後の空白を除く。JS に casefold は無いので toUpperCase().toLowerCase() で寄せる
// （ß → SS → ss、ς → Σ → σ）
import type { InstrumentRecord } from '../../../core/record';

export function nameKey(name: string): string {
  return name.normalize('NFKC').toUpperCase().toLowerCase().trim();
}

/** 一覧から同じ名前の銘柄を探す（空の名前は探さない） */
export function findInstrument(
  name: string,
  list: readonly InstrumentRecord[],
): InstrumentRecord | undefined {
  const key = nameKey(name);
  if (key === '') return undefined;
  return list.find((i) => nameKey(i.name) === key);
}
