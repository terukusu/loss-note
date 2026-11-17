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
