// 振り返りの「何で崩れたか」の順位図の表（#228。前は気づきの心理ごとの集計の表（#162）と Good / More の表（#221）。設計書 6.1・9.4・C60）。
// hook を持たない。棒の凡例の 1 行（規律コスト・計画どおり率の「i」）→ 値の行（rankRows の並び = 基準（平常心）→ 多く失った順。
// 行ごとに 1 行目 = 名前・基準の印・件数と計画どおり率 / 規律コスト、2 行目 = 横棒。棒の長さは表示中の行の規律コストの絶対値の最大に
// 対する割合）→ 件数が少ない行のまとまり（見出し 1 回・名前と件数だけの小さな押せる形を横に詰めて折り返す。「あと N 件」は
// 読み上げの全文に残す。360px の長さを詰めるため。#228 のレビュー）。規律コストの見た目の言い方は rankCostOf（1 枚目の見出しと同じ
// 「崩れで」にそろえ、R の出ない取引は 1 行目の添え「R なし N 件」で言う）。
// trailHref があれば行（値の行・件数が少ない行）は押せる行で、その行の「期間の取引」へ（#185。行全体が当たり・右に ›。
// ui-guidelines 9.12）。無ければ押せない形のまま。
// 棒は SVG の rect の % 幅（CSP で style 属性を使わない）で、色は付けない（判定の段の色を使わない。C34・C60）。棒と見た目の部品は
// 読み上げから外し、行の全文（列の名前つき）で読ませる。R・% は無色の数（P3）
import { type ComponentChildren, Fragment } from 'preact';
import {
  BASE_MARK,
  COLUMN,
  FEW_HEAD,
  type InsightRowText,
  rankCostOf,
  rankRows,
} from '../lib/insight-view';
import { Link } from '../lib/router';
import { InfoTip } from './InfoTip';

/** 行のデータ属性（心理 = data-emotion、Good / More = data-topic） */
type RowAttrs = Readonly<Record<string, string>>;

/** 行の中身を、行き先があれば押せる行（Link）で包む（読み上げの名前は中の sr-only の全文） */
function trail(href: string | undefined, cls: string, children: ComponentChildren) {
  return href === undefined ? (
    children
  ) : (
    <Link href={href} class={cls}>
      {children}
    </Link>
  );
}

/** 棒の幅（%。小数 1 桁） */
export function barWidth(ratio: number): string {
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`;
}

function RankCells({ r, ratio }: { readonly r: InsightRowText; readonly ratio: number }) {
  const rate =
    r.few || r.rateText === null
      ? r.restText
        ? `${r.restText}で表示`
        : ''
      : `${r.rateText}（${r.fractionText}）`;
  const cost = rankCostOf(r);
  const parts = [r.countText, rate, r.noRText].filter(Boolean);
  return (
    <>
      <span class="sr-only">{r.srText}</span>
      <span class="insight__cells" aria-hidden="true">
        <span class="insight__name">
          <span class="insight__tag">{r.name}</span>
          {r.base ? <span class="insight__base">{BASE_MARK}</span> : null}
          <span class="insight__count">
            {parts.map((t, i) => (
              <Fragment key={t}>
                {i > 0 ? ' · ' : ''}
                <span class="insight__piece">{t}</span>
              </Fragment>
            ))}
          </span>
        </span>
        <span class="insight__cost">
          {cost ? (
            <>
              <span class="insight__sub">{cost.lead}</span>
              {cost.value ? <span class="num">{cost.value}</span> : null}
            </>
          ) : null}
        </span>
        {r.costR === null ? null : (
          <svg class="insight__bar" aria-hidden="true" focusable="false">
            <rect class="insight__track" x="0" y="0" width="100%" height="100%" rx="3" />
            {ratio > 0 ? (
              <rect
                class="insight__fill"
                x="0"
                y="0"
                width={barWidth(ratio)}
                height="100%"
                rx="3"
              />
            ) : null}
          </svg>
        )}
      </span>
    </>
  );
}

/**
 * 順位図の表（凡例の 1 行・値の行・件数が少ない行のまとまり）。心理と Good / More で共有する。
 * idPrefix は見出しの id の頭（1 画面に何枚あっても重ならない）
 */
export function InsightRows<R extends InsightRowText>(p: {
  readonly idPrefix: string;
  readonly main: readonly R[];
  readonly few: readonly R[];
  readonly keyOf: (r: R) => string;
  readonly attrsOf: (r: R) => RowAttrs;
  readonly hrefOf: (r: R) => string | undefined;
}) {
  const fewId = `${p.idPrefix}-few`;
  const ranked = rankRows(p.main);
  return (
    <>
      {ranked.length > 0 ? (
        <div class="insight__table">
          <p class="insight__key">
            <span class="insight__keyitem">
              棒の長さは{COLUMN.cost}
              <InfoTip term="disciplineCost" size="sm" />
            </span>
            <span class="insight__keyitem">
              率は{COLUMN.rate}
              <InfoTip term="planRate" size="sm" />
            </span>
          </p>
          <ul class="insight__rows">
            {ranked.map(({ row, ratio }) => (
              <li
                key={p.keyOf(row)}
                class={row.base ? 'insight__row insight__row--base' : 'insight__row'}
                {...p.attrsOf(row)}
              >
                {trail(p.hrefOf(row), 'insight__link', <RankCells r={row} ratio={ratio} />)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.few.length > 0 ? (
        <div class="insight__fewbox">
          <h3 class="review__label insight__fewhead" id={fewId}>
            {FEW_HEAD}
          </h3>
          <ul class="insight__few" aria-labelledby={fewId}>
            {p.few.map((r) => (
              <li key={p.keyOf(r)} class="insight__fewrow" {...p.attrsOf(r)}>
                {trail(
                  p.hrefOf(r),
                  'insight__fewlink',
                  <>
                    <span class="sr-only">{r.srText}</span>
                    <span aria-hidden="true">
                      <span class="insight__fewname">{r.name}</span>{' '}
                      <span class="insight__count">{r.countText}</span>
                    </span>
                  </>,
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
