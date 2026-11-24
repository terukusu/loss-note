// ホームを 1 画面にする（Issue #128 AC-4・AC-5・AC-6。設計書 9.2 のホーム・ui-guidelines 9.4・K18）。
// 純関数（lib/home-view.ts）と、hook を持たない HomeView の並び。部品は関数として展開する（DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  compactRowModel,
  HOME_RECENT,
  homeDate,
  type MonthSlot,
  monthCard,
} from '../../ui/src/lib/home-view';
import { monthSelection, periodRange } from '../../ui/src/lib/period';
import type { ReviewState } from '../../ui/src/lib/review-controller';
import { reviewModelFor } from '../../ui/src/lib/review-view';
import { Link } from '../../ui/src/lib/router';
import { tradeRow } from '../../ui/src/lib/trade-view';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { HomeView } from '../../ui/src/pages/Home';
import { closedInfoTip } from './helpers/info-tip';
import { REVIEW_NOW, S1, S2, S4_IMPORTS } from './helpers/review-examples';
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
const NONE = new Set<string>();

const MONTH = monthSelection(REVIEW_NOW);
const RANGE = periodRange(MONTH, REVIEW_NOW);
const R = RANGE.ok ? { from: RANGE.from, to: RANGE.to } : { from: 0, to: 1 };

function cardOf(trades: readonly StoredTrade[]) {
  const state: ReviewState = { phase: 'ready', range: R, trades, truncated: false };
  const model = reviewModelFor(state, RANGE, {
    hidden: NONE,
    includeImports: false,
    instruments: INSTRUMENTS,
    now: REVIEW_NOW,
  });
  if (!model) throw new Error('model');
  return monthCard(model, RANGE, MONTH);
}

function slotOf(trades: readonly StoredTrade[]): MonthSlot {
  return {
    state: { phase: 'ready', range: R, trades, truncated: false },
    card: cardOf(trades),
    onReload: noop,
    onRelogin: noop,
  };
}

const ready = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
  more: 'done',
});

function home(trades: readonly StoredTrade[], extra: { draft?: boolean } = {}) {
  return expand(
    <HomeView
      state={ready(trades)}
      hidden={NONE}
      empty={<p class="empty-mark">空</p>}
      onReload={noop}
      onRelogin={noop}
      today={homeDate(REVIEW_NOW)}
      month={slotOf(trades)}
      draft={extra.draft ?? false}
    />,
  );
}

describe('純関数: ホームの見出しの日付・今月の規律の数・詰めた行', () => {
  it('今日の日付は「11月19日（木）」', () => {
    expect(homeDate(REVIEW_NOW)).toBe('11月19日（木）');
    expect(homeDate(new Date(2027, 0, 3, 9).getTime())).toBe('1月3日（日）');
  });

  it('S1（今月 7 件）: 計画どおり率 57%（4 / 7 件）・規律コスト −0.6R（守っていれば +0.9R · 実際 +0.3R。振り返りのタブと同じ文）', () => {
    const c = cardOf(S1);
    expect(c.title).toBe('今月の規律');
    expect(c.meta).toBe('11/1〜11/19 · 7 件');
    expect([c.range, c.count]).toEqual(['11/1〜11/19', '7 件']);
    expect(c.href).toBe('/review?period=custom&from=2026-11-01&to=2026-11-19');
    expect(c.empty).toBeNull();
    expect(c.rate).toEqual({ value: '57', unit: '%' });
    expect(c.rateSub).toBe('4 / 7 件');
    expect(c.cost).toEqual({ value: '−0.6', unit: 'R' });
    expect(c.costSub).toBe('守っていれば +0.9R · 実際 +0.3R');
    // 語の塊ごとに 1 行（語の途中で折らない。デザイン a3）
    expect(c.costLines).toEqual(['守っていれば +0.9R', '実際 +0.3R']);
    expect(c.costMeasured).toBe(false);
    expect(c.curve.length).toBeGreaterThan(0);
  });

  it('判定の出た取引が 5 件未満なら率の数を出さず「あと N 件で表示」', () => {
    const c = cardOf(S2);
    expect(c.rate).toBeNull();
    expect(c.rateSub).toBe('あと 2 件で表示');
  });

  it('今月の取引が 0 件・取り込みだけ: 数を出さず短い文（取り込みは外す = 振り返りの既定と同じ）', () => {
    const none = cardOf([]);
    expect(none.empty).toBe('今月の取引はまだありません');
    expect(none.meta).toBe('11/1〜11/19');
    expect(none.rate).toBeNull();
    expect(none.cost).toBeNull();
    const imports = cardOf(S4_IMPORTS);
    expect(imports.empty).toBe('今月の取引は取り込んだものだけです');
  });

  it('詰めた行: 記号の段・「判定の名前 · 月 / 日 [· 口座]」（今年でない日だけ年つき。口座は省略してよいので最後。#176）・R と「リスク 0.5%」（デザイン a4）', () => {
    const row = tradeRow(S1[2] as StoredTrade, INSTRUMENTS, []);
    const m = compactRowModel(row, REVIEW_NOW);
    expect(m.tier).toBe('break');
    expect(m.symbol).toBe('triangle');
    expect(m.gradeLabel).toBe('B 悪い損失');
    expect(m.sub).toBe('B 悪い損失 · 11/15');
    expect(m.date).toBe('11/15');
    expect(m.accountName).toBeNull();
    expect(m.rMissing).toBe(false);
    expect(m.rText).toBe('−1.6R');
    expect(m.riskText).toMatch(/^リスク \d+(\.\d+)?%$/);
    const withAccount = compactRowModel({ ...row, accountName: '口座 B' }, REVIEW_NOW);
    expect(withAccount.sub).toBe('B 悪い損失 · 11/15 · 口座 B');
    expect(withAccount.accountName).toBe('口座 B');
    // 今年でない日は年つき
    expect(compactRowModel(row, new Date(2027, 0, 3).getTime()).sub).toBe(
      'B 悪い損失 · 2026/11/15',
    );
    // R が出ない（LC の無い C）は「—」を 1 つ、リスクの段は出さない
    const noR = compactRowModel(tradeRow(S1[4] as StoredTrade, INSTRUMENTS, []), REVIEW_NOW);
    expect(noR.rMissing).toBe(true);
    expect(noR.rText).toBe('—');
    expect(noR.riskText).toBeNull();
    expect(HOME_RECENT).toBe(3);
  });

  it('差は 0 だが R の出ない取引がある月は、規律コストに × の印（「崩れなし」に見せない。コード N6）', () => {
    const c = cardOf(S1.filter((t) => t.id !== 's1-3'));
    expect(c.cost).toEqual({ value: '±0.0', unit: 'R' });
    expect(c.costMeasured).toBe(true);
    expect(cardOf(S1).costMeasured).toBe(false);
  });
});

describe('HomeView の並び（K18・9.4）', () => {
  const KINDS = ['homehead', 'homedraft', 'streak', 'homemonth', 'homerecent'] as const;
  const kinds = (tree: Node[]) =>
    all(tree, (e) => KINDS.some((k) => hasClass(k)(e))).map((e) =>
      KINDS.find((k) => hasClass(k)(e)),
    );

  it('見出し → 直近の流れ → 今月の規律 → 直近の取引（期間の選択・内訳・表・注記・円は置かない）', () => {
    const tree = home(S1);
    expect(kinds(tree)).toEqual(['homehead', 'streak', 'homemonth', 'homerecent']);
    // 期間の選択・取り込みの切り替え・内訳・表・「—」の理由の注記を置かない
    expect(all(tree, (e) => e.type === 'input')).toEqual([]);
    expect(all(tree, (e) => e.type === 'table' || e.type === 'details')).toEqual([]);
    expect(all(tree, hasClass('review__legend'))).toEqual([]);
    expect(all(tree, hasClass('tradelist__notes'))).toEqual([]);
    expect(text(tree)).not.toContain('円');
    // 大きな題「ホーム」は見せない（h1 は印と「損失ノート」、読み上げで「ホーム」）
    const h1 = all(tree, (e) => e.type === 'h1');
    expect(h1).toHaveLength(1);
    expect(text(h1)).toContain('損失ノート');
    expect(text(h1)).toContain('ホーム');
    expect(text(all(tree, hasClass('homehead__date')))).toBe('11月19日（木）');
  });

  it('直近の取引は決済の新しい順の 3 件と「すべての取引 ›」の押せる行（取引のタブへ）', () => {
    const tree = home(S1);
    const rows = all(tree, hasClass('homerow'));
    expect(rows.map((r) => r.props.href)).toEqual(['/trades/s1-7', '/trades/s1-6', '/trades/s1-5']);
    expect(rows.every((r) => typeof r.props['aria-label'] === 'string')).toBe(true);
    const more = all(
      tree,
      (e) => e.type === 'a' && e.props.href === '/trades' && hasClass('rowlink')(e),
    );
    expect(more).toHaveLength(1);
    expect(text(more)).toBe('すべての取引');
  });

  it('直近の流れのカードは取引のタブへ、今月の規律のカードは振り返りのタブを今月で（押せるカード。当たりはカードの全面）', () => {
    const tree = home(S1);
    const streakLink = all(
      tree,
      (e) => e.type === 'a' && hasClass('homecard__link')(e) && e.props.href === '/trades',
    );
    expect(streakLink).toHaveLength(1);
    expect(text(streakLink)).toContain('取引');
    const monthLink = all(
      tree,
      (e) =>
        e.type === 'a' &&
        hasClass('homecard__link')(e) &&
        e.props.href === '/review?period=custom&from=2026-11-01&to=2026-11-19',
    );
    expect(monthLink).toHaveLength(1);
    expect(text(monthLink)).toContain('振り返り');
    // 今月の規律の数字は数字の段 title（28px）の 2 つ（率・規律コスト）。単位は数の外の別の塊（#236・C62）
    const month = all(tree, hasClass('homemonth'))[0]?.children ?? [];
    expect(all(month, hasClass('num--title')).map(text)).toEqual(['57', '−0.6']);
    expect(all(month, hasClass('num-unit')).map(text)).toEqual(['%', 'R']);
    expect(all(month, hasClass('numu--title')).map(text)).toEqual(['57%', '−0.6R']);
    expect(all(month, hasClass('num--display'))).toEqual([]);
    expect(all(month, hasClass('num--hero'))).toEqual([]);
    // 規律コストの下は語の塊ごとに 1 行
    const lines = all(tree, hasClass('homemonth__lines'))[0] as El;
    expect(lines.children.map(text)).toEqual(['守っていれば +0.9R', '実際 +0.3R']);
    // 主役の文は文節の塊の間（wbr）でだけ折る
    const head = all(tree, hasClass('streak__headtext'))[0] as El;
    expect(text(head)).toBe('計画どおりが 2 件続いています');
    expect(all([head], (e) => e.type === 'wbr')).toHaveLength(1);
    // 小さな曲線は読み上げから外す
    expect(all(tree, hasClass('minicurve'))[0]?.props['aria-hidden']).toBe('true');
  });

  it('書きかけがあれば見出しの下・主役の上に「記録の書きかけがあります ›」（記録する画面へ）', () => {
    const tree = home(S1, { draft: true });
    expect(kinds(tree)).toEqual(['homehead', 'homedraft', 'streak', 'homemonth', 'homerecent']);
    const d = all(tree, hasClass('homedraft'))[0] as El;
    const a = all([d], (e) => e.type === 'a')[0] as El;
    expect(a.props.href).toBe('/record');
    expect(text(a)).toBe('記録の書きかけがあります');
  });

  it('取引 0 件: 見出しと空の状態だけ（書きかけがあればその行も）', () => {
    const tree = home([]);
    expect(kinds(tree)).toEqual(['homehead']);
    expect(all(tree, hasClass('empty-mark'))).toHaveLength(1);
    expect(kinds(home([], { draft: true }))).toEqual(['homehead', 'homedraft']);
  });

  it('今月の規律の読み込みの失敗は直近の取引を巻き込まない（カードの中に文言と [再読み込み]）', () => {
    const tree = expand(
      <HomeView
        state={ready(S1)}
        hidden={NONE}
        empty={<p>空</p>}
        onReload={noop}
        onRelogin={noop}
        today="11月19日（木）"
        month={{
          state: { phase: 'failed', range: R, error: '読めません', errorKind: 'network' },
          card: null,
          onReload: noop,
          onRelogin: noop,
        }}
      />,
    );
    expect(all(tree, hasClass('homerow'))).toHaveLength(3);
    const m = all(tree, hasClass('homemonth'))[0] as El;
    expect(text(m)).toContain('読めません');
    expect(text(m)).toContain('再読み込み');
  });
});
