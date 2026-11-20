// 画面の行き来の薄い層（History API。契約 C-5・ADR-0002）。履歴は NavEnv で差し替えられる
// （テストは偽物、main.tsx だけが実物の window を渡す）。タブごとの積み重ねと戻るの規則は tab-nav.ts の純関数（#127・
// ui-guidelines 9.7）で、ここは計画を history で行い、go の間の popstate を画面に出さない
import { createContext, type JSX } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import {
  type Resolved,
  type RouteOptions,
  resolveNavigation,
  rootTabOf,
  shouldInterceptClick,
  type Tab,
  tabOfRoute,
  tabRoot,
} from './routes';
import {
  bootMarks,
  MARK_KEYS,
  markState,
  memoryOf,
  type NavMark,
  planRetap,
  planTabSwitch,
  pushMark,
  readMark,
  replaceMark,
  type TabMemory,
} from './tab-nav';

/** ブラウザの履歴の最小限 */
export interface NavEnv {
  location(): { readonly pathname: string; readonly search: string };
  /** mark = この項目の印（history.state に持つ。tab-nav.ts。省けば印を持たない） */
  pushState(url: string, mark?: NavMark): void;
  replaceState(url: string, mark?: NavMark): void;
  /** 戻る・進む（popstate）の購読。やめる関数を返す */
  onPopState(fn: () => void): () => void;
  /** 今の項目の history.state（印を読む。無ければ「印なし」= 起動で並びを組み直す） */
  readState?(): unknown;
  /** ブラウザの戻る（history.back）。無ければ「前の画面」は置き換えに倒れる */
  back?(): void;
  /** history.go(n)（タブの切り替え・同じタブの押し直しで根の段まで戻す。無ければ戻らずに続ける） */
  go?(n: number): void;
  /** 今の窓のスクロールの位置（タブの記憶に残す。無ければ 0） */
  scrollY?(): number;
  /** ms 後に呼ぶ。取り消す関数を返す（go の popstate が来ないときの保険。無ければ待ち続ける） */
  defer?(fn: () => void, ms: number): () => void;
  /**
   * 利用者の最初の操作（ユーザーのアクティベーション）のときに 1 度だけ呼ぶ。印の無い起動の組み直しをここまで待つ（操作の無いまま
   * 積んだ項目は、Chrome が戻る・history.go で飛ばすため。#127）。無ければすぐ組み直す
   */
  onActivation?(fn: () => void): void;
}

/**
 * 今の画面に着いた経路（init = 開いた・再読み込み、push = アプリの中で進んだ、replace = 置き換え、pop = 戻る / 進む、
 * tab = タブを替えて記憶の画面を積み直した（スクロールの位置は殻が戻す）、retap = 開いているタブの根でタブを押した
 * （先頭へ送って裏で読み直す））
 */
export type NavVia = 'init' | 'push' | 'replace' | 'pop' | 'tab' | 'retap';

export interface Navigator {
  readonly current: Resolved & {
    readonly search: string;
    readonly via: NavVia;
    /** 今の項目の印（タブ・ホームからの並び） */
    readonly mark: NavMark;
    /** via が tab のとき、殻が戻すスクロールの位置 */
    readonly scroll: number;
  };
  /** 進む。行き先がほかのタブの根なら、そのタブへ根で替える（ホームの「すべて」など）。今のタブの根なら根まで戻る */
  push(href: string): void;
  replace(href: string): void;
  /**
   * 前の画面へ（#75 の [キャンセル]・上の帯の「‹」）: 開いて閉じる層の段を巻き戻してから、アプリの中に前の画面があれば戻る、
   * 無ければ fallback へ置き換える（戻るでアプリの外へ出ない）
   */
  back(fallback: string): void;
  /** タブを押した（9.7 の 2・3。今のタブなら根へ / 先頭へ、ほかのタブなら記憶の画面へ） */
  tab(tab: Tab): void;
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

/** history.state のアプリの中の深さ（印の appDepth。無い・壊れた値は 0） */
export function depthOf(state: unknown): number {
  const raw =
    typeof state === 'object' && state !== null
      ? (state as Record<string, unknown>)[MARK_KEYS.depth]
      : undefined;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export function windowEnv(win: Window): NavEnv {
  const stateOf = (mark: NavMark | undefined) => (mark ? markState(mark) : null);
  return {
    location: () => ({ pathname: win.location.pathname, search: win.location.search }),
    pushState: (url, mark) => win.history.pushState(stateOf(mark), '', url),
    replaceState: (url, mark) => win.history.replaceState(stateOf(mark), '', url),
    onPopState: (fn) => {
      win.addEventListener('popstate', fn);
      return () => win.removeEventListener('popstate', fn);
    },
    readState: () => win.history.state,
    back: () => win.history.back(),
    go: (n) => win.history.go(n),
    scrollY: () => win.scrollY,
    defer: (fn, ms) => {
      const t = win.setTimeout(fn, ms);
      return () => win.clearTimeout(t);
    },
    onActivation: (fn) => {
      const kinds = ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'] as const;
      const on = () => {
        if (win.navigator.userActivation && !win.navigator.userActivation.isActive) return;
        for (const k of kinds) win.removeEventListener(k, on, true);
        fn();
      };
      for (const k of kinds) win.addEventListener(k, on, true);
    },
  };
}

/** 画面の行き来に添える知らせ（#57: 開いて閉じる層の記録を捨てる。back-layers.ts の reset） */
export interface NavHooks {
  /**
   * 画面が移る（push・replace は履歴を書く前、ほかの URL への戻る / 進むは着いた後）。URL の変わらない戻る（層の段）では
   * 呼ばない。push の前に呼ぶのは、層の記録を捨てて今の項目のスクロールの復元を auto に戻してから次の項目を積むため
   */
  readonly onNavigate?: () => void;
  /**
   * replace・前の画面へ・タブの切り替えの前: 開いて閉じる層の段が積まれていれば巻き戻し、元の項目に着いてから done を呼ぶ
   * （true）。段が無ければ false（すぐ行う）。back-layers.ts の unwind（#57 再レビュー B3）
   */
  readonly unwind?: (done: () => void) => boolean;
}

/** go の popstate が来ないときに、待ちを解いて続けるまでの時間（ms） */
const GO_TIMEOUT_MS = 1000;

export function createNavigator(env: NavEnv, opts: RouteOptions, hooks: NavHooks = {}): Navigator {
  const listeners = new Set<() => void>();
  const homeMark: NavMark = { depth: 0, tab: 'home', stack: ['/'] };
  let current: Navigator['current'] = {
    route: { name: 'home' },
    search: '',
    via: 'init',
    mark: homeMark,
    scroll: 0,
  };
  /** 今の画面の URL（パス + 検索）。URL の変わらない popstate（層の段の出入り）を見分ける */
  let at = '';
  /** 今の項目の印 */
  let mark: NavMark = homeMark;
  /** 今の並びの各段のスクロールの位置（進む前に覚える。添え字は深さ） */
  let scrolls: number[] = [];
  /** タブごとの記憶（タブの記憶の中だけ。端末の保存先に書かない） */
  const memory = new Map<Tab, TabMemory>();
  /** タブの切り替えで積み直した段の深さ（いちばん上を除く。戻ってきたら殻が位置を戻す） */
  const repushed = new Set<number>();
  /** 利用者の最初の操作を待っている、印の無い起動の組み直し（#127） */
  let pendingBoot: { href: string; mark: NavMark }[] | null = null;
  /** go の popstate を待っている間の続き（その間の popstate は画面に出さない） */
  let pending: { readonly land: () => void; readonly cancel: (() => void) | null } | null = null;

  const here = () => {
    const loc = env.location();
    return `${loc.pathname}${loc.search}`;
  };
  const readMarkNow = (): NavMark | null => readMark(env.readState?.(), here(), opts);

  /** 今の URL から画面を決める。知らない URL は履歴を置き換えてホーム */
  const sync = (via: NavVia, scroll = 0) => {
    const loc = env.location();
    const r = resolveNavigation(loc.pathname, opts);
    mark = readMarkNow() ??
      pendingBoot?.at(-1)?.mark ?? { depth: 0, tab: tabOfRoute(r.route), stack: [here()] };
    if (r.replace !== undefined) {
      mark = replaceMark(mark, r.replace);
      env.replaceState(r.replace, mark);
      current = { route: r.route, search: '', via, mark, scroll };
    } else {
      current = { route: r.route, search: loc.search, via, mark, scroll };
    }
    at = here();
    // 今のタブの記憶は今の並び（戻る・進むでも、そのタブにいる間は今の並びが記憶）
    memory.set(mark.tab, memoryOf(mark, scrolls, opts));
  };
  const notify = () => {
    for (const fn of listeners) fn();
  };
  /** 今の段のスクロールの位置を覚える（上の段は捨てる） */
  const keepScroll = () => {
    scrolls = scrolls.slice(0, mark.depth + 1);
    scrolls[mark.depth] = env.scrollY?.() ?? 0;
  };

  /** 組み直しを書く（待っていれば。利用者の操作の中で呼ぶ） */
  const runBoot = () => {
    const marks = pendingBoot;
    pendingBoot = null;
    if (!marks) return;
    marks.forEach((m, i) => {
      if (i === 0) env.replaceState(m.href, m.mark);
      else env.pushState(m.href, m.mark);
    });
  };
  // 起動: 印の無い項目（新しく開いた・外から来た・共有）だけ、並びを組み直す（9.7 の 5）。印があれば（再読み込み・前へ / 次へ・
  // bfcache）ブラウザの並びのまま。組み直しは利用者の最初の操作のときに書く（操作の無いまま積んだ項目は Chrome が戻る・
  // history.go で飛ばし、タブの切り替えの go が前のページまで戻ってしまう。触らずに戻ればアプリを出る = 9.7 の 5 の外れの側）
  if (env.readState && readMarkNow() === null) {
    const loc = env.location();
    const r = resolveNavigation(loc.pathname, opts);
    const href = r.replace ?? `${loc.pathname}${loc.search}`;
    const marks = bootMarks(href, opts);
    if (marks.length > 1 && env.onActivation) {
      pendingBoot = marks;
      env.onActivation(runBoot);
    } else {
      pendingBoot = marks;
      runBoot();
    }
  }
  sync('init');

  /** go(n) で戻り、着いたら then を呼ぶ（その popstate は画面に出さない）。前の go が着くまで次を始めない */
  const goQueue: (() => void)[] = [];
  let going = false;
  const nextGo = () => {
    going = false;
    const job = goQueue.shift();
    if (job) job();
  };
  /** n は始めるときに決める関数でもよい（前の go が着いた後の深さで数える = ログアウトの重なり。#127） */
  const goThen = (n: number | (() => number), then: () => void) => {
    const job = () => {
      going = true;
      const done = () => {
        then();
        nextGo();
      };
      const k = typeof n === 'function' ? n() : n;
      if (k === 0 || !env.go) {
        done();
        return;
      }
      const begin = () => {
        const cancel =
          env.defer?.(() => {
            const p = pending;
            pending = null;
            p?.land();
          }, GO_TIMEOUT_MS) ?? null;
        pending = { land: done, cancel };
        env.go?.(k);
      };
      // 層の段の巻き戻し（back-layers の popstate の中）から呼ばれたとき、同じ popstate が router にも届くので、
      // その後で始める（届いた popstate を自分の go の着地と取り違えない。#127）
      if (env.defer) env.defer(begin, 0);
      else begin();
    };
    if (going) goQueue.push(job);
    else job();
  };

  const off = env.onPopState(() => {
    if (pending) {
      const p = pending;
      pending = null;
      p.cancel?.();
      p.land();
      return;
    }
    // 開いて閉じる層（「i」の吹き出し）・ページの中でたどった段（用語集の #…）の出入りは URL（パス + 検索）が変わらない:
    // 画面を変えない（戻るで層だけを閉じる。#57）。印（深さ）だけは今の段のものにする（タブの切り替えで戻る段の数。#127 B1）
    if (here() === at) {
      const m = readMarkNow();
      if (m) {
        mark = m;
        current = { ...current, mark };
      }
      return;
    }
    // 積み直した段（タブの切り替え）へ戻った: ブラウザは位置を正しく覚えていないので、覚えていた位置を殻が戻す（#127 N1）
    const landed = readMarkNow();
    if (landed && repushed.has(landed.depth)) {
      repushed.delete(landed.depth);
      sync('pop', scrolls[landed.depth] ?? 0);
    } else sync('pop');
    hooks.onNavigate?.();
    notify();
  });

  /**
   * 今の段の印を読み直す（画面が自分で積んだ段 = 用語集の中でたどった #… は router に知らせずに積まれるので、操作の前に
   * 今の段の深さを読む。#127 B1）。URL（パス + 検索）が同じときだけ
   */
  const refresh = () => {
    if (pendingBoot || here() !== at) return;
    const m = readMarkNow();
    if (m) {
      mark = m;
      current = { ...current, mark };
    }
  };

  /** 層の段を巻き戻してから run（段が無ければすぐ） */
  const afterUnwind = (run: () => void) => {
    if (hooks.unwind?.(run)) return;
    run();
  };

  /** タブを替える（記憶の画面を積み直す。root = 記憶を捨てて根で開く） */
  const switchTab = (target: Tab, root: boolean) => {
    afterUnwind(() => {
      keepScroll();
      memory.set(mark.tab, memoryOf(mark, scrolls, opts));
      if (root) memory.delete(target);
      const mem = memory.get(target) ?? null;
      const plan = planTabSwitch(mark, target, mem);
      goThen(plan.go, () => {
        hooks.onNavigate?.();
        if (plan.replace) env.replaceState(plan.replace.href, plan.replace.mark);
        for (const p of plan.push) env.pushState(p.href, p.mark);
        // 積み直した段のスクロールの位置（記憶のまま。下の段はそのまま）
        const ys = mem?.scrolls ?? [0];
        scrolls = [...scrolls.slice(0, Math.max(0, plan.top.depth + 1 - ys.length)), ...ys];
        repushed.clear();
        for (const p of plan.push) if (p.mark.depth < plan.top.depth) repushed.add(p.mark.depth);
        sync('tab', plan.scroll);
        notify();
      });
    });
  };

  /** 同じタブを押し直した（根へ戻る / 根なら先頭へ） */
  const retap = () => {
    afterUnwind(() => {
      const plan = planRetap(mark);
      if (plan === 'top') {
        hooks.onNavigate?.();
        env.replaceState(here(), mark);
        sync('retap');
        notify();
        return;
      }
      goThen(plan.go, () => {
        hooks.onNavigate?.();
        sync('pop');
        notify();
      });
    });
  };

  return {
    get current() {
      return current;
    },
    push(href) {
      runBoot();
      refresh();
      const path = href.split(/[?#]/)[0] ?? '';
      const r = resolveNavigation(path, opts);
      // ほかのタブの根へ: そのタブへ根で替える（積まない。9.4 の「すべて ›」）。今のタブの根へ（次の画面から）: 根まで戻る
      const rootTab = r.replace === undefined ? rootTabOf(r.route) : null;
      if (rootTab && href === tabRoot(rootTab) && href !== at) {
        if (rootTab !== mark.tab) {
          switchTab(rootTab, true);
          return;
        }
        if (planRetap(mark) !== 'top') {
          retap();
          return;
        }
      }
      // 今と同じ画面（パス + 検索）へは積まずに置き換える（同じ URL が 2 つ積まれると、[キャンセル] の戻るが URL の変わらない
      // 戻る = 層の段とみなされて画面が移らない。#75 B1）。開いて閉じる層の段があれば巻き戻してから（R5）。殻には「進んだ」
      // （push）と伝え、見出しへのフォーカスと先頭へのスクロールは今までどおり（R6）
      if (href.split('#')[0] === at) {
        afterUnwind(() => {
          hooks.onNavigate?.();
          env.replaceState(href, replaceMark(mark, href));
          sync('push');
          notify();
        });
        return;
      }
      // 知らない画面へは積まずに置き換える（戻るで知らない URL に戻らない）
      hooks.onNavigate?.();
      if (r.replace !== undefined) env.replaceState(r.replace, replaceMark(mark, r.replace));
      else {
        keepScroll();
        env.pushState(href, pushMark(mark, href));
      }
      sync('push');
      notify();
    },
    replace(href) {
      // 利用者の操作の前の置き換え（ログインの門）: 組み直しは捨て、今の 1 段のまま
      if (pendingBoot) {
        pendingBoot = null;
        mark = { depth: 0, tab: mark.tab, stack: [here()] };
      }
      refresh();
      const to = resolveNavigation(href.split(/[?#]/)[0] ?? '', opts).route;
      if (to.name === 'login') {
        // ログインの画面へ（ログアウト・ログインが切れた）: ホームの段まで戻って置き換え、タブの記憶を捨てる（次に
        // ログインした利用者にタブ・積み重ねを持ち越さない。#127 B2）
        afterUnwind(() => {
          goThen(
            () => -mark.depth,
            () => {
              hooks.onNavigate?.();
              memory.clear();
              repushed.clear();
              scrolls = [0];
              env.replaceState(href, { depth: 0, tab: 'home', stack: [href] });
              sync('replace');
              notify();
            },
          );
        });
        return;
      }
      if (current.route.name === 'login') {
        // ログインの画面から行き先へ（ログインした）: ログインの押下が利用者の操作なので、印の無い起動と同じく並びを
        // 組み直す（`/trades/a` → `[/, /trades, /trades/a]`。#127 B2・N2）
        hooks.onNavigate?.();
        bootMarks(href, opts).forEach((m, i) => {
          if (i === 0) env.replaceState(m.href, m.mark);
          else env.pushState(m.href, m.mark);
        });
        sync('replace');
        notify();
        return;
      }
      afterUnwind(() => {
        hooks.onNavigate?.();
        env.replaceState(href, replaceMark(mark, href));
        sync('replace');
        notify();
      });
    },
    back(fallback) {
      runBoot();
      refresh();
      afterUnwind(() => {
        if (mark.depth > 0 && env.back) {
          // popstate で画面が移る（onNavigate・notify は popstate の側）
          env.back();
          return;
        }
        hooks.onNavigate?.();
        env.replaceState(fallback, replaceMark(mark, fallback));
        sync('replace');
        notify();
      });
    },
    tab(t) {
      runBoot();
      refresh();
      if (t === mark.tab) retap();
      else switchTab(t, false);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      off();
      pending?.cancel?.();
      pending = null;
      listeners.clear();
    },
  };
}

export const NavigatorContext = createContext<Navigator | null>(null);

/** 今の画面（URL が変わると描き直す） */
export function useCurrent(nav: Navigator): Navigator['current'] {
  const [cur, setCur] = useState(nav.current);
  useEffect(() => nav.subscribe(() => setCur(nav.current)), [nav]);
  return cur;
}

type AnchorProps = JSX.HTMLAttributes<HTMLAnchorElement> & {
  href: string;
  /** タブ（下のタブ・行き先）: 押すと push ではなく nav.tab（9.7 の 2・3。href はそのタブの根） */
  tab?: Tab;
};

/** アプリの中のリンク。左クリックだけを横取りして push（タブなら nav.tab）し、新しいタブ等はブラウザに任せる */
export function Link({ href, onClick, tab, ...rest }: AnchorProps) {
  const nav = useContext(NavigatorContext);
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (typeof onClick === 'function') onClick(e);
        if (!nav || !shouldInterceptClick(e)) return;
        e.preventDefault();
        if (tab) nav.tab(tab);
        else nav.push(href);
      }}
    />
  );
}
