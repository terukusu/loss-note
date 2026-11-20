// 「i」の説明（Issue #57 契約 UI-57。#129 で吹き出しから説明のシートへ）の中身とたどり。DOM なし。部品は「i」のボタン
// components/InfoTip.tsx と、アプリに 1 つの説明のシート components/InfoSheet.tsx。規則はここ: たどった言葉 = infoTrail（文の中の
// 用語集のリンクで積む・戻る / Esc / [‹ 前の言葉] で 1 つずつ外す）、中身 = infoContent。シートは同時に 1 つ。
// 開閉・閉じ方・フォーカスの規則は下のシートの部品と同じ lib/sheet.ts。広い形の吹き出しの置き方（優先の向き・入らなければ
// 反対・窓の端に揃える）は CSS の anchor positioning（components.css の .sheet--info）
import { type GlossaryId, type GlossaryItem, glossaryTerm } from './glossary';

/** たどった言葉の並び（説明のシートの中で用語集のリンクを押すたびに 1 つ積む）の次の状態 */
export type TrailEvent =
  | { readonly type: 'link'; readonly id: GlossaryId }
  | { readonly type: 'up'; readonly depth: number }
  | { readonly type: 'clear' };

/**
 * link = 末尾に積む（今見ている言葉と同じなら積まない）、up = depth 段目まで戻す（0 = 「i」の言葉そのもの。戻る・Esc・
 * [‹ 前の言葉] は今の段数 − 1）、clear = 空に（開き直した）
 */
export function infoTrail(trail: readonly GlossaryId[], ev: TrailEvent): readonly GlossaryId[] {
  if (ev.type === 'clear') return [];
  if (ev.type === 'up') return trail.slice(0, Math.max(0, Math.min(trail.length, ev.depth)));
  if (trail.at(-1) === ev.id) return trail;
  return [...trail, ev.id];
}

/** 説明の出どころ: 用語のデータの ID か、言葉と文（明細の枠の補足） */
export type InfoSource =
  | { readonly term: GlossaryId; readonly id?: string }
  | { readonly label: string; readonly body: string; readonly id: string };

export interface InfoContent {
  /** ボタンの名前「「〈言葉〉」の説明」（「i」の言葉。たどっても変えない） */
  readonly name: string;
  /** 説明の箱の要素の ID（ボタンの aria-controls） */
  readonly panelId: string;
  /** シートの見出し（今見ている言葉。「i」の言葉そのもの・たどった先の言葉・明細の補足の言葉） */
  readonly title: string;
  /** 1 つ前の説明の言葉（戻るボタンの「‹ 〈言葉〉」。たどっていなければ null） */
  readonly back: string | null;
  /** 先頭の短い説明（用語のデータの summary。リンクの印つき。明細の補足は null） */
  readonly lead: string | null;
  /** 続きの文（リンクの印つき） */
  readonly body: readonly string[];
  readonly items: readonly GlossaryItem[];
  readonly example: string | null;
  /** 用語集の画面のその項目（末尾の「用語集で見る」。明細の補足は null） */
  readonly glossary: GlossaryId | null;
  /** 今の段数（0 = 「i」の言葉そのもの） */
  readonly depth: number;
}

export function infoName(label: string): string {
  return `「${label}」の説明`;
}

/** 出どころとたどった言葉から、ボタンの名前と箱の中身を作る（見せるのはたどった言葉の末尾） */
export function infoContent(src: InfoSource, trail: readonly GlossaryId[] = []): InfoContent {
  const name = 'term' in src ? infoName(glossaryTerm(src.term).term) : infoName(src.label);
  const panelId = 'term' in src ? (src.id ?? `info-${src.term}`) : src.id;
  const top = trail.at(-1);
  const baseName = 'term' in src ? glossaryTerm(src.term).term : src.label;
  const prev = trail.at(-2);
  const back = top === undefined ? null : prev === undefined ? baseName : glossaryTerm(prev).term;
  if (top !== undefined || 'term' in src) {
    const id = top ?? (src as { term: GlossaryId }).term;
    const t = glossaryTerm(id);
    return {
      name,
      panelId,
      title: t.term,
      back,
      lead: t.summary,
      body: t.body,
      items: t.items ?? [],
      example: t.example ?? null,
      glossary: t.id,
      depth: trail.length,
    };
  }
  return {
    name,
    panelId,
    title: src.label,
    back: null,
    lead: null,
    body: [src.body],
    items: [],
    example: null,
    glossary: null,
    depth: 0,
  };
}
