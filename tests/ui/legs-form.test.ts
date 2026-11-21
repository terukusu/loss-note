// レッグの下書きの純関数（#117。設計書 4.7・7.6・C54）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  canUndoLegRemove,
  EMPTY_LEG,
  LEG_MSG,
  type LegDraft,
  legCardText,
  legDraftsFromStored,
  legIds,
  legRemovedText,
  legsChanged,
  nextLeg,
  normalizeContractMonth,
  readLegs,
  sqEndOf,
  toggleExpired,
  undoLegRemove,
} from '../../ui/src/lib/legs-form';

const full: LegDraft = {
  ...EMPTY_LEG,
  optionType: 'P',
  contractMonth: '2027-01',
  strike: '36,000',
  side: 'sell',
  quantity: '2',
  entryPrice: '120',
  exitPrice: '60',
};

describe('SQ の日の終わり（C54・#116 の「その日の日本時間の終わり」）', () => {
  it('2027-01 は第 2 金曜の 2027-01-08、2027-02 は 2027-02-12（共有の fixture と同じ時点）', () => {
    expect(sqEndOf('2027-01')).toBe(1_799_420_399_999);
    expect(sqEndOf('2027-02')).toBe(1_802_444_399_999);
  });
  it('週次の YYYY-MM-DD はその日。翌日 0 時（日本時間）の 1 ms 前', () => {
    // 2027-01-15 の終わり = 2027-01-15T15:00:00Z − 1 ms
    expect(sqEndOf('2027-01-15')).toBe(Date.UTC(2027, 0, 15, 15) - 1);
  });
  it('1 日が金曜の月も第 2 金曜（2027-10-01 は金曜 → 2027-10-08）', () => {
    expect(sqEndOf('2027-10')).toBe(Date.UTC(2027, 9, 8, 15) - 1);
  });
  it('読めない形は無し', () => {
    expect(sqEndOf('2027-13')).toBeUndefined();
    expect(sqEndOf('')).toBeUndefined();
  });
});

describe('限月の打ち方', () => {
  it.each([
    ['2027-01', '2027-01'],
    ['2027/1', '2027-01'],
    ['２０２７－０１'.replace('－', '-'), '2027-01'],
    ['2027.1.15', '2027-01-15'],
    ['2027年1月', '2027-01'],
    // 数字だけ・2 桁の年（スマホの数字のキーボード。デザインレビュー N4）
    ['202701', '2027-01'],
    ['2701', '2027-01'],
    ['27/1', '2027-01'],
    ['20270115', '2027-01-15'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeContractMonth(raw)).toBe(want);
  });
  it.each(['2027-00', '2027-02-30', '271', '202713', 'abc'])('%s は読めない', (raw) => {
    expect(normalizeContractMonth(raw)).toBeUndefined();
  });
});

describe('[＋ レッグ]（7.6「直前のレッグの限月・P / C・買い / 売り・枚数を写す」）', () => {
  it('前のレッグを写し、行使価格・イン・決済・満期で消滅・ID・時刻は写さない', () => {
    const prev: LegDraft = { ...full, id: 'l1', expired: true, entryTime: 1, exitTime: 2 };
    expect(nextLeg([prev])).toEqual({
      ...EMPTY_LEG,
      optionType: 'P',
      contractMonth: '2027-01',
      side: 'sell',
      quantity: '2',
    });
  });
  it('レッグが無ければ空の行', () => {
    expect(nextLeg([])).toEqual(EMPTY_LEG);
  });
});

describe('[満期で消滅]', () => {
  it('入れると決済が空なら 0、入っていればそのまま。外すと決済は残す', () => {
    expect(toggleExpired({ ...full, exitPrice: '' })).toMatchObject({
      expired: true,
      exitPrice: '0',
    });
    expect(toggleExpired({ ...full, exitPrice: '35' })).toMatchObject({
      expired: true,
      exitPrice: '35',
    });
    expect(toggleExpired({ ...full, expired: true })).toMatchObject({
      expired: false,
      exitPrice: '60',
    });
  });
});

describe('レッグを読む（API の検査と同じ形）', () => {
  it('そろったレッグ → Leg（数は 3 桁区切りを読む・ID は l1 から・手で入れたレッグは時刻なし）', () => {
    const r = readLegs([full]);
    expect(r.missing).toEqual([]);
    expect(r.legs).toEqual([
      {
        id: 'l1',
        optionType: 'P',
        contractMonth: '2027-01',
        strike: 36_000,
        side: 'sell',
        quantity: 2,
        entry: { price: 120 },
        exit: { price: 60, kind: 'closed' },
      },
    ]);
  });
  it('満期で消えたレッグの決済の時刻は SQ の日の終わり', () => {
    const r = readLegs([{ ...full, expired: true, exitPrice: '0' }]);
    expect(r.legs?.[0]?.exit).toEqual({ price: 0, time: 1_799_420_399_999, kind: 'expired' });
  });
  it('保存済みの時刻は保つ（決済したレッグだけ決済の時刻）', () => {
    const r = readLegs([{ ...full, entryTime: 10, exitTime: 20 }]);
    expect(r.legs?.[0]?.entry.time).toBe(10);
    expect(r.legs?.[0]?.exit.time).toBe(20);
  });
  it('レッグが無ければ「レッグ」が足りない', () => {
    expect(readLegs([])).toEqual({ errors: [], missing: ['レッグ'] });
  });
  it('足りない欄のあるレッグを名指す・誤りは欄ごと・本文は作らない', () => {
    const r = readLegs([
      full,
      { ...full, strike: '' },
      { ...full, quantity: '0', contractMonth: 'x' },
    ]);
    expect(r.missing).toEqual(['レッグ 2']);
    expect(r.errors[2]).toEqual({
      quantity: '0 より大きい数値を入力してください',
      contractMonth: LEG_MSG.contractMonth,
    });
    expect(r.legs).toBeUndefined();
  });
  it('イン・決済は 0 を受ける（OTM で消えた）、負は誤り', () => {
    expect(readLegs([{ ...full, exitPrice: '0' }]).legs).toBeDefined();
    expect(readLegs([{ ...full, entryPrice: '-1' }]).errors[0]).toEqual({
      entryPrice: '0 以上の数値を入力してください',
    });
  });
});

describe('ID（保存済みは保ち、足したレッグには空いている ID）', () => {
  it('l1・l3 が残り、足したレッグは l2', () => {
    expect(legIds([{ ...full, id: 'l1' }, { ...full, id: 'l3' }, full])).toEqual([
      'l1',
      'l3',
      'l2',
    ]);
  });
  it('重なった ID は外して振り直す', () => {
    expect(
      legIds([
        { ...full, id: 'l2' },
        { ...full, id: 'l2' },
      ]),
    ).toEqual(['l2', 'l1']);
  });
});

describe('保存済み → 下書き → 読む の往復と、直したか', () => {
  const stored = readLegs([
    { ...full, entryTime: 5, exitTime: 9 },
    { ...full, side: 'buy', strike: '35000', expired: true, exitPrice: '0' },
  ]).legs;
  if (stored === undefined) throw new Error('読めない');
  it('何も変えなければ同じレッグ（直していない）', () => {
    const again = readLegs(legDraftsFromStored(stored)).legs;
    expect(again).toEqual(stored);
    expect(legsChanged(stored, again ?? [])).toBe(false);
  });
  it('決済を変える・消す・足すと直した', () => {
    const d = legDraftsFromStored(stored);
    const changed =
      readLegs([{ ...(d[0] as LegDraft), exitPrice: '61' }, d[1] as LegDraft]).legs ?? [];
    expect(legsChanged(stored, changed)).toBe(true);
    expect(legsChanged(stored, stored.slice(0, 1))).toBe(true);
  });
});

describe('満期で消えたレッグの保存済みの時刻（レビュー 1）', () => {
  // SQ の日から作る時刻と違う時刻（祝日で繰り上げた SQ などの架空の値）
  const odd = Date.UTC(2027, 0, 7, 15) - 1;
  const stored = readLegs([{ ...full, expired: true, exitPrice: '0' }]).legs;
  if (stored === undefined) throw new Error('読めない');
  const legs = [
    { ...stored[0], exit: { ...stored[0].exit, time: odd } } as (typeof stored)[number],
  ] as const;
  it('何も変えなければ保存済みの時刻を保つ（直したことにならない）', () => {
    const again = readLegs(legDraftsFromStored(legs)).legs ?? [];
    expect(again[0]?.exit.time).toBe(odd);
    expect(legsChanged(legs, again)).toBe(false);
  });
  it('保存済みの時刻が無い満期のレッグは、何も変えなければ時刻を付けない', () => {
    const { time: _t, ...exit } = stored[0].exit;
    const noTime = [{ ...stored[0], exit }] as unknown as typeof legs;
    const again = readLegs(legDraftsFromStored(noTime)).legs ?? [];
    expect(again[0]?.exit.time).toBeUndefined();
    expect(legsChanged(noTime, again)).toBe(false);
  });
  it('限月を変えたら SQ の日から作り直す', () => {
    const d = legDraftsFromStored(legs)[0] as LegDraft;
    const again = readLegs([{ ...d, contractMonth: '2027-02' }]).legs ?? [];
    expect(again[0]?.exit.time).toBe(sqEndOf('2027-02'));
  });
});

describe('レッグを消して戻す（P4・デザインレビュー B1）', () => {
  const a = { ...full, strike: '1' };
  const b = { ...full, strike: '2' };
  const c = { ...full, strike: '3' };
  it('元の位置へ戻す。並びが短くなっていれば末尾', () => {
    expect(undoLegRemove([a, c], { leg: b, index: 1 })).toEqual([a, b, c]);
    expect(undoLegRemove([a], { leg: c, index: 2 })).toEqual([a, c]);
    expect(legRemovedText({ leg: b, index: 1 })).toBe('レッグ 2 を削除しました');
  });
  it('再レビュー B2: 10 本のときは戻さない（11 本目を作らない）。11 本以上は読まない（保存を止める）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...full, strike: String(i + 1) }));
    expect(canUndoLegRemove(ten)).toBe(false);
    expect(undoLegRemove(ten, { leg: b, index: 1 })).toHaveLength(10);
    expect(canUndoLegRemove(ten.slice(1))).toBe(true);
    const r = readLegs([...ten, c]);
    expect(r.tooMany).toBe(true);
    expect(r.legs).toBeUndefined();
  });
});

describe('カードの 2 行（7.6「売り 2 · P 36,000 · 2027-01」「120 → 60」）', () => {
  it('そろったレッグ', () => {
    expect(legCardText(full)).toEqual({ head: '売り 2 · P 36,000 · 2027-01', prices: '120 → 60' });
  });
  it('満期で消滅・未入力の欄は ?', () => {
    expect(legCardText({ ...EMPTY_LEG, side: 'buy', expired: true, exitPrice: '0' })).toEqual({
      head: '買い ? · ? ? · ?',
      prices: '? → 0 満期で消滅',
    });
  });
});
