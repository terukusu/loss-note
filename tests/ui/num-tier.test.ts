// 数字の段と単位の文法（#236・設計書 C62）。例 E1〜E11 は Issue の例の表。値はすべて架空
import { describe, expect, it } from 'vitest';
import { formatMoney, formatPct, formatR, formatRate, formatYen } from '../../ui/src/lib/format';
import {
  type NumTier,
  numView,
  numViewOf,
  splitNumUnit,
  tierOf,
  UNIT_APART,
} from '../../ui/src/lib/num-tier';
import { forAll } from '../core/helpers/prng';

const TIERS: readonly NumTier[] = ['display', 'hero', 'title', 'row'];

describe('splitNumUnit: 表示の文字を数と単位に分ける', () => {
  it('R・%・円・通貨の 3 文字を単位にする（符号・桁区切り・小数は数の側）', () => {
    expect(splitNumUnit('−3.1R')).toEqual({ value: '−3.1', unit: 'R' });
    expect(splitNumUnit('+2.0R')).toEqual({ value: '+2.0', unit: 'R' });
    expect(splitNumUnit('±0.0R')).toEqual({ value: '±0.0', unit: 'R' });
    expect(splitNumUnit('57%')).toEqual({ value: '57', unit: '%' });
    expect(splitNumUnit('2.5%')).toEqual({ value: '2.5', unit: '%' });
    expect(splitNumUnit('−8,000円')).toEqual({ value: '−8,000', unit: '円' });
    expect(splitNumUnit('−50.00 USD')).toEqual({ value: '−50.00', unit: ' USD' });
  });

  it('E11: 単位で終わらない文字は分けない（「R なし」「損益なし」「リスクなし」）', () => {
    for (const t of ['R なし', '損益なし', 'リスクなし', '率なし', '—']) {
      expect(splitNumUnit(t)).toEqual({ value: t, unit: '' });
    }
  });
});

describe('numView: 段と単位の文法', () => {
  it('E1: 振り返りの規律コスト −3.1R は display の「−3.1」と別の塊の「R」', () => {
    expect(numView('−3.1R', 'display')).toEqual({ tier: 'display', value: '−3.1', unit: 'R' });
  });

  it('E2: 計画どおり率 57% は title の「57」と「%」', () => {
    expect(numView('57%', 'title')).toEqual({ tier: 'title', value: '57', unit: '%' });
  });

  it('E3: 崩れなし ±0.0R も display', () => {
    expect(numView('±0.0R', 'display')).toEqual({ tier: 'display', value: '±0.0', unit: 'R' });
  });

  it('E4: + で始まる値は display に出さず hero に下げる（ほかの段はそのまま）', () => {
    expect(numView('+0.5R', 'display')).toEqual({ tier: 'hero', value: '+0.5', unit: 'R' });
    expect(tierOf('display', '+0.5')).toBe('hero');
    expect(tierOf('hero', '+0.5')).toBe('hero');
    expect(tierOf('title', '+0.5')).toBe('title');
    expect(tierOf('row', '+0.5')).toBe('row');
    expect(tierOf('display', '−0.5')).toBe('display');
  });

  it('E5: 判定 A の +2.0R は hero（56px の段ではない）', () => {
    expect(numView('+2.0R', 'hero')).toEqual({ tier: 'hero', value: '+2.0', unit: 'R' });
  });

  it('E6・E9: row は数と単位が 1 つの塊（リスク・損益・行の R）', () => {
    expect(numView('2.5%', 'row')).toEqual({ tier: 'row', value: '2.5%', unit: null });
    expect(numView('−8,000円', 'row')).toEqual({ tier: 'row', value: '−8,000円', unit: null });
    expect(numView('−1.0R', 'row')).toEqual({ tier: 'row', value: '−1.0R', unit: null });
    expect(numView('−50.00 USD', 'row')).toEqual({ tier: 'row', value: '−50.00 USD', unit: null });
  });

  it('E8・E10: ホームの今月の規律と下の帯の R は title で単位を分ける', () => {
    expect(numView('63%', 'title')).toEqual({ tier: 'title', value: '63', unit: '%' });
    expect(numView('−1.2R', 'title')).toEqual({ tier: 'title', value: '−1.2', unit: 'R' });
    expect(numView('−1.6R', 'title')).toEqual({ tier: 'title', value: '−1.6', unit: 'R' });
  });

  it('E11: 単位の無い文字はどの段でも 1 つの塊', () => {
    for (const t of TIERS) expect(numView('R なし', t).unit).toBeNull();
  });

  it('単位を分ける段は display・hero・title だけ', () => {
    expect(UNIT_APART).toEqual({ display: true, hero: true, title: true, row: false });
  });

  it('numViewOf は分けた数と単位から同じ形を作る（ホームの今月の規律の形）', () => {
    expect(numViewOf('−0.6', 'R', 'title')).toEqual(numView('−0.6R', 'title'));
    expect(numViewOf('57', '%', 'row')).toEqual({ tier: 'row', value: '57%', unit: null });
  });

  it('性質: どの段・どの書き方でも、数 + 単位 = 元の文字（読み上げ・文字としての中身を変えない）。display は + で始まらない', () => {
    forAll(
      236,
      3000,
      (r) => {
        const x = (r.next() - 0.5) * 40 * (r.bool(0.2) ? 1000 : 1);
        const kind = r.int(0, 5);
        const text =
          kind === 0
            ? formatR(x)
            : kind === 1
              ? formatPct(Math.abs(x))
              : kind === 2
                ? formatRate(r.next())
                : kind === 3
                  ? formatYen(x * 1000)
                  : kind === 4
                    ? formatMoney(x * 10, r.pick(['USD', 'EUR', 'JPY']))
                    : formatR(r.bool(0.5) ? Number.NaN : x);
        return { text, tier: r.pick(TIERS) };
      },
      ({ text, tier }) => {
        const v = numView(text, tier);
        expect(v.value + (v.unit ?? '')).toBe(text);
        if (v.tier === 'display') expect(v.value.startsWith('+')).toBe(false);
        if (v.unit !== null) {
          expect(UNIT_APART[v.tier]).toBe(true);
          expect(['R', '%', '円'].includes(v.unit) || /^ [A-Z]{3}$/.test(v.unit)).toBe(true);
        }
        // 有限の値の書き方は必ず分けられる（単位の取りこぼしが無い）
        if (UNIT_APART[v.tier] && !text.includes('なし')) expect(v.unit).not.toBeNull();
      },
    );
  });
});
