// 画面のソースの禁止の書き方（Issue #3 の KEEP-2・KEEP-3。設計書 10.1・CLAUDE.md「データの読み書きの経路」）
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../../ui/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** KEEP-2: HTML の文字列を DOM に入れる書き方と、style 属性 */
const HTML_AND_STYLE: ReadonlyArray<readonly [string, RegExp]> = [
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['dangerouslySetInnerHTML', /\bdangerouslySetInnerHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write(ln)?\b/],
  ['createContextualFragment', /\bcreateContextualFragment\b/],
  // 属性の style（JSX の style={…} / style="…"）。前に => や比較の > があっても拾えるよう、タグの形に頼らない
  ['JSX の style', /(^|[\s{(,])style\s*=\s*[{"'`]/m],
  ['style 要素', /<style[\s>/]/i],
  ['createElement("style")', /createElement\(\s*['"`]style['"`]/],
  ['adoptedStyleSheets', /\badoptedStyleSheets\b/],
  ['DOMParser', /\bDOMParser\b/],
  ['.style の書き換え', /\.\s*style\s*(\.|\[|=)/],
  ['setAttribute("style"', /setAttribute\(\s*['"]style['"]/],
];

/** KEEP-3: 画面は Firestore・Storage を直接読み書きしない */
const FORBIDDEN_IMPORTS = /^(firebase\/(firestore|storage)|@firebase\/(firestore|storage))(\/|$)/;

function importsOf(src: string): string[] {
  return [
    ...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((m) => m[1] ?? '');
}

function violations(src: string): string[] {
  const out: string[] = [];
  for (const [name, re] of HTML_AND_STYLE) if (re.test(src)) out.push(name);
  for (const s of importsOf(src)) if (FORBIDDEN_IMPORTS.test(s)) out.push(`import ${s}`);
  return out;
}

describe('検査そのものの自己テスト', () => {
  it.each([
    ['el.innerHTML = s', 'innerHTML'],
    ['<div dangerouslySetInnerHTML={{ __html: s }} />', 'dangerouslySetInnerHTML'],
    ['<div class="a" style={{ color: x }} />', 'JSX の style'],
    ['<span\n  style="width: 1px"\n/>', 'JSX の style'],
    ['<div onClick={() => go()} style={{ width: 1 }} />', 'JSX の style'],
    ['<div hidden={a > b} style="width: 1px" />', 'JSX の style'],
    ['<Box {...p} style={s} />', 'JSX の style'],
    ['<style>{css}</style>', 'style 要素'],
    ["document.createElement('style')", 'createElement("style")'],
    ['document.adoptedStyleSheets = [s]', 'adoptedStyleSheets'],
    ['new DOMParser().parseFromString(s, "text/html")', 'DOMParser'],
    ['el.style.width = "1px"', '.style の書き換え'],
    ["el.setAttribute('style', 'x')", 'setAttribute("style"'],
    ['document.write(x)', 'document.write'],
    ["import { getFirestore } from 'firebase/firestore';", 'import firebase/firestore'],
    ["import { getFirestore } from 'firebase/firestore/lite';", 'import firebase/firestore/lite'],
    ["const m = await import('@firebase/storage');", 'import @firebase/storage'],
  ])('%s を見つける', (src, name) => {
    expect(violations(src)).toContain(name);
  });

  it('許す書き方は見つけない', () => {
    expect(
      violations(
        "import { getAuth } from 'firebase/auth';\nconst c = 'badge';\n<div class={c} data-state=\"x\" />\nimport './styles/tokens.css';\nconst styles = 1;\n<p class=\"field__hint\">style の話</p>",
      ),
    ).toEqual([]);
  });
});

/** 画面が読み込んでよい firebase のモジュール（ログインだけ） */
const ALLOWED_FIREBASE = new Set(['firebase/app', 'firebase/auth']);

describe('画面のソース（KEEP-2・KEEP-3）', () => {
  it('KEEP-3: firebase は firebase/app と firebase/auth だけを読み込む', () => {
    const used = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const s of importsOf(src)) if (/^@?firebase(\/|$)/.test(s)) used.add(s);
    }
    expect([...used].filter((s) => !ALLOWED_FIREBASE.has(s))).toEqual([]);
    expect([...used].sort()).toEqual(['firebase/app', 'firebase/auth']);
  });

  it('対象のファイルがある', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(sources))('%s に禁止の書き方が無い', (_path, src) => {
    expect(violations(src)).toEqual([]);
  });
});

/** Issue #13 AC-11: 記録の下書き・取引の値を端末（Web Storage・IndexedDB）に書かない */
const RECORD_FILES = [
  '../../ui/src/lib/record-form.ts',
  '../../ui/src/lib/record-controller.ts',
  '../../ui/src/lib/reasons.ts',
  '../../ui/src/lib/instrument-name.ts',
  '../../ui/src/lib/datetime.ts',
  '../../ui/src/pages/Record.tsx',
  '../../ui/src/components/TextField.tsx',
  // Issue #15（決済明細の読み取り）
  '../../ui/src/lib/image-limits.ts',
  '../../ui/src/lib/statement-image.ts',
  '../../ui/src/lib/statement-fill.ts',
  // Issue #12（根拠の足のチャート。AC-10: チャートの画像を端末の保存先に書かない）
  '../../ui/src/lib/charts.ts',
  // Issue #89（編集の画面のチャート・付属のチャート）
  '../../ui/src/lib/chart-slots.ts',
  '../../ui/src/lib/edit-controller.ts',
  '../../ui/src/components/ChartPanel.tsx',
];
const DEVICE_STORAGE =
  /\b(localStorage|sessionStorage|indexedDB|IDBFactory|caches|document\.cookie)\b/;

describe('記録の画面のソース（Issue #13 AC-11）', () => {
  it.each(RECORD_FILES)('%s は端末の保存先に触れない', (path) => {
    const src = sources[path];
    expect(src, path).toBeDefined();
    expect(DEVICE_STORAGE.test(src ?? '')).toBe(false);
  });

  it('明細の時刻の時間帯（#58 KEEP-7）: 端末に触れるのは zone-memory.ts だけで、書く鍵は statement-tz.ts の 1 つだけ', () => {
    const zm = sources['../../ui/src/lib/zone-memory.ts'] ?? '';
    const tz = sources['../../ui/src/lib/statement-tz.ts'] ?? '';
    expect(zm).toContain('window.localStorage');
    expect(zm).not.toMatch(/\bsetItem\b/);
    expect(DEVICE_STORAGE.test(tz)).toBe(false);
    expect(tz.match(/\.setItem\(/g)).toEqual(['.setItem(']);
    expect(tz).toContain('storage.setItem(ZONE_KEY, id)');
  });

  it('検査の自己テスト: 端末の保存先の語を見つける', () => {
    expect(DEVICE_STORAGE.test('localStorage.setItem(k, v)')).toBe(true);
    expect(DEVICE_STORAGE.test('indexedDB.open("x")')).toBe(true);
    expect(DEVICE_STORAGE.test('const draft = {}')).toBe(false);
  });
});

/** Issue #15 AC-13: object URL・data URL を作らない（CSP の img-src を広げない。プレビューは canvas） */
const OBJECT_OR_DATA_URL: ReadonlyArray<readonly [string, RegExp]> = [
  ['createObjectURL', /\bcreateObjectURL\b/],
  ['toDataURL', /\btoDataURL\b/],
  ['readAsDataURL', /\breadAsDataURL\b/],
  ['FileReader', /\bFileReader\b/],
  ["'blob:'", /['"`]blob:/],
  ["'data:'", /['"`]data:/],
];

function urlViolations(src: string): string[] {
  return OBJECT_OR_DATA_URL.filter(([, re]) => re.test(src)).map(([name]) => name);
}

/** Issue #15 AC-11: 貼る・読み取る・保存するの流れでダイアログを出さない */
const DIALOG =
  /\b(confirm|alert|prompt)\s*\(|<dialog[\s>]|role=["']alertdialog["']|\bshowModal\s*\(/;
/** Issue #15 AC-12: 履歴・URL に触れない（読み取りの値を URL・履歴の state に置かない） */
const HISTORY_OR_URL = /\b(history|location)\s*\./;
const STATEMENT_FILES = [
  '../../ui/src/lib/image-limits.ts',
  '../../ui/src/lib/statement-image.ts',
  '../../ui/src/lib/statement-fill.ts',
  '../../ui/src/lib/record-controller.ts',
  '../../ui/src/pages/Record.tsx',
  '../../ui/src/lib/charts.ts',
  '../../ui/src/lib/chart-slots.ts',
  '../../ui/src/components/ChartPanel.tsx',
];

/**
 * 書き出したファイルの保存の層（Issue #167・ADR-0025）: object URL を作ってよい唯一のファイル。文字の Blob を a[download] で
 * 保存するだけ（img の src に使わない = CSP の img-src を広げない）
 */
const DOWNLOAD_FILE = '../../ui/src/lib/download.ts';

describe('決済明細の読み取り（Issue #15 AC-11・AC-12・AC-13）', () => {
  it.each(Object.entries(sources).filter(([path]) => path !== DOWNLOAD_FILE))(
    'AC-13: %s は object URL・data URL を作らない',
    (_path, src) => {
      expect(urlViolations(src)).toEqual([]);
    },
  );

  it('#167 KEEP-3: 例外は保存の層だけ。createObjectURL のほかは作らず、img・canvas に使わない。読み込むのは書き出しの画面だけ', () => {
    const src = sources[DOWNLOAD_FILE] ?? '';
    expect(urlViolations(src)).toEqual(['createObjectURL']);
    expect(src).toContain('new Blob([file.text]');
    expect(src).toContain('URL.revokeObjectURL(url)');
    expect(src).not.toMatch(/<img[\s>]|createElement\(\s*['"`](img|iframe|canvas)/);
    const importers = Object.entries(sources)
      .filter(([, s]) => /from '(\.\.\/lib|\.)\/download'/.test(s))
      .map(([path]) => path);
    expect(importers).toEqual(['../../ui/src/pages/SettingsExport.tsx']);
  });

  it.each(STATEMENT_FILES)(
    'AC-11・AC-12: %s はダイアログを出さず、履歴・URL に触れない',
    (path) => {
      const src = sources[path];
      expect(src, path).toBeDefined();
      expect(DIALOG.test(src ?? '')).toBe(false);
      expect(HISTORY_OR_URL.test(src ?? '')).toBe(false);
    },
  );

  it.each([
    ['URL.createObjectURL(blob)', 'createObjectURL'],
    ['canvas.toDataURL()', 'toDataURL'],
    ['new FileReader().readAsDataURL(f)', 'readAsDataURL'],
    ['const r = new FileReader()', 'FileReader'],
    ["img.src = 'blob:' + id", "'blob:'"],
    ['const u = `data:image/png;base64,` + b', "'data:'"],
  ])('検査の自己テスト: %s を見つける', (src, name) => {
    expect(urlViolations(src)).toContain(name);
  });

  it('検査の自己テスト: ダイアログ・履歴の語を見つけ、似た書き方は見逃す', () => {
    for (const bad of [
      'if (confirm("送りますか")) go()',
      'window.alert(x)',
      '<dialog open>',
      '<div role="alertdialog">',
      'el.showModal()',
      'history.pushState(s, "", u)',
      'location.hash = x',
    ]) {
      expect(DIALOG.test(bad) || HISTORY_OR_URL.test(bad), bad).toBe(true);
    }
    for (const fine of [
      '<p role="alert">',
      "const metadata = 'x'",
      'const blobPart = 1',
      'notice--error',
    ]) {
      expect(
        DIALOG.test(fine) || HISTORY_OR_URL.test(fine) || urlViolations(fine).length > 0,
        fine,
      ).toBe(false);
    }
  });
});
