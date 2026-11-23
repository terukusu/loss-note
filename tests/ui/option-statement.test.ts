// 記録する画面: 明細のオプションの行をポジションの下書きに流し込み、1 件ずつ記録する（#118。設計書 7.6・C51・C54・4.7）。
// 偽の API（tests/ui/helpers/fake-api.ts）で controller を通して確かめる。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, TradeRecord } from '../../core/record';
import { NEW_MULTIPLIER_ID } from '../../ui/src/components/TradeFields';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { EMPTY_LEG, type LegDraft, sqEndOf } from '../../ui/src/lib/legs-form';
import {
  createRecordController,
  POSITION_MERGED,
  type RecordController,
  rowUnitOf,
} from '../../ui/src/lib/record-controller';
import { FIELD_INPUT_ID, tradeSummary } from '../../ui/src/lib/record-screen';
import { OPTION_INSTRUMENT_NEEDED } from '../../ui/src/lib/statement-positions';
import { defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import {
  blobOf,
  fakePreview,
  OPT_A1,
  OPT_A2,
  OPT_B1,
  type OptionRowSpec,
  optionRowJson,
  pngBytes,
  preparedImage,
  ROW_E1,
  statementBody,
  unknownTz,
} from './helpers/statement-rows';

const NOW = new Date(2026, 11, 24, 10, 0).getTime();
const XYZOP: InstrumentRecord = {
  id: 'i-xyzop',
  name: '架空指数XYZOP',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'JPY',
  multiplier: 1_000,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
};

async function opened(
  rows: readonly unknown[],
  instruments: readonly InstrumentRecord[] = [XYZOP],
): Promise<{ fake: FakeApi; c: RecordController }> {
  const fake = createFakeApi({
    instruments,
    accounts: [defaultAccount(20_000_000)],
    reads: [{ status: 200, body: statementBody(rows) }],
  });
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
  });
  await c.load();
  await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
  return { fake, c };
}

/** 手で入れる 3 つ（原資産）と 3 つのタップ */
function typePosition(c: RecordController) {
  c.update({ type: 'set', field: 'entryPrice', value: '38500' });
  c.update({ type: 'set', field: 'exitPrice', value: '39100' });
  c.update({ type: 'set', field: 'lc', value: '37800' });
  c.update({ type: 'set', field: 'lcDecided', value: true });
  c.update({ type: 'set', field: 'lcMove', value: 'none' });
  c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
}

const posted = (fake: FakeApi): TradeRecord[] =>
  fake.calls
    .filter((x) => x.method === 'POST' && x.path === '/api/trades')
    .map((x) => x.body as TradeRecord);

const rows3 = [optionRowJson(OPT_A1), optionRowJson(OPT_A2), ROW_E1, optionRowJson(OPT_B1)];

describe('明細のオプションの行 → ポジションの下書き（7.6 の 1〜3）', () => {
  it('同じ position の 2 行が 1 件のポジション。「1 / 3 件目」、レッグ 2 本・明細の損益の合計', async () => {
    const { c } = await opened(rows3);
    const s = c.getState();
    const st = s.statement;
    expect(st?.phase).toBe('ready');
    expect(st?.rows).toHaveLength(3);
    expect(st && rowUnitOf(st)).toBe('件目');
    expect(s.draft).toMatchObject({
      instrumentName: '架空指数XYZOP',
      pnlYen: '98000',
      feeYen: '2000',
      entryPrice: '',
      exitPrice: '',
    });
    expect(s.draft.legs.map((l) => [l.optionType, l.strike, l.side, l.quantity])).toEqual([
      ['P', '36000', 'sell', '2'],
      ['P', '35500', 'buy', '2'],
    ]);
    expect(s.read.option).toBeDefined();
  });

  it('記録すると本文にレッグ 2 本（時刻つき）・明細の損益・数量 1。次は先物の行、その次は別のポジション', async () => {
    const { fake, c } = await opened(rows3);
    typePosition(c);
    expect(c.getState().read.canSave).toBe(true);
    await c.save();
    const [body] = posted(fake);
    expect(body?.legs?.map((l) => [l.id, l.optionType, l.strike, l.side, l.quantity])).toEqual([
      ['l1', 'P', 36_000, 'sell', 2],
      ['l2', 'P', 35_500, 'buy', 2],
    ]);
    expect(body?.legs?.[0]?.entry).toEqual({ price: 240, time: OPT_A1.opened.epochMs });
    expect(body?.legs?.[1]?.exit).toEqual({
      price: 70,
      time: OPT_A2.closed.epochMs,
      kind: 'closed',
    });
    expect(body).toMatchObject({
      side: 'L',
      statementPnlYen: 98_000,
      entries: [{ price: 38_500, quantity: 1, time: OPT_A1.opened.epochMs }],
      exit: { price: 39_100, time: OPT_A2.closed.epochMs, orderType: 'unknown' },
    });
    // 2 件目 = 先物の行（レッグなし）
    const s2 = c.getState();
    expect(s2.statement?.index).toBe(1);
    expect(s2.statement?.notice).toBe('1 / 3 件目を記録しました。次の取引（2 / 3）です');
    expect(s2.draft.legs).toEqual([]);
    expect(s2.draft.instrumentName).toBe(ROW_E1.symbol);
    c.skipRow();
    // 3 件目 = 別の日のポジション（1 本）
    const s3 = c.getState();
    expect(s3.statement?.index).toBe(2);
    expect(s3.draft.legs).toHaveLength(1);
    expect(s3.draft.pnlYen).toBe('-25300');
  });

  it('[別のポジションにする] → 次の取引に。［このポジションに入れる］ で戻る（触った欄・直したレッグは保つ）', async () => {
    const { c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]);
    c.update({ type: 'set', field: 'lc', value: '37800' });
    c.splitLeg(1);
    let s = c.getState();
    expect(s.statement?.rows).toHaveLength(2);
    expect(s.statement?.units).toEqual([[0], [1]]);
    expect(s.draft.legs).toHaveLength(1);
    expect(s.draft.pnlYen).toBe('259000');
    expect(s.draft.lc).toBe('37800');
    expect(s.statement?.notice).toContain('次の取引（2 / 2）');
    c.mergeNextPosition();
    s = c.getState();
    expect(s.statement?.units).toEqual([[0, 1]]);
    expect(s.draft.legs).toHaveLength(2);
    expect(s.draft.pnlYen).toBe('98000');
    expect(s.statement?.notice).toBe(POSITION_MERGED(1));
    // 手で足したレッグは分けても残る。1 本のポジション・手で足したレッグは分けない
    c.update({ type: 'set', field: 'legs', value: [...s.draft.legs, { ...EMPTY_LEG }] });
    c.splitLeg(2);
    expect(c.getState().statement?.units).toEqual([[0, 1]]);
    c.splitLeg(0);
    expect(c.getState().draft.legs.map((l) => l.read?.raw ?? 'manual')).toEqual([1, 'manual']);
    c.splitLeg(0);
    expect(c.getState().statement?.units).toEqual([[1], [0]]);
  });

  it('C54: 明細の逆指値 + 手で足した満期で消えた売り → 満期（SQ）・決済の理由はその他・決済の時刻は SQ の日', async () => {
    const { fake, c } = await opened([
      optionRowJson(OPT_A1),
      optionRowJson({ ...OPT_A2, order: 'stop' }),
    ]);
    expect(c.getState().draft).toMatchObject({ exitReason: 'lc', stopOrderPlaced: 'placed' });
    typePosition(c);
    const sell: LegDraft = {
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '34000',
      side: 'sell',
      quantity: '1',
      entryPrice: '30',
      exitPrice: '0',
      expired: true,
    };
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, sell] });
    const s = c.getState();
    expect(s.draft).toMatchObject({
      exitReason: 'other',
      stopOrderPlaced: 'unanswered',
      exitTime: toLocalInput(sqEndOf('2027-01') as number),
    });
    expect(s.statement?.marks.exitTime).toBe('sq');
    await c.save();
    const [body] = posted(fake);
    expect(body?.exit).toMatchObject({ orderType: 'expiry', reason: 'other' });
    expect(body?.stopOrderPlaced).toBe('unanswered');
    // 明細の損益は決済したレッグの分のまま（満期で消えたレッグは core が導出して足す。4.7）
    expect(body?.statementPnlYen).toBe(98_000);
  });

  it('4.7: 手で足した決済のレッグの損益を明細の損益に足して保存する（98,000 − 30,000 = 68,000）', async () => {
    const { fake, c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]);
    typePosition(c);
    const buy: LegDraft = {
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '35000',
      side: 'buy',
      quantity: '1',
      entryPrice: '50',
      exitPrice: '20',
    };
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, buy] });
    // 画面の欄は明細の値のまま（足すのは保存の本文）
    expect(c.getState().draft.pnlYen).toBe('98000');
    await c.save();
    expect(posted(fake)[0]?.statementPnlYen).toBe(68_000);
  });

  it('B1: 先物「架空225」とオプション「架空225オプション」があれば、オプションの銘柄に当てる', async () => {
    const fut: InstrumentRecord = { ...XYZOP, id: 'i-f', name: '架空225', productForm: 'future' };
    const op: InstrumentRecord = { ...XYZOP, id: 'i-op', name: '架空225オプション' };
    const { fake, c } = await opened(
      [
        optionRowJson({ ...OPT_A1, underlying: '架空225' }),
        optionRowJson({ ...OPT_A2, underlying: '架空225' }),
      ],
      [fut, op],
    );
    expect(c.getState().draft.instrumentName).toBe('架空225オプション');
    expect(c.getState().read.option?.newInstrument).toBeUndefined();
    typePosition(c);
    await c.save();
    expect(posted(fake)[0]?.instrumentId).toBe('i-op');
    // 先物の銘柄は変えない・銘柄を足さない
    expect(
      fake.calls.some((x) => x.path.startsWith('/api/instruments') && x.method !== 'GET'),
    ).toBe(false);
  });

  it('B1: オプションの銘柄が無ければ「<原資産>オプション」を足す案。乗数を入れて記録すると形 オプションで足す', async () => {
    const fut: InstrumentRecord = { ...XYZOP, id: 'i-f', name: '架空225', productForm: 'future' };
    const { fake, c } = await opened(
      [
        optionRowJson({ ...OPT_A1, underlying: '架空225' }),
        optionRowJson({ ...OPT_A2, underlying: '架空225' }),
      ],
      [fut],
    );
    const s = c.getState();
    expect(s.draft.instrumentName).toBe('架空225オプション');
    expect(s.read.option?.newInstrument).toBe('架空225オプション');
    typePosition(c);
    expect(c.getState().read.canSave).toBe(false);
    expect(c.getState().read.missing).toContain('乗数');
    // 2 段目の要約に「未入力 乗数」（押すと乗数の欄へ）
    const st = c.getState();
    const sum = tradeSummary(st.draft, st.read.errors, st.statement?.marks ?? {}, st.read.option);
    expect(sum.named).toContainEqual({
      field: 'instrumentMultiplier',
      label: '乗数',
      kind: 'missing',
    });
    expect(FIELD_INPUT_ID.instrumentMultiplier).toBe(NEW_MULTIPLIER_ID);
    expect(st.read.option?.newInstrumentCurrency).toBe('JPY');
    expect(c.getState().read.notice).toBeUndefined();
    c.update({ type: 'set', field: 'instrumentMultiplier', value: '1000' });
    expect(c.getState().read.canSave).toBe(true);
    await c.save();
    const add = fake.calls.find((x) => x.method === 'POST' && x.path === '/api/instruments');
    expect(add?.body).toEqual({
      name: '架空225オプション',
      productForm: 'option',
      multiplier: 1000,
      priceCurrency: 'JPY',
      underlying: '架空225',
    });
    expect(posted(fake)[0]?.legs).toHaveLength(2);
  });

  it('見直し 2: 明細の損益の通貨が USD なら、足す銘柄の価格の通貨も USD', async () => {
    const usd = (spec: typeof OPT_A1) => ({
      ...optionRowJson({ ...spec, underlying: '架空US指数' }),
      pnlCurrency: 'USD',
    });
    const { c } = await opened([usd(OPT_A1), usd(OPT_A2)], []);
    expect(c.getState().read.option?.newInstrumentCurrency).toBe('USD');
    c.update({ type: 'set', field: 'instrumentMultiplier', value: '100' });
    expect(c.getState().read.instrument.create?.priceCurrency).toBe('USD');
  });

  it('先物の銘柄の名前を打ったら保存しない（形を変えさせない文）', async () => {
    const fut: InstrumentRecord = { ...XYZOP, id: 'i-f', name: '架空225', productForm: 'future' };
    const { c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)], [fut, XYZOP]);
    c.update({ type: 'set', field: 'instrumentName', value: '架空225' });
    typePosition(c);
    c.update({ type: 'set', field: 'side', value: 'L' });
    c.update({ type: 'set', field: 'quantity', value: '1' });
    const r = c.getState().read;
    expect(r.canSave).toBe(false);
    expect(r.notice).toBe(OPTION_INSTRUMENT_NEEDED);
  });

  it('B2: 逆指値の行を分けたら「明細から」の既定を外し、まとめ直したら戻す。本人が触った値は残す', async () => {
    const { c } = await opened([
      optionRowJson(OPT_A1),
      optionRowJson({ ...OPT_A2, order: 'stop' }),
    ]);
    let s = c.getState();
    expect(s.draft).toMatchObject({ lcDecided: null, exitReason: 'lc', stopOrderPlaced: 'placed' });
    expect(s.statement?.marks).toMatchObject({ exitReason: 'statement' });
    c.splitLeg(1);
    s = c.getState();
    expect(s.draft).toMatchObject({
      lcDecided: null,
      exitReason: 'other',
      exitOrderType: 'unknown',
      stopOrderPlaced: 'unanswered',
    });
    expect(s.statement?.marks.lcDecided).toBeUndefined();
    expect(s.statement?.marks.exitReason).toBeUndefined();
    c.mergeNextPosition();
    s = c.getState();
    expect(s.draft).toMatchObject({ lcDecided: null, exitReason: 'lc', stopOrderPlaced: 'placed' });
    expect(s.statement?.marks).toMatchObject({ exitReason: 'statement' });
    // 本人が選んだ決済の理由は、分けても残す
    c.update({ type: 'set', field: 'exitReason', value: 'fearEarly' });
    c.splitLeg(1);
    expect(c.getState().draft.exitReason).toBe('fearEarly');
    // 「明細から」の印は触ったときに外れる（markEdited）
    expect(c.getState().statement?.marks.exitReason).toBeUndefined();
  });

  it('レビュー 3: 損益の欄を本人が直したら、手で足したレッグの損益を足さない', async () => {
    const { fake, c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]);
    typePosition(c);
    const buy: LegDraft = {
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '35000',
      side: 'buy',
      quantity: '1',
      entryPrice: '50',
      exitPrice: '20',
    };
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, buy] });
    c.update({ type: 'set', field: 'pnlYen', value: '60000' });
    await c.save();
    expect(posted(fake)[0]?.statementPnlYen).toBe(60_000);
  });

  it('時間帯の無い明細: 時間帯を選ぶとレッグの時刻も入る', async () => {
    const spec = (s: OptionRowSpec): OptionRowSpec => ({
      ...s,
      opened: unknownTz(s.opened.written),
      closed: unknownTz(s.closed.written),
    });
    const { c } = await opened([optionRowJson(spec(OPT_A1)), optionRowJson(spec(OPT_A2))]);
    expect(c.getState().draft.legs.every((l) => l.entryTime === undefined)).toBe(true);
    c.chooseTimeZone('jst');
    const legs = c.getState().draft.legs;
    expect(legs.map((l) => l.entryTime)).toEqual([OPT_A1.opened.epochMs, OPT_A2.opened.epochMs]);
    c.openOtherZones();
    expect(c.getState().draft.legs.every((l) => l.entryTime === undefined)).toBe(true);
  });

  it('もう 1 枚を貼ると、前の明細のレッグは捨て、手で足したレッグは残す', async () => {
    const fake = createFakeApi({
      instruments: [XYZOP],
      accounts: [defaultAccount(20_000_000)],
      reads: [
        { status: 200, body: statementBody([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]) },
        { status: 200, body: statementBody([optionRowJson({ ...OPT_B1, position: 0 })]) },
      ],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, { ...EMPTY_LEG }] });
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    expect(c.getState().draft.legs.map((l) => l.read?.raw ?? 'manual')).toEqual([0, 'manual']);
    expect(c.getState().draft.legs[0]?.optionType).toBe('C');
  });
});

describe('明細の削除とレッグ（#184 例 #10・AC-6）', () => {
  it('明細から読んだレッグ 2 本 + 手で足したレッグ 1 本で削除 → 手で足した 1 本だけ残る。［元に戻す］ で 3 本', async () => {
    const { c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]);
    const hand: LegDraft = { ...EMPTY_LEG, optionType: 'C', strike: '40000', quantity: '1' };
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, hand] });
    const before = c.getState().draft.legs;
    expect(before).toHaveLength(3);
    c.removeStatement();
    expect(c.getState().draft.legs).toEqual([hand]);
    c.undoRemoveStatement();
    expect(c.getState().draft.legs).toEqual(before);
  });

  it('本人が入れた原資産のイン・決済は、削除・［元に戻す］ で残る（明細から来たものではない。設計書 7.5・13.2）', async () => {
    const { c } = await opened([optionRowJson(OPT_A1), optionRowJson(OPT_A2)]);
    c.update({ type: 'set', field: 'entryPrice', value: '38500' });
    c.update({ type: 'set', field: 'exitPrice', value: '39100' });
    c.removeStatement();
    const s = c.getState().draft;
    expect(s).toMatchObject({ entryPrice: '38500', exitPrice: '39100', instrumentName: '' });
    expect(s.legs).toEqual([]);
    c.update({ type: 'set', field: 'exitPrice', value: '39200' });
    c.undoRemoveStatement();
    expect(c.getState().draft).toMatchObject({
      entryPrice: '38500',
      exitPrice: '39200',
      instrumentName: '架空指数XYZOP',
    });
    expect(c.getState().draft.legs).toHaveLength(2);
  });
});
