// 用語集の文の中のリンク（[[id]]・[[id|見せる文字]]）を、文字とリンクの並びに分ける純関数（Issue #57・#76）。
// 画面はこの並びを、文字はテキストのノード・リンクは部品（吹き出しの中はボタン・用語集の画面はページの中のリンク）で組む。
// HTML の文字列にしない（CSP・P11）。知らない ID のリンクは文字のまま（テストが用語集の全文で 0 件を確かめる）
import { type GlossaryId, type GlossaryTerm, glossaryTerm, isGlossaryId } from './glossary';

export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly id: GlossaryId; readonly text: string };

const LINK = /\[\[([A-Za-z]+)(?:\|([^\]]+))?\]\]/g;

/** 文を文字とリンクに分ける（空の文字は出さない） */
export function linkSegments(text: string): readonly TextSegment[] {
  const out: TextSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) });
    const raw = m[1] ?? '';
    if (isGlossaryId(raw)) {
      out.push({ kind: 'link', id: raw, text: m[2] ?? glossaryTerm(raw).label });
    } else {
      out.push({ kind: 'text', text: m[2] ?? raw });
    }
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** リンクの印を外した見える文字 */
export function plainText(text: string): string {
  return linkSegments(text)
    .map((s) => s.text)
    .join('');
}

/** 文に書かれたリンクの ID（知らない ID も含めて、書かれた順に重複なし） */
export function rawLinkIds(text: string): readonly string[] {
  return [...new Set([...text.matchAll(LINK)].map((m) => m[1] ?? ''))];
}

/** 項目のすべての文（短い説明・続き・一覧・例） */
export function termTexts(t: GlossaryTerm): readonly string[] {
  return [t.summary, ...t.body, ...(t.items ?? []).map((i) => i.text), t.example ?? ''];
}

/** 項目から関係する言葉（文の中のリンク先。自分を除き、書かれた順に重複なし） */
export function relatedIds(t: GlossaryTerm): readonly GlossaryId[] {
  const ids = termTexts(t).flatMap((s) =>
    linkSegments(s).flatMap((x) => (x.kind === 'link' ? [x.id] : [])),
  );
  return [...new Set(ids)].filter((id) => id !== t.id);
}

/** 用語集の画面の項目の要素の ID（ページの中のリンクの行き先） */
export function glossaryAnchor(id: GlossaryId): string {
  return `glossary-${id}`;
}

/**
 * 用語集の画面のその項目への URL（吹き出しの末尾の「用語集で見る」）。from = 来た画面のパス（用語集の画面の「‹ 〈来た画面〉」）
 */
export function glossaryHref(id: GlossaryId, from?: string): string {
  const q = from ? `?from=${encodeURIComponent(from)}` : '';
  return `/glossary${q}#${glossaryAnchor(id)}`;
}
