// 設定の画面と記録する画面のつながり（Issue #5 AC-1 の後半・AC-7 の E14・E15・KEEP-3）。
// 設定の controller と記録の controller を同じ偽の API で動かす。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade } from '../../core/record';
import { formatPct } from '../../ui/src/lib/format';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import { type Draft, RISK_NOTE, summarize } from '../../ui/src/lib/record-form';
import { createSettingsController } from '../../ui/src/lib/settings-controller';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import { E6 } from './helpers/record-drafts';

const NOW = new Date(2026, 3, 5, 14, 37).getTime();

const XAU: InstrumentRecord = {
  id: 'i-xau',
  name: 'XAU',
  underlyingKind: 'commodity',
  productForm: 'spotCfd',
  // 円建て（1R・リスク（%）を価格から出せる。5.1）
  priceCurrency: 'JPY',
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

/** 記録する画面を開いて下書きを入れる（E6 = 5.1 の例: L・イン 100.00・LC 99.50・数量 10,000・決済 99.40） */
async function recordOpen(fake: FakeApi, d: Draft = E6): Promise<RecordController> {
  const rc = createRecordController({ api: fake.api, now: () => NOW });
  await rc.load();
  rc.update({ type: 'fill', values: d });
  return rc;
}

async function recordTrade(fake: FakeApi, name: string): Promise<StoredTrade> {
  const rc = await recordOpen(fake, { ...E6, instrumentName: name });
  await rc.save();
  const saved = rc.getState().saved?.trade;
  if (!saved) throw new Error(`保存できない: ${JSON.stringify(rc.getState().error)}`);
  return saved;
}

async function settingsOpen(fake: FakeApi) {
  const sc = createSettingsController({ api: fake.api });
  await sc.load();
  return sc;
}

describe('AC-1: 資金を保存した後の記録にリスク（%）が出る', () => {
  it('E1: 資金 1,000,000 を保存 → 記録する画面で E1 の取引のリスクは 0.5%', async () => {
    const fake = createFakeApi({ instruments: [{ ...XAU, id: 'i-us30', name: 'US30' }] });
    // 保存する前は「資金を設定すると出ます」（KEEP-3: 文言はそのまま）
    const before = await recordOpen(fake);
    expect(before.getState().read.preview.riskPct).toBeUndefined();
    expect(before.getState().read.preview.riskNote).toBe(RISK_NOTE.noCapital);

    const sc = await settingsOpen(fake);
    sc.setField('capital', '1,000,000');
    await sc.saveSettings();

    const rc = await recordOpen(fake);
    const p = rc.getState().read.preview;
    expect(p.riskPct).toBeCloseTo(0.5, 12);
    expect(formatPct(p.riskPct ?? Number.NaN)).toBe('0.5%');
  });
});

describe('AC-7: 直しても記録済みの取引は変わらず、以後の記録に効く（C36）', () => {
  it('E14: XAU の乗数 1 で T1 → 乗数を 100 に → T2。T1 の写しと判定は変わらない', async () => {
    const fake = createFakeApi({ instruments: [XAU], capitalYen: 1_000_000 });
    const t1 = await recordTrade(fake, 'XAU');
    const t1Before = summarize(t1);
    expect(t1.snapshot.instrument.multiplier).toBe(1);

    const sc = await settingsOpen(fake);
    sc.openInstrument(XAU.id);
    sc.updateInstrument('multiplier', '100');
    await sc.saveInstrument();
    expect(sc.getState().instruments[0]?.multiplier).toBe(100);

    const t2 = await recordTrade(fake, 'XAU');
    expect(t2.snapshot.instrument.multiplier).toBe(100);

    const t1After = fake.trades.find((t) => t.id === t1.id);
    expect(t1After?.snapshot.instrument.multiplier).toBe(1);
    expect(t1After && summarize(t1After)).toEqual(t1Before);
    // T2 は乗数 100 で 1R・リスクが 100 倍（以後の記録に効く）
    expect(summarize(t2).riskPct).toBeCloseTo((t1Before.riskPct ?? 0) * 100, 9);
  });

  it('E15: 資金が未設定のときに T3 → 資金を保存 → T3 は資金なしのまま、後の取引には出る', async () => {
    const fake = createFakeApi({ instruments: [XAU] });
    const t3 = await recordTrade(fake, 'XAU');
    expect(t3.snapshot.capitalYen).toBeNull();

    const sc = await settingsOpen(fake);
    sc.setField('capital', '1000000');
    await sc.saveSettings();

    const t3After = fake.trades.find((t) => t.id === t3.id);
    expect(t3After?.snapshot.capitalYen).toBeNull();
    const s3 = t3After ? summarize(t3After) : undefined;
    expect(s3?.riskPct).toBeUndefined();
    expect(s3?.riskNote).toBe(RISK_NOTE.noCapital);

    const t4 = await recordTrade(fake, 'XAU');
    expect(t4.snapshot.capitalYen).toBe(1_000_000);
    expect(summarize(t4).riskPct).toBeCloseTo(0.5, 12);
  });
});
