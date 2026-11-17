// 種つきの乱数（mulberry32）。性質テストの入力を毎回同じに作るため。依存を足さずに自前で持つ
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  bool(p?: number): boolean;
}

export function rng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const v = items[Math.floor(next() * items.length)];
      if (v === undefined) throw new Error('空の配列から選べません');
      return v;
    },
    bool: (p = 0.5) => next() < p,
  };
}

/** 種と回数を決めて n 回確かめる。失敗したら種と回数を添えて投げ直す */
export function forAll<T>(
  seed: number,
  n: number,
  gen: (r: Rng) => T,
  check: (value: T) => void,
): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const value = gen(r);
    try {
      check(value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`種 ${seed} の ${i} 回目で失敗: ${msg}\n入力: ${JSON.stringify(value)}`);
    }
  }
}
