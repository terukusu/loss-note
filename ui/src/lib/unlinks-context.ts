// 両建てを解く + [元に戻す]（#267）をアプリの殻（App.tsx）から画面へ渡す口。無ければ（テストで画面だけを描くとき）トーストを出さない
import { createContext } from 'preact';
import type { PositionGroupBody } from '../../../core/record';

export interface UnlinksValue {
  /** 解けた（label = どのまとまりか、body = 結び直す本文）。殻が次の画面で [元に戻す] へフォーカスを移す */
  readonly done: (label: string, body: PositionGroupBody) => void;
}

export const UnlinksContext = createContext<UnlinksValue | null>(null);
