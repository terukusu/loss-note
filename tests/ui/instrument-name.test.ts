// 銘柄の名前の同一視（Issue #13 AC-8・契約 R-2）。API の name_key（NFKC → casefold → 前後の空白を除く）と同じ例の表
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { findInstrument, nameKey } from '../../ui/src/lib/instrument-name';

function inst(id: string, name: string): InstrumentRecord {
  return {
    id,
    name,
    underlyingKind: 'other',
    productForm: 'spotCfd',
    priceCurrency: null,
    multiplier: 1,
    quantityStep: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('nameKey', () => {
  it('API の test_name_key_normalizes と同じ例（前後の空白・小文字・全角）', () => {
    expect(nameKey(' US30 ')).toBe(nameKey('us30'));
    expect(nameKey('us30')).toBe(nameKey('ＵＳ３０'));
  });

  it.each([
    ['US30', 'ｕｓ３０ '],
    ['US30', 'Us30'],
    ['STRASSE', 'straße'],
    ['架空指数A', '架空指数Ａ'],
  ])('%s と %s は同じ名前', (a, b) => {
    expect(nameKey(a)).toBe(nameKey(b));
  });

  it('違う名前は違う', () => {
    expect(nameKey('US30')).not.toBe(nameKey('US300'));
    expect(nameKey('架空指数A')).not.toBe(nameKey('架空指数B'));
  });
});

describe('findInstrument', () => {
  const list = [inst('i-us30', 'US30'), inst('i-x', '架空指数B')];
  it('全角・大文字小文字・前後の空白だけの違いなら一覧の銘柄', () => {
    expect(findInstrument('ｕｓ３０ ', list)?.id).toBe('i-us30');
  });
  it('一覧に無ければ undefined。空の名前も undefined', () => {
    expect(findInstrument('架空指数A', list)).toBeUndefined();
    expect(findInstrument('  ', list)).toBeUndefined();
  });
});
