// 判定の枠と貼り付きの帯の文（Issue #33。DOM なし）。
// 帯には数と一言だけ（「あと 7 欄」「誤り 1 欄」「明細を読み取っています」、そろえば判定の要約）、
// 欄の名前は判定の枠の案内に 1 文で出す（[記録する] の読み上げの説明に結ぶ）。
// 判定の枠は同じ説明を 2 回出さない: R・リスクの場所は「—」にして、出ない理由は注記に 1 回だけ（一覧 #9 と同じ形）。
// 「過剰リスクは見ていない」（riskNotChecked）は理由の一覧から分けて脇の 1 行に出す（文言・判定は変えない）
import type { Reason } from '../../../core/judge';
import { badgeModel } from './badge';
import { formatR } from './format';
import {
  type DraftAction,
  type DraftField,
  type DraftReading,
  type Preview,
  RISK_NOTE,
  type Summary,
} from './record-form';
import { MISSING, riskNoteOf, rNoteOf } from './trade-view';

/** チャートの準備中に記録を止めるときの知らせ（controller が使う。純関数の側に置き、層の向きを controller → 純関数に揃える） */
export const CHART_PREPARING = 'チャートを準備しています。終わってから記録できます。';

/** 帯の 1 行の状態の文。押せないときは理由の数か一言、そろったら判定の要約（文字だけ。色を付けない） */
export function submitStatus(read: DraftReading, errorLabels: readonly string[]): string {
  // 帯は幅 360px で 1 行に入る短い文だけ（長い知らせは判定の枠の案内に全文で出す）
  if (read.notice === CHART_PREPARING) return 'チャートの準備中';
  if (read.notice) return read.notice;
  const parts: string[] = [];
  if (errorLabels.length > 0) parts.push(`誤り ${errorLabels.length} 欄`);
  if (read.missing.length > 0) parts.push(`あと ${read.missing.length} 欄`);
  if (parts.length > 0) return parts.join('・');
  const j = read.preview.judgment;
  if (!j) return '';
  const label = badgeModel(j.grade).label;
  return read.preview.r === undefined ? label : `${label} · ${formatR(read.preview.r)}`;
}

/** [記録する] が押せない理由の文（判定の枠の案内。押せるときは null） */
export function blockReason(read: DraftReading, errorLabels: readonly string[]): string | null {
  if (read.canSave) return null;
  const errors = errorLabels.length > 0 ? `誤りのある欄（${errorLabels.join('・')}）` : null;
  const missing = read.missing.length > 0 ? `足りない欄（${read.missing.join('・')}）` : null;
  const fields =
    errors && missing
      ? `${errors}を直し、${missing}をそろえると、判定と理由が出ます。`
      : errors
        ? `${errors}を直すと、判定と理由が出ます。`
        : missing
          ? `${missing}をそろえると、判定と理由が出ます。`
          : null;
  const out = [read.notice ? read.notice.replace(/。?$/, '。') : null, fields]
    .filter((x) => x !== null)
    .join(' ');
  return out === '' ? null : out;
}

export interface VerdictNotes {
  /** R の場所が「—」 */
  readonly rNone: boolean;
  /** リスクの場所が「—」 */
  readonly riskNone: boolean;
  /** 「—」の理由（1 つの理由は 1 回だけ。判定を待つ間は出さない） */
  readonly notes: readonly string[];
  /** 理由の一覧から分けた「見ていないもの」の注記 */
  readonly aside: readonly Reason[];
  /** 理由の一覧に出す理由 */
  readonly reasons: readonly Reason[];
  /**
   * R・リスクの段を出さない（LC が無い取引。「—」を 2 つ並べず、注記の 1 行「LC が無いので R・リスクは出ません」にする。
   * 判定を待つ間は出す）
   */
  readonly hideRisk: boolean;
}

/** LC が無い取引の注記（R・リスクの段の代わりの 1 行） */
export const NO_LC_NOTE = 'LC が無いので R・リスクは出ません';

/** 判定の枠の注記・脇の 1 行・理由の一覧 */
export function verdictNotes(
  summary: Summary | Preview,
  opts: { readonly pending: boolean },
): VerdictNotes {
  const all = summary.judgment?.reasons ?? [];
  const aside = all.filter((r) => r.kind === 'riskNotChecked');
  // C は添え書き（「LC を決めずに入った取引です。」）が「LC を決めずに入った」と同じことを言うので、理由の一覧に重ねない
  const grade = summary.judgment?.grade;
  const reasons = all.filter(
    (r) => r.kind !== 'riskNotChecked' && !(grade === 'C' && r.kind === 'noLc'),
  );
  const hideRisk = !opts.pending && summary.noLc && !summary.invalid;
  const rNone = summary.r === undefined;
  const riskNone = summary.riskPct === undefined;
  const notes: string[] = [];
  if (!opts.pending) {
    const rWhy = rNoteOf(summary);
    let riskWhy = riskNoteOf(summary);
    // 資金が未設定の説明は脇の 1 行（「資金が未設定なので過剰リスクは見ていない」）で言っているので重ねない
    const noCapitalAside = aside.some(
      (r) => r.kind === 'riskNotChecked' && r.cause === 'noCapital',
    );
    if (noCapitalAside && riskWhy === RISK_NOTE.noCapital) riskWhy = null;
    if (hideRisk) notes.push(NO_LC_NOTE);
    else if (rWhy !== null && rWhy === riskWhy) notes.push(`R・リスクの「${MISSING}」: ${rWhy}`);
    else {
      if (rWhy !== null) notes.push(`R の「${MISSING}」: ${rWhy}`);
      if (riskWhy !== null) notes.push(`リスクの「${MISSING}」: ${riskWhy}`);
    }
  }
  return {
    rNone,
    riskNone,
    notes,
    aside: opts.pending ? [] : aside,
    reasons: opts.pending ? [] : reasons,
    hideRisk,
  };
}

/** 3 つのタップと LC の「なし」（押した後に判定の枠を見える範囲へ寄せる。AC-3） */
const TAP_FIELDS: readonly DraftField[] = ['lcDecided', 'lcMove', 'timeframeChange', 'lcNone'];

export function isTapAction(action: DraftAction): boolean {
  return action.type === 'set' && TAP_FIELDS.includes(action.field);
}
