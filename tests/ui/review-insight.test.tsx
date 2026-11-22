// 振り返りのタブの 規律 / 気づき のセグメントと、気づきの心理ごとの集計のカード（Issue #162 の AC-1・AC-6・AC-7・KEEP-2）。
// 部品は関数として展開する（DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import {
  FEW_HEAD,
  INSIGHT_NONE,
  insightModelFor,
  OVERLAP_NOTE,
} from '../../ui/src/lib/insight-view';
import {
  type PeriodSelection,
  parsePeriod,
  parseReviewView,
  periodActions,
  periodRange,
  type ReviewViewKey,
  reviewHref,
  reviewTableHref,
} from '../../ui/src/lib/period';
import { createReviewController, type ReviewState } from '../../ui/src/lib/review-controller';
import { REVIEW_ONLY_IMPORTS, reviewModelFor } from '../../ui/src/lib/review-view';
import { createNavigator, Link, type NavEnv } from '../../ui/src/lib/router';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { ReviewView } from '../../ui/src/pages/Review';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { E1, E1_HIDDEN, E5, E6 } from './helpers/insight-examples';
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
const noop = () => {};

const range7 = periodRange({ key: '7d', imports: false }, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };
const ready = (trades: readonly StoredTrade[]): ReviewState => ({
  phase: 'ready',
  range: R7,
  trades,
  truncated: false,
});

function slot(
  sel: PeriodSelection,
  state: ReviewState,
  view: ReviewViewKey,
  hidden: ReadonlySet<string> = new Set(),
  onView: (v: ReviewViewKey) => void = noop,
): ReviewSlot {
  const range = periodRange(sel, REVIEW_NOW);
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
    view,
    insight:
      view === 'insight'
        ? insightModelFor(state, range, { hidden, includeImports: sel.imports })
        : null,
    onView,
    tableHref: reviewTableHref(sel),
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

function render(review: ReviewSlot, trades: readonly StoredTrade[] = E1) {
  const tree = expand(
    <ReviewView
      state={tradesReady(trades)}
      hidden={new Set()}
      empty={<p>空</p>}
      onReload={noop}
      onRelogin={noop}
      review={review}
    />,
  );
  return all(tree, hasClass('review'))[0] as El;
}

const SEVEN: PeriodSelection = { key: '7d', imports: false };
const radios = (r: El, name: string) =>
  all([r], (e) => e.type === 'input' && e.props.name === name);

describe('規律 / 気づき のセグメント', () => {
  it('期間の上に 2 択（規律・気づき）。開いている方に印', () => {
    const r = render(slot(SEVEN, ready(E1), 'insight', E1_HIDDEN));
    const view = radios(r, 'review-view');
    expect(view.map((e) => e.props.value)).toEqual(['discipline', 'insight']);
    expect(view.find((e) => e.props.checked)?.props.value).toBe('insight');
    expect(text(all([r], hasClass('review__view')))).toContain('規律');
    expect(text(all([r], hasClass('review__view')))).toContain('気づき');
    // 期間の選択・範囲と件数は気づきでも同じ
    expect(radios(r, 'review-period')).toHaveLength(5);
    expect(text(all([r], hasClass('review__meta')))).toBe('11/13〜11/19 · 11 件');
    // 規律のカードは出さない
    expect(all([r], hasClass('review__costcard'))).toEqual([]);
    expect(all([r], hasClass('review__ratecard'))).toEqual([]);
  });

  it('押すと onView に選んだ方を渡す', () => {
    const got: ReviewViewKey[] = [];
    const r = render(slot(SEVEN, ready(E1), 'discipline', E1_HIDDEN, (v) => got.push(v)));
    const insight = radios(r, 'review-view').find((e) => e.props.value === 'insight') as El;
    (insight.props.onChange as () => void)();
    expect(got).toEqual(['insight']);
    // 規律を開いているときは今までの 2 枚のカード
    expect(all([r], hasClass('review__costcard'))).toHaveLength(1);
    expect(all([r], hasClass('insight'))).toEqual([]);
  });
});

describe('AC-1: E1 の気づきのカード', () => {
  const r = render(slot(SEVEN, ready(E1), 'insight', E1_HIDDEN));
  const card = all([r], hasClass('insight'))[0] as El;

  it('見出しと「11 件のうち 10 件に記入」', () => {
    expect(text(all([card], (e) => e.type === 'h2'))).toContain('心理ごとの規律');
    expect(text(card)).toContain('11 件のうち 10 件に記入');
  });

  it('値の行: 平常心（基準）→ 取り戻したい。読み上げは列の名前つきの全文・見た目の部品は外す（行は押せない）', () => {
    const rows = all([card], hasClass('insight__row'));
    expect(rows.map((e) => e.props['data-emotion'])).toEqual(['calm', 'recoup']);
    expect(rows[0]?.props.class).toContain('insight__row--base');
    expect(rows.map((e) => text(all([e], hasClass('sr-only'))))).toEqual([
      '平常心（基準） 5 件、計画どおり率 100%（5 / 5）、規律コスト 崩れなし ±0.0R',
      '取り戻したい 5 件、計画どおり率 0%（0 / 5）、規律コスト 崩れで −1.8R',
    ]);
    const cells = rows.map((e) => all([e], hasClass('insight__cells'))[0] as El);
    expect(cells.every((c) => c.props['aria-hidden'] === 'true')).toBe(true);
    expect(cells.map((c) => text(c))).toEqual([
      '平常心基準5 件100%（5 / 5）崩れなし±0.0R',
      '取り戻したい5 件0%（0 / 5）崩れで−1.8R',
    ]);
    // 押せるのは列の見出しの「i」2 つだけ（行はリンク・ボタンにしない）
    expect(all([card], (e) => e.type === 'a')).toEqual([]);
    const buttons = all([card], (e) => e.type === 'button');
    expect(buttons.map((b) => b.props['aria-label'])).toEqual([
      '「計画どおり率」の説明',
      '「規律コスト」の説明',
    ]);
  });

  it('列の見出し（計画どおり率・規律コスト）は 1 回だけ', () => {
    const cols = all([card], hasClass('insight__cols'));
    expect(cols).toHaveLength(1);
    expect(text(cols)).toContain('計画どおり率');
    expect(text(cols)).toContain('規律コスト');
  });

  it('AC-4: 件数が少ない行は見出し 1 回の下に名前・件数・あと何件だけ（%・分数・R の文が無い）', () => {
    const box = all([card], hasClass('insight__fewbox'))[0] as El;
    expect(text(all([box], (e) => e.type === 'h3'))).toBe(FEW_HEAD);
    const few = all([box], hasClass('insight__fewrow'));
    expect(few.map((e) => e.props['data-emotion'])).toEqual([
      'wantProfit',
      'wantPosition',
      'overconfident',
      'cantCut',
    ]);
    expect(text(all([few[0] as El], hasClass('sr-only')))).toBe(
      '儲けたい 1 件、件数が少ない（あと 4 件で表示）',
    );
    for (const e of few) expect(text(e)).not.toMatch(/%|\/|R/);
  });

  it('AC-2: 添えの 1 行', () => {
    expect(text(card)).toContain(OVERLAP_NOTE);
  });
});

describe('AC-6: 行が 0 の期間', () => {
  it('E5: 付け方の 1 行・行 0', () => {
    const r = render(slot(SEVEN, ready(E5), 'insight'), E5);
    expect(all([r], hasClass('insight__row'))).toEqual([]);
    expect(text(r)).toContain(INSIGHT_NONE);
    expect(text(r)).toContain('3 件のうち 0 件に記入');
    // 付けに行ける: 取引のタブへ（2 番目の重さのボタン）
    const go = all([r], (e) => e.type === 'a' && text(e).includes('取引を見る'));
    expect(go.map((e) => e.props.href)).toEqual(['/trades']);
  });

  it('E6: 取り込みだけ → 規律と同じ文・行 0', () => {
    const r = render(slot(SEVEN, ready(E6), 'insight'), E6);
    expect(all([r], hasClass('insight__row'))).toEqual([]);
    expect(text(r)).toContain(REVIEW_ONLY_IMPORTS);
    // 取り込みの切り替えは共通（気づきでも出る）
    expect(all([r], hasClass('review__toggle'))).toHaveLength(1);
  });

  it('読み込み中は骨組み・期間の切り替えの途中は前の気づきを薄く残す', () => {
    const first = render(slot(SEVEN, { phase: 'loading', range: R7 }, 'insight'));
    expect(all([first], hasClass('review__skeleton'))).toHaveLength(1);
    const before = slot(SEVEN, ready(E1), 'insight', E1_HIDDEN);
    const loading = slot({ key: '1m', imports: false }, { phase: 'loading', range: R7 }, 'insight');
    const r = render({ ...loading, previousInsight: before.insight ?? null });
    const busy = all([r], hasClass('review__body--busy'))[0] as El;
    expect(busy.props['aria-busy']).toBe('true');
    expect(all([busy], hasClass('insight__row'))).toHaveLength(2);
    expect(all([busy], hasClass('insight__fewrow'))).toHaveLength(4);
  });
});

/** URL を持つ偽の履歴（置き換え・積むの呼び出しを数える） */
class FakeEnv implements NavEnv {
  url: string;
  pushes: string[] = [];
  replaces: string[] = [];
  constructor(url: string) {
    this.url = url;
  }
  location() {
    const i = this.url.indexOf('?');
    return i < 0
      ? { pathname: this.url, search: '' }
      : { pathname: this.url.slice(0, i), search: this.url.slice(i) };
  }
  pushState(url: string) {
    this.pushes.push(url);
    this.url = url;
  }
  replaceState(url: string) {
    this.replaces.push(url);
    this.url = url;
  }
  onPopState() {
    return noop;
  }
}

describe('AC-7: 期間は 2 つのセグメントで共通（E7）・URL の置き換え', () => {
  it('規律 → 気づき → 1 か月 → 規律 で、規律も 1 か月', () => {
    const env = new FakeEnv('/review?period=7d');
    const nav = createNavigator(env, { dev: false });
    const sel = () => parsePeriod(nav.current.search);
    const view = () => parseReviewView(nav.current.search);
    // useReview と同じつなぎ方: セグメント = reviewHref(期間, 次)、期間 = reviewHref(次, 今のセグメント)
    const onView = (v: ReviewViewKey) => nav.replace(reviewHref(sel(), v));
    const act = () =>
      periodActions(
        sel(),
        () => REVIEW_NOW,
        (n) => nav.replace(reviewHref(n, view())),
      );
    onView('insight');
    expect(env.url).toBe('/review?period=7d&view=insight');
    act().onKey('1m');
    expect(env.url).toBe('/review?period=1m&view=insight');
    expect(view()).toBe('insight');
    act().onImports(true);
    expect(env.url).toBe('/review?period=1m&imports=1&view=insight');
    onView('discipline');
    expect(env.url).toBe('/review?period=1m&imports=1');
    expect(sel()).toEqual({ key: '1m', imports: true });
    expect(view()).toBe('discipline');
    expect(env.pushes).toEqual([]);
    expect(nav.current.route).toEqual({ name: 'review' });
  });

  it('URL の読み書き: 気づきだけ鍵を持つ・知らない値は規律・規律の URL は今までと同じ', () => {
    expect(parseReviewView('?period=7d&view=insight')).toBe('insight');
    expect(parseReviewView('?period=7d')).toBe('discipline');
    expect(parseReviewView('?view=foo')).toBe('discipline');
    expect(reviewHref({ key: '3m', imports: false })).toBe('/review?period=3m');
    expect(reviewHref({ key: '3m', imports: false }, 'discipline')).toBe('/review?period=3m');
    // 期間の読み取りは view を見ない
    expect(parsePeriod('?period=3m&view=insight')).toEqual({ key: '3m', imports: false });
  });
});

describe('KEEP-2: 気づきを見ても書き込まない', () => {
  it('期間を変えて読み直しても GET だけ', async () => {
    const fake = createFakeApi({ trades: [...E1], instruments: INSTRUMENTS });
    const review = createReviewController({ api: fake.api });
    await review.load(R7);
    const one = periodRange({ key: '1m', imports: false }, REVIEW_NOW);
    if (one.ok) await review.load({ from: one.from, to: one.to });
    await review.reload();
    const s = review.getState();
    expect(s.phase).toBe('ready');
    // 気づきの表示の形を作る（読むだけ）
    if (one.ok) insightModelFor(s, one, { hidden: new Set(), includeImports: false });
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
    review.dispose();
  });
});
