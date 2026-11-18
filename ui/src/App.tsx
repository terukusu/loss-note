// アプリの殻: ログインの門を通し、今の画面を枠（Shell）に入れて描く。URL・テーマ・ログインは main.tsx が実物を渡す
import type { ComponentType, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorCode, loginErrorMessage, SIGN_OUT_FAILED } from './auth/errors';
import { onAuthKind } from './auth/forbidden';
import { type AuthState, gate } from './auth/gate';
import { type AuthSession, api, forbiddenFlag } from './auth/session';
import { TOAST_UNDO_ID, Toast } from './components/Toast';
import { loadParts } from './devPages';
import { Shell } from './layout/Shell';
import { createDeletions, type DeletionsState } from './lib/deletions';
import { DeletionsContext } from './lib/deletions-context';
import { type Navigator, NavigatorContext, useCurrent } from './lib/router';
import { hrefOf, type Route, titleOf } from './lib/routes';
import { applyTheme, type StorageLike, type Theme, writeTheme } from './lib/theme';
import { Forbidden } from './pages/Forbidden';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Record } from './pages/Record';
import { Settings } from './pages/Settings';
import { TradeDetail } from './pages/TradeDetail';
import { TradeEdit } from './pages/TradeEdit';
import { Trades } from './pages/Trades';

export const APP_NAME = 'loss-note';

export interface AppProps {
  readonly nav: Navigator;
  readonly session: AuthSession;
  readonly initialTheme: Theme;
  readonly storage: StorageLike | null;
  readonly root: { setAttribute(name: string, value: string): void };
  readonly dev: boolean;
  readonly emulator: boolean;
  /** 起動時のログインの失敗の案内（Firebase の初期化が失敗したとき） */
  readonly initialLoginError?: string | null;
}

export interface PageProps {
  readonly route: Route;
  readonly theme: Theme;
  readonly onTheme: (t: Theme) => void;
  readonly onSignOut: () => void;
  readonly signOutBusy?: boolean;
  readonly signOutError?: string | null;
  readonly Parts: ComponentType | null;
}

/** 門を通った後の画面の中身（hooks を持たない。テストで直接呼べる） */
export function Page(p: PageProps) {
  const { route, theme, onTheme, onSignOut, Parts } = p;
  switch (route.name) {
    case 'login':
      // 門がログイン画面を描くので、ここには来ない（ログイン済みは next へ置き換える）
      return <Loading />;
    case 'home':
      return <Home />;
    case 'record':
      return <Record />;
    case 'trades':
      return <Trades />;
    case 'trade':
      return <TradeDetail id={route.id} />;
    case 'tradeEdit':
      return <TradeEdit id={route.id} />;
    case 'settings':
      return (
        <Settings
          theme={theme}
          onTheme={onTheme}
          onSignOut={onSignOut}
          signOutBusy={p.signOutBusy ?? false}
          signOutError={p.signOutError ?? null}
        />
      );
    case 'parts':
      return Parts ? <Parts /> : <Loading />;
  }
}

/** ログインの状態が分かるまでの面（中身もログイン画面も出さない） */
export function Loading() {
  return (
    <p class="loading" role="status">
      読み込み中…
    </p>
  );
}

export function App(props: AppProps) {
  const { nav, session, initialTheme, storage, root, dev, emulator } = props;
  const { route, search, via } = useCurrent(nav);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [auth, setAuth] = useState<AuthState>({ kind: 'unknown' });
  const [forbidden, setForbidden] = useState(forbiddenFlag.isSet());
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(props.initialLoginError ?? null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [Parts, setParts] = useState<ComponentType | null>(null);
  const first = useRef(true);
  // 取引を消す + [元に戻す]（Issue #9。ADR-0007）: アプリの殻に 1 つ。画面を移っても取り消せる
  const deletions = useMemo(
    () =>
      createDeletions({
        api,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      }),
    [],
  );
  const [delState, setDelState] = useState<DeletionsState>(deletions.getState());
  useEffect(() => deletions.subscribe(setDelState), [deletions]);
  /** [消す] の直後の画面の移りでは、見出しではなく [元に戻す] へフォーカスを移す（8 秒の間にキーで届くように） */
  const focusUndo = useRef(false);
  const removeTrade = (id: string, label: string) => {
    focusUndo.current = true;
    deletions.remove(id, label);
  };
  /** トーストが閉じた後は、見出しへフォーカスを戻す（body に落とさない） */
  const focusHeading = () => {
    setTimeout(
      () => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }),
      0,
    );
  };
  // タブが隠れた・ページを離れるときは、待っている削除をすぐ送る（届かなければ取引は残る側に倒れる）
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void deletions.flush();
    };
    const onPageHide = () => {
      void deletions.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [deletions]);

  useEffect(() => session.subscribe(setAuth), [session]);
  useEffect(() => forbiddenFlag.subscribe(setForbidden), []);
  // 使えないアカウント（#43）: ログイン・ログアウトで旗を下ろし、ログインしたら 1 度だけ読んで確かめる
  // （ホームは /api を読まないので、403 をすぐ受けて「このアカウントでは使えません」を出す。forbidden.ts）
  useEffect(() => onAuthKind(auth.kind, forbiddenFlag, () => api('/api/settings')), [auth.kind]);

  const g = gate(auth, route, hrefOf(route), search, { dev }, forbidden);
  useEffect(() => {
    if (g.replace !== undefined) nav.replace(g.replace);
  }, [g.replace, nav]);

  const onTheme = (t: Theme) => {
    // その場で効かせ、保存は試すだけ（失敗しても画面にエラーを出さない。T4）
    applyTheme(root, t);
    writeTheme(storage, t);
    setTheme(t);
  };

  const onSignIn = () => {
    setBusy(true);
    setLoginError(null);
    session
      .signIn()
      .catch((e: unknown) => setLoginError(loginErrorMessage(errorCode(e))))
      .finally(() => setBusy(false));
  };

  const onSignOut = () => {
    // 状態が signedOut になると門がログイン画面へ置き換える。戻り先は付けない
    setSignOutBusy(true);
    setSignOutError(null);
    // 待っている削除は、ログアウトの前に送る（ID トークンがあるうちに）
    deletions
      .flush()
      .then(() => session.signOut())
      .then(() => deletions.reset())
      .then(() => nav.replace('/login'))
      .catch(() => setSignOutError(SIGN_OUT_FAILED))
      .finally(() => setSignOutBusy(false));
  };

  useEffect(() => {
    if (route.name !== 'parts' || Parts || !loadParts) return;
    let alive = true;
    loadParts().then((C) => {
      if (alive) setParts(() => C);
    });
    return () => {
      alive = false;
    };
  }, [route.name, Parts]);

  useEffect(() => {
    document.title = titleOf(route);
    if (g.render === 'loading') return;
    // 画面が変わったら見出しへフォーカスを移す（最初の表示では動かさない。フォーカスでスクロールさせない）。
    // 先頭へ戻すのは新しい画面へ進んだときだけで、戻る・進むではブラウザが元の位置を戻す（P6）
    if (first.current) {
      first.current = false;
      return;
    }
    const undo = focusUndo.current ? document.getElementById(TOAST_UNDO_ID) : null;
    focusUndo.current = false;
    if (undo) undo.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    if (via === 'push') window.scrollTo(0, 0);
  }, [route, via, g.render]);

  let body: JSX.Element;
  if (g.render === 'forbidden') {
    body = (
      <Shell route={route} bare>
        <Forbidden onSignOut={onSignOut} signOutBusy={signOutBusy} signOutError={signOutError} />
      </Shell>
    );
  } else if (g.render === 'login') {
    body = (
      <Shell route={route}>
        <Login onSignIn={onSignIn} busy={busy} error={loginError} emulator={emulator} />
      </Shell>
    );
  } else if (g.render === 'loading') {
    body = (
      <Shell route={route} bare>
        <Loading />
      </Shell>
    );
  } else {
    body = (
      <Shell
        route={route}
        emulator={emulator}
        toast={
          <Toast
            toast={delState.toast}
            failed={delState.failed}
            onUndo={() => {
              deletions.undo();
              focusHeading();
            }}
            onDismiss={() => {
              deletions.dismiss();
              focusHeading();
            }}
            onDismissFailed={() => {
              deletions.dismissFailed();
              focusHeading();
            }}
            onHold={deletions.hold}
            onResume={deletions.resume}
          />
        }
      >
        <Page
          route={route}
          theme={theme}
          onTheme={onTheme}
          onSignOut={onSignOut}
          signOutBusy={signOutBusy}
          signOutError={signOutError}
          Parts={Parts}
        />
      </Shell>
    );
  }
  return (
    <NavigatorContext.Provider value={nav}>
      <DeletionsContext.Provider value={{ state: delState, deletions, remove: removeTrade }}>
        {body}
      </DeletionsContext.Provider>
    </NavigatorContext.Provider>
  );
}
