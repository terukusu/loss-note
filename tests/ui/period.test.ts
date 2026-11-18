// ホームの振り返りの期間（Issue #88 契約 P-2・例の表 P1〜P8・AC-1・AC-8）。値はすべて架空。
// 端末の時間帯を日本時間に決め打ちしない（期待もローカルの new Date(年, 月, 日) で作る）
import { describe, expect, it } from 'vitest';
import {
  customDefaults,
  inRange,
  PERIOD_ERROR,
  PERIOD_KEYS,
  type PeriodSelection,
  parsePeriod,
  periodRange,
  periodSearch,
} from '../../ui/src/lib/period';
import { forAll } from '../core/helpers/prng';

/** 今日 = 2026-11-19 12:00（ローカル） */
const NOW = new Date(2026, 10, 19, 12, 0).getTime();
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

function ok(sel: PeriodSelection, now = NOW) {
  const r = periodRange(sel, now);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const sel = (key: PeriodSelection['key'], from?: string, to?: string): PeriodSelection => ({
  key,
  ...(from === undefined ? {} : { from }),
  ...(to === undefined ? {} : { to }),
  imports: false,
});

describe('periodRange: 例の表', () => {
  it('P1: 1 日 = 11/19 0:00〜11/20 0:00。11/18 23:59 は入らない', () => {
    const r = ok(sel('1d'));
    expect([r.from, r.to]).toEqual([at(2026, 11, 19), at(2026, 11, 20)]);
    expect(inRange(at(2026, 11, 18, 23, 59), r)).toBe(false);
    expect(inRange(at(2026, 11, 19), r)).toBe(true);
    expect(r.label).toBe('11/19');
    expect(r.days).toBe(1);
  });

  it('P2: 7 日 = 11/13 0:00〜11/20 0:00', () => {
    const r = ok(sel('7d'));
    expect([r.from, r.to]).toEqual([at(2026, 11, 13), at(2026, 11, 20)]);
    expect(r.label).toBe('11/13〜11/19');
    expect(r.days).toBe(7);
  });

  it('P3: 1 か月 = 10/20 0:00〜11/20 0:00', () => {
    const r = ok(sel('1m'));
    expect([r.from, r.to]).toEqual([at(2026, 10, 20), at(2026, 11, 20)]);
    expect(r.label).toBe('10/20〜11/19');
  });

  it('P4: 3 か月 = 8/20 0:00〜11/20 0:00', () => {
    const r = ok(sel('3m'));
    expect([r.from, r.to]).toEqual([at(2026, 8, 20), at(2026, 11, 20)]);
  });

  it('P5: 1 か月（今日 = 2026-03-31）= 3/1 0:00〜4/1 0:00（2/31 が無いので 2/28 の翌日）', () => {
    const r = ok(sel('1m'), at(2026, 3, 31, 12));
    expect([r.from, r.to]).toEqual([at(2026, 3, 1), at(2026, 4, 1)]);
    expect(r.label).toBe('3/1〜3/31');
  });

  it('P6: 任意 11/01〜11/10 = 11/01 0:00〜11/11 0:00。11/10 23:59 は入り、11/11 0:00 は入らない', () => {
    const r = ok(sel('custom', '2026-11-01', '2026-11-10'));
    expect([r.from, r.to]).toEqual([at(2026, 11, 1), at(2026, 11, 11)]);
    expect(inRange(at(2026, 11, 10, 23, 59), r)).toBe(true);
    expect(inRange(at(2026, 11, 11), r)).toBe(false);
    expect(r.label).toBe('11/1〜11/10');
    expect(r.days).toBe(10);
  });

  it('P7: 逆・1 年を超える・空は集計しない理由の文言', () => {
    expect(periodRange(sel('custom', '2026-11-10', '2026-11-01'), NOW)).toEqual({
      ok: false,
      error: PERIOD_ERROR.order,
    });
    expect(periodRange(sel('custom', '2025-11-01', '2026-11-19'), NOW)).toEqual({
      ok: false,
      error: PERIOD_ERROR.tooLong,
    });
    expect(periodRange(sel('custom'), NOW)).toEqual({ ok: false, error: PERIOD_ERROR.empty });
    expect(periodRange(sel('custom', '2026-11-01'), NOW)).toEqual({
      ok: false,
      error: PERIOD_ERROR.empty,
    });
    expect(PERIOD_ERROR).toEqual({
      empty: '開始日と終了日を選んでください',
      order: '開始日は終了日より前にしてください',
      tooLong: '1 年以内で選んでください',
    });
  });

  it('P7 の境: 同じ日は 1 日、366 日ちょうどは受ける・367 日は誤り', () => {
    expect(ok(sel('custom', '2026-11-19', '2026-11-19')).days).toBe(1);
    const r = ok(sel('custom', '2025-11-19', '2026-11-19'));
    expect(r.days).toBe(366);
    expect(r.label).toBe('2025/11/19〜2026/11/19');
    expect(periodRange(sel('custom', '2025-11-18', '2026-11-19'), NOW)).toEqual({
      ok: false,
      error: PERIOD_ERROR.tooLong,
    });
  });

  it('P8: 期間が無い・知らない値は 7 日', () => {
    for (const s of ['', '?', '?period=2w', '?period=7D', '?imports=1', '?period=']) {
      expect(parsePeriod(s).key).toBe('7d');
    }
    expect(parsePeriod('?period=2w&imports=1')).toEqual({ key: '7d', imports: true });
  });
});

describe('URL の端の日付', () => {
  it('どの時間帯でも API の時刻の範囲に収まらない年（1970・2099 年）は日付として受けない', () => {
    expect(parsePeriod('?period=custom&from=1970-01-01&to=1970-01-05')).toEqual({
      key: 'custom',
      imports: false,
    });
    expect(parsePeriod('?period=custom&from=2099-12-01&to=2099-12-31')).toEqual({
      key: 'custom',
      imports: false,
    });
    const r = periodRange(sel('custom', '1971-01-01', '1971-12-31'), NOW);
    expect(r.ok && r.from).toBeGreaterThan(0);
  });
});

describe('parsePeriod / periodSearch', () => {
  it('5 つの期間 × 取り込みの 2 状態で往復が同じ（AC-8）', () => {
    for (const key of PERIOD_KEYS) {
      for (const imports of [false, true]) {
        const s: PeriodSelection =
          key === 'custom'
            ? { key, from: '2026-11-01', to: '2026-11-10', imports }
            : { key, imports };
        const search = periodSearch(s);
        expect(search.startsWith(`?period=${key}`)).toBe(true);
        expect(parsePeriod(search)).toEqual(s);
      }
    }
  });

  it('任意の日付は形の合うもの・ある日付だけ残す', () => {
    expect(parsePeriod('?period=custom&from=2026-02-30&to=2026-3-1')).toEqual({
      key: 'custom',
      imports: false,
    });
    expect(parsePeriod('?period=custom&from=2026-02-28')).toEqual({
      key: 'custom',
      from: '2026-02-28',
      imports: false,
    });
    // 任意でない期間の from / to は捨てる
    expect(parsePeriod('?period=1d&from=2026-11-01&to=2026-11-02')).toEqual({
      key: '1d',
      imports: false,
    });
  });

  it('任意の最初の日付は 7 日と同じ範囲', () => {
    const d = customDefaults(NOW);
    expect(d).toEqual({ from: '2026-11-13', to: '2026-11-19' });
    const a = ok(sel('custom', d.from, d.to));
    const b = ok(sel('7d'));
    expect([a.from, a.to]).toEqual([b.from, b.to]);
  });
});

describe('periodRange: 性質', () => {
  it('どの日でも 開始 ≦ 今 < 終了・終了は翌日の 0 時・1 か月は 28〜31 日・3 か月は 89〜92 日', () => {
    forAll(
      880,
      500,
      (r) => new Date(r.int(2020, 2030), r.int(0, 11), r.int(1, 31), r.int(0, 23)).getTime(),
      (now) => {
        const t = new Date(now);
        const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
        const days: Record<string, number> = {};
        for (const key of ['1d', '7d', '1m', '3m'] as const) {
          const r = ok(sel(key), now);
          expect(r.from).toBeLessThanOrEqual(now);
          expect(r.to).toBe(tomorrow);
          // 開始はその暦日の最初の時刻（0 時に夏時間が始まる時間帯では 1 時になるので、時を見ずに暦日の境で確かめる）
          const f = new Date(r.from);
          expect(r.from).toBe(new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime());
          const before = new Date(r.from - 1);
          expect(before.getDate() === f.getDate() && before.getMonth() === f.getMonth()).toBe(
            false,
          );
          days[key] = r.days;
        }
        expect(days['1d']).toBe(1);
        expect(days['7d']).toBe(7);
        expect(days['1m']).toBeGreaterThanOrEqual(28);
        expect(days['1m']).toBeLessThanOrEqual(31);
        expect(days['3m']).toBeGreaterThanOrEqual(89);
        expect(days['3m']).toBeLessThanOrEqual(92);
      },
    );
  });
});
