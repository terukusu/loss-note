// 開発の時だけの画面（部品の見本）。本番のビルドでは import.meta.env.DEV が false になり、
// 読み込み自体がビルドから外れる（本番の /dev/parts は知らない URL = ホーム）
import type { ComponentType } from 'preact';

export const loadParts: (() => Promise<ComponentType>) | null = import.meta.env.DEV
  ? () => import('./pages/dev/Parts').then((m) => m.Parts)
  : null;
