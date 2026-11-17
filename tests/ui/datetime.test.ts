// datetime-local の文字列 ⇔ エポック（端末の時間帯。Issue #13）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  floorToMinute,
  formatDateTime,
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
