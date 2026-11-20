// 取引を編集（Issue #9 契約 U-3。設計書 C36・4 章の冒頭・7.5）: 記録する画面と同じ欄（TradeFields）と判定の枠（Verdict）を、
// 保存した値が入った状態で出す。直している間も判定・理由・R・リスク（%）はその場で出直し、資金・許容リスクは取引に写した値で
// 計算する（今の設定を使わない）。明細の枠は出さない。チャート（#89）は記録する画面と同じ枠（ChartPanel）で
// 追加・差し替え・削除・付属の枠ができ、[保存する] で取引と一緒に 1 要求で保存する（[キャンセル] で捨てる。変更があれば
// トーストの [元に戻す] で戻せる。画面を移っても変更は書きかけの置き場に残る。#75）。
// チャートの無い枠に記録された時間足は保存で外し、その旨を判定の枠の上に出す。保存できたら詳細へ置き換える。
// TradeEdit は hook を持たない。「見つかりません」の面は詳細と同じ
import type { JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { accountIdOf, DEFAULT_ACCOUNT_ID } from '../../../core/record';
import type { Timeframe } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import { SheetBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { addExtraId, ChartPanel, chartBoxId, restoreId } from '../components/ChartPanel';
import { ResnapshotPanel } from '../components/Resnapshot';
import { Segment } from '../components/Segment';
import { TradeMainFields, TradeMoreFields } from '../components/TradeFields';
import { Verdict } from '../components/Verdict';
import { findAccount, selectedAccountId, switchHint } from '../lib/accounts';
import { chartChangeCount, keptReadingSlots, keptReadingText } from '../lib/chart-slots';

import {
  type AnySlot,
  CHART_SLOT_TEXT,
  CHART_TIMEFRAME_FIELD,
  chartSlotOf,
  type ExtraSlot,
  isMainSlot,
} from '../lib/charts';
import { CURRENCY_CLEARED_NOTE, CURRENCY_FX_CLEARED_NOTE, currencyView } from '../lib/currency';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import { editDraftImages, editDraftLabel, editDraftStatus, resumedNote } from '../lib/draft-status';
import { editKey } from '../lib/drafts';
import { DraftsContext } from '../lib/drafts-context';
import { createEditController, type EditController, type EditState } from '../lib/edit-controller';
import { bandText, changeText } from '../lib/edit-form';
import { TIMEFRAME_NAME } from '../lib/reasons';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS } from '../lib/record-form';
import { BAR_PREFIX, CHOICE_NAME, RESNAPSHOT_LABEL } from '../lib/resnapshot';
import { NavigatorContext } from '../lib/router';
import { imageFileFromClipboard, type PasteTarget } from '../lib/statement-fill';
import { browserCodec, prepareImage } from '../lib/statement-image';
import { notFoundState } from './TradeDetail';
import { LoadState } from './Trades';

export function TradeEdit({ id }: { readonly id: string }) {
  return <TradeEditScreen id={id} notFound={notFoundState()} />;
}

const SUBMIT_ID = 'edit-submit';

function TradeEditScreen({
  id,
  notFound,
}: {
  readonly id: string;
  readonly notFound: JSX.Element;
}) {
  // 書きかけの置き場（#75）から取引ごとに借りる。変更があるまま離れた書きかけは残り、戻ると借り直す（読み込み直さない）
  const drafts = useContext(DraftsContext);
  const store = drafts?.drafts;
  const { controller, restored, resumedAt } = useMemo(() => {
    const create = () =>
      createEditController({
        api,
        id,
        prepare: (file) => prepareImage(file, browserCodec),
        preview: (bytes, type) => browserCodec.preview(bytes, type),
      });
    if (!store) return { controller: create(), restored: false, resumedAt: null };
    return store.acquire<EditController>(editKey(id), () => {
      const c = create();
      return {
        controller: c,
        kind: 'edit',
        href: `/trades/${id}/edit`,
        status: () => editDraftStatus(c.getState()),
        subscribe: (fn) => c.subscribe(() => fn()),
        // どの取引の編集か（知らせ「US30 L 11/09 の編集の変更は残っています」。#75 N3）
        label: () => editDraftLabel(c.getState()),
        images: () => editDraftImages(c.getState()),
        dispose: () => c.dispose(),
      };
    });
  }, [id, store]);
  const [state, setState] = useState<EditState>(controller.getState());
  const del = useContext(DeletionsContext);
  const nav = useContext(NavigatorContext);
  const prev = useRef(state.phase);
  useEffect(() => {
    const off = controller.subscribe(setState);
    if (!restored) void controller.load();
    return () => {
      off();
      if (store) store.release(editKey(id), controller);
      else controller.dispose();
    };
  }, [controller, restored, store, id]);
  // 枠そのもの（輪と「ここに貼れます」が出ている状態）にフォーカスがあるときだけ、貼った画像をその枠へ（記録する画面と
  // 同じ行き先。#89）。ほかの貼り付けは横取りしない（編集には明細の枠が無い）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const slot = chartSlotOf(e.target as Element | null);
      if (!slot) return;
      const file = imageFileFromClipboard(e.clipboardData?.items, e.target as PasteTarget | null);
      if (!file) return;
      e.preventDefault();
      void controller.setChart(slot, file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [controller]);
  useEffect(() => {
    const before = prev.current;
    prev.current = state.phase;
    if (state.phase === 'saved') {
      // 保存できたら前の画面（詳細）へ戻る（今の積み重ねの 1 つ下。戻るで編集の画面に戻らない。9.7 の 6・ADR-0019 の追記）
      nav?.back(`/trades/${id}`);
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
      onSetRefresh={controller.setRefresh}
      onRecalcNow={() => {
        // 判定の枠のそばのボタンは押すと消えるので、行き先の「今の値」へフォーカスを移す（N-3）
        controller.setRefresh(true);
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>(`input[name="${CHOICE_NAME}"][value="current"]`)
            ?.focus();
        });
      }}
      onSave={() => {
        void controller.save();
      }}
      onPickChart={(slot, file) => {
        void controller.setChart(slot, file);
      }}
      onRemoveChart={(slot) => {
        controller.removeChart(slot);
        // [削除] の後: 保存済みのチャートは枠が残るので [元に戻す] へ。新しく足した追加の枠は枠ごと消えるので [＋ 追加] へ
        const c = controller.getState().charts?.[slot];
        focusLater(
          c?.phase === 'removed'
            ? restoreId('edit', slot)
            : isMainSlot(slot)
              ? chartBoxId('edit', slot)
              : addExtraId('edit'),
        );
      }}
      onRestoreChart={(slot) => {
        controller.restoreChart(slot);
        focusLater(chartBoxId('edit', slot));
      }}
      onAddExtraChart={() => {
        const slot = controller.addExtraChart();
        if (slot) focusLater(chartBoxId('edit', slot));
      }}
      onExtraTimeframe={controller.setExtraTimeframe}
      onExtraNote={controller.setExtraNote}
      onAcceptChartTimeframe={(slot) => {
        controller.acceptChartTimeframe(slot);
        focusLater(`${chartBoxId('edit', slot)}-tf`);
      }}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
      {...(drafts ? { onCancel: () => drafts.cancel(editKey(id), `/trades/${id}`) } : {})}
      resumedAt={resumedAt}
    />
  );
}

export interface TradeEditViewProps {
  readonly id: string;
  readonly state: EditState;
  readonly hidden: ReadonlySet<string>;
  readonly notFound: JSX.Element;
  readonly onUpdate: (action: DraftAction) => void;
  /** 計算に使う値（#31）: true = 今の値、false = 記録したとき。省けば何もしない */
  readonly onSetRefresh?: (on: boolean) => void;
  /** 判定の枠のそばの [今の値で再計算]（#31。押すと「今の値」を選び、そこへフォーカスを移す） */
  readonly onRecalcNow?: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /**
   * [キャンセル]（#75）: 変更を捨てて前の画面へ（変更があれば [元に戻す] のトースト）。省けば詳細へのリンク（置き場の無い
   * テストの描画）
   */
  readonly onCancel?: () => void;
  /** 離れていた書きかけを借り直した: 離れた時刻（「前の変更の続きです」。#75）。省けば出さない */
  readonly resumedAt?: number | null;
  /** 今の時刻（「N 分前」。省けば Date.now） */
  readonly now?: number;
  /** チャートの枠（#89。省けば何もしない） */
  readonly onPickChart?: (slot: AnySlot, file: File) => void;
  readonly onRemoveChart?: (slot: AnySlot) => void;
  readonly onRestoreChart?: (slot: AnySlot) => void;
  readonly onAddExtraChart?: () => void;
  readonly onExtraTimeframe?: (slot: ExtraSlot, value: Timeframe | null) => void;
  readonly onExtraNote?: (slot: ExtraSlot, note: string) => void;
  readonly onAcceptChartTimeframe?: (slot: AnySlot) => void;
}

/** 描き直しの後にフォーカスを移す（消えたボタンの代わり） */
function focusLater(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/** チャートの無い枠の時間足を外す旨（D7） */
export function orphanNotice(state: Pick<EditState, 'orphans'>): string | null {
  if (state.orphans.length === 0) return null;
  const list = state.orphans
    .map((o) => `${CHART_SLOT_TEXT[o.slot].name}: ${TIMEFRAME_NAME[o.timeframe]}`)
    .join('・');
  return `チャートが無い時間足（${list}）は、保存時に削除されます。チャートが無いと時間足の違いを確認できないためです。`;
}

/**
 * 編集の全画面のシート（hook を持たない）: 上の帯（左上の ✕ = キャンセル・題「取引を編集」）と、欄・判定の枠・[保存]。
 * ✕ は保存中は押せない（#75 R4）。置き場の無いテストの描画では詳細へのリンク
 */
export function TradeEditView(p: TradeEditViewProps) {
  const saving = p.state.phase === 'saving' || p.state.phase === 'saved';
  return (
    <>
      <SheetBar
        title="取引を編集"
        {...(p.onCancel
          ? { onCancel: p.onCancel, cancelDisabled: saving }
          : { cancelHref: `/trades/${p.id}` })}
      />
      <p class="pagehead__desc">
        資金・許容リスクと銘柄の値は、記録したときの値で計算します。チャートの変更は [保存]
        で一緒に保存します。
      </p>
      <TradeEditBody {...p} />
    </>
  );
}

/** 編集の欄・判定の枠・[保存]（hook を持たない） */
function TradeEditBody(p: TradeEditViewProps) {
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
  const notice = orphanNotice(state);
  // チャートの変更の数（差し替え・追加・削除。保存の帯に出す。#89）
  const chartChanges = chartChangeCount(state.charts);
  // 2 枠の時間足の読み取りの途中（保存すると「指定なし」。#89 N2）
  const keptReading = keptReadingSlots(state.charts);
  // 口座（#47）: 開いたときは取引の口座（付いていない取引は既定の口座）。替えたら欄の下に 1 行（U19）
  const original = state.trade ? accountIdOf(state.trade.record) : DEFAULT_ACCOUNT_ID;
  const accountId = selectedAccountId(d.accountId, original);
  const switched = switchHint(findAccount(accountId, state.accounts), accountId !== original);
  // 通貨の違う口座へ替えたら、損益・手数料を空に戻した旨を同じ 1 行に足し、「ほかの欄」を開く（#47 PR-2・U33）
  const accountHint =
    state.currencyCleared && switched !== null
      ? `${switched}。${state.fxCleared ? CURRENCY_FX_CLEARED_NOTE : CURRENCY_CLEARED_NOTE}`
      : switched;
  const currency = read.currency ? currencyView(read.currency, state.preview.derivedFx) : undefined;
  // 記録したときの値と今の値（#31）: 違うときだけ。資金が空でリスク（%）が出せるなら、判定の枠の注記のそばにも
  const offer = state.offer;
  const refresh = state.refresh && offer !== null;
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
        <legend class="sr-only">取引を編集</legend>
        {p.resumedAt != null && state.phase === 'editing' ? (
          <p class="draft__resumed">{resumedNote('edit', p.resumedAt, p.now ?? Date.now())}</p>
        ) : null}
        <TradeMainFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={{}}
          onUpdate={p.onUpdate}
          accounts={state.accounts}
          accountId={accountId}
          accountHint={accountHint}
          {...(currency ? { currency } : {})}
        />
        <ChartPanel
          idPrefix="edit"
          title="チャート（任意）"
          charts={state.charts}
          extras={state.extras}
          markChanges
          timeframes={{ entry: d.entryChartTimeframe, exit: d.exitChartTimeframe }}
          {...(p.onPickChart ? { onPick: p.onPickChart } : {})}
          {...(p.onRemoveChart ? { onRemove: p.onRemoveChart } : {})}
          {...(p.onRestoreChart ? { onRestore: p.onRestoreChart } : {})}
          {...(p.onAcceptChartTimeframe ? { onAccept: p.onAcceptChartTimeframe } : {})}
          {...(p.onAddExtraChart ? { onAddExtra: p.onAddExtraChart } : {})}
          {...(p.onExtraNote ? { onNote: p.onExtraNote } : {})}
          onTimeframe={(slot, value) => {
            if (isMainSlot(slot))
              p.onUpdate({ type: 'set', field: CHART_TIMEFRAME_FIELD[slot], value });
            else p.onExtraTimeframe?.(slot, value);
          }}
        />
        {notice ? (
          <p class="notice edit__orphans" id="edit-orphans">
            {notice}
          </p>
        ) : null}
        {offer ? (
          <ResnapshotPanel offer={offer} on={refresh} onChoose={(on) => p.onSetRefresh?.(on)} />
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
          {...(offer?.nearVerdict && !refresh
            ? {
                asideAction: (
                  <Button variant="secondary" onClick={() => p.onRecalcNow?.()}>
                    {RESNAPSHOT_LABEL}
                  </Button>
                ),
              }
            : {})}
        />
        <TradeMoreFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={{}}
          onUpdate={p.onUpdate}
          {...(currency ? { currency } : {})}
          open={optionalError || state.currencyCleared}
        />
      </fieldset>

      <div class="record__submit edit__submit">
        <p class="edit__change" id="edit-change" aria-live="polite">
          {refresh ? BAR_PREFIX : ''}
          {bandText(changeText(state.before, state.preview), chartChanges)}
        </p>
        {keptReading.length > 0 ? (
          <p class="field__hint edit__kept" role="status">
            {keptReadingText(keptReading)}
          </p>
        ) : null}
        {state.error ? (
          <div class="notice notice--error" role="alert">
            <p>{state.error}</p>
            {state.errorKind === 'auth' ? (
              <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
                もう一度ログイン
              </Button>
            ) : null}
          </div>
        ) : null}
        <p class="record__missing" aria-live="polite">
          {[
            errorLabels.length > 0 ? `誤りのある欄: ${errorLabels.join('・')}` : '',
            read.missing.length > 0 ? `未入力の欄: ${read.missing.join('・')}` : '',
          ]
            .filter(Boolean)
            .join(' / ')}
        </p>
        {/* キャンセルは上の帯の左上の ✕（9.3・9.12。#127） */}
        <div class="edit__actions">
          <Button
            type="submit"
            id={SUBMIT_ID}
            size="lg"
            icon="check"
            disabled={!read.canSave || saving}
          >
            {saving
              ? state.sendingCharts
                ? 'チャートを送っています…'
                : '保存しています…'
              : '保存'}
          </Button>
        </div>
      </div>
    </form>
  );
}
