// 起動: テーマを描く前に当て（インラインの script は CSP で使えないので、ここで最初に行う）、
// 実物の history・localStorage・<html> を App に渡す
import { render } from 'preact';
import { App } from './App';
import { createNavigator, windowEnv } from './lib/router';
import { applyTheme, readTheme, safeStorage } from './lib/theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

const storage = safeStorage(() => window.localStorage);
const theme = readTheme(storage);
applyTheme(document.documentElement, theme);

const nav = createNavigator(windowEnv(window), { dev: import.meta.env.DEV });
const root = document.getElementById('app');
if (root) {
  render(
    <App nav={nav} initialTheme={theme} storage={storage} root={document.documentElement} />,
    root,
  );
}
