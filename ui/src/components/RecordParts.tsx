// 記録する（#130）と編集（#131）の全画面のシートが共有する部品（設計書 9.2「形は記録すると同じ」・docs/ui-guidelines.md 9.4）。
// hook を持たない。id は接頭辞（record / edit）で作り、同じ画面に 2 つ置かない。
// - SummaryCard: 取引の欄の 3 行の要約・［編集］（取引の欄のシート）・名指しのチップ・口座の札 / Segment・状態の文
// - MiniCharts: チャートの小さな 2 枠（横に並べる）と、その下のチャートの注意（常に出す。C38）
// - VerdictLineButton: 下の帯の判定の 1 行（押すと判定のシート）。危ない勝ちは R の代わりに帯の文（#227）
import { type ComponentChildren, Fragment } from 'preact';
import type { Timeframe } from '../../../core/trade';
import { CHART_READ_NOTICE } from '../lib/chart-read';
import type { ChartState, ChartsState } from '../lib/chart-slots';
import { CHART_SLOT_TEXT, CHART_SLOTS, type ChartSlot } from '../lib/charts';
import { formatPct } from '../lib/format';
import { YEAR_INFERRED_CHIP } from '../lib/legs-form';
import { TIMEFRAME_NAME } from '../lib/reasons';
import type { DraftField } from '../lib/record-form';
import {
  chartSlotLine,
  chartSlotParts,
  type LinePart,
  miniChartId,
  NAMED_LEAD,
  namedLabel,
  type StatementStatus,
  sentencesOf,
  type TradeSummary,
  type VerdictLine,
} from '../lib/record-screen';
import { Button } from './Button';
import { changeMark } from './ChartPanel';
import { Icon } from './Icon';
import { JudgeBadge } from './JudgeBadge';
import { RNum } from './Num';

/** 部品の id（接頭辞つき。記録する画面は record-…、編集は edit-…） */
export const partIds = (prefix: string) => ({
  summary: `${prefix}-summary`,
  editFields: `${prefix}-edit-fields`,
  verdictLine: `${prefix}-verdict-line`,
  chartsTitle: `${prefix}-mini-charts-title`,
});

export interface SummaryCardProps {
  readonly prefix: string;
  readonly summary: TradeSummary;
  /**
   * 明細の行の状態の文（記録する画面だけ。完了の文・キャンセル・次の行の知らせ。#166・#180）。あれば名前の上の 1 行に出し、
   * 札「読み取り」は出さない（次の行の知らせは読み取りのことを言わないので、札を残す。#180 の R5）。
   * 読み上げは記録する画面の状態の領域が持つので、ここは見える文だけ。省けば札「読み取り」のまま（編集の画面）
   */
  readonly status?: StatementStatus | undefined;
  /** 口座の札（口座が 4 つ以上のとき。押すと取引の欄のシートの口座の欄） */
  readonly accountChip: string | null;
  /** 取引の欄のシートを開く（focus = 名指した欄から開いたときの欄） */
  readonly onFields: (focus?: DraftField) => void;
  /** 要約の下の行（タイムゾーン・口座の Segment・状態の文など。順に並べる） */
  readonly children?: ComponentChildren;
}

/** 読み取りの後・手入力の後（記録する）・開いた取引（編集）の要約 */
export function SummaryCard(p: SummaryCardProps) {
  const sum = p.summary;
  const ids = partIds(p.prefix);
  return (
    <div class="rstmt__card rstmt__card--sum">
      {p.accountChip ? (
        <button
          type="button"
          class="chip rsum__account"
          aria-label={`口座: ${p.accountChip}（口座を選ぶ）`}
          onClick={() => p.onFields('accountId')}
        >
          {p.accountChip}
          <Icon name="chevron" />
        </button>
      ) : null}
      <div class="rsum__text" id={ids.summary}>
        {/* 1 行目は名前と札・［編集］。2・3 行目は ［編集］ の下まで全幅（実際の桁の価格でも折り返しにくくする。#164） */}
        <div class={p.status ? 'rsum__head rsum__head--status' : 'rsum__head'}>
          {/* 名前は切らずに折り返す。札は名前の右（入らなければ下）に置き、名前を押し縮めない（#164） */}
          {/* 状態の 1 行（記録する画面の完了の文・キャンセル・次の行の知らせ。名前の上。読み取り中の「読み取り中…」と同じ場所。
              知らせは印を付けない = 完了の文のチェックと見分ける。#166・#180） */}
          {p.status ? (
            <p class={`rsum__status rsum__status--${p.status.kind}`} aria-hidden="true">
              {p.status.kind !== 'done' ? null : (p.status.need ?? 0) > 0 ? (
                // 入力が必要な欄が残る: 成功のチェックでなく中立の「!」（下の「読み取れませんでした」と矛盾させない）
                <span class="rsum__statusicon rsum__statusicon--need" />
              ) : (
                <span class="rsum__statusicon">
                  <Icon name="check" />
                </span>
              )}
              {p.status.kind === 'notice' ? (
                // 知らせは文ごとに折らない塊にして、文の間で折る（「（2 / 2）」の中で折らない。#180 のデザインの確かめ）
                <span>
                  {sentencesOf(p.status.text).map((t, i) => (
                    // 同じ文が 2 回入っても key が重ならないよう、文の位置を添える（並びは文から決まり、入れ替わらない）
                    <span class="rsum__sentence" key={`${i}:${t}`}>
                      {t}
                    </span>
                  ))}
                </span>
              ) : (
                <span>{p.status.text}</span>
              )}
            </p>
          ) : null}
          <p class="rsum__l1">
            <span class="rsum__name">{sum.name}</span>
            {sum.read && (!p.status || p.status.kind === 'notice') ? (
              <span class="field__mark rsum__mark">読み取り</span>
            ) : null}
            {sum.yearInferred ? (
              <span class="field__mark field__mark--warn rsum__mark">{YEAR_INFERRED_CHIP}</span>
            ) : null}
          </p>
          <Button
            variant="secondary"
            size="sm"
            id={ids.editFields}
            label="取引の欄を編集"
            onClick={() => p.onFields()}
          >
            編集
          </Button>
        </div>
        {/* 見える 2 行は記号つき。読み上げは記号の無い文（#164 のレビュー N4） */}
        <p class="rsum__l2" aria-hidden="true">
          <Parts parts={sum.line2Parts} />
        </p>
        <p class="rsum__l3" aria-hidden="true">
          <Parts parts={sum.line3Parts} pnl={sum.pnl} />
        </p>
        <p class="sr-only">{sum.spoken}</p>
      </div>
      {sum.named.length > 0 ? (
        <ul class="rsum__named" aria-label="入力が必要な欄">
          {sum.named.map((n) => (
            <li key={n.field}>
              <button
                type="button"
                class={`chip rsum__chip rsum__chip--${n.kind}`}
                aria-label={namedLabel(n)}
                onClick={() => p.onFields(n.field)}
              >
                <span class="rsum__chiplead">{NAMED_LEAD[n.kind]}</span>
                <span>{n.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {p.children}
    </div>
  );
}

/**
 * 折り返してよい所で分けた行（塊ごとに次の行へ回す。間は空白 1 つ）。pnl を渡すと、最後の塊の末尾の損益の数だけ 1 段強く
 * （色は付けない。判定の色と混ぜない = P2。#164 のデザインレビュー 4）
 */
function Parts({
  parts,
  pnl,
}: {
  readonly parts: readonly string[];
  readonly pnl?: string | undefined;
}) {
  const last = parts.length - 1;
  return (
    <>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          {pnl !== undefined && i === last && t.endsWith(pnl) ? (
            <span class="rsum__part">
              {t.slice(0, t.length - pnl.length)}
              <span class="rsum__pnl">{pnl}</span>
            </span>
          ) : (
            <span class="rsum__part">{t}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * 塊で分けた 1 行（#212。ui-guidelines 10.3）。塊の間（空白 1 つ）で折り、atom の塊（時間足・「追加 5 枚」）は中で折らない。
 * 文字は塊をつないだもの = 元の 1 行と同じ
 */
export function LineParts({ parts }: { readonly parts: readonly LinePart[] }) {
  return (
    <>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          <span class={t.atom ? 'rpart rpart--atom' : 'rpart'}>{t.text}</span>
        </Fragment>
      ))}
    </>
  );
}

export interface MiniChartsProps {
  readonly prefix: string;
  readonly charts: ChartsState | undefined;
  readonly timeframes: { readonly entry: Timeframe | null; readonly exit: Timeframe | null };
  /** 編集の画面: 変えた枠の印（差し替え・追加・削除）を 2 行目に出す */
  readonly markChanges?: boolean;
  /** 読み取りの上限などで送れない知らせ（記録する画面） */
  readonly blocked?: string | null | undefined;
  readonly onPick: (slot: ChartSlot, file: File) => void;
  /** チャートのある枠（・削除した保存済みの枠・読み戻せなかった枠）を押した: チャートのシート */
  readonly onOpen: () => void;
}

/** チャートの 2 枠（横に並べる）と、その下のチャートの注意（常に出す。C38）。詳細はチャートのシート */
export function MiniCharts(p: MiniChartsProps) {
  const ids = partIds(p.prefix);
  return (
    <section class="rcharts" aria-labelledby={ids.chartsTitle}>
      <h2 class="sr-only" id={ids.chartsTitle}>
        チャート（任意）
      </h2>
      <div class="rcharts__grid">
        {CHART_SLOTS.map((slot) => (
          <MiniChart
            key={slot}
            prefix={p.prefix}
            slot={slot}
            chart={p.charts?.[slot]}
            timeframe={p.timeframes[slot]}
            markChanges={p.markChanges === true}
            onPick={(f) => p.onPick(slot, f)}
            onOpen={p.onOpen}
          />
        ))}
      </div>
      <p class="charts__notice rcharts__notice">{CHART_READ_NOTICE}</p>
      {p.blocked ? (
        <p class="statement__text" role="status">
          {p.blocked}
        </p>
      ) : null}
    </section>
  );
}

/** チャートの 1 枠（2 枠の並び `MiniCharts` の中と、記録する画面の 1 段目のチャートの枠の中。2026-11-21） */
export function MiniChart(p: {
  readonly prefix: string;
  readonly slot: ChartSlot;
  readonly chart: ChartState | undefined;
  readonly timeframe: Timeframe | null;
  readonly markChanges: boolean;
  readonly onPick: (file: File) => void;
  readonly onOpen: () => void;
}) {
  const c = p.chart;
  const name = CHART_SLOT_TEXT[p.slot].name;
  const preview = c?.phase === 'ready' ? c.preview : null;
  const hasChart = c?.phase === 'ready';
  // 編集の画面: 削除した保存済みの枠・読み戻せなかった保存済みの枠も、押すとチャートのシート（[元に戻す]・差し替え）
  const opens = hasChart || c?.phase === 'removed' || (c?.stored === true && c.phase === 'failed');
  const like = {
    hasChart,
    preparing: c?.phase === 'preparing',
    reading: c?.read === 'reading',
    failed: c?.phase === 'failed',
    timeframe: p.timeframe ? TIMEFRAME_NAME[p.timeframe] : null,
    suggest: c?.readSuggest ? TIMEFRAME_NAME[c.readSuggest] : null,
    change: p.markChanges ? changeMark(c) : null,
  };
  const lineText = chartSlotLine(like);
  const id = miniChartId(p.slot, p.prefix);
  const body = (
    <>
      {preview ? (
        <span class="rchart__thumb" aria-hidden="true">
          <canvas
            class="rchart__canvas"
            width={preview.width}
            height={preview.height}
            ref={(el: HTMLCanvasElement | null) => {
              if (el) preview.draw(el);
            }}
          />
        </span>
      ) : (
        <span
          class={opens ? 'rchart__thumb' : 'rchart__thumb rchart__thumb--empty'}
          aria-hidden="true"
        >
          <Icon name={opens ? 'image' : 'plus'} />
        </span>
      )}
      <span class="rchart__text">
        <span class="rchart__name">{name}</span>
        <span class="rchart__line">
          <LineParts parts={chartSlotParts(like)} />
        </span>
      </span>
    </>
  );
  if (opens) {
    // チャートがある枠: 押すとチャートのシート（時間足・差し替え・削除・追加）。フォーカスして貼ると差し替え（R1）
    return (
      <button
        type="button"
        id={id}
        class="rchart rchart--full"
        data-chart-slot={p.slot}
        aria-haspopup="dialog"
        aria-label={`${name}のチャート: ${lineText}（チャートを開く）`}
        onClick={p.onOpen}
      >
        {body}
      </button>
    );
  }
  // 空の枠: 押すとファイルを選ぶ（1 タップ）。フォーカスして貼るとこの枠へ（data-chart-slot。R1）
  return (
    <label class="rchart" id={id} for={`${id}-file`}>
      {body}
      <input
        id={`${id}-file`}
        class="statement__input"
        type="file"
        data-chart-slot={p.slot}
        aria-label={`${name}のチャートを選ぶ`}
        accept="image/png,image/jpeg,image/*"
        onChange={(ev) => {
          const input = ev.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (file) p.onPick(file);
        }}
      />
    </label>
  );
}

/**
 * 下の帯の判定の 1 行（押すと判定のシート。9.3）。判定が出ていればバッジ・R・リスク、出ていなければ状態の文（「あと n 欄」
 * 「タイムゾーンが未選択」など）。状態の文は常に読み上げの live region に入れる
 */
export function VerdictLineButton(p: {
  readonly id: string;
  readonly line: VerdictLine;
  readonly status: string;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  const { line } = p;
  return (
    <button
      type="button"
      id={p.id}
      class={line.kind === 'judged' ? 'vline vline--judged' : 'vline'}
      aria-haspopup="dialog"
      aria-label={`判定を開く: ${p.status}`}
      disabled={p.disabled}
      onClick={p.onOpen}
    >
      {line.kind === 'judged' ? (
        <>
          <JudgeBadge grade={line.grade} />
          {/* 危ない勝ちは R の代わりに反実の 1 行か崩れの文（本文の大きさ・無色。#227・C59） */}
          {line.caution !== undefined ? <span class="vline__caution">{line.caution}</span> : null}
          {line.r !== undefined ? <RNum value={line.r} size="lg" /> : null}
          {line.riskPct !== undefined ? (
            <span class="vline__risk">
              リスク <span class="num">{formatPct(line.riskPct)}</span>
            </span>
          ) : null}
        </>
      ) : null}
      <span
        class={line.kind === 'judged' ? 'record__status sr-only' : 'record__status'}
        aria-live="polite"
      >
        {p.status}
      </span>
      <Icon name="chevron" class="vline__chev" />
    </button>
  );
}
