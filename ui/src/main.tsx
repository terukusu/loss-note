// 起動: テーマを描く前に当て（インラインの script は CSP で使えないので、ここで最初に行う）、
// 実物の history・localStorage・<html>・ログインの接続を App に渡す
import { render } from 'preact';
import { App } from './App';
import { readAuthConfig } from './auth/config';
import { DEV_AUTH_DEFAULTS } from './auth/devDefaults';
import { UNAVAILABLE } from './auth/errors';
import { type AuthSession, createFirebaseSession, unavailableSession } from './auth/session';
import { createBackLayers, installBackLayers, windowBackEnv } from './lib/back-layers';
import { InstallContext } from './lib/install-context';
import { createInstallStore } from './lib/install-prompt';
import { installKeyboardReveal } from './lib/keyboard-reveal';
import { createNavigator, windowEnv } from './lib/router';
import { applyTheme, readTheme, safeStorage } from './lib/theme';
import { createScreenMotion, installPressFeedback, windowMotionEnv } from './lib/view-transition';
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
// アプリとしてインストール（#121）: 描く前に作り、設定のタブを開く前に届いたインストールの案内の権利も受け取る
const install = createInstallStore(window);
// 開いて閉じる層（「i」の吹き出し）を戻るで閉じる記録（#57）。画面が移ったら記録を捨てる
const layers = createBackLayers(windowBackEnv(window));
installBackLayers(layers);
// キーボードで入力の欄が隠れないように寄せる（#172。ui-guidelines 9.6）
installKeyboardReveal(window);
// 画面の移りの動き（View Transitions）と押した手応え（#136。ui-guidelines 9.8）
const motion = createScreenMotion(windowMotionEnv(window));
installPressFeedback(window);
const nav = createNavigator(
  windowEnv(window),
  { dev },
  {
    onNavigate: () => layers.reset(),
    unwind: (done) => layers.unwind(done),
    transition: (change, update, target) => motion.run(change, update, target),
  },
);
const root = document.getElementById('app');
if (root) {
  render(
    <InstallContext.Provider value={install}>
      <App
        nav={nav}
        motion={motion}
        session={session}
        initialTheme={theme}
        storage={storage}
        root={document.documentElement}
        dev={dev}
        emulator={config.emulatorUrl !== null}
        initialLoginError={initialLoginError}
      />
    </InstallContext.Provider>,
    root,
  );
}
