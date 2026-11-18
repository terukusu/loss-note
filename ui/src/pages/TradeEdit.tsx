// 取引を直す（Issue #9 契約 U-3。設計書 C36・4 章の冒頭・7.5）: 記録する画面と同じ欄（TradeFields）と判定の枠（Verdict）を、
// 保存した値が入った状態で出す。直している間も判定・理由・R・リスク（%）はその場で出直し、資金・許容リスクは取引に写した値で
// 計算する（今の設定を使わない）。明細の枠は出さず、チャートは変えない（チャートのある枠の時間足だけを選び直せる）。
// チャートの無い枠に記録された時間足は保存で外し、その旨を判定の枠の上に出す。保存できたら詳細へ置き換える。
// TradeEdit は hook を持たない。「見つかりません」の面は詳細と同じ
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { accountIdOf, DEFAULT_ACCOUNT_ID } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import { TradeMainFields, TradeMoreFields } from '../components/TradeFields';
import { Verdict } from '../components/Verdict';
import { findAccount, selectedAccountId, switchHint } from '../lib/accounts';

import {
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  isTimeframe,
  TIMEFRAME_CHOICES,
} from '../lib/charts';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { createEditController, type EditState } from '../lib/edit-controller';
import { changeText } from '../lib/edit-form';
import { TIMEFRAME_NAME } from '../lib/reasons';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS } from '../lib/record-form';
import { NavigatorContext } from '../lib/router';
import { notFoundState } from './TradeDetail';
import { LoadState } from './Trades';

export function TradeEdit({ id }: { readonly id: string }) {
  return (
    <>
      <PageHeader
        title="取引を直す"
        description="資金・許容リスクは記録したときの値で計算します。チャートは記録したときのままです（時間足だけ選び直せます）。"
      />
      <TradeEditScreen id={id} notFound={notFoundState()} />
    </>
  );
}

const SUBMIT_ID = 'edit-submit';

function TradeEditScreen({
  id,
  notFound,
}: {
  readonly id: string;
  readonly notFound: JSX.Element;
}) {
  const controller = useMemo(() => createEditController({ api, id }), [id]);
  const [state, setState] = useState<EditState>(controller.getState());
  const del = useContext(DeletionsContext);
  const nav = useContext(NavigatorContext);
  const prev = useRef(state.phase);
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    const before = prev.current;
    prev.current = state.phase;
    if (state.phase === 'saved') {
      // 保存できたら詳細へ（戻るで直しの画面に戻らない）
      nav?.replace(`/trades/${id}`);
    } else if (before === 'saving' && state.phase === 'editing' && state.error) {
      // 保存に失敗して戻った: 押した [保存する] へフォーカスを戻す（失敗の文言は role="alert"）
      document.getElementById(SUBMIT_ID)?.focus();
    }
  }, [state.phase, state.error, id, nav]);
  return (
    <TradeEditView
      id={id}
      state={state}
      hidden={del?.state.hidden ?? NO_HIDDEN}
      notFound={notFound}
      onUpdate={controller.update}
      onSave={() => {
        void controller.save();
      }}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
    />
  );
}

export interface TradeEditViewProps {
  readonly id: string;
  readonly state: EditState;
  readonly hidden: ReadonlySet<string>;
  readonly notFound: JSX.Element;
  readonly onUpdate: (action: DraftAction) => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** チャートの無い枠の時間足を外す旨（D7） */
export function orphanNotice(state: Pick<EditState, 'orphans'>): string | null {
  if (state.orphans.length === 0) return null;
  const list = state.orphans
    .map((o) => `${CHART_SLOT_TEXT[o.slot].name}: ${TIMEFRAME_NAME[o.timeframe]}`)
    .join('・');
  return `チャートの無い枠の時間足（${list}）は、保存のときに外します。チャートが無いと時間足の違いを確かめられないためです。`;
}

/** 直すの欄・判定の枠・[保存する]（hook を持たない） */
export function TradeEditView(p: TradeEditViewProps) {
  const { state } = p;
  if (p.hidden.has(p.id) || state.phase === 'notFound') return p.notFound;
  if (state.phase === 'blocked') {
    return (
      <section class="card section">
        <p class="section__note">{state.block}</p>
        <div>
          <Button href={`/trades/${p.id}`} variant="secondary" icon="back">
            詳細へ戻る
          </Button>
        </div>
      </section>
    );
  }
  if (state.phase === 'loading' || state.phase === 'loadFailed') {
    return <LoadState state={state} onReload={p.onReload} onRelogin={p.onRelogin} />;
  }
  const d = state.draft;
  const read = state.read;
  const e = read.errors;
  const saving = state.phase === 'saving' || state.phase === 'saved';
  const errorFields = (Object.keys(e) as (keyof typeof e)[]).filter((k) => e[k] !== undefined);
  const errorLabels = [...new Set(errorFields.map((k) => FIELD_LABEL[k]))];
  const optionalError = errorFields.some((k) => OPTIONAL_FIELDS.includes(k));
  const charts = CHART_SLOTS.filter((slot) => state.trade?.charts?.[slot] !== undefined);
  const notice = orphanNotice(state);
  // 口座（#47）: 開いたときは取引の口座（付いていない取引は既定の口座）。替えたら欄の下に 1 行（U19）
  const original = state.trade ? accountIdOf(state.trade.record) : DEFAULT_ACCOUNT_ID;
  const accountId = selectedAccountId(d.accountId, original);
  const accountHint = switchHint(findAccount(accountId, state.accounts), accountId !== original);
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
        <legend class="sr-only">取引を直す</legend>
        <TradeMainFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={{}}
          onUpdate={p.onUpdate}
          accounts={state.accounts}
          accountId={accountId}
          accountHint={accountHint}
        />
        {charts.length > 0 ? (
          <section class="card section" aria-labelledby="edit-charts-title">
            <h2 class="section__title" id="edit-charts-title">
              根拠の足のチャートの時間足
            </h2>
            <p class="section__note">チャートは直すでは変えません。時間足だけを選び直せます。</p>
            {charts.map((slot) => {
              const field = CHART_TIMEFRAME_FIELD[slot];
              const fid = `edit-chart-${slot}-tf`;
              return (
                <div key={slot} class="field">
                  <label class="field__label" for={fid}>
                    {CHART_SLOT_TEXT[slot].name}のチャートの時間足（任意）
                  </label>
                  <select
                    id={fid}
                    class="select"
                    value={d[field] ?? ''}
                    onChange={(ev) => {
                      const v = ev.currentTarget.value;
                      p.onUpdate({ type: 'set', field, value: isTimeframe(v) ? v : null });
                    }}
                  >
                    <option value="">選ばない</option>
                    {TIMEFRAME_CHOICES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </section>
        ) : null}
        {notice ? (
          <p class="notice edit__orphans" id="edit-orphans">
            {notice}
          </p>
        ) : null}
        <Verdict
          summary={state.preview}
          side={d.side ?? 'L'}
          gapSlip={
            state.preview.showGapSlip ? (
              <Segment
                label="窓・滑りでしたか"
                value={d.gapSlip === 'unanswered' ? null : d.gapSlip}
                onChange={(v) => p.onUpdate({ type: 'set', field: 'gapSlip', value: v })}
                options={[
                  { value: 'yes', label: 'はい' },
                  { value: 'no', label: 'いいえ' },
                ]}
              />
            ) : null
          }
          pending={state.preview.judgment === undefined}
          hasErrors={errorFields.length > 0}
          before={state.before}
        />
        <TradeMoreFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={{}}
          onUpdate={p.onUpdate}
          open={optionalError}
        />
      </fieldset>

      <div class="record__submit edit__submit">
        <p class="edit__change" id="edit-change" aria-live="polite">
          {changeText(state.before, state.preview)}
        </p>
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
        <Button
          type="submit"
          id={SUBMIT_ID}
          size="lg"
          block
          icon="check"
          disabled={!read.canSave || saving}
        >
          {saving ? '保存しています…' : '保存する'}
        </Button>
        <Button href={`/trades/${p.id}`} variant="ghost" icon="back" block>
          やめる
        </Button>
      </div>
    </form>
  );
}
