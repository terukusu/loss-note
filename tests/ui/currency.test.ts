// 通貨と為替の見せ方・可否の純関数（#47 PR-2・U22〜U24・U28・U31・R6・R7）。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  accountCurrencyIn,
  accountsInUse,
  CURRENCY_CLEARED_NOTE,
  currencyHint,
  currencyLockedText,
  currencyView,
  formatFxDerived,
  fxFieldVisible,
  fxLine,
  unitOf,
} from '../../ui/src/lib/currency';
import { CURRENCY_UNREAD_NOTE } from '../../ui/src/lib/statement-account';
import { forAll } from '../core/helpers/prng';
import { ACC_A, ACC_D } from './helpers/currency-examples';

describe('為替の欄を出すか（AC-15・U23）', () => {
  it.each([
    ['F1: JPY の口座 × USD 建て', 'USD', 'JPY', true],
    ['F8: JPY の口座 × 円建て', 'JPY', 'JPY', false],
    ['F9: USD の口座 × USD 建て', 'USD', 'USD', false],
    ['F10: USD の口座 × EUR 建て', 'EUR', 'USD', true],
    ['F11: 価格の通貨 未設定', null, 'JPY', false],
    ['F11: 価格の通貨 未設定（USD の口座）', null, 'USD', false],
  ] as const)('%s → %s', (_name, price, account, shown) => {
    expect(fxFieldVisible(price, account)).toBe(shown);
  });
});

describe('銘柄の下の 1 行（U22）', () => {
  it('違えば「USD 建て」、未設定なら「価格の通貨 未設定」、同じなら無し', () => {
    expect(currencyHint('USD', 'JPY')).toBe('USD 建て');
    expect(currencyHint('EUR', 'USD')).toBe('EUR 建て');
    // 未設定の 1 行は外貨の口座のときだけ（J9 の直し）。円の口座では出さない
    expect(currencyHint(null, 'JPY')).toBeUndefined();
    expect(currencyHint(null, 'USD')).toBe('価格の通貨 未設定');
    expect(currencyHint('JPY', 'JPY')).toBeUndefined();
    expect(currencyHint('USD', 'USD')).toBeUndefined();
  });
});

describe('為替の欄の下の 1 行（U24・AC-14）', () => {
  it('空・入れた・逆算（逆算は入れた値より優先）', () => {
    expect(fxLine({ price: 'USD', account: 'JPY' })).toBe('1 USD = ?円（空でも記録できます）');
    expect(fxLine({ price: 'USD', account: 'JPY', entered: 150 })).toBe('1 USD = 150円');
    expect(fxLine({ price: 'USD', account: 'JPY', derived: 150 })).toBe(
      '明細から 1 USD = 150.00円',
    );
    expect(fxLine({ price: 'USD', account: 'JPY', entered: 149, derived: 150 })).toBe(
      '明細から 1 USD = 150.00円',
    );
    expect(fxLine({ price: 'EUR', account: 'USD' })).toBe('1 EUR = ? USD（空でも記録できます）');
    expect(fxLine({ price: 'EUR', account: 'USD', entered: 1.1 })).toBe('1 EUR = 1.1 USD');
  });

  it('逆算の為替は有効 5 桁（指数表記にしない）', () => {
    expect(formatFxDerived(150)).toBe('150.00');
    expect(formatFxDerived(1.1)).toBe('1.1000');
    expect(formatFxDerived(0.0067)).toBe('0.0067000');
    expect(formatFxDerived(12345.6)).toBe('12346');
    expect(formatFxDerived(1234567)).toBe('1234567');
    expect(formatFxDerived(0)).toBe('');
    expect(formatFxDerived(Number.NaN)).toBe('');
  });

  it('性質: 正の有限の数なら指数表記にならず、読み直すと有効 5 桁の誤差の内', () => {
    forAll(
      471,
      1_000,
      (r) => r.int(1, 9_999_999) / 10 ** r.int(0, 8),
      (x) => {
        const s = formatFxDerived(x);
        if (/e/i.test(s)) throw new Error(`指数表記 ${s}`);
        const back = Number(s);
        const tol = x >= 1e5 ? 0.5 : x * 1e-4;
        if (!(Math.abs(back - x) <= tol)) throw new Error(`${x} → ${s}`);
      },
    );
  });
});

describe('単位・明細の流し込み・知らせの文言', () => {
  it('単位: JPY = 円、ほか = 3 文字', () => {
    expect(unitOf('JPY')).toBe('円');
    expect(unitOf('USD')).toBe('USD');
  });
  it('U31・U33 の文言', () => {
    expect(currencyLockedText('USD')).toBe('通貨: USD（取引があるので変更できません）');
    expect(CURRENCY_CLEARED_NOTE).toBe('通貨が違うので、損益と手数料を空に戻しました');
  });
});

describe('口座の通貨・取引のある口座', () => {
  it('accountCurrencyIn: 空 = 既定の口座。一覧に無ければ JPY', () => {
    const accounts = [ACC_A, ACC_D];
    expect(accountCurrencyIn(accounts, 'accD')).toBe('USD');
    expect(accountCurrencyIn(accounts, '')).toBe('JPY');
    expect(accountCurrencyIn(accounts, 'nothing')).toBe('JPY');
  });
  it('accountsInUse: accountId の無い取引は既定の口座', () => {
    const t = (accountId?: string) =>
      ({
        record: accountId === undefined ? {} : { accountId },
      }) as unknown as Pick<StoredTrade, 'record'>;
    expect([...accountsInUse([t(), t('accD'), t('accD')])].sort()).toEqual(['accD', 'default']);
    expect(accountsInUse([]).size).toBe(0);
  });
});

describe('currencyView（取引の欄の見せ方）', () => {
  it('円の口座・円建て: 価格の通貨・為替の欄は無く、単位は円（KEEP-3）', () => {
    expect(
      currencyView({ price: 'JPY', account: 'JPY', matched: true, fxShown: false }, undefined),
    ).toEqual({ moneyUnit: '円' });
  });
  it('JPY の口座 × USD 建て: 「USD 建て」・為替の欄（単位 円）・空の 1 行', () => {
    expect(
      currencyView({ price: 'USD', account: 'JPY', matched: true, fxShown: true }, undefined),
    ).toEqual({
      instrumentHint: 'USD 建て',
      fx: { unit: '円', line: '1 USD = ?円（空でも記録できます）' },
      moneyUnit: '円',
    });
  });
  it('一覧に無い名前を打っている間は価格の通貨を出さない。注記を渡せば出す', () => {
    const v = currencyView(
      { price: null, account: 'USD', matched: false, fxShown: false },
      undefined,
      CURRENCY_UNREAD_NOTE,
    );
    expect(v).toEqual({ moneyUnit: 'USD', moneyNote: CURRENCY_UNREAD_NOTE });
  });
});
