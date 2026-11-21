// 取引の欄（記録する画面 #13 と直す画面 #9 が共有する。Issue #9 で Record.tsx から出した。id・クラス・文言・順は同じ）。
// TradeCoreFields = 「取引」の欄（取引の欄のシートの中）、LcFields = LC と一言、TapFields = 3 つのタップ、TradeMoreBody = ほかの欄（任意。
// 取引の欄のシートの次の段）。記録する・編集の画面は 1 画面の形に並べる（#130・#131）。
// 「取引」の並び（#58）: 銘柄 | 数量（通貨が違うときは銘柄だけ・数量は為替と並ぶ）/ L / S / イン | 決済 / エントリーの時刻（任意）| 決済の時刻
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
  FIELD_LABEL,
  type LcMoveKind,
  lcMoveLabel,
  OPTION_LABEL,
  type ReadingOption,
} from '../lib/record-form';
import { MARK_LABEL, type Marks } from '../lib/statement-fill';
import { AccountField } from './AccountField';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';
import { LegList, type NextPosition } from './LegList';
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
  /**
   * 「狭めた = …」の 1 行を出さず、「i」の説明（用語集の lcMove の先頭の文）に任せる（記録する画面の 1 画面の高さ。#130）。
   * 直す画面は今のまま 1 行を出す
   */
  readonly moveHintInInfo?: boolean;
  /** 通貨と為替（#47 PR-2）。省けば円の口座・円建てと同じ（欄も文言も増えない） */
  readonly currency?: CurrencyView;
  /**
   * オプションのポジション（#117。readDraft の option があるときだけ画面が渡す）。渡すと数量の欄を出さず、L / S は自動の向きが
   * 出ないときだけ、イン / 決済 / LC は原資産の言葉、イン | 決済の下にレッグの一覧、LC に「最大損失まで」を出す
   */
  readonly option?: OptionFields;
}

export interface OptionFields {
  readonly reading: ReadingOption;
  /** レッグの行を押した（そのレッグの欄を開く。同時に開くのは 1 本） */
  readonly onOpenLeg: (index: number) => void;
  /** [＋ レッグ]（直前のレッグを写した行を足して開く） */
  readonly onAddLeg: () => void;
  /** 直前に消したレッグの 1 行と ［元に戻す］（P4。省けば出さない） */
  readonly removed?: string | null;
  readonly onUndoRemove?: () => void;
  /** 明細の次のポジションと ［このポジションに入れる］（記録する画面だけ。#118） */
  readonly nextPosition?: NextPosition | null;
  readonly onMergeNext?: () => void;
  /** 一覧の直前の操作の知らせ（［別のポジションにする］ の後。#118） */
  readonly legNotice?: string | null;
}

/** 明細のポジションで足すオプションの銘柄の乗数の欄（#118） */
export const NEW_MULTIPLIER_ID = 'record-new-multiplier';
export const newInstrumentText = (name: string, currency: string) =>
  `「${name}」をオプションの銘柄（価格の通貨 ${currency}）として追加します`;

/** 「最大損失まで」の押す形の名前（C50） */
export const MAX_LOSS_LABEL = '最大損失まで';
export const LOSS_PLAN_LABEL = 'LC での損失の見込み（任意）';
/** 売りの裸で 1R が出ないときに LC の枠へ出した見込みの欄の下の 1 行（オーナーの決定 2026-11-21） */
export const LOSS_PLAN_HINT =
  '売りの裸は 1R が表示されないことがあります。入力すると R とリスクが表示されます';

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
  { value: 'lc', label: 'LC（根拠が崩れる条件に達した）' },
  { value: 'gapSlip', label: '窓・滑り' },
  { value: 'tp', label: 'TP' },
  { value: 'brokeManual', label: '根拠が崩れたので手動で' },
  { value: 'fearEarly', label: '崩れる前に怖くなって' },
  { value: 'timeout', label: '時間切れ' },
  { value: 'other', label: 'その他' },
];

/** LC を動かしたかの 3 択の下の 1 行（どちらに当たるかの手がかり。L / S で同じ。#56 デザインレビュー 4） */
export const LC_MOVE_HINT = '狭めた = インに近づけた、広げた = 遠ざけた';
export const LC_MOVE_HINT_ID = 'record-lc-move-hint';

/** LC を動かしたかの選択肢（L / S で同じ言葉。#56） */
const MOVE_OPTIONS: readonly { value: LcMoveKind; label: string }[] = (
  ['none', 'tightened', 'widened'] as const
).map((k) => ({ value: k, label: lcMoveLabel(k) }));

const TIMEFRAME_OPTIONS: readonly { value: TimeframeChange; label: string }[] = [
  { value: 'none', label: 'そのまま' },
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

/** 「取引」の欄の中身（口座・銘柄 | 数量・L / S・イン | 決済・為替・時刻）。記録する画面は取引の欄のシートに、直す画面は枠に置く */
export function TradeCoreFields(p: TradeFieldsProps) {
  const { d, e, set, mark } = fieldHelpers(p);
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
  const instrument = (
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
  );
  // エントリーの時刻（任意）と決済の時刻を並べる（エントリー → 決済の順。左右はイン / 決済の列とそろう。#58）
  const times = (
    <div class="record__pair">
      <TextField
        id="record-entry-time"
        label={`${FIELD_LABEL.entryTime}（任意）`}
        type="datetime-local"
        value={d.entryTime}
        onInput={set('entryTime')}
        {...mark('entryTime')}
        {...(e.entryTime ? { error: e.entryTime } : {})}
      />
      <TextField
        id="record-exit-time"
        label={FIELD_LABEL.exitTime}
        type="datetime-local"
        value={d.exitTime}
        onInput={set('exitTime')}
        {...mark('exitTime')}
        {...(e.exitTime ? { error: e.exitTime } : {})}
      />
    </div>
  );
  return (
    <>
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
      {/* 銘柄と数量は前の取引から入る既定の値の対なので、幅 360px でも 2 列に並べて画面の全長を詰める（#58。R12）。
        通貨が違っても同じ段に置き、欄の位置を変えない（為替は価格の下に段を足す。#58 デザインレビュー 1） */}
      {p.option ? (
        <>
          {instrument}
          {p.option.reading.newInstrument !== undefined ? (
            // 明細のポジションでオプションの銘柄が一覧に無い: この名前・取引の形態 オプションで足す。乗数は推さない（#118 の B1）
            // 乗数は 2 列の 1 列目（価格と同じ幅）、案内の 1 行は全幅
            <>
              <div class="record__pair record__pair--prices">
                <NumberField
                  id={NEW_MULTIPLIER_ID}
                  label="乗数"
                  value={d.instrumentMultiplier}
                  onInput={set('instrumentMultiplier')}
                  placeholder="例: 1000"
                  describedBy={`${NEW_MULTIPLIER_ID}-what`}
                  {...(e.instrumentMultiplier ? { error: e.instrumentMultiplier } : {})}
                />
              </div>
              <p id={`${NEW_MULTIPLIER_ID}-what`} class="field__hint record__movehint">
                {newInstrumentText(
                  p.option.reading.newInstrument,
                  p.option.reading.newInstrumentCurrency ?? 'JPY',
                )}
              </p>
            </>
          ) : null}
        </>
      ) : (
        <div class="record__pair record__pair--prices">
          {instrument}
          {quantity}
        </div>
      )}
      <datalist id={INSTRUMENT_LIST_ID}>
        {p.instruments.map((i) => (
          <option key={i.id} value={i.name} />
        ))}
      </datalist>
      {p.option && !p.option.reading.askSide ? null : (
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
      )}
      <div class="record__pair record__pair--prices">
        <NumberField
          id="record-entry"
          label={p.option ? OPTION_LABEL.entryPrice : 'イン'}
          size="lg"
          value={d.entryPrice}
          onInput={set('entryPrice')}
          placeholder="0.00"
          {...mark('entryPrice')}
          {...(e.entryPrice ? { error: e.entryPrice } : {})}
        />
        <NumberField
          id="record-exit"
          label={p.option ? OPTION_LABEL.exitPrice : '決済'}
          size="lg"
          value={d.exitPrice}
          onInput={set('exitPrice')}
          placeholder="0.00"
          {...mark('exitPrice')}
          {...(e.exitPrice ? { error: e.exitPrice } : {})}
        />
      </div>
      {fx ? (
        // 通貨が違うときだけ「為替 | 1 USD = ? 円」の段を足す（どの幅でも 2 列。右の 1 行は為替の欄の読み上げの説明）
        <div class="record__pair record__pair--prices">
          <NumberField
            id="record-fx"
            label="為替"
            value={d.fxRate}
            onInput={set('fxRate')}
            unit={fx.unit}
            describedBy={FX_LINE_ID}
            {...(e.fxRate ? { error: e.fxRate } : {})}
          />
          <p id={FX_LINE_ID} class="field__hint record__fxline">
            {fx.line}
          </p>
        </div>
      ) : null}
      {p.option ? (
        <LegList
          legs={d.legs}
          errors={p.option.reading.legErrors}
          onOpen={p.option.onOpenLeg}
          onAdd={p.option.onAddLeg}
          removed={p.option.removed ?? null}
          {...(p.option.onUndoRemove ? { onUndo: p.option.onUndoRemove } : {})}
          {...(p.option.nextPosition ? { nextPosition: p.option.nextPosition } : {})}
          {...(p.option.onMergeNext ? { onMergeNext: p.option.onMergeNext } : {})}
          {...(p.option.legNotice ? { notice: p.option.legNotice } : {})}
          {...(e.legs ? { error: e.legs } : {})}
        />
      ) : null}
      {times}
    </>
  );
}

/** 入る前に決めた LC（+ なし。オプションは + 最大損失まで・見込み）と崩れの条件の一言 */
export function LcFields(p: TradeFieldsProps) {
  const { d, e, set, onUpdate } = fieldHelpers(p);
  const o = p.option;
  // 「最大損失まで」は最大損失が定まるときだけ出す（選んだ後にレッグを変えて定まらなくなっても、外せるよう出したまま）
  const maxLossShown = o !== undefined && (o.reading.maxLossSelectable || d.lcMaxLoss);
  const maxLossOn = o !== undefined && d.lcMaxLoss;
  return (
    <>
      <div class="lcrow">
        <NumberField
          id="record-lc"
          label={o ? '入る前に決めた LC（原資産）' : '入る前に決めた LC'}
          size="lg"
          value={d.lc}
          onInput={set('lc')}
          disabled={d.lcNone || maxLossOn}
          placeholder={d.lcNone ? 'なし' : maxLossOn ? MAX_LOSS_LABEL : '0.00'}
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
      {maxLossShown ? (
        <div class="lcmaxloss">
          <button
            type="button"
            class="lcnone lcmaxloss__toggle"
            id="record-lc-maxloss"
            aria-pressed={maxLossOn ? 'true' : 'false'}
            onClick={() => onUpdate({ type: 'set', field: 'lcMaxLoss', value: !maxLossOn })}
          >
            {maxLossOn ? <Icon name="check" /> : null}
            <span>{MAX_LOSS_LABEL}</span>
          </button>
          <InfoTip term="maxLoss" size="sm" />
        </div>
      ) : null}
      {o?.reading.lossPlanUp && !maxLossOn ? <LossPlanField {...p} hint={LOSS_PLAN_HINT} /> : null}
      <TextField
        id="record-broken"
        label="根拠が崩れる条件（任意）"
        value={d.brokenCondition}
        onInput={set('brokenCondition')}
        placeholder="例: 押し目の安値を割ったら"
        {...(e.brokenCondition ? { error: e.brokenCondition } : {})}
      />
    </>
  );
}

/** LC での損失の見込み（任意。K15。口座の通貨） */
export function LossPlanField(p: TradeFieldsProps & { readonly hint?: string }) {
  const { d, e, set } = fieldHelpers(p);
  return (
    <NumberField
      id="record-loss-plan"
      label={LOSS_PLAN_LABEL}
      value={d.lcLossPlan}
      onInput={set('lcLossPlan')}
      unit={p.currency?.moneyUnit ?? '円'}
      {...(p.hint ? { hint: p.hint } : {})}
      {...(e.lcLossPlan ? { error: e.lcLossPlan } : {})}
    />
  );
}

/** 決済までの行動の 3 つのタップ（LC なしの注記・広げた後の LC・チャートとの食い違いの 1 行） */
export function TapFields(p: TradeFieldsProps) {
  const { d, e, set, mark, onUpdate } = fieldHelpers(p);
  return (
    <>
      {d.lcNone ? (
        <p class="section__note">LC が無いため、「決めていない」「そのまま」として記録します。</p>
      ) : (
        <>
          <Segment
            label="LC を入る前に決めていたか"
            id="record-lc-decided"
            info={<InfoTip term="lcDecided" prefer="above" />}
            {...mark('lcDecided')}
            value={d.lcDecided === null ? null : d.lcDecided ? 'yes' : 'no'}
            onChange={(v) => onUpdate({ type: 'set', field: 'lcDecided', value: v === 'yes' })}
            options={[
              { value: 'yes', label: '決めていた' },
              { value: 'no', label: '決めていない' },
            ]}
          />
          {/* 「最大損失まで」は LC を動かしたかを聞かない（5.7 の 5。本文は none。#114 の 1） */}
          {p.option && d.lcMaxLoss ? null : (
            <>
              <Segment
                label="LC を動かしたか"
                info={<InfoTip term="lcMove" prefer="above" />}
                value={d.lcMove}
                onChange={set('lcMove')}
                options={MOVE_OPTIONS}
                {...(p.moveHintInInfo ? {} : { describedBy: LC_MOVE_HINT_ID })}
              />
              {p.moveHintInInfo ? null : (
                <p id={LC_MOVE_HINT_ID} class="field__hint record__movehint">
                  {LC_MOVE_HINT}
                </p>
              )}
            </>
          )}
          {d.lcMove === 'widened' && !(p.option && d.lcMaxLoss) ? (
            <NumberField
              id="record-lc-after"
              label={`${FIELD_LABEL.lcAfter}（任意）`}
              value={d.lcAfter}
              onInput={set('lcAfter')}
              {...(e.lcAfter ? { error: e.lcAfter } : {})}
            />
          ) : null}
        </>
      )}
      <Segment
        label="時間足を変えたか"
        info={<InfoTip term="timeframeChange" prefer="above" />}
        value={d.timeframeChange}
        onChange={set('timeframeChange')}
        options={TIMEFRAME_OPTIONS}
      />
      {p.timeframeHint ? <p class="field__hint">{p.timeframeHint}</p> : null}
    </>
  );
}

/** ほかの欄（任意）の中身（損益・手数料・LC の根拠・決済の理由）。記録する画面は取引の欄のシートの次の段に置く（#130） */
export function TradeMoreBody(p: TradeFieldsProps) {
  const { d, e, set, mark, onUpdate, marks } = fieldHelpers(p);
  const unit = p.currency?.moneyUnit ?? '円';
  const note = p.currency?.moneyNote;
  return (
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
      {/* LC での損失の見込み（K15。売りの裸で 1R が出ないときは LC の枠に出す。「最大損失まで」とは同時に持たない） */}
      {p.option && !p.option.reading.lossPlanUp && !d.lcMaxLoss ? <LossPlanField {...p} /> : null}
      <Segment
        label="LC の根拠"
        value={d.lcBasis}
        onChange={set('lcBasis')}
        options={[
          { value: 'chart', label: 'チャート' },
          { value: 'amount', label: '金額' },
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
  );
}
