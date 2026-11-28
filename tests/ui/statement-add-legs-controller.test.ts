// 記録する画面の ［明細から追加］（#260・設計書 C73・4.7・7.6）: 偽の API で controller を通して、例の表 #1〜#11 を確かめる。
// 値はすべて架空（原資産 架空XYZ・乗数 1,000・円の口座）
import { describe, expect, it } from 'vitest';
import type { AccountRecord, InstrumentRecord, TradeRecord } from '../../core/record';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { EMPTY_LEG, type LegDraft } from '../../ui/src/lib/legs-form';
import {
  createRecordController,
  READ_PATH,
  type RecordController,
} from '../../ui/src/lib/record-controller';
import { readDraft } from '../../ui/src/lib/record-form';
import { ADD_LEGS_MSG } from '../../ui/src/lib/statement-add-legs';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi, type ReadScript } from './helpers/fake-api';
import {
  ADD_A,
  ADD_B,
  ADD_C,
  blobOf,
  fakePreview,
  jst,
  type OptionRowSpec,
  optionRowJson,
  pngBytes,
  preparedImage,
  statementBody,
  unknownTz,
} from './helpers/statement-rows';

const NOW = new Date(2026, 11, 24, 10, 0).getTime();
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
const file = () => blobOf(pngBytes(1200, 800, 2048));
const read = (specs: readonly (OptionRowSpec | Record<string, unknown>)[]): ReadScript => ({
  status: 200,
  body: statementBody(specs.map((s) => ('putCall' in s ? optionRowJson(s as OptionRowSpec) : s))),
});

async function setup(
  reads: readonly ReadScript[],
  opts: { readonly accounts?: readonly AccountRecord[]; readonly firstStatement?: boolean } = {},
): Promise<{ fake: FakeApi; c: RecordController }> {
  const fake = createFakeApi({
    instruments: [XYZ],
    accounts: opts.accounts ?? [defaultAccount(20_000_000)],
    reads,
  });
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
  });
  await c.load();
  if (opts.firstStatement !== false) await c.readImage(file());
  return { fake, c };
}

/** 本人が入れる原資産の価格・LC・タップ（例 #1: LC 37,500・建てたときの原資産 38,000） */
function typePlan(c: RecordController) {
  c.update({ type: 'set', field: 'entryPrice', value: '38000' });
  c.update({ type: 'set', field: 'exitPrice', value: '37400' });
  c.update({ type: 'set', field: 'lc', value: '37500' });
  c.update({ type: 'set', field: 'brokenCondition', value: '架空の崩れの一言' });
  c.update({ type: 'set', field: 'lcMove', value: 'none' });
  c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
}

const reads = (fake: FakeApi) => fake.calls.filter((x) => x.path === READ_PATH).length;
const posted = (fake: FakeApi): TradeRecord[] =>
  fake.calls
    .filter((x) => x.method === 'POST' && x.path === '/api/trades')
    .map((x) => x.body as TradeRecord);
const strikes = (c: RecordController) => c.getState().draft.legs.map((l) => l.strike);

describe('例 #1: 1 枚目の明細の後に 2 枚目から 1 本追加する', () => {
  it('足 3 本・明細の損益 28,500・手数料 1,500・決済の時刻 12/10 14:00・成行・既定は外れる。LC・原資産は変わらない。送信 1 回', async () => {
    const { fake, c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    typePlan(c);
    const before = c.getState();
    expect(before.draft.exitOrderType).toBe('stop');
    expect(before.draft.exitReason).toBe('lc');
    expect(before.read.body?.statementPnlYen).toBe(89_000);
    expect(reads(fake)).toBe(1);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(reads(fake)).toBe(2);
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(s.draft.legs.slice(0, 2)).toEqual(before.draft.legs);
    expect(s.draft).toMatchObject({
      lc: '37500',
      entryPrice: '38000',
      exitPrice: '37400',
      brokenCondition: '架空の崩れの一言',
      lcMove: 'none',
      timeframeChange: 'none',
      accountId: before.draft.accountId,
      exitTime: toLocalInput(ADD_C.closed.epochMs as number),
      exitOrderType: 'market',
      exitReason: 'other',
      pnlYen: before.draft.pnlYen,
    });
    expect(s.statement?.marks.exitReason).toBeUndefined();
    expect(s.legAdd).toEqual({
      phase: 'done',
      notice: '明細から足を 1 本追加しました',
      undo: true,
    });
    expect(s.read.body).toMatchObject({
      statementPnlYen: 28_500,
      fees: [{ amountYen: 1_500 }],
      exit: { orderType: 'market', time: ADD_C.closed.epochMs },
    });
    expect(s.read.body?.legs).toHaveLength(3);
    // KEEP-2: 2 枚目で明細の特徴を覚えない・口座を替えない
    expect(fake.calls.some((x) => x.path.startsWith('/api/statement-profiles'))).toBe(false);
    expect(s.read.canSave).toBe(true);
    await c.save();
    expect(posted(fake)[0]).toMatchObject({
      statementPnlYen: 28_500,
      fees: [{ amountYen: 1_500 }],
    });
  });

  it('AC-5: 判定の枠の損益・勝ち負け・R は、同じ足を手で打って損益 28,500・手数料 1,500 を打った下書きと一致', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    typePlan(c);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    const manual = {
      ...s.draft,
      source: 'manual' as const,
      pnlYen: '28500',
      feeYen: '1500',
      legs: s.draft.legs.map(({ read: _r, ...l }): LegDraft => l),
    };
    const ctx = { instruments: [XYZ], accounts: s.accounts, statementPnl: false };
    const typed = readDraft(manual, ctx);
    // 手数料を除いた損益 = 28,500 + 1,500 = 30,000（足の導出の合計）
    expect(s.read.preview.pnlYen).toBeDefined();
    expect(s.read.preview.pnlYen).toBe(typed.preview.pnlYen);
    expect(s.read.preview.r).toBe(typed.preview.r);
    expect(s.read.preview.judgment).toEqual(typed.preview.judgment);
    expect(typed.body?.statementPnlYen).toBe(28_500);
  });
});

describe('KEEP-2: 2 枚目の明細で口座・明細の特徴の覚えを書き換えない', () => {
  it('2 枚目の応答の明細の特徴が別の口座を指していても、口座は今のまま・覚えの要求を送らない', async () => {
    const a1 = defaultAccount(20_000_000);
    const a2 = account('acctb', '口座 B', 10_000_000);
    const second: ReadScript = {
      status: 200,
      body: statementBody([optionRowJson(ADD_C)], {
        profile: { key: 'a'.repeat(32), accountId: 'acctb' },
      }),
    };
    const { fake, c } = await setup([read([ADD_A, ADD_B]), second], { accounts: [a1, a2] });
    const before = c.getState().draft.accountId;
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(c.getState().draft.accountId).toBe(before);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    expect(fake.calls.some((x) => x.path.startsWith('/api/statement-profiles'))).toBe(false);
  });
});

describe('重複・上限・足さない行（例 #2・#3・#4・#5）', () => {
  it('例 #2: 同じ画像をもう一度 → 足は 3 本のまま・「この明細の足はすべて入っています」・送信は数える', async () => {
    const { fake, c } = await setup([read([ADD_A, ADD_B]), read([ADD_C]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(reads(fake)).toBe(3);
    expect(c.getState().legAdd).toEqual({
      phase: 'failed',
      notice: 'この明細の足はすべて入っています',
      undo: false,
    });
  });

  it('例 #3・#4: 別の原資産・先物の行は追加しない。原資産の行が無ければ何も変えない', async () => {
    const futures = { ...optionRowJson(ADD_C), symbol: '架空XYZ先物', option: undefined };
    const { c } = await setup([
      read([ADD_A, ADD_B]),
      read([
        { ...ADD_C, underlying: '架空ABC' },
        { ...ADD_C, underlying: '架空ABC', strike: 1 },
        futures,
        ADD_C,
      ]),
      read([futures]),
    ]);
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(c.getState().legAdd?.notice).toBe(
      '明細から足を 1 本追加しました。別の原資産・先物の 3 行は追加していません',
    );
    const mid = c.getState().draft;
    await c.addLegsFromStatement(file());
    expect(c.getState().draft).toBe(mid);
    expect(c.getState().legAdd?.notice).toBe(ADD_LEGS_MSG.noRows);
  });

  it('例 #5: 足が 9 本のときに 2 本読める明細 → 1 本も追加せず、下書き全体が同じ', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C, { ...ADD_C, strike: 41_000 }])]);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...EMPTY_LEG,
      optionType: 'C' as const,
      contractMonth: '2027-01',
      strike: String(50_000 + i),
      side: 'buy' as const,
      quantity: '1',
      entryPrice: '10',
      exitPrice: '5',
    }));
    c.update({ type: 'set', field: 'legs', value: [...c.getState().draft.legs, ...seven] });
    const before = c.getState().draft;
    await c.addLegsFromStatement(file());
    expect(c.getState().draft).toEqual(before);
    expect(c.getState().legAdd?.notice).toBe('足は 10 本までです（今 9 本 · この明細から 2 本）');
  });
});

describe('失敗・キャンセル・読み取り中（例 #6・AC-1・AC-4）', () => {
  for (const [name, script, notice] of [
    ['上限（429）', { status: 429 }, '今日の読み取りの上限に達しました。足は変わっていません。'],
    ['送り口の失敗（502）', { status: 502 }, '読み取れませんでした。足は変わっていません。'],
    [
      '明細でない',
      { status: 200, body: { kind: 'notStatement', rows: [] } },
      '決済明細として読めませんでした。足は変わっていません。',
    ],
    ['通信の失敗', 'throw', '読み取れませんでした。足は変わっていません。'],
  ] as const) {
    it(`例 #6: ${name} → 下書き全体が足す前と同じ・決まった文の 1 文目 +「足は変わっていません。」`, async () => {
      const { c } = await setup([read([ADD_A, ADD_B]), script as ReadScript]);
      typePlan(c);
      const before = c.getState();
      await c.addLegsFromStatement(file());
      const s = c.getState();
      expect(s.draft).toEqual(before.draft);
      expect(s.statement?.marks).toEqual(before.statement?.marks);
      expect(s.legAdd).toEqual({ phase: 'failed', notice, undo: false });
      expect(s.read.canSave).toBe(true);
    });
  }

  it('AC-1: 読み取り中は記録できず・2 回目は押せない（送信 1 回）。キャンセルで足は変わらない', async () => {
    const { fake, c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    typePlan(c);
    const before = c.getState().draft;
    fake.holdReads();
    const p = c.addLegsFromStatement(file());
    await Promise.resolve();
    await new Promise((ok) => setTimeout(ok, 0));
    const s = c.getState();
    expect(s.legAdd?.phase).toBe('reading');
    expect(s.read.canSave).toBe(false);
    expect(s.read.notice).toBe(ADD_LEGS_MSG.reading);
    // 読み取り中も LC・タップは入力できる（C23）
    c.update({ type: 'set', field: 'lc', value: '37600' });
    expect(c.getState().draft.lc).toBe('37600');
    await c.addLegsFromStatement(file());
    expect(reads(fake)).toBe(2);
    c.cancelLegRead();
    fake.releaseReads();
    await p;
    const after = c.getState();
    expect(after.draft.legs).toEqual(before.legs);
    expect(after.legAdd).toEqual({ phase: 'failed', notice: ADD_LEGS_MSG.cancelled, undo: false });
    expect(after.read.canSave).toBe(true);
  });

  it('AC-1: 足の一覧が出ていない（先物の明細）・保存の後は何もしない', async () => {
    const futures = { ...optionRowJson(ADD_C), symbol: '架空XYZ先物', option: undefined };
    const { fake, c } = await setup([read([futures])]);
    expect(c.getState().read.option).toBeUndefined();
    await c.addLegsFromStatement(file());
    expect(reads(fake)).toBe(1);
    expect(c.getState().legAdd).toBeUndefined();
  });
});

describe('［元に戻す］ と 1 枚目の明細の削除（例 #7・#11・AC-7）', () => {
  it('例 #7: 追加の直後に ［元に戻す］ → 足 2 本・明細の損益 89,000・手数料 1,000・12/9 10:00・逆指値・決済の理由 LC（明細から）。送信は増えない', async () => {
    const { fake, c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    typePlan(c);
    const before = c.getState();
    await c.addLegsFromStatement(file());
    c.undoAddLegs();
    const s = c.getState();
    expect(s.draft).toEqual(before.draft);
    expect(s.statement?.marks).toEqual(before.statement?.marks);
    expect(s.read.body).toMatchObject({
      statementPnlYen: 89_000,
      fees: [{ amountYen: 1_000 }],
      exit: { orderType: 'stop', reason: 'lc', time: ADD_A.closed.epochMs },
    });
    expect(s.legAdd).toBeUndefined();
    expect(reads(fake)).toBe(2);
  });

  it('次の足の操作で ［元に戻す］ は終わる', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 3) });
    expect(c.getState().legAdd).toBeUndefined();
    c.undoAddLegs();
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
  });

  it('シートを閉じた（dismissLegAdd）ら知らせと ［元に戻す］ は消える', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    c.dismissLegAdd();
    expect(c.getState().legAdd).toBeUndefined();
    c.undoAddLegs();
    expect(c.getState().draft.legs).toHaveLength(3);
  });

  it('例 #11: 追加の後に 1 枚目の明細を ［削除］ → 1 枚目の 2 本が消え、2 枚目の C 40,000 が残る。［元に戻す］ で 3 本', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    c.removeStatement();
    expect(strikes(c)).toEqual(['40000']);
    c.undoRemoveStatement();
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
  });

  it('1 枚目の明細を入れ替えても、追加した明細の足は残る（R4）', async () => {
    const { c } = await setup([
      read([ADD_A, ADD_B]),
      read([ADD_C]),
      read([{ ...ADD_A, strike: 36_500 }, ADD_B]),
    ]);
    await c.addLegsFromStatement(file());
    await c.readImage(file());
    expect(strikes(c)).toEqual(['36500', '35000', '40000']);
  });
});

describe('手入力・外貨の口座・時間帯（例 #8・#9・#10・AC-6）', () => {
  it('例 #8: ［明細なしで手入力］ + 手の足 1 本 → 重複の 1 本は追加せず、明細の損益 89,500・手数料 500', async () => {
    const { fake, c } = await setup([read([ADD_A, ADD_B])], { firstStatement: false });
    c.startManual();
    c.update({ type: 'set', field: 'instrumentName', value: XYZ.name });
    c.update({
      type: 'set',
      field: 'legs',
      value: [
        {
          ...EMPTY_LEG,
          optionType: 'P',
          contractMonth: '2027-01',
          strike: '36000',
          side: 'sell',
          quantity: '1',
          entryPrice: '300',
          exitPrice: '120',
        },
      ],
    });
    typePlan(c);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(reads(fake)).toBe(1);
    expect(strikes(c)).toEqual(['36000', '35000']);
    expect(s.legAdd?.notice).toBe('明細から足を 1 本追加しました。同じ足 1 本は追加していません');
    expect(s.read.body).toMatchObject({ statementPnlYen: 89_500, fees: [{ amountYen: 500 }] });
    // 手入力のまま（明細の行は持たない）・口座は同じ
    expect(s.statement).toBeUndefined();
    expect(s.draft.source).toBe('manual');
  });

  it('例 #8 の続き: 損益の欄を本人が打っていたら、その値を正として追加した行の損益を足さない（知らせに 1 行）', async () => {
    const { c } = await setup([read([ADD_C])], { firstStatement: false });
    c.startManual();
    c.update({ type: 'set', field: 'instrumentName', value: XYZ.name });
    c.update({ type: 'set', field: 'pnlYen', value: '12345' });
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(s.legAdd?.notice).toBe('明細から足を 1 本追加しました。損益は打った値のままです');
    typePlan(c);
    expect(c.getState().read.body?.statementPnlYen).toBe(12_345);
  });

  it('例 #9: 外貨の口座（USD）・価格の通貨 JPY・為替が空 → 足は追加し、明細の損益は入れない', async () => {
    const usd = account('default', '口座 1', 100_000, 1, { currency: 'USD' });
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])], { accounts: [usd] });
    typePlan(c);
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(s.read.body?.statementPnlYen).toBeUndefined();
    expect(s.read.body?.fees).toEqual([]);
  });

  it('例 #10: 時間帯の書かれていない 2 枚目（選択も覚えも無い）→ 足は時刻なし・ポジションの決済の時刻は変わらない', async () => {
    const { c } = await setup([
      read([ADD_A, ADD_B]),
      read([
        { ...ADD_C, opened: unknownTz('2026-12-02T09:30'), closed: unknownTz('2026-12-10T14:00') },
      ]),
    ]);
    const before = c.getState().draft;
    await c.addLegsFromStatement(file());
    const s = c.getState();
    expect(s.draft.legs).toHaveLength(3);
    expect(s.draft.legs[2]?.exitTime).toBeUndefined();
    expect(s.draft.exitTime).toBe(before.exitTime);
    expect(s.draft.exitOrderType).toBe('stop');
  });

  it('時間帯の書かれていない 2 枚目でも、端末に覚えた時間帯で足の時刻を入れる', async () => {
    const fake = createFakeApi({
      instruments: [XYZ],
      accounts: [defaultAccount(20_000_000)],
      reads: [
        read([ADD_A, ADD_B]),
        read([
          {
            ...ADD_C,
            opened: unknownTz('2026-12-02T09:30'),
            closed: unknownTz('2026-12-10T14:00'),
          },
        ]),
      ],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
      zoneMemory: { read: () => 'jst', write: () => {} },
    });
    await c.load();
    await c.readImage(file());
    await c.addLegsFromStatement(file());
    expect(c.getState().draft.legs[2]?.exitTime).toBe(ADD_C.closed.epochMs);
    expect(c.getState().draft.exitTime).toBe(toLocalInput(ADD_C.closed.epochMs as number));
  });

  it('AC-6: 本人が決済の時刻を触っていれば変えない（注文の種類は行の値）', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    const mine = toLocalInput((ADD_C.closed.epochMs as number) + 3_600_000);
    c.update({ type: 'set', field: 'exitTime', value: mine });
    await c.addLegsFromStatement(file());
    expect(c.getState().draft.exitTime).toBe(mine);
    expect(c.getState().draft.exitOrderType).toBe('market');
  });

  it('次の件（明細の次の行）へ進むと、追加した足は持ち越さない', async () => {
    const { c } = await setup([
      read([ADD_A, ADD_B, { ...ADD_C, underlying: '架空ABC', position: 1 }]),
      read([ADD_C]),
    ]);
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    c.skipRow();
    expect(strikes(c)).toEqual(['40000']);
    expect(c.getState().draft.legs[0]?.read?.sheet).toBeUndefined();
    expect(c.getState().legAdd).toBeUndefined();
  });

  it('レビュー N2: 決済の時点になった追加の足を削除したら、決済の時刻・注文の種類・決済の理由（明細から）を追加する前へ戻す', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    const before = c.getState();
    await c.addLegsFromStatement(file());
    expect(c.getState().draft.exitOrderType).toBe('market');
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 2) });
    const s = c.getState();
    expect(s.draft).toMatchObject({
      exitOrderType: 'stop',
      exitReason: 'lc',
      stopOrderPlaced: 'placed',
      exitTime: before.draft.exitTime,
    });
    expect(s.statement?.marks.exitReason).toBe('statement');
    expect(s.statement?.marks.exitTime).toBe(before.statement?.marks.exitTime);
  });

  it('レビュー N2: 本人が触った決済の時刻・決済の理由は戻さない（注文の種類は証拠なので戻す）', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C])]);
    await c.addLegsFromStatement(file());
    const mine = toLocalInput((ADD_C.closed.epochMs as number) + 60_000);
    c.update({ type: 'set', field: 'exitTime', value: mine });
    c.update({ type: 'set', field: 'exitReason', value: 'tp' });
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 2) });
    expect(c.getState().draft).toMatchObject({
      exitTime: mine,
      exitReason: 'tp',
      exitOrderType: 'stop',
    });
  });

  it('レビュー N7: 追加した明細と同じ画像を 1 段目に入れ替えても、同じ足を二重に持たない', async () => {
    const { c } = await setup([read([ADD_A, ADD_B]), read([ADD_C]), read([ADD_A, ADD_B, ADD_C])]);
    await c.addLegsFromStatement(file());
    await c.readImage(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000']);
    expect(c.getState().draft.legs.every((l) => l.read?.sheet === undefined)).toBe(true);
  });

  it('レビュー N2 の続き: 2 回追加した後に追加の足をすべて消すと、最初に追加する前の注文の種類へ戻る', async () => {
    const { c } = await setup([
      read([ADD_A, ADD_B]),
      read([ADD_C]),
      read([{ ...ADD_C, strike: 41_000, closed: jst(2026, 12, 11, 9, 0) }]),
    ]);
    await c.addLegsFromStatement(file());
    await c.addLegsFromStatement(file());
    expect(strikes(c)).toEqual(['36000', '35000', '40000', '41000']);
    // 決済の時点 = 4 本目 → 消すと 3 本目（追加の足）の値、さらに消すと 1 枚目の値
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 3) });
    expect(c.getState().draft.exitTime).toBe(toLocalInput(ADD_C.closed.epochMs as number));
    c.update({ type: 'set', field: 'legs', value: c.getState().draft.legs.slice(0, 2) });
    expect(c.getState().draft).toMatchObject({ exitOrderType: 'stop', exitReason: 'lc' });
  });
});
