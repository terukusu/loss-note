// 設定の画面の通信と状態（Issue #5 契約）。DOM を持たず、画面（pages/Settings.tsx）は購読して描くだけ。
// - 開いたら設定と銘柄を並行に読む。読めていない間は保存を送らない（既定の performanceUnit で上書きしない。KEEP-2）
// - 資金と許容リスクは 1 つの [保存]（PUT /api/settings は 3 欄を丸ごと。performanceUnit は読んだ値のまま）。
//   銘柄は 1 件ずつ開いて 7 欄を直し [保存]（PUT /api/instruments/<id>）、名前だけで [足す]（POST。既定は API が埋める。C21）
// - 誤りのある下書きは送らない。実行中は同じ Promise を返す（二重に送らない）
// - 失敗は決まった文言だけを状態に置く（応答の本文・例外の文字列を持たない）。401・ログインしていない = ログインが切れた
// - 足す要求が時間切れ・通信の失敗になったときは届いた可能性がある。次に押して 409 なら、届いていたものとして一覧を取り直す
// - 状態は記憶の中だけ（端末の保存先に書かない）
import type { InstrumentRecord, SettingsRecord } from '../../../core/record';
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
  type HistoryRow,
  historyRows,
  INSTRUMENT_FIELD_LABEL,
  type InstrumentDraft,
  type InstrumentField,
  type InstrumentReading,
  instrumentDraftOf,
  readInstrumentDraft,
  readNewInstrumentName,
  readSettingsDraft,
  SETTINGS_FIELD_LABEL,
  SETTINGS_MSG,
  type SettingsDraft,
  type SettingsField,
  type SettingsReading,
  settingsDraftOf,
  sortInstruments,
} from './settings-form';

export const SETTINGS_LOAD_FAILED =
  '設定を読み込めませんでした。通信を確かめて、もう一度読み込んでください。';
export const SETTINGS_SAVE_FAILED =
  '保存できませんでした。入力はそのまま残っています。もう一度 [保存] を押してください。';
export const SETTINGS_NETWORK_FAILED =
  'つながりません。入力はそのまま残っています。もう一度 [保存] を押してください。';
export const ADD_FAILED = '足せませんでした。もう一度 [足す] を押してください。';
export const ADD_NETWORK_FAILED =
  'つながりません。もう一度 [足す] を押してください（届いていた銘柄は二重に足しません）。';
export const INSTRUMENT_NOT_FOUND = 'この銘柄は見つかりません。読み込み直してください。';
export const SETTINGS_SAVED = '保存しました。これから記録する取引に効きます。';
export const instrumentSaved = (name: string) =>
  `${name} を保存しました。これから記録する取引に効きます。`;
export const instrumentAdded = (name: string) => `${name} を足しました。`;

export type SettingsPhase = 'loading' | 'loadFailed' | 'ready';

/** 知らせ（どのカードに出すか・成功か失敗か） */
export interface SettingsNotice {
  readonly area: 'settings' | 'instruments';
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

export interface SettingsState {
  readonly phase: SettingsPhase;
  /** 読み込みの失敗の文言 */
  readonly error: string | null;
  readonly errorKind?: FailureKind;
  /** 読んだ（保存した）設定。読めるまでは null */
  readonly settings: SettingsRecord | null;
  /** 資金の履歴（新しい順） */
  readonly history: readonly HistoryRow[];
  readonly draft: SettingsDraft;
  readonly reading: SettingsReading;
  readonly savingSettings: boolean;
  /** 銘柄（名前の順） */
  readonly instruments: readonly InstrumentRecord[];
  readonly editing: EditingInstrument | null;
  readonly newName: string;
  readonly newNameError: string | null;
  readonly adding: boolean;
  readonly notice: SettingsNotice | null;
}

export interface SettingsController {
  getState(): SettingsState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: SettingsState) => void): () => void;
  load(): Promise<void>;
  setField(field: SettingsField, value: string): void;
  saveSettings(): Promise<void>;
  /** 1 件だけ開く（別の行を開くと前の下書きは捨てる） */
  openInstrument(id: string): void;
  closeInstrument(): void;
  updateInstrument<K extends InstrumentField>(field: K, value: InstrumentDraft[K]): void;
  saveInstrument(): Promise<void>;
  setNewName(value: string): void;
  addInstrument(): Promise<void>;
}

const EMPTY_DRAFT: SettingsDraft = { capital: '', risk: '1' };
const EMPTY_READING: SettingsReading = { errors: {}, warning: null, body: null };

function saveMessage(kind: FailureKind): Pick<SettingsNotice, 'text' | 'auth'> {
  if (kind === 'auth') return { text: AUTH_EXPIRED, auth: true };
  return { text: kind === 'network' ? SETTINGS_NETWORK_FAILED : SETTINGS_SAVE_FAILED };
}

function isSettings(v: unknown): v is SettingsRecord {
  const s = v as SettingsRecord | null;
  return (
    s !== null &&
    typeof s === 'object' &&
    typeof s.riskTolerancePct === 'number' &&
    (s.capitalYen === null || typeof s.capitalYen === 'number') &&
    (s.performanceUnit === 'R' || s.performanceUnit === 'yen') &&
    Array.isArray(s.capitalHistory)
  );
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
    settings: null,
    history: [],
    draft: EMPTY_DRAFT,
    reading: EMPTY_READING,
    savingSettings: false,
    instruments: [],
    editing: null,
    newName: '',
    newNameError: null,
    adding: false,
    notice: null,
  };
  let savingSettings: Promise<void> | null = null;
  let savingInstrument: Promise<void> | null = null;
  let adding: Promise<void> | null = null;
  /** [足す] を押した（空の名前の誤りを出す） */
  let addTried = false;
  /** 届いたか分からない足す要求の名前の鍵（時間切れ・通信の失敗の後） */
  let uncertainAdd: string | null = null;
  /** API が 409 を返した名前の鍵（直している銘柄） */
  let nameTaken: string | null = null;

  /** 状態を更新し、下書きの読み取りを作り直して知らせる */
  const set = (patch: Partial<SettingsState>) => {
    const next = { ...state, ...patch };
    const reading = next.settings ? readSettingsDraft(next.draft, next.settings) : EMPTY_READING;
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
      reading,
      editing,
      history: next.settings ? historyRows(next.settings.capitalHistory) : [],
      newNameError: named && !nn.ok ? nn.error : null,
    };
    for (const fn of listeners) fn(state);
  };

  const listInstruments = async (): Promise<InstrumentRecord[]> => {
    const i = await getJson<{ items: InstrumentRecord[] }>(await request('/api/instruments'), 200);
    if (!Array.isArray(i.items)) throw new Failed('other');
    return sortInstruments(i.items);
  };

  const load = async () => {
    set({ phase: 'loading', error: null, notice: null, editing: null });
    try {
      const [s, items] = await Promise.all([
        request('/api/settings').then((r) => getJson<unknown>(r, 200)),
        listInstruments(),
      ]);
      if (!isSettings(s)) throw new Failed('other');
      set({ phase: 'ready', settings: s, draft: settingsDraftOf(s), instruments: items });
    } catch (e) {
      const kind = kindOf(e);
      set({
        phase: 'loadFailed',
        error: kind === 'auth' ? AUTH_EXPIRED : SETTINGS_LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  const doSaveSettings = async () => {
    const body = state.reading.body;
    if (state.phase !== 'ready' || !state.settings) return;
    if (body === null) {
      // 誤りがあれば送らず、どの欄かを知らせる（画面は最初の誤りの欄へフォーカスを移す）
      const labels = errorFieldsOf(state.reading.errors, SETTINGS_FIELD_LABEL).map(
        (f) => SETTINGS_FIELD_LABEL[f],
      );
      set({ notice: { area: 'settings', kind: 'error', text: errorFieldsText(labels) } });
      return;
    }
    set({ savingSettings: true, notice: null });
    try {
      const res = await request('/api/settings', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      const saved = await getJson<unknown>(res, 200);
      if (!isSettings(saved)) throw new Failed('other');
      set({
        savingSettings: false,
        settings: saved,
        draft: settingsDraftOf(saved),
        notice: { area: 'settings', kind: 'ok', text: SETTINGS_SAVED },
      });
    } catch (e) {
      set({
        savingSettings: false,
        notice: { area: 'settings', kind: 'error', ...saveMessage(kindOf(e)) },
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
    set({ editing: { ...ed, saving: true }, notice: null });
    const done = (patch: Partial<SettingsState>) => {
      const cur = state.editing;
      set({ ...(cur && cur.id === ed.id ? { editing: { ...cur, saving: false } } : {}), ...patch });
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
    setField(field, value) {
      if (state.phase !== 'ready' || state.savingSettings) return;
      set({ draft: { ...state.draft, [field]: value }, notice: null });
    },
    saveSettings: () =>
      once(
        () => savingSettings,
        (p) => {
          savingSettings = p;
        },
        doSaveSettings,
      ),
    openInstrument(id) {
      if (state.phase !== 'ready' || state.editing?.saving) return;
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
    closeInstrument() {
      if (!state.editing || state.editing.saving) return;
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
  };
}

/** 欄の要素の ID（画面の部品と同じ。誤りの欄へフォーカスを移すときに使う） */
export const SETTINGS_FIELD_ID: Readonly<Record<SettingsField, string>> = {
  capital: 'settings-capital',
  risk: 'settings-risk',
};
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
  settings: 'settings-save',
  instrument: 'settings-inst-save',
  add: 'settings-add',
} as const;
export const NEW_NAME_ID = 'settings-new-name';

/**
 * 押した操作が終わった後にフォーカスを移す先の ID（null = 移さない）。レビュー指摘 5・6:
 * 誤りで送らなかった・409 で名前が重なった → 最初の誤りの欄、保存に失敗して戻った → 押したボタン
 * （保存中はボタン・欄が無効になり、フォーカスが外れるため）。成功は移さない（銘柄を閉じたときは [直す] へ別に戻す）
 */
export function focusAfter(action: keyof typeof SAVE_BUTTON_ID, s: SettingsState): string | null {
  if (action === 'settings') {
    const first = errorFieldsOf(s.reading.errors, SETTINGS_FIELD_LABEL)[0];
    if (first !== undefined) return SETTINGS_FIELD_ID[first];
    return s.notice?.area === 'settings' && s.notice.kind === 'error'
      ? SAVE_BUTTON_ID.settings
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
