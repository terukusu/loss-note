// 消した印と [消す] の操作をアプリの殻（App.tsx）から画面へ渡す口（Issue #9。ADR-0007）。
// 画面は hidden で一覧・ホーム・詳細・直すから隠し、[消す] で remove を呼ぶ。無ければ（テストで画面だけを描くとき）何も隠さない
import { createContext } from 'preact';
import type { Deletions, DeletionsState } from './deletions';

export interface DeletionsValue {
  readonly state: DeletionsState;
  readonly deletions: Deletions;
  /** [消す]（label = どの取引か。トーストに出す）。殻が次の画面で [元に戻す] へフォーカスを移す */
  readonly remove: (id: string, label: string) => void;
}

export const DeletionsContext = createContext<DeletionsValue | null>(null);

export const NO_HIDDEN: ReadonlySet<string> = new Set();
