// 振り返りの 1 本の流れ（#228。設計書 9.2・9.4・C60）の「なぜ」と「次は」の段。hook を持たない。
// - WhyCard: 見出し「何で崩れたか」（Good の切り口は「何が効いたか」）と右に「N 件のうち M 件に記入」（崩れ方は「N 件のうち崩れ M 件」）→
//   切り替え 心理 / 崩れ方 / More / Good（Segment。URL の `&why=`）→ 順位図の表（InsightRows。心理は前の気づきの心理ごとの集計（#162）、
//   崩れ方は判定の崩れの理由ごとの集計（#239・C68。率を出さず凡例も規律コストだけ）、More / Good は話題ごとの集計（#221）と同じ行・同じ文）
//   → 重なりの 1 行。心理の付いた取引が無い期間は付け方の 2 行と ［取引を見る］、崩れの取引が無い期間は 1 行、Good / More の付いていない
//   期間は前と同じ 1〜2 行
// - NextCard: 見出し「次はこうする」→ More の自分で書いた行の最新 1 行（かぎ括弧。テキストのノード）とその取引の日 →
//   押せる行「More の自分で書いた行を見る ›」（期間の取引 `&notes=more`）。無ければ案内の 1 行だけ
// 色・動きは付けない（C34）
import { REFLECTION_NOTES } from '../../../core/review';
import {
  INSIGHT_NONE,
  INSIGHT_NONE_LINES,
  type InsightModel,
  NEXT_LINK,
  NEXT_NONE,
  NEXT_TITLE,
  type NextModel,
  type ReasonInsight,
  type ReflectionCardModel,
  type ReflectionInsightRow,
} from '../lib/insight-view';
import { WHY_KEYS, WHY_LABEL, type WhyKey } from '../lib/period';
import type { TrailFilter } from '../lib/review-trades';
import { Button, RowLink } from './Button';
import { InsightRows } from './InsightCard';
import { Segment } from './Segment';

type TrailHref = ((filter: TrailFilter) => string) | undefined;

/** なぜの段の見出し（#228）: 心理・More は「何で崩れたか」、Good は良かった行動なので「何が効いたか」 */
export const WHY_TITLE = '何で崩れたか';
export const WHY_TITLE_GOOD = '何が効いたか';

export function whyTitleOf(why: WhyKey): string {
  return why === 'good' ? WHY_TITLE_GOOD : WHY_TITLE;
}

const WHY_OPTIONS = WHY_KEYS.map((v) => ({ value: v, label: WHY_LABEL[v] }));

/** Good / More の行の絞り方（話題 / 自分で書いた行） */
export function reflectionFilterOf(
  card: Pick<ReflectionCardModel, 'side'>,
  r: Pick<ReflectionInsightRow, 'key'>,
): TrailFilter {
  return r.key === REFLECTION_NOTES
    ? { kind: 'notes', side: card.side }
    : { kind: 'topic', side: card.side, id: r.key };
}

function Notes({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      {lines.map((l) => (
        <p key={l} class="review__note">
          {l}
        </p>
      ))}
    </>
  );
}

/** 心理の切り口の中身 */
function EmotionBody({
  m,
  trailHref,
}: {
  readonly m: InsightModel;
  readonly trailHref: TrailHref;
}) {
  if (m.rows.length === 0) {
    return (
      <div class="insight__none">
        {m.emptyText === INSIGHT_NONE ? (
          <Notes lines={INSIGHT_NONE_LINES} />
        ) : (
          <p class="review__note">{m.emptyText}</p>
        )}
        <div>
          <Button variant="secondary" href="/trades">
            取引を見る
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <InsightRows
        idPrefix="insight"
        main={m.main}
        few={m.few}
        keyOf={(r) => r.id}
        attrsOf={(r) => ({ 'data-emotion': r.id })}
        hrefOf={(r) => trailHref?.({ kind: 'emotion', id: r.id })}
      />
      {m.overlapText ? <p class="review__note">{m.overlapText}</p> : null}
    </>
  );
}

/** 崩れ方の切り口の中身（#239） */
function ReasonBody({
  r,
  trailHref,
}: {
  readonly r: ReasonInsight | null | undefined;
  readonly trailHref: TrailHref;
}) {
  if (!r) return null;
  if (r.noneText) return <p class="review__note">{r.noneText}</p>;
  return (
    <>
      <InsightRows
        idPrefix="reason"
        main={r.main}
        few={r.few}
        rate={false}
        keyOf={(x) => x.kind}
        attrsOf={(x) => ({ 'data-reason': x.kind })}
        hrefOf={(x) => trailHref?.({ kind: 'reason', id: x.kind })}
      />
      {r.overlapText ? <p class="review__note">{r.overlapText}</p> : null}
    </>
  );
}

/** Good / More の切り口の中身 */
function SideBody({
  m,
  side,
  trailHref,
}: {
  readonly m: InsightModel;
  readonly side: 'good' | 'more';
  readonly trailHref: TrailHref;
}) {
  const r = m.reflection;
  if (!r) return null;
  if (r.noneLines) return <Notes lines={r.noneLines} />;
  const card = r.cards.find((c) => c.side === side);
  if (!card) return null;
  if (card.noneText) return <p class="review__note">{card.noneText}</p>;
  return (
    <div class="reflinsight" data-side={card.side}>
      <InsightRows
        idPrefix={`reflection-${card.side}`}
        main={card.main}
        few={card.few}
        keyOf={(x) => x.key}
        attrsOf={(x) => ({ 'data-topic': x.key })}
        hrefOf={(x) => trailHref?.(reflectionFilterOf(card, x))}
      />
      {card.overlapText ? <p class="review__note">{card.overlapText}</p> : null}
    </div>
  );
}

/** 見出しの右の「N 件のうち M 件に記入」（切り口ごと） */
function headTextOf(m: InsightModel, why: WhyKey): string | null {
  if (why === 'emotion') return m.headText;
  if (why === 'reason') return m.reason?.headText ?? null;
  return m.reflection?.cards.find((c) => c.side === why)?.headText ?? null;
}

export function WhyCard({
  m,
  why,
  onWhy,
  trailHref,
}: {
  readonly m: InsightModel;
  readonly why: WhyKey;
  /** 切り替えを押した（URL を置き換える）。無ければ切り替えを出さず心理だけ */
  readonly onWhy?: ((why: WhyKey) => void) | undefined;
  readonly trailHref?: TrailHref;
}) {
  const shown: WhyKey = onWhy ? why : 'emotion';
  const head = headTextOf(m, shown);
  return (
    <section
      class={`card section review__card insight why${trailHref ? ' insight--trail' : ''}`}
      aria-labelledby="why-title"
      data-why={shown}
    >
      <div class="review__ratehead">
        <h2 class="why__title" id="why-title">
          {whyTitleOf(shown)}
        </h2>
        {head ? <p class="review__sub review__nowrap">{head}</p> : null}
      </div>
      {onWhy ? (
        <div class="why__switch">
          <Segment
            label="切り口"
            name="review-why"
            showLabel={false}
            options={WHY_OPTIONS}
            value={shown}
            onChange={onWhy}
          />
        </div>
      ) : null}
      {shown === 'emotion' ? (
        <EmotionBody m={m} trailHref={trailHref} />
      ) : shown === 'reason' ? (
        <ReasonBody r={m.reason} trailHref={trailHref} />
      ) : (
        <SideBody m={m} side={shown} trailHref={trailHref} />
      )}
    </section>
  );
}

export function NextCard({
  n,
  trailHref,
}: {
  readonly n: NextModel;
  readonly trailHref?: TrailHref;
}) {
  return (
    <section class="card section review__card next" aria-labelledby="next-title">
      <h2 class="why__title" id="next-title">
        {NEXT_TITLE}
      </h2>
      {n.text === null ? (
        <p class="review__note">{NEXT_NONE}</p>
      ) : (
        <>
          {/* 利用者が書いた文はテキストのノードで出す（HTML として解かない） */}
          <blockquote class="next__quote">
            <p class="next__text">「{n.text}」</p>
            {n.dateText ? <p class="review__sub">{n.dateText}</p> : null}
          </blockquote>
          {trailHref ? (
            <div class="review__more next__more">
              <RowLink href={trailHref({ kind: 'notes', side: 'more' })} meta={`${n.count} 件`}>
                {NEXT_LINK}
              </RowLink>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
