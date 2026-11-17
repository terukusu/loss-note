// 根拠の足のチャート（Issue #12。設計書 7.5・4.2・5.3、ADR-0006）の純関数。DOM・通信・端末の保存先に触れない。
// - 枠はエントリー時・決済時の 2 つ（1 枠 1 枚・どちらも任意）。利用者が枠を選んだ（フォーカスした）ときだけ、
//   貼った画像はその枠に入る。枠の外の貼り付けは今までどおり決済明細の読み取りへ（R1。chartSlotOf）
// - 時間足の欄は列挙の 9 つか空。チャートのある枠でだけ選べる（R2。本文に入れる条件は record-form.ts の readDraft）
// - 保存は [記録する] で取引と一緒に 1 要求（multipart。部分 record = JSON の文字、entryChart / exitChart = 画像）
import { TIMEFRAMES, type Timeframe } from '../../../core/trade';
import type { ImageType } from './image-limits';
import { TIMEFRAME_NAME } from './reasons';

export type ChartSlot = 'entry' | 'exit';
export const CHART_SLOTS: readonly ChartSlot[] = ['entry', 'exit'];

/** 枠の名前と、撮る足が分かる添え書き（別の足で撮っただけで「時間足を変えた」にならないように） */
export const CHART_SLOT_TEXT: Readonly<Record<ChartSlot, { name: string; hint: string }>> = {
  entry: { name: 'エントリー時', hint: 'エントリーの根拠にした足' },
  exit: { name: '決済時', hint: '決済の判断に使った足' },
};

/** 下書き・本文の時間足の欄 */
export const CHART_TIMEFRAME_FIELD = {
  entry: 'entryChartTimeframe',
  exit: 'exitChartTimeframe',
} as const satisfies Record<ChartSlot, string>;

/** multipart の部分の名前（API の charts.PART と同じ） */
export const CHART_PART: Readonly<Record<ChartSlot, string>> = {
  entry: 'entryChart',
  exit: 'exitChart',
};

/** 時間足の選択肢（短い順。「選ばない」は画面が先頭に足す） */
export const TIMEFRAME_CHOICES: readonly { value: Timeframe; label: string }[] = TIMEFRAMES.map(
  (v) => ({ value: v, label: TIMEFRAME_NAME[v] }),
);

export function isTimeframe(v: string): v is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(v);
}

/** 貼り付けの対象（DOM の要素の最小の形。テストは偽物を渡す） */
export interface ChartPasteTarget {
  getAttribute?(name: string): string | null;
}

/** 枠の要素の印（Record.tsx が枠に付ける data 属性） */
export const CHART_SLOT_ATTR = 'data-chart-slot';

/**
 * 貼り付けの行き先: 対象が枠そのもの（フォーカスがあり「ここに貼れます」の目印が出ている状態）ならその枠、
 * ほかは null（= 今までどおり決済明細の読み取りへ）。枠の中の時間足の欄・ボタン・ファイルの欄にフォーカスが
 * あるときはチャートにしない（目印が出ていないのにチャートが置き換わり、時間足が消えるのを防ぐ。目印と行き先を一致させる）
 */
export function chartSlotOf(target: ChartPasteTarget | null | undefined): ChartSlot | null {
  if (!target || typeof target.getAttribute !== 'function') return null;
  const v = target.getAttribute(CHART_SLOT_ATTR);
  return v === 'entry' || v === 'exit' ? v : null;
}

/** 送るチャート（描き直した後のバイト列と形式） */
export interface ChartUpload {
  readonly bytes: Uint8Array;
  readonly contentType: ImageType;
}

/** 取引とチャートを 1 要求で送る本文（Content-Type は付けない。境界は fetch が付ける） */
export function tradeFormData(
  record: unknown,
  charts: Readonly<Partial<Record<ChartSlot, ChartUpload>>>,
): FormData {
  const fd = new FormData();
  fd.append('record', JSON.stringify(record));
  for (const slot of CHART_SLOTS) {
    const c = charts[slot];
    if (!c) continue;
    const ext = c.contentType === 'image/png' ? 'png' : 'jpg';
    fd.append(
      CHART_PART[slot],
      new Blob([c.bytes as BlobPart], { type: c.contentType }),
      `chart.${ext}`,
    );
  }
  return fd;
}
