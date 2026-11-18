// 取引を編集画面の通信と状態（Issue #9 契約 U-3。設計書 C36・4 章の冒頭・7.5、ADR-0004 決定 5・ADR-0006 決定 7）。
// DOM を持たない。画面（pages/TradeEdit.tsx）は購読して描くだけ。
// - 開いたら取引・銘柄・口座を並行に読み、保存した値の入った下書きを作る（edit-form.ts）。404 = notFound、
//   建てが複数・建てごとの LC の取引 = blocked
// - 下書きのたびに、写した資金・許容リスク（口座を付け替えたら付け替え先の今の値。#47）で判定・R・リスクを出し直す
//   （readDraft + editPreview）
// - 保存は PUT（JSON。チャートの変更があれば multipart）。1 回押して 1 件（実行中は同じ Promise）。PUT は冪等なので、
//   時間切れの後に送り直してよい。チャートの無い枠の時間足は本文に入らない（orphanTimeframes をその旨として出す）
// - 今の値で計算し直す（#31）: 写した値と取引の口座・銘柄の今の値が違えば offer（違う値と判定・R・リスクの 前 → 後）を出す。
//   setRefresh(true) で「今の値」を選ぶとプレビューは今の値で出し、保存の PUT に ?snapshot=current を付ける（選ばなければ付けない。
//   C36）。違いが無くなったら（口座・銘柄を付け替えた等）選択も戻す。保存の前に口座・銘柄を読み直し、開いてから今の値が
//   変わっていたら保存せずに知らせる（見せた値と違う値で保存しない）
// - 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）。下書きは記憶の中だけ（端末の保存先・URL・履歴に書かない）
// - 通貨の違う口座へ付け替えたら損益・手数料を空に戻し（currencyCleared）、元の通貨の口座へ戻したら開いたときの値に戻す
//   （#47 PR-2・A9・U33。保存済みの値は元の口座の通貨の金額なので、別の通貨の口座に持ち込まない）
// - チャート（#89）: 保存済みのチャートを読み戻してプレビューに置き（chart-slots.ts。記録する画面と同じもの）、追加・
//   差し替え・削除・付属の枠ができる。変更は [保存する] まで送らない。保存は取引の欄とチャートの変更を 1 要求
//   （PUT の multipart: 差し替え・足す画像 + 外す枠）で、API が 1 トランザクションで書く（失敗すれば取引もチャートも前のまま）。
//   [キャンセル]・画面を離れると捨てる（dispose でプレビューを閉じる）。足した枠の時間足は空から読み取りで埋める。
//   2 枠を差し替えたときは前に保存した時間足を残し、読めたら置き換える（失敗で終われば「前のチャートの時間足のまま」）。
//   読み取りの途中で保存したら、その枠は「指定なし」で保存する（#89 N2）。removeChart は利用者が [削除] した枠だけ。
//   判定のプレビューは今の枠（チャートの有無）で出し直す（保存の帯の「判定: 前 → 後」）
import {
  type AccountRecord,
  accountCurrencyOf,
  type InstrumentRecord,
  type StoredTrade,
  type TradeRecord,
} from '../../../core/record';
import type { Timeframe } from '../../../core/trade';
import { sortAccounts } from './accounts';
import { CHART_READ_TIMEOUT_MS } from './chart-read';
import {
  type ChartSlots,
  type ChartSlotsChange,
  type ChartsState,
  createChartSlots,
  keptReadingSlots,
} from './chart-slots';
import {
  ALL_SLOTS,
  type AnySlot,
  CHART_TIMEFRAME_FIELD,
  type ChartSlot,
  chartSaveTimeoutMs,
  type ExtraEntry,
  type ExtraSlot,
  extraNoteErrors,
  extraNoteTooLong,
  extrasBody,
  extrasFromRecord,
  isMainSlot,
  tradeFormData,
} from './charts';
import { accountCurrencyIn } from './currency';
import {
  draftFromStored,
  editBlock,
  editContext,
  editPreview,
  editSnapshot,
  mergeEdit,
  type OrphanTimeframe,
  orphanTimeframes,
} from './edit-form';
import type { ImageType } from './image-limits';
import { resolveInstrument } from './instrument-resolve';
import {
  applyDraft,
  type Draft,
  type DraftAction,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  type FxPair,
  fxPairOf,
  fxStale,
  fxVisibleOf,
  type Preview,
  readDraft,
  refineFxBasis,
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
  currentSnapshot,
  RESNAPSHOT_QUERY,
  type ResnapshotOffer,
  resnapshotOffer,
  withoutStaleFx,
} from './resnapshot';
import type { PrepareResult, PreviewHandle } from './statement-image';
import { loadChartPreview, tradePath } from './trade-detail-controller';
import { CHART_PREPARING } from './verdict-notes';

/** ほかの画面でチャートが変わっていて、この画面の並びと食い違う（API の 400 noChart / noEntry。#89） */
export const EDIT_CHARTS_CHANGED =
  'ほかの画面でチャートが変わったため保存できませんでした。再読み込みしてから、もう一度編集してください。';

export const EDIT_LOAD_FAILED =
  '取引を読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const EDIT_SAVE_FAILED =
  '保存できませんでした。入力内容は残っています。もう一度 [保存] を押してください。';
export const EDIT_VALUES_CHANGED =
  '開いてから口座・銘柄の値が変わりました。表示を今の値に更新したので、確認してから、もう一度 [保存] を押してください。';
export const EDIT_NETWORK_FAILED =
  '通信できませんでした。入力内容は残っています。もう一度 [保存] を押してください（二重には保存されません）。';

export type EditPhase =
  | 'loading'
  | 'notFound'
  | 'blocked'
  | 'loadFailed'
  | 'editing'
  | 'saving'
  | 'saved';

export interface EditState {
  readonly phase: EditPhase;
  readonly trade: StoredTrade | null;
  readonly instruments: readonly InstrumentRecord[];
  /** 口座（名前の順。#47） */
  readonly accounts: readonly AccountRecord[];
  readonly draft: Draft;
  /** 開いたときの下書き（手数料・時刻を変えたかを見る） */
  readonly initial: Draft;
  readonly read: DraftReading;
  /** 判定・R・リスク（保存する記録で計算。足りない欄があれば readDraft のプレビュー） */
  readonly preview: Preview;
  /** 直す前（開いたとき）の判定・R・リスク（保存した取引のまま） */
  readonly before: Summary;
  /** チャートの無い枠の時間足（保存で外す） */
  readonly orphans: readonly OrphanTimeframe[];
  /** 直せない理由（phase = blocked） */
  readonly block: string | null;
  /** 写した値と今の値の違い（違わなければ null。#31） */
  readonly offer: ResnapshotOffer | null;
  /** 今の値で計算し直すを選んでいる（offer があるときだけ効く） */
  readonly refresh: boolean;
  /** 通貨の違う口座へ付け替えて、損益・手数料を空に戻した（U33 の知らせと「ほかの欄」を開く） */
  readonly currencyCleared: boolean;
  /** そのとき打ってあった為替も空に戻した（知らせに「為替」を足す） */
  readonly fxCleared: boolean;
  readonly error: string | null;
  readonly errorKind?: FailureKind;
  /** チャートの枠（保存済み・足した・差し替えた。#89） */
  readonly charts?: ChartsState;
  /** 付属のチャートの行（追加した順。#89） */
  readonly extras: readonly ExtraEntry[];
  /** 保存でチャートの画像を送っている（帯の文を「チャートを送っています…」に。#89） */
  readonly sendingCharts?: true;
}

export interface EditController {
  getState(): EditState;
  subscribe(fn: (s: EditState) => void): () => void;
  load(): Promise<void>;
  update(action: DraftAction): void;
  /** 計算に使う値: true = 今の値、false = 記録したとき（#31。違いが無ければ何もしない） */
  setRefresh(on: boolean): void;
  save(): Promise<void>;
  /** チャートを枠に入れる（描き直してプレビュー・時間足の読み取り。送るのは [保存する]。#89） */
  setChart(slot: AnySlot, file: Blob): Promise<void>;
  /** [削除]: 枠のチャートと時間足を消す（付属の枠は行ごと。保存済みのチャートは [保存する] で消える） */
  removeChart(slot: AnySlot): void;
  /** [＋ チャートを追加] */
  addExtraChart(): ExtraSlot | null;
  setExtraTimeframe(slot: ExtraSlot, value: Timeframe | null): void;
  setExtraNote(slot: ExtraSlot, note: string): void;
  /** [〈読めた値〉にする] */
  acceptChartTimeframe(slot: AnySlot): void;
  /** [元に戻す]: 削除・差し替えした枠を保存済みのチャートに戻す */
  restoreChart(slot: AnySlot): void;
  dispose(): void;
}

const EMPTY_CTX: DraftContext = { instruments: [], accounts: [] };

/** 保存する記録（足りない欄・誤りがあれば undefined）。銘柄の ID は決まっていなければ仮の値 */
function mergedOf(
  trade: StoredTrade,
  initial: Draft,
  draft: Draft,
  read: DraftReading,
  instrumentId: string,
  ctx: DraftContext,
): TradeRecord | undefined {
  return read.body === undefined
    ? undefined
    : mergeEdit(
        trade.record,
        initial,
        draft,
        read.body,
        instrumentId,
        fxOpts(read, ctx, initial, draft),
      );
}

/** 為替の保ち方: 欄が出ていれば下書き、出ていなければ為替が意味を失っていないとき（fxStale でない）だけ元の為替を保つ */
function fxOpts(read: DraftReading, ctx: DraftContext, initial: Draft, draft: Draft) {
  return {
    fxShown: fxVisibleOf(editSnapshot(read, ctx, draft)),
    keepOriginalFx: !fxStale(fxPairOf(initial, ctx), fxPairOf(draft, ctx)),
  };
}

/** 2 つの組が同じか（価格の通貨と口座の通貨） */
const samePair = (a: FxPair, b: FxPair) => a.price === b.price && a.account === b.account;

/** 下書きの口座の通貨（元の口座なら取引に写した通貨、付け替えたら付け替え先の今の通貨） */
function draftCurrency(
  trade: StoredTrade,
  accounts: readonly AccountRecord[],
  draft: Pick<Draft, 'accountId'>,
): string {
  const ctx = editContext(trade, [], accounts);
  const id = draft.accountId === '' ? ctx.base?.accountId : draft.accountId;
  if (id === ctx.base?.accountId) return accountCurrencyOf(trade.snapshot);
  return accountCurrencyIn(accounts, id ?? '');
}

export function createEditController(deps: {
  readonly api: ApiFn;
  readonly id: string;
  readonly timeoutMs?: number;
  /** 画像を送る形に描き直す（画面が statement-image.ts の prepareImage を渡す。テストは偽物。#89） */
  readonly prepare?: (file: Blob) => Promise<PrepareResult>;
  /** 保存済みのチャートを canvas に描ける形にする（画面は browserCodec.preview。省けば読み戻さない） */
  readonly preview?: (bytes: Uint8Array, type: ImageType) => Promise<PreviewHandle>;
  readonly readTimeoutMs?: number;
}): EditController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: EditState) => void>();
  const emptyRead = readDraft(EMPTY_DRAFT, EMPTY_CTX);
  let state: EditState = {
    phase: 'loading',
    trade: null,
    instruments: [],
    accounts: [],
    draft: EMPTY_DRAFT,
    initial: EMPTY_DRAFT,
    read: emptyRead,
    preview: emptyRead.preview,
    before: { noLc: false },
    orphans: [],
    block: null,
    offer: null,
    refresh: false,
    currencyCleared: false,
    fxCleared: false,
    error: null,
    extras: [],
  };
  let inflight: Promise<void> | null = null;
  let gen = 0;
  let disposed = false;

  const emit = () => {
    for (const fn of listeners) fn(state);
  };

  /** 下書きを読み直して状態を置く（「窓・滑りでしたか」の問いが消えたら答えも消す。記録する画面と同じ） */
  const withDraft = (
    trade: StoredTrade,
    instruments: readonly InstrumentRecord[],
    accounts: readonly AccountRecord[],
    draft0: Draft,
    initial: Draft,
    refresh: boolean,
  ) => {
    const ctx = editContext(trade, instruments, accounts, {
      entry: slots.has('entry'),
      exit: slots.has('exit'),
    });
    let draft = draft0;
    let read = readDraft(draft, ctx);
    // ただし開いたときのまま（触っていない）答えは残す（保存で書き換えない。mergeEdit）
    if (
      !read.preview.showGapSlip &&
      draft.gapSlip !== 'unanswered' &&
      draft.gapSlip !== initial.gapSlip
    ) {
      draft = { ...draft, gapSlip: 'unanswered' };
      read = readDraft(draft, ctx);
    }
    const id = read.instrument.matchedId ?? trade.record.instrumentId;
    const merged = mergedOf(trade, initial, draft, read, id, ctx);
    const stored = editSnapshot(read, ctx, draft);
    const offer = resnapshotOffer(stored, currentSnapshot(read, ctx, draft), merged);
    const snapshot = refresh && offer !== null ? offer.snapshot : stored;
    // 今の値で通貨の組（価格の通貨 / 口座の通貨）が変わるなら、打った為替は今の組では意味を失うので外して計算する（#47 PR-2）
    const forPreview =
      refresh && offer !== null && merged !== undefined
        ? withoutStaleFx(merged, stored, snapshot)
        : merged;
    // チャートの描き直し中・付属の一言が長すぎる間は保存しない（記録する画面と同じ。#89）
    let gated = read;
    if (slots.preparing()) {
      gated = { ...gated, canSave: false, notice: gated.notice ?? CHART_PREPARING };
    }
    if (extraNoteErrors(slots.view().extras).length > 0) {
      gated = { ...gated, canSave: false, notice: gated.notice ?? extraNoteTooLong };
    }
    return {
      draft,
      read: gated,
      offer,
      preview: editPreview(read, forPreview, snapshot),
      orphans: orphanTimeframes(trade, (s) => slots.has(s)),
    };
  };

  const set = (patch: Partial<EditState>) => {
    // 失敗の種類は失敗の文言がある間だけ持つ
    const next: EditState = { ...state, ...patch };
    if (next.error === null) {
      const { errorKind: _gone, ...rest } = next;
      state = rest;
    } else {
      state = next;
    }
    emit();
  };

  /** 為替の基準の組（開いたときの組 → 為替を打ったときの組）と、規則で空にしたか（#47 PR-2） */
  let fxBasis: FxPair = { price: null, account: 'JPY', matched: false };
  let fxAutoCleared = false;

  /** チャートの枠（chart-slots.ts。記録する画面と同じもの） */
  const slots: ChartSlots = createChartSlots({
    request,
    readTimeoutMs: deps.readTimeoutMs ?? CHART_READ_TIMEOUT_MS,
    ...(deps.prepare ? { prepare: deps.prepare } : {}),
    timeframeOf: (slot) => state.draft[CHART_TIMEFRAME_FIELD[slot]],
    commit: (c: ChartSlotsChange) => {
      const trade = state.trade;
      if (disposed || trade === null || state.phase === 'loading') return;
      let draft = state.draft;
      for (const [slot, tf] of Object.entries(c.timeframes ?? {})) {
        draft = { ...draft, [CHART_TIMEFRAME_FIELD[slot as ChartSlot]]: tf };
      }
      state = { ...state, charts: c.view.charts, extras: c.view.extras };
      const next = withDraft(
        trade,
        state.instruments,
        state.accounts,
        draft,
        state.initial,
        state.refresh,
      );
      set({
        ...next,
        ...(next.offer === null ? { refresh: false } : {}),
        ...(c.authExpired ? { error: AUTH_EXPIRED, errorKind: 'auth' as const } : {}),
      });
    },
  });

  /** 保存済みのチャートを読み戻して枠に置く（読めない枠は「読み込めませんでした」。差し替え・削除はできる） */
  const loadStoredCharts = async (trade: StoredTrade, my: number) => {
    const stored = ALL_SLOTS.filter((s) => trade.charts?.[s] !== undefined);
    const preview = deps.preview;
    if (!preview) return;
    await Promise.all(
      stored.map(async (slot) => {
        let handle: PreviewHandle | null = null;
        try {
          handle = await loadChartPreview(request, deps.id, slot, preview);
        } catch {
          handle = null;
        }
        // 開き直した・離れた後に届いた応答は捨てる（差し替え・削除の後でも元のチャートとして持つ = [元に戻す]）
        if (my !== gen || disposed) {
          handle?.close();
          return;
        }
        slots.setStored(slot, handle);
      }),
    );
  };

  const load = async () => {
    const my = ++gen;
    set({ phase: 'loading', error: null });
    try {
      const [res, inst, acc] = await Promise.all([
        request(tradePath(deps.id)),
        request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
        request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
      ]);
      if (my !== gen || disposed) return;
      if (res.status === 404) {
        set({ phase: 'notFound', error: null });
        return;
      }
      const trade = await getJson<StoredTrade>(res, 200);
      if (
        !trade ||
        typeof trade !== 'object' ||
        !Array.isArray(inst?.items) ||
        !Array.isArray(acc?.items)
      ) {
        throw new Failed('other');
      }
      if (my !== gen || disposed) return;
      const accounts = sortAccounts(acc.items);
      const block = editBlock(trade);
      if (block !== null) {
        set({ phase: 'blocked', trade, instruments: inst.items, accounts, block, error: null });
        return;
      }
      const initial = draftFromStored(trade, inst.items);
      fxBasis = fxPairOf(initial, editContext(trade, inst.items, accounts));
      fxAutoCleared = false;
      // 保存済みのチャートは読み戻すまで「読み込んでいます」（チャートはある = 判定・時間足の欄はそのまま）
      slots.clear();
      for (const slot of ALL_SLOTS) {
        if (trade.charts?.[slot] === undefined) continue;
        slots.markStored(slot, isMainSlot(slot) ? initial[CHART_TIMEFRAME_FIELD[slot]] : null);
      }
      slots.init(extrasFromRecord(trade.record.extraCharts).filter((e) => slots.has(e.slot)));
      state = { ...state, trade, charts: slots.view().charts, extras: slots.view().extras };
      const next = withDraft(trade, inst.items, accounts, initial, initial, false);
      set({
        phase: 'editing',
        trade,
        instruments: inst.items,
        accounts,
        initial,
        ...next,
        before: summarize(trade),
        block: null,
        refresh: false,
        currencyCleared: false,
        fxCleared: false,
        error: null,
      });
      await loadStoredCharts(trade, my);
    } catch (e) {
      if (my !== gen || disposed) return;
      const kind = kindOf(e);
      set({
        phase: 'loadFailed',
        error: kind === 'auth' ? AUTH_EXPIRED : EDIT_LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  /** 400 の理由が、チャートの並び・有無の食い違い（ほかの画面でチャートが変わった）か */
  const chartsConflict = async (res: Response): Promise<boolean> => {
    try {
      const j = (await res.clone().json()) as { issues?: { kind?: unknown }[] };
      return (j.issues ?? []).some((i) => i.kind === 'noChart' || i.kind === 'noEntry');
    } catch {
      return false;
    }
  };

  /** チャートの変更（差し替え・足す画像と外す枠）。変更が無ければ null（今の JSON の PUT） */
  const chartChanges = (trade: StoredTrade) => {
    const uploads = slots.uploads();
    // removeChart を送るのは、利用者が [削除] した保存済みの枠だけ（差し替えの失敗などで黙って消さない。#89 R1）
    const removes = slots.removedSlots().filter((s) => trade.charts?.[s] !== undefined);
    if (Object.keys(uploads).length === 0 && removes.length === 0) return null;
    return { uploads, removes };
  };

  const doSave = async () => {
    // 2 枠を差し替えて時間足の読み取りの途中なら、前のチャートの時間足を新しいチャートに付けず「指定なし」で保存する
    // （保存の前の帯で知らせる。利用者が選んだ値はそのまま。#89 N2）
    const keptReading = keptReadingSlots(state.charts);
    if (keptReading.length > 0 && state.phase === 'editing' && state.trade !== null) {
      let d = state.draft;
      for (const slot of keptReading) d = { ...d, [CHART_TIMEFRAME_FIELD[slot]]: null };
      const next = withDraft(
        state.trade,
        state.instruments,
        state.accounts,
        d,
        state.initial,
        state.refresh,
      );
      state = { ...state, ...next };
    }
    const { trade, read, draft, initial } = state;
    // 「今の値」を選んでいて、記録したときの値と今の値が違うときだけ保存し直しを頼む（#31）
    const refresh = state.refresh && state.offer !== null;
    if (state.phase !== 'editing' || trade === null || !read.canSave || read.body === undefined) {
      return;
    }
    const body = read.body;
    // 終わっていない時間足の読み取りは止めて結果を捨てる（記録する画面と同じ。#27）
    const stopped = slots.stopReads();
    if (stopped.length > 0) state = { ...state, charts: slots.view().charts };
    set({ phase: 'saving', error: null });
    try {
      if (refresh) {
        // 開いてから口座・銘柄の今の値が変わっていたら、表示を更新して保存しない（N-6）
        const [inst2, acc2] = await Promise.all([
          request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
          request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
        ]);
        if (disposed) return;
        if (!Array.isArray(inst2?.items) || !Array.isArray(acc2?.items)) throw new Failed('other');
        const accounts2 = sortAccounts(acc2.items);
        const next = withDraft(trade, inst2.items, accounts2, draft, initial, true);
        const seen = JSON.stringify(state.offer?.snapshot);
        if (next.offer === null || JSON.stringify(next.offer.snapshot) !== seen) {
          set({
            phase: 'editing',
            instruments: inst2.items,
            accounts: accounts2,
            ...next,
            refresh: next.offer !== null,
            error: EDIT_VALUES_CHANGED,
          });
          // 保存の前に止めた時間足の読み取りを送り直す（#89 R3）
          slots.requeue(stopped);
          return;
        }
      }
      const inst = await resolveInstrument(
        request,
        read.instrument.name,
        read.instrument.matchedId,
        state.instruments,
      );
      // 足した銘柄は保存に失敗しても一覧に残す（次に押したときに同じ名前を足し直さない）
      if (inst.instruments !== state.instruments) set({ instruments: inst.instruments });
      const ctx = editContext(trade, state.instruments, state.accounts);
      const record0 = mergeEdit(
        trade.record,
        initial,
        draft,
        body,
        inst.id,
        fxOpts(read, ctx, initial, draft),
      );
      // 今の値で写し直す（#31）とき、通貨の組が変わるなら為替を外して送る（#47 PR-2。為替は組に縛られた値）
      const offer = state.offer;
      const merged =
        refresh && offer !== null
          ? withoutStaleFx(record0, editSnapshot(read, ctx, draft), offer.snapshot)
          : record0;
      const extraCharts = extrasBody(slots.view().extras, (x) => slots.has(x));
      const record: TradeRecord = { ...merged, ...(extraCharts ? { extraCharts } : {}) };
      // チャートの変更があれば取引と一緒に 1 要求（multipart。API が 1 トランザクションで書く）。無ければ今の JSON
      const changes = chartChanges(trade);
      const path = `${tradePath(deps.id)}${refresh ? RESNAPSHOT_QUERY : ''}`;
      if (changes) set({ sendingCharts: true });
      const res = changes
        ? await request(
            path,
            { method: 'PUT', body: tradeFormData(record, changes.uploads, changes.removes) },
            { ms: chartSaveTimeoutMs(changes.uploads) },
          )
        : await request(path, {
            method: 'PUT',
            headers: JSON_HEADERS,
            body: JSON.stringify(record),
          });
      if (disposed) return;
      if (res.status === 404) {
        set({ phase: 'notFound', error: null });
        return;
      }
      // 本文に付属の並びがあれば JSON の保存でも同じ食い違いが起きうる（#89 R4）
      if (
        (changes || record.extraCharts !== undefined) &&
        res.status === 400 &&
        (await chartsConflict(res))
      ) {
        unsend();
        set({ phase: 'editing', error: EDIT_CHARTS_CHANGED, errorKind: 'other' });
        slots.requeue(stopped);
        return;
      }
      const saved = await getJson<StoredTrade>(res, 200);
      unsend();
      set({ phase: 'saved', trade: saved, error: null });
    } catch (e) {
      if (disposed) return;
      unsend();
      const kind = kindOf(e);
      set({
        phase: 'editing',
        error:
          kind === 'auth'
            ? AUTH_EXPIRED
            : kind === 'network'
              ? EDIT_NETWORK_FAILED
              : EDIT_SAVE_FAILED,
        errorKind: kind,
      });
      // 編集に戻った: 保存の前に止めた時間足の読み取りを送り直す
      slots.requeue(stopped);
    }
  };

  const editing = () => state.phase === 'editing' && state.trade !== null;

  /** 送っている印を外す */
  function unsend() {
    if (state.sendingCharts) {
      const { sendingCharts: _s, ...rest } = state;
      state = rest;
    }
  }

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
      const trade = state.trade;
      if (state.phase !== 'editing' || trade === null) return;
      // チャートの時間足を利用者が選んだ: 後で届く読み取りで上書きせず、読み取りの印と知らせを消す（#27）
      if (action.type === 'set') {
        for (const slot of ['entry', 'exit'] as const) {
          if (action.field !== CHART_TIMEFRAME_FIELD[slot]) continue;
          slots.touch(slot, action.value as Timeframe | null);
          state = { ...state, charts: slots.view().charts };
        }
      }
      let draft = applyDraft(state.draft, action);
      let currencyCleared = state.currencyCleared;
      let fxCleared = state.fxCleared;
      if (action.type === 'set' && action.field === 'accountId') {
        const original = accountCurrencyOf(trade.snapshot);
        const before = draftCurrency(trade, state.accounts, state.draft);
        const after = draftCurrency(trade, state.accounts, draft);
        if (after !== before && after !== original) {
          // 通貨の違う口座へ: 損益・手数料を空に戻す（A9・U33）。付け替えた後に手で打った値も、通貨が変われば
          // その口座の通貨の金額ではなくなるので空にする（為替と同じ規則。再レビュー 3）
          draft = { ...draft, pnlYen: '', feeYen: '' };
          currencyCleared = true;
          fxCleared = state.draft.fxRate !== '';
        } else if (after === original && before !== original) {
          // 元の通貨へ戻した: 開いたときの値に戻す（保存の前なら取り消せる）
          draft = { ...draft, pnlYen: state.initial.pnlYen, feeYen: state.initial.feeYen };
          currencyCleared = false;
          fxCleared = false;
        }
      }
      // 為替: 意味を失う移り（口座の通貨が変わる・決まった価格の通貨どうしが違う。fxStale）なら空にし、開いたときの組へ
      // 戻したら開いたときの値に戻す（為替は組に縛られた値。#47 PR-2 のレビュー block）。銘柄の名前を打っている途中
      // （一覧に当たらない）では空にしない（再レビュー 2）
      const ctx = editContext(trade, state.instruments, state.accounts);
      const now = fxPairOf(draft, ctx);
      const initialPair = fxPairOf(state.initial, ctx);
      if (action.type === 'set' && action.field === 'fxRate') {
        fxBasis = now;
        fxAutoCleared = false;
      } else if (
        now.matched &&
        samePair(now, initialPair) &&
        (fxAutoCleared || fxStale(fxBasis, now))
      ) {
        // 開いたときの組へ戻した: 規則で空にした為替も、別の組で打った為替も、開いたときの値に戻す（3 回目の再レビュー 2）
        draft = { ...draft, fxRate: state.initial.fxRate };
        fxBasis = initialPair;
        fxAutoCleared = false;
      } else if (draft.fxRate !== '' && fxStale(fxBasis, now)) {
        draft = { ...draft, fxRate: '' };
        fxAutoCleared = true;
      } else {
        fxBasis = refineFxBasis(fxBasis, now);
      }
      const next = withDraft(
        trade,
        state.instruments,
        state.accounts,
        draft,
        state.initial,
        state.refresh,
      );
      // 違いが無くなったら選択も戻す（付け替えて戻したときに、押した覚えの無い「今の値」にならない。N-8）
      set({
        ...next,
        ...(next.offer === null ? { refresh: false } : {}),
        currencyCleared,
        fxCleared,
        error: null,
      });
    },
    setRefresh(on) {
      const trade = state.trade;
      if (state.phase !== 'editing' || trade === null) return;
      if (on && state.offer === null) return;
      const next = withDraft(
        trade,
        state.instruments,
        state.accounts,
        state.draft,
        state.initial,
        on,
      );
      set({ ...next, refresh: on, error: null });
    },
    save() {
      if (inflight) return inflight;
      const p = doSave().finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    async setChart(slot, file) {
      if (!editing()) return;
      state = { ...state, error: null };
      await slots.setChart(slot, file);
    },
    removeChart(slot) {
      if (!editing()) return;
      state = { ...state, error: null };
      slots.remove(slot);
    },
    addExtraChart() {
      if (!editing()) return null;
      return slots.addExtra();
    },
    setExtraTimeframe(slot, value) {
      if (editing()) slots.setExtraTimeframe(slot, value);
    },
    setExtraNote(slot, note) {
      if (editing()) slots.setExtraNote(slot, note);
    },
    acceptChartTimeframe(slot) {
      if (editing()) slots.accept(slot);
    },
    restoreChart(slot) {
      if (!editing()) return;
      state = { ...state, error: null };
      slots.restore(slot);
    },
    dispose() {
      disposed = true;
      gen++;
      slots.clear();
      listeners.clear();
    },
  };
}
