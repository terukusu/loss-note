// 記録する画面の通信と状態（Issue #13 契約 R-3）。DOM を持たず、画面（pages/Record.tsx）は購読して描くだけ。
// - 開いたら取引・銘柄・口座を並行に読み、既定（最後に記録した取引の銘柄・数量・口座、決済の時刻 = 開いた時刻）を入れる
//   （AC-9・#47 R4）
// - 口座（#47）: 口座が 2 つ以上なら下書きの口座で資金・許容リスクを決める（本文にも入れる）。その場で足す（名前 + 資金の
//   2 欄。POST /api/accounts）と、足した口座を一覧に足して選ぶ。ほかの欄・明細・チャートは触らない。送っている間は
//   保存しない（帯の文「口座を足しています」）
// - 保存は 1 回押して 1 件（実行中は同じ Promise を返す。AC-10）。銘柄は一覧に同じ名前（nameKey）があればその ID、
//   無ければ名前だけで足す（既定は API が埋める。C21）。409 なら一覧を取り直して照合する
// - 失敗は決まった文言だけを状態に置く（応答の本文・例外の文字列を持たない = 画面に反射しない）。
//   401・ログインしていない = ログインが切れた / 時間切れ・通信の失敗 = つながらない / ほか = 保存できなかった
// - 要求には時間の上限を置く。保存の要求が時間切れ・通信の失敗になったときは、API に届いて保存された可能性がある。
//   API に冪等のための ID は無いので、次に押したときはまず取引の一覧を読み、同じ本文の取引があれば
//   それを保存した取引として扱い、送り直さない（二重に保存しない）
// - 下書き・取引の値は記憶の中だけ。Web Storage・IndexedDB に触れない（AC-11）。画面を離れても、入力があれば殻の
//   書きかけの置き場（drafts.ts。#75）がこの controller ごと同じタブの記憶に残す
// - 決済明細の読み取り（#15）: readImage で画像を描き直して（差し込まれた prepare。DOM はここに来ない）
//   POST /api/statement-reads に送り、応答の行を下書きに流し込む（statement-fill.ts）。読み取り中も入力でき、
//   保存の門（gateReading）で読み取り中・時間帯の未確認は保存しない。新しい読み取り・やめた・画面を離れた（dispose）は
//   世代を進めて要求を止め、古い応答は捨てる。画像のプレビューは保存の後・やめた・離れたで close して参照を捨てる。
//   画像・読み取りの値も記憶の中だけ（端末の保存先・URL・履歴に書かない）
// - 根拠の足のチャート（#12）: setChart で枠ごとに画像を描き直してプレビューを出すだけ（送らない）。[記録する] で
//   取引と一緒に 1 要求（multipart。時間の上限 30 秒）で送る。描き直し中は保存しない。差し替え・外すとその枠の時間足は
//   空に戻る（選び直し）。保存の後・明細の次の行・画面を離れたらプレビューを close して捨てる。保存の失敗では残す。
//   チャートの画像も記憶の中だけ
// - チャートの時間足の読み取り（#27）: 枠の画像が使えるようになったら追加の操作なしで POST /api/chart-reads に送り、
//   枠の時間足が空で利用者が触っていなければ読んだ値で埋めて印を付ける（chart-read.ts）。利用者が違う値を選んでいれば
//   上書きせず「チャートからは … と読めました」と 1 タップで直せる案を出す。AI の読み取りは 1 つずつ送る（明細が先、
//   チャートはその後に枠の順。同時の予約と CPU の取り合いを減らす。ADR-0015）。読み取り中も [記録する] は押せ、
//   記録した時点で終わっていない読み取りは止めて結果を捨てる（時間足は任意の欄）。差し替え・外す・離れたでも止める。
//   失敗は決まった文言で知らせ、欄は空のまま
// - 読み取りの準備（#65・#99 の続き）: warmRead なら、開いたとき・明細の読み取りが API に届いた後（先立ては 1 回で
//   捨てるので次の 1 枚のために立て直す）・画面に戻ったとき（refreshWarm。前に送ってから WARM_REFRESH_MS 以上）に
//   POST /api/statement-reads/prepare を送る。重ねて送らない（読み取りの後に送っている間だったら、終わってから 1 回
//   だけ送り直す）。AI を呼ばず、失敗は画面に出さない。離れた（dispose）後は送らない。書きかけを残して画面の外に
//   いる間（setOnScreen(false)。#75）も送らず、そのあいだに送り直せなかった分は戻ったとき（refreshWarm）に間を置かず送る

import {
  type AccountRecord,
  accountIdOf,
  type InstrumentBody,
  type InstrumentRecord,
  type StoredTrade,
  type TradeRecord,
} from '../../../core/record';
import type { Timeframe } from '../../../core/trade';
import {
  ACCOUNT_ADDING,
  ACCOUNT_MSG,
  type AccountField,
  type AccountReading,
  accountNameOf,
  defaultAccountId,
  EMPTY_NEW_ACCOUNT,
  type NewAccountDraft,
  readNewAccountDraft,
  sortAccounts,
} from './accounts';
import { CHART_READ_MSG } from './chart-read';
import {
  CHART_MSG,
  type ChartPhase,
  type ChartSlots,
  type ChartSlotsChange,
  type ChartState,
  type ChartsState,
  createChartSlots,
} from './chart-slots';
import {
  type AnySlot,
  CHART_TIMEFRAME_FIELD,
  type ChartSlot,
  chartSaveTimeoutMs,
  EXTRA_FULL,
  type ExtraEntry,
  type ExtraSlot,
  extraNoteErrors,
  extraNoteTooLong,
  extrasBody,
  tradeFormData,
} from './charts';
import { accountCurrencyIn } from './currency';
import { floorToMinute, toLocalInput } from './datetime';
import { formatPlain } from './format';
import { nameKey as nameKeyOf } from './instrument-name';
import { resolveInstrument as resolveInstrumentId } from './instrument-resolve';
import {
  applyDraft,
  applyFxRule,
  type Draft,
  type DraftAction,
  type DraftContext,
  type DraftField,
  type DraftReading,
  EMPTY_DRAFT,
  type FxPair,
  fxPairOf,
  readDraft,
  type Summary,
  summarize,
} from './record-form';
import type { RecordStage } from './record-screen';
import {
  type ApiFn,
  AUTH_EXPIRED,
  createRequest,
  Failed,
  type FailureKind,
  getJson,
  JSON_HEADERS,
  kindOf,
  REQUEST_TIMEOUT_MS,
} from './request';
import {
  learnedAccountId,
  pnlFillOf,
  profilePath,
  type StatementProfile,
  suggestedAccount,
} from './statement-account';
import {
  type FieldMark,
  type Filled,
  fillFromRow,
  gateReading,
  type Marks,
  markEdited,
  parseReadResponse,
  READ_FIELDS,
  READ_MSG,
  type ReadRow,
  readFailureOf,
  refillMoney,
  rowLabel,
} from './statement-fill';
import type { PrepareResult, PreviewHandle } from './statement-image';
import {
  gatePosition,
  hasPositions,
  initialUnits,
  legsWithZone,
  mergeNext,
  nextPositionIndex,
  optionInstrumentName,
  splitUnit,
  syncExpiry,
  type Unit,
  unitLegs,
  unitRows,
} from './statement-positions';
import { type KeptAnswer, restoreStatement, stripStatement } from './statement-remove';
import {
  applyZone,
  isOtherZone,
  type TzField,
  type TzId,
  tzFieldsOf,
  unapplyZone,
} from './statement-tz';
import { DELIVERED_LIMIT, tradesPath } from './trade-pages';
import { CHART_PREPARING } from './verdict-notes';

export type { ApiFn, FailureKind };
export { AUTH_EXPIRED, REQUEST_TIMEOUT_MS };

export const LOAD_FAILED =
  '記録の準備ができませんでした。通信状況を確認して、再読み込みしてください。';
export const SAVE_FAILED =
  '保存できませんでした。入力内容は残っています。もう一度 [記録する] を押してください。';
export const NETWORK_FAILED =
  '通信できませんでした。入力内容は残っています。もう一度 [記録する] を押してください（二重には保存されません）。';

/** 読み取りの要求の時間の上限（API の締め切り 20 秒 + 後始末 約 5 秒 + 余裕。R3） */
export const READ_TIMEOUT_MS = 30_000;
export const READ_PATH = '/api/statement-reads';
/** 読み取りの準備（#65）: 開いたときに 1 回送り、API が明細の読み取りの CLI を先に立てる。応答は使わない */
export const READ_PREPARE_PATH = '/api/statement-reads/prepare';
/** 準備の要求の時間の上限（API が待つ上限 = 立ち上がり 20 秒 + 静まり 5 秒（#99）より長く、Cloud Run・gunicorn の 60 秒より短い） */
export const READ_PREPARE_TIMEOUT_MS = 30_000;
/**
 * 画面に戻ったときに準備を送り直す間隔（#99 の続き）。API の先立ては作ってから 10 分で捨てられ、インスタンスも
 * 使われなければ止まる。生きている先立てがあれば API はすぐ返す（AI を呼ばない）ので、短く取ってタブの行き来だけを間引く
 */
export const WARM_REFRESH_MS = 60_000;

/** 明細の読み取りの応答が AI へ送った後のものか（200 と、503 を除く 5xx。#99 の続き） */
export function sentToAi(status: number): boolean {
  return status === 200 || (status >= 500 && status !== 503);
}

/**
 * 画面に戻った（見えるようになった）ときに onVisible を呼ぶつなぎ（#99 の続き）。target は document、
 * isVisible は document.visibilityState === 'visible'。返す関数で外す（画面を離れたとき）
 */
export function watchVisible(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  isVisible: () => boolean,
  onVisible: () => void,
): () => void {
  const fn = () => {
    if (isVisible()) onVisible();
  };
  target.addEventListener('visibilitychange', fn);
  return () => target.removeEventListener('visibilitychange', fn);
}
export const ROWS_DONE = '明細のすべての行を確認しました';
/** 「行目」か「件目」（オプションのポジションを含む明細は取引とポジションを合わせて数える。#118） */
type RowUnit = '行目' | '件目';
const nextWord = (unit: RowUnit) => (unit === '件目' ? '取引' : '行');
export const rowSaved = (index: number, total: number, unit: RowUnit = '行目') =>
  `${rowLabel(index, total, unit)}を記録しました。次の${nextWord(unit)}（${index + 2} / ${total}）です`;
export const rowSkipped = (index: number, total: number, unit: RowUnit = '行目') =>
  `${rowLabel(index, total, unit)}をスキップしました。次の${nextWord(unit)}（${index + 2} / ${total}）です`;
/** [別のポジションにする]・［このポジションに入れる］ の後の知らせ（#118） */
export const POSITION_SPLIT = (next: number, total: number) =>
  `レッグを別のポジションにしました。次の取引（${next} / ${total}）で記録します`;
export const POSITION_MERGED = (legs: number) => `次のポジションのレッグ ${legs} 本を入れました`;

/** 明細の行の数え方 */
export function rowUnitOf(st: Pick<StatementState, 'rows'>): RowUnit {
  return hasPositions(st.rows) ? '件目' : '行目';
}
/** チャートつきの保存の時間の上限（画像 2 枚で約 1 MB を送る） */
export const CHART_SAVE_TIMEOUT_MS = 30_000;
export type { ChartPhase, ChartState, ChartsState };
export { CHART_MSG, CHART_PREPARING, EXTRA_FULL };
/** 前の保存が届いたか分からない間は枠を変えない（次の [記録する] は届いた取引を探すので、変えた枠が送られない） */
export const CHART_LOCKED =
  '前回の記録が保存されたか確認できていません。チャートを変更する前に、もう一度 [記録する] を押してください。';
/** その場で足す口座の失敗（足す欄の中の知らせ。欄の値は残る。U8） */
export const ACCOUNT_ADD_FAILED = '口座を追加できませんでした。もう一度 [追加] を押してください。';
export const ACCOUNT_ADD_NETWORK_FAILED =
  '通信できませんでした。もう一度 [追加] を押してください（二重には追加されません）。';
export { ACCOUNT_ADDING };
export const READ_BLOCKED = {
  notReady: '記録の準備ができてから、もう一度貼り付けてください。',
  saving: '記録しています。終わってから、もう一度貼り付けてください。',
} as const;

export type RecordPhase = 'loading' | 'loadFailed' | 'editing' | 'saving' | 'saved';

/** 明細の読み取りの段階: 描き直し中 / 読み取り中 / 行を確かめている / 失敗 / 行を最後まで見た */
export type StatementPhase = 'preparing' | 'reading' | 'ready' | 'failed' | 'done';

export interface StatementState {
  readonly phase: StatementPhase;
  /**
   * 記録する単位の行（phase = ready のとき 1 行以上）。先物の行は応答の行のまま、オプションの行はポジションのまとまりごとの
   * 合成の行（statement-positions.ts の unitRow。#118）
   */
  readonly rows: readonly ReadRow[];
  /** 応答の行そのもの（#118。まとめ直しに使う。phase = ready のとき） */
  readonly raw?: readonly ReadRow[];
  /** まとまり（応答の行の番号の並び。rows と同じ並び。#118） */
  readonly units?: readonly Unit[];
  /** 今の行の番号（0 から） */
  readonly index: number;
  /** 欄の印 */
  readonly marks: Marks;
  /** 失敗の決まった文言（phase = failed のとき。ログインが切れたときは null で、error に出す） */
  readonly message: string | null;
  /** 知らせ（「1 / 3 行目を記録しました」など） */
  readonly notice: string | null;
  /** 送るものと同じ画像のプレビュー（記憶の中だけ） */
  readonly preview: PreviewHandle | null;
  /**
   * 覚えの無い明細で、本人がまだ口座を選んでいない（口座の欄の下に「この明細の口座を選んでください。次から自動で
   * 選びます」。#66 デザイン 1）。本人が口座を選ぶ・追加すると false
   */
  readonly firstTime?: boolean;
  /** 明細に時間帯の書かれていない時刻があった（#58 の後半）。無ければ省く */
  readonly tz?: TzState;
  /**
   * 別の明細の読み直しが失敗・キャンセルで終わり、この明細（選ぶ前の明細）に戻した（#184 R6）。失敗は決まった文言。次の読み取り・
   * 削除・次の行で外す
   */
  readonly reverted?: StatementReverted;
  /** 別の明細の読み直しの途中（キャンセル・失敗で前の明細に戻る。#184。読み取り中の文を「別の明細を読み取り中…」に） */
  readonly rereading?: true;
}

/** 読み直しをやめて前の明細に戻した理由（#184 R6） */
export type StatementReverted =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' };

/** 時間帯の確かめ（#58 の後半・statement-tz.ts） */
export interface TzState {
  /** この行で時間帯が書かれていなかった欄 */
  readonly fields: readonly TzField[];
  /** 選んだ（覚えた）時間帯。まだ選んでいなければ null */
  readonly choice: TzId | null;
  /**
   * 覚えた時間帯（またはこの明細の前の行で選んだ時間帯）で最初から入れた。gap があるときは入れておらず、その時間帯では
   * 存在しない時刻だったことを示す
   */
  readonly remembered: boolean;
  /** [ほかのタイムゾーン…] を開いている */
  readonly otherOpen: boolean;
  /** その時間帯に無い時刻だった（夏時間の切り替え）。理由の 1 行に出す */
  readonly gap: TzId | null;
}

/**
 * 明細の状態の写し（#184。削除の ［元に戻す］ と読み直しの戻り先）: 直前の下書き・明細から来たものを取り除いた下書き・明細
 * （画像ごと）・明細ごとの記憶。記憶の中だけ
 */
interface StatementSnap {
  readonly before: Draft;
  readonly stripped: Draft;
  readonly statement: StatementState;
  readonly touched: ReadonlySet<DraftField>;
  readonly profile: StatementProfile | null;
  readonly accountTouched: boolean;
  readonly learnedInStatement: boolean;
  readonly statementSaved: StoredTrade[];
  readonly statementZone: TzId | null;
  readonly fxBasis: FxPair | null;
  readonly autoAccount: { readonly from: string; readonly to: string } | null;
}

/** 端末に覚えた時間帯（画面が zone-memory.ts で作る。テストは偽物。書くのは時間帯の ID だけ） */
export interface ZoneMemory {
  read(): TzId | null;
  write(id: TzId): void;
}

export interface SavedView {
  readonly trade: StoredTrade;
  readonly instrumentName: string;
  readonly summary: Summary;
  /** 保存した取引の口座の名前と、保存したときの口座の数（「口座 A に記録しました」。U11） */
  readonly accountName: string;
  readonly accountCount: number;
  /** 明細の特徴を覚えた（覚えが無かった・覚えと違う口座で記録した。口座 2 つ以上のときだけ。#66 デザイン 5） */
  readonly learned?: boolean;
  /**
   * 保存の後のシートで心理を付ける取引（#156 R4。1 件の記録なら [trade]、複数行の明細なら同じ明細から保存した行すべて。
   * 保存の順）。controller は常に入れる（任意なのは、手で組む SavedView の形を変えないため。無ければ [trade]）
   */
  readonly trades?: readonly StoredTrade[];
}

/** その場で足す口座の欄（開いている間だけ。#47 B5・U5〜U9） */
export interface AddAccountState {
  readonly draft: NewAccountDraft;
  /** 欄の誤り（名前が空の誤りは [足す] を押した後だけ） */
  readonly errors: AccountReading<unknown>['errors'];
  readonly saving: boolean;
  /** 通信の失敗の文言（欄の中の知らせ） */
  readonly message: string | null;
  /** ログインが切れた */
  readonly auth?: true;
}

export interface RecordState {
  readonly phase: RecordPhase;
  readonly draft: Draft;
  readonly instruments: readonly InstrumentRecord[];
  /** 口座（名前の順。#47） */
  readonly accounts: readonly AccountRecord[];
  /** その場で足す口座の欄（開いているときだけ） */
  readonly addAccount?: AddAccountState;
  /** 今の下書きの読み取り（誤り・足りない欄・プレビュー） */
  readonly read: DraftReading;
  /** 読み込み・保存の失敗の文言（決まった文言だけ） */
  readonly error: string | null;
  /** 失敗の種類（ログインし直す案内を出すか） */
  readonly errorKind?: FailureKind;
  /** 保存した取引とその判定（phase = saved のとき） */
  readonly saved?: SavedView;
  /** 決済明細の読み取り（貼った・選んだとき。#15） */
  readonly statement?: StatementState;
  /** 読み込み中・保存中などで画像を受けられなかったときの知らせ（黙って捨てない） */
  readonly readBlocked?: string | null;
  /** 根拠の足のチャートの枠（貼った・選んだ枠だけ。#12。付属の x1〜x5 は #89） */
  readonly charts?: ChartsState;
  /** 付属のチャートの行（追加した順。#89） */
  readonly extras?: readonly ExtraEntry[];
  /** 枠を変えられなかった知らせ（前の保存が届いたか分からない間。黙って捨てない） */
  readonly chartBlocked?: string | null;
  /**
   * 空の下書きに戻したときの下書き（開いたとき・次の取引・最後の行のスキップ）。これと違えば「入力がある」（#75 R0。
   * draft-status.ts）
   */
  readonly baseline?: Draft;
  /**
   * ［明細なしで手入力］ を押した（#130。明細の場所を要約の状態にする。次の取引・最後の行のスキップで戻す）。書きかけの
   * 判定（draft-status.ts）には数えない（押しただけでは入力ではない）
   */
  readonly manual?: boolean;
  /**
   * 段（2026-11-21。設計書 K17）: input = 1 段目「スクショを入れる」、review = 2 段目「振り返る」。開いたとき・次の取引・最後の
   * 行のスキップは input、明細を選ぶ（読み取りを待たない。C23）・［明細なしで手入力］ は review。書きかけと一緒に預かるので、
   * 戻ったときも同じ段。書きかけの判定には数えない
   */
  readonly stage?: RecordStage;
  /**
   * 読み取り中に ［キャンセル］ を押した（2 段目の明細の行に「読み取りをキャンセルしました」。#166 R1）。次の読み取り・
   * ［明細なしで手入力］・保存・次の取引で false に戻す
   */
  readonly readCancelled?: boolean;
  /**
   * 読み取った明細を削除した直後で、［元に戻す］ が押せる（1 段目の明細の枠の 1 行「明細を削除しました」。#184 R3・R4）。
   * 次の明細を選ぶ・記録する・✕・画面を離れると false
   */
  readonly statementRemoved?: boolean;
}

export interface RecordController {
  getState(): RecordState;
  /** 購読（すぐに今の状態を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (s: RecordState) => void): () => void;
  load(): Promise<void>;
  update(action: DraftAction): void;
  save(): Promise<void>;
  /** [次の取引を記録]: 空の入力に戻す（既定は今保存した取引から。API は読み直さない） */
  next(): void;
  /** 明細の画像を 1 枚受けて、描き直して読み取りに送る（追加の操作なし。前の読み取りは捨てる） */
  readImage(file: Blob): Promise<void>;
  /**
   * 読み取りをやめる（後で届いた応答は捨てる）。別の明細の読み直しなら、選ぶ前の明細の状態（値・印・画像・行）に戻す（#184 R6）
   */
  cancelRead(): void;
  /**
   * ［削除］: 読み取った明細を削除する（明細から来た値を取り除き、LC・一言・3 つのタップ・チャートなど本人が入れたものは残す。
   * AI へ送らない。#184 R1〜R3）
   */
  removeStatement(): void;
  /** ［元に戻す］: 削除の直前の明細の状態（値・印・画像・行）に戻す（AI へ送らない。#184 R4） */
  undoRemoveStatement(): void;
  /** 明細の時刻の時間帯を選ぶ: 選んだ時間帯から日本時間に直して欄に入れ、端末に覚える（#58） */
  chooseTimeZone(id: TzId): void;
  /** [ほかのタイムゾーン…] を開く（前に選んだ時間帯で入れた欄は明細の時刻に戻す） */
  openOtherZones(): void;
  /** [この行を飛ばす] */
  skipRow(): void;
  /** [別のポジションにする]: 明細から読んだレッグ（下書きのレッグの番号）を次の取引として記録する（#118・7.6） */
  splitLeg(legIndex: number): void;
  /** ［このポジションに入れる］: 次の同じ原資産のポジションのレッグを今のポジションに入れる（#118・7.6） */
  mergeNextPosition(): void;
  /** ［明細なしで手入力］: 明細の場所を要約の状態にする（取引の欄のシートを開くのは画面。#130） */
  startManual(): void;
  /** 段を替える（2 段目の上の帯の ［スクショ］ = input、1 段目の ［振り返りへ進む］ = review。値はそのまま） */
  setStage(stage: RecordStage): void;
  /** チャートを 1 枚、枠に入れる（描き直してプレビューを出すだけ。送るのは [記録する]。同じ枠なら置き換え） */
  setChart(slot: AnySlot, file: Blob): Promise<void>;
  /** [削除]: 枠の画像と時間足を消す（付属の枠は行ごと） */
  removeChart(slot: AnySlot): void;
  /** [＋ チャートを追加]: 付属の枠を末尾に足す（足した枠。5 枚なら null） */
  addExtraChart(): ExtraSlot | null;
  /** 付属の枠の時間足・一言 */
  setExtraTimeframe(slot: ExtraSlot, value: Timeframe | null): void;
  setExtraNote(slot: ExtraSlot, note: string): void;
  /** [＋ 口座を足す]: その場で足す欄を開く（ほかの欄は触らない） */
  openAddAccount(): void;
  /** [やめる]・Esc: 足す欄を閉じる（送っている間は閉じない） */
  closeAddAccount(): void;
  setNewAccount(field: Extract<AccountField, 'name' | 'capital'>, value: string): void;
  /** [足す]: POST /api/accounts。足せたら一覧に足して選ぶ（下書きのほかの欄・明細・チャートはそのまま） */
  addAccount(): Promise<void>;
  /** [〈読めた値〉にする]: チャートから読めた値で枠の時間足を直す（印を付ける） */
  acceptChartTimeframe(slot: AnySlot): void;
  /**
   * 画面に戻った（タブが見えるようになった）: 前に準備を送ってから WARM_REFRESH_MS 以上たっていれば送り直す
   * （warmRead のときだけ。#99 の続き）
   */
  refreshWarm(): void;
  /**
   * 記録する画面に出ている（true）か、書きかけを置き場に残して画面の外にいる（false）か（#75）。画面の外では準備を送らない
   * （終わっていない読み取りが後で返っても送らない。その分は戻ったときの refreshWarm が間を置かず送る）。既定は true
   */
  setOnScreen(on: boolean): void;
  /** 画面を離れた: 読み取りを止め、画像と残りの行を捨てる（チャートも捨てる） */
  dispose(): void;
}

/**
 * 記録する画面に出た（#75）。初めての controller は読み込む（開いたときの準備を含む）。書きかけを借り直したときは読み込み直さず、
 * 準備だけを refreshWarm の規則で送る（前に送ってから WARM_REFRESH_MS 以上、または画面の外で送り直せなかった分）。
 * 返す関数で画面を離れる（以後、戻るまで準備を送らない）。started は読み込みを 1 回にするための印（画面が 1 つ持つ）
 */
export function enterRecordScreen(
  c: RecordController,
  started: WeakSet<RecordController>,
): () => void {
  c.setOnScreen(true);
  if (started.has(c)) c.refreshWarm();
  else {
    started.add(c);
    void c.load();
  }
  return () => c.setOnScreen(false);
}

/**
 * 開いたときの既定（AC-9・#47 R4）: 最後に記録した取引（作った時刻が最大）の銘柄・数量・口座（一覧に無い口座は既定の口座）、
 * 決済の時刻 = 今（分まで）
 */
export function defaultsFrom(
  trades: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  now: number,
  accounts: readonly AccountRecord[] = [],
): Partial<Draft> {
  const exitTime = toLocalInput(floorToMinute(now));
  const accountId = defaultAccountId(trades, accounts);
  let last: StoredTrade | undefined;
  for (const t of trades) if (!last || t.createdAt > last.createdAt) last = t;
  if (!last) return { exitTime, accountId };
  const name = instruments.find((i) => i.id === last.record.instrumentId)?.name ?? '';
  return {
    instrumentName: name,
    quantity: formatPlain(last.record.entries[0].quantity),
    exitTime,
    accountId,
  };
}

/** 鍵の順に依らない JSON（同じ本文の取引かを比べる） */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function messageOf(kind: FailureKind): string {
  if (kind === 'auth') return AUTH_EXPIRED;
  if (kind === 'network') return NETWORK_FAILED;
  return SAVE_FAILED;
}

/** 空の下書きと、それを「入力が無い」の基準にする組（#75） */
function withBaseline(draft: Draft): { draft: Draft; baseline: Draft } {
  return { draft, baseline: draft };
}

export function createRecordController(deps: {
  readonly api: ApiFn;
  readonly now: () => number;
  readonly timeoutMs?: number;
  /** 画像を送る形に描き直す（画面が statement-image.ts の prepareImage を渡す。テストは偽物） */
  readonly prepare?: (file: Blob) => Promise<PrepareResult>;
  readonly readTimeoutMs?: number;
  /**
   * 読み取りの準備を送る（#65。画面が true を渡す。失敗は画面に出さない）: 開いたとき・読み取りの後・画面に
   * 戻ったとき（#99 の続き）
   */
  readonly warmRead?: boolean;
  /** 明細の時刻の時間帯を端末に覚える（#58。省けば覚えない） */
  readonly zoneMemory?: ZoneMemory;
}): RecordController {
  const { now } = deps;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? READ_TIMEOUT_MS;
  const listeners = new Set<(s: RecordState) => void>();
  let state: RecordState = {
    phase: 'loading',
    draft: EMPTY_DRAFT,
    instruments: [],
    accounts: [],
    read: readDraft(EMPTY_DRAFT, { instruments: [], accounts: [] }),
    error: null,
  };
  let inflight: Promise<void> | null = null;
  /** 届いたか分からない保存の本文（時間切れ・通信の失敗の後） */
  let uncertain: TradeRecord | null = null;
  /** 読み取りの世代（新しい読み取り・やめた・離れたで進め、古い応答を捨てる） */
  let readGen = 0;
  let readAbort: AbortController | null = null;
  /** 貼った後に利用者が触った欄（応答で上書きしない） */
  let touched = new Set<DraftField>();
  /**
   * 明細の特徴（#66。応答の鍵と提案の口座。記憶の中だけ = 端末の保存先・URL・履歴に書かない）と、その明細で本人が
   * 口座を選んだ・足したか（選んでいれば提案を使わない。R4・S3）。もう 1 枚・最後の行の後・やめた・離れたで捨てる
   */
  let profile: StatementProfile | null = null;
  let accountTouched = false;
  /** その明細で覚えを新しくした（記録の後の 1 行。#66 デザイン 5） */
  let learnedInStatement = false;
  /** 同じ明細から保存した取引（保存の順。スキップした行・失敗した行は入らない。保存の後のシートで心理を付ける先。#156 R4） */
  let statementSaved: StoredTrade[] = [];
  /** その明細で選んだ（当てた）時間帯（同じ明細のほかの行に使う。Z8）。もう 1 枚・やめた・離れたで捨てる */
  let statementZone: TzId | null = null;
  /** 空の下書きに戻すときの既定（開いたとき、保存の後は今保存した取引から） */
  let defaults: Partial<Draft> = {};
  /** その場で足す口座: [足す] を押した（空の名前の誤りを出す）・409 の名前の鍵・届いたか分からない名前 */
  let addTried = false;
  let accountTaken: string | null = null;
  let uncertainAccount: string | null = null;
  let addingAccount: Promise<void> | null = null;
  /** 読み取りの準備（#99 の続き）: 送っている間・送っている間に要るようになった・最後に送った時刻・離れた */
  let warmInflight = false;
  let warmAgain = false;
  let warmSentAt: number | null = null;
  let disposed = false;
  let onScreen = true;
  /** 画面の外にいて送り直せなかった（戻ったら WARM_REFRESH_MS を待たずに送る。#75） */
  let warmMissed = false;
  /** 明細から自動で選んだ口座（選ぶ前 → 選んだ。#66）。本人が触っていなければ削除・読み直しで選ぶ前に戻す（#184 R1） */
  let autoAccount: { readonly from: string; readonly to: string } | null = null;
  /** 削除の ［元に戻す］ の戻り先（#184 R4。画像を持つので、終わったら close して捨てる） */
  let undoSnap: StatementSnap | null = null;
  /** 別の明細の読み直しの戻り先（#184 R6。読み直しが失敗・キャンセルで終わったら戻す。読めたら捨てる） */
  let rollback: StatementSnap | null = null;

  const set = (patch: Partial<Omit<RecordState, 'read'>>, clearSaved = false) => {
    const merged = { ...state, ...patch };
    const { saved, errorKind, ...rest } = merged;
    let base: Omit<RecordState, 'read'> = {
      ...rest,
      ...(clearSaved || saved === undefined ? {} : { saved }),
      ...(merged.error === null || errorKind === undefined ? {} : { errorKind }),
    };
    const ctx: DraftContext = {
      instruments: base.instruments,
      accounts: base.accounts,
      charts: {
        entry: base.charts?.entry?.phase === 'ready',
        exit: base.charts?.exit?.phase === 'ready',
      },
      // 損益の欄を本人が打った・直したら、手で足したレッグの損益を足さない（#118 のレビュー 3）
      ...(base.statement ? { statementPnl: base.statement.marks.pnlYen === 'read' } : {}),
      // 明細の損益の通貨（その場で足すオプションの銘柄の価格の通貨。#118 の見直し 2）
      ...(() => {
        const st = base.statement;
        const c = st?.phase === 'ready' ? st.rows[st.index]?.pnlCurrency : undefined;
        return c !== undefined && /^[A-Z]{3}$/.test(c) ? { statementCurrency: c } : {};
      })(),
    };
    // 明細から作ったポジション（#118）: 決済の時点が SQ かで、明細の逆指値の既定と決済の時刻を合わせる（C54）
    const st0 = base.statement;
    const unitRow0 = st0?.phase === 'ready' ? st0.rows[st0.index] : undefined;
    if (st0 && unitRow0?.legs) {
      const synced = syncExpiry(base.draft, st0.marks, touched, unitRow0, st0.tz?.choice ?? null);
      if (synced.draft !== base.draft || synced.marks !== st0.marks) {
        base = { ...base, draft: synced.draft, statement: { ...st0, marks: synced.marks } };
      }
    }
    let read = readDraft(base.draft, ctx);
    // 「窓・滑りでしたか」の問いが消えたら答えも消す（後で問いが出直したときに古い答えを選んだまま出さない）
    if (!read.preview.showGapSlip && base.draft.gapSlip !== 'unanswered') {
      base = { ...base, draft: { ...base.draft, gapSlip: 'unanswered' } };
      read = readDraft(base.draft, ctx);
    }
    const st = base.statement;
    if (st) {
      read = gateReading(read, {
        reading: st.phase === 'preparing' || st.phase === 'reading',
        marks: st.marks,
      });
      // 銘柄がオプションの形でないポジションは保存しない（#118）
      read = gatePosition(read, unitRow0);
    }
    // チャートの描き直し中は保存しない（送るものが決まっていない）
    if (Object.values(base.charts ?? {}).some((c) => c?.phase === 'preparing')) {
      read = { ...read, canSave: false, notice: read.notice ?? CHART_PREPARING };
    }
    // 付属の一言が長すぎる間は保存しない（#89）
    if (extraNoteErrors(base.extras ?? []).length > 0) {
      read = { ...read, canSave: false, notice: read.notice ?? extraNoteTooLong };
    }
    // 口座を足している間は保存しない（U9）
    if (base.addAccount?.saving) {
      read = { ...read, canSave: false, notice: read.notice ?? ACCOUNT_ADDING };
    }
    // チャートの時間足の読み取り中も保存できる（任意の欄。待たずに記録できることを帯に出す。#27）
    if (read.canSave && Object.values(base.charts ?? {}).some((c) => c?.read === 'reading')) {
      read = { ...read, notice: read.notice ?? CHART_READ_MSG.reading };
    }
    state = { ...base, read };
    for (const fn of listeners) fn(state);
  };

  const statementBusy = () =>
    state.statement?.phase === 'preparing' || state.statement?.phase === 'reading';

  /** 時間の上限つきの要求。時間切れ・通信の失敗は network、ログインしていなければ auth（request.ts） */
  const request = createRequest(deps.api, timeoutMs);

  /** チャートの枠（エントリー時・決済時・付属。chart-slots.ts。編集の画面と同じもの） */
  const slots: ChartSlots = createChartSlots({
    request,
    readTimeoutMs,
    ...(deps.prepare ? { prepare: deps.prepare } : {}),
    timeframeOf: (slot) => state.draft[CHART_TIMEFRAME_FIELD[slot]],
    othersBusy: statementBusy,
    commit: (c: ChartSlotsChange) => {
      let draft = state.draft;
      for (const [slot, tf] of Object.entries(c.timeframes ?? {})) {
        draft = { ...draft, [CHART_TIMEFRAME_FIELD[slot as ChartSlot]]: tf };
      }
      set({
        charts: c.view.charts,
        extras: c.view.extras,
        draft,
        ...(c.authExpired ? { error: AUTH_EXPIRED, errorKind: 'auth' as const } : {}),
      });
    },
  });
  const pump = () => slots.pump();
  const chartIdle = () => slots.idle();

  /** すべての枠を空に戻す（知らせは次の set で出す） */
  const clearCharts = () => {
    slots.clear();
    if (state.charts || state.extras) {
      const { charts: _gone, extras: _x, ...rest } = state;
      state = rest;
    }
  };

  /**
   * 読み取りの準備を送る（重ねない）。again = 送っている間なら、終わってから 1 回だけ送り直す（読み取りの後。
   * 送っている準備の先立ては、その読み取りが使ったかもしれない）
   */
  const warm = (again = false) => {
    if (!deps.warmRead || disposed) return;
    if (!onScreen) {
      if (again) warmMissed = true;
      return;
    }
    if (warmInflight) {
      if (again) warmAgain = true;
      return;
    }
    warmInflight = true;
    warmAgain = false;
    warmMissed = false;
    warmSentAt = now();
    void request(READ_PREPARE_PATH, { method: 'POST' }, { ms: READ_PREPARE_TIMEOUT_MS })
      .catch(() => undefined)
      .finally(() => {
        warmInflight = false;
        if (warmAgain) warm(true);
      });
  };

  const load = async () => {
    set({ phase: 'loading', error: null, readBlocked: null }, true);
    warm();
    try {
      const [t, i, a] = await Promise.all([
        // 既定に使うのは前回（作った時刻が最大）の 1 件だけ。全件を読まない（Issue #87）
        request(tradesPath({ order: 'created', limit: 1 })).then((r) =>
          getJson<{ items: StoredTrade[] }>(r, 200),
        ),
        request('/api/instruments').then((r) => getJson<{ items: InstrumentRecord[] }>(r, 200)),
        request('/api/accounts').then((r) => getJson<{ items: AccountRecord[] }>(r, 200)),
      ]);
      if (!Array.isArray(t.items) || !Array.isArray(i.items) || !Array.isArray(a.items)) {
        throw new Failed('other');
      }
      const accounts = sortAccounts(a.items);
      defaults = defaultsFrom(t.items, i.items, now(), accounts);
      const { addAccount: _closed, ...rest } = state;
      state = rest;
      set({
        phase: 'editing',
        stage: 'input',
        instruments: i.items,
        accounts,
        ...withBaseline(applyDraft(EMPTY_DRAFT, { type: 'reset', values: defaults })),
        error: null,
      });
    } catch (e) {
      const kind = kindOf(e);
      set({
        phase: 'loadFailed',
        error: kind === 'auth' ? AUTH_EXPIRED : LOAD_FAILED,
        errorKind: kind,
      });
    }
  };

  /** 銘柄の ID を決める（一覧に同じ名前があればそれ、無ければ足す。409 なら取り直して照合。instrument-resolve.ts） */
  const resolveInstrument = (
    name: string,
    matchedId: string | undefined,
    create?: Omit<InstrumentBody, 'name'>,
  ) => resolveInstrumentId(request, name, matchedId, state.instruments, create);

  /** 前の保存が届いていたか（同じ本文の取引が、作った時刻の新しい順の先頭 DELIVERED_LIMIT 件にあるか。Issue #87） */
  const findDelivered = async (record: TradeRecord): Promise<StoredTrade | undefined> => {
    const list = await getJson<{ items: StoredTrade[] }>(
      await request(tradesPath({ order: 'created', limit: DELIVERED_LIMIT })),
      200,
    );
    if (!Array.isArray(list.items)) throw new Failed('other');
    const want = canonical(record);
    return list.items.find((t) => canonical(t.record) === want);
  };

  /** 読み取りを止めて、画像（プレビュー）と残りの行を捨てる（読み直しの戻り先も捨てる） */
  const endStatement = () => {
    dropRollback();
    detachStatement();
    touched = new Set();
    accountTouched = false;
  };

  /**
   * 明細を外す（読み取りを止め、明細ごとの記憶を捨てる）。前の明細の後に本人が直した読み取りの欄は持ち越さない（#184 Q1）ので
   * touched から読み取りの欄を外し、本人の答え（決めていた・決済の理由など）は残す。本人が選んだ口座（accountTouched）は残す
   * （R2・R5）。画像は戻り先（削除の ［元に戻す］・読み直しの戻り先）が持っていなければ close する
   */
  const detachStatement = () => {
    readGen++;
    readAbort?.abort();
    readAbort = null;
    touched = new Set([...touched].filter((f) => !(READ_FIELDS as readonly string[]).includes(f)));
    profile = null;
    learnedInStatement = false;
    statementSaved = [];
    statementZone = null;
    autoAccount = null;
    const prev = state.statement;
    if (!prev) return;
    if (prev.preview && !kept(prev.preview)) prev.preview.close();
    const { statement: _gone, ...rest } = state;
    state = rest;
  };

  /** 戻り先が持っている画像か（close しない） */
  const kept = (preview: PreviewHandle) =>
    undoSnap?.statement.preview === preview || rollback?.statement.preview === preview;

  /**
   * 今の明細（ready）の写し（削除の ［元に戻す］・読み直しの戻り先。#184）。取り除いた下書きには為替の規則を当てない: 口座を
   * 選ぶ前に戻しても、銘柄が空になるので通貨の組が決まらず、打った為替は「ほかの任意の欄」として残す（R2）。規則は次に銘柄・口座が
   * 決まったとき（入力・次の明細の流し込み）に当たり、［元に戻す］ では基準の組（fxBasis）ごと戻す
   */
  const takeSnap = (st: StatementState): StatementSnap => {
    const accountFrom =
      !accountTouched && autoAccount !== null && state.draft.accountId === autoAccount.to
        ? autoAccount.from
        : undefined;
    return {
      before: state.draft,
      stripped: stripStatement(state.draft, st.marks, accountFrom),
      statement: st,
      touched: new Set(touched),
      profile,
      accountTouched,
      learnedInStatement,
      statementSaved,
      statementZone,
      fxBasis,
      autoAccount,
    };
  };

  /** 戻り先を捨てる（画像は今の明細が使っていなければ close） */
  const dropSnap = (snap: StatementSnap | null) => {
    const p = snap?.statement.preview;
    if (p && state.statement?.preview !== p) p.close();
  };
  const dropRollback = () => {
    const snap = rollback;
    rollback = null;
    dropSnap(snap);
  };
  /** 削除の ［元に戻す］ を終える（知らせの 1 行も外す。知らせは次の set で出す） */
  const dropUndo = () => {
    const snap = undoSnap;
    undoSnap = null;
    dropSnap(snap);
    if (state.statementRemoved) state = { ...state, statementRemoved: false };
  };

  /**
   * 写しの明細の状態に戻す（#184 R4・R6）: 明細から来た値・印・画像・行・明細ごとの記憶を戻し、本人の計画の欄は今のまま。
   * reverted: 読み直しをやめて戻した理由（明細の枠の 1 行）
   */
  const restore = (snap: StatementSnap, reverted?: StatementReverted) => {
    readGen++;
    readAbort?.abort();
    readAbort = null;
    const cur = state.statement;
    if (cur?.preview && cur.preview !== snap.statement.preview) cur.preview.close();
    // 写しの後に本人が選んだ答え・口座は戻さない
    const chosen = new Set<KeptAnswer>([
      ...(['lcDecided', 'exitReason'] as const).filter((f) => touched.has(f)),
      ...(accountTouched && !snap.accountTouched ? (['accountId'] as const) : []),
    ]);
    // 読み取りの欄は写しの値に戻すので、触った印も写しのもの
    touched = new Set([
      ...snap.touched,
      ...[...touched].filter((f) => !(READ_FIELDS as readonly string[]).includes(f)),
    ]);
    profile = snap.profile;
    accountTouched = snap.accountTouched || accountTouched;
    learnedInStatement = snap.learnedInStatement;
    statementSaved = snap.statementSaved;
    statementZone = snap.statementZone;
    fxBasis = snap.fxBasis;
    autoAccount = snap.autoAccount;
    const draft = restoreStatement(
      state.draft,
      snap.before,
      snap.stripped,
      snap.statement.marks,
      chosen,
    );
    // 戻さなかった「明細から」「自動で選択」の答えは本人の答え（印を外す）
    let marks = snap.statement.marks;
    for (const f of ['lcDecided', 'exitReason', 'accountId'] as const) {
      if (draft[f] !== snap.before[f]) marks = markEdited(marks, f);
    }
    const { reverted: _old, ...st } = snap.statement;
    set({
      draft,
      error: null,
      readCancelled: false,
      statementRemoved: false,
      statement: { ...st, marks, ...(reverted ? { reverted } : {}) },
    });
  };

  /** 覚えた時間帯（読めない・例外は null） */
  const rememberedZone = (): TzId | null => {
    try {
      return deps.zoneMemory?.read() ?? null;
    } catch {
      return null;
    }
  };

  /**
   * 流し込んだ行に時間帯の無い時刻があれば、この明細で選んだ時間帯（無ければ覚えた時間帯）で直して入れる（Z7・Z8）。
   * どちらも無ければ印 tz のまま（選ぶか欄を直すまで記録しない）
   */
  const withZone = (
    filled: Filled,
    row: ReadRow,
    raw: readonly ReadRow[] = [],
  ): Filled & { tz?: TzState } => {
    const fields = tzFieldsOf(filled.marks);
    if (fields.length === 0) return filled;
    const preferred = statementZone ?? rememberedZone();
    if (preferred === null) {
      return {
        ...filled,
        tz: { fields, choice: null, remembered: false, otherOpen: false, gap: null },
      };
    }
    const a = applyZone(filled.draft, filled.marks, row, preferred, fields);
    if (a.gaps.length > 0) {
      // 覚えた時間帯では存在しない時刻（夏時間の切り替え）: どの欄も直さず（手で選ぶ道と同じ）、ほかを選ぶよう促す
      return {
        ...filled,
        tz: { fields, choice: null, remembered: true, otherOpen: false, gap: preferred },
      };
    }
    statementZone = preferred;
    return {
      // 明細から読んだレッグの時刻も同じ時間帯で（#118）
      draft: row.legs ? { ...a.draft, legs: legsWithZone(a.draft.legs, raw, preferred) } : a.draft,
      marks: a.marks,
      tz: {
        fields,
        choice: preferred,
        remembered: true,
        otherOpen: isOtherZone(preferred),
        gap: null,
      },
    };
  };

  /**
   * 口座を替えた後の下書きと印（#47 PR-2・ux 2.1）: 明細の行が読めていて口座の通貨が変わったら、外貨の口座へは読み取りで
   * 入れた損益・手数料を空に戻し、JPY の口座へは今の行から入れ直す（手で打った値・触った欄は触らない）
   */
  const afterAccountChange = (
    draft: Draft,
    accounts: readonly AccountRecord[],
  ): { draft: Draft; statement?: StatementState } => {
    const st = state.statement;
    const row = st?.phase === 'ready' ? st.rows[st.index] : undefined;
    if (!st || !row) return { draft };
    const before = accountCurrencyIn(state.accounts, state.draft.accountId);
    const after = accountCurrencyIn(accounts, draft.accountId);
    if (before === after) return { draft };
    const filled = refillMoney(
      { draft, marks: st.marks },
      row,
      touched,
      after,
      priceCurrencyOf(row.symbol),
    );
    return { draft: filled.draft, statement: { ...st, marks: filled.marks } };
  };

  /** 行の銘柄の価格の通貨（一覧の名前と同じ名前の銘柄。無い・未設定は null。#66 P3） */
  const priceCurrencyOf = (symbol: string | null): string | null => {
    if (symbol === null) return null;
    const key = nameKeyOf(symbol);
    return state.instruments.find((i) => nameKeyOf(i.name) === key)?.priceCurrency ?? null;
  };

  /** 為替を打ったときの通貨の組（打っていなければ null。#47 PR-2） */
  let fxBasis: FxPair | null = null;
  /** 下書きに為替の規則を当てる（typed = いま為替の欄を打った: 基準の組を今の組にする） */
  const withFxRule = (draft: Draft, accounts: readonly AccountRecord[], typed = false): Draft => {
    const now = fxPairOf(draft, { instruments: state.instruments, accounts });
    if (typed) {
      fxBasis = draft.fxRate === '' ? null : now;
      return draft;
    }
    const r = applyFxRule(draft, fxBasis, now);
    fxBasis = r.basis;
    return r.draft;
  };

  /**
   * 行（先物の行かポジションのまとまり）を下書きに流し込む。ポジションはレッグも（明細の行の順 + 手で足したレッグ。#118）
   */
  const fillUnit = (
    base: Draft,
    row: ReadRow,
    opts: { readonly accountCurrency: string; readonly priceCurrency: string | null },
  ): Filled => {
    const filled = fillFromRow(base, row, touched, opts);
    if (!row.legs) return filled;
    // 銘柄はオプションの形の銘柄の中からだけ当てる（原資産の名前 / 原資産 +「オプション」。先物には当てない。レビュー B1）
    const named =
      row.symbol === null || touched.has('instrumentName')
        ? undefined
        : optionInstrumentName(row.symbol, state.instruments, defaults.instrumentName);
    return {
      draft: {
        ...filled.draft,
        ...(named ? { instrumentName: named.name } : {}),
        legs: unitLegs(base.legs, row, statementZone),
      },
      marks: filled.marks,
    };
  };

  /** 行 index の下書き（読み取りの欄 = 行、LC・一言・3 つのタップ・広げた後の LC は空） */
  const showRow = (st: StatementState, index: number, notice: string | null) => {
    const row = st.rows[index];
    if (!row) return;
    touched = new Set();
    clearCharts();
    // 次の行は前の行の口座を引き継ぐ（#47 R4・B6）。外貨の口座では損益・手数料を入れない（PR-2・R7）
    const filled = withZone(
      fillUnit({ ...EMPTY_DRAFT, accountId: state.draft.accountId }, row, {
        accountCurrency: accountCurrencyIn(state.accounts, state.draft.accountId),
        priceCurrency: priceCurrencyOf(row.symbol),
      }),
      row,
      st.raw,
    );
    const { tz: _oldTz, reverted: _r, ...rest } = st;
    set(
      {
        phase: 'editing',
        error: null,
        chartBlocked: null,
        draft: filled.draft,
        statement: {
          ...rest,
          ...(filled.tz ? { tz: filled.tz } : {}),
          phase: 'ready',
          index,
          marks: filled.marks,
          notice,
          message: null,
          firstTime: false,
        },
      },
      true,
    );
  };

  /**
   * まとめ直した（#118）: 今のポジションを新しいまとまりで流し込み直す。本人が触った欄・直したレッグ・手で足したレッグは保つ
   */
  const regroup = (st: StatementState, units: readonly Unit[], notice: string) => {
    const raw = st.raw ?? [];
    const rows = unitRows(raw, units);
    const row = rows[st.index];
    if (!row) return;
    // 前のまとまりの明細の行から入れた既定（逆指値 → LC を決めていた・決済の理由）と読み取りの欄の印は、新しいまとまりの行で
    // 決め直す（証拠の行を分けた後に「明細から」を残さない。本人が触った欄は残す。レビュー B2）
    let base = state.draft;
    const marks: Partial<Record<DraftField, FieldMark>> = { ...st.marks };
    if (!touched.has('lcDecided') && st.marks.lcDecided === 'statement')
      base = { ...base, lcDecided: null };
    if (!touched.has('exitReason') && st.marks.exitReason === 'statement') {
      base = { ...base, exitReason: 'other' };
    }
    for (const f of [...READ_FIELDS, 'lcDecided', 'exitReason'] as const) {
      if (!touched.has(f)) delete marks[f];
    }
    const filled = withZone(
      fillUnit(base, row, {
        accountCurrency: accountCurrencyIn(state.accounts, state.draft.accountId),
        priceCurrency: priceCurrencyOf(row.symbol),
      }),
      row,
      raw,
    );
    const { tz: oldTz, reverted: _r, ...rest } = st;
    const tz = filled.tz ?? (tzFieldsOf(filled.marks).length > 0 ? oldTz : undefined);
    set({
      draft: withFxRule(filled.draft, state.accounts),
      error: null,
      statement: {
        ...rest,
        ...(tz ? { tz } : {}),
        rows,
        units,
        marks: { ...marks, ...filled.marks },
        notice,
      },
    });
  };

  const statementFailed = (gen: number, message: string | null) => {
    if (gen !== readGen) return;
    // 別の明細の読み直しなら、選ぶ前の明細の状態に戻して決まった文言を出す（出どころの印の無い前の値を残さない。#184 R6）
    const snap = rollback;
    if (snap) {
      rollback = null;
      restore(snap, message === null ? undefined : { kind: 'failed', message });
      return;
    }
    const st = state.statement;
    if (!st) return;
    set({ statement: { ...st, phase: 'failed', message, rows: [], index: 0, marks: {} } });
  };

  const readImage = async (file: Blob) => {
    try {
      await readImageInner(file);
    } finally {
      pump();
    }
  };

  const readImageInner = async (file: Blob) => {
    if (state.phase === 'saved') next();
    if (!deps.prepare) return;
    if (state.phase !== 'editing') {
      set({ readBlocked: state.phase === 'saving' ? READ_BLOCKED.saving : READ_BLOCKED.notReady });
      return;
    }
    // 次の明細を選んだら削除の ［元に戻す］ は終わる（#184 R4）
    dropUndo();
    // 読めた明細があれば、明細から来たもの（読み取りの欄 9 つ。読んだ後に本人が直した値も・明細のレッグ・「明細から」の既定・
    // 自動で選んだ口座）を取り除いてから読む（#184 R5・Q1 = 持ち越さない）。前の明細は読み直しの戻り先に持つ（失敗・キャンセルで
    // 戻す。R6）。読み取りの途中で選び直したときは、前の戻り先（最後に読めた明細）のまま
    const prev = state.statement;
    let draft = state.draft;
    if (prev?.phase === 'ready') {
      dropRollback();
      const snap = takeSnap(prev);
      rollback = snap;
      draft = snap.stripped;
    } else if (prev?.phase !== 'preparing' && prev?.phase !== 'reading') {
      dropRollback();
    }
    detachStatement();
    const gen = readGen;
    const ctl = new AbortController();
    readAbort = ctl;
    set({
      error: null,
      readBlocked: null,
      readCancelled: false,
      // 明細を選んだら読み取りを待たずに 2 段目へ（C23。2026-11-21）
      stage: 'review',
      draft,
      statement: {
        phase: 'preparing',
        rows: [],
        index: 0,
        marks: {},
        message: null,
        notice: null,
        preview: null,
        ...(rollback ? { rereading: true as const } : {}),
      },
    });
    let prepared: PrepareResult;
    try {
      prepared = await deps.prepare(file);
    } catch {
      prepared = { ok: false, error: 'not_image' };
    }
    if (gen !== readGen) {
      if (prepared.ok) prepared.image.preview.close();
      return;
    }
    if (!prepared.ok) {
      statementFailed(gen, prepared.error === 'not_image' ? READ_MSG.notImage : READ_MSG.rejected);
      return;
    }
    const { bytes, contentType, preview } = prepared.image;
    const st0 = state.statement;
    if (!st0) {
      preview.close();
      return;
    }
    set({ statement: { ...st0, phase: 'reading', preview } });
    // 送っているチャートの読み取りがあれば終わるのを待つ（AI の読み取りは 1 つずつ。明細が先なので、待っている
    // チャートより前に送る）
    await chartIdle();
    if (gen !== readGen) return;
    try {
      const res = await request(
        READ_PATH,
        { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes as BodyInit },
        { ms: readTimeoutMs, ctl },
      );
      // API が先立てを使った（または使えずにその場で立てた）ので、次の 1 枚のために立て直す（#99 の続き）。
      // AI へ送った応答（200・送り口の失敗の 502 / 504 など）だけ。AI へ送る前に返す 400・403・413・429・503 の後は
      // 送らない（401 は request が投げる）
      if (sentToAi(res.status)) warm(true);
      if (gen !== readGen) return;
      if (res.status !== 200) {
        const kind = readFailureOf(res.status);
        if (kind === 'auth') throw new Failed('auth');
        statementFailed(gen, READ_MSG[kind]);
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (gen !== readGen) return;
      const result = parseReadResponse(json);
      if (result === null) {
        statementFailed(gen, READ_MSG.failed);
        return;
      }
      if (result.kind !== 'statement' || result.rows.length === 0) {
        statementFailed(gen, READ_MSG.notStatement);
        return;
      }
      const st = state.statement;
      // オプションの行は同じ position のまとまりを 1 件に（#118・7.6 の 2）
      const raw = result.rows;
      const units = initialUnits(raw);
      const rows = unitRows(raw, units);
      const row = rows[0];
      if (!st || !row || state.phase !== 'editing') {
        // 明細が外れた・編集中でない: 戻り先の画像を持ち続けない
        dropRollback();
        return;
      }
      // 明細から口座を選ぶ（#66・R4）: 口座 2 つ以上・提案の口座が一覧にある・本人がまだ選んでいないときだけ。
      // 損益・手数料は選んだ口座の通貨で流し込む（R6）
      profile = result.profile;
      const suggested = suggestedAccount(profile, state.accounts, accountTouched);
      const base = suggested === undefined ? state.draft : { ...state.draft, accountId: suggested };
      // 明細から替えた口座は、本人が触らなければ削除・読み直しで選ぶ前に戻す（#184 R1）
      autoAccount =
        suggested !== undefined && suggested !== state.draft.accountId
          ? { from: state.draft.accountId, to: suggested }
          : null;
      const accountCurrency = accountCurrencyIn(state.accounts, base.accountId);
      const priceCurrency = priceCurrencyOf(row.symbol);
      const filled = withZone(fillUnit(base, row, { accountCurrency, priceCurrency }), row, raw);
      // 印「自動で選択」は確かな提案のときだけ（提案の口座の通貨が明細の損益と合わなければ印を付けない。デザイン 4）
      const sure =
        suggested !== undefined &&
        pnlFillOf(row.pnlCurrency, accountCurrency, '', priceCurrency).fills;
      // 覚えの無い明細（鍵はあるが覚えが無い・覚えの口座が一覧に無い）で、本人がまだ選んでいない（デザイン 1）
      const firstTime =
        profile !== null &&
        !accountTouched &&
        state.accounts.length >= 2 &&
        !state.accounts.some((a) => a.id === profile?.accountId);
      const { accountId: _oldMark, ...prevMarks } = st.marks;
      const { tz: _oldTz, rereading: _rr, ...stRest } = st;
      set({
        // 読み取りが銘柄・口座を入れ替えたときも為替の規則を当てる（#47 PR-2 の 3 回目の再レビュー 3）
        draft: withFxRule(filled.draft, state.accounts),
        statement: {
          ...stRest,
          ...(filled.tz ? { tz: filled.tz } : {}),
          phase: 'ready',
          rows,
          raw,
          units,
          index: 0,
          marks: {
            ...prevMarks,
            ...filled.marks,
            ...(sure ? { accountId: 'auto' as const } : {}),
          },
          message: null,
          notice: null,
          firstTime,
        },
      });
      // 読めた: 前の明細の戻り先を捨てる（画像を close）
      dropRollback();
    } catch (e) {
      if (gen !== readGen) return;
      if (kindOf(e) === 'auth') {
        statementFailed(gen, null);
        set({ error: AUTH_EXPIRED, errorKind: 'auth' });
        return;
      }
      // 時間切れ・通信の失敗: API に届いて先立てを使ったかもしれないので立て直す（利用者がやめた・新しい読み取りは
      // 上の世代の確かめで返っている。#99 の続き）
      if (kindOf(e) === 'network') warm(true);
      statementFailed(gen, READ_MSG.failed);
    } finally {
      if (readAbort === ctl) readAbort = null;
    }
  };

  const setChart = async (slot: AnySlot, file: Blob) => {
    if (state.phase === 'saved') next();
    if (!deps.prepare) return;
    if (state.phase !== 'editing') {
      set({ readBlocked: state.phase === 'saving' ? READ_BLOCKED.saving : READ_BLOCKED.notReady });
      return;
    }
    if (uncertain !== null) {
      set({ chartBlocked: CHART_LOCKED });
      return;
    }
    // 差し替えたらその枠の時間足は選び直し（前のチャートの足が残って、誤って「時間足を変えた」にしない）
    state = { ...state, error: null, readBlocked: null, chartBlocked: null };
    await slots.setChart(slot, file);
  };

  const removeChart = (slot: AnySlot) => {
    if (state.phase !== 'editing') return;
    const isExtraRow = state.extras?.some((e) => e.slot === slot) ?? false;
    if (!state.charts?.[slot] && !isExtraRow) return;
    if (uncertain !== null) {
      set({ chartBlocked: CHART_LOCKED });
      return;
    }
    state = { ...state, error: null };
    slots.remove(slot);
  };

  const next = () => {
    const saved = state.saved;
    if (state.phase !== 'saved' || !saved) return;
    set(
      {
        phase: 'editing',
        stage: 'input',
        error: null,
        manual: false,
        readCancelled: false,
        ...withBaseline(
          applyDraft(EMPTY_DRAFT, {
            type: 'reset',
            values: { ...defaults, exitTime: toLocalInput(floorToMinute(now())) },
          }),
        ),
      },
      true,
    );
  };

  const doSave = async () => {
    const read = state.read;
    const body = read.body;
    if (state.phase !== 'editing' || !read.canSave || body === undefined) return;
    // 記録したら削除の ［元に戻す］ は終わる（#184 R4）
    dropUndo();
    // 終わっていない時間足の読み取りは止めて結果を捨てる（時間足は利用者が選んだ値か空のまま記録する。#27）
    const stopped = slots.stopReads();
    if (stopped.length > 0) state = { ...state, ...slots.view() };
    set({ phase: 'saving', error: null });
    try {
      const inst = await resolveInstrument(
        read.instrument.name,
        read.instrument.matchedId,
        read.instrument.create,
      );
      // 足した銘柄は保存に失敗しても一覧に残す（次に押したときに同じ名前を足し直さない）
      if (inst.instruments !== state.instruments) set({ instruments: inst.instruments });
      const extraCharts = extrasBody(state.extras ?? [], (x) => slots.has(x));
      const record: TradeRecord = {
        ...body,
        instrumentId: inst.id,
        ...(extraCharts ? { extraCharts } : {}),
      };
      let trade: StoredTrade | undefined;
      if (uncertain !== null && canonical(uncertain) === canonical(record)) {
        trade = await findDelivered(record);
      }
      if (trade === undefined) {
        // チャートがあれば取引と一緒に 1 要求（multipart）。無ければ今の JSON
        const uploads = slots.uploads();
        const withCharts = Object.keys(uploads).length > 0;
        try {
          const res = await request(
            '/api/trades',
            withCharts
              ? { method: 'POST', body: tradeFormData(record, uploads) }
              : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(record) },
            withCharts ? { ms: Math.max(CHART_SAVE_TIMEOUT_MS, chartSaveTimeoutMs(uploads)) } : {},
          );
          uncertain = null;
          trade = await getJson<StoredTrade>(res, 201);
        } catch (e) {
          if (kindOf(e) === 'network') uncertain = record;
          throw e;
        }
      }
      uncertain = null;
      const found = trade;
      // 覚える（#66・R5）: 明細から作った下書きを記録したら、鍵 → その取引の口座を上書きで覚える。失敗は黙って捨てる
      // （記録は成功のまま・知らせを出さない）。鍵が無ければ送らない
      const fromStatement = state.statement?.phase === 'ready';
      const learnedId = learnedAccountId(accountIdOf(found.record));
      // 記録の後の 1 行（デザイン 5）: 覚えが無かった・覚えと違う口座で記録したとき（口座 2 つ以上だけ）
      const learned =
        fromStatement &&
        profile !== null &&
        state.accounts.length >= 2 &&
        profile.accountId !== learnedId;
      if (fromStatement && profile) {
        learn(profile.key, learnedId);
        profile = { ...profile, accountId: learnedId };
      }
      if (learned) learnedInStatement = true;
      const learnedOnce = learnedInStatement;
      // 明細の行なら、同じ明細から保存した取引に足す（最後の行の後のシートで、保存した行すべてに心理を付ける。#156 R4）
      const inStatement = state.statement?.phase === 'ready';
      if (inStatement) statementSaved = [...statementSaved, found];
      const savedTrades = inStatement ? statementSaved : [found];
      const name = inst.instruments.find((i) => i.id === found.record.instrumentId)?.name ?? '';
      defaults = {
        instrumentName: name,
        quantity: formatPlain(found.record.entries[0].quantity),
        accountId: accountIdOf(found.record),
      };
      // 保存したチャートは捨てる（次の取引・次の行の枠は空。1 取引 = その取引のチャート）
      clearCharts();
      // 明細の残りの行があれば、次の行で下書きを作り直す（C20。R7）
      const st = state.statement;
      if (st && st.phase === 'ready' && st.index + 1 < st.rows.length) {
        const saved = st.index;
        showRow(st, saved + 1, rowSaved(saved, st.rows.length, rowUnitOf(st)));
        return;
      }
      endStatement();
      set({
        phase: 'saved',
        readCancelled: false,
        saved: {
          trade: found,
          trades: savedTrades,
          instrumentName: name,
          summary: summarize(found),
          accountName: accountNameOf(accountIdOf(found.record), state.accounts),
          accountCount: state.accounts.length,
          ...(learnedOnce ? { learned: true } : {}),
        },
        error: null,
        chartBlocked: null,
      });
    } catch (e) {
      const kind = kindOf(e);
      set({ phase: 'editing', error: messageOf(kind), errorKind: kind });
      // 記録が失敗して編集に戻った: 記録の前に止めた時間足の読み取りを送り直す（1 つずつ・明細が先の順のまま。#27 R1）
      slots.requeue(stopped);
    }
  };

  /** 明細の特徴の鍵 → 口座を覚える（PUT /api/statement-profiles/{鍵}。待たない・失敗は捨てる。#66） */
  const learn = (key: string, accountId: string) => {
    const path = profilePath(key);
    if (path === undefined) return;
    void request(path, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ accountId }),
    }).catch(() => undefined);
  };

  /** 足す欄の誤り（名前が空の誤りは [足す] を押した後だけ。API の 409 の名前は重複） */
  const addErrors = (draft: NewAccountDraft, accounts: readonly AccountRecord[]) => {
    const r = readNewAccountDraft(draft, accounts);
    const errors: Partial<Record<AccountField, string>> = { ...r.errors };
    if (errors.name === ACCOUNT_MSG.nameRequired && !addTried) delete errors.name;
    if (!errors.name && accountTaken !== null && nameKeyOf(draft.name) === accountTaken) {
      errors.name = ACCOUNT_MSG.duplicateName;
    }
    return { reading: r, errors };
  };

  const setAdd = (patch: Partial<AddAccountState>) => {
    const cur = state.addAccount;
    if (!cur) return;
    const next = { ...cur, ...patch };
    set({ addAccount: { ...next, errors: addErrors(next.draft, state.accounts).errors } });
  };

  const closeAdd = () => {
    const { addAccount: _closed, ...rest } = state;
    state = rest;
  };

  const doAddAccount = async () => {
    const cur = state.addAccount;
    if (state.phase !== 'editing' || !cur || cur.saving) return;
    addTried = true;
    const { reading, errors } = addErrors(cur.draft, state.accounts);
    const body = Object.keys(errors).length === 0 ? reading.body : null;
    if (body === null) {
      setAdd({ message: null });
      return;
    }
    const key = nameKeyOf(body.name);
    const { auth: _a, ...base } = cur;
    set({ addAccount: { ...base, errors: {}, saving: true, message: null } });
    const finish = (patch: Partial<AddAccountState>) => {
      const c = state.addAccount;
      if (!c) return;
      const { auth: _x, ...rest } = c;
      set({
        addAccount: {
          ...rest,
          saving: false,
          ...patch,
          errors: addErrors(c.draft, state.accounts).errors,
        },
      });
    };
    /** 足せた: 一覧に足して選び、欄を閉じる（下書きのほかの欄・明細・チャートはそのまま。B5） */
    const added = (accounts: AccountRecord[], id: string) => {
      addTried = false;
      accountTaken = null;
      uncertainAccount = null;
      closeAdd();
      // その場で足して選んだ口座も本人が選んだ口座（提案で上書きしない。#66・S10）
      if (state.statement) accountTouched = true;
      const moved = withFxRule({ ...state.draft, accountId: id }, accounts);
      const changed = afterAccountChange(moved, accounts);
      const st = changed.statement ?? state.statement;
      set({
        accounts,
        ...changed,
        ...(st
          ? { statement: { ...st, marks: markEdited(st.marks, 'accountId'), firstTime: false } }
          : {}),
      });
    };
    try {
      let res: Response;
      try {
        res = await request('/api/accounts', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (kindOf(e) === 'network') uncertainAccount = key;
        throw e;
      }
      if (res.status === 409) {
        // 前の [足す] が届いていた（時間切れ・通信の失敗の後）なら、その口座を足せたものとして選ぶ
        const wasUncertain = uncertainAccount === key;
        uncertainAccount = null;
        const list = await getJson<{ items: AccountRecord[] }>(await request('/api/accounts'), 200);
        if (!Array.isArray(list.items)) throw new Failed('other');
        const accounts = sortAccounts(list.items);
        const hit = accounts.find((a) => nameKeyOf(a.name) === key);
        if (wasUncertain && hit) {
          added(accounts, hit.id);
          return;
        }
        accountTaken = key;
        set({ accounts });
        finish({ message: null });
        return;
      }
      const created = await getJson<AccountRecord>(res, 201);
      added(sortAccounts([...state.accounts, created]), created.id);
    } catch (e) {
      const kind = kindOf(e);
      finish(
        kind === 'auth'
          ? { message: AUTH_EXPIRED, auth: true }
          : { message: kind === 'network' ? ACCOUNT_ADD_NETWORK_FAILED : ACCOUNT_ADD_FAILED },
      );
    }
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    load,
    openAddAccount() {
      if (state.phase !== 'editing' || state.addAccount) return;
      addTried = false;
      accountTaken = null;
      set({
        addAccount: { draft: EMPTY_NEW_ACCOUNT, errors: {}, saving: false, message: null },
      });
    },
    closeAddAccount() {
      if (!state.addAccount || state.addAccount.saving) return;
      addTried = false;
      accountTaken = null;
      closeAdd();
      set({});
    },
    setNewAccount(field, value) {
      const cur = state.addAccount;
      if (!cur || cur.saving) return;
      if (field === 'name' && value.trim() === '') addTried = false;
      setAdd({ draft: { ...cur.draft, [field]: value }, message: null });
    },
    addAccount() {
      if (addingAccount) return addingAccount;
      const p = doAddAccount().finally(() => {
        addingAccount = null;
      });
      addingAccount = p;
      return p;
    },
    update(action) {
      if (state.phase !== 'editing') return;
      // チャートの時間足を利用者が選んだ: 後で届く読み取りで上書きせず、読み取りの印と知らせを消す（#27）
      if (action.type === 'set') {
        for (const slot of ['entry', 'exit'] as const) {
          if (action.field !== CHART_TIMEFRAME_FIELD[slot]) continue;
          slots.touch(slot, action.value as Timeframe | null);
          state = { ...state, ...slots.view() };
        }
      }
      const st = state.statement;
      // 口座・銘柄を替えて為替が意味を失ったら、打った為替を空にする（#47 PR-2。fxStale の規則）
      const nextDraft = withFxRule(
        applyDraft(state.draft, action),
        state.accounts,
        action.type === 'set' && action.field === 'fxRate',
      );
      // 削除の後に本人が選んだ答え・口座も、［元に戻す］・次の明細の提案で上書きしない（#184 R2）
      if (!st && undoSnap && action.type === 'set') {
        if (action.field === 'accountId') accountTouched = true;
        else touched.add(action.field);
      }
      if (st && action.type === 'set' && action.field === 'accountId') {
        // 口座は読み取りの欄ではない（触った欄に入れない）。通貨が変われば損益・手数料を合わせる。
        // 本人が選んだので、この明細では提案を使わず、印「自動で選択」は外す（「直した」にはしない。#66・R4・S3）
        accountTouched = true;
        const moved = afterAccountChange(nextDraft, state.accounts);
        const base = moved.statement ?? st;
        const marks = markEdited(base.marks, 'accountId');
        set({
          ...moved,
          statement: { ...base, marks, firstTime: false },
          error: null,
          readBlocked: null,
          chartBlocked: null,
        });
        return;
      }
      if (st && action.type === 'set') {
        touched.add(action.field);
        const marks = markEdited(st.marks, action.field);
        set({
          draft: nextDraft,
          error: null,
          readBlocked: null,
          chartBlocked: null,
          ...(marks === st.marks ? {} : { statement: { ...st, marks } }),
        });
        return;
      }
      set({
        draft: nextDraft,
        error: null,
        readBlocked: null,
        chartBlocked: null,
      });
    },
    save() {
      if (inflight) return inflight;
      const p = doSave().finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    next,
    readImage,
    setChart,
    removeChart,
    addExtraChart() {
      if (state.phase === 'saved') next();
      if (state.phase !== 'editing') return null;
      if (uncertain !== null) {
        set({ chartBlocked: CHART_LOCKED });
        return null;
      }
      state = { ...state, error: null, chartBlocked: null };
      return slots.addExtra();
    },
    setExtraTimeframe(slot, value) {
      if (state.phase !== 'editing') return;
      slots.setExtraTimeframe(slot, value);
    },
    setExtraNote(slot, note) {
      if (state.phase !== 'editing') return;
      slots.setExtraNote(slot, note);
    },
    cancelRead() {
      const st = state.statement;
      if (!st || (st.phase !== 'preparing' && st.phase !== 'reading')) return;
      // 別の明細の読み直しなら、選ぶ前の明細の状態に戻す（#184 R6）
      const snap = rollback;
      if (snap) {
        rollback = null;
        restore(snap, { kind: 'cancelled' });
        set({ readCancelled: true });
        pump();
        return;
      }
      endStatement();
      // 明細の行に「読み取りをキャンセルしました」を出す（読み取りの値・画像は捨てたまま。#166 R1）
      set({ readCancelled: true });
      pump();
    },
    removeStatement() {
      const st = state.statement;
      if (state.phase !== 'editing' || st?.phase !== 'ready') return;
      dropUndo();
      const snap = takeSnap(st);
      undoSnap = snap;
      detachStatement();
      set({
        draft: snap.stripped,
        error: null,
        readBlocked: null,
        readCancelled: false,
        statementRemoved: true,
      });
    },
    undoRemoveStatement() {
      const snap = undoSnap;
      if (!snap || state.phase !== 'editing' || state.statement) return;
      undoSnap = null;
      restore(snap);
    },
    acceptChartTimeframe(slot) {
      const c = state.charts?.[slot];
      if (state.phase !== 'editing' || !c?.readSuggest) return;
      state = { ...state, error: null };
      slots.accept(slot);
    },
    chooseTimeZone(id) {
      const st = state.statement;
      const tz = st?.tz;
      if (st?.phase !== 'ready' || !tz || state.phase !== 'editing') return;
      const row = st.rows[st.index];
      if (!row) return;
      const a = applyZone(state.draft, st.marks, row, id, tz.fields);
      if (a.gaps.length > 0) {
        // その時間帯に無い時刻: 欄は変えず、理由を出す（Z5）。覚えない
        set({ statement: { ...st, tz: { ...tz, gap: id } } });
        return;
      }
      statementZone = id;
      try {
        deps.zoneMemory?.write(id);
      } catch {
        // 覚えられなくてもその場では当てる
      }
      set({
        draft: row.legs
          ? { ...a.draft, legs: legsWithZone(a.draft.legs, st.raw ?? [], id) }
          : a.draft,
        statement: {
          ...st,
          marks: a.marks,
          tz: { ...tz, choice: id, remembered: false, otherOpen: isOtherZone(id), gap: null },
        },
      });
    },
    openOtherZones() {
      const st = state.statement;
      const tz = st?.tz;
      if (st?.phase !== 'ready' || !tz || state.phase !== 'editing' || tz.otherOpen) return;
      const row = st.rows[st.index];
      if (!row) return;
      const u = unapplyZone(state.draft, st.marks, row, tz.fields);
      set({
        draft: row.legs
          ? { ...u.draft, legs: legsWithZone(u.draft.legs, st.raw ?? [], null) }
          : u.draft,
        statement: {
          ...st,
          marks: u.marks,
          tz: { ...tz, choice: null, remembered: false, otherOpen: true, gap: null },
        },
      });
    },
    skipRow() {
      const st = state.statement;
      if (st?.phase !== 'ready' || state.phase !== 'editing') return;
      if (st.index + 1 < st.rows.length) {
        showRow(st, st.index + 1, rowSkipped(st.index, st.rows.length, rowUnitOf(st)));
        return;
      }
      // 最後の行を飛ばした: 読み取りを終えて、空の下書き（既定 = 今保存した取引か開いたとき）に戻す
      endStatement();
      clearCharts();
      set({
        error: null,
        manual: false,
        stage: 'input',
        ...withBaseline(
          applyDraft(EMPTY_DRAFT, {
            type: 'reset',
            values: { ...defaults, exitTime: toLocalInput(floorToMinute(now())) },
          }),
        ),
        statement: {
          phase: 'done',
          rows: [],
          index: 0,
          marks: {},
          message: null,
          notice: ROWS_DONE,
          preview: null,
        },
      });
    },
    splitLeg(legIndex) {
      const st = state.statement;
      if (st?.phase !== 'ready' || state.phase !== 'editing' || !st.raw || !st.units) return;
      const leg = state.draft.legs[legIndex];
      if (leg?.read === undefined) return;
      const units = splitUnit(st.raw, st.units, st.index, leg.read.raw);
      if (units === null) return;
      regroup(st, units, POSITION_SPLIT(st.index + 2, units.length));
    },
    mergeNextPosition() {
      const st = state.statement;
      if (st?.phase !== 'ready' || state.phase !== 'editing' || !st.raw || !st.units) return;
      const j = nextPositionIndex(st.raw, st.units, st.index);
      const units = mergeNext(st.raw, st.units, st.index);
      if (j === null || units === null) return;
      regroup(st, units, POSITION_MERGED(st.units[j]?.length ?? 0));
    },
    startManual() {
      if (state.phase !== 'editing') return;
      if (state.manual === true && state.stage === 'review') return;
      // キャンセルの文は手入力の要約に持ち込まない（#166）
      set({ manual: true, stage: 'review', readCancelled: false });
    },
    setStage(stage) {
      if (state.phase !== 'editing' || state.stage === stage) return;
      set({ stage });
    },
    refreshWarm() {
      if (!warmMissed && warmSentAt !== null && now() - warmSentAt < WARM_REFRESH_MS) return;
      warm();
    },
    setOnScreen(on) {
      onScreen = on;
      // 画面を離れた（✕ を含む）ら削除の ［元に戻す］ は終わり、画像を捨てる（#184 R4）
      if (!on && undoSnap) {
        dropUndo();
        set({});
      }
    },
    dispose() {
      disposed = true;
      dropUndo();
      endStatement();
      clearCharts();
    },
  };
}
