// 記録する画面の 1 段目で、スクショをまとめて選ぶ（#232・設計書 C67・7.5）。DOM・通信を持たない純関数。
// - 振り分けは本人が選んだ順だけで決める（AI を使わない）: 1 枚目 = 決済明細、2 枚目から = 空いているチャートの枠へ
//   エントリー時 → 決済時 → 追加 1〜5 の順。入らなかった枚数は知らせる（黙って捨てない）
// - 取り違え（明細とチャートが逆）: まとめて選んだ明細が「明細として読めない」で終わり、まとめて選んだチャートに入れ替える
//   相手（「チャートでない」と読めた最初の枠、無ければ読み取りで確かめられなかった最初の枠）があるときだけ、［入れ替える］ を出す
import { CHART_READ_MSG } from './chart-read';
import type { AnySlot, ChartSlot } from './charts';
import { READ_MSG } from './statement-fill';

/** チャートの枠の行き先（追加の枠の ID は controller が足すときに決める） */
export type PickTarget =
  | { readonly kind: 'main'; readonly slot: ChartSlot }
  | { readonly kind: 'extra' };

export interface PickPlan<T> {
  /** 明細の読み取りへ送る 1 枚（選んだ 1 枚目。0 枚なら null） */
  readonly statement: T | null;
  /** チャートの枠へ入れるもの（選んだ順） */
  readonly charts: readonly { readonly target: PickTarget; readonly file: T }[];
  /** 入らなかった枚数（枠が足りない） */
  readonly dropped: number;
}

/**
 * 選んだ順 → 振り分け。taken は前からチャートの入っている枠（飛ばす）、extrasFree はまだ足せる追加の枠の数
 */
export function planPicks<T>(
  files: readonly T[],
  opts: { readonly taken: Readonly<Record<ChartSlot, boolean>>; readonly extrasFree: number },
): PickPlan<T> {
  const [statement, ...rest] = files;
  if (statement === undefined) return { statement: null, charts: [], dropped: 0 };
  const targets: PickTarget[] = [];
  for (const slot of ['entry', 'exit'] as const) {
    if (!opts.taken[slot]) targets.push({ kind: 'main', slot });
  }
  for (let i = 0; i < Math.max(0, opts.extrasFree); i++) targets.push({ kind: 'extra' });
  const charts = rest.slice(0, targets.length).map((file, i) => ({
    target: targets[i] as PickTarget,
    file,
  }));
  return { statement, charts, dropped: rest.length - charts.length };
}

/**
 * チャートの枠の読み取りで分かったこと: chart = チャートと読めた（時間足が読めた・本人が選んでいた）/ notChart = チャートでない
 * と読めた / unknown = 確かめられなかった（失敗・上限・時間足の表示なし）/ pending = 描き直し中・読み取り中
 */
export type ChartCheck = 'chart' | 'notChart' | 'unknown' | 'pending';

export interface ChartLikeState {
  readonly phase: string;
  readonly read?: 'reading' | 'done' | undefined;
  readonly readNote?: string | null | undefined;
}

/** 枠の状態 → 読み取りで分かったこと（画像が無い・使えない枠は null） */
export function chartCheckOf(c: ChartLikeState | undefined): ChartCheck | null {
  if (!c) return null;
  if (c.phase === 'preparing') return 'pending';
  if (c.phase !== 'ready') return null;
  if (c.read !== 'done') return 'pending';
  if (c.readNote === CHART_READ_MSG.notChart) return 'notChart';
  return c.readNote ? 'unknown' : 'chart';
}

/**
 * 入れ替える相手の枠（出さなければ null）。statement はまとめて選んだ明細の今の状態、slots はまとめて選んだ画像がまだ入って
 * いる枠（選んだ順）。明細が「明細として読めない」で終わったときだけ。チャートと読めた枠は相手にしない（入れ替えても直らない）
 */
export function swapTargetOf(input: {
  readonly statement:
    | { readonly phase: string; readonly message?: string | null | undefined }
    | undefined;
  readonly charts: Readonly<Partial<Record<AnySlot, ChartLikeState>>> | undefined;
  readonly slots: readonly AnySlot[];
}): AnySlot | null {
  const st = input.statement;
  if (st?.phase !== 'failed' || st.message !== READ_MSG.notStatement) return null;
  const checks = input.slots.map((slot) => ({ slot, check: chartCheckOf(input.charts?.[slot]) }));
  const notChart = checks.find((c) => c.check === 'notChart');
  if (notChart) return notChart.slot;
  // 読み取り中の枠があれば結果を待つ（後で「チャートでない」と分かる枠を相手にするため）
  if (checks.some((c) => c.check === 'pending')) return null;
  return checks.find((c) => c.check === 'unknown')?.slot ?? null;
}

/** 2 段目の入れ替えの案内（相手の枠があるとき） */
export const BULK_SWAP_TEXT = '明細とチャートが逆かもしれません';

/** ［入れ替える］ の読み上げの名前 */
export function bulkSwapLabel(slotName: string): string {
  return `明細と${slotName}のチャートを入れ替える`;
}

/** 入らなかった枚数の 1 行 */
export function bulkDroppedText(n: number): string {
  return `選んだ画像のうち ${n} 枚は入れていません（チャートは 7 枚までです）。`;
}
