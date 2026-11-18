// 用語集の文（[[id]] のリンクの印つき）を、テキストのノードとリンクの部品で組む（Issue #57・#76。HTML の文字列にしない）。
// button = 「i」の吹き出しの中（押すとその言葉の説明へ。onLink）、anchor = 用語集の画面の中（ページの中のリンク
// #glossary-〈id〉。ブラウザの履歴に 1 つずつ積まれ、戻るで 1 つずつ戻る）。名前は見える文字（label in name）。
// 文の中のリンクなので当たりの 44px の例外（WCAG 2.5.8 の inline。ui:check も .glink を数えない）。hook を持たない
import type { GlossaryId } from '../lib/glossary';
import { glossaryAnchor, linkSegments } from '../lib/glossary-text';

export interface GlossaryTextProps {
  readonly text: string;
  readonly link: 'button' | 'anchor';
  readonly onLink?: (id: GlossaryId) => void;
}

export function GlossaryText(p: GlossaryTextProps) {
  return (
    <>
      {linkSegments(p.text).map((s, i) =>
        s.kind === 'text' ? (
          s.text
        ) : p.link === 'button' ? (
          <button
            key={i}
            type="button"
            class="glink"
            data-term={s.id}
            onClick={() => p.onLink?.(s.id)}
          >
            {s.text}
          </button>
        ) : (
          <a key={i} class="glink" href={`#${glossaryAnchor(s.id)}`}>
            {s.text}
          </a>
        ),
      )}
    </>
  );
}
