// 規律コストの曲線の描く位置（Issue #88 契約 P-4。設計書 6.2）。DOM なし。
// 面は viewBox 0〜100 × 0〜100（preserveAspectRatio="none" で幅に伸ばす。線は non-scaling-stroke）。印・右端の札・斜線の
// 模様は伸ばさない別の SVG に百分率の位置で置く（形が潰れない）。
// 横軸は取引の順番（0 = 原点。時刻の間隔ではない）、縦軸は R の累積（上が +）。
// 縦の範囲 = [min(0, 両系列の最小), max(0, 両系列の最大)]（幅が 1R に満たなければ 1R に広げる）を、きりのよい刻み
// （0.5・1・2・2.5・5 × 10^k の R。目盛り 3〜7 本・上下の空きが最小）の倍数まで広げ、さらに上下に 8% の余白（端の目盛りの文字が切れない）。
// 計画どおりの累積はどの点でも実際の累積を下回らない（置き換えは損を小さくする向きだけ。6.2）ので、差の面はいつも
// 計画が上・実際が下の区間で、面の大きさ（最後の幅）= −規律コスト
import type { Grade } from '../../../core/judge';
import type { CurvePoint } from '../../../core/review';
import { badgeModel, type Tier, type TierSymbol } from './badge';
import { formatR } from './format';

/** 差を差として扱う最小の幅（numeric.ts の誤差の約束） */
const EPS = 1e-9;
const PAD = 0.08;
/** 右端の 2 つの札の間の最小の距離（面の高さの割合 %。180px で 23px） */
const LABEL_GAP = 13;
/** 点の印を全部の点に打つ件数の上限（多いと点が潰れる。崩れの印はいつも打つ） */
const DOT_MAX = 40;
/**
 * 1 件あたりの横幅が 8px を切る件数の目安（面の幅 = 360px で約 130px・720px 以上で約 700px）。超えたら計画の線を破線から細い実線に、
 * 崩れの印を線の上から横軸の上の帯（rug）に移す（破線が点の群れに見え、印が線を隠すため）
 */
export const DENSE_NARROW = 16;
export const DENSE_WIDE = 88;
/** rug の印をまとめる横の間隔（面の幅の %） */
const RUG_GAP = 4;

export interface CurveTick {
  readonly r: number;
  /** 面の上からの位置（0〜100） */
  readonly y: number;
  readonly label: string;
  readonly zero: boolean;
}

/** 崩れ（計画どおりの R に置き換えた取引）の印 */
export interface CurveMark {
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
  readonly symbol: TierSymbol;
}

/** 右端の札（位置は面の上からの %） */
export interface EndLabel {
  readonly y: number;
  readonly text: string;
}

export interface CurveGeometry {
  /** 実際の R の累積の折れ線（原点を含む。SVG の points） */
  readonly actualPoints: string;
  /** 計画どおりの R の累積の折れ線 */
  readonly plannedPoints: string;
  /** 差の面（崩れで失った R）の多角形の points。差の無い区間は作らない */
  readonly gapPolygons: readonly string[];
  /** 同じ多角形を 0〜1 の割合で（斜線の模様の clipPath。objectBoundingBox） */
  readonly gapFractions: readonly string[];
  /** 差の面の区間（点の番号。1 = 1 件目の取引。[開始の点, 終わりの点]） */
  readonly gapSpans: readonly (readonly [number, number])[];
  /** きりのよい刻みの目盛り（0 を含む 3〜7 本） */
  readonly ticks: readonly CurveTick[];
  readonly step: number;
  /** 0 の線の位置 */
  readonly zeroY: number;
  /** 縦の範囲（R） */
  readonly lo: number;
  readonly hi: number;
  /** 崩れの印（判定のバッジと同じ形） */
  readonly marks: readonly CurveMark[];
  /** 実際の線の点（件数が多いときは空） */
  readonly dots: readonly { readonly x: number; readonly y: number }[];
  /** 横軸の上の帯に並べる崩れの印（近いものは 1 つにまとめ、件数を持つ）。件数が多いときに使う */
  readonly rug: readonly (CurveMark & { readonly count: number })[];
  /** 件数が多い（狭い幅 / 広い幅で 1 件あたり 8px を切る）。画面の幅で線種と印の置き場所を切り替える */
  readonly dense: { readonly narrow: boolean; readonly wide: boolean };
  /** 右端の札（計画・実際）と差の括弧（差が無ければ null） */
  readonly ends: {
    readonly planned: EndLabel;
    readonly actual: EndLabel;
    readonly bracket: {
      readonly top: number;
      readonly bottom: number;
      readonly label: EndLabel;
    } | null;
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * きりのよい刻み（0.5・1・2・2.5・5 × 10^k の R）。範囲を刻みの倍数まで広げたときの目盛りが 3〜7 本のうち、広げた分（上下の空き）が
 * いちばん小さいもの（同じなら本数の少ない方）。大きな負けの期間でも上端が大きく空かない
 */
export function niceStep(lo: number, hi: number): number {
  let best = { step: 10 ** 9, waste: Number.POSITIVE_INFINITY, count: 0 };
  for (let k = -1; k < 9; k++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * 10 ** k;
      if (step < 0.5 - EPS) continue;
      const a = Math.floor(lo / step + EPS);
      const b = Math.ceil(hi / step - EPS);
      const count = b - a + 1;
      if (count < 3 || count > 7) continue;
      const waste = (b - a) * step - (hi - lo);
      if (waste < best.waste - EPS || (Math.abs(waste - best.waste) <= EPS && count < best.count)) {
        best = { step, waste, count };
      }
    }
  }
  return best.step;
}

/** 目盛りの文字（0 は「0」、刻みが整数なら「+2R」、0.5・2.5 刻みなら「+1.5R」） */
function tickLabel(r: number, step: number): string {
  if (Math.abs(r) < EPS) return '0';
  if (Number.isInteger(step)) return `${r > 0 ? '+' : '−'}${Math.round(Math.abs(r))}R`;
  return formatR(r);
}

/** 崩れ（置き換えた取引）の判定の形と段 */
function markOf(grade: Grade | null): { tier: Tier; symbol: TierSymbol } {
  const b = badgeModel(grade);
  return { tier: b.tier, symbol: b.symbol };
}

export function curveGeometry(curve: readonly CurvePoint[]): CurveGeometry {
  const actual = [0, ...curve.map((p) => p.actualCum)];
  const planned = [0, ...curve.map((p) => p.plannedCum)];
  const all = [...actual, ...planned];
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi - lo < 1) {
    const grow = (1 - (hi - lo)) / 2;
    lo -= grow;
    hi += grow;
  }
  const step = niceStep(lo, hi);
  lo = Math.floor(lo / step + EPS) * step;
  hi = Math.ceil(hi / step - EPS) * step;
  const tickRs: number[] = [];
  for (let v = lo; v <= hi + EPS; v += step) tickRs.push(Math.abs(v) < EPS ? 0 : v);
  const span = hi - lo;
  const top = hi + span * PAD;
  const bottom = lo - span * PAD;
  const n = curve.length;
  const xOf = (i: number) => (n === 0 ? 0 : round((i / n) * 100));
  const yOf = (r: number) => round(((top - r) / (top - bottom)) * 100);
  const pts = (vs: readonly number[]) => vs.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');

  // 差のある区間: 点 i〜i+1 のどちらかで差があれば、その区間は面に入る
  const diff = actual.map((a, i) => (planned[i] ?? a) - a);
  const spans: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const has = (diff[i] ?? 0) > EPS || (diff[i + 1] ?? 0) > EPS;
    if (!has) continue;
    const last = spans[spans.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else spans.push([i, i + 1]);
  }
  const polyOf = (a: number, b: number, scale: number) => {
    const upper: string[] = [];
    const lower: string[] = [];
    for (let i = a; i <= b; i++) {
      upper.push(`${round(xOf(i) / scale)},${round(yOf(planned[i] ?? 0) / scale)}`);
      lower.unshift(`${round(xOf(i) / scale)},${round(yOf(actual[i] ?? 0) / scale)}`);
    }
    return [...upper, ...lower].join(' ');
  };

  const marks: CurveMark[] = [];
  curve.forEach((p, i) => {
    if (p.plannedR - p.r > EPS)
      marks.push({ x: xOf(i + 1), y: yOf(p.actualCum), ...markOf(p.grade) });
  });
  const dots = n <= DOT_MAX ? curve.map((p, i) => ({ x: xOf(i + 1), y: yOf(p.actualCum) })) : [];
  // rug: 印を横軸の上の帯に。前の印から RUG_GAP % 以内なら同じ印にまとめる（重い方の段の形を残す）
  const weight: Readonly<Record<Tier, number>> = { worst: 3, break: 2, neutral: 1, plan: 0 };
  const rug: { x: number; y: number; tier: Tier; symbol: TierSymbol; count: number }[] = [];
  for (const m of marks) {
    const last = rug[rug.length - 1];
    if (last && m.x - last.x < RUG_GAP) {
      last.count += 1;
      if (weight[m.tier] > weight[last.tier]) {
        last.tier = m.tier;
        last.symbol = m.symbol;
      }
    } else rug.push({ ...m, y: 100, count: 1 });
  }

  // 右端の札: 計画は上・実際は下（計画 ≧ 実際）。近すぎれば中ほどから上下に離す
  const lastPlanned = planned[n] ?? 0;
  const lastActual = actual[n] ?? 0;
  const yp = yOf(lastPlanned);
  const ya = yOf(lastActual);
  let lp = yp;
  let la = ya;
  if (la - lp < LABEL_GAP) {
    const mid = (lp + la) / 2;
    lp = mid - LABEL_GAP / 2;
    la = mid + LABEL_GAP / 2;
  }
  const shift = lp < 4 ? 4 - lp : la > 96 ? 96 - la : 0;
  lp = round(lp + shift);
  la = round(la + shift);
  const gap = lastPlanned - lastActual;
  // 差の札は括弧の右の列で、2 つの札の中ほどの高さに固定する（押し出さない。#88 再レビュー 6）
  const bracket =
    n > 0 && gap > EPS
      ? {
          top: lp,
          bottom: la,
          label: { y: round((lp + la) / 2), text: formatR(lastActual - lastPlanned) },
        }
      : null;

  return {
    actualPoints: pts(actual),
    plannedPoints: pts(planned),
    gapPolygons: spans.map(([a, b]) => polyOf(a, b, 1)),
    gapFractions: spans.map(([a, b]) => polyOf(a, b, 100)),
    gapSpans: spans,
    ticks: tickRs.map((r) => ({ r, y: yOf(r), label: tickLabel(r, step), zero: r === 0 })),
    step,
    zeroY: yOf(0),
    lo: bottom,
    hi: top,
    marks,
    dots,
    rug,
    dense: { narrow: n > DENSE_NARROW, wide: n > DENSE_WIDE },
    ends: {
      planned: { y: lp, text: `計画 ${formatR(lastPlanned)}` },
      actual: { y: la, text: `実際 ${formatR(lastActual)}` },
      bracket,
    },
  };
}

/** points の文字 → 点の座標（テスト・検査用） */
export function pointsOf(points: string): readonly { readonly x: number; readonly y: number }[] {
  return points
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    });
}

/** 面の y → R（curveGeometry の逆。テストで点の R を読み戻す） */
export function rOfY(y: number, g: Pick<CurveGeometry, 'lo' | 'hi'>): number {
  return g.hi - (y / 100) * (g.hi - g.lo);
}
