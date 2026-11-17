// AC-12: 計算と判定のコード（core/）が画面・通信・Firebase・現在時刻・乱数を参照しない
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../../core/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 語の境で探す禁止語（コメントの日本語に当たらないように） */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date', /\bnew\s+Date\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['fetch', /\bfetch\b/],
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['localStorage', /\blocalStorage\b/],
  ['performance', /\bperformance\b/],
  ['firebase', /\bfirebase\b/i],
  ['preact', /\bpreact\b/i],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
];

describe('core/ の純粋性', () => {
  it('対象のファイルがある', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(sources))(
    '%s は core/ の中だけを import し、禁止語を含まない',
    (_path, src) => {
      const specifiers = [
        ...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
        ...src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
        ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1] ?? '');
      for (const s of specifiers) expect(s, `import ${s}`).toMatch(/^\.\/[^/]+$/);
      for (const [name, re] of FORBIDDEN) expect(re.test(src), `${name} を含む`).toBe(false);
    },
  );
});
