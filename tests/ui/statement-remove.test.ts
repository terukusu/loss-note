// 読み取った明細の削除と戻し（Issue 184。例は Issue の表・すべて架空の値）
import { describe, expect, it } from 'vitest';
import { EMPTY_LEG, type LegDraft } from '../../ui/src/lib/legs-form';
import { applyDraft, type Draft, EMPTY_DRAFT } from '../../ui/src/lib/record-form';
import { type Marks, READ_FIELDS } from '../../ui/src/lib/statement-fill';
import { restoreStatement, stripStatement } from '../../ui/src/lib/statement-remove';

/** 明細 A を読んだ後に、決済を 99.0 に直し、LC・一言・2 つのタップ・チャートの時間足を入れた下書き（例 #1 の前提） */
const A: Draft = applyDraft(EMPTY_DRAFT, {
  type: 'fill',
  values: {
    instrumentName: '架空指数X',
    side: 'L',
    quantity: '1',
    entryPrice: '100',
    exitPrice: '99.0',
    exitTime: '2026-03-04T10:00',
    entryTime: '2026-03-04T09:00',
    pnlYen: '-800',
    feeYen: '40',
    lc: '99.5',
    brokenCondition: '直近安値割れ',
    lcDecided: true,
    lcMove: 'none',
    timeframeChange: 'none',
    exitReason: 'lc',
    source: 'statement',
    exitOrderType: 'stop',
    stopOrderPlaced: 'placed',
    entryChartTimeframe: '1h',
    accountId: 'accB',
    fxRate: '150',
  },
});
const MARKS: Marks = {
  instrumentName: 'read',
  side: 'read',
  quantity: 'read',
  entryPrice: 'read',
  exitPrice: 'edited',
  exitTime: 'read',
  entryTime: 'read',
  pnlYen: 'read',
  feeYen: 'read',
  lcDecided: 'statement',
  exitReason: 'statement',
  accountId: 'auto',
};

const readLeg = (strike: string): LegDraft => ({
  ...EMPTY_LEG,
  optionType: 'P',
  strike,
  quantity: '2',
  read: { raw: 0, unit: [0, 1], yearInferred: false },
});
const handLeg: LegDraft = { ...EMPTY_LEG, optionType: 'C', strike: '40000', quantity: '1' };

describe('stripStatement（R1・R2。例 #1・#8・#10）', () => {
  it('例 #1: 読み取りの欄 9 つ（直した値も）は空、既定の答えは戻り、入力元は手入力。LC 以下・時間足・為替は残る', () => {
    const d = stripStatement(A, MARKS);
    for (const f of READ_FIELDS) expect(d[f], f).toEqual(EMPTY_DRAFT[f]);
    expect(d).toMatchObject({
      lcDecided: null,
      exitReason: 'other',
      exitOrderType: 'unknown',
      stopOrderPlaced: 'unanswered',
      source: 'manual',
      lc: '99.5',
      brokenCondition: '直近安値割れ',
      lcMove: 'none',
      timeframeChange: 'none',
      entryChartTimeframe: '1h',
      fxRate: '150',
      accountId: 'accB',
    });
  });

  it('本人が選んだ答え（印が「明細から」でない）は残す', () => {
    const { lcDecided: _l, exitReason: _e, ...mine } = MARKS;
    const d = stripStatement(A, mine);
    expect(d.lcDecided).toBe(true);
    expect(d.exitReason).toBe('lc');
  });

  it('例 #8: 自動で選んだ口座は選ぶ前の口座に（渡さなければ今のまま）', () => {
    expect(stripStatement(A, MARKS, 'default').accountId).toBe('default');
  });

  it('例 #10: 明細から読んだレッグだけを除き、手で足したレッグは残す', () => {
    const withLegs = { ...A, legs: [readLeg('36000'), readLeg('35500'), handLeg] };
    expect(stripStatement(withLegs, MARKS).legs).toEqual([handLeg]);
  });
});

describe('オプションの行の原資産の欄（#184 のコードレビュー 1。設計書 7.5・13.2）', () => {
  // 明細はオプションの行の原資産の L / S・イン・決済・数量を入れない（印が無い）= 本人が入れた値なので、削除・戻しで触らない
  const OPT_MARKS: Marks = {
    instrumentName: 'read',
    exitTime: 'read',
    pnlYen: 'read',
    feeYen: 'read',
  };
  const opt = { ...A, legs: [readLeg('36000'), handLeg] };

  it('削除しても原資産の L / S・イン・決済・数量は残り、明細が入れた欄・明細のレッグは取り除く', () => {
    const d = stripStatement(opt, OPT_MARKS);
    expect(d).toMatchObject({ side: 'L', entryPrice: '100', exitPrice: '99.0', quantity: '1' });
    expect(d).toMatchObject({ instrumentName: '', exitTime: '', pnlYen: '', feeYen: '' });
    expect(d.entryTime).toBe(A.entryTime);
    expect(d.legs).toEqual([handLeg]);
  });

  it('［元に戻す］ の後も、削除の後に本人が直した原資産の値はそのまま', () => {
    const stripped = stripStatement(opt, OPT_MARKS);
    const now = { ...stripped, exitPrice: '98.5' };
    const back = restoreStatement(now, opt, stripped, OPT_MARKS);
    expect(back.exitPrice).toBe('98.5');
    expect(back.instrumentName).toBe(A.instrumentName);
    expect(back.legs).toEqual(opt.legs);
  });
});

describe('restoreStatement（R4・R6。例 #2）', () => {
  it('削除の直後に戻すと削除の前と同じ', () => {
    const stripped = stripStatement(A, MARKS, 'default');
    expect(restoreStatement(stripped, A, stripped, MARKS)).toEqual(A);
  });

  it('削除の後に入れた計画の欄は今のまま、明細から来た値だけを戻す', () => {
    const stripped = stripStatement(A, MARKS);
    const now = { ...stripped, lc: '99.4', brokenCondition: '別の一言' };
    expect(restoreStatement(now, A, stripped, MARKS)).toEqual({
      ...A,
      lc: '99.4',
      brokenCondition: '別の一言',
    });
  });

  it('削除の後に本人が選んだ答え・口座は戻さない', () => {
    const stripped = stripStatement(A, MARKS, 'default');
    const now = { ...stripped, lcDecided: false, exitReason: 'other' as const };
    const back = restoreStatement(
      now,
      A,
      stripped,
      MARKS,
      new Set(['lcDecided', 'exitReason', 'accountId'] as const),
    );
    expect(back).toMatchObject({ lcDecided: false, exitReason: 'other', accountId: 'default' });
    expect(back.exitPrice).toBe('99.0');
  });

  it('レッグ: 明細のレッグ（削除の前の並び）+ 今の手で足したレッグ', () => {
    const before = { ...A, legs: [readLeg('36000'), readLeg('35500'), handLeg] };
    const stripped = stripStatement(before, MARKS);
    const hand2 = { ...handLeg, strike: '41000' };
    const now = { ...stripped, legs: [handLeg, hand2] };
    expect(restoreStatement(now, before, stripped, MARKS).legs).toEqual([
      readLeg('36000'),
      readLeg('35500'),
      handLeg,
      hand2,
    ]);
  });
});

// #165・C56: 逆指値の未設定（本人の答え）は明細から来たものではないので、削除・戻しで消えない
describe('逆指値の未設定（#165）', () => {
  const withStop: Draft = applyDraft(A, { type: 'set', field: 'stopNotPlaced', value: true });

  it('削除しても未設定は残り、本文は notPlaced', () => {
    const stripped = stripStatement(withStop, MARKS);
    expect(stripped.stopNotPlaced).toBe(true);
    expect(stripped.stopOrderPlaced).toBe('unanswered');
  });

  it('戻しても未設定は残る（明細の逆指値 placed も戻る）', () => {
    const stripped = stripStatement(withStop, MARKS);
    const back = restoreStatement(stripped, withStop, stripped, MARKS);
    expect(back.stopNotPlaced).toBe(true);
    expect(back.stopOrderPlaced).toBe('placed');
  });
});
