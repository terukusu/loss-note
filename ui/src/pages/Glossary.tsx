// 用語集（Issue #76。#57 の PR で作る）。判定に効く言葉を 1 か所のデータ（lib/glossary.ts）から 3 つの区切りで一覧にし、各項目の
// 文の中の言葉と「関係する言葉」から、その項目へページの中のリンク（#glossary-〈id〉）でたどる。たどるたびに履歴に 1 つ積み
// （history.state.glossary = 用語集の中でたどった数）、戻る（バックキー・ブラウザの戻る）で 1 つずつ前の項目へ戻る（router は
// URL のパス + 検索が変わらない戻るで画面を変えない）。上の「‹ 〈来た画面〉」は用語集の中でたどった段を飛ばして来た画面へ戻る
// （「i」の「用語集で見る」から来たとき = ?from=〈パス〉。それ以外は設定へ）。
// 文はテキストのノードとリンクの部品だけ（HTML の文字列にしない）。GlossaryView は hook を持たない（テストは関数を呼んで木にする）
import { useEffect, useState } from 'preact/hooks';
import { GlossaryText } from '../components/GlossaryText';
import { GradeName } from '../components/InfoTip';
import { PageHeader } from '../components/PageHeader';
import {
  GLOSSARY,
  GLOSSARY_GROUPS,
  type GlossaryId,
  type GlossaryTerm,
  glossaryTerm,
  isGlossaryId,
} from '../lib/glossary';
import { glossaryAnchor, relatedIds } from '../lib/glossary-text';
import { Link } from '../lib/router';
import { glossaryBack } from '../lib/routes';

function Term({ t, current }: { readonly t: GlossaryTerm; readonly current: boolean }) {
  const text = (s: string) => <GlossaryText text={s} link="anchor" />;
  const related = relatedIds(t);
  const titleId = `${glossaryAnchor(t.id)}-title`;
  return (
    <section
      class={`card section glossary__item${current ? ' glossary__item--current' : ''}`}
      id={glossaryAnchor(t.id)}
      aria-labelledby={titleId}
      aria-current={current ? 'location' : undefined}
      tabIndex={-1}
    >
      <h3 class="section__title glossary__term" id={titleId}>
        {t.term}
      </h3>
      <p class="glossary__lead">{text(t.summary)}</p>
      {t.body.length > 0 ? (
        <p>
          {t.body.map((b) => (
            <span key={b}>{text(b)}</span>
          ))}
        </p>
      ) : null}
      {t.items && t.items.length > 0 ? (
        <ul class="glossary__items">
          {t.items.map((i) => (
            <li key={i.name}>
              <GradeName name={i.name} grade={i.grade} /> {text(i.text)}
            </li>
          ))}
        </ul>
      ) : null}
      {t.example ? <p class="glossary__example">{t.example}</p> : null}
      {related.length > 0 ? (
        <p class="glossary__related">
          <span class="glossary__related-label">関係する言葉:</span>{' '}
          {related.map((id, i) => (
            <span key={id}>
              {i > 0 ? '・' : ''}
              <a class="glink" href={`#${glossaryAnchor(id)}`}>
                {glossaryTerm(id).term}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

export interface GlossaryViewProps {
  /** 今見ている項目（たどった先。見出しの左の線で示す） */
  readonly current?: GlossaryId | null;
  /** 上の戻るリンクの名前（「‹ 記録する」の〈記録する〉） */
  readonly backLabel?: string;
  /** 押したとき（来た画面へ戻る）。無ければ設定へのリンク */
  readonly onBack?: (() => void) | undefined;
}

export function GlossaryView(p: GlossaryViewProps) {
  const backLabel = p.backLabel ?? '設定';
  return (
    <>
      <PageHeader
        title="用語集"
        description={
          <>
            {p.onBack ? (
              <button type="button" class="detail__back glossary__back" onClick={p.onBack}>
                ‹ {backLabel}
              </button>
            ) : (
              <Link href="/settings" class="detail__back">
                ‹ 設定
              </Link>
            )}
            <span>
              判定に関わる言葉の意味です。下線の言葉を押すと、その説明へ移動します。ブラウザの「戻る」で元の位置に戻れます。
            </span>
          </>
        }
      />
      <nav class="card section glossary__index" aria-label="言葉の一覧">
        {GLOSSARY_GROUPS.map((g) => (
          <div key={g.id} class="glossary__index-group">
            <p class="glossary__group-name">{g.name}</p>
            <ul>
              {GLOSSARY.filter((t) => t.group === g.id).map((t) => (
                <li key={t.id}>
                  <a class="glink" href={`#${glossaryAnchor(t.id)}`}>
                    {t.term}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {GLOSSARY_GROUPS.map((g) => (
        <section key={g.id} class="glossary__group" aria-labelledby={`glossary-group-${g.id}`}>
          <h2 class="glossary__group-title" id={`glossary-group-${g.id}`}>
            {g.name}
          </h2>
          {GLOSSARY.filter((t) => t.group === g.id).map((t) => (
            <Term key={t.id} t={t} current={p.current === t.id} />
          ))}
        </section>
      ))}
    </>
  );
}

const PREFIX = '#glossary-';

/** 今の URL のハッシュの項目（無い・知らない言葉は null） */
function hashTerm(): GlossaryId | null {
  const h = decodeURIComponent(window.location.hash);
  if (!h.startsWith(PREFIX)) return null;
  const id = h.slice(PREFIX.length);
  return isGlossaryId(id) ? id : null;
}

/** 用語集の中でたどった数（history.state.glossary） */
function depthNow(): number {
  const s: unknown = window.history.state;
  const d = typeof s === 'object' && s !== null ? (s as { glossary?: unknown }).glossary : 0;
  return typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : 0;
}

function reveal(id: GlossaryId, focus: boolean) {
  const el = document.getElementById(glossaryAnchor(id));
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  if (focus) el.focus({ preventScroll: true });
}

export function Glossary() {
  const [current, setCurrent] = useState<GlossaryId | null>(null);
  const back = glossaryBack(window.location.search, { dev: import.meta.env.DEV });

  useEffect(() => {
    // 開いたとき: URL の項目へ寄せる（殻の先頭へのスクロールの後）
    const first = hashTerm();
    setCurrent(first);
    const raf = first ? window.requestAnimationFrame(() => reveal(first, false)) : 0;
    // ページの中のリンク: 履歴に 1 つ積んで移る（たどった数を state に持つ。:target に頼らず今の項目を描く）
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = e.target instanceof Element ? e.target.closest('a[href^="#glossary-"]') : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const id = a.getAttribute('href')?.slice(PREFIX.length) ?? '';
      if (!isGlossaryId(id)) return;
      e.preventDefault();
      const { pathname, search } = window.location;
      window.history.pushState(
        { glossary: depthNow() + 1 },
        '',
        `${pathname}${search}#${glossaryAnchor(id)}`,
      );
      setCurrent(id);
      reveal(id, true);
    };
    // 戻る・進む: 今の項目を描き直す（位置はブラウザが戻す）
    const onPop = () => setCurrent(hashTerm());
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  return (
    <GlossaryView
      current={current}
      backLabel={back?.label ?? '設定'}
      // 来た画面へ: 用語集の中でたどった数 + 用語集に入った 1 つを戻る
      onBack={back ? () => window.history.go(-(depthNow() + 1)) : undefined}
    />
  );
}
