// ホームの規律の振り返りの段（Issue #88 AC-7・AC-8・AC-10・KEEP-4）。部品は関数として展開する（DOM を使わない）。
// 値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import type { ReviewSlot } from '../../ui/src/components/ReviewSummary';
import {
  homeHref,
  type PeriodKey,
  type PeriodSelection,
  parsePeriod,
  periodActions,
  periodRange,
} from '../../ui/src/lib/period';
import {
  createReviewController,
  REVIEW_LOAD_FAILED,
  type ReviewState,
} from '../../ui/src/lib/review-controller';
import { reviewModelFor } from '../../ui/src/lib/review-view';
import { createNavigator, Link, type NavEnv } from '../../ui/src/lib/router';
import { HOME_LIMIT } from '../../ui/src/lib/trade-pages';
import { createTradesController, type TradesState } from '../../ui/src/lib/trades-controller';
import { HomeView } from '../../ui/src/pages/Home';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { REVIEW_NOW, S1, S4_IMPORTS } from './helpers/review-examples';
import { H1, INSTRUMENTS, US30 } from './helpers/trade-examples';

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
const NONE = new Set<string>();
const emptyEl = <p>空</p>;

const tradesReady = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
  more: 'done',
});

function slot(sel: PeriodSelection, state: ReviewState): ReviewSlot {
  const range = periodRange(sel, REVIEW_NOW);
  return {
    selection: sel,
    range,
    state,
    model: reviewModelFor(state, range, {
      hidden: NONE,
      includeImports: sel.imports,
      instruments: INSTRUMENTS,
      now: REVIEW_NOW,
    }),
    onKey: noop,
    onDates: noop,
    onImports: noop,
    onReload: noop,
    onRelogin: noop,
  };
}

const SEVEN: PeriodSelection = { key: '7d', imports: false };
const range7 = periodRange(SEVEN, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };

function home(review: ReviewSlot, recent: TradesState = tradesReady(H1)) {
  return expand(
    <HomeView
      state={recent}
      hidden={NONE}
      empty={emptyEl}
      onReload={noop}
      onRelogin={noop}
      review={review}
    />,
  );
}

const reviewOf = (tree: Node[]) => all(tree, hasClass('review'))[0] as El;

describe('振り返りの段の並びと中身（S1）', () => {
  const tree = home(slot(SEVEN, { phase: 'ready', range: R7, trades: S1, truncated: false }));
  const r = reviewOf(tree);

  it('[記録する] → 振り返り → 直近の判定の順', () => {
    const order = all(
      tree,
      (e) =>
        hasClass('home__record')(e) ||
        hasClass('review')(e) ||
        e.props['aria-labelledby'] === 'home-recent-title',
    ).map((e) =>
      hasClass('home__record')(e) ? 'record' : hasClass('review')(e) ? 'review' : 'recent',
    );
    expect(order).toEqual(['record', 'review', 'recent']);
  });

  it('期間の 5 つの選択肢（radio）・範囲と件数の行（aria-live）・数字の段', () => {
    const radios = all([r], (e) => e.type === 'input' && e.props.type === 'radio');
    expect(radios.map((e) => e.props.value)).toEqual(['1d', '7d', '1m', '3m', 'custom']);
    expect(radios.find((e) => e.props.checked)?.props.value).toBe('7d');
    const meta = all([r], hasClass('review__meta'))[0] as El;
    expect(text(meta)).toBe('11/13〜11/19 · 7 件');
    expect(meta.props['aria-live']).toBe('polite');
    const s = text(r);
    for (const w of ['57%', '4 / 7 件', '崩れで −0.6R', '守っていれば +0.9R · 実際 +0.3R']) {
      expect(s).toContain(w);
    }
    // 円を出さない（6.3）
    expect(s).not.toMatch(/円/);
  });

  it('計画どおり率・規律コストの横に「i」（用語集の言葉）', () => {
    const names = all(
      [r],
      (e) => e.type === 'button' && /の説明$/.test(String(e.props['aria-label'] ?? '')),
    ).map((e) => e.props['aria-label']);
    // 並びの組み替え（デザインレビュー 1）: 一言の見出しの規律コスト → 曲線 → 計画どおり率
    expect(names).toEqual(['「規律コスト」の説明', '「計画どおり率」の説明']);
  });

  it('内訳: 帯は読み上げから外し、凡例は記号・名前・件数', () => {
    const bar = all([r], hasClass('review__bar'))[0] as El;
    expect(bar.props['aria-hidden']).toBe('true');
    expect(all([bar], (e) => e.type === 'rect').map((e) => e.props.class)).toEqual([
      'review__seg review__seg--plan',
      'review__seg review__seg--plan',
      'review__seg review__seg--break',
      'review__seg review__seg--break',
      'review__seg review__seg--worst',
    ]);
    const items = all([r], hasClass('review__legend-item')).map(text);
    expect(items).toEqual([
      'A いい損失2',
      '計画どおりの勝ち2',
      'B 悪い損失1',
      '危ない勝ち1',
      'C 極悪な損失1',
    ]);
  });

  it('AC-10: 曲線は読み上げから外し、「数で見る」の表は R の出た 6 行（日付・銘柄・判定・R・2 つの累積 + 差）', () => {
    const curve = all([r], hasClass('curve'))[0] as El;
    expect(curve.props['aria-hidden']).toBe('true');
    for (const svg of all([r], (e) => e.type === 'svg')) {
      // 図の SVG は自分か祖先で aria-hidden（読み上げの名前を持たない）
      expect(svg.props['aria-label']).toBeUndefined();
    }
    const details = all([r], (e) => e.type === 'details')[0] as El;
    expect(details.props.open).toBeUndefined();
    expect(text(all([details], (e) => e.type === 'summary'))).toBe('数で見る');
    const head = all([details], (e) => e.type === 'th').map(text);
    expect(head).toEqual(['日付', '銘柄', '判定', 'R', '実際の累積', '計画どおりの累積', '差']);
    const rows = all([details], (e) => e.type === 'tbody')
      .flatMap((b) => all([b], (e) => e.type === 'tr'))
      .map((tr) => all([tr], (e) => e.type === 'td').map(text));
    expect(rows).toHaveLength(6);
    expect(rows.every((cells) => cells.length === 7)).toBe(true);
    expect(rows[2]).toEqual(['11/15', 'US30', 'B 悪い損失', '−1.6R', '−0.6R', '±0.0R', '−0.6R']);
    // 横に送る箱はキーボードでも送れる（tabindex・名前つきの region）
    const box = all([details], hasClass('review__scroll'))[0] as El;
    expect([box.type, box.props.tabIndex]).toEqual(['section', 0]);
    expect(box.props['aria-labelledby']).toBe('home-review-table-caption');
    expect(text(all([details], (e) => e.type === 'caption'))).toContain('決済の古い順');
    const s = text(r);
    expect(s).toContain('危ない勝ち 1 件 +0.5R は運です');
    expect(s).toContain('LC が無い 1 件は曲線に入れていません');
  });
});

describe('AC-7: 取り込んだ取引の切り替え（S4）', () => {
  const box = (tree: Node[]) =>
    all(reviewOf(tree).children, (e) => e.type === 'input' && e.props.type === 'checkbox');

  it('取り込みが無ければ切り替えは出ない', () => {
    expect(
      box(home(slot(SEVEN, { phase: 'ready', range: R7, trades: S1, truncated: false }))),
    ).toEqual([]);
  });

  it('既定は外して件数の 1 行、含めると 9 件・56%（5 / 9 件）', () => {
    const off = home(
      slot(SEVEN, { phase: 'ready', range: R7, trades: [...S1, ...S4_IMPORTS], truncated: false }),
    );
    expect(box(off)).toHaveLength(1);
    expect(box(off)[0]?.props.checked).toBe(false);
    const s = text(reviewOf(off));
    expect(s).toContain('含めて集計する');
    expect(s).toContain('取り込んだ取引 2 件は集計に含めていません');
    expect(s).toContain('4 / 7 件');
    const on = home(
      slot(
        { ...SEVEN, imports: true },
        { phase: 'ready', range: R7, trades: [...S1, ...S4_IMPORTS], truncated: false },
      ),
    );
    expect(box(on)[0]?.props.checked).toBe(true);
    const t = text(reviewOf(on));
    expect(t).toContain('· 9 件');
    expect(t).toContain('56%');
    expect(t).toContain('5 / 9 件');
    expect(t).not.toContain('は集計に含めていません');
  });
});

describe('件数が少ない・0 件・期間の誤り', () => {
  it('S3: 0 件は文だけ（数字・内訳・曲線を出さない）。期間の選択は残る', () => {
    const tree = home(slot(SEVEN, { phase: 'ready', range: R7, trades: [], truncated: false }));
    const r = reviewOf(tree);
    expect(text(r)).toContain('この期間に決済した取引はありません');
    expect(all([r], hasClass('review__stats'))).toEqual([]);
    expect(all([r], hasClass('curve'))).toEqual([]);
    expect(all([r], (e) => e.type === 'input' && e.props.type === 'radio')).toHaveLength(5);
  });

  it('P7: 任意の誤りは欄の下に文言、読まない（範囲の行も出さない）', () => {
    const sel: PeriodSelection = {
      key: 'custom',
      from: '2026-11-10',
      to: '2026-11-01',
      imports: false,
    };
    const tree = home(slot(sel, { phase: 'idle' }));
    const r = reviewOf(tree);
    expect(all([r], (e) => e.type === 'input' && e.props.type === 'date')).toHaveLength(2);
    expect(text(all([r], hasClass('field__error')))).toBe('開始日は終了日より前にしてください');
    expect(all([r], hasClass('review__meta'))).toEqual([]);
  });
});

describe('KEEP-4: 振り返りだけ失敗しても [記録する] と直近の判定は出る', () => {
  it('偽の API で範囲つきの GET だけ 503 → 直近 5 件は読め、振り返りは決まった文言と [再読み込み]', async () => {
    const fake = createFakeApi({
      trades: H1,
      instruments: [US30],
      fail: { 'GET /api/trades?range': 503 },
    });
    const recent = createTradesController({ api: fake.api, pageSize: HOME_LIMIT });
    const review = createReviewController({ api: fake.api });
    await Promise.all([recent.load(), review.load(R7)]);
    expect(recent.getState().phase).toBe('ready');
    const tree = home(slot(SEVEN, review.getState()), recent.getState());
    expect(all(tree, hasClass('home__record'))).toHaveLength(1);
    expect(all(tree, hasClass('traderow'))).toHaveLength(5);
    const r = reviewOf(tree);
    expect(text(r)).toContain(REVIEW_LOAD_FAILED);
    expect(text(all([r], (e) => e.type === 'button'))).toContain('再読み込み');
    // 応答の本文を出さない
    expect(text(r)).not.toContain('偽物');
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

describe('AC-8: 期間と取り込みの切り替えは URL の置き換え（履歴を積まない）・開き直すと同じ表示', () => {
  const keys: readonly PeriodKey[] = ['1d', '7d', '1m', '3m', 'custom'];
  for (const key of keys) {
    for (const imports of [false, true]) {
      it(`${key} × 取り込み ${imports ? '含める' : '外す'}`, () => {
        const env = new FakeEnv('/');
        const nav = createNavigator(env, { dev: false });
        const act = () =>
          periodActions(
            parsePeriod(nav.current.search),
            () => REVIEW_NOW,
            (n) => nav.replace(homeHref(n)),
          );
        if (key !== '7d') act().onKey(key);
        if (imports) act().onImports(true);
        expect(env.pushes).toEqual([]);
        expect(env.replaces.length).toBe((key !== '7d' ? 1 : 0) + (imports ? 1 : 0));
        expect(nav.current.route).toEqual({ name: 'home' });
        expect(nav.current.via).toBe(env.replaces.length > 0 ? 'replace' : 'init');
        const shown = parsePeriod(nav.current.search);
        expect(shown.key).toBe(key);
        expect(shown.imports).toBe(imports);
        // 開き直す（同じ URL で作り直す）→ 同じ期間・切り替え・範囲
        const again = createNavigator(new FakeEnv(env.url), { dev: false });
        const reopened = parsePeriod(again.current.search);
        expect(reopened).toEqual(shown);
        expect(periodRange(reopened, REVIEW_NOW)).toEqual(periodRange(shown, REVIEW_NOW));
        if (key === 'custom') {
          // 任意を選んだ最初の日付は 7 日と同じ範囲
          const r = periodRange(reopened, REVIEW_NOW);
          expect(r.ok && [r.from, r.to]).toEqual([R7.from, R7.to]);
        }
      });
    }
  }

  it('任意の日付を変えると URL の from / to が変わる', () => {
    const env = new FakeEnv('/?period=custom&from=2026-11-13&to=2026-11-19');
    const nav = createNavigator(env, { dev: false });
    periodActions(
      parsePeriod(nav.current.search),
      () => REVIEW_NOW,
      (n) => nav.replace(homeHref(n)),
    ).onDates('2026-11-01', '2026-11-10');
    expect(env.url).toBe('/?period=custom&from=2026-11-01&to=2026-11-10');
    const r = periodRange(parsePeriod(nav.current.search), REVIEW_NOW);
    expect(r.ok && r.label).toBe('11/1〜11/10');
    expect(env.pushes).toEqual([]);
  });

  it('同じ期間を押しても URL を変えない', () => {
    const env = new FakeEnv('/?period=1d');
    const nav = createNavigator(env, { dev: false });
    periodActions(
      parsePeriod(nav.current.search),
      () => REVIEW_NOW,
      (n) => nav.replace(homeHref(n)),
    ).onKey('1d');
    expect(env.replaces).toEqual([]);
  });
});

describe('レビュー後の修正（#88 Phase 4・4b）', () => {
  const ready = (trades: readonly StoredTrade[], truncated = false): ReviewState => ({
    phase: 'ready',
    range: R7,
    trades,
    truncated,
  });

  it('期間を変えた直後（読み終えた範囲が 7 日・今の期間が 1 日）は前の件数を出さず、読み込み中', () => {
    const r = reviewOf(home(slot({ key: '1d', imports: false }, ready(S1))));
    expect(text(all([r], hasClass('review__meta')))).toBe('11/19');
    expect(text(r)).toContain('読み込んでいます');
    expect(all([r], hasClass('curve'))).toEqual([]);
  });

  it('期間の切り替えの途中は前の図を薄く残す（aria-busy・中は読み上げから外す）。最初の読み込みは高さを取る骨組み', () => {
    const before = slot(SEVEN, ready(S1));
    const one: PeriodSelection = { key: '1m', imports: false };
    const loading = slot(one, { phase: 'loading', range: R7 });
    const r = reviewOf(home({ ...loading, previous: before.model }));
    const busy = all([r], hasClass('review__body--busy'))[0] as El;
    expect(busy.props['aria-busy']).toBe('true');
    expect(
      all([busy], (e) => e.props['aria-hidden'] === 'true' && e.props.inert === true),
    ).toHaveLength(1);
    expect(all([busy], hasClass('curve'))).toHaveLength(1);
    // 範囲の行に前の件数を出さない
    expect(text(all([r], hasClass('review__meta')))).not.toContain('件');
    const first = reviewOf(home(slot(SEVEN, { phase: 'loading', range: R7 })));
    expect(all([first], hasClass('review__skeleton'))).toHaveLength(1);
  });

  it('件数の上限で切れた応答は 1 行の注記（C44）', () => {
    const r = reviewOf(home(slot(SEVEN, ready(S1, true))));
    expect(text(r)).toContain('期間の取引が多いので先頭の 2,000 件で集計しています');
  });

  it('並び: 一言の見出し → 曲線 → 計画どおり率と内訳 →「数で見る」', () => {
    const r = reviewOf(home(slot(SEVEN, ready(S1))));
    const order = all([r], (e) =>
      ['review__head', 'curve', 'review__grid', 'review__table'].some((c) => hasClass(c)(e)),
    ).map((e) => String(e.props.class).split(' ')[0]);
    expect(order).toEqual(['review__head', 'curve', 'review__grid', 'review__table']);
    // 主役は崩れで失った R（num--xl）。2 行目に守っていれば · 実際、計画どおり率は num--lg（見出しより小さく）
    const head = all([r], hasClass('review__headline'))[0] as El;
    expect(text(head)).toBe('崩れで −0.6R');
    expect(all([head], hasClass('num--xl'))).toHaveLength(1);
    expect(text(all([r], hasClass('review__subline')))).toBe('守っていれば +0.9R · 実際 +0.3R');
    const rate = all([r], hasClass('review__grid'))[0] as El;
    expect(all([rate], hasClass('num--lg')).map(text)).toEqual(['57%']);
    expect(all([rate], hasClass('num--xl'))).toEqual([]);
  });

  it('0 件の期間は「3か月で見る」で次の 1 手（押すと 3 か月）', () => {
    let pressed: string | null = null;
    const base = slot(SEVEN, ready([]));
    const r = reviewOf(
      home({
        ...base,
        onKey: (k) => {
          pressed = k;
        },
      }),
    );
    const btn = all([r], (e) => e.type === 'button' && text(e) === '3か月で見る')[0] as El;
    (btn.props.onClick as () => void)();
    expect(pressed).toBe('3m');
  });

  it('件数が少ない（判定の出た取引 3 件）は率の場所に「件数が少ない」と、あと何件で出るか', () => {
    const r = reviewOf(home(slot(SEVEN, ready(S1.slice(0, 3)))));
    expect(text(all([r], hasClass('review__missing')))).toBe('件数が少ない');
    expect(text(r)).toContain('あと 2 件で表示されます（判定の出た取引 3 件）');
  });

  it('差が無い期間は凡例に「差」を出さない。LC の無い C があれば「R で測れる崩れ」、無ければ「崩れなし」', () => {
    const r = reviewOf(home(slot(SEVEN, ready(S1.filter((t) => t.id !== 's1-3')))));
    expect(text(all([r], hasClass('curve__legend')))).not.toContain('差');
    expect(text(r)).not.toContain('崩れなし');
    expect(text(all([r], hasClass('review__headline')))).toBe('R で測れる崩れ ±0.0R');
    expect(text(r)).toContain('LC が無い 1 件は曲線に入れていません');
    const clean = reviewOf(
      home(slot(SEVEN, ready(S1.filter((t) => t.id !== 's1-3' && t.id !== 's1-5')))),
    );
    expect(text(all([clean], hasClass('review__headline')))).toBe('崩れなし ±0.0R');
    expect(text(clean)).toContain('崩れなし（2 本の線は重なっています）');
  });
});
