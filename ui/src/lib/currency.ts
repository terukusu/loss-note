// 通貨と為替の見せ方・可否（#47 PR-2・R6・R7・U22〜U28・U31。設計書 C43・9.2）。DOM・通信に触れない純関数。
// 為替は「銘柄の価格の通貨 1 単位 = 口座の通貨でいくら」。価格の通貨が口座の通貨と同じなら 1 で固定し、欄を出さない。
// 価格の通貨が未設定（null）の銘柄は、口座の通貨と同じとみなさず、欄も出さない（F11。読み取りで足した銘柄に欄を出すと
// 30 秒の予算を崩すため）
import {
  type AccountRecord,
  accountIdOf,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_CURRENCY,
  type StoredTrade,
} from '../../../core/record';
import { formatNumber, groupDigits } from './format';

/** 欄の単位・文の中の通貨の書き方（JPY = 円、ほか = 3 文字） */
export function unitOf(currency: string): string {
  return currency === DEFAULT_CURRENCY ? '円' : currency;
}

/** 数の文字に口座の通貨の単位を付ける（JPY は空きなしの「150円」、ほかは「1.1 USD」。金額の表記と同じ。#47 PR-2 デザイン 7） */
export function withUnit(num: string, currency: string): string {
  return currency === DEFAULT_CURRENCY ? `${num}円` : `${num} ${currency}`;
}

/** 為替の欄を出すか（価格の通貨が決まっていて、口座の通貨と違うときだけ。F1・F8・F9・F11） */
export function fxFieldVisible(priceCurrency: string | null, accountCurrency: string): boolean {
  return priceCurrency !== null && priceCurrency !== accountCurrency;
}

/**
 * 銘柄の下の 1 行（U22）: 違う →「USD 建て」/ 未設定 →「価格の通貨 未設定」/ 同じ → 無し。
 * 未設定の 1 行は外貨の口座のときだけ出す（円の口座では、名前だけで足した銘柄のたびに出る雑音になるため。
 * J9 の直し・main の決定 2026-11-19）
 */
export function currencyHint(
  priceCurrency: string | null,
  accountCurrency: string,
): string | undefined {
  if (priceCurrency === null) {
    return accountCurrency === DEFAULT_CURRENCY ? undefined : '価格の通貨 未設定';
  }
  if (priceCurrency !== accountCurrency) return `${priceCurrency} 建て`;
  return undefined;
}

/** 逆算の為替の表示（有効 5 桁。150 → 150.00、1.1 → 1.1000、12345.6 → 12,346。整数部は 3 桁区切り（#40）。指数表記にしない） */
export function formatFxDerived(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '';
  if (x >= 1e5) return groupDigits(String(Math.round(x)));
  // toPrecision は丸めた後の桁で 5 桁にする（99.9996 → 100.00）。指数表記になる極端な値だけ小数の桁で書く
  const p = x.toPrecision(5);
  if (!/e/i.test(p)) return groupDigits(p);
  const digits = Math.max(0, 4 - Math.floor(Math.log10(x)));
  // 1e-5 未満のような極端な値は 10 桁までで止める（toFixed の上限より十分小さく）
  return x.toFixed(Math.min(digits, 10));
}

/**
 * 為替の欄の下の 1 行（U24）。逆算があれば入れた値より逆算の行を優先して残す（明細の値が正。F7・ux 2.1）。
 * 空・逆算なし「1 USD = ? 円（空でも記録できます）」/ 入れた「1 USD = 150円」/ 逆算「明細から 1 USD = 150.00円」
 */
export function fxLine(args: {
  readonly price: string;
  readonly account: string;
  readonly entered?: number;
  readonly derived?: number;
}): string {
  const a = args.account;
  if (args.derived !== undefined)
    return `明細から 1 ${args.price} = ${withUnit(formatFxDerived(args.derived), a)}`;
  if (args.entered !== undefined)
    return `1 ${args.price} = ${withUnit(formatNumber(args.entered), a)}`;
  return `1 ${args.price} = ${withUnit('?', a)}（空でも記録できます）`;
}

// 明細の読み取りの損益・手数料を入れるか・入れないときの理由は statement-account.ts の pnlFillOf（#66・R6。
// #47 PR-2 の R7「外貨の口座では入れない」・U28 の注記を置き換えた）

/** 編集の画面で通貨の違う口座へ替えたときの知らせ（U33。打ってあった為替も空にしたときは FX 付き） */
export const CURRENCY_CLEARED_NOTE = '通貨が違うので、損益と手数料を空に戻しました';
export const CURRENCY_FX_CLEARED_NOTE = '通貨が違うので、損益・手数料・為替を空に戻しました';

/** 取引のある口座の通貨の文字（U31） */
export function currencyLockedText(currency: string): string {
  return `通貨: ${currency}（取引があるので変更できません）`;
}

/** 取引のある口座の ID の集合（accountId の無い取引は既定の口座。U31） */
export function accountsInUse(trades: readonly Pick<StoredTrade, 'record'>[]): Set<string> {
  return new Set(trades.map((t) => accountIdOf(t.record)));
}

/** 口座の ID（空 = 既定の口座）の通貨（一覧に無ければ JPY） */
export function accountCurrencyIn(
  accounts: readonly Pick<AccountRecord, 'id' | 'currency'>[],
  accountId: string,
): string {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  return accounts.find((a) => a.id === id)?.currency || DEFAULT_CURRENCY;
}

/** 取引の欄の通貨と為替の見せ方（components/TradeFields.tsx の CurrencyView と同じ形） */
export interface CurrencyViewModel {
  readonly instrumentHint?: string;
  readonly fx?: { readonly unit: string; readonly line: string };
  readonly moneyUnit: string;
  readonly moneyNote?: string;
}

/**
 * 下書きの読み取り（readDraft の currency・プレビューの逆算の為替）→ 欄の見せ方（U22〜U24・U27）。
 * moneyNote は画面の状態（外貨の口座で明細を貼った・通貨の違う口座へ替えた）から画面が渡す
 */
export function currencyView(
  c: {
    readonly price: string | null;
    readonly account: string;
    readonly matched: boolean;
    readonly fxShown: boolean;
    readonly fxRate?: number;
  },
  derivedFx: number | undefined,
  moneyNote?: string,
): CurrencyViewModel {
  const hint = c.matched ? currencyHint(c.price, c.account) : undefined;
  return {
    ...(hint === undefined ? {} : { instrumentHint: hint }),
    ...(c.fxShown && c.price !== null
      ? {
          fx: {
            unit: unitOf(c.account),
            line: fxLine({
              price: c.price,
              account: c.account,
              ...(c.fxRate === undefined ? {} : { entered: c.fxRate }),
              ...(derivedFx === undefined ? {} : { derived: derivedFx }),
            }),
          },
        }
      : {}),
    moneyUnit: unitOf(c.account),
    ...(moneyNote === undefined ? {} : { moneyNote }),
  };
}
