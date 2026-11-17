// アプリの殻: ログインの門を通し、今の画面を枠（Shell）に入れて描く。URL・テーマ・ログインは main.tsx が実物を渡す
import type { ComponentType, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorCode, loginErrorMessage, SIGN_OUT_FAILED } from './auth/errors';
import { type AuthState, gate } from './auth/gate';
import type { AuthSession } from './auth/session';
import { loadParts } from './devPages';
import { Shell } from './layout/Shell';
import { type Navigator, NavigatorContext, useCurrent } from './lib/router';
import { hrefOf, type Route, titleOf } from './lib/routes';
import { applyTheme, type StorageLike, type Theme, writeTheme } from './lib/theme';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Record } from './pages/Record';
import { Settings } from './pages/Settings';
import { TradeDetail } from './pages/TradeDetail';
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
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(props.initialLoginError ?? null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [Parts, setParts] = useState<ComponentType | null>(null);
  const first = useRef(true);

  useEffect(() => session.subscribe(setAuth), [session]);

  const g = gate(auth, route, hrefOf(route), search, { dev });
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
    session
      .signOut()
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
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    if (via === 'push') window.scrollTo(0, 0);
  }, [route, via, g.render]);

  let body: JSX.Element;
  if (g.render === 'login') {
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
      <Shell route={route} emulator={emulator}>
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
  return <NavigatorContext.Provider value={nav}>{body}</NavigatorContext.Provider>;
}
