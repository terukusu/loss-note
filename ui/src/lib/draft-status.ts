// 記録する画面・編集の画面の書きかけの状態（Issue #75 R0。純関数）。殻の書きかけの置き場（drafts.ts）が、画面を離れるときに
// 残すか・[キャンセル] で [元に戻す] を出すか・タブを閉じるときに確認するかをこれで決める。
// - empty = 入力が無い（読み込み中・読み込みの失敗・開いたときのまま）
// - input = 入力がある（記録: 開いたときの既定から欄が変わった・明細を貼った・チャート・付属の枠・口座の追加の欄に入力 /
//   編集: 開いたときから欄・チャート・付属の枠・計算に使う値が変わった）
// - saving = 保存中（[キャンセル] を押せない。離れても残す）
// - done = 保存し終えた（残さない。記録する画面は結果の面を見せ終えたら捨てる）
import { chartChangeCount } from './chart-slots';
import { type ExtraEntry, extrasFromRecord } from './charts';
import type { EditState } from './edit-controller';
import type { RecordState } from './record-controller';
import type { Draft } from './record-form';
import { shortLabel } from './trade-view';

export type DraftStatus = 'empty' | 'input' | 'saving' | 'done';

/** 2 つの下書きの欄が同じか（下書きは平らな値と、足の並び（平らな値の行。#117）だけを持つ） */
export function sameDraft(a: Draft, b: Draft): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Draft>;
  for (const k of keys) {
    if (k === 'legs') {
      if (a.legs !== b.legs && JSON.stringify(a.legs) !== JSON.stringify(b.legs)) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}

export function recordDraftStatus(s: RecordState): DraftStatus {
  if (s.phase === 'saving') return 'saving';
  if (s.phase === 'saved') return 'done';
  if (s.phase !== 'editing') return 'empty';
  const st = s.statement;
  if (st && (st.phase === 'preparing' || st.phase === 'reading' || st.phase === 'ready')) {
    return 'input';
  }
  if (Object.values(s.charts ?? {}).some((c) => c !== undefined)) return 'input';
  if ((s.extras ?? []).length > 0) return 'input';
  const add = s.addAccount;
  if (add && (add.draft.name.trim() !== '' || add.draft.capital.trim() !== '')) return 'input';
  if (s.baseline && !sameDraft(s.draft, s.baseline)) return 'input';
  return 'empty';
}

/** 付属の枠が保存した並びから変わったか（足した枠・時間足・一言。削除は chartChangeCount が数える） */
function extrasChanged(now: readonly ExtraEntry[], saved: readonly ExtraEntry[]): boolean {
  return now.some((x) => {
    const y = saved.find((e) => e.slot === x.slot);
    return y === undefined || y.timeframe !== x.timeframe || y.note !== x.note;
  });
}

export function editDraftStatus(s: EditState): DraftStatus {
  if (s.phase === 'saving') return 'saving';
  if (s.phase === 'saved') return 'done';
  if (s.phase !== 'editing') return 'empty';
  if (!sameDraft(s.draft, s.initial)) return 'input';
  if (chartChangeCount(s.charts) > 0) return 'input';
  // 新しく入れた枠（描き直し中・失敗を含む）
  if (Object.values(s.charts ?? {}).some((c) => c !== undefined && !c.stored)) return 'input';
  if (s.trade && extrasChanged(s.extras, extrasFromRecord(s.trade.record.extraCharts))) {
    return 'input';
  }
  if (s.refresh && s.offer !== null) return 'input';
  return 'empty';
}

/** 記録の書きかけの画像（破棄の知らせに添える。チャートの枚数と、明細を貼ったか） */
export function recordDraftImages(s: RecordState): { charts: number; statement: boolean } {
  const st = s.statement;
  return {
    charts: Object.values(s.charts ?? {}).filter((c) => c !== undefined && c.phase !== 'removed')
      .length,
    statement: st !== undefined && st.phase !== 'done' && st.phase !== 'failed',
  };
}

/** 編集の書きかけの画像（新しく入れたチャートの枚数。保存済みのチャートは捨てても残る） */
export function editDraftImages(s: EditState): { charts: number; statement: boolean } {
  return {
    charts: Object.values(s.charts ?? {}).filter(
      (c) => c !== undefined && !c.stored && c.phase !== 'removed',
    ).length,
    statement: false,
  };
}

/** 離れてからの時間（「3 分前」「2 時間前」。1 分未満は「1 分以内」） */
export function agoText(leftAt: number, now: number): string {
  const min = Math.floor(Math.max(0, now - leftAt) / 60_000);
  if (min < 1) return '1 分以内';
  if (min < 60) return `${min} 分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 時間前`;
  return `${Math.floor(h / 24)} 日前`;
}

/** datetime-local の値（YYYY-MM-DDTHH:mm）→ 「11/19 09:31」 */
function shortLocal(v: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? `${m[1]}/${m[2]} ${m[3]}` : v;
}

/**
 * 借り直した書きかけの見出しの下の 1 行（#75 デザイン 1）。前の入力の続きであること・やめるときの左上の ✕（#127）、
 * 記録で決済の時刻が開いたときの自動の値のままなら、それを言う（前に開いた時刻のまま記録しないように）
 */
export function resumedNote(
  kind: 'record' | 'edit',
  leftAt: number,
  now: number,
  exitTimeKept?: string,
): string {
  const head =
    kind === 'record'
      ? `前の入力の続きです（${agoText(leftAt, now)}）。`
      : `前の変更の続きです（${agoText(leftAt, now)}）。`;
  const exit = exitTimeKept
    ? `決済の時刻は開いたときの ${shortLocal(exitTimeKept)} のままです。`
    : '';
  return `${head}${exit}破棄するときは左上の ✕（キャンセル）を押してください。`;
}

/** 記録の決済の時刻が、開いたときの自動の値のままか（そのままならその値。手で変えた・読み取りで入れたなら undefined） */
export function exitTimeKept(s: RecordState): string | undefined {
  const b = s.baseline;
  if (!b?.exitTime || s.draft.exitTime !== b.exitTime) return undefined;
  if (s.statement?.marks && 'exitTime' in s.statement.marks) return undefined;
  return b.exitTime;
}

/** 編集の書きかけがどの取引か（削除のトーストと同じ短い名前。読み込む前は空） */
export function editDraftLabel(s: EditState): string {
  const t = s.trade;
  if (!t) return '';
  const name = s.instruments.find((i) => i.id === t.record.instrumentId)?.name ?? '';
  return shortLabel(t, name);
}

/**
 * 続きの 1 行を出す時刻（#75 R2）: 保存し終えたら以後は出さない（[次の取引] の空の下書きは前の入力の続きではない）。
 * 画面が controller の状態を受けるたびに前の値と状態の段で呼ぶ
 */
export function resumedAfter(cur: number | null, phase: string): number | null {
  return phase === 'saved' ? null : cur;
}
