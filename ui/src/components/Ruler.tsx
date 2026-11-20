// LC の物差し（Issue #34 契約 U-1・ルール 5）。判定の枠の数の後・理由の前に 1 段で出す。hook を持たない。
// 横 1 本の線（左 = 損の側）の上に イン・決めた LC（−1R の縦線）・広げた後の LC（線の上側の ▽）・決済・TP を形で置き、
// 線の下に目盛り（−1R・0・+1R・TP）、その下に名前と価格の 1 行（R は読み上げだけ）と越えた幅。
// 決めた LC〜広げた後の LC は破線の太線、決済が決めた LC を越えた区間は実線の太線。入る前に決めていない LC は破線の縦線。
// 図の上の 1 行（右寄せ）に小さな見出し「LC の物差し」と説明の「i」（#57。#131 で図に重ねるのをやめた: 文字の拡大 200% で
// 見出しが目盛り・印に重なった。#110）。
// 図は読み上げから外し、文字の一覧を「LC の物差し」という名前の一覧として読ませる。色は文字・線のトークンだけ（CSS）。
// 位置は SVG の属性の百分率と px（style を使わない。CSP）。入れ子の svg を点の位置に置き、形は原点を中心に描く
import type { JSX } from 'preact';
import type { Ruler as RulerModel, RulerPointKind } from '../../../core/ruler';
import {
  overArc,
  overshootText,
  RULER_LABEL,
  rulerItems,
  rulerTicks,
  widenArc,
  xOf,
} from '../lib/ruler-view';
import { InfoTip } from './InfoTip';

export type RulerShape = 'ring' | 'bar' | 'triangleDown' | 'diamond' | 'square';

/** 点の種類ごとの形（5 つすべて違う。色に頼らず形で見分ける。AC-5） */
export const RULER_MARKS: Readonly<
  Record<RulerPointKind, { readonly shape: RulerShape; readonly filled: boolean }>
> = {
  entry: { shape: 'ring', filled: false },
  plannedLc: { shape: 'bar', filled: false },
  movedLc: { shape: 'triangleDown', filled: false },
  exit: { shape: 'diamond', filled: true },
  tp: { shape: 'square', filled: false },
};

/** 線の y・目盛りの文字の基線の y（px。図の高さは CSS の .ruler__plot と同じ 48px） */
const LINE_Y = 20;
const TICK_Y = 44;

/**
 * 原点を中心にした形（大きさ s = 半径の目安 px）。above = 線の上側に置き、先で線を指す（広げた後の LC が同じ価格の
 * 決済の ◆ に隠れない）
 */
function shapeOf(shape: RulerShape, s: number, above = false): JSX.Element {
  switch (shape) {
    case 'ring':
      return <circle cx="0" cy="0" r={s - 0.5} />;
    case 'bar':
      return <path d={`M0 ${-(s + 4)}V${s + 4}`} />;
    case 'triangleDown':
      return above ? (
        <path d={`M${-s} ${-2 * s - 3}H${s}L0 -3Z`} />
      ) : (
        <path d={`M${-s} ${-s + 1}H${s}L0 ${s}Z`} />
      );
    case 'diamond':
      return <path d={`M0 ${-s - 1}L${s + 1} 0L0 ${s + 1}L${-s - 1} 0Z`} />;
    case 'square':
      return <rect x={-s} y={-s} width={2 * s} height={2 * s} />;
  }
}

function markClass(kind: RulerPointKind, late: boolean): string {
  const m = RULER_MARKS[kind];
  return `ruler__mark ruler__mark--${m.shape}${m.filled ? ' ruler__mark--filled' : ''}${
    kind === 'plannedLc' && late ? ' ruler__mark--late' : ''
  }`;
}

/** 名前の頭に置く小さな形（図の点との対応。読み上げからは外す） */
function Legend({ kind, late }: { readonly kind: RulerPointKind; readonly late: boolean }) {
  return (
    <svg class="ruler__key" viewBox="-8 -8 16 16" aria-hidden="true" focusable="false">
      <g class={markClass(kind, late)}>{shapeOf(RULER_MARKS[kind].shape, 5)}</g>
    </svg>
  );
}

/** 計画の点を先に、決済を最後に描く（重なったとき決済が上に来る） */
const DRAW_ORDER: readonly RulerPointKind[] = ['plannedLc', 'movedLc', 'entry', 'tp', 'exit'];

export function Ruler({ ruler }: { readonly ruler: RulerModel }) {
  const late = !ruler.lcDecidedBeforeEntry;
  const items = rulerItems(ruler);
  const over = overshootText(ruler);
  const arc = overArc(ruler);
  const widen = widenArc(ruler);
  const drawn = [...ruler.points].sort(
    (a, b) => DRAW_ORDER.indexOf(a.kind) - DRAW_ORDER.indexOf(b.kind),
  );
  return (
    <div class="ruler">
      {/* 図の上の小さな見出しと「i」（#57・#110）。名前は文字の一覧の読み上げの名前と同じ言葉。見出しの文字は一覧の名前と重ねて読ませない */}
      <div class="ruler__head">
        <span aria-hidden="true">{RULER_LABEL}</span>
        <InfoTip term="ruler" size="sm" prefer="above" />
      </div>
      <div class="ruler__track">
        <svg class="ruler__plot" aria-hidden="true" focusable="false">
          <line class="ruler__line" x1="0%" x2="100%" y1={LINE_Y} y2={LINE_Y} />
          {widen ? (
            <line class="ruler__widen" x1={widen.from} x2={widen.to} y1={LINE_Y} y2={LINE_Y} />
          ) : null}
          {arc ? (
            <line class="ruler__over" x1={arc.from} x2={arc.to} y1={LINE_Y} y2={LINE_Y} />
          ) : null}
          {drawn.map((p) => (
            <svg key={p.kind} x={xOf(p.pos)} y={LINE_Y} overflow="visible" aria-hidden="true">
              <g class={markClass(p.kind, late)}>
                {shapeOf(RULER_MARKS[p.kind].shape, 6, p.kind === 'movedLc')}
              </g>
              {p.outOfRange ? (
                <path
                  class="ruler__beyond"
                  d={p.pos <= 0.5 ? 'M-10 -4L-14 0L-10 4' : 'M10 -4L14 0L10 4'}
                />
              ) : null}
            </svg>
          ))}
          {rulerTicks(ruler).map((t) => (
            <text key={t.key} class="ruler__tick" x={t.x} y={TICK_Y} text-anchor={t.anchor}>
              {t.label}
            </text>
          ))}
        </svg>
      </div>
      <ul class="ruler__list" aria-label={RULER_LABEL}>
        {items.map((i) => (
          <li key={i.kind} class={`ruler__item ruler__item--${i.kind}`}>
            <Legend kind={i.kind} late={late} />
            <span>
              {i.name} {i.price}
            </span>
            {i.rText === null ? null : <span class="sr-only">（{i.rText}）</span>}
          </li>
        ))}
        {over ? <li class="ruler__over-text">{over}</li> : null}
      </ul>
    </div>
  );
}
