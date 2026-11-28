// 両建てのまとまり（#267。設計書 C75〜C81・4.8・5.8・6.5・7.7・9.2・ADR-0027）の画面の純関数。DOM・通信・現在時刻に触れない。
// 計算と判定は core/position-group.ts（#265）。ここは保存した形 → 計算の入力・判定の枠の Summary・画面の文字・候補の選び方・本文。
// - まとまりの中の取引は「メンバー」（オプションの「足」と混ぜない。C72）。役割は 本玉（main）/ 決済の代わり（hedge）
// - 量 = 数量 × 乗数（銘柄の snapshot。為替・通貨は掛けない。C76）
// - 崩れたまとまり（メンバーの取引が無い・メンバーの逆参照がこのまとまりを指していない・役割の組が崩れた）は判定に使わず、
//   メンバーを単独の取引として判定する（4.8）

import type { EmotionTagId } from '../../../core/emotion-tags';
import type { Judgment } from '../../../core/judge';
import {
  evaluatePositionGroup,
  type GroupEvaluation,
  type GroupNote,
  type PositionGroupInput,
  unionEmotions,
  unionReflection,
} from '../../../core/position-group';
import {
  accountCurrencyOf,
  type GroupExitBody,
  type GroupRole,
  type InstrumentRecord,
  type PositionGroupBody,
  type StoredPositionGroup,
  type StoredTrade,
} from '../../../core/record';
import type { Reflection } from '../../../core/reflection';
import { noLcRulerOf, rulerOf } from '../../../core/ruler';
import type { ExitReason, Side } from '../../../core/trade';
import { badgeModel } from './badge';
import { formatMoney, formatPrice, formatQuantity } from './format';
import { GROUP_MARK, ROLE_TEXT } from './group-text';
import { nameKey } from './instrument-name';
import { RISK_NOTE, type Summary } from './record-form';
import { breachView, cautionText } from './risky-win';
import { instrumentNameOf, SIDE_SHORT } from './trade-view';

/** まとまりの画面の URL（#267。設計書 9.2） */
export const groupHref = (id: string) => `/trades/groups/${id}`;

/** まとまりの API のパス */
export const GROUPS_PATH = '/api/position-groups';
export const groupPath = (id: string) => `${GROUPS_PATH}/${encodeURIComponent(id)}`;

export { GROUP_MARK, ROLE_TEXT } from './group-text';

/** 崩れたまとまりの 1 行（4.8・7.7） */
export const BROKEN_TEXT = '両建てのまとまりが崩れています';
/** 崩れたまとまりの添え（なぜ単独の判定を出しているか） */
export const BROKEN_NOTE =
  'メンバーを単独の取引として判定しています。［解く］ で結び付きを外せます。';

/** 削除の行の添え（メンバーの取引。消した後に初めて知ることにしない。4.8） */
export const DELETE_MEMBER_NOTE = '両建てのまとまりから外れます';

/** 編集の保存の 409 `inPositionGroup`（4.8） */
export const SIDE_LOCKED = '両建てを解いてから向きを変えてください';

/** 409 などの応答の理由（`{error, reason}` の reason。読めなければ null。本文のほかの中身は持ち出さない） */
export async function conflictReason(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { reason?: unknown };
    return typeof body?.reason === 'string' ? body.reason : null;
  } catch {
    return null;
  }
}

/** 操作のシートの行の文字（7.7） */
export const LINK_LABEL = '両建てに結ぶ';
/** ［解く］ の添え（上書きがあれば、上書きごと戻ることも言う。7.7） */
export function unlinkNote(hasExit: boolean): string {
  return hasExit
    ? '8 秒は元に戻せます（固定の価格などの修正ごと）'
    : '8 秒は元に戻せます · 記録・心理は残ります';
}
/** 崩れたまとまりの ［解く］ の添え（結び直せないので戻せない） */
export const UNLINK_BROKEN_NOTE = '記録・心理・Good / More は残ります';
export const OPEN_GROUP_LABEL = 'まとまりを見る';
/** 相手を選ぶシートの題（7.7） */
export const PICKER_TITLE = '両建ての相手';
/** 相手を選ぶシートの段の見出し（候補の向き。選んでも替わらない） */
export const PICKER_SECTION = {
  opposite: '逆の向き',
  same: '同じ向き（本玉か決済の代わりに加える）',
  other: 'ほかの銘柄（逆の向き）',
} as const;

/** 相手を選ぶ範囲（この取引のエントリーの 7 日前〜決済の 7 日後。7.7） */
export const PICK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const RATIO_TOL = 1e-9;

// ── 応答の検査 ──

const isRole = (v: unknown): v is GroupRole => v === 'main' || v === 'hedge';
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** まとまりの 1 件の形か（知らない鍵は残す。最低限の鍵だけ見る） */
export function isGroup(v: unknown): v is StoredPositionGroup {
  if (v === null || typeof v !== 'object') return false;
  const g = v as Partial<StoredPositionGroup>;
  return (
    typeof g.id === 'string' &&
    g.id !== '' &&
    typeof g.schemaVersion === 'number' &&
    Array.isArray(g.members) &&
    g.members.every(
      (m) =>
        m !== null &&
        typeof m === 'object' &&
        typeof m.tradeId === 'string' &&
        isRole(m.role) &&
        isTime(m.exitTime) &&
        (m.entryTime === null || isTime(m.entryTime)),
    )
  );
}

/** GET /api/position-groups の応答（`{items, truncated}`）→ まとまりの並び。形が違えば null */
export function parseGroupList(body: unknown): readonly StoredPositionGroup[] | null {
  if (body === null || typeof body !== 'object') return null;
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items) || !items.every(isGroup)) return null;
  return items;
}

// ── 量・時刻 ──

/** 取引の量（エントリーの数量の合計 × 乗数。C76） */
export function volumeOf(t: Pick<StoredTrade, 'record' | 'snapshot'>): number {
  const q = t.record.entries.reduce((s, e) => s + e.quantity, 0);
  return Number((q * t.snapshot.instrument.multiplier).toPrecision(15));
}

/** 最初のエントリーの時刻（時刻の無いエントリーだけなら決済の時刻） */
export function entryStartOf(t: Pick<StoredTrade, 'record'>): number {
  const times = t.record.entries.flatMap((e) => (e.time === undefined ? [] : [e.time]));
  return times.length > 0 ? Math.min(...times) : t.record.exit.time;
}

// ── 計算の入力と状態 ──

/** まとまり → core の計算の入力（取引が見つからないメンバーは trade 無し = 崩れたまとまり） */
export function groupInputOf(
  g: StoredPositionGroup,
  byId: ReadonlyMap<string, StoredTrade>,
): PositionGroupInput {
  return {
    members: g.members.map((m) => {
      const trade = byId.get(m.tradeId);
      return { tradeId: m.tradeId, role: m.role, ...(trade ? { trade } : {}) };
    }),
    ...(g.exit ? { exit: g.exit } : {}),
  };
}

export type GroupState =
  /** 判定に使えるまとまり（ev.ok = false なら、メンバーの取引の入力の誤りで計算できない） */
  | {
      readonly kind: 'ok';
      readonly group: StoredPositionGroup;
      readonly ev: GroupEvaluation;
      /** メンバーの取引（まとまりの並び） */
      readonly members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[];
    }
  /** 崩れたまとまり（4.8。メンバーを単独で判定する） */
  | { readonly kind: 'broken'; readonly group: StoredPositionGroup };

/**
 * まとまりの状態: メンバーの取引がそろい、どれもこのまとまりを指していて（逆参照）、役割の組が崩れていなければ ok。
 * それ以外は broken（判定に使わない）
 */
export function groupStateOf(
  g: StoredPositionGroup,
  byId: ReadonlyMap<string, StoredTrade>,
): GroupState {
  const input = groupInputOf(g, byId);
  const backRef = g.members.every((m) => byId.get(m.tradeId)?.positionGroupId === g.id);
  const ev = evaluatePositionGroup(input);
  if (!backRef || (!ev.ok && ev.problems.length > 0)) return { kind: 'broken', group: g };
  return {
    kind: 'ok',
    group: g,
    ev,
    members: g.members.flatMap((m) => {
      const trade = byId.get(m.tradeId);
      return trade ? [{ trade, role: m.role }] : [];
    }),
  };
}

/** 本玉の並び: 決済の時刻 → 最初のエントリーの時刻 → 取引の ID（core の「最初の本玉」と同じ） */
export function mainsOf(
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
): StoredTrade[] {
  return members
    .filter((m) => m.role === 'main')
    .map((m) => m.trade)
    .sort(
      (a, b) =>
        a.record.exit.time - b.record.exit.time ||
        firstEntry(a) - firstEntry(b) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

const firstEntry = (t: StoredTrade) => t.record.entries[0].time ?? Number.POSITIVE_INFINITY;

/** 最初の本玉（判定の札・R を一覧で出す行。6.5） */
export function firstMainOf(
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
): StoredTrade | undefined {
  return mainsOf(members)[0];
}

/**
 * 判定の枠（Verdict）に渡す Summary（5.8）。R・1R・リスク・判定はまとまりの値、LC の物差しはまとまりを写した入力
 * （本玉の価格・決済 = 部分の量の加重平均の価格 P）。損益は通貨が 1 つのときだけ（違えば pnlList で並べる）
 */
export function groupSummary(
  ev: GroupEvaluation,
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
): Summary {
  const mains = mainsOf(members);
  const first = mains[0];
  const noLc = mains.some(
    (t) => t.record.lc === undefined && t.record.entries.every((e) => e.lc === undefined),
  );
  const fallbackCurrency = first ? accountCurrencyOf(first.snapshot) : 'JPY';
  if (!ev.ok)
    return { noLc, invalid: true, riskNote: RISK_NOTE.invalid, currency: fallbackCurrency };
  const single = ev.pnl?.length === 1 ? ev.pnl[0] : undefined;
  const currency = ev.oneRCurrency ?? single?.currency ?? fallbackCurrency;
  const riskNote =
    ev.riskPct !== undefined
      ? undefined
      : noLc
        ? RISK_NOTE.noLc
        : mains.some((t) => t.snapshot.capitalYen === null)
          ? RISK_NOTE.noCapital
          : RISK_NOTE.noOneR;
  const tp = first?.record.tp;
  const ruler = rulerOf(ev.input, tp) ?? (noLc ? noLcRulerOf(ev.input, tp) : undefined);
  return {
    noLc,
    currency,
    ...(ev.r === undefined ? {} : { r: ev.r }),
    ...(ev.oneRYen === undefined ? {} : { oneRYen: ev.oneRYen }),
    ...(ev.riskPct === undefined ? {} : { riskPct: ev.riskPct }),
    ...(single === undefined ? {} : { pnlYen: single.amount }),
    ...(ev.judgment === undefined ? {} : { judgment: ev.judgment }),
    ...(riskNote === undefined ? {} : { riskNote }),
    ...(ruler === undefined ? {} : { ruler }),
  };
}

/** 損益が 2 つ以上の通貨に分かれるときの並び（「+90,000円 · −250.00 USD」。換算しない。C79）。1 つ以下なら null */
export function pnlListText(ev: GroupEvaluation): string | null {
  if (!ev.ok || ev.pnl === undefined || ev.pnl.length < 2) return null;
  return ev.pnl.map((p) => formatMoney(p.amount, p.currency)).join(' · ');
}

/** まとまりの向き（本玉の向き） */
export function groupSide(ev: GroupEvaluation, mains: readonly StoredTrade[]): Side {
  return ev.ok ? ev.side : (mains[0]?.record.side ?? 'L');
}

/** まとまりの画面の題（「両建て · XYZ 先物 L」。7.7） */
export function groupTitle(
  mains: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
): string {
  const first = mains[0];
  if (!first) return '両建て';
  return `${GROUP_MARK} · ${instrumentNameOf(first, instruments)} ${SIDE_SHORT[first.record.side]}`;
}

/** 解いたトーストのまとまりの名前（「XYZ 先物 L」。題の頭の「両建て · 」を重ねない = 「XYZ 先物 L の両建てを解きました」） */
export function unlinkLabel(
  mains: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
): string {
  const first = mains[0];
  return first ? `${instrumentNameOf(first, instruments)} ${SIDE_SHORT[first.record.side]}` : '';
}

/** 取引の短い名前（「XYZ CFD S 100」） */
export function tradeShortText(t: StoredTrade, instruments: readonly InstrumentRecord[]): string {
  const q = t.record.entries.reduce((s, e) => s + e.quantity, 0);
  return `${instrumentNameOf(t, instruments)} ${SIDE_SHORT[t.record.side]} ${formatQuantity(Number(q.toPrecision(15)))}`;
}

/**
 * 固定の 1 行（7.7）: 「固定 11/20 23:10 · XYZ CFD S 100 · 38,450」。直した価格は「38,440（修正済み）」、一部なら
 * 「量 500 / 1,000 を固定」を足す。固定が無い（固定を外した・決済の代わりが本玉の決済より後）なら「固定なし…」
 */
export function fixLineParts(
  ev: GroupEvaluation,
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
  instruments: readonly InstrumentRecord[],
): readonly string[] {
  if (!ev.ok) return [];
  const fix = ev.fix;
  if (fix === undefined) return ['固定なし（本玉の決済で判定）'];
  const hedges = members.filter((m) => m.role === 'hedge').map((m) => m.trade);
  const [onlyHedge] = hedges;
  const parts = [fix.time === undefined ? '固定' : `固定 ${shortDateTime(fix.time)}`];
  parts.push(
    hedges.length === 1 && onlyHedge
      ? tradeShortText(onlyHedge, instruments)
      : `${ROLE_TEXT.hedge} ${hedges.length} 件`,
  );
  const edited =
    Math.abs(fix.price - fix.derivedPrice) > RATIO_TOL * Math.max(1, Math.abs(fix.derivedPrice));
  parts.push(edited ? `${formatPrice(fix.price)}（修正済み）` : formatPrice(fix.price));
  if (!fix.full)
    parts.push(`量 ${formatQuantity(fix.quantity)} / ${formatQuantity(ev.quantity)} を固定`);
  return parts;
}

/** まとまりの注記（判定の重さに数えない。5.8 の 3・4） */
export function groupNoteText(
  n: GroupNote,
  byId: ReadonlyMap<string, StoredTrade>,
  instruments: readonly InstrumentRecord[],
): string {
  if (n.kind === 'overHedged') {
    return `決済の代わりが量 ${formatQuantity(Number(n.excess.toPrecision(15)))} 多い（判定に使わない）`;
  }
  const t = byId.get(n.tradeId);
  const name = t ? instrumentNameOf(t, instruments) : ROLE_TEXT.hedge;
  return `固定をやめた（${name} を ${shortDateTime(n.time)} に決済）`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 「11/20 23:10」（端末の時間帯） */
export function shortDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** メンバーの詳細の 1 行（判定のカードの代わり。7.7）: 「両建て（本玉）· まとまりの判定 B 悪い損失」 */
export function memberLineText(role: GroupRole, judgment: Judgment | undefined): string {
  return `${GROUP_MARK}（${ROLE_TEXT[role]}）· まとまりの判定 ${badgeModel(judgment?.grade ?? null).label}`;
}

/** メンバーの行（まとまりの画面。7.7）: 役割・銘柄・口座・量・建て → 決済・損益 */
export interface MemberRowModel {
  readonly id: string;
  readonly href: string;
  readonly role: string;
  readonly title: string;
  readonly account?: string;
  readonly volume: string;
  readonly when: string;
  readonly pnl: string | null;
}

export function memberRows(
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
  instruments: readonly InstrumentRecord[],
  accountName: (t: StoredTrade) => string | undefined,
): readonly MemberRowModel[] {
  // 本玉 → 決済の代わり、それぞれエントリーの時刻の順
  const sorted = [...members].sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === 'main' ? -1 : 1) ||
      entryStartOf(a.trade) - entryStartOf(b.trade) ||
      (a.trade.id < b.trade.id ? -1 : 1),
  );
  return sorted.map(({ trade: t, role }) => {
    const account = accountName(t);
    const pnl = memberPnl(t);
    return {
      id: t.id,
      href: `/trades/${t.id}`,
      role: ROLE_TEXT[role],
      title: tradeShortText(t, instruments),
      ...(account === undefined ? {} : { account }),
      volume: `量 ${formatQuantity(volumeOf(t))}`,
      when: `${shortDateTime(entryStartOf(t))} → ${shortDateTime(t.record.exit.time)}`,
      pnl: pnl === undefined ? null : formatMoney(pnl, accountCurrencyOf(t.snapshot)),
    };
  });
}

/** メンバーの損益（明細の損益。無ければ価格から。5.1） */
function memberPnl(t: StoredTrade): number | undefined {
  if (t.record.statementPnlYen !== undefined) return t.record.statementPnlYen;
  const s = t.record.side === 'L' ? 1 : -1;
  const fx =
    t.snapshot.instrument.priceCurrency === accountCurrencyOf(t.snapshot)
      ? 1
      : t.record.exit.fxRate;
  if (fx === undefined) return undefined;
  const v = t.record.entries.reduce(
    (sum, e) =>
      sum +
      s * (t.record.exit.price - e.price) * e.quantity * t.snapshot.instrument.multiplier * fx,
    0,
  );
  return Number.isFinite(v) ? v : undefined;
}

/** なぜのカードの値（メンバーの和。6.5） */
export function groupWhy(members: readonly { readonly trade: StoredTrade }[]): {
  readonly emotions: EmotionTagId[];
  readonly reflection: Reflection;
} {
  const trades = members.map((m) => m.trade);
  return { emotions: unionEmotions(trades), reflection: unionReflection(trades) };
}

// ── 相手を選ぶ（7.7） ──

/** 選べる取引か（足が無く、ほかのまとまりにいない。editing = 直しているまとまりの ID のメンバーは選べる） */
export function linkable(t: StoredTrade, editing?: string): boolean {
  if (t.record.legs !== undefined) return false;
  return t.positionGroupId === undefined || t.positionGroupId === editing;
}

/** 保有の期間が重なるか（相手のエントリー ≤ この取引の決済、かつ相手の決済 ≥ この取引のエントリー。7.7） */
export function overlaps(a: StoredTrade, b: StoredTrade): boolean {
  return entryStartOf(b) <= a.record.exit.time && b.record.exit.time >= entryStartOf(a);
}

/** 原資産の名前の鍵（銘柄の「原資産」、空なら銘柄の名前。名前の同一視 4.1） */
export function underlyingKeyOf(t: StoredTrade, instruments: readonly InstrumentRecord[]): string {
  const inst = instruments.find((i) => i.id === t.record.instrumentId);
  const name = inst?.underlying?.trim() || inst?.name || '';
  return nameKey(name);
}

export interface PickerSections {
  /** 向きが逆・期間が重なる・原資産の名前が同じ */
  readonly opposite: readonly StoredTrade[];
  /** 向きが逆・期間が重なる・原資産の名前は違うが種類が同じ（下の段「ほかの銘柄」） */
  readonly other: readonly StoredTrade[];
  /** 同じ向き・期間が重なる・原資産の名前が同じ（「本玉に加える」） */
  readonly same: readonly StoredTrade[];
}

/** 候補の段（7.7）。並びはエントリーの時刻が近い順 */
export function pickerSections(
  base: StoredTrade,
  pool: readonly StoredTrade[],
  instruments: readonly InstrumentRecord[],
  editing?: string,
): PickerSections {
  const key = underlyingKeyOf(base, instruments);
  const kind = base.snapshot.instrument.underlyingKind;
  const start = entryStartOf(base);
  const seen = new Set<string>([base.id]);
  const out = {
    opposite: [] as StoredTrade[],
    other: [] as StoredTrade[],
    same: [] as StoredTrade[],
  };
  for (const t of pool) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (!linkable(t, editing) || !overlaps(base, t)) continue;
    const sameName = key !== '' && underlyingKeyOf(t, instruments) === key;
    if (t.record.side !== base.record.side) {
      if (sameName) out.opposite.push(t);
      else if (t.snapshot.instrument.underlyingKind === kind) out.other.push(t);
    } else if (sameName) {
      out.same.push(t);
    }
  }
  const near = (a: StoredTrade, b: StoredTrade) =>
    Math.abs(entryStartOf(a) - start) - Math.abs(entryStartOf(b) - start) || (a.id < b.id ? -1 : 1);
  return {
    opposite: out.opposite.sort(near),
    other: out.other.sort(near),
    same: out.same.sort(near),
  };
}

/** 範囲の入口（GET /api/trades?exitFrom&exitTo）に渡す決済の時刻の範囲（7.7） */
export function pickRange(base: StoredTrade): {
  readonly exitFrom: number;
  readonly exitTo: number;
} {
  const exitTo = base.record.exit.time + PICK_WINDOW_MS + 1;
  // 範囲の入口の上限（367 日）に収める。保有が 353 日を超える取引だけ、エントリーの 7 日前より後から読む（まれ）
  return { exitFrom: Math.max(entryStartOf(base) - PICK_WINDOW_MS, exitTo - MAX_RANGE_MS), exitTo };
}

/** 範囲の入口の長さの上限（API の trade_range と同じ 367 日） */
export const MAX_RANGE_MS = 367 * 24 * 60 * 60 * 1000;

/** 本玉の向きの既定（最初にエントリーした取引の側。同じ時刻なら base の側。7.7） */
export function defaultMainSide(base: StoredTrade, picked: readonly StoredTrade[]): Side {
  let first = base;
  for (const t of picked) if (entryStartOf(t) < entryStartOf(first)) first = t;
  return first.record.side;
}

/** 選んだ取引の役割（本玉の向きと同じ = 本玉、逆 = 決済の代わり） */
export function rolesOf(
  base: StoredTrade,
  picked: readonly StoredTrade[],
  mainSide: Side,
): { readonly trade: StoredTrade; readonly role: GroupRole }[] {
  return [base, ...picked].map((trade) => ({
    trade,
    role: trade.record.side === mainSide ? ('main' as const) : ('hedge' as const),
  }));
}

/** 量の比べの 1 行（7.7）: 揃っている / 一部を固定 / 決済の代わりが多い */
export function volumeLine(
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
): string {
  const sumOf = (r: GroupRole) =>
    Number(
      members
        .filter((m) => m.role === r)
        .reduce((s, m) => s + volumeOf(m.trade), 0)
        .toPrecision(15),
    );
  const main = sumOf('main');
  const hedge = sumOf('hedge');
  const head = `${ROLE_TEXT.hedge} 量 ${formatQuantity(hedge)} / ${ROLE_TEXT.main} 量 ${formatQuantity(main)}`;
  if (main <= 0) return head;
  if (Math.abs(hedge - main) <= main * RATIO_TOL) return `${head} · 揃っています`;
  if (hedge < main)
    return `${head} · 量 ${formatQuantity(hedge)} を固定（${Math.round((hedge / main) * 100)}%）`;
  return `${head} · ${ROLE_TEXT.hedge}が量 ${formatQuantity(Number((hedge - main).toPrecision(15)))} 多い`;
}

/** 選んだ組で結べるか（本玉と決済の代わりが 1 件以上ずつ・10 件まで）。押せない理由（null = 結べる） */
export function linkBlock(members: readonly { readonly role: GroupRole }[]): string | null {
  if (members.length < 2) return '相手を選んでください';
  if (!members.some((m) => m.role === 'hedge'))
    return `${ROLE_TEXT.hedge}（逆の向きの取引）を選んでください`;
  if (!members.some((m) => m.role === 'main')) return `${ROLE_TEXT.main}を選んでください`;
  if (members.length > 10) return 'メンバーは 10 件までです';
  return null;
}

/** 選んだ組の判定（下の帯の 1 行。記録する画面の下の帯と同じ形。危ない勝ちは R の代わりに崩れの文。C59） */
export type PreviewLine =
  | { readonly kind: 'none'; readonly text: string }
  | {
      readonly kind: 'judged';
      readonly grade: NonNullable<Judgment['grade']>;
      readonly r?: number;
      readonly riskPct?: number;
      readonly caution?: string;
    };

export function previewLine(
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
  exit?: GroupExitBody,
): PreviewLine {
  const block = linkBlock(members);
  if (block !== null) return { kind: 'none', text: block };
  const ev = evaluatePositionGroup({
    members: members.map((m) => ({ tradeId: m.trade.id, role: m.role, trade: m.trade })),
    ...(exit ? { exit } : {}),
  });
  if (!ev.ok || ev.judgment === undefined) return { kind: 'none', text: '判定は表示されません' };
  const risky = breachView(ev.judgment, ev.r, ev.side);
  if (risky) return { kind: 'judged', grade: ev.judgment.grade, caution: cautionText(risky) };
  return {
    kind: 'judged',
    grade: ev.judgment.grade,
    ...(ev.r === undefined ? {} : { r: ev.r }),
    ...(ev.riskPct === undefined ? {} : { riskPct: ev.riskPct }),
  };
}

/** 結ぶ・置き換える本文（POST / PUT /api/position-groups） */
export function groupBody(
  members: readonly { readonly tradeId: string; readonly role: GroupRole }[],
  exit?: GroupExitBody,
): PositionGroupBody {
  const e = exit ? cleanExit(exit) : undefined;
  return {
    members: members.map((m) => ({ tradeId: m.tradeId, role: m.role })),
    ...(e ? { exit: e } : {}),
  };
}

/** 上書きの空の鍵を落とす（全部空なら undefined = `exit` を送らない = 上書きを消す） */
export function cleanExit(e: GroupExitBody): GroupExitBody | undefined {
  const out: GroupExitBody = {
    ...(e.price !== undefined && Number.isFinite(e.price) && e.price > 0 ? { price: e.price } : {}),
    ...(e.orderType ? { orderType: e.orderType } : {}),
    ...(e.reason ? { reason: e.reason } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── 直す（固定の価格・注文の種類・決済の理由。7.7） ──

export interface ExitDraft {
  /** 固定の価格の欄（空 = 既定の量の加重平均） */
  readonly price: string;
  /** '' = 不明（既定） */
  readonly orderType: '' | 'stop' | 'market' | 'limit';
  /** '' = 最初の本玉の決済の理由（既定） */
  readonly reason: '' | ExitReason;
}

export function exitDraftOf(g: StoredPositionGroup): ExitDraft {
  return {
    price: g.exit?.price === undefined ? '' : String(g.exit.price),
    orderType: g.exit?.orderType ?? '',
    reason: g.exit?.reason ?? '',
  };
}

/** 下書き → 上書き（誤りは error。空の欄は既定 = 鍵を送らない） */
export function readExitDraft(d: ExitDraft): {
  readonly exit?: GroupExitBody;
  readonly error?: string;
} {
  const raw = d.price.normalize('NFKC').replaceAll(',', '').trim();
  let price: number | undefined;
  if (raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return { error: '固定の価格は正の数で入力してください' };
    price = n;
  }
  const exit = cleanExit({
    ...(price === undefined ? {} : { price }),
    ...(d.orderType ? { orderType: d.orderType } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
  });
  return exit ? { exit } : {};
}

/** 「窓・滑りでしたか」を判定のカードで聞くか（持ち続けたが当たり、決済の理由を上書きしていないとき。5.8 の 5） */
export function asksGapSlip(ev: GroupEvaluation, g: StoredPositionGroup): boolean {
  if (!ev.ok || g.exit?.reason !== undefined) return false;
  return ev.judgment?.reasons.some((r) => r.kind === 'heldPastLc') === true;
}

/** 「窓・滑りでしたか」の答え → 決済の理由の上書き（はい = 窓・滑り、いいえ = 最初の本玉の理由。窓・滑りなら「ほか」） */
export function gapSlipReason(answer: boolean, firstMain: StoredTrade | undefined): ExitReason {
  if (answer) return 'gapSlip';
  const r = firstMain?.record.exit.reason;
  return r === undefined || r === 'gapSlip' ? 'other' : r;
}

// ── 一覧の行（6.5） ──

/** 一覧の行に添えるまとまりの値（lead = 最初の本玉の行・member = ほかのメンバーの行・unknown = まとまりを読めていない） */
export type GroupRowInfo =
  | { readonly kind: 'lead'; readonly summary: Summary }
  | { readonly kind: 'member'; readonly role: GroupRole }
  | { readonly kind: 'unknown' };

/** まとまりの索引（取引の ID → 状態。一覧の行・CSV が使う） */
export interface GroupIndex {
  readonly groups: ReadonlyMap<string, GroupState>;
  /** 調べたまとまりの ID（逆参照の指す先。ここに無い ID はまだ読んでいない = unknown） */
  readonly asked: ReadonlySet<string>;
}

export function groupIndexOf(
  groups: readonly StoredPositionGroup[],
  byId: ReadonlyMap<string, StoredTrade>,
  asked: Iterable<string> = groups.map((g) => g.id),
): GroupIndex {
  return {
    groups: new Map(groups.map((g) => [g.id, groupStateOf(g, byId)])),
    asked: new Set(asked),
  };
}

/**
 * 取引の行のまとまりの値: 逆参照が無ければ undefined（今の行のまま）。まとまりが ok なら最初の本玉の行に判定、
 * ほかは役割。崩れた・見つからない（逆参照が指す先が無い）まとまりは undefined（単独の取引として判定する。4.8）。
 * 索引が無い（読めていない・読めなかった）ときは unknown（単独の判定を出さない。C78）
 */
export function groupRowInfo(
  t: StoredTrade,
  index: GroupIndex | null | undefined,
): GroupRowInfo | undefined {
  const gid = t.positionGroupId;
  if (gid === undefined) return undefined;
  if (!index?.asked.has(gid)) return { kind: 'unknown' };
  const st = index.groups.get(gid);
  if (st?.kind !== 'ok') return undefined;
  const me = st.members.find((m) => m.trade.id === t.id);
  if (!me) return undefined;
  const first = firstMainOf(st.members);
  if (first?.id === t.id) return { kind: 'lead', summary: groupSummary(st.ev, st.members) };
  return { kind: 'member', role: me.role };
}
