// 取引の詳細の通信と状態（Issue #9 契約 U-2。設計書 7.5・9.2、ADR-0006 決定 4）。DOM を持たない。
// - 開いたら取引（GET /api/trades/{id}）と銘柄・口座（#47）を並行に読む。404（無い ID・ほかの利用者の取引）は notFound
// - チャートのある枠だけ GET /api/trades/{id}/charts/{slot} を読み、形式と寸法を imageInfo で確かめてから、差し込まれた
//   preview（画面は statement-image.ts の browserCodec.preview）で canvas に描ける handle にする。object URL・data URL を
//   作らない。読めなかった枠は failed（その枠だけ [もう一度読み込む]）。画面を離れたら（dispose）handle を close する
// - 画像・取引は記憶の中だけ（端末の保存先・URL・履歴に書かない）。失敗は決まった文言だけ
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';
import { ALL_SLOTS, type AnySlot, type ChartSlot, type ExtraSlot } from './charts';
import { type ImageType, imageInfo } from './image-limits';
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
    };

export interface DetailController {
  getState(): DetailState;
  subscribe(fn: (s: DetailState) => void): () => void;
  load(): Promise<void>;
  /** 読めなかった枠を読み直す */
  reloadChart(slot: AnySlot): Promise<void>;
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
        const has = (slot: AnySlot) => trade.charts?.[slot] !== undefined;
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
        });
        await Promise.all(ALL_SLOTS.filter(has).map((slot) => readChart(slot)));
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
      if (state.phase !== 'ready' || state.trade.charts?.[slot] === undefined) return;
      const c = state.charts[slot];
      if (c?.phase === 'ready' || c?.phase === 'loading') return;
      await readChart(slot);
    },
    dispose() {
      disposed = true;
      gen++;
      for (const s of ALL_SLOTS) chartGen[s]++;
      closeCharts();
      listeners.clear();
    },
  };
}
