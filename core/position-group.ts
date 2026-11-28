// 両建てのまとまり（決済の代わり）の計算と判定（設計書 4.8・5.8・C75〜C80・ADR-0027。#265）。
// まとまりは「本玉のエントリーと計画 + まとまりの決済」の 1 つの取引の入力に写し、判定は 5.3・5.4 の同じ関数（judge）を通る。
// メンバー単独の判定は出さない。崩れたまとまり（4.8）は判定を出さず理由を返す（呼ぶ側がメンバーを単独で判定する）。
// 量 = 数量 × 乗数（銘柄の snapshot。為替・通貨は掛けない。C76）。価格は銘柄の価格の通貨、金額は口座の通貨、時点はエポックからのミリ秒
import { CALM, type EmotionTagId, normalizeEmotions } from './emotion-tags';
import { type Judgment, judge, REASON_ORDER, type Reason } from './judge';
import { isOverRisk, oneRYen, pnlYen, rMultiple } from './pnl';
import { accountCurrencyOf, accountIdOf, type StoredTrade, toTradeInput } from './record';
import { normalizeReflection, type Reflection } from './reflection';
import { type BreachKind, breachKindsOf, type ReviewItem } from './review';
import type {
  Entry,
  ExitOrderType,
  ExitReason,
  LcMove,
  Side,
  TimeframeChange,
  TradeInput,
} from './trade';
import { type Issue, validateTrade } from './validate';

/** メンバーの役割: main = 本玉（計画を持つ）/ hedge = 決済の代わり（本玉と逆の向きで損益を固定した） */
export type MemberRole = 'main' | 'hedge';

/** 計算に使う取引の欄（保存した取引のうち） */
export type GroupTrade = Pick<
  StoredTrade,
  'id' | 'createdAt' | 'record' | 'snapshot' | 'emotionTags' | 'reflection'
>;

export interface GroupMember {
  readonly tradeId: string;
  readonly role: MemberRole;
  /** 取引（無い = まとまりが指す取引が見つからない = 崩れたまとまり） */
  readonly trade?: GroupTrade;
}

/** まとまりの決済の上書き（4.8 の `exit`。どれも任意） */
export interface GroupExitOverride {
  /** 本人が直した固定の価格（無い = 決済の代わりの建値の量の加重平均） */
  readonly price?: number;
  /** 決済の代わりを建てた注文の種類（無い = 不明。C78） */
  readonly orderType?: 'stop' | 'market' | 'limit';
  /** 決済の理由（無い = 最初の本玉の決済の理由。「窓・滑りでしたか」の答えもここ） */
  readonly reason?: ExitReason;
}

export interface PositionGroupInput {
  readonly members: readonly GroupMember[];
  readonly exit?: GroupExitOverride;
}

/** メンバーの数の範囲（4.8） */
export const MIN_GROUP_MEMBERS = 2;
export const MAX_GROUP_MEMBERS = 10;
/** 決済の代わりを最初の本玉の決済よりこれを超えて先に決済したら「固定を外した」（5.8 の 3・13.2） */
export const UNFIX_GAP_MS = 30 * 60 * 1000;
/** 量の比の誤差（5.8 の 1・4） */
const RATIO_TOL = 1e-9;

/** 崩れたまとまりの理由（4.8） */
export type GroupProblem =
  | 'memberCount'
  | 'duplicateTrade'
  | 'missingTrade'
  | 'noMain'
  | 'noHedge'
  | 'mainSideMixed'
  | 'hedgeSameSide'
  | 'hasLegs';

/** 決済の部分（5.8 の 2）: 量・価格・時刻・注文の種類 */
export interface GroupExitPart {
  /** fix = 固定した量（決済の代わり）/ rest = 残りを本玉の決済で閉じた量 */
  readonly kind: 'fix' | 'rest';
  readonly quantity: number;
  readonly price: number;
  readonly time?: number;
  readonly orderType: ExitOrderType;
  /** rest の部分の本玉の取引の ID */
  readonly tradeId?: string;
}

/** 判定の重さに数えない、まとまりの注記（5.8 の 3・4） */
export type GroupNote =
  /** 固定を外した（決済の代わりを最初の本玉の決済より 30 分を超えて先に決済した） */
  | { readonly kind: 'unfixed'; readonly tradeId: string; readonly time: number }
  /** 決済の代わりが本玉より多い（超えた量は判定・R に使わない） */
  | { readonly kind: 'overHedged'; readonly excess: number };

export interface GroupFix {
  /**
   * 固定の時点（揃えた決済の代わりのエントリーの時刻。一部だけの固定は最後に数えたエントリーの時刻。
   * 時刻の無いエントリーがあれば無し）
   */
  readonly time?: number;
  /** 固定の価格（上書きがあればその値） */
  readonly price: number;
  /** 上書きの無いときの固定の価格（建値の量の加重平均） */
  readonly derivedPrice: number;
  /** 固定した量（Q 以下） */
  readonly quantity: number;
  /** Q に揃ったか */
  readonly full: boolean;
}

/** 通貨ごとの損益（口座の通貨。換算しない。C79） */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
}

export type GroupEvaluation =
  /** 崩れたまとまり（problems）か、メンバーの取引の入力の誤り（issues。problems は空） */
  | {
      readonly ok: false;
      readonly problems: readonly GroupProblem[];
      readonly issues?: readonly Issue[];
    }
  | {
      readonly ok: true;
      readonly side: Side;
      /** 本玉の量 Q */
      readonly quantity: number;
      /** 固定（固定に数える決済の代わりが無ければ無し = まとまりの決済は本玉の決済そのもの） */
      readonly fix?: GroupFix;
      readonly parts: readonly GroupExitPart[];
      /** 部分の量の加重平均の決済の価格 P */
      readonly exitPrice: number;
      /** まとまりの決済の時刻（リスクが残っていた部分を最後に閉じた時刻） */
      readonly exitTime?: number;
      readonly r?: number;
      /** 本玉の 1R の合計（本玉の口座の通貨が 1 つのとき） */
      readonly oneRYen?: number;
      readonly oneRCurrency?: string;
      /** 口座ごとの本玉の 1R ÷ その口座の資金の大きいほう */
      readonly riskPct?: number;
      readonly overRisk?: boolean;
      /** メンバーの損益の合計（通貨ごと・最初に現れた順。1 件でも損益が出なければ無し） */
      readonly pnl?: readonly CurrencyAmount[];
      readonly judgment?: Judgment;
      readonly notes: readonly GroupNote[];
      /** まとまりを写した 1 件の取引の入力（決済 = P。量を数量、乗数 1。LC の物差しなどに使う） */
      readonly input: TradeInput;
    };

interface Resolved {
  readonly trade: GroupTrade;
  readonly role: MemberRole;
  readonly input: TradeInput;
  /** 乗数（snapshot） */
  readonly multiplier: number;
}

/** 崩れたまとまりの理由（無ければ空。4.8 の API の検査と同じ形 + 無い取引） */
export function groupProblems(members: readonly GroupMember[]): GroupProblem[] {
  const problems: GroupProblem[] = [];
  const add = (p: GroupProblem) => {
    if (!problems.includes(p)) problems.push(p);
  };
  if (members.length < MIN_GROUP_MEMBERS || members.length > MAX_GROUP_MEMBERS) add('memberCount');
  if (new Set(members.map((m) => m.tradeId)).size !== members.length) add('duplicateTrade');
  if (members.some((m) => m.trade === undefined || m.trade.id !== m.tradeId)) add('missingTrade');
  const mains = members.filter((m) => m.role === 'main');
  const hedges = members.filter((m) => m.role === 'hedge');
  if (mains.length === 0) add('noMain');
  if (hedges.length === 0) add('noHedge');
  const mainSides = new Set(mains.flatMap((m) => (m.trade ? [m.trade.record.side] : [])));
  if (mainSides.size > 1) add('mainSideMixed');
  const [mainSide] = [...mainSides];
  if (
    mainSide !== undefined &&
    mainSides.size === 1 &&
    hedges.some((m) => m.trade !== undefined && m.trade.record.side === mainSide)
  ) {
    add('hedgeSameSide');
  }
  if (members.some((m) => m.trade?.record.legs !== undefined)) add('hasLegs');
  return problems;
}

/** エントリーの量（数量 × 乗数）と持ち主 */
interface SizedEntry {
  readonly owner: Resolved;
  readonly entry: Entry;
  readonly size: number;
  /** その時点の LC（エントリーの LC か取引の LC） */
  readonly lc?: number;
}

function sizedEntries(rs: readonly Resolved[]): SizedEntry[] {
  return rs.flatMap((owner) =>
    owner.input.entries.map((entry) => {
      const lc = entry.lc ?? owner.input.lc;
      return {
        owner,
        entry,
        size: entry.quantity * owner.multiplier,
        ...(lc === undefined ? {} : { lc }),
      };
    }),
  );
}

/** 時刻の順（時刻の無いエントリーが 1 つでもあれば記録の並びのまま。5.8 の 3） */
function byTime(es: readonly SizedEntry[]): SizedEntry[] {
  if (es.some((e) => e.entry.time === undefined)) return [...es];
  return [...es].sort((a, b) => (a.entry.time ?? 0) - (b.entry.time ?? 0));
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** 崩れの側に寄せた LC の動き（広げた > 取り消した > 狭めた > なし） */
function mergedLcMove(mains: readonly Resolved[], ref: number | undefined): LcMove {
  if (mains.some((m) => m.input.lcMove.kind === 'widened')) {
    return { kind: 'widened', ...(ref === undefined ? {} : { after: ref }) };
  }
  if (mains.some((m) => m.input.lcMove.kind === 'cancelled')) return { kind: 'cancelled' };
  if (mains.some((m) => m.input.lcMove.kind === 'tightened')) return { kind: 'tightened' };
  return { kind: 'none' };
}

function mergedTimeframeChange(mains: readonly Resolved[]): TimeframeChange {
  if (mains.some((m) => m.input.timeframeChange === 'longer')) return 'longer';
  if (mains.some((m) => m.input.timeframeChange === 'shorter')) return 'shorter';
  return 'none';
}

/** 持ち続けたの比較先（C30）: 時刻の最後の本玉のエントリーの LC。その持ち主が広げていれば広げた後の値 */
function referenceLc(last: SizedEntry | undefined): number | undefined {
  if (last === undefined) return undefined;
  const move = last.owner.input.lcMove;
  if (move.kind === 'widened') return move.after;
  return last.lc;
}

interface FixResult {
  readonly fix?: GroupFix;
  readonly notes: GroupNote[];
}

/** 固定の時点と価格（5.8 の 1・3・4） */
function fixOf(
  mains: readonly Resolved[],
  hedges: readonly Resolved[],
  q: number,
  override: GroupExitOverride | undefined,
): FixResult {
  const notes: GroupNote[] = [];
  const firstMainExit = Math.min(...mains.map((m) => m.trade.record.exit.time));
  const eligible: Resolved[] = [];
  for (const h of hedges) {
    const hx = h.trade.record.exit.time;
    // 最初の本玉の決済より 30 分を超えて先に決済した = 固定を外した（ちょうど 30 分は外していない）
    if (Number.isFinite(firstMainExit) && firstMainExit - hx > UNFIX_GAP_MS) {
      notes.push({ kind: 'unfixed', tradeId: h.trade.id, time: hx });
    } else {
      eligible.push(h);
    }
  }
  // 本玉の決済（最初の本玉の決済）より後に建てたエントリーは固定に数えない
  const entries = byTime(
    sizedEntries(eligible).filter(
      (e) => e.entry.time === undefined || e.entry.time <= firstMainExit,
    ),
  );
  let used = 0;
  let weighted = 0;
  let time: number | undefined;
  let timeKnown = true;
  let reached = false;
  let extra = 0;
  for (const e of entries) {
    if (reached) {
      extra += e.size;
      continue;
    }
    const take = Math.min(e.size, q - used);
    used += take;
    weighted += take * e.entry.price;
    extra += e.size - take;
    if (e.entry.time === undefined) timeKnown = false;
    time = e.entry.time;
    if (used >= q * (1 - RATIO_TOL)) reached = true;
  }
  if (extra > q * RATIO_TOL) notes.push({ kind: 'overHedged', excess: extra });
  if (!(used > 0)) return { notes };
  const derivedPrice = weighted / used;
  const price = override?.price ?? derivedPrice;
  return {
    fix: {
      ...(timeKnown && time !== undefined ? { time } : {}),
      price,
      derivedPrice,
      quantity: reached ? q : used,
      full: reached,
    },
    notes,
  };
}

/** 決済の部分（5.8 の 2）。固定が無ければ本玉ごとの決済そのもの */
function partsOf(
  mains: readonly Resolved[],
  q: number,
  fix: GroupFix | undefined,
  override: GroupExitOverride | undefined,
): GroupExitPart[] {
  const parts: GroupExitPart[] = [];
  const fixed = fix?.quantity ?? 0;
  if (fix !== undefined) {
    parts.push({
      kind: 'fix',
      quantity: fixed,
      price: fix.price,
      ...(fix.time === undefined ? {} : { time: fix.time }),
      orderType: override?.orderType ?? 'unknown',
    });
  }
  const rest = q - fixed;
  if (rest > q * RATIO_TOL) {
    for (const m of mains) {
      const size = sum(m.input.entries.map((e) => e.quantity)) * m.multiplier;
      const x = m.trade.record.exit;
      parts.push({
        kind: 'rest',
        quantity: (rest * size) / q,
        price: x.price,
        time: x.time,
        orderType: x.orderType,
        tradeId: m.trade.id,
      });
    }
  }
  return parts;
}

/** 損益の合計（通貨ごと。1 件でも損益が出なければ無し。C79） */
function pnlOf(rs: readonly Resolved[]): CurrencyAmount[] | undefined {
  const by = new Map<string, number>();
  for (const m of rs) {
    const v = pnlYen(m.input);
    if (v === undefined || !Number.isFinite(v)) return undefined;
    const c = accountCurrencyOf(m.trade.snapshot);
    by.set(c, (by.get(c) ?? 0) + v);
  }
  return [...by].map(([currency, amount]) => ({ currency, amount }));
}

interface RiskResult {
  readonly oneRYen?: number;
  readonly oneRCurrency?: string;
  readonly riskPct?: number;
  /** 判定に渡す資金（どの口座も資金があるとき、リスクの大きい口座の資金） */
  readonly capitalYen?: number;
}

/** 1R（本玉の合計）とリスク（口座ごとの大きいほう）。5.8 の 8 */
function riskOf(mains: readonly Resolved[]): RiskResult {
  const oneRs = mains.map((m) => oneRYen(m.input));
  if (oneRs.some((v) => v === undefined || !Number.isFinite(v))) return {};
  const values = oneRs as number[];
  const currencies = new Set(mains.map((m) => accountCurrencyOf(m.trade.snapshot)));
  const [currency] = [...currencies];
  const total =
    currencies.size === 1 && currency !== undefined
      ? { oneRYen: sum(values), oneRCurrency: currency }
      : {};
  const accounts = new Map<string, { oneR: number; capital: number | null }>();
  mains.forEach((m, i) => {
    const id = accountIdOf(m.trade.record);
    const now = accounts.get(id);
    accounts.set(id, {
      oneR: (now?.oneR ?? 0) + (values[i] ?? 0),
      capital: now === undefined ? m.trade.snapshot.capitalYen : now.capital,
    });
  });
  let best: { pct: number; capital: number } | undefined;
  for (const a of accounts.values()) {
    if (a.capital === null || !(a.capital > 0)) return total;
    const pct = (a.oneR / a.capital) * 100;
    if (best === undefined || pct > best.pct) best = { pct, capital: a.capital };
  }
  return best === undefined ? total : { ...total, riskPct: best.pct, capitalYen: best.capital };
}

/** 本玉の計画を 1 件の取引の入力に写す（決済は後で付ける。量を数量、乗数 1） */
function mergedInput(mains: readonly Resolved[], firstMain: Resolved): TradeInput {
  const entries = byTime(sizedEntries(mains));
  const last = entries[entries.length - 1];
  const ref = referenceLc(last);
  const allLc = entries.every((e) => e.lc !== undefined);
  const widened = mains.find((m) => m.input.lcMove.kind === 'widened');
  const tradeLc = (widened ?? firstMain).input.lc ?? firstMain.input.lc;
  const chartLonger = mains.find(
    (m) => m.input.entryChartTimeframe !== undefined && m.input.exitChartTimeframe !== undefined,
  );
  const f = firstMain.input;
  const chart = chartLonger?.input ?? f;
  const merged = entries.map((e) => ({
    ...(e.entry.time === undefined ? {} : { time: e.entry.time }),
    price: e.entry.price,
    quantity: e.size,
    ...(e.lc === undefined ? {} : { lc: e.lc }),
  }));
  const [head, ...tail] = merged;
  if (head === undefined) throw new Error('本玉のエントリーがありません');
  return {
    side: f.side,
    instrument: { multiplier: 1, quantityStep: 1, priceInAccountCurrency: true },
    entries: [head, ...tail],
    ...(allLc && tradeLc !== undefined ? { lc: tradeLc } : {}),
    lcBasis: mains.some((m) => m.input.lcBasis === 'amount') ? 'amount' : 'chart',
    lcDecidedBeforeEntry: mains.every((m) => m.input.lcDecidedBeforeEntry),
    lcMove: mergedLcMove(mains, ref),
    timeframeChange: mergedTimeframeChange(mains),
    ...(f.timeframe === undefined ? {} : { timeframe: f.timeframe }),
    ...(chart.entryChartTimeframe === undefined
      ? {}
      : { entryChartTimeframe: chart.entryChartTimeframe }),
    ...(chart.exitChartTimeframe === undefined
      ? {}
      : { exitChartTimeframe: chart.exitChartTimeframe }),
    riskTolerancePct: f.riskTolerancePct,
  };
}

/** 決済の部分のうち、比較先に対して最も不利な価格の部分（同じなら先） */
function worstPart(parts: readonly GroupExitPart[], side: Side): GroupExitPart | undefined {
  const s = side === 'L' ? 1 : -1;
  let worst: GroupExitPart | undefined;
  for (const p of parts) if (worst === undefined || s * p.price < s * worst.price) worst = p;
  return worst;
}

/** 理由の並びを 5.3 の表の順に揃え、広げた・取り消したを本玉の値で表す */
function fixReasons(reasons: readonly Reason[], mains: readonly Resolved[]): Reason[] {
  const widened = mains.find((m) => m.input.lcMove.kind === 'widened');
  const out: Reason[] = reasons.map((r) => {
    if (r.kind !== 'lcWidened' || widened === undefined) return r;
    const move = widened.input.lcMove;
    const to = move.kind === 'widened' ? move.after : undefined;
    const from = widened.input.lc;
    return {
      kind: 'lcWidened',
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
  });
  // 広げた本玉と取り消した本玉が両方あれば、取り消したも理由に（どちらも B。答えは崩れの側に寄せる）
  if (
    mains.some((m) => m.input.lcMove.kind === 'cancelled') &&
    !out.some((r) => r.kind === 'lcCancelled')
  ) {
    out.push({ kind: 'lcCancelled' });
  }
  const order = (r: Reason) => REASON_ORDER.indexOf(r.kind);
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order(a.r) - order(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** まとまりの計算と判定（5.8） */
export function evaluatePositionGroup(group: PositionGroupInput): GroupEvaluation {
  const problems = groupProblems(group.members);
  if (problems.length > 0) return { ok: false, problems };

  const resolved: Resolved[] = group.members.flatMap((m) =>
    m.trade === undefined
      ? []
      : [
          {
            trade: m.trade,
            role: m.role,
            input: toTradeInput(m.trade),
            multiplier: m.trade.snapshot.instrument.multiplier,
          },
        ],
  );
  const issues = resolved.flatMap((m) => validateTrade(m.input));
  if (issues.length > 0) return { ok: false, problems: [], issues };

  const mains = resolved.filter((m) => m.role === 'main');
  const hedges = resolved.filter((m) => m.role === 'hedge');
  // 最初の本玉 = 決済の時刻の早い本玉（同じなら結んだ順）
  const firstMain = [...mains].sort(
    (a, b) => a.trade.record.exit.time - b.trade.record.exit.time,
  )[0];
  if (firstMain === undefined) return { ok: false, problems: ['noMain'] };

  const q = sum(sizedEntries(mains).map((e) => e.size));
  const { fix, notes } = fixOf(mains, hedges, q, group.exit);
  const parts = partsOf(mains, q, fix, group.exit);
  const exitPrice = sum(parts.map((p) => p.quantity * p.price)) / q;
  const rest = parts.filter((p) => p.kind === 'rest');
  const exitTime =
    rest.length > 0 || fix?.time === undefined
      ? Math.max(...mains.map((m) => m.trade.record.exit.time))
      : fix.time;

  const base = mergedInput(mains, firstMain);
  const reason = group.exit?.reason ?? firstMain.input.exit?.reason ?? 'other';
  // 決済の理由の上書きが無ければ、最初の本玉の「窓・滑りでしたか」の答えも使う
  const gap =
    group.exit?.reason === undefined && firstMain.input.gapSlipAnswer !== undefined
      ? { gapSlipAnswer: firstMain.input.gapSlipAnswer }
      : {};
  const fixedOrder = parts.find((p) => p.kind === 'fix')?.orderType;
  const input: TradeInput = {
    ...base,
    ...gap,
    exit: {
      ...(Number.isFinite(exitTime) ? { time: exitTime } : {}),
      price: exitPrice,
      orderType: fixedOrder ?? firstMain.input.exit?.orderType ?? 'unknown',
      reason,
    },
  };

  const r = rMultiple(input);
  const risk = riskOf(mains);
  const pnl = pnlOf(resolved);
  const [only] = pnl ?? [];
  const singlePnl = pnl?.length === 1 && only !== undefined ? only.amount : undefined;
  const overRisk = risk.riskPct === undefined ? undefined : isOverRisk(risk.riskPct);
  const judged: TradeInput = {
    ...input,
    ...(risk.capitalYen === undefined ? {} : { capitalYen: risk.capitalYen }),
  };
  // 判定に渡す 1R は「出たか」だけを見る（口座の通貨が違えば額は出さないが、リスクが出れば確かめてある）
  const judgeOneR = risk.oneRYen ?? (risk.riskPct === undefined ? undefined : 1);
  const nums = {
    ...(r === undefined ? {} : { r }),
    ...(singlePnl === undefined ? {} : { pnlYen: singlePnl }),
    ...(judgeOneR === undefined ? {} : { oneRYen: judgeOneR }),
    ...(risk.riskPct === undefined ? {} : { riskPct: risk.riskPct, overRisk: overRisk === true }),
  };

  const judgment = judgeByParts(judged, parts, nums);
  const fixedJudgment =
    judgment === undefined
      ? undefined
      : { ...judgment, reasons: fixReasons(judgment.reasons, mains) };

  return {
    ok: true,
    side: base.side,
    quantity: q,
    ...(fix === undefined ? {} : { fix }),
    parts,
    exitPrice,
    ...(Number.isFinite(exitTime) ? { exitTime } : {}),
    ...(r === undefined ? {} : { r }),
    ...(risk.oneRYen === undefined ? {} : { oneRYen: risk.oneRYen }),
    ...(risk.oneRCurrency === undefined ? {} : { oneRCurrency: risk.oneRCurrency }),
    ...(risk.riskPct === undefined ? {} : { riskPct: risk.riskPct, overRisk: overRisk === true }),
    ...(pnl === undefined ? {} : { pnl }),
    ...(fixedJudgment === undefined ? {} : { judgment: fixedJudgment }),
    notes,
    input,
  };
}

/**
 * 持ち続けたは部分ごとに見る（C78）: 部分ごとにその部分の価格・注文の種類を決済にして判定し、持ち続けたが当たる部分が
 * あればその判定、無ければ最も不利な部分の判定（逆指値で切れた・窓・滑りの注記がその部分から出る）。
 * 勝ち負けの境は R（部分に依らない）。R が出なければ P のまま判定する（持ち続けたは R が要るので当たらない）
 */
function judgeByParts(
  t: TradeInput,
  parts: readonly GroupExitPart[],
  nums: Parameters<typeof judge>[1],
): Judgment | undefined {
  const exit = t.exit;
  if (exit === undefined || nums.r === undefined) return judge(t, nums);
  const at = (p: GroupExitPart) =>
    judge({ ...t, exit: { ...exit, price: p.price, orderType: p.orderType } }, nums);
  for (const p of parts) {
    const j = at(p);
    if (j?.reasons.some((x) => x.kind === 'heldPastLc')) return j;
  }
  const worst = worstPart(parts, t.side);
  return worst === undefined ? judge(t, nums) : at(worst);
}

/** 心理のタグの和（平常心とほかのタグがあれば平常心を外す。6.5） */
export function unionEmotions(trades: readonly Pick<GroupTrade, 'emotionTags'>[]): EmotionTagId[] {
  const all = normalizeEmotions(trades.flatMap((t) => t.emotionTags ?? []));
  return all.length > 1 ? all.filter((t) => t !== CALM) : all;
}

/** Good / More の和（話題は和、自分で書いた行はメンバーの順に並べ同じ文は 1 つ。6.5） */
export function unionReflection(trades: readonly Pick<GroupTrade, 'reflection'>[]): Reflection {
  const side = (k: 'good' | 'more') => ({
    topics: trades.flatMap((t) => t.reflection?.[k].topics ?? []),
    notes: [...new Set(trades.flatMap((t) => t.reflection?.[k].notes ?? []))],
  });
  return normalizeReflection({ good: side('good'), more: side('more') });
}

/**
 * 振り返りの 1 件の項目（6.5・C80。#268 が使う）。決済の時刻 = まとまりの決済の時刻、作った時刻 = メンバーの最も早い時刻、
 * 取り込んだメンバーがあれば取り込み。判定の出ないまとまりは grade: null。崩れたまとまりは無し（メンバーを単独で数える）
 */
export function groupReviewItem(
  id: string,
  group: PositionGroupInput,
  ev: GroupEvaluation = evaluatePositionGroup(group),
): ReviewItem | undefined {
  if (!ev.ok || ev.exitTime === undefined) return undefined;
  const trades = group.members.flatMap((m) => (m.trade === undefined ? [] : [m.trade]));
  const emotions = unionEmotions(trades);
  const reflection = unionReflection(trades);
  const hasReflection =
    reflection.good.topics.length +
      reflection.good.notes.length +
      reflection.more.topics.length +
      reflection.more.notes.length >
    0;
  const reasons: BreachKind[] = breachKindsOf(ev.judgment?.reasons ?? []);
  return {
    id,
    exitTime: ev.exitTime,
    createdAt: Math.min(...trades.map((t) => t.createdAt)),
    grade: ev.judgment?.grade ?? null,
    ...(ev.r === undefined ? {} : { r: ev.r }),
    imported: trades.some((t) => t.record.source === 'import'),
    ...(emotions.length === 0 ? {} : { emotions }),
    ...(hasReflection ? { reflection } : {}),
    ...(reasons.length === 0 ? {} : { reasons }),
  };
}
