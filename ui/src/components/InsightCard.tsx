// 振り返りのタブの「気づき」の心理ごとの集計のカード（#162。設計書 6.1・9.4・C34）。hook を持たない。
// 見出し「心理ごとの規律」と右に「N 件のうち M 件に記入」→ 列の見出し（計画どおり率・規律コスト。それぞれ「i」）→
// 値の行（平常心 = 基準を先頭に、下に太い区切り）→ 件数が少ない行のまとまり（見出し 1 回・名前と件数と「あと N 件」だけを
// 詰めて並べる）→ 重なりの 1 行。trailHref があれば行（値の行・件数が少ない行）は押せる行で、その心理の「期間の取引」へ（#185。
// 行全体が当たり・右に ›。ui-guidelines 9.12）。無ければ押せない形のまま。
// 値の行は格子: 広い = 名前 | 率 | 規律コスト の 3 列（列の位置はどの行も同じ）、狭い = 必ず 2 段（名前と件数 / 率を左・規律コストを右）。
// 読み上げは行ごとの全文（列の名前つき）で、見た目の部品は外す。色・棒は付けない（C34）。R・% は無色の数（P3）
import type { ComponentChildren } from 'preact';
import {
  BASE_MARK,
  COLUMN,
  FEW_HEAD,
  INSIGHT_NONE,
  INSIGHT_NONE_LINES,
  INSIGHT_TITLE,
  type InsightModel,
  type InsightRow,
} from '../lib/insight-view';
import type { TrailFilter } from '../lib/review-trades';
import { Link } from '../lib/router';
import { Button } from './Button';
import { InfoTip } from './InfoTip';

function NameCell({ r }: { readonly r: InsightRow }) {
  return (
    <span class="insight__name">
      <span class="insight__tag">{r.name}</span>
      {r.base ? <span class="insight__base">{BASE_MARK}</span> : null}
      <span class="insight__count">{r.countText}</span>
    </span>
  );
}

type TrailHref = ((filter: TrailFilter) => string) | undefined;

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

function MainRow({ r, href }: { readonly r: InsightRow; readonly href: string | undefined }) {
  return (
    <li class={r.base ? 'insight__row insight__row--base' : 'insight__row'} data-emotion={r.id}>
      {trail(href, 'insight__link', <MainCells r={r} />)}
    </li>
  );
}

function MainCells({ r }: { readonly r: InsightRow }) {
  return (
    <>
      <span class="sr-only">{r.srText}</span>
      <span class="insight__cells" aria-hidden="true">
        <NameCell r={r} />
        {r.few || r.rateText === null ? (
          <span class="insight__rate insight__missing">
            {r.restText ? `${r.restText}で表示` : ''}
          </span>
        ) : (
          <span class="insight__rate">
            <span class="num">{r.rateText}</span>
            <span class="insight__sub">（{r.fractionText}）</span>
          </span>
        )}
        <span class="insight__cost">
          {r.cost ? (
            <>
              <span class="insight__sub">{r.cost.lead}</span>
              {r.cost.value ? <span class="num">{r.cost.value}</span> : null}
            </>
          ) : null}
        </span>
      </span>
    </>
  );
}

export function InsightCard({
  m,
  trailHref,
}: {
  readonly m: InsightModel;
  readonly trailHref?: TrailHref;
}) {
  const hrefOf = (r: InsightRow) => trailHref?.({ kind: 'emotion', id: r.id });
  if (m.empty) {
    return (
      <section class="card section review__card review__empty-box">
        <p class="review__empty">{m.emptyText}</p>
      </section>
    );
  }
  return (
    <section
      class={`card section review__card insight${trailHref ? ' insight--trail' : ''}`}
      aria-labelledby="insight-title"
    >
      <div class="review__ratehead">
        <h2 class="review__label" id="insight-title">
          {INSIGHT_TITLE}
        </h2>
        {m.headText ? <p class="review__sub review__nowrap">{m.headText}</p> : null}
      </div>
      {m.rows.length === 0 ? (
        <div class="insight__none">
          {m.emptyText === INSIGHT_NONE ? (
            INSIGHT_NONE_LINES.map((l) => (
              <p key={l} class="review__note">
                {l}
              </p>
            ))
          ) : (
            <p class="review__note">{m.emptyText}</p>
          )}
          <div>
            <Button variant="secondary" href="/trades">
              取引を見る
            </Button>
          </div>
        </div>
      ) : null}
      {m.main.length > 0 ? (
        <div class="insight__table">
          <div class="insight__cols">
            <span class="insight__colname">心理</span>
            <span class="insight__colrate">
              {COLUMN.rate}
              <InfoTip term="planRate" size="sm" />
            </span>
            <span class="insight__colcost">
              {COLUMN.cost}
              <InfoTip term="disciplineCost" size="sm" />
            </span>
          </div>
          <ul class="insight__rows">
            {m.main.map((r) => (
              <MainRow key={r.id} r={r} href={hrefOf(r)} />
            ))}
          </ul>
        </div>
      ) : null}
      {m.few.length > 0 ? (
        <div class="insight__fewbox">
          <h3 class="review__label insight__fewhead" id="insight-few">
            {FEW_HEAD}
          </h3>
          <ul class="insight__few" aria-labelledby="insight-few">
            {m.few.map((r) => (
              <li key={r.id} class="insight__fewrow" data-emotion={r.id}>
                {trail(
                  hrefOf(r),
                  'insight__fewlink',
                  <>
                    <span class="sr-only">{r.srText}</span>
                    <span aria-hidden="true">
                      <span class="insight__fewname">{r.name}</span>{' '}
                      <span class="insight__count">
                        {r.countText} · {r.restText}で表示
                      </span>
                    </span>
                  </>,
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {m.overlapText ? <p class="review__note">{m.overlapText}</p> : null}
    </section>
  );
}
