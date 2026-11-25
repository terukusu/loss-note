// LC の物差しの文字と描く位置（Issue #34 契約 P-2・ルール 4）。DOM なし。
// 文字の一覧は「名前 価格（R）」（イン は R を付けない）。並びは core/ruler.ts の points のまま（左 = 損の側から）。
// 画面では R を読み上げだけに残し（見た目の R は線の下の目盛りと判定の枠の大きな R）、名前と価格を 1 行に並べる。
// 越えた行の幅は判定の枠に出る決済の R の文字（formatR）から作る（R の文字と食い違わない）
// 図の文法（#231・設計書 C66）: 図の文法 = 計画（決めた LC〜イン）は無彩色の帯、実行（イン〜決済）は文字の色の線、決めた LC の外の
// 区間（広げた・越えた。LC なしはイン〜決済）は崩れの区間で、判定の段が崩れ・極悪のときだけ段の塗りの色（CSS）。
// LC の価格の無いオプションのポジションは −1R を計画の上限の名前（価格なし）、LC なしは価格の位置の図（`NoLcRuler`）
import type {
  NoLcPointKind,
  NoLcRuler,
  Ruler,
  RulerBound,
  RulerPointKind,
} from '../../../core/ruler';
import { formatPrice, formatR } from './format';

/** 文字の一覧の名前（読み上げの名前） */
export const RULER_LABEL = 'LC の物差し';
/** オプションのポジションの物差し（点は原資産の価格。レッグのプレミアムと読み違えない。#117 のデザインレビュー N2） */
export const RULER_LABEL_UNDERLYING = 'LC の物差し（原資産）';

export const POINT_NAME: Readonly<Record<RulerPointKind, string>> = {
  entry: 'イン',
  plannedLc: '決めた LC',
  movedLc: '広げた後の LC',
  exit: '決済',
  tp: 'TP',
};

/** LC を入る前に決めていなかった取引の、R の分母の LC の名前（計画の線ではないことを書き分ける） */
export const LATE_LC_NAME = '後から決めた LC';

/** LC の価格の無いオプションのポジションの −1R の名前（#231・C66。価格は出さない） */
export const BOUND_NAME: Readonly<Record<RulerBound, string>> = {
  maxLoss: '最大損失',
  lossPlan: 'LC での損失の見込み',
};

/** LC なしの図の損の側の端の印の名前（#231・C66） */
export const NO_LC_MARK = 'LC なし';

export interface RulerItem {
  readonly kind: RulerPointKind | NoLcPointKind;
  /** 名前（決めた LC は、入る前に決めていなければ「後から決めた LC」。計画の上限なら「最大損失」など） */
  readonly name: string;
  /** 価格の文字（計画の上限・「LC なし」の印は null） */
  readonly price: string | null;
  /** R の文字（イン は null） */
  readonly rText: string | null;
  /** 「名前 価格（R）」（読み上げの 1 項目の文と同じ） */
  readonly text: string;
}

function nameOf(kind: RulerPointKind, ruler: Ruler): string {
  if (kind !== 'plannedLc') return POINT_NAME[kind];
  if (ruler.bound !== undefined) return BOUND_NAME[ruler.bound];
  return ruler.lcDecidedBeforeEntry ? POINT_NAME.plannedLc : LATE_LC_NAME;
}

function itemText(name: string, price: string | null, rText: string | null): string {
  return `${name}${price === null ? '' : ` ${price}`}${rText === null ? '' : `（${rText}）`}`;
}

/** 文字の一覧（左 = 損の側から。範囲の外の点も本当の値。LC なしの図は名前と価格だけ） */
export function rulerItems(ruler: Ruler | NoLcRuler): readonly RulerItem[] {
  if (ruler.basis === 'price') {
    return ruler.points.map((p) => {
      const name = p.kind === 'noLc' ? NO_LC_MARK : POINT_NAME[p.kind];
      const price = p.price === undefined ? null : formatPrice(p.price);
      return { kind: p.kind, name, price, rText: null, text: itemText(name, price, null) };
    });
  }
  return ruler.points.map((p) => {
    const name = nameOf(p.kind, ruler);
    const price = p.price === undefined ? null : formatPrice(p.price);
    const rText = p.kind === 'entry' ? null : formatR(p.r);
    return { kind: p.kind, name, price, rText, text: itemText(name, price, rText) };
  });
}

/**
 * 「LC を 0.6R 越えて決済」。決済が決めた LC を越えていなければ null。幅は決済の R の文字（小数 1 桁）から 1.0 を引いた値。
 * 決済の R の文字が「−1.0R」になる小さな越え（例 −1.03R）は「0.1R 未満」
 */
export function overshootText(ruler: Ruler | NoLcRuler): string | null {
  if (ruler.basis !== 'r' || ruler.overshootR === undefined) return null;
  const exit = ruler.points.find((p) => p.kind === 'exit');
  if (exit === undefined) return null;
  // formatR と同じ丸め（0 から遠い側。2 進の誤差の寄せ 1e-9）で 10 分の 1 の単位の整数にする
  const n = Math.round(Math.abs(exit.r) * 10 + 1e-9) - 10;
  if (n <= 0) return 'LC を 0.1R 未満超えて決済';
  return `LC を ${Math.floor(n / 10)}.${n % 10}R 超えて決済`;
}

/** 線の上の x（SVG の属性の百分率。例 "23.08%"） */
export function xOf(pos: number): string {
  const p = Number.isFinite(pos) ? Math.min(1, Math.max(0, pos)) : 0;
  return `${(p * 100).toFixed(2)}%`;
}

export interface Arc {
  readonly from: string;
  readonly to: string;
}

/**
 * 区間（#231・C66）: plan = 計画した損失の幅（決めた LC〜イン。入る前に決めた LC だけ）・exec = 実行（イン〜決済）・
 * widen = LC を広げた区間・over = 決済が決めた LC を越えた区間・free = LC なしの取引のイン〜決済。
 * breach = 計画の線の外の区間（widen・over・free。判定の段が崩れ・極悪のときだけ段の塗りの色）
 */
export type SegmentKind = 'plan' | 'exec' | 'widen' | 'over' | 'free';

export interface Segment extends Arc {
  readonly kind: SegmentKind;
  readonly breach: boolean;
}

/** 描く順（下から: 計画の帯 → 実行の線 → 崩れの区間） */
export function rulerSegments(ruler: Ruler | NoLcRuler): readonly Segment[] {
  const out: Segment[] = [];
  const push = (kind: SegmentKind, arc: Arc | null) => {
    if (arc !== null && arc.from !== arc.to)
      out.push({ ...arc, kind, breach: kind === 'widen' || kind === 'over' || kind === 'free' });
  };
  if (ruler.basis === 'price') {
    const e = ruler.points.find((p) => p.kind === 'entry');
    const x = ruler.points.find((p) => p.kind === 'exit');
    if (e !== undefined && x !== undefined) {
      const [l, r] = e.pos <= x.pos ? [e, x] : [x, e];
      push('free', { from: xOf(l.pos), to: xOf(r.pos) });
    }
    return out;
  }
  if (ruler.lcDecidedBeforeEntry) push('plan', arcBetween(ruler, 'plannedLc', 'entry'));
  push('exec', arcBetween(ruler, 'entry', 'exit'));
  push('widen', widenArc(ruler));
  push('over', overArc(ruler));
  return out;
}

export interface Arrow {
  /** 矢印の先の位置（広げた後の LC） */
  readonly x: string;
  /** 指す向き（広げた後の LC の側） */
  readonly dir: 'left' | 'right';
}

/** LC を広げた向きの矢印（決めた LC → 広げた後の LC。#231・C66）。広げた後の LC の点が無い・同じ位置なら null */
export function widenArrow(ruler: Ruler | NoLcRuler): Arrow | null {
  if (ruler.basis !== 'r') return null;
  const from = ruler.points.find((p) => p.kind === 'plannedLc');
  const to = ruler.points.find((p) => p.kind === 'movedLc');
  if (from === undefined || to === undefined || xOf(from.pos) === xOf(to.pos)) return null;
  return { x: xOf(to.pos), dir: to.pos < from.pos ? 'left' : 'right' };
}

function arcBetween(ruler: Ruler, a: RulerPointKind, b: RulerPointKind): Arc | null {
  const pa = ruler.points.find((p) => p.kind === a);
  const pb = ruler.points.find((p) => p.kind === b);
  if (pa === undefined || pb === undefined) return null;
  const [l, r] = pa.pos <= pb.pos ? [pa, pb] : [pb, pa];
  return { from: xOf(l.pos), to: xOf(r.pos) };
}

/** 越えた区間（決済〜決めた LC。左から右）。越えていなければ null */
export function overArc(ruler: Ruler): Arc | null {
  if (ruler.overshootR === undefined) return null;
  return arcBetween(ruler, 'exit', 'plannedLc');
}

/** LC を広げた区間（決めた LC〜広げた後の LC。左から右）。広げた後の LC の点が無ければ null */
export function widenArc(ruler: Ruler): Arc | null {
  return arcBetween(ruler, 'movedLc', 'plannedLc');
}

export interface Tick {
  readonly key: string;
  readonly x: string;
  readonly label: string;
  /** 端では文字を内側へ寄せる（はみ出さない） */
  readonly anchor: 'start' | 'middle' | 'end';
}

/** 目盛りの文字が端に近いとみなす位置（内側へ寄せる） */
const EDGE = 0.12;
/** +1R の目盛りを TP の文字と重ねない間隔 */
const NEAR = 0.1;

function anchorOf(pos: number): Tick['anchor'] {
  return pos < EDGE ? 'start' : pos > 1 - EDGE ? 'end' : 'middle';
}

/**
 * 線の下の目盛り: 決めた LC の下に「−1R」（入る前に決めていなければ「−1R（後から）」）、イン の下に「0」、+1R の位置に「+1R」、
 * TP があれば「TP」（+1R と近ければ +1R を出さない）
 */
export function rulerTicks(ruler: Ruler | NoLcRuler): readonly Tick[] {
  // LC なしの図は R の目盛りを出さず、損の側の端に「LC なし」だけ（#231・C66）
  if (ruler.basis === 'price')
    return [{ key: 'noLc', x: xOf(0), label: NO_LC_MARK, anchor: 'start' }];
  const span = ruler.hi - ruler.lo;
  const at = (r: number) => Math.min(1, Math.max(0, (r - ruler.lo) / span));
  const ticks: Tick[] = [];
  const add = (key: string, pos: number, label: string) =>
    ticks.push({ key, x: xOf(pos), label, anchor: anchorOf(pos) });
  add(
    'lc',
    at(-1),
    ruler.lcDecidedBeforeEntry || ruler.bound !== undefined ? '−1R' : '−1R（後から）',
  );
  add('entry', at(0), '0');
  const tp = ruler.points.find((p) => p.kind === 'tp');
  const onePos = at(1);
  if (tp === undefined || Math.abs(tp.pos - onePos) > NEAR) add('one', onePos, '+1R');
  if (tp !== undefined) add('tp', tp.pos, 'TP');
  return ticks;
}
