// C-1 数字の表示（Issue #3 の例の表 N1〜N10・R3）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { formatR, formatYen } from '../../ui/src/lib/format';
import { forAll } from '../core/helpers/prng';

const MINUS = '−';

describe('formatR / formatYen（例の表 N1〜N10）', () => {
  it.each([
    ['N1', 2.34, '+2.3R'],
    ['N2', -1, `${MINUS}1.0R`],
    ['N3', -1.25, `${MINUS}1.3R`],
    ['N4', 0, '±0.0R'],
    ['N5', -0.04, `${MINUS}0.0R`],
    ['N6', 0.04, '+0.0R'],
    ['N7', null, 'R なし'],
  ] as const)('%s: R = %s → %s', (_id, r, want) => {
    expect(formatR(r)).toBe(want);
  });

  it.each([
    ['N8', 12345, '+12,345円'],
    ['N9', -1234.5, `${MINUS}1,235円`],
    ['N10', 0, '±0円'],
  ] as const)('%s: 損益 %s → %s', (_id, yen, want) => {
    expect(formatYen(yen)).toBe(want);
  });
});

describe('formatR / formatYen の端', () => {
  it('2 進の誤差で 0 に近い側へ落ちない（1.15 → +1.2R、−1.15 → −1.2R）', () => {
    // 1.15 × 10 = 11.499999999999998 になる。0 から遠い側へ寄せて 12
    expect(formatR(1.15)).toBe('+1.2R');
    expect(formatR(-1.15)).toBe(`${MINUS}1.2R`);
    expect(formatR(0.05)).toBe('+0.1R');
  });

  it('−0 は ±（ちょうど 0 と同じ）', () => {
    expect(formatR(-0)).toBe('±0.0R');
    expect(formatYen(-0)).toBe('±0円');
  });

  it('円は丸めて 0 でも元の符号を残す（−0.4 → −0円、0.4 → +0円）', () => {
    expect(formatYen(-0.4)).toBe(`${MINUS}0円`);
    expect(formatYen(0.4)).toBe('+0円');
  });

  it('大きな値の 3 桁区切り（999999.95 → +1,000,000円、R の 1234.56 → +1234.6R）', () => {
    expect(formatYen(999999.95)).toBe('+1,000,000円');
    expect(formatYen(-1234567)).toBe(`${MINUS}1,234,567円`);
    expect(formatR(1234.56)).toBe('+1234.6R');
  });

  it('有限でない値は「R なし」「損益なし」', () => {
    expect(formatR(Number.NaN)).toBe('R なし');
    expect(formatR(Number.POSITIVE_INFINITY)).toBe('R なし');
    expect(formatR(Number.NEGATIVE_INFINITY)).toBe('R なし');
    expect(formatYen(Number.NaN)).toBe('損益なし');
    expect(formatYen(Number.POSITIVE_INFINITY)).toBe('損益なし');
  });
});

/** 表示の文字列から符号と絶対値を取り出す */
function parse(s: string, unit: 'R' | '円'): { sign: string; abs: number } {
  const m = new RegExp(`^([+${MINUS}±])([\\d,]+(?:\\.\\d)?)${unit}$`).exec(s);
  if (!m) throw new Error(`形が違う: ${s}`);
  return { sign: m[1] ?? '', abs: Number((m[2] ?? '').replace(/,/g, '')) };
}

describe('formatR / formatYen の性質（種つき乱数・架空の値）', () => {
  it('R: 符号は元の値の符号、丸めの差は 0.05 以内、ハイフンを含まない', () => {
    forAll(
      303,
      2000,
      (r) => (r.next() - 0.5) * 20 * (r.bool(0.2) ? 100 : 1),
      (x) => {
        const s = formatR(x);
        expect(s.includes('-')).toBe(false);
        const { sign, abs } = parse(s, 'R');
        expect(sign).toBe(x > 0 ? '+' : x < 0 ? MINUS : '±');
        expect(Math.abs(abs - Math.abs(x))).toBeLessThanOrEqual(0.05 + 1e-9);
      },
    );
  });

  it('円: 符号は元の値の符号、丸めの差は 0.5 以内、3 桁区切り、ハイフンを含まない', () => {
    forAll(
      304,
      2000,
      (r) => (r.next() - 0.5) * 10 ** r.int(0, 9),
      (x) => {
        const s = formatYen(x);
        expect(s.includes('-')).toBe(false);
        expect(s).toMatch(/^[+−±]\d{1,3}(,\d{3})*円$/);
        const { sign, abs } = parse(s, '円');
        expect(sign).toBe(x > 0 ? '+' : x < 0 ? MINUS : '±');
        expect(Math.abs(abs - Math.abs(x))).toBeLessThanOrEqual(0.5 + 1e-9);
      },
    );
  });
});
