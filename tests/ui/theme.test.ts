// C-6 テーマ（Issue #3 の例の表 T1〜T4・R1）。OS の設定（matchMedia）を見ないこと
import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  readTheme,
  type StorageLike,
  THEME_KEY,
  writeTheme,
} from '../../ui/src/lib/theme';

function memoryStorage(
  init: Record<string, string> = {},
): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

function fakeRoot() {
  const attrs = new Map<string, string>();
  return { attrs, setAttribute: (n: string, v: string) => attrs.set(n, v) };
}

describe('テーマ（例の表 T1〜T4）', () => {
  it('T1: 記憶なし・OS はダーク → ダーク', () => {
    expect(readTheme(memoryStorage())).toBe('dark');
  });

  it('T2: 記憶なし・OS はライト → ダーク（OS の設定を見ない）', () => {
    // OS の設定を読む手段（matchMedia）を、読まれたら落ちる形で置いておく
    const g = globalThis as { matchMedia?: unknown };
    const before = g.matchMedia;
    g.matchMedia = () => {
      throw new Error('matchMedia を読んだ');
    };
    try {
      expect(readTheme(memoryStorage())).toBe('dark');
      expect(readTheme(null)).toBe('dark');
    } finally {
      g.matchMedia = before;
    }
  });

  it('T3: ライトを選んで、閉じて開き直す → ライト', () => {
    const s = memoryStorage();
    expect(writeTheme(s, 'light')).toBe(true);
    expect(s.data.get(THEME_KEY)).toBe('light');
    // 開き直す = 同じ保存から読み直す
    expect(readTheme(s)).toBe('light');
    writeTheme(s, 'dark');
    expect(readTheme(s)).toBe('dark');
  });

  it('T4: 保存が例外を投げる → ダークで開き、切り替えはその場で効いて例外を出さない', () => {
    expect(readTheme(throwingStorage)).toBe('dark');
    const root = fakeRoot();
    applyTheme(root, 'dark');
    expect(() => writeTheme(throwingStorage, 'light')).not.toThrow();
    expect(writeTheme(throwingStorage, 'light')).toBe(false);
    applyTheme(root, 'light');
    expect(root.attrs.get('data-theme')).toBe('light');
  });

  it('保存の値が dark / light 以外なら無視してダーク', () => {
    expect(readTheme(memoryStorage({ [THEME_KEY]: 'sepia' }))).toBe('dark');
    expect(readTheme(memoryStorage({ [THEME_KEY]: '' }))).toBe('dark');
    expect(readTheme(memoryStorage({ [THEME_KEY]: 'LIGHT' }))).toBe('dark');
  });

  it('applyTheme は data-theme 属性だけを付ける（style 属性ではない）', () => {
    const root = fakeRoot();
    applyTheme(root, 'light');
    expect([...root.attrs.keys()]).toEqual(['data-theme']);
  });
});
