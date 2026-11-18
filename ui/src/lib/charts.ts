// 根拠の足のチャート（Issue #12。設計書 7.5・4.2・5.3、ADR-0006）の純関数。DOM・通信・端末の保存先に触れない。
// - 枠はエントリー時・決済時の 2 つ（1 枠 1 枚・どちらも任意）。利用者が枠を選んだ（フォーカスした）ときだけ、
//   貼った画像はその枠に入る。枠の外の貼り付けは今までどおり決済明細の読み取りへ（R1。chartSlotOf）
// - 時間足の欄は列挙の 9 つか空。チャートのある枠でだけ選べる（R2。本文に入れる条件は record-form.ts の readDraft）
// - 保存は [記録する] で取引と一緒に 1 要求（multipart。部分 record = JSON の文字、entryChart / exitChart = 画像）
// - 付属のチャート（#89）: 枠 x1〜x5（最大 5 枚・追加した順。判定に使わない）。各枚に任意の時間足と一言（40 字まで）。
//   並び・時間足・一言は記録の extraCharts。編集の保存は取引の PUT の multipart（差し替え・足す画像 + 外す枠 removeChart）
import type { ExtraChart, ExtraChartSlot } from '../../../core/record';
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

/** 付属のチャートの枠（#89。最大 5 枚） */
export type ExtraSlot = ExtraChartSlot;
export const EXTRA_SLOTS: readonly ExtraSlot[] = ['x1', 'x2', 'x3', 'x4', 'x5'];
/** すべての枠（エントリー時・決済時・付属） */
export type AnySlot = ChartSlot | ExtraSlot;
export const ALL_SLOTS: readonly AnySlot[] = [...CHART_SLOTS, ...EXTRA_SLOTS];
/** 付属の一言の上限（API と同じ） */
export const EXTRA_NOTE_MAX = 40;
export const EXTRA_FULL = `追加のチャートは ${EXTRA_SLOTS.length} 枚までです。`;
export const extraNoteTooLong = `一言は ${EXTRA_NOTE_MAX} 字までです。`;

export function isMainSlot(slot: AnySlot): slot is ChartSlot {
  return slot === 'entry' || slot === 'exit';
}

/** 付属の枠の表示の名前（並びの番号。1 から） */
export function extraName(index: number): string {
  return `追加のチャート ${index + 1}`;
}

/** 付属の枠の 1 行（画面の状態。時間足・一言は下書き） */
export interface ExtraEntry {
  readonly slot: ExtraSlot;
  readonly timeframe: Timeframe | null;
  readonly note: string;
}

/** 空いている付属の枠（無ければ null） */
export function freeExtraSlot(used: readonly { readonly slot: ExtraSlot }[]): ExtraSlot | null {
  return EXTRA_SLOTS.find((s) => !used.some((e) => e.slot === s)) ?? null;
}

/** 保存した付属の並び → 画面の行 */
export function extrasFromRecord(extras: readonly ExtraChart[] | undefined): ExtraEntry[] {
  return (extras ?? []).map((e) => ({
    slot: e.slot,
    timeframe: e.timeframe ?? null,
    note: e.note ?? '',
  }));
}

/**
 * 画面の行 → 記録の extraCharts（画像のある枠だけ・並びのまま。空の一言は入れない）。
 * 1 枚も無ければ undefined（鍵を置かない = 付属の無い取引は今と同じ形）
 */
export function extrasBody(
  extras: readonly ExtraEntry[],
  hasChart: (slot: ExtraSlot) => boolean,
): readonly ExtraChart[] | undefined {
  const out = extras
    .filter((e) => hasChart(e.slot))
    .map((e) => ({
      slot: e.slot,
      ...(e.timeframe === null ? {} : { timeframe: e.timeframe }),
      ...(e.note.trim() === '' ? {} : { note: e.note.trim() }),
    }));
  return out.length > 0 ? out : undefined;
}

/** 一言が長すぎる付属の枠 */
export function extraNoteErrors(extras: readonly ExtraEntry[]): readonly ExtraSlot[] {
  return extras.filter((e) => [...e.note.trim()].length > EXTRA_NOTE_MAX).map((e) => e.slot);
}

/**
 * チャートつきの保存の時間の上限（#89）: 30 秒 + 送る画像 1 MB ごとに 10 秒（7 枚で約 3.6 MB → 70 秒。携帯の回線で
 * 1 Mbps 前後でも届くように）
 */
export function chartSaveTimeoutMs(
  uploads: Readonly<Partial<Record<AnySlot, ChartUpload>>>,
): number {
  const total = Object.values(uploads).reduce((n, u) => n + (u?.bytes.byteLength ?? 0), 0);
  return 30_000 + Math.ceil(total / 1_000_000) * 10_000;
}

/** 下書き・本文の時間足の欄 */
export const CHART_TIMEFRAME_FIELD = {
  entry: 'entryChartTimeframe',
  exit: 'exitChartTimeframe',
} as const satisfies Record<ChartSlot, string>;

/** multipart の部分の名前（API の charts.PART と同じ） */
export const CHART_PART: Readonly<Record<AnySlot, string>> = {
  entry: 'entryChart',
  exit: 'exitChart',
  x1: 'x1Chart',
  x2: 'x2Chart',
  x3: 'x3Chart',
  x4: 'x4Chart',
  x5: 'x5Chart',
};
/** 取引の直しの multipart で外す枠の部分（API の charts.REMOVE_PART と同じ） */
export const CHART_REMOVE_PART = 'removeChart';

/** 時間足の選択肢（短い順。「指定なし」は画面が先頭に足す） */
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
export function chartSlotOf(target: ChartPasteTarget | null | undefined): AnySlot | null {
  if (!target || typeof target.getAttribute !== 'function') return null;
  const v = target.getAttribute(CHART_SLOT_ATTR);
  return (ALL_SLOTS as readonly (string | null)[]).includes(v) ? (v as AnySlot) : null;
}

/** 送るチャート（描き直した後のバイト列と形式） */
export interface ChartUpload {
  readonly bytes: Uint8Array;
  readonly contentType: ImageType;
}

/**
 * 取引とチャートを 1 要求で送る本文（Content-Type は付けない。境界は fetch が付ける）。
 * removes は取引の直しだけ（外す枠。#89）
 */
export function tradeFormData(
  record: unknown,
  charts: Readonly<Partial<Record<AnySlot, ChartUpload>>>,
  removes: readonly AnySlot[] = [],
): FormData {
  const fd = new FormData();
  fd.append('record', JSON.stringify(record));
  for (const slot of removes) fd.append(CHART_REMOVE_PART, slot);
  for (const slot of ALL_SLOTS) {
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
