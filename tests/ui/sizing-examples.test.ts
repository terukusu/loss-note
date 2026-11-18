// Issue #67 の例の表（数量の比と提案の数量）を、保存した取引の summarize・判定の枠の 1 行・詳細の「すべての欄」と、
// 記録する・詳細・編集・設定の controller と偽の API で通す（AC-1〜AC-3・AC-6・AC-7）。値・名前はすべて架空。
// 共通の場面 P: L、イン 100.00、LC 99.50、決済 99.50、乗数 1、数量の刻み 1、円建て。
// 口座 A = 資金 1,000,000・許容 1%、口座 B = 200,000・1%、口座 E = 1,000,000・0.5%。
// 許容額 = 資金 × 許容リスク ÷ 100、比 = 1R ÷ 許容額、提案 = 数量 × 許容額 ÷ 1R を刻みに切り捨て
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade, TradeSnapshot } from '../../core/record';
import { createEditController } from '../../ui/src/lib/edit-controller';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import { type Draft, EMPTY_DRAFT, type Summary, summarize } from '../../ui/src/lib/record-form';
import { createSettingsController } from '../../ui/src/lib/settings-controller';
import type { PreviewHandle } from '../../ui/src/lib/statement-image';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { recordFields, SIZING_LABEL } from '../../ui/src/lib/trade-view';
import { sizingLine, sizingText } from '../../ui/src/lib/verdict-notes';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import { E11 } from './helpers/record-drafts';
import { stored } from './helpers/trade-examples';

const NOW = new Date(2026, 3, 5, 14, 37).getTime();

const JP: InstrumentRecord = {
  id: 'i-jp',
  name: '架空指数A',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: 'JPY',
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const A = account('accA', '口座 A', 1_000_000);
const B = account('accB', '口座 B', 200_000);

/** 取引に写した値（円建て・乗数 1・刻み 1・口座 A） */
function snap(over: Partial<TradeSnapshot> = {}, inst: Partial<TradeSnapshot['instrument']> = {}) {
  return {
    instrument: {
      multiplier: 1,
      quantityStep: 1,
      priceCurrency: 'JPY',
      underlyingKind: 'index',
      productForm: 'spotCfd',
      ...inst,
    },
    capitalYen: 1_000_000,
    riskTolerancePct: 1,
    ...over,
  } as TradeSnapshot;
}

const exitAt = (price: number) => ({
  time: 1_800_000_000_000,
  price,
  orderType: 'unknown' as const,
  reason: 'other' as const,
  gapSlip: 'unanswered' as const,
});

/** Z6: USD 建て・決済 99.40・数量 100・明細の損益 −9,100・手数料 100・為替は空 */
const z6 = (step: number) =>
  stored(
    'z6',
    {
      entries: [{ price: 100, quantity: 100 }],
      exit: exitAt(99.4),
      statementPnlYen: -9_100,
      fees: [{ amountYen: 100 }],
    },
    { snapshot: snap({}, { priceCurrency: 'USD', quantityStep: step }) },
  );

/** Z8 / Z9: イン 38,000・乗数 100 */
const index = (id: string, lc: number, quantity: number) =>
  stored(
    id,
    { entries: [{ price: 38_000, quantity }], lc, exit: exitAt(lc) },
    { snapshot: snap({}, { multiplier: 100 }) },
  );

const Z: Record<string, StoredTrade> = {
  Z1: stored('z1', {}, { snapshot: snap() }),
  Z2: stored('z2', {}, { snapshot: snap({ capitalYen: 200_000 }) }),
  Z3: stored(
    'z3',
    { entries: [{ price: 100, quantity: 30_000 }] },
    { snapshot: snap({ riskTolerancePct: 0.5 }) },
  ),
  Z4: stored('z4', { entries: [{ price: 100, quantity: 20_000 }] }, { snapshot: snap() }),
  Z5: stored('z5', { entries: [{ price: 100, quantity: 10_400 }] }, { snapshot: snap() }),
  Z6: z6(1),
  Z7: z6(10),
  Z8: index('z8', 37_900, 2),
  Z9: index('z9', 37_600, 1),
  Z10: stored('z10', { side: 'S', lc: 100.5, exit: exitAt(100.5) }, { snapshot: snap() }),
  Z11: stored('z11', {}, { snapshot: snap({ capitalYen: null }) }),
  Z12: stored('z12', { lc: undefined, lcDecidedBeforeEntry: false }, { snapshot: snap() }),
  Z13: stored('z13', {}, { snapshot: snap({}, { priceCurrency: 'USD' }) }),
  Z14: stored(
    'z14',
    {
      entries: [
        { price: 100, quantity: 5_000 },
        { price: 99.8, quantity: 5_000 },
      ],
    },
    { snapshot: snap() },
  ),
};

const fieldsOf = (t: StoredTrade) =>
  Object.fromEntries(recordFields(t, '架空指数A').map((r) => [r.label, r.value]));

const line = (s: Summary) => {
  const segs = sizingLine(s, { pending: false });
  return segs === null ? null : sizingText(segs);
};

describe('AC-1: 例 Z1〜Z10 の比・表示の文字・提案の数量（保存した取引 → summarize → 判定の枠の 1 行・すべての欄）', () => {
  // [例, 比, 判定の枠の 1 行, すべての欄の比, すべての欄の提案]
  const cases = [
    // 1R 5,000 ÷ 許容額 10,000 = 0.5、提案 10,000 × 10,000 ÷ 5,000 = 20,000
    ['Z1', 0.5, '数量 10000 · 適正の数量 20000（実際は 0.5 倍）', '0.5 倍', '20000'],
    // 5,000 ÷ 2,000 = 2.5、10,000 × 2,000 ÷ 5,000 = 4,000
    ['Z2', 2.5, '数量 10000 · 適正の数量 4000（実際は 2.5 倍）', '2.5 倍', '4000'],
    // 15,000 ÷ 5,000 = 3.0、30,000 × 5,000 ÷ 15,000 = 10,000
    ['Z3', 3, '数量 30000 · 適正の数量 10000（実際は 3.0 倍）', '3.0 倍', '10000'],
    // 10,000 ÷ 10,000 = 1.0、20,000 × 10,000 ÷ 10,000 = 20,000
    ['Z4', 1, '数量 20000 · 適正の数量 20000（実際は 1.0 倍）', '1.0 倍', '20000'],
    // 5,200 ÷ 10,000 = 0.52 → 表示 0.6、10,400 × 10,000 ÷ 5,200 = 20,000
    ['Z5', 0.52, '数量 10400 · 適正の数量 20000（実際は 0.6 倍）', '0.6 倍', '20000'],
    // 1R = 9,000 × 0.50 ÷ 0.60 = 7,500 → 0.75 → 0.8、100 × 10,000 ÷ 7,500 = 133.3 → 133
    ['Z6', 0.75, '数量 100 · 適正の数量 133（実際は 0.8 倍）', '0.8 倍', '133'],
    // 刻み 10 → 130
    ['Z7', 0.75, '数量 100 · 適正の数量 130（実際は 0.8 倍）', '0.8 倍', '130'],
    // 1R = 100 × 2 × 100 = 20,000 → 2.0、2 × 10,000 ÷ 20,000 = 1
    ['Z8', 2, '数量 2 · 適正の数量 1（実際は 2.0 倍）', '2.0 倍', '1'],
    // 1R = 400 × 1 × 100 = 40,000 → 4.0、0.25 → 0
    [
      'Z9',
      4,
      '数量 1（許容リスクの 4.0 倍） · 最小の数量でも許容リスクを超えます',
      '4.0 倍',
      '0（最小の数量でも許容リスクを超えます）',
    ],
    // S で Z1 と同じ
    ['Z10', 0.5, '数量 10000 · 適正の数量 20000（実際は 0.5 倍）', '0.5 倍', '20000'],
  ] as const;

  it.each(cases)('%s', (name, ratio, want, fieldRatio, fieldSuggested) => {
    const t = Z[name] as StoredTrade;
    const s = summarize(t);
    expect(s.invalid).toBeUndefined();
    expect(Math.abs((s.sizing?.ratio ?? Number.NaN) - ratio)).toBeLessThanOrEqual(1e-9);
    expect(line(s)).toBe(want);
    const f = fieldsOf(t);
    expect(f[SIZING_LABEL.ratio]).toBe(fieldRatio);
    expect(f[SIZING_LABEL.suggested]).toBe(fieldSuggested);
  });

  it('すべての欄の 2 行は「数量」→「提案の数量」→「許容リスクに対する数量」の順', () => {
    const labels = recordFields(Z.Z1 as StoredTrade, '架空指数A').map((r) => r.label);
    const i = labels.indexOf('数量');
    expect(labels.slice(i, i + 3)).toEqual(['数量', '適正の数量', '許容リスクに対する数量']);
  });
});

describe('AC-2: Z11〜Z13 は比も提案の数量も出ない・AC-3: Z14 は比 0.4 倍だけ', () => {
  it.each(['Z11', 'Z12', 'Z13'])('%s', (name) => {
    const t = Z[name] as StoredTrade;
    const s = summarize(t);
    expect(s.sizing).toBeUndefined();
    expect(line(s)).toBeNull();
    const f = fieldsOf(t);
    expect(f).not.toHaveProperty(SIZING_LABEL.ratio);
    expect(f).not.toHaveProperty(SIZING_LABEL.suggested);
  });

  it('Z14: 1R = 0.50 × 5,000 + 0.30 × 5,000 = 4,000 → 0.4 倍。提案の数量は出さない', () => {
    const s = summarize(Z.Z14 as StoredTrade);
    expect(s.sizing?.ratio).toBeCloseTo(0.4, 12);
    expect(s.sizing).not.toHaveProperty('suggestedQuantity');
    // 数量は 2 つのエントリーの合計
    expect(line(s)).toBe('数量 10000（許容リスクの 0.4 倍）');
    const f = fieldsOf(Z.Z14 as StoredTrade);
    expect(f[SIZING_LABEL.ratio]).toBe('0.4 倍');
    expect(f).not.toHaveProperty(SIZING_LABEL.suggested);
  });

  it('取引の LC が無く、エントリーごとの LC だけの取引は出さない（判定の枠と「すべての欄」が揃う）', () => {
    // entries[0].lc 99.50 だけ（record.lc なし）。1R は 0.50 × 10,000 = 5,000 と出るが、LC なしの取引として扱う
    const t = stored(
      'z-entry-lc',
      { lc: undefined, entries: [{ price: 100, quantity: 10_000, lc: 99.5 }] },
      { snapshot: snap() },
    );
    const s = summarize(t);
    expect(s.noLc).toBe(true);
    expect(s.sizing).toBeUndefined();
    expect(line(s)).toBeNull();
    const f = fieldsOf(t);
    expect(f).not.toHaveProperty(SIZING_LABEL.ratio);
    expect(f).not.toHaveProperty(SIZING_LABEL.suggested);
  });

  it('判定を待つ間は出さない', () => {
    expect(sizingLine(summarize(Z.Z1 as StoredTrade), { pending: true })).toBeNull();
  });
});

// ---- controller と偽の API（Z15・Z16） ----

async function opened(fake: FakeApi): Promise<RecordController> {
  const c = createRecordController({ api: fake.api, now: () => NOW });
  await c.load();
  return c;
}

/** E11（場面 P）を銘柄 JP・数量・口座で下書きに入れる */
function fillP(c: RecordController, quantity: string, accountId: string) {
  const values: Partial<Draft> = {};
  for (const [k, v] of Object.entries(E11)) {
    if (v !== (EMPTY_DRAFT as unknown as Record<string, unknown>)[k]) {
      (values as Record<string, unknown>)[k] = v;
    }
  }
  c.update({ type: 'fill', values: { ...values, instrumentName: JP.name, quantity, accountId } });
}

const handle: PreviewHandle = { width: 1, height: 1, draw: () => {}, close: () => {} };

function fake(): FakeApi {
  return createFakeApi({ instruments: [JP], accounts: [defaultAccount(null), A, B] });
}

describe('AC-6: 例 Z15（記録する画面で数量と口座を変えると、その場で変わる）', () => {
  it('Z1 → 数量 30,000 で 1.5 倍・提案 20,000 → 口座 B で 7.5 倍・提案 4,000', async () => {
    const c = await opened(fake());
    fillP(c, '10000', A.id);
    expect(line(c.getState().read.preview)).toBe('数量 10000 · 適正の数量 20000（実際は 0.5 倍）');
    // 1R = 0.50 × 30,000 = 15,000 ÷ 10,000 = 1.5、30,000 × 10,000 ÷ 15,000 = 20,000
    c.update({ type: 'set', field: 'quantity', value: '30000' });
    expect(c.getState().read.preview.sizing?.ratio).toBeCloseTo(1.5, 12);
    expect(line(c.getState().read.preview)).toBe('数量 30000 · 適正の数量 20000（実際は 1.5 倍）');
    // B の許容額 2,000 → 15,000 ÷ 2,000 = 7.5、30,000 × 2,000 ÷ 15,000 = 4,000
    c.update({ type: 'set', field: 'accountId', value: B.id });
    expect(c.getState().read.preview.sizing?.ratio).toBeCloseTo(7.5, 12);
    expect(line(c.getState().read.preview)).toBe('数量 30000 · 適正の数量 4000（実際は 7.5 倍）');
    // 判定は今と同じ（B の 7.5% で過剰リスク）
    expect(c.getState().read.preview.judgment?.grade).toBe('B');
  });
});

describe('AC-7: 例 Z16（記録した後に口座の資金を直しても詳細の比は変わらず、付け替えたときだけ変わる）', () => {
  async function recordZ1(f: FakeApi): Promise<StoredTrade> {
    const c = await opened(f);
    fillP(c, '10000', A.id);
    await c.save();
    const t = c.getState().saved?.trade;
    if (!t) throw new Error(`保存できない: ${String(c.getState().error)}`);
    return t;
  }

  it('口座 A の資金を 500,000 に変えた後も、詳細は 0.5 倍・提案 20,000', async () => {
    const f = fake();
    const t = await recordZ1(f);
    const sc = createSettingsController({ api: f.api });
    await sc.load();
    sc.openAccount(A.id);
    sc.updateAccount('capital', '500000');
    await sc.saveAccount();
    expect(sc.getState().accounts.find((x) => x.id === A.id)?.capitalYen).toBe(500_000);
    const dc = createTradeDetailController({ api: f.api, id: t.id, preview: async () => handle });
    await dc.load();
    const s = dc.getState();
    if (s.phase !== 'ready') throw new Error(s.phase);
    expect(line(s.summary)).toBe('数量 10000 · 適正の数量 20000（実際は 0.5 倍）');
    expect(fieldsOf(s.trade)[SIZING_LABEL.ratio]).toBe('0.5 倍');
  });

  it('編集の画面で口座 B に付け替える → プレビューも保存の後も 2.5 倍・提案 4,000', async () => {
    const f = fake();
    const t = await recordZ1(f);
    const ec = createEditController({ api: f.api, id: t.id });
    await ec.load();
    expect(line(ec.getState().preview)).toBe('数量 10000 · 適正の数量 20000（実際は 0.5 倍）');
    ec.update({ type: 'set', field: 'accountId', value: B.id });
    expect(line(ec.getState().preview)).toBe('数量 10000 · 適正の数量 4000（実際は 2.5 倍）');
    await ec.save();
    const saved = ec.getState().trade as StoredTrade;
    expect(saved.snapshot.capitalYen).toBe(200_000);
    expect(line(summarize(saved))).toBe('数量 10000 · 適正の数量 4000（実際は 2.5 倍）');
    const ff = fieldsOf(saved);
    expect(ff[SIZING_LABEL.ratio]).toBe('2.5 倍');
    expect(ff[SIZING_LABEL.suggested]).toBe('4000');
  });
});
