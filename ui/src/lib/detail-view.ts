// 取引の詳細の 1 画面の形（#131。設計書 9.2 の取引の詳細の行・9.3・docs/ui-guidelines.md 9.3・9.12）の純関数。DOM なし。
// - 上の帯の「…」から操作のシート（今の値と比べる・削除）。比較のシートは見るだけ（#31 の P4）
// - チャートは 2 枠を横に並べ、押すと全画面で見る層。追加のチャート（#89）は 2 枠の下に同じ形で並べる
// - 「すべての欄」「総評」は次の画面（その場で開かない）
import type { StoredTrade } from '../../../core/record';
import type { AnySlot } from './charts';
import type { ChartSlotView } from './trade-view';

/** 開いているシート（TradeDetailScreen が持つ。View は受けて描くだけ） */
export type DetailSheet =
  | { readonly kind: 'actions' }
  | { readonly kind: 'compare' }
  | { readonly kind: 'chart'; readonly slot: AnySlot }
  /** 心理のタグを付ける・外す（#156。保存の後のシートと同じ中身） */
  | { readonly kind: 'emotion' };

/** シートの ID（dialog の id。開いたボタンの aria-controls） */
export const DETAIL_SHEET_ID = {
  actions: 'detail-actions-sheet',
  compare: 'detail-compare-sheet',
  chart: 'detail-chart-viewer',
  emotion: 'detail-emotion-sheet',
} as const;

/** 上の帯の「…」の読み上げの名前と、操作のシートの題 */
export const ACTIONS_LABEL = '操作';

/** 操作のシートの行（押せる行。9.12） */
export type DetailAction = 'compare' | 'delete';

/**
 * 操作のシートの行: 今の値と比べる（違う値があり、直せる取引のときだけ。#31 の「違わなければ何も出さない」）→ 削除。
 * 消すは確認を挟まない（[元に戻す] はトースト。ADR-0007）
 */
export function detailActions(hasOffer: boolean): readonly DetailAction[] {
  return hasOffer ? ['compare', 'delete'] : ['delete'];
}

/** 削除の行の文字 */
export const DELETE_LABEL = '削除';
/** 削除の行の右の添え（確認を挟まずにすぐ消えるので、押す前に戻せることを言う。#131 のデザインレビュー a3） */
export const DELETE_NOTE = '8 秒は元に戻せます';

/** チャートの枠の名前（「エントリー時 · 4 時間足」。追加のチャートは一言があれば一言。時間足が無ければ名前だけ） */
export function chartCaption(c: ChartSlotView): string {
  const name = c.note ?? c.name;
  return c.timeframe ? `${name} · ${c.timeframe}` : name;
}

/** 総評（取り込んだ取引の「【取り込み】元の判定 X」など。空なら null = 行を出さない） */
export function commentOf(t: StoredTrade): string | null {
  const v = t.record.exit.review?.trim();
  return v ? v : null;
}

/** 詳細の次の画面の URL（#131。「すべての欄」「総評」） */
export const fieldsHref = (id: string) => `/trades/${id}/fields`;
export const commentHref = (id: string) => `/trades/${id}/comment`;
