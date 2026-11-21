// 記録する画面の形（#130。2026-11-21 に 2 段へ。設計書 0.4 K17・9.2 の記録するの行・docs/ui-guidelines.md 9.4）の純関数。DOM なし。
// - 同じ全画面のシートの中の 2 つの段: 1 段目「スクショを入れる」（明細・チャートの絵の枠）→ 2 段目「振り返る」（要約・LC 以下）。
//   ［次へ］ は置かず、明細を選ぶ・［明細なしで手入力］ が段を進める（読み取りを待たない。C23）
// - 明細の場所は同じ場所で 3 つの状態が入れ替わる: 選ぶ前（pick）・読み取り中（reading）・読み取りの後（summary）
// - 読み取りの後（と ［明細なしで手入力］ の後）は、取引の欄を 3 行の要約（名前 / 向き・数量・イン → 決済 / 決済の時刻・明細の損益。何も切らない。#164）に畳み、読めなかった・未入力・誤りの欄を名指す
//   （7.5 の「確かめずに記録へ入る経路は無い」を、要約が常に見えていることと名指しで守る。K17）
// - 判定は下の帯に 1 行（押すと判定のシート）。タイムゾーンが未選択なら押せない理由を 1 行に出す（保存の門は 7.5 のまま）
// - 読み取りが終わったとき、どの欄にもフォーカスが無ければ LC へ移す（入力中の欄から奪わない）
import type { Grade } from '../../../core/judge';
import type { AnySlot } from './charts';
import { formatMoney, formatPrice, formatQuantity } from './format';
import { hasYearInferred } from './legs-form';
import type { RecordPhase } from './record-controller';
import {
  type Draft,
  type DraftField,
  type DraftReading,
  FIELD_LABEL,
  parseNum,
} from './record-form';
import type { FieldMark, Marks } from './statement-fill';
import { submitStatus } from './verdict-notes';

export type StatementArea = 'pick' | 'reading' | 'summary';

/** 明細の読み取りの段（controller の StatementPhase と同じ値。層の向きを純関数 ← controller にするため、ここで受ける形だけ書く） */
export type StatementPhaseLike = 'preparing' | 'reading' | 'ready' | 'failed' | 'done';

/**
 * 明細の場所の状態: 読み取り中 → reading、読めた行がある・［明細なしで手入力］ を押した・取引の欄（L / S・イン・決済）に値が
 * ある → summary、ほか → pick。取引の値があるのに選ぶ前へ戻すと、要約が見えないまま記録できてしまう（2 枚目の読み取りの
 * 失敗・キャンセルの後。7.5 の「確かめずに記録へ入る経路は無い」。#130 のレビュー B1）。開いたときに既定で入る銘柄・数量・
 * 決済の時刻は数えない
 */
export function statementArea(s: {
  readonly statement?: { readonly phase: StatementPhaseLike } | undefined;
  readonly manual?: boolean | undefined;
  readonly draft?: Pick<Draft, 'side' | 'entryPrice' | 'exitPrice'> | undefined;
}): StatementArea {
  const phase = s.statement?.phase;
  if (phase === 'preparing' || phase === 'reading') return 'reading';
  if (phase === 'ready' || s.manual === true) return 'summary';
  const d = s.draft;
  if (d && (d.side !== null || d.entryPrice.trim() !== '' || d.exitPrice.trim() !== ''))
    return 'summary';
  return 'pick';
}

/** 要約に畳む取引の欄（要約が名指しする欄。画面の並びの順） */
export const SUMMARY_FIELDS = [
  'instrumentName',
  'side',
  'quantity',
  'entryPrice',
  'exitPrice',
  'exitTime',
] as const satisfies readonly DraftField[];

export type SummaryField = (typeof SUMMARY_FIELDS)[number];

/** 要約の行には出さないが、誤りなら名指す取引の欄（取引の欄のシートの中。#130 のレビュー N4） */
export const NAMED_EXTRA_FIELDS = [
  'fxRate',
  'entryTime',
  // 明細のポジションでその場で足すオプションの銘柄の乗数（#118）
  'instrumentMultiplier',
] as const satisfies readonly DraftField[];

export type NamedFieldId = SummaryField | (typeof NAMED_EXTRA_FIELDS)[number];

/** 名指しの種類: 誤り / 読み取れなかった / 未入力 */
export type NamedKind = 'error' | 'unread' | 'missing';

export interface NamedField {
  readonly field: NamedFieldId;
  readonly label: string;
  readonly kind: NamedKind;
}

export interface TradeSummary {
  /**
   * 1 行目: 銘柄の名前だけ（無ければ「—」）。切らずに折り返す（#164。「ミニ日経225先物 26/12」が「…」で切れて意味が
   * 分からなかった）
   */
  readonly name: string;
  /** 限月の年を補ったまま（本人が直していない）のレッグがある（注意の札。#118 のデザインレビュー 1） */
  readonly yearInferred?: boolean;
  /** 2 行目: 「L · 数量 1 · イン 100 → 決済 99.2」（オプションの形は「L · レッグ 2 · 原資産 イン … → 決済 …」） */
  readonly line2: string;
  /**
   * 2 行目を折り返してよい所で分けたもの（間は空白 1 つ。join(' ') で line2）。区切りの「·」「→」は前の塊の末尾に付け、
   * 折り返した行の頭に来ないようにする（#164 のレビュー）
   */
  readonly line2Parts: readonly string[];
  /** 3 行目: 「3/4 10:00 決済」と、明細の損益が読めていれば「· 明細の損益 −800円」（時刻を先に書き、2 行目の価格と分ける） */
  readonly line3: string;
  readonly line3Parts: readonly string[];
  /** 明細の損益（口座の通貨の書き方）。3 行目の最後の塊の数の部分（画面は数だけ 1 段強く） */
  readonly pnl?: string;
  /** 読み上げの文（「L、数量 1、イン 100、決済 99.2、3/4 10:00 決済、明細の損益 −800円」。記号「·」「→」を読ませない） */
  readonly spoken: string;
  /** 読み取りの値が入っている（印「読み取り」） */
  readonly read: boolean;
  /** 名指す欄（誤り → 読み取れなかった → 未入力の順は問わず、画面の並びの順） */
  readonly named: readonly NamedField[];
}

const DASH = '—';

/** 欄の文字を要約の数に（読めれば 3 桁区切り、読めなければ打ったまま） */
function numText(raw: string, fmt: (n: number) => string): string {
  const t = raw.trim();
  if (t === '') return DASH;
  const p = parseNum(t);
  // 読めない値は出さない（誤りは名指しのチップに任せる。#130 のデザインレビュー a5）
  return p.ok ? fmt(p.value) : DASH;
}

/** 決済の時刻の要約（端末の時刻の欄 YYYY-MM-DDTHH:mm は「M/D HH:mm」。タイムゾーンの無い書かれた時刻はそのまま） */
export function timeText(raw: string): string {
  const t = raw.trim();
  if (t === '') return DASH;
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}`;
}

const READ_MARKS: readonly FieldMark[] = ['read', 'edited', 'tz', 'unread'];

/** 取引の欄の 3 行の要約（名前 / 向き・数量・イン → 決済 / 決済の時刻・明細の損益）と、名指す欄 */
export function tradeSummary(
  draft: Draft,
  errors: DraftReading['errors'],
  marks: Marks,
  /**
   * オプションの形（#117。readDraft の option）。渡すと数量の代わりにレッグの本数、L / S は自動の向き（出ないときだけ名指す）
   */
  option?: DraftReading['option'],
  /** 口座の通貨（明細の損益の書き方。省いたら JPY） */
  currency = 'JPY',
): TradeSummary {
  const name =
    draft.instrumentName.trim() === '' || errors.instrumentName !== undefined
      ? DASH
      : draft.instrumentName.trim();
  const side =
    (option ? (option.autoSide ?? (option.askSide ? draft.side : null)) : draft.side) ?? DASH;
  const qty = numText(draft.quantity, formatQuantity);
  const entry = numText(draft.entryPrice, formatPrice);
  const exit = numText(draft.exitPrice, formatPrice);
  // 見出しを付ける（「100 → 99.2」だけでは何の数か分からない。#164）。画面は塊ごとに次の行へ回す（区切りは塊の末尾）
  const size = option ? `レッグ ${draft.legs.length}` : `数量 ${qty}`;
  const inLabel = option ? '原資産 イン' : 'イン';
  const line2Parts = [`${side} ·`, `${size} ·`, `${inLabel} ${entry} →`, `決済 ${exit}`];
  const time = errors.exitTime !== undefined ? DASH : timeText(draft.exitTime);
  const pnl = pnlText(
    draft.pnlYen,
    errors.pnlYen !== undefined || option?.legsEdited === true,
    currency,
  );
  const at = `${time} 決済`;
  const line3Parts = pnl === null ? [at] : [`${at} ·`, `明細の損益 ${pnl}`];
  const say = (t: string) => (t === DASH ? '未入力' : t);
  const spoken = [
    say(side),
    option ? size : `数量 ${say(qty)}`,
    `${inLabel} ${say(entry)}`,
    `決済 ${say(exit)}`,
    time === DASH ? '決済の時刻 未入力' : at,
    ...(pnl === null ? [] : [`明細の損益 ${pnl}`]),
  ].join('、');
  const named: NamedField[] = [];
  for (const f of SUMMARY_FIELDS) {
    // オプションの形は数量を聞かず、L / S は自動の向きが出ないときだけ聞く
    if (option && (f === 'quantity' || (f === 'side' && !option.askSide))) continue;
    const label = FIELD_LABEL[f];
    if (errors[f] !== undefined) named.push({ field: f, label, kind: 'error' });
    else if (isEmpty(draft, f)) {
      named.push({ field: f, label, kind: marks[f] === 'unread' ? 'unread' : 'missing' });
    }
  }
  for (const f of NAMED_EXTRA_FIELDS) {
    if (errors[f] !== undefined) named.push({ field: f, label: FIELD_LABEL[f], kind: 'error' });
  }
  // その場で足すオプションの銘柄の乗数（推さない = 空なら未入力として名指す。#118）
  if (
    option?.newInstrument !== undefined &&
    errors.instrumentMultiplier === undefined &&
    draft.instrumentMultiplier.trim() === ''
  ) {
    named.push({
      field: 'instrumentMultiplier',
      label: FIELD_LABEL.instrumentMultiplier,
      kind: 'missing',
    });
  }
  const read = SUMMARY_FIELDS.some((f) => READ_MARKS.includes(marks[f] as FieldMark));
  return {
    name,
    line2: line2Parts.join(' '),
    line2Parts,
    line3: line3Parts.join(' '),
    line3Parts,
    ...(pnl === null ? {} : { pnl }),
    spoken,
    read,
    named,
    ...(option && hasYearInferred(draft.legs) ? { yearInferred: true } : {}),
  };
}

/** 明細の損益（読めて誤りが無いときだけ。無い・読めない・レッグを直して使わないときは出さない = null） */
function pnlText(raw: string, skip: boolean, currency: string): string | null {
  const t = raw.trim();
  if (skip || t === '') return null;
  const p = parseNum(t);
  return p.ok ? formatMoney(p.value, currency) : null;
}

function isEmpty(d: Draft, f: SummaryField): boolean {
  if (f === 'side') return d.side === null;
  return d[f].trim() === '';
}

/** 名指しの文（「未入力: 決済」「読み取れませんでした: 数量」「誤り: イン」）の頭の言葉 */
export const NAMED_LEAD: Readonly<Record<NamedKind, string>> = {
  error: '誤り',
  unread: '読み取れませんでした',
  missing: '未入力',
};

/** 名指しのチップの読み上げの名前（押すと取引の欄のシートがその欄で開く） */
export function namedLabel(n: NamedField): string {
  return `${NAMED_LEAD[n.kind]}: ${n.label}（取引の欄を開く）`;
}

/** タイムゾーンの状態の形（controller の TzState の受ける所だけ） */
export interface TzLike {
  readonly fields: readonly ('exitTime' | 'entryTime')[];
  readonly choice: string | null;
  readonly remembered: boolean;
  readonly gap: string | null;
}

/**
 * タイムゾーンの確かめを出すか（利用者が欄を直していない、印が tz か選んだタイムゾーンで入れた read の欄がある）。
 * choose = 未選択（要約の行に印と ［タイムゾーンを選ぶ］。保存できない）、chosen = 選んだ・覚えで入れた（［タイムゾーンを選ぶ］ だけ）
 */
export function timeZoneNeed(tz: TzLike | undefined, marks: Marks): 'choose' | 'chosen' | null {
  if (!tz) return null;
  const visible = tz.fields.some((f) => marks[f] === 'tz' || marks[f] === 'read');
  if (!visible) return null;
  const pending = tz.fields.some((f) => marks[f] === 'tz');
  return pending ? 'choose' : 'chosen';
}

/** 要約の行の印と、判定の 1 行の理由 */
export const TZ_PENDING = {
  /** 要約の行の印（保存できない理由を状態の言葉で。ボタンと同じ言葉を 2 回出さない。#130 のデザインレビュー a6） */
  mark: '時刻が未確定',
  button: 'タイムゾーンを選ぶ',
  line: 'タイムゾーンが未選択',
} as const;

export type VerdictLine =
  | {
      readonly kind: 'judged';
      readonly grade: Grade;
      readonly r?: number;
      readonly riskPct?: number;
    }
  | { readonly kind: 'status'; readonly text: string };

/**
 * 下の帯の判定の 1 行。読み取り中・チャートの準備中の知らせ → タイムゾーンが未選択 → 誤り・あと n 欄 → 判定（バッジ・R・
 * リスク）。押すと判定のシート（中身は今の判定の枠）
 */
export function verdictLine(
  read: DraftReading,
  errorLabels: readonly string[],
  tzPending: boolean,
): VerdictLine {
  if (read.notice) return { kind: 'status', text: submitStatus(read, errorLabels) };
  if (tzPending) return { kind: 'status', text: TZ_PENDING.line };
  const j = read.preview.judgment;
  if (errorLabels.length > 0 || read.missing.length > 0 || !j) {
    // 欄はそろっているのに判定が出ない（計算できない取引）ときは、数ではなく中立の文（#130 のレビュー N5）
    return { kind: 'status', text: submitStatus(read, errorLabels) || '判定を見る' };
  }
  return {
    kind: 'judged',
    grade: j.grade,
    ...(read.preview.r === undefined ? {} : { r: read.preview.r }),
    ...(read.preview.riskPct === undefined ? {} : { riskPct: read.preview.riskPct }),
  };
}

/**
 * 読み取りが終わったとき LC へフォーカスを移すか: 読み取り中（preparing / reading）→ 読めた（ready）に移り、フォーカスが
 * どの入力の欄にも無いときだけ（入力中の欄から奪わない。9.4）
 */
export function focusLcAfterRead(
  before: StatementPhaseLike | undefined,
  after: StatementPhaseLike | undefined,
  focus: 'field' | 'none',
): boolean {
  const wasReading = before === 'preparing' || before === 'reading';
  return wasReading && after === 'ready' && focus === 'none';
}

/** 開いているシート（RecordScreen が持つ。View は受けて描くだけ） */
export type RecordSheet =
  | {
      readonly kind: 'fields';
      /**
       * main = 取引の欄、more = ほかの欄（任意。同じシートの次の段）、leg = レッグ 1 本の欄（#117。同じシートの次の段。
       * 同時に開くのは 1 本。設計書 7.6）
       */
      readonly step: 'main' | 'more' | 'leg';
      /** step = leg のときのレッグの並びの番号（0 から） */
      readonly leg?: number;
      /** 開いたときにフォーカスする欄（要約の名指しから開いた） */
      readonly focus?: DraftField;
    }
  | { readonly kind: 'tz' }
  | { readonly kind: 'verdict' }
  | { readonly kind: 'chart' }
  /** 保存の後のシート「記録しました」（心理のタグ。#156・設計書 9.4） */
  | { readonly kind: 'emotion' };

/** シートの ID（dialog の id。開いたボタンの aria-controls） */
export const SHEET_ID = {
  fields: 'record-fields-sheet',
  tz: 'record-tz-sheet',
  verdict: 'record-verdict-sheet',
  chart: 'record-chart-sheet',
  emotion: 'record-emotion-sheet',
} as const;

/**
 * 保存の後のシートを開くか（#156 R4・AC-4）: 保存の後（saved）に移ったときだけ = 記録の保存のたびに 1 度。複数行の明細は
 * 途中の行の保存では editing のまま次の行へ進むので開かず、最後の行の後に 1 度だけ。保存の後のまま画面に戻った（借り直した）
 * ときは移りが無いので開かない
 */
export function opensEmotionSheet(before: RecordPhase, after: RecordPhase): boolean {
  return before !== 'saved' && after === 'saved';
}

/** 取引の欄のシートで、名指した欄へフォーカスする要素の id（L / S は Segment の先頭の radio を画面が探す） */
export const FIELD_INPUT_ID: Readonly<Record<NamedFieldId | 'accountId', string>> = {
  instrumentName: 'record-instrument',
  side: 'record-side',
  quantity: 'record-quantity',
  entryPrice: 'record-entry',
  exitPrice: 'record-exit',
  exitTime: 'record-exit-time',
  fxRate: 'record-fx',
  entryTime: 'record-entry-time',
  instrumentMultiplier: 'record-new-multiplier',
  accountId: 'record-account',
};

/** 小さなチャートの枠の 2 行目（時間足・読み取り中・読めた値の案） */
export function chartSlotLine(c: {
  readonly hasChart: boolean;
  readonly preparing: boolean;
  readonly reading: boolean;
  readonly failed: boolean;
  readonly timeframe: string | null;
  readonly suggest: string | null;
  /**
   * 編集の画面の変えた枠の印（「差し替え済み」「追加（未保存）」「削除（未保存）」。ChartPanel の changeMark。#131）。
   * あれば読み取りの途中・案より先に出す（保存で何が変わるかを 2 枠の上で言う）
   */
  readonly change?: string | null;
}): string {
  if (c.preparing) return '準備しています…';
  if (c.change) return c.change;
  if (!c.hasChart) return c.failed ? '使えない画像です' : 'チャートを選ぶ';
  if (c.reading) return '時間足を読み取り中…';
  if (c.suggest) return `チャートからは ${c.suggest}`;
  return c.timeframe ?? '時間足 指定なし';
}

/** 小さなチャートの枠の id（シートの中の今の枠 `record-chart-<slot>` とは別。編集の画面は接頭辞 edit。#131） */
export const miniChartId = (slot: AnySlot, prefix = 'record') => `${prefix}-mini-${slot}`;
/** 記録する画面の段: input = 1 段目「スクショを入れる」、review = 2 段目「振り返る」（2026-11-21。K17） */
export type RecordStage = 'input' | 'review';

/** 今の段（controller が持つ。省けば振り返る段 = 状態だけを描くテスト） */
export function stageOf(s: { readonly stage?: RecordStage | undefined }): RecordStage {
  return s.stage ?? 'review';
}

/**
 * 2 段目の明細の行の状態: 読み取り中 / 要約 / やり直し（失敗・キャンセルで取引の値が無い。選ぶ枠は 1 段目だけなので、
 * 理由と ［スクショを選ぶ］・［手入力で続ける］ を出す。要約を通らずに記録できる経路は作らない = 7.5）
 */
export type StatementRow = 'reading' | 'summary' | 'retry';

export function statementRow(s: Parameters<typeof statementArea>[0]): StatementRow {
  const a = statementArea(s);
  return a === 'pick' ? 'retry' : a;
}

/** 1 段目の明細の枠: 空（絵と ［スクショを選ぶ］）か、入った（実物の写しと状態の文と ［スクショを変更］） */
export type Stage1Statement =
  | { readonly kind: 'empty' }
  | { readonly kind: 'filled'; readonly text: string };

export function stage1Statement(
  st:
    | {
        readonly phase: StatementPhaseLike;
        readonly rows: { readonly length: number };
        /** 応答の行（オプションのレッグをポジションにまとめる前。#118）。省けば rows */
        readonly raw?: { readonly length: number } | undefined;
      }
    | undefined,
): Stage1Statement {
  if (!st || st.phase === 'done' || st.phase === 'failed') return { kind: 'empty' };
  if (st.phase === 'preparing' || st.phase === 'reading')
    return { kind: 'filled', text: '読み取り中…' };
  const n = st.raw?.length ?? st.rows.length;
  // オプションのポジションにまとめた明細は「件」で数える（2 段目の「1 / 2 件目」と揃える。#118 のデザインレビュー 6）
  if (st.raw !== undefined && st.raw.length !== st.rows.length) {
    return { kind: 'filled', text: `${st.rows.length} 件（明細の ${n} 行）を読み取りました` };
  }
  return {
    kind: 'filled',
    text: n >= 2 ? `${n} 行を読み取りました` : '読み取りました',
  };
}

/** 1 段目で読み取りの途中か（［読み取りをキャンセル］ を出す。読み取り中に 1 段目へ戻ってもやめられる。2 段化のレビュー指摘 2） */
export function stage1Reading(st: { readonly phase: StatementPhaseLike } | undefined): boolean {
  return st?.phase === 'preparing' || st?.phase === 'reading';
}

/** 1 段目の下に ［振り返りへ進む］ を出すか（2 段目に見せる要約があるとき。無ければ ［明細なしで手入力］） */
export function showProceed(s: Parameters<typeof statementArea>[0]): boolean {
  return statementArea(s) !== 'pick';
}

/** チャートの枠の状態（chartSlotLine の入力と同じ形） */
export type ChartLike = Parameters<typeof chartSlotLine>[0];

/**
 * 2 段目のチャートの行: 空 = 押すとエントリー時のチャートを選ぶ（1 タップ。準備中・失敗は状態の文）、
 * 入った = 「エントリー時 · 時間足」と決済時の 1 行（押すとチャートのシート）
 */
export type ChartRow =
  | { readonly kind: 'empty'; readonly status: string | null }
  | { readonly kind: 'full'; readonly line1: string; readonly line2: string };

export function chartRow(c: {
  readonly entry: ChartLike;
  readonly exit: ChartLike;
  readonly extras: number;
}): ChartRow {
  const { entry, exit } = c;
  if (!entry.hasChart && !exit.hasChart && c.extras === 0) {
    const status = entry.preparing || entry.failed ? chartSlotLine(entry) : null;
    return { kind: 'empty', status };
  }
  const line1 = `エントリー時 · ${entry.hasChart ? chartSlotLine(entry) : '未選択'}`;
  const exitText =
    exit.hasChart || exit.preparing
      ? `決済時 · ${chartSlotLine(exit)}`
      : '決済時のチャートも追加できます';
  const line2 = c.extras > 0 ? `${exitText} · 追加 ${c.extras} 枚` : exitText;
  return { kind: 'full', line1, line2 };
}

/**
 * 2 段目の明細の行の状態の文（#166。設計書 7.5・ui-guidelines 9.4 の状態 2）: 読み取り中 → 「読み取り中…」、読めた → 完了の文
 * （前半は 1 段目の明細の枠と同じ件数の言い方。要約が名指す欄が 1 つ以上なら「 · 入力が必要な欄 n」）、キャンセル →
 * 「読み取りをキャンセルしました」、ほか（失敗 = 決まった文言の警告・次の行の知らせ・手入力）→ null。完了の文は読めた
 * 最初の行で知らせ（「1 / 2 行目を記録しました…」など）が無い間だけ（R4・R5。次の行へ進んだら知らせに替わる）。
 * 名指す欄の数は今の要約から数える（欄を埋めると減り、0 で後ろが外れる）
 */
export type StatementStatus = {
  readonly kind: 'reading' | 'done' | 'cancelled';
  readonly text: string;
  /** 完了の文の「入力が必要な欄」の数（kind = done のとき。1 以上なら印をチェックでなく中立の「!」にする。#166 のデザインレビュー 2） */
  readonly need?: number;
} | null;

export const READ_CANCELLED = '読み取りをキャンセルしました';

export function statementStatus(
  st:
    | (Parameters<typeof stage1Statement>[0] & {
        readonly index: number;
        readonly notice: string | null;
      })
    | undefined,
  named: number,
  /** 読み取り中に ［キャンセル］ を押した（controller の readCancelled） */
  cancelled = false,
): StatementStatus {
  if (!st) return cancelled ? { kind: 'cancelled', text: READ_CANCELLED } : null;
  if (st.phase === 'preparing' || st.phase === 'reading')
    return { kind: 'reading', text: '読み取り中…' };
  if (st.phase !== 'ready' || st.index !== 0 || st.notice !== null) return null;
  const s1 = stage1Statement(st);
  if (s1.kind !== 'filled') return null;
  return {
    kind: 'done',
    text: named > 0 ? `${s1.text} · 入力が必要な欄 ${named}` : s1.text,
    need: named,
  };
}

/**
 * 明細の行の 1 回だけの動き（#166 R3）: 読み取り中から読めた・失敗したへ移ったときだけ true。キャンセル（利用者が押した）・
 * ほかの移りは false
 */
export function readFinished(
  before: StatementPhaseLike | undefined,
  after: StatementPhaseLike | undefined,
): boolean {
  const wasReading = before === 'preparing' || before === 'reading';
  return wasReading && (after === 'ready' || after === 'failed');
}
