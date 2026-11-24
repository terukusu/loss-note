// アプリとしてインストール（#121）の状態を殻の外（main.tsx）から設定の画面へ渡す文脈。無い = 案内を出せないブラウザと同じ
import { createContext } from 'preact';
import { IDLE_INSTALL, type InstallStore } from './install-prompt';

export const InstallContext = createContext<InstallStore>(IDLE_INSTALL);
