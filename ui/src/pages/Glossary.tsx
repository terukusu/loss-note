// 用語集（Issue #76。#57 の PR で作る）。判定に効く言葉を 1 か所のデータ（lib/glossary.ts）から 3 つの区切りで一覧にし、各項目の
// 文の中の言葉と「関係する言葉」から、その項目へページの中のリンク（#glossary-〈id〉）でたどる。たどるたびに履歴に 1 つ積み
// （history.state.glossary = 用語集の中でたどった数）、戻る（バックキー・ブラウザの戻る）で 1 つずつ前の項目へ戻る（router は
// URL のパス + 検索が変わらない戻るで画面を変えない）。上の「‹ 〈来た画面〉」は用語集の中でたどった段を飛ばして来た画面へ戻る
// （「i」の「用語集で見る」から来たとき = ?from=〈パス〉。それ以外は設定へ）。
// 文はテキストのノードとリンクの部品だけ（HTML の文字列にしない）。GlossaryView は hook を持たない（テストは関数を呼んで木にする）
import { useEffect, useState } from 'preact/hooks';
import { TopBar } from '../components/AppBar';
import { Chip } from '../components/Button';
import { GlossaryText } from '../components/GlossaryText';
import { GradeName } from '../components/InfoTip';
import {
  GLOSSARY,
  GLOSSARY_GROUPS,
  type GlossaryId,
  type GlossaryTerm,
  glossaryTerm,
  isGlossaryId,
} from '../lib/glossary';
import { glossaryAnchor, relatedIds } from '../lib/glossary-text';
import { depthOf } from '../lib/router';
import { glossaryBack } from '../lib/routes';
import { inPageStepState } from '../lib/tab-nav';

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
        <div class="glossary__related">
          <span class="glossary__related-label">関係する言葉:</span>
          {/* 関係する言葉の札（チップ。9.12） */}
          <ul class="chips">
            {related.map((id) => (
              <li key={id}>
                <Chip href={`#${glossaryAnchor(id)}`}>{glossaryTerm(id).term}</Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export interface GlossaryViewProps {
  /** 今見ている項目（たどった先。見出しの左の線で示す） */
  readonly current?: GlossaryId | null;
  /** 上の帯の戻るのボタンの名前（「‹ 記録する」の〈記録する〉） */
  readonly backLabel?: string;
  /** 押したとき（来た画面へ戻る）。無ければ設定へのリンク */
  readonly onBack?: (() => void) | undefined;
}

export function GlossaryView(p: GlossaryViewProps) {
  const backLabel = p.backLabel ?? '設定';
  return (
    <>
      <TopBar
        title="用語集"
        back={
          p.onBack ? { label: backLabel, onBack: p.onBack } : { label: '設定', href: '/settings' }
        }
      />
      <p class="pagehead__desc">
        判定に関わる言葉の意味です。下線の言葉を押すと、その説明へ移動します。ブラウザの「戻る」で元の位置に戻れます。
      </p>
      <nav class="card section glossary__index" aria-label="言葉の一覧">
        {GLOSSARY_GROUPS.map((g) => (
          <div key={g.id} class="glossary__index-group">
            <p class="glossary__group-name">{g.name}</p>
            <ul class="chips">
              {GLOSSARY.filter((t) => t.group === g.id).map((t) => (
                <li key={t.id}>
                  <Chip href={`#${glossaryAnchor(t.id)}`}>{t.term}</Chip>
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
      const { pathname, search, hash } = window.location;
      const next = `${pathname}${search}#${glossaryAnchor(id)}`;
      // アプリの印は 1 段進める（たどった段も積み重ねの深さに数える。タブの切り替え・押し直しで戻る段が足りるように。
      // 再読み込みで履歴を組み直さない。#127 のレビュー B1）
      window.history.pushState(
        {
          ...inPageStepState(window.history.state, `${pathname}${search}${hash}`, next, {
            dev: import.meta.env.DEV,
          }),
          glossary: depthNow() + 1,
        },
        '',
        next,
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
      // 来た画面へ: 用語集の中でたどった数 + 用語集に入った 1 つを戻る（直接開いても履歴は [/, /settings, /glossary] に
      // 組み直してあるので設定へ戻る。アプリの中に前の画面が無い古い履歴だけ設定へのリンク）
      onBack={
        back || depthOf(window.history.state) > 0
          ? () => window.history.go(-(depthNow() + 1))
          : undefined
      }
    />
  );
}
