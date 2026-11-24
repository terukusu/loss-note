import { describe, expect, it } from 'vitest';
import { PRIMITIVE_NAME, readTokens } from './helpers/css-tokens';

/**
 * 画面の CSS（ui/**\/*.css）の色とテーマ（Issue #3 の AC-1・2・3・4・5。docs/ui-guidelines.md P2・P3・P8・P12）。
 * option-simulator の tests/ui/cssTokens.test.ts の解析（blocks・decls・colorHits・luminance・contrast）を移植した。
 *
 * (a) 色の値（16 進・rgb/rgba・hsl/hsla・色の名前）は tokens.css の原色の層（`:root` の `--c-*` だけの規則）の中だけ。
 *     2 つのテーマの定義（`:root, :root[data-theme="dark"]` と `:root[data-theme="light"]`）は原色の参照で役割を決め、
 *     部品の CSS は役割だけを使う（#229・設計書 C61）。color-mix() もトークン同士。値を比べるときは原色まで解く
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

/**
 * 段のトークン（--tier-*）を使う規則のうち、選択子が許可の形でないもの（#229 AC-5。ホーム・直近の流れの CSS で、段の色を
 * 印・記号・図の外 = カードや入れ物の面に使わない）。tint（面に敷く色）は tintAllowed の形の選択子だけ
 */
function tierRuleViolations(css: string, allowed: RegExp, tintAllowed: RegExp = allowed): string[] {
  const bad: string[] = [];
  for (const b of blocks(css)) {
    if (!/--tier-/.test(b.body)) continue;
    const tint = /--tier-[a-z]+-tint/.test(b.body);
    for (const sel of b.selector.split(',').map((x) => x.trim())) {
      if (!allowed.test(sel) || (tint && !tintAllowed.test(sel))) bad.push(sel);
    }
  }
  return bad;
}

/** 原色（--c-*）の参照の名前 */
function primitiveRefs(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--c-[\w-]+)/g)].map((m) => m[1] ?? '');
}

const tokensCss = stripComments(files[TOKENS] ?? '');
const tokenBlocks = blocks(tokensCss);
const dark = tokenBlocks.find((b) => b.selector.replace(/\s+/g, ' ') === DARK_SELECTOR);
const light = tokenBlocks.find((b) => b.selector === LIGHT_SELECTOR);
const sheet = readTokens(files[TOKENS] ?? '');
/** テーマの定義を原色まで解いた値（コントラスト・値の比較はこれで見る） */
const darkDecls = sheet.resolved.dark;
const lightDecls = sheet.resolved.light;
/** 原色の層の規則（`:root` の、宣言がすべて `--c-*` の規則） */
const primitiveBlock = tokenBlocks.find(
  (b) =>
    b.selector === ':root' &&
    [...decls(b.body).keys()].length > 0 &&
    [...decls(b.body).keys()].every((k) => k.startsWith('--c-')),
);
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

  it('NUM_SELECTOR は .num と .num--hero に当たり、.num-table・.numfield に当たらない', () => {
    expect(
      ['.num', '.num--hero', '.hero .num', '.num:hover'].map((x) => NUM_SELECTOR.test(x)),
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

  it('#229 E8: 部品の CSS の原色の参照・テーマの定義の色の値を見つける', () => {
    expect(primitiveRefs('.a { color: var(--c-gray-100); background: var(--s1); }')).toEqual([
      '--c-gray-100',
    ]);
    expect(primitiveRefs('.a { color: var(--ink); }')).toEqual([]);
    const bad = readTokens(
      ':root { --c-gray-1: #000000; }\n:root,\n:root[data-theme="dark"] { --ink: #123456; }\n' +
        ':root[data-theme="light"] { --ink: var(--c-gray-1); }',
    );
    expect(bad.raw.dark.get('--ink')).toBe('#123456');
    expect(colorHits(':root[data-theme="dark"] { --ink: #123456; }')).toEqual(['#123456']);
    expect(bad.resolved.light.get('--ink')).toBe('#000000');
    expect(() =>
      readTokens(
        ':root { --c-gray-1: #000000; }\n:root,\n:root[data-theme="dark"] { --ink: var(--c-nope); }\n' +
          ':root[data-theme="light"] { --ink: var(--c-gray-1); }',
      ),
    ).toThrow(/--c-nope/);
  });

  it('#229 AC-5: tierRuleViolations は許可の外の選択子・許可の外の tint を見つける', () => {
    const allowed = /^\.streak__(dot--|headline--[a-z]+ \.streak__headmark)/;
    const tint = /^\.streak__dot--/;
    expect(
      tierRuleViolations(
        '.streak__dot--plan { background: var(--tier-plan-tint); }',
        allowed,
        tint,
      ),
    ).toEqual([]);
    expect(
      tierRuleViolations(
        '.streak__headline--plan .streak__headmark { color: var(--tier-plan-ink); }',
        allowed,
        tint,
      ),
    ).toEqual([]);
    // 入れ物の面に tint を敷く・記号の選択子に tint を使う・色の無い規則は数えない
    expect(
      tierRuleViolations('.streak { background: var(--tier-plan-tint); }', allowed, tint),
    ).toEqual(['.streak']);
    expect(
      tierRuleViolations(
        '.streak__headline--plan .streak__headmark { background: var(--tier-plan-tint); }',
        allowed,
        tint,
      ),
    ).toEqual(['.streak__headline--plan .streak__headmark']);
    expect(tierRuleViolations('.streak { color: var(--ink); }', allowed, tint)).toEqual([]);
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

  it('AC-2 (a)・#229 AC-1: 色の値は tokens.css の原色の層の中だけ（テーマの定義にも書かない）', () => {
    expect(primitiveBlock, '原色の層の規則').toBeDefined();
    for (const [path, raw] of Object.entries(files)) {
      let css = stripComments(raw);
      if (path === TOKENS && primitiveBlock) {
        // 原色の層を取り除いた残り（テーマの定義を含む）を調べる
        css = css.slice(0, primitiveBlock.start) + css.slice(primitiveBlock.end);
      }
      expect(colorHits(css), path).toEqual([]);
    }
  });

  it('#229 AC-1: 原色の名前は --c-<色相>-<段> の形。テーマの定義の var() は原色だけを参照する', () => {
    const names = [...decls(primitiveBlock?.body ?? '').keys()];
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => !PRIMITIVE_NAME.test(n))).toEqual([]);
    for (const b of [dark, light]) {
      for (const [name, value] of decls(b?.body ?? '')) {
        for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          expect(m[1] ?? '', `${name}: ${value}`).toMatch(/^--c-/);
        }
      }
    }
  });

  it('#229 AC-1: 部品・枠・画面の CSS（tokens.css の外）は原色を参照しない（役割だけを使う）', () => {
    for (const [path, raw] of Object.entries(files)) {
      if (path === TOKENS) continue;
      expect(primitiveRefs(stripComments(raw)), path).toEqual([]);
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
      // 例外は Google の G のロゴだけ（ガイドラインが色を変えることを禁じる。公式の 4 色に限る。Issue #52）
      if (path.endsWith('/components/GoogleLogo.tsx')) {
        const official = new Set(['#4285F4', '#EA4335', '#FBBC05', '#34A853']);
        const colors = hits.map((h) => h.slice(1));
        expect(colors.length, path).toBeGreaterThan(0);
        expect(
          colors.filter((c) => !official.has(c)),
          path,
        ).toEqual([]);
        expect(new Set(colors), path).toEqual(official);
        continue;
      }
      expect(hits, path).toEqual([]);
    }
  });

  it('Google でログインするボタン: 配色はガイドラインの値（ダーク / ライト）、1px の枠、14/20・500、余白 12 / 10 / 12、ロゴ 20px、角丸の四角（Issue #52 AC-2・AC-3）', () => {
    const blockOf = (bs: Block[], sel: string) => bs.find((b) => b.selector === sel)?.body ?? '';
    const gsi = (d: Map<string, string>) => [
      d.get('--gsi-bg'),
      d.get('--gsi-line'),
      d.get('--gsi-ink'),
    ];
    expect(gsi(darkDecls)).toEqual(['#131314', '#8e918f', '#e3e3e3']);
    expect(gsi(lightDecls)).toEqual(['#ffffff', '#747775', '#1f1f1f']);
    const css = blocks(stripComments(files[COMPONENTS] ?? ''));
    const btn = decls(blockOf(css, '.gsi'));
    expect(btn.get('border')).toBe('1px solid var(--gsi-line)');
    expect(btn.get('background')).toBe('var(--gsi-bg)');
    expect(btn.get('color')).toBe('var(--gsi-ink)');
    // 14/20（--fs-sm = 14px。文字の拡大に付いていくようトークンから決める。#79）
    expect(btn.get('font-size')).toBe('var(--fs-sm)');
    const rootDecls = decls(
      tokenBlocks.find((b) => b.selector === ':root' && b.body.includes('--fs-sm'))?.body ?? '',
    );
    expect(rootDecls.get('--fs-sm')).toBe('14px');
    expect(btn.get('line-height')).toBe('calc(var(--fs-sm) * 10 / 7)');
    expect(btn.get('font-weight')).toBe('var(--fw-medium)');
    expect(btn.get('font-family')).toMatch(/^"Google Sans"/);
    expect(btn.get('padding')).toBe('0 12px');
    expect(btn.get('min-height')).toBe('var(--tap)');
    expect(btn.get('border-radius')).toBe('var(--radius-md)');
    expect(decls(blockOf(css, '.gsi__contents')).get('gap')).toBe('10px');
    const logo = decls(blockOf(css, '.gsi-logo'));
    expect([logo.get('width'), logo.get('height')]).toEqual(['20px', '20px']);
    // 押している間は中身だけを薄くする（地・枠の宣言は変えない）
    const disabled = decls(blockOf(css, '.gsi:disabled .gsi__contents'));
    expect(disabled.get('opacity')).toBe('0.38');
    expect(decls(blockOf(css, '.gsi:disabled')).has('background')).toBe(false);
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
        ...TIERS.map((t) => [`--tier-${t}-ink`, `--tier-${t}-tint`] as const),
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
    // セグメントは項目ごとの枠（Issue #33: 入れ子 2 段のため、セグメント全体の枠を項目へ移した）
    for (const sel of ['.numfield', '.seg__item']) {
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
      for (const part of ['ink', 'tint', 'line', 'solid']) {
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
      expect(d.get('background')).toBe(`var(--tier-${t}-tint)`);
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

  it('AC-7: 数字の部品（.num）と数値の入力欄は本文の書体の桁揃え（tabular-nums）。等幅（--mono）を宣言しない', () => {
    const css = blocks(stripComments(files[COMPONENTS] ?? ''));
    for (const sel of ['.num', '.numfield__input']) {
      const d = decls(css.find((x) => x.selector === sel)?.body ?? '');
      expect(d.get('font-variant-numeric'), sel).toContain('tabular-nums');
      const family = d.get('font-family');
      expect(family === undefined || family === 'var(--font)', `${sel}: ${family}`).toBe(true);
    }
    // どの CSS でも .num・.num--<大きさ>・.numfield の規則に --mono を書かない
    for (const [path, raw] of Object.entries(files)) {
      for (const b of blocks(stripComments(raw))) {
        if (!NUM_SELECTOR.test(b.selector) && !/\.numfield(?![\w-])|\.numfield__/.test(b.selector))
          continue;
        expect(decls(b.body).get('font-family') ?? '', `${path} ${b.selector}`).not.toContain(
          '--mono',
        );
      }
    }
    // 判定の枠の R は数字の段 hero のまま（枠の中で数字の大きさを替える規則を持たない。#131・#236）
    const inVerdict = Object.values(files)
      .flatMap((raw) => blocks(stripComments(raw)))
      .filter((b) => /\.verdict/.test(b.selector) && /\.num(--|\b)/.test(b.selector));
    expect(inVerdict.map((b) => b.selector)).toEqual([]);
  });

  it('#236 C62: 数字の 4 段（display / hero / title / row）は大きさ・650・字間のトークンで、title 以上の単位は数の 0.5 倍・500・2 番目の文字の色', () => {
    const root = decls(tokenBlocks.find((b) => b.selector === ':root')?.body ?? '');
    expect(Object.fromEntries([...root].filter(([k]) => k.startsWith('--ls-num-')))).toEqual({
      '--ls-num-display': '-0.03em',
      '--ls-num-hero': '-0.02em',
      '--ls-num-title': '-0.015em',
      '--ls-num-row': '-0.01em',
    });
    const css = blocks(stripComments(files[COMPONENTS] ?? ''));
    const rule = (sel: string) => decls(css.find((x) => x.selector === sel)?.body ?? '');
    for (const tier of ['display', 'hero', 'title', 'row']) {
      const d = rule(`.num--${tier}`);
      expect(d.get('font-size'), tier).toBe(`var(--fs-num-${tier})`);
      expect(d.get('font-weight'), tier).toBe('var(--fw-bold)');
      expect(d.get('letter-spacing'), tier).toBe(`var(--ls-num-${tier})`);
    }
    for (const tier of ['display', 'hero', 'title']) {
      expect(rule(`.numu--${tier} .num-unit`).get('font-size'), tier).toBe(
        `calc(var(--fs-num-${tier}) * 0.5)`,
      );
    }
    // row は単位を分けない（0.5 倍だと 12px を下回る）
    expect(css.find((x) => x.selector === '.numu--row .num-unit')).toBeUndefined();
    const unit = rule('.num-unit');
    expect(unit.get('font-weight')).toBe('var(--fw-medium)');
    expect(unit.get('color')).toBe('var(--ink-2)');
    expect(rule('.numu').get('white-space')).toBe('nowrap');
    // 単位の大きさ（0.5 倍）が文字のいちばん小さい段（12px）を下回らない
    const px = (k: string) => Number.parseFloat(root.get(k) ?? 'NaN');
    for (const tier of ['display', 'hero', 'title']) {
      expect(px(`--fs-num-${tier}`) * 0.5).toBeGreaterThanOrEqual(px('--fs-xs'));
    }
    // 前の数字の段（.num--xl・.num--lg）はどの CSS にも残っていない
    for (const [path, raw] of Object.entries(files)) {
      expect(stripComments(raw), path).not.toMatch(/\.num--(xl|lg)\b|--fs-num-(xl|lg)\b/);
    }
  });

  it('#127 A7: 文字の大きさのトークンは 6 段（30 / 20 / 17 / 16 / 14 / 12）と数字の 4 段（56 / 40 / 28 / 20。#236・C62）だけ', () => {
    const root = decls(tokenBlocks.find((b) => b.selector === ':root')?.body ?? '');
    const fs = [...root].filter(([k]) => k.startsWith('--fs-'));
    expect(Object.fromEntries(fs)).toEqual({
      '--fs-title': '30px',
      '--fs-lg': '20px',
      '--fs-nav': '17px',
      '--fs-md': '16px',
      '--fs-sm': '14px',
      '--fs-xs': '12px',
      '--fs-num-display': '56px',
      '--fs-num-hero': '40px',
      '--fs-num-title': '28px',
      '--fs-num-row': '20px',
    });
    // 本文の行の高さは 1.5（9.9）
    expect(root.get('--lh-body')).toBe('1.5');
  });

  it('#127 9.6: 安全域は --safe-* のトークンだけが env() を受ける（部品の CSS に env() を書かない）', () => {
    const root = decls(tokenBlocks.find((b) => b.selector === ':root')?.body ?? '');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(root.get(`--safe-${side}`)).toBe(`env(safe-area-inset-${side}, 0px)`);
    }
    for (const [path, raw] of Object.entries(files)) {
      if (path === TOKENS) continue;
      expect(stripComments(raw), path).not.toMatch(/env\(/);
    }
  });

  it('#127 9.9: 主のボタンの面（藍のグラデーションの両端）と白い文字が両テーマで 4.5:1 以上', () => {
    for (const [theme, d] of THEMES) {
      for (const end of ['--primary-from', '--primary-to']) {
        const fg = d.get('--on-primary') ?? '';
        const bg = d.get(end) ?? '';
        expect(
          contrast(fg, bg),
          `${theme} --on-primary(${fg}) / ${end}(${bg})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('AC-6: 角丸のトークンは 18 / 14 / 10px・シートの 28px（丸は 999px。9.9・#127）。部品の CSS の角丸は var(--radius-*) か 0 だけ（px の直書き 0 件）', () => {
    const root = decls(tokenBlocks.find((b) => b.selector === ':root')?.body ?? '');
    expect(root.get('--radius-lg')).toBe('18px');
    expect(root.get('--radius-md')).toBe('14px');
    expect(root.get('--radius-sm')).toBe('10px');
    expect(root.get('--radius-sheet')).toBe('28px');
    expect(root.get('--radius-pill')).toBe('999px');
    const bad: string[] = [];
    let seen = 0;
    for (const [path, raw] of Object.entries(files)) {
      if (path === TOKENS) continue;
      for (const b of blocks(stripComments(raw))) {
        for (const [name, value] of decls(b.body)) {
          if (!/^border(-[a-z]+)*-radius$/.test(name)) continue;
          seen++;
          const parts = value.replace(/var\(--radius-[a-z]+\)/g, 'TOKEN').split(/[\s/]+/);
          if (!parts.every((x) => x === 'TOKEN' || x === '0')) {
            bad.push(`${path} ${b.selector} { ${name}: ${value} }`);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it('物差しの CSS は文字・線・段のトークンだけ（新しい色を足さない。Issue #34 AC-5）', () => {
    const allowed =
      /^(var\(--(ink|ink-2|ink-3|line|line-2|tier-(plan|break|worst|neutral)-(ink|bg|line))\)|currentColor|none|transparent)$/;
    let seen = 0;
    const bad: string[] = [];
    for (const b of blocks(stripComments(files[COMPONENTS] ?? ''))) {
      if (!/\.ruler|\.taps/.test(b.selector)) continue;
      for (const [name, value] of decls(b.body)) {
        if (
          !['color', 'fill', 'stroke', 'background', 'background-color', 'border-color'].includes(
            name,
          )
        ) {
          continue;
        }
        seen++;
        if (!allowed.test(value)) bad.push(`${b.selector} { ${name}: ${value} }`);
      }
      // 面の色・四辺の線を持たない（枠に数えない。入れ子は判定の枠 → 部品の 2 段）
      for (const k of ['border', 'background', 'box-shadow']) {
        if (/\.ruler(?![\w-])|\.ruler__track|\.ruler__plot/.test(b.selector)) {
          expect(decls(b.body).has(k), `${b.selector} の ${k}`).toBe(false);
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it('振り返りの段の CSS は判定の段・文字・線のトークンだけ。数字は無色（Issue #88 AC-11）', () => {
    const allowed =
      /^(var\(--(ink|ink-2|ink-3|line|line-2|tier-(plan|break|worst|neutral)-(ink|line|solid))\)|currentColor|none|transparent)$/;
    const css = stripComments(files['../../ui/src/styles/review.css'] ?? '');
    expect(css).not.toBe('');
    // 強調・誤りの色・面の色を使わない（判定の段の色と混ぜない。P2）
    expect(
      /--accent|--danger|--s[0-9]|--bg\b|color-mix|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css),
    ).toBe(false);
    let seen = 0;
    const bad: string[] = [];
    for (const b of blocks(css)) {
      for (const [name, value] of decls(b.body)) {
        if (
          ![
            'color',
            'fill',
            'stroke',
            'background',
            'background-color',
            'border-color',
            'outline-color',
            'accent-color',
          ].includes(name) &&
          !/^border(-(top|bottom|left|right))?$/.test(name)
        ) {
          continue;
        }
        seen++;
        const color = /^border/.test(name) ? (value.match(/var\([^)]*\)/)?.[0] ?? 'none') : value;
        if (!allowed.test(color)) bad.push(`${b.selector} { ${name}: ${value} }`);
      }
      // 数字の部品（.num）に色を付けない（P3）
      if (/\.num(?![\w-])/.test(b.selector)) {
        for (const k of ['color', 'fill', 'background', 'background-color']) {
          expect(decls(b.body).has(k), `${b.selector} の ${k}`).toBe(false);
        }
      }
      // 面の色・四辺の線・影を持たない（カードの中に内枠を作らない。P7）
      for (const k of ['background', 'background-color', 'box-shadow', 'border']) {
        expect(decls(b.body).has(k), `${b.selector} の ${k}`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it('AI の利用状況のカードの CSS は文字・線のトークンだけ（判定の段の色を使わない。Issue #62 AC-7）', () => {
    const allowed = /^(var\(--(ink|ink-2|ink-3|line|line-2)\)|currentColor|none|transparent)$/;
    const css = files['../../ui/src/styles/ai-usage.css'] ?? '';
    expect(css).not.toBe('');
    expect(/--tier-|--accent|--danger/.test(stripComments(css))).toBe(false);
    let seen = 0;
    const bad: string[] = [];
    for (const b of blocks(stripComments(css))) {
      for (const [name, value] of decls(b.body)) {
        if (
          !['color', 'fill', 'stroke', 'background', 'background-color', 'border-color'].includes(
            name,
          )
        ) {
          continue;
        }
        seen++;
        if (!allowed.test(value)) bad.push(`${b.selector} { ${name}: ${value} }`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it('直近の流れの CSS は判定の段・文字・線のトークンだけ。点の段のクラスは同じ段のトークン（Issue #35 AC-7）', () => {
    const allowed =
      /^(var\(--(ink|ink-2|ink-3|line|line-2|tier-(plan|break|worst|neutral)-(ink|tint|line))\)|currentColor|none|transparent)$/;
    const css = stripComments(files['../../ui/src/styles/streak.css'] ?? '');
    expect(css).not.toBe('');
    expect(
      /--accent|--danger|--s[0-9]|--bg\b|color-mix|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css),
    ).toBe(false);
    let seen = 0;
    const bad: string[] = [];
    for (const b of blocks(css)) {
      // 段のクラス（streak__dot--plan など）は自分の段のトークンだけ
      const tier = /--(plan|break|worst|neutral)\b/.exec(b.selector)?.[1];
      for (const [name, value] of decls(b.body)) {
        if (
          !['color', 'fill', 'stroke', 'background', 'background-color', 'border-color'].includes(
            name,
          ) &&
          !/^border(-(top|bottom|left|right))?$/.test(name)
        ) {
          continue;
        }
        seen++;
        const color = /^border/.test(name)
          ? (value.match(/var\([^)]*\)/)?.[0] ?? 'transparent')
          : value;
        if (!allowed.test(color)) bad.push(`${b.selector} { ${name}: ${value} }`);
        if (tier && /--tier-/.test(color) && !color.includes(`--tier-${tier}-`)) {
          bad.push(`${b.selector} { ${name}: ${value} }`);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it('CSS は外のものを読まない（url() も @import も書かない）', () => {
    for (const [path, raw] of Object.entries(files)) {
      const css = stripComments(raw);
      expect(/\burl\(/.test(css), `${path} に url(`).toBe(false);
      expect(/@import\b/.test(css), `${path} に @import`).toBe(false);
    }
  });
});

/**
 * #229 AC-2: 役割のトークンの値（原色まで解いた値）は、2 層にする前（2026-11-25 の main の tokens.css）から 1 つも変えない。
 * 判定の段の `-bg` は `-tint` の名前で比べる。`-solid` は #229 で足したので表の外。表は変更前の tokens.css から機械的に写した。
 * 値を意図して替える Issue は、この表を同じ PR で直す（黙って値が変わらないための表）
 */
const ROLE_VALUES_BEFORE_229: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--bg': '#0a0c10',
    '--s1': '#11141a',
    '--s2': '#171b23',
    '--s3': '#1e232d',
    '--line': '#222834',
    '--line-2': '#323a48',
    '--field-line': '#646f82',
    '--ink': '#eef1f6',
    '--ink-2': '#a8b0bf',
    '--ink-3': '#8d96a7',
    '--accent': '#9aa8ff',
    '--on-accent': '#0a0c10',
    '--focus': '#b8c2ff',
    '--glow': '#6f7dff1f',
    '--glow-2': '#2ec5a00f',
    '--tier-plan-ink': '#6ee7b7',
    '--tier-plan-tint': '#0e2a21',
    '--tier-plan-line': '#1e5a46',
    '--tier-break-ink': '#f7c063',
    '--tier-break-tint': '#2e2310',
    '--tier-break-line': '#6a4d16',
    '--tier-worst-ink': '#ff8fa0',
    '--tier-worst-tint': '#3a121b',
    '--tier-worst-line': '#7a2536',
    '--tier-neutral-ink': '#b3bac7',
    '--tier-neutral-tint': '#232833',
    '--tier-neutral-line': '#3a4252',
    '--danger': '#ff8f8f',
    '--warn-ink': '#f7c063',
    '--warn-bg': '#2e2310',
    '--warn-line': '#6a4d16',
    '--gsi-bg': '#131314',
    '--gsi-line': '#8e918f',
    '--gsi-ink': '#e3e3e3',
    '--mark-from': '#6573f2',
    '--mark-to': '#3d4fd6',
    '--mark-ink': '#ffffff',
    '--mark-edge': '#ffffff2e',
    '--mark-glow': '#6573f224',
    '--shadow-1': '0 1px 0 #ffffff08 inset, 0 1px 2px #00000066',
    '--shadow-2': '0 1px 0 #ffffff0a inset, 0 12px 32px #00000080',
    '--scrim': '#0a0c10cc',
    '--primary-from': '#4f5ee8',
    '--primary-to': '#3d4fd6',
    '--on-primary': '#ffffff',
    '--shadow-card': 'none',
    '--statusbar-bg': '#0a0c1000',
    '--viewer-bg': '#000000',
    '--viewer-ink': '#ffffff',
  },
  light: {
    '--bg': '#f3f4f7',
    '--s1': '#ffffff',
    '--s2': '#f8f9fb',
    '--s3': '#eceef2',
    '--line': '#e2e5eb',
    '--line-2': '#cbd0d9',
    '--field-line': '#7d8696',
    '--ink': '#0f1218',
    '--ink-2': '#485062',
    '--ink-3': '#5c6576',
    '--accent': '#3d4fd6',
    '--on-accent': '#ffffff',
    '--focus': '#3d4fd6',
    '--glow': '#3d4fd614',
    '--glow-2': '#0f9e7a0d',
    '--tier-plan-ink': '#09694a',
    '--tier-plan-tint': '#e0f5ec',
    '--tier-plan-line': '#9fd9c1',
    '--tier-break-ink': '#855400',
    '--tier-break-tint': '#fcefd6',
    '--tier-break-line': '#ecc77f',
    '--tier-worst-ink': '#b01c3b',
    '--tier-worst-tint': '#fde6ea',
    '--tier-worst-line': '#f0a8b6',
    '--tier-neutral-ink': '#4a5263',
    '--tier-neutral-tint': '#e9ebf0',
    '--tier-neutral-line': '#cbd0d9',
    '--danger': '#b4232f',
    '--warn-ink': '#855400',
    '--warn-bg': '#fcefd6',
    '--warn-line': '#ecc77f',
    '--gsi-bg': '#ffffff',
    '--gsi-line': '#747775',
    '--gsi-ink': '#1f1f1f',
    '--mark-from': '#6573f2',
    '--mark-to': '#3d4fd6',
    '--mark-ink': '#ffffff',
    '--mark-edge': '#ffffff00',
    '--mark-glow': '#3d4fd61a',
    '--shadow-1': '0 1px 2px #0f12180f, 0 1px 1px #0f12180a',
    '--shadow-2': '0 2px 4px #0f12180d, 0 16px 40px #0f121814',
    '--scrim': '#0f121866',
    '--primary-from': '#4f5ee8',
    '--primary-to': '#3d4fd6',
    '--on-primary': '#ffffff',
    '--shadow-card': '0 1px 3px #0f121814',
    '--statusbar-bg': '#11141a',
    '--viewer-bg': '#000000',
    '--viewer-ink': '#ffffff',
  },
};

/** 判定の段の図の塗りの選択子（#229 AC-4。帯・面は solid で塗る） */
const SOLID_FILLS: readonly (readonly [string, string, string])[] = [
  ['review.css', '.review__seg--plan', 'var(--tier-plan-solid)'],
  ['review.css', '.review__seg--break', 'var(--tier-break-solid)'],
  ['review.css', '.review__seg--worst', 'var(--tier-worst-solid)'],
  ['review.css', '.review__seg--neutral', 'var(--tier-neutral-solid)'],
  ['review.css', '.curve__gap', 'var(--tier-break-solid)'],
  ['home.css', '.minicurve__gap', 'var(--tier-break-solid)'],
];

describe('トークンの 2 層と判定の段の 4 つの役割（#229・設計書 C61）', () => {
  it('AC-2: 役割の値は 2 層にする前と同じ（両テーマ・全部の役割。-solid だけ新しい）', () => {
    for (const [theme, d] of THEMES) {
      const before = ROLE_VALUES_BEFORE_229[theme];
      const now = Object.fromEntries(
        [...d].filter(([k]) => k.startsWith('--') && !/^--tier-[a-z]+-solid$/.test(k)),
      );
      expect(now, theme).toEqual(before);
    }
  });

  it('AC-3: 判定の 4 段は ink・tint・line・solid を両テーマで持ち、solid は 4 段で違い、カードとシートの面に 3:1 以上', () => {
    const low: string[] = [];
    for (const [theme, d] of THEMES) {
      for (const t of TIERS) {
        for (const part of ['ink', 'tint', 'line', 'solid']) {
          expect(isHex6(d.get(`--tier-${t}-${part}`) ?? ''), `${theme} --tier-${t}-${part}`).toBe(
            true,
          );
        }
        for (const s of ['--s1', '--s2']) {
          const fg = d.get(`--tier-${t}-solid`) ?? '';
          const bg = d.get(s) ?? '';
          const r = contrast(fg, bg);
          if (!(r >= 3))
            low.push(`${theme} --tier-${t}-solid(${fg}) / ${s}(${bg}) = ${r.toFixed(2)}`);
        }
      }
    }
    expect(low).toEqual([]);
  });

  it('AC-4: 塗り（fill・background）に段の ink を使わない。段の -bg の名前は残っていない。図の塗りは solid', () => {
    const bad: string[] = [];
    for (const [path, raw] of Object.entries(files)) {
      const css = stripComments(raw);
      if (/--tier-[a-z]+-bg\b/.test(css)) bad.push(`${path}: --tier-*-bg`);
      for (const b of blocks(css)) {
        for (const [name, value] of decls(b.body)) {
          if (!['fill', 'background', 'background-color'].includes(name)) continue;
          if (/var\(--tier-[a-z]+-ink\)/.test(value))
            bad.push(`${path} ${b.selector} { ${name}: ${value} }`);
        }
      }
    }
    expect(bad).toEqual([]);
    for (const [file, sel, want] of SOLID_FILLS) {
      const css = stripComments(files[`../../ui/src/styles/${file}`] ?? '');
      const b = blocks(css).find((x) => x.selector === sel);
      expect(b, `${file} ${sel}`).toBeDefined();
      expect(decls(b?.body ?? '').get('fill'), `${file} ${sel}`).toBe(want);
    }
  });

  it('AC-5: ホームと直近の流れは段の色を印・記号・図にだけ使い、カードや入れ物の面に敷かない。振り返りの集計の面にも tint を敷かない', () => {
    const home = stripComments(files['../../ui/src/styles/home.css'] ?? '');
    const streak = stripComments(files['../../ui/src/styles/streak.css'] ?? '');
    expect(home).not.toBe('');
    expect(streak).not.toBe('');
    // ホーム: 行の印・規律コストの × の記号・小さな曲線だけ（tint は行の印の地だけ）
    expect(
      tierRuleViolations(
        home,
        /^\.(homerow__mark|homemonth__measured|minicurve__)/,
        /^\.homerow__mark--/,
      ),
    ).toEqual([]);
    // 直近の流れ: 点（地は tint）と見出しの記号だけ
    expect(
      tierRuleViolations(
        streak,
        /^\.streak__(dot--|headline--[a-z]+ \.streak__headmark)/,
        /^\.streak__dot--/,
      ),
    ).toEqual([]);
    expect(blocks(home).filter((b) => /--tier-/.test(b.body)).length).toBeGreaterThan(3);
    expect(blocks(streak).filter((b) => /--tier-/.test(b.body)).length).toBeGreaterThan(3);
    for (const f of ['review.css', 'review-tab.css']) {
      const css = stripComments(files[`../../ui/src/styles/${f}`] ?? '');
      expect(css, f).not.toBe('');
      expect(/--tier-[a-z]+-tint/.test(css), `${f} に tint`).toBe(false);
    }
  });
});
