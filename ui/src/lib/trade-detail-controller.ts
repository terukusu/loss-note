// 取引の詳細の通信と状態（Issue #9 契約 U-2。設計書 7.5・9.2、ADR-0006 決定 4）。DOM を持たない。
// - 開いたら取引（GET /api/trades/{id}）と銘柄・口座（#47）を並行に読む。404（無い ID・ほかの利用者の取引）は notFound
// - チャートのある枠だけ GET /api/trades/{id}/charts/{slot} を読み、形式と寸法を imageInfo で確かめてから、差し込まれた
//   preview（画面は statement-image.ts の browserCodec.preview）で canvas に描ける handle にする。object URL・data URL を
//   作らない。読めなかった枠は failed（その枠だけ [もう一度読み込む]）。画面を離れたら（dispose）handle を close する
// - 画像・取引は記憶の中だけ（端末の保存先・URL・履歴に書かない）。失敗は決まった文言だけ
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import { isEmptyReflection, type Reflection } from '../../../core/reflection';
import { ALL_SLOTS, type AnySlot, type ChartSlot, type ExtraSlot } from './charts';
import { loadGroupOf } from './group-controller';
import { type ImageType, imageInfo } from './image-limits';
import { type GroupState, groupPath } from './position-group';
import { type Summary, summarize } from './record-form';
import {
  type ApiFn,
  AUTH_EXPIRED,
  createRequest,
  Failed,
  type FailureKind,
  getJson,
  kindOf,
  REQUEST_TIMEOUT_MS,
  type RequestFn,
} from './request';
import type { PreviewHandle } from './statement-image';
import { instrumentNameOf } from './trade-view';

export const DETAIL_LOAD_FAILED =
  '取引を読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const CHART_LOAD_FAILED = 'チャートを読み込めませんでした';
/** チャートの読みの時間の上限（1 枚 最大 500 KB） */
export const CHART_READ_TIMEOUT_MS = 30_000;

export type ChartView =
  | { readonly phase: 'none' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly preview: PreviewHandle }
  | { readonly phase: 'failed' };

/**
 * 両建てのまとまり（#267・7.7）: none = メンバーでない（逆参照が無い・指す先が無い）/ loading / failed = 読めなかった
 * （単独の判定を出さない）/ ready = まとまりの状態（ok なら判定のカードの代わりにまとまりへの 1 行、broken なら単独の判定と ［解く］）
 */
export type GroupDetail =
  | { readonly phase: 'none' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed' }
  | {
      readonly phase: 'ready';
      readonly state: GroupState;
      readonly byId: ReadonlyMap<string, StoredTrade>;
      /** 解いている */
      readonly unlinking?: boolean;
      readonly error?: string;
    };

export const GROUP_UNLINK_FAILED = '解けませんでした。通信状況を確認して、もう一度押してください。';

export type DetailState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'notFound' }
  | { readonly phase: 'loadFailed'; readonly error: string; readonly errorKind: FailureKind }
  | {
      readonly phase: 'ready';
      readonly trade: StoredTrade;
      readonly instruments: readonly InstrumentRecord[];
      readonly accounts: readonly AccountRecord[];
      readonly instrumentName: string;
      readonly summary: Summary;
      /** エントリー時・決済時は常に、付属の枠（#89）は画像のある枠だけ */
      readonly charts: Readonly<Record<ChartSlot, ChartView>> &
        Readonly<Partial<Record<ExtraSlot, ChartView>>>;
      /** 両建てのまとまり（#267。省いた = none） */
      readonly group?: GroupDetail;
    };

export interface DetailController {
  getState(): DetailState;
  subscribe(fn: (s: DetailState) => void): () => void;
  load(): Promise<void>;
  /** 読めなかった枠を読み直す */
  reloadChart(slot: AnySlot): Promise<void>;
  /** 心理のタグを保存できた: 読んだ取引のタグだけを差し替える（#156。判定・チャートは変えない） */
  applyEmotionTags(tags: readonly EmotionTagId[]): void;
  /** Good / More を保存できた: 読んだ取引の Good / More だけを差し替える（#123。判定・チャートは変えない） */
  applyReflection(r: Reflection): void;
  /** 両建てのまとまりを読み直す（読めなかったとき） */
  reloadGroup(): Promise<void>;
  /** 崩れたまとまりを解く（DELETE。解けたら取引を読み直す）。解けたら true */
  unlinkGroup(): Promise<boolean>;
  /** 画面を離れた: チャートの handle を close し、後で届いた応答を捨てる */
  dispose(): void;
}

export function tradePath(id: string): string {
  return `/api/trades/${encodeURIComponent(id)}`;
}

/**
 * 保存したチャートを 1 枚読み戻して、canvas に描ける handle にする（形式と寸法を imageInfo で確かめてから。読めなければ
 * 投げる）。詳細と編集の画面（#89）が同じものを使う
 */
export async function loadChartPreview(
  request: RequestFn,
  id: string,
  slot: AnySlot,
  preview: (bytes: Uint8Array, type: ImageType) => Promise<PreviewHandle>,
): Promise<PreviewHandle> {
  const res = await request(`${tradePath(id)}/charts/${slot}`, {}, { ms: CHART_READ_TIMEOUT_MS });
  if (res.status !== 200) throw new Failed('other');
  const bytes = new Uint8Array(await res.arrayBuffer());
  // 壊れた応答・画像でない応答を復号に回さない
  const info = imageInfo(bytes);
  if (!info || info.width <= 0 || info.height <= 0) throw new Failed('other');
  return preview(bytes, info.type);
}

export function createTradeDetailController(deps: {
  readonly api: ApiFn;
  readonly id: string;
  readonly preview: (bytes: Uint8Array, type: ImageType) => Promise<PreviewHandle>;
  readonly timeoutMs?: number;
  /** チャートを読み戻すか（詳細の次の画面「すべての欄」「総評」は読まない。#131。既定 true） */
  readonly charts?: boolean;
  /** 両建てのまとまりを読むか（詳細の次の画面は読まない。既定 true） */
  readonly group?: boolean;
}): DetailController {
  const { id } = deps;
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: DetailState) => void>();
  let state: DetailState = { phase: 'loading' };
  let gen = 0;
  const chartGen = Object.fromEntries(ALL_SLOTS.map((s) => [s, 0])) as Record<AnySlot, number>;
  let disposed = false;

  const set = (s: DetailState) => {
    state = s;
    for (const fn of listeners) fn(state);
  };
  const closeCharts = () => {
    if (state.phase !== 'ready') return;
    for (const slot of ALL_SLOTS) {
      const c = state.charts[slot];
      if (c?.phase === 'ready') c.preview.close();
    }
  };
  const setChart = (slot: AnySlot, view: ChartView) => {
    if (state.phase !== 'ready') return;
    set({ ...state, charts: { ...state.charts, [slot]: view } });
  };

  const readChart = async (slot: AnySlot): Promise<void> => {
    const my = ++chartGen[slot];
    const current = () => !disposed && my === chartGen[slot] && state.phase === 'ready';
    setChart(slot, { phase: 'loading' });
    try {
      const handle = await loadChartPreview(request, id, slot, deps.preview);
      if (!current()) {
        handle.close();
        return;
      }
      setChart(slot, { phase: 'ready', preview: handle });
    } catch {
      if (current()) setChart(slot, { phase: 'failed' });
    }
  };

  let groupGen = 0;
  const setGroup = (g: GroupDetail) => {
    if (state.phase !== 'ready') return;
    set({ ...state, group: g });
  };
  const readGroup = async (trade: StoredTrade): Promise<void> => {
    if (trade.positionGroupId === undefined) return;
    const my = ++groupGen;
    const current = () => !disposed && my === groupGen && state.phase === 'ready';
    setGroup({ phase: 'loading' });
    try {
      const got = await loadGroupOf(request, trade);
      if (!current()) return;
      setGroup(
        got === null ? { phase: 'none' } : { phase: 'ready', state: got.state, byId: got.byId },
      );
    } catch {
      if (current()) setGroup({ phase: 'failed' });
    }
  };

  const self: DetailController = {
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
      closeCharts();
      set({ phase: 'loading' });
      try {
        const [res, inst, acc] = await Promise.all([
          request(tradePath(id)),
          request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
          request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
        ]);
        if (my !== gen || disposed) return;
        if (res.status === 404) {
          set({ phase: 'notFound' });
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
        const has = (slot: AnySlot) => deps.charts !== false && trade.charts?.[slot] !== undefined;
        set({
          phase: 'ready',
          trade,
          instruments: inst.items,
          accounts: acc.items,
          instrumentName: instrumentNameOf(trade, inst.items),
          summary: summarize(trade),
          charts: Object.fromEntries(
            ALL_SLOTS.map((s) => [s, has(s) ? { phase: 'loading' } : { phase: 'none' }]),
          ) as Record<ChartSlot, ChartView>,
          group: trade.positionGroupId === undefined ? { phase: 'none' } : { phase: 'loading' },
        });
        await Promise.all([
          ...ALL_SLOTS.filter(has).map((slot) => readChart(slot)),
          ...(deps.group === false ? [] : [readGroup(trade)]),
        ]);
      } catch (e) {
        if (my !== gen || disposed) return;
        const kind = kindOf(e);
        set({
          phase: 'loadFailed',
          error: kind === 'auth' ? AUTH_EXPIRED : DETAIL_LOAD_FAILED,
          errorKind: kind,
        });
      }
    },
    async reloadChart(slot) {
      if (deps.charts === false) return;
      if (state.phase !== 'ready' || state.trade.charts?.[slot] === undefined) return;
      const c = state.charts[slot];
      if (c?.phase === 'ready' || c?.phase === 'loading') return;
      await readChart(slot);
    },
    applyEmotionTags(tags) {
      if (disposed || state.phase !== 'ready') return;
      const { emotionTags: _old, ...rest } = state.trade;
      set({ ...state, trade: tags.length > 0 ? { ...rest, emotionTags: [...tags] } : rest });
    },
    applyReflection(r) {
      if (disposed || state.phase !== 'ready') return;
      const { reflection: _old, ...rest } = state.trade;
      set({ ...state, trade: isEmptyReflection(r) ? rest : { ...rest, reflection: r } });
    },
    async reloadGroup() {
      if (state.phase !== 'ready' || state.group?.phase !== 'failed') return;
      await readGroup(state.trade);
    },
    async unlinkGroup() {
      const s = state;
      if (s.phase !== 'ready' || s.group?.phase !== 'ready' || s.group.unlinking) return false;
      const g = s.group;
      setGroup({ ...g, unlinking: true });
      try {
        const res = await request(groupPath(g.state.group.id), { method: 'DELETE' });
        // 既に無い（ほかのタブで解いた）も解けた扱い
        if (res.status !== 204 && res.status !== 404) throw new Failed('other');
        if (disposed) return false;
        await self.load();
        return true;
      } catch (e) {
        if (!disposed && state.phase === 'ready' && state.group?.phase === 'ready') {
          const { unlinking: _u, ...rest } = state.group;
          setGroup({ ...rest, error: kindOf(e) === 'auth' ? AUTH_EXPIRED : GROUP_UNLINK_FAILED });
        }
        return false;
      }
    },
    dispose() {
      disposed = true;
      gen++;
      groupGen++;
      for (const s of ALL_SLOTS) chartGen[s]++;
      closeCharts();
      listeners.clear();
    },
  };
  return self;
}
