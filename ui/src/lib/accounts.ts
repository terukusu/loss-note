// 口座の表示と入力の読み取り（Issue #47 PR-1。設計書 4.5・9.2・C41・ADR-0012。画面の決定 U1〜U21）。
// DOM・通信・現在時刻に触れない純関数。口座の並び（API と同じ）・記録する画面の口座の欄の形（無し / Segment / select）・
// 既定の口座（最後に記録した取引の口座）・判定の枠と保存の後の文・設定の口座の行の要約と、口座の下書き
// （設定の直す・足す欄、記録する画面の名前 + 資金の 2 欄）の検査。数の読み方・資金と許容リスクの規則は設定の画面と同じ
// （settings-form.ts の readCapital・readRisk・riskWarning・allowanceIn）。
// 口座の通貨（#47 PR-2）: 金額は口座の通貨で書き（formatAmount）、設定の欄に「通貨」（取引のある口座は文字。U30・U31）
import {
  type AccountBody,
  type AccountPut,
  type AccountRecord,
  accountIdOf,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
  DEFAULT_CURRENCY,
  type StoredTrade,
} from '../../../core/record';
import { formatAmount, formatPlain } from './format';
import { nameKey } from './instrument-name';
import { hasBadChar, lengthOf, NAME_MAX } from './record-form';
import {
  allowanceIn,
  type ReadResult,
  readAccountCurrency,
  readCapital,
  readRisk,
  riskWarning,
  SETTINGS_MSG,
} from './settings-form';

export const ACCOUNT_MSG = {
  nameRequired: '名前を入力してください',
  nameInvalid: SETTINGS_MSG.nameInvalid,
  duplicateName: '同じ名前の口座があります',
} as const;

/** 口座の名前が一覧に無いとき（取引が指す口座が読めなかった） */
export const UNKNOWN_ACCOUNT = '口座が見つかりません';
/** 送っている間の帯の文（U9） */
export const ACCOUNT_ADDING = '口座を追加しています';
/** 記録する画面の足す欄の資金の説明（3.2） */
export const NEW_ACCOUNT_CAPITAL_HINT =
  '資金は空欄でも追加できます。入力するとリスク（%）が表示されます';

/** 一覧の並び（API の account_sort_key と同じ: 名前の同一視の鍵 → 名前 → ID）。入力は変えない */
export function sortAccounts(list: readonly AccountRecord[]): AccountRecord[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...list].sort(
    (a, b) => cmp(nameKey(a.name), nameKey(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id),
  );
}

/** 記録する画面・直す画面の口座の欄の形（U1〜U3。P1 の規則: 2〜3 択は Segment・4 択以上は select） */
export type AccountChoiceKind = 'none' | 'segment' | 'select';

/** 名前の見た目の幅の目安（全角 = 2・半角 = 1。Segment の幅の割り振りにだけ使う） */
export function nameWidth(name: string): number {
  let w = 0;
  for (const ch of name) w += (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  return w;
}

/** 長い名前と見なす幅（全角 7 字ほど。360px の 3 等分の項目に ✓ と一緒に入らなくなる幅） */
export const LONG_NAME_WIDTH = 13;

/**
 * 口座の Segment で残りの幅を回す項目の位置（再レビュー 2・N2）。長い名前（LONG_NAME_WIDTH 以上）がちょうど 1 つで、
 * 2 番目に長い名前の 1.5 倍以上のときだけその位置を返す。ほかは null（等分。似た長さの名前で幅が偏らない）。
 * 選んでいる口座に依らない（選ぶたびに境目が動かない）
 */
export function segmentGrowIndex(names: readonly string[]): number | null {
  if (names.length < 2) return null;
  const widths = names.map(nameWidth);
  const sorted = [...widths].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  if (top < LONG_NAME_WIDTH || top < second * 1.5) return null;
  return widths.indexOf(top);
}

/** Segment の見出しの右の「選択中: 〈名前〉」（長い名前の口座があるときだけ。無ければ null） */
export function selectedNote(
  accounts: readonly Pick<AccountRecord, 'id' | 'name'>[],
  selectedId: string,
): string | null {
  if (!accounts.some((a) => nameWidth(a.name) >= LONG_NAME_WIDTH)) return null;
  const a = accounts.find((x) => x.id === selectedId);
  return a ? `選択中: ${a.name}` : null;
}

export function accountChoiceKind(n: number): AccountChoiceKind {
  if (n <= 1) return 'none';
  return n <= 3 ? 'segment' : 'select';
}

/** 口座が 2 つ以上か（口座の名前を出す・本文に accountId を入れる。KEEP-3） */
export function hasManyAccounts(accounts: readonly AccountRecord[]): boolean {
  return accounts.length >= 2;
}

/**
 * 記録する画面の既定の口座（R4・B3・B4）: 最後に記録した（作った時刻が最大の）取引の口座。取引が無い・その口座が
 * 一覧に無いときは既定の口座。並びに依らない
 */
export function defaultAccountId(
  trades: readonly Pick<StoredTrade, 'createdAt' | 'record'>[],
  accounts: readonly AccountRecord[],
): string {
  let last: Pick<StoredTrade, 'createdAt' | 'record'> | undefined;
  for (const t of trades) if (!last || t.createdAt > last.createdAt) last = t;
  if (!last) return DEFAULT_ACCOUNT_ID;
  const id = accountIdOf(last.record);
  return accounts.some((a) => a.id === id) ? id : DEFAULT_ACCOUNT_ID;
}

/** 下書きの口座（空 = 既定の口座。直す画面は元の取引の口座） */
export function selectedAccountId(draftAccountId: string, fallback = DEFAULT_ACCOUNT_ID): string {
  return draftAccountId === '' ? fallback : draftAccountId;
}

export function findAccount(
  id: string,
  accounts: readonly AccountRecord[],
): AccountRecord | undefined {
  return accounts.find((a) => a.id === id);
}

/** 口座の名前（一覧に無い既定の口座は「口座 1」、ほかは「口座が見つかりません」） */
export function accountNameOf(id: string, accounts: readonly AccountRecord[]): string {
  const a = findAccount(id, accounts);
  if (a) return a.name;
  return id === DEFAULT_ACCOUNT_ID ? DEFAULT_ACCOUNT_NAME : UNKNOWN_ACCOUNT;
}

/** 取引の口座の名前（accountId の無い取引は既定の口座。U18） */
export function tradeAccountName(
  t: Pick<StoredTrade, 'record'>,
  accounts: readonly AccountRecord[],
): string {
  return accountNameOf(accountIdOf(t.record), accounts);
}

/**
 * 判定の枠の 1 行（U10・U17。口座が 2 つ以上のときだけ画面が出す）。資金あり「口座 A の資金 1,000,000円 に対して」
 * （recorded = 詳細: 「口座 A の資金 1,000,000円（記録したとき）に対して」）、資金なし「口座 B（資金は未設定）」
 */
export function verdictAsideText(
  name: string,
  capitalYen: number | null,
  opts: { readonly recorded?: boolean; readonly currency?: string } = {},
): string {
  if (capitalYen === null) return `${name}（資金は未設定）`;
  const when = opts.recorded ? '（記録したとき）' : ' ';
  return `${name} の資金 ${formatAmount(capitalYen, opts.currency ?? DEFAULT_CURRENCY)}${when}に対して`;
}

/** 口座の通貨（API はいつも返す。古い応答・テストの口座で無ければ JPY） */
export function currencyOfAccount(a: { readonly currency?: string }): string {
  return a.currency || DEFAULT_CURRENCY;
}

/** 保存の後の知らせ（U11）: 口座が 2 つ以上なら「口座 A に記録しました」、1 つなら「記録しました」 */
export function savedText(count: number, name: string): string {
  return count >= 2 ? `${name} に記録しました` : '記録しました';
}

/** 直す画面で口座を替えたときの 1 行（U19。元の口座なら null） */
export function switchHint(account: AccountRecord | undefined, changed: boolean): string | null {
  if (!changed || !account) return null;
  if (account.capitalYen === null) {
    return `${account.name} は資金が未設定です。リスク（%）は表示されなくなります`;
  }
  return `${account.name} の今の資金 ${formatAmount(account.capitalYen, currencyOfAccount(account))} で再計算します`;
}

/**
 * 設定の口座の行の 2 行目（U12・U13・U30）: 「1,000,000円 · 許容 1%」/「10,000.00 USD · 許容 1%」/
 * 「資金 未設定 · 許容 1%」
 */
export function accountLine(
  a: Pick<AccountRecord, 'capitalYen' | 'riskTolerancePct'> & { readonly currency?: string },
): string {
  const risk = `許容 ${formatPlain(a.riskTolerancePct)}%`;
  return a.capitalYen === null
    ? `資金 未設定 · ${risk}`
    : `${formatAmount(a.capitalYen, currencyOfAccount(a))} · ${risk}`;
}

/**
 * 設定の口座の行の 3 行目: 「1 回の負けは 10,000円 まで」/「1 回の負けは 100.00 USD まで」/
 * 「資金を入れるとリスク（%）が出ます」
 */
export function accountAllowanceLine(
  a: Pick<AccountRecord, 'capitalYen' | 'riskTolerancePct'> & { readonly currency?: string },
): string {
  if (a.capitalYen === null) return '資金を入力するとリスク（%）が表示されます';
  const c = currencyOfAccount(a);
  return `1 回の負けは ${formatAmount(allowanceIn(a.capitalYen, a.riskTolerancePct, c), c)} まで`;
}

// ── 口座の下書き ─────────────────────────────

/** 設定の直す欄・足す欄（4 欄。文字は打ったまま。通貨は #47 PR-2） */
export interface AccountDraft {
  readonly name: string;
  readonly currency: string;
  readonly capital: string;
  readonly risk: string;
}

export type AccountField = keyof AccountDraft;

/** 欄の名前（画面の並びの順） */
export const ACCOUNT_FIELD_LABEL: Readonly<Record<AccountField, string>> = {
  name: '名前',
  currency: '通貨',
  capital: '資金',
  risk: '許容リスク',
};

export const EMPTY_ACCOUNT_DRAFT: AccountDraft = {
  name: '',
  currency: DEFAULT_CURRENCY,
  capital: '',
  risk: '1',
};

/** 欄の資金の単位（入れた通貨に追従。読めない通貨の間は今の口座の通貨か JPY。U30） */
export function draftCurrencyOf(draft: Pick<AccountDraft, 'currency'>, fallback: string): string {
  const c = readAccountCurrency(draft.currency);
  return c.ok ? c.value : fallback;
}

export interface AccountReading<B> {
  readonly errors: Readonly<Partial<Record<AccountField, string>>>;
  /** 2% を超える許容リスクの警告（保存はできる） */
  readonly warning: string | null;
  readonly body: B | null;
}

/** 保存値から直す欄の下書き（資金は 3 桁区切り、未設定は空。外貨は小数 2 桁） */
export function accountDraftOf(a: AccountRecord): AccountDraft {
  const currency = currencyOfAccount(a);
  return {
    name: a.name,
    currency,
    capital:
      a.capitalYen === null
        ? ''
        : formatAmount(a.capitalYen, currency).replace(/円$| [A-Z]{3}$/, ''),
    risk: formatPlain(a.riskTolerancePct),
  };
}

/** 名前: trim・1〜40 字・制御文字なし・自分以外の口座と同じ名前（nameKey）でない（API と同じ） */
export function readAccountName(
  raw: string,
  list: readonly AccountRecord[],
  selfId: string | null,
): ReadResult<string> {
  const name = raw.trim();
  if (name === '') return { ok: false, error: ACCOUNT_MSG.nameRequired };
  if (lengthOf(name) > NAME_MAX || hasBadChar(name)) {
    return { ok: false, error: ACCOUNT_MSG.nameInvalid };
  }
  const key = nameKey(name);
  if (list.some((a) => a.id !== selfId && nameKey(a.name) === key)) {
    return { ok: false, error: ACCOUNT_MSG.duplicateName };
  }
  return { ok: true, value: name };
}

/**
 * 設定の口座の下書きを読む。selfId = 直している口座（null = 足す）、savedCapital = 直す前の資金（設定済みなら空は誤り。
 * 足すときは null = 空でよい）。currencyLocked = 取引のある口座（通貨は欄でなく文字。本文に通貨を入れない = 今のまま。U31）。
 * savedCurrency = 直す前の通貨（固定のとき資金の検査に使う）
 */
export function readAccountDraft(
  draft: AccountDraft,
  list: readonly AccountRecord[],
  selfId: string | null,
  savedCapital: number | null,
  opts: { readonly currencyLocked?: boolean; readonly savedCurrency?: string } = {},
): AccountReading<AccountPut> {
  const errors: Partial<Record<AccountField, string>> = {};
  const name = readAccountName(draft.name, list, selfId);
  if (!name.ok) errors.name = name.error;
  const locked = opts.currencyLocked === true;
  const currency: ReadResult<string> = locked
    ? { ok: true, value: opts.savedCurrency ?? DEFAULT_CURRENCY }
    : readAccountCurrency(draft.currency);
  if (!currency.ok) errors.currency = currency.error;
  // 資金の検査は通貨で変わる（JPY = 整数・外貨 = 小数 2 桁まで）。通貨が読めない間は今の通貨か JPY で見る
  const capital = readCapital(
    draft.capital,
    savedCapital,
    currency.ok ? currency.value : (opts.savedCurrency ?? DEFAULT_CURRENCY),
  );
  if (!capital.ok) errors.capital = capital.error;
  const risk = readRisk(draft.risk);
  if (!risk.ok) errors.risk = risk.error;
  const warning = risk.ok ? riskWarning(risk.value) : null;
  if (!name.ok || !currency.ok || !capital.ok || !risk.ok) return { errors, warning, body: null };
  return {
    errors,
    warning,
    body: {
      name: name.value,
      ...(locked ? {} : { currency: currency.value }),
      capitalYen: capital.value,
      riskTolerancePct: risk.value,
    },
  };
}

/** 記録する画面のその場で足す 2 欄（名前・資金（任意）。B5） */
export interface NewAccountDraft {
  readonly name: string;
  readonly capital: string;
}

export const EMPTY_NEW_ACCOUNT: NewAccountDraft = { name: '', capital: '' };

/** その場で足す口座の本文（名前と、入れたときだけ資金。許容リスクは API の既定 1） */
export function readNewAccountDraft(
  draft: NewAccountDraft,
  list: readonly AccountRecord[],
): AccountReading<AccountBody> {
  const errors: Partial<Record<AccountField, string>> = {};
  const name = readAccountName(draft.name, list, null);
  if (!name.ok) errors.name = name.error;
  const capital = readCapital(draft.capital, null);
  if (!capital.ok) errors.capital = capital.error;
  if (!name.ok || !capital.ok) return { errors, warning: null, body: null };
  return {
    errors,
    warning: null,
    body: { name: name.value, ...(capital.value === null ? {} : { capitalYen: capital.value }) },
  };
}
