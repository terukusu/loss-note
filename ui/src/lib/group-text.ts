// 両建てのまとまり（#267）の画面の言葉（一覧の行・詳細・まとまりの画面が共有する。position-group.ts と trade-view.ts の
// 両方から読むので、依存の無い小さなファイルに置く）
import type { GroupRole } from '../../../core/record';

/** 役割の名前（画面の言葉。C76） */
export const ROLE_TEXT: Readonly<Record<GroupRole, string>> = {
  main: '本玉',
  hedge: '決済の代わり',
};

/** 一覧の行・詳細に添える印（6.5） */
export const GROUP_MARK = '両建て';
