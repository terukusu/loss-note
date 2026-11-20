// 記録する（Issue #13。手で入れて記録する。設計書 7.5 の流れ 3〜7・9.2、契約 R-4）。
// 決済明細のスクショを貼る枠（Issue #15）: 貼った・選んだ画像をすぐ読み取りへ送り、読み取りの値を同じ欄に印つきで入れる。
// 送る前の注意は枠に常に出す（ダイアログにしない）。プレビューは送るものと同じ画像を canvas に描く（object URL を作らない）。
// 根拠の足のチャートの枠（Issue #12）: エントリー時・決済時の 2 枠。枠を選んで（フォーカスして）貼る・[チャートを選ぶ] と
// その枠に入り、明細の読み取りには送らない（枠の外の貼り付けは今までどおり明細へ。R1）。チャートは [記録する] で取引と一緒に送る。
// 3 層: 純関数（lib/record-form.ts）→ 通信と状態（lib/record-controller.ts）→ この画面（薄い）。
// Record は hook を持たない（App のテストが 1 段だけ呼ぶ）。RecordScreen が controller を購読し、
// 描画は hook を持たない RecordView に任せる（状態と操作の関数を受けて描くだけ。テストで直接呼べる）。
// 判定・R は core/ の結果だけを出す。色は判定の段（バッジと結果の枠）だけ、数字は無色（C34）。
// 密度と階層（Issue #33）: 判定の枠は 3 つのタップのすぐ後。貼り付きの帯は 1 段（1 行の状態の文 + [記録する]）で、
// 欄の名前は判定の枠の案内に出す。タップの後に判定が出ていれば、判定の枠を見える範囲へ寄せる（フォーカスは動かさない）
// 口座（Issue #47 PR-1）: 口座が 2 つ以上なら「取引」の先頭に口座の欄と、判定の枠に「口座 A の資金 … に対して」の 1 行。
// 「取引」の見出しの行の右端の [＋ 口座を足す] で、その場で名前と資金だけで足せる（設定の画面に移らない）
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Side, Timeframe } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import {
  AccountAddButton,
  AccountAddForm,
  ADD_ACCOUNT_BUTTON_ID,
  NEW_ACCOUNT_NAME_ID,
} from '../components/AccountAdd';
import { ACCOUNT_FIELD_ID } from '../components/AccountField';
import { SheetBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { addExtraId, chartBoxId as boxId, ChartPanel } from '../components/ChartPanel';
import { Icon } from '../components/Icon';
import { InfoTip } from '../components/InfoTip';
import { Segment } from '../components/Segment';
import { TradeMainFields, TradeMoreFields } from '../components/TradeFields';
import { VERDICT_TITLE_ID, Verdict } from '../components/Verdict';
import {
  findAccount,
  hasManyAccounts,
  savedText,
  selectedAccountId,
  verdictAsideText,
} from '../lib/accounts';
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
import { accountHintOf, learnedText, pnlFillOf } from '../lib/statement-account';
import {
  imageFileFromClipboard,
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
import { blockReason, isTapAction, submitStatus } from '../lib/verdict-notes';
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
  if (!ctx || !draft) return <RecordBarView title={title} saving={false} />;
  return (
    <RecordBarView title={title} saving={saving} onCancel={() => ctx.cancel(recordKey(), '/')} />
  );
}

export function RecordBarView(p: {
  readonly title: string;
  readonly saving: boolean;
  readonly onCancel?: () => void;
}) {
  return (
    <SheetBar
      title={p.title}
      {...(p.onCancel ? { onCancel: p.onCancel, cancelDisabled: p.saving } : { cancelHref: '/' })}
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
    } else if (before === 'saving' && state.phase === 'editing' && state.error) {
      // 保存に失敗して戻った: 保存中は欄とボタンが無効でフォーカスが外れるので、押した [記録する] へ戻す
      // （失敗の文言は role="alert" で読み上げる。#5 のレビュー指摘 6）
      document.getElementById(SUBMIT_ID)?.focus();
    }
  }, [state.phase, state.error]);

  // 明細の 1 行を保存して次の行へ移ったら、枠の行の番号へスクロールしてフォーカスを移す
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
    const el = document.getElementById(STATEMENT_ROW_ID);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, [rowKey]);

  /** 押すと消えるボタンの後に、次に触る所へフォーカスを移す（描き直しの後） */
  const focusSoon = (id: string) => {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  };
  /** 口座を足せた後: 選ばれた口座の項目（Segment の選ばれた radio か select）へ（U7） */
  const focusAccount = () => {
    setTimeout(() => {
      const el =
        document.querySelector<HTMLElement>(`input[name="${ACCOUNT_FIELD_ID}"]:checked`) ??
        document.getElementById(ACCOUNT_FIELD_ID);
      el?.focus();
    }, 0);
  };

  /**
   * 3 つのタップ（と LC の「なし」）の後、判定が出ていれば判定のバッジと R の行を見える範囲へ寄せる（AC-3）。見えていれば
   * 動かさない（nearest）。動きを減らす設定では動きを付けない。フォーカスは押したタップに残す。上の帯・貼り付きの帯・
   * 下部の行き先の分は .verdict__stats / .verdict__head の scroll-margin で空ける
   */
  const onUpdate = (action: DraftAction) => {
    controller.update(action);
    if (!isTapAction(action)) return;
    if (controller.getState().read.preview.judgment === undefined) return;
    setTimeout(() => {
      // 寄せるのは判定のバッジと R の行まで（枠全体だと、理由が多いときに押したタップの枠が上へ隠れる）。
      // R・リスクの段の無い取引（LC なし）は枠ごと（枠が短い）
      const v = document.getElementById(VERDICT_TITLE_ID)?.closest('section');
      const target = v?.querySelector('.verdict__stats') ?? v;
      if (!target) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, 0);
  };

  return (
    <RecordView
      state={state}
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
        focusSoon(FIRST_FIELD_ID);
      }}
      onChooseTz={controller.chooseTimeZone}
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
        focusSoon(st?.phase === 'ready' ? STATEMENT_ROW_ID : STATEMENT_TITLE_ID);
      }}
    />
  );
}

export interface RecordViewProps {
  readonly state: RecordState;
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

const FIRST_FIELD_ID = 'record-instrument';
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
  // 畳んだ「ほかの欄」に誤りがあれば開いて見せる
  const optionalError = errorFields.some((k) => OPTIONAL_FIELDS.includes(k));
  // 明細の読み取りの印（読み取りの値は「ほかの欄」も開いて見せる。AC-4）
  const marks = state.statement?.marks ?? {};
  const hasReadMarks = Object.keys(marks).length > 0;
  // 押せない理由（判定の枠の案内。[記録する] の読み上げの説明に結ぶ）と、帯の 1 行の状態の文
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
  const add = state.addAccount;
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

        {p.resumedAt != null ? (
          <p class="draft__resumed" id={RESUMED_ID}>
            {resumedNote('record', p.resumedAt, p.now ?? Date.now(), exitTimeKept(state))}
          </p>
        ) : null}

        <StatementPanel {...p} />

        <TradeMainFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={marks}
          onUpdate={onUpdate}
          accounts={state.accounts}
          accountId={accountId}
          {...(accountHint ? { accountHint } : {})}
          {...(currency ? { currency } : {})}
          accountAction={
            <AccountAddButton
              open={add !== undefined}
              busy={add?.saving === true}
              onOpen={() => p.onOpenAddAccount?.()}
              onClose={() => p.onCloseAddAccount?.()}
            />
          }
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
          timeframeHint={conflict?.tapHint ?? null}
        />

        <Verdict
          summary={read.preview}
          side={side ?? 'L'}
          {...(accountLine === undefined ? {} : { account: accountLine })}
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
          hint={reason}
          hintId={VERDICT_HINT_ID}
          chartConflict={conflict?.verdictLine ?? null}
        />

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

        <TradeMoreFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={marks}
          onUpdate={onUpdate}
          {...(currency ? { currency } : {})}
          open={optionalError || hasReadMarks}
        />
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
        <p class="record__status" aria-live="polite">
          {submitStatus(read, errorLabels)}
        </p>
        <Button
          type="submit"
          id={SUBMIT_ID}
          icon="record"
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

/** 明細を貼る枠（注意・選ぶボタン・読み取りの状態・プレビュー・行の番号・時間帯の確かめ・失敗の文言） */
function StatementPanel(p: RecordViewProps) {
  const st = p.state.statement;
  const busy = st?.phase === 'preparing' || st?.phase === 'reading';
  const rows = st?.phase === 'ready' ? st.rows.length : 0;
  const row = st?.phase === 'ready' ? st.rows[st.index] : undefined;
  const tz = st?.phase === 'ready' && st.tz && row && tzVisible(st.tz, st.marks) ? st.tz : null;
  const preview = st?.preview ?? null;
  return (
    <section class="card section statement" aria-labelledby={STATEMENT_TITLE_ID}>
      <h2 class="section__title" id={STATEMENT_TITLE_ID} tabIndex={-1}>
        決済明細のスクショ
      </h2>
      {/* 補足は注意の文の末尾の「i」に（#57。3 つの中身は注意に常に出ている）。[スクショを選ぶ] の説明に結ぶのは文だけ */}
      <p class="statement__notice">
        <span id={STATEMENT_NOTICE_ID}>{STATEMENT_NOTICE.join('')}</span>
        <InfoTip label={STATEMENT_INFO_LABEL} body={STATEMENT_NOTICE_MORE} id={STATEMENT_INFO_ID} />
      </p>
      <div class="statement__pick">
        <label class="btn btn--secondary statement__file" for={STATEMENT_FILE_ID}>
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
        {/* キーの名前に頼らない言い方。指で触る端末（スマホ）では出さない（CSS の hover・pointer: fine だけで出す） */}
        <p class="field__hint statement__pastehint">PC はこの画面に貼り付けることもできます。</p>
      </div>
      {p.state.readBlocked ? (
        <p class="statement__text" role="status">
          {p.state.readBlocked}
        </p>
      ) : null}
      {busy ? (
        <div class="statement__status">
          <p class="statement__reading" role="status">
            明細を読み取っています…
          </p>
          <Button
            variant="secondary"
            label="明細の読み取りをキャンセル"
            onClick={() => p.onCancelRead?.()}
          >
            キャンセル
          </Button>
        </div>
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
      {tz && row ? <TzChoices tz={tz} row={row} {...p} /> : null}
      {st?.phase === 'failed' && st.message ? (
        <p class="notice notice--error" role="alert">
          {st.message}
        </p>
      ) : null}
      {st?.notice ? (
        <p class="statement__text" role="status">
          {st.notice}
        </p>
      ) : null}
    </section>
  );
}

/** 時間帯の確かめを出すか: 時間帯の無い欄のうち、利用者が欄を直していない（印が tz か選んだ時間帯で入れた read）欄がある */
function tzVisible(tz: TzState, marks: Marks): boolean {
  return tz.fields.some((f) => marks[f] === 'tz' || marks[f] === 'read');
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
