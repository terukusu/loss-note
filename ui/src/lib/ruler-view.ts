// LC の物差しの文字と描く位置（Issue #34 契約 P-2・ルール 4）。DOM なし。
// 文字の一覧は「名前 価格（R）」（イン は R を付けない）。並びは core/ruler.ts の points のまま（左 = 損の側から）。
// 画面では R を読み上げだけに残し（見た目の R は線の下の目盛りと判定の枠の大きな R）、名前と価格を 1 行に並べる。
// 越えた行の幅は判定の枠に出る決済の R の文字（formatR）から作る（R の文字と食い違わない）
import type { Ruler, RulerPointKind } from '../../../core/ruler';
import { formatPrice, formatR } from './format';

/** 文字の一覧の名前（読み上げの名前） */
export const RULER_LABEL = 'LC の物差し';

export const POINT_NAME: Readonly<Record<RulerPointKind, string>> = {
  entry: 'イン',
  plannedLc: '決めた LC',
  movedLc: '動かした LC',
  exit: '決済',
  tp: 'TP',
};

/** LC を入る前に決めていなかった取引の、R の分母の LC の名前（計画の線ではないことを書き分ける） */
export const LATE_LC_NAME = 'LC（入った後）';

export interface RulerItem {
  readonly kind: RulerPointKind;
  /** 名前（決めた LC は、入る前に決めていなければ「LC（入った後）」） */
  readonly name: string;
  readonly price: string;
  /** R の文字（イン は null） */
  readonly rText: string | null;
  /** 「名前 価格（R）」（読み上げの 1 項目の文と同じ） */
  readonly text: string;
}

function nameOf(kind: RulerPointKind, ruler: Ruler): string {
  return kind === 'plannedLc' && !ruler.lcDecidedBeforeEntry ? LATE_LC_NAME : POINT_NAME[kind];
}

/** 文字の一覧（左 = 損の側から。範囲の外の点も本当の値） */
export function rulerItems(ruler: Ruler): readonly RulerItem[] {
  return ruler.points.map((p) => {
    const name = nameOf(p.kind, ruler);
    const price = formatPrice(p.price);
    const rText = p.kind === 'entry' ? null : formatR(p.r);
    return {
      kind: p.kind,
      name,
      price,
      rText,
      text: `${name} ${price}${rText === null ? '' : `（${rText}）`}`,
    };
  });
}

/**
 * 「LC を 0.6R 越えて決済」。決済が決めた LC を越えていなければ null。幅は決済の R の文字（小数 1 桁）から 1.0 を引いた値。
 * 決済の R の文字が「−1.0R」になる小さな越え（例 −1.03R）は「0.1R 未満」
 */
export function overshootText(ruler: Ruler): string | null {
  if (ruler.overshootR === undefined) return null;
  const exit = ruler.points.find((p) => p.kind === 'exit');
  if (exit === undefined) return null;
  // formatR と同じ丸め（0 から遠い側。2 進の誤差の寄せ 1e-9）で 10 分の 1 の単位の整数にする
  const n = Math.round(Math.abs(exit.r) * 10 + 1e-9) - 10;
  if (n <= 0) return 'LC を 0.1R 未満越えて決済';
  return `LC を ${Math.floor(n / 10)}.${n % 10}R 越えて決済`;
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

/** LC を広げた区間（決めた LC〜動かした LC。左から右）。動かした LC の点が無ければ null */
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
export function rulerTicks(ruler: Ruler): readonly Tick[] {
  const span = ruler.hi - ruler.lo;
  const at = (r: number) => Math.min(1, Math.max(0, (r - ruler.lo) / span));
  const ticks: Tick[] = [];
  const add = (key: string, pos: number, label: string) =>
    ticks.push({ key, x: xOf(pos), label, anchor: anchorOf(pos) });
  add('lc', at(-1), ruler.lcDecidedBeforeEntry ? '−1R' : '−1R（後から）');
  add('entry', at(0), '0');
  const tp = ruler.points.find((p) => p.kind === 'tp');
  const onePos = at(1);
  if (tp === undefined || Math.abs(tp.pos - onePos) > NEAR) add('one', onePos, '+1R');
  if (tp !== undefined) add('tp', tp.pos, 'TP');
  return ticks;
}
