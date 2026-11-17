// 取引の一覧・詳細・直す・消すのソースの規則（Issue #9 KEEP-6・AC-5）。既存の source-rules.test.ts と同じ規則を、
// この Issue で足したファイルに当てる: 端末の保存先（Web Storage・IndexedDB など）に触れない、確認のダイアログを出さない、
// 履歴・URL に触れない（行き来は router の Navigator だけ）、object URL・data URL を作らない（チャートは canvas）
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../../ui/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FILES = [
  '../../ui/src/lib/trade-view.ts',
  '../../ui/src/lib/edit-form.ts',
  '../../ui/src/lib/trades-controller.ts',
  '../../ui/src/lib/trade-detail-controller.ts',
  '../../ui/src/lib/edit-controller.ts',
  '../../ui/src/lib/deletions.ts',
  '../../ui/src/lib/deletions-context.ts',
  '../../ui/src/lib/instrument-resolve.ts',
  '../../ui/src/components/Verdict.tsx',
  '../../ui/src/components/TradeFields.tsx',
  '../../ui/src/components/TradeRow.tsx',
  '../../ui/src/components/Toast.tsx',
  '../../ui/src/pages/Home.tsx',
  '../../ui/src/pages/Trades.tsx',
  '../../ui/src/pages/TradeDetail.tsx',
  '../../ui/src/pages/TradeEdit.tsx',
];

const DEVICE_STORAGE =
  /\b(localStorage|sessionStorage|indexedDB|IDBFactory|caches|document\.cookie)\b/;
const DIALOG =
  /\b(confirm|alert|prompt)\s*\(|<dialog[\s>]|role=["'](alert)?dialog["']|\bshowModal\s*\(/;
const HISTORY_OR_URL = /\b(history|location)\s*\./;
const OBJECT_OR_DATA_URL =
  /\bcreateObjectURL\b|\btoDataURL\b|\breadAsDataURL\b|\bFileReader\b|['"`]blob:|['"`]data:|<img[\s>]/;

describe('Issue #9 のソースの規則', () => {
  it.each(FILES)('%s がある', (path) => {
    expect(sources[path], path).toBeDefined();
  });

  it.each(FILES)('%s は端末の保存先に触れない', (path) => {
    expect(DEVICE_STORAGE.test(sources[path] ?? '')).toBe(false);
  });

  it.each(FILES)('%s は確認のダイアログを出さない（P4）', (path) => {
    expect(DIALOG.test(sources[path] ?? '')).toBe(false);
  });

  it.each(FILES)('%s は履歴・URL に直接触れない', (path) => {
    expect(HISTORY_OR_URL.test(sources[path] ?? '')).toBe(false);
  });

  it.each(FILES)('%s は object URL・data URL・img を使わない', (path) => {
    expect(OBJECT_OR_DATA_URL.test(sources[path] ?? '')).toBe(false);
  });

  it('検査の自己テスト', () => {
    for (const [re, bad] of [
      [DEVICE_STORAGE, 'sessionStorage.setItem(k, v)'],
      [DIALOG, 'if (confirm("消しますか")) go()'],
      [DIALOG, '<div role="dialog">'],
      [DIALOG, '<div role="alertdialog">'],
      [HISTORY_OR_URL, 'history.back()'],
      [OBJECT_OR_DATA_URL, 'URL.createObjectURL(b)'],
      [OBJECT_OR_DATA_URL, '<img src={u} />'],
    ] as const) {
      expect(re.test(bad), bad).toBe(true);
    }
    for (const fine of ['<p role="alert">', '<div role="status">', 'const imgRatio = 1']) {
      expect(DIALOG.test(fine) || OBJECT_OR_DATA_URL.test(fine), fine).toBe(false);
    }
  });
});
