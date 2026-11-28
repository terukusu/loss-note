// 記録する（Issue #13。手で入れて記録する。設計書 7.5 の流れ 3〜7・9.2、契約 R-4）。
// 2 つの段（2026-11-21。設計書 0.4 K17・9.2 の記録するの行・docs/ui-guidelines.md 9.4）: 同じ全画面のシートの中で、
// 1 段目「スクショを入れる」= 決済明細とチャートの絵つきの大きな枠と ［明細なしで手入力］、2 段目「振り返る」= 入れたものの
// カード（明細の要約の行・口座・チャートの行）・入る前に決めた LC と一言・決済までの行動のタップ、下の帯に判定の 1 行と [記録する]。
// ［次へ］ は置かず、明細を選ぶと読み取りを待たずに 2 段目へ移る（C23。LC へフォーカス）。読み取りの結果は要約の 3 行に
// 流れ込むだけ。2 段目の上の帯の ［スクショ］ で 1 段目へ戻る。取引の欄・ほかの欄・タイムゾーン・判定・チャートの詳細は下のシート。
// 決済明細のスクショ（Issue #15）: 貼った・選んだ画像をすぐ読み取りへ送り、読み取りの値を同じ欄に印つきで入れる。
// 送る前の注意は 1 段目の明細の枠の下に常に出す（ダイアログにしない。C38）。プレビューは送るものと同じ画像を canvas に描く。
// 根拠の足のチャート（Issue #12）: 1 段目の絵の枠・2 段目のチャートの行から 1 タップで選ぶ。枠を選んで（フォーカスして）貼ると
// その枠に入り、明細の読み取りには送らない（枠の外の貼り付けは今までどおり明細へ。R1）。チャートは [記録する] で取引と一緒に送る。
// 3 層: 純関数（lib/record-form.ts・lib/record-screen.ts）→ 通信と状態（lib/record-controller.ts）→ この画面（薄い）。
// Record は hook を持たない（App のテストが 1 段だけ呼ぶ）。RecordScreen が controller を購読し、開いているシートを持つ。
// 描画は hook を持たない RecordView に任せる（状態と操作の関数を受けて描くだけ。テストで直接呼べる）。
// 判定・R は core/ の結果だけを出す。色は判定の段（バッジと結果の枠）だけ、数字は無色（C34）。
// 形（縦・横・広い）が替わっても View を包む DOM は同じ（形は殻と CSS だけが知る。9.5。2 列は U10）
import type { ComponentChildren } from 'preact';
import { notePress, takeSubmit } from '../lib/keyboard-reveal';
import '../styles/record.css';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { Side, Timeframe } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import {
  AccountAddButton,
  AccountAddForm,
  ADD_ACCOUNT_BUTTON_ID,
  NEW_ACCOUNT_NAME_ID,
} from '../components/AccountAdd';
import { ACCOUNT_FIELD_ID, AccountField } from '../components/AccountField';
import { SheetBar } from '../components/AppBar';
import { Button, RowLink } from '../components/Button';
import { addExtraId, chartBoxId as boxId, ChartPanel } from '../components/ChartPanel';
import { useEmotionChoices } from '../components/EmotionChoices';
import { EmotionSheetBody, type EmotionShort, emotionMoreStartId } from '../components/Emotions';
import { Icon } from '../components/Icon';
import { InfoTip } from '../components/InfoTip';
import { LegEditor } from '../components/LegEditor';
import { LEG_LIST_ID, LEG_MERGE_ID } from '../components/LegList';
import { CandleArt, StatementArt } from '../components/RecordArt';
import {
  LineParts,
  MiniChart,
  partIds,
  SummaryCard,
  VerdictLineButton,
} from '../components/RecordParts';
import { Segment } from '../components/Segment';
import { Sheet } from '../components/Sheet';
import {
  LcFields,
  TapFields,
  TradeCoreFields,
  type TradeFieldsProps,
  TradeMoreBody,
} from '../components/TradeFields';
import { VERDICT_TITLE_ID, Verdict } from '../components/Verdict';
import {
  accountChoiceKind,
  findAccount,
  hasManyAccounts,
  savedText,
  selectedAccountId,
  verdictAsideText,
} from '../lib/accounts';
import { backLayers } from '../lib/back-layers';
import { BULK_SWAP_TEXT, bulkDroppedText, bulkSwapLabel, swapTargetOf } from '../lib/bulk-pick';
import { CHART_READ_NOTICE, CHART_SEND_INFO, timeframeConflict } from '../lib/chart-read';
import type { ChartState } from '../lib/chart-slots';
import {
  type AnySlot,
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  type ChartSlot,
  chartSlotOf,
  type ExtraSlot,
  isMainSlot,
} from '../lib/charts';
import { currencyView } from '../lib/currency';
import {
  exitTimeKept,
  recordDraftImages,
  recordDraftStatus,
  resumedAfter,
  resumedNote,
} from '../lib/draft-status';
import { recordKey } from '../lib/drafts';
import { DraftsContext } from '../lib/drafts-context';
import { hiddenOf } from '../lib/emotion-choices-controller';
import {
  createEmotionController,
  type EmotionController,
  type EmotionState,
} from '../lib/emotion-controller';
import { loadEmotionCounts } from '../lib/emotion-history';
import { emotionSheetTitle, type SavedVerdict, savedCandidates } from '../lib/emotion-tags';
import { formatPrice, formatQuantity } from '../lib/format';
import { editLeg, type LegUndo, legRemovedText, nextLeg, undoLegRemove } from '../lib/legs-form';
import { reasonText, TIMEFRAME_NAME } from '../lib/reasons';
import {
  createRecordController,
  enterRecordScreen,
  type RecordController,
  type RecordState,
  rowUnitOf,
  type TzState,
  watchVisible,
} from '../lib/record-controller';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS, summarize } from '../lib/record-form';
import {
  type ChartLike,
  chartRow,
  chartRowParts,
  FIELD_INPUT_ID,
  focusLcAfterRead,
  miniChartId,
  opensEmotionSheet,
  REREAD_CANCEL_LABEL,
  REREADING,
  type RecordSheet,
  type RecordStage,
  readFinished,
  revertedMessage,
  SHEET_ID,
  type StatementStatus,
  showProceed,
  stage1Reading,
  stage1Statement,
  stageOf,
  statementRow,
  statementStatus,
  type TradeSummary,
  TZ_PENDING,
  timeZoneNeed,
  tradeSummary,
  verdictLine,
} from '../lib/record-screen';
import { createRequest } from '../lib/request';
import { sheetDismiss } from '../lib/sheet';
import { accountHintOf, learnedText, pnlFillOf } from '../lib/statement-account';
import {
  imageFileFromClipboard,
  MARK_LABEL,
  type Marks,
  type PasteTarget,
  type ReadRow,
  rowLabel,
} from '../lib/statement-fill';
import { browserCodec, prepareImage } from '../lib/statement-image';
import { nextPositionView } from '../lib/statement-positions';
import {
  gapText,
  isOtherZone,
  MAIN_ZONES,
  OTHER_ZONES,
  otherResultLine,
  rememberedGapText,
  rememberedText,
  resultText,
  TZ_TEXT,
  type TzId,
  wallToEpoch,
  writtenLine,
} from '../lib/statement-tz';
import { blockReason, submitStatus } from '../lib/verdict-notes';
import { deviceZoneMemory } from '../lib/zone-memory';

export function Record() {
  return (
    <>
      <RecordBar title="記録する" />
      <RecordScreen />
    </>
  );
}

/** 読み込みを始めた controller（見出しと画面の両方が置き場から借りるので、読み込みは 1 回だけ。借り直しでは読み込まない） */
const started = new WeakSet<RecordController>();

/** 置き場（殻の drafts.ts。#75）から記録する画面の controller を借りる。見出しの [キャンセル] と画面が同じものを借りる */
function useRecordDraft(): { controller: RecordController; resumedAt: number | null } | null {
  const ctx = useContext(DraftsContext);
  return useMemo(() => {
    if (!ctx) return null;
    const got = ctx.drafts.acquire<RecordController>(
      recordKey(),
      () => {
        const c = createScreenController();
        return {
          controller: c,
          kind: 'record',
          href: '/record',
          status: () => recordDraftStatus(c.getState()),
          subscribe: (fn) => c.subscribe(() => fn()),
          images: () => recordDraftImages(c.getState()),
          stop: () => c.cancelRead(),
          dispose: () => c.dispose(),
        };
      },
      // 離れている間に保存し終えた結果は、戻ったときに 1 度見せる（次に離れたら捨てる）
      { reuseDone: true },
    );
    return { controller: got.controller, resumedAt: got.resumedAt };
  }, [ctx]);
}

function createScreenController(): RecordController {
  return createRecordController({
    api,
    now: () => Date.now(),
    prepare: (file) => prepareImage(file, browserCodec),
    warmRead: true,
    // 明細の時刻の時間帯を端末に覚える（時間帯の ID だけ。#58）
    zoneMemory: deviceZoneMemory(),
  });
}

/** controller の保存中かを購読する（[キャンセル] は保存中は押せない。R4） */
function useSaving(c: RecordController | undefined): boolean {
  const [saving, setSaving] = useState(c?.getState().phase === 'saving');
  useEffect(() => c?.subscribe((s) => setSaving(s.phase === 'saving')), [c]);
  return saving;
}

/**
 * 記録するの全画面のシートの上の帯（#127。9.3・9.12）: 左上の ✕（読み上げの名前「キャンセル」。どの形でも同じ左上。保存中は
 * 押せない = #75 R4）と題「記録する」。最初の描画から出す（置き場から借りる。#75 N7）。置き場が無い（テストで画面だけ）なら
 * ホームへのリンク
 */
export function RecordBar({ title }: { readonly title: string }) {
  const ctx = useContext(DraftsContext);
  const draft = useRecordDraft();
  const saving = useSaving(draft?.controller);
  const rows = useRowText(draft?.controller);
  const stage = useStage(draft?.controller);
  if (!ctx || !draft) return <RecordBarView title={title} saving={false} />;
  const c = draft.controller;
  return (
    <RecordBarView
      title={title}
      saving={saving}
      rows={rows}
      stage={stage}
      onCancel={() => ctx.cancel(recordKey(), '/')}
      onInput={() => {
        c.setStage('input');
        focusSoonId(STAGE1_TITLE_ID);
      }}
    />
  );
}

/** 今の段（読み込み・保存の後は出さない = 上の帯の ［スクショ］ は振り返る段の入力中だけ） */
function stageNow(s: RecordState | undefined): RecordStage | null {
  if (!s || (s.phase !== 'editing' && s.phase !== 'saving')) return null;
  return stageOf(s);
}

function useStage(c: RecordController | undefined): RecordStage | null {
  const [stage, setStage] = useState(stageNow(c?.getState()));
  useEffect(() => c?.subscribe((s) => setStage(stageNow(s))), [c]);
  return stage;
}

/** 押すと消える・段が替わるボタンの後に、次に触る所へフォーカスを移す（描き直しの後） */
function focusSoonId(id: string) {
  setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 0);
}

/** 明細の行の進み具合（「1 / 2 行目」。行が 2 つ以上のときだけ。上の帯の右。9.3） */
function rowTextOf(s: RecordState | undefined): string | null {
  const st = s?.statement;
  if (st?.phase !== 'ready' || st.rows.length < 2) return null;
  return rowLabel(st.index, st.rows.length, rowUnitOf(st));
}

function useRowText(c: RecordController | undefined): string | null {
  const [text, setText] = useState(rowTextOf(c?.getState()));
  useEffect(() => c?.subscribe((s) => setText(rowTextOf(s))), [c]);
  return text;
}

export function RecordBarView(p: {
  readonly title: string;
  readonly saving: boolean;
  /** 明細の行の進み具合（「1 / 2 行目」。題の下の小さな行。右は ［スクショ］ が使う） */
  readonly rows?: string | null;
  /** 今の段（振り返る段なら右に ［スクショ］。2026-11-21） */
  readonly stage?: RecordStage | null;
  readonly onCancel?: () => void;
  /** ［スクショ］（1 段目へ戻る） */
  readonly onInput?: () => void;
}) {
  return (
    <SheetBar
      title={p.title}
      {...(p.onCancel ? { onCancel: p.onCancel, cancelDisabled: p.saving } : { cancelHref: '/' })}
      {...(p.rows ? { sub: <span class="appbar__meta num">{p.rows}</span> } : {})}
      {...(p.stage === 'review' && p.onInput
        ? {
            end: (
              <Button
                variant="secondary"
                size="sm"
                icon="image"
                id={TO_INPUT_ID}
                class="record__toinput"
                label="スクショを入れる画面へ戻る"
                disabled={p.saving}
                onClick={p.onInput}
              >
                スクショ
              </Button>
            ),
          }
        : {})}
    />
  );
}

/**
 * controller を書きかけの置き場から借りて購読する。入力があるまま離れた書きかけは置き場に残り、戻ると借り直す（読み込み直さない）。
 * 置き場が無い（テストで画面だけを描く）ときは開くたびに作り、離れると捨てる
 */
export function RecordScreen() {
  const ctx = useContext(DraftsContext);
  const draft = useRecordDraft();
  const own = useMemo(() => (draft ? null : createScreenController()), [draft]);
  const controller = draft?.controller ?? (own as RecordController);
  const [state, setState] = useState<RecordState>(controller.getState());
  // 続きの 1 行は保存し終えたら出さない（次の取引の空の下書きは前の入力の続きではない。#75 R2）
  const [resumedAt, setResumedAt] = useState(() =>
    resumedAfter(draft?.resumedAt ?? null, controller.getState().phase),
  );
  const prevPhase = useRef(state.phase);
  // 開いているシート（取引の欄・ほかの欄・タイムゾーン・判定・チャート。#130。書きかけには残さない）
  const [sheet, setSheet] = useState<RecordSheet | null>(null);
  // 直前に消した足（［元に戻す］。シートを閉じたら忘れる。#117）
  const [legUndo, setLegUndo] = useState<LegUndo | null>(null);
  /** ［別のポジションにする］ の後の知らせ（シートを閉じたら忘れる。#118 のデザインレビュー 4） */
  const [legNotice, setLegNotice] = useState<string | null>(null);
  // 枠・行に貼ってチャートを差し替えた知らせ（段が替わる・チャートを選ぶ・消すと消す）
  const [replaced, setReplaced] = useState<string | null>(null);
  // 保存の後のシートの心理のタグ（#156）。保存のたびに作り直し、シートを閉じても送りが終わるまで残す（画面を離れたら捨てる）
  const emotion = useRef<EmotionController | null>(null);
  const [emotionState, setEmotionState] = useState<EmotionState | null>(null);
  // 心理の選択肢の設定（#163）。画面を開くたびに読む（読めない・読み込み中はすべて出す）
  const choices = useEmotionChoices();
  useEffect(() => () => emotion.current?.dispose(), []);
  // 保存の後のシートの候補（#230・C65）: 直近の取引に付いた心理の数。画面を開いたときと ［次の取引を記録］ で読み直す
  // （記録の読み込みを待たせない。読めなければ前の数のまま = 初めは null で既定の巡り。R4）。候補はシートを開く時点で決めて
  // 固定する（開いた後に数が届いても入れ替えない。R4・AC-5）
  const emotionCounts = useRef<ReadonlyMap<EmotionTagId, number> | null>(null);
  const countsSeq = useRef(0);
  const reloadEmotionCounts = () => {
    const seq = ++countsSeq.current;
    void loadEmotionCounts(createRequest(api)).then((c) => {
      if (c && seq === countsSeq.current) emotionCounts.current = c;
    });
  };
  const [emotionPicks, setEmotionPicks] = useState<{
    readonly candidates: readonly EmotionTagId[];
    readonly expanded: boolean;
  } | null>(null);
  // 開いたときに 1 回だけ読む
  useEffect(() => reloadEmotionCounts(), []);
  // ［ほかの心理］ を押すとボタンが消えるので、出した最初のまとまりの見出しへフォーカスを移す（R5）
  useEffect(() => {
    if (!emotionPicks?.expanded) return;
    document
      .querySelector<HTMLElement>(`[data-focus-id="${emotionMoreStartId('record')}"]`)
      ?.focus();
  }, [emotionPicks?.expanded]);

  useEffect(() => {
    const off = controller.subscribe((s) => {
      setState(s);
      setResumedAt((cur) => resumedAfter(cur, s.phase));
    });
    // 初めてなら読み込む。借り直しは読み込み直さず、読み取りの準備だけ送り直す（#75・#99 の続き）
    const leave = enterRecordScreen(controller, started);
    return () => {
      off();
      leave();
      // 画面を離れた: 置き場があれば返す（入力があれば残る）。無ければ捨てる（読み取りを止め、画像を閉じる）
      if (ctx) ctx.drafts.release(recordKey(), controller);
      else controller.dispose();
    };
  }, [controller, ctx]);

  // 画像の貼り付けは文字の欄の外ならどこでも受ける（画像があるときだけ横取りする）。文字の欄に貼ったときは、
  // 画像を含んでいても横取りせず普通の貼り付けに任せる（表計算のコピーは文字と画像の両方を持つ。R1）。
  // 貼り付けを受けるのはこの画面にいる間だけ（書きかけの後始末は上の購読の後始末）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileFromClipboard(e.clipboardData?.items, e.target as PasteTarget | null);
      if (!file) return;
      e.preventDefault();
      // 枠そのもの（エントリー時 / 決済時。輪と「ここに貼れます」が出ている状態）にフォーカスがあるときだけチャート。
      // 枠の中の時間足の欄・ボタンを含め、ほかは決済明細の読み取りへ（#12 R1。目印と行き先を一致させる）
      const slot = chartSlotOf(e.target as Element | null);
      // 入っているチャートを貼って差し替えたときは 1 行で知らせる（黙って差し替えない。2026-11-21 のレビュー N5）
      const had = slot !== null && controller.getState().charts?.[slot]?.phase === 'ready';
      setReplaced(had && slot ? replacedText(slot) : null);
      if (slot) void controller.setChart(slot, file);
      else void controller.readImage(file);
    };
    // 画面に戻ったら読み取りの準備を送り直す（前のタブで開いたままの間に先立てが捨てられていることがある。#99 の続き）
    const unwatch = watchVisible(
      document,
      () => document.visibilityState === 'visible',
      () => controller.refreshWarm(),
    );
    document.addEventListener('paste', onPaste);
    // 離れても controller は捨てない（書きかけは置き場に残す。捨てるのは置き場。#75）
    return () => {
      document.removeEventListener('paste', onPaste);
      unwatch();
    };
  }, [controller]);

  // 保存した直後は結果の見出しへ、次の取引へ戻ったら明細の場所へフォーカスを移す（読み上げ・キーで迷わない）
  useEffect(() => {
    const before = prevPhase.current;
    prevPhase.current = state.phase;
    if (before === state.phase) return;
    if (state.phase === 'saved') {
      window.scrollTo({ top: 0 });
      const saved = state.saved;
      if (opensEmotionSheet(before, state.phase) && saved) {
        // 保存の後のシート（#156 R4）: 保存した取引（複数行なら同じ明細から保存した行すべて）に心理を付ける。
        // 見出しへのフォーカスはシートが移す（閉じたら判定の枠の見出しへ）
        emotion.current?.dispose();
        const c = createEmotionController({
          request: createRequest(api),
          tradeIds: (saved.trades ?? [saved.trade]).map((t) => t.id),
          initial: [],
        });
        emotion.current = c;
        c.subscribe(setEmotionState);
        setEmotionPicks({
          candidates: savedCandidates(emotionCounts.current, hiddenOf(choices.state)),
          expanded: false,
        });
        setSheet({ kind: 'emotion' });
      } else {
        setSheet(null);
        document.getElementById(VERDICT_TITLE_ID)?.focus();
      }
    } else if (before === 'saved' && state.phase === 'editing') {
      // 次の取引: 付けた心理を数に入れて読み直す（#230）
      reloadEmotionCounts();
      window.scrollTo({ top: 0 });
      document.getElementById(STAGE1_TITLE_ID)?.focus({ preventScroll: true });
    } else if (before === 'saving' && state.phase === 'editing' && state.error) {
      // 保存に失敗して戻った: 保存中は欄とボタンが無効でフォーカスが外れるので、押した [記録する] へ戻す
      // （失敗の文言は role="alert" で読み上げる。#5 のレビュー指摘 6）
      document.getElementById(SUBMIT_ID)?.focus();
    }
  }, [state.phase, state.error]);

  // 読み取りが終わったとき、どの欄にもフォーカスが無ければ LC へ（入力中の欄から奪わない。9.4・AC-10）
  const prevStatement = useRef(state.statement?.phase);
  useEffect(() => {
    const before = prevStatement.current;
    const after = state.statement?.phase;
    prevStatement.current = after;
    const a = document.activeElement;
    const inField =
      a instanceof HTMLElement &&
      (a.matches('input, select, textarea, [contenteditable="true"]') ||
        a.closest('dialog') !== null);
    if (focusLcAfterRead(before, after, inField ? 'field' : 'none')) {
      document.getElementById(LC_ID)?.focus({ preventScroll: true });
    }
  }, [state.statement?.phase]);

  // 完了の文の読み上げの数は、読めた最初の行が出た時点で 1 回だけ数える（同じ読み取りの間は替えない。#166 のコードレビュー 2）
  const spokenRef = useRef<{ readonly key: unknown; readonly named: number } | null>(null);
  {
    const st = state.statement;
    const key = st?.phase === 'ready' && st.index === 0 && st.notice === null ? st.rows : null;
    if (key === null) spokenRef.current = null;
    else if (spokenRef.current?.key !== key)
      spokenRef.current = { key, named: summaryOf(state).named.length };
  }
  const spokenNamed = spokenRef.current?.named;

  // 読み取りが読めた・失敗した直後だけ、明細の行に 1 回の動き（#166 R3）。動きの終わり（animationend）で外し、動きが
  // 描かれなかったとき（1 段目へ戻った・動きを減らす設定）も時間で外す（段・シートを行き来しても繰り返さない）
  const [readFlash, setReadFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFlashPhase = useRef(state.statement?.phase);
  useEffect(() => {
    const before = prevFlashPhase.current;
    const after = state.statement?.phase;
    prevFlashPhase.current = after;
    if (!readFinished(before, after)) return;
    setReadFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setReadFlash(false), READ_FLASH_CLEAR_MS);
  }, [state.statement?.phase]);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // 段の移り（2026-11-21）: 1 段目 → 2 段目は LC へ（明細を選んだ・［振り返りへ進む］。シートを開いた ［明細なしで手入力］ は
  // シートが見出しへ移す）。2 段目 → 1 段目は 1 段目の見出しへ。どちらも上の端から見せる
  const stage = state.phase === 'editing' || state.phase === 'saving' ? stageOf(state) : null;
  const prevStage = useRef(stage);
  useEffect(() => {
    const before = prevStage.current;
    prevStage.current = stage;
    if (before === stage || before === null || stage === null) return;
    window.scrollTo({ top: 0 });
    setReplaced(null);
    if (stage === 'review') {
      if (sheet === null) document.getElementById(LC_ID)?.focus({ preventScroll: true });
    } else {
      document.getElementById(STAGE1_TITLE_ID)?.focus({ preventScroll: true });
    }
  }, [stage, sheet]);

  // 明細の 1 行を保存して次の行へ移ったら、明細の場所へフォーカスを移す
  // （知らせ「i / N 行目を記録しました。次の行（…）です」は名前の上の 1 行に出し、明細の行の読み上げの領域で読み上げる。#180）
  const rowKey =
    state.phase === 'editing' && state.statement?.phase === 'ready' && state.statement.notice
      ? `${state.statement.index}:${state.statement.notice}`
      : '';
  const prevRowKey = useRef('');
  useEffect(() => {
    if (rowKey === prevRowKey.current) return;
    prevRowKey.current = rowKey;
    if (!rowKey) return;
    document.getElementById(STATEMENT_TITLE_ID)?.focus({ preventScroll: true });
  }, [rowKey]);

  // 取引の欄のシートの段 2（ほかの欄・足 1 本の欄。#117）は戻るの層を 1 段積む（戻る・Esc で段 1 へ。ui-guidelines 9.3・9.7）
  const moreLayered = useRef(false);
  // 段 2 を開いたまま画面ごと外れた（403 の旗・ログインの門の置き換えなど）ときは層を外す（#130 のレビュー N3）
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
  const onSheet = (next: RecordSheet | null) => {
    setSheet(next);
    // 閉じた後にフォーカスが body に落ちた（開いたボタンが段の移りで消えた = ［明細なしで手入力］ など）ときは、LC か要約の
    // ［編集］ へ（キーボード・読み上げで迷わない。2 段化のレビュー指摘 4）
    if (next === null) {
      setLegUndo(null);
      setLegNotice(null);
      // 保存の後のシートを閉じた: 判定の枠の見出しへ（#156。保存の後の画面には LC が無い）
      if (controller.getState().phase === 'saved') {
        setTimeout(() => document.getElementById(VERDICT_TITLE_ID)?.focus(), 0);
      } else setTimeout(focusAfterSheet, 0);
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

  /** 押すと消えるボタンの後に、次に触る所へフォーカスを移す（描き直しの後） */
  const focusSoon = (id: string) => {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  };
  /** 口座を足せた後: 選ばれた口座の項目（Segment の選ばれた radio か select）へ（U7）。Segment は画面にあるのでシートを閉じる */
  const focusAccount = () => {
    if (accountChoiceKind(controller.getState().accounts.length) === 'segment') setSheet(null);
    setTimeout(() => {
      const el =
        document.querySelector<HTMLElement>(`input[name="${ACCOUNT_FIELD_ID}"]:checked`) ??
        document.getElementById(ACCOUNT_FIELD_ID);
      el?.focus();
    }, 0);
  };

  const onUpdate = controller.update;

  return (
    <RecordView
      state={state}
      sheet={sheet}
      onSheet={onSheet}
      {...(emotionState ? { emotion: emotionState } : {})}
      onEmotionToggle={(id) => emotion.current?.toggle(id)}
      emotionHidden={hiddenOf(choices.state)}
      {...(emotionPicks
        ? {
            emotionShort: {
              ...emotionPicks,
              onMore: () => setEmotionPicks((cur) => (cur ? { ...cur, expanded: true } : cur)),
            },
          }
        : {})}
      legUndo={legUndo}
      legNotice={legNotice}
      readFlash={readFlash}
      {...(spokenNamed === undefined ? {} : { spokenNamed })}
      onReadFlashEnd={() => setReadFlash(false)}
      onLegRemoved={setLegUndo}
      onLegUndo={() => {
        if (!legUndo) return;
        onUpdate({
          type: 'set',
          field: 'legs',
          value: undoLegRemove(controller.getState().draft.legs, legUndo),
        });
        setLegUndo(null);
        // ボタンは消えるので、戻した足の行へ
        focusSoon(`${LEG_LIST_ID}-${legUndo.index}`);
      }}
      onManual={() => {
        onSheet({ kind: 'fields', step: 'main', focus: 'instrumentName' });
        controller.startManual();
      }}
      onStage={controller.setStage}
      onUpdate={onUpdate}
      onSave={() => {
        void controller.save();
      }}
      onNext={controller.next}
      {...(ctx ? { onCancel: () => ctx.cancel(recordKey(), '/') } : {})}
      resumedAt={resumedAt}
      chartReplaced={replaced}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        // ログアウトすると門がログイン画面へ置き換える（戻り先はこの画面）
        void signOutActive();
      }}
      onPickFile={(file) => {
        void controller.readImage(file);
      }}
      onPickFiles={(files) => {
        // まとめて選んだ（#232）: 1 枚目 = 明細、2 枚目から = 空いているチャートの枠（選んだ順）
        setReplaced(null);
        void controller.pickMany(files);
      }}
      onSwapBulk={() => {
        setReplaced(null);
        void controller.swapBulk();
        // 押したボタンは消えるので、読み直している明細の行の見出しへ（読めたら今の規則どおり LC へ移る = focusLcAfterRead）
        focusSoon(STATEMENT_TITLE_ID);
      }}
      onRemoveStatement={() => {
        controller.removeStatement();
        // 押したボタンは消えるので、同じ枠の ［元に戻す］ へ
        focusSoon(STATEMENT_UNDO_ID);
      }}
      onUndoRemoveStatement={() => {
        controller.undoRemoveStatement();
        focusSoon(STATEMENT_REMOVE_ID);
      }}
      onCancelRead={() => {
        controller.cancelRead();
        // 2 段目は LC へ、1 段目（読み取り中に ［スクショ］ で戻った）は明細を選ぶ欄へ（段は替わらない）
        focusSoon(stageOf(controller.getState()) === 'review' ? LC_ID : STATEMENT_FILE_ID);
      }}
      onChooseTz={(id) => {
        controller.chooseTimeZone(id);
        // 1 タップで当てて閉じる（その時間帯に無い時刻なら理由を出したまま開いておく）
        if (controller.getState().statement?.tz?.gap !== id) setSheet(null);
      }}
      // フォーカスは radio に残す（矢印キーで行き来できる。一覧は次の Tab）
      onOpenOtherZones={controller.openOtherZones}
      onPickChart={(slot, file) => {
        setReplaced(null);
        void controller.setChart(slot, file);
      }}
      onAcceptChartTimeframe={(slot) => {
        controller.acceptChartTimeframe(slot);
        // ボタンは消えるので時間足の欄へ
        focusSoon(`${chartBoxId(slot)}-tf`);
      }}
      onRemoveChart={(slot) => {
        setReplaced(null);
        controller.removeChart(slot);
        // [削除] の後は枠へフォーカスを戻す（ボタンは消える）。付属の枠は枠ごと消えるので [＋ チャートを追加] へ
        focusSoon(isMainSlot(slot) ? chartBoxId(slot) : addExtraId('record'));
      }}
      onAddExtraChart={() => {
        const slot = controller.addExtraChart();
        if (slot) focusSoon(chartBoxId(slot));
      }}
      onExtraTimeframe={controller.setExtraTimeframe}
      onExtraNote={controller.setExtraNote}
      onOpenAddAccount={() => {
        controller.openAddAccount();
        focusSoon(NEW_ACCOUNT_NAME_ID);
      }}
      onCloseAddAccount={() => {
        controller.closeAddAccount();
        focusSoon(ADD_ACCOUNT_BUTTON_ID);
      }}
      onNewAccount={controller.setNewAccount}
      onAddAccount={() => {
        void controller.addAccount().then(() => {
          // 足せたら欄は閉じ、選ばれた口座へ。足せなければ欄に残る（誤りの欄・知らせ）
          if (!controller.getState().addAccount) focusAccount();
        });
      }}
      onSplitLeg={(i) => {
        controller.splitLeg(i);
        setLegUndo(null);
        setLegNotice(`足 ${i + 1} を別のポジションにしました。次の件で記録します`);
        onSheet({ kind: 'fields', step: 'main' });
        // 分けた足は「次のポジション ［このポジションに入れる］」の行になる（押せば戻る）
        focusSoon(LEG_MERGE_ID);
      }}
      onMergeNext={() => {
        controller.mergeNextPosition();
        setLegUndo(null);
        setLegNotice(null);
        focusSoon(`${LEG_LIST_ID}-0`);
      }}
      onSkipRow={() => {
        controller.skipRow();
        // 最後の行を飛ばすとボタンは消える（読み取りを終えて空の下書き）。枠の見出しへ
        const st = controller.getState().statement;
        if (st?.phase !== 'ready') setSheet(null);
        // 最後の行を飛ばすと 1 段目（見出しへのフォーカスは段の移りが移す）
        if (st?.phase === 'ready') focusSoon(STATEMENT_ROW_ID);
      }}
    />
  );
}

export interface RecordViewProps {
  readonly state: RecordState;
  /** 保存の後のシートの心理のタグ（#156。省けば保存の後のシートを出さない） */
  readonly emotion?: EmotionState;
  /** チップを押した */
  readonly onEmotionToggle?: (id: EmotionTagId) => void;
  /** 心理の選択肢に出さないタグ（#163 の設定。省く・読めない・読み込み中 = すべて出す） */
  readonly emotionHidden?: readonly EmotionTagId[];
  /** 保存の後のシートの短い形（#230。平常心 + 候補 + ［ほかの心理］。省けば全部の選択肢） */
  readonly emotionShort?: EmotionShort;
  /** 開いているシート（#130。省けばどれも閉じている） */
  readonly sheet?: RecordSheet | null;
  /** シートを開く・替える・閉じる（null） */
  readonly onSheet?: (sheet: RecordSheet | null) => void;
  /** 直前に消した足（一覧の「足 2 を削除しました ［元に戻す］」。P4・#117 のレビュー B1。省けば出さない） */
  readonly legUndo?: LegUndo | null;
  /** 足の一覧の直前の操作の知らせ（［別のポジションにする］ の後。#118） */
  readonly legNotice?: string | null;
  /** ［この足を削除］ で消した（戻すために覚える） */
  readonly onLegRemoved?: (u: LegUndo) => void;
  /** ［元に戻す］（元の位置・ID・時刻ごと戻す） */
  readonly onLegUndo?: () => void;
  /** ［明細なしで手入力］・［手入力で続ける］ */
  readonly onManual?: () => void;
  /** 段を替える（［振り返りへ進む］・［スクショを選ぶ］。2026-11-21） */
  readonly onStage?: (stage: RecordStage) => void;
  readonly onUpdate: (action: DraftAction) => void;
  readonly onSave: () => void;
  readonly onNext: () => void;
  /** [キャンセル]（#75）。帯の [記録する] の左に出す（幅 720 以上だけ。360 は見出しの右）。省けば出さない */
  readonly onCancel?: () => void;
  /** 離れていた書きかけを借り直した: 離れた時刻（見出しの下の「前の入力の続きです」。#75 デザイン 1）。省けば出さない */
  readonly resumedAt?: number | null;
  /** チャートを差し替えた知らせ（枠・行にフォーカスして貼った。省けば出さない） */
  readonly chartReplaced?: string | null;
  /** 今の時刻（「N 分前」。省けば Date.now） */
  readonly now?: number;
  readonly onReload: () => void;
  /** ログインが切れたとき: もう一度ログイン */
  readonly onRelogin: () => void;
  /** 明細の画像を選んだ（#15） */
  readonly onPickFile?: (file: File) => void;
  /** 1 段目の明細の枠で画像をまとめて選んだ（選んだ順。2 枚以上。#232） */
  readonly onPickFiles?: (files: File[]) => void;
  /** 2 段目の ［入れ替える］（まとめて選んだ明細とチャートが逆かもしれないとき。#232） */
  readonly onSwapBulk?: () => void;
  /** [やめて手で入れる] */
  readonly onCancelRead?: () => void;
  /** 1 段目の明細の枠の ［削除］（#184） */
  readonly onRemoveStatement?: () => void;
  /** 削除の後の ［元に戻す］（#184） */
  readonly onUndoRemoveStatement?: () => void;
  /**
   * 明細の行の 1 回だけの動き（読み取りが読めた・失敗した直後。#166 R3）。動きが終わったら onReadFlashEnd で外す。
   * 省けば動かない
   */
  readonly readFlash?: boolean;
  /**
   * 読み取りが終わった時点の「入力が必要な欄」の数（hook の層が読み取りごとに 1 回だけ数える）。読み上げの領域はこの数で
   * 止める（#166 のコードレビュー 2）。省けば今の数
   */
  readonly spokenNamed?: number;
  readonly onReadFlashEnd?: () => void;
  /** 明細の時刻の時間帯を選んだ（#58） */
  readonly onChooseTz?: (id: TzId) => void;
  /** [ほかのタイムゾーン…] */
  readonly onOpenOtherZones?: () => void;
  /** [この行を飛ばす] */
  readonly onSkipRow?: () => void;
  /** [別のポジションにする]（下書きの足の番号。#118） */
  readonly onSplitLeg?: (legIndex: number) => void;
  /** ［このポジションに入れる］（#118） */
  readonly onMergeNext?: () => void;
  /** チャートを枠に選んだ（#12） */
  readonly onPickChart?: (slot: AnySlot, file: File) => void;
  /** チャートの [削除] */
  readonly onRemoveChart?: (slot: AnySlot) => void;
  /** [＋ チャートを追加]・付属の時間足・一言（#89） */
  readonly onAddExtraChart?: () => void;
  readonly onExtraTimeframe?: (slot: ExtraSlot, value: Timeframe | null) => void;
  readonly onExtraNote?: (slot: ExtraSlot, note: string) => void;
  /** [＋ 口座を足す]・[やめる]・欄の入力・[足す]（#47） */
  readonly onOpenAddAccount?: () => void;
  readonly onCloseAddAccount?: () => void;
  readonly onNewAccount?: (field: 'name' | 'capital', value: string) => void;
  readonly onAddAccount?: () => void;
  /** チャートから読めた値の [〈値〉にする]（#27） */
  readonly onAcceptChartTimeframe?: (slot: AnySlot) => void;
}

/** 入る前に決めた LC の欄（読み取りの後・読み取りのキャンセルの後のフォーカスの行き先） */
const LC_ID = 'record-lc';
const IDS = partIds('record');

/**
 * シートを閉じた後に LC の欄へ移すか。使えない欄と、「なし」「最大損失まで」で止めた欄（readOnly。#171）は避けて要約の ［編集］ へ
 * （止めた欄はフォーカスでは外れないが、前の disabled のときと同じ行き先にする）
 */
export function lcTakesFocus(lc: {
  readonly disabled: boolean;
  readonly readOnly: boolean;
}): boolean {
  return !lc.disabled && !lc.readOnly;
}

/**
 * シートを閉じた後、フォーカスが body に落ちていたら LC（使えなければ要約の ［編集］）へ。開いたボタンへ戻せた・ほかへ移した
 * ときは何もしない
 */
function focusAfterSheet() {
  if (typeof document === 'undefined') return;
  const a = document.activeElement;
  if (a && a !== document.body) return;
  const lc = document.getElementById(LC_ID);
  const target =
    lc instanceof HTMLInputElement && lcTakesFocus(lc)
      ? lc
      : document.getElementById(IDS.editFields);
  target?.focus({ preventScroll: true });
}
const MANUAL_ID = 'record-manual';
const MORE_ROW_ID = 'record-more';
const TZ_OPEN_ID = 'record-tz-open';
const TZ_MARK_ID = 'record-tz-mark';
const VERDICT_LINE_ID = 'record-verdict-line';
/** 取引の欄のシートの段 2（ほかの欄）の戻るの層 */
const MORE_LAYER = `${SHEET_ID.fields}~more`;
/** 借り直した書きかけの 1 行（#75） */
export const RESUMED_ID = 'record-resumed';
const SUBMIT_ID = 'record-submit';
const STATEMENT_FILE_ID = 'record-statement-file';
const STATEMENT_NOTICE_ID = 'record-statement-notice';
const VERDICT_HINT_ID = 'record-verdict-hint';
const STATEMENT_TITLE_ID = 'record-statement-title';
/** 明細の行の動きの印を外すまでの時間（動きは --dur-base = 200ms 以下。animationend が来なかったときの保険。#166） */
const READ_FLASH_CLEAR_MS = 600;
/** 2 段目の明細の行の状態の文の読み上げの領域（#166） */
export const STATEMENT_STATUS_ID = 'record-statement-status';
/** 1 段目の見出し（段の移り・次の取引のフォーカスの行き先） */
const STAGE1_TITLE_ID = 'record-stage1-title';
/** 1 段目の ［読み取りをキャンセル］（読み取り中に 1 段目へ戻ったとき） */
export const STAGE1_CANCEL_ID = 'record-stage1-cancel';
/** 1 段目の明細の枠の ［削除］ と、削除の後の ［元に戻す］（#184） */
export const STATEMENT_REMOVE_ID = 'record-statement-remove';
export const STATEMENT_UNDO_ID = 'record-statement-undo';
/** 削除の後の 1 行（#184 R3。何が消えて何が残るかを言う。デザインレビュー 2） */
export const STATEMENT_REMOVED = '明細の値を削除しました。LC・一言・タップ・チャートは残っています';
/** 上の帯の ［スクショ］・1 段目の ［振り返りへ進む］・2 段目の ［スクショを選ぶ］ */
const TO_INPUT_ID = 'record-to-input';
const PROCEED_ID = 'record-proceed';
const REPICK_ID = 'record-repick';
/** 2 段目の ［入れ替える］（#232） */
export const BULK_SWAP_ID = 'record-bulk-swap';
const CHART_NOTICE_ID = 'record-chart-notice';
const STATEMENT_ROW_ID = 'record-statement-row';
const TZ_NAME = 'record-tz';
const TZ_OTHER_ID = 'record-tz-other';
const chartBoxId = (slot: AnySlot) => boxId('record', slot);

/**
 * 送る前の注意（枠に常に出す。畳まない・ダイアログにしない。R10・設計書 7.5・C38）。3 つの中身（AI の提供元に送る・
 * 口座番号などを切り取る・画像を保存しない）を 2 文にまとめ、幅 360px で 3 行以下にする（Issue #33 AC-4）。
 * チャートの注意はチャートの枠の見出しの下に別に出す（#27。チャートは記録と一緒に保存するので主語を分ける）
 */
export const STATEMENT_NOTICE = [
  '明細の画像は AI の提供元（Anthropic）に送って読み取り、保存しません。',
  '口座番号・氏名は切り取ってから貼り付けてください。',
] as const;

/** 注意の「i」の中（畳んでよい補足。3 つの中身は上の注意に常に出ている。#57） */
export const STATEMENT_NOTICE_MORE =
  '読み取った値は欄に入ります。確認してから記録してください。画像はこのアプリにも端末にも保存しません。';

/** 注意の「i」の言葉（ボタンの名前「「明細の送り方」の説明」） */
export const STATEMENT_INFO_LABEL = '明細の送り方';
/**
 * 明細の注意の「i」の説明のシートの ID（InfoTip の panelId になる）。説明のシートは記録する画面のシート（`record-` で始まる
 * 取引の欄・判定など）と別の層なので、`record-` で始めない（ui:check は `record-` のシートを説明のシートとして数えない。
 * Issue 130 の版では「説明（明細）」の状態が全部の窓で開けなかった）
 */
const STATEMENT_INFO_ID = 'statement-info';

export function RecordView(p: RecordViewProps) {
  const { state } = p;
  const blocked = state.readBlocked ? (
    <p class="statement__text" role="status">
      {state.readBlocked}
    </p>
  ) : null;
  if (state.phase === 'loading') {
    return (
      <>
        <p class="loading" role="status">
          読み込んでいます…
        </p>
        {blocked}
      </>
    );
  }
  if (state.phase === 'loadFailed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {state.error}
        </p>
        {blocked}
        <div>
          {state.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              再読み込み
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
  const charts = Object.keys(saved.trade.charts ?? {}).length;
  return (
    <div class="record">
      <Verdict
        summary={saved.summary}
        side={r.side}
        status={savedText(saved.accountCount, saved.accountName)}
        caption={`${saved.instrumentName} · ${r.side === 'L' ? 'L ロング' : 'S ショート'} · イン ${formatPrice(entry.price)} → 決済 ${formatPrice(r.exit.price)} · 数量 ${formatQuantity(entry.quantity)}`}
        {...(() => {
          // 保存の後の 1 行: チャートの枚数と、明細の口座を覚えたこと（#66 デザイン 5）
          const notes = [
            ...(charts > 0 ? [`チャート ${charts} 枚も保存しました`] : []),
            ...(saved.learned ? [learnedText(saved.accountName)] : []),
          ];
          return notes.length > 0 ? { note: notes.join('。') } : {};
        })()}
      />
      {/* シートを閉じた後に送りが失敗したとき（#156。シートの中なら中に出す） */}
      {p.emotion?.error && p.sheet?.kind !== 'emotion' ? (
        <p class="notice notice--error" role="alert">
          {p.emotion.error}
        </p>
      ) : null}
      {/* 保存の後はボタン 1 つなので帯（カード）に包まず、判定の枠の下に直に置く */}
      <Button block icon="record" onClick={p.onNext}>
        次の取引を記録
      </Button>
      {p.emotion ? (
        <Sheet
          id={SHEET_ID.emotion}
          open={p.sheet?.kind === 'emotion'}
          kind="form"
          title={emotionSheetTitle((saved.trades ?? [saved.trade]).length)}
          onDismiss={() => p.onSheet?.(null)}
        >
          <EmotionSheetBody
            prefix="record"
            context="saved"
            state={p.emotion}
            verdicts={savedVerdicts(saved)}
            {...(p.emotionHidden ? { hidden: p.emotionHidden } : {})}
            {...(p.emotionShort ? { short: p.emotionShort } : {})}
            onToggle={(id) => p.onEmotionToggle?.(id)}
            onClose={() => p.onSheet?.(null)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

/** 保存の後のシートの上の判定（1 件は今の判定の枠と同じ値、複数行は保存した行ごと。#156） */
function savedVerdicts(saved: NonNullable<RecordState['saved']>): SavedVerdict[] {
  const trades = saved.trades ?? [saved.trade];
  return trades.map((t) => {
    const s = t.id === saved.trade.id ? saved.summary : summarize(t);
    // 判定の理由の先頭の 1 つ（1 件のときシートに出す。心理を選ぶ手がかり = 何が崩れたか）
    const first = s.judgment?.reasons[0];
    const reason = first
      ? reasonText(first, t.record.side, s.option?.maxLossPlan ? { maxLossPlan: true } : {})
      : undefined;
    return {
      grade: s.judgment?.grade ?? null,
      ...(s.r === undefined ? {} : { r: s.r }),
      ...(reason ? { reason } : {}),
    };
  });
}

/**
 * 記録する画面の 1 画面の形（#130。設計書 K17・9.2・ui-guidelines 9.4）。上から 明細の場所（3 つの状態）・チャートの 2 枠と
 * 注意・LC と一言・決済までの行動のタップ、下の帯に判定の 1 行と ［記録する］。取引の欄・タイムゾーン・判定・チャートの詳細は下のシート。
 * 形（縦・横・広い）が替わっても同じ木を描く（形は CSS だけが知る。9.5）
 */
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
  const errorFields = (Object.keys(e) as (keyof typeof e)[]).filter((k) => e[k] !== undefined);
  const errorLabels = [...new Set(errorFields.map((k) => FIELD_LABEL[k]))];
  const marks = state.statement?.marks ?? {};
  // 押せない理由（判定のシートの案内。[記録する] の読み上げの説明に結ぶ）
  const reason = blockReason(read, errorLabels);
  // 3 つ目のタップの答えとチャートの時間足の違いの食い違い（#27。責めずに事実として並べる）
  const conflict = timeframeConflict(d.timeframeChange, read.preview.judgment?.reasons ?? []);
  const describe = !read.canSave && reason !== null ? VERDICT_HINT_ID : undefined;
  // 口座（#47）: 選んでいる口座と、2 つ以上のときの判定の枠の 1 行（U10）
  const accountId = selectedAccountId(d.accountId);
  const account = findAccount(accountId, state.accounts);
  const accountLine =
    hasManyAccounts(state.accounts) && account
      ? verdictAsideText(account.name, account.capitalYen, {
          ...(account.currency ? { currency: account.currency } : {}),
        })
      : undefined;
  // 通貨と為替（#47 PR-2）: 明細の損益の通貨が口座と合わない・読めないときは、損益・手数料の下に理由（#66・R6・C3・C5・C6）
  const accountCurrency = read.currency?.account ?? 'JPY';
  const st = state.statement;
  const row = st?.phase === 'ready' ? st.rows[st.index] : undefined;
  const moneyNote = row
    ? pnlFillOf(row.pnlCurrency, accountCurrency, account?.name ?? '口座', read.currency?.price)
        .note
    : undefined;
  // 口座の欄の下の 1 行（#66 デザイン 1・3b・4）: 通貨の合う口座の案内か、覚えの無い明細の「選んでください」
  const accountHint = row
    ? accountHintOf({
        accounts: state.accounts,
        accountId: d.accountId,
        pnlCurrency: row.pnlCurrency,
        firstTime: st?.firstTime === true,
      })
    : undefined;
  const currency = read.currency
    ? currencyView(read.currency, read.preview.derivedFx, moneyNote)
    : undefined;
  const tzNeed = st?.phase === 'ready' ? timeZoneNeed(st.tz, marks) : null;
  const line = verdictLine(read, errorLabels, tzNeed === 'choose');
  const sheet = p.sheet ?? null;
  const openSheet = (s: RecordSheet | null) => p.onSheet?.(s);
  // オプションのポジション（#117。銘柄の商品の形がオプション）: 足の行・[＋ 足] は取引の欄のシートの段 2（足 1 本の欄）
  const legAt = sheet?.kind === 'fields' && sheet.step === 'leg' ? (sheet.leg ?? 0) : null;
  const legIndex = legAt !== null && d.legs[legAt] !== undefined ? legAt : null;
  const openLeg = (i: number) => openSheet({ kind: 'fields', step: 'leg', leg: i });
  const setLegs = (value: typeof d.legs) => onUpdate({ type: 'set', field: 'legs', value });
  // 明細のポジション（#118）: 次の同じ原資産のポジションの足の本数と、今のポジションの明細の足の本数
  const unitsNow = st?.phase === 'ready' ? st.units : undefined;
  const nextPosition =
    st?.phase === 'ready' && st.raw && unitsNow
      ? nextPositionView(st.raw, unitsNow, st.index)
      : null;
  const unitLegCount = st?.phase === 'ready' ? (unitsNow?.[st.index]?.length ?? 0) : 0;
  const fields: TradeFieldsProps = {
    draft: d,
    errors: e,
    instruments: state.instruments,
    marks,
    onUpdate,
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
            nextPosition,
            legNotice: p.legNotice ?? null,
            ...(p.onMergeNext ? { onMergeNext: p.onMergeNext } : {}),
          },
        }
      : {}),
  };
  const step2 = sheet?.kind === 'fields' && (sheet.step === 'more' || legIndex !== null);
  const choice = accountChoiceKind(state.accounts.length);
  const add = state.addAccount;
  const stage = stageOf(state);

  return (
    <form
      class={`record record--one record--${stage}`}
      data-stage={stage}
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
        <legend class="sr-only">取引の記録</legend>

        {p.resumedAt != null ? (
          <p class="draft__resumed" id={RESUMED_ID}>
            {resumedNote('record', p.resumedAt, p.now ?? Date.now(), exitTimeKept(state))}
          </p>
        ) : null}

        {stage === 'input' ? (
          <StageInput {...p} />
        ) : (
          <>
            {/* 入れたもののカード（明細の要約の行・口座・チャートの行。#117 の足の欄は取引の欄のシートの中 = 段 leg） */}
            <div class="rinput">
              <StatementArea
                {...p}
                tzNeed={tzNeed}
                accountField={
                  choice === 'segment' && !add ? (
                    <AccountField
                      accounts={state.accounts}
                      value={accountId}
                      onChange={set('accountId')}
                      {...(accountHint ? { hint: accountHint } : {})}
                      {...(marks.accountId ? { mark: MARK_LABEL[marks.accountId] } : {})}
                    />
                  ) : null
                }
                accountChip={choice === 'select' && account ? account.name : null}
              />
              <BulkNotes {...p} />
              <ChartRowView {...p} />
            </div>

            <div class="record__lc">
              <LcFields {...fields} />
            </div>

            <div class="record__taps">
              <TapFields {...fields} timeframeHint={conflict?.tapHint ?? null} moveHintInInfo />
              {read.preview.showGapSlip ? (
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
          </>
        )}

        {/* 取引の欄（要約の ［編集］・名指しの欄・［明細なしで手入力］）。段 2 = ほかの欄（任意） */}
        <Sheet
          id={SHEET_ID.fields}
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
                onChange={(leg) =>
                  setLegs(d.legs.map((x, i) => (i === legIndex ? editLeg(x, leg) : x)))
                }
                {...(p.onSplitLeg && d.legs[legIndex]?.read && unitLegCount >= 2
                  ? { onSplit: () => p.onSplitLeg?.(legIndex) }
                  : {})}
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
              <StatementDetails {...p} />
              <div class="section__head record__accounthead">
                <span class="section__title" id="record-trade-title">
                  取引
                </span>
                <AccountAddButton
                  open={add !== undefined}
                  busy={add?.saving === true}
                  onOpen={() => p.onOpenAddAccount?.()}
                  onClose={() => p.onCloseAddAccount?.()}
                />
              </div>
              <TradeCoreFields
                {...fields}
                accounts={choice === 'select' ? state.accounts : []}
                accountId={accountId}
                {...(choice === 'select' && accountHint ? { accountHint } : {})}
                {...(add
                  ? {
                      accountAdd: (
                        <AccountAddForm
                          state={add}
                          onField={(f, v) => p.onNewAccount?.(f, v)}
                          onAdd={() => p.onAddAccount?.()}
                          onClose={() => p.onCloseAddAccount?.()}
                          onRelogin={p.onRelogin}
                        />
                      ),
                    }
                  : {})}
              />
              <RowLink
                id={MORE_ROW_ID}
                onClick={() => openSheet({ kind: 'fields', step: 'more' })}
                meta={moreMeta(d, marks, e, read.option?.lossPlanUp === false)}
              >
                ほかの欄（任意）
              </RowLink>
            </div>
          )}
        </Sheet>

        <Sheet
          id={SHEET_ID.tz}
          open={sheet?.kind === 'tz' && tzNeed !== null}
          kind="form"
          title={TZ_TEXT.legend}
          onDismiss={() => openSheet(null)}
        >
          {st?.phase === 'ready' && st.tz && row && tzNeed !== null ? (
            <TzChoices tz={st.tz} row={row} {...p} />
          ) : null}
        </Sheet>

        <Sheet
          id={SHEET_ID.chart}
          open={sheet?.kind === 'chart'}
          kind="form"
          title="チャート"
          onDismiss={() => openSheet(null)}
        >
          <ChartPanel
            idPrefix="record"
            title="チャート（任意）"
            charts={state.charts}
            extras={state.extras ?? []}
            timeframes={{ entry: d.entryChartTimeframe, exit: d.exitChartTimeframe }}
            blocked={state.chartBlocked}
            {...(p.onPickChart ? { onPick: p.onPickChart } : {})}
            {...(p.onRemoveChart ? { onRemove: p.onRemoveChart } : {})}
            {...(p.onAcceptChartTimeframe ? { onAccept: p.onAcceptChartTimeframe } : {})}
            {...(p.onAddExtraChart ? { onAddExtra: p.onAddExtraChart } : {})}
            {...(p.onExtraNote ? { onNote: p.onExtraNote } : {})}
            onTimeframe={(slot, value) => {
              if (isMainSlot(slot)) {
                onUpdate({ type: 'set', field: CHART_TIMEFRAME_FIELD[slot], value });
              } else {
                p.onExtraTimeframe?.(slot, value);
              }
            }}
          />
        </Sheet>

        <Sheet
          id={SHEET_ID.verdict}
          open={sheet?.kind === 'verdict'}
          kind="info"
          title="判定"
          onDismiss={() => openSheet(null)}
        >
          <Verdict
            summary={read.preview}
            side={read.option?.autoSide ?? side ?? 'L'}
            {...(accountLine === undefined ? {} : { account: accountLine })}
            pending={read.preview.judgment === undefined}
            hasErrors={errorFields.length > 0}
            hint={reason}
            hintId={VERDICT_HINT_ID}
            chartConflict={conflict?.verdictLine ?? null}
          />
        </Sheet>
      </fieldset>

      {stage === 'input' ? (
        <StageInputFoot {...p} />
      ) : (
        <div class="record__submit record__submit--bar">
          <SaveError {...p} />
          <VerdictLineButton
            id={VERDICT_LINE_ID}
            line={line}
            status={line.kind === 'status' ? line.text : submitStatus(read, errorLabels)}
            disabled={saving}
            onOpen={() => openSheet({ kind: 'verdict' })}
          />
          <Button
            type="submit"
            id={SUBMIT_ID}
            icon="record"
            block
            disabled={!read.canSave || saving}
            {...(describe ? { describedBy: describe } : {})}
          >
            {saving
              ? Object.values(state.charts ?? {}).some((c) => c?.phase === 'ready')
                ? 'チャートを送っています…'
                : '記録しています…'
              : '記録する'}
          </Button>
        </div>
      )}
    </form>
  );
}

/**
 * 保存の失敗の文（2 段目の下の帯と、1 段目の下の端。失敗の後に ［スクショ］ で 1 段目へ戻っても見える。2 段化のレビュー指摘 1）
 */
function SaveError(p: RecordViewProps) {
  const { state } = p;
  return state.error ? (
    <div class="notice notice--error" role="alert">
      <p>{state.error}</p>
      {state.errorKind === 'auth' ? (
        <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
          もう一度ログイン
        </Button>
      ) : null}
    </div>
  ) : null;
}

/** 「ほかの欄（任意）›」の行の右の添え（誤り → 読み取りの値 → 入れた欄の数。無ければ出さない） */
function moreMeta(
  d: RecordState['draft'],
  marks: Marks,
  errors: RecordState['read']['errors'],
  /** LC での損失の見込みが「ほかの欄」にある（オプションの形で、LC の枠に上げていない。#117） */
  lossPlanInMore = false,
): string | null {
  if (OPTIONAL_FIELDS.some((f) => errors[f] !== undefined)) return '誤りあり';
  if (lossPlanInMore && errors.lcLossPlan !== undefined) return '誤りあり';
  if (marks.pnlYen || marks.feeYen || marks.exitReason) return '読み取りあり';
  const filled = [d.pnlYen, d.feeYen].filter((v) => v.trim() !== '').length;
  return filled > 0 ? `${filled} 欄` : null;
}

/**
 * 2 段目の明細の行（同じ要素の中で 3 つの状態が入れ替わる。9.4）: 読み取り中 = 要約の骨組みと ［キャンセル］、読み取りの後 =
 * 要約 3 行と ［編集］・名指し・タイムゾーン・口座、やり直し = 読み取りの失敗・キャンセルで取引の値が無い（理由と
 * ［スクショを選ぶ］（1 段目へ）・［手入力で続ける］。選ぶ枠は 1 段目だけ。要約を通らずに記録できる経路は無い = 7.5）
 */
function StatementArea(
  p: RecordViewProps & {
    readonly tzNeed: 'choose' | 'chosen' | null;
    readonly accountField: ComponentChildren;
    readonly accountChip: string | null;
  },
) {
  const { state } = p;
  const st = state.statement;
  const area = statementRow({ statement: st, manual: state.manual, draft: state.draft });
  const open = (s: RecordSheet) => p.onSheet?.(s);
  const sum = area === 'summary' ? summaryOf(state) : null;
  // 状態の文（読み取り中… / 完了の文 / キャンセル。#166）。読み上げは下の領域が持ち、見える文は読み上げから外す
  const cancelled = state.readCancelled === true;
  const status = statementStatus(st, sum?.named.length ?? 0, cancelled);
  // 読み上げは終わった時点の文で止める（欄を埋めて数が減っても読み上げ直さない。10.2「1 つの出来事に知らせは 1 つ」。
  // 同じ Issue のコードレビュー 2）。見える文は今の数
  const spoken =
    status?.kind === 'done' && p.spokenNamed !== undefined
      ? statementStatus(st, p.spokenNamed, cancelled)
      : status;
  const message = statementMessage(st);
  // 次の行の知らせは名前の上の 1 行と上の読み上げの領域が持つ（#180）。ここは画像を受けられなかった知らせなどだけ
  const notices = <StatementNotices state={state} rowNotice={false} />;
  return (
    <section
      class={`rstmt${p.readFlash ? ' rstmt--flash' : ''}`}
      data-area={area}
      aria-labelledby={STATEMENT_TITLE_ID}
      onAnimationEnd={(e) => {
        if ((e.target as Element).classList.contains('rstmt__card')) p.onReadFlashEnd?.();
      }}
    >
      <h2 class="sr-only" id={STATEMENT_TITLE_ID} tabIndex={-1}>
        決済明細
      </h2>
      {/* 読み上げの領域は読み取り中から常に描き、中身だけを替える（3 つの形が入れ替わっても同じ要素。ui-guidelines 9.4・#166 R2） */}
      <p class="sr-only" role="status" id={STATEMENT_STATUS_ID} key="status">
        {spoken?.text ?? ''}
      </p>
      {area === 'retry' ? (
        <div class="rstmt__card rstmt__card--retry" key="card-retry">
          {message ??
            (status?.kind === 'cancelled' ? (
              <p class="rsum__l1 rstmt__cancelled" aria-hidden="true">
                {status.text}
              </p>
            ) : (
              <p class="rsum__l1">明細がありません</p>
            ))}
          <div class="rstmt__actions">
            <Button
              variant="secondary"
              id={REPICK_ID}
              icon="image"
              onClick={() => p.onStage?.('input')}
            >
              スクショを選ぶ
            </Button>
            <Button variant="secondary" id={MANUAL_ID} onClick={() => p.onManual?.()}>
              手入力で続ける
            </Button>
          </div>
          {notices}
        </div>
      ) : area === 'reading' ? (
        <div class="rstmt__card rstmt__card--sum" key="card-reading">
          {/* 要約と同じ形（名前の行と右のボタン + 全幅の 2 行。流れ込んでも LC が動かない。#164） */}
          <div class="rsum__text">
            <div class="rsum__head rsum__head--status">
              {/* 下の帯が「明細を読み取っています」と言うので、枠の中は短く（幅 360 でも切れない。#130 のデザインレビュー a2）。
                  読み取りの後の完了の文と同じ場所（名前の上の 1 行）。読み上げは上の領域（#166） */}
              <p class="rsum__status rsum__status--reading" aria-hidden="true">
                <span>{st?.rereading ? REREADING : '読み取り中…'}</span>
              </p>
              <p class="rsum__l1 rsum__skeleton rsum__skeleton--name" aria-hidden="true" />
              <Button
                variant="secondary"
                size="sm"
                label={st?.rereading ? REREAD_CANCEL_LABEL : '明細の読み取りをキャンセル'}
                onClick={() => p.onCancelRead?.()}
              >
                キャンセル
              </Button>
            </div>
            <p class="rsum__l2 rsum__skeleton" aria-hidden="true" />
            <p class="rsum__l3 rsum__skeleton rsum__skeleton--short" aria-hidden="true" />
          </div>
          {notices}
        </div>
      ) : (
        <RecordSummary
          key="card-summary"
          {...p}
          summary={sum as TradeSummary}
          status={status}
          message={message}
          notices={notices}
          onOpen={open}
        />
      )}
    </section>
  );
}

/**
 * 明細の失敗の決まった文言（読み取りの失敗と、別の明細の読み直しが失敗して前の明細に戻したとき。#184 R6）。無ければ null
 */
function statementMessage(st: RecordState['statement']): ComponentChildren {
  const text =
    st?.phase === 'failed' && st.message
      ? st.message
      : st?.reverted?.kind === 'failed'
        ? revertedMessage(st.reverted.message)
        : null;
  return text ? (
    <p class="notice notice--error" role="alert">
      {text}
    </p>
  ) : null;
}

/** 2 段目の要約（明細の行と、完了の文の数の hook の層が同じものを数える） */
function summaryOf(state: RecordState): TradeSummary {
  return tradeSummary(
    state.draft,
    state.read.errors,
    state.statement?.marks ?? {},
    state.read.option,
    state.read.currency?.account,
  );
}

/**
 * 画像を受けられなかった知らせと、明細の知らせ（「1 / 3 行目を記録しました」など）。明細の知らせは 1 段目の明細の枠の下だけ
 * （rowNotice）。2 段目は明細の行の名前の上の 1 行と常に描いた読み上げの領域に出す（#180。10.2「1 つの出来事に知らせは 1 つ」）
 */
function StatementNotices({
  state,
  rowNotice = true,
}: {
  readonly state: RecordState;
  readonly rowNotice?: boolean;
}) {
  const st = state.statement;
  return (
    <>
      {state.readBlocked ? (
        <p class="statement__text" role="status">
          {state.readBlocked}
        </p>
      ) : null}
      {rowNotice && st?.notice ? (
        <p class="statement__text" role="status">
          {st.notice}
        </p>
      ) : null}
      {/* 次の件も同じ原資産のポジション（#118 のレビュー指摘 1）: 記録した後は編集で足を追加するしかないので、記録の前に知らせる */}
      {st?.phase === 'ready' &&
      st.raw &&
      st.units &&
      nextPositionView(st.raw, st.units, st.index) ? (
        <p class="statement__text" id={NEXT_POSITION_NOTE_ID}>
          {NEXT_POSITION_NOTE}
        </p>
      ) : null}
    </>
  );
}

const NEXT_POSITION_NOTE_ID = 'record-next-position-note';
/** 2 段目の 1 行（取引の欄のシートの ［このポジションに入れる］ へ導く） */
export const NEXT_POSITION_NOTE =
  '次の件も同じ原資産です。同じポジションなら ［編集］ からまとめられます';

function RecordSummary(
  p: RecordViewProps & {
    readonly tzNeed: 'choose' | 'chosen' | null;
    readonly accountField: ComponentChildren;
    readonly accountChip: string | null;
    readonly summary: TradeSummary;
    readonly status: StatementStatus;
    readonly message: ComponentChildren;
    readonly notices: ComponentChildren;
    readonly onOpen: (s: RecordSheet) => void;
  },
) {
  return (
    <SummaryCard
      prefix="record"
      summary={p.summary}
      status={p.status}
      accountChip={p.accountChip}
      onFields={(focus) => p.onOpen({ kind: 'fields', step: 'main', ...(focus ? { focus } : {}) })}
    >
      {p.tzNeed ? (
        <div class="rsum__tz">
          {p.tzNeed === 'choose' ? (
            <span class="field__mark rsum__tzmark" id={TZ_MARK_ID}>
              {TZ_PENDING.mark}
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            id={TZ_OPEN_ID}
            {...(p.tzNeed === 'choose' ? { describedBy: TZ_MARK_ID } : {})}
            onClick={() => p.onOpen({ kind: 'tz' })}
          >
            {TZ_PENDING.button}
          </Button>
        </div>
      ) : null}
      {p.accountField ? <div class="rsum__accounts">{p.accountField}</div> : null}
      {p.message}
      {p.notices}
    </SummaryCard>
  );
}

/**
 * ［スクショを選ぶ］・［スクショを変更］（label + 画像だけのファイルの欄。選ぶと読み取りへ = 2 段目。同じファイルを選び直せるよう
 * 空に戻す）。1 段目の明細の枠だけに置く（明細を送る入口は 1 つ）
 */
function StatementPick(p: {
  readonly primary?: boolean;
  /** 小さい形（読めた後の ［スクショを変更］。［削除］ と 1 行に並べる。#184 のデザインレビュー 4） */
  readonly small?: boolean;
  readonly text: string;
  /**
   * まとめて選べる（明細が入る前の ［スクショを選ぶ］ だけ。#232・C67）。2 枚以上なら onPickFiles（選んだ順）、1 枚なら onPickFile
   */
  readonly multiple?: boolean;
  readonly onPickFile?: ((file: File) => void) | undefined;
  readonly onPickFiles?: ((files: File[]) => void) | undefined;
}) {
  return (
    <label
      class={`btn ${p.primary ? 'btn--primary' : 'btn--secondary'}${p.small ? ' btn--sm' : ''} rin__btn statement__file`}
      for={STATEMENT_FILE_ID}
    >
      <Icon name="image" />
      <span>{p.text}</span>
      <input
        id={STATEMENT_FILE_ID}
        class="statement__input"
        type="file"
        accept="image/png,image/jpeg,image/*"
        multiple={p.multiple === true}
        aria-describedby={STATEMENT_NOTICE_ID}
        onChange={(ev) => {
          const input = ev.currentTarget;
          // 選んだ順（端末の選択の画面が返す並び）のまま。空に戻す前に写す（同じファイルを選び直しても届くように空に戻す）
          const files = Array.from(input.files ?? []);
          input.value = '';
          if (files.length >= 2 && p.multiple && p.onPickFiles) p.onPickFiles(files);
          else if (files[0]) p.onPickFile?.(files[0]);
        }}
      />
    </label>
  );
}

/**
 * 取引の欄のシートの先頭の明細: プレビュー、複数行の ［この行をスキップ］（もう 1 枚を選ぶのは 1 段目の ［スクショを変更］。
 * シートは欄だけ。2026-11-21）
 */
function StatementDetails(p: RecordViewProps) {
  const st = p.state.statement;
  const rows = st?.phase === 'ready' ? st.rows.length : 0;
  const preview = st?.preview ?? null;
  return (
    <div class="statement rstmt__details">
      {preview ? (
        <canvas
          class="statement__preview"
          width={preview.width}
          height={preview.height}
          role="img"
          aria-label="貼り付けた明細のプレビュー"
          ref={(el: HTMLCanvasElement | null) => {
            if (el) preview.draw(el);
          }}
        />
      ) : null}
      {st && rows >= 2 ? (
        <div class="statement__rows">
          <p class="statement__row" id={STATEMENT_ROW_ID} tabIndex={-1}>
            {rowLabel(st.index, rows, rowUnitOf(st))}
          </p>
          <Button variant="secondary" onClick={() => p.onSkipRow?.()}>
            {st.rows[st.index]?.legs ? 'このポジションをスキップ' : 'この行をスキップ'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** チャートの枠の状態を、行・枠の文の入力に写す */
function chartLike(c: ChartState | undefined, timeframe: Timeframe | null): ChartLike {
  return {
    hasChart: c?.phase === 'ready',
    preparing: c?.phase === 'preparing',
    reading: c?.read === 'reading',
    failed: c?.phase === 'failed',
    timeframe: timeframe ? TIMEFRAME_NAME[timeframe] : null,
    suggest: c?.readSuggest ? TIMEFRAME_NAME[c.readSuggest] : null,
  };
}

/**
 * まとめて選んだときの 2 段目の 1 行（明細の行とチャートの行の間。#232・C67）: 明細が「明細として読めない」で相手の枠があれば
 * 「明細とチャートが逆かもしれません」と ［入れ替える］、枠が足りずに入れなかった枚数があればその 1 行。読み上げの領域は
 * 2 段目の入れたもののカードに常に描き、中身だけを替える（役割と中身を同時に出すと読み上げられないことがある。空なら高さ 0）
 */
function BulkNotes(p: RecordViewProps) {
  const { state } = p;
  const target = swapTargetOf({
    statement: state.statement,
    charts: state.charts,
    slots: state.bulkSlots ?? [],
  });
  const dropped = state.bulkDropped ?? 0;
  const name = target ? (isMainSlot(target) ? CHART_SLOT_TEXT[target].name : '追加') : '';
  return (
    <div class="rbulk" role="status">
      {target ? (
        <div class="rbulk__swap">
          <span class="rbulk__text">{BULK_SWAP_TEXT}</span>
          <Button
            variant="secondary"
            size="sm"
            id={BULK_SWAP_ID}
            label={bulkSwapLabel(name)}
            onClick={() => p.onSwapBulk?.()}
          >
            入れ替える
          </Button>
        </div>
      ) : null}
      {dropped > 0 ? <p class="rbulk__text rbulk__dropped">{bulkDroppedText(dropped)}</p> : null}
    </div>
  );
}

/** チャートを差し替えた知らせの文 */
export const replacedText = (slot: AnySlot) =>
  `${isMainSlot(slot) ? CHART_SLOT_TEXT[slot].name : '追加'}のチャートを差し替えました。`;

/**
 * 1 段目の見出しの下の案内（明細が入る前 / 入った後。デザインレビュー a1）。入る前は、まとめて選べることと選んだ順の決まり
 * （#232・C67。明細を選ぶとすぐ振り返りへ進むのは今のまま）
 */
export const STAGE1_LEAD = 'まとめて選べます。選んだ 1 枚目が明細、2 枚目からがチャートです。';
export const STAGE1_LEAD_FILLED = '明細は入っています。チャートは振り返りの画面でも追加できます。';

/**
 * 1 段目「スクショを入れる」（2026-11-21。K17・ui-guidelines 9.4）: 絵つきの大きな枠 2 つ（決済明細・チャート）と、その下に
 * 常に出す注意（C38）、［明細なしで手入力］（2 段目に見せるものがあれば ［振り返りへ進む］）。判定の帯・［記録する］ は置かない
 */
function StageInput(p: RecordViewProps) {
  const { state } = p;
  const d = state.draft;
  const st = state.statement;
  const s1 = stage1Statement(st);
  const filled = s1.kind === 'filled';
  const preview = filled ? (st?.preview ?? null) : null;
  const charts = state.charts ?? {};
  const anyChart = charts.entry !== undefined || charts.exit !== undefined;
  const message = statementMessage(st);
  const ready = st?.phase === 'ready';
  const removed = state.statementRemoved === true;
  return (
    <section class="rin" aria-labelledby={STAGE1_TITLE_ID}>
      <div class="rin__head">
        <h2 class="rin__title" id={STAGE1_TITLE_ID} tabIndex={-1}>
          スクショを入れる
        </h2>
        <p class="rin__lead">{filled ? STAGE1_LEAD_FILLED : STAGE1_LEAD}</p>
      </div>

      <div class={filled ? 'rin__card rin__card--filled' : 'rin__card'}>
        <div class="rin__body">
          <div class="rin__artwrap" aria-hidden="true">
            <div class="rin__art">
              {preview ? (
                <canvas
                  class="rin__preview"
                  width={preview.width}
                  height={preview.height}
                  ref={(el: HTMLCanvasElement | null) => {
                    if (el) preview.draw(el);
                  }}
                />
              ) : (
                <StatementArt />
              )}
            </div>
            {filled ? (
              <span class="rin__check">
                <Icon name="check" />
              </span>
            ) : null}
          </div>
          <div class="rin__text">
            <h3 class="rin__name">決済明細のスクショ</h3>
            {/* 状態の文の live region は常に描き、中身だけを替える（役割と中身を同時に替えると読み上げられないことがある。
              2 段化のレビュー指摘 3） */}
            {/* 削除の後は説明の文を下の 1 行（何が消えて何が残るか）に任せる（1 段目の縦 0px。#184） */}
            <p class={removed ? 'rin__desc sr-only' : 'rin__desc'} role="status">
              {filled ? s1.text : removed ? '' : '決済した後の、約定と損益が載っている画面'}
            </p>
            <div class="rin__acts">
              <StatementPick
                primary={!filled}
                small={filled}
                text={filled ? 'スクショを変更' : 'スクショを選ぶ'}
                multiple={!filled}
                onPickFile={p.onPickFile}
                onPickFiles={p.onPickFiles}
              />
              {/* 読めた明細だけを削除できる（読み取り中は ［読み取りをキャンセル］。#184 例 #11） */}
              {ready ? (
                <Button
                  variant="secondary"
                  size="sm"
                  id={STATEMENT_REMOVE_ID}
                  label="明細を削除"
                  onClick={() => p.onRemoveStatement?.()}
                >
                  削除
                </Button>
              ) : null}
            </div>
            {/* 読み取り中に 1 段目へ戻っても、ここでやめられる（2 段化のレビュー指摘 2） */}
            {stage1Reading(st) ? (
              <Button
                variant="secondary"
                size="sm"
                id={STAGE1_CANCEL_ID}
                label={st?.rereading ? REREAD_CANCEL_LABEL : '明細の読み取りをキャンセル'}
                onClick={() => p.onCancelRead?.()}
              >
                読み取りをキャンセル
              </Button>
            ) : null}
          </div>
        </div>
        {/* 削除の後の 1 行（その場の ［元に戻す］。押した ［削除］ のすぐ下 = 枠の本文の直後に、文と ［元に戻す］ を 1 つの面で。
            全画面のシートの中なのでトーストにしない = 足の削除と同じ形。P4・10.2・#184）。読み上げの領域は常に描き、中身だけを替える */}
        <div class="rin__removed" role="status">
          {removed ? (
            <>
              <span class="rin__removedtext">{STATEMENT_REMOVED}</span>
              <Button
                variant="secondary"
                size="sm"
                id={STATEMENT_UNDO_ID}
                label="明細の削除を元に戻す"
                onClick={() => p.onUndoRemoveStatement?.()}
              >
                元に戻す
              </Button>
            </>
          ) : null}
        </div>
        {/* 送る前の注意（畳まない・3 行以下。7.5・C38）。補足は末尾の「i」 */}
        <p class="statement__notice rin__notice">
          <span id={STATEMENT_NOTICE_ID}>{STATEMENT_NOTICE.join('')}</span>
          <InfoTip
            label={STATEMENT_INFO_LABEL}
            body={STATEMENT_NOTICE_MORE}
            id={STATEMENT_INFO_ID}
          />
        </p>
        {message}
        <StatementNotices state={state} />
      </div>

      <div class={anyChart ? 'rin__card rin__card--bare' : 'rin__card'}>
        {anyChart ? (
          <div class="rin__charts">
            <h3 class="rin__name">
              <ChartTitle />
            </h3>
            <div class="rcharts__grid">
              {CHART_SLOTS.map((slot) => (
                <MiniChart
                  key={slot}
                  prefix="record"
                  slot={slot}
                  chart={charts[slot]}
                  timeframe={slot === 'entry' ? d.entryChartTimeframe : d.exitChartTimeframe}
                  onPick={(f) => p.onPickChart?.(slot, f)}
                  markChanges={false}
                  onOpen={() => p.onSheet?.({ kind: 'chart' })}
                />
              ))}
            </div>
          </div>
        ) : (
          <div class="rin__body">
            <div class="rin__artwrap" aria-hidden="true">
              <div class="rin__art rin__art--chart">
                <CandleArt />
              </div>
            </div>
            <div class="rin__text">
              <h3 class="rin__name">
                <ChartTitle />
                <span class="field__optional">（任意）</span>
              </h3>
              <p class="rin__desc">根拠にした時間足のまま撮ったもの</p>
              <label
                class="btn btn--tonal rin__btn"
                id={miniChartId('entry')}
                for={`${miniChartId('entry')}-file`}
              >
                <Icon name="plus" />
                <span>チャートを選ぶ</span>
                <ChartFileInput
                  slot="entry"
                  describedBy={CHART_NOTICE_ID}
                  onPick={(f) => p.onPickChart?.('entry', f)}
                />
              </label>
            </div>
          </div>
        )}
        {/* 送る前の注意（畳まない 1 行。C38）。何のために送るか・保存することは末尾の「i」（#251） */}
        <p class="charts__notice rin__notice">
          <span id={CHART_NOTICE_ID}>{CHART_READ_NOTICE}</span>
          <InfoTip
            label={CHART_SEND_INFO.label}
            body={CHART_SEND_INFO.body}
            id={CHART_SEND_INFO.id}
          />
        </p>
        {state.chartBlocked ? (
          <p class="statement__text" role="status">
            {state.chartBlocked}
          </p>
        ) : null}
        <ChartReplaced text={p.chartReplaced} />
      </div>

      <p class="field__hint statement__pastehint">PC はこの画面に貼り付けることもできます。</p>
    </section>
  );
}

/** チャートの枠の題（「エントリーした足の / チャート」の語の切れ目でだけ折る。デザインレビュー a2） */
function ChartTitle() {
  return (
    <>
      <span class="rin__chunk">エントリーした足の</span>
      <span class="rin__chunk">チャート</span>
    </>
  );
}

/** 枠・行にフォーカスして貼り、チャートを差し替えた知らせ（黙って差し替えない。#130 の R1 の振る舞いはそのまま） */
function ChartReplaced({ text }: { readonly text?: string | null | undefined }) {
  return text ? (
    <p class="statement__text rchart__replaced" role="status">
      {text}
    </p>
  ) : null;
}

/**
 * 1 段目の下の端のボタン（フォームの下の端 = 2 段目の ［記録する］ と同じ所。デザインレビュー a3）。2 段目に見せる要約が
 * あれば ［振り返りへ進む］、無ければ ［明細なしで手入力］
 */
function StageInputFoot(p: RecordViewProps) {
  const { state } = p;
  const st = state.statement;
  const filled = stage1Statement(st).kind === 'filled';
  const proceed = showProceed({ statement: st, manual: state.manual, draft: state.draft });
  return (
    <div class="rin__foot">
      <SaveError {...p} />
      {proceed ? (
        <Button
          id={PROCEED_ID}
          block
          variant={filled ? 'primary' : 'secondary'}
          onClick={() => p.onStage?.('review')}
        >
          振り返りへ進む
        </Button>
      ) : (
        <>
          <p class="rin__footlead">スクショが無いとき</p>
          <Button
            variant="secondary"
            block
            class="rstmt__manual"
            id={MANUAL_ID}
            onClick={() => p.onManual?.()}
          >
            明細なしで手入力
          </Button>
        </>
      )}
    </div>
  );
}

/** チャートを選ぶファイルの欄（画像だけ。フォーカスして貼るとこの枠へ = data-chart-slot。R1） */
function ChartFileInput(p: {
  readonly slot: ChartSlot;
  readonly describedBy?: string;
  readonly onPick: (file: File) => void;
}) {
  const id = miniChartId(p.slot);
  return (
    <input
      id={`${id}-file`}
      class="statement__input"
      type="file"
      data-chart-slot={p.slot}
      aria-label={`${CHART_SLOT_TEXT[p.slot].name}のチャートを選ぶ`}
      {...(p.describedBy ? { 'aria-describedby': p.describedBy } : {})}
      accept="image/png,image/jpeg,image/*"
      onChange={(ev) => {
        const input = ev.currentTarget;
        const file = input.files?.[0];
        input.value = '';
        if (file) p.onPick(file);
      }}
    />
  );
}

/**
 * 2 段目のチャートの行（入れたもののカードの 2 行目。2026-11-21）: 空 = 小さなローソク足の絵と題とチャートの注意（C38）。
 * 行全体が押せて 1 タップでエントリー時のチャートを選ぶ。入った = 小さな写し・「エントリー時 · 時間足」・決済時の 1 行・›、
 * 押すとチャートのシート（時間足・差し替え・削除・決済時・追加のチャート）
 */
function ChartRowView(p: RecordViewProps) {
  const { state } = p;
  const d = state.draft;
  const charts = state.charts ?? {};
  const rowInput = {
    entry: chartLike(charts.entry, d.entryChartTimeframe),
    exit: chartLike(charts.exit, d.exitChartTimeframe),
    extras: (state.extras ?? []).length,
  };
  const row = chartRow(rowInput);
  // 画面は塊で描く（塊の間で折る。#212）。読み上げの名前は 1 行の文字（row）のまま
  const parts = chartRowParts(rowInput);
  const id = miniChartId('entry');
  const blocked = (
    <>
      {state.chartBlocked ? (
        <p class="statement__text rchartrow__blocked" role="status">
          {state.chartBlocked}
        </p>
      ) : null}
      <ChartReplaced text={p.chartReplaced} />
    </>
  );
  if (row.kind === 'full') {
    const c = charts.entry?.phase === 'ready' ? charts.entry : charts.exit;
    const preview = c?.phase === 'ready' ? c.preview : null;
    return (
      <>
        <button
          type="button"
          id={id}
          class="rchartrow rchartrow--full"
          data-chart-slot="entry"
          aria-haspopup="dialog"
          aria-label={`チャート: ${row.line1}。${row.line2}（チャートを開く）`}
          onClick={() => p.onSheet?.({ kind: 'chart' })}
        >
          <span class="rchartrow__thumb" aria-hidden="true">
            {preview ? (
              <canvas
                class="rchart__canvas"
                width={preview.width}
                height={preview.height}
                ref={(el: HTMLCanvasElement | null) => {
                  if (el) preview.draw(el);
                }}
              />
            ) : (
              <CandleArt small />
            )}
          </span>
          <span class="rchartrow__text">
            <span class="rchartrow__l1">
              {parts.kind === 'full' ? <LineParts parts={parts.line1} /> : row.line1}
            </span>
            <span class="rchartrow__l2">
              {parts.kind === 'full' ? <LineParts parts={parts.line2} /> : row.line2}
            </span>
          </span>
          <Icon name="chevron" class="rchartrow__chev" />
        </button>
        {blocked}
      </>
    );
  }
  return (
    <>
      <label class="rchartrow" id={id} for={`${id}-file`}>
        <span class="rchartrow__thumb rchartrow__thumb--empty" aria-hidden="true">
          <CandleArt small />
          <span class="rchartrow__plus">
            <Icon name="plus" />
          </span>
        </span>
        <span class="rchartrow__text">
          <span class="rchartrow__l1">
            {parts.kind === 'empty' && parts.status ? (
              <LineParts parts={parts.status} />
            ) : (
              'エントリーした足のチャート'
            )}
          </span>
          <span class="charts__notice rchartrow__notice" id={CHART_NOTICE_ID}>
            {CHART_READ_NOTICE}
          </span>
        </span>
        <ChartFileInput
          slot="entry"
          describedBy={CHART_NOTICE_ID}
          onPick={(f) => p.onPickChart?.('entry', f)}
        />
      </label>
      {blocked}
    </>
  );
}

/**
 * 明細の時刻の時間帯を選ぶ（#58 の後半）。押す前に、選択肢ごとに欄に入る日本時間を見せる。選ぶとすぐ当てる
 * （1 タップ）。選んだ後も残り、ほかを選べば明細の時刻から直し直す
 */
function TzChoices(p: RecordViewProps & { readonly tz: TzState; readonly row: ReadRow }) {
  const { tz, row } = p;
  // 横に出す日本時間は決済の時刻（無ければエントリーの時刻）。選んだ後は欄に入った値が見える
  const lines = tz.fields.flatMap((f) => {
    const t = row[f];
    return t ? [{ f, written: t.written }] : [];
  });
  const shown = lines.find((l) => l.f === 'exitTime') ?? lines[0];
  const result = (id: TzId) => (shown ? resultText(shown.written, id) : '');
  const isGap = (id: TzId) => lines.some((l) => wallToEpoch(l.written, id).kind === 'gap');
  const otherChecked = tz.otherOpen || (tz.choice !== null && isOtherZone(tz.choice));
  const otherValue = tz.choice !== null && isOtherZone(tz.choice) ? tz.choice : '';
  const rememberedGap = tz.remembered && tz.choice === null && tz.gap !== null;
  return (
    <fieldset class="statement__tz">
      <legend class="statement__tzlegend">{TZ_TEXT.legend}</legend>
      {/* 覚えたタイムゾーンでは存在しない時刻: 「直しました」は出さず、ほかを選ぶよう促す 1 行だけ */}
      <p class="statement__text" {...(rememberedGap ? { role: 'status' } : {})}>
        {rememberedGap && tz.gap !== null
          ? rememberedGapText(tz.gap)
          : tz.remembered && tz.choice !== null
            ? rememberedText(tz.choice)
            : TZ_TEXT.lead}
      </p>
      {lines.map((l) => (
        <p key={l.f} class="field__hint statement__tzwritten">
          {writtenLine(FIELD_LABEL[l.f], l.written)}
        </p>
      ))}
      <div class="tzopts">
        {MAIN_ZONES.map((z) => {
          const checked = !otherChecked && tz.choice === z.id;
          return (
            <label key={z.id} class="seg__item tzopt">
              <input
                class="seg__input"
                type="radio"
                name={TZ_NAME}
                value={z.id}
                checked={checked}
                onChange={() => p.onChooseTz?.(z.id)}
              />
              {checked ? <Icon name="check" class="seg__check" /> : null}
              <span class="tzopt__name">{z.name}</span>
              <span class="tzopt__result">{result(z.id)}</span>
            </label>
          );
        })}
        <label class="seg__item tzopt">
          <input
            class="seg__input"
            type="radio"
            name={TZ_NAME}
            value="other"
            checked={otherChecked}
            onChange={() => p.onOpenOtherZones?.()}
          />
          {otherChecked ? <Icon name="check" class="seg__check" /> : null}
          <span class="tzopt__name">{TZ_TEXT.other}</span>
        </label>
      </div>
      {otherChecked ? (
        <select
          id={TZ_OTHER_ID}
          class="select"
          aria-label={TZ_TEXT.otherSelect}
          value={otherValue}
          onChange={(ev) => {
            const v = OTHER_ZONES.find((z) => z.id === ev.currentTarget.value);
            if (v) p.onChooseTz?.(v.id);
          }}
        >
          <option value="" disabled>
            {TZ_TEXT.otherPlaceholder}
          </option>
          {OTHER_ZONES.map((z) => (
            <option key={z.id} value={z.id} disabled={isGap(z.id)}>
              {`${z.name} → ${result(z.id)}`}
            </option>
          ))}
        </select>
      ) : null}
      {/* 閉じた一覧は 360px で結果の時刻まで見えないので、選んだほかのタイムゾーンの結果は下に 1 行で出す */}
      {otherValue !== '' && shown && wallToEpoch(shown.written, otherValue).kind === 'ok' ? (
        <p class="field__hint statement__tzwritten">{otherResultLine(shown.written, otherValue)}</p>
      ) : null}
      {tz.gap !== null && !rememberedGap ? (
        <p class="statement__text" role="status">
          {gapText(tz.gap)}
        </p>
      ) : null}
    </fieldset>
  );
}
