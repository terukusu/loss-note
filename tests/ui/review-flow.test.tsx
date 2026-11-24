// 振り返りのタブの 1 本の流れ（Issue #228 の AC-1〜AC-6。前は #162 の 規律 / 気づき のセグメントと気づきの心理ごとの集計のカード。
// その AC-1・AC-4・AC-6・KEEP-2 の値はここで保つ）。部品は関数として展開する（DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import {
  FEW_HEAD,
  INSIGHT_NONE,
  insightModelFor,
  NEXT_NONE,
  OVERLAP_NOTE,
} from '../../ui/src/lib/insight-view';
import {
  canonicalReviewHref,
  type PeriodSelection,
  parsePeriod,
  parseWhy,
  periodRange,
  reviewHref,
  reviewTableHref,
  type WhyKey,
} from '../../ui/src/lib/period';
import { createReviewController, type ReviewState } from '../../ui/src/lib/review-controller';
import { reviewNavActions } from '../../ui/src/lib/review-nav';
import { reviewTradesHref } from '../../ui/src/lib/review-trades';
import { REVIEW_ONLY_IMPORTS, reviewModelFor } from '../../ui/src/lib/review-view';
import { createNavigator, Link, type NavEnv } from '../../ui/src/lib/router';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { ReviewView } from '../../ui/src/pages/Review';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { E1, E1_HIDDEN, E5, E6, tagged } from './helpers/insight-examples';
import { R1, R1_HIDDEN, reflected } from './helpers/reflection-insight-examples';
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
  why: WhyKey = 'emotion',
  hidden: ReadonlySet<string> = new Set(),
  onWhy: (v: WhyKey) => void = noop,
  trail = false,
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
    why,
    insight: insightModelFor(state, range, {
      hidden,
      includeImports: sel.imports,
      now: REVIEW_NOW,
    }),
    onWhy,
    ...(trail ? { trailHref: (f) => reviewTradesHref(sel, f) } : {}),
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

describe('AC-1・AC-2: 1 本の流れ（セグメントなし）', () => {
  const r = render(slot(SEVEN, ready(E1), 'emotion', E1_HIDDEN, noop, true));

  it('規律 / 気づき のセグメントが無く、期間・範囲と件数の下に いくら → なぜ → 連勝の後 → どの取引 → 次は の順', () => {
    expect(radios(r, 'review-view')).toEqual([]);
    expect(radios(r, 'review-period')).toHaveLength(5);
    expect(text(all([r], hasClass('review__meta')))).toBe('11/13〜11/19 · 11 件');
    const cards = (all([r], hasClass('review__cards'))[0] as El).children.filter(
      (n): n is El => typeof n !== 'string',
    );
    const kinds = cards.map((c) =>
      ['review__costcard', 'review__ratecard', 'why', 'winrun', 'review__which', 'next'].find((k) =>
        hasClass(k)(c),
      ),
    );
    expect(kinds).toEqual([
      'review__costcard',
      'review__ratecard',
      'why',
      'winrun',
      'review__which',
      'next',
    ]);
    expect(text(all([r], (e) => e.type === 'h2' && e.props.class === 'why__title'))).toBe(
      '何で崩れたか次はこうする',
    );
  });

  it('44px の数字の段（num--xl）は規律コストの 1 つだけ・計画どおり率は 24px（num--lg）', () => {
    const xl = all([r], hasClass('num--xl'));
    expect(xl).toHaveLength(1);
    expect(all([r], hasClass('review__costcard'))[0]).toBeDefined();
    expect(
      all([all([r], hasClass('review__costcard'))[0] as El], hasClass('num--xl')),
    ).toHaveLength(1);
    const rate = all([all([r], hasClass('review__ratecard'))[0] as El], hasClass('num--lg'));
    expect(text(rate)).toBe('55');
  });

  it('どの取引: 崩れ（B・危ない勝ち・C）の件数つきの「崩れの取引を見る ›」と「数で見る ›」', () => {
    const which = all([r], hasClass('review__which'))[0] as El;
    const links = all([which], (e) => e.type === 'a');
    expect(links.map((a) => a.props.href)).toEqual([
      '/review/trades?period=7d&tier=off',
      '/review/table?period=7d',
    ]);
    expect(text(links[0] as El)).toBe('崩れの取引を見る5 件');
  });
});

describe('AC-5: 崩れが無い期間は「崩れの取引を見る ›」を出さない（E7）', () => {
  it('A・計画どおりの勝ちだけ', () => {
    const plan = E1.filter((t) => ['t1', 't2', 't3', 't4', 't5'].includes(t.id));
    const r = render(slot(SEVEN, ready(plan), 'emotion', new Set(), noop, true), plan);
    const which = all([r], hasClass('review__which'))[0] as El;
    expect(all([which], (e) => e.type === 'a').map((a) => a.props.href)).toEqual([
      '/review/table?period=7d',
    ]);
  });
});

describe('AC-1（#162 の値を保つ）: E1 の心理の順位図', () => {
  const r = render(slot(SEVEN, ready(E1), 'emotion', E1_HIDDEN));
  const card = all([r], hasClass('why'))[0] as El;

  it('見出し「何で崩れたか」と「11 件のうち 10 件に記入」・切り替え 3 つ（心理が選ばれている）', () => {
    expect(text(all([card], (e) => e.type === 'h2'))).toBe('何で崩れたか');
    expect(text(card)).toContain('11 件のうち 10 件に記入');
    const why = radios(card, 'review-why');
    expect(why.map((e) => e.props.value)).toEqual(['emotion', 'more', 'good']);
    expect(why.find((e) => e.props.checked)?.props.value).toBe('emotion');
  });

  it('値の行: 平常心（基準）→ 取り戻したい。読み上げは列の名前つきの全文・見た目の部品（棒も）は外す（行は押せない）', () => {
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
      '平常心基準5 件 · 100%（5 / 5）崩れなし±0.0R',
      // R の出ない取引（t9 の C）は 1 行目の添え（#228 のレビュー 8）
      '取り戻したい5 件 · 0%（0 / 5） · R なし 1 件崩れで−1.8R',
    ]);
    // 棒は 0 と 100%（取り戻したいがいちばん多く失った）
    const fills = rows.map((e) => all([e], hasClass('insight__fill')).map((f) => f.props.width));
    expect(fills).toEqual([[], ['100.0%']]);
    for (const e of rows) {
      const bar = all([e], hasClass('insight__bar'))[0] as El;
      expect(bar.props['aria-hidden']).toBe('true');
    }
    // 押せるのは凡例の「i」2 つだけ（行はリンク・ボタンにしない）
    expect(all([card], (e) => e.type === 'a')).toEqual([]);
    const buttons = all([card], (e) => e.type === 'button');
    expect(buttons.map((b) => b.props['aria-label'])).toEqual([
      '「規律コスト」の説明',
      '「計画どおり率」の説明',
    ]);
  });

  it('凡例の 1 行（棒の長さ・率）は 1 回だけ', () => {
    const key = all([card], hasClass('insight__key'));
    expect(key).toHaveLength(1);
    expect(text(key)).toContain('棒の長さは規律コスト');
    expect(text(key)).toContain('率は計画どおり率');
  });

  it('件数が少ない行は見出し 1 回の下に名前・件数・あと何件だけ（%・分数・R の文が無い）', () => {
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
    // 見た目は名前と件数だけの小さな押せる形（「あと N 件」は読み上げの全文と見出しに。#228 のレビュー 4）
    const shown = few.map((e) => text(all([e], (x) => x.props['aria-hidden'] === 'true')));
    expect(shown).toEqual([
      '儲けたい 1 件',
      'ポジりたい 1 件',
      '調子に乗った 1 件',
      '切れない 1 件',
    ]);
  });

  it('添えの 1 行', () => {
    expect(text(card)).toContain(OVERLAP_NOTE);
  });
});

describe('AC-3: 順位図の並びと棒（E1）', () => {
  // E1 に、5 件で −0.4R の心理（乗り遅れ怖い: B −1.2R × 2・A × 3）を足す。並びは 平常心 → 取り戻したい（−1.8R）→ 乗り遅れ怖い（−0.4R）
  const fomo = [
    tagged('f1', 0, 'B', -1.2, ['fomo']),
    tagged('f2', 1, 'B', -1.2, ['fomo']),
    tagged('f3', 2, 'A', -1.0, ['fomo']),
    tagged('f4', 3, 'A', -1.0, ['fomo']),
    tagged('f5', 4, 'A', -1.0, ['fomo']),
  ];
  const trades = [...fomo, ...E1];
  it('件数の多い順ではなく、多く失った順（基準は先頭）。棒 = 0・100%・22.2%', () => {
    const r = render(slot(SEVEN, ready(trades), 'emotion', E1_HIDDEN), trades);
    const rows = all([all([r], hasClass('why'))[0] as El], hasClass('insight__row'));
    expect(rows.map((e) => e.props['data-emotion'])).toEqual(['calm', 'recoup', 'fomo']);
    expect(rows.map((e) => all([e], hasClass('insight__fill'))[0]?.props.width ?? '0')).toEqual([
      '0',
      '100.0%',
      '22.2%',
    ]);
  });
});

describe('#228 のレビュー 8: 崩れの R が 0 の行の言い方', () => {
  it('R の出ない取引がある 0 の行は「崩れで ±0.0R」と「R なし N 件」（「R で測れる崩れ」と書かない）、無ければ「崩れなし」', () => {
    // 都合よく解釈 5 件: A 4（R −1.0）・C 1（LC なし = R なし）。平常心 5 件: A 5
    const trades = [
      ...['c1', 'c2', 'c3', 'c4'].map((id, i) => tagged(id, i, 'A', -1.0, ['confirmation'])),
      tagged('c5', 4, 'C', -2.0, ['confirmation']),
      ...['k1', 'k2', 'k3', 'k4', 'k5'].map((id, i) => tagged(id, i, 'A', -1.0, ['calm'])),
    ];
    const r = render(slot(SEVEN, ready(trades)), trades);
    const rows = all([all([r], hasClass('why'))[0] as El], hasClass('insight__row'));
    const cells = rows.map((e) => text(all([e], hasClass('insight__cells'))[0] as El));
    expect(cells).toEqual([
      '平常心基準5 件 · 100%（5 / 5）崩れなし±0.0R',
      '都合よく解釈5 件 · 80%（4 / 5） · R なし 1 件崩れで±0.0R',
    ]);
    for (const c of cells) expect(c).not.toContain('R で測れる崩れ');
    // 読み上げの全文は前のまま（KEEP-1）
    expect(text(all([rows[1] as El], hasClass('sr-only')))).toBe(
      '都合よく解釈 5 件、計画どおり率 80%（4 / 5）、規律コスト R で測れる崩れ ±0.0R',
    );
  });
});

describe('AC-4: 切り替え More / Good', () => {
  it('More を押すと onWhy に渡す。More を開くと More の話題の順位図（data-topic）と見出しの記入の件数', () => {
    const got: WhyKey[] = [];
    const r = render(
      slot(SEVEN, ready(R1), 'emotion', R1_HIDDEN, (v) => got.push(v)),
      R1,
    );
    const more = radios(r, 'review-why').find((e) => e.props.value === 'more') as El;
    (more.props.onChange as () => void)();
    expect(got).toEqual(['more']);
    const m = render(slot(SEVEN, ready(R1), 'more', R1_HIDDEN), R1);
    const card = all([m], hasClass('why'))[0] as El;
    expect(card.props['data-why']).toBe('more');
    expect(text(card)).toContain('11 件のうち 5 件に記入');
    const rows = all([card], hasClass('insight__row'));
    expect(rows.map((e) => e.props['data-topic'])).toEqual(['oversized']);
    expect(text(all([rows[0] as El], hasClass('sr-only')))).toBe(
      '数量が多すぎた 5 件、計画どおり率 0%（0 / 5）、規律コスト 崩れで −1.8R',
    );
    const g = render(slot(SEVEN, ready(R1), 'good', R1_HIDDEN), R1);
    const gcard = all([g], hasClass('why'))[0] as El;
    // 見出しは Good だけ「何が効いたか」（#228 のレビュー 5）
    expect(text(all([card], (e) => e.type === 'h2'))).toBe('何で崩れたか');
    expect(text(all([gcard], (e) => e.type === 'h2'))).toBe('何が効いたか');
    expect(all([gcard], hasClass('insight__row')).map((e) => e.props['data-topic'])).toEqual([
      'followedRules',
    ]);
  });

  it('Good / More が両側とも付いていない期間は付け方の 2 行', () => {
    const r = render(slot(SEVEN, ready(E1), 'more', E1_HIDDEN));
    const card = all([r], hasClass('why'))[0] as El;
    expect(text(card)).toContain('この期間の取引に Good / More は付いていません。');
    expect(all([card], hasClass('insight__row'))).toEqual([]);
  });
});

describe('AC-6: 次はこうする', () => {
  it('E8: More の自分で書いた行のある取引のうち決済のいちばん新しい取引の最初の行・日付・押せる行', () => {
    const trades = [
      reflected('n1', 5, 'B', -1.2, {
        moreNotes: ['同じ日に 2 回目は入らない', '入る前に LC を置く'],
      }),
      reflected('n2', 4, 'B', -1.2, { moreNotes: ['数量を 1R から逆算する'] }),
      ...E1.filter((t) => t.id === 't1'),
    ];
    const r = render(slot(SEVEN, ready(trades), 'emotion', new Set(), noop, true), trades);
    const next = all([r], hasClass('next'))[0] as El;
    expect(text(all([next], hasClass('next__text')))).toBe('「同じ日に 2 回目は入らない」');
    expect(text(next)).toContain('11/18 の取引');
    const link = all([next], (e) => e.type === 'a')[0] as El;
    expect(link.props.href).toBe('/review/trades?period=7d&notes=more');
    expect(text(link)).toBe('More の自分で書いた行を見る2 件');
  });

  it('自分で書いた行はテキストのノード（HTML として解かない・要素が増えない）', () => {
    const trades = [reflected('n1', 5, 'B', -1.2, { moreNotes: ['<b>太字</b>'] })];
    const r = render(slot(SEVEN, ready(trades), 'emotion', new Set(), noop, true), trades);
    const q = all([r], hasClass('next__text'))[0] as El;
    expect(q.children).toEqual(['「', '<b>太字</b>', '」']);
    expect(all([q], (e) => e.type === 'b')).toEqual([]);
  });

  it('E9: More の自分で書いた行が無い → 案内の 1 行だけ（押せる行なし）', () => {
    const r = render(slot(SEVEN, ready(E1), 'emotion', E1_HIDDEN, noop, true));
    const next = all([r], hasClass('next'))[0] as El;
    expect(text(all([next], (e) => e.type === 'p'))).toBe(NEXT_NONE);
    expect(all([next], (e) => e.type === 'a')).toEqual([]);
  });
});

describe('行が 0 の期間・読み込み', () => {
  it('E5: 付け方の 1 行・行 0', () => {
    const r = render(slot(SEVEN, ready(E5)), E5);
    expect(all([r], hasClass('insight__row'))).toEqual([]);
    expect(text(r)).toContain(INSIGHT_NONE);
    expect(text(r)).toContain('3 件のうち 0 件に記入');
    // 付けに行ける: 取引のタブへ（2 番目の重さのボタン）
    const go = all([r], (e) => e.type === 'a' && text(e).includes('取引を見る'));
    expect(go.map((e) => e.props.href)).toEqual(['/trades']);
  });

  it('E6: 取り込みだけ → 規律と同じ文・なぜ・次はの段を出さない', () => {
    const r = render(slot(SEVEN, ready(E6)), E6);
    expect(all([r], hasClass('why'))).toEqual([]);
    expect(all([r], hasClass('next'))).toEqual([]);
    expect(text(r)).toContain(REVIEW_ONLY_IMPORTS);
    expect(all([r], hasClass('review__toggle'))).toHaveLength(1);
  });

  it('読み込み中は骨組み・期間の切り替えの途中は前の流れを薄く残す', () => {
    const first = render(slot(SEVEN, { phase: 'loading', range: R7 }));
    expect(all([first], hasClass('review__skeleton'))).toHaveLength(1);
    const before = slot(SEVEN, ready(E1), 'emotion', E1_HIDDEN);
    const loading = slot({ key: '1m', imports: false }, { phase: 'loading', range: R7 });
    const r = render({
      ...loading,
      previous: before.model ?? null,
      previousInsight: before.insight ?? null,
    });
    const busy = all([r], hasClass('review__body--busy'))[0] as El;
    expect(busy.props['aria-busy']).toBe('true');
    expect(all([busy], hasClass('review__costcard'))).toHaveLength(1);
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

describe('AC-1・AC-4: URL（切り替えの置き換え・期間で保つ・前の URL の置き換え）', () => {
  it('E2・E3（hook と同じつなぎ方 = lib/review-nav.ts を本物の navigator で）: More → 1 か月 → 取り込み → 心理。どれも置き換え', () => {
    const env = new FakeEnv('/review?period=7d');
    const nav = createNavigator(env, { dev: false });
    // useReview は描くたびに今の検索部分で reviewNavActions を作り直す。ここも操作のたびに作り直す
    const act = () => reviewNavActions(nav.current.search, nav, { now: () => REVIEW_NOW });
    act().onWhy('more');
    expect(env.url).toBe('/review?period=7d&why=more');
    act().onKey('1m');
    expect(env.url).toBe('/review?period=1m&why=more');
    act().onImports(true);
    expect(env.url).toBe('/review?period=1m&imports=1&why=more');
    expect(act().tableHref).toBe('/review/table?period=1m&imports=1');
    expect(act().trailHref({ kind: 'off' })).toBe('/review/trades?period=1m&imports=1&tier=off');
    act().onWhy('more'); // 同じ切り替えは何もしない
    act().onWhy('emotion');
    expect(env.url).toBe('/review?period=1m&imports=1');
    expect(parsePeriod(nav.current.search)).toEqual({ key: '1m', imports: true });
    expect(parseWhy(nav.current.search)).toBe('emotion');
    expect(env.replaces).toHaveLength(4);
    expect(env.pushes).toEqual([]);
    expect(nav.current.route).toEqual({ name: 'review' });
  });

  it('E4（hook の effect が呼ぶ redirect）: 前の URL は置き換え・canonical を渡さない画面（数で見る・期間の取引）は置き換えない', () => {
    const env = new FakeEnv('/review?period=1m&view=insight&why=good');
    const nav = createNavigator(env, { dev: false });
    const tab = reviewNavActions(nav.current.search, nav, {
      canonical: true,
      now: () => REVIEW_NOW,
    });
    expect(tab.canonical).toBe('/review?period=1m&why=good');
    tab.redirect();
    expect(env.url).toBe('/review?period=1m&why=good');
    expect(env.pushes).toEqual([]);
    // 置き換えた後は今の形なので、もう一度描いても置き換えない
    const again = reviewNavActions(nav.current.search, nav, {
      canonical: true,
      now: () => REVIEW_NOW,
    });
    expect(again.canonical).toBeNull();
    again.redirect();
    expect(env.replaces).toHaveLength(1);
    // canonical を渡さない組み立ては view があっても置き換えない
    const env2 = new FakeEnv('/review/table?period=7d&view=insight');
    const nav2 = createNavigator(env2, { dev: false });
    const table = reviewNavActions(nav2.current.search, nav2, {
      hrefOf: reviewTableHref,
      now: () => REVIEW_NOW,
    });
    table.redirect();
    expect(env2.replaces).toEqual([]);
    // 数で見るの期間の操作は表の URL に置き換える（切り替えを持ち込まない）
    table.onKey('3m');
    expect(env2.url).toBe('/review/table?period=3m');
  });

  it('URL の読み書き: More / Good だけ鍵を持つ・知らない値は心理・心理の URL は今までと同じ', () => {
    expect(parseWhy('?period=7d&why=more')).toBe('more');
    expect(parseWhy('?period=7d&why=good')).toBe('good');
    expect(parseWhy('?period=7d')).toBe('emotion');
    expect(parseWhy('?why=foo')).toBe('emotion');
    expect(reviewHref({ key: '3m', imports: false })).toBe('/review?period=3m');
    expect(reviewHref({ key: '3m', imports: false }, 'emotion')).toBe('/review?period=3m');
    expect(reviewHref({ key: '3m', imports: true }, 'good')).toBe(
      '/review?period=3m&imports=1&why=good',
    );
    expect(parsePeriod('?period=3m&why=more')).toEqual({ key: '3m', imports: false });
  });

  it('E4: 前の URL `&view=insight` は view を外した URL に置き換える（今の形なら置き換えない）', () => {
    expect(canonicalReviewHref('?period=7d&view=insight')).toBe('/review?period=7d');
    expect(canonicalReviewHref('?period=1m&imports=1&view=insight')).toBe(
      '/review?period=1m&imports=1',
    );
    expect(canonicalReviewHref('?period=7d&view=discipline&why=more')).toBe(
      '/review?period=7d&why=more',
    );
    expect(canonicalReviewHref('?period=7d')).toBeNull();
    expect(canonicalReviewHref('?period=7d&why=good')).toBeNull();
    expect(canonicalReviewHref('')).toBeNull();
    // 置き換えは履歴を積まない（useReview は nav.replace で渡す）
    const env = new FakeEnv('/review?period=7d&view=insight');
    const nav = createNavigator(env, { dev: false });
    const to = canonicalReviewHref(nav.current.search);
    if (to) nav.replace(to);
    expect(env.url).toBe('/review?period=7d');
    expect(env.pushes).toEqual([]);
  });
});

describe('KEEP-2: 振り返りを見ても書き込まない', () => {
  it('期間を変えて読み直しても GET だけ', async () => {
    const fake = createFakeApi({ trades: [...E1], instruments: INSTRUMENTS });
    const review = createReviewController({ api: fake.api });
    await review.load(R7);
    const one = periodRange({ key: '1m', imports: false }, REVIEW_NOW);
    if (one.ok) await review.load({ from: one.from, to: one.to });
    await review.reload();
    const s = review.getState();
    expect(s.phase).toBe('ready');
    // なぜ・次はの表示の形を作る（読むだけ）
    if (one.ok) insightModelFor(s, one, { hidden: new Set(), includeImports: false });
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
    review.dispose();
  });
});
