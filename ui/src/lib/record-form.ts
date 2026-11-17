// 記録する画面の入力の下書き（Issue #13 契約 R-1。設計書 4.2・5.1・5.3・7.5、C17・C19・C26・C37）。
// 下書き（欄ごとの文字列 + 選択）→ 欄ごとの誤り・足りない欄の名前・API に送る本文・プレビュー（判定・R・リスク）を返す
// 純関数 readDraft と、下書きの更新 applyDraft。DOM・通信・現在時刻に触れない（同じ入力に同じ出力）。
// 判定・R は core/ の evaluateTrade の結果だけを使う（規則を作り直さない）。本文を保存の形に写し、
// core/record.ts の toTradeInput を通して計算するので、保存の前の表示と保存の後に読み直した表示が同じ道を通る。
// #15（スクショの読み取り）は、読み取った値を applyDraft の fill で同じ欄に流し込み（statement-fill.ts）、
// 出どころ・注文の種類・逆指値を入れたかも下書きに持って、同じ readDraft の道で本文を作る。
// #12（根拠の足のチャート）: 枠ごとの時間足を下書きに持ち、チャートのある枠（DraftContext.charts）の選んだ時間足だけを
// 本文に入れる（プレビューの判定にも同じ本文が効く）。チャートが無いときの本文は今と同じ
import { evaluateTrade } from '../../../core/evaluate';
import type { Judgment } from '../../../core/judge';
import type {
  GapSlip,
  InstrumentRecord,
  InstrumentSnapshot,
  RecordSource,
  StopOrderPlaced,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../../core/record';
import { toTradeInput } from '../../../core/record';
import type {
  ExitOrderType,
  ExitReason,
  LcMove,
  Side,
  Timeframe,
  TimeframeChange,
} from '../../../core/trade';
import { fromLocalInput } from './datetime';
import { findInstrument } from './instrument-name';
import { widenVerb } from './reasons';

export type LcMoveKind = LcMove['kind'];

/** 下書き。文字の欄は打ったまま、選択は未選択 = null */
export interface Draft {
  readonly instrumentName: string;
  readonly side: Side | null;
  readonly entryPrice: string;
  readonly exitPrice: string;
  readonly quantity: string;
  readonly exitTime: string;
  readonly entryTime: string;
  readonly pnlYen: string;
  readonly feeYen: string;
  readonly lc: string;
  /** 「LC を決めていなかった（なし）」をはっきり選んだ */
  readonly lcNone: boolean;
  readonly lcAfter: string;
  readonly brokenCondition: string;
  readonly lcDecided: boolean | null;
  readonly lcMove: LcMoveKind | null;
  readonly timeframeChange: TimeframeChange | null;
  readonly lcBasis: 'chart' | 'amount';
  readonly exitReason: ExitReason;
  readonly gapSlip: GapSlip;
  /** 出どころ（明細の読み取りから入れた = statement。画面に欄は出さない。#15） */
  readonly source: Extract<RecordSource, 'manual' | 'statement'>;
  /** 決済の注文の種類（明細の証拠だけ。手では選ばない。C26） */
  readonly exitOrderType: ExitOrderType;
  /** 逆指値を入れたか（明細で逆指値と読めたときだけ placed） */
  readonly stopOrderPlaced: StopOrderPlaced;
  /** チャートの時間足（任意。チャートのある枠でだけ選べ、本文に入る。#12） */
  readonly entryChartTimeframe: Timeframe | null;
  readonly exitChartTimeframe: Timeframe | null;
}

export type DraftField = keyof Draft;

/** 空の下書き（3 つのタップ・L / S は既定なし。LC の根拠 = チャートの根拠・決済の理由 = その他。C19） */
export const EMPTY_DRAFT: Draft = {
  instrumentName: '',
  side: null,
  entryPrice: '',
  exitPrice: '',
  quantity: '',
  exitTime: '',
  entryTime: '',
  pnlYen: '',
  feeYen: '',
  lc: '',
  lcNone: false,
  lcAfter: '',
  brokenCondition: '',
  lcDecided: null,
  lcMove: null,
  timeframeChange: null,
  lcBasis: 'chart',
  exitReason: 'other',
  gapSlip: 'unanswered',
  source: 'manual',
  exitOrderType: 'unknown',
  stopOrderPlaced: 'unanswered',
  entryChartTimeframe: null,
  exitChartTimeframe: null,
};

export type DraftAction =
  | {
      [K in DraftField]: { readonly type: 'set'; readonly field: K; readonly value: Draft[K] };
    }[DraftField]
  | { readonly type: 'fill'; readonly values: Partial<Draft> }
  | { readonly type: 'reset'; readonly values?: Partial<Draft> };

/**
 * 下書きの更新。LC の価格を打つと「なし」は外れ、「なし」を選ぶと LC・下げた後の LC は空になる
 * （価格と「なし」が両方ある下書きを作らない）
 */
export function applyDraft(draft: Draft, action: DraftAction): Draft {
  if (action.type === 'reset') return { ...EMPTY_DRAFT, ...(action.values ?? {}) };
  const next: Draft =
    action.type === 'fill'
      ? { ...draft, ...action.values }
      : ({ ...draft, [action.field]: action.value } as Draft);
  const touched = action.type === 'fill' ? action.values : { [action.field]: action.value };
  if (touched.lcNone === true) return { ...next, lc: '', lcAfter: '' };
  if (typeof touched.lc === 'string' && touched.lc.trim() !== '') return { ...next, lcNone: false };
  return next;
}

/** 読み取りの文脈: 自分の銘柄の一覧と設定（資金・許容リスク） */
export interface DraftContext {
  readonly instruments: readonly InstrumentRecord[];
  readonly settings: { readonly capitalYen: number | null; readonly riskTolerancePct: number };
  /** チャートのある枠（#12。省けばどちらも無い） */
  readonly charts?: { readonly entry: boolean; readonly exit: boolean };
}

/** API に送る取引の本文（銘柄の ID は保存のときに決める） */
export type TradeBody = Omit<TradeRecord, 'instrumentId'>;

/** 判定・数の表示に要るもの（保存の前のプレビューと、保存の後の表示で同じ形） */
export interface Summary {
  readonly r?: number;
  readonly oneRYen?: number;
  readonly riskPct?: number;
  readonly pnlYen?: number;
  readonly judgment?: Judgment;
  /** LC が無い（「なし」で記録した）。R・1R・リスクは出ない */
  readonly noLc: boolean;
  /** リスク（%）が出ないときの場所の文言 */
  readonly riskNote?: string;
}

export interface Preview extends Summary {
  /** 「窓・滑りでしたか」を聞くか（「持ち続けた」が当たる取引だけ。答えても消えない。C19） */
  readonly showGapSlip: boolean;
}

export interface DraftReading {
  readonly errors: Readonly<Partial<Record<DraftField, string>>>;
  /** 足りない欄の名前（画面の並びの順） */
  readonly missing: readonly string[];
  readonly canSave: boolean;
  /** 保存できない理由の文（足りない欄・誤りのほか。明細の読み取り中など。#15） */
  readonly notice?: string;
  readonly body?: TradeBody;
  readonly instrument: { readonly name: string; readonly matchedId?: string };
  readonly preview: Preview;
}

/** 一覧に無い銘柄を足すときの既定（API の既定と同じ。C21） */
export const DEFAULT_INSTRUMENT: InstrumentSnapshot = {
  multiplier: 1,
  quantityStep: 1,
  priceCurrency: null,
  underlyingKind: 'other',
  productForm: 'spotCfd',
};

/** API の入力の上限（api/src/loss_note_api/schema.py と同じ） */
export const MAX_ABS = 1e12;
export const NAME_MAX = 40;
const BROKEN_CONDITION_MAX = 200;

export const MISSING_LABEL = {
  instrumentName: '銘柄',
  side: 'L / S',
  entryPrice: 'イン',
  exitPrice: '決済の価格',
  quantity: '数量',
  exitTime: '決済の時刻',
  lc: 'LC（価格か「なし」）',
  lcDecided: 'LC を入る前に決めていたか',
  lcMove: 'LC を動かしたか',
  timeframeChange: '時間足を変えたか',
} as const;

/** 欄の名前（誤りのある欄を並べるとき） */
export const FIELD_LABEL: Readonly<Record<DraftField, string>> = {
  instrumentName: '銘柄',
  side: 'L / S',
  entryPrice: 'イン',
  exitPrice: '決済',
  quantity: '数量',
  exitTime: '決済の時刻',
  entryTime: '建てた時刻',
  pnlYen: '損益（円）',
  feeYen: '手数料（円）',
  lc: 'LC',
  lcNone: 'LC',
  lcAfter: '下げた後の LC',
  brokenCondition: '崩れの条件の一言',
  lcDecided: 'LC を入る前に決めていたか',
  lcMove: 'LC を動かしたか',
  timeframeChange: '時間足を変えたか',
  lcBasis: 'LC の根拠',
  exitReason: '決済の理由',
  gapSlip: '窓・滑りでしたか',
  source: '出どころ',
  exitOrderType: '注文の種類',
  stopOrderPlaced: '逆指値を入れたか',
  entryChartTimeframe: 'エントリー時のチャートの時間足',
  exitChartTimeframe: '決済時のチャートの時間足',
};

/** 「ほかの欄（任意）」に畳んだ欄 */
export const OPTIONAL_FIELDS: readonly DraftField[] = [
  'pnlYen',
  'feeYen',
  'entryTime',
  'lcBasis',
  'exitReason',
];

export const MSG = {
  notNumber: '数を入れてください（例: 100.5）',
  notPositive: '0 より大きい数を入れてください',
  tooLarge: '大きすぎます',
  notNonNegative: '0 以上の数を入れてください',
  notDateTime: '日時を入れてください',
  entryAfterExit: '建てた時刻は決済の時刻より前にしてください',
  nameInvalid: `${NAME_MAX} 字までで、制御文字を含めないでください`,
  brokenConditionInvalid: `${BROKEN_CONDITION_MAX} 字までで、制御文字を含めないでください`,
  lcDirection: (side: Side) =>
    side === 'L' ? 'L の LC はインより下にしてください' : 'S の LC はインより上にしてください',
  lcAfterDirection: (side: Side) =>
    side === 'L'
      ? '下げた後の LC は、入る前の LC より下にしてください'
      : '上げた後の LC は、入る前の LC より上にしてください',
} as const;

export const RISK_NOTE = {
  noLc: 'LC が無いので出ません',
  noCapital: '資金を設定すると出ます',
  noOneR: '損益（円）を入れると出ます',
} as const;

type Parsed = { readonly ok: true; readonly value: number } | { readonly ok: false };

/**
 * 数の読み方: NFKC（全角の数字・記号）→ 前後の空白を除く → 3 桁区切りのカンマを除く → − (U+2212) を - に →
 * `[+-]整数[.小数]`（`100.`・`.5` を含む）だけを受ける（指数表記・16 進・Infinity を受けない）
 */
export function parseNum(raw: string): Parsed {
  let s = raw.normalize('NFKC').trim().replace(/−/g, '-');
  if (s.includes(',')) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return { ok: false };
    s = s.replace(/,/g, '');
  }
  // 「100.」「.5」も受ける（打ちかけ・打ち間違いで起きやすい形）
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false };
  const value = Number(s);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** 制御文字・孤立したサロゲート・書式文字（ZWJ を除く）を含むか（API の text() と同じ） */
export function hasBadChar(s: string): boolean {
  for (const ch of s) {
    if (ch === '‍') continue;
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) return true;
    const c = ch.charCodeAt(0);
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return true;
  }
  return false;
}

/** 文字の数（Python の len と同じ、コードポイントで数える） */
export function lengthOf(s: string): number {
  return [...s].length;
}

/** 保存した取引（またはその形に写した下書き）の判定・数 */
export function summarize(stored: Pick<StoredTrade, 'record' | 'snapshot'>): Summary {
  const noLc = stored.record.lc === undefined;
  const ev = evaluateTrade(toTradeInput(stored));
  if (!ev.ok) return { noLc };
  const riskNote =
    ev.riskPct !== undefined
      ? undefined
      : noLc
        ? RISK_NOTE.noLc
        : stored.snapshot.capitalYen === null
          ? RISK_NOTE.noCapital
          : RISK_NOTE.noOneR;
  return {
    noLc,
    ...(ev.r === undefined ? {} : { r: ev.r }),
    ...(ev.oneRYen === undefined ? {} : { oneRYen: ev.oneRYen }),
    ...(ev.riskPct === undefined ? {} : { riskPct: ev.riskPct }),
    ...(ev.pnlYen === undefined ? {} : { pnlYen: ev.pnlYen }),
    ...(ev.judgment === undefined ? {} : { judgment: ev.judgment }),
    ...(riskNote === undefined ? {} : { riskNote }),
  };
}

function snapshotOf(ctx: DraftContext, instrument: InstrumentRecord | undefined): TradeSnapshot {
  const i = instrument ?? DEFAULT_INSTRUMENT;
  return {
    instrument: {
      multiplier: i.multiplier,
      quantityStep: i.quantityStep,
      priceCurrency: i.priceCurrency,
      underlyingKind: i.underlyingKind,
      productForm: i.productForm,
    },
    capitalYen: ctx.settings.capitalYen,
    riskTolerancePct: ctx.settings.riskTolerancePct,
  };
}

const PREVIEW_ID = 'preview';

export function readDraft(draft: Draft, ctx: DraftContext): DraftReading {
  const errors: Partial<Record<DraftField, string>> = {};
  const missing: string[] = [];

  // 数の欄: 空なら undefined、読めなければ誤り
  const num = (
    field: DraftField,
    raw: string,
    rule: 'positive' | 'nonNegative' | 'signed',
    label?: string,
  ): number | undefined => {
    if (raw.trim() === '') {
      if (label) missing.push(label);
      return undefined;
    }
    const p = parseNum(raw);
    if (!p.ok) {
      errors[field] = MSG.notNumber;
      return undefined;
    }
    if (Math.abs(p.value) > MAX_ABS) {
      errors[field] = MSG.tooLarge;
      return undefined;
    }
    if (rule === 'positive' && !(p.value > 0)) {
      errors[field] = MSG.notPositive;
      return undefined;
    }
    if (rule === 'nonNegative' && p.value < 0) {
      errors[field] = MSG.notNonNegative;
      return undefined;
    }
    return p.value;
  };

  // 銘柄
  const name = draft.instrumentName.trim();
  if (name === '') missing.push(MISSING_LABEL.instrumentName);
  else if (lengthOf(name) > NAME_MAX || hasBadChar(name)) errors.instrumentName = MSG.nameInvalid;
  const matched = errors.instrumentName ? undefined : findInstrument(name, ctx.instruments);

  // 取引の欄
  const side = draft.side;
  if (side === null) missing.push(MISSING_LABEL.side);
  const entry = num('entryPrice', draft.entryPrice, 'positive', MISSING_LABEL.entryPrice);
  const exit = num('exitPrice', draft.exitPrice, 'positive', MISSING_LABEL.exitPrice);
  const quantity = num('quantity', draft.quantity, 'positive', MISSING_LABEL.quantity);

  let exitTime: number | undefined;
  if (draft.exitTime.trim() === '') missing.push(MISSING_LABEL.exitTime);
  else {
    exitTime = fromLocalInput(draft.exitTime.trim());
    if (exitTime === undefined) errors.exitTime = MSG.notDateTime;
  }

  // LC（価格か「なし」のどちらか。C37）
  const lcNone = draft.lcNone;
  let lc: number | undefined;
  if (!lcNone) {
    lc = num('lc', draft.lc, 'positive', MISSING_LABEL.lc);
    if (lc !== undefined && side !== null && entry !== undefined) {
      const ok = side === 'L' ? lc < entry : lc > entry;
      if (!ok) {
        errors.lc = MSG.lcDirection(side);
        lc = undefined;
      }
    }
  }

  // 崩れの条件の一言（任意）
  const brokenCondition = draft.brokenCondition.trim();
  if (lengthOf(brokenCondition) > BROKEN_CONDITION_MAX || hasBadChar(brokenCondition)) {
    errors.brokenCondition = MSG.brokenConditionInvalid;
  }

  // 3 つのタップ（「なし」のときは決めていたか・動かしたかを聞かない）
  if (!lcNone) {
    if (draft.lcDecided === null) missing.push(MISSING_LABEL.lcDecided);
    if (draft.lcMove === null) missing.push(MISSING_LABEL.lcMove);
  }
  if (draft.timeframeChange === null) missing.push(MISSING_LABEL.timeframeChange);

  // 下げた後の LC（任意。「下げた」のときだけ）
  let lcAfter: number | undefined;
  if (!lcNone && draft.lcMove === 'widened') {
    lcAfter = num('lcAfter', draft.lcAfter, 'positive');
    if (lcAfter !== undefined && side !== null && lc !== undefined) {
      const ok = side === 'L' ? lcAfter < lc : lcAfter > lc;
      if (!ok) {
        errors.lcAfter = MSG.lcAfterDirection(side);
        lcAfter = undefined;
      }
    }
  }

  // 任意の欄
  let entryTime: number | undefined;
  if (draft.entryTime.trim() !== '') {
    entryTime = fromLocalInput(draft.entryTime.trim());
    if (entryTime === undefined) errors.entryTime = MSG.notDateTime;
    else if (exitTime !== undefined && entryTime > exitTime) {
      errors.entryTime = MSG.entryAfterExit;
      entryTime = undefined;
    }
  }
  const pnlYen = num('pnlYen', draft.pnlYen, 'signed');
  const feeYen = num('feeYen', draft.feeYen, 'nonNegative');

  // チャートの時間足（チャートのある枠の、選んだものだけ。R2・R4）
  const entryChartTimeframe = ctx.charts?.entry ? draft.entryChartTimeframe : null;
  const exitChartTimeframe = ctx.charts?.exit ? draft.exitChartTimeframe : null;

  const instrument = { name, ...(matched ? { matchedId: matched.id } : {}) };
  const snapshot = snapshotOf(ctx, matched);
  const hasErrors = Object.keys(errors).length > 0;

  // 本文の組み立て（タップは引数で差し替えられる。R の先出しで仮の値を入れるため）
  const build = (
    s: Side,
    en: number,
    ex: number,
    q: number,
    xt: number,
    taps: {
      lcDecided: boolean;
      lcMove: LcMoveKind;
      timeframeChange: TimeframeChange;
      gapSlip: GapSlip;
    },
  ): TradeBody => {
    const move: LcMove = lcNone
      ? { kind: 'none' }
      : taps.lcMove === 'widened'
        ? { kind: 'widened', ...(lcAfter === undefined ? {} : { after: lcAfter }) }
        : { kind: taps.lcMove };
    return {
      status: 'closed',
      source: draft.source,
      side: s,
      ...(lc === undefined ? {} : { lc }),
      ...(brokenCondition === '' ? {} : { brokenCondition }),
      lcBasis: draft.lcBasis,
      stopOrderPlaced: draft.stopOrderPlaced,
      lcDecidedBeforeEntry: lcNone ? false : taps.lcDecided,
      lcMove: move,
      timeframeChange: taps.timeframeChange,
      entries: [
        { price: en, quantity: q, ...(entryTime === undefined ? {} : { time: entryTime }) },
      ],
      // 注文の種類は明細の証拠だけ（手の記録は「不明」のまま。手で選んだ「逆指値」は証拠にならない。C26）
      exit: {
        time: xt,
        price: ex,
        orderType: draft.exitOrderType,
        reason: draft.exitReason,
        gapSlip: taps.gapSlip,
      },
      ...(pnlYen === undefined ? {} : { statementPnlYen: pnlYen }),
      fees: feeYen === undefined ? [] : [{ amountYen: feeYen }],
      ...(entryChartTimeframe === null ? {} : { entryChartTimeframe }),
      ...(exitChartTimeframe === null ? {} : { exitChartTimeframe }),
    };
  };
  const asStored = (body: TradeBody) => ({
    record: { ...body, instrumentId: PREVIEW_ID } as TradeRecord,
    snapshot,
  });

  let preview: Preview = { noLc: lcNone, showGapSlip: false };
  let body: TradeBody | undefined;
  const numbersReady =
    !hasErrors &&
    side !== null &&
    entry !== undefined &&
    exit !== undefined &&
    quantity !== undefined &&
    (lcNone || lc !== undefined);

  if (numbersReady) {
    const xt = exitTime ?? 0;
    const complete = missing.length === 0;
    if (complete) {
      const taps = {
        lcDecided: draft.lcDecided ?? false,
        lcMove: draft.lcMove ?? 'none',
        timeframeChange: draft.timeframeChange ?? 'none',
      };
      // 「窓・滑りでしたか」は、答えを未回答にしたときに「持ち続けた」が当たる取引だけで聞く
      const unanswered = summarize(
        asStored(build(side, entry, exit, quantity, xt, { ...taps, gapSlip: 'unanswered' })),
      );
      const showGapSlip =
        unanswered.judgment?.reasons.some((r) => r.kind === 'heldPastLc') ?? false;
      body = build(side, entry, exit, quantity, xt, {
        ...taps,
        gapSlip: showGapSlip ? draft.gapSlip : 'unanswered',
      });
      preview = { ...summarize(asStored(body)), showGapSlip };
    } else {
      // タップの前でも R・1R・リスクは出す（タップに依存しない。判定・理由は出さない）
      const s = summarize(
        asStored(
          build(side, entry, exit, quantity, xt, {
            lcDecided: true,
            lcMove: 'none',
            timeframeChange: 'none',
            gapSlip: 'unanswered',
          }),
        ),
      );
      const { judgment: _hidden, ...nums } = s;
      preview = { ...nums, showGapSlip: false };
    }
  }

  const canSave = body !== undefined;
  return {
    errors,
    missing,
    canSave,
    ...(body === undefined ? {} : { body }),
    instrument,
    preview,
  };
}

/** LC を動かしたかの選択肢の文言（S は「上げた」） */
export function lcMoveLabel(kind: LcMoveKind, side: Side | null): string {
  if (kind === 'none') return 'そのまま';
  if (kind === 'tightened') return '詰めた';
  return widenVerb(side ?? 'L');
}
