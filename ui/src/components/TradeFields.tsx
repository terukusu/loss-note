// 取引の欄（記録する画面 #13 と直す画面 #9 が共有する。Issue #9 で Record.tsx から出した。id・クラス・文言・順は同じ）。
// TradeMainFields = 「取引」「LC」「3 つのタップ」の 3 つの枠、TradeMoreFields = 畳んだ「ほかの欄（任意）」。
// hook を持たない（テストは関数を呼んで木にする）。値はテキストのノードだけ（HTML の文字列を DOM に入れない）
import type { InstrumentRecord } from '../../../core/record';
import type { ExitReason, TimeframeChange } from '../../../core/trade';
import {
  type Draft,
  type DraftAction,
  type DraftField,
  type DraftReading,
  type LcMoveKind,
  lcMoveLabel,
} from '../lib/record-form';
import { MARK_LABEL, type Marks } from '../lib/statement-fill';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { Segment } from './Segment';
import { TextField } from './TextField';

export interface TradeFieldsProps {
  readonly draft: Draft;
  readonly errors: DraftReading['errors'];
  readonly instruments: readonly InstrumentRecord[];
  /** 明細の読み取りの印（記録する画面だけ。#15） */
  readonly marks: Marks;
  readonly onUpdate: (action: DraftAction) => void;
}

export const INSTRUMENT_LIST_ID = 'record-instruments';

export const EXIT_REASONS: readonly { value: ExitReason; label: string }[] = [
  { value: 'lc', label: 'LC（崩れの条件に当たった）' },
  { value: 'gapSlip', label: '窓・滑り' },
  { value: 'tp', label: 'TP' },
  { value: 'brokeManual', label: '根拠が崩れたので手で' },
  { value: 'fearEarly', label: '崩れる前に怖くなって' },
  { value: 'timeout', label: '時間切れ' },
  { value: 'other', label: 'その他' },
];

const TIMEFRAME_OPTIONS: readonly { value: TimeframeChange; label: string }[] = [
  { value: 'none', label: '変えず' },
  { value: 'longer', label: '長い足へ' },
  { value: 'shorter', label: '短い足へ' },
];

function fieldHelpers(p: TradeFieldsProps) {
  const d = p.draft;
  const set =
    <K extends keyof Draft>(field: K) =>
    (value: Draft[K]) =>
      p.onUpdate({ type: 'set', field, value } as DraftAction);
  const mark = (f: DraftField): { mark?: string } => {
    const m = p.marks[f];
    return m ? { mark: MARK_LABEL[m] } : {};
  };
  return { d, e: p.errors, set, mark, onUpdate: p.onUpdate, marks: p.marks };
}

/** 「取引」「LC」「決済までの振る舞い」（3 つのタップ）の枠 */
export function TradeMainFields(p: TradeFieldsProps) {
  const { d, e, set, mark, onUpdate } = fieldHelpers(p);
  const side = d.side;
  const moveOptions: readonly { value: LcMoveKind; label: string }[] = (
    ['none', 'tightened', 'widened'] as const
  ).map((k) => ({ value: k, label: lcMoveLabel(k, side) }));
  const widenWord = side === 'S' ? '上げた' : '下げた';
  return (
    <>
      <section class="card section" aria-labelledby="record-trade-title">
        <h2 class="section__title" id="record-trade-title">
          取引
        </h2>
        <TextField
          id="record-instrument"
          label="銘柄"
          value={d.instrumentName}
          onInput={set('instrumentName')}
          list={INSTRUMENT_LIST_ID}
          placeholder="例: 架空指数A"
          {...mark('instrumentName')}
          {...(e.instrumentName ? { error: e.instrumentName } : {})}
        />
        <datalist id={INSTRUMENT_LIST_ID}>
          {p.instruments.map((i) => (
            <option key={i.id} value={i.name} />
          ))}
        </datalist>
        <Segment
          label="L / S"
          id="record-side"
          {...mark('side')}
          value={d.side}
          onChange={set('side')}
          options={[
            { value: 'L', label: 'L ロング' },
            { value: 'S', label: 'S ショート' },
          ]}
        />
        <div class="record__pair record__pair--prices">
          <NumberField
            id="record-entry"
            label="イン"
            size="lg"
            value={d.entryPrice}
            onInput={set('entryPrice')}
            placeholder="0.00"
            {...mark('entryPrice')}
            {...(e.entryPrice ? { error: e.entryPrice } : {})}
          />
          <NumberField
            id="record-exit"
            label="決済"
            size="lg"
            value={d.exitPrice}
            onInput={set('exitPrice')}
            placeholder="0.00"
            {...mark('exitPrice')}
            {...(e.exitPrice ? { error: e.exitPrice } : {})}
          />
        </div>
        <div class="record__pair">
          <NumberField
            id="record-quantity"
            label="数量"
            value={d.quantity}
            onInput={set('quantity')}
            {...mark('quantity')}
            {...(e.quantity ? { error: e.quantity } : {})}
          />
          <TextField
            id="record-exit-time"
            label="決済の時刻"
            type="datetime-local"
            value={d.exitTime}
            onInput={set('exitTime')}
            {...mark('exitTime')}
            {...(e.exitTime ? { error: e.exitTime } : {})}
          />
        </div>
      </section>

      <section class="card section" aria-labelledby="record-lc-title">
        <h2 class="section__title" id="record-lc-title">
          LC
        </h2>
        <div class="lcrow">
          <NumberField
            id="record-lc"
            label="入る前に決めた LC"
            size="lg"
            value={d.lc}
            onInput={set('lc')}
            disabled={d.lcNone}
            placeholder={d.lcNone ? 'なし' : '0.00'}
            hint="思惑が外れたと確認できる価格"
            {...(e.lc ? { error: e.lc } : {})}
          />
          <button
            type="button"
            class="lcnone"
            aria-pressed={d.lcNone ? 'true' : 'false'}
            aria-label="LC を決めていなかった（なし）"
            onClick={() => onUpdate({ type: 'set', field: 'lcNone', value: !d.lcNone })}
          >
            {d.lcNone ? <Icon name="check" /> : null}
            <span>なし</span>
          </button>
        </div>
        <TextField
          id="record-broken"
          label="崩れの条件の一言（任意）"
          value={d.brokenCondition}
          onInput={set('brokenCondition')}
          placeholder="例: 押し目の安値を割ったら"
          {...(e.brokenCondition ? { error: e.brokenCondition } : {})}
        />
      </section>

      <section class="card section" aria-labelledby="record-taps-title">
        <h2 class="section__title" id="record-taps-title">
          決済までの振る舞い
        </h2>
        {d.lcNone ? (
          <p class="section__note">
            LC なしなので「LC を決めていなかった」「動かしていない」で記録します。
          </p>
        ) : (
          <>
            <Segment
              label="LC を入る前に決めていたか"
              id="record-lc-decided"
              {...mark('lcDecided')}
              value={d.lcDecided === null ? null : d.lcDecided ? 'yes' : 'no'}
              onChange={(v) => onUpdate({ type: 'set', field: 'lcDecided', value: v === 'yes' })}
              options={[
                { value: 'yes', label: '決めていた' },
                { value: 'no', label: '決めていない' },
              ]}
            />
            <Segment
              label="LC を動かしたか"
              value={d.lcMove}
              onChange={set('lcMove')}
              options={moveOptions}
            />
            {d.lcMove === 'widened' ? (
              <NumberField
                id="record-lc-after"
                label={`${widenWord}後の LC（任意）`}
                value={d.lcAfter}
                onInput={set('lcAfter')}
                {...(e.lcAfter ? { error: e.lcAfter } : {})}
              />
            ) : null}
          </>
        )}
        <Segment
          label="時間足を変えたか"
          value={d.timeframeChange}
          onChange={set('timeframeChange')}
          options={TIMEFRAME_OPTIONS}
        />
      </section>
    </>
  );
}

/** 畳んだ「ほかの欄（任意）」（open = 開いて見せる: 誤りがある・読み取りの値がある） */
export function TradeMoreFields(p: TradeFieldsProps & { readonly open: boolean }) {
  const { d, e, set, mark, onUpdate, marks } = fieldHelpers(p);
  return (
    <details class="card more" {...(p.open ? { open: true } : {})}>
      <summary class="more__summary">ほかの欄（任意）</summary>
      <div class="more__body">
        <div class="record__pair">
          <NumberField
            id="record-pnl"
            label="損益（円。明細の値）"
            inputMode="text"
            value={d.pnlYen}
            onInput={set('pnlYen')}
            unit="円"
            {...mark('pnlYen')}
            {...(e.pnlYen ? { error: e.pnlYen } : {})}
          />
          <NumberField
            id="record-fee"
            label="手数料（円）"
            value={d.feeYen}
            onInput={set('feeYen')}
            unit="円"
            {...mark('feeYen')}
            {...(e.feeYen ? { error: e.feeYen } : {})}
          />
        </div>
        <TextField
          id="record-entry-time"
          label="建てた時刻"
          type="datetime-local"
          value={d.entryTime}
          onInput={set('entryTime')}
          {...mark('entryTime')}
          {...(e.entryTime ? { error: e.entryTime } : {})}
        />
        <Segment
          label="LC の根拠"
          value={d.lcBasis}
          onChange={set('lcBasis')}
          options={[
            { value: 'chart', label: 'チャートの根拠' },
            { value: 'amount', label: '金額から' },
          ]}
        />
        <div class="field">
          {marks.exitReason ? (
            <div class="field__head">
              <label class="field__label" for="record-exit-reason">
                決済の理由
              </label>
              <span id="record-exit-reason-mark" class="field__mark">
                {MARK_LABEL[marks.exitReason]}
              </span>
            </div>
          ) : (
            <label class="field__label" for="record-exit-reason">
              決済の理由
            </label>
          )}
          <select
            id="record-exit-reason"
            class="select"
            aria-describedby={marks.exitReason ? 'record-exit-reason-mark' : undefined}
            value={d.exitReason}
            onChange={(ev) =>
              onUpdate({
                type: 'set',
                field: 'exitReason',
                value: ev.currentTarget.value as ExitReason,
              })
            }
          >
            {EXIT_REASONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </details>
  );
}
