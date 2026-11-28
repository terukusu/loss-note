// ホームの規律の振り返りの通信と状態（Issue #88 契約 U-1。設計書 C44）。DOM を持たず、画面は購読して描くだけ。
// - 期間の範囲ごとに GET /api/trades?exitFrom=..&exitTo=..（決済の時刻の範囲。範囲の中の全件）を読む
// - 範囲を替えたら前の読みの応答は捨てる（世代）。同じ範囲を読み終えていれば読み直さない（reload は読み直す）
// - 直近の判定（trades-controller）とは別に読む（こちらの失敗が [記録する]・直近の判定を巻き込まない。KEEP-4）
// - 両建てのまとまり（#268・6.5）: 応答の positionGroups（範囲と重なるまとまり）と groupMembers（範囲の外のメンバーの取引）も
//   持つ。鍵の無い応答（前の版の API）・配列でない値は空の配列（まとまりの無い今の集計と同じ）
// 失敗は決まった文言だけ（応答の本文・例外の文字を持たない）。端末に何も保存しない
import type { StoredTrade } from '../../../core/record';
import type { StoredPositionGroup } from '../../../core/review-group';
import {
  type ApiFn,
  AUTH_EXPIRED,
  createRequest,
  Failed,
  type FailureKind,
  getJson,
  kindOf,
  REQUEST_TIMEOUT_MS,
} from './request';
import { tradesPath } from './trade-pages';

export const REVIEW_LOAD_FAILED =
  '振り返りを読み込めませんでした。通信状況を確認して、再読み込みしてください。';

export interface ExitRange {
  readonly from: number;
  readonly to: number;
}

export type ReviewState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading'; readonly range: ExitRange }
  | {
      readonly phase: 'failed';
      readonly range: ExitRange;
      readonly error: string;
      readonly errorKind: FailureKind;
    }
  | {
      readonly phase: 'ready';
      readonly range: ExitRange;
      readonly trades: readonly StoredTrade[];
      /** 期間の取引が上限（2,000 件）を超え、先頭（決済の新しい順）の分だけ返ってきた（C44） */
      readonly truncated: boolean;
      /** 範囲と重なる両建てのまとまり（#268。controller は空でも入れる。無い = まとまりなし） */
      readonly groups?: readonly StoredPositionGroup[];
      /** まとまりの範囲の外のメンバーの取引（#268。controller は空でも入れる） */
      readonly groupMembers?: readonly StoredTrade[];
    };

export interface ReviewController {
  getState(): ReviewState;
  subscribe(fn: (s: ReviewState) => void): () => void;
  /** 範囲を読む（null = 期間の誤りで読まない。同じ範囲を読み終えていれば何もしない） */
  load(range: ExitRange | null): Promise<void>;
  /** 今の範囲を読み直す（失敗の後の [再読み込み]） */
  reload(): Promise<void>;
  dispose(): void;
}

/** GET /api/trades の範囲つきのパス */
export function rangePath(range: ExitRange): string {
  return tradesPath({ exitFrom: range.from, exitTo: range.to });
}

/** まとまりの最低限の形（ID と メンバーの配列）。崩れた値は数えない（メンバーを単独で数える = 崩れたまとまりと同じ） */
function isGroupShape(g: unknown): g is StoredPositionGroup {
  if (typeof g !== 'object' || g === null) return false;
  const v = g as { id?: unknown; members?: unknown };
  return (
    typeof v.id === 'string' &&
    Array.isArray(v.members) &&
    v.members.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as { tradeId?: unknown }).tradeId === 'string' &&
        ((m as { role?: unknown }).role === 'main' || (m as { role?: unknown }).role === 'hedge'),
    )
  );
}

const same = (a: ExitRange, b: ExitRange) => a.from === b.from && a.to === b.to;

export function createReviewController(deps: {
  readonly api: ApiFn;
  readonly timeoutMs?: number;
}): ReviewController {
  const request = createRequest(deps.api, deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const listeners = new Set<(s: ReviewState) => void>();
  let state: ReviewState = { phase: 'idle' };
  let gen = 0;
  const set = (s: ReviewState) => {
    state = s;
    for (const fn of listeners) fn(state);
  };

  const read = async (range: ExitRange) => {
    const my = ++gen;
    set({ phase: 'loading', range });
    try {
      const body = await getJson<{
        items?: unknown;
        truncated?: unknown;
        positionGroups?: unknown;
        groupMembers?: unknown;
      }>(await request(rangePath(range)), 200);
      if (!Array.isArray(body?.items)) throw new Failed('other');
      if (my !== gen) return;
      set({
        phase: 'ready',
        range,
        trades: body.items as StoredTrade[],
        truncated: body.truncated === true,
        groups: Array.isArray(body.positionGroups)
          ? (body.positionGroups as StoredPositionGroup[]).filter(isGroupShape)
          : [],
        groupMembers: Array.isArray(body.groupMembers) ? (body.groupMembers as StoredTrade[]) : [],
      });
    } catch (e) {
      if (my !== gen) return;
      const kind = kindOf(e);
      set({
        phase: 'failed',
        range,
        error: kind === 'auth' ? AUTH_EXPIRED : REVIEW_LOAD_FAILED,
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
    async load(range) {
      if (range === null) {
        gen++;
        set({ phase: 'idle' });
        return;
      }
      if (state.phase !== 'idle' && state.phase !== 'failed' && same(state.range, range)) return;
      await read(range);
    },
    async reload() {
      if (state.phase === 'idle') return;
      await read(state.range);
    },
    dispose() {
      gen++;
      listeners.clear();
    },
  };
}
