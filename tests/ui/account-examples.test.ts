// Issue #47 PR-1 の例の表（口座と snapshot・記録する画面の口座・直す画面）を、記録・直す・設定の controller と偽の API で
// 通す（AC-3・AC-4・AC-6・AC-7・AC-8）。値・名前はすべて架空。
// 共通の場面 P: L、イン 100.00、LC 99.50、乗数 1、3 つのタップはすべて計画どおり、LC の根拠はチャート（E11 = 決済 99.50）。
// 円建ての銘柄なので 1R = 丨イン − LC丨 × 数量 × 乗数 = 0.50 × 数量、リスク（%）= 1R ÷ 口座の資金 × 100
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade } from '../../core/record';
import { createEditController } from '../../ui/src/lib/edit-controller';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import { type Draft, EMPTY_DRAFT, summarize } from '../../ui/src/lib/record-form';
import { createSettingsController } from '../../ui/src/lib/settings-controller';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi, type FakeOptions } from './helpers/fake-api';
import { E11, NO_CAPITAL } from './helpers/record-drafts';

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
const E = account('accE', '口座 E', 1_000_000, 0.5);

async function opened(fake: FakeApi): Promise<RecordController> {
  const c = createRecordController({ api: fake.api, now: () => NOW });
  await c.load();
  return c;
}

/** 下書きを例の値にそろえ（口座も）、記録して保存した取引を返す */
async function record(fake: FakeApi, accountId: string, quantity = '10000'): Promise<StoredTrade> {
  const c = await opened(fake);
  const values: Partial<Draft> = {};
  for (const [k, v] of Object.entries(E11)) {
    if (v !== (EMPTY_DRAFT as unknown as Record<string, unknown>)[k]) {
      (values as Record<string, unknown>)[k] = v;
    }
  }
  c.update({
    type: 'fill',
    values: { ...values, instrumentName: JP.name, quantity, accountId },
  });
  expect(c.getState().read.canSave).toBe(true);
  await c.save();
  const t = c.getState().saved?.trade;
  if (!t) throw new Error(`保存できない: ${String(c.getState().error)}`);
  return t;
}

function fake(opts: FakeOptions = {}): FakeApi {
  return createFakeApi({ instruments: [JP], accounts: [defaultAccount(null), A, B, E], ...opts });
}

describe('AC-3: 例 A1〜A3・A8（取引は記録したときの口座の資金で計算。過剰リスクの境目は 2% のまま）', () => {
  it('A1: 口座 A（1,000,000・1%）・数量 10,000 → 1R 5,000 円・0.5%・−1.0R・A', async () => {
    const f = fake();
    const t = await record(f, A.id);
    expect(t.record.accountId).toBe(A.id);
    expect(t.snapshot.capitalYen).toBe(1_000_000);
    const s = summarize(t);
    // 1R = 0.50 × 10,000 × 1 = 5,000 円、リスク = 5,000 ÷ 1,000,000 × 100 = 0.5%
    expect(s.oneRYen).toBeCloseTo(5000, 9);
    expect(s.riskPct).toBeCloseTo(0.5, 12);
    expect(s.r).toBeCloseTo(-1, 12);
    expect(s.judgment?.grade).toBe('A');
  });

  it('A2: 同じ取引を口座 B（200,000・1%）で → 1R 5,000 円・2.5%・B（過剰リスク（2.5%））', async () => {
    const t = await record(fake(), B.id);
    const s = summarize(t);
    // リスク = 5,000 ÷ 200,000 × 100 = 2.5%（> 2% で過剰リスク）
    expect(s.oneRYen).toBeCloseTo(5000, 9);
    expect(s.riskPct).toBeCloseTo(2.5, 12);
    expect(s.judgment?.grade).toBe('B');
    expect(s.judgment?.reasons.some((r) => r.kind === 'overRisk')).toBe(true);
  });

  it('A3: A1 の後に口座 A の資金を 500,000 に直し、同じ値でもう 1 件 → 1 件目 0.5% のまま、2 件目 1.0%', async () => {
    const f = fake();
    const first = await record(f, A.id);
    const sc = createSettingsController({ api: f.api });
    await sc.load();
    sc.openAccount(A.id);
    sc.updateAccount('capital', '500,000');
    await sc.saveAccount();
    expect(sc.getState().accounts.find((x) => x.id === A.id)?.capitalYen).toBe(500_000);
    const second = await record(f, A.id);
    const stored = f.trades.find((x) => x.id === first.id) as StoredTrade;
    expect(summarize(stored).riskPct).toBeCloseTo(0.5, 12);
    // 5,000 ÷ 500,000 × 100 = 1.0%
    expect(summarize(second).riskPct).toBeCloseTo(1.0, 12);
  });

  it('A8: 口座 E（1,000,000・許容 0.5%）・数量 30,000 → 1R 15,000 円・1.5%・A（許容を超えても 2% 以下）', async () => {
    const t = await record(fake(), E.id, '30000');
    const s = summarize(t);
    // 1R = 0.50 × 30,000 = 15,000 円、リスク = 15,000 ÷ 1,000,000 × 100 = 1.5%
    expect(s.oneRYen).toBeCloseTo(15_000, 9);
    expect(s.riskPct).toBeCloseTo(1.5, 12);
    expect(s.judgment?.grade).toBe('A');
    expect(t.snapshot.riskTolerancePct).toBe(0.5);
  });
});

describe('AC-4: 例 A4（直す画面で口座を付け替える / 付け替えない）', () => {
  async function a1AfterCapitalChange() {
    const f = fake();
    const t = await record(f, A.id);
    // 口座 A の資金を 500,000 に直した後
    const sc = createSettingsController({ api: f.api });
    await sc.load();
    sc.openAccount(A.id);
    sc.updateAccount('capital', '500000');
    await sc.saveAccount();
    const ec = createEditController({ api: f.api, id: t.id });
    await ec.load();
    return { f, t, ec };
  }

  it('付け替え: 口座 B へ → 2.5%・B（過剰リスク）。プレビューと保存の後が同じ', async () => {
    const { ec } = await a1AfterCapitalChange();
    ec.update({ type: 'set', field: 'accountId', value: B.id });
    expect(ec.getState().preview.riskPct).toBeCloseTo(2.5, 12);
    expect(ec.getState().preview.judgment?.grade).toBe('B');
    await ec.save();
    const saved = ec.getState().trade as StoredTrade;
    expect(saved.record.accountId).toBe(B.id);
    expect(saved.snapshot.capitalYen).toBe(200_000);
    expect(summarize(saved).riskPct).toBeCloseTo(2.5, 12);
    expect(summarize(saved).judgment?.grade).toBe('B');
  });

  it('そのまま: 口座は変えずに決済の理由を直す → 0.5%（写した値のまま）', async () => {
    const { ec } = await a1AfterCapitalChange();
    ec.update({ type: 'set', field: 'exitReason', value: 'lc' });
    expect(ec.getState().preview.riskPct).toBeCloseTo(0.5, 12);
    await ec.save();
    const saved = ec.getState().trade as StoredTrade;
    expect(saved.snapshot.capitalYen).toBe(1_000_000);
    expect(summarize(saved).riskPct).toBeCloseTo(0.5, 12);
    expect(saved.record.accountId).toBe(A.id);
  });

  it('付け替えて元へ戻すと、写した値のまま（今の 500,000 で計算し直さない）', async () => {
    const { ec } = await a1AfterCapitalChange();
    ec.update({ type: 'set', field: 'accountId', value: B.id });
    ec.update({ type: 'set', field: 'accountId', value: A.id });
    expect(ec.getState().preview.riskPct).toBeCloseTo(0.5, 12);
  });
});

describe('AC-8: 例 B7（口座の付いていない取引を編集画面で開き、口座を変えずに保存）', () => {
  it('口座 2 個: 口座の欄は「口座 1」、保存の後の snapshot と 1R・リスク・判定が開く前と同じ', async () => {
    const legacy: StoredTrade = {
      id: 't-legacy',
      schemaVersion: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      snapshot: {
        instrument: {
          multiplier: 1,
          quantityStep: 1,
          priceCurrency: 'JPY',
          underlyingKind: 'index',
          productForm: 'spotCfd',
        },
        capitalYen: 1_000_000,
        riskTolerancePct: 1,
      },
      record: {
        status: 'closed',
        source: 'manual',
        instrumentId: JP.id,
        side: 'L',
        lc: 99.5,
        lcBasis: 'chart',
        stopOrderPlaced: 'unanswered',
        lcDecidedBeforeEntry: true,
        lcMove: { kind: 'none' },
        timeframeChange: 'none',
        entries: [{ price: 100, quantity: 10_000 }],
        exit: {
          time: 1_800_000_000_000,
          price: 99.5,
          orderType: 'unknown',
          reason: 'lc',
          gapSlip: 'unanswered',
        },
        fees: [],
      },
    };
    // 今の口座 1 の資金は 2,000,000（移し替えた後に直した）。口座 B もある
    const f = createFakeApi({
      instruments: [JP],
      trades: [legacy],
      accounts: [defaultAccount(2_000_000), B],
    });
    const before = summarize(legacy);
    const ec = createEditController({ api: f.api, id: legacy.id });
    await ec.load();
    expect(ec.getState().draft.accountId).toBe('default');
    expect(ec.getState().accounts.map((a) => a.name)).toEqual(['口座 1', '口座 B']);
    expect(ec.getState().preview.riskPct).toBeCloseTo(0.5, 12);
    await ec.save();
    const saved = ec.getState().trade as StoredTrade;
    expect(saved.snapshot).toEqual(legacy.snapshot);
    const after = summarize(saved);
    expect(after.oneRYen).toBe(before.oneRYen);
    expect(after.riskPct).toBe(before.riskPct);
    expect(after.judgment).toEqual(before.judgment);
    // 本文の口座は「口座 1」（既定）。付け替えではない
    const put = f.calls.find((x) => x.method === 'PUT');
    expect(put?.body).toMatchObject({ accountId: 'default' });
  });

  it('口座 1 個: 本文に口座を入れず（元のまま）、snapshot は変わらない', async () => {
    const t = await (async () => {
      const f = createFakeApi({ instruments: [JP], capitalYen: 1_000_000 });
      const saved = await record(f, '');
      return { f, saved };
    })();
    expect(t.saved.record.accountId).toBeUndefined();
    const ec = createEditController({ api: t.f.api, id: t.saved.id });
    await ec.load();
    await ec.save();
    const put = t.f.calls.find((x) => x.method === 'PUT');
    expect(put?.body).not.toHaveProperty('accountId');
    expect((ec.getState().trade as StoredTrade).snapshot).toEqual(t.saved.snapshot);
  });
});

describe('AC-6・AC-7: 記録する画面の口座（B1〜B6）', () => {
  it('B1: 既定の口座 1 つ（資金は未設定）→ 欄の判定は口座なし・記録できる・リスク「—」・A。本文に口座が入らない', async () => {
    const f = createFakeApi({ instruments: [JP] });
    const t = await record(f, '');
    const s = summarize(t);
    expect(s.riskPct).toBeUndefined();
    expect(s.judgment?.grade).toBe('A');
    expect(s.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noCapital' });
    const post = f.calls.find((x) => x.method === 'POST' && x.path === '/api/trades');
    expect(post?.body).not.toHaveProperty('accountId');
    // 文脈が同じなら下書きの読みも口座なし
    expect(NO_CAPITAL.accounts).toHaveLength(1);
  });

  it('B2: 口座 1 個（口座 A に名前を直した既定の口座）→ 本文に口座は入らず、その口座に属する', async () => {
    const f = createFakeApi({
      instruments: [JP],
      accounts: [{ ...defaultAccount(1_000_000), name: '口座 A' }],
    });
    const c = await opened(f);
    expect(c.getState().accounts).toHaveLength(1);
    const t = await record(f, '');
    expect(t.record.accountId).toBeUndefined();
    expect(t.snapshot.capitalYen).toBe(1_000_000);
  });

  it('B3: 口座 2 個（A・B）、最後に記録した取引が B → 開いたとき B。1 回の操作で A に変わる', async () => {
    const f = createFakeApi({ instruments: [JP], accounts: [defaultAccount(null), A, B] });
    await record(f, A.id);
    await record(f, B.id);
    const c = await opened(f);
    expect(c.getState().draft.accountId).toBe(B.id);
    c.update({ type: 'set', field: 'accountId', value: A.id });
    expect(c.getState().draft.accountId).toBe(A.id);
  });

  it('B4: 口座 2 個（口座 1・口座 B）、最後の取引に口座が付いていない（移す前）→ 口座 1', async () => {
    const f = createFakeApi({
      instruments: [JP],
      accounts: [defaultAccount(null), B],
      trades: [
        {
          ...(await record(createFakeApi({ instruments: [JP] }), '')),
          id: 't-old',
          createdAt: 5_000,
        },
      ],
    });
    const c = await opened(f);
    expect(c.getState().draft.accountId).toBe('default');
  });

  it('U11: 保存の後の知らせは、口座 2 つ以上で「口座 B に記録しました」、1 つで「記録しました」', async () => {
    const f = fake();
    const c = await opened(f);
    c.update({
      type: 'fill',
      values: { ...E11, instrumentName: JP.name, accountId: B.id },
    });
    await c.save();
    expect(c.getState().saved?.accountName).toBe('口座 B');
    expect(c.getState().saved?.accountCount).toBe(4);
  });
});
