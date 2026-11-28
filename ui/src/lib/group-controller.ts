// 両建てのまとまりの通信と状態（#267。設計書 4.8・7.7・ADR-0027）。DOM を持たない。
// - 読む: GET /api/position-groups（本人のまとまりすべて）と、メンバーの取引（GET /api/trades/{id}。1 件ずつ並行に）
// - 結ぶ: POST /api/position-groups、直す: PUT /api/position-groups/{id}、解く: DELETE /api/position-groups/{id}
// - 相手を選ぶシートは今の範囲の入口（GET /api/trades?exitFrom&exitTo）で候補を読む（新しい入口を足さない。7.7）
// 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）
import type { EmotionTagId } from '../../../core/emotion-tags';
import type {
  AccountRecord,
  GroupExitBody,
  GroupRole,
  InstrumentRecord,
  StoredPositionGroup,
  StoredTrade,
} from '../../../core/record';
import { isEmptyReflection, type Reflection } from '../../../core/reflection';
import type { Side } from '../../../core/trade';
import {
  conflictReason,
  defaultMainSide,
  GROUPS_PATH,
  type GroupIndex,
  type GroupState,
  groupBody,
  groupIndexOf,
  groupPath,
  groupStateOf,
  isGroup,
  type PickerSections,
  parseGroupList,
  pickerSections,
  pickRange,
  rolesOf,
} from './position-group';
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
  type RequestFn,
} from './request';
import { tradesPath } from './trade-pages';

export const GROUP_LOAD_FAILED =
  '両建てのまとまりを読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const GROUP_SAVE_FAILED = '保存できませんでした。もう一度押してください。';
export const GROUP_NETWORK_FAILED = '通信できませんでした。もう一度押してください。';
export const GROUP_IN_OTHER =
  'ほかの両建てのまとまりに入っている取引があります。画面を再読み込みしてから変更してください。';
export const GROUP_GONE =
  '選んだ取引が見つかりません（削除された可能性があります）。選択を変更してください。';
export const GROUP_SHAPE = 'この組み合わせでは結べません。向きと銘柄を確認してください。';
export const GROUP_CANDIDATES_FAILED =
  '候補を読み込めませんでした。通信状況を確認して、もう一度開いてください。';

/** 本人のまとまりをすべて読む（形が違えば Failed） */
export async function readGroups(request: RequestFn): Promise<readonly StoredPositionGroup[]> {
  const list = parseGroupList(await getJson<unknown>(await request(GROUPS_PATH), 200));
  if (!list) throw new Failed('other');
  return list;
}

/** 取引を 1 件読む（404 = null） */
export async function readTrade(request: RequestFn, id: string): Promise<StoredTrade | null> {
  const res = await request(`/api/trades/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const t = await getJson<StoredTrade>(res, 200);
  if (!t || typeof t !== 'object' || typeof t.id !== 'string') throw new Failed('other');
  return t;
}

/** まとまりのメンバーの取引のうち、known に無いものを読む（無い取引は入れない = 崩れたまとまり） */
export async function readMembers(
  request: RequestFn,
  groups: readonly StoredPositionGroup[],
  known: ReadonlyMap<string, StoredTrade>,
): Promise<Map<string, StoredTrade>> {
  const byId = new Map(known);
  const missing = [
    ...new Set(
      groups.flatMap((g) => g.members.map((m) => m.tradeId)).filter((id) => !byId.has(id)),
    ),
  ];
  const got = await Promise.all(missing.map((id) => readTrade(request, id)));
  for (const t of got) if (t) byId.set(t.id, t);
  return byId;
}

/**
 * 一覧の行のためのまとまりの索引（6.5）: 逆参照を持つ取引があるときだけ、まとまりの一覧と、読んでいないメンバーの取引を読む。
 * 逆参照を持つ取引が無ければ要求を送らず null
 */
export async function loadGroupIndex(
  request: RequestFn,
  trades: readonly StoredTrade[],
): Promise<GroupIndex | null> {
  const refs = new Set(trades.flatMap((t) => (t.positionGroupId ? [t.positionGroupId] : [])));
  if (refs.size === 0) return null;
  const groups = (await readGroups(request)).filter((g) => refs.has(g.id));
  const byId = await readMembers(request, groups, new Map(trades.map((t) => [t.id, t])));
  return groupIndexOf(groups, byId, refs);
}

/** 取引の詳細のためのまとまり（逆参照の指す先。無ければ null = 単独の取引） */
export async function loadGroupOf(
  request: RequestFn,
  trade: StoredTrade,
): Promise<{ readonly state: GroupState; readonly byId: ReadonlyMap<string, StoredTrade> } | null> {
  const gid = trade.positionGroupId;
  if (gid === undefined) return null;
  const g = (await readGroups(request)).find((x) => x.id === gid);
  if (!g) return null;
  const byId = await readMembers(request, [g], new Map([[trade.id, trade]]));
  return { state: groupStateOf(g, byId), byId };
}

/** 書きの失敗 → 決まった文言 */
async function writeError(res: Response | null, kind: FailureKind): Promise<string> {
  if (kind === 'auth') return AUTH_EXPIRED;
  if (kind === 'network') return GROUP_NETWORK_FAILED;
  if (res?.status === 409 && (await conflictReason(res)) === 'inOtherGroup') return GROUP_IN_OTHER;
  if (res?.status === 404) return GROUP_GONE;
  if (res?.status === 400) return GROUP_SHAPE;
  return GROUP_SAVE_FAILED;
}

// ── まとまりの画面 ──

export type GroupScreenState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'notFound' }
  | { readonly phase: 'loadFailed'; readonly error: string; readonly errorKind: FailureKind }
  | {
      readonly phase: 'ready';
      readonly group: StoredPositionGroup;
      readonly state: GroupState;
      readonly byId: ReadonlyMap<string, StoredTrade>;
      readonly instruments: readonly InstrumentRecord[];
      readonly accounts: readonly AccountRecord[];
      /** 送っている書き（直す・解く） */
      readonly saving: 'exit' | 'unlink' | null;
      readonly error: string | null;
    };

export interface GroupController {
  getState(): GroupScreenState;
  subscribe(fn: (s: GroupScreenState) => void): () => void;
  load(): Promise<void>;
  /** 上書きを置き換える（undefined = 上書きを消す）。保存できたら true */
  saveExit(exit: GroupExitBody | undefined): Promise<boolean>;
  /** 解く。解けたら true */
  unlink(): Promise<boolean>;
  /** 心理のタグを保存できた（すべてのメンバーに同じ集合。6.5） */
  applyEmotionTags(tags: readonly EmotionTagId[]): void;
  /** Good / More を保存できた（すべてのメンバーに同じ値。6.5） */
  applyReflection(r: Reflection): void;
  /** 誤りの文を消す */
  clearError(): void;
  dispose(): void;
}

export function createGroupController(deps: {
  readonly api: ApiFn;
  readonly id: string;
  readonly timeoutMs?: number;
}): GroupController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: GroupScreenState) => void>();
  let state: GroupScreenState = { phase: 'loading' };
  let gen = 0;
  let disposed = false;
  const set = (s: GroupScreenState) => {
    if (disposed) return;
    state = s;
    for (const fn of listeners) fn(state);
  };
  const rebuild = (g: StoredPositionGroup, byId: ReadonlyMap<string, StoredTrade>) => {
    if (state.phase !== 'ready') return;
    set({ ...state, group: g, byId, state: groupStateOf(g, byId) });
  };
  const mapTrades = (fn: (t: StoredTrade) => StoredTrade) => {
    if (state.phase !== 'ready') return;
    const ids = new Set(state.group.members.map((m) => m.tradeId));
    const byId = new Map([...state.byId].map(([k, t]) => [k, ids.has(k) ? fn(t) : t]));
    rebuild(state.group, byId);
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
    async load() {
      const my = ++gen;
      set({ phase: 'loading' });
      try {
        const [groups, inst, acc] = await Promise.all([
          readGroups(request),
          request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
          request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
        ]);
        if (my !== gen) return;
        if (!Array.isArray(inst?.items) || !Array.isArray(acc?.items)) throw new Failed('other');
        const g = groups.find((x) => x.id === deps.id);
        if (!g) {
          set({ phase: 'notFound' });
          return;
        }
        const byId = await readMembers(request, [g], new Map());
        if (my !== gen) return;
        set({
          phase: 'ready',
          group: g,
          byId,
          state: groupStateOf(g, byId),
          instruments: inst.items,
          accounts: acc.items,
          saving: null,
          error: null,
        });
      } catch (e) {
        if (my !== gen) return;
        const kind = kindOf(e);
        set({
          phase: 'loadFailed',
          error: kind === 'auth' ? AUTH_EXPIRED : GROUP_LOAD_FAILED,
          errorKind: kind,
        });
      }
    },
    async saveExit(exit) {
      const s = state;
      if (s.phase !== 'ready' || s.saving !== null) return false;
      set({ ...s, saving: 'exit', error: null });
      let res: Response | null = null;
      try {
        res = await request(groupPath(s.group.id), {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify(groupBody(s.group.members, exit)),
        });
        const saved = await getJson<unknown>(res, 200);
        if (!isGroup(saved)) throw new Failed('other');
        const cur = state;
        if (cur.phase !== 'ready') return false;
        set({ ...cur, saving: null, group: saved, state: groupStateOf(saved, cur.byId) });
        return true;
      } catch (e) {
        const cur = state;
        if (cur.phase === 'ready')
          set({ ...cur, saving: null, error: await writeError(res, kindOf(e)) });
        return false;
      }
    },
    async unlink() {
      const s = state;
      if (s.phase !== 'ready' || s.saving !== null) return false;
      set({ ...s, saving: 'unlink', error: null });
      let res: Response | null = null;
      try {
        res = await request(groupPath(s.group.id), { method: 'DELETE' });
        // 既に無い（ほかのタブで解いた）も解けた扱い
        if (res.status !== 204 && res.status !== 404) throw new Failed('other');
        const cur = state;
        if (cur.phase === 'ready') set({ ...cur, saving: null });
        return true;
      } catch (e) {
        const cur = state;
        if (cur.phase === 'ready')
          set({ ...cur, saving: null, error: await writeError(res, kindOf(e)) });
        return false;
      }
    },
    applyEmotionTags(tags) {
      mapTrades((t) => {
        const { emotionTags: _old, ...rest } = t;
        return tags.length > 0 ? { ...rest, emotionTags: [...tags] } : rest;
      });
    },
    applyReflection(r) {
      mapTrades((t) => {
        const { reflection: _old, ...rest } = t;
        return isEmptyReflection(r) ? rest : { ...rest, reflection: r };
      });
    },
    clearError() {
      if (state.phase === 'ready' && state.error !== null) set({ ...state, error: null });
    },
    dispose() {
      gen++;
      listeners.clear();
      disposed = true;
    },
  };
}

// ── 相手を選ぶシート（7.7） ──

export type PickerState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed'; readonly error: string }
  | {
      readonly phase: 'ready';
      readonly sections: PickerSections;
      /** 選んだ取引の ID（押した順） */
      readonly selected: readonly string[];
      /** 本玉の向き（null = 既定 = 最初にエントリーした取引の側） */
      readonly mainSide: Side | null;
      readonly saving: boolean;
      readonly error: string | null;
    };

export interface PickerController {
  getState(): PickerState;
  subscribe(fn: (s: PickerState) => void): () => void;
  load(): Promise<void>;
  toggle(id: string): void;
  /** 役割を入れ替える（本玉の向きを逆に） */
  swap(): void;
  /** 選んだ取引と役割（base を先頭に） */
  members(): readonly { readonly trade: StoredTrade; readonly role: GroupRole }[];
  /** 結ぶ。結べたらまとまりの ID、だめなら null（誤りは状態に） */
  link(): Promise<string | null>;
  dispose(): void;
}

export function createPickerController(deps: {
  readonly request: RequestFn;
  readonly base: StoredTrade;
  readonly instruments: readonly InstrumentRecord[];
}): PickerController {
  const { base, request } = deps;
  const listeners = new Set<(s: PickerState) => void>();
  let state: PickerState = { phase: 'loading' };
  let pool = new Map<string, StoredTrade>();
  let disposed = false;
  let gen = 0;
  const set = (s: PickerState) => {
    if (disposed) return;
    state = s;
    for (const fn of listeners) fn(state);
  };
  const picked = (): StoredTrade[] =>
    state.phase === 'ready' ? state.selected.flatMap((id) => pool.get(id) ?? []) : [];
  const sideNow = (): Side => {
    const p = picked();
    return state.phase === 'ready' && state.mainSide !== null
      ? state.mainSide
      : defaultMainSide(base, p);
  };
  const self: PickerController = {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    async load() {
      const my = ++gen;
      set({ phase: 'loading' });
      try {
        const body = await getJson<{ items?: unknown }>(
          await request(tradesPath(pickRange(base))),
          200,
        );
        if (!Array.isArray(body?.items)) throw new Failed('other');
        if (my !== gen) return;
        const items = body.items as StoredTrade[];
        pool = new Map(items.map((t) => [t.id, t]));
        set({
          phase: 'ready',
          sections: pickerSections(base, items, deps.instruments),
          selected: [],
          mainSide: null,
          saving: false,
          error: null,
        });
      } catch (e) {
        if (my !== gen) return;
        set({
          phase: 'failed',
          error: kindOf(e) === 'auth' ? AUTH_EXPIRED : GROUP_CANDIDATES_FAILED,
        });
      }
    },
    toggle(id) {
      const s = state;
      if (s.phase !== 'ready' || s.saving || !pool.has(id)) return;
      const selected = s.selected.includes(id)
        ? s.selected.filter((x) => x !== id)
        : [...s.selected, id];
      // 選び直したら役割の入れ替えは既定へ戻す（選んだ組で最初にエントリーした側が本玉）
      set({ ...s, selected, mainSide: null, error: null });
    },
    swap() {
      const s = state;
      if (s.phase !== 'ready' || s.saving) return;
      const now = sideNow();
      set({ ...s, mainSide: now === 'L' ? 'S' : 'L', error: null });
    },
    members() {
      return rolesOf(base, picked(), sideNow());
    },
    async link() {
      const s = state;
      if (s.phase !== 'ready' || s.saving) return null;
      const members = self.members();
      set({ ...s, saving: true, error: null });
      let res: Response | null = null;
      try {
        res = await request(GROUPS_PATH, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(
            groupBody(members.map((m) => ({ tradeId: m.trade.id, role: m.role }))),
          ),
        });
        const saved = await getJson<unknown>(res, 201);
        if (!isGroup(saved)) throw new Failed('other');
        const cur = state;
        if (cur.phase === 'ready') set({ ...cur, saving: false });
        return saved.id;
      } catch (e) {
        const cur = state;
        if (cur.phase === 'ready')
          set({ ...cur, saving: false, error: await writeError(res, kindOf(e)) });
        return null;
      }
    },
    dispose() {
      disposed = true;
      gen++;
      listeners.clear();
    },
  };
  return self;
}
