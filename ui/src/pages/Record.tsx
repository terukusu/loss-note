// 記録する（Issue #13。手で入れて記録する。設計書 7.5 の流れ 3〜7・9.2、契約 R-4）。
// 3 層: 純関数（lib/record-form.ts）→ 通信と状態（lib/record-controller.ts）→ この画面（薄い）。
// Record は hook を持たない（App のテストが 1 段だけ呼ぶ）。RecordScreen が controller を購読し、
// 描画は hook を持たない RecordView に任せる（状態と操作の関数を受けて描くだけ。テストで直接呼べる）。
// 判定・R は core/ の結果だけを出す。色は判定の段（バッジと結果の枠）だけ、数字は無色（C34）
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Grade } from '../../../core/judge';
import type { ExitReason, Side, TimeframeChange } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { JudgeBadge } from '../components/JudgeBadge';
import { RNum, YenNum } from '../components/Num';
import { NumberField } from '../components/NumberField';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import { TextField } from '../components/TextField';
import { badgeModel } from '../lib/badge';
import { formatPct, formatPrice } from '../lib/format';
import { reasonText } from '../lib/reasons';
import {
  createRecordController,
  type RecordController,
  type RecordState,
} from '../lib/record-controller';
import {
  type DraftAction,
  FIELD_LABEL,
  type LcMoveKind,
  lcMoveLabel,
  OPTIONAL_FIELDS,
  type Preview,
  type Summary,
} from '../lib/record-form';

export function Record() {
  return (
    <>
      <PageHeader
        title="記録する"
        description="決済の後に 1 回だけ。打つ数字はイン・決済・LC、あとは 3 つのタップで判定が出ます。"
      />
      <RecordScreen />
    </>
  );
}

/** controller を作って購読する（画面を開くたびに作り直す。下書きは画面を離れると消える） */
export function RecordScreen() {
  const controller = useMemo<RecordController>(
    () => createRecordController({ api, now: () => Date.now() }),
    [],
  );
  const [state, setState] = useState<RecordState>(controller.getState());
  const prevPhase = useRef(state.phase);

  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);

  // 保存した直後は結果の見出しへ、次の取引へ戻ったら最初の欄へフォーカスを移す（読み上げ・キーで迷わない）
  useEffect(() => {
    const before = prevPhase.current;
    prevPhase.current = state.phase;
    if (before === state.phase) return;
    if (state.phase === 'saved') {
      document.getElementById(VERDICT_TITLE_ID)?.focus();
      window.scrollTo({ top: 0 });
    } else if (before === 'saved' && state.phase === 'editing') {
      window.scrollTo({ top: 0 });
      document.getElementById(FIRST_FIELD_ID)?.focus({ preventScroll: true });
    }
  }, [state.phase]);

  return (
    <RecordView
      state={state}
      onUpdate={controller.update}
      onSave={() => {
        void controller.save();
      }}
      onNext={controller.next}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        // ログアウトすると門がログイン画面へ置き換える（戻り先はこの画面）
        void signOutActive();
      }}
    />
  );
}

export interface RecordViewProps {
  readonly state: RecordState;
  readonly onUpdate: (action: DraftAction) => void;
  readonly onSave: () => void;
  readonly onNext: () => void;
  readonly onReload: () => void;
  /** ログインが切れたとき: ログインし直す */
  readonly onRelogin: () => void;
}

const FIRST_FIELD_ID = 'record-instrument';
const VERDICT_TITLE_ID = 'record-verdict-title';
const INSTRUMENT_LIST_ID = 'record-instruments';

const EXIT_REASONS: readonly { value: ExitReason; label: string }[] = [
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

/** 判定ごとの添え書き（危ない勝ちは負けと同じくらい目立たせる。設計書 5.4） */
const GRADE_LEAD: Partial<Record<Grade, string>> = {
  riskyWin: '勝っても、規律は崩れています。',
  C: 'LC を決めずに入った取引です。',
};

export function RecordView(p: RecordViewProps) {
  const { state } = p;
  if (state.phase === 'loading') {
    return (
      <p class="loading" role="status">
        読み込み中…
      </p>
    );
  }
  if (state.phase === 'loadFailed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {state.error}
        </p>
        <div>
          {state.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              ログインし直す
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              もう一度読み込む
            </Button>
          )}
        </div>
      </section>
    );
  }
  if (state.phase === 'saved' && state.saved) return <SavedPanel {...p} />;
  return <RecordForm {...p} />;
}

function SavedPanel(p: RecordViewProps) {
  const saved = p.state.saved;
  if (!saved) return null;
  const r = saved.trade.record;
  const entry = r.entries[0];
  return (
    <div class="record">
      <Verdict
        summary={saved.summary}
        side={r.side}
        status="記録しました"
        caption={`${saved.instrumentName} · ${r.side === 'L' ? 'L ロング' : 'S ショート'} · イン ${formatPrice(entry.price)} → 決済 ${formatPrice(r.exit.price)} · 数量 ${formatPrice(entry.quantity)}`}
      />
      <div class="record__submit">
        <Button size="lg" block icon="record" onClick={p.onNext}>
          次の取引を記録
        </Button>
      </div>
    </div>
  );
}

function RecordForm(p: RecordViewProps) {
  const { state, onUpdate } = p;
  const d = state.draft;
  const read = state.read;
  const e = read.errors;
  const saving = state.phase === 'saving';
  const side: Side | null = d.side;
  const set =
    <K extends keyof typeof d>(field: K) =>
    (value: (typeof d)[K]) =>
      onUpdate({ type: 'set', field, value } as DraftAction);
  const moveOptions: readonly { value: LcMoveKind; label: string }[] = (
    ['none', 'tightened', 'widened'] as const
  ).map((k) => ({ value: k, label: lcMoveLabel(k, side) }));
  const widenWord = side === 'S' ? '上げた' : '下げた';
  const errorFields = (Object.keys(e) as (keyof typeof e)[]).filter((k) => e[k] !== undefined);
  const errorLabels = [...new Set(errorFields.map((k) => FIELD_LABEL[k]))];
  // 畳んだ「ほかの欄」に誤りがあれば開いて見せる
  const optionalError = errorFields.some((k) => OPTIONAL_FIELDS.includes(k));

  return (
    <form
      class="record"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        p.onSave();
      }}
    >
      <fieldset class="record__fields" disabled={saving}>
        <legend class="sr-only">取引の記録</legend>

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
            {...(e.instrumentName ? { error: e.instrumentName } : {})}
          />
          <datalist id={INSTRUMENT_LIST_ID}>
            {state.instruments.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
          <Segment
            label="L / S"
            value={d.side}
            onChange={set('side')}
            options={[
              { value: 'L', label: 'L ロング' },
              { value: 'S', label: 'S ショート' },
            ]}
          />
          <div class="record__pair">
            <NumberField
              id="record-entry"
              label="イン"
              size="lg"
              value={d.entryPrice}
              onInput={set('entryPrice')}
              placeholder="0.00"
              {...(e.entryPrice ? { error: e.entryPrice } : {})}
            />
            <NumberField
              id="record-exit"
              label="決済"
              size="lg"
              value={d.exitPrice}
              onInput={set('exitPrice')}
              placeholder="0.00"
              {...(e.exitPrice ? { error: e.exitPrice } : {})}
            />
          </div>
          <div class="record__pair">
            <NumberField
              id="record-quantity"
              label="数量"
              value={d.quantity}
              onInput={set('quantity')}
              {...(e.quantity ? { error: e.quantity } : {})}
            />
            <TextField
              id="record-exit-time"
              label="決済の時刻"
              type="datetime-local"
              value={d.exitTime}
              onInput={set('exitTime')}
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
            3 つのタップ
          </h2>
          {d.lcNone ? (
            <p class="section__note">
              LC なしなので「LC を決めていなかった」「動かしていない」で記録します。
            </p>
          ) : (
            <>
              <Segment
                label="LC を入る前に決めていたか"
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

        <Verdict
          summary={read.preview}
          side={side ?? 'L'}
          gapSlip={
            read.preview.showGapSlip ? (
              <Segment
                label="窓・滑りでしたか"
                value={d.gapSlip === 'unanswered' ? null : d.gapSlip}
                onChange={set('gapSlip')}
                options={[
                  { value: 'yes', label: 'はい' },
                  { value: 'no', label: 'いいえ' },
                ]}
              />
            ) : null
          }
          pending={read.preview.judgment === undefined}
          hasErrors={errorFields.length > 0}
        />

        <details class="card more" {...(optionalError ? { open: true } : {})}>
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
                {...(e.pnlYen ? { error: e.pnlYen } : {})}
              />
              <NumberField
                id="record-fee"
                label="手数料（円）"
                value={d.feeYen}
                onInput={set('feeYen')}
                unit="円"
                {...(e.feeYen ? { error: e.feeYen } : {})}
              />
            </div>
            <TextField
              id="record-entry-time"
              label="建てた時刻"
              type="datetime-local"
              value={d.entryTime}
              onInput={set('entryTime')}
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
              <label class="field__label" for="record-exit-reason">
                決済の理由
              </label>
              <select
                id="record-exit-reason"
                class="select"
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
      </fieldset>

      <div class="record__submit">
        {state.error ? (
          <div class="notice notice--error" role="alert">
            <p>{state.error}</p>
            {state.errorKind === 'auth' ? (
              <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
                ログインし直す
              </Button>
            ) : null}
          </div>
        ) : null}
        <p class="record__missing" aria-live="polite">
          {[
            errorLabels.length > 0 ? `誤りのある欄: ${errorLabels.join('・')}` : '',
            read.missing.length > 0 ? `足りない欄: ${read.missing.join('・')}` : '',
          ]
            .filter(Boolean)
            .join(' / ')}
        </p>
        <Button type="submit" size="lg" block icon="record" disabled={!read.canSave || saving}>
          {saving ? '記録しています…' : '記録する'}
        </Button>
      </div>
    </form>
  );
}

interface VerdictProps {
  readonly summary: Summary | Preview;
  readonly side: Side;
  /** 保存の後の知らせ（「記録しました」） */
  readonly status?: string;
  readonly caption?: string;
  readonly gapSlip?: ComponentChildren;
  /** 判定がまだ出ていない（足りない欄・誤りがある） */
  readonly pending?: boolean;
  /** 入力に誤りがある（案内の文を変える） */
  readonly hasErrors?: boolean;
}

/** 判定・理由・R・リスクの枠。枠の色は判定の段だけ、数字は無色 */
function Verdict(v: VerdictProps) {
  const j = v.summary.judgment;
  const tier = badgeModel(j?.grade ?? null).tier;
  const lead = j ? GRADE_LEAD[j.grade] : undefined;
  const waiting = v.hasErrors ? '誤りを直すと出ます' : 'イン・決済・LC で出ます';
  const rNote = v.summary.noLc ? 'LC が無いので出ません' : waiting;
  const riskNote = v.summary.riskNote ?? waiting;
  return (
    <section
      class={`card verdict verdict--${tier}${v.status ? ' verdict--saved' : ''}`}
      aria-labelledby={VERDICT_TITLE_ID}
    >
      {v.status ? (
        <p class="verdict__status" role="status">
          <Icon name="check" />
          <span>{v.status}</span>
        </p>
      ) : null}
      <div class="verdict__head">
        <h2 class="verdict__title" id={VERDICT_TITLE_ID} tabIndex={-1}>
          判定
        </h2>
        <JudgeBadge grade={j?.grade ?? null} size="lg" />
      </div>
      {lead ? <p class="verdict__lead">{lead}</p> : null}
      <dl class="verdict__stats">
        <div class="verdict__stat">
          <dt class="verdict__label">R</dt>
          <dd>
            {v.summary.r !== undefined ? (
              <RNum value={v.summary.r} size="xl" />
            ) : (
              <span class="verdict__note">{rNote}</span>
            )}
          </dd>
        </div>
        <div class="verdict__stat">
          <dt class="verdict__label">リスク</dt>
          <dd>
            {v.summary.riskPct !== undefined ? (
              <span class="num num--lg">{formatPct(v.summary.riskPct)}</span>
            ) : (
              <span class="verdict__note">{riskNote}</span>
            )}
          </dd>
        </div>
        {v.summary.pnlYen !== undefined ? (
          <div class="verdict__stat">
            <dt class="verdict__label">損益</dt>
            <dd>
              <YenNum value={v.summary.pnlYen} size="lg" />
            </dd>
          </div>
        ) : null}
      </dl>
      {j ? (
        <ul class="reasons" aria-label="理由">
          {j.reasons.map((r, i) => (
            <li key={`${r.kind}-${i}`} class="reasons__item">
              {reasonText(r, v.side)}
            </li>
          ))}
        </ul>
      ) : v.pending ? (
        <p class="verdict__hint">
          {v.hasErrors
            ? '誤りのある欄を直すと、判定と理由が出ます。'
            : '足りない欄をそろえると、判定と理由が出ます。'}
        </p>
      ) : null}
      {v.gapSlip ? <div class="verdict__ask">{v.gapSlip}</div> : null}
      {v.caption ? <p class="verdict__caption">{v.caption}</p> : null}
    </section>
  );
}
