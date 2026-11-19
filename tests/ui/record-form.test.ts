// 記録する画面の下書きの読み取り readDraft（Issue #13 契約 R-1・AC-2・3・6・7。例の表 E1〜E18）。値はすべて架空

import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { type TradeRecord, toTradeInput } from '../../core/record';
import type { TradeInput } from '../../core/trade';
import { formatPct, formatR } from '../../ui/src/lib/format';
import { reasonText } from '../../ui/src/lib/reasons';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  FIELD_LABEL,
  lcMoveLabel,
  MISSING_LABEL,
  MSG,
  OPTIONAL_FIELDS,
  parseNum,
  RISK_NOTE,
  readDraft,
} from '../../ui/src/lib/record-form';
import { forAll } from '../core/helpers/prng';
import { closedAt, trade, without } from '../core/helpers/trade-builder';
import { defaultAccount, moneyOf } from './helpers/accounts';
import {
  CAPITAL_1M,
  draft,
  E1,
  E2,
  E3,
  E4,
  E5,
  E6,
  E7,
  E10,
  E11,
  E12,
  E16,
  E17,
  E18,
  NO_CAPITAL,
  US30,
} from './helpers/record-drafts';

const MINUS = '−';

function texts(r: DraftReading): string[] {
  const side = r.body?.side ?? 'L';
  return (r.preview.judgment?.reasons ?? []).map((x) => reasonText(x, side));
}

/** 同じ取引を、画面の下書きを通さず計算の入力に直接組む（AC-3 の突き合わせ。価格の通貨 未設定 = priceInAccountCurrency false） */
function direct(over: Partial<TradeInput>, exit: number, ctx: DraftContext): TradeInput {
  const t = trade({
    instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: false },
    riskTolerancePct: moneyOf(ctx.accounts).riskTolerancePct,
    ...over,
  });
  const withCapital =
    moneyOf(ctx.accounts).capitalYen === null
      ? without(t, 'capitalYen')
      : { ...t, capitalYen: moneyOf(ctx.accounts).capitalYen as number };
  return closedAt(withCapital, exit);
}

function expectSameAsCore(r: DraftReading, t: TradeInput) {
  const ev = evaluateTrade(t);
  if (!ev.ok) throw new Error('core が受け付けない');
  expect(r.preview.judgment?.grade).toBe(ev.judgment?.grade);
  expect(r.preview.judgment?.reasons).toEqual(ev.judgment?.reasons);
  expect(r.preview.r).toBe(ev.r);
  expect(r.preview.riskPct).toBe(ev.riskPct);
}

describe('例の表（AC-1・AC-3）', () => {
  it('E1: B・「LC を広げた（99.5 → 99.2）」・−1.6R・資金が未設定', () => {
    const r = readDraft(E1, NO_CAPITAL);
    expect(r.canSave).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.preview.judgment?.grade).toBe('B');
    expect(texts(r)).toEqual([
      'LC を広げた（99.5 → 99.2）',
      '資金が未設定のため、過剰リスクは判定していません',
    ]);
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.6R`);
    expect(r.preview.riskNote).toBe(RISK_NOTE.noCapital);
    expect(r.preview.showGapSlip).toBe(false);
    expectSameAsCore(r, direct({ lcMove: { kind: 'widened', after: 99.2 } }, 99.2, NO_CAPITAL));
  });

  it('E2: A（決めた LC で切れた）・−1.0R・リスク 0.5%', () => {
    const r = readDraft(E2, CAPITAL_1M);
    expect(r.preview.judgment?.grade).toBe('A');
    expect(texts(r)).toContain('決めた LC で切れた');
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.0R`);
    expect(formatPct(r.preview.riskPct as number)).toBe('0.5%');
    expect(r.preview.riskNote).toBeUndefined();
    expectSameAsCore(r, { ...direct({}, 99.5, CAPITAL_1M), statementPnlYen: -5000 });
  });

  it('E3: 危ない勝ち（LC を決めずに入った）・+1.5R', () => {
    const r = readDraft(E3, NO_CAPITAL);
    expect(r.preview.judgment?.grade).toBe('riskyWin');
    expect(texts(r)).toContain('LC を決めずに入った');
    expect(formatR(r.preview.r)).toBe('+1.5R');
    expectSameAsCore(r, direct({ lcDecidedBeforeEntry: false }, 100.75, NO_CAPITAL));
  });

  it('E4: 危ない勝ち（過剰リスク（2.5%））・+1.0R・リスク 2.5%', () => {
    const r = readDraft(E4, CAPITAL_1M);
    expect(r.preview.judgment?.grade).toBe('riskyWin');
    expect(texts(r)).toContain('過剰リスク（2.5%）');
    expect(formatR(r.preview.r)).toBe('+1.0R');
    expect(formatPct(r.preview.riskPct as number)).toBe('2.5%');
    expectSameAsCore(r, { ...direct({}, 100.5, CAPITAL_1M), statementPnlYen: 25000 });
  });

  it('E5: S で B（LC を広げた（150.5 → 151））・−2.0R', () => {
    const r = readDraft(E5, NO_CAPITAL);
    expect(r.preview.judgment?.grade).toBe('B');
    expect(texts(r)).toContain('LC を広げた（150.5 → 151）');
    expect(formatR(r.preview.r)).toBe(`${MINUS}2.0R`);
    expectSameAsCore(
      r,
      direct(
        {
          side: 'S',
          entries: [{ price: 150, quantity: 10_000 }],
          lc: 150.5,
          lcMove: { kind: 'widened', after: 151 },
        },
        151,
        NO_CAPITAL,
      ),
    );
  });

  it('E6（AC-6）: 「窓・滑りでしたか」が出る。未回答・いいえ = B、はい = A。はいでも出たまま', () => {
    const un = readDraft(E6, NO_CAPITAL);
    expect(un.preview.showGapSlip).toBe(true);
    expect(un.preview.judgment?.grade).toBe('B');
    expect(texts(un)).toContain(`LC で切らずに持ち続けた（${MINUS}1.2R）`);
    expect(un.body?.exit.gapSlip).toBe('unanswered');

    const no = readDraft(
      applyDraft(E6, { type: 'set', field: 'gapSlip', value: 'no' }),
      NO_CAPITAL,
    );
    expect(no.preview.showGapSlip).toBe(true);
    expect(no.preview.judgment?.grade).toBe('B');
    expect(no.body?.exit.gapSlip).toBe('no');

    const yes = readDraft(
      applyDraft(E6, { type: 'set', field: 'gapSlip', value: 'yes' }),
      NO_CAPITAL,
    );
    expect(yes.preview.showGapSlip).toBe(true);
    expect(yes.preview.judgment?.grade).toBe('A');
    expect(texts(yes)).toEqual(expect.arrayContaining(['決めた LC で切れた', '窓・滑り']));
    expect(yes.body?.exit.gapSlip).toBe('yes');
    expectSameAsCore(un, direct({}, 99.4, NO_CAPITAL));
    expectSameAsCore(yes, { ...direct({}, 99.4, NO_CAPITAL), gapSlipAnswer: true });
  });

  it('AC-6: E2・E7 では「窓・滑りでしたか」を聞かない。聞かない取引の答えは送らない', () => {
    expect(readDraft(E2, CAPITAL_1M).preview.showGapSlip).toBe(false);
    expect(readDraft(E7, NO_CAPITAL).preview.showGapSlip).toBe(false);
    const stale = applyDraft(E7, { type: 'set', field: 'gapSlip', value: 'yes' });
    expect(readDraft(stale, NO_CAPITAL).body?.exit.gapSlip).toBe('unanswered');
  });

  it('E6 で決済の理由が「窓・滑り」なら救済済みなので聞かない（core のまま）', () => {
    const r = readDraft(
      applyDraft(E6, { type: 'set', field: 'exitReason', value: 'gapSlip' }),
      NO_CAPITAL,
    );
    expect(r.preview.showGapSlip).toBe(false);
    expect(r.preview.judgment?.grade).toBe('A');
  });

  it('E7: 計画どおりの勝ち・±0.0R', () => {
    const r = readDraft(E7, NO_CAPITAL);
    expect(r.preview.judgment?.grade).toBe('safeWin');
    expect(formatR(r.preview.r)).toBe('±0.0R');
    expectSameAsCore(r, direct({}, 100, NO_CAPITAL));
  });

  it('E11: 資金あり・損益空・通貨未設定 → R −1.0R、リスクの場所は「損益を入力すると表示されます」', () => {
    const r = readDraft(E11, CAPITAL_1M);
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.0R`);
    expect(r.preview.riskPct).toBeUndefined();
    expect(r.preview.riskNote).toBe(RISK_NOTE.noOneR);
    expect(texts(r)).toContain('1R が出ないため、過剰リスクは判定していません');
    expectSameAsCore(r, direct({}, 99.5, CAPITAL_1M));
  });

  it.each([
    ['-20,100', '2.1%', true],
    ['-20000', '2.0%', false],
    ['−19600', '2.0%', false],
  ] as const)('E12: 損益 %s 円 → リスク %s（過剰 %s）', (pnl, pct, over) => {
    const r = readDraft(E12(pnl), CAPITAL_1M);
    expect(formatPct(r.preview.riskPct as number)).toBe(pct);
    const kinds = (r.preview.judgment?.reasons ?? []).map((x) => x.kind);
    expect(kinds.includes('overRisk')).toBe(over);
    expect(r.preview.judgment?.grade).toBe(over ? 'B' : 'A');
  });

  it('E16: LC なしの負け → C、R は出ない、決めていたか・動かしたかは聞かない、本文は lc なし・決めていなかった・動かしていない', () => {
    const r = readDraft(E16, NO_CAPITAL);
    expect(r.canSave).toBe(true);
    expect(r.preview.judgment?.grade).toBe('C');
    expect(texts(r)).toEqual([
      'LC を決めずに入った',
      '資金が未設定のため、過剰リスクは判定していません',
    ]);
    expect(r.preview.r).toBeUndefined();
    expect(r.preview.noLc).toBe(true);
    expect(r.preview.riskNote).toBe(RISK_NOTE.noLc);
    expect(r.body?.lc).toBeUndefined();
    expect('lc' in (r.body ?? {})).toBe(false);
    expect(r.body?.lcDecidedBeforeEntry).toBe(false);
    expect(r.body?.lcMove).toEqual({ kind: 'none' });
  });

  it('E16: 資金があっても LC なしは「1R が出ないため、過剰リスクは判定していません」とリスクの場所の「LC が無いため表示されません」', () => {
    const r = readDraft(E16, CAPITAL_1M);
    expect(texts(r)).toContain('1R が出ないため、過剰リスクは判定していません');
    expect(r.preview.riskNote).toBe(RISK_NOTE.noLc);
  });

  it('E17: LC なしの勝ち → 危ない勝ち（LC を決めずに入った）、R は出ない', () => {
    const r = readDraft(E17, NO_CAPITAL);
    expect(r.preview.judgment?.grade).toBe('riskyWin');
    expect(texts(r)).toContain('LC を決めずに入った');
    expect(r.preview.r).toBeUndefined();
  });

  it('「なし」のときは決めていたか・動かしたかの値が下書きに残っていても送らない', () => {
    const r = readDraft(
      applyDraft(E16, { type: 'fill', values: { lcDecided: true, lcMove: 'widened' } }),
      NO_CAPITAL,
    );
    expect(r.body?.lcDecidedBeforeEntry).toBe(false);
    expect(r.body?.lcMove).toEqual({ kind: 'none' });
    expect(r.preview.judgment?.grade).toBe('C');
  });
});

describe('必須の欄（AC-2・E10・E18）', () => {
  const required: ReadonlyArray<readonly [string, Partial<Draft>]> = [
    [MISSING_LABEL.instrumentName, { instrumentName: '  ' }],
    [MISSING_LABEL.side, { side: null }],
    [MISSING_LABEL.entryPrice, { entryPrice: '' }],
    [MISSING_LABEL.exitPrice, { exitPrice: '' }],
    [MISSING_LABEL.quantity, { quantity: '' }],
    [MISSING_LABEL.exitTime, { exitTime: '' }],
    [MISSING_LABEL.lc, { lc: '' }],
    [MISSING_LABEL.lcDecided, { lcDecided: null }],
    [MISSING_LABEL.lcMove, { lcMove: null }],
    [MISSING_LABEL.timeframeChange, { timeframeChange: null }],
  ];

  it.each(required)(
    '「%s」が欠ければ判定なし・保存できない・未入力の欄にその名前',
    (label, gap) => {
      const r = readDraft(applyDraft(E2, { type: 'fill', values: gap }), CAPITAL_1M);
      expect(r.canSave).toBe(false);
      expect(r.body).toBeUndefined();
      expect(r.preview.judgment).toBeUndefined();
      expect(r.missing).toEqual([label]);
    },
  );

  it('必須だけを入れて任意を空のまま保存できる（崩れの条件・エントリーの時刻・損益・手数料なし）', () => {
    const r = readDraft(E7, NO_CAPITAL);
    expect(r.canSave).toBe(true);
    const b = r.body as NonNullable<DraftReading['body']>;
    expect(b.brokenCondition).toBeUndefined();
    expect(b.statementPnlYen).toBeUndefined();
    expect(b.fees).toEqual([]);
    expect(b.entries).toEqual([{ price: 100, quantity: 10000 }]);
    expect(b).toMatchObject({
      status: 'closed',
      source: 'manual',
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      exit: { orderType: 'unknown', reason: 'other', gapSlip: 'unanswered' },
    });
  });

  it('空の下書きは全部の必須が足りない（画面の並びの順）', () => {
    expect(readDraft(EMPTY_DRAFT, NO_CAPITAL).missing).toEqual([
      MISSING_LABEL.instrumentName,
      MISSING_LABEL.side,
      MISSING_LABEL.entryPrice,
      MISSING_LABEL.exitPrice,
      MISSING_LABEL.quantity,
      MISSING_LABEL.exitTime,
      MISSING_LABEL.lc,
      MISSING_LABEL.lcDecided,
      MISSING_LABEL.lcMove,
      MISSING_LABEL.timeframeChange,
    ]);
  });

  it('E10: 時間足だけ未選択 → 判定なし、R は −1.6R で出る、足りないのは時間足だけ', () => {
    const r = readDraft(E10, NO_CAPITAL);
    expect(r.canSave).toBe(false);
    expect(r.preview.judgment).toBeUndefined();
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.6R`);
    expect(r.missing).toEqual([MISSING_LABEL.timeframeChange]);
  });

  it('タップの前でも、LC・L / S・イン・決済・数量がそろえば R・リスクが出る', () => {
    const r = readDraft(
      draft({ side: 'L', entryPrice: '100', lc: '99.5', exitPrice: '99.5', pnlYen: '-5000' }),
      CAPITAL_1M,
    );
    expect(r.preview.judgment).toBeUndefined();
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.0R`);
    expect(formatPct(r.preview.riskPct as number)).toBe('0.5%');
  });

  it('E18: LC の価格も「なし」も無い → 判定なし・R なし・「LC（価格か「なし」）」が足りない', () => {
    const r = readDraft(E18, NO_CAPITAL);
    expect(r.canSave).toBe(false);
    expect(r.preview.r).toBeUndefined();
    expect(r.preview.judgment).toBeUndefined();
    expect(r.missing).toEqual([MISSING_LABEL.lc]);
  });

  it('LC なしのときは決めていたか・動かしたかを未入力の欄に数えない', () => {
    const r = readDraft(
      applyDraft(E16, { type: 'set', field: 'timeframeChange', value: null }),
      NO_CAPITAL,
    );
    expect(r.missing).toEqual([MISSING_LABEL.timeframeChange]);
  });
});

describe('入力の誤り（AC-7・E8・E9）', () => {
  const cases: ReadonlyArray<readonly [string, Partial<Draft>, keyof Draft, string]> = [
    ['E8 LC = イン', { lc: '100.00' }, 'lc', MSG.lcDirection('L')],
    ['E8 LC > イン', { lc: '100.50' }, 'lc', MSG.lcDirection('L')],
    ['S の LC < イン', { side: 'S', lc: '99.50' }, 'lc', MSG.lcDirection('S')],
    [
      'E9 広げた後の LC が入る前の LC より上',
      { lcMove: 'widened', lcAfter: '99.60' },
      'lcAfter',
      MSG.lcAfterDirection('L'),
    ],
    ['イン が数でない', { entryPrice: '100円' }, 'entryPrice', MSG.notNumber],
    ['決済が数でない', { exitPrice: 'abc' }, 'exitPrice', MSG.notNumber],
    ['数量が数でない', { quantity: '1e4' }, 'quantity', MSG.notNumber],
    ['LC が数でない', { lc: '99..5' }, 'lc', MSG.notNumber],
    ['損益が数でない', { pnlYen: '1,23' }, 'pnlYen', MSG.notNumber],
    ['手数料が数でない', { feeYen: 'x' }, 'feeYen', MSG.notNumber],
    ['広げた後の LC が数でない', { lcMove: 'widened', lcAfter: '?' }, 'lcAfter', MSG.notNumber],
    ['数量 0', { quantity: '0' }, 'quantity', MSG.notPositive],
    ['数量が負', { quantity: '-1' }, 'quantity', MSG.notPositive],
    ['イン が 0', { entryPrice: '0' }, 'entryPrice', MSG.notPositive],
    ['手数料が負', { feeYen: '-1' }, 'feeYen', MSG.notNonNegative],
    ['大きすぎる損益', { pnlYen: '10000000000000' }, 'pnlYen', MSG.tooLarge],
    [
      'エントリーの時刻が決済の時刻より後',
      { entryTime: '2026-03-04T10:01' },
      'entryTime',
      MSG.entryAfterExit,
    ],
    ['日時でない決済の時刻', { exitTime: '2026-02-30T10:00' }, 'exitTime', MSG.notDateTime],
    ['銘柄の名前が 41 字', { instrumentName: 'あ'.repeat(41) }, 'instrumentName', MSG.nameInvalid],
    ['銘柄の名前に制御文字', { instrumentName: 'US\u000730' }, 'instrumentName', MSG.nameInvalid],
    ['銘柄の名前に書式文字', { instrumentName: 'US‮30' }, 'instrumentName', MSG.nameInvalid],
    [
      '崩れの条件が 201 字',
      { brokenCondition: 'あ'.repeat(201) },
      'brokenCondition',
      MSG.brokenConditionInvalid,
    ],
  ];

  it.each(cases)('%s → その欄に文言、判定なし、保存できない', (_name, over, field, msg) => {
    const r = readDraft(applyDraft(E2, { type: 'fill', values: over }), CAPITAL_1M);
    expect(r.errors[field]).toBe(msg);
    expect(r.canSave).toBe(false);
    expect(r.body).toBeUndefined();
    expect(r.preview.judgment).toBeUndefined();
    expect(r.preview.r).toBeUndefined();
  });

  it('エントリーの時刻 = 決済の時刻は受ける。前なら本文のエントリーに時刻', () => {
    const same = readDraft(
      applyDraft(E2, { type: 'set', field: 'entryTime', value: '2026-03-04T10:00' }),
      CAPITAL_1M,
    );
    expect(same.canSave).toBe(true);
    const before = readDraft(
      applyDraft(E2, { type: 'set', field: 'entryTime', value: '2026-03-04T09:30' }),
      CAPITAL_1M,
    );
    expect(before.body?.entries[0].time).toBe(new Date(2026, 2, 4, 9, 30).getTime());
  });

  it('ZWJ を含む名前・40 字ちょうどは受ける', () => {
    const ok = readDraft(
      applyDraft(E2, { type: 'set', field: 'instrumentName', value: 'あ'.repeat(40) }),
      CAPITAL_1M,
    );
    expect(ok.errors.instrumentName).toBeUndefined();
    const zwj = readDraft(
      applyDraft(E2, { type: 'set', field: 'instrumentName', value: '架空‍指数' }),
      CAPITAL_1M,
    );
    expect(zwj.errors.instrumentName).toBeUndefined();
  });
});

describe('parseNum', () => {
  it.each([
    ['100', 100],
    ['100.00', 100],
    ['１００．５', 100.5],
    [' 99.5 ', 99.5],
    ['10,000', 10000],
    ['-5,000', -5000],
    ['−5000', -5000],
    ['－5000', -5000],
    ['+25,000', 25000],
    ['100.', 100],
    ['.5', 0.5],
    ['-.5', -0.5],
    ['1,000.', 1000],
  ] as const)('%j → %s', (s, want) => {
    expect(parseNum(s)).toEqual({ ok: true, value: want });
  });

  it.each(['', 'abc', '1e3', '0x10', 'Infinity', '1,00', '.', '1..5', '1 000', '--1', '1.2.3'])(
    '%j は数でない',
    (s) => {
      expect(parseNum(s).ok).toBe(false);
    },
  );
});

describe('下書きの更新 applyDraft', () => {
  it('LC の価格を打つと「なし」は外れる', () => {
    const d = applyDraft(E16, { type: 'set', field: 'lc', value: '99.5' });
    expect(d.lcNone).toBe(false);
    expect(d.lc).toBe('99.5');
  });

  it('「なし」を選ぶと LC・広げた後の LC は空になる', () => {
    const d = applyDraft(E1, { type: 'set', field: 'lcNone', value: true });
    expect(d.lc).toBe('');
    expect(d.lcAfter).toBe('');
  });

  it('空白だけの LC では「なし」を外さない', () => {
    expect(applyDraft(E16, { type: 'set', field: 'lc', value: ' ' }).lcNone).toBe(true);
  });

  it('reset は空の下書き + 渡した値', () => {
    const d = applyDraft(E1, { type: 'reset', values: { instrumentName: 'US30' } });
    expect(d).toEqual({ ...EMPTY_DRAFT, instrumentName: 'US30' });
  });
});

describe('銘柄の照合', () => {
  it('一覧の銘柄に当たれば matchedId、無ければ名前だけ', () => {
    expect(readDraft(draft({ instrumentName: ' ｕｓ３０ ' }), NO_CAPITAL).instrument).toEqual({
      name: 'ｕｓ３０',
      matchedId: US30.id,
    });
    expect(readDraft(draft({ instrumentName: '架空指数A' }), NO_CAPITAL).instrument).toEqual({
      name: '架空指数A',
    });
  });

  it('一覧の銘柄の値（円建て）で計算する。無い名前は既定（通貨 未設定）', () => {
    const jpy: DraftContext = {
      instruments: [{ ...US30, priceCurrency: 'JPY' }],
      accounts: [defaultAccount(1_000_000)],
    };
    const known = readDraft(E11, jpy);
    expect(known.preview.pnlYen).toBeCloseTo(-5000, 9);
    expect(formatPct(known.preview.riskPct as number)).toBe('0.5%');
    const unknown = readDraft(
      applyDraft(E11, { type: 'set', field: 'instrumentName', value: '架空指数A' }),
      jpy,
    );
    expect(unknown.preview.riskPct).toBeUndefined();
  });
});

describe('性質（種つき乱数の下書き。契約 R-1）', () => {
  it('canSave ⇔ body あり ⇔ 未入力の欄なし・誤りなし。body を保存の形にして計算すると preview と同じ', () => {
    forAll(
      1303,
      600,
      (r) => {
        const side = r.pick(['L', 'S'] as const);
        const entry = 50 + r.int(0, 10000) / 100;
        const width = r.int(1, 300) / 100;
        const lc = side === 'L' ? entry - width : entry + width;
        const exit = Math.max(0.01, entry + (r.next() - 0.5) * width * 6);
        const lcNone = r.bool(0.2);
        const d = draft({
          side: r.bool(0.05) ? null : side,
          entryPrice: entry.toFixed(2),
          exitPrice: exit.toFixed(2),
          quantity: r.bool(0.05) ? '0' : String(r.int(1, 100000)),
          ...(lcNone ? { lcNone: true } : { lc: r.bool(0.05) ? '' : lc.toFixed(2) }),
          lcDecided: r.bool(0.1) ? null : r.bool(0.8),
          lcMove: r.bool(0.1) ? null : r.pick(['none', 'tightened', 'widened'] as const),
          lcAfter: r.bool(0.5)
            ? (side === 'L' ? lc - r.int(0, 100) / 100 : lc + r.int(0, 100) / 100).toFixed(2)
            : '',
          timeframeChange: r.bool(0.1) ? null : r.pick(['none', 'longer', 'shorter'] as const),
          pnlYen: r.bool(0.5) ? String(r.int(-100000, 100000)) : '',
          feeYen: r.bool(0.3) ? String(r.int(0, 500)) : '',
          gapSlip: r.pick(['yes', 'no', 'unanswered'] as const),
          exitReason: r.pick([
            'lc',
            'gapSlip',
            'tp',
            'brokeManual',
            'fearEarly',
            'timeout',
            'other',
          ] as const),
        });
        const ctx = r.bool() ? CAPITAL_1M : NO_CAPITAL;
        return { d, ctx };
      },
      ({ d, ctx }) => {
        const read = readDraft(d, ctx);
        const empty = read.missing.length === 0 && Object.keys(read.errors).length === 0;
        expect(read.canSave).toBe(empty);
        expect(read.body !== undefined).toBe(read.canSave);
        expect(readDraft(d, ctx)).toEqual(read);
        for (const v of [read.preview.r, read.preview.riskPct, read.preview.oneRYen]) {
          if (v !== undefined) expect(Number.isFinite(v)).toBe(true);
        }
        if (read.body) {
          const record = { ...read.body, instrumentId: US30.id } as TradeRecord;
          const ev = evaluateTrade(
            toTradeInput({
              record,
              snapshot: {
                instrument: { ...US30 },
                ...moneyOf(ctx.accounts),
              },
            }),
          );
          if (!ev.ok) throw new Error('core が受け付けない');
          expect(read.preview.judgment).toEqual(ev.judgment);
          expect(read.preview.r).toBe(ev.r);
          expect(read.preview.riskPct).toBe(ev.riskPct);
          // LC なしのときは R が出ない
          if (d.lcNone) expect(read.preview.r).toBeUndefined();
          // 「なし」は決めていなかった・動かしていないで送る
          if (d.lcNone) {
            expect(read.body.lcDecidedBeforeEntry).toBe(false);
            expect(read.body.lcMove).toEqual({ kind: 'none' });
          }
        }
      },
    );
  });
});

// ── 根拠の足のチャートの時間足（Issue #12 契約 P-1・R2・R3・AC-3・AC-4） ──

describe('チャートの時間足（Issue #12）', () => {
  const ctx = (entry: boolean, exit: boolean): DraftContext => ({
    ...NO_CAPITAL,
    charts: { entry, exit },
  });
  const tf = (d: Draft, entry: Draft['entryChartTimeframe'], exit: Draft['exitChartTimeframe']) =>
    applyDraft(d, {
      type: 'fill',
      values: { entryChartTimeframe: entry, exitChartTimeframe: exit },
    });

  it('両方にチャートがあれば、選んだ時間足が本文に入る', () => {
    const body = readDraft(tf(E2, '4h', '1d'), ctx(true, true)).body;
    expect(body?.entryChartTimeframe).toBe('4h');
    expect(body?.exitChartTimeframe).toBe('1d');
  });

  it('決済時のチャートが無ければ、決済時の時間足は入らない（R4。外したら判定も従う）', () => {
    const body = readDraft(tf(E2, '4h', '1d'), ctx(true, false)).body;
    expect(body?.entryChartTimeframe).toBe('4h');
    expect(body && 'exitChartTimeframe' in body).toBe(false);
  });

  it('チャートが無ければ本文は今と同じ（文脈を省いても、どちらも false でも）', () => {
    const plain = readDraft(E2, NO_CAPITAL).body;
    expect(readDraft(tf(E2, '4h', '1d'), NO_CAPITAL).body).toEqual(plain);
    expect(readDraft(tf(E2, '4h', '1d'), ctx(false, false)).body).toEqual(plain);
    expect(EMPTY_DRAFT.entryChartTimeframe).toBeNull();
    expect(EMPTY_DRAFT.exitChartTimeframe).toBeNull();
  });

  it('E6: チャートがあっても時間足を選ばなければ本文に入らず、必須の欄も増えない（R6）', () => {
    const read = readDraft(E2, ctx(true, true));
    expect(read.canSave).toBe(true);
    expect(read.missing).toEqual([]);
    expect(read.body && 'entryChartTimeframe' in read.body).toBe(false);
  });

  it('時間足は必須の欄にも誤りにも数えない（手で打つ欄・選ぶ欄の数は変わらない）', () => {
    const empty = readDraft(EMPTY_DRAFT, ctx(true, true));
    expect(empty.missing).toEqual(readDraft(EMPTY_DRAFT, NO_CAPITAL).missing);
  });
});

describe('#56 LC を動かしたかの言葉（L / S で同じ）', () => {
  it('AC-1: 選択肢の文言は「そのまま」「狭めた」「広げた」（向きに依らない）', () => {
    expect((['none', 'tightened', 'widened'] as const).map((k) => lcMoveLabel(k))).toEqual([
      'そのまま',
      '狭めた',
      '広げた',
    ]);
  });

  it('AC-3（E5・E6）・AC-7: 向きの逆の広げた後の LC の誤りの文と、欄の名前', () => {
    // E5: L・イン 100.00・LC 99.50・広げた後 99.80（入る前の LC より上 = 狭めた側）
    const l = readDraft(
      draft({
        side: 'L',
        entryPrice: '100.00',
        lc: '99.50',
        exitPrice: '99.80',
        lcDecided: true,
        lcMove: 'widened',
        lcAfter: '99.80',
        timeframeChange: 'none',
      }),
      NO_CAPITAL,
    );
    expect(l.errors.lcAfter).toBe('広げた後の LC は、入る前の LC より下にしてください');
    // E6: S・イン 150.00・LC 150.50・広げた後 150.20（入る前の LC より下 = 狭めた側）
    const sh = readDraft(
      draft({
        side: 'S',
        entryPrice: '150.00',
        lc: '150.50',
        exitPrice: '150.20',
        lcDecided: true,
        lcMove: 'widened',
        lcAfter: '150.20',
        timeframeChange: 'none',
      }),
      NO_CAPITAL,
    );
    expect(sh.errors.lcAfter).toBe('広げた後の LC は、入る前の LC より上にしてください');
    expect(FIELD_LABEL.lcAfter).toBe('広げた後の LC');
  });
});

describe('#58 エントリーの時刻は任意の「取引」の欄', () => {
  it('AC-3（例 T2）: エントリーの時刻が空でも記録でき、足りない欄に数えない', () => {
    const r = readDraft(E2, CAPITAL_1M);
    expect(E2.entryTime).toBe('');
    expect(r.canSave).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.missing).not.toContain(FIELD_LABEL.entryTime);
    expect(r.body?.entries[0].time).toBeUndefined();
    expect(r.body).toBeDefined();
  });

  it('「ほかの欄」に畳んだ欄からエントリーの時刻を外した（誤りで「ほかの欄」を開かない）', () => {
    expect(OPTIONAL_FIELDS).not.toContain('entryTime');
    expect(OPTIONAL_FIELDS).toEqual(['pnlYen', 'feeYen', 'lcBasis', 'exitReason']);
  });

  it('T3: エントリーの時刻が決済の時刻より後なら誤り（今の検査のまま）', () => {
    const r = readDraft(
      { ...E2, entryTime: '2026-11-12T14:00', exitTime: '2026-11-12T13:00' },
      CAPITAL_1M,
    );
    expect(r.errors.entryTime).toBe('エントリーの時刻は決済の時刻より前にしてください');
    expect(r.canSave).toBe(false);
  });
});
