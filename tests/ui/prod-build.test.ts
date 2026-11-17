// 本番のビルドに開発のときだけの値が入らない（ADR-0003。#3 PR-2 のレビュー指摘 1）。
// vite の build を書き出しなし（write: false）で実行し、出力の JS・CSS・HTML を調べる
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

// /dev/parts の経路の文字列は parseRoute が持つ（開発の時だけ有効。本番では知らない URL）ので対象にしない
const FORBIDDEN = ['127.0.0.1:9099', 'demo-loss-note', 'demo-api-key', '部品の見本'];

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;

describe('本番のビルド', () => {
  it('エミュレーターの URL・架空のプロジェクトと鍵・部品の見本を含まない', async () => {
    // vitest の中は NODE_ENV=test で、そのままだと開発のビルド（import.meta.env.DEV が真）になる
    const before = env.NODE_ENV;
    env.NODE_ENV = 'production';
    let out: Rollup.RollupOutput | Rollup.RollupOutput[];
    try {
      out = (await build({
        configFile: 'vite.config.ts',
        logLevel: 'silent',
        mode: 'production',
        build: { write: false },
      })) as Rollup.RollupOutput | Rollup.RollupOutput[];
    } finally {
      env.NODE_ENV = before;
    }
    const outputs = Array.isArray(out) ? out : [out];
    const files = outputs.flatMap((o) => o.output);
    expect(files.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const f of files) {
      const text = f.type === 'chunk' ? f.code : String(f.source);
      for (const w of FORBIDDEN) if (text.includes(w)) found.push(`${f.fileName}: ${w}`);
    }
    expect(found).toEqual([]);
  }, 60_000);
});
