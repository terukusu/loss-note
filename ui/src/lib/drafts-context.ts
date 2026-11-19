// 書きかけの置き場と [キャンセル] をアプリの殻（App.tsx）から画面へ渡す口（Issue #75。ADR-0019）。
// 無ければ（テストで画面だけを描くとき）画面は自分で controller を作り、離れると捨てる（今までどおり）
import { createContext } from 'preact';
import type { Drafts } from './drafts';

export interface DraftsValue {
  readonly drafts: Drafts;
  /**
   * [キャンセル]: 書きかけを捨てて（入力があれば [元に戻す] のトースト）、アプリの中の前の画面へ戻る（無ければ fallback へ
   * 置き換え）。保存中は何もしない
   */
  readonly cancel: (key: string, fallback: string) => void;
}

export const DraftsContext = createContext<DraftsValue | null>(null);

/**
 * 離れて残している書きかけの鍵（ナビの [記録する]・詳細の [編集] の印の点。#75 デザイン 1）。DraftsContext と分けるのは、
 * 置き場から借りる画面が状態の変わるたびに借り直さないため
 */
export const DraftsKeptContext = createContext<ReadonlySet<string>>(new Set());
