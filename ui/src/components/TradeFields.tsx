// 取引の欄（記録する画面 #13 と直す画面 #9 が共有する。Issue #9 で Record.tsx から出した。id・クラス・文言・順は同じ）。
// TradeMainFields = 「取引」「LC」「3 つのタップ」の 3 つの枠、TradeMoreFields = 畳んだ「ほかの欄（任意）」。
// hook を持たない（テストは関数を呼んで木にする）。値はテキストのノードだけ（HTML の文字列を DOM に入れない）
// 口座（#47）: 「取引」の先頭（銘柄の上）に口座の欄（口座が 2 つ以上のとき）。記録する画面は見出しの行の右端に
// [＋ 口座を足す]（accountAction）と、開いたときの 2 欄（accountAdd。開いている間は口座の欄を隠す）を渡す
// 通貨と為替（#47 PR-2・U22〜U28・U33）: 銘柄の下の 1 行（建ての通貨）、通貨が違うときだけ「数量 | 為替」の 2 列と、
// その下に通しの 1 行（1 USD = ? 円）。「ほかの欄」の損益・手数料の単位は口座の通貨、その下に注記（外貨の口座・付け替え）
import type { ComponentChildren } from 'preact';
import type { AccountRecord, InstrumentRecord } from '../../../core/record';
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
import { AccountField } from './AccountField';
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
  /** 口座（名前の順。#47。2 つ以上で欄を出す） */
  readonly accounts?: readonly AccountRecord[];
  /** 選んでいる口座の ID（空の下書きは既定の口座 / 元の口座に読み替えた値） */
  readonly accountId?: string;
  /** 口座の欄の下の 1 行（直す画面で口座を替えたとき。U19） */
  readonly accountHint?: string | null;
  /** 「取引」の見出しの行の右端（記録する画面の [＋ 口座を足す]） */
  readonly accountAction?: ComponentChildren;
  /** 見出しの下に開く口座を足す欄（開いている間は口座の欄を隠す） */
  readonly accountAdd?: ComponentChildren;
  /** 3 つ目のタップの下に添える 1 行（チャートの時間足の違いと食い違うとき。記録する画面だけ。#27） */
  readonly timeframeHint?: string | null;
  /** 通貨と為替（#47 PR-2）。省けば円の口座・円建てと同じ（欄も文言も増えない） */
  readonly currency?: CurrencyView;
}

/** 通貨と為替の見せ方（画面が lib/currency.ts の純関数で作る） */
export interface CurrencyView {
  /** 銘柄の下の 1 行（「USD 建て」「価格の通貨 未設定」。U22） */
  readonly instrumentHint?: string;
  /** 為替の欄（通貨が違うときだけ。unit = 口座の通貨の単位、line = 欄の下の 1 行。U23・U24） */
  readonly fx?: { readonly unit: string; readonly line: string };
  /** 損益・手数料の単位（「円」/「USD」。U27） */
  readonly moneyUnit: string;
  /** 損益・手数料の下の 1 行（明細の損益の通貨が口座と合わない・読めない（#66・R6）・通貨の違う口座へ替えた。U33） */
  readonly moneyNote?: string;
}

/** 為替の欄の下の 1 行の ID（為替の欄の読み上げの説明） */
export const FX_LINE_ID = 'record-fx-line';

export const INSTRUMENT_LIST_ID = 'record-instruments';
/** 損益・手数料の下の 1 行の ID */
export const MONEY_NOTE_ID = 'record-money-note';

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
  const fx = p.currency?.fx;
  const quantity = (
    <NumberField
      id="record-quantity"
      label="数量"
      value={d.quantity}
      onInput={set('quantity')}
      {...mark('quantity')}
      {...(e.quantity ? { error: e.quantity } : {})}
    />
  );
  const exitTime = (
    <TextField
      id="record-exit-time"
      label="決済の時刻"
      type="datetime-local"
      value={d.exitTime}
      onInput={set('exitTime')}
      {...mark('exitTime')}
      {...(e.exitTime ? { error: e.exitTime } : {})}
    />
  );
  return (
    <>
      <section class="card section" aria-labelledby="record-trade-title">
        {p.accountAction ? (
          <div class="section__head">
            <h2 class="section__title" id="record-trade-title">
              取引
            </h2>
            {p.accountAction}
          </div>
        ) : (
          <h2 class="section__title" id="record-trade-title">
            取引
          </h2>
        )}
        {p.accountAdd ? (
          p.accountAdd
        ) : p.accounts && p.accountId !== undefined ? (
          <AccountField
            accounts={p.accounts}
            value={p.accountId}
            onChange={set('accountId')}
            {...(p.accountHint ? { hint: p.accountHint } : {})}
            {...mark('accountId')}
          />
        ) : null}
        <TextField
          id="record-instrument"
          label="銘柄"
          value={d.instrumentName}
          onInput={set('instrumentName')}
          list={INSTRUMENT_LIST_ID}
          placeholder="例: 架空指数A"
          {...(p.currency?.instrumentHint ? { hint: p.currency.instrumentHint } : {})}
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
        {fx ? (
          <>
            {/* 通貨が違うときだけ「数量 | 為替」の 2 列（どの幅でも 2 列）、その下に通しの 1 行、決済の時刻は 1 列 */}
            <div class="record__pair record__pair--prices">
              {quantity}
              <NumberField
                id="record-fx"
                label="為替"
                value={d.fxRate}
                onInput={set('fxRate')}
                unit={fx.unit}
                describedBy={FX_LINE_ID}
                {...(e.fxRate ? { error: e.fxRate } : {})}
              />
            </div>
            <p id={FX_LINE_ID} class="field__hint record__pairnote">
              {fx.line}
            </p>
            {exitTime}
          </>
        ) : (
          <div class="record__pair">
            {quantity}
            {exitTime}
          </div>
        )}
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
        {p.timeframeHint ? <p class="field__hint">{p.timeframeHint}</p> : null}
      </section>
    </>
  );
}

/** 畳んだ「ほかの欄（任意）」（open = 開いて見せる: 誤りがある・読み取りの値がある） */
export function TradeMoreFields(p: TradeFieldsProps & { readonly open: boolean }) {
  const { d, e, set, mark, onUpdate, marks } = fieldHelpers(p);
  const unit = p.currency?.moneyUnit ?? '円';
  const note = p.currency?.moneyNote;
  return (
    <details class="card more" {...(p.open ? { open: true } : {})}>
      <summary class="more__summary">ほかの欄（任意）</summary>
      <div class="more__body">
        <div class="record__pair">
          <NumberField
            id="record-pnl"
            label="損益（明細の値）"
            inputMode="text"
            value={d.pnlYen}
            onInput={set('pnlYen')}
            unit={unit}
            {...(note ? { describedBy: MONEY_NOTE_ID } : {})}
            {...mark('pnlYen')}
            {...(e.pnlYen ? { error: e.pnlYen } : {})}
          />
          <NumberField
            id="record-fee"
            label="手数料"
            value={d.feeYen}
            onInput={set('feeYen')}
            unit={unit}
            {...(note ? { describedBy: MONEY_NOTE_ID } : {})}
            {...mark('feeYen')}
            {...(e.feeYen ? { error: e.feeYen } : {})}
          />
        </div>
        {note ? (
          <p id={MONEY_NOTE_ID} class="field__hint record__pairnote">
            {note}
          </p>
        ) : null}
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
