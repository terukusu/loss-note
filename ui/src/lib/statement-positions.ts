// 決済明細のオプションの行をポジションの下書きにまとめる規則（#118。設計書 7.6・C51・C54・4.7）。純関数（DOM・通信・今の時刻なし）。
// - まとまり（unit）= 明細の行の番号の並び。先物の行は 1 行 = 1 件、オプションの行は API の position ごとに 1 件（最初に出た順）。
//   「i / N 件目」は取引とポジションを合わせて数える（7.6 の 2）
// - ポジションの合成の行（unitRow）: 原資産の名前・最初に建てた時刻・最後に決済した時刻・損益と手数料の合計。下書きへの流し込み
//   （fillFromRow）・時間帯の確かめ（statement-tz.ts）は先物の行と同じ道を通る。プレミアムの価格・枚数は取引の欄へ入れない
// - レッグの下書き（unitLegs）: 明細の行 1 つ = 1 レッグ（読み取りの印つき）。まとめ直しても本人が直したレッグは保つ
// - [別のポジションにする]（splitUnit）・［このポジションに入れる］（mergeNext。7.6 の [前のポジションに入れる] を前の側から押す形）
// - C54 の既定（syncExpiry）: 決済の時点が SQ（注文の種類 expiry）なら、明細の逆指値から入れた既定（決済の理由 = LC・逆指値を
//   入れた）を触っていなければ外し、決済の時刻を SQ の日に。SQ でなくなれば明細の値に戻す
// - 手で足した決済のレッグの損益を明細の損益に足す（statementPnlWithLegs。4.7）
import { legPnlPrice, positionExitOrderType, positionExitPoint } from '../../../core/option';
import type { InstrumentRecord } from '../../../core/record';
import type { Leg } from '../../../core/trade';
import { toLocalInput } from './datetime';
import { formatPlain } from './format';
import { nameKey } from './instrument-name';
import { type LegDraft, legCardText, readLegs } from './legs-form';
import type { Draft, DraftField, DraftReading } from './record-form';
import type { FieldMark, Marks, ReadRow, ReadTime } from './statement-fill';
import { type TzId, wallToEpoch } from './statement-tz';

/** まとまり: 明細の行の番号（0 から）の並び */
export type Unit = readonly number[];

const isOption = (r: ReadRow | undefined): boolean => r?.option !== undefined;

/**
 * 応答の行 → まとまりの並び。先物の行は 1 行ずつ、オプションの行は position が同じ行を 1 つに（最初に出た位置に置く）。
 * position が無い行は 1 行ずつ
 */
export function initialUnits(rows: readonly ReadRow[]): Unit[] {
  const units: number[][] = [];
  const byPos = new Map<number, number[]>();
  rows.forEach((r, i) => {
    const pos = r.option?.position ?? null;
    if (r.option === undefined || pos === null) {
      units.push([i]);
      return;
    }
    const u = byPos.get(pos);
    if (u) u.push(i);
    else {
      const fresh = [i];
      byPos.set(pos, fresh);
      units.push(fresh);
    }
  });
  return units;
}

/** オプションのポジションを含むか（「件目」で数える） */
export function hasPositions(rows: readonly ReadRow[]): boolean {
  return rows.some((r) => r.legs !== undefined);
}

const pick = (ts: readonly (ReadTime | null)[], later: boolean): ReadTime | null => {
  let best: ReadTime | null = null;
  for (const t of ts) {
    if (t === null) continue;
    // 同じ明細の時刻は同じ時間帯で書かれているので、書かれた文字（YYYY-MM-DDTHH:MM）の順 = 時刻の順
    if (best === null || (later ? t.written > best.written : t.written < best.written)) best = t;
  }
  return best;
};

/** 足し算の誤差を丸める（0.1 + 0.2 を 0.3 に。15 桁） */
const tidy = (n: number): number => Number.parseFloat(n.toPrecision(15));

function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return tidy((values as number[]).reduce((a, b) => a + b, 0));
}

/**
 * まとまり → 画面が使う 1 行。先物の行はそのまま。オプションのまとまりは合成の行: 銘柄 = 原資産の名前（無ければ明細の銘柄）、
 * イン / 決済 / 数量 / L / S は空（原資産の価格は本人が入れる。13.2）、損益・手数料は全部の行が読めて通貨がそろうときだけ合計、
 * エントリーの時刻 = いちばん早い建て、決済の時刻 = いちばん遅い決済、注文の種類 = 最後に決済した行の値
 */
export function unitRow(raw: readonly ReadRow[], unit: Unit): ReadRow | undefined {
  const rows = unit.map((i) => raw[i]).filter((r): r is ReadRow => r !== undefined);
  const [first] = rows;
  if (first === undefined || rows.length !== unit.length) return undefined;
  if (!isOption(first)) return first;
  const currencies = new Set(rows.map((r) => r.pnlCurrency));
  const sameCurrency = currencies.size === 1;
  const exitTime = pick(
    rows.map((r) => r.exitTime),
    true,
  );
  const last =
    exitTime === null ? rows[rows.length - 1] : rows.find((r) => r.exitTime === exitTime);
  const fees = rows.every((r) => r.fees !== null) ? rows.flatMap((r) => r.fees ?? []) : null;
  const name =
    rows.map((r) => r.option?.underlying ?? null).find((n) => n !== null) ??
    rows.map((r) => r.symbol).find((n) => n !== null) ??
    null;
  return {
    symbol: name,
    side: null,
    entryPrice: null,
    exitPrice: null,
    quantity: null,
    pnl: sameCurrency ? sumOrNull(rows.map((r) => r.pnl)) : null,
    pnlCurrency: sameCurrency ? first.pnlCurrency : 'unknown',
    entryTime: pick(
      rows.map((r) => r.entryTime),
      false,
    ),
    exitTime,
    timeZoneNeedsCheck: rows.some((r) => r.timeZoneNeedsCheck),
    fees,
    feesTotal: sumOrNull(rows.map((r) => r.feesTotal)),
    exitOrderType: last?.exitOrderType ?? 'unknown',
    ...(first.option ? { option: first.option } : {}),
    legs: rows,
    legRaw: unit,
  };
}

/** まとまりの並び → 画面が使う行の並び（形の外れたまとまりは無い = 呼ぶ側が作らない） */
export function unitRows(raw: readonly ReadRow[], units: readonly Unit[]): ReadRow[] {
  return units.map((u) => unitRow(raw, u)).filter((r): r is ReadRow => r !== undefined);
}

const underlyingKey = (raw: readonly ReadRow[], unit: Unit): string | null => {
  const r = unitRow(raw, unit);
  return r?.symbol == null ? null : nameKey(r.symbol);
};

/**
 * [別のポジションにする]: index のまとまりから明細の行 r を外し、すぐ後ろに 1 行のまとまりとして置く（次に記録する）。
 * オプションのまとまりで 2 行以上のときだけ。できなければ null
 */
export function splitUnit(
  raw: readonly ReadRow[],
  units: readonly Unit[],
  index: number,
  r: number,
): Unit[] | null {
  const u = units[index];
  if (u === undefined || u.length < 2 || !u.includes(r) || !isOption(raw[r])) return null;
  return [...units.slice(0, index), u.filter((x) => x !== r), [r], ...units.slice(index + 1)];
}

/**
 * index より後で、同じ原資産（名前の同一視 4.1）のいちばん近いオプションのまとまりの番号（［このポジションに入れる］の相手）。
 * 無ければ null
 */
export function nextPositionIndex(
  raw: readonly ReadRow[],
  units: readonly Unit[],
  index: number,
): number | null {
  const u = units[index];
  if (u === undefined || !isOption(raw[u[0] as number])) return null;
  const key = underlyingKey(raw, u);
  for (let j = index + 1; j < units.length; j++) {
    const v = units[j] as Unit;
    if (isOption(raw[v[0] as number]) && underlyingKey(raw, v) === key) return j;
  }
  return null;
}

/** ［このポジションに入れる］: 次のポジション（nextPositionIndex）の行を index のまとまりに入れる（明細の順に並べ直す） */
export function mergeNext(
  raw: readonly ReadRow[],
  units: readonly Unit[],
  index: number,
): Unit[] | null {
  const j = nextPositionIndex(raw, units, index);
  if (j === null) return null;
  const merged = [...(units[index] as Unit), ...(units[j] as Unit)].sort((a, b) => a - b);
  return units.flatMap((u, k) => (k === index ? [merged] : k === j ? [] : [u]));
}

const num = (n: number | null): string => (n === null ? '' : formatPlain(n));

/** 明細の時刻 → epoch（時間帯が読めていればそれ、読めなければ選んだ時間帯で。どちらも無ければ無し） */
function timeMs(t: ReadTime | null, zone: TzId | null): number | undefined {
  if (t === null) return undefined;
  if (t.epochMs !== null) return t.epochMs;
  if (zone === null) return undefined;
  const r = wallToEpoch(t.written, zone);
  return r.kind === 'ok' ? r.ms : undefined;
}

/** 明細のオプションの行 → レッグの下書き（読み取りの印つき。P / C・限月・行使価格・売買は読めなければ空） */
export function legDraftOf(row: ReadRow, raw: number, unit: Unit, zone: TzId | null): LegDraft {
  const o = row.option;
  const entryTime = timeMs(row.entryTime, zone);
  const exitTime = timeMs(row.exitTime, zone);
  return {
    optionType: o?.putCall === 'put' ? 'P' : o?.putCall === 'call' ? 'C' : null,
    contractMonth: o?.expiry ?? '',
    strike: num(o?.strike ?? null),
    side: o?.side ?? null,
    quantity: num(row.quantity),
    entryPrice: num(row.entryPrice),
    exitPrice: num(row.exitPrice),
    expired: false,
    ...(entryTime === undefined ? {} : { entryTime }),
    ...(exitTime === undefined ? {} : { exitTime }),
    read: { raw, unit, yearInferred: o?.expiryYearInferred === true },
  };
}

/**
 * ポジションのレッグの並び: 明細の行の順のレッグ（前の下書きに同じ行のレッグがあれば、本人の直しごと保つ）+ 手で足したレッグ。
 * 10 本を超えても黙って落とさない（readLegs が保存を止める）
 */
export function unitLegs(
  current: readonly LegDraft[],
  row: ReadRow,
  zone: TzId | null,
): LegDraft[] {
  const legs = row.legs ?? [];
  const at = row.legRaw ?? [];
  const byRaw = new Map<number, LegDraft>();
  for (const l of current) if (l.read !== undefined) byRaw.set(l.read.raw, l);
  const read = legs.map((r, i) => {
    const raw = at[i] as number;
    const kept = byRaw.get(raw);
    return kept?.read
      ? { ...kept, read: { ...kept.read, unit: at } }
      : legDraftOf(r, raw, at, zone);
  });
  return [...read, ...current.filter((l) => l.read === undefined)];
}

/** 時間帯を選んだ・外したとき: 明細から読んだレッグの時刻を、明細の行から当て直す（時間帯が無ければ時刻なし） */
export function legsWithZone(
  legs: readonly LegDraft[],
  raw: readonly ReadRow[],
  zone: TzId | null,
): LegDraft[] {
  return legs.map((l) => {
    const r = l.read === undefined ? undefined : raw[l.read.raw];
    if (r === undefined) return l;
    const { entryTime: _e, exitTime: _x, ...rest } = l;
    const entryTime = timeMs(r.entryTime, zone);
    const exitTime = timeMs(r.exitTime, zone);
    return {
      ...rest,
      ...(entryTime === undefined ? {} : { entryTime }),
      ...(exitTime === undefined ? {} : { exitTime }),
    };
  });
}

/** 明細の時刻 → 欄の文字と印（statement-fill の timeField と同じ。時間帯を選んでいればその時間帯で） */
function statementTime(t: ReadTime | null, zone: TzId | null): { value: string; mark: FieldMark } {
  if (t === null) return { value: '', mark: 'unread' };
  const ms = timeMs(t, zone);
  if (ms !== undefined) return { value: toLocalInput(ms), mark: 'read' };
  return { value: t.written, mark: 'tz' };
}

/**
 * C54 の既定（明細から作ったポジションの下書きだけ）。決済の時点が SQ（注文の種類が expiry になる）なら:
 * - 明細の逆指値から入れた既定を外す（触っていなければ決済の理由 = その他・印なし、逆指値を入れたか = 未回答）
 * - 決済の時刻を SQ の日（満期で消えたレッグの時刻 = その日の日本時間の終わり）に（触っていなければ。印「SQ の日」）
 * SQ でなくなれば明細の値に戻す（決済の理由 = LC・印「明細から」、逆指値を入れた、決済の時刻 = 明細の時刻）。
 * レッグがそろっていない間は変えない
 */
export function syncExpiry(
  draft: Draft,
  marks: Marks,
  touched: ReadonlySet<DraftField>,
  row: ReadRow | undefined,
  zone: TzId | null,
): { readonly draft: Draft; readonly marks: Marks } {
  if (draft.source !== 'statement' || row?.legs === undefined || draft.legs.length === 0) {
    return { draft, marks };
  }
  const legs = readLegs(draft.legs).legs;
  if (legs === undefined) return { draft, marks };
  const sq = positionExitOrderType(legs, draft.exitOrderType) === 'expiry';
  const patch: { -readonly [K in keyof Draft]?: Draft[K] } = {};
  const m: Partial<Record<DraftField, FieldMark>> = { ...marks };
  if (draft.exitOrderType === 'stop') {
    patch.stopOrderPlaced = sq ? 'unanswered' : 'placed';
    if (!touched.has('exitReason')) {
      patch.exitReason = sq ? 'other' : 'lc';
      if (sq) delete m.exitReason;
      else m.exitReason = 'statement';
    }
  }
  if (!touched.has('exitTime')) {
    const point = positionExitPoint(legs);
    const sqTime = point !== undefined && point.kind !== 'closed' ? point.time : undefined;
    if (sqTime !== undefined) {
      patch.exitTime = toLocalInput(sqTime);
      m.exitTime = 'sq';
    } else if (m.exitTime === 'sq') {
      const t = statementTime(row.exitTime, zone);
      patch.exitTime = t.value;
      m.exitTime = t.mark;
    }
  }
  const draftSame = (Object.keys(patch) as (keyof Draft)[]).every((k) => patch[k] === draft[k]);
  const keys = new Set([...Object.keys(m), ...Object.keys(marks)] as DraftField[]);
  const marksSame = [...keys].every((k) => m[k] === marks[k]);
  return {
    draft: draftSame ? draft : { ...draft, ...patch },
    marks: marksSame ? marks : m,
  };
}

/**
 * 明細の損益（ポジションの明細の行の合計）+ 手で足した決済したレッグの導出の損益（4.7）。
 * - 明細から読んだレッグが欠けた（消した・別のポジションにした後に直した）・満期で消滅にしたときは、明細の損益がどのレッグの分か
 *   分からないので無し（レッグの合計に切り替える。直す画面と同じ）
 * - 為替が要るのに無ければ無し（レッグの合計を使う）
 * 返す changed = 明細の損益をそのまま使わない（足した・空にした）
 */
export function statementPnlWithLegs(
  pnl: number | undefined,
  drafts: readonly LegDraft[],
  legs: readonly Leg[],
  multiplier: number,
  fx: number | undefined,
): { readonly pnl: number | undefined; readonly dropped: boolean } {
  if (pnl === undefined) return { pnl, dropped: false };
  const fromStatement = drafts.filter((d) => d.read !== undefined);
  if (fromStatement.length === 0) return { pnl, dropped: false };
  const unit = fromStatement[0]?.read?.unit ?? [];
  const present = new Set(fromStatement.map((d) => d.read?.raw));
  const complete =
    present.size === unit.length &&
    fromStatement.length === unit.length &&
    unit.every((r) => present.has(r)) &&
    fromStatement.every((d) => !d.expired);
  if (!complete) return { pnl: undefined, dropped: true };
  const added = drafts
    .map((d, i) => ({ d, leg: legs[i] }))
    .filter((x) => x.d.read === undefined && !x.d.expired && x.leg !== undefined);
  if (added.length === 0) return { pnl, dropped: false };
  if (fx === undefined) return { pnl: undefined, dropped: true };
  const sum = added.reduce((s, x) => s + legPnlPrice(x.leg as Leg, multiplier) * fx, 0);
  return { pnl: tidy(pnl + sum), dropped: false };
}

/**
 * 先物・CFD などの銘柄の名前を打ったポジションの理由（保存しない。API はレッグを持てる銘柄を商品の形で決める。ADR-0020 の
 * 決定 9）。先物の銘柄の形を変えさせない（以後の先物の記録が壊れるため。#118 のレビュー B1）
 */
export const OPTION_INSTRUMENT_NEEDED =
  'オプションのポジションです。先物・CFD の銘柄にはレッグを記録できないので、オプションの銘柄を選んでください';

/** 保存の門: 明細のポジションなのに、銘柄がオプションの形でない（レッグを読まない）間は保存しない。名前が空なら足りない欄に任せる */
export function gatePosition(read: DraftReading, row: ReadRow | undefined): DraftReading {
  if (row?.legs === undefined || read.option !== undefined || read.instrument.name === '') {
    return read;
  }
  return { ...read, canSave: false, notice: read.notice ?? OPTION_INSTRUMENT_NEEDED };
}

/** オプションの銘柄の名前の添え（「日経225」→「日経225オプション」。取り込みで作った名前と同じ形） */
export const OPTION_SUFFIX = 'オプション';

/**
 * 明細から読んだポジションの銘柄（#118 のレビュー B1・設計書 7.6 の 2）: 商品の形がオプションの銘柄の中からだけ、
 * 名前 = 原資産の名前 か 名前 = 原資産の名前 +「オプション」（名前の同一視 4.1）で探す。先物・CFD などには当てない。
 * 1 つならそれ、複数なら最後に記録した取引の銘柄（lastName）、それも無ければ一覧の先の銘柄。
 * 当たらなければ「<原資産>オプション」（readDraft が取引の形態 オプションで足す案にする。乗数は本人が入れる）
 */
export function optionInstrumentName(
  underlying: string,
  instruments: readonly InstrumentRecord[],
  lastName?: string,
): { readonly name: string; readonly matched: boolean } {
  const keys = new Set([nameKey(underlying), nameKey(`${underlying}${OPTION_SUFFIX}`)]);
  const hits = instruments.filter((i) => i.productForm === 'option' && keys.has(nameKey(i.name)));
  const last = lastName === undefined ? undefined : nameKey(lastName);
  const pick = hits.find((i) => nameKey(i.name) === last) ?? hits[0];
  if (pick) return { name: pick.name, matched: true };
  const suffixed = nameKey(underlying).endsWith(nameKey(OPTION_SUFFIX));
  return { name: suffixed ? underlying : `${underlying}${OPTION_SUFFIX}`, matched: false };
}

/** 明細の次のポジションの見出しの中身（LegList の NextPosition と同じ形） */
export interface NextPositionView {
  readonly legs: number;
  readonly head: string;
  readonly opened: string | null;
}

/**
 * 今の件（index）の次の同じ原資産のポジションの見出し: レッグの本数・1 本目のレッグの 1 行・エントリーの日（明細に書かれた日の
 * 「M/D」）。無ければ null（デザインレビュー 2）
 */
export function nextPositionView(
  raw: readonly ReadRow[],
  units: readonly Unit[],
  index: number,
): NextPositionView | null {
  const j = nextPositionIndex(raw, units, index);
  const u = j === null ? undefined : units[j];
  const row = u === undefined ? undefined : unitRow(raw, u);
  const first = row?.legs?.[0];
  if (u === undefined || row === undefined || first === undefined) return null;
  const m = row.entryTime === null ? null : /^\d{4}-(\d{2})-(\d{2})/.exec(row.entryTime.written);
  return {
    legs: u.length,
    head: legCardText(legDraftOf(first, u[0] as number, u, null)).head,
    opened: m ? `${Number(m[1])}/${Number(m[2])}` : null,
  };
}
