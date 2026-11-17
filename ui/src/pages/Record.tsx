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
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Side } from '../../../core/trade';
import { api, signOutActive } from '../auth/session';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import { TradeMainFields, TradeMoreFields } from '../components/TradeFields';
import { VERDICT_TITLE_ID, Verdict } from '../components/Verdict';
import {
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  CHART_TIMEFRAME_FIELD,
  type ChartSlot,
  chartSlotOf,
  isTimeframe,
  TIMEFRAME_CHOICES,
} from '../lib/charts';
import { formatPrice } from '../lib/format';
import {
  createRecordController,
  type RecordController,
  type RecordState,
} from '../lib/record-controller';
import { type DraftAction, FIELD_LABEL, OPTIONAL_FIELDS } from '../lib/record-form';
import {
  imageFileFromClipboard,
  needsTzCheck,
  type PasteTarget,
  rowLabel,
} from '../lib/statement-fill';
import { browserCodec, prepareImage } from '../lib/statement-image';
import { blockReason, isTapAction, submitStatus } from '../lib/verdict-notes';

export function Record() {
  return (
    <>
      <PageHeader title="記録する" />
      <RecordScreen />
    </>
  );
}

/** controller を作って購読する（画面を開くたびに作り直す。下書きは画面を離れると消える） */
export function RecordScreen() {
  const controller = useMemo<RecordController>(
    () =>
      createRecordController({
        api,
        now: () => Date.now(),
        prepare: (file) => prepareImage(file, browserCodec),
      }),
    [],
  );
  const [state, setState] = useState<RecordState>(controller.getState());
  const prevPhase = useRef(state.phase);

  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);

  // 画像の貼り付けは文字の欄の外ならどこでも受ける（画像があるときだけ横取りする）。文字の欄に貼ったときは、
  // 画像を含んでいても横取りせず普通の貼り付けに任せる（表計算のコピーは文字と画像の両方を持つ。R1）。
  // 画面を離れたら読み取りを止め、画像と残りの行を捨てる
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
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('paste', onPaste);
      controller.dispose();
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
      onConfirmTz={() => {
        controller.confirmTimeZone();
        focusSoon('record-exit-time');
      }}
      onPickChart={(slot, file) => {
        void controller.setChart(slot, file);
      }}
      onRemoveChart={(slot) => {
        controller.removeChart(slot);
        // [外す] の後は枠へフォーカスを戻す（ボタンは消える）
        focusSoon(chartBoxId(slot));
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
  readonly onReload: () => void;
  /** ログインが切れたとき: ログインし直す */
  readonly onRelogin: () => void;
  /** 明細の画像を選んだ（#15） */
  readonly onPickFile?: (file: File) => void;
  /** [やめて手で入れる] */
  readonly onCancelRead?: () => void;
  /** [日本時間で合っている] */
  readonly onConfirmTz?: () => void;
  /** [この行を飛ばす] */
  readonly onSkipRow?: () => void;
  /** チャートを枠に選んだ（#12） */
  readonly onPickChart?: (slot: ChartSlot, file: File) => void;
  /** チャートの [外す] */
  readonly onRemoveChart?: (slot: ChartSlot) => void;
}

const FIRST_FIELD_ID = 'record-instrument';
const SUBMIT_ID = 'record-submit';
const STATEMENT_FILE_ID = 'record-statement-file';
const STATEMENT_NOTICE_ID = 'record-statement-notice';
const VERDICT_HINT_ID = 'record-verdict-hint';
const STATEMENT_TITLE_ID = 'record-statement-title';
const STATEMENT_ROW_ID = 'record-statement-row';
const CHARTS_TITLE_ID = 'record-charts-title';
const chartBoxId = (slot: ChartSlot) => `record-chart-${slot}`;

/**
 * 送る前の注意（枠に常に出す。畳まない・ダイアログにしない。R10・設計書 7.5・C38）。3 つの中身（AI の提供元に送る・
 * 口座番号などを切り取る・画像を保存しない）を 2 文にまとめ、幅 360px で 3 行以下にする（Issue #33 AC-4）
 */
export const STATEMENT_NOTICE = [
  '明細は AI の提供元（Anthropic）に送って読み取り、画像は保存しません。',
  '口座番号・氏名は切り取って貼ってください。',
] as const;

/** 注意の「詳しく」の中（畳んでよい補足。3 つの中身は上の注意に常に出ている） */
export const STATEMENT_NOTICE_MORE =
  '明細の画像は AI の提供元（Anthropic）に送り、読み取った値を欄に入れます。値は確かめてから記録してください。画像はこのアプリにも端末にも保存しません。口座番号・氏名などは、端末の写真の編集で切り取ってから貼ってください。';

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
  const charts = CHART_SLOTS.filter((s) => saved.trade.charts?.[s] !== undefined).length;
  return (
    <div class="record">
      <Verdict
        summary={saved.summary}
        side={r.side}
        status="記録しました"
        caption={`${saved.instrumentName} · ${r.side === 'L' ? 'L ロング' : 'S ショート'} · イン ${formatPrice(entry.price)} → 決済 ${formatPrice(r.exit.price)} · 数量 ${formatPrice(entry.quantity)}`}
        {...(charts > 0 ? { note: `チャート ${charts} 枚も保存しました` } : {})}
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
  const describe = !read.canSave && reason !== null ? VERDICT_HINT_ID : undefined;

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

        <StatementPanel {...p} />

        <TradeMainFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={marks}
          onUpdate={onUpdate}
        />

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
          hint={reason}
          hintId={VERDICT_HINT_ID}
        />

        <ChartPanel {...p} />

        <TradeMoreFields
          draft={d}
          errors={e}
          instruments={state.instruments}
          marks={marks}
          onUpdate={onUpdate}
          open={optionalError || hasReadMarks}
        />
      </fieldset>

      <div class="record__submit record__submit--bar">
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
          {saving ? '記録しています…' : '記録する'}
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
  const tz = st?.phase === 'ready' && needsTzCheck(st.marks);
  const preview = st?.preview ?? null;
  return (
    <section class="card section statement" aria-labelledby={STATEMENT_TITLE_ID}>
      <h2 class="section__title" id={STATEMENT_TITLE_ID} tabIndex={-1}>
        決済明細のスクショ
      </h2>
      <p class="statement__notice" id={STATEMENT_NOTICE_ID}>
        {STATEMENT_NOTICE.join('')}
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
        <details class="statement__more">
          <summary class="statement__more-summary">詳しく</summary>
          <p class="statement__more-body">{STATEMENT_NOTICE_MORE}</p>
        </details>
        {/* キーの名前に頼らない言い方。指で触る端末（スマホ）では出さない（CSS の hover・pointer: fine だけで出す） */}
        <p class="field__hint statement__pastehint">PC はこの画面に貼り付けもできます。</p>
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
          <Button variant="ghost" onClick={() => p.onCancelRead?.()}>
            やめて手で入れる
          </Button>
        </div>
      ) : null}
      {preview ? (
        <canvas
          class="statement__preview"
          width={preview.width}
          height={preview.height}
          role="img"
          aria-label="貼った明細のプレビュー"
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
            この行を飛ばす
          </Button>
        </div>
      ) : null}
      {tz ? (
        <div class="statement__tz">
          <p class="statement__text">
            明細に時間帯が書かれていない時刻があります。書かれた時刻が日本時間なら押してください（違えば欄を直します）。
          </p>
          <Button variant="secondary" onClick={() => p.onConfirmTz?.()}>
            日本時間で合っている
          </Button>
        </div>
      ) : null}
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

/** 根拠の足のチャートの枠（エントリー時・決済時。#12 契約 UI-1） */
function ChartPanel(p: RecordViewProps) {
  return (
    // 外側のカードを持たない（見出し + 2 つの点線の枠。枠 → ボタン・canvas の 2 段。Issue #33 AC-5）
    <section class="section charts" aria-labelledby={CHARTS_TITLE_ID}>
      <h2 class="section__title" id={CHARTS_TITLE_ID}>
        根拠の足のチャート（任意）
      </h2>
      {p.state.chartBlocked ? (
        <p class="statement__text" role="status">
          {p.state.chartBlocked}
        </p>
      ) : null}
      <div class="charts__grid">
        {CHART_SLOTS.map((slot) => (
          <ChartBox key={slot} slot={slot} {...p} />
        ))}
      </div>
    </section>
  );
}

function ChartBox(p: RecordViewProps & { readonly slot: ChartSlot }) {
  const { slot } = p;
  const c = p.state.charts?.[slot];
  const text = CHART_SLOT_TEXT[slot];
  const id = chartBoxId(slot);
  const field = CHART_TIMEFRAME_FIELD[slot];
  const tf = p.state.draft[field];
  const preview = c?.phase === 'ready' ? c.preview : null;
  return (
    // 枠を選んで（クリック・Tab で）貼るとこの枠に入る（data-chart-slot を chartSlotOf が見る）
    <fieldset
      class="chart"
      id={id}
      data-chart-slot={slot}
      aria-describedby={`${id}-hint`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 貼り付けの行き先を選ぶために枠そのものにフォーカスを置く（R1）
      tabIndex={0}
    >
      <legend class="chart__name" id={`${id}-name`}>
        {text.name}
      </legend>
      <p class="chart__hint" id={`${id}-hint`}>
        {text.hint}
      </p>
      {c?.phase === 'preparing' ? (
        <p class="statement__reading" role="status">
          準備しています…
        </p>
      ) : null}
      {c?.phase === 'failed' && c.message ? (
        <p class="notice notice--error" role="alert">
          {c.message}
        </p>
      ) : null}
      {preview ? (
        <>
          <canvas
            class="chart__preview"
            width={preview.width}
            height={preview.height}
            role="img"
            aria-label={`${text.name}のチャートのプレビュー`}
            ref={(el: HTMLCanvasElement | null) => {
              if (el) preview.draw(el);
            }}
          />
          <div class="chart__row">
            <div class="field chart__tf">
              <label class="field__label" for={`${id}-tf`}>
                時間足（任意）
              </label>
              <select
                id={`${id}-tf`}
                class="select"
                value={tf ?? ''}
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
            <Button
              variant="ghost"
              label={`${text.name}のチャートを外す`}
              onClick={() => p.onRemoveChart?.(slot)}
            >
              外す
            </Button>
          </div>
        </>
      ) : c?.phase === 'preparing' ? null : (
        <div class="statement__pick">
          <label class="btn btn--secondary statement__file" for={`${id}-file`}>
            <Icon name="image" />
            <span>チャートを選ぶ</span>
            <input
              id={`${id}-file`}
              class="statement__input"
              type="file"
              aria-label={`${text.name}のチャートを選ぶ`}
              accept="image/png,image/jpeg,image/*"
              onChange={(ev) => {
                const input = ev.currentTarget;
                const file = input.files?.[0];
                input.value = '';
                if (file) p.onPickChart?.(slot, file);
              }}
            />
          </label>
          <p class="field__hint chart__pastehint">PC は枠を選んでから貼り付けもできます。</p>
        </div>
      )}
      <p class="chart__ready" aria-hidden="true">
        ここに貼れます
      </p>
    </fieldset>
  );
}
