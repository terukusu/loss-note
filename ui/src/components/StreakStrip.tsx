// ホームと一覧の「直近の流れ」の段（Issue #35）。hook を持たない。表示の形は lib/streak.ts の streakModel。
// 見出し → 1 行目（最新の段の記号 + 「計画どおりが 3 件続いています」）→ 判定の段の点の並び（左 = 古い・右 = 新しい。
// 連続している点の下に線）→ 2 行目（「直近 10 件のうち計画どおり 6 件」）。
// 色だけに頼らない（P5）: 点は段の色に段の記号（○ △ × −）を重ね、並びは名前つきの ol で各点を「日付 判定の名前」と読ませる。
// 点は押せない（10 個 × 44px は幅 360px に入らない。詳細へは一覧の行から）。損益・R は出さない
import { STREAK_AXIS, STREAK_TITLE, type StreakModel } from '../lib/streak';
import '../styles/streak.css';
import { Icon } from './Icon';

export function StreakSection({ model, id }: { readonly model: StreakModel; readonly id: string }) {
  const titleId = `${id}-title`;
  return (
    <section class="card section streak" aria-labelledby={titleId}>
      <h2 class="section__title" id={titleId}>
        {STREAK_TITLE}
      </h2>
      <p class={`streak__headline streak__headline--${model.tier}`}>
        <Icon name={model.symbol} class="streak__headmark" />
        <span>{model.headline}</span>
      </p>
      <div class="streak__strip">
        <ol class="streak__dots" aria-label={model.listLabel}>
          {model.dots.map((d) => (
            <li key={d.id} class={`streak__item${d.run ? ' streak__item--run' : ''}`}>
              <span class={`streak__dot streak__dot--${d.tier}`}>
                <Icon name={d.symbol} class="streak__mark" />
              </span>
              <span class="sr-only">{d.label}</span>
            </li>
          ))}
        </ol>
        <p class="streak__axis" aria-hidden="true">
          <span>{STREAK_AXIS.old}</span>
          <span>{STREAK_AXIS.new}</span>
        </p>
      </div>
      <p class="streak__sub">{model.subline}</p>
      {model.importsNote ? <p class="streak__sub">{model.importsNote}</p> : null}
    </section>
  );
}
