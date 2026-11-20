// 記録する画面の 1 段目の絵（2026-11-21。設計書 K17・docs/ui-guidelines.md 9.4）。何を入れる枠かを、ちっこい文字ではなく
// 絵で分からせる。外部の画像は使わず SVG で描き、色は CSS のトークン（record.css の .rart__*）だけ。読み上げからは隠す
// （枠の題が同じことを言う）。hook を持たない

/** 決済明細の絵: 決済した後の明細の画面（建値・決済・損益の行が並ぶ） */
export function StatementArt() {
  const rows = [0, 1];
  return (
    <svg class="rart rart--statement" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect class="rart__phone" x="18" y="8" width="84" height="124" rx="10" />
      <rect class="rart__bar" x="28" y="20" width="34" height="5" rx="2.5" />
      <rect class="rart__rule" x="28" y="31" width="64" height="1" />
      {rows.map((i) => {
        const y = 40 + i * 38;
        return (
          <g key={i}>
            <rect class="rart__strong" x="28" y={y} width="30" height="5" rx="2.5" />
            <rect class="rart__pill" x="62" y={y - 1} width="12" height="7" rx="3.5" />
            <rect class="rart__line" x="28" y={y + 11} width="22" height="4" rx="2" />
            <rect class="rart__line" x="56" y={y + 11} width="22" height="4" rx="2" />
            <rect class="rart__accent" x="28" y={y + 21} width="26" height="5" rx="2.5" />
            <rect class="rart__rule" x="28" y={y + 31} width="64" height="1" />
          </g>
        );
      })}
    </svg>
  );
}

/** ローソク足の絵: 時間足の札「1H」と、エントリーした足を指す印「IN」 */
export function CandleArt({ small = false }: { readonly small?: boolean }) {
  // [x, 実体の上, 実体の下, ひげの上, ひげの下]（架空の形）
  const candles: readonly (readonly [number, number, number, number, number])[] = [
    [14, 58, 72, 52, 76],
    [28, 66, 78, 60, 84],
    [42, 74, 88, 68, 94],
    [56, 82, 86, 78, 100],
    [70, 62, 82, 56, 86],
    [84, 56, 66, 50, 70],
    [98, 54, 60, 48, 64],
    [112, 40, 58, 34, 60],
  ];
  return (
    <svg
      class={small ? 'rart rart--candle rart--small' : 'rart rart--candle'}
      viewBox="0 0 128 112"
      aria-hidden="true"
      focusable="false"
    >
      <rect class="rart__grid" x="0" y="44" width="128" height="1" />
      <rect class="rart__grid" x="0" y="104" width="128" height="1" />
      <rect class="rart__level" x="0" y="84" width="128" height="1.5" />
      {candles.map(([x, top, bottom, hi, lo]) => (
        <g key={x}>
          <rect class="rart__wick" x={x + 3.25} y={hi} width="1.5" height={lo - hi} />
          <rect class="rart__body" x={x} y={top} width="8" height={bottom - top} rx="1" />
        </g>
      ))}
      {small ? null : (
        <>
          <rect class="rart__tag" x="6" y="8" width="26" height="15" rx="7.5" />
          {/* 文字は線で描く（絵の中の文字は文字の拡大に乗らず、読み上げからも隠れているので、字ではなく形にする） */}
          <path
            class="rart__glyph"
            d="M15 12.5 L16.5 11.5 V19.5 M20.5 11.5 V19.5 M25 11.5 V19.5 M20.5 15.5 H25"
          />
          <path class="rart__in" d="M60 90 L66 100 L54 100 Z" />
          <path
            class="rart__glyph rart__glyph--in"
            d="M56 103.5 V110.5 M59 110.5 V103.5 L64 110.5 V103.5"
          />
        </>
      )}
    </svg>
  );
}
