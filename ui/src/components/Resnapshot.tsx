// 記録したときの値と今の値（Issue #31。設計書 C36）の比較のシートの中身。hook を持たない。
// - 編集の画面の中のカード / 折りたたみをやめ、詳細と編集の比較のシート（下のシート）の中身にした（#131。設計書 9.2・9.3）
// - 中身: 違う値（記録したとき → 今）、判定・R・リスクの 前 → 後（変わらなければ 1 行に畳む。判定が変わるときは 1 文で
//   はっきり書く）。編集は加えて 2 択「計算に使う値」（記録したとき / 今の値。L / S と同じ部品）と、どちらで保存するか・戻し方の
//   1 行。詳細は見るだけ（2 択を持たない。#31 の P4）
// - 前 → 後は文字と矢印だけ（色で意味を持たせない。矢印は読み上げでは「から / へ」）
import {
  CHOICE_LABEL,
  CHOICE_NAME,
  CHOICE_OPTIONS,
  gradeChangeText,
  NO_OUTCOME_CHANGE,
  OUTCOME_PENDING,
  type OutcomeRow,
  outcomeRows,
  type ResnapshotChoice,
  type ResnapshotOffer,
  resnapshotLead,
  resnapshotStatus,
} from '../lib/resnapshot';
import { Segment } from './Segment';

function Row({ label, from, to, changed }: OutcomeRow) {
  return (
    <div class={changed ? 'resnap__row resnap__row--changed' : 'resnap__row'}>
      <dt class="resnap__label">{label}</dt>
      <dd class="resnap__value">
        {changed ? (
          <>
            <span>{from}</span>
            <span class="resnap__arrow" aria-hidden="true">
              →
            </span>
            <span class="sr-only">から</span>
            <span>{to}</span>
            <span class="sr-only">へ</span>
          </>
        ) : (
          <span>{to}（変わらず）</span>
        )}
      </dd>
    </div>
  );
}

/** 違う値と、判定・R・リスクの 前 → 後（詳細・編集の比較のシートで同じ。prefix は id の頭） */
export function ResnapshotSummary({
  offer,
  prefix = 'edit',
}: {
  readonly offer: ResnapshotOffer;
  readonly prefix?: string;
}) {
  const outcomes = offer.before && offer.after ? outcomeRows(offer.before, offer.after) : null;
  const gradeLine = offer.before && offer.after ? gradeChangeText(offer.before, offer.after) : null;
  const anyChange = outcomes?.some((o) => o.changed) ?? false;
  return (
    <div class="resnap">
      <p class="resnap__lead">{resnapshotLead(offer)}</p>
      <p class="resnap__caption" id={`${prefix}-resnapshot-diffs`}>
        違う値（記録したとき → 今）
      </p>
      <dl class="resnap__list" aria-labelledby={`${prefix}-resnapshot-diffs`}>
        {offer.diffs.map((d) => (
          <Row key={d.label} {...d} changed />
        ))}
      </dl>
      {outcomes === null ? (
        <p class="resnap__status">{OUTCOME_PENDING}</p>
      ) : anyChange ? (
        <>
          <p class="resnap__caption" id={`${prefix}-resnapshot-outcomes`}>
            今の値で再計算すると
          </p>
          {gradeLine ? <p class="resnap__grade">{gradeLine}</p> : null}
          <dl class="resnap__list" aria-labelledby={`${prefix}-resnapshot-outcomes`}>
            {outcomes.map((o) => (
              <Row key={o.label} {...o} />
            ))}
          </dl>
        </>
      ) : (
        <p class="resnap__status">{NO_OUTCOME_CHANGE}</p>
      )}
    </div>
  );
}

/** 編集の比較のシートの中身: 違う値・前 → 後と、2 択「計算に使う値」・どちらで保存するかの 1 行 */
export function ResnapshotBody(p: {
  readonly offer: ResnapshotOffer;
  readonly on: boolean;
  readonly onChoose: (on: boolean) => void;
}) {
  return (
    <>
      <ResnapshotSummary offer={p.offer} />
      <Segment<ResnapshotChoice>
        label={CHOICE_LABEL}
        name={CHOICE_NAME}
        options={CHOICE_OPTIONS}
        value={p.on ? 'current' : 'recorded'}
        onChange={(v) => p.onChoose(v === 'current')}
        describedBy="edit-resnapshot-status"
      />
      <p class="resnap__status" id="edit-resnapshot-status" aria-live="polite">
        {resnapshotStatus(p.on)}
      </p>
    </>
  );
}
