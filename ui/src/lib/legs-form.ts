// オプションのポジションの足の下書き（#117。設計書 4.7・7.6・C47・C51・C54・ADR-0020）。純関数（DOM・通信・現在時刻なし）。
// - 足の下書き（欄ごとの文字列 + 選択 + 保存済みの時刻）→ 欄ごとの誤り・足りない欄・API に送る足（core/trade.ts の Leg）
// - [＋ 足] は直前の足の限月・P / C・買い / 売り・枚数を写す（7.6「違うのは行使価格と建値・決済値だけのことが多い」）
// - [満期で消滅] は決済値 0（ITM で消えたときは本人が入れる）・決済の時刻は限月の SQ の日の日本時間の終わり（C54・#116）。
//   SQ の日は限月 YYYY-MM なら第 2 金曜（祝日の繰り上げは見ない。後ろにずれても救わない側に倒れる）、週次 YYYY-MM-DD はその日
// - 手で入れる足は時刻を持たない（7.6 の手で入れる欄に時刻は無い）。直す画面は保存済みの時刻を保つ
// - ID はポジションの中の並び順で l1〜l10 に振る（API の LEG_ID と同じ形）
import { MAX_LEGS } from '../../../core/option';
import type { ExitOrderType, Leg, LegSide } from '../../../core/trade';
import { formatPlain, formatPrice } from './format';

export { MAX_LEGS };

/** 足の下書き。文字の欄は打ったまま、選択は未選択 = null */
export interface LegDraft {
  /** 保存済みの足の ID（直す画面だけ。手で追加した足には無く、読むときに空いている ID を振る） */
  readonly id?: string;
  readonly optionType: 'P' | 'C' | null;
  /** 限月（YYYY-MM。週次は YYYY-MM-DD） */
  readonly contractMonth: string;
  readonly strike: string;
  readonly side: LegSide | null;
  readonly quantity: string;
  readonly entryPrice: string;
  readonly exitPrice: string;
  /** 満期で消えた（決済明細に出ない） */
  readonly expired: boolean;
  /** 保存済みの建ての時刻（直す画面だけ。手で入れた足には無い） */
  readonly entryTime?: number;
  /** 保存済みの決済の時刻（決済した足だけ使う。満期で消えた足は SQ の日から作る） */
  readonly exitTime?: number;
  /**
   * 保存済みの満期で消えた足の時刻と、そのときの限月（直す画面だけ）。限月が同じで満期の印のままなら保ち、SQ の日から
   * 作り直さない（祝日で繰り上げた SQ などで作り直すと、何も変えない編集でも「足を編集した」になるため）
   */
  readonly expiredTime?: number;
  readonly expiredMonth?: string;
  /** 明細から読んだ足（記録する画面だけ。#118。手で追加した足には無い） */
  readonly read?: LegRead;
}

/** 明細から読んだ足の出どころ（#118。statement-positions.ts が作る） */
export interface LegRead {
  /** 明細の行の番号（0 から。ポジションをまとめ直したときに、本人が直した足を保つ目印） */
  readonly raw: number;
  /** そのポジションの明細の行の番号（明細の損益がどの足の分か = すべてそろっているかを確かめる） */
  readonly unit: readonly number[];
  /** 限月の年を建てた日から補った（明細に年が無い。7.6 の 1） */
  readonly yearInferred: boolean;
  /** 読んだ後に本人が欄を直した（印「修正済み」） */
  readonly edited?: true;
  /**
   * 足した明細の通し番号（1 から。#260・C73）。無い = 1 枚目の明細（1 段目で読んだ明細）の足。足した明細の足では raw・unit は
   * その明細の行の番号で、unit は実際に足した行だけ（重複で足さなかった行は入らない）
   */
  readonly sheet?: number;
  /** 足した明細の行の損益・手数料の合計（明細の通貨のまま。読めなければ null）と、その通貨（#260。足した明細の足だけ） */
  readonly pnl?: number | null;
  readonly fee?: number | null;
  readonly currency?: string;
  /** 足した明細の行の注文の種類（#260。決済の時点を決める足になったら、ポジションの注文の種類にする = C54・C26） */
  readonly orderType?: ExitOrderType;
}

/** 1 枚目の明細から読んだ足か（手で追加した足・足した明細の足ではない。#118・#260） */
export const fromMainStatement = (l: LegDraft): boolean =>
  l.read !== undefined && l.read.sheet === undefined;

/** 足した明細（2 枚目から）の足か（#260） */
export const fromAddedStatement = (l: LegDraft): boolean => l.read?.sheet !== undefined;

/** 明細から読んだ足の印（一覧の行の右の添え。「読み取り」/「修正済み」。年を補った印は別の札 = YEAR_INFERRED_CHIP） */
export function legReadText(d: LegDraft): string | null {
  if (d.read === undefined) return null;
  return d.read.edited ? '修正済み' : '読み取り';
}

/** 限月の年を補った足の札（注意の色。一覧の行と 2 段目の要約。デザインレビュー 1） */
export const YEAR_INFERRED_CHIP = '限月の年は推定';

/** 年を補ったまま（本人が限月を直していない）の足があるか */
export const hasYearInferred = (legs: readonly LegDraft[]): boolean =>
  legs.some((l) => l.read?.yearInferred === true);

/** 限月の年を補ったときの欄の下の 1 行 */
export const YEAR_INFERRED_HINT =
  '明細に年が無いので、エントリーした日から補いました。違えば直してください';

/**
 * 足の欄を直した（LegEditor の onChange）: 明細から読んだ足なら印を「修正済み」にし、限月を直したら年を補った印を外す
 */
export function editLeg(prev: LegDraft, next: LegDraft): LegDraft {
  if (prev.read === undefined || next.read === undefined) return next;
  const changed = (Object.keys(LEG_FIELD_LABEL) as LegField[]).some((f) => prev[f] !== next[f]);
  const expiredChanged = prev.expired !== next.expired;
  if (!changed && !expiredChanged) return next;
  return {
    ...next,
    read: {
      ...next.read,
      edited: true,
      yearInferred: next.read.yearInferred && prev.contractMonth === next.contractMonth,
    },
  };
}

export type LegField =
  | 'optionType'
  | 'contractMonth'
  | 'strike'
  | 'side'
  | 'quantity'
  | 'entryPrice'
  | 'exitPrice';

export const EMPTY_LEG: LegDraft = {
  optionType: null,
  contractMonth: '',
  strike: '',
  side: null,
  quantity: '',
  entryPrice: '',
  exitPrice: '',
  expired: false,
};

export const LEG_FIELD_LABEL: Readonly<Record<LegField, string>> = {
  optionType: 'P / C',
  contractMonth: '限月',
  strike: '行使価格',
  side: '買い / 売り',
  quantity: '枚数',
  entryPrice: 'イン',
  exitPrice: '決済',
};

export const LEG_SIDE_LABEL: Readonly<Record<LegSide, string>> = { buy: '買い', sell: '売り' };

export const LEG_MSG = {
  notNumber: '数値を入力してください（例: 120）',
  notPositive: '0 より大きい数値を入力してください',
  notNonNegative: '0 以上の数値を入力してください',
  tooLarge: '大きすぎます',
  contractMonth: '限月は 2027-01 の形で入力してください（週次は 2027-01-15）',
} as const;

/** API の入力の上限（record-form の MAX_ABS と同じ） */
const MAX_ABS = 1e12;

/** ポジションの中の n 番目（0 から）の足の ID */
export function legId(index: number): string {
  return `l${index + 1}`;
}

/**
 * [＋ 足] で追加する行: 直前の足の限月・P / C・買い / 売り・枚数を写す（行使価格・建値・決済値は空、満期で消滅は外す）。
 * 足が無ければ空の行
 */
export function nextLeg(legs: readonly LegDraft[]): LegDraft {
  const prev = legs[legs.length - 1];
  if (prev === undefined) return EMPTY_LEG;
  return {
    ...EMPTY_LEG,
    optionType: prev.optionType,
    contractMonth: prev.contractMonth,
    side: prev.side,
    quantity: prev.quantity,
  };
}

/** 消した足（［元に戻す］ で元の位置・ID・時刻ごと戻す。P4・#117 のレビュー B1） */
export interface LegUndo {
  readonly leg: LegDraft;
  readonly index: number;
}

/** 消した後の 1 行「足 2 を削除しました」 */
export function legRemovedText(u: LegUndo): string {
  return `足 ${u.index + 1} を削除しました`;
}

/** ［元に戻す］ を押せるか（戻すと上限の 10 本を超えるときは押せない。#117 の再レビュー B2） */
export function canUndoLegRemove(legs: readonly LegDraft[]): boolean {
  return legs.length < MAX_LEGS;
}

/** 戻せないときの理由（［元に戻す］ の横の 1 行） */
export const LEG_UNDO_FULL = `足が ${MAX_LEGS} 本あるため戻せません`;

/** 消した足を元の位置へ戻す（並びが短くなっていれば末尾。上限の 10 本なら戻さない） */
export function undoLegRemove(legs: readonly LegDraft[], u: LegUndo): LegDraft[] {
  if (!canUndoLegRemove(legs)) return [...legs];
  const at = Math.min(u.index, legs.length);
  return [...legs.slice(0, at), u.leg, ...legs.slice(at)];
}

/** [満期で消滅] の切り替え。入れたときに決済値が空なら 0（OTM で消えた。ITM なら本人が直す） */
export function toggleExpired(leg: LegDraft): LegDraft {
  if (leg.expired) return { ...leg, expired: false };
  return { ...leg, expired: true, exitPrice: leg.exitPrice.trim() === '' ? '0' : leg.exitPrice };
}

/** 限月の打ち方を YYYY-MM（-DD）に直す（全角・/・. を受ける。月・日の 1 桁は 0 で埋める）。読めなければ undefined */
export function normalizeContractMonth(raw: string): string | undefined {
  let s = raw
    .normalize('NFKC')
    .trim()
    .replace(/[/.年月]/g, '-')
    .replace(/-+$/, '');
  // 数字だけ（スマホの数字のキーボード。デザインレビュー N4）: 202701 / 2701 = YYYY-MM・YY-MM、20270115 = YYYY-MM-DD
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  else if (/^\d{6}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4)}`;
  else if (/^\d{4}$/.test(s)) s = `20${s.slice(0, 2)}-${s.slice(2)}`;
  // 2 桁の年（27-01・27/1）は 20YY
  s = s.replace(/^(\d{2})-/, '20$1-');
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (m === null) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] === undefined ? undefined : Number(m[3]);
  if (mo < 1 || mo > 12) return undefined;
  if (d !== undefined) {
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (d < 1 || d > last) return undefined;
  }
  const mm = String(mo).padStart(2, '0');
  return d === undefined ? `${m[1]}-${mm}` : `${m[1]}-${mm}-${String(d).padStart(2, '0')}`;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 限月の SQ の日の日本時間の終わり（翌日 0 時の 1 ms 前。C54・#116）。YYYY-MM は第 2 金曜、YYYY-MM-DD はその日。
 * 形が読めなければ undefined
 */
export function sqEndOf(contractMonth: string): number | undefined {
  const cm = normalizeContractMonth(contractMonth);
  if (cm === undefined) return undefined;
  const [ys, ms, ds] = cm.split('-');
  const y = Number(ys);
  const mo = Number(ms) - 1;
  let day: number;
  if (ds !== undefined) day = Number(ds);
  else {
    const dow = new Date(Date.UTC(y, mo, 1)).getUTCDay();
    day = 1 + ((5 - dow + 7) % 7) + 7;
  }
  return Date.UTC(y, mo, day + 1) - JST_OFFSET_MS - 1;
}

type Num = { readonly ok: true; readonly value: number } | { readonly ok: false };

function parse(raw: string): Num {
  let s = raw.normalize('NFKC').trim().replace(/−/g, '-');
  if (s.includes(',')) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return { ok: false };
    s = s.replace(/,/g, '');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false };
  const value = Number(s);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

export interface LegsReading {
  /** 足ごとの欄の誤り（並びは足と同じ） */
  readonly errors: readonly Readonly<Partial<Record<LegField, string>>>[];
  /** 足りない欄のある足の名前（「足 2」。足が 1 本も無ければ「足」） */
  readonly missing: readonly string[];
  /** すべての足がそろって誤りが無ければ、API に送る足 */
  readonly legs?: readonly [Leg, ...Leg[]];
  /** 上限（10 本）を超えている（保存しない。黙って末尾を落とさない。#117 の再レビュー B2） */
  readonly tooMany?: boolean;
}

/** 1 本の足の欄ごとの誤りと、足りない欄 */
export function readLeg(
  d: LegDraft,
  id: string,
): {
  readonly errors: Partial<Record<LegField, string>>;
  readonly missing: readonly LegField[];
  readonly leg?: Leg;
} {
  const errors: Partial<Record<LegField, string>> = {};
  const missing: LegField[] = [];
  const num = (f: LegField, raw: string, rule: 'positive' | 'nonNegative') => {
    if (raw.trim() === '') {
      missing.push(f);
      return undefined;
    }
    const p = parse(raw);
    if (!p.ok) {
      errors[f] = LEG_MSG.notNumber;
      return undefined;
    }
    if (Math.abs(p.value) > MAX_ABS) {
      errors[f] = LEG_MSG.tooLarge;
      return undefined;
    }
    if (rule === 'positive' ? !(p.value > 0) : p.value < 0) {
      errors[f] = rule === 'positive' ? LEG_MSG.notPositive : LEG_MSG.notNonNegative;
      return undefined;
    }
    return p.value;
  };
  if (d.optionType === null) missing.push('optionType');
  let contractMonth: string | undefined;
  if (d.contractMonth.trim() === '') missing.push('contractMonth');
  else {
    contractMonth = normalizeContractMonth(d.contractMonth);
    if (contractMonth === undefined) errors.contractMonth = LEG_MSG.contractMonth;
  }
  const strike = num('strike', d.strike, 'positive');
  if (d.side === null) missing.push('side');
  const quantity = num('quantity', d.quantity, 'positive');
  const entry = num('entryPrice', d.entryPrice, 'nonNegative');
  const exit = num('exitPrice', d.exitPrice, 'nonNegative');
  if (
    d.optionType === null ||
    d.side === null ||
    contractMonth === undefined ||
    strike === undefined ||
    quantity === undefined ||
    entry === undefined ||
    exit === undefined
  ) {
    return { errors, missing };
  }
  // 保存済みの満期で消えた足（expiredMonth あり）は、限月が同じなら保存済みの時刻のまま（時刻が無ければ無いまま）
  const exitTime = d.expired
    ? d.expiredMonth !== undefined && d.expiredMonth === contractMonth
      ? d.expiredTime
      : sqEndOf(contractMonth)
    : d.exitTime;
  const leg: Leg = {
    id,
    optionType: d.optionType,
    contractMonth,
    strike,
    side: d.side,
    quantity,
    entry: { price: entry, ...(d.entryTime === undefined ? {} : { time: d.entryTime }) },
    exit: {
      price: exit,
      ...(exitTime === undefined ? {} : { time: exitTime }),
      kind: d.expired ? 'expired' : 'closed',
    },
  };
  return { errors, missing, leg };
}

/** 足の ID: 保存済みの ID は保ち（重なれば外す）、無い足には空いている l1〜l10 を若い順に振る */
export function legIds(drafts: readonly LegDraft[]): string[] {
  const used = new Set<string>();
  const kept = drafts.map((d) => {
    if (d.id === undefined || used.has(d.id)) return undefined;
    used.add(d.id);
    return d.id;
  });
  let next = 0;
  return kept.map((id) => {
    if (id !== undefined) return id;
    while (used.has(legId(next))) next += 1;
    const fresh = legId(next);
    used.add(fresh);
    return fresh;
  });
}

/** 足の並びを読む（1〜10 本。0 本は足りない、11 本以上は追加できない作りなので読まない） */
export function readLegs(drafts: readonly LegDraft[]): LegsReading {
  if (drafts.length === 0) return { errors: [], missing: ['足'] };
  if (drafts.length > MAX_LEGS) {
    return { errors: drafts.map(() => ({})), missing: [], tooMany: true };
  }
  const errors: Partial<Record<LegField, string>>[] = [];
  const missing: string[] = [];
  const legs: Leg[] = [];
  const ids = legIds(drafts.slice(0, MAX_LEGS));
  drafts.slice(0, MAX_LEGS).forEach((d, i) => {
    const r = readLeg(d, ids[i] as string);
    errors.push(r.errors);
    if (r.missing.length > 0) missing.push(`足 ${i + 1}`);
    if (r.leg) legs.push(r.leg);
  });
  const ok = legs.length === Math.min(drafts.length, MAX_LEGS);
  const [first, ...rest] = legs;
  return {
    errors,
    missing,
    ...(ok && first !== undefined ? { legs: [first, ...rest] as const } : {}),
  };
}

/** 保存済みの足 → 下書き（数は指数表記にしない。時刻を保つ） */
export function legDraftsFromStored(legs: readonly Leg[]): LegDraft[] {
  return legs.map((l) => ({
    id: l.id,
    optionType: l.optionType,
    contractMonth: l.contractMonth,
    strike: formatPlain(l.strike),
    side: l.side,
    quantity: formatPlain(l.quantity),
    entryPrice: formatPlain(l.entry.price),
    exitPrice: formatPlain(l.exit.price),
    expired: l.exit.kind === 'expired',
    ...(l.entry.time === undefined ? {} : { entryTime: l.entry.time }),
    ...(l.exit.kind === 'closed' && l.exit.time !== undefined ? { exitTime: l.exit.time } : {}),
    ...(l.exit.kind === 'expired'
      ? {
          expiredMonth: l.contractMonth,
          ...(l.exit.time === undefined ? {} : { expiredTime: l.exit.time }),
        }
      : {}),
  }));
}

/** 鍵の順によらない比較のための写し */
function legKey(l: Leg): string {
  return JSON.stringify([
    l.id,
    l.optionType,
    l.contractMonth,
    l.strike,
    l.side,
    l.quantity,
    l.entry.price,
    l.entry.time ?? null,
    l.exit.price,
    l.exit.time ?? null,
    l.exit.kind,
  ]);
}

/** 足を直したか（追加した・直した・消した。記録した後の直す画面で明細の損益を空にする。4.7） */
export function legsChanged(before: readonly Leg[], after: readonly Leg[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((l, i) => legKey(l) !== legKey(after[i] as Leg));
}

/** カードの 2 行（1 行目「売り 2 · P 36,000 · 2027-01」、2 行目「120 → 60」/「150 → 0 満期で消滅」）。未入力の欄は「?」 */
export function legCardText(d: LegDraft): { readonly head: string; readonly prices: string } {
  const n = (raw: string, fmt: (v: number) => string) => {
    const p = parse(raw);
    return p.ok ? fmt(p.value) : '?';
  };
  const head = [
    `${d.side === null ? '?' : LEG_SIDE_LABEL[d.side]} ${n(d.quantity, formatPlain)}`,
    `${d.optionType ?? '?'} ${n(d.strike, formatPrice)}`,
    normalizeContractMonth(d.contractMonth) ?? (d.contractMonth.trim() || '?'),
  ].join(' · ');
  const prices = `${n(d.entryPrice, formatPrice)} → ${n(d.exitPrice, formatPrice)}${d.expired ? ' 満期で消滅' : ''}`;
  return { head, prices };
}
