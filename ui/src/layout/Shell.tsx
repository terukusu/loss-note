// アプリの殻（docs/ui-guidelines.md 9.2・9.6・9.7。ADR-0021。#127）: 行き先のタブ 4 つ（ホーム・取引・振り返り・設定）と
// 真ん中の ［＋ 記録］（作業の入口）。幅 720px 未満は下のタブ（親指で届く。下の安全域の分だけ内側）、それ以上は上の帯の中に
// 横並び（画面の 3 つの形は U9（#134） で入れる）。全画面のシート（記録する・編集）の間は、幅 720px 未満の下のタブを隠す（下の帯を
// 1 段にする）。今の「印 + 損失ノート」の帯は幅 720px 以上だけに置き、幅 720px 未満の画面ごとの帯（題・戻る・操作）は各画面の
// 上の帯（AppBar.tsx）と、タブの根の大きな題（PageHeader）が持つ。上の安全域には面を敷く（ライトのテーマでも状態のバーの白い
// 文字が読めるよう暗くする。9.6）。ログイン画面には行き先を出さない。hook を持たない（テストは関数を呼んで木にする）
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DraftDot } from '../components/Button';
import { Icon } from '../components/Icon';
import { APP_NAME } from '../lib/app-name';
import { DRAFT_DOT_TEXT } from '../lib/drafts';
import { Link } from '../lib/router';
import {
  RECORD_ENTRY,
  type Route,
  screenKindOf,
  TAB_ITEMS,
  type Tab,
  type TabItem,
} from '../lib/routes';

export interface ShellProps {
  readonly route: Route;
  readonly children: ComponentChildren;
  /** 今のタブ（history.state の印。無ければ URL から決めたタブ） */
  readonly tab?: Tab;
  /** 手元のエミュレーターに繋いでいるか（帯に印を出す） */
  readonly emulator?: boolean;
  /** ログインの状態が分かるまでの面（行き先を出さない） */
  readonly bare?: boolean;
  /** トースト（[元に戻す] など。#9。画面を移っても残る。幅 720 未満は下のタブ（シートの間は下の帯）の上、以上は右下） */
  readonly toast?: ComponentChildren;
  /** 記録する画面の書きかけを残している（［＋ 記録］ に印の点。#75） */
  readonly recordDraft?: boolean;
  /** タブの根の小さな題（RootTitleBar。App が作る。タブの根の画面だけに置く） */
  readonly rootbar?: ComponentChildren;
}

function Brand() {
  return (
    <span class="brand">
      <span class="brand__mark">
        <Icon name="mark" />
      </span>
      <span class="brand__name">{APP_NAME}</span>
    </span>
  );
}

/** タブ（押すと nav.tab。修飾キー・中クリックはブラウザに任せる = 新しいタブで根を開く） */
function TabLink({ item, current }: { readonly item: TabItem; readonly current: boolean }) {
  return (
    <Link
      href={item.href}
      tab={item.tab}
      id={`appnav-${item.tab}`}
      class="appnav__link"
      aria-current={current ? 'page' : undefined}
    >
      <Icon name={item.icon} class="appnav__icon" />
      <span class="appnav__label">{item.label}</span>
    </Link>
  );
}

/** 真ん中の ［＋ 記録］（見える文字「記録」、読み上げの名前「記録する」。書きかけがあれば点） */
function RecordEntry({ current, draft }: { readonly current: boolean; readonly draft: boolean }) {
  return (
    <Link
      href={RECORD_ENTRY.href}
      id="appnav-record"
      class="appnav__link appnav__record"
      aria-current={current ? 'page' : undefined}
    >
      <span class="appnav__fab" aria-hidden="true">
        <Icon name="plus" />
      </span>
      <span class="appnav__label">
        <span aria-hidden="true">{RECORD_ENTRY.label}</span>
        <span class="sr-only">{RECORD_ENTRY.name}</span>
      </span>
      {draft ? <DraftDot text={DRAFT_DOT_TEXT} /> : null}
    </Link>
  );
}

/**
 * タブの根の小さな題（9.2）: 中身の先頭の大きな題（.pagehead__title）がスクロールで流れたら、上の帯に小さな題を残す。
 * 幅 720px 未満だけ（それ以上は上の帯がある）。読み上げからは隠す（題は h1 が持つ）。App が作って殻に渡す（殻は hook を持たない）
 */
export function RootTitleBar({ title }: { readonly title: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const h1 = document.querySelector('main .pagehead__title');
    if (!h1 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const e = entries.at(-1);
      if (e) setShown(!e.isIntersecting && e.boundingClientRect.top < 0);
    });
    io.observe(h1);
    return () => io.disconnect();
  }, [title]);
  return (
    <div class={shown ? 'rootbar rootbar--shown' : 'rootbar'} aria-hidden="true">
      <span class="rootbar__title">{title}</span>
    </div>
  );
}

/** 今のタブの名前（タブの根の小さな題） */
export function tabLabel(tab: Tab): string {
  return TAB_ITEMS.find((t) => t.tab === tab)?.label ?? '';
}

export function Shell({
  route,
  children,
  tab,
  emulator,
  bare,
  toast,
  recordDraft,
  rootbar,
}: ShellProps) {
  if (route.name === 'login' || bare) {
    return (
      <div class="shell shell--bare">
        {/* 入口の画面も上の安全域に面を敷く（ライトのテーマで状態のバーの白い文字が読めるように。9.6・#127 N4） */}
        <div class="statusbar-bg" aria-hidden="true" />
        <main id="main" class="content content--center">
          {children}
        </main>
      </div>
    );
  }
  // 部品の見本（開発の時だけ）は入口の画面（shell--bare）の背景にしない
  const kind = screenKindOf(route) === 'bare' ? 'page' : screenKindOf(route);
  const sheet = kind === 'sheet';
  const currentTab = tab ?? 'home';
  const tabs = TAB_ITEMS.map((item) => (
    <li key={item.tab} class="appnav__item">
      <TabLink item={item} current={!sheet && item.tab === currentTab} />
    </li>
  ));
  return (
    <div class={`shell shell--${kind}`}>
      <div class="statusbar-bg" aria-hidden="true" />
      {kind === 'root' ? (rootbar ?? null) : null}
      <header class="apphead">
        <div class="apphead__inner">
          <div class="apphead__brand">
            <Brand />
            {emulator ? <span class="envchip">エミュレーター</span> : null}
          </div>
          <nav class="appnav" aria-label="メイン">
            <ul class="appnav__list">
              {tabs.slice(0, 2)}
              <li class="appnav__item appnav__item--record">
                <RecordEntry current={route.name === 'record'} draft={recordDraft ?? false} />
              </li>
              {tabs.slice(2)}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" class={`content content--${kind}`}>
        {children}
      </main>
      {toast ?? null}
    </div>
  );
}
