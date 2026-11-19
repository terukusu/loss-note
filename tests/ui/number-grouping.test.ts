// #40 価格・数量の 3 桁区切り（AC4・AC5）。表示の文字は区切りつき、入力の欄の値は区切りなしのまま。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { fxLine } from '../../ui/src/lib/currency';
import { draftFromStored } from '../../ui/src/lib/edit-form';
import { reasonText } from '../../ui/src/lib/reasons';
import { parseNum, summarize } from '../../ui/src/lib/record-form';
import { snapshotDiffs } from '../../ui/src/lib/resnapshot';
import { rulerItems } from '../../ui/src/lib/ruler-view';
import { instrumentSummary } from '../../ui/src/lib/settings-form';
import { recordFields } from '../../ui/src/lib/trade-view';
import { sizingLine, sizingText } from '../../ui/src/lib/verdict-notes';
import { SNAP_1M, stored, US30 } from './helpers/trade-examples';

// L、イン 38,250・数量 1,500・決めた LC 38,100 → 38,050 へ広げて 38,050 で決済。損益 (38,050 − 38,250) × 1,500 = −300,000 円、
// 手数料 1,234.5 円、資金 30,000,000 円・1%（許容額 300,000）。R = −200 / 150、提案の数量は手数料を含めた 1R から出るので 2,008（4 桁 = 区切りの確かめ）
// 比は約 0.75 → 0.8 倍（すべて架空の値）
const BIG = stored(
  'g1',
  {
    lc: 38_100,
    lcMove: { kind: 'widened', after: 38_050 },
    entries: [{ price: 38_250, quantity: 1_500 }],
    exit: {
      time: 1_700_000_000_000,
      price: 38_050,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    fees: [{ amountYen: 1_234.5 }],
    statementPnlYen: -300_000,
  },
  { snapshot: { ...SNAP_1M, capitalYen: 30_000_000 } },
);

const fields = Object.fromEntries(recordFields(BIG, '架空指数A').map((r) => [r.label, r.value]));

describe('#40 AC4: 表示の価格・数量は 3 桁区切り（丸めない）', () => {
  it('取引の詳細: イン・決済・数量・LC・広げた後の LC・手数料', () => {
    expect(fields.イン).toBe('38,250');
    expect(fields.決済).toBe('38,050');
    expect(fields.数量).toBe('1,500');
    expect(fields.LC).toBe('38,100');
    expect(fields['LC を動かしたか']).toBe('広げた（38,050）');
    expect(fields.手数料).toBe('1,234.5円');
  });

  it('理由の文: LC を広げた（38,100 → 38,050）', () => {
    expect(reasonText({ kind: 'lcWidened', from: 38_100, to: 38_050 }, 'L')).toBe(
      'LC を広げた（38,100 → 38,050）',
    );
  });

  it('LC の物差しの文字', () => {
    const ruler = summarize(BIG).ruler;
    if (!ruler) throw new Error('物差しが出ません');
    const texts = rulerItems(ruler).map((i) => i.price);
    expect(texts).toContain('38,250');
    expect(texts).toContain('38,100');
    expect(texts.every((t) => /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(t))).toBe(true);
  });

  it('判定の枠の数量の 1 行', () => {
    const segs = sizingLine(summarize(BIG), { pending: false });
    expect(segs === null ? null : sizingText(segs)).toBe(
      '数量 1,500 · 適正の数量 2,008（実際は 0.8 倍）',
    );
    expect(fields.提案の数量 ?? fields.適正の数量).toBe('2,008');
  });

  it('為替の欄の下の 1 行（入れた値。小数は丸めない）', () => {
    expect(fxLine({ price: 'BTC', account: 'JPY', entered: 15_000_000.5 })).toBe(
      '1 BTC = 15,000,000.5円',
    );
    expect(fxLine({ price: 'EUR', account: 'USD', entered: 1.08345 })).toBe('1 EUR = 1.08345 USD');
  });

  it('設定の銘柄の要約・記録したときの値との差（乗数・数量の刻み）', () => {
    const inst: InstrumentRecord = { ...US30, multiplier: 1_000, quantityStep: 0.01 };
    expect(instrumentSummary(inst)).toContain('乗数 1,000 · 刻み 0.01');
    const diffs = snapshotDiffs(SNAP_1M, {
      ...SNAP_1M,
      instrument: { ...SNAP_1M.instrument, multiplier: 10_000, quantityStep: 1_000 },
    });
    expect(diffs).toEqual(
      expect.arrayContaining([
        { label: '乗数', from: '1', to: '10,000' },
        { label: '数量の刻み', from: '1', to: '1,000' },
      ]),
    );
  });
});

describe('#40 AC5: 入力の欄の値は区切りを入れない', () => {
  it('編集の画面の既定値は区切りなし（下書きの値・変更の有無の比較を変えない）', () => {
    const d = draftFromStored(BIG, [US30]);
    expect(d.entryPrice).toBe('38250');
    expect(d.exitPrice).toBe('38050');
    expect(d.quantity).toBe('1500');
    expect(d.lc).toBe('38100');
    expect(d.feeYen).toBe('1234.5');
  });

  it('区切りつきの値を貼り付けても同じ数として読む', () => {
    for (const [raw, want] of [
      ['38,250', 38_250],
      [fields.イン ?? '', 38_250],
      ['1,234.5', 1_234.5],
    ] as const) {
      expect(parseNum(raw)).toEqual({ ok: true, value: want });
    }
  });
});
