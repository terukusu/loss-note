// 取引を編集画面の純関数（Issue #9 契約 P-2。設計書 4 章の冒頭・C36・7.5、ADR-0004 決定 5・ADR-0006 決定 7）。
// DOM・通信・現在時刻に触れない。
// - 保存した取引 → 記録する画面と同じ下書き（draftFromStored）と読みの文脈（editContext）。判定・R・リスクは記録する画面と
//   同じ readDraft → summarize の道で出し、資金・許容リスクは取引に写した値（base）で計算する（今の設定を使わない）。
//   銘柄を別の銘柄に付け替えたときだけ、その銘柄の今の値で計算する（API の update_trade と同じ）
// - 保存の本文（mergeEdit）: 下書きが持つ欄は readDraft の本文から（空にした任意の欄は消える）、下書きが持たない欄
//   （根拠・TP・感情・総評・限月など）は元の値。手数料・決済 / 建ての時刻は、下書きの文字が開いたときから変わっていなければ
//   元の値（手数料のラベル・秒を落とさない）。出どころ（source）は元の値。利用者が触っていない答えも書き換えない:
//   「窓・滑りでしたか」の答え（聞かない場面でも開いたときのまま）、LC なしの取引の「決めていたか」「動かしたか」
// - チャートの無い枠の時間足（#12 より前の形）は本文に入れない（保存の前に orphanTimeframes をその旨として出す）
// - 建てが複数・建てごとの LC の取引は下書きで表せない（直すと判定が変わる）ので直せない（editBlock）
// - 口座（#47）: 下書きの口座は取引の口座（accountId の無い取引は既定の口座）。口座が元と同じなら写した資金・許容リスク、
//   付け替えたら付け替え先の今の値で計算する（API と同じ）。本文の口座は、口座が 2 つ以上なら下書きの口座、
//   1 つなら元の値（元に無ければ入れない）
// - 為替（#47 PR-2）: 為替の欄が出ている取引（価格の通貨 ≠ 口座の通貨）では下書きの値が正（空 = 外す）、出ていない取引では
//   元の exit.fxRate を保つ（mergeEdit の fxShown）。ただし通貨の組（価格の通貨 / 口座の通貨）が開いたときと違えば、元の為替は
//   意味を失うので保たない（keepOriginalFx = false）。損益・手数料・為替の空への戻しは edit-controller
import type {
  AccountRecord,
  InstrumentRecord,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../../core/record';
import { accountIdOf, feesTotalYen } from '../../../core/record';
import type { Timeframe } from '../../../core/trade';
import { badgeModel } from './badge';
import { CHART_SLOTS, CHART_TIMEFRAME_FIELD, type ChartSlot } from './charts';
import { toLocalInput } from './datetime';
import { formatPlain, formatR } from './format';
import { findInstrument } from './instrument-name';
import {
  type Draft,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  type Preview,
  type Summary,
  snapshotOf,
  summarize,
  type TradeBody,
} from './record-form';

export const EDIT_BLOCKED =
  '建てが複数（または建てごとの LC）の取引は、まだ編集できません。消して記録し直すことはできます。';

/** 直せない理由（直せるなら null） */
export function editBlock(t: Pick<StoredTrade, 'record'>): string | null {
  const r = t.record;
  if (r.entries.length > 1 || r.entries[0].lc !== undefined) return EDIT_BLOCKED;
  return null;
}

/** 保存した取引 → 下書き（記録する画面と同じ形。数は指数表記にしない、時刻は端末の時間帯の分まで） */
export function draftFromStored(t: StoredTrade, instruments: readonly InstrumentRecord[]): Draft {
  const r = t.record;
  const e = r.entries[0];
  const x = r.exit;
  const noLc = r.lc === undefined;
  return {
    ...EMPTY_DRAFT,
    instrumentName: instruments.find((i) => i.id === r.instrumentId)?.name ?? '',
    side: r.side,
    entryPrice: formatPlain(e.price),
    exitPrice: formatPlain(x.price),
    quantity: formatPlain(e.quantity),
    fxRate: x.fxRate === undefined ? '' : formatPlain(x.fxRate),
    exitTime: toLocalInput(x.time),
    entryTime: e.time === undefined ? '' : toLocalInput(e.time),
    pnlYen: r.statementPnlYen === undefined ? '' : formatPlain(r.statementPnlYen),
    feeYen: r.fees.length === 0 ? '' : formatPlain(feesTotalYen(r.fees)),
    lc: noLc ? '' : formatPlain(r.lc as number),
    lcNone: noLc,
    lcAfter:
      !noLc && r.lcMove.kind === 'widened' && r.lcMove.after !== undefined
        ? formatPlain(r.lcMove.after)
        : '',
    brokenCondition: r.brokenCondition ?? '',
    lcDecided: noLc ? null : r.lcDecidedBeforeEntry,
    lcMove: noLc ? null : r.lcMove.kind,
    timeframeChange: r.timeframeChange,
    lcBasis: r.lcBasis,
    exitReason: x.reason,
    gapSlip: x.gapSlip,
    // 取り込み（import）の出どころは下書きでは manual に見せ、本文では元の値に戻す（mergeEdit）
    source: r.source === 'statement' ? 'statement' : 'manual',
    exitOrderType: x.orderType,
    stopOrderPlaced: r.stopOrderPlaced,
    entryChartTimeframe: r.entryChartTimeframe ?? null,
    exitChartTimeframe: r.exitChartTimeframe ?? null,
    accountId: accountIdOf(r),
  };
}

/** 直すときの読みの文脈: 銘柄と口座の一覧、チャートのある枠、元の銘柄・口座と写した値 */
export function editContext(
  t: StoredTrade,
  instruments: readonly InstrumentRecord[],
  accounts: readonly AccountRecord[] = [],
): DraftContext {
  return {
    instruments,
    accounts,
    charts: { entry: t.charts?.entry !== undefined, exit: t.charts?.exit !== undefined },
    base: {
      instrumentId: t.record.instrumentId,
      accountId: accountIdOf(t.record),
      snapshot: t.snapshot,
    },
  };
}

export interface OrphanTimeframe {
  readonly slot: ChartSlot;
  readonly timeframe: Timeframe;
}

/** チャートの無い枠に記録された時間足（#12 より前の形。直しの保存では外す） */
export function orphanTimeframes(t: StoredTrade): readonly OrphanTimeframe[] {
  const out: OrphanTimeframe[] = [];
  for (const slot of CHART_SLOTS) {
    const tf = t.record[CHART_TIMEFRAME_FIELD[slot]];
    if (tf !== undefined && t.charts?.[slot] === undefined) out.push({ slot, timeframe: tf });
  }
  return out;
}

/** 下書きが持たない欄（元の値を保つ） */
const KEPT_KEYS = [
  'status',
  'contractMonth',
  'optionType',
  'strike',
  'timeframe',
  'tp',
  'thesis',
  'entryEmotion',
  'planFxRate',
  'plannedAt',
] as const satisfies readonly (keyof TradeRecord)[];
const KEPT_EXIT_KEYS = ['emotion', 'review'] as const;

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/**
 * 直しの保存の本文。original = 元の記録、initial = 開いたときの下書き、draft = 今の下書き、body = readDraft の本文、
 * instrumentId = 保存のときに決めた銘柄の ID。fxShown = 為替の欄が出ているか（出ていれば本文の為替、出ていなければ元の為替）
 */
export function mergeEdit(
  original: TradeRecord,
  initial: Draft,
  draft: Draft,
  body: TradeBody,
  instrumentId: string,
  opts: { readonly fxShown?: boolean; readonly keepOriginalFx?: boolean } = {},
): TradeRecord {
  const fxRate = opts.fxShown
    ? body.exit.fxRate
    : opts.keepOriginalFx === false
      ? undefined
      : original.exit.fxRate;
  const e0 = original.entries[0];
  const be = body.entries[0];
  const keepEntryTime = draft.entryTime === initial.entryTime && e0.time !== undefined;
  const keepExitTime = draft.exitTime === initial.exitTime;
  const keepFees = draft.feeYen === initial.feeYen;
  // 触っていない答えは元の値（下書きで表せない組み合わせを保存でそろえない）
  const keepGapSlip = draft.gapSlip === initial.gapSlip;
  const keepNoLcAnswers = draft.lcNone && initial.lcNone && original.lc === undefined;
  return {
    ...pick(original, KEPT_KEYS),
    status: original.status,
    source: original.source,
    instrumentId,
    ...(body.accountId !== undefined
      ? { accountId: body.accountId }
      : original.accountId !== undefined
        ? { accountId: original.accountId }
        : {}),
    side: body.side,
    ...(body.lc === undefined ? {} : { lc: body.lc }),
    ...(body.brokenCondition === undefined ? {} : { brokenCondition: body.brokenCondition }),
    lcBasis: body.lcBasis,
    stopOrderPlaced: body.stopOrderPlaced,
    lcDecidedBeforeEntry: keepNoLcAnswers
      ? original.lcDecidedBeforeEntry
      : body.lcDecidedBeforeEntry,
    lcMove: keepNoLcAnswers ? original.lcMove : body.lcMove,
    timeframeChange: body.timeframeChange,
    entries: [
      {
        price: be.price,
        quantity: be.quantity,
        ...(keepEntryTime
          ? { time: e0.time as number }
          : be.time === undefined
            ? {}
            : { time: be.time }),
      },
    ],
    exit: {
      ...pick(original.exit, KEPT_EXIT_KEYS),
      time: keepExitTime ? original.exit.time : body.exit.time,
      price: body.exit.price,
      ...(fxRate === undefined ? {} : { fxRate }),
      orderType: body.exit.orderType,
      reason: body.exit.reason,
      gapSlip: keepGapSlip ? original.exit.gapSlip : body.exit.gapSlip,
    },
    ...(body.statementPnlYen === undefined ? {} : { statementPnlYen: body.statementPnlYen }),
    fees: keepFees ? original.fees : body.fees,
    ...(body.entryChartTimeframe === undefined
      ? {}
      : { entryChartTimeframe: body.entryChartTimeframe }),
    ...(body.exitChartTimeframe === undefined
      ? {}
      : { exitChartTimeframe: body.exitChartTimeframe }),
  };
}

/**
 * 直しの読みの銘柄の値（同じ銘柄 = 写した値、別の銘柄 = 今の値、一覧に無い名前 = 既定）と資金・許容リスク
 * （同じ口座 = 写した値、付け替えた口座 = その口座の今の値）
 */
export function editSnapshot(
  read: DraftReading,
  ctx: DraftContext,
  draft: Pick<Draft, 'accountId'>,
): TradeSnapshot {
  const matched =
    read.instrument.matchedId === undefined
      ? findInstrument(read.instrument.name, ctx.instruments)
      : ctx.instruments.find((i) => i.id === read.instrument.matchedId);
  return snapshotOf(ctx, matched, draft.accountId);
}

/**
 * 直しのプレビュー: 保存する記録（merged。下書きが持たない欄 = 為替のレート・計画の時刻などを含む）があればそれで計算し、
 * 無ければ（足りない欄・誤りがある）readDraft のプレビューのまま
 */
export function editPreview(
  read: DraftReading,
  merged: TradeRecord | undefined,
  snapshot: TradeSnapshot,
): Preview {
  if (merged === undefined) return read.preview;
  return { ...summarize({ record: merged, snapshot }), showGapSlip: read.preview.showGapSlip };
}

function verdictText(s: Pick<Summary, 'judgment' | 'r'>): string {
  const label = badgeModel(s.judgment?.grade ?? null).label;
  return s.r === undefined ? label : `${label} ${formatR(s.r)}`;
}

/** 保存の帯に出す、直す前 → 直した後の判定（変わらなければその旨） */
export function changeText(before: Summary, after: Summary): string {
  const a = verdictText(before);
  if (after.judgment === undefined) return `編集前: ${a}（編集後の判定は、欄をそろえると出ます）`;
  const b = verdictText(after);
  return a === b ? `判定は変わりません: ${a}` : `判定: ${a} → ${b}`;
}
