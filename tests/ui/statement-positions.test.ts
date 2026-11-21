// 明細のオプションの行をポジションの下書きにまとめる純関数（#118。ui/src/lib/statement-positions.ts・statement-fill.ts の
// option の検査・record-form.ts の明細の損益 + 手で足したレッグ）。値はすべて架空（手計算の例は各テストの注）
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { toLocalInput } from '../../ui/src/lib/datetime';
import {
  EMPTY_LEG,
  editLeg,
  hasYearInferred,
  type LegDraft,
  legReadText,
  readLegs,
  sqEndOf,
} from '../../ui/src/lib/legs-form';
import { type Draft, EMPTY_DRAFT, readDraft } from '../../ui/src/lib/record-form';
import { stage1Statement, tradeSummary } from '../../ui/src/lib/record-screen';
import {
  fillFromRow,
  parseReadResponse,
  type ReadRow,
  rowLabel,
} from '../../ui/src/lib/statement-fill';
import {
  gatePosition,
  hasPositions,
  initialUnits,
  legDraftOf,
  legsWithZone,
  mergeNext,
  nextPositionIndex,
  nextPositionView,
  OPTION_INSTRUMENT_NEEDED,
  optionInstrumentName,
  splitUnit,
  statementPnlWithLegs,
  syncExpiry,
  unitLegs,
  unitRow,
  unitRows,
} from '../../ui/src/lib/statement-positions';
import { defaultAccount } from './helpers/accounts';
import {
  jst,
  OPT_A1,
  OPT_A2,
  OPT_B1,
  type OptionRowSpec,
  optionRowJson,
  ROW_E1,
  statementBody,
  unknownTz,
} from './helpers/statement-rows';

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
const ctx = {
  instruments: [XYZOP],
  accounts: [defaultAccount(20_000_000)],
};

function parsed(rows: readonly unknown[]): readonly ReadRow[] {
  const r = parseReadResponse(statementBody(rows));
  if (r === null) throw new Error('読めない');
  return r.rows;
}

const raw = parsed([optionRowJson(OPT_A1), optionRowJson(OPT_A2), ROW_E1, optionRowJson(OPT_B1)]);

describe('応答のオプションの行の検査（未知の形を信じない）', () => {
  it('API の形を写す', () => {
    expect(raw[0]?.option).toEqual({
      underlying: '架空指数XYZOP',
      expiry: '2027-01',
      expiryYearInferred: false,
      putCall: 'put',
      strike: 36_000,
      side: 'sell',
      position: 0,
    });
    expect(raw[2]?.option).toBeUndefined();
  });
  it('型違い・範囲の外の欄は null。年を補った印は限月が読めたときだけ', () => {
    const [row] = parsed([
      {
        ...optionRowJson(OPT_A1),
        option: {
          underlying: 'X\u0000',
          expiry: '2027-13',
          expiryYearInferred: true,
          putCall: 'P',
          strike: -1,
          side: 'L',
          position: 1.5,
        },
      },
    ]);
    expect(row?.option).toEqual({
      underlying: null,
      expiry: null,
      expiryYearInferred: false,
      putCall: null,
      strike: null,
      side: null,
      position: null,
    });
  });
  it('option がオブジェクトでなければオプションでない行（true・文字・配列）', () => {
    for (const option of [true, 'P', [1], null]) {
      const [row] = parsed([{ ...optionRowJson(OPT_A1), option }]);
      expect(row?.option).toBeUndefined();
    }
  });
  it('position の上限（20 行）と負の数は null', () => {
    for (const position of [-1, 20, 1e9]) {
      const [row] = parsed([
        {
          ...optionRowJson(OPT_A1),
          option: { ...(optionRowJson(OPT_A1).option as object), position },
        },
      ]);
      expect(row?.option?.position).toBeNull();
    }
  });
});

describe('まとまり（7.6 の 2）', () => {
  it('同じ position の行を 1 件に、先物の行は 1 行 1 件。最初に出た位置に置く', () => {
    expect(initialUnits(raw)).toEqual([[0, 1], [2], [3]]);
  });
  it('position の無いオプションの行は 1 行 1 件', () => {
    const rows = parsed([
      {
        ...optionRowJson(OPT_A1),
        option: { ...(optionRowJson(OPT_A1).option as object), position: null },
      },
      optionRowJson(OPT_A2),
    ]);
    expect(initialUnits(rows)).toEqual([[0], [1]]);
  });
  it('「i / N 件目」は取引とポジションを合わせて数える', () => {
    const rows = unitRows(raw, initialUnits(raw));
    expect(rows).toHaveLength(3);
    expect(hasPositions(rows)).toBe(true);
    expect(hasPositions([ROW_E1])).toBe(false);
    expect(rowLabel(1, 3, '件目')).toBe('2 / 3 件目');
    expect(rowLabel(1, 3)).toBe('2 / 3 行目');
  });
});

describe('合成の行（unitRow）', () => {
  it('手計算: 損益 259,000 + (−161,000) = 98,000、手数料 2,000、時刻は最初の建て〜最後の決済', () => {
    const r = unitRow(raw, [0, 1]);
    expect(r).toMatchObject({
      symbol: '架空指数XYZOP',
      side: null,
      entryPrice: null,
      exitPrice: null,
      quantity: null,
      pnl: 98_000,
      pnlCurrency: 'JPY',
      fees: [1_000, 1_000],
      feesTotal: 2_000,
      exitOrderType: 'unknown',
      legRaw: [0, 1],
    });
    expect(r?.entryTime?.written).toBe('2026-12-08T09:40');
    expect(r?.exitTime?.written).toBe('2026-12-22T13:16');
    expect(r?.legs).toHaveLength(2);
  });
  it('注文の種類は最後に決済した行の値', () => {
    const rows = parsed([
      optionRowJson({ ...OPT_A1, order: 'market' }),
      optionRowJson({ ...OPT_A2, order: 'stop' }),
    ]);
    expect(unitRow(rows, [0, 1])?.exitOrderType).toBe('stop');
    expect(unitRow(rows, [1, 0])?.exitOrderType).toBe('stop');
  });
  it('損益が 1 行でも読めない・通貨が違えば合計しない（null・unknown）', () => {
    const noPnl = parsed([optionRowJson(OPT_A1), { ...optionRowJson(OPT_A2), pnl: null }]);
    expect(unitRow(noPnl, [0, 1])?.pnl).toBeNull();
    const usd = parsed([optionRowJson(OPT_A1), { ...optionRowJson(OPT_A2), pnlCurrency: 'USD' }]);
    expect(unitRow(usd, [0, 1])).toMatchObject({ pnl: null, pnlCurrency: 'unknown' });
  });
  it('足し算の誤差を丸める（0.1 + 0.2 = 0.3）', () => {
    const rows = parsed([
      { ...optionRowJson(OPT_A1), pnl: 0.1 },
      { ...optionRowJson(OPT_A2), pnl: 0.2 },
    ]);
    expect(unitRow(rows, [0, 1])?.pnl).toBe(0.3);
  });
  it('先物の行はそのまま。番号が範囲の外なら無し', () => {
    expect(unitRow(raw, [2])).toBe(raw[2]);
    expect(unitRow(raw, [9])).toBeUndefined();
  });
  it('流し込み: 銘柄 = 原資産、プレミアム・向き・枚数は取引の欄へ入れない', () => {
    const r = unitRow(raw, [0, 1]) as ReadRow;
    const f = fillFromRow(EMPTY_DRAFT, r, new Set());
    expect(f.draft).toMatchObject({
      instrumentName: '架空指数XYZOP',
      side: null,
      entryPrice: '',
      exitPrice: '',
      quantity: '',
      pnlYen: '98000',
      feeYen: '2000',
    });
  });
});

describe('レッグの下書き（7.6 の 3）', () => {
  it('明細の行 → レッグ（P / C・限月・行使価格・売買・枚数・建値・決済値・時刻・読み取りの印）', () => {
    const l = legDraftOf(raw[0] as ReadRow, 0, [0, 1], null);
    expect(l).toEqual({
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '36000',
      side: 'sell',
      quantity: '2',
      entryPrice: '240',
      exitPrice: '110',
      expired: false,
      entryTime: OPT_A1.opened.epochMs,
      exitTime: OPT_A1.closed.epochMs,
      read: { raw: 0, unit: [0, 1], yearInferred: false },
    });
    expect(legReadText(l)).toBe('読み取り');
  });
  it('年を補った限月は別の札（hasYearInferred）。限月を直すと外れ、印は「修正済み」', () => {
    const [row] = parsed([optionRowJson({ ...OPT_A1, inferred: true })]);
    const l = legDraftOf(row as ReadRow, 0, [0], null);
    expect(legReadText(l)).toBe('読み取り');
    expect(hasYearInferred([l])).toBe(true);
    const qty = editLeg(l, { ...l, quantity: '3' });
    expect(legReadText(qty)).toBe('修正済み');
    expect(hasYearInferred([qty])).toBe(true);
    const month = editLeg(l, { ...l, contractMonth: '2028-01' });
    expect(hasYearInferred([month])).toBe(false);
    expect(editLeg(l, { ...l })).toEqual(l);
  });
  it('時間帯の無い時刻は、選んだ時間帯で epoch に。無ければ時刻なし（legsWithZone で当て直す）', () => {
    const [row] = parsed([
      optionRowJson({
        ...OPT_A1,
        opened: unknownTz('2026-12-08T09:40'),
        closed: unknownTz('2026-12-22T13:15'),
      }),
    ]);
    const none = legDraftOf(row as ReadRow, 0, [0], null);
    expect(none.entryTime).toBeUndefined();
    expect(none.exitTime).toBeUndefined();
    const tokyo = legsWithZone([none], [row as ReadRow], 'jst');
    expect(tokyo[0]?.entryTime).toBe(OPT_A1.opened.epochMs);
    expect(tokyo[0]?.exitTime).toBe(OPT_A1.closed.epochMs);
    expect(legsWithZone(tokyo, [row as ReadRow], null)[0]?.entryTime).toBeUndefined();
  });
  it('まとめ直しても、本人が直したレッグ（同じ明細の行）と手で足したレッグは保つ', () => {
    const r = unitRow(raw, [0, 1]) as ReadRow;
    const first = unitLegs([], r, null);
    const edited = [{ ...(first[0] as LegDraft), quantity: '3' }, first[1] as LegDraft];
    const manual: LegDraft = { ...EMPTY_LEG, optionType: 'P', side: 'buy' };
    const only0 = unitLegs([...edited, manual], unitRow(raw, [0]) as ReadRow, null);
    expect(only0.map((l) => l.read?.raw ?? 'manual')).toEqual([0, 'manual']);
    expect(only0[0]?.quantity).toBe('3');
    expect(only0[0]?.read?.unit).toEqual([0]);
  });
});

describe('[別のポジションにする] / ［このポジションに入れる］', () => {
  const units = initialUnits(raw);
  it('分けた行はすぐ後ろの 1 件（次に記録する）。1 本・先物・範囲の外は分けない', () => {
    expect(splitUnit(raw, units, 0, 1)).toEqual([[0], [1], [2], [3]]);
    expect(splitUnit(raw, units, 0, 0)).toEqual([[1], [0], [2], [3]]);
    expect(splitUnit(raw, units, 2, 3)).toBeNull();
    expect(splitUnit(raw, units, 1, 2)).toBeNull();
    expect(splitUnit(raw, units, 0, 3)).toBeNull();
  });
  it('次のポジションは同じ原資産のいちばん近いオプションのまとまり（先物の行をまたぐ）', () => {
    expect(nextPositionIndex(raw, units, 0)).toBe(2);
    expect(nextPositionIndex(raw, units, 1)).toBeNull();
    expect(nextPositionIndex(raw, units, 2)).toBeNull();
    expect(mergeNext(raw, units, 0)).toEqual([[0, 1, 3], [2]]);
  });
  it('分けて入れ直すと元に戻る', () => {
    const split = splitUnit(raw, units, 0, 0) as number[][];
    expect(mergeNext(raw, split, 0)).toEqual(units);
  });
  it('原資産が違えばまとめない', () => {
    const rows = parsed([
      optionRowJson(OPT_A1),
      optionRowJson({ ...OPT_B1, underlying: '架空指数QOP' }),
    ]);
    expect(nextPositionIndex(rows, initialUnits(rows), 0)).toBeNull();
    expect(mergeNext(rows, initialUnits(rows), 0)).toBeNull();
  });
});

/** 例のポジションの下書き（取引の欄は手で入れた形） */
function positionDraft(specs: readonly OptionRowSpec[], extra: Partial<Draft> = {}) {
  const rows = parsed(specs.map(optionRowJson));
  const unit = specs.map((_, i) => i);
  const row = unitRow(rows, unit) as ReadRow;
  const f = fillFromRow(EMPTY_DRAFT, row, new Set());
  const draft: Draft = {
    ...f.draft,
    legs: unitLegs([], row, null),
    entryPrice: '38500',
    exitPrice: '39100',
    lc: '37800',
    lcDecided: true,
    lcMove: 'none',
    timeframeChange: 'none',
    entryTime: f.draft.entryTime,
    ...extra,
  };
  return { rows, row, draft, marks: f.marks };
}

describe('C54: 注文の種類が満期（SQ）になったら明細の逆指値の既定を外す・SQ でなくなれば戻す', () => {
  const stop = [OPT_A1, { ...OPT_A2, order: 'stop' as const }];
  const expiredSell: LegDraft = {
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
  it('決済したレッグだけ: 逆指値の既定のまま（決済の理由 = LC・逆指値を入れた）', () => {
    const { draft, marks, row } = positionDraft(stop);
    expect(draft).toMatchObject({ exitReason: 'lc', stopOrderPlaced: 'placed' });
    const s = syncExpiry(draft, marks, new Set(), row, null);
    expect(s.draft).toBe(draft);
  });
  it('満期で消えた売りを足す → 決済の理由 = その他・未回答・決済の時刻 = SQ の日（印 sq）。消すと明細の値に戻る', () => {
    const { draft, marks, row } = positionDraft(stop);
    const withSq = { ...draft, legs: [...draft.legs, expiredSell] };
    const s = syncExpiry(withSq, marks, new Set(), row, null);
    expect(s.draft).toMatchObject({
      exitReason: 'other',
      stopOrderPlaced: 'unanswered',
      exitTime: toLocalInput(sqEndOf('2027-01') as number),
    });
    expect(s.marks.exitReason).toBeUndefined();
    expect(s.marks.exitTime).toBe('sq');
    // 保存の本文は満期（SQ）
    const body = readDraft(s.draft, ctx).body;
    expect(body?.exit).toMatchObject({ orderType: 'expiry', reason: 'other' });
    expect(body?.stopOrderPlaced).toBe('unanswered');
    // 消した → 戻す
    const back = syncExpiry({ ...s.draft, legs: draft.legs }, s.marks, new Set(), row, null);
    expect(back.draft).toMatchObject({
      exitReason: 'lc',
      stopOrderPlaced: 'placed',
      exitTime: draft.exitTime,
    });
    expect(back.marks).toMatchObject({ exitReason: 'statement', exitTime: 'read' });
    expect(readDraft(back.draft, ctx).body?.exit.orderType).toBe('stop');
  });
  it('本人が触った決済の理由・決済の時刻は変えない', () => {
    const { draft, marks, row } = positionDraft(stop);
    const touched = new Set(['exitReason', 'exitTime'] as const);
    const mine = { ...draft, exitReason: 'tp' as const, legs: [...draft.legs, expiredSell] };
    const s = syncExpiry(mine, marks, touched, row, null);
    expect(s.draft).toMatchObject({ exitReason: 'tp', exitTime: draft.exitTime });
    expect(s.draft.stopOrderPlaced).toBe('unanswered');
  });
  it('満期で消えた買いだけを足しても時点は変わらない（C54）', () => {
    const { draft, marks, row } = positionDraft(stop);
    const buy = { ...expiredSell, side: 'buy' as const };
    const s = syncExpiry({ ...draft, legs: [...draft.legs, buy] }, marks, new Set(), row, null);
    expect(s.draft).toMatchObject({ exitReason: 'lc', stopOrderPlaced: 'placed' });
  });
  it('手の記録・レッグがそろっていない間は変えない', () => {
    const { draft, marks, row } = positionDraft(stop);
    const manual = { ...draft, source: 'manual' as const, legs: [...draft.legs, expiredSell] };
    expect(syncExpiry(manual, marks, new Set(), row, null).draft).toBe(manual);
    const half = { ...draft, legs: [...draft.legs, { ...expiredSell, strike: '' }] };
    expect(syncExpiry(half, marks, new Set(), row, null).draft).toBe(half);
  });
});

describe('4.7: 手で足した決済のレッグの損益を明細の損益に足す', () => {
  /** P 35,000 買い 1（50 → 20）: (20 − 50) × 1 × 1,000 = −30,000 */
  const closedBuy: LegDraft = {
    ...EMPTY_LEG,
    optionType: 'P',
    contractMonth: '2027-01',
    strike: '35000',
    side: 'buy',
    quantity: '1',
    entryPrice: '50',
    exitPrice: '20',
  };
  it('手計算: 98,000 + (−30,000) = 68,000 を明細の損益として保存する', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const r = readDraft({ ...draft, legs: [...draft.legs, closedBuy] }, ctx);
    expect(r.body?.statementPnlYen).toBe(68_000);
    expect(r.option?.legsEdited).toBe(false);
    // 足さなければ明細の損益のまま
    expect(readDraft(draft, ctx).body?.statementPnlYen).toBe(98_000);
  });
  it('満期で消えたレッグは足さない（core が導出して足す）', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const expired = { ...closedBuy, expired: true, exitPrice: '0' };
    expect(readDraft({ ...draft, legs: [...draft.legs, expired] }, ctx).body?.statementPnlYen).toBe(
      98_000,
    );
  });
  it('為替が要るのに無ければ明細の損益を空に（レッグの合計）。為替があれば掛けて足す', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const drafts = [...draft.legs, closedBuy];
    const legs = readLegs(drafts).legs ?? [];
    expect(statementPnlWithLegs(98_000, drafts, legs, 1_000, undefined)).toEqual({
      pnl: undefined,
      dropped: true,
    });
    expect(statementPnlWithLegs(98_000, drafts, legs, 1_000, 150)).toEqual({
      pnl: 98_000 - 30_000 * 150,
      dropped: false,
    });
  });
  it('明細のレッグを消した・満期で消滅にした → 明細の損益を空にして 1 行「損益はレッグの合計」', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const removed = readDraft({ ...draft, legs: [draft.legs[0] as LegDraft] }, ctx);
    expect(removed.body?.statementPnlYen).toBeUndefined();
    expect(removed.option?.legsEdited).toBe(true);
    const expired = readDraft(
      {
        ...draft,
        legs: [{ ...(draft.legs[0] as LegDraft), expired: true }, draft.legs[1] as LegDraft],
      },
      ctx,
    );
    expect(expired.body?.statementPnlYen).toBeUndefined();
  });
  it('明細の損益が無ければ何もしない。明細のレッグが無い（手の記録）なら何もしない', () => {
    expect(statementPnlWithLegs(undefined, [], [], 1_000, 1)).toEqual({
      pnl: undefined,
      dropped: false,
    });
    const legs = readLegs([closedBuy]).legs ?? [];
    expect(statementPnlWithLegs(5_000, [closedBuy], legs, 1_000, 1)).toEqual({
      pnl: 5_000,
      dropped: false,
    });
  });
});

describe('レッグの時刻とポジションの時刻の範囲（API の outOfPosition を保存の前に）', () => {
  it('決済の時刻を最後のレッグの決済より前にすると誤り', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const early = toLocalInput(jst(2026, 12, 22, 13, 0).epochMs as number);
    const r = readDraft({ ...draft, exitTime: early }, ctx);
    expect(r.errors.exitTime).toBeDefined();
    expect(r.canSave).toBe(false);
  });
  it('エントリーの時刻を最初のレッグの建てより後にすると誤り', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2]);
    const late = toLocalInput(jst(2026, 12, 8, 10, 0).epochMs as number);
    expect(readDraft({ ...draft, entryTime: late }, ctx).errors.entryTime).toBeDefined();
    expect(readDraft(draft, ctx).canSave).toBe(true);
  });
});

const FUT: InstrumentRecord = {
  ...XYZOP,
  id: 'i-fut',
  name: '架空指数XYZOP',
  productForm: 'future',
};
const N225F: InstrumentRecord = { ...XYZOP, id: 'i-n225', name: '架空225', productForm: 'future' };
const N225OP: InstrumentRecord = { ...XYZOP, id: 'i-n225op', name: '架空225オプション' };

describe('銘柄の当て方（レビュー B1）: オプションの形の銘柄の中からだけ', () => {
  it('先物「架空225」とオプション「架空225オプション」→ オプション。先物には当てない', () => {
    expect(optionInstrumentName('架空225', [N225F, N225OP])).toEqual({
      name: '架空225オプション',
      matched: true,
    });
    expect(optionInstrumentName('架空225', [N225F])).toEqual({
      name: '架空225オプション',
      matched: false,
    });
  });
  it('名前 = 原資産の名前も当てる。名前の同一視（全角・大小）', () => {
    expect(optionInstrumentName('架空指数ＸＹＺＯＰ', [XYZOP]).name).toBe('架空指数XYZOP');
  });
  it('複数当たれば最後に記録した取引の銘柄、無ければ一覧の先', () => {
    const both = [XYZOP, { ...N225OP, name: '架空指数XYZOPオプション' }];
    expect(optionInstrumentName('架空指数XYZOP', both, '架空指数XYZOPオプション').name).toBe(
      '架空指数XYZOPオプション',
    );
    expect(optionInstrumentName('架空指数XYZOP', both, '別の銘柄').name).toBe('架空指数XYZOP');
  });
  it('原資産の名前がすでに「オプション」で終われば重ねない', () => {
    expect(optionInstrumentName('架空225オプション', []).name).toBe('架空225オプション');
  });
});

describe('一覧に無いときはオプションの銘柄を足す案（乗数は本人が入れる）', () => {
  it('乗数が空なら足りない欄。入れるとレッグを読み、足す銘柄の欄を本文の隣に', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2], { instrumentName: '架空225オプション' });
    const none = readDraft(draft, { ...ctx, instruments: [N225F] });
    expect(none.option?.newInstrument).toBe('架空225オプション');
    expect(none.missing).toContain('乗数');
    expect(none.canSave).toBe(false);
    const r = readDraft(
      { ...draft, instrumentMultiplier: '1000' },
      { ...ctx, instruments: [N225F] },
    );
    expect(r.canSave).toBe(true);
    expect(r.instrument).toEqual({
      name: '架空225オプション',
      create: {
        productForm: 'option',
        multiplier: 1000,
        priceCurrency: 'JPY',
        underlying: '架空225',
      },
    });
    expect(r.body?.legs).toHaveLength(2);
    // 損益は乗数で: 明細の損益 98,000 のまま
    expect(r.body?.statementPnlYen).toBe(98_000);
  });
  it('乗数が数でなければ誤り', () => {
    const { draft } = positionDraft([OPT_A1, OPT_A2], {
      instrumentName: '架空225オプション',
      instrumentMultiplier: 'x',
    });
    expect(readDraft(draft, { ...ctx, instruments: [] }).errors.instrumentMultiplier).toBeDefined();
  });
});

describe('保存の門: 先物・CFD の銘柄の名前を打ったポジション', () => {
  it('先物の形の銘柄なら保存しない（形を変えさせない文）。名前が空なら足りない欄に任せる', () => {
    const { draft, row } = positionDraft([OPT_A1, OPT_A2]);
    const r = readDraft(draft, { ...ctx, instruments: [FUT] });
    const g = gatePosition(r, row);
    expect(g.canSave).toBe(false);
    expect(g.notice).toBe(OPTION_INSTRUMENT_NEEDED);
    expect(OPTION_INSTRUMENT_NEEDED).not.toContain('設定');
    const empty = readDraft({ ...draft, instrumentName: '' }, ctx);
    expect(gatePosition(empty, row)).toBe(empty);
    // オプションの銘柄・先物の行では変えない
    const ok = readDraft(draft, ctx);
    expect(gatePosition(ok, row)).toBe(ok);
    expect(gatePosition(r, ROW_E1)).toBe(r);
  });
});

describe('次のポジションの見出し・2 段目の要約（デザインレビュー 2・5・1）', () => {
  it('エントリーの日と 1 本目のレッグの 1 行', () => {
    const units = initialUnits(raw);
    expect(nextPositionView(raw, units, 0)).toEqual({
      legs: 1,
      head: '買い 1 · C 41,000 · 2027-01',
      opened: '12/9',
    });
    expect(nextPositionView(raw, units, 2)).toBeNull();
  });
  it('要約の 1 行目は銘柄だけ、2 行目の先頭に向きとレッグの本数。年を補ったレッグがあれば札', () => {
    const rows = parsed([optionRowJson({ ...OPT_A1, inferred: true }), optionRowJson(OPT_A2)]);
    const row = unitRow(rows, [0, 1]) as ReadRow;
    const d = { ...positionDraft([OPT_A1, OPT_A2]).draft, legs: unitLegs([], row, null) };
    const r = readDraft(d, ctx);
    const sum = tradeSummary(d, r.errors, {}, r.option);
    expect(sum.name).toBe('架空指数XYZOP');
    expect(sum.line2Parts.slice(0, 2)).toEqual(['L ·', 'レッグ 2 ·']);
    expect(sum.line2.startsWith('L · レッグ 2 · 原資産 イン ')).toBe(true);
    expect(sum.yearInferred).toBe(true);
  });
  it('1 段目の数え方は「件」（明細の行の数を添える）', () => {
    const rows = unitRows(raw, initialUnits(raw));
    expect(stage1Statement({ phase: 'ready', rows, raw })).toEqual({
      kind: 'filled',
      text: '3 件（明細の 4 行）を読み取りました',
    });
    expect(stage1Statement({ phase: 'ready', rows: [ROW_E1, ROW_E1] })).toEqual({
      kind: 'filled',
      text: '2 行を読み取りました',
    });
  });
});
