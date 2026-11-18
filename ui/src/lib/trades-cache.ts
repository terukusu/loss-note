// 取引の一覧の読み込み済みの分と位置（Issue #87 R8）。詳細・直すから戻る（ブラウザの戻る）ときに、最初の 1 ページへ
// 戻らずに同じ件数と位置で出すための、記憶の中だけの 1 件の入れ物。殻（App.tsx）に 1 つ置き、ログアウト・ログインして
// いない状態で空にする（次の利用者に前の利用者の取引を見せない）。端末の保存先には書かない
import { createContext } from 'preact';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../../core/record';

export interface TradesSnapshot {
  readonly trades: readonly StoredTrade[];
  readonly instruments: readonly InstrumentRecord[];
  readonly accounts: readonly AccountRecord[];
  /** 次のページのカーソル（null = 最後まで読んだ） */
  readonly next: string | null;
}

export interface TradesCache {
  get(): TradesSnapshot | null;
  set(s: TradesSnapshot): void;
  /** 一覧の位置（縦のスクロール。px） */
  scrollY(): number;
  setScrollY(y: number): void;
  clear(): void;
}

export function createTradesCache(): TradesCache {
  let snap: TradesSnapshot | null = null;
  let y = 0;
  return {
    get: () => snap,
    set(s) {
      snap = s;
    },
    scrollY: () => y,
    setScrollY(v) {
      y = Number.isFinite(v) && v > 0 ? v : 0;
    },
    clear() {
      snap = null;
      y = 0;
    },
  };
}

/** 殻から一覧へ渡す口。無ければ（テストで画面だけを描くとき）戻っても最初の 1 ページから読む */
export const TradesCacheContext = createContext<TradesCache | null>(null);
