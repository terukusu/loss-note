import { describe, expect, it } from 'vitest';

/**
 * 画面の CSS（ui/**\/*.css）の色とテーマ（Issue #3 の AC-1・2・3・4・5。docs/ui-guidelines.md P2・P3・P8・P12）。
 * option-simulator の tests/ui/cssTokens.test.ts の解析（blocks・decls・colorHits・luminance・contrast）を移植した。
 *
 * (a) 色の値（16 進・rgb/rgba・hsl/hsla・色の名前）は tokens.css のテーマの定義
 *     （`:root, :root[data-theme="dark"]` と `:root[data-theme="light"]`）の中だけ。color-mix() もトークン同士
 * (b) 2 つの定義の名前の組が同じ
 * (c) var(--x) で使う名前がすべて定義済み
 * (d) 文字 × 面、--on-accent × --accent、バッジ 4 段の文字 × 地のコントラストが両テーマで 4.5:1 以上
 * ほか: prefers-color-scheme を使わない・既定はダーク・段の色が互いに違う・数字の部品は色を持たない・
 *       TSX に色の直書きが無い
 */

/**
 * 一覧は import.meta.glob の鍵だけ（読み込まない）、中身は Node の fs で読む
 * （vitest は CSS を空のモジュールにするので `?raw` では読めない。@types/node を足さないため型はここで最小限に書く）
 */
const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(p: URL, enc: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');
const files: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('../../ui/**/*.css')).map((path) => [
    path,
    fs.readFileSync(new URL(path, import.meta.url), 'utf8'),
  ]),
);
const tsxFiles = import.meta.glob('../../ui/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const TOKENS = '../../ui/src/styles/tokens.css';
const COMPONENTS = '../../ui/src/styles/components.css';
const DARK_SELECTOR = ':root, :root[data-theme="dark"]';
const LIGHT_SELECTOR = ':root[data-theme="light"]';

/** CSS の色の名前（CSS Color 4 の named colors）。transparent・currentColor・inherit は色の値として数えない */
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace ' +
    'olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
    'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen'
  ).split(' '),
);

/** 本文の文字に使うトークンと、文字が載る面 */
const TEXT_TOKENS = ['--ink', '--ink-2', '--ink-3'];
const TEXT_SURFACES = ['--bg', '--s1', '--s2', '--s3'];
/** 判定の 4 段（ui/src/lib/badge.ts の TIERS と同じ） */
const TIERS = ['plan', 'break', 'worst', 'neutral'];

const isHex6 = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** WCAG 2.x の相対輝度（#rrggbb） */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return Number.NaN;
  const n = Number.parseInt(m[1] ?? '', 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** コントラスト比（1〜21。色が #rrggbb でなければ NaN = 検査が落ちる） */
function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Block {
  selector: string;
  body: string;
  start: number;
  end: number;
}

/** 宣言を持つ規則（@media の中も含む）を取り出す小さな解析。トークンの定義を探すためだけに使う */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  const stack: { start: number; open: number }[] = [];
  let boundary = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      stack.push({ start: boundary, open: i });
      boundary = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top) {
        const body = css.slice(top.open + 1, i);
        if (!body.includes('{')) {
          out.push({
            selector: css.slice(top.start, top.open).trim(),
            body,
            start: top.start,
            end: i + 1,
          });
        }
      }
      boundary = i + 1;
    } else if (c === ';') {
      boundary = i + 1;
    }
  }
  return out;
}

function decls(body: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const value = part
      .slice(at + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (name) m.set(name, value);
  }
  return m;
}

/** 色の値の出現（16 進・rgb/rgba・hsl/hsla・色の名前）。transparent / currentColor / inherit は数えない */
function colorHits(css: string): string[] {
  const hits: string[] = [];
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)) hits.push(m[0]);
  for (const b of blocks(css)) {
    for (const [name, value] of decls(b.body)) {
      const v = value.replace(/"[^"]*"|'[^']*'/g, '').replace(/var\([^)]*\)/g, '');
      for (const w of v.matchAll(/(?<![\w-])[a-zA-Z]+(?![\w-])/g)) {
        if (NAMED.has(w[0].toLowerCase())) hits.push(`${name}: ${w[0]}`);
      }
    }
  }
  return hits;
}

/** color-mix( … ) の中身（括弧の対応を数えて取り出す。入れ子の関数の中にあっても切り出せる） */
function colorMixArgs(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/color-mix\(/g)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '(') depth++;
      else if (css[i] === ')') depth--;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

/** 数字の部品のクラス（.num と .num--<大きさ>）を含む選択子か（.num-table などは別の部品） */
const NUM_SELECTOR = /\.num(--[\w-]+)?(?![\w-])/;

const tokensCss = stripComments(files[TOKENS] ?? '');
const tokenBlocks = blocks(tokensCss);
const dark = tokenBlocks.find((b) => b.selector.replace(/\s+/g, ' ') === DARK_SELECTOR);
const light = tokenBlocks.find((b) => b.selector === LIGHT_SELECTOR);
const darkDecls = decls(dark?.body ?? '');
const lightDecls = decls(light?.body ?? '');
const THEMES = [
  ['dark', darkDecls],
  ['light', lightDecls],
] as const;

describe('検査そのものの自己テスト', () => {
  it('colorMixArgs は入れ子の中の color-mix も括弧の対応で切り出す', () => {
    expect(
      colorMixArgs(
        'a { background: linear-gradient(0deg, color-mix(in srgb, var(--a) 5%, var(--b))); }',
      ),
    ).toEqual(['in srgb, var(--a) 5%, var(--b)']);
  });

  it('NUM_SELECTOR は .num と .num--lg に当たり、.num-table・.numfield に当たらない', () => {
    expect(
      ['.num', '.num--lg', '.hero .num', '.num:hover'].map((x) => NUM_SELECTOR.test(x)),
    ).toEqual([true, true, true, true]);
    expect(
      ['.num-table__id', '.numfield__input', '.number'].map((x) => NUM_SELECTOR.test(x)),
    ).toEqual([false, false, false]);
  });

  it('colorHits は 16 進・関数・色の名前を見つけ、transparent / currentColor / inherit / var() は見逃す', () => {
    expect(colorHits('.a { color: #fff; }')).toEqual(['#fff']);
    expect(colorHits('.a { background: rgba(0, 0, 0, 0.5); }')).toEqual(['rgba(']);
    expect(colorHits('.a { color: hsl(0 0% 0%); }')).toEqual(['hsl(']);
    expect(colorHits('.a { border: 1px solid red; }')).toEqual(['border: red']);
    expect(
      colorHits(
        '.a { color: currentColor; background: transparent; fill: inherit; border-color: var(--red); }',
      ),
    ).toEqual([]);
  });

  it('contrast は白黒で 21、#767676 / 白で約 4.54、#rrggbb 以外は NaN', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('red', '#ffffff')).toBeNaN();
  });
});

describe('画面の CSS のトークン（AC-1・2・3・4・5）', () => {
  it('CSS のファイルが読めて、tokens.css に 2 つのテーマの定義がある', () => {
    expect(Object.keys(files)).toContain(TOKENS);
    expect(Object.keys(files)).toContain(COMPONENTS);
    expect(dark, DARK_SELECTOR).toBeDefined();
    expect(light, LIGHT_SELECTOR).toBeDefined();
  });

  it('AC-1: :root の既定はダーク、テーマを prefers-color-scheme で選ばない', () => {
    expect(darkDecls.get('color-scheme')).toBe('dark');
    expect(lightDecls.get('color-scheme')).toBe('light');
    for (const [path, raw] of Object.entries(files)) {
      expect(/prefers-color-scheme/.test(stripComments(raw)), path).toBe(false);
    }
  });

  it('AC-2 (a): 色の値は tokens.css のテーマの定義の中だけ', () => {
    for (const [path, raw] of Object.entries(files)) {
      let css = stripComments(raw);
      if (path === TOKENS) {
        // テーマの定義を取り除いた残りを調べる（後ろから消して位置をずらさない）
        for (const b of [dark, light]
          .filter((x): x is Block => !!x)
          .sort((a, b) => b.start - a.start)) {
          css = css.slice(0, b.start) + css.slice(b.end);
        }
      }
      expect(colorHits(css), path).toEqual([]);
    }
  });

  it('AC-2 (a): color-mix() はトークン同士（var() と割合・transparent だけ）', () => {
    for (const [path, raw] of Object.entries(files)) {
      for (const inner of colorMixArgs(stripComments(raw))) {
        const rest = inner
          .replace(/var\(--[\w-]+\)/g, '')
          .replace(/\bin (srgb|oklab|oklch)\b/g, '')
          .replace(/\btransparent\b/g, '')
          .replace(/[\d.]+%/g, '')
          .replace(/[\s,]/g, '');
        expect(rest, `${path}: color-mix(${inner})`).toBe('');
      }
    }
  });

  it('AC-2 (b): ダークとライトは同じ名前の集合（片方だけの色を作らない）', () => {
    expect([...lightDecls.keys()].sort()).toEqual([...darkDecls.keys()].sort());
    expect(darkDecls.size).toBeGreaterThan(10);
  });

  it('AC-2: 画面のソース（ui/src の TS / TSX）に色の直書きが無い', () => {
    expect(Object.keys(tsxFiles).length).toBeGreaterThan(0);
    for (const [path, src] of Object.entries(tsxFiles)) {
      const hits = [...src.matchAll(/["'`(\s:=]#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)].map(
        (m) => m[0],
      );
      expect(hits, path).toEqual([]);
    }
  });

  it('(c) var(--x) で使う名前はすべて定義済み', () => {
    const defined = new Set<string>();
    for (const raw of Object.values(files)) {
      for (const m of stripComments(raw).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1] ?? '');
    }
    const missing: string[] = [];
    for (const [path, raw] of Object.entries(files)) {
      for (const m of stripComments(raw).matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!defined.has(m[1] ?? '')) missing.push(`${path}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('AC-3 (d): 文字 × 面、--on-accent × --accent、バッジの文字 × 地が両テーマで 4.5:1 以上', () => {
    const low: string[] = [];
    for (const [theme, d] of THEMES) {
      const pairs = [
        ...TEXT_TOKENS.flatMap((ink) => TEXT_SURFACES.map((surface) => [ink, surface] as const)),
        ['--on-accent', '--accent'] as const,
        ...TIERS.map((t) => [`--tier-${t}-ink`, `--tier-${t}-bg`] as const),
      ];
      for (const [ink, surface] of pairs) {
        const fg = d.get(ink) ?? '';
        const bg = d.get(surface) ?? '';
        const what = `${theme} ${ink}(${fg}) / ${surface}(${bg})`;
        for (const c of [fg, bg]) expect(isHex6(c), `${what}: ${c} が #rrggbb でない`).toBe(true);
        const ratio = contrast(fg, bg);
        if (!(ratio >= 4.5)) low.push(`${what} = ${ratio.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('入力の部品の枠（--field-line）とフォーカスの輪（--focus）は面に両テーマで 3:1 以上（WCAG 1.4.11）', () => {
    const low: string[] = [];
    for (const [theme, d] of THEMES) {
      for (const fg of ['--field-line', '--focus']) {
        for (const s of TEXT_SURFACES) {
          const a = d.get(fg) ?? '';
          const b = d.get(s) ?? '';
          const r = contrast(a, b);
          if (!(r >= 3)) low.push(`${theme} ${fg}(${a}) / ${s}(${b}) = ${r.toFixed(2)}`);
        }
      }
    }
    expect(low).toEqual([]);
  });

  it('入力欄とセグメントの枠は --field-line', () => {
    const css = stripComments(files[COMPONENTS] ?? '');
    for (const sel of ['.numfield', '.seg']) {
      const d = decls(blocks(css).find((x) => x.selector === sel)?.body ?? '');
      expect(d.get('border'), sel).toBe('1px solid var(--field-line)');
    }
  });

  it('部品の見本の CSS は本番の部品の CSS に入れない（見本の画面だけが読む parts.css）', () => {
    const css = stripComments(files[COMPONENTS] ?? '');
    for (const cls of ['.parts', '.hero', '.badge-list', '.num-table', '.swatch', '.icons']) {
      expect(css.includes(cls), `components.css に ${cls}`).toBe(false);
    }
    expect(Object.keys(files)).toContain('../../ui/src/pages/dev/parts.css');
  });

  it('入力の誤り（--danger）も文字として面に 4.5:1 以上', () => {
    for (const [theme, d] of THEMES) {
      for (const s of ['--s1', '--s2']) {
        const fg = d.get('--danger') ?? '';
        const bg = d.get(s) ?? '';
        expect(contrast(fg, bg), `${theme} --danger / ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('AC-4: 判定の 4 段の文字の色・地の色は、両テーマで互いに違う', () => {
    for (const [theme, d] of THEMES) {
      for (const part of ['ink', 'bg', 'line']) {
        const values = TIERS.map((t) => (d.get(`--tier-${t}-${part}`) ?? '').toLowerCase());
        for (const v of values) expect(v, `${theme} --tier-*-${part}`).not.toBe('');
        expect(new Set(values).size, `${theme} --tier-*-${part}: ${values.join(' ')}`).toBe(
          TIERS.length,
        );
      }
    }
  });

  it('AC-4: バッジの段のクラスは段のトークンだけを使う', () => {
    const css = stripComments(files[COMPONENTS] ?? '');
    for (const t of TIERS) {
      const b = blocks(css).find((x) => x.selector === `.badge--${t}`);
      expect(b, `.badge--${t}`).toBeDefined();
      const d = decls(b?.body ?? '');
      expect(d.get('color')).toBe(`var(--tier-${t}-ink)`);
      expect(d.get('background')).toBe(`var(--tier-${t}-bg)`);
      expect(d.get('border-color')).toBe(`var(--tier-${t}-line)`);
    }
  });

  it('AC-5: 数字の部品（.num）は色を宣言しない（本文の文字の色を継ぐ）', () => {
    let found = 0;
    for (const [path, raw] of Object.entries(files)) {
      for (const b of blocks(stripComments(raw))) {
        if (!NUM_SELECTOR.test(b.selector)) continue;
        found++;
        const d = decls(b.body);
        for (const k of ['color', '-webkit-text-fill-color', 'fill']) {
          expect(d.has(k), `${path} ${b.selector} の ${k}`).toBe(false);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('数字の部品は等幅（--mono・tabular-nums）', () => {
    const b = blocks(stripComments(files[COMPONENTS] ?? '')).find((x) => x.selector === '.num');
    const d = decls(b?.body ?? '');
    expect(d.get('font-family')).toBe('var(--mono)');
    expect(d.get('font-variant-numeric')).toContain('tabular-nums');
  });

  it('CSS は外のものを読まない（url() も @import も書かない）', () => {
    for (const [path, raw] of Object.entries(files)) {
      const css = stripComments(raw);
      expect(/\burl\(/.test(css), `${path} に url(`).toBe(false);
      expect(/@import\b/.test(css), `${path} に @import`).toBe(false);
    }
  });
});
