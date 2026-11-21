// 編集の全画面のシート（#131。設計書 9.2 の編集の行「形は記録すると同じ」・9.3）の純関数。DOM なし。
// - 要約 + ［編集］（取引の欄のシート）・チャートの小さな 2 枠（チャートのシート）・LC・一言・3 つのタップ・下の帯に判定の 1 行と
//   ［保存］。比較（#31）はシートの中の 1 行「今の値と比べる」→ 比較のシート
// - 判定の 1 行は記録する画面と同じ規則（record-screen.ts の verdictLine）で、編集のプレビュー（写した値・今の値）で出す
import type { DraftField, DraftReading, Preview } from './record-form';
import { type VerdictLine, verdictLine } from './record-screen';

/** 開いているシート（TradeEditScreen が持つ。View は受けて描くだけ） */
export type EditSheet =
  | {
      readonly kind: 'fields';
      /**
       * main = 取引の欄、more = ほかの欄（任意。同じシートの次の段）、leg = レッグ 1 本の欄（#117。同じシートの次の段。
       * 同時に開くのは 1 本。設計書 7.6。記録する画面の RecordSheet と同じ形）
       */
      readonly step: 'main' | 'more' | 'leg';
      /** step = leg のときのレッグの並びの番号（0 から） */
      readonly leg?: number;
      readonly focus?: DraftField;
    }
  | { readonly kind: 'chart' }
  | { readonly kind: 'verdict' }
  | { readonly kind: 'compare' };

/** シートの ID（dialog の id） */
export const EDIT_SHEET_ID = {
  fields: 'edit-fields-sheet',
  chart: 'edit-chart-sheet',
  verdict: 'edit-verdict-sheet',
  compare: 'edit-compare-sheet',
} as const;

/** 判定の 1 行: 記録する画面と同じ規則で、判定・R・リスクは編集のプレビュー（写した値か、選んだ今の値）から */
export function editVerdictLine(
  read: DraftReading,
  preview: Preview,
  errorLabels: readonly string[],
): VerdictLine {
  return verdictLine({ ...read, preview }, errorLabels, false);
}

/** 判定のシートの下の 1 行（どの値で計算しているか。今の値を選んでいれば、保存で写し直すこと） */
export function editValuesNote(refresh: boolean): string {
  return refresh
    ? '資金・許容リスクと銘柄の値は、今の値で計算しています。保存すると、この取引の値が今の値に更新されます。'
    : '資金・許容リスクと銘柄の値は、記録したときの値で計算します。';
}
