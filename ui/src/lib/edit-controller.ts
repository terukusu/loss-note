// 取引を直す画面の通信と状態（Issue #9 契約 U-3。設計書 C36・4 章の冒頭・7.5、ADR-0004 決定 5・ADR-0006 決定 7）。
// DOM を持たない。画面（pages/TradeEdit.tsx）は購読して描くだけ。
// - 開いたら取引と銘柄を並行に読み、保存した値の入った下書きを作る（edit-form.ts）。404 = notFound、
//   建てが複数・建てごとの LC の取引 = blocked
// - 下書きのたびに、写した資金・許容リスクで判定・R・リスクを出し直す（readDraft + editPreview）
// - 保存は PUT（JSON）。1 回押して 1 件（実行中は同じ Promise）。PUT は冪等なので、時間切れの後に送り直してよい。
//   チャートは変えない（チャートの無い枠の時間足は本文に入らない。orphanTimeframes をその旨として出す）
// - 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）。下書きは記憶の中だけ（端末の保存先・URL・履歴に書かない）
import type { InstrumentRecord, StoredTrade, TradeRecord } from '../../../core/record';
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
import { resolveInstrument } from './instrument-resolve';
import {
  applyDraft,
  type Draft,
  type DraftAction,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  type Preview,
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
import { tradePath } from './trade-detail-controller';

export const EDIT_LOAD_FAILED =
  '取引を読み込めませんでした。通信を確かめて、もう一度読み込んでください。';
export const EDIT_SAVE_FAILED =
  '保存できませんでした。入力はそのまま残っています。もう一度 [保存する] を押してください。';
export const EDIT_NETWORK_FAILED =
  'つながりません。入力はそのまま残っています。もう一度 [保存する] を押してください。';

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
  readonly error: string | null;
  readonly errorKind?: FailureKind;
}

export interface EditController {
  getState(): EditState;
  subscribe(fn: (s: EditState) => void): () => void;
  load(): Promise<void>;
  update(action: DraftAction): void;
  save(): Promise<void>;
  dispose(): void;
}

const EMPTY_CTX: DraftContext = {
  instruments: [],
  settings: { capitalYen: null, riskTolerancePct: 1 },
};

/** 保存する記録（足りない欄・誤りがあれば undefined）。銘柄の ID は決まっていなければ仮の値 */
function mergedOf(
  trade: StoredTrade,
  initial: Draft,
  draft: Draft,
  read: DraftReading,
  instrumentId: string,
): TradeRecord | undefined {
  return read.body === undefined
    ? undefined
    : mergeEdit(trade.record, initial, draft, read.body, instrumentId);
}

export function createEditController(deps: {
  readonly api: ApiFn;
  readonly id: string;
  readonly timeoutMs?: number;
}): EditController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: EditState) => void>();
  const emptyRead = readDraft(EMPTY_DRAFT, EMPTY_CTX);
  let state: EditState = {
    phase: 'loading',
    trade: null,
    instruments: [],
    draft: EMPTY_DRAFT,
    initial: EMPTY_DRAFT,
    read: emptyRead,
    preview: emptyRead.preview,
    before: { noLc: false },
    orphans: [],
    block: null,
    error: null,
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
    draft0: Draft,
    initial: Draft,
  ) => {
    const ctx = editContext(trade, instruments);
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
    const merged = mergedOf(trade, initial, draft, read, id);
    return { draft, read, preview: editPreview(read, merged, editSnapshot(read, ctx)) };
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

  const load = async () => {
    const my = ++gen;
    set({ phase: 'loading', error: null });
    try {
      const [res, inst] = await Promise.all([
        request(tradePath(deps.id)),
        request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
      ]);
      if (my !== gen || disposed) return;
      if (res.status === 404) {
        set({ phase: 'notFound', error: null });
        return;
      }
      const trade = await getJson<StoredTrade>(res, 200);
      if (!trade || typeof trade !== 'object' || !Array.isArray(inst?.items)) {
        throw new Failed('other');
      }
      if (my !== gen || disposed) return;
      const block = editBlock(trade);
      if (block !== null) {
        set({ phase: 'blocked', trade, instruments: inst.items, block, error: null });
        return;
      }
      const initial = draftFromStored(trade, inst.items);
      const next = withDraft(trade, inst.items, initial, initial);
      set({
        phase: 'editing',
        trade,
        instruments: inst.items,
        initial,
        ...next,
        before: summarize(trade),
        orphans: orphanTimeframes(trade),
        block: null,
        error: null,
      });
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

  const doSave = async () => {
    const { trade, read, draft, initial } = state;
    if (state.phase !== 'editing' || trade === null || !read.canSave || read.body === undefined) {
      return;
    }
    const body = read.body;
    set({ phase: 'saving', error: null });
    try {
      const inst = await resolveInstrument(
        request,
        read.instrument.name,
        read.instrument.matchedId,
        state.instruments,
      );
      // 足した銘柄は保存に失敗しても一覧に残す（次に押したときに同じ名前を足し直さない）
      if (inst.instruments !== state.instruments) set({ instruments: inst.instruments });
      const record = mergeEdit(trade.record, initial, draft, body, inst.id);
      const res = await request(tradePath(deps.id), {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(record),
      });
      if (disposed) return;
      if (res.status === 404) {
        set({ phase: 'notFound', error: null });
        return;
      }
      const saved = await getJson<StoredTrade>(res, 200);
      set({ phase: 'saved', trade: saved, error: null });
    } catch (e) {
      if (disposed) return;
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
      const trade = state.trade;
      if (state.phase !== 'editing' || trade === null) return;
      const next = withDraft(
        trade,
        state.instruments,
        applyDraft(state.draft, action),
        state.initial,
      );
      set({ ...next, error: null });
    },
    save() {
      if (inflight) return inflight;
      const p = doSave().finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    dispose() {
      disposed = true;
      gen++;
      listeners.clear();
    },
  };
}
