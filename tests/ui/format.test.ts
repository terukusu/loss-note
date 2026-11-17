// C-1 数字の表示（Issue #3 の例の表 N1〜N10・R3）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { formatPct, formatPlain, formatPrice, formatR, formatYen } from '../../ui/src/lib/format';
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

describe('formatPct（Issue #13 E12・契約 R-2）: 小数 1 桁へ切り上げ、誤差 1e-9 は切り上げない', () => {
  it.each([
    ['E12 2.01%', 2.01, '2.1%'],
    ['E12 2.00%', 2.0, '2.0%'],
    ['E12 1.96%', 1.96, '2.0%'],
    ['0.5% は 0.6% にならない', 0.5, '0.5%'],
    ['2.5% は 2.6% にならない', 2.5, '2.5%'],
    ['2 進の誤差（0.1 + 0.2 = 0.30000000000000004）', 0.1 + 0.2, '0.3%'],
    ['ちょうど 0', 0, '0.0%'],
    ['1e-9 の上振れは切り上げない', 2 + 1e-10, '2.0%'],
  ] as const)('%s', (_name, p, want) => {
    expect(formatPct(p)).toBe(want);
  });

  it('有限でない値は「リスクなし」', () => {
    expect(formatPct(Number.NaN)).toBe('リスクなし');
    expect(formatPct(Number.POSITIVE_INFINITY)).toBe('リスクなし');
  });

  it('性質: 表示の値は元の値以上で、差は 0.1 未満（種つき乱数）', () => {
    forAll(
      1301,
      2000,
      (r) => r.next() * 10 ** r.int(0, 2),
      (x) => {
        const s = formatPct(x);
        expect(s).toMatch(/^\d+\.\d%$/);
        const v = Number(s.slice(0, -1));
        expect(v).toBeGreaterThanOrEqual(x - 1e-9);
        expect(v - x).toBeLessThan(0.1 + 1e-9);
      },
    );
  });
});

describe('formatPrice（契約 R-2）: 保存した数のまま', () => {
  it.each([
    [99.5, '99.5'],
    [99.2, '99.2'],
    [151, '151'],
    [0.00012, '0.00012'],
    [38250, '38250'],
  ] as const)('%s → %s', (n, want) => {
    expect(formatPrice(n)).toBe(want);
  });
});

describe('formatPlain（レビュー指摘 5）: 指数表記にしない', () => {
  it.each([
    [1e-7, '0.0000001'],
    [2.5e-8, '0.000000025'],
    [0.00012, '0.00012'],
    [10000, '10000'],
    [0.3, '0.3'],
  ] as const)('%s → %s', (n, want) => {
    expect(formatPlain(n)).toBe(want);
    expect(formatPrice(n)).toBe(want);
  });

  it('性質: 指数表記を含まず、数として読み直すと元の値（種つき乱数）', () => {
    forAll(
      1304,
      1000,
      (r) => r.int(1, 99999) * 10 ** -r.int(0, 12),
      (x) => {
        const s = formatPlain(x);
        expect(s).not.toMatch(/e/i);
        expect(Number(s)).toBeCloseTo(x, 12);
      },
    );
  });
});
