// 記録する・直す画面のオプションのポジションの読み（#117。設計書 4.7・5.7・7.6・C47・C49・C50）と見せ方（option-view）。
// 値・名前はすべて架空（架空の指数 XYZ のオプション・乗数 1,000・円の口座）
import { describe, expect, it } from 'vitest';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../core/record';
import { draftFromStored, editContext, mergeEdit } from '../../ui/src/lib/edit-form';
import { EMPTY_LEG, type LegDraft } from '../../ui/src/lib/legs-form';
import {
  LEGS_EDITED,
  legCountText,
  legRows,
  MAX_LOSS_AS_PLANNED,
  maxLossText,
  optionVerdictLines,
  SIDE_MISMATCH,
} from '../../ui/src/lib/option-view';
import { reasonText } from '../../ui/src/lib/reasons';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  EMPTY_DRAFT,
  readDraft,
} from '../../ui/src/lib/record-form';

const XYZ: InstrumentRecord = {
  id: 'i-xyz',
  name: '架空指数XYZオプション',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'JPY',
  multiplier: 1_000,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
};
const FUT: InstrumentRecord = {
  ...XYZ,
  id: 'i-fut',
  name: '架空指数XYZ先物',
  productForm: 'future',
};

const account = (capitalYen: number): AccountRecord => ({
  id: 'default',
  name: '口座 1',
  currency: 'JPY',
  capitalYen,
  riskTolerancePct: 1,
  capitalHistory: [],
  createdAt: 1,
  updatedAt: 1,
});
const ctx = (capital = 10_000_000): DraftContext => ({
  instruments: [XYZ, FUT],
  accounts: [account(capital)],
});

const leg = (o: Partial<LegDraft>): LegDraft => ({ ...EMPTY_LEG, contractMonth: '2027-01', ...o });

const base: Draft = {
  ...EMPTY_DRAFT,
  instrumentName: XYZ.name,
  exitTime: '2027-01-06T13:30',
  lcDecided: true,
  lcMove: 'none',
  timeframeChange: 'none',
};

// 5.7 の満期で消えたレッグの例: P 37,000 買い 1（300・満期で消滅）、P 36,000 売り 1（150 → 30・明細の損益 +120,000 円）
const expiredExample: Draft = {
  ...base,
  entryPrice: '38500',
  exitPrice: '38200',
  lc: '37800',
  pnlYen: '120000',
  legs: [
    leg({
      optionType: 'P',
      strike: '37000',
      side: 'buy',
      quantity: '1',
      entryPrice: '300',
      exitPrice: '0',
      expired: true,
    }),
    leg({
      optionType: 'P',
      strike: '36000',
      side: 'sell',
      quantity: '1',
      entryPrice: '150',
      exitPrice: '30',
    }),
  ],
};

// 5.7 の最大損失の例: P 38,000 買い 1（400）・P 37,000 売り 1（150）、資金 20,000,000 円
const maxLossExample: Draft = {
  ...base,
  entryPrice: '38200',
  exitPrice: '38100',
  lcMaxLoss: true,
  pnlYen: '-130000',
  legs: [
    leg({
      optionType: 'P',
      strike: '38000',
      side: 'buy',
      quantity: '1',
      entryPrice: '400',
      exitPrice: '300',
    }),
    leg({
      optionType: 'P',
      strike: '37000',
      side: 'sell',
      quantity: '1',
      entryPrice: '150',
      exitPrice: '180',
    }),
  ],
};

// 売りの裸（P 36,000 売り 1）で LC あり、勝ち
const nakedWin: Draft = {
  ...base,
  entryPrice: '38500',
  exitPrice: '38900',
  lc: '37500',
  legs: [
    leg({
      optionType: 'P',
      strike: '36000',
      side: 'sell',
      quantity: '1',
      entryPrice: '150',
      exitPrice: '50',
    }),
  ],
};

describe('オプションの形の欄（AC-1）', () => {
  it('先物の銘柄はレッグを読まない（option なし・数量と L / S を聞く）', () => {
    const r = readDraft({ ...nakedWin, instrumentName: FUT.name }, ctx());
    expect(r.option).toBeUndefined();
    expect(r.missing).toEqual(['L / S', '数量']);
    expect(r.body).toBeUndefined();
  });
  it('オプションの銘柄はレッグを読み、数量・L / S を聞かない', () => {
    const r = readDraft({ ...nakedWin, legs: [] }, ctx());
    expect(r.missing).toEqual(['レッグ']);
    expect(r.option?.askSide).toBe(false);
  });
  it('原資産の欄の名前で足りない欄を名指す', () => {
    const r = readDraft({ ...base, legs: [] }, ctx());
    expect(r.missing).toEqual([
      'エントリー時の原資産',
      '決済時の原資産',
      'LC（原資産・「なし」・「最大損失まで」）',
      'レッグ',
    ]);
  });
  it('レッグの欄に誤りがあれば保存できない', () => {
    const r = readDraft(
      { ...nakedWin, legs: [leg({ ...nakedWin.legs[0], quantity: 'x' })] },
      ctx(),
    );
    expect(r.errors.legs).toBeDefined();
    expect(r.option?.legErrors[0]?.quantity).toBeDefined();
    expect(r.canSave).toBe(false);
  });
});

describe('向き（C47）', () => {
  it('LC が原資産より下なら L、上なら S（自動）', () => {
    expect(readDraft(nakedWin, ctx()).body?.side).toBe('L');
    const s = readDraft({ ...nakedWin, lc: '39500' }, ctx());
    expect(s.option?.autoSide).toBe('S');
    expect(s.body?.side).toBe('S');
  });
  it('LC なしで限月が違う（満期の損益で比べられない）ときだけ L / S を聞く', () => {
    const d: Draft = {
      ...nakedWin,
      lc: '',
      lcNone: true,
      legs: [
        ...nakedWin.legs,
        leg({
          optionType: 'C',
          strike: '40000',
          side: 'buy',
          quantity: '1',
          entryPrice: '10',
          exitPrice: '5',
          contractMonth: '2027-02',
        }),
      ],
    };
    const r = readDraft(d, ctx());
    expect(r.option?.askSide).toBe(true);
    expect(r.missing).toContain('L / S');
    expect(readDraft({ ...d, side: 'S' }, ctx()).body?.side).toBe('S');
  });
  it('LC が L、レッグの満期の損益の比べ方が S なら食い違いの 1 行（AC-7）', () => {
    // コールの売りの裸（上がるほど損 = S の形）なのに LC を下に置いた（L）
    const d: Draft = {
      ...nakedWin,
      legs: [
        leg({
          optionType: 'C',
          strike: '40000',
          side: 'sell',
          quantity: '1',
          entryPrice: '100',
          exitPrice: '20',
        }),
      ],
    };
    const r = readDraft(d, ctx());
    expect(r.preview.option?.sideMismatch).toBe(true);
    expect(optionVerdictLines(r.preview.option, 'JPY').warnings).toEqual([SIDE_MISMATCH]);
  });
});

describe('満期で消えたレッグ（AC-4・4.7 の例）', () => {
  it('損益 = 明細 +120,000 + (−300 × 1 × 1,000) = −180,000 円（負け）。決済の時刻は SQ の日の終わり', () => {
    const r = readDraft(expiredExample, ctx());
    expect(r.preview.pnlYen).toBe(-180_000);
    expect(r.body?.legs?.[0]?.exit).toEqual({ price: 0, time: 1_799_420_399_999, kind: 'expired' });
    // 満期で消えたのは買いだけ → 決済の時点は決済した売り（注文の種類は明細の値 = 不明）
    expect(r.body?.exit.orderType).toBe('unknown');
  });
  it('売りが満期で消えたら注文の種類は満期（SQ）（C54）', () => {
    const r = readDraft(
      { ...nakedWin, legs: [leg({ ...nakedWin.legs[0], exitPrice: '0', expired: true })] },
      ctx(),
    );
    expect(r.body?.exit.orderType).toBe('expiry');
  });
});

describe('「最大損失まで」（AC-5・C50・#114 の 1・3）', () => {
  it('最大損失が定まるときだけ選べる', () => {
    expect(readDraft(maxLossExample, ctx()).option?.maxLossSelectable).toBe(true);
    expect(readDraft(nakedWin, ctx()).option?.maxLossSelectable).toBe(false);
  });
  it('5.7 の例: 1R = 最大損失 250,000 円・R = −130,000 ÷ 250,000 = −0.52・A・LC を動かしたかを聞かず none', () => {
    const r = readDraft({ ...maxLossExample, lcMove: null }, ctx(20_000_000));
    expect(r.missing).toEqual([]);
    expect(r.body?.riskPlan).toBe('maxLoss');
    expect(r.body?.lc).toBeUndefined();
    expect(r.body?.lcMove).toEqual({ kind: 'none' });
    expect(r.body?.side).toBe('S');
    const p = r.preview;
    expect(p.oneRYen).toBeCloseTo(250_000, 6);
    expect(p.r).toBeCloseTo(-0.52, 12);
    expect(p.riskPct).toBeCloseTo(1.25, 12);
    expect(p.noLc).toBe(false);
    expect(p.judgment?.grade).toBe('A');
    expect(p.option?.maxLossPlan).toBe(true);
    expect(optionVerdictLines(p.option, 'JPY').facts).toEqual([
      '1R は最大損失から · 最大損失 250,000円',
    ]);
    const asPlanned = p.judgment?.reasons.find((x) => x.kind === 'asPlannedLc');
    if (asPlanned === undefined) throw new Error('注記が無い');
    expect(reasonText(asPlanned, 'S', { maxLossPlan: true })).toBe(MAX_LOSS_AS_PLANNED);
    expect(reasonText(asPlanned, 'S')).toBe('決めた LC で切れた');
  });
  it('「広げた」を選んでいても「最大損失まで」なら none を送る', () => {
    const r = readDraft({ ...maxLossExample, lcMove: 'widened', lcAfter: '37000' }, ctx());
    expect(r.body?.lcMove).toEqual({ kind: 'none' });
  });
  it('#165 レビュー 1: 「最大損失まで」の間は見えない逆指値の未設定を送らない（外すと前の答えに戻る）', () => {
    const d = { ...maxLossExample, stopNotPlaced: true };
    expect(readDraft(d, ctx()).body?.stopOrderPlaced).toBe('unanswered');
    const off = applyDraft(d, { type: 'set', field: 'lc', value: '37800' });
    expect(off.stopNotPlaced).toBe(true);
  });
  it('「最大損失まで」と見込みは同時に送らない', () => {
    expect(
      readDraft({ ...maxLossExample, lcLossPlan: '90000' }, ctx()).body?.lcLossPlanYen,
    ).toBeUndefined();
  });
  it('レッグを変えて定まらなくなったら LC を選び直す', () => {
    const r = readDraft({ ...maxLossExample, legs: nakedWin.legs }, ctx());
    expect(r.missing).toContain('LC（原資産・「なし」・「最大損失まで」）');
  });
  it('選ぶと LC の価格・「なし」を外し、LC を打つと外れる', () => {
    const a = applyDraft(
      { ...base, lc: '37800', lcNone: false },
      { type: 'set', field: 'lcMaxLoss', value: true },
    );
    expect(a).toMatchObject({ lc: '', lcNone: false, lcMaxLoss: true });
    expect(applyDraft(a, { type: 'set', field: 'lc', value: '37800' }).lcMaxLoss).toBe(false);
    expect(applyDraft(a, { type: 'set', field: 'lcNone', value: true }).lcMaxLoss).toBe(false);
  });
});

describe('LC での損失の見込み（AC-8・K15・オーナーの決定 2026-11-21）', () => {
  it('売りの裸で見込み以外の 1R が出ないときだけ LC の枠に出す', () => {
    const r = readDraft(nakedWin, ctx());
    expect(r.preview.oneRYen).toBeUndefined();
    expect(r.option?.lossPlanUp).toBe(true);
    expect(optionVerdictLines(r.preview.option, 'JPY').facts).toEqual([
      '最大損失は定まらない（売りの裸）',
    ]);
  });
  it('入れると 1R は見込み（出したまま）', () => {
    const r = readDraft({ ...nakedWin, lcLossPlan: '150000' }, ctx());
    expect(r.body?.lcLossPlanYen).toBe(150_000);
    expect(r.preview.option?.oneRSource).toBe('plan');
    expect(r.option?.lossPlanUp).toBe(true);
  });
  it('売りの裸でも実際の動きから 1R が出る負けは「ほかの欄」のまま', () => {
    // 5.7 の (2) の例: 150 → 420、建てたとき 38,500・LC 37,500・決済 37,300
    const r = readDraft(
      {
        ...nakedWin,
        exitPrice: '37300',
        lcMove: 'none',
        legs: [leg({ ...nakedWin.legs[0], exitPrice: '420' })],
      },
      ctx(),
    );
    expect(r.preview.option?.oneRSource).toBe('actualMove');
    expect(r.option?.lossPlanUp).toBe(false);
  });
  it('限月がそろった買いのスプレッド（売りの裸でない）は「ほかの欄」', () => {
    expect(
      readDraft({ ...maxLossExample, lcMaxLoss: false, lc: '37500' }, ctx()).option?.lossPlanUp,
    ).toBe(false);
  });
});

describe('直す画面（AC-9・KEEP-3）', () => {
  const stored = (d: Draft): StoredTrade => {
    const r = readDraft(d, ctx());
    if (!r.body) throw new Error('本文が無い');
    return {
      id: 'T1',
      schemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
      record: { ...r.body, instrumentId: XYZ.id },
      snapshot: {
        instrument: {
          multiplier: 1_000,
          quantityStep: 1,
          priceCurrency: 'JPY',
          underlyingKind: 'index',
          productForm: 'option',
        },
        capitalYen: 10_000_000,
        riskTolerancePct: 1,
        accountCurrency: 'JPY',
      },
    };
  };
  it('「最大損失まで」の取引を開くと「なし」ではなく「最大損失まで」', () => {
    const t = stored(maxLossExample);
    const d = draftFromStored(t, [XYZ]);
    expect(d).toMatchObject({ lcNone: false, lcMaxLoss: true, lcMove: null });
    const r = readDraft(d, editContext(t, [XYZ]));
    expect(r.body?.riskPlan).toBe('maxLoss');
    if (!r.body) throw new Error('本文が無い');
    expect(mergeEdit(t.record, d, d, r.body, XYZ.id)).toEqual(t.record);
  });
  it('レッグを直すと明細の損益を空にし、1 行を出す（4.7）', () => {
    const t = stored(expiredExample);
    expect(t.record.statementPnlYen).toBe(120_000);
    const d0 = draftFromStored(t, [XYZ]);
    const legs = d0.legs.map((l, i) => (i === 1 ? { ...l, exitPrice: '20' } : l));
    const r = readDraft({ ...d0, legs }, editContext(t, [XYZ]));
    expect(r.option?.legsEdited).toBe(true);
    expect(r.body?.statementPnlYen).toBeUndefined();
    // 損益 = レッグの合計 = −300,000 + 130,000 = −170,000 円
    expect(r.preview.pnlYen).toBe(-170_000);
    expect(optionVerdictLines(r.preview.option, 'JPY', { legsEdited: true }).warnings).toContain(
      LEGS_EDITED,
    );
    if (!r.body) throw new Error('本文が無い');
    const merged = mergeEdit(t.record, d0, { ...d0, legs }, r.body, XYZ.id);
    expect(merged.statementPnlYen).toBeUndefined();
    expect(merged.legs?.[1]?.exit.price).toBe(20);
  });
  it('レッグの無い前からのオプションの取引はレッグを読まない（今の形のまま。KEEP-3）', () => {
    const legacy: StoredTrade = {
      ...stored(nakedWin),
      schemaVersion: 1,
      record: {
        status: 'closed',
        source: 'manual',
        instrumentId: XYZ.id,
        side: 'S',
        lc: 200,
        lcBasis: 'chart',
        stopOrderPlaced: 'unanswered',
        lcDecidedBeforeEntry: true,
        lcMove: { kind: 'none' },
        timeframeChange: 'none',
        entries: [{ price: 150, quantity: 1 }],
        exit: {
          time: 1_799_209_800_000,
          price: 50,
          orderType: 'unknown',
          reason: 'other',
          gapSlip: 'unanswered',
        },
        fees: [],
      },
    };
    const d = draftFromStored(legacy, [XYZ]);
    const r = readDraft(d, editContext(legacy, [XYZ]));
    expect(r.option).toBeUndefined();
    expect(r.body?.legs).toBeUndefined();
    expect(r.body?.entries).toEqual([{ price: 150, quantity: 1 }]);
  });
});

describe('詳細と一覧（AC-10・AC-11）', () => {
  const t: StoredTrade = {
    id: 'T1',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    record: {
      ...(readDraft(expiredExample, ctx()).body as NonNullable<
        ReturnType<typeof readDraft>['body']
      >),
      instrumentId: XYZ.id,
    },
    snapshot: {
      instrument: {
        multiplier: 1_000,
        quantityStep: 1,
        priceCurrency: 'JPY',
        underlyingKind: 'index',
        productForm: 'option',
      },
      capitalYen: 10_000_000,
      riskTolerancePct: 1,
      accountCurrency: 'JPY',
    },
  };
  it('レッグの行: 損益は sign × (決済 − イン) × 枚数 × 乗数', () => {
    expect(legRows(t).map((r) => [r.head, r.prices, r.pnl])).toEqual([
      ['買い 1 · P 37,000 · 2027-01', '300 → 0 満期で消滅', '−300,000円'],
      ['売り 1 · P 36,000 · 2027-01', '150 → 30', '+120,000円'],
    ]);
  });
  it('一覧の「レッグ 2」。レッグの無い取引は無し', () => {
    expect(legCountText(t)).toBe('レッグ 2');
    const { legs: _legs, ...noLegs } = t.record;
    expect(legCountText({ record: noLegs })).toBeNull();
  });
  it('最大損失の 1 行の言い方', () => {
    expect(maxLossText({ defined: true }, 'JPY')).toBe('最大損失は為替を入力すると表示されます');
    expect(maxLossText({ defined: false, cause: 'contractMonths' }, 'JPY')).toBe(
      '最大損失は定まらない（限月が違う）',
    );
  });
});
