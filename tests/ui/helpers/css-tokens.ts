/**
 * トークンの CSS（ui/src/styles/tokens.css）を読み、役割のトークンを原色まで解く（#229・設計書 C61・ui-guidelines P12）。
 * 色の値は原色の層（`:root` の、宣言がすべて `--c-*` の規則）にだけ書き、2 つのテーマの定義は原色を参照して役割を決める。
 * テスト（cssTokens・icons・pwa）は、役割の値をこの helper で原色まで解いてから比べる
 */

/** ダーク（既定）とライトのテーマの定義の選択子（空白をつぶした形） */
export const DARK_SELECTOR = ':root,:root[data-theme="dark"]';
export const LIGHT_SELECTOR = ':root[data-theme="light"]';
/** 原色の名前の形（`--c-<色相>[-<段>][-a<不透明度>]`） */
export const PRIMITIVE_NAME = /^--c-[a-z]+(-[0-9]+)?(-a[0-9]{2})?$/;

export type Theme = 'dark' | 'light';

interface RawBlock {
  readonly selector: string;
  readonly decls: Map<string, string>;
}

function rawBlocks(css: string): RawBlock[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: RawBlock[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const part of (m[2] ?? '').split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      const name = part.slice(0, at).trim();
      if (name)
        decls.set(
          name,
          part
            .slice(at + 1)
            .trim()
            .replace(/\s+/g, ' '),
        );
    }
    out.push({ selector: (m[1] ?? '').replace(/\s+/g, ''), decls });
  }
  return out;
}

export interface TokenSheet {
  /** 原色の層の宣言（名前 → 値） */
  readonly primitives: Map<string, string>;
  /** テーマの定義の宣言のまま（var() を解かない） */
  readonly raw: Record<Theme, Map<string, string>>;
  /** テーマの定義の宣言を原色まで解いた値 */
  readonly resolved: Record<Theme, Map<string, string>>;
  /** 値の中の var() を、テーマの定義 → 原色の順に再帰で解く（解けない名前・循環は例外） */
  resolve(theme: Theme, value: string): string;
}

export function readTokens(css: string): TokenSheet {
  const bs = rawBlocks(css);
  const primitiveBlocks = bs.filter(
    (b) =>
      b.selector === ':root' &&
      b.decls.size > 0 &&
      [...b.decls.keys()].every((k) => k.startsWith('--c-')),
  );
  if (primitiveBlocks.length !== 1) {
    throw new Error(`原色の層の規則がちょうど 1 つでない（${primitiveBlocks.length} 個）`);
  }
  const primitives = primitiveBlocks[0]?.decls ?? new Map<string, string>();
  const find = (sel: string) => {
    const b = bs.find((x) => x.selector === sel);
    if (!b) throw new Error(`テーマの定義が無い: ${sel}`);
    return b.decls;
  };
  const raw = { dark: find(DARK_SELECTOR), light: find(LIGHT_SELECTOR) };
  const resolve = (theme: Theme, value: string, depth = 0): string => {
    if (depth > 8) throw new Error(`var() の参照が深すぎる（循環？）: ${value}`);
    return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
      const next = raw[theme].get(name) ?? primitives.get(name);
      if (next === undefined) throw new Error(`${theme}: ${name} が定義されていない`);
      return resolve(theme, next, depth + 1);
    });
  };
  const resolvedOf = (theme: Theme) =>
    new Map([...raw[theme]].map(([k, v]) => [k, resolve(theme, v)] as const));
  return {
    primitives,
    raw,
    resolved: { dark: resolvedOf('dark'), light: resolvedOf('light') },
    resolve: (theme, value) => resolve(theme, value),
  };
}
