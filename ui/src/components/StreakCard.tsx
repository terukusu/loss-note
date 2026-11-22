// 振り返りのタブの「気づき」の連勝の後のカード（#185。設計書 6.1・9.4・C34）。hook を持たない。
// 見出し「連勝の後」と右に「2 連勝以上の直後の取引」→ 値（件数・計画どおり率と分数・規律コスト。判定の出た取引が 5 件未満なら
// 件数と「あと N 件で率を表示」。0 件なら文。率と規律コストの下に比べる相手「ほかの取引 …」）→「調子に乗った」との重なりの
// 2 組（名前と値。0 件の組は軽く）→ 数え方の注記 →
// 押せる行「連勝の後の取引を見る ›」（trailHref があり、連勝の後が 1 件以上のとき。同じ期間の「期間の取引」）。
// 値は名前と値の組（dl）で読ませる。色・棒は付けない（C34）。R・% は無色の数（P3）
import {
  COLUMN,
  STREAK_LEAD,
  STREAK_LINK,
  STREAK_NOTE,
  STREAK_TITLE,
  type StreakModel,
} from '../lib/insight-view';
import type { TrailFilter } from '../lib/review-trades';
import { RowLink } from './Button';
import { InfoTip } from './InfoTip';

export function StreakCard({
  s,
  trailHref,
}: {
  readonly s: StreakModel;
  readonly trailHref?: ((filter: TrailFilter) => string) | undefined;
}) {
  return (
    <>
      <section class="card section review__card winrun" aria-labelledby="winrun-title">
        <div class="review__ratehead">
          <h2 class="review__label" id="winrun-title">
            {STREAK_TITLE}
          </h2>
          <p class="review__sub review__nowrap">{STREAK_LEAD}</p>
        </div>
        {s.count === 0 ? (
          <p class="review__note">{s.noneText}</p>
        ) : (
          <dl class="winrun__cells">
            <div class="winrun__cell">
              <dt class="winrun__key">件数</dt>
              <dd>
                <span class="num winrun__num">{s.countText}</span>
                {s.few ? <span class="winrun__sub">{s.restText}で率を表示</span> : null}
              </dd>
            </div>
            {s.few ? null : (
              <>
                <div class="winrun__cell">
                  <dt class="winrun__key">
                    {COLUMN.rate}
                    <InfoTip term="planRate" size="sm" />
                  </dt>
                  <dd>
                    <span class="winrun__value">
                      <span class="num winrun__num">{s.rateText}</span>
                      <span class="insight__sub">（{s.fractionText}）</span>
                    </span>
                    {s.others ? <span class="winrun__sub">{s.others.rate}</span> : null}
                  </dd>
                </div>
                <div class="winrun__cell">
                  <dt class="winrun__key">
                    {COLUMN.cost}
                    <InfoTip term="disciplineCost" size="sm" />
                  </dt>
                  <dd>
                    {s.cost ? (
                      <span class="winrun__value">
                        <span class="insight__sub">{s.cost.lead}</span>
                        {s.cost.value ? <span class="num winrun__num">{s.cost.value}</span> : null}
                      </span>
                    ) : null}
                    {s.others?.cost ? <span class="winrun__sub">{s.others.cost}</span> : null}
                  </dd>
                </div>
              </>
            )}
          </dl>
        )}
        {s.count > 0 && s.few && s.others ? <p class="review__note">{s.others.rate}</p> : null}
        {s.pairs.length > 0 ? (
          <dl class="winrun__overlap">
            {s.pairs.map((p) => (
              <div
                key={p.label}
                class={p.zero ? 'winrun__pair winrun__pair--zero' : 'winrun__pair'}
              >
                <dt>{p.label}</dt>
                <dd class="num">{p.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p class="review__note">{STREAK_NOTE}</p>
      </section>
      {trailHref && s.count > 0 ? (
        <div class="review__more">
          <RowLink href={trailHref({ kind: 'winStreak' })}>{STREAK_LINK}</RowLink>
        </div>
      ) : null}
    </>
  );
}
