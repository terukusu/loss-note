// 振り返りの「何で崩れたか」の Good / More の切り口（前は気づきの Good / More の話題ごとの集計のカード）と、行から「期間の取引」へたどる
// （Issue #221 の AC-1〜AC-7。#228 で切り口の形に読み替えた）。
// 部品は関数として展開する（DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import {
  insightModel,
  insightModelFor,
  REFLECTION_NONE_LINES,
  REFLECTION_OVERLAP_NOTE,
} from '../../ui/src/lib/insight-view';
import {
  type PeriodSelection,
  periodRange,
  reviewTableHref,
  type WhyKey,
} from '../../ui/src/lib/period';
import type { ReviewState } from '../../ui/src/lib/review-controller';
import {
  parseTrail,
  REVIEW_TRADES_NONE,
  reviewTradesHref,
  reviewTradesModelFor,
  type TrailFilter,
  trailTitle,
} from '../../ui/src/lib/review-trades';
import { reviewModelFor } from '../../ui/src/lib/review-view';
import { Link } from '../../ui/src/lib/router';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { ReviewView } from '../../ui/src/pages/Review';
import { ReviewTradesView } from '../../ui/src/pages/ReviewTrades';
import { closedInfoTip } from './helpers/info-tip';
import { E1, E1_HIDDEN } from './helpers/insight-examples';
import { R1, R1_HIDDEN, R4, R6, reflected } from './helpers/reflection-insight-examples';
import { REVIEW_NOW } from './helpers/review-examples';
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
const range7 = periodRange(SEVEN, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };

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
  why: WhyKey = 'more',
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
    why,
    insight: insightModelFor(state, range, {
      hidden,
      includeImports: sel.imports,
      now: REVIEW_NOW,
    }),
    onWhy: noop,
    tableHref: reviewTableHref(sel),
    trailHref: (f: TrailFilter) => reviewTradesHref(sel, f),
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

function renderInsight(
  sel: PeriodSelection,
  trades: readonly StoredTrade[],
  hidden = R1_HIDDEN,
  why: WhyKey = 'more',
) {
  return expand(
    <ReviewView
      state={tradesReady(trades)}
      hidden={new Set()}
      empty={<p>空</p>}
      onReload={noop}
      onRelogin={noop}
      review={slot(sel, trades, hidden, why)}
    />,
  );
}

/** 「何で崩れたか」の段を Good / More の切り口で開いたもの（#228。前は側ごとのカード） */
const cardOf = (tree: Node[], side: 'good' | 'more') =>
  all(tree, (e) => hasClass('why')(e) && e.props['data-why'] === side)[0] as El;

/** 行の全文（名前と要約。insight-view の text） */
const model = (trades: readonly StoredTrade[], includeImports = false, hidden = R1_HIDDEN) =>
  insightModel(trades, { hidden, includeImports, range: R7 });
const lines = (side: 'good' | 'more', m = model(R1)) =>
  m.reflection?.cards.find((c) => c.side === side)?.rows.map((r) => r.text);

describe('AC-1: E1 の More のカード', () => {
  it('表示の形: 見出し・4 行の名前・順・値（X1・I1 はどの行にも入らない）・重なり', () => {
    const m = model(R1);
    expect(m.reflection?.cards.map((c) => c.side)).toEqual(['more', 'good']);
    const more = m.reflection?.cards[0];
    expect(more?.title).toBe('More の話題ごとの規律');
    expect(more?.headText).toBe('11 件のうち 5 件に記入');
    expect(lines('more', m)).toEqual([
      '数量が多すぎた 5 件 · 0%（0 / 5）· 崩れで −1.8R',
      '根拠が揃う前に入った 1 件 · 件数が少ない',
      '出口を決めていなかった 1 件 · 件数が少ない',
      '自分で書いた行 1 件 · 件数が少ない',
    ]);
    expect(more?.main.map((r) => r.key)).toEqual(['oversized']);
    expect(more?.few.map((r) => [r.key, r.restText])).toEqual([
      ['enteredEarly', 'あと 4 件'],
      ['noExitPlan', 'あと 4 件'],
      ['notes', 'あと 4 件'],
    ]);
    expect(more?.overlapText).toBe(REFLECTION_OVERLAP_NOTE);
    expect(more?.noneText).toBeNull();
  });

  it('画面: 切り替えは 心理 → More → Good・More の切り口の行は押せる行（その話題の期間の取引へ）', () => {
    const tree = renderInsight(SEVEN, R1);
    expect(
      all(tree, (e) => e.type === 'input' && e.props.name === 'review-why').map(
        (e) => e.props.value,
      ),
    ).toEqual(['emotion', 'more', 'good']);
    const card = cardOf(tree, 'more');
    expect(text(all([card], (e) => e.type === 'h2'))).toBe('何で崩れたか');
    expect(text(card)).toContain('11 件のうち 5 件に記入');
    const rows = all([card], (e) => e.type === 'li' && e.props['data-topic'] !== undefined);
    expect(rows.map((li) => [li.props['data-topic'], links([li])[0]?.props.href])).toEqual([
      ['oversized', '/review/trades?period=7d&more=oversized'],
      ['enteredEarly', '/review/trades?period=7d&more=enteredEarly'],
      ['noExitPlan', '/review/trades?period=7d&more=noExitPlan'],
      ['notes', '/review/trades?period=7d&notes=more'],
    ]);
    expect(text(all([rows[0] as El], hasClass('sr-only')))).toBe(
      '数量が多すぎた 5 件、計画どおり率 0%（0 / 5）、規律コスト 崩れで −1.8R',
    );
    expect(text(all([rows[3] as El], hasClass('sr-only')))).toBe(
      '自分で書いた行 1 件、件数が少ない（あと 4 件で表示）',
    );
    // 見出しの id はカードごとに別（心理のカードと重ならない）
    const ids = all(tree, (e) => typeof e.props.id === 'string').map((e) => e.props.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(text(card)).toContain(REFLECTION_OVERLAP_NOTE);
  });
});

describe('AC-2: E2 の Good のカード', () => {
  it('ルールどおりに動けた 5 / 5 ±0 → 早めに撤退できた 3 件 → 利を伸ばせた 1 件 → 自分で書いた行 1 件', () => {
    const good = model(R1).reflection?.cards[1];
    expect(good?.title).toBe('Good の話題ごとの規律');
    expect(good?.headText).toBe('11 件のうち 5 件に記入');
    expect(lines('good')).toEqual([
      'ルールどおりに動けた 5 件 · 100%（5 / 5）· 崩れなし ±0.0R',
      '早めに撤退できた 3 件 · 件数が少ない',
      '利を伸ばせた 1 件 · 件数が少ない',
      '自分で書いた行 1 件 · 件数が少ない',
    ]);
    expect(good?.few.map((r) => r.restText)).toEqual(['あと 2 件', 'あと 4 件', 'あと 4 件']);
    expect(good?.overlapText).toBe(REFLECTION_OVERLAP_NOTE);
    // 基準の印は付けない
    expect(good?.rows.every((r) => !r.base)).toBe(true);
  });
});

describe('AC-3: 取り込みを含める（E3）', () => {
  it('More 12 件のうち 6 件・数量が多すぎた 6 件 · 0%（0 / 6）· 崩れで −2.3R、Good 12 件のうち 5 件', () => {
    const m = model(R1, true);
    expect(m.reflection?.cards.map((c) => c.headText)).toEqual([
      '12 件のうち 6 件に記入',
      '12 件のうち 5 件に記入',
    ]);
    expect(lines('more', m)?.[0]).toBe('数量が多すぎた 6 件 · 0%（0 / 6）· 崩れで −2.3R');
    expect(lines('good', m)).toEqual(lines('good'));
  });
});

describe('AC-4: 重なりの 1 行（E4）', () => {
  it('話題 1 つずつ・自分で書いた行なしなら出ない', () => {
    const more = model(R4, false, new Set()).reflection?.cards[0];
    expect(more?.overlapText).toBeNull();
    expect(more?.rows.map((r) => r.key)).toEqual(['oversized', 'lcTooTight']);
    expect(text(cardOf(renderInsight(SEVEN, R4, new Set()), 'more'))).not.toContain(
      REFLECTION_OVERLAP_NOTE,
    );
  });
});

describe('AC-5: Good / More の付いていない期間（E5・E6）', () => {
  it('E5: 両側とも無い → 1 枚にまとめた付け方の 2 行（ボタンは心理のカードの 1 つだけ）・心理のカードはそのまま', () => {
    const m = model(E1, false, E1_HIDDEN);
    expect(m.reflection).toEqual({ noneLines: REFLECTION_NONE_LINES, cards: [] });
    const tree = renderInsight(SEVEN, E1, E1_HIDDEN);
    const none = [cardOf(tree, 'more')];
    expect(all(none, hasClass('review__note')).map(text)).toEqual([...REFLECTION_NONE_LINES]);
    expect(all(none, (e) => e.type === 'a')).toEqual([]);
    expect(all(none, hasClass('insight__row'))).toEqual([]);
    // 心理の切り口の行は今までどおり（E1 の 2 行）
    const emotion = all(renderInsight(SEVEN, E1, E1_HIDDEN, 'emotion'), hasClass('why'))[0] as El;
    expect(all([emotion], hasClass('insight__row'))).toHaveLength(2);
  });

  it('E6: Good が無い → Good のカードは 1 行だけ（表・見出しの列なし）', () => {
    const m = model(R6, false, new Set());
    const good = m.reflection?.cards[1];
    expect(good?.noneText).toBe('この期間の取引に Good は付いていません');
    expect(good?.rows).toEqual([]);
    expect(good?.headText).toBe('2 件のうち 0 件に記入');
    const card = cardOf(renderInsight(SEVEN, R6, new Set(), 'good'), 'good');
    expect(all([card], hasClass('review__note')).map(text)).toEqual([
      'この期間の取引に Good は付いていません',
    ]);
    expect(all([card], hasClass('insight__key'))).toEqual([]);
  });

  it('対象が 0 件の期間は Good / More のカードを出さない（心理のカードの空の文だけ）', () => {
    expect(model([]).reflection).toBeNull();
    expect(all(renderInsight(SEVEN, []), hasClass('why'))).toEqual([]);
  });
});

function viewOf(trades: readonly StoredTrade[], filter: TrailFilter | null, hidden = R1_HIDDEN) {
  const review = slot(SEVEN, trades, hidden);
  const m = reviewTradesModelFor(review.state, review.range, {
    hidden,
    includeImports: false,
    filter,
    instruments: INSTRUMENTS,
  });
  return { m, tree: expand(<ReviewTradesView review={review} filter={filter} model={m} />) };
}

describe('AC-6: 行から期間の取引へ（E7・E8）', () => {
  it('URL の往復: 話題・自分で書いた行', () => {
    for (const f of [
      { kind: 'topic', side: 'more', id: 'oversized' },
      { kind: 'topic', side: 'good', id: 'cutEarly' },
      { kind: 'notes', side: 'more' },
      { kind: 'notes', side: 'good' },
    ] as const) {
      const href = reviewTradesHref({ key: '1m', imports: true }, f);
      expect(parseTrail(href.slice('/review/trades'.length))).toEqual(f);
    }
    expect(reviewTradesHref(SEVEN, { kind: 'topic', side: 'good', id: 'cutEarly' })).toBe(
      '/review/trades?period=7d&good=cutEarly',
    );
    expect(reviewTradesHref(SEVEN, { kind: 'notes', side: 'more' })).toBe(
      '/review/trades?period=7d&notes=more',
    );
  });

  it('E7: 数量が多すぎた = 題・名前つきの要約・行 T6・T5・T4・T3・T2・同じ側のほかの話題の添え', () => {
    const { m, tree } = viewOf(R1, { kind: 'topic', side: 'more', id: 'oversized' });
    expect(m?.summary).toBe('5 件 · 0%（0 / 5）· 崩れで −1.8R');
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('数量が多すぎた');
    expect(all(tree, hasClass('review__trailpart')).map(text)).toEqual([
      '5 件',
      '計画どおり率 0%（0 / 5）',
      '規律コスト 崩れで −1.8R',
    ]);
    expect(all(tree, hasClass('traderow')).map((a) => a.props.href)).toEqual([
      '/trades/t6',
      '/trades/t5',
      '/trades/t4',
      '/trades/t3',
      '/trades/t2',
    ]);
    expect(m?.notes).toEqual({ t4: '出口を決めていなかった', t2: '根拠が揃う前に入った' });
  });

  it('E8: More の自分で書いた行 = 題・行 T6 だけ・添えは最初の行と「ほか 1 行」', () => {
    const { m, tree } = viewOf(R1, { kind: 'notes', side: 'more' });
    expect(text(all(tree, (e) => e.type === 'h1'))).toBe('More の自分で書いた行');
    expect(all(tree, hasClass('traderow')).map((a) => a.props.href)).toEqual(['/trades/t6']);
    expect(all(tree, hasClass('traderow__note')).map(text)).toEqual([
      '「入る前に数量を 1R から逆算する」ほか 1 行',
    ]);
    expect(m?.summaryParts).toEqual(['1 件', '計画どおり率 あと 4 件で表示']);
    // Good の自分で書いた行は 1 行だけ → 「ほか」なし
    expect(viewOf(R1, { kind: 'notes', side: 'good' }).m?.notes).toEqual({
      t9: '「前提が崩れたので LC の前に決済した」',
    });
  });

  it('自分で書いた行の文はテキストのまま出す（HTML として解かない・要素が増えない）', () => {
    const evil = '<img src=x onerror=alert(1)><b>太字</b>';
    const trades = [reflected('h1', 0, 'B', -1.5, { more: ['oversized'], moreNotes: [evil] })];
    const { m, tree } = viewOf(trades, { kind: 'notes', side: 'more' }, new Set());
    expect(m?.notes).toEqual({ h1: `「${evil}」` });
    const note = all(tree, hasClass('traderow__note'));
    expect(note).toHaveLength(1);
    // 中身は文字の子 1 つだけ（img・b の要素は無い）
    expect(note[0]?.children).toEqual([`「${evil}」`]);
    expect(all(tree, (e) => e.type === 'img' || e.type === 'b')).toEqual([]);
  });

  it('添えは 2 つまで + 「ほか N」・絞った話題を省く', () => {
    const trades = [
      reflected('z1', 0, 'B', -1.5, {
        more: ['enteredEarly', 'againstHigherTf', 'oversized', 'lcTooTight', 'reEntered'],
      }),
    ];
    const { m } = viewOf(trades, { kind: 'topic', side: 'more', id: 'oversized' }, new Set());
    expect(m?.notes).toEqual({ z1: '根拠が揃う前に入った・上位足の流れに逆らった ほか 2' });
  });

  it('該当 0 件は何で絞ったかを言う', () => {
    expect(
      viewOf(R6, { kind: 'topic', side: 'more', id: 'orderMistake' }, new Set()).m?.emptyText,
    ).toBe('この期間に「発注を間違えた」を付けた取引はありません');
    expect(viewOf(R6, { kind: 'notes', side: 'good' }, new Set()).m?.emptyText).toBe(
      'この期間に Good を自分で書いた取引はありません',
    );
  });
});

describe('AC-7: 側の違う ID・知らない値は該当なし（E9）', () => {
  it('parseTrail は null・画面は該当なしの文と ［振り返りへ］', () => {
    for (const s of [
      '?period=7d&more=cutEarly',
      '?period=7d&good=foo',
      '?period=7d&good=oversized',
      '?period=7d&good=',
      '?period=7d&notes=both',
      '?period=7d&notes=',
      '?period=7d&more=__proto__',
    ]) {
      expect(parseTrail(s)).toBeNull();
    }
    const { tree } = viewOf(R1, parseTrail('?period=7d&more=cutEarly'));
    expect(text(all(tree, hasClass('review__empty')))).toBe(REVIEW_TRADES_NONE);
    expect(all(tree, hasClass('traderow'))).toEqual([]);
    expect(links(tree).filter((a) => text(a).includes('振り返りへ'))).toHaveLength(1);
    expect(trailTitle(null)).toBe('期間の取引');
  });

  it('心理の鍵が先（両方あれば心理）・連勝の後は今までどおり', () => {
    expect(parseTrail('?emotion=recoup&more=oversized')).toEqual({ kind: 'emotion', id: 'recoup' });
    expect(parseTrail('?after=winStreak')).toEqual({ kind: 'winStreak' });
  });
});
