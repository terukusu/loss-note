// 振り返りの「何で崩れたか」の崩れ方（判定の崩れの理由）の切り口と、行から「期間の取引」へたどる（Issue #239 の AC-1〜AC-7。
// 設計書 6.1・C68）。部品は関数として展開する（DOM を使わない）。値はすべて架空。
// 共通: 銘柄 US30、円建て、資金 1,000,000 円、L、イン 100.00、LC 99.50（幅 0.5）、数量 10,000。R = (決済 − イン) ÷ 0.5
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import {
  insightModel,
  insightModelFor,
  REASON_NONE,
  REASON_OVERLAP_NOTE,
} from '../../ui/src/lib/insight-view';
import {
  type PeriodSelection,
  parseWhy,
  periodRange,
  reviewHref,
  reviewTableHref,
  type WhyKey,
} from '../../ui/src/lib/period';
import { BREACH_NAME } from '../../ui/src/lib/reasons';
import type { ReviewState } from '../../ui/src/lib/review-controller';
import {
  parseTrail,
  reviewTradesHref,
  reviewTradesModel,
  type TrailFilter,
  trailTitle,
  whyOfTrail,
} from '../../ui/src/lib/review-trades';
import { REVIEW_EMPTY, reviewModelFor } from '../../ui/src/lib/review-view';
import { Link } from '../../ui/src/lib/router';
import { bootStack } from '../../ui/src/lib/tab-nav';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { ReviewView } from '../../ui/src/pages/Review';
import { closedInfoTip } from './helpers/info-tip';
import { exitAt, REVIEW_NOW } from './helpers/review-examples';
import { INSTRUMENTS, stored } from './helpers/trade-examples';

type Rec = Parameters<typeof stored>[1];

/** day 日目の 10:00 に決済した取引（R → 決済の価格 = 100 + R × 0.5。数量 qty） */
function tr(
  id: string,
  day: number,
  r: number | null,
  over: Rec = {},
  opts: { readonly qty?: number; readonly source?: 'manual' | 'import' } = {},
): StoredTrade {
  const qty = opts.qty ?? 10_000;
  const price = r === null ? 99 : Math.round((100 + r * 0.5) * 1e6) / 1e6;
  const n = Number(id.replace(/\D/g, '')) || 0;
  return stored(
    id,
    {
      source: opts.source ?? 'manual',
      entries: [{ price: 100, quantity: qty }],
      exit: {
        time: exitAt(day),
        price,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      statementPnlYen: Math.round((price - 100) * qty),
      ...over,
    },
    { createdAt: 1_763_000_000_000 + n },
  );
}

const widened = (after: number): Rec => ({ lcMove: { kind: 'widened', after } });

/**
 * Issue の例 E1（t9 の LC を広げた とナンピンを別の取引 t9・t10 に分けた形）: t3〜t10 が崩れ。i1 は取り込み
 * - t3 B −1.6 LC を広げた（広げた後 99.2 = 決済。持ち続けたにならない）
 * - t4 B −2.0 LC を広げた + 持ち続けた（広げた後 99.2 より不利な 99.0 で −1R を超える）
 * - t5 危ない勝ち +1.0 LC を広げた
 * - t6 C R なし LC を決めずに入った
 * - t7 B −0.5 金額ありき
 * - t8 B −1.2 LC を広げた + 過剰リスク（数量 50,000 → 1R 25,000 円 = 2.5% > 2%）
 * - t9 B −3.0 LC を広げた（広げた後 98.5 = 決済）
 */
const E1: readonly StoredTrade[] = [
  tr('t1', 0, -1.0),
  tr('t2', 0, 2.0),
  tr('t3', 1, -1.6, widened(99.2)),
  tr('t4', 1, -2.0, widened(99.2)),
  tr('t5', 2, 1.0, widened(99.2)),
  tr('t6', 2, null, { lc: undefined, lcDecidedBeforeEntry: false }),
  tr('t7', 3, -0.5, { lcBasis: 'amount' }),
  tr('t8', 4, -1.2, widened(99.4), { qty: 50_000 }),
  tr('t9', 5, -3.0, widened(98.5)),
  // t10 B −1.0 ナンピン 2 回（イン 100.00・99.80・99.60 を 10,000 ずつ、LC 99.50。R = (−0.5 −0.3 −0.1) ÷ (0.5 + 0.3 + 0.1) = −1.0）
  tr('t10', 5, null, {
    entries: [
      { price: 100, quantity: 10_000 },
      { price: 99.8, quantity: 10_000 },
      { price: 99.6, quantity: 10_000 },
    ],
    exit: {
      time: exitAt(5),
      price: 99.5,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    statementPnlYen: -9_000,
  }),
  tr('i1', 6, -1.5, widened(99.25), { source: 'import' }),
];

const SEVEN: PeriodSelection = { key: '7d', imports: false };
const range7 = periodRange(SEVEN, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };
const model = (trades: readonly StoredTrade[], includeImports = false) =>
  insightModel(trades, { hidden: new Set(), includeImports, range: R7, now: REVIEW_NOW });

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

function renderTree(
  trades: readonly StoredTrade[],
  why: WhyKey,
  onWhy: (v: WhyKey) => void = noop,
  /** 取引のタブの一覧（無ければ trades。期間の外にしか取引の無い利用者を作る） */
  list: readonly StoredTrade[] = trades,
): Node[] {
  const range = periodRange(SEVEN, REVIEW_NOW);
  const state: ReviewState = { phase: 'ready', range: R7, trades, truncated: false };
  const opts = { hidden: new Set<string>(), includeImports: false, now: REVIEW_NOW };
  const review: ReviewSlot = {
    selection: SEVEN,
    range,
    state,
    model: reviewModelFor(state, range, { ...opts, instruments: INSTRUMENTS }),
    why,
    insight: insightModelFor(state, range, opts),
    onWhy,
    tableHref: reviewTableHref(SEVEN),
    trailHref: (f: TrailFilter) => reviewTradesHref(SEVEN, f),
    onKey: noop,
    onDates: noop,
    onImports: noop,
    onReload: noop,
    onRelogin: noop,
  };
  const tradesState: TradesState = {
    phase: 'ready',
    trades: list,
    instruments: INSTRUMENTS,
    accounts: [],
    more: 'done',
  };
  const tree = expand(
    <ReviewView
      state={tradesState}
      hidden={new Set()}
      empty={<p>空</p>}
      onReload={noop}
      onRelogin={noop}
      review={review}
    />,
  );
  return tree;
}

function render(trades: readonly StoredTrade[], why: WhyKey, onWhy: (v: WhyKey) => void = noop) {
  return all(renderTree(trades, why, onWhy), hasClass('why'))[0] as El;
}

describe('AC-1・AC-2: E1 の崩れ方の集計の表示の形', () => {
  it('見出し・行の名前・件数・規律コスト（率なし）・件数が少ない行・重なり', () => {
    const r = model(E1).reason;
    expect(r?.headText).toBe('10 件のうち崩れ 8 件');
    expect(r?.rows.map((x) => x.text)).toEqual([
      // −0.6 − 1.0 + 0 − 0.2 − 2.0 = −3.8
      'LC を広げた 5 件 · 崩れで −3.8R',
      'LC を決めずに入った 1 件 · 件数が少ない',
      'LC で切らずに持ち続けた 1 件 · 件数が少ない',
      '過剰リスク 1 件 · 件数が少ない',
      '金額ありきの LC 1 件 · 件数が少ない',
      // 2 回のナンピンでも 1 件
      'ナンピン 1 件 · 件数が少ない',
    ]);
    expect(r?.main.map((x) => [x.kind, x.rateText, x.fractionText, x.costR])).toEqual([
      ['lcWidened', null, null, expect.closeTo(-3.8, 9)],
    ]);
    expect(r?.main[0]?.srText).toBe('LC を広げた 5 件、規律コスト 崩れで −3.8R');
    expect(r?.few.map((x) => [x.kind, x.restText])).toEqual([
      ['noLc', 'あと 4 件'],
      ['heldPastLc', 'あと 4 件'],
      ['overRisk', 'あと 4 件'],
      ['amountBasedLc', 'あと 4 件'],
      ['averagingDown', 'あと 4 件'],
    ]);
    expect(r?.overlapText).toBe(REASON_OVERLAP_NOTE);
    expect(r?.noneText).toBeNull();
  });

  it('E2: 取り込みを含めると LC を広げた 6 件 · 崩れで −4.3R・11 件のうち崩れ 9 件', () => {
    const r = model(E1, true).reason;
    expect(r?.headText).toBe('11 件のうち崩れ 9 件');
    expect(r?.rows[0]?.text).toBe('LC を広げた 6 件 · 崩れで −4.3R');
  });

  it('E6: 理由が 1 つずつ（重なりなし）なら重なりの 1 行を出さない', () => {
    const single = E1.filter((t) => !['t4', 't8'].includes(t.id));
    expect(model(single).reason?.overlapText).toBeNull();
  });
});

describe('AC-3・AC-7: 行の無い期間', () => {
  it('E3: A・計画どおりの勝ち（早逃げの注記つきの A を含む）だけ → 行 0・崩れなしの 1 行', () => {
    const early = tr('t2', 1, -0.8, {
      exit: {
        time: exitAt(1),
        price: 99.6,
        orderType: 'unknown',
        reason: 'fearEarly',
        gapSlip: 'unanswered',
      },
    });
    const r = model([E1[0] as StoredTrade, early, E1[1] as StoredTrade]).reason;
    expect(r?.rows).toEqual([]);
    expect(r?.headText).toBe('3 件のうち崩れ 0 件');
    expect(r?.noneText).toBe(REASON_NONE);
    const card = render([E1[0] as StoredTrade, early], 'reason');
    expect(text(card)).toContain(REASON_NONE);
    expect(all([card], (e) => e.type === 'li')).toEqual([]);
  });

  it('E4: 取引 0 件 → 崩れ方の組み立ては無く、心理と同じ空の文', () => {
    const m = model([]);
    expect(m.empty).toBe(true);
    expect(m.reason).toBeNull();
    // `&why=reason` で描いても「何で崩れたか」の箱は出さず、心理と同じ空の文
    const tree = renderTree([], 'reason', noop, [E1[0] as StoredTrade]);
    expect(all(tree, hasClass('why'))).toEqual([]);
    expect(text(tree)).toContain(REVIEW_EMPTY);
  });
});

describe('AC-5: 切り替え 心理 / 崩れ方 / More / Good と順位図', () => {
  it('切り替えは 4 つで崩れ方が選ばれ、見出し「何で崩れたか」と「10 件のうち崩れ 8 件」', () => {
    const card = render(E1, 'reason');
    expect(card.props['data-why']).toBe('reason');
    const radios = all([card], (e) => e.type === 'input' && e.props.name === 'review-why');
    expect(radios.map((e) => e.props.value)).toEqual(['emotion', 'reason', 'more', 'good']);
    expect(radios.find((e) => e.props.checked)?.props.value).toBe('reason');
    expect(text(all([card], (e) => e.type === 'h2'))).toBe('何で崩れたか');
    expect(text(card)).toContain('10 件のうち崩れ 8 件');
  });

  it('凡例は棒の長さ（規律コスト）だけで計画どおり率が無い・行に % が無い', () => {
    const card = render(E1, 'reason');
    const key = all([card], hasClass('insight__key'));
    expect(key).toHaveLength(1);
    expect(text(key)).toContain('棒の長さは規律コスト');
    expect(text(key)).not.toContain('計画どおり率');
    expect(text(card)).not.toContain('%');
  });

  it('行は押せる行で、その崩れ方の期間の取引へ（値の行と件数が少ない行）', () => {
    const card = render(E1, 'reason');
    const rows = all([card], (e) => e.type === 'li' && e.props['data-reason'] !== undefined);
    expect(
      rows.map((li) => [li.props['data-reason'], all([li], (e) => e.type === 'a')[0]?.props.href]),
    ).toEqual([
      ['lcWidened', '/review/trades?period=7d&reason=lcWidened'],
      ['noLc', '/review/trades?period=7d&reason=noLc'],
      ['heldPastLc', '/review/trades?period=7d&reason=heldPastLc'],
      ['overRisk', '/review/trades?period=7d&reason=overRisk'],
      ['amountBasedLc', '/review/trades?period=7d&reason=amountBasedLc'],
      ['averagingDown', '/review/trades?period=7d&reason=averagingDown'],
    ]);
    // 棒は読み上げから外し、行の全文で読ませる
    expect(text(all([rows[0] as El], hasClass('sr-only')))).toBe(
      'LC を広げた 5 件、規律コスト 崩れで −3.8R',
    );
  });

  it('崩れ方を押すと onWhy に reason を渡す', () => {
    const got: WhyKey[] = [];
    const card = render(E1, 'emotion', (v) => got.push(v));
    const seg = all([card], (e) => e.type === 'input' && e.props.value === 'reason')[0];
    expect(seg).toBeDefined();
    (seg as El).props.onChange &&
      ((seg as El).props.onChange as (e: unknown) => void)({ currentTarget: { value: 'reason' } });
    expect(got).toEqual(['reason']);
  });

  it('URL: 崩れ方は `&why=reason`（往復で同じ）・知らない値は心理', () => {
    expect(reviewHref(SEVEN, 'reason')).toBe('/review?period=7d&why=reason');
    expect(parseWhy('?period=7d&why=reason')).toBe('reason');
    expect(parseWhy('?period=7d&why=reasons')).toBe('emotion');
  });
});

describe('AC-6: 崩れ方の行から期間の取引へ', () => {
  const filter: TrailFilter = { kind: 'reason', id: 'lcWidened' };
  const href = reviewTradesHref(SEVEN, filter);

  it('URL の往復・崩れの理由の 8 種でない値は該当なし', () => {
    expect(href).toBe('/review/trades?period=7d&reason=lcWidened');
    expect(parseTrail('?period=7d&reason=lcWidened')).toEqual(filter);
    expect(parseTrail('?period=7d&reason=earlyExit')).toBeNull();
    expect(parseTrail('?period=7d&reason=foo')).toBeNull();
    expect(trailTitle(filter)).toBe(BREACH_NAME.lcWidened);
  });

  it('E5: 行は決済の新しい順の t9・t8・t5・t4・t3、要約は率なし、添えはほかの崩れ方', () => {
    const m = reviewTradesModel(E1, {
      hidden: new Set(),
      includeImports: false,
      range: R7,
      filter,
      instruments: INSTRUMENTS,
    });
    expect(m.title).toBe('LC を広げた');
    expect(m.rows.map((r) => r.id)).toEqual(['t9', 't8', 't5', 't4', 't3']);
    expect(m.summary).toBe('5 件 · 崩れで −3.8R');
    expect(m.summaryParts).toEqual(['5 件', '規律コスト 崩れで −3.8R']);
    expect(m.notes).toEqual({ t8: '過剰リスク', t4: 'LC で切らずに持ち続けた' });
  });

  it('件数が少ない崩れ方は規律コストを出さず、あと何件かを言う・0 件は何で絞ったかを言う', () => {
    const one = reviewTradesModel(E1, {
      hidden: new Set(),
      includeImports: false,
      range: R7,
      filter: { kind: 'reason', id: 'overRisk' },
      instruments: INSTRUMENTS,
    });
    expect(one.summary).toBe('1 件 · 件数が少ない');
    expect(one.summaryParts).toEqual(['1 件', '規律コスト あと 4 件で表示']);
    const none = reviewTradesModel(E1, {
      hidden: new Set(),
      includeImports: false,
      range: R7,
      filter: { kind: 'reason', id: 'lcCancelled' },
      instruments: INSTRUMENTS,
    });
    expect(none.emptyText).toBe('この期間に「持っている間に逆指値を取消」の取引はありません');
  });

  it('戻る先は崩れ方の切り口の振り返り（直接開いたときの組み直しも）', () => {
    expect(whyOfTrail(filter)).toBe('reason');
    expect(bootStack(href, { dev: false })).toEqual(['/', '/review?period=7d&why=reason', href]);
  });
});
