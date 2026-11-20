// ホームの主役「直近の流れ」のカード（Issue #35。#128 でホームだけに置き、一覧の上から外した。設計書 9.2・9.3・K18）。
// hook を持たない。表示の形は lib/streak.ts の streakModel。
// 見出しの行（「直近の流れ」と右の「取引 ›」）→ 1 行目（最新の段の記号 + 「計画どおりが 3 件続いています」。段 2 の大きさ・文節で折る）→
// 判定の段の点の並び（全幅。左 = 古い・右 = 新しい。連続している点の下に線）→ 2 行目（「直近 10 件のうち計画どおり 6 件」と目盛り）。
// 色だけに頼らない（P5）: 点は段の色に段の記号（○ △ × −）を重ね、並びは名前つきの ol で各点を「日付 判定の名前」と読ませる。
// カードを押すと取引のタブ（9.4・9.12 の押せるカード）。当たりは見出しの行の「取引 ›」のリンクをカードの全面に広げて取る
// （点 10 個 × 44px は幅 360px に入らないので、点は押せない）。損益・R は出さない
import { Fragment } from 'preact';
import { Link } from '../lib/router';
import { STREAK_AXIS, STREAK_TITLE, type StreakModel } from '../lib/streak';
import '../styles/streak.css';
import { Icon } from './Icon';

export function StreakSection({ model, id }: { readonly model: StreakModel; readonly id: string }) {
  const titleId = `${id}-title`;
  return (
    <section class="card homecard streak" aria-labelledby={titleId}>
      <div class="homecard__head">
        <h2 class="section__title" id={titleId}>
          {STREAK_TITLE}
        </h2>
        <Link href="/trades" class="homecard__link">
          <span class="sr-only">直近の流れを</span>
          <span>取引</span>
          <span class="sr-only">で見る</span>
          <Icon name="chevron" class="homecard__chev" />
        </Link>
      </div>
      <p class={`streak__headline streak__headline--${model.tier}`}>
        <Icon name={model.symbol} class="streak__headmark" />
        {/* 文節の塊の間（<wbr>）と空白でだけ折る（語の途中で折らない。#128 デザイン a2） */}
        <span class="streak__headtext">
          {model.headlineParts.map((t, i) => (
            <Fragment key={t}>
              {i > 0 ? <wbr /> : null}
              {t}
            </Fragment>
          ))}
        </span>
      </p>
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
      <div class="streak__foot">
        <p class="streak__sub">{model.subline}</p>
        <p class="streak__axis" aria-hidden="true">
          {STREAK_AXIS.old} → {STREAK_AXIS.new}
        </p>
      </div>
      {model.importsNote ? <p class="streak__sub">{model.importsNote}</p> : null}
    </section>
  );
}
