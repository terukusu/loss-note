// 記録する画面: 明細から口座を選ぶ・覚える（Issue #66 の AC-3・AC-4・AC-7・KEEP-6。例 S1〜S10・S13・S14）と、
// 口座の切り替えで損益を口座の通貨でやり直す（AC-13。C7）。偽の API（tests/ui/helpers/fake-api.ts）で確かめる。
// 値・名前はすべて架空。会社の名前は画面に来ない（API が鍵に変える）ので、応答の profile の鍵と提案の口座だけを台本に書く
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import type { ReadRow } from '../../ui/src/lib/statement-fill';
import { account, defaultAccount } from './helpers/accounts';
import { createFakeApi, type FakeApi, type ReadScript } from './helpers/fake-api';
import { US30 } from './helpers/record-drafts';
import {
  blobOf,
  fakePreview,
  pngBytes,
  preparedImage,
  ROW_E1,
  ROWS_E10,
  statementBody,
} from './helpers/statement-rows';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const KX = 'a'.repeat(32);
const B = { ...US30, id: 'inst-b', name: '架空指数B' };
/** 口座 A（既定の口座・資金 1,000,000）と口座 B（資金 200,000） */
const ACC_A = { ...defaultAccount(1_000_000), name: '口座 A' };
const ACC_B = account('accB', '口座 B', 200_000);

function lastTradeOn(accountId: string): StoredTrade {
  return {
    id: 't-last',
    schemaVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: 200_000,
      riskTolerancePct: 1,
    },
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId: B.id,
      accountId,
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity: 1 }],
      exit: {
        time: 2_000,
        price: 99.5,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      fees: [],
    },
  };
}

/** 提案つきの読み取りの応答（profile = null は鍵なし） */
const read = (
  rows: readonly ReadRow[],
  profile: { key: string; accountId: string | null } | null,
): ReadScript => ({ status: 200, body: statementBody(rows, { profile }) });

async function openedWith(
  reads: readonly ReadScript[],
  opts: { accounts?: readonly ReturnType<typeof account>[]; last?: string } = {},
): Promise<{ fake: FakeApi; c: RecordController }> {
  const fake = createFakeApi({
    instruments: [B],
    trades: opts.last === undefined ? [] : [lastTradeOn(opts.last)],
    accounts: opts.accounts ?? [ACC_A, ACC_B],
    reads,
  });
  const c = createRecordController({
    api: fake.api,
    now: () => NOW,
    prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
  });
  await c.load();
  return { fake, c };
}

const img = () => blobOf(pngBytes(1200, 800, 2048));
const learns = (fake: FakeApi) =>
  fake.calls.filter((x) => x.method === 'PUT' && x.path.startsWith('/api/statement-profiles/'));

/** 手で打つ欄 2 つと選ぶ欄 3 つ */
function typeFive(c: RecordController, lc = '99.0') {
  c.update({ type: 'set', field: 'lc', value: lc });
  c.update({ type: 'set', field: 'brokenCondition', value: '押し目の安値を割ったら' });
  c.update({ type: 'set', field: 'lcDecided', value: true });
  c.update({ type: 'set', field: 'lcMove', value: 'none' });
  c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

describe('明細から口座を選ぶ（AC-3。S1〜S4・S6）', () => {
  it('S1: 覚えなし → 前回の口座 B・印なし。A に直して記録 → X の鍵 → A を覚える', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], { key: KX, accountId: null })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    c.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    typeFive(c);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(learns(fake)).toEqual([
      { method: 'PUT', path: `/api/statement-profiles/${KX}`, body: { accountId: ACC_A.id } },
    ]);
    expect(fake.profiles.get(KX)).toBe(ACC_A.id);
  });

  it('S2: 覚え A・前回 B → 口座 A・印「自動で選択」。判定の枠のリスク（%）は A の資金で出る', async () => {
    const { c } = await openedWith([read([ROW_E1], { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    typeFive(c);
    const s = c.getState();
    expect(s.draft.accountId).toBe(ACC_A.id);
    expect(s.statement?.marks.accountId).toBe('auto');
    // 手で A を選んだときと同じリスク（%）（1R ÷ 1,000,000）
    const { c: manual } = await openedWith([read([ROW_E1], null)], { last: ACC_B.id });
    await manual.readImage(img());
    manual.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    typeFive(manual);
    expect(s.read.preview.riskPct).toBeDefined();
    expect(s.read.preview.riskPct).toBe(manual.getState().read.preview.riskPct);
    const onB = await openedWith([read([ROW_E1], null)], { last: ACC_B.id });
    await onB.c.readImage(img());
    typeFive(onB.c);
    expect(onB.c.getState().read.preview.riskPct).toBeCloseTo(
      (s.read.preview.riskPct as number) * 5,
      9,
    );
  });

  it('S3: 応答の前に口座 B を選んでいた → B のまま・印なし。記録すると X の鍵 → B に覚え直す', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => c.getState().statement?.phase === 'reading');
    c.update({ type: 'set', field: 'accountId', value: ACC_B.id });
    fake.releaseReads();
    await p;
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    typeFive(c);
    await c.save();
    expect(fake.profiles.get(KX)).toBe(ACC_B.id);
  });

  it('S4: 提案 A を B に直して記録 → 印は消え（「直した」にしない）、次の X の明細は B・印「自動で選択」', async () => {
    const { fake, c } = await openedWith(
      [
        read([ROW_E1], { key: KX, accountId: ACC_A.id }),
        read([ROW_E1], { key: KX, accountId: ACC_B.id }),
      ],
      { last: ACC_A.id },
    );
    await c.readImage(img());
    expect(c.getState().statement?.marks.accountId).toBe('auto');
    c.update({ type: 'set', field: 'accountId', value: ACC_B.id });
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    typeFive(c);
    await c.save();
    expect(fake.profiles.get(KX)).toBe(ACC_B.id);
    c.next();
    c.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(c.getState().statement?.marks.accountId).toBe('auto');
  });

  it('S6: Y の明細（覚えなし）→ 提案なし・前回の口座', async () => {
    const { c } = await openedWith([read([ROW_E1], { key: 'b'.repeat(32), accountId: null })], {
      last: ACC_A.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_A.id);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
  });
});

describe('覚える / 覚えない（AC-4。S5・S7〜S10・S13）', () => {
  it('S5: 鍵なし（会社の名前が写っていない）→ 提案なし・記録しても覚えない', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], null)], { last: ACC_B.id });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    typeFive(c);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(learns(fake)).toHaveLength(0);
  });

  it('S7: 口座 1 つ → 欄も印も無い（今と同じ）。記録すると X の鍵 → 既定の口座を覚える', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], { key: KX, accountId: 'default' })], {
      accounts: [ACC_A],
    });
    await c.readImage(img());
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    typeFive(c);
    await c.save();
    // 口座 1 つの本文は今と同じ（accountId を入れない）。覚えは既定の口座
    const post = fake.calls.find((x) => x.method === 'POST' && x.path === '/api/trades');
    expect(post?.body).not.toHaveProperty('accountId');
    expect(fake.profiles.get(KX)).toBe('default');
  });

  it('S8: 3 行の明細（提案 A）で 1 行目を A で記録 → 2・3 行目の既定も A', async () => {
    const { fake, c } = await openedWith([read(ROWS_E10, { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_A.id);
    typeFive(c);
    await c.save();
    expect(c.getState().statement?.index).toBe(1);
    expect(c.getState().draft.accountId).toBe(ACC_A.id);
    c.skipRow();
    expect(c.getState().draft.accountId).toBe(ACC_A.id);
    expect(learns(fake).map((x) => x.body)).toEqual([{ accountId: ACC_A.id }]);
  });

  it('S9: 3 行（提案 A）で 1 行目を飛ばし、2 行目を B に直して記録 → X の鍵 → B（飛ばした行は送らない）', async () => {
    const { fake, c } = await openedWith([read(ROWS_E10, { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    c.skipRow();
    expect(learns(fake)).toHaveLength(0);
    expect(c.getState().draft.accountId).toBe(ACC_A.id);
    c.update({ type: 'set', field: 'accountId', value: ACC_B.id });
    // 2 行目は S・イン 200（LC は上）
    typeFive(c, '201');
    await c.save();
    expect(learns(fake).map((x) => x.body)).toEqual([{ accountId: ACC_B.id }]);
    expect(fake.profiles.get(KX)).toBe(ACC_B.id);
  });

  it('S10: その場で口座 C を足して記録 → X の鍵 → C。足した口座は提案で上書きしない', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => c.getState().statement?.phase === 'reading');
    c.openAddAccount();
    c.setNewAccount('name', '口座 C');
    await c.addAccount();
    const created = c.getState().accounts.find((a) => a.name === '口座 C');
    fake.releaseReads();
    await p;
    expect(c.getState().draft.accountId).toBe(created?.id);
    typeFive(c);
    await c.save();
    expect(fake.profiles.get(KX)).toBe(created?.id);
  });

  it('S13: 覚えの口座が今の一覧に無い → 提案なし・前回の口座', async () => {
    const { c } = await openedWith([read([ROW_E1], { key: KX, accountId: 'goneAccount' })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
  });

  it('覚えの送信が失敗しても記録は成功のまま・知らせを出さない', async () => {
    const fake = createFakeApi({
      instruments: [B],
      trades: [lastTradeOn(ACC_B.id)],
      accounts: [ACC_A, ACC_B],
      reads: [read([ROW_E1], { key: KX, accountId: ACC_A.id })],
      fail: { [`PUT /api/statement-profiles/${KX}`]: 503 },
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(img());
    typeFive(c);
    await c.save();
    await until(() => learns(fake).length === 1);
    expect(c.getState().phase).toBe('saved');
    expect(c.getState().error).toBeNull();
  });

  it('明細の無い記録（手で入れた）では覚えない。明細の後の次の取引も覚えない。鍵は状態の文字に残さない', async () => {
    const { fake, c } = await openedWith([read([ROW_E1], { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    typeFive(c);
    await c.save();
    expect(learns(fake)).toHaveLength(1);
    expect(JSON.stringify(c.getState())).not.toContain(KX);
    // [次の取引を記録] で手で入れて記録 → 覚えない（明細の特徴は最後の行の後に捨てている）
    c.next();
    c.update({ type: 'set', field: 'instrumentName', value: B.name });
    c.update({ type: 'set', field: 'side', value: 'L' });
    c.update({ type: 'set', field: 'entryPrice', value: '100' });
    c.update({ type: 'set', field: 'exitPrice', value: '99' });
    c.update({ type: 'set', field: 'quantity', value: '1' });
    typeFive(c);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(learns(fake)).toHaveLength(1);
  });
});

describe('429・失敗（AC-7。S14）', () => {
  it.each([429, 502, 503])(
    '%i → 提案なし（前回の口座のまま・印なし）。手で記録でき、覚えない',
    async (status) => {
      const { fake, c } = await openedWith([{ status, body: { error: 'x' } }], { last: ACC_B.id });
      await c.readImage(img());
      expect(c.getState().statement?.phase).toBe('failed');
      expect(c.getState().draft.accountId).toBe(ACC_B.id);
      expect(c.getState().statement?.marks.accountId).toBeUndefined();
      c.update({ type: 'set', field: 'instrumentName', value: B.name });
      c.update({ type: 'set', field: 'side', value: 'L' });
      c.update({ type: 'set', field: 'entryPrice', value: '100' });
      c.update({ type: 'set', field: 'exitPrice', value: '99' });
      c.update({ type: 'set', field: 'quantity', value: '1' });
      typeFive(c);
      await c.save();
      expect(c.getState().phase).toBe('saved');
      expect(learns(fake)).toHaveLength(0);
    },
  );
});

describe('口座の切り替えで損益を口座の通貨でやり直す（AC-13。C7）', () => {
  const ACC_D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });
  const ROW_USD: ReadRow = { ...ROW_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' };

  it('C4 → C7: 提案の口座 D（USD）で入り、A に替えると外れ、D に戻すと戻る。手で打った値は残る', async () => {
    const { c } = await openedWith([read([ROW_USD], { key: KX, accountId: ACC_D.id })], {
      accounts: [ACC_A, ACC_D],
      last: ACC_A.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_D.id);
    expect(c.getState().draft.pnlYen).toBe('-62');
    expect(c.getState().draft.feeYen).toBe('2');
    c.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    expect(c.getState().draft.pnlYen).toBe('');
    expect(c.getState().draft.feeYen).toBe('');
    c.update({ type: 'set', field: 'accountId', value: ACC_D.id });
    expect(c.getState().draft.pnlYen).toBe('-62');
    expect(c.getState().draft.feeYen).toBe('2');
    // 手で手数料を打つ → A・D のどちらへ替えても残る
    c.update({ type: 'set', field: 'feeYen', value: '3' });
    c.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    expect(c.getState().draft.feeYen).toBe('3');
    expect(c.getState().draft.pnlYen).toBe('');
    c.update({ type: 'set', field: 'accountId', value: ACC_D.id });
    expect(c.getState().draft.feeYen).toBe('3');
    expect(c.getState().draft.pnlYen).toBe('-62');
  });

  it('C3: 円の口座で USD の明細 → 損益・手数料は入らない（ほかの欄は入る）', async () => {
    const { c } = await openedWith([read([ROW_USD], null)], { accounts: [ACC_A] });
    await c.readImage(img());
    expect(c.getState().draft.pnlYen).toBe('');
    expect(c.getState().draft.feeYen).toBe('');
    expect(c.getState().draft.instrumentName).toBe(ROW_E1.symbol);
  });
});

describe('レビュー後（#66 デザイン 1・4・5、P3）', () => {
  const ACC_D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });
  const ROW_USD: ReadRow = { ...ROW_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' };

  it('デザイン 1: 覚えの無い明細 → firstTime。本人が口座を選ぶと消える。鍵が無い・覚えあり・口座 1 つでは出ない', async () => {
    const { c } = await openedWith([read([ROW_E1], { key: KX, accountId: null })], {
      last: ACC_B.id,
    });
    await c.readImage(img());
    expect(c.getState().statement?.firstTime).toBe(true);
    c.update({ type: 'set', field: 'accountId', value: ACC_A.id });
    expect(c.getState().statement?.firstTime).toBe(false);
    const cases: [{ key: string; accountId: string | null } | null, (typeof ACC_A)[]][] = [
      [null, [ACC_A, ACC_B]],
      [{ key: KX, accountId: ACC_A.id }, [ACC_A, ACC_B]],
      [{ key: KX, accountId: null }, [ACC_A]],
    ];
    for (const [profile, accounts] of cases) {
      const o = await openedWith([read([ROW_E1], profile)], { accounts });
      await o.c.readImage(img());
      expect(o.c.getState().statement?.firstTime).toBe(false);
    }
  });

  it('デザイン 4: 覚えた口座の通貨が明細と違う → 口座は選ぶが印は付けない', async () => {
    const { c } = await openedWith([read([ROW_USD], { key: KX, accountId: ACC_B.id })], {
      accounts: [ACC_A, ACC_B, ACC_D],
      last: ACC_A.id,
    });
    await c.readImage(img());
    expect(c.getState().draft.accountId).toBe(ACC_B.id);
    expect(c.getState().statement?.marks.accountId).toBeUndefined();
    expect(c.getState().draft.pnlYen).toBe('');
  });

  it('デザイン 5: 覚えが無かった明細を記録 → 保存の後に learned。覚えと同じ口座・口座 1 つなら付かない', async () => {
    const first = await openedWith([read([ROW_E1], { key: KX, accountId: null })], {
      last: ACC_B.id,
    });
    await first.c.readImage(img());
    typeFive(first.c);
    await first.c.save();
    expect(first.c.getState().saved?.learned).toBe(true);
    const again = await openedWith([read([ROW_E1], { key: KX, accountId: ACC_A.id })], {
      last: ACC_B.id,
    });
    await again.c.readImage(img());
    typeFive(again.c);
    await again.c.save();
    expect(again.c.getState().saved?.learned).toBeUndefined();
    const one = await openedWith([read([ROW_E1], { key: KX, accountId: null })], {
      accounts: [ACC_A],
    });
    await one.c.readImage(img());
    typeFive(one.c);
    await one.c.save();
    expect(one.c.getState().saved?.learned).toBeUndefined();
  });

  it('P3: 円の口座・通貨が不明・銘柄が USD 建て → 損益・手数料を入れない（未設定の銘柄なら入れる）', async () => {
    const unknownRow: ReadRow = { ...ROW_E1, symbol: '架空指数U', pnlCurrency: 'unknown' };
    const usdInst = { ...B, id: 'inst-usd', name: '架空指数U', priceCurrency: 'USD' };
    const fake = createFakeApi({
      instruments: [B, usdInst],
      accounts: [ACC_A],
      reads: [read([unknownRow], null), read([{ ...unknownRow, symbol: B.name }], null)],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(img());
    expect(c.getState().draft.pnlYen).toBe('');
    expect(c.getState().draft.feeYen).toBe('');
    await c.readImage(img());
    expect(c.getState().draft.pnlYen).toBe('-2000');
  });
});
