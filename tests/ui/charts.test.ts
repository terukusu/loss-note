// 根拠の足のチャートの純関数（Issue #12 契約 P-1・AC-2・R1・R2）。値・画像はすべて架空
import { describe, expect, it } from 'vitest';
import { TIMEFRAMES } from '../../core/trade';
import {
  CHART_PART,
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  type ChartPasteTarget,
  chartSlotOf,
  isTimeframe,
  TIMEFRAME_CHOICES,
  tradeFormData,
} from '../../ui/src/lib/charts';
import { jpegBytes, pngBytes } from './helpers/statement-rows';

/** DOM の要素の偽物（data-chart-slot を持つ枠そのもの / 持たない要素） */
function el(slot: string | null): ChartPasteTarget {
  return { getAttribute: (n) => (n === 'data-chart-slot' ? slot : null) };
}

describe('貼り付けの行き先 chartSlotOf（AC-2・E14・R1）', () => {
  it('枠そのもの（輪と「ここに貼れます」が出ている状態）→ その枠', () => {
    expect(chartSlotOf(el('entry'))).toBe('entry');
    expect(chartSlotOf(el('exit'))).toBe('exit');
  });

  it('枠の中の時間足の欄・ボタン・ファイルの欄 → null（目印が出ていないのでチャートにしない。明細の側へ）', () => {
    // 枠の中の要素は data-chart-slot を持たない（祖先を辿らない）
    expect(chartSlotOf(el(null))).toBeNull();
  });

  it('枠の外（数値の欄・本文）・対象なし → null（= 決済明細の読み取りへ）', () => {
    expect(chartSlotOf(el(null))).toBeNull();
    expect(chartSlotOf(null)).toBeNull();
    expect(chartSlotOf(undefined)).toBeNull();
    expect(chartSlotOf({})).toBeNull();
  });

  it('知らない枠の名前は null（行き先を作らない）', () => {
    for (const bad of ['', 'Entry', 'middle', 'entry ', '__proto__']) {
      expect(chartSlotOf(el(bad))).toBeNull();
    }
  });
});

describe('枠の文言と時間足の選択肢（R2）', () => {
  it('枠は 2 つ。名前と撮る足が分かる添え書き', () => {
    expect(CHART_SLOTS).toEqual(['entry', 'exit']);
    expect(CHART_SLOT_TEXT.entry).toEqual({
      name: 'エントリー時',
      hint: 'エントリーの根拠にした足',
    });
    expect(CHART_SLOT_TEXT.exit).toEqual({ name: '決済時', hint: '決済の判断に使った足' });
    expect(CHART_TIMEFRAME_FIELD).toEqual({
      entry: 'entryChartTimeframe',
      exit: 'exitChartTimeframe',
    });
  });

  it('時間足は列挙の 9 つ（短い順・表示名つき）', () => {
    expect(TIMEFRAME_CHOICES.map((c) => c.value)).toEqual([...TIMEFRAMES]);
    expect(TIMEFRAME_CHOICES).toHaveLength(9);
    expect(TIMEFRAME_CHOICES.find((c) => c.value === '4h')?.label).toBe('4 時間足');
    expect(TIMEFRAME_CHOICES.find((c) => c.value === '1d')?.label).toBe('日足');
    expect(isTimeframe('1M')).toBe(true);
    expect(isTimeframe('')).toBe(false);
    expect(isTimeframe('2h')).toBe(false);
  });
});

describe('取引とチャートを 1 要求で送る本文 tradeFormData（API-1）', () => {
  it('record は JSON の文字、画像はその枠の部分に形式つきの Blob', async () => {
    const entry = pngBytes(1200, 800, 3000, 7);
    const exit = jpegBytes(1200, 800, 2000, 9);
    const record = { side: 'L', entryChartTimeframe: '4h' };
    const fd = tradeFormData(record, {
      entry: { bytes: entry, contentType: 'image/png' },
      exit: { bytes: exit, contentType: 'image/jpeg' },
    });
    const names: string[] = [];
    fd.forEach((_v, k) => {
      names.push(k);
    });
    expect(names).toEqual(['record', CHART_PART.entry, CHART_PART.exit]);
    expect(JSON.parse(String(fd.get('record')))).toEqual(record);
    const e = fd.get('entryChart') as Blob;
    const x = fd.get('exitChart') as Blob;
    expect([e.type, e.size, x.type, x.size]).toEqual(['image/png', 3000, 'image/jpeg', 2000]);
    expect(new Uint8Array(await e.arrayBuffer())).toEqual(entry);
  });

  it('チャートの無い枠の部分は付けない', () => {
    const fd = tradeFormData(
      {},
      { exit: { bytes: pngBytes(10, 10, 100), contentType: 'image/png' } },
    );
    expect(fd.get('entryChart')).toBeNull();
    expect(fd.get('exitChart')).not.toBeNull();
  });
});
