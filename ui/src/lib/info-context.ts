// 「i」のボタンと、アプリに 1 つの説明のシート（components/InfoSheet.tsx の InfoHost）をつなぐ文脈（#129）。「i」は
// 開いてほしいことだけを頼み、シートの開閉・たどり・戻るの層は InfoHost が持つ。同時に 1 つ
import { createContext } from 'preact';
import type { InfoSource } from './info-tip';

export interface InfoRequest {
  readonly source: InfoSource;
  /** 広い形の吹き出しで先に試す向き（3 つの質問・物差しは上） */
  readonly prefer?: 'above' | 'below' | undefined;
  /** 頼んだ「i」（開いているかの印。同じ言葉の「i」が 2 つあっても、押した方だけが開いて見える） */
  readonly owner: object;
}

export interface InfoHostValue {
  /** 今開いている説明を頼んだ「i」（閉じていれば null） */
  readonly owner: object | null;
  open(req: InfoRequest): void;
}

/** 無い = テスト・部品だけの描画（押しても何もしない） */
export const InfoContext = createContext<InfoHostValue | null>(null);
