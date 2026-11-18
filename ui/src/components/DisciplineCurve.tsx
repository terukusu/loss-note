// 規律コストの曲線（Issue #88 契約 U-1・P-4。設計書 6.2）。実際の R の累積（実線・文字の色）と、計画どおりだったらの R の累積
// （破線・計画どおりの段の色）を重ね、差の面を崩れの段の色と斜線の模様で塗る（色だけに頼らない）。hook を持たない。
// 右端に「計画」「実際」の札と差の括弧、崩れた取引（計画どおりの R に置き換えた取引）の点に判定のバッジと同じ形の印。
// 横軸は取引の順（両端に最初と最後の決済の日付、下に「取引の順」）。
// 図は読み上げから外し（aria-hidden）、同じ中身を見出しの文と「数で見る」の表で読ませる（P5）。
// 線と面は viewBox 0〜100 の SVG を幅に伸ばし（線は non-scaling-stroke）、目盛り・札・印・斜線は伸ばさない SVG に百分率の位置で
// 置く（文字と形が潰れない。style 属性を使わない = CSP）。模様と切り抜きの ID はホームに 1 つだけの図の決まった名前
import type { JSX } from 'preact';
import type { CurvePoint } from '../../../core/review';
import type { TierSymbol } from '../lib/badge';
import { curveGeometry } from '../lib/review-chart';

export interface DisciplineCurveProps {
  readonly curve: readonly CurvePoint[];
  /** 最初と最後の決済の日付（「11/13」。同じ日なら last は null） */
  readonly firstDate: string;
  readonly lastDate: string | null;
}

export const HATCH_ID = 'curve-hatch';

/** 判定のバッジと同じ形（Icon の 24 の座標を 0 中心・半径 6 に縮めた形） */
function markShape(symbol: TierSymbol): JSX.Element {
  switch (symbol) {
    case 'triangle':
      return <path d="M0 -5.5L5.5 4.5H-5.5Z" />;
    case 'cross':
      return <path d="M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5" />;
    case 'circle':
      return <circle cx="0" cy="0" r="4.5" />;
    case 'dash':
      return <path d="M-5 0H5" />;
  }
}

/** 斜線の模様（45 度・線 1px・間隔 6px） */
function Hatch() {
  return (
    <pattern
      id={HATCH_ID}
      width="6"
      height="6"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line class="curve__hatch-line" x1="0" y1="0" x2="0" y2="6" />
    </pattern>
  );
}

/** 件数が多いときの印（画面の幅で計画の線を細い実線に・崩れの印を横軸の上の帯に。CSS の幅の段と組む） */
export function curveClass(dense: { readonly narrow: boolean; readonly wide: boolean }): string {
  return `curve${dense.narrow ? ' curve--dense' : ''}${dense.wide ? ' curve--dense-wide' : ''}`;
}

export function DisciplineCurve(p: DisciplineCurveProps) {
  const g = curveGeometry(p.curve);
  const b = g.ends.bracket;
  return (
    <div class={curveClass(g.dense)} aria-hidden="true">
      <svg class="curve__axis" aria-hidden="true" focusable="false">
        {g.ticks.map((t) => (
          <text
            key={t.label}
            class="curve__tick"
            x="100%"
            y={`${t.y}%`}
            dx="-6"
            dy="0.35em"
            text-anchor="end"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <svg
        class="curve__plot"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {g.ticks
          .filter((t) => !t.zero)
          .map((t) => (
            <line
              key={t.label}
              class="curve__grid"
              x1="0"
              x2="100"
              y1={t.y}
              y2={t.y}
              vector-effect="non-scaling-stroke"
            />
          ))}
        <line
          class="curve__zero"
          x1="0"
          x2="100"
          y1={g.zeroY}
          y2={g.zeroY}
          vector-effect="non-scaling-stroke"
        />
        {g.gapPolygons.map((pts) => (
          <polygon key={pts} class="curve__gap" points={pts} />
        ))}
        <polyline
          class="curve__planned"
          points={g.plannedPoints}
          vector-effect="non-scaling-stroke"
        />
        <polyline
          class="curve__actual"
          points={g.actualPoints}
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <svg class="curve__over" aria-hidden="true" focusable="false">
        <defs>
          <Hatch />
          {g.gapFractions.map((pts, i) => (
            <clipPath key={pts} id={`curve-gap-${i}`} clipPathUnits="objectBoundingBox">
              <polygon points={pts} />
            </clipPath>
          ))}
        </defs>
        {g.gapFractions.map((pts, i) => (
          <rect
            key={pts}
            class="curve__hatch"
            width="100%"
            height="100%"
            fill={`url(#${HATCH_ID})`}
            clip-path={`url(#curve-gap-${i})`}
          />
        ))}
        {g.dots.map((d) => (
          <circle key={`${d.x}`} class="curve__dot" cx={`${d.x}%`} cy={`${d.y}%`} r="2.5" />
        ))}
        <g class="curve__marks-line">
          {g.marks.map((m) => (
            <svg key={`${m.x}`} x={`${m.x}%`} y={`${m.y}%`} overflow="visible" aria-hidden="true">
              <g class={`curve__mark curve__mark--${m.tier}`}>{markShape(m.symbol)}</g>
            </svg>
          ))}
        </g>
        {/* 件数が多いとき: 崩れの印を横軸のすぐ上の帯に並べる（近い印は 1 つにまとめる。線を隠さない） */}
        <g class="curve__marks-rug">
          {g.rug.map((m) => (
            <svg key={`${m.x}`} x={`${m.x}%`} y="100%" overflow="visible" aria-hidden="true">
              <g class={`curve__mark curve__mark--${m.tier}`} transform="translate(0 -8)">
                {markShape(m.symbol)}
              </g>
            </svg>
          ))}
        </g>
      </svg>
      {/* 右端: 1 列目に「計画」「実際」の札、その右に括弧、括弧の右の列に差（中ほどの高さに固定。押し出さない） */}
      <svg class="curve__ends" aria-hidden="true" focusable="false">
        <text class="curve__end" x="2%" y={`${g.ends.planned.y}%`} dy="0.35em">
          {g.ends.planned.text}
        </text>
        <text class="curve__end" x="2%" y={`${g.ends.actual.y}%`} dy="0.35em">
          {g.ends.actual.text}
        </text>
        {b ? (
          <>
            <g class="curve__bracket">
              <line x1="62%" x2="65%" y1={`${b.top}%`} y2={`${b.top}%`} />
              <line x1="65%" x2="65%" y1={`${b.top}%`} y2={`${b.bottom}%`} />
              <line x1="62%" x2="65%" y1={`${b.bottom}%`} y2={`${b.bottom}%`} />
            </g>
            <text class="curve__end curve__end--gap" x="69%" y={`${b.label.y}%`} dy="0.35em">
              {b.label.text}
            </text>
          </>
        ) : null}
      </svg>
      <div class="curve__dates">
        <span>{p.firstDate}</span>
        <span class="curve__order">取引の順</span>
        <span>{p.lastDate ?? ''}</span>
      </div>
    </div>
  );
}

/** 線の凡例（線の形で見分ける。色だけに頼らない）。差が無い期間は「差」を出さない */
export function CurveLegend({
  gap,
  dense,
}: {
  readonly gap: boolean;
  readonly dense?: { readonly narrow: boolean; readonly wide: boolean };
}) {
  return (
    <ul class={`curve__legend${dense ? curveClass(dense).replace('curve', '') : ''}`}>
      <li>
        <svg class="curve__key" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
          <line class="curve__actual" x1="1" x2="23" y1="4" y2="4" />
        </svg>
        実際の R の累積
      </li>
      <li>
        <svg class="curve__key" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
          <line class="curve__planned" x1="1" x2="23" y1="4" y2="4" />
        </svg>
        計画どおりだったら
      </li>
      {gap ? (
        <li>
          <svg class="curve__key" viewBox="0 0 24 8" aria-hidden="true" focusable="false">
            <rect class="curve__gap" x="1" y="0.5" width="22" height="7" rx="1" />
            <rect
              class="curve__hatch"
              x="1"
              y="0.5"
              width="22"
              height="7"
              rx="1"
              fill={`url(#${HATCH_ID})`}
            />
          </svg>
          差（崩れで失った R）
        </li>
      ) : null}
    </ul>
  );
}
