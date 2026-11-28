// 取引を編集画面の純関数（Issue #9 契約 P-2。設計書 4 章の冒頭・C36・7.5、ADR-0004 決定 5・ADR-0006 決定 7）。
// DOM・通信・現在時刻に触れない。
// - 保存した取引 → 記録する画面と同じ下書き（draftFromStored）と読みの文脈（editContext）。判定・R・リスクは記録する画面と
//   同じ readDraft → summarize の道で出し、資金・許容リスクは取引に写した値（base）で計算する（今の設定を使わない）。
//   銘柄を別の銘柄に付け替えたときだけ、その銘柄の今の値で計算する（API の update_trade と同じ）
// - 保存の本文（mergeEdit）: 下書きが持つ欄は readDraft の本文から（空にした任意の欄は消える）、下書きが持たない欄
//   （根拠・TP・感情・総評・限月など）は元の値。手数料・決済 / 建ての時刻は、下書きの文字が開いたときから変わっていなければ
//   元の値（手数料のラベル・秒を落とさない）。出どころ（source）は元の値。利用者が触っていない答えも書き換えない:
//   「窓・滑りでしたか」の答え（聞かない場面でも開いたときのまま）、LC なしの取引の「決めていたか」「動かしたか」
// - チャートの無い枠の時間足（#12 より前の形）は本文に入れない（保存の前に orphanTimeframes をその旨として出す）。
//   チャートの有無は編集の今の枠（#89。足した・外したチャートを含む）で見る
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
import { legDraftsFromStored } from './legs-form';
import {
  type Draft,
  type DraftContext,
  type DraftReading,
  EMPTY_DRAFT,
  fxPairOf,
  fxStale,
  fxVisibleOf,
  type Preview,
  type Summary,
  snapshotOf,
  summarize,
  type TradeBody,
} from './record-form';
import { quietR } from './risky-win';

export const EDIT_BLOCKED =
  'エントリーが複数（またはエントリーごとの LC）の取引は、まだ編集できません。削除して、もう一度記録することはできます。';

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
  // 「最大損失まで」（#117・C50）は LC の価格を置かない計画で、「なし」ではない
  const maxLoss = r.legs !== undefined && r.riskPlan === 'maxLoss';
  const noLc = r.lc === undefined && !maxLoss;
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
    lcMove: noLc || maxLoss ? null : r.lcMove.kind,
    timeframeChange: r.timeframeChange,
    lcBasis: r.lcBasis,
    exitReason: x.reason,
    gapSlip: x.gapSlip,
    // 取り込み（import）の出どころは下書きでは manual に見せ、本文では元の値に戻す（mergeEdit）
    source: r.source === 'statement' ? 'statement' : 'manual',
    exitOrderType: x.orderType,
    // 本人の未設定（notPlaced）は切り替えの欄に分ける（本文は stopOrderPlacedOf で同じ値に戻る。C56・#165）
    stopOrderPlaced: r.stopOrderPlaced === 'placed' ? 'placed' : 'unanswered',
    stopNotPlaced: r.stopOrderPlaced === 'notPlaced',
    entryChartTimeframe: r.entryChartTimeframe ?? null,
    exitChartTimeframe: r.exitChartTimeframe ?? null,
    accountId: accountIdOf(r),
    // オプションのポジション（#117。足を落とさない。#116 の 409）
    legs: r.legs === undefined ? [] : legDraftsFromStored(r.legs),
    lcMaxLoss: maxLoss,
    lcLossPlan: r.lcLossPlanYen === undefined ? '' : formatPlain(r.lcLossPlanYen),
  };
}

/**
 * 編集の画面で「LC を入る前に決めていたか」を聞く取引（C57・#202）: 前からの記録で、LC の価格（または「最大損失まで」）があるのに
 * 「決めていなかった」と保存した取引（後から書いた LC・取り込みの C）だけ。保存した答えのまま開き、直せるようにする（11 章）。
 * それ以外の取引は聞かず、LC の欄から決める（record-form の lcDecidedOf）。開いた元の記録で決める（編集中の LC の切り替えで変えない）
 */
export function asksLcDecided(r: TradeRecord): boolean {
  const maxLoss = r.legs !== undefined && r.riskPlan === 'maxLoss';
  return (r.lc !== undefined || maxLoss) && !r.lcDecidedBeforeEntry;
}

/**
 * 直すときの読みの文脈: 銘柄と口座の一覧、チャートのある枠（charts を省けば保存した取引の枠。#89 は編集の今の枠）、
 * 元の銘柄・口座と写した値
 */
export function editContext(
  t: StoredTrade,
  instruments: readonly InstrumentRecord[],
  accounts: readonly AccountRecord[] = [],
  charts?: { readonly entry: boolean; readonly exit: boolean },
): DraftContext {
  return {
    instruments,
    accounts,
    charts: charts ?? {
      entry: t.charts?.entry !== undefined,
      exit: t.charts?.exit !== undefined,
    },
    base: {
      instrumentId: t.record.instrumentId,
      accountId: accountIdOf(t.record),
      snapshot: t.snapshot,
      ...(t.record.legs === undefined ? {} : { legs: t.record.legs }),
    },
  };
}

export interface OrphanTimeframe {
  readonly slot: ChartSlot;
  readonly timeframe: Timeframe;
}

/**
 * チャートの無い枠に記録された時間足（#12 より前の形。直しの保存では外す）。has を渡せば編集の今の枠で見る
 * （チャートを足した枠は外さない。#89）
 */
export function orphanTimeframes(
  t: StoredTrade,
  has: (slot: ChartSlot) => boolean = (slot) => t.charts?.[slot] !== undefined,
): readonly OrphanTimeframe[] {
  const out: OrphanTimeframe[] = [];
  for (const slot of CHART_SLOTS) {
    const tf = t.record[CHART_TIMEFRAME_FIELD[slot]];
    if (tf !== undefined && !has(slot)) out.push({ slot, timeframe: tf });
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
  opts: {
    readonly fxShown?: boolean;
    readonly keepOriginalFx?: boolean;
    /** 明細から追加した足の手数料（#263・C82。readDraft の option.addedFees） */
    readonly addedFees?: number;
  } = {},
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
    // 手数料の欄が開いたときのままなら保存済みの内訳（ラベル）を保ち、明細から追加した足の手数料を 1 件足す（#263・C82）
    fees: keepFees
      ? opts.addedFees !== undefined && opts.addedFees > 0
        ? [...original.fees, { amountYen: opts.addedFees }]
        : original.fees
      : body.fees,
    ...(body.entryChartTimeframe === undefined
      ? {}
      : { entryChartTimeframe: body.entryChartTimeframe }),
    ...(body.exitChartTimeframe === undefined
      ? {}
      : { exitChartTimeframe: body.exitChartTimeframe }),
    // 足・1R の決め方・見込みは下書きの本文から（足を持つ取引は必ず legs を送る。#116 の守り (b)・#117）
    ...(body.legs === undefined ? {} : { legs: body.legs }),
    ...(body.riskPlan === undefined ? {} : { riskPlan: body.riskPlan }),
    ...(body.lcLossPlanYen === undefined ? {} : { lcLossPlanYen: body.lcLossPlanYen }),
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
  // 危ない勝ちの R は帯に出さない（下の帯の判定の 1 行と同じ規則 R4。#227・C59）
  return s.r === undefined || quietR(s.judgment?.grade) ? label : `${label} ${formatR(s.r)}`;
}

/**
 * 保存の帯に出す、直す前 → 直した後の判定。段・R・理由が変わらなければ null（すぐ上の判定の 1 行と同じことを
 * 2 回言わない。Issue 251・設計書 C70）
 */
export function changeText(before: Summary, after: Summary): string | null {
  const a = verdictText(before);
  if (after.judgment === undefined)
    return `編集前: ${a}（未入力の欄を入力すると、編集後の判定が表示されます）`;
  const b = verdictText(after);
  if (a !== b) return `判定: ${a} → ${b}`;
  // 危ない勝ちのまま R だけが変わる（帯に R を出さないので、変わったことだけを言う）
  if (quietR(after.judgment?.grade) && formatR(before.r) !== formatR(after.r))
    return `判定は ${a} のまま・R が変わります`;
  // 段と R が同じでも理由が変われば言う（チャートを差し替えて「時間足を変えた（…・チャートから）」が消えるなど。#89）
  return sameReasons(before, after) ? null : `判定は ${a} のまま・理由が変わります`;
}

function sameReasons(a: Summary, b: Summary): boolean {
  // 理由の種類と出どころ（チャートから・タップ）だけを比べる（金額・% の数は判定の数の行に出る）。リスクを確かめられない
  // 注記（riskNotChecked）は資金の有無の知らせで、規律の理由ではないので比べない（今の値の再計算は #31 の枠が見せる）
  const key = (s: Summary) =>
    (s.judgment?.reasons ?? [])
      .filter((r) => r.kind !== 'riskNotChecked')
      .map((r) => `${r.kind}:${'source' in r ? String(r.source) : ''}`)
      .join('|');
  return key(a) === key(b);
}

/** 保存の帯の先頭（記録したときの値でなく今の値で再計算して保存する。#31） */
export const BAR_REFRESH = '今の値で再計算';

/**
 * 保存の帯の文: 今の値で再計算する印 · 判定の変化・チャートの変更の数（「・チャート n か所を変更」）。判定が変わらなければ
 * 判定の文を出さず、何も言うことが無ければ空（#89・#251）
 */
export function bandText(change: string | null, chartChanges: number, refresh = false): string {
  const charts = chartChanges > 0 ? `チャート ${chartChanges} か所を変更` : null;
  const body = [change, charts].filter((x): x is string => x !== null).join('・');
  return [refresh ? BAR_REFRESH : null, body === '' ? null : body]
    .filter((x): x is string => x !== null)
    .join(' · ');
}

/**
 * 保存の本文の組み立ての選択（mergeEdit の opts）。為替の保ち方: 欄が出ていれば下書き、出ていなければ為替が意味を失っていない
 * とき（fxStale でない）だけ元の為替を保つ。明細から追加した足の手数料（#263）も渡す
 */
export function editFxOpts(read: DraftReading, ctx: DraftContext, initial: Draft, draft: Draft) {
  return {
    fxShown: fxVisibleOf(editSnapshot(read, ctx, draft)),
    keepOriginalFx: !fxStale(fxPairOf(initial, ctx), fxPairOf(draft, ctx)),
    ...(read.option?.addedFees === undefined ? {} : { addedFees: read.option.addedFees }),
  };
}

/**
 * 保存する記録（足りない欄・誤りがあれば undefined）。銘柄の ID は決まっていなければ仮の値。編集の controller と、詳細の
 * 比較のシート（#131。開いたときの下書きのまま）が同じものを使う
 */
export function mergedOf(
  trade: StoredTrade,
  initial: Draft,
  draft: Draft,
  read: DraftReading,
  instrumentId: string,
  ctx: DraftContext,
): TradeRecord | undefined {
  return read.body === undefined
    ? undefined
    : mergeEdit(
        trade.record,
        initial,
        draft,
        read.body,
        instrumentId,
        editFxOpts(read, ctx, initial, draft),
      );
}
