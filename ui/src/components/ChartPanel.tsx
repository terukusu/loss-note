// チャートの枠（Issue #12 契約 UI-1・#27・#89）。記録する画面と編集の画面が同じものを使う（hook を持たない）。
// - エントリー時・決済時の 2 枠（720px 以上は横に 2 つ）と、追加のチャートの枠（追加した順・最大 5 枚）。追加は見出しの行の
//   右端の [＋ 追加]（480px 以上は「＋ チャートを追加」）だけで、記録する画面の全長を増やさない（記録の手間の予算）
// - 追加の枠は小見出し「追加のチャート（判定には使いません）」の下に分けて並べ、枠線も実線にする（2 枠は点線の受け口）
// - 枠を選んで（クリック・Tab で）貼るとこの枠に入る（data-chart-slot を chartSlotOf が見る）。[チャートを選ぶ]・
//   チャートのある枠の [差し替え] も同じ。[削除] は枠の右上
// - 時間足（任意）はチャートのある枠でだけ選べる。読み取りで埋めた値には印「チャートから」、選んだ値と違えば案
// - 追加の枠の一言（任意・40 字まで）はチャートのある枠だけ（画像の無い行の一言は保存されないので出さない）
// - 編集の画面（markChanges）: 変えた枠の名前の横に印「差し替え」「追加」、削除した保存済みの枠は「チャートなし（保存で
//   削除）」と [元に戻す]
import type { Timeframe } from '../../../core/trade';
import {
  CHART_READ_MARK,
  CHART_READ_NOTICE,
  CHART_SEND_INFO,
  suggestButton,
  suggestText,
} from '../lib/chart-read';
import { CHART_REMOVED, type ChartState, type ChartsState } from '../lib/chart-slots';
import {
  type AnySlot,
  CHART_SLOT_TEXT,
  CHART_SLOTS,
  type ChartSlot,
  EXTRA_FULL,
  EXTRA_NOTE_MAX,
  EXTRA_SLOTS,
  type ExtraEntry,
  type ExtraSlot,
  extraName,
  extraNoteTooLong,
  isTimeframe,
  TIMEFRAME_CHOICES,
} from '../lib/charts';
import { Button } from './Button';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';
import { TextField } from './TextField';

export interface ChartPanelProps {
  /** 要素の ID の頭（'record' / 'edit'） */
  readonly idPrefix: string;
  readonly title: string;
  readonly charts: ChartsState | undefined;
  readonly extras: readonly ExtraEntry[];
  /** エントリー時・決済時の時間足（下書き） */
  readonly timeframes: Readonly<Record<ChartSlot, Timeframe | null>>;
  /** 枠を変えられなかった知らせ */
  readonly blocked?: string | null | undefined;
  /** 編集の画面: 変えた枠の印と、削除した保存済みの枠の [元に戻す] を出す */
  readonly markChanges?: boolean;
  readonly onPick?: (slot: AnySlot, file: File) => void;
  readonly onRemove?: (slot: AnySlot) => void;
  readonly onRestore?: (slot: AnySlot) => void;
  readonly onAccept?: (slot: AnySlot) => void;
  readonly onTimeframe?: (slot: AnySlot, value: Timeframe | null) => void;
  readonly onNote?: (slot: ExtraSlot, note: string) => void;
  readonly onAddExtra?: () => void;
}

export const chartBoxId = (prefix: string, slot: AnySlot) => `${prefix}-chart-${slot}`;
export const addExtraId = (prefix: string) => `${prefix}-chart-add`;
export const restoreId = (prefix: string, slot: AnySlot) => `${prefix}-chart-${slot}-restore`;
/** 追加のチャートの小見出し（判定に使わないことを 1 回だけ言う。詳細の画面も同じ） */
export const EXTRA_TITLE = '追加のチャート（判定には使いません）';
export const EXTRA_HINT = '上位足・下位足・指標など';

/** 編集の画面の枠の印（状態の言葉。操作のボタンと見分ける。変えていなければ null） */
export function changeMark(c: ChartState | undefined): string | null {
  if (c?.phase === 'removed') return '削除（未保存）';
  if (c?.phase !== 'ready' || c.stored) return null;
  return c.replaced ? '差し替え済み' : '追加（未保存）';
}

/** [＋ 追加] を押せない（削除した保存済みの枠は 5 枚に数えない。デザインの再レビュー 7） */
export function extrasFull(
  extras: readonly ExtraEntry[],
  charts: ChartsState | undefined,
): boolean {
  return (
    extras.length >= EXTRA_SLOTS.length &&
    !extras.some((e) => charts?.[e.slot]?.phase === 'removed')
  );
}

export function ChartPanel(p: ChartPanelProps) {
  const titleId = `${p.idPrefix}-charts-title`;
  const full = extrasFull(p.extras, p.charts);
  return (
    // 外側のカードを持たない（見出し + 2 つの点線の枠。枠 → ボタン・canvas の 2 段。Issue #33 AC-5）
    <section class="section charts" aria-labelledby={titleId}>
      {/* [＋ 追加] は見出しの行の右端（[＋ 口座を足す] と同じ形。記録する画面の全長を増やさない。#89） */}
      <div class="section__head">
        <h2 class="section__title" id={titleId}>
          {p.title}
        </h2>
        <button
          type="button"
          id={addExtraId(p.idPrefix)}
          class="btn btn--tonal btn--sm section__action charts__add"
          aria-label="チャートを追加"
          disabled={full}
          {...(full ? { 'aria-describedby': `${addExtraId(p.idPrefix)}-full` } : {})}
          onClick={() => p.onAddExtra?.()}
        >
          {/* 幅 480px 未満は見出しと 1 行に収めるため「＋ 追加」（読み上げの名前は常に「チャートを追加」） */}
          <span aria-hidden="true">
            ＋ <span class="charts__addlong">チャートを</span>追加
          </span>
        </button>
      </div>
      {full ? (
        <p class="field__hint" id={`${addExtraId(p.idPrefix)}-full`}>
          {EXTRA_FULL}
        </p>
      ) : null}
      {/* 送る前の注意（常に出す 1 行。追加のチャートも時間足を読むために送る。C38・#27）。中身の補足は「i」（#251） */}
      <p class="charts__notice">
        {CHART_READ_NOTICE}
        <InfoTip
          label={CHART_SEND_INFO.label}
          body={CHART_SEND_INFO.body}
          id={CHART_SEND_INFO.id}
        />
      </p>
      {p.blocked ? (
        <p class="statement__text" role="status">
          {p.blocked}
        </p>
      ) : null}
      <div class="charts__grid">
        {CHART_SLOTS.map((slot) => (
          <ChartBox
            key={slot}
            {...p}
            slot={slot}
            name={CHART_SLOT_TEXT[slot].name}
            hint={CHART_SLOT_TEXT[slot].hint}
            chart={p.charts?.[slot]}
            timeframe={p.timeframes[slot]}
          />
        ))}
      </div>
      {p.extras.length > 0 ? (
        <>
          <h3 class="charts__subtitle" id={`${p.idPrefix}-charts-extra-title`}>
            {EXTRA_TITLE}
          </h3>
          <div class="charts__grid charts__extras">
            {p.extras.map((e, i) => (
              <ChartBox
                key={e.slot}
                {...p}
                slot={e.slot}
                name={extraName(i)}
                hint={EXTRA_HINT}
                chart={p.charts?.[e.slot]}
                timeframe={e.timeframe}
                extra={e}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function FilePick(p: {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly variant: 'secondary' | 'tonal';
  readonly onFile: (file: File) => void;
}) {
  return (
    <label class={`btn btn--${p.variant} statement__file`} for={p.id}>
      <Icon name="image" />
      <span>{p.label}</span>
      <input
        id={p.id}
        class="statement__input"
        type="file"
        aria-label={p.ariaLabel}
        accept="image/png,image/jpeg,image/*"
        onChange={(ev) => {
          const input = ev.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (file) p.onFile(file);
        }}
      />
    </label>
  );
}

function ChartBox(
  p: ChartPanelProps & {
    readonly slot: AnySlot;
    readonly name: string;
    readonly hint: string;
    readonly chart: ChartState | undefined;
    readonly timeframe: Timeframe | null;
    readonly extra?: ExtraEntry;
  },
) {
  const { slot, chart: c } = p;
  const id = chartBoxId(p.idPrefix, slot);
  const preview = c?.phase === 'ready' ? c.preview : null;
  const removed = c?.phase === 'removed';
  // 編集（#89）: 保存済みのチャートを読み戻している間・読み戻せなかった枠も、チャートはある（時間足の欄と [削除] を出す）
  const storedLoading = c?.stored === true && c.phase === 'ready' && preview === null;
  const storedFailed = c?.stored === true && c.phase === 'failed';
  const hasChart = preview !== null || storedLoading || storedFailed;
  // 追加の枠の空の行も削除できる（削除した保存済みの枠は [元に戻す] だけ）
  const removable = !removed && (hasChart || p.extra !== undefined);
  const noteTooLong = p.extra !== undefined && [...p.extra.note.trim()].length > EXTRA_NOTE_MAX;
  const mark = p.markChanges ? changeMark(c) : null;
  const pick = (file: File) => p.onPick?.(slot, file);
  return (
    <fieldset
      class={p.extra ? 'chart chart--extra' : 'chart'}
      id={id}
      data-chart-slot={slot}
      aria-describedby={`${id}-hint`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 貼り付けの行き先を選ぶために枠そのものにフォーカスを置く（R1）
      tabIndex={0}
    >
      <legend class="chart__name" id={`${id}-name`}>
        {p.name}
        {mark ? <span class="chart__mark">{mark}</span> : null}
      </legend>
      {removable ? (
        <div class="chart__remove">
          <Button
            variant="secondary"
            label={`${p.name}のチャートを削除`}
            onClick={() => p.onRemove?.(slot)}
          >
            削除
          </Button>
        </div>
      ) : null}
      {/* 撮る足の添え書きは空の枠だけに見せる（貼った後は読み上げの説明にだけ残す。#27 デザイン 7） */}
      <p class={hasChart || removed ? 'chart__hint sr-only' : 'chart__hint'} id={`${id}-hint`}>
        {p.hint}
      </p>
      {c?.phase === 'preparing' ? (
        <p class="statement__reading" role="status">
          準備しています…
        </p>
      ) : null}
      {c?.message ? (
        <p class="notice notice--error" role="alert">
          {c.message}
        </p>
      ) : null}
      {storedLoading ? (
        <p class="statement__reading" role="status">
          チャートを読み込んでいます…
        </p>
      ) : null}
      {removed ? (
        <div class="chart__removed">
          <p class="chart__removedtext">{CHART_REMOVED}</p>
          <Button
            variant="secondary"
            id={restoreId(p.idPrefix, slot)}
            icon="undo"
            label={`${p.name}のチャートを元に戻す`}
            onClick={() => p.onRestore?.(slot)}
          >
            元に戻す
          </Button>
        </div>
      ) : null}
      {hasChart ? (
        <>
          {preview ? (
            <canvas
              class="chart__preview"
              width={preview.width}
              height={preview.height}
              role="img"
              aria-label={`${p.name}のチャートのプレビュー`}
              ref={(el: HTMLCanvasElement | null) => {
                if (el) preview.draw(el);
              }}
            />
          ) : null}
          <div class="field chart__tf">
            {/* 名前の段は印の有無にかかわらず同じ形（#210）。時間足を読み終えて印が出ても select を作り直さない */}
            <div class="field__head">
              <label class="field__label" for={`${id}-tf`}>
                時間足（任意）
              </label>
              {c?.readMark ? (
                <span id={`${id}-tf-mark`} class="field__mark field__mark--chart">
                  <Icon name="image" class="field__markicon" />
                  {CHART_READ_MARK}
                </span>
              ) : null}
            </div>
            <select
              id={`${id}-tf`}
              {...(c?.readMark ? { 'aria-describedby': `${id}-tf-mark` } : {})}
              class={c?.readMark ? 'select select--read' : 'select'}
              value={p.timeframe ?? ''}
              onChange={(ev) => {
                const v = ev.currentTarget.value;
                p.onTimeframe?.(slot, isTimeframe(v) ? v : null);
              }}
            >
              <option value="">指定なし</option>
              {TIMEFRAME_CHOICES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {c?.read === 'reading' ? (
            <p class="statement__reading" role="status">
              時間足を読み取っています…
            </p>
          ) : null}
          {c?.readNote ? (
            <p class="field__hint" role="status">
              {c.readNote}
            </p>
          ) : null}
          {c?.readSuggest ? (
            // 利用者の選んだ値と読めた値が違う: 上書きせず、読めた値と 1 タップで直すボタンを出す（#27 デザイン 3）
            <div class="chart__suggest">
              <p class="field__hint" role="status">
                {suggestText(c.readSuggest)}
              </p>
              <Button variant="secondary" onClick={() => p.onAccept?.(slot)}>
                {suggestButton(c.readSuggest)}
              </Button>
            </div>
          ) : null}
          {p.extra ? (
            <TextField
              id={`${id}-note`}
              label="一言（任意）"
              value={p.extra.note}
              placeholder="例: 上位足の環境"
              {...(noteTooLong ? { error: extraNoteTooLong } : {})}
              onInput={(v) => {
                const extra = p.extra;
                if (extra) p.onNote?.(extra.slot, v);
              }}
            />
          ) : null}
          {/* チャートのある枠も 1 手で差し替えられる（携帯は貼り付けをほぼ使わない。#89） */}
          <div class="chart__replace">
            <FilePick
              id={`${id}-file`}
              label="差し替え"
              ariaLabel={`${p.name}のチャートを差し替える`}
              variant="secondary"
              onFile={pick}
            />
          </div>
        </>
      ) : null}
      {!hasChart && !removed && c?.phase !== 'preparing' ? (
        <div class="statement__pick">
          <FilePick
            id={`${id}-file`}
            label="チャートを選ぶ"
            ariaLabel={`${p.name}のチャートを選ぶ`}
            variant="secondary"
            onFile={pick}
          />
          <p class="field__hint chart__pastehint">PC はこの欄を選んで貼り付けできます。</p>
        </div>
      ) : null}
      <p class="chart__ready" aria-hidden="true">
        {hasChart ? '貼り付けると差し替えられます' : 'ここに貼り付け'}
      </p>
    </fieldset>
  );
}
