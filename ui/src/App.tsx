// アプリの殻: 今の画面を枠（Shell）に入れて描く。URL・テーマは main.tsx が実物を渡す
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { loadParts } from './devPages';
import { Shell } from './layout/Shell';
import { type Navigator, NavigatorContext, useCurrent } from './lib/router';
import { type Route, titleOf } from './lib/routes';
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
  readonly initialTheme: Theme;
  readonly storage: StorageLike | null;
  readonly root: { setAttribute(name: string, value: string): void };
}

export interface PageProps {
  readonly route: Route;
  readonly theme: Theme;
  readonly onTheme: (t: Theme) => void;
  readonly Parts: ComponentType | null;
}

/** 画面の中身（hooks を持たない。テストで直接呼べる） */
export function Page({ route, theme, onTheme, Parts }: PageProps) {
  switch (route.name) {
    case 'login':
      return <Login />;
    case 'home':
      return <Home />;
    case 'record':
      return <Record />;
    case 'trades':
      return <Trades />;
    case 'trade':
      return <TradeDetail id={route.id} />;
    case 'settings':
      return <Settings theme={theme} onTheme={onTheme} />;
    case 'parts':
      return Parts ? <Parts /> : <p class="loading">読み込み中…</p>;
  }
}

export function App({ nav, initialTheme, storage, root }: AppProps) {
  const { route, via } = useCurrent(nav);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [Parts, setParts] = useState<ComponentType | null>(null);
  const first = useRef(true);

  const onTheme = (t: Theme) => {
    // その場で効かせ、保存は試すだけ（失敗しても画面にエラーを出さない。T4）
    applyTheme(root, t);
    writeTheme(storage, t);
    setTheme(t);
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
    // 画面が変わったら見出しへフォーカスを移す（最初の表示では動かさない）
    if (first.current) {
      first.current = false;
      return;
    }
    // 見出しへフォーカスを移す（フォーカスでスクロールさせない）。先頭へ戻すのは新しい画面へ進んだときだけで、
    // 戻る・進むではブラウザが元の位置を戻す（history.scrollRestoration の既定 auto。P6）
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
    if (via === 'push') window.scrollTo(0, 0);
  }, [route, via]);

  return (
    <NavigatorContext.Provider value={nav}>
      <Shell route={route}>
        <Page route={route} theme={theme} onTheme={onTheme} Parts={Parts} />
      </Shell>
    </NavigatorContext.Provider>
  );
}
