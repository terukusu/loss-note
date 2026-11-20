// 振り返りのタブ（`/review`）の規律の振り返り（Issue #88 契約 U-1。#128 でホームから移して作り直した。設計書 6.1・6.2・6.3・
// 9.2 の振り返りの行・C44・ui-guidelines 9.3・9.11）。hook を持たない。
// 縦の順は 期間（上に貼り付く）→ 範囲と件数（・取り込みの切り替え）→ 1 枚目（一言の見出し = 規律コスト・守っていれば · 実際 →
// 規律コストの曲線と凡例）→ 2 枚目（計画どおり率の主役の数字・判定の内訳の帯と凡例・運と R が出ない件数）→「数で見る ›」
// （次の画面 `/review/table`。表）。指定の日付の欄と取り込みの切り替えは、期間のシート（U3（#129） の下のシート）ができるまで期間の下。
// 成績は R だけ（円を出さない）。R・% は無色の .num（P3）。色は判定の段（内訳の帯・凡例の記号・差の面・崩れの印）と文字・線だけ（P2）。
// 図（内訳の帯・曲線）は読み上げから外し、同じ中身を文字（見出しの文・凡例・「数で見る」の表）で読ませる（P5）。
// 表示の形（model）は hook の層が作って渡す（描画のたびに集計しない。読み終えた範囲が今の期間と違えば null = 読み込み中）
import { splitUnit } from '../lib/home-view';
import type { PeriodKey, PeriodRange, PeriodSelection } from '../lib/period';
import type { ReviewState } from '../lib/review-controller';
import { NO_CURVE, type ReviewModel, ROWS_CAPTION } from '../lib/review-view';
import '../styles/review.css';
import { DENSE_NARROW, DENSE_WIDE } from '../lib/review-chart';
import { Button, RowLink } from './Button';
import { CurveLegend, DisciplineCurve } from './DisciplineCurve';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';
import { PeriodDates, PeriodSegment } from './PeriodPicker';

export interface ReviewSlot {
  readonly selection: PeriodSelection;
  readonly range: PeriodRange;
  readonly state: ReviewState;
  /** 表示の形（`reviewModelFor`。読み込み中・期間の誤り・範囲の食い違いは null） */
  readonly model: ReviewModel | null;
  /**
   * 期間を切り替えて読んでいる間に残す前の期間の表示の形（薄くして aria-busy。カードの高さを跳ばさない。#88 再レビュー 4）。
   * 範囲の行の件数には使わない（新しい範囲に前の件数を出さない）
   */
  readonly previous?: ReviewModel | null;
  /** 「数で見る ›」の行き先（同じ期間の `/review/table?…`） */
  readonly tableHref: string;
  readonly onKey: (key: PeriodKey) => void;
  readonly onDates: (from: string, to: string) => void;
  readonly onImports: (include: boolean) => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** 見出しの前の記号（差あり = 崩れの △、差 0 = 計画どおりの ○、差 0 だが曲線の外の取引あり = 極悪の ×） */
const HEADLINE_SYMBOL = { gap: 'triangle', none: 'circle', measured: 'cross' } as const;

/** 件数が多いか（曲線の描く位置と同じ境。凡例の見本の線種をそろえる） */
function curveDense(n: number) {
  return { narrow: n > DENSE_NARROW, wide: n > DENSE_WIDE };
}

export const TABLE_ID = 'review-table';

/** 主役の数字（44px）と小さな単位（%・R）。ホームの今月の規律と同じ形（#128 デザインの細かい点） */
function BigNum({ text }: { readonly text: string }) {
  const n = splitUnit(text);
  return (
    <span class="review__big">
      <span class="num num--xl">{n.value}</span>
      <span class="review__unit">{n.unit}</span>
    </span>
  );
}

export function ReviewSection(p: ReviewSlot) {
  const m = p.model;
  return (
    <div class="review">
      {/* 貼り付くのは 5 つの選択肢の行だけ。指定の日付の欄は流れる（デザイン a5） */}
      <div class="review__period-bar">
        <PeriodSegment
          selection={p.selection}
          range={p.range}
          onKey={p.onKey}
          onDates={p.onDates}
        />
      </div>
      <PeriodDates selection={p.selection} range={p.range} onKey={p.onKey} onDates={p.onDates} />
      {p.range.ok ? (
        <p class="review__meta" aria-live="polite">
          {p.range.label}
          {m ? ` · ${m.countText}` : ''}
        </p>
      ) : null}
      {m?.imports ? <ImportsToggle m={m} onImports={p.onImports} /> : null}
      {m?.truncatedText ? <p class="review__note">{m.truncatedText}</p> : null}
      <ReviewBody {...p} />
    </div>
  );
}

function ImportsToggle({
  m,
  onImports,
}: {
  readonly m: ReviewModel;
  readonly onImports: (include: boolean) => void;
}) {
  if (!m.imports) return null;
  return (
    <label class="review__toggle">
      {/* checkbox は行の全面に透明で重ね（当たり = 行。44px 以上）、見た目は SVG の四角とチェックの記号 */}
      <input
        type="checkbox"
        class="review__check"
        checked={m.imports.include}
        onChange={(e) => onImports(e.currentTarget.checked)}
      />
      <svg class="review__box" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect class="review__box-frame" x="1" y="1" width="18" height="18" rx="4" />
        {m.imports.include ? <path class="review__box-check" d="M5 10.5l3.2 3.2L15 6.8" /> : null}
      </svg>
      <span class="review__toggle-text">
        <span>含めて集計する</span>
        <span class="review__sub">{m.imports.stateText}</span>
      </span>
    </label>
  );
}

function ReviewBody(p: ReviewSlot) {
  const s = p.state;
  if (!p.range.ok || s.phase === 'idle') return null;
  if (s.phase === 'failed') {
    return (
      <section class="card section review__card">
        <p class="notice notice--error" role="alert">
          {s.error}
        </p>
        <div>
          {s.errorKind === 'auth' ? (
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
  const loading = s.phase === 'loading' || !p.model;
  const shown = loading ? (p.previous ?? null) : p.model;
  if (loading && (!shown || shown.empty)) {
    // 最初の読み込み: 中身の形の高さを先に取る骨組み（読み終えて中身が出てもカードの高さが大きく跳ばない）
    return (
      <div class="card review__skeleton" aria-busy="true">
        <p class="loading" role="status">
          読み込んでいます…
        </p>
      </div>
    );
  }
  if (!shown) return null;
  if (loading) {
    // 期間の切り替えの途中: 前の図を薄く残す（読み上げは「読み込んでいます」だけ）
    return (
      <div class="review__body review__body--busy" aria-busy="true">
        <p class="sr-only" role="status">
          読み込んでいます…
        </p>
        <div class="review__cards" aria-hidden="true" inert>
          <ReviewContent {...p} m={shown} />
        </div>
      </div>
    );
  }
  return (
    <div class="review__cards">
      <ReviewContent {...p} m={shown} />
    </div>
  );
}

function ReviewContent(p: ReviewSlot & { readonly m: ReviewModel }) {
  const m = p.m;
  if (m.empty) {
    return (
      <section class="card section review__card review__empty-box">
        <p class="review__empty">{m.emptyText}</p>
        {p.selection.key !== '3m' && p.selection.key !== 'custom' && !m.imports ? (
          <div>
            <Button variant="secondary" onClick={() => p.onKey('3m')}>
              3か月で見る
            </Button>
          </div>
        ) : null}
      </section>
    );
  }
  const gap = m.review.cost < 0;
  const h = m.headline;
  const dense = curveDense(m.curve.length);
  return (
    <>
      <section
        class="card section review__card review__costcard"
        aria-labelledby="review-cost-title"
      >
        <h2 class="sr-only" id="review-cost-title">
          規律コスト
        </h2>
        <div class="review__head">
          {h ? (
            // 主役は崩れで失った R（規律コスト）。数は無色、状態は前の記号の形（○ △ ×）と段の色で
            <p class={`review__headline review__headline--${h.kind}`}>
              <Icon name={HEADLINE_SYMBOL[h.kind]} class="review__headmark" />
              <span class="review__lead">{h.lead}</span> <BigNum text={h.value} />
              <InfoTip term="disciplineCost" size="sm" />
            </p>
          ) : null}
          <p class="review__subline">{m.subline}</p>
        </div>
        <div class="review__curve">
          {m.curve.length === 0 || !m.curveDates ? (
            <p class="review__note">{NO_CURVE}</p>
          ) : (
            <>
              <DisciplineCurve
                curve={m.curve}
                firstDate={m.curveDates.first}
                lastDate={m.curveDates.last}
              />
              <div aria-hidden="true">
                <CurveLegend gap={gap} dense={dense} />
              </div>
            </>
          )}
          {m.noGapText ? <p class="review__note">{m.noGapText}</p> : null}
        </div>
      </section>
      <section
        class="card section review__card review__ratecard"
        aria-labelledby="review-rate-title"
      >
        <div class="review__ratehead">
          <h2 class="review__label" id="review-rate-title">
            計画どおり率
            <InfoTip term="planRate" size="sm" />
          </h2>
          {m.rateText === null ? null : <p class="review__sub review__nowrap">{m.rateCountText}</p>}
        </div>
        <p class="review__value">
          {m.rateText === null ? (
            <span class="review__missing">{m.rateMissingText}</span>
          ) : (
            <BigNum text={m.rateText} />
          )}
        </p>
        {m.rateText === null ? <p class="review__sub">{m.rateCountText}</p> : null}
        <div class="review__mix">
          <h3 class="sr-only">判定の内訳</h3>
          <svg class="review__bar" aria-hidden="true" focusable="false">
            {m.bar.map((b) => (
              <rect
                key={b.key}
                class={`review__seg review__seg--${b.tier}`}
                x={`${(b.x * 100).toFixed(3)}%`}
                width={`${Math.max(0, b.width * 100 - 0.8).toFixed(3)}%`}
                y="0"
                height="100%"
                rx="3"
              />
            ))}
          </svg>
          <ul class="review__legend" aria-label="判定の内訳">
            {m.legend.map((l) => (
              <li key={l.key} class={`review__legend-item review__legend-item--${l.tier}`}>
                <Icon name={l.symbol} class="review__mark" />
                <span>{l.label}</span>
                <span class="review__count">{l.count}</span>
              </li>
            ))}
          </ul>
        </div>
        {m.luckText || m.noRText ? (
          <ul class="review__notes">
            {m.luckText ? <li>{m.luckText}</li> : null}
            {m.noRText ? <li>{m.noRText}</li> : null}
          </ul>
        ) : null}
      </section>
      {m.rows.length > 0 ? (
        <div class="review__more">
          <RowLink href={p.tableHref}>数で見る</RowLink>
        </div>
      ) : null}
    </>
  );
}

/** 「数で見る」の表（取引ごとの R と累積。決済の古い順）。狭い幅は累積の 2 列を外す（CSS） */
export function ReviewTable({ m }: { readonly m: ReviewModel }) {
  return (
    <div class="review__table">
      {/* 狭い幅では表を横に送る。キーボード（Safari）でも送れるよう、名前つきの区切り（section）にフォーカスを置ける */}
      <section
        class="review__scroll"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 横に送る箱をキーボードで送れるようにする（WCAG 2.1.1。Safari は自動でフォーカスしない）
        tabIndex={0}
        aria-labelledby={`${TABLE_ID}-caption`}
      >
        <table>
          <caption class="sr-only" id={`${TABLE_ID}-caption`}>
            {ROWS_CAPTION}
          </caption>
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">銘柄</th>
              <th scope="col">判定</th>
              <th scope="col" class="num">
                R
              </th>
              <th scope="col" class="num">
                実際の累積
              </th>
              <th scope="col" class="num">
                計画どおりの累積
              </th>
              <th scope="col" class="num">
                差
              </th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.dateText}</td>
                <td>{r.instrumentName}</td>
                <td>{r.gradeLabel}</td>
                <td class="num">{r.rText}</td>
                <td class="num">{r.actualCumText}</td>
                <td class="num">{r.plannedCumText}</td>
                <td class="num">{r.gapText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
