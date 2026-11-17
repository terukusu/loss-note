// 開発のビルドのときだけ使うログインの既定値（すべて架空。エミュレーターは値を見ない）。
// main.tsx が import.meta.env.DEV のときだけ参照するので、本番のビルドには入らない（tests/ui/prod-build.test.ts）
import type { AuthDefaults } from './config';

export const DEV_AUTH_DEFAULTS: AuthDefaults = {
  projectId: 'demo-loss-note',
  apiKey: 'demo-api-key',
  emulatorUrl: 'http://127.0.0.1:9099',
};
