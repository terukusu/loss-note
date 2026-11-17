import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'ui',
  server: {
    // 実際の売買の記録の写しとエミュレーターの書き出し（data/local/）を、開発サーバーの /@fs/ からも配らない。
    // Vite の既定の拒否（.env・.env.*・*.{crt,pem}・**/.git/**）も書き残す
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/local/**'] },
    // 手元の API（api/ の Flask。`npm run dev:api` で 8000 番）へ /api を渡す（同一オリジンを保つ）
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // CSP（script-src 'self'）のため、modulepreload の polyfill（インライン script）を入れない
    modulePreload: { polyfill: false },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
