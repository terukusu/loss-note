// 記録する画面の通信と状態（Issue #13 契約 R-3）。DOM を持たず、画面（pages/Record.tsx）は購読して描くだけ。
// - 開いたら取引・銘柄・口座を並行に読み、既定（最後に記録した取引の銘柄・数量・口座、決済の時刻 = 開いた時刻）を入れる
//   （AC-9・#47 R4）
// - 口座（#47）: 口座が 2 つ以上なら下書きの口座で資金・許容リスクを決める（本文にも入れる）。その場で足す（名前 + 資金の
//   2 欄。POST /api/accounts）と、足した口座を一覧に足して選ぶ。ほかの欄・明細・チャートは触らない。送っている間は
//   保存しない（帯の文「口座を足しています」）
// - 保存は 1 回押して 1 件（実行中は同じ Promise を返す。AC-10）。銘柄は一覧に同じ名前（nameKey）があればその ID、
//   無ければ名前だけで足す（既定は API が埋める。C21）。409 なら一覧を取り直して照合する
// - 失敗は決まった文言だけを状態に置く（応答の本文・例外の文字列を持たない = 画面に反射しない）。
//   401・ログインしていない = ログインが切れた / 時間切れ・通信の失敗 = つながらない / ほか = 保存できなかった
// - 要求には時間の上限を置く。保存の要求が時間切れ・通信の失敗になったときは、API に届いて保存された可能性がある。
//   API に冪等のための ID は無いので、次に押したときはまず取引の一覧を読み、同じ本文の取引があれば
//   それを保存した取引として扱い、送り直さない（二重に保存しない）
// - 下書き・取引の値は記憶の中だけ。Web Storage・IndexedDB に触れない（AC-11。画面を離れると入力は消える）
// - 決済明細の読み取り（#15）: readImage で画像を描き直して（差し込まれた prepare。DOM はここに来ない）
//   POST /api/statement-reads に送り、応答の行を下書きに流し込む（statement-fill.ts）。読み取り中も入力でき、
//   保存の門（gateReading）で読み取り中・時間帯の未確認は保存しない。新しい読み取り・やめた・画面を離れた（dispose）は
//   世代を進めて要求を止め、古い応答は捨てる。画像のプレビューは保存の後・やめた・離れたで close して参照を捨てる。
//   画像・読み取りの値も記憶の中だけ（端末の保存先・URL・履歴に書かない）
// - 根拠の足のチャート（#12）: setChart で枠ごとに画像を描き直してプレビューを出すだけ（送らない）。[記録する] で
//   取引と一緒に 1 要求（multipart。時間の上限 30 秒）で送る。描き直し中は保存しない。差し替え・外すとその枠の時間足は
//   空に戻る（選び直し）。保存の後・明細の次の行・画面を離れたらプレビューを close して捨てる。保存の失敗では残す。
//   チャートの画像も記憶の中だけ
import {
  type AccountRecord,
  accountIdOf,
  type InstrumentRecord,
  type StoredTrade,
  type TradeRecord,
} from '../../../core/record';
import {
  ACCOUNT_ADDING,
  ACCOUNT_MSG,
  type AccountField,
  type AccountReading,
  accountNameOf,
  defaultAccountId,
  EMPTY_NEW_ACCOUNT,
  type NewAccountDraft,
  readNewAccountDraft,
  sortAccounts,
} from './accounts';
import {
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  type ChartSlot,
  type ChartUpload,
  tradeFormData,
} from './charts';
import { floorToMinute, toLocalInput } from './datetime';
import { formatPlain } from './format';
import { nameKey as nameKeyOf } from './instrument-name';
import { resolveInstrument as resolveInstrumentId } from './instrument-resolve';
import {
  applyDraft,
  type Draft,
  type DraftAction,
  type DraftContext,
  type DraftField,
  type DraftReading,
  EMPTY_DRAFT,
  readDraft,
  type Summary,
  summarize,
} from './record-form';
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
  confirmTimeZone,
  fillFromRow,
  gateReading,
  type Marks,
  markEdited,
  parseReadResponse,
  READ_MSG,
  type ReadRow,
  readFailureOf,
  rowLabel,
} from './statement-fill';
import type { PrepareResult, PreviewHandle } from './statement-image';
import { CHART_PREPARING } from './verdict-notes';

export type { ApiFn, FailureKind };
export { AUTH_EXPIRED, REQUEST_TIMEOUT_MS };

export const LOAD_FAILED =
  '記録の準備ができませんでした。通信を確かめて、もう一度読み込んでください。';
export const SAVE_FAILED =
  '保存できませんでした。入力はそのまま残っています。もう一度 [記録する] を押してください。';
export const NETWORK_FAILED =
  'つながりません。入力はそのまま残っています。もう一度 [記録する] を押してください（届いていた記録は二重に保存しません）。';

/** 読み取りの要求の時間の上限（API の締め切り 20 秒 + 後始末 約 5 秒 + 余裕。R3） */
export const READ_TIMEOUT_MS = 30_000;
export const READ_PATH = '/api/statement-reads';
/** 読み取りの準備（#65）: 開いたときに 1 回送り、API が明細の読み取りの CLI を先に立てる。応答は使わない */
export const READ_PREPARE_PATH = '/api/statement-reads/prepare';
/** 準備の要求の時間の上限（API が待つ上限 20 秒 + 余裕） */
export const READ_PREPARE_TIMEOUT_MS = 25_000;
export const ROWS_DONE = '明細の行を最後まで見ました';
export const rowSaved = (index: number, total: number) =>
  `${rowLabel(index, total)}を記録しました。次の行（${index + 2} / ${total}）です`;
export const rowSkipped = (index: number, total: number) =>
  `${rowLabel(index, total)}を飛ばしました。次の行（${index + 2} / ${total}）です`;
/** チャートつきの保存の時間の上限（画像 2 枚で約 1 MB を送る） */
export const CHART_SAVE_TIMEOUT_MS = 30_000;
export { CHART_PREPARING };
export const CHART_MSG = {
  notImage: '画像を読み込めませんでした。PNG か JPEG のチャートを選んでください。',
  rejected: 'この画像は使えません。別の画像を選んでください。',
} as const;
/** 前の保存が届いたか分からない間は枠を変えない（次の [記録する] は届いた取引を探すので、変えた枠が送られない） */
export const CHART_LOCKED =
  '前の [記録する] が届いたか確かめるまで、チャートは変えられません。先に [記録する] をもう一度押してください。';
/** その場で足す口座の失敗（足す欄の中の知らせ。欄の値は残る。U8） */
export const ACCOUNT_ADD_FAILED = '口座を足せませんでした。もう一度 [足す] を押してください。';
export const ACCOUNT_ADD_NETWORK_FAILED =
  'つながりません。もう一度 [足す] を押してください（届いていた口座は二重に足しません）。';
export { ACCOUNT_ADDING };
export const READ_BLOCKED = {
  notReady: '記録の準備ができてから、もう一度貼ってください。',
  saving: '記録しています。終わってから、もう一度貼ってください。',
} as const;

export type RecordPhase = 'loading' | 'loadFailed' | 'editing' | 'saving' | 'saved';

/** 明細の読み取りの段階: 描き直し中 / 読み取り中 / 行を確かめている / 失敗 / 行を最後まで見た */
export type StatementPhase = 'preparing' | 'reading' | 'ready' | 'failed' | 'done';

export interface StatementState {
  readonly phase: StatementPhase;
  /** 読み取った行（phase = ready のとき 1 行以上） */
  readonly rows: readonly ReadRow[];
  /** 今の行の番号（0 から） */
  readonly index: number;
  /** 欄の印 */
  readonly marks: Marks;
  /** 失敗の決まった文言（phase = failed のとき。ログインが切れたときは null で、error に出す） */
  readonly message: string | null;
  /** 知らせ（「1 / 3 行目を記録しました」など） */
  readonly notice: string | null;
  /** 送るものと同じ画像のプレビュー（記憶の中だけ） */
  readonly preview: PreviewHandle | null;
}

/** チャートの枠の段階: 描き直し中 / 使える（プレビューあり）/ 失敗（決まった文言） */
export type ChartPhase = 'preparing' | 'ready' | 'failed';

export interface ChartState {
  readonly phase: ChartPhase;
  /** 送るものと同じ画像のプレビュー（phase = ready のとき。記憶の中だけ） */
  readonly preview: PreviewHandle | null;
  readonly message: string | null;
}

export type ChartsState = Readonly<Partial<Record<ChartSlot, ChartState>>>;

export interface SavedView {
  readonly trade: StoredTrade;
  readonly instrumentName: string;
  readonly summary: Summary;
  /** 保存した取引の口座の名前と、保存したときの口座の数（「口座 A に記録しました」。U11） */
  readonly accountName: string;
  readonly accountCount: number;
}

/** その場で足す口座の欄（開いている間だけ。#47 B5・U5〜U9） */
export interface AddAccountState {
  readonly draft: NewAccountDraft;
  /** 欄の誤り（名前が空の誤りは [足す] を押した後だけ） */
  readonly errors: AccountReading<unknown>['errors'];
  readonly saving: boolean;
  /** 通信の失敗の文言（欄の中の知らせ） */
  readonly message: string | null;
  /** ログインが切れた */
  readonly auth?: true;
}

export interface RecordState {
  readonly phase: RecordPhase;
  readonly draft: Draft;
  readonly instruments: readonly InstrumentRecord[];
  /** 口座（名前の順。#47） */
  readonly accounts: readonly AccountRecord[];
  /** その場で足す口座の欄（開いているときだけ） */
  readonly addAccount?: AddAccountState;
  /** 今の下書きの読み取り（誤り・足りない欄・プレビュー） */
  readonly read: DraftReading;
  /** 読み込み・保存の失敗の文言（決まった文言だけ） */
  readonly error: string | null;
  /** 失敗の種類（ログインし直す案内を出すか） */
  readonly errorKind?: FailureKind;
  /** 保存した取引とその判定（phase = saved のとき） */
  readonly saved?: SavedView;
  /** 決済明細の読み取り（貼った・選んだとき。#15） */
  readonly statement?: StatementState;
  /** 読み込み中・保存中などで画像を受けられなかったときの知らせ（黙って捨てない） */
  readonly readBlocked?: string | null;
  /** 根拠の足のチャートの枠（貼った・選んだ枠だけ。#12） */
  readonly charts?: ChartsState;
  /** 枠を変えられなかった知らせ（前の保存が届いたか分からない間。黙って捨てない） */
  readonly chartBlocked?: string | null;
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
  /** 明細の画像を 1 枚受けて、描き直して読み取りに送る（追加の操作なし。前の読み取りは捨てる） */
  readImage(file: Blob): Promise<void>;
  /** [やめて手で入れる]: 読み取りをやめる（後で届いた応答は捨てる。欄はそのまま） */
  cancelRead(): void;
  /** [日本時間で合っている] */
  confirmTimeZone(): void;
  /** [この行を飛ばす] */
  skipRow(): void;
  /** チャートを 1 枚、枠に入れる（描き直してプレビューを出すだけ。送るのは [記録する]。同じ枠なら置き換え） */
  setChart(slot: ChartSlot, file: Blob): Promise<void>;
  /** [外す]: 枠の画像と時間足を消す */
  removeChart(slot: ChartSlot): void;
  /** [＋ 口座を足す]: その場で足す欄を開く（ほかの欄は触らない） */
  openAddAccount(): void;
  /** [やめる]・Esc: 足す欄を閉じる（送っている間は閉じない） */
  closeAddAccount(): void;
  setNewAccount(field: Extract<AccountField, 'name' | 'capital'>, value: string): void;
  /** [足す]: POST /api/accounts。足せたら一覧に足して選ぶ（下書きのほかの欄・明細・チャートはそのまま） */
  addAccount(): Promise<void>;
  /** 画面を離れた: 読み取りを止め、画像と残りの行を捨てる（チャートも捨てる） */
  dispose(): void;
}

/**
 * 開いたときの既定（AC-9・#47 R4）: 最後に記録した取引（作った時刻が最大）の銘柄・数量・口座（一覧に無い口座は既定の口座）、
 * 決済の時刻 = 今（分まで）
 */
export function defaultsFrom(
  trades: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  now: number,
  accounts: readonly AccountRecord[] = [],
): Partial<Draft> {
  const exitTime = toLocalInput(floorToMinute(now));
  const accountId = defaultAccountId(trades, accounts);
  let last: StoredTrade | undefined;
  for (const t of trades) if (!last || t.createdAt > last.createdAt) last = t;
  if (!last) return { exitTime, accountId };
  const name = instruments.find((i) => i.id === last.record.instrumentId)?.name ?? '';
  return {
    instrumentName: name,
    quantity: formatPlain(last.record.entries[0].quantity),
    exitTime,
    accountId,
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

function messageOf(kind: FailureKind): string {
  if (kind === 'auth') return AUTH_EXPIRED;
  if (kind === 'network') return NETWORK_FAILED;
  return SAVE_FAILED;
}

export function createRecordController(deps: {
  readonly api: ApiFn;
  readonly now: () => number;
  readonly timeoutMs?: number;
  /** 画像を送る形に描き直す（画面が statement-image.ts の prepareImage を渡す。テストは偽物） */
  readonly prepare?: (file: Blob) => Promise<PrepareResult>;
  readonly readTimeoutMs?: number;
  /** 開いたときに読み取りの準備を送る（#65。画面が true を渡す。失敗は画面に出さない） */
  readonly warmRead?: boolean;
}): RecordController {
  const { now } = deps;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? READ_TIMEOUT_MS;
  const listeners = new Set<(s: RecordState) => void>();
  let state: RecordState = {
    phase: 'loading',
    draft: EMPTY_DRAFT,
    instruments: [],
    accounts: [],
    read: readDraft(EMPTY_DRAFT, { instruments: [], accounts: [] }),
    error: null,
  };
  let inflight: Promise<void> | null = null;
  /** 届いたか分からない保存の本文（時間切れ・通信の失敗の後） */
  let uncertain: TradeRecord | null = null;
  /** 読み取りの世代（新しい読み取り・やめた・離れたで進め、古い応答を捨てる） */
  let readGen = 0;
  let readAbort: AbortController | null = null;
  /** 貼った後に利用者が触った欄（応答で上書きしない） */
  let touched = new Set<DraftField>();
  /** 空の下書きに戻すときの既定（開いたとき、保存の後は今保存した取引から） */
  let defaults: Partial<Draft> = {};
  /** その場で足す口座: [足す] を押した（空の名前の誤りを出す）・409 の名前の鍵・届いたか分からない名前 */
  let addTried = false;
  let accountTaken: string | null = null;
  let uncertainAccount: string | null = null;
  let addingAccount: Promise<void> | null = null;

  const set = (patch: Partial<Omit<RecordState, 'read'>>, clearSaved = false) => {
    const merged = { ...state, ...patch };
    const { saved, errorKind, ...rest } = merged;
    let base: Omit<RecordState, 'read'> = {
      ...rest,
      ...(clearSaved || saved === undefined ? {} : { saved }),
      ...(merged.error === null || errorKind === undefined ? {} : { errorKind }),
    };
    const ctx: DraftContext = {
      instruments: base.instruments,
      accounts: base.accounts,
      charts: {
        entry: base.charts?.entry?.phase === 'ready',
        exit: base.charts?.exit?.phase === 'ready',
      },
    };
    let read = readDraft(base.draft, ctx);
    // 「窓・滑りでしたか」の問いが消えたら答えも消す（後で問いが出直したときに古い答えを選んだまま出さない）
    if (!read.preview.showGapSlip && base.draft.gapSlip !== 'unanswered') {
      base = { ...base, draft: { ...base.draft, gapSlip: 'unanswered' } };
      read = readDraft(base.draft, ctx);
    }
    const st = base.statement;
    if (st) {
      read = gateReading(read, {
        reading: st.phase === 'preparing' || st.phase === 'reading',
        marks: st.marks,
      });
    }
    // チャートの描き直し中は保存しない（送るものが決まっていない）
    if (CHART_SLOTS.some((slot) => base.charts?.[slot]?.phase === 'preparing')) {
      read = { ...read, canSave: false, notice: read.notice ?? CHART_PREPARING };
    }
    // 口座を足している間は保存しない（U9）
    if (base.addAccount?.saving) {
      read = { ...read, canSave: false, notice: read.notice ?? ACCOUNT_ADDING };
    }
    state = { ...base, read };
    for (const fn of listeners) fn(state);
  };

  /** 枠ごとの送る画像（記憶の中だけ）と世代（差し替え・外す・離れたで進め、古い描き直しの結果を捨てる） */
  const chartBytes: Partial<Record<ChartSlot, ChartUpload>> = {};
  const chartGen: Record<ChartSlot, number> = { entry: 0, exit: 0 };

  /** 枠の画像とプレビューを捨てる（状態は呼び出し側が直す） */
  const dropChart = (slot: ChartSlot) => {
    chartGen[slot]++;
    state.charts?.[slot]?.preview?.close();
    delete chartBytes[slot];
  };

  /** すべての枠を空に戻す（知らせは次の set で出す） */
  const clearCharts = () => {
    for (const slot of CHART_SLOTS) dropChart(slot);
    if (state.charts) {
      const { charts: _gone, ...rest } = state;
      state = rest;
    }
  };

  const withoutSlot = (slot: ChartSlot): ChartsState => {
    const { [slot]: _gone, ...rest } = state.charts ?? {};
    return rest;
  };

  /** 時間の上限つきの要求。時間切れ・通信の失敗は network、ログインしていなければ auth（request.ts） */
  const request = createRequest(deps.api, timeoutMs);

  const load = async () => {
    set({ phase: 'loading', error: null, readBlocked: null }, true);
    if (deps.warmRead) {
      void request(READ_PREPARE_PATH, { method: 'POST' }, { ms: READ_PREPARE_TIMEOUT_MS }).catch(
        () => undefined,
      );
    }
    try {
      const [t, i, a] = await Promise.all([
        request('/api/trades').then((r) => getJson<{ items: StoredTrade[] }>(r, 200)),
        request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
        request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
      ]);
      if (!Array.isArray(t.items) || !Array.isArray(i.items) || !Array.isArray(a.items)) {
        throw new Failed('other');
      }
      const accounts = sortAccounts(a.items);
      defaults = defaultsFrom(t.items, i.items, now(), accounts);
      const { addAccount: _closed, ...rest } = state;
      state = rest;
      set({
        phase: 'editing',
        instruments: i.items,
        accounts,
        draft: applyDraft(EMPTY_DRAFT, { type: 'reset', values: defaults }),
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

  /** 銘柄の ID を決める（一覧に同じ名前があればそれ、無ければ足す。409 なら取り直して照合。instrument-resolve.ts） */
  const resolveInstrument = (name: string, matchedId: string | undefined) =>
    resolveInstrumentId(request, name, matchedId, state.instruments);

  /** 前の保存が届いていたか（同じ本文の取引が一覧にあるか） */
  const findDelivered = async (record: TradeRecord): Promise<StoredTrade | undefined> => {
    const list = await getJson<{ items: StoredTrade[] }>(await request('/api/trades'), 200);
    if (!Array.isArray(list.items)) throw new Failed('other');
    const want = canonical(record);
    return list.items.find((t) => canonical(t.record) === want);
  };

  /** 読み取りを止めて、画像（プレビュー）と残りの行を捨てる */
  /** keepTouched: 貼り直し（前の読み取りの後に利用者が直した欄は、次の応答でも上書きしない） */
  const endStatement = (keepTouched = false) => {
    readGen++;
    readAbort?.abort();
    readAbort = null;
    if (!keepTouched) touched = new Set();
    const prev = state.statement;
    if (!prev) return;
    prev.preview?.close();
    const { statement: _gone, ...rest } = state;
    state = rest;
  };

  /** 行 index の下書き（読み取りの欄 = 行、LC・一言・3 つのタップ・下げた後の LC は空） */
  const showRow = (st: StatementState, index: number, notice: string | null) => {
    const row = st.rows[index];
    if (!row) return;
    touched = new Set();
    clearCharts();
    // 次の行は前の行の口座を引き継ぐ（#47 R4・B6）
    const filled = fillFromRow({ ...EMPTY_DRAFT, accountId: state.draft.accountId }, row, touched);
    set(
      {
        phase: 'editing',
        error: null,
        chartBlocked: null,
        draft: filled.draft,
        statement: { ...st, phase: 'ready', index, marks: filled.marks, notice, message: null },
      },
      true,
    );
  };

  const statementFailed = (gen: number, message: string | null) => {
    if (gen !== readGen) return;
    const st = state.statement;
    if (!st) return;
    set({ statement: { ...st, phase: 'failed', message, rows: [], index: 0, marks: {} } });
  };

  const readImage = async (file: Blob) => {
    if (state.phase === 'saved') next();
    if (!deps.prepare) return;
    if (state.phase !== 'editing') {
      set({ readBlocked: state.phase === 'saving' ? READ_BLOCKED.saving : READ_BLOCKED.notReady });
      return;
    }
    // 前の読み取りが「明細から」の既定で入れた値は戻す（出どころを失って本人の答えに見えないように）。
    // 前の読み取りの後に利用者が直した欄（touched）は値も印も残し、次の応答で上書きしない
    const prev = state.statement;
    const carried: Partial<Record<DraftField, Marks[DraftField]>> = {};
    let draft = state.draft;
    if (prev) {
      for (const f of touched) if (prev.marks[f] !== undefined) carried[f] = prev.marks[f];
      if (prev.marks.lcDecided === 'statement') draft = { ...draft, lcDecided: null };
      if (prev.marks.exitReason === 'statement') draft = { ...draft, exitReason: 'other' };
      draft = { ...draft, exitOrderType: 'unknown', stopOrderPlaced: 'unanswered' };
    }
    endStatement(true);
    const gen = readGen;
    const ctl = new AbortController();
    readAbort = ctl;
    set({
      error: null,
      readBlocked: null,
      draft,
      statement: {
        phase: 'preparing',
        rows: [],
        index: 0,
        marks: carried as Marks,
        message: null,
        notice: null,
        preview: null,
      },
    });
    let prepared: PrepareResult;
    try {
      prepared = await deps.prepare(file);
    } catch {
      prepared = { ok: false, error: 'not_image' };
    }
    if (gen !== readGen) {
      if (prepared.ok) prepared.image.preview.close();
      return;
    }
    if (!prepared.ok) {
      statementFailed(gen, prepared.error === 'not_image' ? READ_MSG.notImage : READ_MSG.rejected);
      return;
    }
    const { bytes, contentType, preview } = prepared.image;
    const st0 = state.statement;
    if (!st0) {
      preview.close();
      return;
    }
    set({ statement: { ...st0, phase: 'reading', preview } });
    try {
      const res = await request(
        READ_PATH,
        { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes as BodyInit },
        { ms: readTimeoutMs, ctl },
      );
      if (gen !== readGen) return;
      if (res.status !== 200) {
        const kind = readFailureOf(res.status);
        if (kind === 'auth') throw new Failed('auth');
        statementFailed(gen, READ_MSG[kind]);
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (gen !== readGen) return;
      const result = parseReadResponse(json);
      if (result === null) {
        statementFailed(gen, READ_MSG.failed);
        return;
      }
      if (result.kind !== 'statement' || result.rows.length === 0) {
        statementFailed(gen, READ_MSG.notStatement);
        return;
      }
      const st = state.statement;
      const row = result.rows[0];
      if (!st || !row || state.phase !== 'editing') return;
      const filled = fillFromRow(state.draft, row, touched);
      set({
        draft: filled.draft,
        statement: {
          ...st,
          phase: 'ready',
          rows: result.rows,
          index: 0,
          marks: { ...st.marks, ...filled.marks },
          message: null,
          notice: null,
        },
      });
    } catch (e) {
      if (gen !== readGen) return;
      if (kindOf(e) === 'auth') {
        statementFailed(gen, null);
        set({ error: AUTH_EXPIRED, errorKind: 'auth' });
        return;
      }
      statementFailed(gen, READ_MSG.failed);
    } finally {
      if (readAbort === ctl) readAbort = null;
    }
  };

  const setChart = async (slot: ChartSlot, file: Blob) => {
    if (state.phase === 'saved') next();
    if (!deps.prepare) return;
    if (state.phase !== 'editing') {
      set({ readBlocked: state.phase === 'saving' ? READ_BLOCKED.saving : READ_BLOCKED.notReady });
      return;
    }
    if (uncertain !== null) {
      set({ chartBlocked: CHART_LOCKED });
      return;
    }
    dropChart(slot);
    const gen = chartGen[slot];
    // 差し替えたらその枠の時間足は選び直し（前のチャートの足が残って、誤って「時間足を変えた」にしない）
    set({
      error: null,
      readBlocked: null,
      chartBlocked: null,
      draft: { ...state.draft, [CHART_TIMEFRAME_FIELD[slot]]: null },
      charts: { ...state.charts, [slot]: { phase: 'preparing', preview: null, message: null } },
    });
    let prepared: PrepareResult;
    try {
      prepared = await deps.prepare(file);
    } catch {
      prepared = { ok: false, error: 'not_image' };
    }
    if (gen !== chartGen[slot] || state.charts?.[slot]?.phase !== 'preparing') {
      if (prepared.ok) prepared.image.preview.close();
      return;
    }
    if (!prepared.ok) {
      set({
        charts: {
          ...state.charts,
          [slot]: {
            phase: 'failed',
            preview: null,
            message: prepared.error === 'not_image' ? CHART_MSG.notImage : CHART_MSG.rejected,
          },
        },
      });
      return;
    }
    const { bytes, contentType, preview } = prepared.image;
    chartBytes[slot] = { bytes, contentType };
    set({ charts: { ...state.charts, [slot]: { phase: 'ready', preview, message: null } } });
  };

  const removeChart = (slot: ChartSlot) => {
    if (state.phase !== 'editing' || !state.charts?.[slot]) return;
    if (uncertain !== null) {
      set({ chartBlocked: CHART_LOCKED });
      return;
    }
    dropChart(slot);
    set({
      error: null,
      draft: { ...state.draft, [CHART_TIMEFRAME_FIELD[slot]]: null },
      charts: withoutSlot(slot),
    });
  };

  const next = () => {
    const saved = state.saved;
    if (state.phase !== 'saved' || !saved) return;
    set(
      {
        phase: 'editing',
        error: null,
        draft: applyDraft(EMPTY_DRAFT, {
          type: 'reset',
          values: { ...defaults, exitTime: toLocalInput(floorToMinute(now())) },
        }),
      },
      true,
    );
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
        // チャートがあれば取引と一緒に 1 要求（multipart）。無ければ今の JSON
        const uploads: Partial<Record<ChartSlot, ChartUpload>> = {};
        for (const slot of CHART_SLOTS) {
          const c = chartBytes[slot];
          if (c && state.charts?.[slot]?.phase === 'ready') uploads[slot] = c;
        }
        const withCharts = Object.keys(uploads).length > 0;
        try {
          const res = await request(
            '/api/trades',
            withCharts
              ? { method: 'POST', body: tradeFormData(record, uploads) }
              : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(record) },
            withCharts ? { ms: CHART_SAVE_TIMEOUT_MS } : {},
          );
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
      defaults = {
        instrumentName: name,
        quantity: formatPlain(found.record.entries[0].quantity),
        accountId: accountIdOf(found.record),
      };
      // 保存したチャートは捨てる（次の取引・次の行の枠は空。1 取引 = その取引のチャート）
      clearCharts();
      // 明細の残りの行があれば、次の行で下書きを作り直す（C20。R7）
      const st = state.statement;
      if (st && st.phase === 'ready' && st.index + 1 < st.rows.length) {
        const saved = st.index;
        showRow(st, saved + 1, rowSaved(saved, st.rows.length));
        return;
      }
      endStatement();
      set({
        phase: 'saved',
        saved: {
          trade: found,
          instrumentName: name,
          summary: summarize(found),
          accountName: accountNameOf(accountIdOf(found.record), state.accounts),
          accountCount: state.accounts.length,
        },
        error: null,
        chartBlocked: null,
      });
    } catch (e) {
      const kind = kindOf(e);
      set({ phase: 'editing', error: messageOf(kind), errorKind: kind });
    }
  };

  /** 足す欄の誤り（名前が空の誤りは [足す] を押した後だけ。API の 409 の名前は重複） */
  const addErrors = (draft: NewAccountDraft, accounts: readonly AccountRecord[]) => {
    const r = readNewAccountDraft(draft, accounts);
    const errors: Partial<Record<AccountField, string>> = { ...r.errors };
    if (errors.name === ACCOUNT_MSG.nameRequired && !addTried) delete errors.name;
    if (!errors.name && accountTaken !== null && nameKeyOf(draft.name) === accountTaken) {
      errors.name = ACCOUNT_MSG.duplicateName;
    }
    return { reading: r, errors };
  };

  const setAdd = (patch: Partial<AddAccountState>) => {
    const cur = state.addAccount;
    if (!cur) return;
    const next = { ...cur, ...patch };
    set({ addAccount: { ...next, errors: addErrors(next.draft, state.accounts).errors } });
  };

  const closeAdd = () => {
    const { addAccount: _closed, ...rest } = state;
    state = rest;
  };

  const doAddAccount = async () => {
    const cur = state.addAccount;
    if (state.phase !== 'editing' || !cur || cur.saving) return;
    addTried = true;
    const { reading, errors } = addErrors(cur.draft, state.accounts);
    const body = Object.keys(errors).length === 0 ? reading.body : null;
    if (body === null) {
      setAdd({ message: null });
      return;
    }
    const key = nameKeyOf(body.name);
    const { auth: _a, ...base } = cur;
    set({ addAccount: { ...base, errors: {}, saving: true, message: null } });
    const finish = (patch: Partial<AddAccountState>) => {
      const c = state.addAccount;
      if (!c) return;
      const { auth: _x, ...rest } = c;
      set({
        addAccount: {
          ...rest,
          saving: false,
          ...patch,
          errors: addErrors(c.draft, state.accounts).errors,
        },
      });
    };
    /** 足せた: 一覧に足して選び、欄を閉じる（下書きのほかの欄・明細・チャートはそのまま。B5） */
    const added = (accounts: AccountRecord[], id: string) => {
      addTried = false;
      accountTaken = null;
      uncertainAccount = null;
      closeAdd();
      set({ accounts, draft: { ...state.draft, accountId: id } });
    };
    try {
      let res: Response;
      try {
        res = await request('/api/accounts', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (kindOf(e) === 'network') uncertainAccount = key;
        throw e;
      }
      if (res.status === 409) {
        // 前の [足す] が届いていた（時間切れ・通信の失敗の後）なら、その口座を足せたものとして選ぶ
        const wasUncertain = uncertainAccount === key;
        uncertainAccount = null;
        const list = await getJson<{ items: AccountRecord[] }>(await request('/api/accounts'), 200);
        if (!Array.isArray(list.items)) throw new Failed('other');
        const accounts = sortAccounts(list.items);
        const hit = accounts.find((a) => nameKeyOf(a.name) === key);
        if (wasUncertain && hit) {
          added(accounts, hit.id);
          return;
        }
        accountTaken = key;
        set({ accounts });
        finish({ message: null });
        return;
      }
      const created = await getJson<AccountRecord>(res, 201);
      added(sortAccounts([...state.accounts, created]), created.id);
    } catch (e) {
      const kind = kindOf(e);
      finish(
        kind === 'auth'
          ? { message: AUTH_EXPIRED, auth: true }
          : { message: kind === 'network' ? ACCOUNT_ADD_NETWORK_FAILED : ACCOUNT_ADD_FAILED },
      );
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
    openAddAccount() {
      if (state.phase !== 'editing' || state.addAccount) return;
      addTried = false;
      accountTaken = null;
      set({
        addAccount: { draft: EMPTY_NEW_ACCOUNT, errors: {}, saving: false, message: null },
      });
    },
    closeAddAccount() {
      if (!state.addAccount || state.addAccount.saving) return;
      addTried = false;
      accountTaken = null;
      closeAdd();
      set({});
    },
    setNewAccount(field, value) {
      const cur = state.addAccount;
      if (!cur || cur.saving) return;
      if (field === 'name' && value.trim() === '') addTried = false;
      setAdd({ draft: { ...cur.draft, [field]: value }, message: null });
    },
    addAccount() {
      if (addingAccount) return addingAccount;
      const p = doAddAccount().finally(() => {
        addingAccount = null;
      });
      addingAccount = p;
      return p;
    },
    update(action) {
      if (state.phase !== 'editing') return;
      const st = state.statement;
      if (st && action.type === 'set') {
        touched.add(action.field);
        const marks = markEdited(st.marks, action.field);
        set({
          draft: applyDraft(state.draft, action),
          error: null,
          readBlocked: null,
          chartBlocked: null,
          ...(marks === st.marks ? {} : { statement: { ...st, marks } }),
        });
        return;
      }
      set({
        draft: applyDraft(state.draft, action),
        error: null,
        readBlocked: null,
        chartBlocked: null,
      });
    },
    save() {
      if (inflight) return inflight;
      const p = doSave().finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    next,
    readImage,
    setChart,
    removeChart,
    cancelRead() {
      const st = state.statement;
      if (!st || (st.phase !== 'preparing' && st.phase !== 'reading')) return;
      endStatement();
      set({});
    },
    confirmTimeZone() {
      const st = state.statement;
      if (st?.phase !== 'ready' || state.phase !== 'editing') return;
      const row = st.rows[st.index];
      if (!row) return;
      const c = confirmTimeZone(state.draft, st.marks, row);
      set({ draft: c.draft, statement: { ...st, marks: c.marks } });
    },
    skipRow() {
      const st = state.statement;
      if (st?.phase !== 'ready' || state.phase !== 'editing') return;
      if (st.index + 1 < st.rows.length) {
        showRow(st, st.index + 1, rowSkipped(st.index, st.rows.length));
        return;
      }
      // 最後の行を飛ばした: 読み取りを終えて、空の下書き（既定 = 今保存した取引か開いたとき）に戻す
      endStatement();
      clearCharts();
      set({
        error: null,
        draft: applyDraft(EMPTY_DRAFT, {
          type: 'reset',
          values: { ...defaults, exitTime: toLocalInput(floorToMinute(now())) },
        }),
        statement: {
          phase: 'done',
          rows: [],
          index: 0,
          marks: {},
          message: null,
          notice: ROWS_DONE,
          preview: null,
        },
      });
    },
    dispose() {
      endStatement();
      clearCharts();
    },
  };
}
