// 判定の枠と貼り付きの帯の文（Issue #33。DOM なし）。
// 帯には数と一言だけ（「あと 6 欄」「誤り 1 欄」「明細を読み取っています」、そろえば判定の要約）、
// 欄の名前は判定の枠の案内に 1 文で出す（[記録する] の読み上げの説明に結ぶ）。
// 判定の枠は同じ説明を 2 回出さない: R・リスクの場所は「—」にして、出ない理由は注記に 1 回だけ（一覧 #9 と同じ形）。
// 「過剰リスクは見ていない」（riskNotChecked）は理由の一覧から分けて脇の 1 行に出す（文言・判定は変えない）
import type { Reason } from '../../../core/judge';
import { badgeModel } from './badge';
import { formatQuantity, formatR } from './format';
import {
  type DraftAction,
  type DraftField,
  type DraftReading,
  MISSING_LABEL,
  type Preview,
  RISK_NOTE,
  type Summary,
} from './record-form';
import { breachReason, breachView, cautionText } from './risky-win';
import { MISSING, riskNoteOf, rNoteOf, SIZING_OVER_STEP, timesText } from './trade-view';

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
  // 危ない勝ちは R ではなく帯の文（反実の 1 行か崩れの文）を読ませる（#227・C59）
  const risky = breachView(j, read.preview.r, read.body?.side);
  if (risky) return `${label} · ${cautionText(risky)}`;
  return read.preview.r === undefined ? label : `${label} · ${formatR(read.preview.r)}`;
}

/**
 * 決済までの行動の 2 つの質問（未入力の欄の一覧で 1 つにまとめる。判定の枠の案内を短くする。#74 デザインレビュー 4）。
 * LC を入る前に決めていたかは聞かず LC の欄から決める（C57・#202）
 */
const TAP_NAMES: readonly string[] = [MISSING_LABEL.lcMove, MISSING_LABEL.timeframeChange];

/** 未入力の欄の名前の一覧。2 つの質問がどちらも未入力なら「決済までの行動の 2 つ」の 1 つにまとめる */
export function missingNames(missing: readonly string[]): readonly string[] {
  if (!TAP_NAMES.every((t) => missing.includes(t))) return missing;
  const out = missing.filter((m) => !TAP_NAMES.includes(m));
  return [...out, '決済までの行動の 2 つ'];
}

/** [記録する] が押せない理由の文（判定の枠の案内。押せるときは null） */
export function blockReason(read: DraftReading, errorLabels: readonly string[]): string | null {
  if (read.canSave) return null;
  const errors = errorLabels.length > 0 ? `誤りのある欄（${errorLabels.join('・')}）` : null;
  const n = read.missing.length;
  const list = n > 0 ? `（${missingNames(read.missing).join('・')}）` : '';
  const fields =
    errors && n > 0
      ? `${errors}を直し、あと ${n} 欄を入力すると判定が表示されます${list}。`
      : errors
        ? `${errors}を直すと判定が表示されます。`
        : n > 0
          ? `あと ${n} 欄で判定が表示されます${list}。`
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
   * R・リスクの段を出さない（LC が無い取引。「—」を 2 つ並べず、注記の 1 行「LC が無いので R・リスクは表示されません」にする。
   * 判定を待つ間は出す）
   */
  readonly hideRisk: boolean;
  /**
   * 外貨建てで為替も損益も無いので 1R が出ない（#47 PR-2）。注記は「リスク・損益の「—」」の 1 行にまとめ、
   * 脇の理由は「為替が無いので過剰リスクは見ていない」と書く（利用者が直せる原因の言葉。デザインレビュー 2）
   */
  readonly fxMissing: boolean;
}

/** 外貨建てで為替も損益も無いときの脇の理由の文（「1R が出ないので…」の代わり） */
export const FX_NOT_CHECKED = '為替が無いため、過剰リスクは判定していません';

/** LC が無い取引の注記（R・リスクの段の代わりの 1 行） */
export const NO_LC_NOTE = 'LC が無いため、R・リスクは表示されません';

/** 判定の枠の注記・脇の 1 行・理由の一覧 */
export function verdictNotes(
  summary: Summary | Preview,
  opts: { readonly pending: boolean },
): VerdictNotes {
  const all = summary.judgment?.reasons ?? [];
  const aside = all.filter((r) => r.kind === 'riskNotChecked');
  // C は添え書き（「LC を決めずに入った取引です。」）が「LC を決めずに入った」と同じことを言うので、理由の一覧に重ねない
  const grade = summary.judgment?.grade;
  // 危ない勝ちも、崩れの文（枠の上の太字）にした理由は一覧に重ねない（#227・C59）
  const breach = breachReason(summary.judgment);
  const reasons = all.filter(
    (r) => r.kind !== 'riskNotChecked' && !(grade === 'C' && r.kind === 'noLc') && r !== breach,
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
    else if (riskWhy === RISK_NOTE.noOneRFx && rWhy === null)
      notes.push(`リスク・損益の「${MISSING}」: ${riskWhy}`);
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
    fxMissing: !opts.pending && summary.riskNote === RISK_NOTE.noOneRFx,
  };
}

/** 決済までの行動のタップ（編集の前からの記録の LC を入る前に決めていたかも）と LC の「なし」（押した後に判定の枠を見える範囲へ寄せる。AC-3） */
const TAP_FIELDS: readonly DraftField[] = ['lcDecided', 'lcMove', 'timeframeChange', 'lcNone'];

export function isTapAction(action: DraftAction): boolean {
  return action.type === 'set' && TAP_FIELDS.includes(action.field);
}

/**
 * 判定の枠の数量の 1 行の区切り（#67）。実際の数量と提案の数量を並べ、比は括弧に下げる（リスク（%）と同じ数を主役に
 * 重ねない）。数量は 3 桁区切り（formatQuantity。#40）。
 * - エントリー 1 つ: [「数量 10,000」, 「提案の数量 4,000（2.5 倍）」]（2.5 倍 = 数量が提案の数量の何倍か ≒ 1R ÷ 許容額）
 * - 提案の数量が 0: [「数量 1（許容リスクの 4.0 倍）」, 「最小の数量でも許容リスクを超えます」]
 * - エントリー 2 つ以上: [「数量 10,000（許容リスクの 0.4 倍）」]（数量は合計。提案の数量は出さない）
 * 比が出ない・判定を待つ間・LC なしのときは null。色・「大きすぎ」の言葉は付けない（判定の定義を増やさない）。
 * 区切りの中では折り返さず、幅が足りないときは区切りの間で折る（`Verdict.tsx`。1 つの区切りが枠より長いときだけ中で折る。#40）
 */
export function sizingLine(
  summary: Summary | Preview,
  opts: { readonly pending: boolean },
): readonly string[] | null {
  const s = summary.sizing;
  if (opts.pending || s === undefined || summary.noLc) return null;
  const quantity = `数量 ${formatQuantity(s.quantity)}`;
  const q = s.suggestedQuantity;
  if (q === undefined) return [`${quantity}（許容リスクの ${timesText(s.ratio)}）`];
  if (q === 0) return [`${quantity}（許容リスクの ${timesText(s.ratio)}）`, SIZING_OVER_STEP];
  return [quantity, `適正の数量 ${formatQuantity(q)}（実際は ${timesText(s.ratio)}）`];
}

/** 判定の枠の数量の 1 行の文字（区切りを「 · 」でつなぐ。読み上げ・テストと同じ文） */
export function sizingText(segments: readonly string[]): string {
  return segments.join(' · ');
}
