// 取引の一覧のページ分け（Issue #87・ADR-0016）の純関数。DOM・通信を持たない。
// - API の GET /api/trades?limit=..&cursor=..&order=.. の組み立てと応答の検査
// - 読んだページを ID で重ねずに足す（同じ取引が 2 度来たら後の方を正にする）
// - 一覧の件数の文（途中 = 「N 件を表示」、最後まで = 「全 N 件」）
import type { StoredTrade } from '../../../core/record';

/** 一覧の 1 ページの件数 */
export const LIST_PAGE = 50;
/** ホームが読む件数（直近 5 件を出す。[元に戻す] を待つ取引で隠れても 5 件に足りるように少し多く） */
export const HOME_LIMIT = 10;
/** 戻ったときの読み直しの 1 回の件数（API の上限） */
export const REFRESH_PAGE = 100;
/** 記録する画面が「保存が届いたか」を確かめるときに読む件数（作った時刻の新しい順） */
export const DELIVERED_LIMIT = 10;

export type TradeOrder = 'exit' | 'created';

/**
 * GET /api/trades の件数つきのパス（order は exit のとき省く）。決済の時刻の範囲（#88。exitFrom 以上 exitTo 未満の全件。
 * 長さは API が 367 日までに抑える）もここで組み立てる（全件を読むパスを作らない）
 */
export function tradesPath(
  opts:
    | { readonly limit: number; readonly cursor?: string | null; readonly order?: TradeOrder }
    | { readonly exitFrom: number; readonly exitTo: number },
): string {
  const q = new URLSearchParams();
  if ('exitFrom' in opts) {
    q.set('exitFrom', String(opts.exitFrom));
    q.set('exitTo', String(opts.exitTo));
  } else {
    if (opts.order === 'created') q.set('order', 'created');
    q.set('limit', String(opts.limit));
    if (opts.cursor) q.set('cursor', opts.cursor);
  }
  return `/api/trades?${q.toString()}`;
}

export interface TradePage {
  readonly items: readonly StoredTrade[];
  readonly next: string | null;
}

/** 応答の本文がページの形か（items の配列と、next = 文字 / null） */
export function pageOf(body: unknown): TradePage | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as { items?: unknown; next?: unknown };
  if (!Array.isArray(b.items)) return null;
  if (b.next !== null && (typeof b.next !== 'string' || b.next === '')) return null;
  return { items: b.items as StoredTrade[], next: b.next };
}

/** 読んだ分に次のページを足す（同じ ID は後のページの方で置き換え、位置は前のまま） */
export function appendTrades(
  loaded: readonly StoredTrade[],
  page: readonly StoredTrade[],
): readonly StoredTrade[] {
  const fresh = new Map(page.map((t) => [t.id, t]));
  const kept = loaded.map((t) => fresh.get(t.id) ?? t);
  const seen = new Set(loaded.map((t) => t.id));
  return [...kept, ...page.filter((t) => !seen.has(t.id))];
}

/** 一覧の件数の文（count = 見えている行の数）。続きがある間は「続きあり」（読んだ分しか無いと読まれないように） */
export function countText(count: number, done: boolean): string {
  return done
    ? `全 ${count} 件（決済の新しい順）`
    : `${count} 件を表示中（決済の新しい順・続きあり）`;
}

/** 最後まで読んだときの一覧の末尾の文 */
export function endText(count: number): string {
  return `全 ${count} 件を表示しました`;
}

/** 続きがある間の「—」の理由: 件数の括弧を外す（読み込んだ分だけの数を全体の数に見せない） */
export function notesWhileLoading(notes: readonly string[]): string[] {
  return notes.map((n) => n.replace(/（\d+ 件）$/, ''));
}
