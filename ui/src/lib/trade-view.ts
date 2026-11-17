// 取引の一覧・ホーム・詳細の表示の形（Issue #9 契約 P-1。設計書 9.2・5.1・5.4・C34・C36）。DOM・通信・現在時刻に触れない。
// 判定・R・リスク（%）は保存した取引から summarize（= toTradeInput → evaluateTrade）で出す（保存しない）。
// 資金・許容リスク・銘柄の値は取引に写した snapshot だけから（今の設定・銘柄を引かない）。出ない値は記録する画面と同じ文言。
// 並びは API の trade_sort_key と同じ（決済の時刻の新しい順 → 作った時刻の新しい順 → ID の昇順）
import type { Grade, Judgment } from '../../../core/judge';
import type { InstrumentRecord, StoredTrade } from '../../../core/record';
import { type BadgeModel, badgeModel } from './badge';
import { CHART_SLOT_TEXT, CHART_SLOTS, CHART_TIMEFRAME_FIELD, type ChartSlot } from './charts';
import { formatDate, formatDateTime } from './datetime';
import { formatPct, formatPlain, formatPrice, formatR, formatYen } from './format';
import { TIMEFRAME_NAME, widenVerb } from './reasons';
import { RISK_NOTE, type Summary, summarize } from './record-form';

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
  /** L / S（記号だけ） */
  readonly sideText: string;
  readonly dateText: string;
  /** 決済の日付（time 要素の datetime。端末の時間帯の YYYY-MM-DD） */
  readonly dateIso: string;
  /** 行のリンクの読み上げの名前（日付 銘柄 L / S 判定 R リスク。出ない値は理由の文言） */
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

export function tradeRow(t: StoredTrade, instruments: readonly InstrumentRecord[]): TradeRow {
  const s = summarize(t);
  const grade = s.judgment?.grade ?? null;
  const badge = badgeModel(grade);
  const rNote = rNoteOf(s);
  const riskNote = riskNoteOf(s);
  const rText = s.r === undefined ? MISSING : formatR(s.r);
  const riskText = s.riskPct === undefined ? MISSING : formatPct(s.riskPct);
  const instrumentName = instrumentNameOf(t, instruments);
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
    sideText: SIDE_SHORT[t.record.side],
    dateText,
    dateIso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    label: `${dateText} ${instrumentName} ${SIDE_TEXT[t.record.side]} ${badge.label} R ${rNote ?? rText} リスク ${riskNote ?? riskText}`,
  };
}

/**
 * 一覧の上に 1 回だけ出す「—」の理由（行ごとに繰り返さない）。同じ理由は件数にまとめ、R とリスクが同じ理由なら
 * 「R・リスク」とまとめる。例: 「リスクの「—」: 資金を設定すると出ます（1 件）」
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
  return `${tap}（申告${mark('tap')}） / ${TIMEFRAME_NAME[a]} → ${TIMEFRAME_NAME[b]}（チャートから${mark('chart')}）`;
}

/** 直近 n 件の行（sortTrades の先頭 n 件） */
export function recentRows(
  ts: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  n: number = RECENT_COUNT,
): TradeRow[] {
  return sortTrades(ts)
    .slice(0, Math.max(0, n))
    .map((t) => tradeRow(t, instruments));
}

/** 消した印（[元に戻す] を待っている取引）を除く。順は保つ */
export function visibleTrades(
  ts: readonly StoredTrade[],
  hidden: ReadonlySet<string>,
): StoredTrade[] {
  return ts.filter((t) => !hidden.has(t.id));
}

const LC_DECIDED_TEXT = { true: '決めていた', false: '決めていない' } as const;
const TIMEFRAME_CHANGE_TEXT = { none: '変えず', longer: '長い足へ', shorter: '短い足へ' } as const;
const EXIT_REASON_TEXT = {
  lc: 'LC（崩れの条件に当たった）',
  gapSlip: '窓・滑り',
  tp: 'TP',
  brokeManual: '根拠が崩れたので手で',
  fearEarly: '崩れる前に怖くなって',
  timeout: '時間切れ',
  other: 'その他',
} as const;
const LC_BASIS_TEXT = { chart: 'チャートの根拠', amount: '金額から' } as const;
const GAP_SLIP_TEXT = { yes: 'はい', no: 'いいえ', unanswered: '' } as const;

export interface FieldRow {
  readonly label: string;
  readonly value: string;
}

/** 詳細の「記録した欄」（ラベルと値。空の任意の欄は出さない）。judgment は時間足の行に、判定に使った方の印を付けるため */
export function recordFields(
  t: StoredTrade,
  instrumentName: string,
  judgment?: Judgment,
): readonly FieldRow[] {
  const r = t.record;
  const e = r.entries[0];
  const x = r.exit;
  const rows: FieldRow[] = [
    { label: '銘柄', value: instrumentName },
    { label: 'L / S', value: SIDE_TEXT[r.side] },
    { label: 'イン', value: formatPrice(e.price) },
    { label: '決済', value: formatPrice(x.price) },
    { label: '数量', value: formatPlain(e.quantity) },
    { label: '決済の時刻', value: formatDateTime(x.time) },
  ];
  if (e.time !== undefined) rows.push({ label: '建てた時刻', value: formatDateTime(e.time) });
  rows.push({ label: 'LC', value: r.lc === undefined ? 'なし' : formatPrice(r.lc) });
  if (r.brokenCondition) rows.push({ label: '崩れの条件の一言', value: r.brokenCondition });
  if (r.lc !== undefined) {
    rows.push({
      label: 'LC を入る前に決めていたか',
      value: LC_DECIDED_TEXT[String(r.lcDecidedBeforeEntry) as 'true' | 'false'],
    });
    const m = r.lcMove;
    const moved =
      m.kind === 'none'
        ? 'そのまま'
        : m.kind === 'tightened'
          ? '詰めた'
          : `${widenVerb(r.side)}${m.after === undefined ? '' : `（${formatPrice(m.after)}）`}`;
    rows.push({ label: 'LC を動かしたか', value: moved });
  }
  rows.push({ label: '時間足を変えたか', value: timeframeChangeText(t, judgment) });
  if (r.statementPnlYen !== undefined) {
    rows.push({ label: '損益（明細の値）', value: formatYen(r.statementPnlYen) });
  }
  if (r.fees.length > 0) {
    const total = r.fees.reduce((sum, f) => sum + f.amountYen, 0);
    rows.push({ label: '手数料', value: `${formatPlain(total)}円` });
  }
  rows.push({ label: 'LC の根拠', value: LC_BASIS_TEXT[r.lcBasis] });
  rows.push({ label: '決済の理由', value: EXIT_REASON_TEXT[x.reason] });
  if (x.gapSlip !== 'unanswered') {
    rows.push({ label: '窓・滑りでしたか', value: GAP_SLIP_TEXT[x.gapSlip] });
  }
  return rows;
}

export interface ChartSlotView {
  readonly slot: ChartSlot;
  readonly name: string;
  readonly has: boolean;
  /** 時間足の名前（チャートがあって時間足を選んでいないときは null） */
  readonly timeframe: string | null;
}

/** エントリー時・決済時の枠（チャートの有無と時間足の名前） */
export function chartSlots(t: StoredTrade): readonly ChartSlotView[] {
  return CHART_SLOTS.map((slot) => {
    const has = t.charts?.[slot] !== undefined;
    const tf = t.record[CHART_TIMEFRAME_FIELD[slot]];
    return {
      slot,
      name: CHART_SLOT_TEXT[slot].name,
      has,
      timeframe: has && tf !== undefined ? TIMEFRAME_NAME[tf] : null,
    };
  });
}

/** どの取引かが分かる短い名前（トースト「US30 L 11/09 を消しました」・詳細の見出し。端末の時間帯） */
export function shortLabel(t: StoredTrade, instrumentName: string): string {
  const d = new Date(t.record.exit.time);
  return `${instrumentName} ${SIDE_SHORT[t.record.side]} ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** 詳細の見出し（銘柄 · L ロング）と添え書き（決済の日時） */
export function detailHeading(
  t: StoredTrade,
  instrumentName: string,
): { readonly title: string; readonly sub: string } {
  return {
    title: `${instrumentName} · ${SIDE_TEXT[t.record.side]}`,
    sub: `決済 ${formatDateTime(t.record.exit.time)}`,
  };
}
