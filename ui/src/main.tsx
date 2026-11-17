// 起動: テーマを描く前に当て（インラインの script は CSP で使えないので、ここで最初に行う）、
// 実物の history・localStorage・<html>・ログインの接続を App に渡す
import { render } from 'preact';
import { App } from './App';
import { readAuthConfig } from './auth/config';
import { DEV_AUTH_DEFAULTS } from './auth/devDefaults';
import { UNAVAILABLE } from './auth/errors';
import { type AuthSession, createFirebaseSession, unavailableSession } from './auth/session';
import { createNavigator, windowEnv } from './lib/router';
import { applyTheme, readTheme, safeStorage } from './lib/theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const storage = safeStorage(() => window.localStorage);
const theme = readTheme(storage);
applyTheme(document.documentElement, theme);

const dev = import.meta.env.DEV;
// 既定値（架空のプロジェクトとエミュレーター）は開発のビルドのときだけ。本番は変数で受け取る（ADR-0003）
const config = readAuthConfig(import.meta.env, dev ? DEV_AUTH_DEFAULTS : {});
// 初期化が例外を投げても（接続先の設定の誤りなど）白い画面にせず、ログイン画面に案内を出す（例外の本文は出さない）
let session: AuthSession;
let initialLoginError: string | null = null;
try {
  session = createFirebaseSession(config);
} catch {
  session = unavailableSession();
  initialLoginError = UNAVAILABLE;
}
const nav = createNavigator(windowEnv(window), { dev });
const root = document.getElementById('app');
if (root) {
  render(
    <App
      nav={nav}
      session={session}
      initialTheme={theme}
      storage={storage}
      root={document.documentElement}
      dev={dev}
      emulator={config.emulatorUrl !== null}
      initialLoginError={initialLoginError}
    />,
    root,
  );
}
