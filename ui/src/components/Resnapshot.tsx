// 記録したときの値と今の値の枠（Issue #31。編集の画面だけ。設計書 C36）。hook を持たない。
// - 記録したときの資金（または銘柄の値）が空の取引だけ、目立つ枠（カード）で出す。ほかは折りたたみ「記録したときの値」の中
// - 中身は同じ: 違う値（記録したとき → 今）、判定・R・リスクの 前 → 後（変わらなければ 1 行に畳む。判定が変わるときは 1 文で
//   はっきり書く）、2 択「計算に使う値」（記録したとき / 今の値。L / S と同じ部品）と、どちらで保存するか・戻し方の 1 行
// - 前 → 後は文字と矢印だけ（色で意味を持たせない。矢印は読み上げでは「から / へ」）
import {
  CHOICE_LABEL,
  CHOICE_NAME,
  CHOICE_OPTIONS,
  foldSummary,
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

export const RESNAPSHOT_TITLE_ID = 'edit-resnapshot-title';

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

function Body({
  offer,
  on,
  onChoose,
}: {
  readonly offer: ResnapshotOffer;
  readonly on: boolean;
  readonly onChoose: (on: boolean) => void;
}) {
  const outcomes = offer.before && offer.after ? outcomeRows(offer.before, offer.after) : null;
  const gradeLine = offer.before && offer.after ? gradeChangeText(offer.before, offer.after) : null;
  const anyChange = outcomes?.some((o) => o.changed) ?? false;
  return (
    <>
      <p class="resnap__lead">{resnapshotLead(offer)}</p>
      <p class="resnap__caption" id="edit-resnapshot-diffs">
        違う値（記録したとき → 今）
      </p>
      <dl class="resnap__list" aria-labelledby="edit-resnapshot-diffs">
        {offer.diffs.map((d) => (
          <Row key={d.label} {...d} changed />
        ))}
      </dl>
      {outcomes === null ? (
        <p class="resnap__status">{OUTCOME_PENDING}</p>
      ) : anyChange ? (
        <>
          <p class="resnap__caption" id="edit-resnapshot-outcomes">
            今の値で再計算すると
          </p>
          {gradeLine ? <p class="resnap__grade">{gradeLine}</p> : null}
          <dl class="resnap__list" aria-labelledby="edit-resnapshot-outcomes">
            {outcomes.map((o) => (
              <Row key={o.label} {...o} />
            ))}
          </dl>
        </>
      ) : (
        <p class="resnap__status">{NO_OUTCOME_CHANGE}</p>
      )}
      <Segment<ResnapshotChoice>
        label={CHOICE_LABEL}
        name={CHOICE_NAME}
        options={CHOICE_OPTIONS}
        value={on ? 'current' : 'recorded'}
        onChange={(v) => onChoose(v === 'current')}
        describedBy="edit-resnapshot-status"
      />
      <p class="resnap__status" id="edit-resnapshot-status" aria-live="polite">
        {resnapshotStatus(on)}
      </p>
    </>
  );
}

export function ResnapshotPanel(p: {
  readonly offer: ResnapshotOffer;
  readonly on: boolean;
  readonly onChoose: (on: boolean) => void;
}) {
  if (p.offer.prominent) {
    return (
      <section class="card section resnap" aria-labelledby={RESNAPSHOT_TITLE_ID}>
        <h2 class="section__title" id={RESNAPSHOT_TITLE_ID}>
          記録したときの値と今の値
        </h2>
        <Body {...p} />
      </section>
    );
  }
  // 勧めない: 折りたたみ（開き閉じは利用者のまま。open を描き直しで触らない）
  return (
    <details class="card more resnap resnap--fold">
      <summary class="more__summary resnap__summary">
        <span>記録したときの値</span>
        <span class="resnap__summary-note">{foldSummary(p.offer)}</span>
      </summary>
      <div class="more__body">
        <Body {...p} />
      </div>
    </details>
  );
}
