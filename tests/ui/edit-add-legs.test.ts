// 編集の画面の ［明細から追加］（#263・設計書 C82・C73・4.7）: 偽の API で編集の controller を通して、例の表 #1〜#10 を確かめる。
// 値はすべて架空（原資産 架空XYZ・乗数 1,000・円の口座）
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade, TradeRecord } from '../../core/record';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { createEditController, type EditController } from '../../ui/src/lib/edit-controller';
import { withAddedFees } from '../../ui/src/lib/edit-form';
import { EMPTY_LEG, type LegDraft } from '../../ui/src/lib/legs-form';
import { ADDED_NOT_SUMMED, LEGS_EDITED, optionVerdictLines } from '../../ui/src/lib/option-view';
import { READ_PATH } from '../../ui/src/lib/record-controller';
import { type Draft, EMPTY_DRAFT, readDraft, summarize } from '../../ui/src/lib/record-form';
import { ADD_LEGS_MSG, legNoticeWithPnl } from '../../ui/src/lib/statement-add-legs';
import { defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi, type ReadScript } from './helpers/fake-api';
import {
  ADD_A,
  ADD_B,
  ADD_C,
  blobOf,
  fakePreview,
  type OptionRowSpec,
  optionRowJson,
  pngBytes,
  preparedImage,
  statementBody,
} from './helpers/statement-rows';

const XYZ: InstrumentRecord = {
  id: 'i-xyz',
  name: '架空XYZオプション',
  underlying: '架空XYZ',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'JPY',
  multiplier: 1_000,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
};
const ACCOUNTS = [defaultAccount(20_000_000)];
const file = () => blobOf(pngBytes(1200, 800, 2048));
const read = (specs: readonly OptionRowSpec[], over: Record<string, unknown> = {}): ReadScript => ({
  status: 200,
  body: statementBody(specs.map((s) => ({ ...optionRowJson(s), ...over }))),
});
const ms = (s: OptionRowSpec, k: 'opened' | 'closed') => s[k].epochMs as number;

/** 保存済みの足（例の売り P 36,000・買い P 35,000。どちらも 12/9 10:00 に決済） */
function storedLeg(s: OptionRowSpec): LegDraft {
  return {
    ...EMPTY_LEG,
    optionType: s.putCall === 'put' ? 'P' : 'C',
    contractMonth: '2027-01',
    strike: String(s.strike),
    side: s.side,
    quantity: String(s.qty),
    entryPrice: String(s.entry),
    exitPrice: String(s.exit),
    entryTime: ms(s, 'opened'),
    exitTime: ms(s, 'closed'),
  };
}

/** 保存済みの取引（明細の損益 89,000・手数料 1,000・逆指値・決済の理由 LC。足の導出 180,000 − 90,000 = 90,000） */
function storedTrade(
  over: { readonly pnl?: string; readonly legs?: readonly LegDraft[] } = {},
): StoredTrade {
  const d: Draft = {
    ...EMPTY_DRAFT,
    instrumentName: XYZ.name,
    entryPrice: '38000',
    exitPrice: '37400',
    lc: '37500',
    lcMove: 'none',
    timeframeChange: 'none',
    brokenCondition: '架空の崩れの一言',
    lcLossPlan: '50000',
    entryTime: toLocalInput(ms(ADD_A, 'opened')),
    exitTime: toLocalInput(ms(ADD_A, 'closed')),
    pnlYen: over.pnl ?? '89000',
    feeYen: '1000',
    exitOrderType: 'stop',
    stopOrderPlaced: 'placed',
    exitReason: 'lc',
    source: 'statement',
    legs: over.legs ?? [storedLeg(ADD_A), storedLeg(ADD_B)],
  };
  const r = readDraft(d, { instruments: [XYZ], accounts: ACCOUNTS });
  if (!r.body)
    throw new Error(`本文が無い: ${JSON.stringify(r.missing)} ${JSON.stringify(r.errors)}`);
  return {
    id: 'T263',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    record: {
      ...r.body,
      instrumentId: XYZ.id,
      fees: [{ label: '架空の手数料', amountYen: 1_000 }],
    } as TradeRecord,
    snapshot: {
      instrument: {
        multiplier: 1_000,
        quantityStep: 1,
        priceCurrency: 'JPY',
        underlyingKind: 'index',
        productForm: 'option',
      },
      capitalYen: 20_000_000,
      riskTolerancePct: 1,
      accountCurrency: 'JPY',
    },
  };
}

async function open(
  reads: readonly ReadScript[],
  trade: StoredTrade = storedTrade(),
): Promise<{ fake: FakeApi; c: EditController; t: StoredTrade; zoneWrites: string[] }> {
  const fake = createFakeApi({ trades: [trade], instruments: [XYZ], accounts: ACCOUNTS, reads });
  const zoneWrites: string[] = [];
  const c = createEditController({
    api: fake.api,
    id: trade.id,
    prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    zoneMemory: { read: () => null, write: (id) => zoneWrites.push(id) },
  });
  await c.load();
  expect(c.getState().phase).toBe('editing');
  return { fake, c, t: trade, zoneWrites };
}

const reads = (fake: FakeApi) => fake.calls.filter((x) => x.path === READ_PATH).length;
const put = (fake: FakeApi): TradeRecord[] =>
  fake.calls
    .filter((x) => x.method === 'PUT' && x.path.startsWith('/api/trades/'))
    .map((x) => x.body as TradeRecord);
const strikes = (c: EditController) => c.getState().draft.legs.map((l) => l.strike);
const feeTotal = (r: TradeRecord | undefined) =>
  (r?.fees ?? []).reduce((s, f) => s + f.amountYen, 0);

describe('例 #1: 開いたときの足を変えずに明細から 1 本追加する（R2・R4・R5）', () => {
  it('足 3 本・明細の損益 28,500・手数料 1,500（保存済みの内訳 + 500）・決済 12/10 14:00・成行・未回答・理由 LC。送信 1 回', async () => {
    const { fake, c, zoneWrites } = await open([read([ADD_C])]);
    const before = c.getState();
    expect(before.read.body?.statementPnlYen).toBe(89_000);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(reads(fake)).toBe(1);
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(s.draft.legs.slice(0, 2)).toEqual(before.draft.legs);
    expect(s.draft.legs[2]).toMatchObject({
      optionType: 'C',
      contractMonth: '2027-01',
      strike: '40000',
      side: 'sell',
      quantity: '1',
      entryPrice: '200',
      exitPrice: '260',
      entryTime: ms(ADD_C, 'opened'),
      exitTime: ms(ADD_C, 'closed'),
    });
    expect(s.draft).toMatchObject({
      lc: '37500',
      entryPrice: '38000',
      exitPrice: '37400',
      brokenCondition: '架空の崩れの一言',
      accountId: before.draft.accountId,
      exitTime: toLocalInput(ms(ADD_C, 'closed')),
      exitOrderType: 'market',
      stopOrderPlaced: 'unanswered',
      exitReason: 'lc',
      pnlYen: '89000',
      feeYen: '1000',
    });
    expect(s.legAdd).toEqual({
      phase: 'done',
      notice: '明細から足を 1 本追加しました',
      undo: true,
    });
    expect(s.read.option?.legsEdited).toBe(false);
    expect(s.read.canSave).toBe(true);
    // 判定の枠: 損益 28,500。R は手数料を除いた損益 30,000（= 足の導出の合計 180,000 − 90,000 − 60,000）から出るので、
    // 明細の損益・手数料を外した（足の合計の）同じ記録の R と同じ
    expect(s.preview.pnlYen).toBe(28_500);
    await c.save();
    const body = put(fake)[0];
    if (!body) throw new Error('PUT が無い');
    const { statementPnlYen: _p, ...legsOnly } = body;
    const total = summarize({
      record: { ...legsOnly, fees: [] },
      snapshot: storedTrade().snapshot,
    });
    expect(total.pnlYen).toBe(30_000);
    expect(s.preview.r).toBeDefined();
    expect(s.preview.r).toBe(total.r);
    expect(s.preview.judgment?.grade).toBe(total.judgment?.grade);
    expect(body?.statementPnlYen).toBe(28_500);
    expect(body?.fees).toEqual([{ label: '架空の手数料', amountYen: 1_000 }, { amountYen: 500 }]);
    expect(body?.legs).toHaveLength(3);
    expect(body?.exit).toMatchObject({
      orderType: 'market',
      time: ms(ADD_C, 'closed'),
      reason: 'lc',
    });
    expect(body?.stopOrderPlaced).toBe('unanswered');
    // KEEP-4: 口座・明細の特徴の覚え・端末の時間帯を書き換えない
    expect(body?.accountId ?? 'default').toBe('default');
    expect(fake.calls.some((x) => x.path.startsWith('/api/statement-profiles'))).toBe(false);
    expect(zoneWrites).toEqual([]);
  });

  it('例 #2: 同じ画像をもう一度 → 3 本のまま「この明細の足はすべて入っています」（送信は数える）', async () => {
    const { fake, c } = await open([read([ADD_C]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(c.getState().legAdd).toEqual({
      phase: 'failed',
      notice: ADD_LEGS_MSG.allPresent,
      undo: false,
    });
    expect(reads(fake)).toBe(2);
  });

  it('保存済みの足と同じ行は追加しない（重複は保存済みの足とも比べる）', async () => {
    const { c } = await open([read([ADD_A, ADD_C])]);
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(c.getState().legAdd?.notice).toBe(
      '明細から足を 1 本追加しました。同じ足 1 本は追加していません',
    );
  });

  it('例 #3: 足 9 本の取引で 2 本読める明細 → 1 本も追加しない', async () => {
    const nine = Array.from({ length: 9 }, (_, i) =>
      storedLeg({ ...ADD_A, strike: 30_000 + i * 100 }),
    );
    const t = storedTrade({ legs: nine, pnl: '' });
    const { c } = await open([read([ADD_C, { ...ADD_C, strike: 41_000 }])], t);
    const before = c.getState().draft;
    await c.addLegsFromStatement(file());
    expect(c.getState().draft).toEqual(before);
    expect(c.getState().legAdd?.notice).toBe('足は 10 本までです（今 9 本 · この明細から 2 本）');
  });
});

describe('例 #4: 失敗・キャンセルは下書きを変えない（R3・AC-1）', () => {
  for (const [name, script, notice] of [
    ['上限（429）', { status: 429 }, '今日の読み取りの上限に達しました。足は変わっていません。'],
    ['通信の失敗', 'throw', '読み取れませんでした。足は変わっていません。'],
    [
      '明細でない',
      { status: 200, body: { kind: 'notStatement', rows: [] } },
      '決済明細として読めませんでした。足は変わっていません。',
    ],
  ] as const) {
    it(`${name} → 下書き全体が開いたときと同じ`, async () => {
      const { c } = await open([script as ReadScript]);
      const before = c.getState().draft;
      await c.addLegsFromStatement(file());
      expect(c.getState().draft).toEqual(before);
      expect(c.getState().legAdd).toEqual({ phase: 'failed', notice, undo: false });
      expect(c.getState().read.canSave).toBe(true);
    });
  }

  it('読み取り中は保存できず・2 回目は送らない。キャンセルで下書きは同じ', async () => {
    const { fake, c } = await open([read([ADD_C])]);
    const before = c.getState().draft;
    fake.holdReads();
    const p = c.addLegsFromStatement(file());
    await new Promise((ok) => setTimeout(ok, 0));
    expect(c.getState().legAdd?.phase).toBe('reading');
    expect(c.getState().read.canSave).toBe(false);
    expect(c.getState().read.notice).toBe(ADD_LEGS_MSG.reading);
    await c.save();
    expect(put(fake)).toHaveLength(0);
    await c.addLegsFromStatement(file());
    expect(reads(fake)).toBe(1);
    c.cancelLegRead();
    fake.releaseReads();
    await p;
    expect(c.getState().draft).toEqual(before);
    expect(c.getState().legAdd).toEqual({
      phase: 'failed',
      notice: ADD_LEGS_MSG.cancelled,
      undo: false,
    });
    expect(c.getState().read.canSave).toBe(true);
  });

  it('足の無い取引（先物）では何もしない', async () => {
    const t = storedTrade();
    const { legs: _l, riskPlan: _r, lcLossPlanYen: _p, ...rest } = t.record;
    const fut: StoredTrade = {
      ...t,
      schemaVersion: 1,
      record: { ...rest, entries: [{ ...rest.entries[0], quantity: 1 }] } as TradeRecord,
    };
    const { fake, c } = await open([read([ADD_C])], fut);
    expect(c.getState().read.option).toBeUndefined();
    await c.addLegsFromStatement(file());
    expect(reads(fake)).toBe(0);
    expect(c.getState().legAdd).toBeUndefined();
  });
});

describe('損益の切り替え（例 #5〜#8・R4）', () => {
  it('例 #5: 追加の後に保存済みの足を直す → 明細の損益なし・足の合計 40,000・判定の枠に 1 行', async () => {
    const { fake, c } = await open([read([ADD_C])]);
    await c.addLegsFromStatement(file());
    const legs = c.getState().draft.legs.map((l, i) => (i === 1 ? { ...l, exitPrice: '70' } : l));
    c.update({ type: 'set', field: 'legs', value: legs });
    const s = c.getState();
    expect(s.read.option?.legsEdited).toBe(true);
    expect(s.read.option?.addedNotSummed).toBeUndefined();
    expect(s.read.body?.statementPnlYen).toBeUndefined();
    expect(s.preview.pnlYen).toBe(40_000);
    expect(optionVerdictLines(s.preview.option, 'JPY', { legsEdited: true }).warnings).toContain(
      LEGS_EDITED,
    );
    await c.save();
    expect(put(fake)[0]?.statementPnlYen).toBeUndefined();
    expect(feeTotal(put(fake)[0])).toBe(1_500);
  });

  it('例 #6: 行の手数料が読めない → 明細の損益なし（足の合計 30,000）・手数料 1,000', async () => {
    const { fake, c } = await open([
      read([ADD_C], { fees: [], feesTotal: null, feesTotalYen: null }),
    ]);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(s.read.option?.legsEdited).toBe(true);
    expect(s.preview.pnlYen).toBe(30_000);
    // レビュー 4: 足は直していないので、判定の枠の 1 行は「明細から追加した足の損益を足せない」理由
    expect(s.read.option?.addedNotSummed).toBe(true);
    const lines = optionVerdictLines(s.preview.option, 'JPY', {
      legsEdited: true,
      addedNotSummed: true,
    }).warnings;
    expect(lines).toContain(ADDED_NOT_SUMMED);
    expect(lines).not.toContain(LEGS_EDITED);
    await c.save();
    expect(put(fake)[0]?.statementPnlYen).toBeUndefined();
    expect(feeTotal(put(fake)[0])).toBe(1_000);
  });

  it('例 #7: 損益の欄を 88,000 に直してから追加 → 88,000（打った値）と知らせ', async () => {
    const { fake, c } = await open([read([ADD_C])]);
    c.update({ type: 'set', field: 'pnlYen', value: '88000' });
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(s.legAdd?.notice).toBe(`明細から足を 1 本追加しました。${ADD_LEGS_MSG.pnlTyped}`);
    expect(s.read.body?.statementPnlYen).toBe(88_000);
    await c.save();
    expect(put(fake)[0]?.statementPnlYen).toBe(88_000);
  });

  it('例 #8: 保存済みの明細の損益が無い取引 → 足の合計 30,000 のまま・手数料 1,500', async () => {
    const { fake, c } = await open([read([ADD_C])], storedTrade({ pnl: '' }));
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(s.read.body?.statementPnlYen).toBeUndefined();
    expect(s.read.option?.addedNotSummed).toBe(true);
    expect(s.preview.pnlYen).toBe(30_000);
    await c.save();
    expect(put(fake)[0]?.statementPnlYen).toBeUndefined();
    expect(feeTotal(put(fake)[0])).toBe(1_500);
  });

  it('手数料の欄を直していれば追加した行の手数料を足さない', async () => {
    const { fake, c } = await open([read([ADD_C])]);
    c.update({ type: 'set', field: 'feeYen', value: '1200' });
    await c.addLegsFromStatement(file());
    expect(c.getState().read.body?.statementPnlYen).toBe(28_500);
    await c.save();
    expect(put(fake)[0]?.fees).toEqual([{ amountYen: 1_200 }]);
  });
});

describe('［元に戻す］ と時刻（例 #9・#10・R3・R5）', () => {
  it('例 #9: ［元に戻す］ で開いたときに戻り、保存の本文も開いたときと同じ。送信は増えない', async () => {
    const { fake, c, t } = await open([read([ADD_C])]);
    const opened = c.getState().draft;
    await c.addLegsFromStatement(file());
    c.undoAddLegs();
    expect(c.getState().draft).toEqual(opened);
    expect(c.getState().legAdd).toBeUndefined();
    expect(reads(fake)).toBe(1);
    await c.save();
    expect(put(fake)[0]).toEqual(t.record);
  });

  it('例 #9: 足の段で追加した足を消す → 注文の種類・逆指値・決済の時刻が戻り、損益 89,000', async () => {
    const { c } = await open([read([ADD_C])]);
    const opened = c.getState().draft;
    await c.addLegsFromStatement(file());
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 2) });
    const s = c.getState();
    expect(s.draft).toMatchObject({
      exitOrderType: 'stop',
      stopOrderPlaced: 'placed',
      exitTime: opened.exitTime,
      exitReason: 'lc',
    });
    expect(s.read.option?.legsEdited).toBe(false);
    expect(s.read.body?.statementPnlYen).toBe(89_000);
    expect(s.legAdd).toBeUndefined();
  });

  it('例 #10: 決済の時刻を 15:00 に直してから追加 → 時刻はそのまま・注文の種類は成行', async () => {
    const { c } = await open([read([ADD_C])]);
    const typed = toLocalInput(ms(ADD_C, 'closed') + 3_600_000);
    c.update({ type: 'set', field: 'exitTime', value: typed });
    await c.addLegsFromStatement(file());
    expect(c.getState().draft.exitTime).toBe(typed);
    expect(c.getState().draft.exitOrderType).toBe('market');
  });

  it('シートを閉じた（dismissLegAdd）・保存で知らせと ［元に戻す］ が消える', async () => {
    const { c } = await open([read([ADD_C])]);
    await c.addLegsFromStatement(file());
    c.dismissLegAdd();
    expect(c.getState().legAdd).toBeUndefined();
    c.undoAddLegs();
    expect(strikes(c)).toHaveLength(3);
  });
});

describe('AC-1: チャートの時間足の読み取りとは 1 つずつ', () => {
  it('足の読み取り中に入れたチャートの時間足の読み取りは、足の読み取りの後に送る', async () => {
    const { fake, c } = await open([read([ADD_C])]);
    fake.holdReads();
    const p = c.addLegsFromStatement(file());
    await new Promise((ok) => setTimeout(ok, 0));
    const chart = c.setChart('entry', file());
    await new Promise((ok) => setTimeout(ok, 0));
    expect(fake.calls.some((x) => x.path === '/api/chart-reads')).toBe(false);
    fake.releaseReads();
    await p;
    await chart;
    await new Promise((ok) => setTimeout(ok, 0));
    const order = fake.calls
      .map((x) => x.path)
      .filter((x) => x === READ_PATH || x === '/api/chart-reads');
    expect(order[0]).toBe(READ_PATH);
    expect(order).toContain('/api/chart-reads');
  });
});

describe('レビュー 3: 保存のたびに手数料の内訳が増えない', () => {
  it('追加して保存 → 開き直して追加して保存しても、ラベルの無い内訳は 1 件のまま合計だけ増える', async () => {
    const { fake, c } = await open([
      read([ADD_C]),
      read([
        { ...ADD_C, strike: 42_000, entry: 30, exit: 10, pnl: 19_500, closed: { ...ADD_C.closed } },
      ]),
    ]);
    await c.addLegsFromStatement(file());
    await c.save();
    const first = put(fake)[0];
    expect(first?.fees).toEqual([{ label: '架空の手数料', amountYen: 1_000 }, { amountYen: 500 }]);
    await c.load();
    await c.addLegsFromStatement(file());
    await c.save();
    const second = put(fake)[1];
    expect(second?.fees).toEqual([
      { label: '架空の手数料', amountYen: 1_000 },
      { amountYen: 1_000 },
    ]);
    expect(second?.legs).toHaveLength(4);
  });
});

describe('レビュー 5: 「損益は打った値のままです」は追加の後に損益を直しても添える', () => {
  it('legNoticeWithPnl', () => {
    const note = '明細から足を 1 本追加しました';
    expect(legNoticeWithPnl(note, { hasAdded: true, pnlTyped: false })).toBe(note);
    expect(legNoticeWithPnl(note, { hasAdded: false, pnlTyped: true })).toBe(note);
    expect(legNoticeWithPnl(note, { hasAdded: true, pnlTyped: true })).toBe(
      `${note}。${ADD_LEGS_MSG.pnlTyped}`,
    );
    expect(
      legNoticeWithPnl(`${note}。${ADD_LEGS_MSG.pnlTyped}`, { hasAdded: true, pnlTyped: true }),
    ).toBe(`${note}。${ADD_LEGS_MSG.pnlTyped}`);
    expect(legNoticeWithPnl(null, { hasAdded: true, pnlTyped: true })).toBe(ADD_LEGS_MSG.pnlTyped);
  });
});

describe('withAddedFees（レビュー 3）', () => {
  it('内訳が無ければ 1 件、ラベルの無い内訳があれば最後のそれに足す、足す額が無ければ元のまま', () => {
    expect(withAddedFees([], 500)).toEqual([{ amountYen: 500 }]);
    const fees = [{ amountYen: 300 }, { label: '架空', amountYen: 200 }, { amountYen: 100 }];
    expect(withAddedFees(fees, 500)).toEqual([
      { amountYen: 300 },
      { label: '架空', amountYen: 200 },
      { amountYen: 600 },
    ]);
    expect(withAddedFees(fees, undefined)).toBe(fees);
    expect(withAddedFees(fees, 0)).toBe(fees);
  });
});
