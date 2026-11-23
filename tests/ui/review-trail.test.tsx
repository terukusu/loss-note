// 気づきの行・連勝の後のカードから「期間の取引」へたどる（Issue #185 の AC-1・AC-3・AC-4・AC-7・AC-8・AC-9）。
// 部品は関数として展開する（DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import { insightModelFor } from '../../ui/src/lib/insight-view';
import {
  type PeriodSelection,
  periodRange,
  reviewHref,
  reviewTableHref,
} from '../../ui/src/lib/period';
import { createReviewController, type ReviewState } from '../../ui/src/lib/review-controller';
import {
  REVIEW_TRADES_NONE,
  reviewTradesHref,
  reviewTradesModelFor,
  type TrailFilter,
} from '../../ui/src/lib/review-trades';
import { reviewModelFor } from '../../ui/src/lib/review-view';
import { Link } from '../../ui/src/lib/router';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { ReviewView } from '../../ui/src/pages/Review';
import { ReviewTradesView } from '../../ui/src/pages/ReviewTrades';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { E1, E1_HIDDEN } from './helpers/insight-examples';
import { REVIEW_NOW } from './helpers/review-examples';
import { B, B_HIDDEN } from './helpers/streak-examples';
import { INSTRUMENTS } from './helpers/trade-examples';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  const tip = closedInfoTip(vn);
  if (tip) return expand(tip);
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  if (typeof vn.type === 'function') return expand((vn.type as (p: unknown) => unknown)(vn.props));
  const { children, ...props } = vn.props ?? {};
  return [{ type: String(vn.type), props, children: expand(children) }];
}

function all(nodes: Node[], pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) out.push(n);
    all(n.children, pred, out);
  }
  return out;
}
const text = (n: Node | Node[]): string =>
  Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : text(n.children);
const hasClass = (c: string) => (e: El) =>
  String(e.props.class ?? '')
    .split(' ')
    .includes(c);
const links = (n: Node[]) => all(n, (e) => e.type === 'a');

const noop = () => {};
const SEVEN: PeriodSelection = { key: '7d', imports: false };

const ready = (sel: PeriodSelection, trades: readonly StoredTrade[]): ReviewState => {
  const r = periodRange(sel, REVIEW_NOW);
  return r.ok
    ? { phase: 'ready', range: { from: r.from, to: r.to }, trades, truncated: false }
    : { phase: 'idle' };
};

function slot(
  sel: PeriodSelection,
  trades: readonly StoredTrade[],
  hidden: ReadonlySet<string>,
  trail = true,
): ReviewSlot {
  const range = periodRange(sel, REVIEW_NOW);
  const state = ready(sel, trades);
  return {
    selection: sel,
    range,
    state,
    model: reviewModelFor(state, range, {
      hidden,
      includeImports: sel.imports,
      instruments: INSTRUMENTS,
      now: REVIEW_NOW,
    }),
    view: 'insight',
    insight: insightModelFor(state, range, { hidden, includeImports: sel.imports }),
    onView: noop,
    tableHref: reviewTableHref(sel),
    ...(trail ? { trailHref: (f: TrailFilter) => reviewTradesHref(sel, f) } : {}),
    onKey: noop,
    onDates: noop,
    onImports: noop,
    onReload: noop,
    onRelogin: noop,
  };
}

const tradesReady = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
  more: 'done',
});

function renderInsight(review: ReviewSlot, trades: readonly StoredTrade[]) {
  return expand(
    <ReviewView
      state={tradesReady(trades)}
      hidden={new Set()}
      empty={<p>空</p>}
      onReload={noop}
      onRelogin={noop}
      review={review}
    />,
  );
}

describe('AC-1: 気づきの心理の行は押せる行（同じ期間・取り込みのまま「期間の取引」へ）', () => {
  it('基準の行・値の行・件数が少ない行のどれも、その心理の URL へ', () => {
    const tree = renderInsight(slot(SEVEN, E1, E1_HIDDEN), E1);
    const card = all(tree, hasClass('insight'))[0] as El;
    const rows = all([card], (e) => e.type === 'li' && e.props['data-emotion'] !== undefined);
    const hrefs = rows.map((li) => [li.props['data-emotion'], links([li])[0]?.props.href]);
    expect(hrefs).toEqual([
      ['calm', '/review/trades?period=7d&emotion=calm'],
      ['recoup', '/review/trades?period=7d&emotion=recoup'],
      ['wantProfit', '/review/trades?period=7d&emotion=wantProfit'],
      ['wantPosition', '/review/trades?period=7d&emotion=wantPosition'],
      ['overconfident', '/review/trades?period=7d&emotion=overconfident'],
      ['cantCut', '/review/trades?period=7d&emotion=cantCut'],
    ]);
    // 値の行は格子ごと 1 つのリンク（行全体が当たり）・件数が少ない行は面のある押せる形
    expect(links([rows[1] as El])[0]?.props.class).toBe('insight__link');
    expect(links([rows[4] as El])[0]?.props.class).toBe('insight__fewlink');
    // 読み上げの名前は今までの全文（リンクの中の sr-only）
    expect(text(all([rows[1] as El], hasClass('sr-only')))).toBe(
      '取り戻したい 5 件、計画どおり率 0%（0 / 5）、規律コスト 崩れで −1.8R',
    );
    expect(card.props.class).toContain('insight--trail');
  });

  it('取り込みを含める期間では行き先にも imports=1', () => {
    const sel: PeriodSelection = { key: '7d', imports: true };
    const tree = renderInsight(slot(sel, E1, E1_HIDDEN), E1);
    const card = all(tree, hasClass('insight'))[0] as El;
    expect(links([card]).map((a) => a.props.href)).toContain(
      '/review/trades?period=7d&imports=1&emotion=recoup',
    );
  });

  it('行き先を渡さない組み立ては今までどおり押せない（#162 の形）', () => {
    const tree = renderInsight(slot(SEVEN, E1, E1_HIDDEN, false), E1);
    const card = all(tree, hasClass('insight'))[0] as El;
    expect(links([card])).toEqual([]);
    expect(card.props.class).not.toContain('insight--trail');
  });
});

describe('AC-6・AC-7: 連勝の後のカード', () => {
  it('B1: カードの文と、押せる行「連勝の後の取引を見る ›」（同じ期間の連勝の後へ）', () => {
    const tree = renderInsight(slot(SEVEN, B, B_HIDDEN), B);
    const card = all(tree, hasClass('winrun'))[0] as El;
    expect(text(all([card], (e) => e.type === 'h2'))).toBe('連勝の後');
    const t = text(card);
    expect(t).toContain('2 連勝以上の直後の取引');
    expect(text(all([card], hasClass('winrun__cells')))).toBe('件数2 件あと 3 件で率を表示');
    // 比べる相手（ほかの取引 = S1・S2・S4・S5・S7・S8・S9・S10 の 8 件。判定の出た取引 8 = 率が出る）
    expect(text(card)).toContain('ほかの取引 75%（6 / 8）');
    // 重なりは名前と値の組（値は太い数。0 件の組は軽く）
    const pairs = all([card], hasClass('winrun__pair'));
    expect(
      pairs.map((p) => [
        text(all([p], (e) => e.type === 'dt')),
        text(all([p], (e) => e.type === 'dd')),
      ]),
    ).toEqual([
      ['このうち 調子に乗った', '2 件'],
      ['調子に乗った 4 件のうち 連勝の後', '2 件'],
    ]);
    expect(pairs.some((p) => String(p.props.class).includes('--zero'))).toBe(false);
    expect(t).toContain('期間の中の決済の順で数えます');
    const more = links(tree).filter((a) => a.props.class === 'rowlink');
    expect(more.map((a) => [a.props.href, text(a)])).toEqual([
      ['/review/trades?period=7d&after=winStreak', '連勝の後の取引を見る'],
    ]);
  });

  it('連勝の後が 0 件（E1）: 文だけで押せる行は出さない', () => {
    const tree = renderInsight(slot(SEVEN, E1, E1_HIDDEN), E1);
    const card = all(tree, hasClass('winrun'))[0] as El;
    expect(text(card)).toContain('この期間に 2 連勝の直後の取引はありません');
    const pairs = all([card], hasClass('winrun__pair'));
    expect(pairs.map(text)).toEqual(['調子に乗った 1 件のうち 連勝の後0 件']);
    expect(pairs[0]?.props.class).toContain('winrun__pair--zero');
    expect(all([card], hasClass('winrun__cells'))).toEqual([]);
    expect(links(tree).filter((a) => a.props.class === 'rowlink')).toEqual([]);
  });
});

function viewOf(
  sel: PeriodSelection,
  trades: readonly StoredTrade[],
  hidden: ReadonlySet<string>,
  filter: TrailFilter | null,
) {
  const review = slot(sel, trades, hidden);
  const model = reviewTradesModelFor(review.state, review.range, {
    hidden,
    includeImports: sel.imports,
    filter,
    instruments: INSTRUMENTS,
  });
  return expand(<ReviewTradesView review={review} filter={filter} model={model} />);
}

describe('期間の取引の画面（AC-1・AC-3・AC-4・AC-7・AC-8）', () => {
  it('L1: 題・範囲・要約・行（押すと詳細）・戻るは同じ期間の気づき', () => {
    const tree = viewOf(SEVEN, E1, E1_HIDDEN, { kind: 'emotion', id: 'recoup' });
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('取り戻したい');
    expect(text(all(tree, hasClass('review__meta')))).toBe('11/13〜11/19');
    // 画面の要約は名前つき（値は気づきの行と同じ）
    expect(all(tree, hasClass('review__trailpart')).map(text)).toEqual([
      '5 件',
      '計画どおり率 0%（0 / 5）',
      '規律コスト 崩れで −1.8R',
    ]);
    // 行の 2 行目に、絞った心理（取り戻したい）を除いた心理
    expect(all(tree, hasClass('traderow__note')).map(text)).toEqual([
      '儲けたい',
      '切れない',
      '調子に乗った',
      'ポジりたい',
    ]);
    const rows = all(tree, hasClass('traderow'));
    expect(rows.map((a) => a.props.href)).toEqual([
      '/trades/t11',
      '/trades/t9',
      '/trades/t8',
      '/trades/t7',
      '/trades/t6',
    ]);
    const back = all(tree, (e) => e.type === 'a' && e.props.href === reviewHref(SEVEN, 'insight'));
    expect(back).toHaveLength(1);
    expect(text(back)).toContain('振り返り');
  });

  it('B6: 連勝の後 = 題「連勝の後」・要約「2 件 · 件数が少ない」・行 S6 · S3', () => {
    const tree = viewOf(SEVEN, B, B_HIDDEN, { kind: 'winStreak' });
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('連勝の後');
    expect(all(tree, hasClass('review__trailpart')).map(text)).toEqual(['2 件', '件数が少ない']);
    expect(all(tree, hasClass('traderow')).map((a) => a.props.href)).toEqual([
      '/trades/s6',
      '/trades/s3',
    ]);
    // 連勝の後では「調子に乗った」を先に
    expect(all(tree, hasClass('traderow__note')).map(text)).toEqual([
      '調子に乗った・ポジりたい',
      '調子に乗った',
    ]);
  });

  it('L6: 知らない心理 → 文と ［振り返りへ］（同じ期間の気づき）・行 0', () => {
    const sel: PeriodSelection = { key: '1m', imports: true };
    const tree = viewOf(sel, E1, E1_HIDDEN, null);
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('期間の取引');
    expect(text(all(tree, hasClass('review__empty')))).toBe(REVIEW_TRADES_NONE);
    expect(all(tree, hasClass('traderow'))).toEqual([]);
    expect(all(tree, hasClass('review__trailsum'))).toEqual([]);
    const go = links(tree).filter((a) => text(a).includes('振り返りへ'));
    expect(go.map((a) => a.props.href)).toEqual(['/review?period=1m&imports=1&view=insight']);
  });

  it('読み込み中は短い文（前の期間の行を出さない）', () => {
    const review: ReviewSlot = {
      ...slot(SEVEN, E1, E1_HIDDEN),
      state: { phase: 'loading', range: { from: 0, to: 1 } },
    };
    const tree = expand(<ReviewTradesView review={review} filter={null} model={null} />);
    expect(text(all(tree, hasClass('loading')))).toBe('読み込んでいます…');
    expect(all(tree, hasClass('traderow'))).toEqual([]);
  });
});

describe('#188: 詳細の心理のチップから来た期間の取引（期間の名前・期間を選び直せる。デザインレビュー 1・2）', () => {
  const recoup: TrailFilter = { kind: 'emotion', id: 'recoup' };
  const view = (sel: PeriodSelection, fromTrade: boolean, onKey = noop as (k: unknown) => void) => {
    const review = { ...slot(sel, E1, E1_HIDDEN), onKey } as ReviewSlot;
    const model = reviewTradesModelFor(review.state, review.range, {
      hidden: E1_HIDDEN,
      includeImports: sel.imports,
      filter: recoup,
      instruments: INSTRUMENTS,
    });
    return expand(
      <ReviewTradesView review={review} filter={recoup} model={model} fromTrade={fromTrade} />,
    );
  };

  it('「3 か月」で来たら範囲の行の頭に「この取引を含む 3 か月」', () => {
    const tree = view({ key: '3m', imports: false }, true);
    expect(text(all(tree, hasClass('review__meta')))).toMatch(/^この取引を含む 3 か月 · /);
  });

  it('決済の日までの指定の期間で来たら「この取引までの 3 か月」と日付', () => {
    const tree = view(
      { key: 'custom', from: '2026-08-14', to: '2026-11-13', imports: false },
      true,
    );
    expect(text(all(tree, hasClass('review__meta')))).toBe('この取引までの 3 か月 · 8/14〜11/13');
  });

  it('振り返りから来たとき（印なし）は今までどおり日付だけ', () => {
    const tree = view(SEVEN, false);
    expect(text(all(tree, hasClass('review__meta')))).toBe('11/13〜11/19');
  });

  it('期間の選択肢（振り返りと同じ部品）があり、選ぶと onKey に渡る', () => {
    const keys: unknown[] = [];
    const tree = view({ key: '3m', imports: false }, true, (k) => keys.push(k));
    const bar = all(tree, hasClass('review__period-bar'));
    expect(bar).toHaveLength(1);
    const radios = all(bar, (e) => e.type === 'input' && e.props.name === 'review-period');
    expect(radios.map((r) => r.props.value)).toEqual(['1d', '7d', '1m', '3m', 'custom']);
    expect(radios.find((r) => r.props.checked)?.props.value).toBe('3m');
    const one = radios.find((r) => r.props.value === '1m') as El;
    (one.props.onChange as () => void)();
    expect(keys).toEqual(['1m']);
  });
});

describe('AC-9: 期間の取引を見ても書き込まない', () => {
  it('範囲を読む → 表示の形を作る → 読み直すの間、GET だけ', async () => {
    const fake = createFakeApi({ trades: [...B], instruments: INSTRUMENTS });
    const review = createReviewController({ api: fake.api });
    const range = periodRange(SEVEN, REVIEW_NOW);
    if (!range.ok) throw new Error('期間の誤り');
    await review.load({ from: range.from, to: range.to });
    for (const filter of [{ kind: 'winStreak' }, { kind: 'emotion', id: 'calm' }] as const) {
      const m = reviewTradesModelFor(review.getState(), range, {
        hidden: B_HIDDEN,
        includeImports: false,
        filter,
        instruments: INSTRUMENTS,
      });
      expect(m?.empty).toBe(false);
    }
    await review.reload();
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
    review.dispose();
  });
});
