// 決済明細の読み取りから口座を選ぶ・損益を口座の通貨で入れる規則（Issue #66 の R3・R4・R6。設計書 7.5・C45）。
// DOM・通信・今の時刻・保存先に触れない純関数。
// - 明細の特徴の覚え（API の応答の profile = {key, accountId}）は形を確かめてから使う。鍵は API が会社の名前から作った
//   16 進 32 文字で、画面は会社の名前を持たない
// - 提案の口座は、口座が 2 つ以上・提案の口座が今の一覧にある・その明細で本人がまだ口座を選んでいない、のときだけ
// - 損益・手数料は、読んだ通貨が口座の通貨と同じとき、または口座が JPY で通貨が読めなかったときだけ欄に入れる
import { DEFAULT_ACCOUNT_ID, DEFAULT_CURRENCY } from '../../../core/record';

/** 明細の特徴の鍵の形（API の statement_profile.KEY_PATTERN と同じ） */
const KEY = /^[0-9a-f]{32}$/;
/** 口座の ID の形（API の schema.ID_PATTERN と同じ） */
const ID = /^[A-Za-z0-9]{1,40}$/;
/** 読み取りの通貨の形（英字 3 文字。ほかは「不明」） */
const CURRENCY = /^[A-Z]{3}$/;
export const UNKNOWN_CURRENCY = 'unknown';

/** 読み取りの応答の明細の特徴（鍵と、その鍵で前に記録した口座。覚えが無ければ null） */
export interface StatementProfile {
  readonly key: string;
  readonly accountId: string | null;
}

/** 応答の profile → 明細の特徴。形が外れていれば null（提案も覚えもしない） */
export function parseProfile(v: unknown): StatementProfile | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const { key, accountId } = v as Record<string, unknown>;
  if (typeof key !== 'string' || !KEY.test(key)) return null;
  const id = typeof accountId === 'string' && ID.test(accountId) ? accountId : null;
  return { key, accountId: id };
}

/** 覚える入口の道（鍵の形は確かめてある前提。外れていれば undefined） */
export function profilePath(key: string): string | undefined {
  return KEY.test(key) ? `/api/statement-profiles/${key}` : undefined;
}

/**
 * 提案の口座（R3・R4）。口座が 1 つ以下・本人がこの明細で口座を選んだ（touched）・覚えが無い・覚えの口座が今の
 * 一覧に無い → undefined（既定は #47 R4 の前回の口座のまま）
 */
export function suggestedAccount(
  profile: StatementProfile | null | undefined,
  accounts: readonly { readonly id: string }[],
  touched: boolean,
): string | undefined {
  if (touched || accounts.length < 2 || !profile || profile.accountId === null) return undefined;
  const id = profile.accountId;
  return accounts.some((a) => a.id === id) ? id : undefined;
}

/** 応答の通貨 → 英字 3 文字か「不明」 */
export function currencyOf(v: unknown): string {
  return typeof v === 'string' && CURRENCY.test(v) ? v : UNKNOWN_CURRENCY;
}

/** 損益・手数料の流し込みの判断（R6）。fills = 欄に入れる。入れないときは欄の脇の理由（次の行動つき） */
export interface PnlFill {
  readonly fills: boolean;
  readonly note?: string;
}

/** 損益を打つときの単位の書き方（JPY = 「円」、ほか = 「USD 」） */
const moneyWord = (currency: string): string =>
  currency === DEFAULT_CURRENCY ? '円' : `${currency} `;

/**
 * 行の通貨と口座の通貨 → 入れるか（C1〜C6）。通貨 = 口座の通貨 → 入れる / 口座が JPY で通貨が不明 → 銘柄の価格の通貨が
 * JPY か未設定（null・undefined）のときだけ入れる（今と同じ。価格の通貨が USD などと決まっている銘柄は、USD の損益を円
 * として入れうるので入れない。#66 のレビュー P3）/ それ以外 → 入れず、理由（accountName は文に出す口座の名前）
 */
export function pnlFillOf(
  pnlCurrency: string,
  accountCurrency: string,
  accountName: string,
  priceCurrency?: string | null,
): PnlFill {
  const account = accountCurrency || DEFAULT_CURRENCY;
  if (pnlCurrency === account) return { fills: true };
  if (pnlCurrency === UNKNOWN_CURRENCY) {
    const priceIsYenOrUnset =
      priceCurrency === undefined || priceCurrency === null || priceCurrency === DEFAULT_CURRENCY;
    if (account === DEFAULT_CURRENCY && priceIsYenOrUnset) return { fills: true };
    return { fills: false, note: currencyUnreadNote(account) };
  }
  return { fills: false, note: currencyMismatchNote(pnlCurrency, accountName, account) };
}

/** C6 ほか: 通貨が読めず入れなかった（次の行動つき） */
export function currencyUnreadNote(accountCurrency: string): string {
  return `${CURRENCY_UNREAD_NOTE}。${moneyWord(accountCurrency)}の損益を入力してください`;
}

/** C6 の事実の部分 */
export const CURRENCY_UNREAD_NOTE = '明細の損益の通貨が読めませんでした';

/**
 * C3・C5（次の行動つき）:「明細の損益は USD です（口座 A は JPY）。USD の口座を選ぶか、円の損益を入力してください」
 */
export function currencyMismatchNote(
  pnlCurrency: string,
  accountName: string,
  accountCurrency: string,
): string {
  return `明細の損益は ${pnlCurrency} です（${accountName} は ${accountCurrency}）。${pnlCurrency} の口座を選ぶか、${moneyWord(accountCurrency)}の損益を入力してください`;
}

/** 覚えの無い明細のときの口座の欄の下の 1 行（デザイン 1。本人が口座を選んだら消す） */
export const CHOOSE_ACCOUNT_HINT = 'この明細の口座を選んでください。次から自動で選びます';
/** 自動で選んだ口座の印の読み上げの説明（デザイン 2） */
export const AUTO_ACCOUNT_DESC =
  '前にこの明細で選んだ口座を自動で選びました。違うときは変更してください';

/** 記録の後の 1 行（デザイン 5。覚えが無かった・覚えと違う口座で記録したときだけ。送信の失敗は知らせないので弱い言い方） */
export function learnedText(accountName: string): string {
  return `次からこの明細は ${accountName} を自動で選ぶようにしました`;
}

/**
 * 口座の欄の下の 1 行（デザイン 1・3b・4。口座 2 つ以上・明細の行があるときだけ）。損益の通貨が今の口座と合わず、
 * その通貨の口座が一覧にあれば「明細は USD です。USD の口座は 口座 D です」を優先、無ければ覚えの無い明細のとき
 * 「この明細の口座を選んでください。次から自動で選びます」。どちらも無ければ undefined
 */
export function accountHintOf(args: {
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly currency?: string;
  }[];
  readonly accountId: string;
  readonly pnlCurrency: string | undefined;
  readonly firstTime: boolean;
}): string | undefined {
  const { accounts, accountId, pnlCurrency } = args;
  if (accounts.length < 2) return undefined;
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const current = accounts.find((a) => a.id === id);
  const currentCurrency = current?.currency || DEFAULT_CURRENCY;
  if (
    pnlCurrency !== undefined &&
    pnlCurrency !== UNKNOWN_CURRENCY &&
    pnlCurrency !== currentCurrency
  ) {
    const same = accounts.filter((a) => (a.currency || DEFAULT_CURRENCY) === pnlCurrency);
    if (same.length > 0) {
      return `明細は ${pnlCurrency} です。${pnlCurrency} の口座は ${same.map((a) => a.name).join('・')} です`;
    }
  }
  return args.firstTime ? CHOOSE_ACCOUNT_HINT : undefined;
}

/** 覚える口座の ID（空 = 既定の口座） */
export function learnedAccountId(accountId: string | undefined): string {
  return accountId || DEFAULT_ACCOUNT_ID;
}
