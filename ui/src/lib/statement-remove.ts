// 読み取った明細の削除と、削除の前への戻し（Issue 184。設計書 7.5）の純関数。DOM・通信なし。
// - 削除（stripStatement）: 明細から来たもの（読み取りの欄 9 つ。読み取りの後に本人が書き換えた値も・明細から読んだ足・
//   明細が既定で入れた答え（印「明細から」の決済の理由、注文の種類・逆指値を入れた）・明細から自動で
//   選んだ口座）を取り除き、入力元を手入力に戻す。本人の計画（LC・崩れの条件の一言・決済までの行動のタップ・広げた後の LC・チャートの時間足）・
//   ほかの任意の欄・手で追加した足は残す（R1・R2）。読み取りの欄でも、明細が入れなかった欄（印が無い = オプションの行の原資産の
//   L / S・イン・決済・数量。明細に原資産の価格は写らないので本人が入れた値。設計書 13.2）は本人の値として残す
// - 戻す（restoreStatement）: 削除の直前の明細から来た値を、今の下書きに戻す（R4。読み直しの失敗・キャンセルで前の明細へ戻す R6 も
//   同じ）。本人の計画の欄は今のまま
import { type Draft, EMPTY_DRAFT } from './record-form';
import { type Marks, READ_FIELDS } from './statement-fill';

/** 明細が入れた読み取りの欄か（印がある。明細が入れなかった欄・本人が明細の前から打った欄は印を持たない） */
const filledByStatement = (marks: Marks, f: (typeof READ_FIELDS)[number]): boolean =>
  marks[f] !== undefined;

/** 明細から読んだ足か（手で追加した足は read を持たない。#118） */
const fromStatement = (leg: Draft['legs'][number]): boolean => leg.read !== undefined;

/**
 * 明細から来たものを取り除いた下書き。accountFrom: 明細から自動で選んだ口座を本人が触っていなければ、選ぶ前の口座（無ければ
 * 口座は今のまま）
 */
export function stripStatement(draft: Draft, marks: Marks, accountFrom?: string): Draft {
  const out: Record<string, unknown> = { ...draft };
  for (const f of READ_FIELDS) if (filledByStatement(marks, f)) out[f] = EMPTY_DRAFT[f];
  return {
    ...(out as unknown as Draft),
    legs: draft.legs.filter((l) => !fromStatement(l)),
    ...(marks.exitReason === 'statement' ? { exitReason: EMPTY_DRAFT.exitReason } : {}),
    exitOrderType: EMPTY_DRAFT.exitOrderType,
    stopOrderPlaced: EMPTY_DRAFT.stopOrderPlaced,
    source: EMPTY_DRAFT.source,
    ...(accountFrom === undefined ? {} : { accountId: accountFrom }),
  };
}

/** 削除の後に本人が選び直したら戻さない欄（「明細から」の答えと自動で選んだ口座） */
export type KeptAnswer = 'exitReason' | 'accountId';

/**
 * 削除の直前（before）の明細から来た値を、今の下書き（current）に戻す。stripped は before を取り除いた直後の下書き、marks は
 * 削除の直前の印、chosen は削除の後に本人が選んだ答え（戻さない）。「明細から」の答え・自動で選んだ口座は、取り除いたものだけを
 * 戻す。足は明細から読んだ足（削除の直前の並び）+ 今の手で追加した足
 */
export function restoreStatement(
  current: Draft,
  before: Draft,
  stripped: Draft,
  marks: Marks,
  chosen: ReadonlySet<KeptAnswer> = new Set(),
): Draft {
  const out: Record<string, unknown> = { ...current };
  for (const f of READ_FIELDS) if (filledByStatement(marks, f)) out[f] = before[f];
  const back = (k: KeptAnswer, removed: boolean): Partial<Draft> =>
    removed && !chosen.has(k) ? { [k]: before[k] } : {};
  return {
    ...(out as unknown as Draft),
    legs: [...before.legs.filter(fromStatement), ...current.legs.filter((l) => !fromStatement(l))],
    ...back('exitReason', marks.exitReason === 'statement'),
    ...back('accountId', before.accountId !== stripped.accountId),
    exitOrderType: before.exitOrderType,
    stopOrderPlaced: before.stopOrderPlaced,
    source: before.source,
  };
}
