// 2 枚目の明細から足を足す純関数（#260・設計書 C73・4.7・C54）。値はすべて架空（原資産 架空XYZ・乗数 1,000・円の口座）
import { describe, expect, it } from 'vitest';
import { legPnlPrice } from '../../core/option';
import type { InstrumentRecord } from '../../core/record';
import type { Leg } from '../../core/trade';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { EMPTY_LEG, type LegDraft, readLegs } from '../../ui/src/lib/legs-form';
import { type Draft, EMPTY_DRAFT } from '../../ui/src/lib/record-form';
import {
  ADD_LEGS_LABEL,
  ADD_LEGS_MSG,
  addLegsBlock,
  failedText,
  isSameLeg,
  pickAddRows,
  planAddLegs,
  pointAfterAdd,
  positionUnderlying,
  underlyingKey,
} from '../../ui/src/lib/statement-add-legs';
import { parseReadResponse, READ_MSG, type ReadRow } from '../../ui/src/lib/statement-fill';
import {
  addedLegFees,
  initialUnits,
  statementPnlWithLegs,
  unitLegs,
  unitRows,
} from '../../ui/src/lib/statement-positions';
import {
  ADD_A,
  ADD_B,
  ADD_C,
  jst,
  type OptionRowSpec,
  optionRowJson,
  unknownTz,
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
const MULT = 1_000;
const JPY = { accountCurrency: 'JPY', priceCurrency: 'JPY' } as const;

const rowsOf = (specs: readonly (OptionRowSpec | Record<string, unknown>)[]): ReadRow[] => {
  const r = parseReadResponse({
    kind: 'statement',
    rows: specs.map((s) => ('putCall' in s ? optionRowJson(s as OptionRowSpec) : s)),
  });
  if (!r) throw new Error('応答の形');
  return [...r.rows];
};

/** 1 枚目の明細（A・B）の足 */
function mainLegs(): LegDraft[] {
  const raw = rowsOf([ADD_A, ADD_B]);
  const row = unitRows(raw, initialUnits(raw))[0] as ReadRow;
  return unitLegs([], row, null);
}

const futuresRow = {
  symbol: '架空XYZ先物',
  side: 'L',
  entryPrice: 38_000,
  exitPrice: 38_100,
  quantity: 1,
  pnl: 100_000,
  pnlCurrency: 'JPY',
  entryTime: jst(2026, 12, 3, 9, 0),
  exitTime: jst(2026, 12, 3, 10, 0),
  timeZoneNeedsCheck: false,
  fees: [100],
  feesTotal: 100,
  exitOrderType: 'unknown',
};

const plan = (legs: readonly LegDraft[], rows: readonly ReadRow[], sheet = 1) =>
  planAddLegs({
    legs,
    instrumentName: XYZ.name,
    instruments: [XYZ],
    rows,
    sheet,
    zone: null,
  });

const fields = (l: LegDraft) => [
  l.optionType,
  l.contractMonth,
  l.strike,
  l.side,
  l.quantity,
  l.entryPrice,
  l.exitPrice,
];

const parsed = (drafts: readonly LegDraft[]): readonly Leg[] => {
  const legs = readLegs(drafts).legs;
  if (!legs) throw new Error(`足が読めない ${JSON.stringify(readLegs(drafts).errors)}`);
  return legs;
};

describe('足す行（R2。例 #1・#3・#4）', () => {
  it('ボタンの文字は「明細から追加」（操作の言葉は追加。ui-guidelines 8.1）', () => {
    expect(ADD_LEGS_LABEL).toBe('明細から追加');
  });

  it('原資産の鍵: 「架空XYZ」と「架空XYZオプション」は同じ。銘柄が決まればその原資産', () => {
    expect(underlyingKey('架空XYZオプション')).toBe(underlyingKey('架空ＸＹＺ'));
    expect(positionUnderlying(XYZ.name, [XYZ], [])).toEqual({ key: underlyingKey('架空XYZ') });
    // 一覧に無い名前は名前から
    expect(positionUnderlying('架空QQQオプション', [XYZ], [])).toEqual({
      key: underlyingKey('架空QQQ'),
    });
  });

  it('銘柄の欄が空なら、行の原資産が 1 種類のときだけそれ。2 種類以上は「先に銘柄を選んでください」', () => {
    const one = rowsOf([ADD_C]);
    expect(positionUnderlying('', [XYZ], one)).toEqual({ key: underlyingKey('架空XYZ') });
    const two = rowsOf([ADD_C, { ...ADD_C, underlying: '架空ABC' }]);
    expect(positionUnderlying('', [XYZ], two)).toEqual({ reason: 'chooseInstrument' });
    expect(
      planAddLegs({
        legs: [],
        instrumentName: '',
        instruments: [XYZ],
        rows: two,
        sheet: 1,
        zone: null,
      }).notice,
    ).toBe(ADD_LEGS_MSG.chooseInstrument);
    expect(positionUnderlying('', [XYZ], rowsOf([futuresRow]))).toEqual({ reason: 'noRows' });
  });

  it('例 #1: 2 枚目の C 40,000 が 3 本目。7 欄・時刻・読み取りの印（足した明細 1・行の損益と手数料・注文の種類）', () => {
    const before = mainLegs();
    const p = plan(before, rowsOf([ADD_C]));
    expect(p.kind).toBe('added');
    if (p.kind !== 'added') return;
    expect(p.legs).toHaveLength(3);
    // 今の足はそのまま（同じもの）
    expect(p.legs.slice(0, 2)).toEqual(before);
    const added = p.legs[2] as LegDraft;
    expect(fields(added)).toEqual(['C', '2027-01', '40000', 'sell', '1', '200', '260']);
    expect(added.entryTime).toBe(ADD_C.opened.epochMs);
    expect(added.exitTime).toBe(ADD_C.closed.epochMs);
    expect(added.read).toEqual({
      raw: 0,
      unit: [0],
      yearInferred: false,
      sheet: 1,
      pnl: -60_500,
      fee: 500,
      currency: 'JPY',
      orderType: 'market',
    });
    expect(p.notice).toBe('明細から足を 1 本追加しました');
  });

  it('例 #3: 別の原資産 ABC の 2 行と先物の 1 行は追加せず、C 40,000 の 1 本だけ。知らせに 3 行', () => {
    const rows = rowsOf([
      { ...ADD_C, underlying: '架空ABC', strike: 1_000 },
      futuresRow,
      ADD_C,
      { ...ADD_C, underlying: '架空ABC', strike: 1_100 },
    ]);
    expect(pickAddRows(rows, underlyingKey('架空XYZ'))).toEqual({ rows: [2], skipped: 3 });
    const p = plan(mainLegs(), rows);
    expect(p.kind).toBe('added');
    if (p.kind !== 'added') return;
    expect(p.legs.map((l) => l.strike)).toEqual(['36000', '35000', '40000']);
    expect(p.notice).toBe(
      '明細から足を 1 本追加しました。別の原資産・先物の 3 行は追加していません',
    );
  });

  it('例 #4: このポジションの原資産のオプションの行が無ければ何も変えない', () => {
    for (const rows of [rowsOf([futuresRow]), rowsOf([{ ...ADD_C, underlying: '架空ABC' }])]) {
      expect(plan(mainLegs(), rows)).toEqual({ kind: 'none', notice: ADD_LEGS_MSG.noRows });
    }
    expect(ADD_LEGS_MSG.noRows).toBe('このポジションの原資産のオプションの行がありません');
  });

  it('建てた日が違っても同じ原資産の行はすべて追加する（ロール・別の日の建て。C52）', () => {
    const rows = rowsOf([
      ADD_C,
      { ...ADD_C, strike: 41_000, opened: jst(2026, 12, 5, 9, 0), position: 1 },
    ]);
    const p = plan(mainLegs(), rows);
    expect(p.kind === 'added' && p.legs.map((l) => l.strike)).toEqual([
      '36000',
      '35000',
      '40000',
      '41000',
    ]);
  });
});

describe('重複（R3。例 #2・#8）', () => {
  it('例 #2: 同じ明細をもう一度 → 「この明細の足はすべて入っています」', () => {
    const first = plan(mainLegs(), rowsOf([ADD_C]));
    if (first.kind !== 'added') throw new Error('足せない');
    expect(plan(first.legs, rowsOf([ADD_C]), 2)).toEqual({
      kind: 'none',
      notice: 'この明細の足はすべて入っています',
    });
  });

  it('例 #8: 時刻の無い手で入れた足と 7 欄が同じ行は追加せず、残りの 1 本だけ', () => {
    const manual: LegDraft = {
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '36,000',
      side: 'sell',
      quantity: '1',
      entryPrice: '300',
      exitPrice: '120',
    };
    const p = plan([manual], rowsOf([ADD_A, ADD_B]));
    expect(p.kind).toBe('added');
    if (p.kind !== 'added') return;
    expect(p.legs.map((l) => l.strike)).toEqual(['36,000', '35000']);
    // まとまり = 実際に追加した行だけ（損益の合わせ方 R5）
    expect(p.legs[1]?.read?.unit).toEqual([1]);
    expect(p.notice).toBe('明細から足を 1 本追加しました。同じ足 1 本は追加していません');
  });

  it('時刻が両方にあって分まで違えば別の足（同じ値の別の約定）', () => {
    const p = plan([], rowsOf([ADD_C]));
    const a = p.kind === 'added' ? p.legs[0] : undefined;
    if (!a) throw new Error('足せない');
    expect(isSameLeg(a, { ...a, exitTime: (a.exitTime ?? 0) + 30_000 })).toBe(true);
    expect(isSameLeg(a, { ...a, exitTime: (a.exitTime ?? 0) + 60_000 })).toBe(false);
    expect(isSameLeg(a, { ...a, strike: '40,000.0' })).toBe(true);
    expect(isSameLeg(a, { ...a, side: 'buy' })).toBe(false);
  });

  it('性質: 同じ行を 2 回追加しても本数は 1 回目と同じ・今の足の順は変わらない（種つきの乱数 200 通り）', () => {
    let seed = 260;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 200; n++) {
      const k = 1 + Math.floor(rnd() * 4);
      const specs = Array.from({ length: k }, (_, i) => ({
        ...ADD_C,
        putCall: rnd() < 0.5 ? ('put' as const) : ('call' as const),
        strike: 30_000 + 500 * Math.floor(rnd() * 20),
        side: rnd() < 0.5 ? ('buy' as const) : ('sell' as const),
        entry: 10 + Math.floor(rnd() * 300),
        exit: 1 + Math.floor(rnd() * 300),
        closed: jst(2026, 12, 10, 9, i),
      }));
      const base = mainLegs();
      const once = plan(base, rowsOf(specs));
      if (once.kind !== 'added') continue;
      expect(once.legs.slice(0, base.length)).toEqual(base);
      const twice = plan(once.legs, rowsOf(specs), 2);
      expect(twice.kind).toBe('none');
    }
  });
});

describe('10 本の上限・失敗の文（R4。例 #5・#6）', () => {
  it('例 #5: 足が 9 本のときに 2 本読める明細 → 1 本も追加しない', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...EMPTY_LEG, strike: String(i) }));
    const rows = rowsOf([ADD_C, { ...ADD_C, strike: 41_000 }]);
    expect(plan(nine, rows)).toEqual({
      kind: 'tooMany',
      notice: '足は 10 本までです（今 9 本 · この明細から 2 本）',
    });
  });

  it('例 #6: 決まった文言の 1 文目 +「足は変わっていません。」', () => {
    expect(failedText(READ_MSG.limited)).toBe(
      '今日の読み取りの上限に達しました。足は変わっていません。',
    );
    expect(failedText(READ_MSG.notStatement)).toBe(
      '決済明細として読めませんでした。足は変わっていません。',
    );
  });

  it('押せない理由（R1）: 1 枚目の明細の読み取り中 > 足の読み取り中 > 10 本', () => {
    expect(addLegsBlock({ statementReading: false, legReading: false, legs: 9 })).toBeNull();
    expect(addLegsBlock({ statementReading: true, legReading: false, legs: 0 })).toBe(
      ADD_LEGS_MSG.statementReading,
    );
    expect(addLegsBlock({ statementReading: false, legReading: true, legs: 0 })).toBe(
      ADD_LEGS_MSG.reading,
    );
    expect(addLegsBlock({ statementReading: false, legReading: false, legs: 10 })).toBe(
      '足は 10 本までです',
    );
  });
});

describe('明細の損益・手数料（R5・4.7・C73。例 #1・#8・#9）', () => {
  it('例 #1: 89,000 + (−60,500) = 28,500、手数料 1,000 + 500 = 1,500。手数料を除いた損益 30,000 = 足の導出の合計', () => {
    const p = plan(mainLegs(), rowsOf([ADD_C]));
    if (p.kind !== 'added') throw new Error('足せない');
    const legs = parsed(p.legs);
    const r = statementPnlWithLegs(89_000, p.legs, legs, MULT, 1, JPY);
    expect(r).toEqual({ pnl: 28_500, dropped: false });
    expect(1_000 + addedLegFees(p.legs, JPY)).toBe(1_500);
    // 足の導出 = −1 × (120 − 300) × 1 × 1,000 = 180,000、+1 × (60 − 150) × 1,000 = −90,000、−1 × (260 − 200) × 1,000 = −60,000
    const derived = legs.reduce((s, l) => s + legPnlPrice(l, MULT), 0);
    expect(derived).toBe(30_000);
    expect((r.pnl ?? 0) + 1_500).toBe(derived);
  });

  it('例 #8: 手入力の足（導出 180,000）+ 追加した行 −90,500 = 89,500、手数料 500', () => {
    const manual: LegDraft = {
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      strike: '36000',
      side: 'sell',
      quantity: '1',
      entryPrice: '300',
      exitPrice: '120',
    };
    const p = plan([manual], rowsOf([ADD_A, ADD_B]));
    if (p.kind !== 'added') throw new Error('足せない');
    const r = statementPnlWithLegs(undefined, p.legs, parsed(p.legs), MULT, 1, JPY);
    expect(r).toEqual({ pnl: 89_500, dropped: false });
    expect(addedLegFees(p.legs, JPY)).toBe(500);
  });

  it('例 #9: 外貨の口座（USD）・価格の通貨 JPY: 追加した行の損益は口座の通貨に合わないので明細の損益なし（足の合計）', () => {
    const p = plan(mainLegs(), rowsOf([ADD_C]));
    if (p.kind !== 'added') throw new Error('足せない');
    const usd = { accountCurrency: 'USD', priceCurrency: 'JPY' };
    // 1 枚目の損益も外貨の口座では入らない（undefined）: 1 枚目の分が無いので明細の損益は出さない
    expect(statementPnlWithLegs(undefined, p.legs, parsed(p.legs), MULT, undefined, usd).pnl).toBe(
      undefined,
    );
    // 1 枚目の損益を本人が USD で打っていても、追加した行が JPY なら足の合計に切り替える
    expect(statementPnlWithLegs(200, p.legs, parsed(p.legs), MULT, undefined, usd)).toEqual({
      pnl: undefined,
      dropped: true,
    });
    expect(addedLegFees(p.legs, usd)).toBe(0);
  });

  it('追加した足を消した（まとまりが欠けた）・満期で消滅にした・行の損益が読めない → 足の合計に切り替える', () => {
    const rows = rowsOf([ADD_C, { ...ADD_C, strike: 41_000, pnl: 10_000 }]);
    const p = plan(mainLegs(), rows);
    if (p.kind !== 'added') throw new Error('足せない');
    const cut = p.legs.slice(0, 3);
    expect(statementPnlWithLegs(89_000, cut, parsed(cut), MULT, 1, JPY).dropped).toBe(true);
    const expired = p.legs.map((l, i) => (i === 3 ? { ...l, expired: true } : l));
    expect(statementPnlWithLegs(89_000, expired, parsed(expired), MULT, 1, JPY).dropped).toBe(true);
    const unread = p.legs.map((l, i) =>
      i === 3 && l.read ? { ...l, read: { ...l.read, pnl: null } } : l,
    );
    expect(statementPnlWithLegs(89_000, unread, parsed(unread), MULT, 1, JPY).dropped).toBe(true);
    // 1 枚目の足がすべて無い（消した）のに 1 枚目の損益が残っている
    const noMain = p.legs.slice(2);
    expect(statementPnlWithLegs(89_000, noMain, parsed(noMain), MULT, 1, JPY).dropped).toBe(true);
  });

  it('性質: 行の損益 = 導出 − 手数料 の明細なら、明細の損益 + 手数料 = 足の導出の合計（1 枚目 + 2 枚目 + 3 枚目・L/S・利益 / 損失。300 通り）', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const spec = (i: number, sheet: number): OptionRowSpec => {
      const side = rnd() < 0.5 ? ('buy' as const) : ('sell' as const);
      const qty = 1 + Math.floor(rnd() * 3);
      const entry = 5 + Math.floor(rnd() * 400);
      const exit = 1 + Math.floor(rnd() * 400);
      const fee = 100 * Math.floor(rnd() * 10);
      const derived = (side === 'buy' ? 1 : -1) * (exit - entry) * qty * MULT;
      return {
        ...ADD_A,
        putCall: rnd() < 0.5 ? 'put' : 'call',
        strike: 30_000 + 250 * i + 10_000 * sheet,
        side,
        qty,
        entry,
        exit,
        fee,
        pnl: derived - fee,
        closed: jst(2026, 12, 9 + sheet, 10, i),
      };
    };
    for (let n = 0; n < 300; n++) {
      const main = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => spec(i, 0));
      const raw = rowsOf(main);
      const row = unitRows(raw, initialUnits(raw))[0] as ReadRow;
      let legs = unitLegs([], row, null);
      const mainPnl = main.reduce((s, r) => s + r.pnl, 0);
      const mainFee = main.reduce((s, r) => s + r.fee, 0);
      for (let sheet = 1; sheet <= 2; sheet++) {
        const more = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => spec(i, sheet));
        if (more.length === 0) continue;
        const p = plan(legs, rowsOf(more), sheet);
        if (p.kind === 'added') legs = [...p.legs];
      }
      const parsedLegs = parsed(legs);
      const r = statementPnlWithLegs(mainPnl, legs, parsedLegs, MULT, 1, JPY);
      const fees = mainFee + addedLegFees(legs, JPY);
      const derived = parsedLegs.reduce((s, l) => s + legPnlPrice(l, MULT), 0);
      expect(r.dropped).toBe(false);
      expect(Number.isFinite(r.pnl)).toBe(true);
      expect((r.pnl ?? Number.NaN) + fees).toBeCloseTo(derived, 6);
    }
  });

  it('KEEP-1 の性質: 追加した足が無ければ、前の規則（#118 の statementPnlWithLegs）と同じ（種つきの乱数 300 通り）', () => {
    // 前の規則の写し（#118 の版。テストの中の参照）
    const before = (
      pnl: number | undefined,
      drafts: readonly LegDraft[],
      legs: readonly Leg[],
      fx: number | undefined,
    ) => {
      if (pnl === undefined) return { pnl, dropped: false };
      const fromStatement = drafts.filter((d) => d.read !== undefined);
      if (fromStatement.length === 0) return { pnl, dropped: false };
      const unit = fromStatement[0]?.read?.unit ?? [];
      const present = new Set(fromStatement.map((d) => d.read?.raw));
      const complete =
        present.size === unit.length &&
        fromStatement.length === unit.length &&
        unit.every((r) => present.has(r)) &&
        fromStatement.every((d) => !d.expired);
      if (!complete) return { pnl: undefined, dropped: true };
      const added = drafts
        .map((d, i) => ({ d, leg: legs[i] }))
        .filter((x) => x.d.read === undefined && !x.d.expired && x.leg !== undefined);
      if (added.length === 0) return { pnl, dropped: false };
      if (fx === undefined) return { pnl: undefined, dropped: true };
      const sum = added.reduce((s, x) => s + legPnlPrice(x.leg as Leg, MULT) * fx, 0);
      return { pnl: Number.parseFloat((pnl + sum).toPrecision(15)), dropped: false };
    };
    let seed = 118;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 300; n++) {
      let drafts: LegDraft[] = rnd() < 0.8 ? mainLegs() : [];
      if (rnd() < 0.3) drafts = drafts.slice(1);
      if (rnd() < 0.2 && drafts[0]) drafts = [{ ...drafts[0], expired: true }, ...drafts.slice(1)];
      const extra = Math.floor(rnd() * 3);
      for (let i = 0; i < extra; i++) {
        drafts.push({
          ...EMPTY_LEG,
          optionType: 'C',
          contractMonth: '2027-01',
          strike: String(40_000 + i * 500),
          side: rnd() < 0.5 ? 'buy' : 'sell',
          quantity: '1',
          entryPrice: String(Math.floor(rnd() * 300) + 1),
          exitPrice: String(Math.floor(rnd() * 300)),
          expired: rnd() < 0.2,
        });
      }
      if (drafts.length === 0) continue;
      const legs = readLegs(drafts).legs ?? [];
      const pnl = rnd() < 0.2 ? undefined : Math.round(rnd() * 200_000 - 100_000);
      const fx = rnd() < 0.2 ? undefined : 1;
      expect(statementPnlWithLegs(pnl, drafts, legs, MULT, fx, JPY)).toEqual(
        before(pnl, drafts, legs, fx),
      );
    }
  });
});

describe('ポジションの時刻と注文の種類（R6・C54。例 #1・#10）', () => {
  const statementDraft = (legs: readonly LegDraft[]): Draft => ({
    ...EMPTY_DRAFT,
    instrumentName: XYZ.name,
    source: 'statement',
    legs,
    entryTime: toLocalInput(ADD_A.opened.epochMs as number),
    exitTime: toLocalInput(ADD_A.closed.epochMs as number),
    exitOrderType: 'stop',
    exitReason: 'lc',
    stopOrderPlaced: 'placed',
  });
  const marks = {
    entryTime: 'read',
    exitTime: 'read',
    exitReason: 'statement',
  } as const;

  it('例 #1: 決済の時刻 12/10 14:00・注文の種類 成行・「明細から」の既定（決済の理由 LC）は外れる。エントリーはいちばん早い建て', () => {
    const p = plan(mainLegs(), rowsOf([ADD_C]));
    if (p.kind !== 'added') throw new Error('足せない');
    const r = pointAfterAdd(statementDraft(p.legs), marks, new Set());
    expect(r.draft).toMatchObject({
      exitTime: toLocalInput(ADD_C.closed.epochMs as number),
      entryTime: toLocalInput(ADD_A.opened.epochMs as number),
      exitOrderType: 'market',
      exitReason: 'other',
      stopOrderPlaced: 'unanswered',
    });
    expect(r.marks).toEqual({ entryTime: 'read', exitTime: 'read' });
  });

  it('追加した行が逆指値なら、決済の理由 = LC（印「明細から」）・逆指値を入れた', () => {
    const p = plan(mainLegs(), rowsOf([{ ...ADD_C, order: 'stop' }]));
    if (p.kind !== 'added') throw new Error('足せない');
    const d = {
      ...statementDraft(p.legs),
      exitOrderType: 'market' as const,
      exitReason: 'other' as const,
    };
    const r = pointAfterAdd(d, { entryTime: 'read', exitTime: 'read' }, new Set());
    expect(r.draft).toMatchObject({
      exitOrderType: 'stop',
      exitReason: 'lc',
      stopOrderPlaced: 'placed',
    });
    expect(r.marks?.exitReason).toBe('statement');
  });

  it('本人が決済の時刻・決済の理由を触っていれば変えない（注文の種類は証拠なので行の値）', () => {
    const p = plan(mainLegs(), rowsOf([ADD_C]));
    if (p.kind !== 'added') throw new Error('足せない');
    const d = statementDraft(p.legs);
    const r = pointAfterAdd(d, marks, new Set(['exitTime', 'exitReason'] as const));
    expect(r.draft.exitTime).toBe(d.exitTime);
    expect(r.draft.exitReason).toBe('lc');
    expect(r.draft.exitOrderType).toBe('market');
  });

  it('追加した足が決済の時点でなければ（1 枚目の決済の方が後）、決済の時刻・注文の種類は変えない', () => {
    const early = { ...ADD_C, closed: jst(2026, 12, 5, 9, 0) };
    const p = plan(mainLegs(), rowsOf([early]));
    if (p.kind !== 'added') throw new Error('足せない');
    const d = statementDraft(p.legs);
    expect(pointAfterAdd(d, marks, new Set()).draft).toBe(d);
  });

  it('例 #10: 時間帯の書かれていない明細（時間帯の選択も覚えも無い）→ 足は時刻なし。ポジションの時刻は変わらない', () => {
    const p = plan(
      mainLegs(),
      rowsOf([
        { ...ADD_C, opened: unknownTz('2026-12-02T09:30'), closed: unknownTz('2026-12-10T14:00') },
      ]),
    );
    if (p.kind !== 'added') throw new Error('足せない');
    expect(p.legs[2]?.entryTime).toBeUndefined();
    expect(p.legs[2]?.exitTime).toBeUndefined();
    const d = statementDraft(p.legs);
    expect(pointAfterAdd(d, marks, new Set()).draft).toBe(d);
  });
});
