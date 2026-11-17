// 記録する画面の通信と状態（Issue #13 契約 R-3）。DOM を持たず、画面（pages/Record.tsx）は購読して描くだけ。
// - 開いたら取引・銘柄・設定を並行に読み、既定（最後に記録した取引の銘柄・数量、決済の時刻 = 開いた時刻）を入れる（AC-9）
// - 保存は 1 回押して 1 件（実行中は同じ Promise を返す。AC-10）。銘柄は一覧に同じ名前（nameKey）があればその ID、
//   無ければ名前だけで足す（既定は API が埋める。C21）。409 なら一覧を取り直して照合する
// - 失敗は決まった文言だけを状態に置く（応答の本文・例外の文字列を持たない = 画面に反射しない）。
//   401・ログインしていない = ログインが切れた / 時間切れ・通信の失敗 = つながらない / ほか = 保存できなかった
// - 要求には時間の上限を置く。保存の要求が時間切れ・通信の失敗になったときは、API に届いて保存された可能性がある。
//   API に冪等のための ID は無いので、次に押したときはまず取引の一覧を読み、同じ本文の取引があれば
//   それを保存した取引として扱い、送り直さない（二重に保存しない）
// - 下書き・取引の値は記憶の中だけ。Web Storage・IndexedDB に触れない（AC-11。画面を離れると入力は消える）
import type {
  InstrumentRecord,
  SettingsRecord,
  StoredTrade,
  TradeRecord,
} from '../../../core/record';
import { NotSignedIn } from './api';
import { floorToMinute, toLocalInput } from './datetime';
import { formatPlain } from './format';
import { findInstrument } from './instrument-name';
import {
  applyDraft,
  type Draft,
  type DraftAction,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  readDraft,
  type Summary,
  summarize,
} from './record-form';

/** /api への要求（ui/src/auth/session.ts の api と同じ形） */
export type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

export const LOAD_FAILED =
  '記録の準備ができませんでした。通信を確かめて、もう一度読み込んでください。';
export const SAVE_FAILED =
  '保存できませんでした。入力はそのまま残っています。もう一度 [記録する] を押してください。';
export const AUTH_EXPIRED = 'ログインが切れました。ログインし直してください。';
export const NETWORK_FAILED =
  'つながりません。入力はそのまま残っています。もう一度 [記録する] を押してください（届いていた記録は二重に保存しません）。';

/** 要求の時間の上限（ミリ秒） */
export const REQUEST_TIMEOUT_MS = 15_000;

export type RecordPhase = 'loading' | 'loadFailed' | 'editing' | 'saving' | 'saved';
export type FailureKind = 'auth' | 'network' | 'other';

export interface SavedView {
  readonly trade: StoredTrade;
  readonly instrumentName: string;
  readonly summary: Summary;
}

export interface RecordState {
  readonly phase: RecordPhase;
  readonly draft: Draft;
  readonly instruments: readonly InstrumentRecord[];
  readonly settings: DraftContext['settings'];
  /** 今の下書きの読み取り（誤り・足りない欄・プレビュー） */
  readonly read: DraftReading;
  /** 読み込み・保存の失敗の文言（決まった文言だけ） */
  readonly error: string | null;
  /** 失敗の種類（ログインし直す案内を出すか） */
  readonly errorKind?: FailureKind;
  /** 保存した取引とその判定（phase = saved のとき） */
  readonly saved?: SavedView;
}

export interface RecordController {
  getState(): RecordState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: RecordState) => void): () => void;
  load(): Promise<void>;
  update(action: DraftAction): void;
  save(): Promise<void>;
  /** [次の取引を記録]: 空の入力に戻す（既定は今保存した取引から。API は読み直さない） */
  next(): void;
}

class Failed extends Error {
  constructor(readonly kind: FailureKind) {
    super(kind);
  }
}

/** 開いたときの既定（AC-9）: 最後に記録した取引（作った時刻が最大）の銘柄・数量、決済の時刻 = 今（分まで） */
export function defaultsFrom(
  trades: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  now: number,
): Partial<Draft> {
  const exitTime = toLocalInput(floorToMinute(now));
  let last: StoredTrade | undefined;
  for (const t of trades) if (!last || t.createdAt > last.createdAt) last = t;
  if (!last) return { exitTime };
  const name = instruments.find((i) => i.id === last.record.instrumentId)?.name ?? '';
  return {
    instrumentName: name,
    quantity: formatPlain(last.record.entries[0].quantity),
    exitTime,
  };
}

/** 鍵の順に依らない JSON（同じ本文の取引かを比べる） */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function messageOf(kind: FailureKind): string {
  if (kind === 'auth') return AUTH_EXPIRED;
  if (kind === 'network') return NETWORK_FAILED;
  return SAVE_FAILED;
}

export function createRecordController(deps: {
  readonly api: ApiFn;
  readonly now: () => number;
  readonly timeoutMs?: number;
}): RecordController {
  const { now } = deps;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const listeners = new Set<(s: RecordState) => void>();
  const initialSettings = { capitalYen: null, riskTolerancePct: 1 };
  let state: RecordState = {
    phase: 'loading',
    draft: EMPTY_DRAFT,
    instruments: [],
    settings: initialSettings,
    read: readDraft(EMPTY_DRAFT, { instruments: [], settings: initialSettings }),
    error: null,
  };
  let inflight: Promise<void> | null = null;
  /** 届いたか分からない保存の本文（時間切れ・通信の失敗の後） */
  let uncertain: TradeRecord | null = null;

  const set = (patch: Partial<Omit<RecordState, 'read'>>, clearSaved = false) => {
    const merged = { ...state, ...patch };
    const { saved, errorKind, ...rest } = merged;
    let base: Omit<RecordState, 'read'> = {
      ...rest,
      ...(clearSaved || saved === undefined ? {} : { saved }),
      ...(merged.error === null || errorKind === undefined ? {} : { errorKind }),
    };
    let read = readDraft(base.draft, { instruments: base.instruments, settings: base.settings });
    // 「窓・滑りでしたか」の問いが消えたら答えも消す（後で問いが出直したときに古い答えを選んだまま出さない）
    if (!read.preview.showGapSlip && base.draft.gapSlip !== 'unanswered') {
      base = { ...base, draft: { ...base.draft, gapSlip: 'unanswered' } };
      read = readDraft(base.draft, { instruments: base.instruments, settings: base.settings });
    }
    state = { ...base, read };
    for (const fn of listeners) fn(state);
  };

  /** 時間の上限つきの要求。時間切れ・通信の失敗は network、ログインしていなければ auth */
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, ng) => {
      timer = setTimeout(() => {
        ctl.abort();
        ng(new Failed('network'));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([deps.api(path, { ...init, signal: ctl.signal }), timeout]);
      if (res.status === 401) throw new Failed('auth');
      return res;
    } catch (e) {
      if (e instanceof Failed) throw e;
      if (e instanceof NotSignedIn) throw new Failed('auth');
      throw new Failed('network');
    } finally {
      clearTimeout(timer);
    }
  };

  /** 応答を JSON で読む（!ok・読めない本文は Failed。本文の中身は持ち出さない） */
  const getJson = async <T>(res: Response, ok: number): Promise<T> => {
    if (res.status !== ok) throw new Failed('other');
    try {
      return (await res.json()) as T;
    } catch {
      throw new Failed('other');
    }
  };

  const kindOf = (e: unknown): FailureKind => (e instanceof Failed ? e.kind : 'other');

  const load = async () => {
    set({ phase: 'loading', error: null }, true);
    try {
      const [t, i, s] = await Promise.all([
        request('/api/trades').then((r) => getJson<{ items: StoredTrade[] }>(r, 200)),
        request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
        request('/api/settings').then((r) => getJson<SettingsRecord>(r, 200)),
      ]);
      if (!Array.isArray(t.items) || !Array.isArray(i.items)) throw new Failed('other');
      set({
        phase: 'editing',
        instruments: i.items,
        settings: { capitalYen: s.capitalYen ?? null, riskTolerancePct: s.riskTolerancePct },
        draft: applyDraft(EMPTY_DRAFT, {
          type: 'reset',
          values: defaultsFrom(t.items, i.items, now()),
        }),
        error: null,
      });
    } catch (e) {
      const kind = kindOf(e);
      set({
        phase: 'loadFailed',
        error: kind === 'auth' ? AUTH_EXPIRED : LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  /** 銘柄の ID を決める（一覧に同じ名前があればそれ、無ければ足す。409 なら取り直して照合） */
  const resolveInstrument = async (
    name: string,
    matchedId: string | undefined,
  ): Promise<{ id: string; instruments: readonly InstrumentRecord[] }> => {
    if (matchedId !== undefined) return { id: matchedId, instruments: state.instruments };
    const res = await request('/api/instruments', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    });
    if (res.status === 409) {
      const again = await getJson<{ items: InstrumentRecord[] }>(
        await request('/api/instruments'),
        200,
      );
      const found = Array.isArray(again.items) ? findInstrument(name, again.items) : undefined;
      if (!found) throw new Failed('other');
      return { id: found.id, instruments: again.items };
    }
    const created = await getJson<InstrumentRecord>(res, 201);
    return { id: created.id, instruments: [...state.instruments, created] };
  };

  /** 前の保存が届いていたか（同じ本文の取引が一覧にあるか） */
  const findDelivered = async (record: TradeRecord): Promise<StoredTrade | undefined> => {
    const list = await getJson<{ items: StoredTrade[] }>(await request('/api/trades'), 200);
    if (!Array.isArray(list.items)) throw new Failed('other');
    const want = canonical(record);
    return list.items.find((t) => canonical(t.record) === want);
  };

  const doSave = async () => {
    const read = state.read;
    const body = read.body;
    if (state.phase !== 'editing' || !read.canSave || body === undefined) return;
    set({ phase: 'saving', error: null });
    try {
      const inst = await resolveInstrument(read.instrument.name, read.instrument.matchedId);
      // 足した銘柄は保存に失敗しても一覧に残す（次に押したときに同じ名前を足し直さない）
      if (inst.instruments !== state.instruments) set({ instruments: inst.instruments });
      const record: TradeRecord = { ...body, instrumentId: inst.id };
      let trade: StoredTrade | undefined;
      if (uncertain !== null && canonical(uncertain) === canonical(record)) {
        trade = await findDelivered(record);
      }
      if (trade === undefined) {
        try {
          const res = await request('/api/trades', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(record),
          });
          uncertain = null;
          trade = await getJson<StoredTrade>(res, 201);
        } catch (e) {
          if (kindOf(e) === 'network') uncertain = record;
          throw e;
        }
      }
      uncertain = null;
      const found = trade;
      const name = inst.instruments.find((i) => i.id === found.record.instrumentId)?.name ?? '';
      set({
        phase: 'saved',
        saved: { trade: found, instrumentName: name, summary: summarize(found) },
        error: null,
      });
    } catch (e) {
      const kind = kindOf(e);
      set({ phase: 'editing', error: messageOf(kind), errorKind: kind });
    }
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
    update(action) {
      if (state.phase !== 'editing') return;
      set({ draft: applyDraft(state.draft, action), error: null });
    },
    save() {
      if (inflight) return inflight;
      const p = doSave().finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    next() {
      const saved = state.saved;
      if (state.phase !== 'saved' || !saved) return;
      set(
        {
          phase: 'editing',
          error: null,
          draft: applyDraft(EMPTY_DRAFT, {
            type: 'reset',
            values: {
              instrumentName: saved.instrumentName,
              quantity: formatPlain(saved.trade.record.entries[0].quantity),
              exitTime: toLocalInput(floorToMinute(now())),
            },
          }),
        },
        true,
      );
    },
  };
}
