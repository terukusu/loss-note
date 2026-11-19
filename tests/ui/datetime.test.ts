// datetime-local の文字列 ⇔ エポック（端末の時間帯。Issue #13）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  floorToMinute,
  formatDateTime,
  formatHolding,
  fromLocalInput,
  toLocalInput,
} from '../../ui/src/lib/datetime';
import { forAll } from '../core/helpers/prng';

describe('datetime-local の読み書き', () => {
  it('端末の時間帯の日時として読む（Date の地方時と同じ）', () => {
    expect(fromLocalInput('2026-03-04T05:06')).toBe(new Date(2026, 2, 4, 5, 6).getTime());
    expect(fromLocalInput('2026-03-04T05:06:07')).toBe(new Date(2026, 2, 4, 5, 6, 7).getTime());
  });

  it('書く: 分まで、0 で埋める', () => {
    expect(toLocalInput(new Date(2026, 0, 2, 3, 4, 59).getTime())).toBe('2026-01-02T03:04');
  });

  it.each([
    '',
    '2026-02-30T10:00',
    '2026-13-01T10:00',
    '2026-01-01T24:00',
    '2026-01-01 10:00',
    'abc',
    '2101-01-01T00:00',
    '1969-12-31T00:00',
  ])('読めない・範囲外: %j', (s) => {
    expect(fromLocalInput(s)).toBeUndefined();
  });

  it('性質: 書いた文字列を読んで書き直すと同じ文字列（種つき乱数。夏時間の重なりにも依らない）', () => {
    forAll(
      1302,
      500,
      (r) => floorToMinute(Date.UTC(2000, 0, 1) + r.next() * 50 * 365 * 86400000),
      (ms) => {
        const s = toLocalInput(ms);
        const back = fromLocalInput(s);
        expect(back).toBeDefined();
        expect(toLocalInput(back as number)).toBe(s);
      },
    );
  });

  it('floorToMinute は秒・ミリ秒を落とす', () => {
    const t = new Date(2026, 5, 6, 7, 8, 9, 10).getTime();
    expect(floorToMinute(t)).toBe(new Date(2026, 5, 6, 7, 8).getTime());
  });
});

describe('formatDateTime（資金の履歴の日時。端末の時間帯。Issue #5）', () => {
  it('YYYY/MM/DD HH:mm（0 で埋める）', () => {
    expect(formatDateTime(new Date(2026, 10, 8, 9, 5, 30).getTime())).toBe('2026/11/08 09:05');
    expect(formatDateTime(new Date(2026, 0, 1, 0, 0).getTime())).toBe('2026/01/01 00:00');
  });
});

describe('formatHolding（保有時間。Issue #58 契約 P-58a・例 H1〜H6）', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  /** 架空の日時（UTC。差だけを見るので時間帯に依らない） */
  const at = (d: number, h: number, mi = 0) => Date.UTC(2026, 10, d, h, mi);

  it.each([
    // H1: 11/10 09:00 → 11/12 13:00 = 2 日 + 4 時間
    ['H1', at(10, 9), at(12, 13), '保有 2 日 4 時間'],
    // H2: 09:00 → 12:05 = 3 時間 + 5 分
    ['H2', at(10, 9), at(10, 12, 5), '保有 3 時間 5 分'],
    // H3: 09:00 → 09:45 = 45 分
    ['H3', at(10, 9), at(10, 9, 45), '保有 45 分'],
    // H4: 09:00 → 09:00 = 0 分（1 分未満）
    ['H4', at(10, 9), at(10, 9), '保有 1 分未満'],
    // H5: 11/10 09:00 → 11/12 09:30 = 2 日 + 0 時間 30 分（1 日以上は分を切り捨て、0 時間は省く）
    ['H5', at(10, 9), at(12, 9, 30), '保有 2 日'],
    // H6: 09:00 → 12:00 = 3 時間 + 0 分（0 分は省く）
    ['H6', at(10, 9), at(10, 12), '保有 3 時間'],
  ] as const)('%s', (_id, entry, exit, want) => {
    expect(formatHolding(entry, exit)).toBe(want);
  });

  it('境目: 59 秒は 1 分未満・1 分・59 分・1 時間・23 時間 59 分・1 日・1 日 1 時間（どれも切り捨て）', () => {
    const t0 = at(10, 9);
    expect(formatHolding(t0, t0 + 59_999)).toBe('保有 1 分未満');
    expect(formatHolding(t0, t0 + MIN)).toBe('保有 1 分');
    expect(formatHolding(t0, t0 + 60 * MIN - 1)).toBe('保有 59 分');
    expect(formatHolding(t0, t0 + HOUR)).toBe('保有 1 時間');
    expect(formatHolding(t0, t0 + DAY - 1)).toBe('保有 23 時間 59 分');
    expect(formatHolding(t0, t0 + DAY)).toBe('保有 1 日');
    expect(formatHolding(t0, t0 + DAY + HOUR + 59 * MIN)).toBe('保有 1 日 1 時間');
  });

  it('決済がエントリーより前・有限でない値は null（出さない）', () => {
    const t0 = at(10, 9);
    expect(formatHolding(t0, t0 - 1)).toBeNull();
    expect(formatHolding(Number.NaN, t0)).toBeNull();
    expect(formatHolding(t0, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('性質: 差だけで決まる（同じ差なら起点に依らない）・差を増やすと（日, 時, 分）が辞書順で減らない（種つき乱数）', () => {
    /** 文の数の組（日, 時, 分）。1 分未満は (0, 0, 0) */
    const parts = (s: string): [number, number, number] => {
      const n = (re: RegExp) => Number(re.exec(s)?.[1] ?? 0);
      return [n(/(\d+) 日/), n(/(\d+) 時間/), n(/(\d+) 分(?!未満)/)];
    };
    const cmp = (a: number[], b: number[]) => {
      for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
      return 0;
    };
    forAll(
      5801,
      500,
      (r) => {
        const start = Date.UTC(2000, 0, 1) + Math.floor(r.next() * 40 * 365 * DAY);
        const d1 = Math.floor(r.next() * 30 * DAY);
        const d2 = d1 + Math.floor(r.next() * 3 * DAY);
        const shift = Math.floor(r.next() * 365 * DAY);
        return { start, d1, d2, shift };
      },
      ({ start, d1, d2, shift }) => {
        const a = formatHolding(start, start + d1);
        const b = formatHolding(start, start + d2);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(formatHolding(start + shift, start + shift + d1)).toBe(a);
        expect(cmp(parts(b as string), parts(a as string))).toBeGreaterThanOrEqual(0);
        // 1 日以上は分を出さない
        if (d1 >= DAY) expect(a).not.toMatch(/分/);
        expect(a).not.toMatch(/NaN|undefined/);
      },
    );
  });
});
