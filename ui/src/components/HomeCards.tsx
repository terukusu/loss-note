// ホームの部品（#128。設計書 9.2 のホーム・ui-guidelines 9.4・9.12）。hook を持たない。表示の形は lib/home-view.ts。
// - HomeHead: 小さな見出し（印 + 「損失ノート」と今日の日付。大きな題「ホーム」は見せず、読み上げの h1 に入れる）
// - DraftRow: 書きかけがあるときの「記録の書きかけがあります ›」（押せる行）
// - MonthCard: 今月の規律（計画どおり率と規律コストの 2 つの主役の数字と小さな曲線）。カードを押すと振り返りのタブを今月で
// - HomeRecent: 直近の取引 3 件の詰めた行と「すべての取引 ›」（押せる行）
// 押せるカードは、見出しの行の右のリンク（文字 + ›）を当たりにし、CSS でカードの全面に広げる（カードの中にほかの操作が無い）。
// 図（小さな曲線）は読み上げから外し、同じ中身を数字と文で読ませる（P5）
import type { CurvePoint } from '../../../core/review';
import { APP_NAME } from '../lib/app-name';
import { compactRowModel, DRAFT_ROW, type MonthSlot, RECENT_TITLE } from '../lib/home-view';
import { curveGeometry } from '../lib/review-chart';
import { Link } from '../lib/router';
import type { TradeRow } from '../lib/trade-view';
import '../styles/home.css';
import { Button, RowLink } from './Button';
import { Icon } from './Icon';

export function HomeHead({ today }: { readonly today: string }) {
  return (
    <header class="homehead">
      <h1 class="homehead__title" tabIndex={-1}>
        <span class="homehead__mark" aria-hidden="true">
          <Icon name="mark" />
        </span>
        <span class="homehead__name">{APP_NAME}</span>
        <span class="sr-only">（ホーム）</span>
      </h1>
      <p class="homehead__date">{today}</p>
    </header>
  );
}

export function DraftRow() {
  return (
    <div class="homedraft">
      <RowLink href="/record">{DRAFT_ROW}</RowLink>
    </div>
  );
}

/** 小さな規律コストの曲線（実際の累積・計画どおりの累積・差の面。目盛り・札・印は置かない） */
export function MiniCurve({ curve }: { readonly curve: readonly CurvePoint[] }) {
  const g = curveGeometry(curve);
  return (
    <svg
      class="minicurve"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line
        class="minicurve__zero"
        x1="0"
        x2="100"
        y1={g.zeroY}
        y2={g.zeroY}
        vector-effect="non-scaling-stroke"
      />
      {g.gapPolygons.map((pts) => (
        <polygon key={pts} class="minicurve__gap" points={pts} />
      ))}
      <polyline
        class="minicurve__planned"
        points={g.plannedPoints}
        vector-effect="non-scaling-stroke"
      />
      <polyline
        class="minicurve__actual"
        points={g.actualPoints}
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}

const MONTH_ID = 'home-month-title';

export function MonthCard(p: MonthSlot & { readonly href: string }) {
  const c = p.card;
  const s = p.state;
  return (
    <section class="card homecard homemonth" aria-labelledby={MONTH_ID}>
      <div class="homecard__head">
        <h2 class="section__title" id={MONTH_ID}>
          今月の規律
          {c?.meta ? (
            <span class="homemonth__meta">
              （{c.count ? <span class="homemonth__range">{c.range} · </span> : c.range}
              {c.count ?? ''}）
            </span>
          ) : null}
        </h2>
        <Link href={p.href} class="homecard__link">
          <span>振り返り</span>
          <span class="sr-only">で今月の規律を見る</span>
          <Icon name="chevron" class="homecard__chev" />
        </Link>
      </div>
      {s.phase === 'failed' ? (
        <div class="homemonth__failed">
          <p class="notice notice--error" role="alert">
            {s.error}
          </p>
          <div>
            {s.errorKind === 'auth' ? (
              <Button variant="secondary" size="sm" icon="logout" onClick={p.onRelogin}>
                もう一度ログイン
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={p.onReload}>
                再読み込み
              </Button>
            )}
          </div>
        </div>
      ) : !c ? (
        <div class="homemonth__skeleton" aria-busy="true">
          <p class="loading" role="status">
            読み込んでいます…
          </p>
        </div>
      ) : c.empty ? (
        <p class="homemonth__empty">{c.empty}</p>
      ) : (
        <>
          <div class="homemonth__stats">
            <div class="homemonth__stat">
              <p class="homemonth__label">計画どおり率</p>
              <p class="homemonth__value">
                {c.rate ? (
                  <>
                    <span class="num num--xl">{c.rate.value}</span>
                    <span class="homemonth__unit">{c.rate.unit}</span>
                  </>
                ) : (
                  <span class="homemonth__missing">件数が少ない</span>
                )}
              </p>
              <p class="homemonth__sub">{c.rateSub}</p>
            </div>
            <div class="homemonth__stat">
              <p class="homemonth__label">規律コスト</p>
              <p class="homemonth__value">
                {c.cost ? (
                  <>
                    {/* 差は 0 だが R の出ない取引がある（振り返りの「R で測れる崩れ」と同じ ×。読み上げは下の文。N6） */}
                    {c.costMeasured ? <Icon name="cross" class="homemonth__measured" /> : null}
                    <span class="num num--xl">{c.cost.value}</span>
                    <span class="homemonth__unit">{c.cost.unit}</span>
                  </>
                ) : (
                  <span class="homemonth__missing">—</span>
                )}
              </p>
              {/* 語の塊ごとに 1 行（「守っていれば −3.1R」「実際 −3.7R」。語の途中で折らない。デザイン a3） */}
              <p class="homemonth__sub homemonth__lines">
                {c.costLines.map((t) => (
                  <span key={t}>{t}</span>
                ))}
                {c.costMeasured ? <span class="sr-only">R で測れない取引があります</span> : null}
              </p>
            </div>
          </div>
          {c.curve.length > 0 ? <MiniCurve curve={c.curve} /> : null}
        </>
      )}
    </section>
  );
}

/** 詰めた 1 行の行（行全体が詳細へのリンク。左に判定の段の記号の札、右に R とリスク、›） */
export function CompactTradeRow({ row, now }: { readonly row: TradeRow; readonly now: number }) {
  const m = compactRowModel(row, now);
  return (
    <Link href={row.href} class="homerow" aria-label={row.label}>
      <span class={`homerow__mark homerow__mark--${m.tier}`}>
        <Icon name={m.symbol} />
      </span>
      <span class="homerow__main">
        <span class="homerow__title">
          <span class="homerow__name">{row.instrumentName}</span>
          <span class="homerow__side">{row.sideText}</span>
        </span>
        {/* 2 行目「判定の名前 · 日付 · 口座」。区切りの「 · 」は後ろの塊の頭（折れても行末に残さない）。口座の名前だけを「…」で
            詰める（#176） */}
        <span class="homerow__sub">
          <span class="homerow__grade">{m.gradeLabel}</span>
          <span class="homerow__date">{` · ${m.date}`}</span>
          {m.accountName !== null ? (
            <span class="homerow__account">{` · ${m.accountName}`}</span>
          ) : null}
        </span>
      </span>
      {/* R が出ない行は「—」を 1 つだけ、リスクが出ない行は 2 段目を出さない（理由は行の読み上げの名前。デザイン a4） */}
      <span class="homerow__nums">
        <span class={m.rMissing ? 'homerow__r homerow__none' : 'num homerow__r'}>{m.rText}</span>
        {m.riskText !== null ? <span class="homerow__risk">{m.riskText}</span> : null}
      </span>
    </Link>
  );
}

const RECENT_ID = 'home-recent-title';

export function HomeRecent({
  rows,
  now,
}: {
  readonly rows: readonly TradeRow[];
  readonly now: number;
}) {
  return (
    <section class="homerecent" aria-labelledby={RECENT_ID}>
      <h2 class="section__title homerecent__title" id={RECENT_ID}>
        {RECENT_TITLE}
      </h2>
      <div class="card homerecent__group">
        <ul class="homerecent__list" aria-label={RECENT_TITLE}>
          {rows.map((r) => (
            <li key={r.id} class="homerecent__item">
              <CompactTradeRow row={r} now={now} />
            </li>
          ))}
        </ul>
        <RowLink href="/trades">すべての取引</RowLink>
      </div>
    </section>
  );
}
