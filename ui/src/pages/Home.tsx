// ホーム（タブ 1。`/`。#128。設計書 0.4 の K18・9.2 のホーム・ui-guidelines 9.4）: スクロールしない 1 画面。
// 上から 小さな見出し（印 + 「損失ノート」と今日の日付）→（書きかけがあれば「記録の書きかけがあります ›」）→ 直近の流れ（主役。
// 押すと取引のタブ。#35）→ 今月の規律（計画どおり率と規律コストの 2 つの数字と小さな曲線。期間は今月に固定・取り込みを外す。
// 押すと振り返りのタブを今月で。#88・C44）→ 直近の取引 3 件（詰めた行）と「すべての取引 ›」。期間の選択・内訳・表・注記は
// 振り返りのタブ（`/review`）へ移した。［記録する］ は下のタブの ［＋ 記録］ だけ（#127）。
// 読むのは決済の新しい順の先頭 10 件（直近の流れと直近の取引。#87）と、今月の範囲の取引（今月の規律。直近とは別に読む =
// 失敗を巻き込まない。#88 KEEP-4）。Home・HomeView は hook を持たない（App のテストが 1 段だけ呼ぶ）。等倍の文字で窓に入らない
// 高さでは 3 件目の行から CSS で隠し、文字の拡大では縦に伸びる（切らない。9.4）
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { InstrumentRecord } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { EmptyState } from '../components/EmptyState';
import { DraftRow, HomeHead, HomeRecent, MonthCard } from '../components/HomeCards';
import { StreakSection } from '../components/StreakStrip';
import { recordKey } from '../lib/drafts';
import { DraftsKeptContext } from '../lib/drafts-context';
import { HOME_RECENT, homeDate, type MonthSlot, monthCard } from '../lib/home-view';
import { monthSelection, periodRange, reviewHref } from '../lib/period';
import { createReviewController, type ReviewState } from '../lib/review-controller';
import { reviewModelFor } from '../lib/review-view';
import { NavigatorContext } from '../lib/router';
import { streakModel } from '../lib/streak';
import { HOME_LIMIT } from '../lib/trade-pages';
import { recentRows, visibleTrades } from '../lib/trade-view';
import type { TradesState } from '../lib/trades-controller';
import { LoadState, useTrades } from './Trades';

export function Home() {
  return (
    <HomeScreen
      empty={
        <EmptyState
          icon="record"
          title="最初の取引を記録しましょう"
          description="決済したら、その場で 30 秒。[記録] を押して、決済明細とチャートのスクショを貼り付け、LC と 3 つの質問に答えると判定が表示されます。"
        />
      }
    />
  );
}

const NO_INSTRUMENTS: readonly InstrumentRecord[] = [];

/** 今月の規律（今月 1 日〜今日の範囲を読む。「今」は開いたとき・タブを押し直したときに読む） */
function useMonth(instruments: readonly InstrumentRecord[], hidden: ReadonlySet<string>) {
  const nav = useContext(NavigatorContext);
  const [now, setNow] = useState(() => Date.now());
  const sel = useMemo(() => monthSelection(now), [now]);
  const range = useMemo(() => periodRange(sel, now), [sel, now]);
  const controller = useMemo(() => createReviewController({ api }), []);
  const [state, setState] = useState<ReviewState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  const from = range.ok ? range.from : null;
  const to = range.ok ? range.to : null;
  useEffect(() => {
    void controller.load(from === null || to === null ? null : { from, to });
  }, [controller, from, to]);
  // ホームの根でタブを押した（retap）: 日をまたいでいれば今日に合わせ、裏で読み直す（9.7 の 3）
  useEffect(
    () =>
      nav?.subscribe(() => {
        if (nav.current.via !== 'retap') return;
        const t = Date.now();
        if (monthSelection(t).to !== sel.to) setNow(t);
        else void controller.reload();
      }),
    [nav, controller, sel.to],
  );
  const model = useMemo(
    () => reviewModelFor(state, range, { hidden, includeImports: false, instruments, now }),
    [state, range, hidden, instruments, now],
  );
  const slot: MonthSlot = {
    state,
    card: model ? monthCard(model, range, sel) : null,
    onReload: () => {
      void controller.reload();
    },
    onRelogin: () => {
      void signOutActive();
    },
  };
  return { slot, now, href: reviewHref(sel) };
}

function HomeScreen({ empty }: { readonly empty: JSX.Element }) {
  const { state, controller, hidden } = useTrades({ pageSize: HOME_LIMIT });
  const month = useMonth(state.phase === 'ready' ? state.instruments : NO_INSTRUMENTS, hidden);
  const kept = useContext(DraftsKeptContext);
  return (
    <HomeView
      state={state}
      hidden={hidden}
      empty={empty}
      today={homeDate(month.now)}
      now={month.now}
      month={month.slot}
      monthHref={month.href}
      draft={kept.has(recordKey())}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
    />
  );
}

export interface HomeViewProps {
  readonly state: TradesState;
  readonly hidden: ReadonlySet<string>;
  readonly empty: JSX.Element;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /** 見出しの今日の日付（「11月19日（木）」） */
  readonly today?: string;
  /** 今（詰めた行の日付の年を出すか。無ければ描くとき） */
  readonly now?: number;
  /** 今月の規律（無ければ出さない） */
  readonly month?: MonthSlot;
  /** 今月の規律のカードを押した先（無ければ month.card.href） */
  readonly monthHref?: string;
  /** 記録する画面の書きかけを残している（「記録の書きかけがあります ›」） */
  readonly draft?: boolean;
}

/** ホームの 1 画面（hook を持たない）。取引が 0 件なら見出しの下に空の状態（［＋ 記録］ を指す一言。ボタンは足さない） */
export function HomeView(p: HomeViewProps) {
  const { state } = p;
  const head = <HomeHead today={p.today ?? ''} />;
  const draft = p.draft ? <DraftRow /> : null;
  if (state.phase !== 'ready') {
    return (
      <div class="home">
        {head}
        {draft}
        <LoadState {...p} />
      </div>
    );
  }
  const visible = visibleTrades(state.trades, p.hidden);
  if (visible.length === 0) {
    return (
      <div class="home">
        {head}
        {draft}
        {p.empty}
      </div>
    );
  }
  const rows = recentRows(visible, state.instruments, HOME_RECENT, state.accounts);
  const streak = streakModel(state.trades, p.hidden);
  const href = p.monthHref ?? p.month?.card?.href ?? '/review';
  return (
    <div class="home">
      {head}
      {draft}
      {streak ? <StreakSection model={streak} id="home-streak" /> : null}
      {p.month ? <MonthCard {...p.month} href={href} /> : null}
      <HomeRecent rows={rows} now={p.now ?? Date.now()} />
    </div>
  );
}
