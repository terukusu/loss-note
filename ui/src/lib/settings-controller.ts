// 設定の画面の通信と状態（Issue #5 契約・#47 PR-1）。DOM を持たず、画面（pages/Settings.tsx）は購読して描くだけ。
// - 開いたら口座と銘柄を並行に読む（GET /api/accounts は既定の口座が無ければ設定から 1 回だけ作る = 移し替え。#47）。
//   設定（/api/settings）は読まない・送らない（資金・許容リスクは口座に移した。performanceUnit を書き換えない。KEEP-6）
// - 口座（#47 U12〜U15）: 一覧・1 件だけ開く直す（名前・資金・許容リスク。PUT /api/accounts/<id>）・足す
//   （POST /api/accounts）。口座の枠で同時に開けるのは 1 つ（直す欄か足す欄）
// - 銘柄は 1 件ずつ開いて 7 欄を直し [保存]（PUT /api/instruments/<id>）、名前だけで [足す]（POST。既定は API が埋める。C21）
// - 画面（#133）: 口座の直す欄・足す欄（account）、銘柄の直す欄（editing）、銘柄の足す欄（addOpen）は、それぞれ下のシートで、
//   状態が開いている間だけシートが開く。足せた・保存できたら閉じる。閉じ方の force は、戻る・close watcher でシート（dialog）が
//   先に閉じたときに、保存中でも状態を閉じる（シートと状態を食い違わせない。保存の結果は一覧の知らせに出る）
// - 誤りのある下書きは送らない。実行中は同じ Promise を返す（二重に送らない）
// - 失敗は決まった文言だけを状態に置く（応答の本文・例外の文字列を持たない）。401・ログインしていない = ログインが切れた
// - 足す要求が時間切れ・通信の失敗になったときは届いた可能性がある。次に押して 409 なら、届いていたものとして一覧を取り直す
// - 状態は記憶の中だけ（端末の保存先に書かない）
// - 口座の通貨（#47 PR-2・U30・U31）: 開いたときは取引を読まない。直す欄で通貨を今と違う値にしたときだけ、取引の一覧
//   （GET /api/trades）を 1 回読んで取引のある口座を知り、その口座なら通貨を元に戻して文字にし（本文に通貨を入れない =
//   今のまま）知らせる。読めなければ欄のままにし、守りは API の 409 currencyLocked（その口座を取引のある口座に入れ、
//   下書きの通貨を元に戻して知らせる）
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import {
  ACCOUNT_FIELD_LABEL,
  ACCOUNT_MSG,
  type AccountDraft,
  type AccountField,
  type AccountReading,
  accountDraftOf,
  currencyOfAccount,
  EMPTY_ACCOUNT_DRAFT,
  readAccountDraft,
  sortAccounts,
} from './accounts';
import { accountsInUse, currencyLockedText } from './currency';
import { nameKey } from './instrument-name';
import {
  type ApiFn,
  AUTH_EXPIRED,
  createRequest,
  Failed,
  type FailureKind,
  getJson,
  JSON_HEADERS,
  kindOf,
  REQUEST_TIMEOUT_MS,
} from './request';
import {
  EMPTY_INSTRUMENT_READING,
  errorFieldsOf,
  errorFieldsText,
  INSTRUMENT_FIELD_LABEL,
  type InstrumentDraft,
  type InstrumentField,
  type InstrumentReading,
  instrumentDraftOf,
  readAccountCurrency,
  readInstrumentDraft,
  readNewInstrumentName,
  SETTINGS_MSG,
  sortInstruments,
} from './settings-form';

export const SETTINGS_LOAD_FAILED =
  '設定を読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const SETTINGS_SAVE_FAILED =
  '保存できませんでした。入力内容は残っています。もう一度 [保存] を押してください。';
export const SETTINGS_NETWORK_FAILED =
  '通信できませんでした。入力内容は残っています。もう一度 [保存] を押してください（二重には保存されません）。';
export const ADD_FAILED = '追加できませんでした。もう一度 [追加] を押してください。';
export const ADD_NETWORK_FAILED =
  '通信できませんでした。もう一度 [追加] を押してください（二重には追加されません）。';
export const INSTRUMENT_NOT_FOUND = 'この銘柄は見つかりません。再読み込みしてください。';
export const ACCOUNT_NOT_FOUND = 'この口座は見つかりません。再読み込みしてください。';
export const ACCOUNT_ADD_NETWORK_FAILED =
  '通信できませんでした。もう一度 [追加] を押してください（二重には追加されません）。';
export const instrumentSaved = (name: string) =>
  `${name} を保存しました。これから記録する取引に反映されます。`;
export const instrumentAdded = (name: string) => `${name} を追加しました。`;
export const accountSaved = (name: string) =>
  `${name} を保存しました。これから記録する取引に反映されます。`;
export const accountAdded = (name: string) => `${name} を追加しました。`;

export type SettingsPhase = 'loading' | 'loadFailed' | 'ready';

/** 知らせ（どのカードに出すか・成功か失敗か） */
export interface SettingsNotice {
  readonly area: 'accounts' | 'instruments';
  readonly kind: 'ok' | 'error';
  readonly text: string;
  /** ログインが切れた（[ログインし直す] を出す） */
  readonly auth?: true;
}

export interface EditingInstrument {
  readonly id: string;
  readonly draft: InstrumentDraft;
  readonly reading: InstrumentReading;
  readonly saving: boolean;
}

/** 口座の直す欄・足す欄（id = null は足す欄） */
export interface EditingAccount {
  readonly id: string | null;
  readonly draft: AccountDraft;
  readonly reading: AccountReading<unknown>;
  readonly saving: boolean;
}

export interface SettingsState {
  readonly phase: SettingsPhase;
  /** 読み込みの失敗の文言 */
  readonly error: string | null;
  readonly errorKind?: FailureKind;
  /** 口座（名前の順。#47） */
  readonly accounts: readonly AccountRecord[];
  /** 開いている口座の直す欄・足す欄（口座の枠で 1 つだけ） */
  readonly account: EditingAccount | null;
  /** いま足した口座の ID（フォーカスを新しい行の [直す] へ移す。U15） */
  readonly addedAccountId: string | null;
  /** 取引のある口座の ID（通貨を変えられない。null = まだ読んでいない・読めなかった（守りは API の 409）。U31） */
  readonly accountsInUse: ReadonlySet<string> | null;
  /** 銘柄（名前の順） */
  readonly instruments: readonly InstrumentRecord[];
  readonly editing: EditingInstrument | null;
  readonly newName: string;
  readonly newNameError: string | null;
  readonly adding: boolean;
  /** 銘柄の足す欄（下のシート）を開いている（#133） */
  readonly addOpen: boolean;
  /**
   * 口座・銘柄の保存の要求が実行中（シートを先に閉じた後も。#133 レビュー N1）。この間は別の行を開かない
   * （開くと、その ［保存］ が実行中の要求に吸われて送られず、入力が黙って消える）
   */
  readonly accountSaving: boolean;
  readonly instrumentSaving: boolean;
  readonly notice: SettingsNotice | null;
}

export interface SettingsController {
  getState(): SettingsState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: SettingsState) => void): () => void;
  load(): Promise<void>;
  /** 口座の [直す]（id）・[＋ 口座を足す]（null）。別の欄を開くと前の下書きは捨てる */
  openAccount(id: string | null): void;
  /** force = 保存中でも閉じる（シートが先に閉じたとき。#133） */
  closeAccount(force?: boolean): void;
  updateAccount(field: AccountField, value: string): void;
  /** 直す欄なら PUT、足す欄なら POST */
  saveAccount(): Promise<void>;
  /** 通貨を変える操作の取引の確かめが終わるまで待つ（テスト用） */
  settled(): Promise<void>;
  /** 1 件だけ開く（別の行を開くと前の下書きは捨てる） */
  openInstrument(id: string): void;
  closeInstrument(force?: boolean): void;
  updateInstrument<K extends InstrumentField>(field: K, value: InstrumentDraft[K]): void;
  saveInstrument(): Promise<void>;
  setNewName(value: string): void;
  addInstrument(): Promise<void>;
  /** 銘柄の足す欄（下のシート）を開く・閉じる（#133）。開くと名前は空から */
  openAddInstrument(): void;
  closeAddInstrument(force?: boolean): void;
}

const EMPTY_ACCOUNT_READING: AccountReading<unknown> = { errors: {}, warning: null, body: null };

function saveMessage(kind: FailureKind): Pick<SettingsNotice, 'text' | 'auth'> {
  if (kind === 'auth') return { text: AUTH_EXPIRED, auth: true };
  return { text: kind === 'network' ? SETTINGS_NETWORK_FAILED : SETTINGS_SAVE_FAILED };
}

function isAccount(v: unknown): v is AccountRecord {
  const a = v as AccountRecord | null;
  return (
    a !== null &&
    typeof a === 'object' &&
    typeof a.id === 'string' &&
    typeof a.name === 'string' &&
    typeof a.riskTolerancePct === 'number' &&
    (a.capitalYen === null || typeof a.capitalYen === 'number') &&
    Array.isArray(a.capitalHistory)
  );
}

/** 通貨を変えられない口座か（取引があると分かった口座。まだ読んでいない = null は欄のまま。U31） */
export function currencyLocked(inUse: ReadonlySet<string> | null, id: string): boolean {
  return inUse?.has(id) ?? false;
}

export function createSettingsController(deps: {
  readonly api: ApiFn;
  readonly timeoutMs?: number;
}): SettingsController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: SettingsState) => void>();
  let state: SettingsState = {
    phase: 'loading',
    error: null,
    accounts: [],
    account: null,
    addedAccountId: null,
    accountsInUse: null,
    instruments: [],
    editing: null,
    newName: '',
    newNameError: null,
    adding: false,
    addOpen: false,
    accountSaving: false,
    instrumentSaving: false,
    notice: null,
  };
  let savingAccount: Promise<void> | null = null;
  let savingInstrument: Promise<void> | null = null;
  let adding: Promise<void> | null = null;
  /** [足す] を押した（空の名前の誤りを出す） */
  let addTried = false;
  /** 届いたか分からない足す要求の名前の鍵（時間切れ・通信の失敗の後） */
  let uncertainAdd: string | null = null;
  /** API が 409 を返した名前の鍵（直している銘柄） */
  let nameTaken: string | null = null;
  /** 口座: [保存] / [足す] を押した（空の名前の誤りを出す）・409 の名前の鍵・届いたか分からない足す要求の名前の鍵 */
  let accountTried = false;
  let accountTaken: string | null = null;
  let uncertainAccount: string | null = null;

  /** 口座の欄の読み取り（直す欄は直す前の資金で「未設定に戻せない」を見る。足す欄は資金の空 = 未設定） */
  const readAccount = (
    ed: EditingAccount,
    accounts: readonly AccountRecord[],
    inUse: ReadonlySet<string> | null,
  ): AccountReading<unknown> => {
    const rec = ed.id === null ? undefined : accounts.find((a) => a.id === ed.id);
    const saved = rec?.capitalYen ?? null;
    const r = readAccountDraft(ed.draft, accounts, ed.id, saved, {
      currencyLocked: ed.id !== null && currencyLocked(inUse, ed.id),
      ...(rec ? { savedCurrency: currencyOfAccount(rec) } : {}),
    });
    const errors: Partial<Record<AccountField, string>> = { ...r.errors };
    // 足す欄の名前が空の誤りは [足す] を押した後だけ（開いた直後に赤くしない）
    if (errors.name === ACCOUNT_MSG.nameRequired && !accountTried && ed.id === null) {
      delete errors.name;
    }
    if (!errors.name && accountTaken !== null && nameKey(ed.draft.name) === accountTaken) {
      errors.name = ACCOUNT_MSG.duplicateName;
    }
    return { ...r, errors, body: r.body !== null && !errors.name ? r.body : null };
  };

  /** 状態を更新し、下書きの読み取りを作り直して知らせる */
  const set = (patch: Partial<SettingsState>) => {
    const next = { ...state, ...patch };
    const account = next.account
      ? {
          ...next.account,
          reading: readAccount(next.account, next.accounts, next.accountsInUse),
        }
      : null;
    let editing = next.editing;
    if (editing) {
      let r = readInstrumentDraft(editing.draft, next.instruments, editing.id);
      if (nameTaken !== null && !r.errors.name && nameKey(editing.draft.name) === nameTaken) {
        r = { errors: { ...r.errors, name: SETTINGS_MSG.duplicateName }, body: null };
      }
      editing = { ...editing, reading: r };
    }
    const named = next.newName.trim() !== '' || addTried;
    const nn = readNewInstrumentName(next.newName, next.instruments);
    const { errorKind, ...rest } = next;
    state = {
      ...rest,
      ...(rest.error === null || errorKind === undefined ? {} : { errorKind }),
      account,
      editing,
      newNameError: named && !nn.ok ? nn.error : null,
    };
    for (const fn of listeners) fn(state);
  };

  const listInstruments = async (): Promise<InstrumentRecord[]> => {
    const i = await getJson<{ items: InstrumentRecord[] }>(await request('/api/instruments'), 200);
    if (!Array.isArray(i.items)) throw new Failed('other');
    return sortInstruments(i.items);
  };

  const listAccounts = async (): Promise<AccountRecord[]> => {
    const a = await getJson<{ items: unknown[] }>(await request('/api/accounts'), 200);
    if (!Array.isArray(a.items) || !a.items.every(isAccount)) throw new Failed('other');
    return sortAccounts(a.items);
  };

  /** 取引のある口座（読めなければ null。守りは API の 409） */
  const listInUse = async (): Promise<ReadonlySet<string> | null> => {
    try {
      const t = await getJson<{ items: StoredTrade[] }>(await request('/api/trades'), 200);
      return Array.isArray(t.items) ? accountsInUse(t.items) : null;
    } catch {
      return null;
    }
  };
  /** 通貨を変える操作の最初の 1 回だけ取引を読む（同時に何度呼んでも 1 回） */
  let inUseLoad: Promise<void> | null = null;
  const checkInUse = () => {
    if (inUseLoad || state.accountsInUse !== null) return inUseLoad ?? Promise.resolve();
    inUseLoad = listInUse().then((inUse) => {
      inUseLoad = null;
      if (inUse === null) return;
      const cur = state.account;
      // いま直している口座に取引があれば、通貨を元に戻して文字にし、知らせる
      if (cur && cur.id !== null && inUse.has(cur.id)) {
        const rec = state.accounts.find((a) => a.id === cur.id);
        const currency = rec ? currencyOfAccount(rec) : cur.draft.currency;
        set({
          accountsInUse: inUse,
          account: { ...cur, draft: { ...cur.draft, currency } },
          notice: { area: 'accounts', kind: 'error', text: currencyLockedText(currency) },
        });
        return;
      }
      set({ accountsInUse: inUse });
    });
    return inUseLoad;
  };

  const load = async () => {
    set({
      phase: 'loading',
      error: null,
      notice: null,
      editing: null,
      account: null,
      addedAccountId: null,
      addOpen: false,
    });
    try {
      const [accounts, items] = await Promise.all([listAccounts(), listInstruments()]);
      set({ phase: 'ready', accounts, instruments: items });
    } catch (e) {
      const kind = kindOf(e);
      set({
        phase: 'loadFailed',
        error: kind === 'auth' ? AUTH_EXPIRED : SETTINGS_LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  const doSaveAccount = async () => {
    const ed0 = state.account;
    if (state.phase !== 'ready' || !ed0 || ed0.saving) return;
    accountTried = true;
    set({});
    const ed = state.account;
    if (!ed) return;
    const body = ed.reading.body;
    if (body === null) {
      // 誤りがあれば送らず、どの欄かを知らせる（画面は最初の誤りの欄へフォーカスを移す）
      const labels = errorFieldsOf(ed.reading.errors, ACCOUNT_FIELD_LABEL).map(
        (f) => ACCOUNT_FIELD_LABEL[f],
      );
      set({ notice: { area: 'accounts', kind: 'error', text: errorFieldsText(labels) } });
      return;
    }
    const sent = body as { readonly name: string };
    const key = nameKey(sent.name);
    // 実行中の印は結果と同じ set で下ろす（閉じたシートが行へフォーカスを戻すとき、行が押せないままにしない）
    set({ account: { ...ed, saving: true }, accountSaving: true, notice: null });
    const done = (patch: Partial<SettingsState>) => {
      const cur = state.account;
      set({
        ...(cur && cur.id === ed.id ? { account: { ...cur, saving: false } } : {}),
        accountSaving: false,
        ...patch,
      });
    };
    /** 足せた・保存できた: 欄を閉じて一覧を直す */
    const finished = (accounts: AccountRecord[], saved: AccountRecord, added: boolean) => {
      accountTried = false;
      accountTaken = null;
      uncertainAccount = null;
      set({
        account: null,
        accountSaving: false,
        accounts,
        addedAccountId: added ? saved.id : null,
        notice: {
          area: 'accounts',
          kind: 'ok',
          text: added ? accountAdded(saved.name) : accountSaved(saved.name),
        },
      });
    };
    try {
      let res: Response;
      try {
        res = await request(
          ed.id === null ? '/api/accounts' : `/api/accounts/${encodeURIComponent(ed.id)}`,
          {
            method: ed.id === null ? 'POST' : 'PUT',
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          },
        );
      } catch (e) {
        if (ed.id === null && kindOf(e) === 'network') uncertainAccount = key;
        throw e;
      }
      if (res.status === 409 && ed.id !== null) {
        let reason: unknown = null;
        try {
          reason = ((await res.json()) as { reason?: unknown } | null)?.reason;
        } catch {
          reason = null;
        }
        if (reason === 'currencyLocked') {
          // 取引が付いていた: その口座を取引のある口座に入れ、通貨を元に戻して知らせる（U31）
          const id = ed.id;
          const rec = state.accounts.find((a) => a.id === id);
          const currency = rec ? currencyOfAccount(rec) : ed.draft.currency;
          const inUse = new Set(state.accountsInUse ?? []);
          inUse.add(id);
          const cur = state.account;
          set({
            accountSaving: false,
            accountsInUse: inUse,
            ...(cur && cur.id === id
              ? { account: { ...cur, saving: false, draft: { ...cur.draft, currency } } }
              : {}),
            notice: { area: 'accounts', kind: 'error', text: currencyLockedText(currency) },
          });
          return;
        }
      }
      if (res.status === 409) {
        const wasUncertain = ed.id === null && uncertainAccount === key;
        uncertainAccount = null;
        const list = await listAccounts();
        const hit = list.find((a) => nameKey(a.name) === key);
        if (wasUncertain && hit) {
          finished(list, hit, true);
          return;
        }
        accountTaken = key;
        done({ accounts: list });
        return;
      }
      if (res.status === 404) {
        done({ notice: { area: 'accounts', kind: 'error', text: ACCOUNT_NOT_FOUND } });
        return;
      }
      const saved = await getJson<unknown>(res, ed.id === null ? 201 : 200);
      if (!isAccount(saved)) throw new Failed('other');
      const rest = state.accounts.filter((a) => a.id !== saved.id);
      finished(sortAccounts([...rest, saved]), saved, ed.id === null);
    } catch (e) {
      const kind = kindOf(e);
      done({
        notice: {
          area: 'accounts',
          kind: 'error',
          ...(ed.id === null && kind === 'network'
            ? { text: ACCOUNT_ADD_NETWORK_FAILED }
            : ed.id === null && kind === 'other'
              ? { text: ADD_FAILED }
              : saveMessage(kind)),
        },
      });
    }
  };

  const doSaveInstrument = async () => {
    const ed = state.editing;
    const body = ed?.reading.body;
    if (state.phase !== 'ready' || !ed) return;
    if (!body) {
      const labels = errorFieldsOf(ed.reading.errors, INSTRUMENT_FIELD_LABEL).map(
        (f) => INSTRUMENT_FIELD_LABEL[f],
      );
      set({ notice: { area: 'instruments', kind: 'error', text: errorFieldsText(labels) } });
      return;
    }
    set({ editing: { ...ed, saving: true }, instrumentSaving: true, notice: null });
    const done = (patch: Partial<SettingsState>) => {
      const cur = state.editing;
      set({
        ...(cur && cur.id === ed.id ? { editing: { ...cur, saving: false } } : {}),
        instrumentSaving: false,
        ...patch,
      });
    };
    try {
      const res = await request(`/api/instruments/${encodeURIComponent(ed.id)}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        nameTaken = nameKey(body.name);
        done({});
        return;
      }
      if (res.status === 404) {
        done({ notice: { area: 'instruments', kind: 'error', text: INSTRUMENT_NOT_FOUND } });
        return;
      }
      const saved = await getJson<InstrumentRecord>(res, 200);
      nameTaken = null;
      set({
        editing: null,
        instrumentSaving: false,
        instruments: sortInstruments(state.instruments.map((i) => (i.id === saved.id ? saved : i))),
        notice: { area: 'instruments', kind: 'ok', text: instrumentSaved(saved.name) },
      });
    } catch (e) {
      done({ notice: { area: 'instruments', kind: 'error', ...saveMessage(kindOf(e)) } });
    }
  };

  const doAdd = async () => {
    if (state.phase !== 'ready') return;
    addTried = true;
    const nn = readNewInstrumentName(state.newName, state.instruments);
    if (!nn.ok) {
      set({ notice: null });
      return;
    }
    const name = nn.value;
    set({ adding: true, notice: null });
    const added = (instruments: InstrumentRecord[]) => {
      addTried = false;
      uncertainAdd = null;
      set({
        adding: false,
        addOpen: false,
        newName: '',
        instruments,
        notice: { area: 'instruments', kind: 'ok', text: instrumentAdded(name) },
      });
    };
    try {
      let res: Response;
      try {
        res = await request('/api/instruments', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ name }),
        });
      } catch (e) {
        if (kindOf(e) === 'network') uncertainAdd = nameKey(name);
        throw e;
      }
      if (res.status === 409) {
        const wasUncertain = uncertainAdd === nameKey(name);
        uncertainAdd = null;
        const list = await listInstruments();
        if (wasUncertain) {
          added(list);
          return;
        }
        set({ adding: false, instruments: list });
        return;
      }
      const created = await getJson<InstrumentRecord>(res, 201);
      added(sortInstruments([...state.instruments, created]));
    } catch (e) {
      const kind = kindOf(e);
      set({
        adding: false,
        notice: {
          area: 'instruments',
          kind: 'error',
          ...(kind === 'auth'
            ? { text: AUTH_EXPIRED, auth: true }
            : { text: kind === 'network' ? ADD_NETWORK_FAILED : ADD_FAILED }),
        },
      });
    }
  };

  /** 実行中は同じ Promise を返す */
  const once = (
    get: () => Promise<void> | null,
    put: (p: Promise<void> | null) => void,
    fn: () => Promise<void>,
  ) => {
    const cur = get();
    if (cur) return cur;
    const p = fn().finally(() => put(null));
    put(p);
    return p;
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    load,
    openAccount(id) {
      if (state.phase !== 'ready' || state.account?.saving || savingAccount) return;
      const rec = id === null ? undefined : state.accounts.find((a) => a.id === id);
      if (id !== null && !rec) return;
      accountTried = false;
      accountTaken = null;
      set({
        account: {
          id,
          draft: rec ? accountDraftOf(rec) : EMPTY_ACCOUNT_DRAFT,
          reading: EMPTY_ACCOUNT_READING,
          saving: false,
        },
        addedAccountId: null,
        notice: null,
      });
    },
    closeAccount(force) {
      if (!state.account || (state.account.saving && force !== true)) return;
      accountTried = false;
      accountTaken = null;
      set({ account: null });
    },
    updateAccount(field, value) {
      const ed = state.account;
      if (!ed || ed.saving) return;
      if (field === 'name' && value.trim() === '' && ed.id === null) accountTried = false;
      set({ account: { ...ed, draft: { ...ed.draft, [field]: value } }, notice: null });
      // 直す欄で通貨を今と違う値にした: 取引のある口座かを 1 回だけ確かめる（開いたときは数えない）
      if (field === 'currency' && ed.id !== null) {
        const rec = state.accounts.find((a) => a.id === ed.id);
        const typed = readAccountCurrency(value);
        if (rec && typed.ok && typed.value !== currencyOfAccount(rec)) void checkInUse();
      }
    },
    /** 取引の確かめが終わるまで待つ（テスト・画面の検査用） */
    settled: () => inUseLoad ?? Promise.resolve(),
    saveAccount: () =>
      once(
        () => savingAccount,
        (p) => {
          savingAccount = p;
          // 印は doSaveAccount が結果と同じ set で下ろす。ここは投げて抜けたときの念のため
          if (p === null && state.accountSaving) set({ accountSaving: false });
        },
        doSaveAccount,
      ),
    openInstrument(id) {
      if (state.phase !== 'ready' || state.editing?.saving || savingInstrument) return;
      const rec = state.instruments.find((i) => i.id === id);
      if (!rec) return;
      nameTaken = null;
      set({
        editing: {
          id,
          draft: instrumentDraftOf(rec),
          reading: EMPTY_INSTRUMENT_READING,
          saving: false,
        },
        notice: null,
      });
    },
    closeInstrument(force) {
      if (!state.editing || (state.editing.saving && force !== true)) return;
      nameTaken = null;
      set({ editing: null });
    },
    updateInstrument(field, value) {
      const ed = state.editing;
      if (!ed || ed.saving) return;
      set({ editing: { ...ed, draft: { ...ed.draft, [field]: value } }, notice: null });
    },
    saveInstrument: () =>
      once(
        () => savingInstrument,
        (p) => {
          savingInstrument = p;
          if (p === null && state.instrumentSaving) set({ instrumentSaving: false });
        },
        doSaveInstrument,
      ),
    setNewName(value) {
      if (state.adding) return;
      if (value.trim() === '') addTried = false;
      set({ newName: value, notice: null });
    },
    addInstrument: () =>
      once(
        () => adding,
        (p) => {
          adding = p;
        },
        doAdd,
      ),
    openAddInstrument() {
      if (state.phase !== 'ready' || state.adding) return;
      addTried = false;
      set({ addOpen: true, newName: '', notice: null });
    },
    closeAddInstrument(force) {
      if (!state.addOpen || (state.adding && force !== true)) return;
      addTried = false;
      set({ addOpen: false, newName: '' });
    },
  };
}

/** 欄の要素の ID（画面の部品と同じ。誤りの欄へフォーカスを移すときに使う） */
export const ACCOUNT_FIELD_ID: Readonly<Record<AccountField, string>> = {
  name: 'settings-account-name',
  currency: 'settings-account-currency',
  capital: 'settings-account-capital',
  risk: 'settings-account-risk',
};
/** 口座の行の [直す] の ID */
export const accountEditButtonId = (id: string) => `settings-account-edit-${id}`;
export const INSTRUMENT_FIELD_ID: Readonly<Record<InstrumentField, string>> = {
  name: 'settings-inst-name',
  underlying: 'settings-inst-underlying',
  underlyingKind: 'settings-inst-kind',
  productForm: 'settings-inst-form',
  priceCurrency: 'settings-inst-currency',
  multiplier: 'settings-inst-multiplier',
  quantityStep: 'settings-inst-step',
};
export const SAVE_BUTTON_ID = {
  account: 'settings-account-save',
  instrument: 'settings-inst-save',
  add: 'settings-add',
} as const;
/** 口座の [＋ 口座を足す] */
export const ADD_ACCOUNT_ID = 'settings-account-add';
export const NEW_NAME_ID = 'settings-new-name';

/**
 * 押した操作が終わった後にフォーカスを移す先の ID（null = 移さない）。レビュー指摘 5・6:
 * 誤りで送らなかった・409 で名前が重なった → 最初の誤りの欄、保存に失敗して戻った → 押したボタン
 * （保存中はボタン・欄が無効になり、フォーカスが外れるため）。成功は移さない（銘柄を閉じたときは [直す] へ別に戻す）。
 * 口座を足せた → 新しい行の [直す]（U15）
 */
export function focusAfter(action: keyof typeof SAVE_BUTTON_ID, s: SettingsState): string | null {
  if (action === 'account') {
    if (s.addedAccountId !== null && !s.account) return accountEditButtonId(s.addedAccountId);
    if (!s.account) return null;
    const first = errorFieldsOf(s.account.reading.errors, ACCOUNT_FIELD_LABEL)[0];
    if (first !== undefined) return ACCOUNT_FIELD_ID[first];
    return s.notice?.area === 'accounts' && s.notice.kind === 'error'
      ? SAVE_BUTTON_ID.account
      : null;
  }

  if (action === 'instrument') {
    if (!s.editing) return null;
    const first = errorFieldsOf(s.editing.reading.errors, INSTRUMENT_FIELD_LABEL)[0];
    if (first !== undefined) return INSTRUMENT_FIELD_ID[first];
    return s.notice?.area === 'instruments' && s.notice.kind === 'error'
      ? SAVE_BUTTON_ID.instrument
      : null;
  }
  if (s.newNameError !== null) return NEW_NAME_ID;
  return s.notice?.area === 'instruments' && s.notice.kind === 'error' ? SAVE_BUTTON_ID.add : null;
}
