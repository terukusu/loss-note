// 記録する画面の入力の下書き（Issue #13 契約 R-1。設計書 4.2・5.1・5.3・7.5、C17・C19・C26・C37）。
// 下書き（欄ごとの文字列 + 選択）→ 欄ごとの誤り・足りない欄の名前・API に送る本文・プレビュー（判定・R・リスク）を返す
// 純関数 readDraft と、下書きの更新 applyDraft。DOM・通信・現在時刻に触れない（同じ入力に同じ出力）。
// 判定・R は core/ の evaluateTrade の結果だけを使う（規則を作り直さない）。本文を保存の形に写し、
// core/record.ts の toTradeInput を通して計算するので、保存の前の表示と保存の後に読み直した表示が同じ道を通る。
// #15（スクショの読み取り）は、読み取った値を applyDraft の fill で同じ欄に流し込み（statement-fill.ts）、
// 出どころ・注文の種類・逆指値を入れたかも下書きに持って、同じ readDraft の道で本文を作る。
// #12（根拠の足のチャート）: 枠ごとの時間足を下書きに持ち、チャートのある枠（DraftContext.charts）の選んだ時間足だけを
// 本文に入れる（プレビューの判定にも同じ本文が効く）。チャートが無いときの本文は今と同じ
// #47（口座）: 下書きに口座（accountId。空 = 既定の口座）を持ち、資金・許容リスクは選んだ口座の値で計算する。
// 本文の accountId は口座が 2 つ以上のときだけ入れる（口座 1 つの利用者の本文は今と同じ。KEEP-3）
// #47 PR-2（通貨と為替）: 為替の欄（fxRate）は銘柄の価格の通貨が決まっていて口座の通貨と違うときだけ読み、本文の
// exit.fxRate に入れる（欄が出ていなければ入れない）。明細の損益から逆算した為替は Summary.derivedFx で見せるだけ（保存しない）
import { evaluateTrade } from '../../../core/evaluate';
import { maxLossPrice, sideFromExpiry } from '../../../core/expiry';
import type { Judgment } from '../../../core/judge';
import {
  isMaxLossPlan,
  type OneRSource,
  type OptionMaxLoss,
  optionMaxLoss,
  optionSideFromLc,
  optionSideMismatch,
  positionExitOrderType,
} from '../../../core/option';
import { statementFxRate } from '../../../core/pnl';
import type {
  AccountRecord,
  GapSlip,
  InstrumentBody,
  InstrumentRecord,
  InstrumentSnapshot,
  RecordSource,
  StopOrderPlaced,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../../core/record';
import {
  accountCurrencyOf,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_CURRENCY,
  toTradeInput,
} from '../../../core/record';
import { type Ruler, rulerOf } from '../../../core/ruler';
import { reviewSizing } from '../../../core/sizing';
import type {
  ExitOrderType,
  ExitReason,
  LcMove,
  Leg,
  Side,
  Timeframe,
  TimeframeChange,
} from '../../../core/trade';
import { fxFieldVisible } from './currency';
import { fromLocalInput } from './datetime';
import { findInstrument } from './instrument-name';
import { type LegDraft, type LegField, legsChanged, readLegs } from './legs-form';
import { statementPnlWithLegs } from './statement-positions';

export type LcMoveKind = LcMove['kind'];

/** 下書き。文字の欄は打ったまま、選択は未選択 = null */
export interface Draft {
  readonly instrumentName: string;
  readonly side: Side | null;
  readonly entryPrice: string;
  readonly exitPrice: string;
  readonly quantity: string;
  /** 決済の為替（価格の通貨 1 単位 = 口座の通貨。任意。欄が出ているときだけ読む。#47 PR-2） */
  readonly fxRate: string;
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
  /**
   * 逆指値を入れたか（明細の証拠。明細で逆指値と読めたときだけ placed）。本人の答え（未設定）は stopNotPlaced に分けて持ち、
   * 明細の流し込み・削除・読み直しがこの欄を書き換えても本人の答えを消さない。本文の値は stopOrderPlacedOf で決める（C56）
   */
  readonly stopOrderPlaced: StopOrderPlaced;
  /** 逆指値を置いていなかった（LC の欄の行の切り替え「逆指値 未設定」。任意・判定に効かない。C56・#165） */
  readonly stopNotPlaced: boolean;
  /** チャートの時間足（任意。チャートのある枠でだけ選べ、本文に入る。#12） */
  readonly entryChartTimeframe: Timeframe | null;
  readonly exitChartTimeframe: Timeframe | null;
  /** 口座の ID（#47。空 = 既定の口座。直す画面では元の取引の口座。口座が 1 つなら欄を出さない） */
  readonly accountId: string;
  /**
   * オプションのポジションのレッグ（#117・4.7。オプションの形のときだけ読む。記録する画面 = 商品の形がオプションの銘柄、
   * 直す画面 = 元の取引にレッグがある）。オプションの形のときは entryPrice / exitPrice / lc が原資産の価格
   */
  readonly legs: readonly LegDraft[];
  /** 「最大損失まで」（C50。オプションの形で最大損失が定まるときだけ選べる。LC の価格・「なし」と排他） */
  readonly lcMaxLoss: boolean;
  /** LC での損失の見込み（口座の通貨。任意。C49 の (1)・K15） */
  readonly lcLossPlan: string;
  /**
   * 明細から読んだポジションで、オプションの銘柄が一覧に無いときに足す銘柄の乗数（#118。推さない = 本人が入れる）
   */
  readonly instrumentMultiplier: string;
}

export type DraftField = keyof Draft;

/** 空の下書き（3 つのタップ・L / S は既定なし。LC の根拠 = チャートの根拠・決済の理由 = その他。C19） */
export const EMPTY_DRAFT: Draft = {
  instrumentName: '',
  side: null,
  entryPrice: '',
  exitPrice: '',
  quantity: '',
  fxRate: '',
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
  stopNotPlaced: false,
  entryChartTimeframe: null,
  exitChartTimeframe: null,
  accountId: '',
  legs: [],
  lcMaxLoss: false,
  lcLossPlan: '',
  instrumentMultiplier: '',
};

export type DraftAction =
  | {
      [K in DraftField]: { readonly type: 'set'; readonly field: K; readonly value: Draft[K] };
    }[DraftField]
  | { readonly type: 'fill'; readonly values: Partial<Draft> }
  | { readonly type: 'reset'; readonly values?: Partial<Draft> };

/**
 * 下書きの更新。LC の価格を打つと「なし」は外れ、「なし」を選ぶと LC・広げた後の LC は空になる
 * （価格と「なし」が両方ある下書きを作らない）
 */
export function applyDraft(draft: Draft, action: DraftAction): Draft {
  if (action.type === 'reset') return { ...EMPTY_DRAFT, ...(action.values ?? {}) };
  const next: Draft =
    action.type === 'fill'
      ? { ...draft, ...action.values }
      : ({ ...draft, [action.field]: action.value } as Draft);
  const touched = action.type === 'fill' ? action.values : { [action.field]: action.value };
  // 取り消した（置いた逆指値を外した）と未設定（置いていなかった）は同時に持たない（C56・#165 の R4）
  if (touched.lcMove === 'cancelled') return { ...next, stopNotPlaced: false };
  if (touched.stopNotPlaced === true && next.lcMove === 'cancelled')
    return { ...next, lcMove: null };
  if (touched.lcNone === true) return { ...next, lc: '', lcAfter: '', lcMaxLoss: false };
  if (touched.lcMaxLoss === true) return { ...next, lc: '', lcAfter: '', lcNone: false };
  if (typeof touched.lc === 'string' && touched.lc.trim() !== '')
    return { ...next, lcNone: false, lcMaxLoss: false };
  return next;
}

/**
 * LC の価格の欄を止めている選択（#171）。「なし」（C37）か、オプションの「最大損失まで」（#117。optionMode のときだけ）。
 * 止まった欄は薄いまま押せ、押すとその選択を外して価格を入れられる（lcUnlockAction）
 */
export type LcLock = 'none' | 'maxLoss';

export function lcLockOf(draft: Draft, optionMode: boolean): LcLock | null {
  if (draft.lcNone) return 'none';
  if (optionMode && draft.lcMaxLoss) return 'maxLoss';
  return null;
}

/** 止まった LC の欄を押したときの更新。選択のトグルをもう一度押して外したのと同じ（価格は空のまま） */
export function lcUnlockAction(lock: LcLock): DraftAction {
  return lock === 'none'
    ? { type: 'set', field: 'lcNone', value: false }
    : { type: 'set', field: 'lcMaxLoss', value: false };
}

/** 読み取りの文脈: 自分の銘柄の一覧と口座の一覧（資金・許容リスク。#47） */
export interface DraftContext {
  readonly instruments: readonly InstrumentRecord[];
  readonly accounts: readonly AccountRecord[];
  /** チャートのある枠（#12。省けばどちらも無い） */
  readonly charts?: { readonly entry: boolean; readonly exit: boolean };
  /**
   * 直す取引の元の銘柄・口座と、取引に写した値（#9・#47。直す画面だけが渡す）。口座が元と同じなら資金・許容リスクは
   * 写した値のまま、銘柄が元と同じなら銘柄の値も写した値のまま（今の口座・銘柄を引かない。C36。API の update_trade と同じ）。
   * accountId は元の取引の口座（accountId の無い取引は既定の口座）
   */
  readonly base?: {
    readonly instrumentId: string;
    readonly accountId: string;
    readonly snapshot: TradeSnapshot;
    /** 元の取引のレッグ（#117。ある = 直す画面はオプションの形。無い = 前からの取引の形のまま。KEEP-3） */
    readonly legs?: readonly Leg[];
  };
  /**
   * 損益の欄が明細の値のまま（印「読み取り」。#118）。false なら手で足した決済のレッグの損益を足さない（本人が打った・直した
   * 損益に二重に数えない）。省けば明細の値とみなす
   */
  readonly statementPnl?: boolean;
  /**
   * 明細の損益の通貨（読めたときだけ。#118）。その場で足すオプションの銘柄の価格の通貨にする（無ければ口座の通貨）
   */
  readonly statementCurrency?: string;
}

/** 口座が見つからないときの資金・許容リスク・通貨（資金なし・1%・JPY。API の既定の口座の既定と同じ） */
const NO_ACCOUNT = { capitalYen: null, riskTolerancePct: 1, currency: DEFAULT_CURRENCY } as const;

/** 下書きの口座の ID（空 = 直す画面は元の口座、記録する画面は既定の口座） */
export function draftAccountId(draft: Pick<Draft, 'accountId'>, ctx: DraftContext): string {
  if (draft.accountId !== '') return draft.accountId;
  return ctx.base?.accountId ?? DEFAULT_ACCOUNT_ID;
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
  /** 保存した記録から計算できない（検査を通らない形。取り込みなど）。R・リスクの場所に RISK_NOTE.invalid を出す */
  readonly invalid?: true;
  /** LC の物差し（#34。判定の枠の数の後に出す。LC なし・買い増し・計算できないときは無し） */
  readonly ruler?: Ruler;
  /**
   * 数量の比（1R ÷ 許容額）と提案の数量（#67。取引に写した資金・許容リスクで。判定には使わない）。1R・資金・取引の LC
   * が無ければ無し。quantity = 実際の数量（エントリーの数量の合計）。提案の数量はエントリーが 1 つのときだけ
   */
  readonly sizing?: {
    readonly ratio: number;
    readonly quantity: number;
    readonly suggestedQuantity?: number;
  };
  /** 金額（損益・1R）の通貨 = 取引の口座の通貨（#47 PR-2。省いたら JPY） */
  readonly currency?: string;
  /** 明細の損益から逆算した為替（価格の通貨 ≠ 口座の通貨で出せるときだけ。見せるだけ。R6） */
  readonly derivedFx?: number;
  /** オプションのポジション（レッグを持つ取引だけ。#117・5.7） */
  readonly option?: OptionSummary;
}

/** オプションのポジションの判定の枠・詳細に添えるもの（5.7・C47・C49・C50） */
export interface OptionSummary {
  readonly legCount: number;
  /** 1R の出どころ（1R が出たときだけ） */
  readonly oneRSource?: OneRSource;
  readonly maxLoss?: OptionMaxLoss;
  /** LC から決めた向きと満期の損益の比べ方の向きが食い違う（C47。#114 の 2） */
  readonly sideMismatch: boolean;
  /** 「最大損失まで」が効いている（A の注記の文言を替える。#114 の 3） */
  readonly maxLossPlan: boolean;
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
  readonly instrument: {
    readonly name: string;
    readonly matchedId?: string;
    /** 一覧に無い銘柄を足すときの名前以外の欄（明細から読んだポジションのオプションの銘柄。#118） */
    readonly create?: Omit<InstrumentBody, 'name'>;
  };
  readonly preview: Preview;
  /**
   * 通貨と為替（#47 PR-2）: 銘柄の価格の通貨（一覧に無い名前は null）・口座の通貨・為替の欄を出すか・読めた為替。
   * 画面は lib/currency.ts の currencyView で見せ方に直す
   */
  readonly currency?: ReadingCurrency;
  /** オプションの形（#117）のときだけ: レッグの欄の誤り・自動の向き・選べる LC の形 */
  readonly option?: ReadingOption;
}

export interface ReadingOption {
  /** レッグごとの欄の誤り（並びは下書きのレッグと同じ） */
  readonly legErrors: readonly Readonly<Partial<Record<LegField, string>>>[];
  /** 自動で決まった向き（C47。出なければ本人が L / S を選ぶ） */
  readonly autoSide?: Side;
  /** L / S を聞くか（レッグ・建てたときの原資産がそろっても自動の向きが出ないときだけ） */
  readonly askSide: boolean;
  /** 「最大損失まで」を選べるか（レッグがそろい、最大損失が定まる。C50） */
  readonly maxLossSelectable: boolean;
  /**
   * 「LC での損失の見込み」の欄を LC の枠に出すか（売りの裸を含み、見込み以外で 1R が出ない。オーナーの決定 2026-11-21・
   * K15 の例外）。出さないときは「ほかの欄」
   */
  readonly lossPlanUp: boolean;
  /** 直す画面でレッグを直した（明細の損益を本文に入れず、レッグの合計に切り替えた。4.7） */
  readonly legsEdited: boolean;
  /**
   * 明細から読んだポジションで、オプションの銘柄が一覧に無い: この名前で取引の形態 オプションの銘柄を足す（#118。
   * 乗数は本人が入れる）
   */
  readonly newInstrument?: string;
  /** その場で足す銘柄の価格の通貨（明細の損益の通貨か口座の通貨） */
  readonly newInstrumentCurrency?: string;
}

export interface ReadingCurrency {
  readonly price: string | null;
  readonly account: string;
  /** 銘柄の名前が一覧の銘柄に当たったか（当たらない名前を打っている間は建ての通貨を出さない） */
  readonly matched: boolean;
  readonly fxShown: boolean;
  readonly fxRate?: number;
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
  exitPrice: '決済',
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
  fxRate: '為替',
  exitTime: '決済の時刻',
  entryTime: 'エントリーの時刻',
  pnlYen: '損益（明細の値）',
  feeYen: '手数料',
  lc: 'LC',
  lcNone: 'LC',
  lcAfter: '広げた後の LC',
  brokenCondition: '根拠が崩れる条件',
  legs: 'レッグ',
  instrumentMultiplier: '乗数',
  lcMaxLoss: 'LC',
  lcLossPlan: 'LC での損失の見込み',
  lcDecided: 'LC を入る前に決めていたか',
  lcMove: 'LC を動かしたか',
  timeframeChange: '時間足を変えたか',
  lcBasis: 'LC の根拠',
  exitReason: '決済の理由',
  gapSlip: '窓・滑りでしたか',
  source: '入力元',
  exitOrderType: '注文の種類',
  stopOrderPlaced: '逆指値を入れたか',
  stopNotPlaced: '逆指値 未設定',
  entryChartTimeframe: 'エントリー時のチャートの時間足',
  exitChartTimeframe: '決済時のチャートの時間足',
  accountId: '口座',
};

/** 「ほかの欄（任意）」に畳んだ欄（エントリーの時刻は「取引」の枠の任意の欄。#58） */
export const OPTIONAL_FIELDS: readonly DraftField[] = ['pnlYen', 'feeYen', 'lcBasis', 'exitReason'];

export const MSG = {
  notNumber: '数値を入力してください（例: 100.5）',
  notPositive: '0 より大きい数値を入力してください',
  tooLarge: '大きすぎます',
  notNonNegative: '0 以上の数値を入力してください',
  notDateTime: '日時を入力してください',
  entryAfterExit: 'エントリーの時刻は決済の時刻より前にしてください',
  nameInvalid: `${NAME_MAX} 字以内で入力してください（改行・タブは使えません）`,
  brokenConditionInvalid: `${BROKEN_CONDITION_MAX} 字以内で入力してください（改行・タブは使えません）`,
  lcDirection: (side: Side) =>
    side === 'L'
      ? 'ロングの LC はインより下にしてください'
      : 'ショートの LC はインより上にしてください',
  legs: 'レッグの欄に誤りがあります',
  legsTooMany: 'レッグは 10 本までです。1 本を削除してください',
  /** レッグの時刻がポジションの時刻の外（API の outOfPosition を保存の前に止める。4.7・#118） */
  legEntryBefore: 'エントリーの時刻は、最初のレッグのエントリーの時刻以前にしてください',
  legExitAfter: '決済の時刻は、最後のレッグの決済の時刻以後にしてください',
  lcAfterDirection: (side: Side) =>
    side === 'L'
      ? '広げた後の LC は、入る前の LC より下にしてください'
      : '広げた後の LC は、入る前の LC より上にしてください',
} as const;

/** オプションの形の欄の名前（原資産の価格。4.7） */
export const OPTION_LABEL = {
  entryPrice: 'エントリー時の原資産',
  exitPrice: '決済時の原資産',
  lc: 'LC（原資産・「なし」・「最大損失まで」）',
} as const;

export const RISK_NOTE = {
  noLc: 'LC が無いため表示されません',
  noCapital: '資金を設定すると表示されます',
  noOneR: '損益を入力すると表示されます',
  /** 価格の通貨が口座の通貨と違い、為替も損益も無い（F2・U26） */
  noOneRFx: '為替か損益を入力すると表示されます',
  invalid: 'この記録からは計算できません',
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
  const input = toTradeInput(stored);
  // 「最大損失まで」（定まる）は LC の価格を置かない計画で、LC なしではない（C50）
  // オプションで LC を置かなくても見込みの 1R があれば R・リスクを出す（C49 の (1)）
  const noLcPrice = stored.record.lc === undefined && !isMaxLossPlan(input);
  const currency = accountCurrencyOf(stored.snapshot);
  const ev = evaluateTrade(input);
  if (!ev.ok) return { noLc: noLcPrice, invalid: true, riskNote: RISK_NOTE.invalid, currency };
  const noLc = noLcPrice && !(input.option !== undefined && ev.oneRYen !== undefined);
  const option: OptionSummary | undefined =
    input.option === undefined
      ? undefined
      : {
          legCount: input.option.legs.length,
          ...(ev.oneRSource === undefined ? {} : { oneRSource: ev.oneRSource }),
          ...(() => {
            const m = optionMaxLoss(input);
            return m === undefined ? {} : { maxLoss: m };
          })(),
          sideMismatch: optionSideMismatch(input),
          maxLossPlan: isMaxLossPlan(input),
        };
  const fxApplies = fxFieldVisible(stored.snapshot.instrument.priceCurrency, currency);
  const riskNote =
    ev.riskPct !== undefined
      ? undefined
      : noLc
        ? RISK_NOTE.noLc
        : stored.snapshot.capitalYen === null
          ? RISK_NOTE.noCapital
          : fxApplies
            ? RISK_NOTE.noOneRFx
            : RISK_NOTE.noOneR;
  const ruler = rulerOf(input, stored.record.tp);
  // 取引の LC が無い（エントリーごとの LC だけ）取引は、判定の枠（LC なし）と「すべての欄」を揃えて出さない（#67 R1）。
  // オプションのポジションは数量の比・提案の数量を出さない（枚数の組を 1 つの数に縮められない。5.7 の 4。比は後で）
  const sz = noLc || option !== undefined ? undefined : reviewSizing(input);
  const sizing =
    sz === undefined
      ? undefined
      : {
          ratio: sz.ratio,
          quantity: input.entries.reduce((sum, e) => sum + e.quantity, 0),
          ...(sz.suggestedQuantity === undefined
            ? {}
            : { suggestedQuantity: sz.suggestedQuantity }),
        };
  const derivedFx = statementFxRate(input);
  return {
    noLc,
    currency,
    ...(derivedFx === undefined ? {} : { derivedFx }),
    ...(ev.r === undefined ? {} : { r: ev.r }),
    ...(ev.oneRYen === undefined ? {} : { oneRYen: ev.oneRYen }),
    ...(ev.riskPct === undefined ? {} : { riskPct: ev.riskPct }),
    ...(ev.pnlYen === undefined ? {} : { pnlYen: ev.pnlYen }),
    ...(ev.judgment === undefined ? {} : { judgment: ev.judgment }),
    ...(riskNote === undefined ? {} : { riskNote }),
    ...(ruler === undefined ? {} : { ruler }),
    ...(sizing === undefined ? {} : { sizing }),
    ...(option === undefined ? {} : { option }),
  };
}

/**
 * 計算に使う銘柄の値・資金・許容リスク（API の create_trade / update_trade と同じ規則）。
 * 銘柄: base が無ければ（記録する画面）一覧の銘柄（無い名前は既定）。base があれば（直す画面）同じ銘柄 → 取引に写した値 /
 * 別の銘柄 → その銘柄の今の値 / 一覧に無い名前 → 既定の銘柄（C36）。
 * 資金・許容リスク: 選んだ口座（accountId。空 = 既定の口座、直す画面は元の口座）の今の値。直す画面で口座が元と同じなら
 * 取引に写した値のまま（付け替えたときだけ付け替え先の今の値。#47 A4・B7）。一覧に無い口座は資金なし・1%
 */
export function snapshotOf(
  ctx: DraftContext,
  instrument: InstrumentRecord | undefined,
  accountId = '',
): TradeSnapshot {
  const base = ctx.base;
  const acc = draftAccountId({ accountId }, ctx);
  const sameAccount = base !== undefined && acc === base.accountId;
  // 口座の通貨も口座と一緒に写す（元の口座のままなら写した値のまま。移す前の取引は鍵が無い = JPY のまま。#47 PR-2）
  const money: Pick<TradeSnapshot, 'capitalYen' | 'riskTolerancePct' | 'accountCurrency'> =
    sameAccount
      ? {
          capitalYen: base.snapshot.capitalYen,
          riskTolerancePct: base.snapshot.riskTolerancePct,
          ...(base.snapshot.accountCurrency === undefined
            ? {}
            : { accountCurrency: base.snapshot.accountCurrency }),
        }
      : (() => {
          const a = ctx.accounts.find((x) => x.id === acc) ?? NO_ACCOUNT;
          return {
            capitalYen: a.capitalYen,
            riskTolerancePct: a.riskTolerancePct,
            accountCurrency: a.currency || DEFAULT_CURRENCY,
          };
        })();
  if (base && instrument?.id === base.instrumentId) {
    const { capitalYen: _c, riskTolerancePct: _r, accountCurrency: _a, ...rest } = base.snapshot;
    return { ...rest, ...money };
  }
  const i = instrument ?? DEFAULT_INSTRUMENT;
  return {
    instrument: {
      multiplier: i.multiplier,
      quantityStep: i.quantityStep,
      priceCurrency: i.priceCurrency,
      underlyingKind: i.underlyingKind,
      productForm: i.productForm,
    },
    ...money,
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
  // 明細から読んだポジションで、名前がどの銘柄にも当たらない: 取引の形態 オプションの銘柄として足す（乗数は本人が入れる。
  // 価格の通貨は口座の通貨。#118）
  const newOption =
    ctx.base === undefined &&
    matched === undefined &&
    name !== '' &&
    errors.instrumentName === undefined &&
    draft.legs.some((l) => l.read !== undefined);
  const newMultiplier = newOption
    ? num(
        'instrumentMultiplier',
        draft.instrumentMultiplier,
        'positive',
        FIELD_LABEL.instrumentMultiplier,
      )
    : undefined;
  const newCurrency =
    ctx.statementCurrency ??
    (ctx.accounts.find((a) => a.id === draftAccountId(draft, ctx))?.currency || DEFAULT_CURRENCY);
  const pending: InstrumentRecord | undefined = newOption
    ? {
        id: '',
        name,
        underlyingKind: 'other',
        productForm: 'option',
        priceCurrency: newCurrency,
        multiplier: newMultiplier ?? 1,
        quantityStep: 1,
        createdAt: 0,
        updatedAt: 0,
      }
    : undefined;
  const snapshot = snapshotOf(ctx, matched ?? pending, draft.accountId);
  // オプションの形（#117）: 記録する画面は商品の形がオプションの銘柄、直す画面は元の取引にレッグがあるとき
  // （レッグの無い前からの取引は今の形のまま。レッグを足す PUT は API が受けない。4.7）
  const optionMode =
    ctx.base !== undefined
      ? ctx.base.legs !== undefined
      : snapshot.instrument.productForm === 'option';

  // 取引の欄（オプションの形では向きは自動・数量は聞かない（本文は 1）・イン / 決済は原資産。C47・4.7）
  let sideChoice = draft.side;
  if (sideChoice === null && !optionMode) missing.push(MISSING_LABEL.side);
  const entry = num(
    'entryPrice',
    draft.entryPrice,
    'positive',
    optionMode ? OPTION_LABEL.entryPrice : MISSING_LABEL.entryPrice,
  );
  const exit = num(
    'exitPrice',
    draft.exitPrice,
    'positive',
    optionMode ? OPTION_LABEL.exitPrice : MISSING_LABEL.exitPrice,
  );
  const quantity = optionMode
    ? 1
    : num('quantity', draft.quantity, 'positive', MISSING_LABEL.quantity);

  let exitTime: number | undefined;
  if (draft.exitTime.trim() === '') missing.push(MISSING_LABEL.exitTime);
  else {
    exitTime = fromLocalInput(draft.exitTime.trim());
    if (exitTime === undefined) errors.exitTime = MSG.notDateTime;
  }

  // LC（価格か「なし」のどちらか。C37。オプションの形は「最大損失まで」も。C50）
  const lcNone = draft.lcNone;
  const maxLossChosen = optionMode && draft.lcMaxLoss && !lcNone;
  let lc: number | undefined;
  if (!lcNone && !maxLossChosen) {
    lc = num('lc', draft.lc, 'positive', optionMode ? OPTION_LABEL.lc : MISSING_LABEL.lc);
  }

  // レッグ（オプションの形だけ）と自動の向き（C47）
  const legsRead = optionMode ? readLegs(draft.legs) : undefined;
  let option: ReadingOption | undefined;
  let maxLossOn = false;
  if (legsRead) {
    missing.push(...legsRead.missing);
    if (legsRead.tooMany) errors.legs = MSG.legsTooMany;
    else if (legsRead.errors.some((e) => Object.keys(e).length > 0)) errors.legs = MSG.legs;
    const legs = legsRead.legs;
    const mult = snapshot.instrument.multiplier;
    const maxLossSelectable = legs !== undefined && maxLossPrice(legs, mult).defined;
    // 「最大損失まで」は定まるときだけ効く。レッグを直して定まらなくなったら LC を選び直す（4.7）
    maxLossOn = maxLossChosen && (legs === undefined || maxLossSelectable);
    if (maxLossChosen && !maxLossOn) missing.push(OPTION_LABEL.lc);
    const autoSide =
      legs === undefined || entry === undefined
        ? undefined
        : lc !== undefined
          ? optionSideFromLc(entry, lc)
          : maxLossOn || lcNone
            ? sideFromExpiry(legs, mult, entry)
            : undefined;
    const ready =
      legs !== undefined && entry !== undefined && (lc !== undefined || maxLossOn || lcNone);
    const askSide = ready && autoSide === undefined;
    sideChoice = autoSide ?? (askSide ? draft.side : null);
    if (askSide && sideChoice === null) missing.push(MISSING_LABEL.side);
    const m = legs === undefined ? undefined : maxLossPrice(legs, mult);
    const naked = m !== undefined && !m.defined && m.cause === 'unbounded';
    const base = ctx.base?.legs;
    option = {
      legErrors: legsRead.errors,
      ...(autoSide === undefined ? {} : { autoSide }),
      askSide,
      maxLossSelectable,
      lossPlanUp: naked,
      legsEdited: base !== undefined && legs !== undefined && legsChanged(base, legs),
      ...(newOption ? { newInstrument: name, newInstrumentCurrency: newCurrency } : {}),
    };
  }
  const side = sideChoice;
  if (lc !== undefined && side !== null && entry !== undefined) {
    const ok = side === 'L' ? lc < entry : lc > entry;
    if (!ok) {
      errors.lc = MSG.lcDirection(side);
      lc = undefined;
    }
  }

  // 崩れの条件の一言（任意）
  const brokenCondition = draft.brokenCondition.trim();
  if (lengthOf(brokenCondition) > BROKEN_CONDITION_MAX || hasBadChar(brokenCondition)) {
    errors.brokenCondition = MSG.brokenConditionInvalid;
  }

  // 3 つのタップ（「なし」のときは決めていたか・動かしたかを聞かない。「最大損失まで」は動かしたかを聞かない。5.7 の 5・#114 の 1）
  if (!lcNone) {
    if (draft.lcDecided === null) missing.push(MISSING_LABEL.lcDecided);
    if (draft.lcMove === null && !maxLossOn) missing.push(MISSING_LABEL.lcMove);
  }
  if (draft.timeframeChange === null) missing.push(MISSING_LABEL.timeframeChange);

  // 広げた後の LC（任意。「広げた」のときだけ）
  let lcAfter: number | undefined;
  if (!lcNone && !maxLossOn && draft.lcMove === 'widened') {
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
  // 直す画面でレッグを直したら明細の損益はどのレッグの分か分からなくなるので、レッグの合計に切り替える（4.7）
  let pnlYen = option?.legsEdited ? undefined : num('pnlYen', draft.pnlYen, 'signed');
  const feeYen = num('feeYen', draft.feeYen, 'nonNegative');
  // LC での損失の見込み（任意・オプションの形だけ。「最大損失まで」とは同時に持たない。C49・C50）
  const lcLossPlanYen =
    optionMode && !maxLossOn ? num('lcLossPlan', draft.lcLossPlan, 'positive') : undefined;

  // チャートの時間足（チャートのある枠の、選んだものだけ。R2・R4）
  const entryChartTimeframe = ctx.charts?.entry ? draft.entryChartTimeframe : null;
  const exitChartTimeframe = ctx.charts?.exit ? draft.exitChartTimeframe : null;

  const underlying = name.replace(/オプション$/u, '').trim();
  const instrument = {
    name,
    ...(matched ? { matchedId: matched.id } : {}),
    ...(newOption && newMultiplier !== undefined
      ? {
          create: {
            productForm: 'option' as const,
            multiplier: newMultiplier,
            priceCurrency: newCurrency,
            ...(underlying === '' || underlying === name ? {} : { underlying }),
          },
        }
      : {}),
  };

  // 為替（任意。価格の通貨 ≠ 口座の通貨のときだけ欄を出し、読む。0 以下・数でない は誤り。F12）
  const fxShown = fxVisibleOf(snapshot);
  const fxRate = fxShown ? num('fxRate', draft.fxRate, 'positive') : undefined;

  // 明細から作ったポジション（#118）: 手で足した決済のレッグの損益を明細の損益に足す。明細のレッグが欠けた・満期で消滅にした、
  // 為替が要るのに無いときは明細の損益を空にしてレッグの合計に切り替える（4.7）
  const readLegsOk = legsRead?.legs;
  if (
    option !== undefined &&
    readLegsOk !== undefined &&
    !option.legsEdited &&
    ctx.statementPnl !== false
  ) {
    const sameCurrency =
      snapshot.instrument.priceCurrency !== null &&
      snapshot.instrument.priceCurrency === accountCurrencyOf(snapshot);
    const r = statementPnlWithLegs(
      pnlYen,
      draft.legs,
      readLegsOk,
      snapshot.instrument.multiplier,
      sameCurrency ? 1 : fxRate,
    );
    pnlYen = r.pnl;
    if (r.dropped) option = { ...option, legsEdited: true };
  }
  // レッグの時刻はポジションの建てた時刻〜決済した時刻の範囲（満期で消えたレッグの決済は見ない。API の outOfPosition。4.7）
  if (readLegsOk !== undefined) {
    const opened = readLegsOk.map((l) => l.entry.time).filter((t): t is number => t !== undefined);
    const closed = readLegsOk
      .filter((l) => l.exit.kind === 'closed')
      .map((l) => l.exit.time)
      .filter((t): t is number => t !== undefined);
    if (entryTime !== undefined && opened.some((t) => t < entryTime)) {
      errors.entryTime = MSG.legEntryBefore;
    }
    if (exitTime !== undefined && !errors.exitTime && closed.some((t) => t > exitTime)) {
      errors.exitTime = MSG.legExitAfter;
    }
  }
  // 口座が 2 つ以上のときだけ本文に口座を入れる（1 つなら今と同じ本文。KEEP-3）
  const accountId = ctx.accounts.length >= 2 ? draftAccountId(draft, ctx) : undefined;
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
    const move: LcMove =
      lcNone || maxLossOn
        ? { kind: 'none' }
        : taps.lcMove === 'widened'
          ? { kind: 'widened', ...(lcAfter === undefined ? {} : { after: lcAfter }) }
          : { kind: taps.lcMove };
    return {
      status: 'closed',
      source: draft.source,
      ...(accountId === undefined ? {} : { accountId }),
      side: s,
      ...(lc === undefined ? {} : { lc }),
      ...(brokenCondition === '' ? {} : { brokenCondition }),
      lcBasis: draft.lcBasis,
      // 「LC なし」「最大損失まで」の間は切り替えを出さないので、見えない未設定を送らない（下書きには残し、外したら戻る。#165 のレビュー 1）
      stopOrderPlaced: stopOrderPlacedOf({
        ...draft,
        lcMove: move.kind,
        stopNotPlaced: draft.stopNotPlaced && !lcNone && !draft.lcMaxLoss,
      }),
      lcDecidedBeforeEntry: lcNone ? false : taps.lcDecided,
      lcMove: move,
      timeframeChange: taps.timeframeChange,
      entries: [
        { price: en, quantity: q, ...(entryTime === undefined ? {} : { time: entryTime }) },
      ],
      // 注文の種類は明細の証拠だけ（手の記録は「不明」のまま。手で選んだ「逆指値」は証拠にならない。C26）。
      // レッグを持つ取引はレッグの決済の時点から導く（満期で消えた売りなら満期（SQ）。C54）
      exit: {
        time: xt,
        price: ex,
        ...(fxRate === undefined ? {} : { fxRate }),
        orderType: legs ? positionExitOrderType(legs, draft.exitOrderType) : draft.exitOrderType,
        reason: draft.exitReason,
        gapSlip: taps.gapSlip,
      },
      ...(pnlYen === undefined ? {} : { statementPnlYen: pnlYen }),
      fees: feeYen === undefined ? [] : [{ amountYen: feeYen }],
      ...(entryChartTimeframe === null ? {} : { entryChartTimeframe }),
      ...(exitChartTimeframe === null ? {} : { exitChartTimeframe }),
      ...(legs ? { legs } : {}),
      ...(legs && maxLossOn ? { riskPlan: 'maxLoss' as const } : {}),
      ...(legs && lcLossPlanYen !== undefined ? { lcLossPlanYen } : {}),
    };
  };
  const legs = legsRead?.legs;
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
    (lcNone || maxLossOn || lc !== undefined) &&
    (!optionMode || legs !== undefined);

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
      // タップの前でも R・1R・リスクは出す（タップに依存しない。判定・理由と LC の物差しは出さない）
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
      const { judgment: _hidden, ruler: _notYet, ...nums } = s;
      preview = { ...nums, showGapSlip: false };
    }
  }

  const canSave = body !== undefined;
  const currency: ReadingCurrency = {
    price: snapshot.instrument.priceCurrency,
    account: accountCurrencyOf(snapshot),
    matched: matched !== undefined,
    fxShown,
    ...(fxRate === undefined ? {} : { fxRate }),
  };
  return {
    errors,
    missing,
    canSave,
    ...(body === undefined ? {} : { body }),
    instrument,
    preview,
    currency,
    ...(option === undefined
      ? {}
      : {
          option: {
            ...option,
            // 見込み以外（実際の動きから・満期の損益から）で 1R が出たら「ほかの欄」のまま
            lossPlanUp:
              option.lossPlanUp &&
              preview.option?.oneRSource !== 'actualMove' &&
              preview.option?.oneRSource !== 'expiry',
          },
        }),
  };
}

/** 為替の意味を決める通貨の組（銘柄の価格の通貨 / 口座の通貨。#47 PR-2）。matched = 銘柄の名前が一覧の銘柄に当たった */
export interface FxPair {
  readonly price: string | null;
  readonly account: string;
  readonly matched: boolean;
}

export function fxPairOf(
  draft: Pick<Draft, 'instrumentName' | 'accountId'>,
  ctx: DraftContext,
): FxPair {
  const name = draft.instrumentName.trim();
  const inst = name === '' ? undefined : findInstrument(name, ctx.instruments);
  const snap = snapshotOf(ctx, inst, draft.accountId);
  return {
    price: snap.instrument.priceCurrency,
    account: accountCurrencyOf(snap),
    matched: inst !== undefined,
  };
}

/**
 * 為替が意味を失う移りか（為替は「価格の通貨 1 単位 = 口座の通貨」）。口座の通貨が変わる、または決まった価格の通貨どうしが
 * 違う（USD → EUR）ときだけ。価格の通貨が未設定 → 決まった通貨（取り込んだ取引に価格の通貨を入れた）は、未設定の銘柄の為替も
 * 同じ意味で使っているので失わない。銘柄の名前を打っている途中（一覧に当たらない）では、価格の通貨では判定しない
 * （#47 PR-2 の再レビュー 1・2。resnapshot.ts の withoutStaleFx と同じ規則）
 */
export function fxStale(
  basis: Pick<FxPair, 'price' | 'account'>,
  now: Pick<FxPair, 'price' | 'account'> & { readonly matched?: boolean },
): boolean {
  if (basis.account !== now.account) return true;
  if (now.matched === false) return false;
  return basis.price !== null && now.price !== null && basis.price !== now.price;
}

/**
 * 基準の組を当たった銘柄の組で詰める。決まっている価格の通貨を未設定で上書きしない（USD → 未設定の銘柄 → EUR で
 * USD の為替を EUR に持ち込まない。#47 PR-2 の 3 回目の再レビュー 1）
 */
export function refineFxBasis(basis: FxPair, now: FxPair): FxPair {
  if (!now.matched) return basis;
  return { ...now, price: now.price ?? basis.price };
}

/**
 * 打った為替の基準の組を、今の組に合わせて進める（記録する画面）。basis = 為替を打ったときの組（打っていなければ null）。
 * 組が意味を失う移りなら為替を空にして基準を外し、そうでなければ当たった銘柄の組で基準を詰める（未設定 → USD など）
 */
export function applyFxRule(
  next: Draft,
  basis: FxPair | null,
  now: FxPair,
): { readonly draft: Draft; readonly basis: FxPair | null } {
  if (next.fxRate === '' || basis === null)
    return { draft: next, basis: next.fxRate === '' ? null : basis };
  if (fxStale(basis, now)) return { draft: { ...next, fxRate: '' }, basis: null };
  return { draft: next, basis: refineFxBasis(basis, now) };
}

/** 取引に写す値で、為替の欄を出すか（銘柄の価格の通貨が決まっていて口座の通貨と違う） */
export function fxVisibleOf(
  snapshot: Pick<TradeSnapshot, 'instrument' | 'accountCurrency'>,
): boolean {
  return fxFieldVisible(snapshot.instrument.priceCurrency, accountCurrencyOf(snapshot));
}

/** LC を動かしたかの選択肢の文言（L / S で同じ。#56） */
export function lcMoveLabel(kind: LcMoveKind): string {
  if (kind === 'none') return 'そのまま';
  if (kind === 'tightened') return '狭めた';
  if (kind === 'cancelled') return '取消';
  return '広げた';
}

/**
 * 本文の「逆指値を入れたか」（C56・#165）: 本人の未設定 → notPlaced / 取り消した（置いた逆指値を外した）か明細の逆指値 →
 * placed / ほか → unanswered（不明を未設定にしない。C26）
 */
export function stopOrderPlacedOf(
  d: Pick<Draft, 'stopNotPlaced' | 'stopOrderPlaced'> & { readonly lcMove: LcMoveKind | null },
): StopOrderPlaced {
  if (d.stopNotPlaced) return 'notPlaced';
  if (d.lcMove === 'cancelled' || d.stopOrderPlaced === 'placed') return 'placed';
  return 'unanswered';
}
