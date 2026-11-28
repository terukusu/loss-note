// 2 枚目の明細から足を足す（#260・設計書 C73・4.7・7.6）。純関数（DOM・通信・今の時刻なし）。
// - 足す行（pickAddRows）: 読んだ行のうち、今のポジションの原資産と同じ原資産（名前の同一視 4.1）のオプションの行をすべて、
//   明細の行の順に。建てた日が違っても足す（ロール・別の日の建ても同じポジションの足。C52）。別の原資産・先物の行は足さない
// - 重複（isSameLeg）: P / C・限月・行使価格・売買・枚数・建値・決済値が同じで、建てた時刻・決済した時刻が両方にあれば同じ
//   時刻（分まで）の足は同じ足（同じ明細を 2 回選んだ・手で打った足を後から明細で読んだ）
// - 足す（planAddLegs）: 今の足の後ろへ。10 本を超えるなら 1 本も足さない。足した足は読み取りの印つき（LegRead.sheet = 足した
//   明細の通し番号・行の損益・手数料・通貨・注文の種類。損益の合わせ方は statement-positions.ts の statementPnlWithLegs）
// - ポジションの時刻と注文の種類（pointAfterAdd。C54・C26）: 本人が触っていなければ、エントリーの時刻 = 足のいちばん早い建て、
//   決済の時点を決める足が足した足なら決済の時刻 = その足の決済の時刻・注文の種類 = その行の値（逆指値なら決済の理由 = LC）
import { positionExitPoint } from '../../../core/option';
import type { InstrumentRecord } from '../../../core/record';
import { fromLocalInput, toLocalInput } from './datetime';
import { findInstrument, nameKey } from './instrument-name';
import { fromAddedStatement, type LegDraft, MAX_LEGS, readLegs } from './legs-form';
import type { Draft, DraftField } from './record-form';
import type { FieldMark, Marks, ReadRow } from './statement-fill';
import { legDraftOf, OPTION_SUFFIX } from './statement-positions';
import type { TzId } from './statement-tz';

/** ボタンの文字（足の一覧の ［＋ 足］ の隣。操作の言葉は「追加」= ui-guidelines 8.1） */
export const ADD_LEGS_LABEL = '明細から追加';

export const ADD_LEGS_MSG = {
  /** 押せない理由: 1 段目の明細の読み取り中 */
  statementReading: '明細を読み取っています。終わってから追加してください',
  /** 押せない理由・保存の帯: 足の読み取り中 */
  reading: '明細の足を読み取っています',
  /** 押せない理由: 足が 10 本 */
  full: `足は ${MAX_LEGS} 本までです`,
  allPresent: 'この明細の足はすべて入っています',
  noRows: 'このポジションの原資産のオプションの行がありません',
  chooseInstrument: '先に銘柄を選んでください',
  unchanged: '足は変わっていません。',
  pnlTyped: '損益は打った値のままです',
  cancelled: '読み取りをキャンセルしました。足は変わっていません。',
} as const;

export const addedText = (n: number) => `明細から足を ${n} 本追加しました`;
export const skippedText = (n: number) => `別の原資産・先物の ${n} 行は追加していません`;
export const duplicateText = (n: number) => `同じ足 ${n} 本は追加していません`;
export const tooManyText = (now: number, add: number) =>
  `足は ${MAX_LEGS} 本までです（今 ${now} 本 · この明細から ${add} 本）`;

/** 読み取りの失敗の文: 今の決まった文言の 1 文目 +「足は変わっていません。」（例: 「今日の読み取りの上限に達しました。足は…」） */
export function failedText(message: string): string {
  const i = message.indexOf('。');
  const first = i < 0 ? `${message}。` : message.slice(0, i + 1);
  return `${first}${ADD_LEGS_MSG.unchanged}`;
}

/** 原資産の名前の鍵（名前の同一視 4.1 の後に末尾の「オプション」を外す。「XYZ」と「XYZオプション」を同じにする） */
export function underlyingKey(name: string): string {
  const k = nameKey(name);
  const suffix = nameKey(OPTION_SUFFIX);
  return k.endsWith(suffix) && k.length > suffix.length ? k.slice(0, -suffix.length).trim() : k;
}

/**
 * 今のポジションの原資産の鍵（R2）。銘柄の欄が決まっていればその銘柄の原資産（一覧の underlying、無ければ名前）、空なら
 * 明細のオプションの行の原資産が 1 種類のときだけそれ（2 種類以上は「先に銘柄を選んでください」、0 は足す行が無い）
 */
export function positionUnderlying(
  instrumentName: string,
  instruments: readonly InstrumentRecord[],
  rows: readonly ReadRow[],
): { readonly key: string } | { readonly reason: 'chooseInstrument' | 'noRows' } {
  const name = instrumentName.trim();
  if (name !== '') {
    const inst = findInstrument(name, instruments);
    return { key: underlyingKey(inst?.underlying ?? name) };
  }
  const keys = new Set(
    rows
      .map((r) => r.option?.underlying ?? null)
      .filter((u): u is string => u !== null)
      .map(underlyingKey),
  );
  const [only] = keys;
  if (keys.size === 0 || only === undefined) return { reason: 'noRows' };
  if (keys.size > 1) return { reason: 'chooseInstrument' };
  return { key: only };
}

/** 足す行の番号（明細の行の順）と、足さない行（別の原資産・先物・原資産の読めないオプションの行）の数 */
export function pickAddRows(
  rows: readonly ReadRow[],
  key: string,
): { readonly rows: readonly number[]; readonly skipped: number } {
  const picked: number[] = [];
  rows.forEach((r, i) => {
    const u = r.option?.underlying;
    if (u != null && underlyingKey(u) === key) picked.push(i);
  });
  return { rows: picked, skipped: rows.length - picked.length };
}

/** 数の欄を比べる形（カンマ・空白を外して数。数でなければ打ったまま） */
function numKey(s: string): string {
  const t = s.replace(/[,\s]/g, '');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? String(n) : s.trim();
}

const minute = (ms: number) => Math.floor(ms / 60_000);

/** 同じ足か（R3。7 欄 + 両方にある時刻を分まで） */
export function isSameLeg(a: LegDraft, b: LegDraft): boolean {
  if (a.optionType !== b.optionType || a.side !== b.side) return false;
  if (a.contractMonth.trim() !== b.contractMonth.trim()) return false;
  for (const f of ['strike', 'quantity', 'entryPrice', 'exitPrice'] as const) {
    if (numKey(a[f]) !== numKey(b[f])) return false;
  }
  for (const f of ['entryTime', 'exitTime'] as const) {
    const x = a[f];
    const y = b[f];
    if (x !== undefined && y !== undefined && minute(x) !== minute(y)) return false;
  }
  return true;
}

export interface AddLegsInput {
  /** 今の足 */
  readonly legs: readonly LegDraft[];
  readonly instrumentName: string;
  readonly instruments: readonly InstrumentRecord[];
  /** 読んだ明細の行（parseReadResponse の行） */
  readonly rows: readonly ReadRow[];
  /** 足す明細の通し番号（1 から） */
  readonly sheet: number;
  /** 時間帯の書かれていない明細の時刻を直す時間帯（1 枚目で選んだ・端末に覚えた。無ければ足の時刻を入れない） */
  readonly zone: TzId | null;
}

export type AddLegsPlan =
  | {
      readonly kind: 'added';
      /** 足した後の足（今の足 + 足した足） */
      readonly legs: readonly LegDraft[];
      readonly added: number;
      readonly duplicates: number;
      readonly skipped: number;
      /** 結果の 1 行 */
      readonly notice: string;
    }
  | { readonly kind: 'none' | 'tooMany'; readonly notice: string };

/** 2 枚目の明細の行 → 足す足の案（R2〜R4）。今の足は変えない */
export function planAddLegs(input: AddLegsInput): AddLegsPlan {
  const pos = positionUnderlying(input.instrumentName, input.instruments, input.rows);
  if ('reason' in pos) return { kind: 'none', notice: ADD_LEGS_MSG[pos.reason] };
  const pick = pickAddRows(input.rows, pos.key);
  if (pick.rows.length === 0) return { kind: 'none', notice: ADD_LEGS_MSG.noRows };
  const fresh: { readonly raw: number; readonly leg: LegDraft }[] = [];
  let duplicates = 0;
  for (const i of pick.rows) {
    const row = input.rows[i] as ReadRow;
    const leg = legDraftOf(row, i, [], input.zone);
    if (input.legs.some((l) => isSameLeg(l, leg))) duplicates++;
    else fresh.push({ raw: i, leg });
  }
  const skippedNote = pick.skipped > 0 ? skippedText(pick.skipped) : null;
  if (fresh.length === 0) {
    return { kind: 'none', notice: ADD_LEGS_MSG.allPresent };
  }
  if (input.legs.length + fresh.length > MAX_LEGS) {
    return { kind: 'tooMany', notice: tooManyText(input.legs.length, fresh.length) };
  }
  const unit = fresh.map((f) => f.raw);
  const legs = fresh.map(({ raw, leg }) => {
    const row = input.rows[raw] as ReadRow;
    return {
      ...leg,
      read: {
        ...(leg.read as NonNullable<LegDraft['read']>),
        unit,
        sheet: input.sheet,
        pnl: row.pnl,
        fee: row.feesTotal,
        currency: row.pnlCurrency,
        orderType: row.exitOrderType,
      },
    };
  });
  const notice = [
    addedText(fresh.length),
    ...(duplicates > 0 ? [duplicateText(duplicates)] : []),
    ...(skippedNote ? [skippedNote] : []),
  ].join('。');
  return {
    kind: 'added',
    legs: [...input.legs, ...legs],
    added: fresh.length,
    duplicates,
    skipped: pick.skipped,
    notice,
  };
}

/** ［明細から足す］ を押せない理由（R1。押せれば null） */
export function addLegsBlock(p: {
  readonly statementReading: boolean;
  readonly legReading: boolean;
  readonly legs: number;
}): string | null {
  if (p.statementReading) return ADD_LEGS_MSG.statementReading;
  if (p.legReading) return ADD_LEGS_MSG.reading;
  if (p.legs >= MAX_LEGS) return ADD_LEGS_MSG.full;
  return null;
}

/** pointAfterAdd が変える欄（［元に戻す］ で戻す欄と同じ） */
export const POINT_FIELDS = [
  'entryTime',
  'exitTime',
  'exitOrderType',
  'exitReason',
  'stopOrderPlaced',
] as const satisfies readonly (keyof Draft)[];

/**
 * 足した後のポジションの時刻・注文の種類・決済の理由の既定（R6。C54・C26）。本人が触った欄（touched）は変えない。
 * 時間帯を確かめていない欄（印 tz）は変えない。marks は 1 枚目の明細の印（手入力なら null = 印を付けない）
 * - エントリーの時刻: 足のいちばん早い建て（すべての足に時刻があるとき、または今の値がそれより遅いとき）
 * - 決済の時点（positionExitPoint）を決める足が足した明細の足（決済した足）なら: 決済の時刻 = その足の決済の時刻、
 *   注文の種類 = その行の値。逆指値なら決済の理由 = LC（印「明細から」）・逆指値を入れた、でなければ「明細から」の既定を外す
 */
export function pointAfterAdd(
  draft: Draft,
  marks: Marks | null,
  touched: ReadonlySet<DraftField>,
): { readonly draft: Draft; readonly marks: Marks | null } {
  const patch: { -readonly [K in keyof Draft]?: Draft[K] } = {};
  const m: Partial<Record<DraftField, FieldMark>> | null = marks ? { ...marks } : null;
  const known = draft.legs.map((l) => l.entryTime).filter((t): t is number => t !== undefined);
  if (!touched.has('entryTime') && marks?.entryTime !== 'tz' && known.length > 0) {
    const min = Math.min(...known);
    const cur = draft.entryTime.trim() === '' ? undefined : fromLocalInput(draft.entryTime.trim());
    const all = known.length === draft.legs.length;
    if ((cur === undefined && all) || (cur !== undefined && cur > min)) {
      patch.entryTime = toLocalInput(min);
      if (m) m.entryTime = 'read';
    }
  }
  const legs = readLegs(draft.legs).legs;
  const point = legs === undefined ? undefined : positionExitPoint(legs);
  const at = point?.kind === 'closed' ? (legs?.findIndex((l) => l.id === point.legId) ?? -1) : -1;
  const pointLeg = at >= 0 ? draft.legs[at] : undefined;
  if (point !== undefined && pointLeg && fromAddedStatement(pointLeg)) {
    if (!touched.has('exitTime') && marks?.exitTime !== 'tz' && point.time !== undefined) {
      patch.exitTime = toLocalInput(point.time);
      if (m) m.exitTime = 'read';
    }
    const type = pointLeg.read?.orderType ?? 'unknown';
    patch.exitOrderType = type;
    const stop = type === 'stop';
    patch.stopOrderPlaced = stop ? 'placed' : 'unanswered';
    if (!touched.has('exitReason')) {
      if (stop) {
        patch.exitReason = 'lc';
        if (m) m.exitReason = 'statement';
      } else if (m?.exitReason === 'statement') {
        patch.exitReason = 'other';
        delete m.exitReason;
      }
    }
  }
  const same = (Object.keys(patch) as (keyof Draft)[]).every((k) => patch[k] === draft[k]);
  return { draft: same ? draft : { ...draft, ...patch }, marks: m };
}
