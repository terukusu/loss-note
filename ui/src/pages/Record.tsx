// 記録する（Issue #13。手で入れて記録する。設計書 7.5 の流れ 3〜7・9.2、契約 R-4）。
// 1 画面の形（#130。設計書 0.4 K17・9.2 の記録するの行・docs/ui-guidelines.md 9.4）: 全画面のシートの中に、上から
// 明細の場所（選ぶ前・読み取り中・読み取りの後の 3 つの状態が同じ場所で入れ替わる）・チャートの 2 枠と注意（C38）・
// 入る前に決めた LC と一言・3 つのタップ、下の帯に判定の 1 行と [記録する]。LC・一言・3 つのタップは開いた直後から入れられ
// （C23）、読み取りの結果は要約の 2 行に流れ込むだけ。取引の欄・ほかの欄・タイムゾーン・判定・チャートの詳細は下のシート。
// 決済明細のスクショ（Issue #15）: 貼った・選んだ画像をすぐ読み取りへ送り、読み取りの値を同じ欄に印つきで入れる。
// 送る前の注意は選ぶ前の明細の場所に常に出す（ダイアログにしない）。プレビューは送るものと同じ画像を canvas に描く。
// 根拠の足のチャート（Issue #12）: エントリー時・決済時の 2 枠。枠を選んで（フォーカスして）貼る・枠を押して選ぶと
// その枠に入り、明細の読み取りには送らない（枠の外の貼り付けは今までどおり明細へ。R1）。チャートは [記録する] で取引と一緒に送る。
// 3 層: 純関数（lib/record-form.ts・lib/record-screen.ts）→ 通信と状態（lib/record-controller.ts）→ この画面（薄い）。
// Record は hook を持たない（App のテストが 1 段だけ呼ぶ）。RecordScreen が controller を購読し、開いているシートを持つ。
// 描画は hook を持たない RecordView に任せる（状態と操作の関数を受けて描くだけ。テストで直接呼べる）。
// 判定・R は core/ の結果だけを出す。色は判定の段（バッジと結果の枠）だけ、数字は無色（C34）。
// 形（縦・横・広い）が替わっても View を包む DOM は同じ（形は殻と CSS だけが知る。9.5。2 列は U10）
import type { ComponentChildren } from 'preact';
import '../styles/record.css';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { Icon } from '../components/Icon';
import { InfoTip } from '../components/InfoTip';
import { MiniCharts, SummaryCard, VerdictLineButton } from '../components/RecordParts';
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
import { timeframeConflict } from '../lib/chart-read';
import {
  type AnySlot,
  CHART_TIMEFRAME_FIELD,
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
import { formatPrice, formatQuantity } from '../lib/format';
import {
  createRecordController,
  enterRecordScreen,
  type RecordController,
  type RecordState,
  type TzState,
  watchVisible,
} from '../lib/record-controller';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS } from '../lib/record-form';
import {
  FIELD_INPUT_ID,
  focusLcAfterRead,
  type RecordSheet,
  SHEET_ID,
  statementArea,
  TZ_PENDING,
  timeZoneNeed,
  tradeSummary,
  verdictLine,
} from '../lib/record-screen';
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
  if (!ctx || !draft) return <RecordBarView title={title} saving={false} />;
  return (
    <RecordBarView
      title={title}
      saving={saving}
      rows={rows}
      onCancel={() => ctx.cancel(recordKey(), '/')}
    />
  );
}

/** 明細の行の進み具合（「1 / 2 行目」。行が 2 つ以上のときだけ。上の帯の右。9.3） */
function rowTextOf(s: RecordState | undefined): string | null {
  const st = s?.statement;
  if (st?.phase !== 'ready' || st.rows.length < 2) return null;
  return rowLabel(st.index, st.rows.length);
}

function useRowText(c: RecordController | undefined): string | null {
  const [text, setText] = useState(rowTextOf(c?.getState()));
  useEffect(() => c?.subscribe((s) => setText(rowTextOf(s))), [c]);
  return text;
}

export function RecordBarView(p: {
  readonly title: string;
  readonly saving: boolean;
  /** 明細の行の進み具合（「1 / 2 行目」） */
  readonly rows?: string | null;
  readonly onCancel?: () => void;
}) {
  return (
    <SheetBar
      title={p.title}
      {...(p.onCancel ? { onCancel: p.onCancel, cancelDisabled: p.saving } : { cancelHref: '/' })}
      {...(p.rows ? { end: <span class="appbar__meta num">{p.rows}</span> } : {})}
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
      setSheet(null);
      document.getElementById(VERDICT_TITLE_ID)?.focus();
      window.scrollTo({ top: 0 });
    } else if (before === 'saved' && state.phase === 'editing') {
      window.scrollTo({ top: 0 });
      document.getElementById(STATEMENT_TITLE_ID)?.focus({ preventScroll: true });
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

  // 明細の 1 行を保存して次の行へ移ったら、明細の場所へフォーカスを移す
  // （知らせ「i / N 行目を記録しました。次の行（…）です」は role="status" で読み上げる）
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

  // 取引の欄のシートの段 2（ほかの欄）は戻るの層を 1 段積む（戻る・Esc で段 1 へ。ui-guidelines 9.3・9.7）
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
    const want = sheet?.kind === 'fields' && sheet.step === 'more';
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
      onManual={() => {
        controller.startManual();
        onSheet({ kind: 'fields', step: 'main', focus: 'instrumentName' });
      }}
      onUpdate={onUpdate}
      onSave={() => {
        void controller.save();
      }}
      onNext={controller.next}
      {...(ctx ? { onCancel: () => ctx.cancel(recordKey(), '/') } : {})}
      resumedAt={resumedAt}
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
      onCancelRead={() => {
        controller.cancelRead();
        focusSoon(LC_ID);
      }}
      onChooseTz={(id) => {
        controller.chooseTimeZone(id);
        // 1 タップで当てて閉じる（その時間帯に無い時刻なら理由を出したまま開いておく）
        if (controller.getState().statement?.tz?.gap !== id) setSheet(null);
      }}
      // フォーカスは radio に残す（矢印キーで行き来できる。一覧は次の Tab）
      onOpenOtherZones={controller.openOtherZones}
      onPickChart={(slot, file) => {
        void controller.setChart(slot, file);
      }}
      onAcceptChartTimeframe={(slot) => {
        controller.acceptChartTimeframe(slot);
        // ボタンは消えるので時間足の欄へ
        focusSoon(`${chartBoxId(slot)}-tf`);
      }}
      onRemoveChart={(slot) => {
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
      onSkipRow={() => {
        controller.skipRow();
        // 最後の行を飛ばすとボタンは消える（読み取りを終えて空の下書き）。枠の見出しへ
        const st = controller.getState().statement;
        if (st?.phase !== 'ready') setSheet(null);
        focusSoon(st?.phase === 'ready' ? STATEMENT_ROW_ID : STATEMENT_TITLE_ID);
      }}
    />
  );
}

export interface RecordViewProps {
  readonly state: RecordState;
  /** 開いているシート（#130。省けばどれも閉じている） */
  readonly sheet?: RecordSheet | null;
  /** シートを開く・替える・閉じる（null） */
  readonly onSheet?: (sheet: RecordSheet | null) => void;
  /** ［明細なしで手入力］ */
  readonly onManual?: () => void;
  readonly onUpdate: (action: DraftAction) => void;
  readonly onSave: () => void;
  readonly onNext: () => void;
  /** [キャンセル]（#75）。帯の [記録する] の左に出す（幅 720 以上だけ。360 は見出しの右）。省けば出さない */
  readonly onCancel?: () => void;
  /** 離れていた書きかけを借り直した: 離れた時刻（見出しの下の「前の入力の続きです」。#75 デザイン 1）。省けば出さない */
  readonly resumedAt?: number | null;
  /** 今の時刻（「N 分前」。省けば Date.now） */
  readonly now?: number;
  readonly onReload: () => void;
  /** ログインが切れたとき: もう一度ログイン */
  readonly onRelogin: () => void;
  /** 明細の画像を選んだ（#15） */
  readonly onPickFile?: (file: File) => void;
  /** [やめて手で入れる] */
  readonly onCancelRead?: () => void;
  /** 明細の時刻の時間帯を選んだ（#58） */
  readonly onChooseTz?: (id: TzId) => void;
  /** [ほかのタイムゾーン…] */
  readonly onOpenOtherZones?: () => void;
  /** [この行を飛ばす] */
  readonly onSkipRow?: () => void;
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
const STATEMENT_INFO_ID = 'record-statement-info';

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
          読み込み中…
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
      {/* 保存の後はボタン 1 つなので帯（カード）に包まず、判定の枠の下に直に置く */}
      <Button block icon="record" onClick={p.onNext}>
        次の取引を記録
      </Button>
    </div>
  );
}

/**
 * 記録する画面の 1 画面の形（#130。設計書 K17・9.2・ui-guidelines 9.4）。上から 明細の場所（3 つの状態）・チャートの 2 枠と
 * 注意・LC と一言・3 つのタップ、下の帯に判定の 1 行と ［記録する］。取引の欄・タイムゾーン・判定・チャートの詳細は下のシート。
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
  const fields: TradeFieldsProps = {
    draft: d,
    errors: e,
    instruments: state.instruments,
    marks,
    onUpdate,
    ...(currency ? { currency } : {}),
  };
  const choice = accountChoiceKind(state.accounts.length);
  const add = state.addAccount;

  return (
    <form
      class="record record--one"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
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

        <MiniCharts
          prefix="record"
          charts={state.charts}
          timeframes={{ entry: d.entryChartTimeframe, exit: d.exitChartTimeframe }}
          blocked={state.chartBlocked}
          onPick={(slot, f) => p.onPickChart?.(slot, f)}
          onOpen={() => openSheet({ kind: 'chart' })}
        />

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

        {/* 取引の欄（要約の ［編集］・名指しの欄・［明細なしで手入力］）。段 2 = ほかの欄（任意） */}
        <Sheet
          id={SHEET_ID.fields}
          open={sheet?.kind === 'fields'}
          kind="form"
          title={
            sheet?.kind === 'fields' && sheet.step === 'more' ? 'ほかの欄（任意）' : '取引の欄'
          }
          lead={
            sheet?.kind === 'fields' && sheet.step === 'more' ? (
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
          focusKey={sheet?.kind === 'fields' ? sheet.step : 'none'}
          onDismiss={(reason) => {
            const up =
              sheet?.kind === 'fields' && sheet.step === 'more'
                ? sheetDismiss(reason, 1) === 'up'
                : false;
            openSheet(up ? { kind: 'fields', step: 'main' } : null);
          }}
        >
          {sheet?.kind === 'fields' && sheet.step === 'more' ? (
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
                meta={moreMeta(d, marks, e)}
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
            side={side ?? 'L'}
            {...(accountLine === undefined ? {} : { account: accountLine })}
            pending={read.preview.judgment === undefined}
            hasErrors={errorFields.length > 0}
            hint={reason}
            hintId={VERDICT_HINT_ID}
            chartConflict={conflict?.verdictLine ?? null}
          />
        </Sheet>
      </fieldset>

      <div class="record__submit record__submit--bar">
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
    </form>
  );
}

/** 「ほかの欄（任意）›」の行の右の添え（誤り → 読み取りの値 → 入れた欄の数。無ければ出さない） */
function moreMeta(
  d: RecordState['draft'],
  marks: Marks,
  errors: RecordState['read']['errors'],
): string | null {
  if (OPTIONAL_FIELDS.some((f) => errors[f] !== undefined)) return '誤りあり';
  if (marks.pnlYen || marks.feeYen || marks.exitReason) return '読み取りあり';
  const filled = [d.pnlYen, d.feeYen].filter((v) => v.trim() !== '').length;
  return filled > 0 ? `${filled} 欄` : null;
}

/**
 * 明細の場所（同じ要素の中で 3 つの状態が入れ替わる。9.4）: 選ぶ前 = 注意と ［スクショを選ぶ］ ［明細なしで手入力］、
 * 読み取り中 = 要約の骨組みと ［読み取りをキャンセル］、読み取りの後 = 要約 2 行と ［編集］・名指し・タイムゾーン・口座
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
  const area = statementArea({ statement: st, manual: state.manual, draft: state.draft });
  const marks = st?.marks ?? {};
  const open = (s: RecordSheet) => p.onSheet?.(s);
  const message =
    st?.phase === 'failed' && st.message ? (
      <p class="notice notice--error" role="alert">
        {st.message}
      </p>
    ) : null;
  const notices = (
    <>
      {state.readBlocked ? (
        <p class="statement__text" role="status">
          {state.readBlocked}
        </p>
      ) : null}
      {st?.notice ? (
        <p class="statement__text" role="status">
          {st.notice}
        </p>
      ) : null}
    </>
  );
  return (
    <section class="rstmt" data-area={area} aria-labelledby={STATEMENT_TITLE_ID}>
      <h2 class="sr-only" id={STATEMENT_TITLE_ID} tabIndex={-1}>
        決済明細
      </h2>
      {area === 'pick' ? (
        <div class="rstmt__card rstmt__card--pick">
          {/* 送る前の注意（畳まない・3 行以下。7.5・C38）。補足は末尾の「i」 */}
          <p class="statement__notice rstmt__notice">
            <span id={STATEMENT_NOTICE_ID}>{STATEMENT_NOTICE.join('')}</span>
            <InfoTip
              label={STATEMENT_INFO_LABEL}
              body={STATEMENT_NOTICE_MORE}
              id={STATEMENT_INFO_ID}
            />
          </p>
          <div class="rstmt__actions">
            <StatementPick primary onPickFile={p.onPickFile} />
            <Button
              variant="secondary"
              class="rstmt__manual"
              id={MANUAL_ID}
              onClick={() => {
                p.onManual?.();
              }}
            >
              明細なしで手入力
            </Button>
          </div>
          <p class="field__hint statement__pastehint">PC はこの画面に貼り付けることもできます。</p>
          {message}
          {notices}
        </div>
      ) : area === 'reading' ? (
        <div class="rstmt__card rstmt__card--sum">
          <div class="rsum__text">
            {/* 下の帯が「明細を読み取っています」と言うので、枠の中は短く（幅 360 でも切れない。#130 のデザインレビュー a2） */}
            <p class="rsum__l1 statement__reading" role="status">
              読み取り中…
            </p>
            <p class="rsum__l2 rsum__skeleton" aria-hidden="true" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            label="明細の読み取りをキャンセル"
            onClick={() => p.onCancelRead?.()}
          >
            キャンセル
          </Button>
          {notices}
        </div>
      ) : (
        <RecordSummary {...p} marks={marks} message={message} notices={notices} onOpen={open} />
      )}
    </section>
  );
}

function RecordSummary(
  p: RecordViewProps & {
    readonly tzNeed: 'choose' | 'chosen' | null;
    readonly accountField: ComponentChildren;
    readonly accountChip: string | null;
    readonly marks: Marks;
    readonly message: ComponentChildren;
    readonly notices: ComponentChildren;
    readonly onOpen: (s: RecordSheet) => void;
  },
) {
  const { state } = p;
  const sum = tradeSummary(state.draft, state.read.errors, p.marks);
  return (
    <SummaryCard
      prefix="record"
      summary={sum}
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

/** ［スクショを選ぶ］（label + 画像だけのファイルの欄。選ぶと読み取りへ。同じファイルを選び直せるよう空に戻す） */
function StatementPick(p: {
  readonly primary?: boolean;
  readonly onPickFile?: ((file: File) => void) | undefined;
}) {
  return (
    <label
      class={`btn ${p.primary ? 'btn--secondary rstmt__pick' : 'btn--secondary btn--sm'} statement__file`}
      for={STATEMENT_FILE_ID}
    >
      <Icon name="image" />
      <span>スクショを選ぶ</span>
      <input
        id={STATEMENT_FILE_ID}
        class="statement__input"
        type="file"
        accept="image/png,image/jpeg,image/*"
        aria-describedby={STATEMENT_NOTICE_ID}
        onChange={(ev) => {
          const input = ev.currentTarget;
          const file = input.files?.[0];
          // 同じファイルを選び直しても届くように空に戻す
          input.value = '';
          if (file) p.onPickFile?.(file);
        }}
      />
    </label>
  );
}

/**
 * 取引の欄のシートの先頭の明細（読み取りの後・手入力の後）: 送る前の注意と ［スクショを選ぶ］（もう 1 枚で読み直す）、
 * プレビュー、複数行の ［この行をスキップ］
 */
function StatementDetails(p: RecordViewProps) {
  const st = p.state.statement;
  const rows = st?.phase === 'ready' ? st.rows.length : 0;
  const preview = st?.preview ?? null;
  const area = statementArea({ statement: st, manual: p.state.manual, draft: p.state.draft });
  return (
    <div class="statement rstmt__details">
      {area === 'summary' ? (
        <>
          <p class="statement__notice">
            <span id={STATEMENT_NOTICE_ID}>{STATEMENT_NOTICE.join('')}</span>
          </p>
          <div class="statement__pick">
            <StatementPick onPickFile={p.onPickFile} />
          </div>
        </>
      ) : null}
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
            {rowLabel(st.index, rows)}
          </p>
          <Button variant="secondary" onClick={() => p.onSkipRow?.()}>
            この行をスキップ
          </Button>
        </div>
      ) : null}
    </div>
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
