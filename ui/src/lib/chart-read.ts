// チャートの時間足の表示の読み取り（Issue #27。設計書 7.5・K9・K11・C38）の純関数。DOM・通信・端末の保存先に触れない。
// - チャートを枠に入れたら（描き直しの後）、追加の操作なしで POST /api/chart-reads に送る（record-controller.ts）
// - 応答は「チャートか」と時間足（9 つの列挙か null）だけ。形の外は失敗として扱う（値を画面に反射しない）
// - 枠の時間足が空で、利用者がその枠の時間足を触っていないときだけ読んだ値で埋め、印「チャートから」を付ける。
//   利用者が違う値を選んでいれば上書きせず、読めた値を案として出す（1 タップで直せる）
// - 失敗・読めない・チャートでないは決まった文言で知らせ、時間足は空のまま（手で選べる・選ばずに記録できる）
// - 3 つ目のタップ「時間足を変えたか」とチャートの時間足の違いが食い違うときは、責めずに事実として並べる文を作る
import type { Reason } from '../../../core/judge';
import { TIMEFRAMES, type Timeframe, type TimeframeChange } from '../../../core/trade';
import { TIMEFRAME_NAME } from './reasons';
import { readFailureOf } from './statement-fill';

export const CHART_READ_PATH = '/api/chart-reads';
/** 読み取りの要求の時間の上限（明細の読み取りと同じ。API の締め切り 20 秒 + 後始末 + 余裕） */
export const CHART_READ_TIMEOUT_MS = 30_000;

/** 読んだ値で埋めた欄の印（ラベルと並べて幅 360px でも折り返さない長さ） */
export const CHART_READ_MARK = 'チャートから';

/**
 * 送る前の注意（チャートを送れる所に常に出す 1 行。C38 の同意の代わりなので畳まない）。何のために送るか・記録と一緒に保存
 * することは、横の「i」の中（CHART_SEND_INFO。#251・設計書 C70）。明細の注意とは主語を分ける
 */
export const CHART_READ_NOTICE = 'チャートは AI（Anthropic）に送ります。';

/** 送る前の注意の「i」（言葉「チャートの送り方」。説明のシートの ID は `record-` で始めない） */
export const CHART_SEND_INFO = {
  label: 'チャートの送り方',
  body: [
    '時間足を読むため、チャートを AI の提供元（Anthropic）に送ります。',
    'チャートの画像は記録と一緒に保存します。',
  ],
  id: 'info-chart-send',
} as const;

export const CHART_READ_MSG = {
  /** 時間足の読み取り中の帯の文（読み取りを待たずに記録できる。幅 360px でボタンと並べて 1 行。読み取り中は枠に出す） */
  reading: '待たずに記録できます',
  noTimeframe: '時間足を読み取れませんでした。必要なら選んでください。',
  notChart: 'チャートとして読み取れませんでした。決済明細なら、この欄の外に貼り付けてください。',
  failed: '時間足を読み取れませんでした。必要なら選んでください。',
  unavailable: '今は時間足の読み取りを使えません。必要なら選んでください。',
  limited: '今日の読み取りの上限に達しました。時間足は必要なら選んでください。',
} as const;

export interface ChartReadResult {
  readonly kind: 'chart' | 'not_chart';
  readonly timeframe: Timeframe | null;
}

function isTimeframeValue(v: unknown): v is Timeframe {
  return typeof v === 'string' && (TIMEFRAMES as readonly string[]).includes(v);
}

/** 応答の本文の検査（鍵は kind・timeframe だけ。形の外は null = 失敗） */
export function parseChartReadResponse(json: unknown): ChartReadResult | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('timeframe')) return null;
  if (o.kind !== 'chart' && o.kind !== 'not_chart') return null;
  if (o.timeframe !== null && !isTimeframeValue(o.timeframe)) return null;
  if (o.kind === 'not_chart' && o.timeframe !== null) return null;
  return { kind: o.kind, timeframe: o.timeframe };
}

/** 失敗の状態 → 知らせの文言（401 は呼ぶ側がログインの切れとして扱う） */
export function chartReadFailureMessage(status: number): string {
  const kind = readFailureOf(status);
  if (kind === 'limited') return CHART_READ_MSG.limited;
  if (kind === 'unavailable') return CHART_READ_MSG.unavailable;
  return CHART_READ_MSG.failed;
}

/** 読み取りの結果を枠の時間足にどう反映するか */
export interface ChartReadApply {
  /** 欄に入れる値（undefined = 触らない） */
  readonly value?: Timeframe;
  /** 利用者が違う値を選んでいたときの読めた値（上書きしない。案として出す） */
  readonly suggest?: Timeframe;
  /** 印「チャートから読み取り」を付けるか */
  readonly marked: boolean;
  /** 知らせ（埋めたときは null） */
  readonly note: string | null;
}

/**
 * 結果 → 反映。欄が空で利用者が触っていなければ埋めて印。利用者が選んだ値は上書きしない（印も付けない）。
 * 読めない・チャートでないは欄に触れずに知らせる（利用者が既に選んでいれば知らせない）
 */
export function applyChartRead(
  result: ChartReadResult,
  current: Timeframe | null,
  touched: boolean,
): ChartReadApply {
  const userChose = touched || current !== null;
  if (result.kind === 'not_chart') return { marked: false, note: CHART_READ_MSG.notChart };
  if (result.timeframe === null) {
    return { marked: false, note: userChose ? null : CHART_READ_MSG.noTimeframe };
  }
  if (userChose) {
    return result.timeframe === current
      ? { marked: false, note: null }
      : { marked: false, note: null, suggest: result.timeframe };
  }
  return { value: result.timeframe, marked: true, note: null };
}

/** 時間足の名前を途中で折り返さない形（「4 時間足」の空白を詰めない空白にする。幅 360px で「4 時間 / 足」と切れないように。R6） */
export function tfName(tf: Timeframe): string {
  return TIMEFRAME_NAME[tf].replace(/ /g, '\u00a0');
}

/** 読めた値の案の文（「違います」「誤り」を使わず、読めた値だけを述べる） */
export function suggestText(tf: Timeframe): string {
  return `チャートからは ${tfName(tf)} と読めました`;
}

/** 案を受けるボタンの文 */
export function suggestButton(tf: Timeframe): string {
  return `${tfName(tf)}にする`;
}

const TAP_LABEL: Readonly<Record<Exclude<TimeframeChange, 'longer'>, string>> = {
  none: 'そのまま',
  shorter: '短い足へ',
};

export interface TimeframeConflict {
  /** 判定の理由の 2 行目（「あなたの答え: 変えず ／ チャート: 4 時間足 → 日足」） */
  readonly verdictLine: string;
  /** タップの欄の下の 1 行（「チャートでは 4 時間足 → 日足」） */
  readonly tapHint: string;
}

/**
 * 3 つ目のタップの答えとチャートの時間足の違いの食い違い（答えが「変えず」「短い足へ」なのに、チャートの時間足が長い足へ
 * 変わっている）。食い違わない・答えていない・チャートの理由が無いときは null。どちらを正とするかは迫らない
 */
export function timeframeConflict(
  tap: TimeframeChange | null | undefined,
  reasons: readonly Reason[],
): TimeframeConflict | null {
  if (tap !== 'none' && tap !== 'shorter') return null;
  const r = reasons.find((x) => x.kind === 'timeframeLonger' && x.source === 'chart');
  if (r?.kind !== 'timeframeLonger' || !r.from || !r.to) return null;
  const change = `${tfName(r.from)}\u00a0→ ${tfName(r.to)}`;
  return {
    verdictLine: `あなたの答え: ${TAP_LABEL[tap]} ／ チャート: ${change}`,
    tapHint: `チャートでは ${change}`,
  };
}
