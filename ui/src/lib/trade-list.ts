// 取引の一覧の月の区切りと行の形（#132。設計書 9.2 の取引の一覧・9.3、ui-guidelines 9.9・9.12）。DOM・通信・現在時刻に
// 触れない。並びは渡された行の順（sortTrades = 決済の新しい順）のまま。
// - 月は決済の時刻の端末の時間帯の年月（行の dateIso と同じ暦）
// - 見出しの数 = その月の見えている行の数（[元に戻す] を待つ取引は呼ぶ側が visibleTrades で外す。取り込んだ取引も行なので数える）。
//   計画どおり = 判定の段が計画どおり（A・計画どおりの勝ち）の行の数
// - 続きがある間は、読み込んだ中でいちばん古い月の数がそろっていない（次のページに同じ月の取引が残りうる）。その月は
//   「N 件を表示中 · 続きあり」として計画どおりの数を出さない（読み込んだ分だけの数を月の数に見せない。#87 の countText と同じ考え）
import type { Tier, TierSymbol } from './badge';
import { quietR } from './risky-win';
import type { TradeRow } from './trade-view';

/** 行の 2 行目の判定の名前と右の数（ホームの詰めた行と同じ規則。#128 デザイン a4） */
export interface ListRowModel {
  readonly tier: Tier;
  readonly symbol: TierSymbol;
  readonly gradeLabel: string;
  /** 決済の時刻「11/19 14:05」（端末の時間帯。年は月の見出しにある） */
  readonly when: string;
  /** time 要素の datetime（端末の時間帯の「YYYY-MM-DDTHH:mm」。表示の時刻と合わせる。#132 N2） */
  readonly whenIso: string;
  /** R（出ないときは「—」） */
  readonly rText: string;
  readonly rMissing: boolean;
  /** R を静かな形で出す（危ない勝ちの出る R。主役の段に出さない。#227・C59）。ほかの行には無い */
  readonly rQuiet?: true;
  /** 「リスク 0.8%」（R が出ない・リスクが出ないときは null = 段を出さない） */
  readonly riskText: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 決済の時刻 → 「11/19 14:05」（端末の時間帯） */
export function whenText(exitMs: number): string {
  const d = new Date(exitMs);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 決済の時刻 → 「2026-11-19T14:05」（端末の時間帯。time 要素の datetime） */
export function whenIso(exitMs: number): string {
  const d = new Date(exitMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function listRowModel(row: TradeRow): ListRowModel {
  const rMissing = row.rNote !== null;
  return {
    tier: row.badge.tier,
    symbol: row.badge.symbol,
    gradeLabel: row.badge.label,
    when: whenText(row.exitTime),
    whenIso: whenIso(row.exitTime),
    rText: row.rText,
    rMissing,
    ...(!rMissing && quietR(row.grade) ? { rQuiet: true as const } : {}),
    riskText: rMissing || row.riskNote !== null ? null : `リスク ${row.riskText}`,
  };
}

/** 行の月の鍵（dateIso = 端末の時間帯の YYYY-MM-DD → YYYY-MM） */
export function monthKeyOf(row: Pick<TradeRow, 'dateIso'>): string {
  return row.dateIso.slice(0, 7);
}

/** 月の鍵 → 見出し「2026年11月」 */
export function monthTitle(key: string): string {
  const [y, m] = key.split('-');
  return `${Number(y)}年${Number(m)}月`;
}

export interface MonthGroup {
  /** YYYY-MM */
  readonly key: string;
  /** 「2026年11月」 */
  readonly title: string;
  readonly rows: readonly TradeRow[];
  /** 見えている行の数 */
  readonly count: number;
  /** 計画どおり（A・計画どおりの勝ち）の行の数 */
  readonly plan: number;
  /** 数がそろっている（続きを読んでもこの月の行は増えない） */
  readonly complete: boolean;
  /** 見出しの右の文（「13 件 · 計画どおり 8」/「13 件を表示中 · 続きあり」） */
  readonly summary: string;
}

/** 月の見出しの右の文 */
export function monthSummary(count: number, plan: number, complete: boolean): string {
  return complete ? `${count} 件 · 計画どおり ${plan}` : `${count} 件を表示中 · 続きあり`;
}

/**
 * 行（決済の新しい順）を月ごとに束ねる。done = 最後まで読んだ。続きがある間は最後の束（いちばん古い月）だけがそろっていない。
 * 同じ月が離れて現れる（並びが崩れた入力）ときも、前の束に足さず新しい束にする（並びを変えない）
 */
export function monthGroups(rows: readonly TradeRow[], done: boolean): MonthGroup[] {
  const groups: { key: string; rows: TradeRow[] }[] = [];
  for (const r of rows) {
    const key = monthKeyOf(r);
    const last = groups.at(-1);
    if (last && last.key === key) last.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  return groups.map((g, i) => {
    const complete = done || i < groups.length - 1;
    const plan = g.rows.filter((r) => r.badge.tier === 'plan').length;
    return {
      key: g.key,
      title: monthTitle(g.key),
      rows: g.rows,
      count: g.rows.length,
      plan,
      complete,
      summary: monthSummary(g.rows.length, plan, complete),
    };
  });
}

/** 「—」の理由の「i」の言葉（説明のシートの題。ボタンの名前は「「表示されない値」の説明」） */
export const MISSING_INFO_LABEL = '表示されない値';
/** 「—」の理由の説明のシートの ID */
export const MISSING_INFO_ID = 'info-trades-missing';

/** 「—」の理由（missingNotes の文）→ 題の行の「i」の中身。理由が無ければ null（「i」を出さない） */
export function missingInfo(
  notes: readonly string[],
): { readonly label: string; readonly body: readonly string[]; readonly id: string } | null {
  if (notes.length === 0) return null;
  return { label: MISSING_INFO_LABEL, body: notes, id: MISSING_INFO_ID };
}
