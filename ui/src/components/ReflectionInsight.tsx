// 振り返りのタブの「気づき」の Good / More の話題ごとの集計のカード（#221。設計書 6.1・9.4・C58・C34）。hook を持たない。
// 側ごとに 1 枚（More → Good）: 見出し「More の話題ごとの規律」と右に「N 件のうち M 件に記入」→ 表（心理のカードと同じ InsightRows。
// 列の名前は「話題」・基準の行は無い・最後に「自分で書いた行」）→ 重なりの 1 行。その側が付いていない期間は 1 行だけ。
// 両側とも付いていない期間は 1 枚にまとめて付け方の 2 行（ボタンは心理のカードの ［取引を見る］ に任せて重ねない）。
// trailHref があれば行は押せる行で、その話題（自分で書いた行）の「期間の取引」へ（#185 と同じ）。色・棒は付けない（C34）
import { REFLECTION_NOTES } from '../../../core/review';
import {
  REFLECTION_COLUMN,
  type ReflectionCardModel,
  type ReflectionInsight,
  type ReflectionInsightRow,
} from '../lib/insight-view';
import { REFLECTION_TITLE } from '../lib/reflection';
import type { TrailFilter } from '../lib/review-trades';
import { InsightRows } from './InsightCard';

type TrailHref = ((filter: TrailFilter) => string) | undefined;

/** 行の絞り方（話題 / 自分で書いた行） */
export function reflectionFilterOf(
  card: Pick<ReflectionCardModel, 'side'>,
  r: Pick<ReflectionInsightRow, 'key'>,
): TrailFilter {
  return r.key === REFLECTION_NOTES
    ? { kind: 'notes', side: card.side }
    : { kind: 'topic', side: card.side, id: r.key };
}

function ReflectionCard({
  card,
  trailHref,
}: {
  readonly card: ReflectionCardModel;
  readonly trailHref: TrailHref;
}) {
  const titleId = `reflection-${card.side}-title`;
  return (
    <section
      class={`card section review__card insight reflinsight${trailHref ? ' insight--trail' : ''}`}
      aria-labelledby={titleId}
      data-side={card.side}
    >
      <div class="review__ratehead">
        <h2 class="review__label" id={titleId}>
          {card.title}
        </h2>
        <p class="review__sub review__nowrap">{card.headText}</p>
      </div>
      {card.noneText ? <p class="review__note">{card.noneText}</p> : null}
      <InsightRows
        idPrefix={`reflection-${card.side}`}
        column={REFLECTION_COLUMN}
        main={card.main}
        few={card.few}
        keyOf={(r) => r.key}
        attrsOf={(r) => ({ 'data-topic': r.key })}
        hrefOf={(r) => trailHref?.(reflectionFilterOf(card, r))}
      />
      {card.overlapText ? <p class="review__note">{card.overlapText}</p> : null}
    </section>
  );
}

export function ReflectionInsightCards({
  m,
  trailHref,
}: {
  readonly m: ReflectionInsight;
  readonly trailHref?: TrailHref;
}) {
  if (m.noneLines) {
    return (
      <section
        class="card section review__card reflinsight reflinsight--none"
        aria-label={REFLECTION_TITLE}
      >
        {m.noneLines.map((l) => (
          <p key={l} class="review__note">
            {l}
          </p>
        ))}
      </section>
    );
  }
  return (
    <>
      {m.cards.map((card) => (
        <ReflectionCard key={card.side} card={card} trailHref={trailHref} />
      ))}
    </>
  );
}
