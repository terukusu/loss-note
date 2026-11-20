// 開いている下のシートの記録（#129。9.3）。殻（App.tsx）に 1 つで、部品 Sheet が開閉を知らせる。開いているシートが
// 1 つでもある間は、トーストの取り消しの時間（削除の [元に戻す]・書きかけの知らせ）を止める（モーダルの間は外が inert に
// なり、トーストを押せないため）。規則は lib/sheet.ts の sheetStackNext。DOM なし
import { createContext } from 'preact';
import { SHEET_EMPTY, sheetStackNext } from './sheet';

export interface SheetsHost {
  opened(id: string): void;
  closed(id: string): void;
  /** 開いているシートの数（テスト・検査用） */
  count(): number;
}

export interface SheetsHostDeps {
  /** 1 つ目が開いた: トーストの時間を止める */
  readonly onHold: () => void;
  /** すべて閉じた: トーストの時間を置き直す */
  readonly onResume: () => void;
}

export function createSheetsHost(deps: SheetsHostDeps): SheetsHost {
  let stack = SHEET_EMPTY;
  const apply = (type: 'open' | 'close', id: string) => {
    const r = sheetStackNext(stack, { type, id });
    stack = r.stack;
    if (r.hold === 'hold') deps.onHold();
    else if (r.hold === 'resume') deps.onResume();
  };
  return {
    opened: (id) => apply('open', id),
    closed: (id) => apply('close', id),
    count: () => stack.length,
  };
}

/** 殻が渡す記録（無い = テスト・部品だけの描画では何もしない） */
export const SheetsContext = createContext<SheetsHost | null>(null);
