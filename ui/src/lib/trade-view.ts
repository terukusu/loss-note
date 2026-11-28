// 取引の一覧・ホーム・詳細の表示の形（Issue #9 契約 P-1。設計書 9.2・5.1・5.4・C34・C36）。DOM・通信・現在時刻に触れない。
// 判定・R・リスク（%）は保存した取引から summarize（= toTradeInput → evaluateTrade）で出す（保存しない）。
// 資金・許容リスク・銘柄の値は取引に写した snapshot だけから（今の設定・銘柄を引かない）。出ない値は記録する画面と同じ文言。
// 並びは API の trade_sort_key と同じ（決済の時刻の新しい順 → 作った時刻の新しい順 → ID の昇順）
// 口座（#47）: 口座が 2 つ以上のときだけ行・詳細の見出しに口座の名前（口座の付いていない取引は既定の口座）。
// 詳細の「すべての欄」には口座の数によらず口座と、記録したときの資金・許容リスクを出す（U16〜U18）
// 通貨（#47 PR-2）: 金額は取引の口座の通貨（snapshot の accountCurrency。無い = JPY）。「すべての欄」に 1R・建ての通貨・為替
// （通貨が違う取引だけ）を出す（U32・D2・D3）
import type { Grade, Judgment } from '../../../core/judge';
import {
  type AccountRecord,
  accountCurrencyOf,
  type InstrumentRecord,
  type StoredTrade,
} from '../../../core/record';
import { isLongerTimeframe } from '../../../core/trade';
import { hasManyAccounts, tradeAccountName } from './accounts';
import { type BadgeModel, badgeModel } from './badge';
import {
  type AnySlot,
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  extraName,
} from './charts';
import { formatFxDerived, fxFieldVisible, withUnit } from './currency';
import { formatDate, formatDateTime, formatHolding } from './datetime';
import {
  formatAmount,
  formatMoney,
  formatNumber,
  formatPct,
  formatPlain,
  formatPrice,
  formatQuantity,
  formatR,
  formatTimes,
} from './format';
import { legCountText, ONE_R_SOURCE_LABEL } from './option-view';
import { TIMEFRAME_NAME } from './reasons';
import { lcMoveLabel, OPTION_LABEL, RISK_NOTE, type Summary, summarize } from './record-form';

/** 銘柄が一覧に無いときの名前 */
export const UNKNOWN_INSTRUMENT = '銘柄が見つかりません';
/** ホームに出す直近の件数 */
export const RECENT_COUNT = 5;

export const SIDE_TEXT = { L: 'L ロング', S: 'S ショート' } as const;
/** 一覧の行の L / S（記号だけ。読み上げは SIDE_TEXT） */
export const SIDE_SHORT = { L: 'L', S: 'S' } as const;
/** 一覧で値が出ないときの印（理由は一覧の上に 1 回だけ出す。missingNotes） */
export const MISSING = '—';

export interface TradeRow {
  readonly id: string;
  readonly href: string;
  readonly grade: Grade | null;
  readonly badge: BadgeModel;
  /** R の文字（出ないときは「—」。理由は rNote） */
  readonly rText: string;
  readonly r: number | null;
  /** R が出ない理由（記録する画面と同じ文言。出るときは null） */
  readonly rNote: string | null;
  /** リスク（%）の文字（出ないときは「—」。理由は riskNote） */
  readonly riskText: string;
  /** リスクが出ない理由（記録する画面と同じ文言。出るときは null） */
  readonly riskNote: string | null;
  readonly instrumentName: string;
  /** 口座の名前（口座が 2 つ以上のときだけ。U16） */
  readonly accountName?: string;
  /** L / S（記号だけ） */
  readonly sideText: string;
  /** オプションのポジションの足の数（「足 3」。#117・設計書 7.6。足の無い取引には無い） */
  readonly legsText?: string;
  readonly dateText: string;
  /** 決済の日付（time 要素の datetime。端末の時間帯の YYYY-MM-DD） */
  readonly dateIso: string;
  /** 決済の時刻（ms。一覧の行の「11/19 14:05」・月の区切り。#132） */
  readonly exitTime: number;
  /** 行のリンクの読み上げの名前（日付 銘柄 L / S [口座] 判定 R リスク。出ない値は理由の文言） */
  readonly label: string;
}

/** 決済の時刻の新しい順 → 作った時刻の新しい順 → ID の昇順（API の trade_sort_key と同じ）。入力は変えない */
export function sortTrades(ts: readonly StoredTrade[]): StoredTrade[] {
  return [...ts].sort(
    (a, b) =>
      b.record.exit.time - a.record.exit.time ||
      b.createdAt - a.createdAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function instrumentNameOf(
  t: Pick<StoredTrade, 'record'>,
  instruments: readonly InstrumentRecord[],
): string {
  return instruments.find((i) => i.id === t.record.instrumentId)?.name ?? UNKNOWN_INSTRUMENT;
}

/** R が出ない理由（記録する画面の判定の枠と同じ文言。判定の枠の注記 verdict-notes.ts も使う） */
export function rNoteOf(s: Summary): string | null {
  if (s.r !== undefined) return null;
  if (s.invalid) return RISK_NOTE.invalid;
  return s.noLc ? RISK_NOTE.noLc : RISK_NOTE.invalid;
}

/** リスク（%）が出ない理由（記録する画面と同じ文言） */
export function riskNoteOf(s: Summary): string | null {
  if (s.riskPct !== undefined) return null;
  return s.riskNote ?? RISK_NOTE.invalid;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function tradeRow(
  t: StoredTrade,
  instruments: readonly InstrumentRecord[],
  accounts: readonly AccountRecord[] = [],
): TradeRow {
  const s = summarize(t);
  const grade = s.judgment?.grade ?? null;
  const badge = badgeModel(grade);
  const rNote = rNoteOf(s);
  const riskNote = riskNoteOf(s);
  const rText = s.r === undefined ? MISSING : formatR(s.r);
  const riskText = s.riskPct === undefined ? MISSING : formatPct(s.riskPct);
  const instrumentName = instrumentNameOf(t, instruments);
  const accountName = hasManyAccounts(accounts) ? tradeAccountName(t, accounts) : undefined;
  const legsText = legCountText(t);
  const d = new Date(t.record.exit.time);
  const dateText = formatDate(t.record.exit.time);
  return {
    id: t.id,
    href: `/trades/${t.id}`,
    grade,
    badge,
    rText,
    r: s.r ?? null,
    rNote,
    riskText,
    riskNote,
    instrumentName,
    ...(accountName === undefined ? {} : { accountName }),
    sideText: SIDE_SHORT[t.record.side],
    ...(legsText === null ? {} : { legsText }),
    dateText,
    dateIso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    exitTime: t.record.exit.time,
    label: `${dateText} ${instrumentName} ${SIDE_TEXT[t.record.side]}${legsText === null ? '' : ` ${legsText}`}${accountName === undefined ? '' : ` ${accountName}`} ${badge.label} R ${rNote ?? rText} リスク ${riskNote ?? riskText}`,
  };
}

/**
 * 一覧の上に 1 回だけ出す「—」の理由（行ごとに繰り返さない）。同じ理由は件数にまとめ、R とリスクが同じ理由なら
 * 「R・リスク」とまとめる。例: 「リスクの「—」: 資金を設定すると表示されます（1 件）」
 */
export function missingNotes(rows: readonly TradeRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const keys: string[] = [];
    if (r.rNote !== null && r.rNote === r.riskNote) keys.push(`R・リスク\u0000${r.rNote}`);
    else {
      if (r.rNote !== null) keys.push(`R\u0000${r.rNote}`);
      if (r.riskNote !== null) keys.push(`リスク\u0000${r.riskNote}`);
    }
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => {
    const [what, why] = k.split('\u0000');
    return `${what}の「${MISSING}」: ${why}（${n} 件）`;
  });
}

/** 時間足を変えたかの表示（申告とチャートの時間足を並べ、判定に使った方に印。文言は reasons.ts と同じ） */
export function timeframeChangeText(t: StoredTrade, judgment: Judgment | undefined): string {
  const r = t.record;
  const tap = TIMEFRAME_CHANGE_TEXT[r.timeframeChange];
  const a = r.entryChartTimeframe;
  const b = r.exitChartTimeframe;
  const hasChart = t.charts?.entry !== undefined && t.charts?.exit !== undefined;
  const reason = judgment?.reasons.find((x) => x.kind === 'timeframeLonger');
  const used = reason?.kind === 'timeframeLonger' ? reason.source : null;
  const mark = (src: 'tap' | 'chart') => (used === src ? '・判定に使用' : '');
  if (!hasChart || a === undefined || b === undefined) return tap;
  return `${tap}（あなたの答え${mark('tap')}） / ${TIMEFRAME_NAME[a]} → ${TIMEFRAME_NAME[b]}（チャートから${mark('chart')}）`;
}

/** 直近 n 件の行（sortTrades の先頭 n 件） */
export function recentRows(
  ts: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  n: number = RECENT_COUNT,
  accounts: readonly AccountRecord[] = [],
): TradeRow[] {
  return sortTrades(ts)
    .slice(0, Math.max(0, n))
    .map((t) => tradeRow(t, instruments, accounts));
}

/** 消した印（[元に戻す] を待っている取引）を除く。順は保つ */
export function visibleTrades(
  ts: readonly StoredTrade[],
  hidden: ReadonlySet<string>,
): StoredTrade[] {
  return ts.filter((t) => !hidden.has(t.id));
}

const LC_DECIDED_TEXT = { true: '決めていた', false: '決めていない' } as const;
const TIMEFRAME_CHANGE_TEXT = {
  none: 'そのまま',
  longer: '長い足へ',
  shorter: '短い足へ',
} as const;
const EXIT_REASON_TEXT = {
  lc: 'LC（根拠が崩れる条件に達した）',
  gapSlip: '窓・滑り',
  tp: 'TP',
  brokeManual: '根拠が崩れたので手動で',
  fearEarly: '崩れる前に怖くなって',
  satisfied: 'TP の前に満足して',
  timeout: '時間切れ',
  other: 'その他',
} as const;
const LC_BASIS_TEXT = { chart: 'チャート', amount: '金額' } as const;
const STOP_ORDER_TEXT = { placed: '置いた', notPlaced: '未設定', unanswered: '—' } as const;
const GAP_SLIP_TEXT = { yes: 'はい', no: 'いいえ', unanswered: '' } as const;

/** LC を動かしたかの答え（そのまま / 狭めた / 広げた（99.2）。L / S で同じ言葉。#56） */
function lcMoveText(t: StoredTrade): string {
  const m = t.record.lcMove;
  return m.kind === 'widened'
    ? `${lcMoveLabel(m.kind)}${m.after === undefined ? '' : `（${formatPrice(m.after)}）`}`
    : lcMoveLabel(m.kind);
}

export interface TapAnswer {
  /** 問いの全文（読み上げ。「LC を入る前に決めていたか」） */
  readonly label: string;
  /**
   * 札に見せる短い問い（「LC」「時間足」。#131 のデザインレビュー a1: 詳細は表示で、問いの全文は入力の場所と用語集にある。
   * 答えの言葉が重ならないので「LC:」が 2 つ並んでも取り違えない）
   */
  readonly short: string;
  readonly value: string;
  /** 計画から外れた答え（決めていない・広げた・長い足へ。時間足はチャートから判定に効いたときも） */
  readonly offPlan: boolean;
  /** 問いの説明の「i」（用語集の項目。#57 デザインレビュー 8） */
  readonly term: 'lcDecided' | 'lcMove' | 'timeframeChange';
}

/** 3 つのタップの答えの一覧の名前（読み上げ） */
export const TAPS_LABEL = '決済までの行動の答え';
/** 外れた答えの読み上げ */
export const OFF_PLAN_TEXT = '計画から外れた';

/**
 * 詳細の判定の枠の中に札で並べる 3 つのタップの答え（Issue #34 ルール 6）。LC が無い取引は時間足だけ（C37）。
 * 時間足の印は、答えが「長い足へ」か、チャート（エントリー時と決済時の時間足）から判定に効いた（理由に
 * 「時間足を変えた（…・チャートから）」が出る）とき。チャートから効いたときの札の値はチャートの足（例 4 時間足 → 日足）で、
 * あなたの答えとの食い違いは timeframeNote の 1 行で添える
 */
/**
 * 「最大損失まで」（#117・C50）: LC の価格を置かない計画で、「なし」ではない。LC を入る前に決めていたかは聞く（決めていなければ
 * core が C の noLc を付ける）が、LC を動かしたかは聞かない（5.7 の 5）
 */
export function isMaxLossTrade(t: Pick<StoredTrade, 'record'>): boolean {
  return t.record.legs !== undefined && t.record.riskPlan === 'maxLoss';
}

export function tapAnswers(t: StoredTrade, judgment?: Judgment): readonly TapAnswer[] {
  const r = t.record;
  const out: TapAnswer[] = [];
  if (r.lc !== undefined || isMaxLossTrade(t)) {
    out.push({
      label: 'LC を入る前に決めていたか',
      short: 'LC',
      value: LC_DECIDED_TEXT[String(r.lcDecidedBeforeEntry) as 'true' | 'false'],
      offPlan: !r.lcDecidedBeforeEntry,
      term: 'lcDecided',
    });
  }
  if (r.lc !== undefined) {
    out.push({
      label: 'LC を動かしたか',
      // 取消は「LC: 取消」だと LC なしと読めるので、何を取り消したかを札で言う（#165 のデザインレビュー 5）
      short: r.lcMove.kind === 'cancelled' ? '逆指値' : 'LC',
      value: lcMoveText(t),
      offPlan: r.lcMove.kind === 'widened' || r.lcMove.kind === 'cancelled',
      term: 'lcMove',
    });
    // 逆指値の未設定（判定に効かないので外れの印は付けない。置いた・未回答は札を出さない。C56・#165 のデザインレビュー 4）
    if (r.stopOrderPlaced === 'notPlaced') {
      out.push({
        label: '逆指値',
        short: '逆指値',
        value: '未設定',
        offPlan: false,
        term: 'lcMove',
      });
    }
  }
  const reason = judgment?.reasons.find((x) => x.kind === 'timeframeLonger');
  const a = r.entryChartTimeframe;
  const b = r.exitChartTimeframe;
  const fromChart =
    reason?.kind === 'timeframeLonger' &&
    reason.source === 'chart' &&
    a !== undefined &&
    b !== undefined;
  out.push({
    label: '時間足を変えたか',
    short: '時間足',
    value: fromChart
      ? `${TIMEFRAME_NAME[a]} → ${TIMEFRAME_NAME[b]}`
      : TIMEFRAME_CHANGE_TEXT[r.timeframeChange],
    offPlan: r.timeframeChange === 'longer' || reason !== undefined,
    term: 'timeframeChange',
  });
  return out;
}

/**
 * 時間足のあなたの答えと、チャートの時間足が食い違うときの 1 行（例「あなたの答え: そのまま」）。チャートの足はすぐ上の札
 * 「時間足: 4 時間足 → 日足」が言うので、ここではあなたの答えだけ（#131 のデザインレビュー a2）。
 * エントリー時と決済時のチャートと時間足がそろっていなければ null
 */
export function timeframeNote(t: StoredTrade): string | null {
  const r = t.record;
  const a = r.entryChartTimeframe;
  const b = r.exitChartTimeframe;
  const hasChart = t.charts?.entry !== undefined && t.charts?.exit !== undefined;
  if (!hasChart || a === undefined || b === undefined) return null;
  if ((r.timeframeChange === 'longer') === isLongerTimeframe(a, b)) return null;
  return `あなたの答え: ${TIMEFRAME_CHANGE_TEXT[r.timeframeChange]}`;
}

/** 提案の数量が数量の刻み 1 つにも満たないときの言葉（#67 R2） */
export const SIZING_OVER_STEP = '最小の数量でも許容リスクを超えます';

/** 数量の比の文字（「2.5 倍」。小数 1 桁へ切り上げ。#67 R3） */
export function timesText(ratio: number): string {
  return `${formatTimes(ratio)} 倍`;
}

/** 詳細の「すべての欄」の提案の数量・数量の比の行の名前（#67。記録したときの資金・許容リスクは上の 2 行が言う） */
export const SIZING_LABEL = {
  suggested: '適正の数量',
  ratio: '許容リスクに対する数量',
} as const;

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

/**
 * 詳細の「すべての欄」（#34 までの「記録した欄」。ラベルと値。空の任意の欄は出さない）。judgment は時間足の行に、
 * 判定に使った方の印を付けるため。口座・記録したときの資金と許容リスクは口座の数によらず出す（U18。口座の付いていない
 * 取引は既定の口座の名前）
 */
export function recordFields(
  t: StoredTrade,
  instrumentName: string,
  judgment?: Judgment,
  accounts: readonly AccountRecord[] = [],
): readonly FieldRow[] {
  const r = t.record;
  const e = r.entries[0];
  const x = r.exit;
  const s = t.snapshot;
  const currency = accountCurrencyOf(s);
  const price = s.instrument.priceCurrency;
  const sum = summarize(t);
  const rows: FieldRow[] = [
    { label: '口座', value: tradeAccountName(t, accounts) },
    {
      label: '口座の資金（記録したとき）',
      value: s.capitalYen === null ? '未設定' : formatAmount(s.capitalYen, currency),
    },
    { label: '許容リスク（記録したとき）', value: `${formatPlain(s.riskTolerancePct)}%` },
    { label: '銘柄', value: instrumentName },
  ];
  // 建ての通貨: 口座の通貨と違うときだけ「USD」。未設定は外貨の口座のときだけ「未設定」（U32・F11・J9 の直し。
  // 名前に「建て」があるので値は 3 文字だけ。デザイン 6）
  if (price !== null ? price !== currency : currency !== 'JPY') {
    rows.push({ label: '価格の通貨', value: price ?? '未設定' });
  }
  // オプションのポジション（#117）: イン / 決済は原資産の価格。数量（本文は 1）は使わないので、代わりに足の本数
  const legs = r.legs;
  const maxLoss = isMaxLossTrade(t);
  rows.push(
    { label: 'L / S', value: SIDE_TEXT[r.side] },
    { label: legs ? OPTION_LABEL.entryPrice : 'イン', value: formatPrice(e.price) },
    { label: legs ? OPTION_LABEL.exitPrice : '決済', value: formatPrice(x.price) },
    legs
      ? { label: '足', value: `${legs.length} 本` }
      : { label: '数量', value: formatQuantity(e.quantity) },
  );
  // 提案の数量と数量の比（#67。記録したときの資金・許容リスクで。数量どうしを隣に並べる。出ないときは行ごと出さない）
  const sizing = sum.sizing;
  if (sizing !== undefined) {
    if (sizing.suggestedQuantity !== undefined) {
      const q = sizing.suggestedQuantity;
      rows.push({
        label: SIZING_LABEL.suggested,
        value: q === 0 ? `0（${SIZING_OVER_STEP}）` : formatQuantity(q),
      });
    }
    rows.push({ label: SIZING_LABEL.ratio, value: timesText(sizing.ratio) });
  }
  // 為替: 通貨が違う取引だけ。入れた値（1 USD = 150 円）か、明細から逆算した値。どちらも無ければ行なし（U32）
  if (price !== null && fxFieldVisible(price, currency)) {
    // 「1 USD = 150円」/「1 USD = 150.00円（明細から）」（値を 2 度書かない。デザイン 6）
    if (x.fxRate !== undefined) {
      rows.push({
        label: '為替',
        value: `1 ${price} = ${withUnit(formatNumber(x.fxRate), currency)}`,
      });
    } else if (sum.derivedFx !== undefined) {
      rows.push({
        label: '為替',
        value: `1 ${price} = ${withUnit(formatFxDerived(sum.derivedFx), currency)}（明細から）`,
      });
    }
  }
  rows.push({ label: '決済の時刻', value: formatDateTime(x.time) });
  if (e.time !== undefined) rows.push({ label: 'エントリーの時刻', value: formatDateTime(e.time) });
  rows.push({
    label: legs ? 'LC（原資産）' : 'LC',
    value: maxLoss ? '最大損失まで' : r.lc === undefined ? 'なし' : formatPrice(r.lc),
  });
  if (r.lcLossPlanYen !== undefined) {
    rows.push({ label: 'LC での損失の見込み', value: formatAmount(r.lcLossPlanYen, currency) });
  }
  if (sum.oneRYen !== undefined) {
    rows.push({ label: '1R', value: formatAmount(sum.oneRYen, currency) });
  }
  // 1R の出どころ（オプションのポジションだけ。C49）
  if (sum.option?.oneRSource !== undefined) {
    rows.push({ label: '1R の決め方', value: ONE_R_SOURCE_LABEL[sum.option.oneRSource] });
  }
  if (r.brokenCondition) rows.push({ label: '根拠が崩れる条件', value: r.brokenCondition });
  if (r.lc !== undefined || maxLoss) {
    rows.push({
      label: 'LC を入る前に決めていたか',
      value: LC_DECIDED_TEXT[String(r.lcDecidedBeforeEntry) as 'true' | 'false'],
    });
  }
  if (r.lc !== undefined) {
    rows.push({ label: 'LC を動かしたか', value: lcMoveText(t) });
    // 逆指値（置いた / 未設定 / 未回答は「—」。LC の価格のある取引だけ。C56・#165）
    // 取消の取引は「置いた → 取消」の 1 つの値にする（上の行の「取消」と並んで矛盾に見えない。#165 のデザインレビュー 6）
    rows.push({
      label: '逆指値',
      value:
        r.lcMove.kind === 'cancelled'
          ? `${STOP_ORDER_TEXT.placed} → ${lcMoveLabel('cancelled')}`
          : STOP_ORDER_TEXT[r.stopOrderPlaced],
    });
  }
  rows.push({ label: '時間足を変えたか', value: timeframeChangeText(t, judgment) });
  if (r.statementPnlYen !== undefined) {
    rows.push({ label: '損益（明細の値）', value: formatMoney(r.statementPnlYen, currency) });
  }
  if (r.fees.length > 0) {
    const total = r.fees.reduce((acc, f) => acc + f.amountYen, 0);
    // 手数料は丸めない（円の口座は「200.5円」のまま）。整数部は 3 桁区切り（1,234.5円。#40）。外貨の口座は通貨の 3 文字を後ろに
    rows.push({
      label: '手数料',
      value: currency === 'JPY' ? `${formatNumber(total)}円` : `${formatNumber(total)} ${currency}`,
    });
  }
  rows.push({ label: 'LC の根拠', value: LC_BASIS_TEXT[r.lcBasis] });
  rows.push({ label: '決済の理由', value: EXIT_REASON_TEXT[x.reason] });
  if (x.gapSlip !== 'unanswered') {
    rows.push({ label: '窓・滑りでしたか', value: GAP_SLIP_TEXT[x.gapSlip] });
  }
  return rows;
}

export interface ChartSlotView {
  readonly slot: AnySlot;
  readonly name: string;
  readonly has: boolean;
  /** 時間足の名前（チャートがあって時間足を選んでいないときは null） */
  readonly timeframe: string | null;
  /** 付属のチャートの一言（#89。付属の枠で一言があるときだけ） */
  readonly note?: string;
}

/**
 * エントリー時・決済時の枠（チャートの有無と時間足の名前）と、その後ろに付属のチャート（#89。追加した順・画像のある枠だけ。
 * 一言つき）
 */
export function chartSlots(t: StoredTrade): readonly ChartSlotView[] {
  const main = CHART_SLOTS.map((slot) => {
    const has = t.charts?.[slot] !== undefined;
    const tf = t.record[CHART_TIMEFRAME_FIELD[slot]];
    return {
      slot,
      name: CHART_SLOT_TEXT[slot].name,
      has,
      timeframe: has && tf !== undefined ? TIMEFRAME_NAME[tf] : null,
    };
  });
  const extras = (t.record.extraCharts ?? [])
    .filter((e) => t.charts?.[e.slot] !== undefined)
    .map((e, i) => ({
      slot: e.slot,
      name: extraName(i),
      has: true,
      timeframe: e.timeframe === undefined ? null : TIMEFRAME_NAME[e.timeframe],
      ...(e.note ? { note: e.note } : {}),
    }));
  return [...main, ...extras];
}

/** どの取引かが分かる短い名前（トースト「US30 L 11/09 を消しました」・詳細の見出し。端末の時間帯） */
export function shortLabel(t: StoredTrade, instrumentName: string): string {
  const d = new Date(t.record.exit.time);
  return `${instrumentName} ${SIDE_SHORT[t.record.side]} ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** エントリーの時刻（時刻のあるエントリーのうち最も早いもの。事後の記録は entries[0] だけ。無ければ undefined。#58） */
function firstEntryTime(t: StoredTrade): number | undefined {
  const times = t.record.entries.flatMap((e) => (e.time === undefined ? [] : [e.time]));
  return times.length > 0 ? Math.min(...times) : undefined;
}

/** 詳細の見出し（銘柄 · L ロング）と添え書き（決済の日時。エントリーの時刻があれば「· 保有 2 日 4 時間」（#58）、口座が 2 つ以上なら「· 口座 A」も。U17） */
export function detailHeading(
  t: StoredTrade,
  instrumentName: string,
  accounts: readonly AccountRecord[] = [],
): { readonly title: string; readonly sub: string; readonly entry?: string } {
  const account = hasManyAccounts(accounts) ? ` · ${tradeAccountName(t, accounts)}` : '';
  // 保有時間はエントリーの時刻があるときだけ（無ければ「—」も出さない。#58 ルール 3）
  const entryMs = firstEntryTime(t);
  const holding = entryMs === undefined ? null : formatHolding(entryMs, t.record.exit.time);
  return {
    title: `${instrumentName} · ${SIDE_TEXT[t.record.side]}`,
    sub: `決済 ${formatDateTime(t.record.exit.time)}${holding ? ` · ${holding}` : ''}${account}`,
    // 広い幅だけ添え書きの頭に出すエントリーの時刻（保有時間を出す取引だけ。#58 デザインレビュー 5）
    ...(holding && entryMs !== undefined ? { entry: `エントリー ${formatDateTime(entryMs)}` } : {}),
  };
}
