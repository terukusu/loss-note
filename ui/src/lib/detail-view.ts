// 取引の詳細の 1 画面の形（#131。設計書 9.2 の取引の詳細の行・9.3・docs/ui-guidelines.md 9.3・9.12）の純関数。DOM なし。
// - 上の帯の「…」から操作のシート（今の値と比べる・削除）。比較のシートは見るだけ（#31 の P4）
// - チャートは 2 枠を横に並べ、押すと全画面で見る層。追加のチャート（#89）は 2 枠の下に同じ形で並べる
// - 「すべての欄」「総評」は次の画面（その場で開かない）
// - チャートの下に「なぜ」のカード 1 枚（心理 → Good / More → 総評。題と Good / More の並びは判定の段。#248・C69）
import type { Grade } from '../../../core/judge';
import type { StoredTrade } from '../../../core/record';
import { badgeModel, type Tier } from './badge';
import type { AnySlot } from './charts';
import type { ChartSlotView } from './trade-view';

/** 開いているシート（TradeDetailScreen が持つ。View は受けて描くだけ） */
export type DetailSheet =
  | { readonly kind: 'actions' }
  | { readonly kind: 'compare' }
  | { readonly kind: 'chart'; readonly slot: AnySlot }
  /** 心理のタグを付ける・外す（#156。保存の後のシートと同じ中身） */
  | { readonly kind: 'emotion' }
  /** Good / More を付ける・外す・書く（#123） */
  | { readonly kind: 'reflection' }
  /** 両建ての相手を選ぶ（#267・7.7） */
  | { readonly kind: 'link' };

/** シートの ID（dialog の id。開いたボタンの aria-controls） */
export const DETAIL_SHEET_ID = {
  actions: 'detail-actions-sheet',
  compare: 'detail-compare-sheet',
  chart: 'detail-chart-viewer',
  emotion: 'detail-emotion-sheet',
  reflection: 'detail-reflection-sheet',
  link: 'detail-link-sheet',
} as const;

/** 上の帯の「…」の読み上げの名前と、操作のシートの題 */
export const ACTIONS_LABEL = '操作';

/** 操作のシートの行（押せる行。9.12） */
export type DetailAction = 'compare' | 'link' | 'openGroup' | 'delete';

/** 両建ての行（#267・7.7）: link = ［両建てに結ぶ］ / open = ［まとまりを見る］ / null = 出さない */
export type GroupAction = 'link' | 'open' | null;

/**
 * 操作のシートの行: 今の値と比べる（違う値があり、直せる取引のときだけ。#31 の「違わなければ何も出さない」）→ 両建て
 * （#267）→ 削除。消すは確認を挟まない（[元に戻す] はトースト。ADR-0007）
 */
export function detailActions(
  hasOffer: boolean,
  group: GroupAction = null,
): readonly DetailAction[] {
  return [
    ...(hasOffer ? (['compare'] as const) : []),
    ...(group === 'link' ? (['link'] as const) : group === 'open' ? (['openGroup'] as const) : []),
    'delete',
  ];
}

/**
 * 両建ての行の出し方（7.7）: 足を持つ取引は出さない。まとまりが ok ならまとまりを見る、メンバーでない（逆参照が無い・
 * 指す先が無い）なら結ぶ。読み込み中・読めなかった・崩れたまとまり（判定のカードの上の ［解く］）は出さない
 */
export function groupActionOf(
  t: Pick<StoredTrade, 'record'>,
  group: { readonly phase: string; readonly state?: { readonly kind: string } } | undefined,
): GroupAction {
  if (t.record.legs !== undefined) return null;
  const phase = group?.phase ?? 'none';
  if (phase === 'none') return 'link';
  if (phase === 'ready') return group?.state?.kind === 'ok' ? 'open' : null;
  return null;
}

/** 削除の行の文字 */
export const DELETE_LABEL = '削除';
/** 削除の行の右の添え（確認を挟まずにすぐ消えるので、押す前に戻せることを言う。#131 のデザインレビュー a3） */
export const DELETE_NOTE = '8 秒は元に戻せます';

/**
 * チャートの枠の名前の 2 つの塊（名前と「 · 時間足」。追加のチャートは一言があれば一言。時間足が無ければ null）。
 * 札は 2 つを別の要素にし、名前が長いときは時間足の塊の前で折る（時間足を切らない・途中で折らない。#176）
 */
export function chartCaptionParts(c: ChartSlotView): {
  readonly name: string;
  readonly timeframe: string | null;
} {
  return { name: c.note ?? c.name, timeframe: c.timeframe ? ` · ${c.timeframe}` : null };
}

/** チャートの枠の名前（「エントリー時 · 4 時間足」。時間足が無ければ名前だけ） */
export function chartCaption(c: ChartSlotView): string {
  const p = chartCaptionParts(c);
  return p.name + (p.timeframe ?? '');
}

/** 総評（取り込んだ取引の「【取り込み】元の判定 X」など。空なら null = 行を出さない） */
export function commentOf(t: StoredTrade): string | null {
  const v = t.record.exit.review?.trim();
  return v ? v : null;
}

/** 詳細の次の画面の URL（#131。「すべての欄」「総評」） */
export const fieldsHref = (id: string) => `/trades/${id}/fields`;
export const commentHref = (id: string) => `/trades/${id}/comment`;

/** 「なぜ」のカードの題（判定の段ごと。#248・C69）。振り返りの「何で崩れたか」と同じ問いの形 */
export const WHY_TITLE: Readonly<Record<Tier, string>> = {
  plan: 'なぜ守れたか',
  break: 'なぜ崩れたか',
  worst: 'なぜ崩れたか',
  neutral: '心理と振り返り',
};

/** 崩れ・極悪の取引で心理も Good / More も無いときだけ、題の横の「i」の中に置く文（残すと何に効くか。C70・#254） */
export const WHY_HINT = '心理と More を残すと、振り返りの「何で崩れたか」に数えられます。';
/** その「i」の説明のシートの ID */
export const WHY_INFO_ID = 'detail-why-info';

/** 「なぜ」のカードの見出しの id */
export const WHY_TITLE_ID = 'detail-why-title';

/** 「なぜ」のカードの形（DOM なし） */
export interface WhyCardModel {
  readonly title: string;
  /** Good / More の段を More → Good の順にする（崩れ・極悪。C59） */
  readonly moreFirst: boolean;
  /** 題の横の「i」の中の文（null = 「i」を出さない） */
  readonly hint: string | null;
  /** 総評の行の添え（総評の先頭の 1 行。総評が無ければ null = 行を出さない） */
  readonly comment: { readonly preview: string } | null;
}

/** 総評の添え: 空の行を飛ばした最初の行（前後の空白を除く。空なら null） */
export function commentPreview(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim();
    if (v) return v;
  }
  return null;
}

/**
 * 「なぜ」のカードの形（#248・C69）: 題と Good / More の並びは判定の段で決める。案内の 1 行は崩れ・極悪で、心理のタグも
 * Good / More も無く、取り込んだ取引でない（振り返りは既定で取り込みを数えない）ときだけ。判定・R には触れない
 */
export function whyCardModel(
  t: StoredTrade,
  grade: Grade | null,
  have: { readonly emotions: number; readonly reflection: boolean },
): WhyCardModel {
  const tier = badgeModel(grade).tier;
  const off = tier === 'break' || tier === 'worst';
  const empty = have.emotions === 0 && !have.reflection;
  const comment = commentOf(t);
  const preview = comment === null ? null : commentPreview(comment);
  return {
    title: WHY_TITLE[tier],
    moreFirst: off,
    hint: off && empty && t.record.source !== 'import' ? WHY_HINT : null,
    comment: preview === null ? null : { preview },
  };
}
