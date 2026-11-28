// 取引を編集（Issue #9 契約 U-3。設計書 C36・4 章の冒頭・7.5・9.2。#131 で記録する画面と同じ全画面のシートの形にした）:
// 上の帯は左上の ✕（キャンセル）と題「取引を編集」。中身は記録する画面（#130）と同じ部品（components/RecordParts.tsx）で、
// 要約 + ［編集］（取引の欄のシート。段 2 = ほかの欄）・チャートの小さな 2 枠（チャートのシート）・LC・一言・決済までの行動のタップ、
// 下の帯に判定の 1 行（押すと判定のシート）と ［保存］。記録したときの値と今の値（#31）は 1 行「今の値と比べる」→ 比較のシート
// （2 択「計算に使う値」）。詳細の比較のシートの ［編集で今の値にする］ から来たとき（?values=current）は、読み込んだ後に
// 「今の値」を選ぶ（保存までは写し直さない）。
// 直している間も判定・理由・R・リスク（%）はその場で出直し、資金・許容リスクは取引に写した値で計算する（今の設定を使わない）。
// 明細の場所は出さない。チャート（#89）は記録する画面と同じ枠（ChartPanel）で追加・差し替え・削除・付属の枠ができ、[保存] で
// 取引と一緒に 1 要求で保存する（✕ で捨てる。変更があればトーストの [元に戻す] で戻せる。画面を移っても変更は書きかけの置き場に
// 残る。#75）。チャートの無い枠に記録された時間足は保存で外し、その旨を出す。保存できたら前の画面（詳細）へ戻る。
// TradeEdit は hook を持たない。「見つかりません」の面は詳細と同じ。TradeEditView も hook を持たない（開いているシートは
// TradeEditScreen が持つ）
import { notePress, takeSubmit } from '../lib/keyboard-reveal';
import '../styles/record.css';
import '../styles/detail.css';
import type { JSX } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { accountIdOf, DEFAULT_ACCOUNT_ID } from '../../../core/record';
import type { Timeframe } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import { ACCOUNT_FIELD_ID, AccountField } from '../components/AccountField';
import { SheetBar } from '../components/AppBar';
import { Button, RowLink } from '../components/Button';
import { addExtraId, ChartPanel, chartBoxId, restoreId } from '../components/ChartPanel';
import { Icon } from '../components/Icon';
import { LegEditor } from '../components/LegEditor';
import {
  LEG_ADD_CANCEL_ID,
  LEG_ADD_FROM_ID,
  LEG_ADD_UNDO_ID,
  LEG_LIST_ID,
} from '../components/LegList';
import { MiniCharts, partIds, SummaryCard, VerdictLineButton } from '../components/RecordParts';
import { ResnapshotBody } from '../components/Resnapshot';
import { Segment } from '../components/Segment';
import { Sheet } from '../components/Sheet';
import {
  LcFields,
  TapFields,
  TradeCoreFields,
  type TradeFieldsProps,
  TradeMoreBody,
} from '../components/TradeFields';
import { Verdict } from '../components/Verdict';
import { accountChoiceKind, findAccount, selectedAccountId, switchHint } from '../lib/accounts';
import { backLayers } from '../lib/back-layers';
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
import { asksLcDecided, bandText, changeText } from '../lib/edit-form';
import { EDIT_SHEET_ID, type EditSheet, editValuesNote, editVerdictLine } from '../lib/edit-screen';
import {
  fromAddedStatement,
  type LegUndo,
  legRemovedText,
  nextLeg,
  undoLegRemove,
} from '../lib/legs-form';
import { TIMEFRAME_NAME } from '../lib/reasons';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS } from '../lib/record-form';
import { FIELD_INPUT_ID, tradeSummary } from '../lib/record-screen';
import {
  CHOICE_NAME,
  COMPARE_ROW_LABEL,
  COMPARE_SHEET_TITLE,
  compareRowMeta,
  RESNAPSHOT_LABEL,
  wantsCurrentValues,
} from '../lib/resnapshot';
import { NavigatorContext } from '../lib/router';
import { sheetDismiss } from '../lib/sheet';
import { addLegsBlock, legNoticeWithPnl } from '../lib/statement-add-legs';
import { imageFileFromClipboard, type PasteTarget } from '../lib/statement-fill';
import { browserCodec, prepareImage } from '../lib/statement-image';
import { submitStatus } from '../lib/verdict-notes';
import { deviceZoneMemory } from '../lib/zone-memory';
import { notFoundState } from './TradeDetail';
import { LoadState } from './Trades';

export function TradeEdit({ id }: { readonly id: string }) {
  return <TradeEditScreen id={id} notFound={notFoundState()} />;
}

const SUBMIT_ID = 'edit-submit';
const IDS = partIds('edit');
/** 「今の値と比べる」の行（比較のシートを閉じたらここへフォーカスが戻る） */
export const COMPARE_ROW_ID = 'edit-compare';
const MORE_ROW_ID = 'edit-more';
/** 取引の欄のシートの段 2（ほかの欄・足 1 本の欄。#117）の戻るの層 */
const MORE_LAYER = `${EDIT_SHEET_ID.fields}~more`;

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
        // ［明細から追加］ の時刻を直す時間帯（読むだけ。#263）
        zoneMemory: deviceZoneMemory(),
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
  // 開いているシート（取引の欄・チャート・判定・比較。#131。書きかけには残さない）
  const [sheet, setSheet] = useState<EditSheet | null>(null);
  // 直前に消した足（［元に戻す］。シートを閉じたら忘れる。#117）
  const [legUndo, setLegUndo] = useState<LegUndo | null>(null);
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
  // 詳細の比較のシートの ［編集で今の値にする］ から来た（?values=current）: 読み込めたら 1 回だけ「今の値」を選ぶ
  // （借り直した書きかけは、もう読めているのですぐ。違いが無くなっていれば何もしない。保存までは写し直さない = #31 の P4）
  const wantCurrent = wantsCurrentValues(nav?.current.search ?? '');
  const appliedCurrent = useRef(false);
  useEffect(() => {
    if (!wantCurrent || appliedCurrent.current || state.phase !== 'editing') return;
    appliedCurrent.current = true;
    if (state.offer !== null && !state.refresh) controller.setRefresh(true);
  }, [wantCurrent, state.phase, state.offer, state.refresh, controller]);
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
      setSheet(null);
      // 保存できたら前の画面（詳細）へ戻る（今の積み重ねの 1 つ下。戻るで編集の画面に戻らない。9.7 の 6・ADR-0019 の追記）
      nav?.back(`/trades/${id}`);
    } else if (before === 'saving' && state.phase === 'editing' && state.error) {
      // 保存に失敗して戻った: 押した [保存] へフォーカスを戻す（失敗の文言は role="alert"）
      document.getElementById(SUBMIT_ID)?.focus();
    }
  }, [state.phase, state.error, id, nav]);

  // 取引の欄のシートの段 2（ほかの欄・足 1 本の欄）は戻るの層を 1 段積む（戻る・Esc で段 1 へ。記録する画面と同じ。ui-guidelines 9.3・9.7）
  const moreLayered = useRef(false);
  useEffect(
    () => () => {
      if (!moreLayered.current) return;
      moreLayered.current = false;
      backLayers()?.close(MORE_LAYER);
    },
    [],
  );
  useLayoutEffect(() => {
    const layers = backLayers();
    if (!layers) return;
    const want = sheet?.kind === 'fields' && (sheet.step === 'more' || sheet.step === 'leg');
    if (want && !moreLayered.current) {
      layers.open(MORE_LAYER, () => {
        moreLayered.current = false;
        setSheet((cur) => (cur?.kind === 'fields' ? { kind: 'fields', step: 'main' } : cur));
      });
      moreLayered.current = true;
    } else if (!want && moreLayered.current) {
      layers.close(MORE_LAYER);
      moreLayered.current = false;
    }
  });

  /** シートを開く・替える・閉じる。名指した欄から開いたら、開いた後にその欄へフォーカスを移す */
  const onSheet = (next: EditSheet | null) => {
    setSheet(next);
    if (next === null) {
      setLegUndo(null);
      // ［明細から追加］ の知らせと ［元に戻す］ もシートを閉じたら消す（読み取り中は続ける。#263）
      controller.dismissLegAdd();
    }
    if (next?.kind === 'fields' && next.focus) {
      const f = next.focus;
      setTimeout(() => {
        const el =
          f === 'side'
            ? document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="L / S"] input')
            : f === 'accountId'
              ? document.getElementById(ACCOUNT_FIELD_ID)
              : document.getElementById(FIELD_INPUT_ID[f as keyof typeof FIELD_INPUT_ID] ?? '');
        el?.focus();
      }, 0);
    }
  };

  return (
    <TradeEditView
      id={id}
      state={state}
      sheet={sheet}
      onSheet={onSheet}
      legUndo={legUndo}
      onLegRemoved={setLegUndo}
      onLegUndo={() => {
        if (!legUndo) return;
        controller.update({
          type: 'set',
          field: 'legs',
          value: undoLegRemove(controller.getState().draft.legs, legUndo),
        });
        setLegUndo(null);
        // ボタンは消えるので、戻した足の行へ
        focusLater(`${LEG_LIST_ID}-${legUndo.index}`);
      }}
      onAddLegsFromStatement={(f) => {
        setLegUndo(null);
        // 押したボタンは読み取り中は押せないので ［キャンセル］ へ、終わったら ［元に戻す］ か ［明細から追加］ へ（記録する画面と同じ）
        focusLater(LEG_ADD_CANCEL_ID);
        void controller.addLegsFromStatement(f).then(() => {
          const a = document.activeElement;
          if (a !== null && a !== document.body && a.id !== LEG_ADD_CANCEL_ID) return;
          focusLater(controller.getState().legAdd?.undo ? LEG_ADD_UNDO_ID : LEG_ADD_FROM_ID);
        });
      }}
      onCancelLegRead={() => {
        controller.cancelLegRead();
        focusLater(LEG_ADD_FROM_ID);
      }}
      onUndoAddLegs={() => {
        controller.undoAddLegs();
        focusLater(LEG_ADD_FROM_ID);
      }}
      hidden={del?.state.hidden ?? NO_HIDDEN}
      notFound={notFound}
      onUpdate={controller.update}
      onSetRefresh={controller.setRefresh}
      onRecalcNow={() => {
        // 判定のシートのボタンは押すと消えるので、比較のシートを開いて行き先の「今の値」へフォーカスを移す（N-3）
        controller.setRefresh(true);
        setSheet({ kind: 'compare' });
        setTimeout(() => {
          document
            .querySelector<HTMLInputElement>(`input[name="${CHOICE_NAME}"][value="current"]`)
            ?.focus();
        }, 0);
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
  /** 判定のシートの注記のそばの [今の値で再計算]（#31。押すと「今の値」を選び、比較のシートでそこへフォーカスを移す） */
  readonly onRecalcNow?: () => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /**
   * ✕（キャンセル。#75）: 変更を捨てて前の画面へ（変更があれば [元に戻す] のトースト）。省けば詳細へのリンク（置き場の無い
   * テストの描画）
   */
  readonly onCancel?: () => void;
  /** 離れていた書きかけを借り直した: 離れた時刻（「前の変更の続きです」。#75）。省けば出さない */
  readonly resumedAt?: number | null;
  /** 今の時刻（「N 分前」。省けば Date.now） */
  readonly now?: number;
  /** 直前に消した足（一覧の「足 2 を削除しました ［元に戻す］」。P4・#117 のレビュー B1。省けば出さない） */
  readonly legUndo?: LegUndo | null;
  /** ［この足を削除］ で消した（戻すために覚える） */
  readonly onLegRemoved?: (u: LegUndo) => void;
  /** ［元に戻す］（元の位置・ID・時刻ごと戻す） */
  readonly onLegUndo?: () => void;
  /** 開いているシート（#131。省けばどれも閉じている） */
  readonly sheet?: EditSheet | null;
  /** シートを開く・替える・閉じる（null） */
  readonly onSheet?: (sheet: EditSheet | null) => void;
  /** チャートの枠（#89。省けば何もしない） */
  readonly onPickChart?: (slot: AnySlot, file: File) => void;
  readonly onRemoveChart?: (slot: AnySlot) => void;
  readonly onRestoreChart?: (slot: AnySlot) => void;
  readonly onAddExtraChart?: () => void;
  readonly onExtraTimeframe?: (slot: ExtraSlot, value: Timeframe | null) => void;
  readonly onExtraNote?: (slot: ExtraSlot, note: string) => void;
  readonly onAcceptChartTimeframe?: (slot: AnySlot) => void;
  /** ［明細から追加］（#263・C82）: 明細の画像を 1 枚選んだ。省けばボタンを出さない */
  readonly onAddLegsFromStatement?: (file: File) => void;
  readonly onCancelLegRead?: () => void;
  readonly onUndoAddLegs?: () => void;
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
 * 編集の全画面のシート（hook を持たない）: 上の帯（左上の ✕ = キャンセル・題「取引を編集」）と、要約・チャート・LC・
 * 決済までの行動のタップ（前からの「価格あり・決めていなかった」の取引だけ LC を入る前に決めていたかも。#202）・下の帯（判定の 1 行・[保存]）。✕ は保存中は押せない（#75 R4）。置き場の無いテストの描画では詳細へのリンク
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
      <TradeEditBody {...p} />
    </>
  );
}

/**
 * 「ほかの欄（任意）›」の行の右の添え（誤り → 通貨の違う口座へ替えて損益・手数料を空に戻した → 入れた欄の数。無ければ出さない）。
 * 空に戻したことは口座の欄の下の 1 行でも言う（#47 PR-2・U33。#131 でその場で開かず、添えで示す）
 */
function moreMeta(
  d: EditState['draft'],
  errors: EditState['read']['errors'],
  cleared: boolean,
  /** LC での損失の見込みが「ほかの欄」にある（オプションの形で、LC の枠に上げていない。#117） */
  lossPlanInMore = false,
): string | null {
  if (OPTIONAL_FIELDS.some((f) => errors[f] !== undefined)) return '誤りあり';
  if (lossPlanInMore && errors.lcLossPlan !== undefined) return '誤りあり';
  if (cleared) return '空に戻しました';
  const filled = [d.pnlYen, d.feeYen].filter((v) => v.trim() !== '').length;
  return filled > 0 ? `${filled} 欄` : null;
}

/** 編集の 1 画面の形（記録する画面と同じ部品。hook を持たない） */
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
  const notice = orphanNotice(state);
  // チャートの変更の数（差し替え・追加・削除。保存の帯に出す。#89）
  const chartChanges = chartChangeCount(state.charts);
  // 2 枠の時間足の読み取りの途中（保存すると「指定なし」。#89 N2）
  const keptReading = keptReadingSlots(state.charts);
  // 口座（#47）: 開いたときは取引の口座（付いていない取引は既定の口座）。替えたら欄の下に 1 行（U19）
  const original = state.trade ? accountIdOf(state.trade.record) : DEFAULT_ACCOUNT_ID;
  const accountId = selectedAccountId(d.accountId, original);
  const switched = switchHint(findAccount(accountId, state.accounts), accountId !== original);
  // 通貨の違う口座へ替えたら、損益・手数料を空に戻した旨を同じ 1 行に足す（#47 PR-2・U33）
  const accountHint =
    state.currencyCleared && switched !== null
      ? `${switched}。${state.fxCleared ? CURRENCY_FX_CLEARED_NOTE : CURRENCY_CLEARED_NOTE}`
      : switched;
  const currency = read.currency ? currencyView(read.currency, state.preview.derivedFx) : undefined;
  // 記録したときの値と今の値（#31）: 違うときだけ 1 行「今の値と比べる」
  const offer = state.offer;
  const refresh = state.refresh && offer !== null;
  const sheet = p.sheet ?? null;
  const openSheet = (s: EditSheet | null) => p.onSheet?.(s);
  const set =
    <K extends keyof typeof d>(field: K) =>
    (value: (typeof d)[K]) =>
      p.onUpdate({ type: 'set', field, value } as DraftAction);
  // オプションのポジション（#117。元の取引に足がある）: 足の行・[＋ 足] は取引の欄のシートの段 2（足 1 本の欄）
  const legAt = sheet?.kind === 'fields' && sheet.step === 'leg' ? (sheet.leg ?? 0) : null;
  const legIndex = legAt !== null && d.legs[legAt] !== undefined ? legAt : null;
  const openLeg = (i: number) => openSheet({ kind: 'fields', step: 'leg', leg: i });
  const setLegs = (value: typeof d.legs) => p.onUpdate({ type: 'set', field: 'legs', value });
  const fields: TradeFieldsProps = {
    draft: d,
    errors: e,
    instruments: state.instruments,
    marks: {},
    onUpdate: p.onUpdate,
    // 前からの「価格あり・決めていなかった」の取引だけ、LC を入る前に決めていたかを聞く（C57・#202）
    ...(state.trade && asksLcDecided(state.trade.record) ? { askLcDecided: true } : {}),
    ...(currency ? { currency } : {}),
    ...(read.option
      ? {
          option: {
            reading: read.option,
            onOpenLeg: openLeg,
            onAddLeg: () => {
              setLegs([...d.legs, nextLeg(d.legs)]);
              openLeg(d.legs.length);
            },
            removed: p.legUndo ? legRemovedText(p.legUndo) : null,
            ...(p.onLegUndo ? { onUndoRemove: p.onLegUndo } : {}),
            ...(p.onAddLegsFromStatement
              ? {
                  fromStatement: {
                    blocked: addLegsBlock({
                      statementReading: false,
                      legReading: state.legAdd?.phase === 'reading',
                      legs: d.legs.length,
                    }),
                    reading: state.legAdd?.phase === 'reading',
                    // 損益の欄を直していれば、追加の前でも後でも「損益は打った値のままです」を添える（レビュー 5）
                    notice:
                      state.legAdd?.phase === 'reading'
                        ? null
                        : legNoticeWithPnl(state.legAdd?.notice ?? null, {
                            hasAdded: d.legs.some(fromAddedStatement),
                            pnlTyped: d.pnlYen !== state.initial.pnlYen,
                          }),
                    undo: state.legAdd?.undo === true,
                    onPick: p.onAddLegsFromStatement,
                    onCancel: () => p.onCancelLegRead?.(),
                    onUndo: () => p.onUndoAddLegs?.(),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
  const step2 = sheet?.kind === 'fields' && (sheet.step === 'more' || legIndex !== null);
  const choice = accountChoiceKind(state.accounts.length);
  const account = findAccount(accountId, state.accounts);
  const line = editVerdictLine(read, state.preview, errorLabels);
  const status = line.kind === 'status' ? line.text : submitStatus(read, errorLabels);
  return (
    <form
      class="record record--one record--edit"
      noValidate
      onPointerDown={notePress}
      onPointerUp={notePress}
      onPointerCancel={notePress}
      onKeyDown={notePress}
      onSubmit={(ev) => {
        ev.preventDefault();
        // キーボードが出ている間は、本文の最後の送るボタンを押したときだけ送り、欄の Enter による暗黙の送信では保存しない。
        // 送る前にフォーカス中の欄を外して入力を確定させる（ui-guidelines 10.1。#172・#183）
        if (!takeSubmit(ev.currentTarget)) return;
        p.onSave();
      }}
    >
      <fieldset class="record__fields" disabled={saving}>
        <legend class="sr-only">取引を編集</legend>
        {p.resumedAt != null && state.phase === 'editing' ? (
          <p class="draft__resumed">{resumedNote('edit', p.resumedAt, p.now ?? Date.now())}</p>
        ) : null}

        <section class="rstmt" data-area="summary" aria-labelledby="edit-trade-title">
          <h2 class="sr-only" id="edit-trade-title">
            取引
          </h2>
          <SummaryCard
            prefix="edit"
            summary={tradeSummary(d, e, {}, read.option, read.currency?.account)}
            accountChip={choice === 'select' && account ? account.name : null}
            onFields={(focus) =>
              openSheet({ kind: 'fields', step: 'main', ...(focus ? { focus } : {}) })
            }
          >
            {choice === 'segment' ? (
              <div class="rsum__accounts">
                <AccountField
                  accounts={state.accounts}
                  value={accountId}
                  onChange={set('accountId')}
                  hint={accountHint}
                />
              </div>
            ) : choice === 'select' && accountHint ? (
              <p class="field__hint rsum__hint">{accountHint}</p>
            ) : null}
          </SummaryCard>
        </section>

        <MiniCharts
          prefix="edit"
          charts={state.charts}
          timeframes={{ entry: d.entryChartTimeframe, exit: d.exitChartTimeframe }}
          markChanges
          onPick={(slot, f) => p.onPickChart?.(slot, f)}
          onOpen={() => openSheet({ kind: 'chart' })}
        />
        {notice ? (
          <p class="notice edit__orphans" id="edit-orphans">
            {notice}
          </p>
        ) : null}

        <div class="record__lc">
          <LcFields {...fields} />
        </div>

        <div class="record__taps">
          <TapFields {...fields} moveHintInInfo />
          {state.preview.showGapSlip ? (
            <Segment
              label="窓・滑りでしたか"
              value={d.gapSlip === 'unanswered' ? null : d.gapSlip}
              onChange={set('gapSlip')}
              options={[
                { value: 'yes', label: 'はい' },
                { value: 'no', label: 'いいえ' },
              ]}
            />
          ) : null}
        </div>

        {offer ? (
          <div class="dlist edit__compare">
            <RowLink
              id={COMPARE_ROW_ID}
              onClick={() => openSheet({ kind: 'compare' })}
              meta={compareRowMeta(offer, refresh)}
            >
              {COMPARE_ROW_LABEL}
            </RowLink>
          </div>
        ) : null}

        {/* 取引の欄（要約の ［編集］・名指しの欄）。段 2 = ほかの欄（任意） */}
        <Sheet
          id={EDIT_SHEET_ID.fields}
          open={sheet?.kind === 'fields'}
          kind="form"
          title={
            sheet?.kind === 'fields' && sheet.step === 'more'
              ? 'ほかの欄（任意）'
              : legIndex !== null
                ? `足 ${legIndex + 1}`
                : '取引の欄'
          }
          lead={
            step2 ? (
              <button
                type="button"
                class="info__up"
                aria-label="取引の欄へ戻る"
                onClick={() => openSheet({ kind: 'fields', step: 'main' })}
              >
                <Icon name="back" />
                <span>取引の欄</span>
              </button>
            ) : null
          }
          focusKey={
            sheet?.kind === 'fields'
              ? sheet.step === 'leg'
                ? `leg-${legIndex}`
                : sheet.step
              : 'none'
          }
          onDismiss={(reason) => {
            const up = step2 ? sheetDismiss(reason, 1) === 'up' : false;
            openSheet(up ? { kind: 'fields', step: 'main' } : null);
          }}
        >
          {legIndex !== null && d.legs[legIndex] ? (
            <div class="record__sheetbody">
              <LegEditor
                leg={d.legs[legIndex]}
                index={legIndex}
                {...(read.option?.legErrors[legIndex]
                  ? { errors: read.option.legErrors[legIndex] }
                  : {})}
                onChange={(leg) => setLegs(d.legs.map((x, i) => (i === legIndex ? leg : x)))}
                onRemove={() => {
                  const leg = d.legs[legIndex];
                  if (leg) p.onLegRemoved?.({ leg, index: legIndex });
                  setLegs(d.legs.filter((_, i) => i !== legIndex));
                  openSheet({ kind: 'fields', step: 'main' });
                }}
              />
            </div>
          ) : sheet?.kind === 'fields' && sheet.step === 'more' ? (
            <div class="record__sheetbody">
              <TradeMoreBody {...fields} />
            </div>
          ) : (
            <div class="record__sheetbody">
              <TradeCoreFields
                {...fields}
                accounts={choice === 'select' ? state.accounts : []}
                accountId={accountId}
                {...(choice === 'select' ? { accountHint } : {})}
              />
              <RowLink
                id={MORE_ROW_ID}
                onClick={() => openSheet({ kind: 'fields', step: 'more' })}
                meta={moreMeta(d, e, state.currencyCleared, read.option?.lossPlanUp === false)}
              >
                ほかの欄（任意）
              </RowLink>
            </div>
          )}
        </Sheet>

        <Sheet
          id={EDIT_SHEET_ID.chart}
          open={sheet?.kind === 'chart'}
          kind="form"
          title="チャート"
          onDismiss={() => openSheet(null)}
        >
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
        </Sheet>

        <Sheet
          id={EDIT_SHEET_ID.verdict}
          open={sheet?.kind === 'verdict'}
          kind="info"
          title="判定"
          onDismiss={() => openSheet(null)}
        >
          <Verdict
            summary={state.preview}
            side={read.option?.autoSide ?? d.side ?? 'L'}
            pending={state.preview.judgment === undefined}
            hasErrors={errorFields.length > 0}
            before={state.before}
            legsEdited={read.option?.legsEdited === true}
            addedNotSummed={read.option?.addedNotSummed === true}
            note={editValuesNote(refresh)}
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
        </Sheet>

        <Sheet
          id={EDIT_SHEET_ID.compare}
          open={sheet?.kind === 'compare' && offer !== null}
          kind="form"
          title={COMPARE_SHEET_TITLE}
          onDismiss={() => openSheet(null)}
        >
          {offer ? (
            <div class="record__sheetbody compare__body">
              <ResnapshotBody offer={offer} on={refresh} onChoose={(on) => p.onSetRefresh?.(on)} />
            </div>
          ) : null}
        </Sheet>
      </fieldset>

      <div class="record__submit record__submit--bar edit__submit">
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
        <VerdictLineButton
          id={IDS.verdictLine}
          line={line}
          status={status}
          disabled={saving}
          onOpen={() => openSheet({ kind: 'verdict' })}
        />
        <p class="edit__change" id="edit-change" aria-live="polite">
          {bandText(changeText(state.before, state.preview), chartChanges, refresh)}
        </p>
        {keptReading.length > 0 ? (
          <p class="field__hint edit__kept" role="status">
            {keptReadingText(keptReading)}
          </p>
        ) : null}
        {/* キャンセルは上の帯の左上の ✕（9.3・9.12。#127） */}
        <Button type="submit" id={SUBMIT_ID} icon="check" block disabled={!read.canSave || saving}>
          {saving ? (state.sendingCharts ? 'チャートを送っています…' : '保存しています…') : '保存'}
        </Button>
      </div>
    </form>
  );
}
