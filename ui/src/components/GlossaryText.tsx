// 用語集の文（[[id]] のリンクの印つき）を、テキストのノードとリンクの部品で組む（Issue #57・#76。HTML の文字列にしない）。
// どちらも <a>（文の中で流れて折れる inline。button は中身を 1 つの箱にするので、言葉の前で行が早く折れて右に空きが残った。#143）。
// sheet = 説明のシートの中（押すとその言葉の説明へたどる。onLink。href は用語集の画面のその項目で、修飾キー・中クリックは
// ブラウザに任せる）、anchor = 用語集の画面の中（ページの中のリンク #glossary-〈id〉。ブラウザの履歴に 1 つずつ積まれ、
// 戻るで 1 つずつ戻る）。名前は見える文字（label in name）。文の中のリンクなので当たりの 44px の例外（WCAG 2.5.8 の inline。
// ui:check も .glink を数えない）。hook を持たない
import type { GlossaryId } from '../lib/glossary';
import { glossaryAnchor, glossaryHref, linkSegments } from '../lib/glossary-text';
import { type ClickLike, shouldInterceptClick } from '../lib/routes';

export interface GlossaryTextProps {
  readonly text: string;
  readonly link: 'sheet' | 'anchor';
  readonly onLink?: (id: GlossaryId) => void;
  /** sheet の href の ?from=（今の画面のパス） */
  readonly from?: string | undefined;
}

/** 説明のシートの中のリンクの押下: 素の押下だけ横取りしてたどる（#143・#144。札のリンクも同じ） */
export function followClick(
  e: ClickLike & { preventDefault: () => void },
  id: GlossaryId,
  onLink?: (id: GlossaryId) => void,
): void {
  if (!shouldInterceptClick(e)) return;
  e.preventDefault();
  onLink?.(id);
}

export function GlossaryText(p: GlossaryTextProps) {
  return (
    <>
      {linkSegments(p.text).map((s, i) =>
        s.kind === 'text' ? (
          s.text
        ) : p.link === 'sheet' ? (
          <a
            key={i}
            class="glink"
            href={glossaryHref(s.id, p.from)}
            data-term={s.id}
            onClick={(e) => followClick(e, s.id, p.onLink)}
          >
            {s.text}
          </a>
        ) : (
          <a key={i} class="glink" href={`#${glossaryAnchor(s.id)}`}>
            {s.text}
          </a>
        ),
      )}
    </>
  );
}
