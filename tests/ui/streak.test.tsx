// ホームの「直近の流れ」（Issue #35 AC-2〜AC-6。#128 で一覧の上から外した）。表示の形 streakModel と、部品を関数として展開した木を見る
// （DOM を使わない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { StreakSection } from '../../ui/src/components/StreakStrip';
import { Link } from '../../ui/src/lib/router';
import { STREAK_TITLE, STREAK_WINDOW, streakModel } from '../../ui/src/lib/streak';
import type { TradesState } from '../../ui/src/lib/trades-controller';
import { HomeView } from '../../ui/src/pages/Home';
import { TradesView } from '../../ui/src/pages/Trades';
import { closedInfoTip } from './helpers/info-tip';
import { exitAt, S1, S4_IMPORTS } from './helpers/review-examples';
import { INSTRUMENTS, L1, stored } from './helpers/trade-examples';

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
const cls = (e: El) => String(e.props.class ?? '');
const hasClass = (c: string) => (e: El) => cls(e).split(' ').includes(c);
const noop = () => {};
const NONE = new Set<string>();

const ready = (trades: readonly StoredTrade[]): TradesState => ({
  phase: 'ready',
  trades,
  instruments: INSTRUMENTS,
  accounts: [],
  more: 'done',
});

/** L1 の形（A −1.0R）で決済の時刻だけ違う取引 */
const planned = (id: string, i: number, source: 'manual' | 'import' = 'manual') =>
  stored(id, { ...L1.record, source, exit: { ...L1.record.exit, time: exitAt(i) } });
/** LC を広げた B */
const broken = (id: string, i: number) =>
  stored(id, {
    ...L1.record,
    lcMove: { kind: 'widened', after: 99.2 },
    exit: { ...L1.record.exit, time: exitAt(i), price: 99.2 },
    statementPnlYen: -8_000,
  });
/** 計算できない（判定なし）: 決済の価格が無効 */
const noJudge = (id: string, i: number) =>
  stored(id, {
    ...L1.record,
    entries: [{ price: 100, quantity: 0 }],
    exit: { ...L1.record.exit, time: exitAt(i) },
  });

describe('AC-2: 例 S1 の 7 件', () => {
  it('点は古い順に plan・plan・break・break・worst・plan・plan、連続の印は最後の 2 点', () => {
    const m = streakModel([...S1].reverse(), NONE);
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.dots.map((d) => d.id)).toEqual(S1.map((t) => t.id));
    expect(m.dots.map((d) => d.tier)).toEqual([
      'plan',
      'plan',
      'break',
      'break',
      'worst',
      'plan',
      'plan',
    ]);
    expect(m.dots.map((d) => d.run)).toEqual([false, false, false, false, false, true, true]);
    expect(m.run).toEqual({ kind: 'plan', count: 2 });
    expect(m.headline).toBe('計画どおりが 2 件続いています');
    expect(m.subline).toBe('直近 7 件のうち計画どおり 4 件');
    expect(m.listLabel).toBe('直近 7 件の判定（古い順）');
    expect(m.importsNote).toBeNull();
    expect(m.tier).toBe('plan');
    expect(m.symbol).toBe('circle');
  });
});

describe('AC-3: 件数・消した印・取り込み', () => {
  it('11 件以上なら新しい方の 10 件だけ', () => {
    const ts = Array.from({ length: 12 }, (_, i) => planned(`p${i}`, i));
    const m = streakModel(ts, NONE);
    expect(m?.dots.length).toBe(STREAK_WINDOW);
    expect(m?.dots[0]?.id).toBe('p2');
    expect(m?.dots[9]?.id).toBe('p11');
    expect(m?.headline).toBe('計画どおりが 10 件続いています');
  });

  // 繰り上がるのは読み込み済みの範囲だけ: ホームは 10 件だけ読むので、消した印があると点は 9 件以下になり 11 件目は
  // 繰り上がらない（[元に戻す] の 8 秒の間だけ。新しく読まない方針。一覧は読み込み済みなら繰り上がる）
  it('消した印の取引は数えない（読み込み済みの範囲で次の取引が繰り上がる。ホームでは点が減る）', () => {
    const ts = [planned('a', 0), broken('b', 1), planned('c', 2)];
    const m = streakModel(ts, new Set(['c']));
    expect(m?.dots.map((d) => d.id)).toEqual(['a', 'b']);
    expect(m?.headline).toBe('直近の取引は B 悪い損失');
  });

  it('決済の時刻が同じ取引は一覧と同じ並び（作った時刻の新しい方 → ID の昇順が新しい側）', () => {
    const at = (id: string, createdAt: number, b = false) =>
      stored(
        id,
        {
          ...L1.record,
          ...(b
            ? { lcMove: { kind: 'widened' as const, after: 99.2 }, statementPnlYen: -8_000 }
            : {}),
          exit: { ...L1.record.exit, time: exitAt(0), ...(b ? { price: 99.2 } : {}) },
        },
        { createdAt },
      );
    // 新しい順: z（作った 3）→ a（作った 2・ID の昇順で先）→ b（作った 2）→ c（作った 1）
    const ts = [at('c', 1, true), at('b', 2), at('a', 2, true), at('z', 3)];
    const m = streakModel(ts, NONE);
    expect(m?.dots.map((d) => d.id)).toEqual(['c', 'b', 'a', 'z']);
    expect(m?.dots.map((d) => d.run)).toEqual([false, false, false, true]);
    expect(m?.headline).toBe('直近の取引は A いい損失');
    // 入力の順によらない
    expect(streakModel([...ts].reverse(), NONE)?.dots.map((d) => d.id)).toEqual([
      'c',
      'b',
      'a',
      'z',
    ]);
  });

  it('取り込んだ取引は点にせず、外した件数を添える', () => {
    const ts = [...S1, ...S4_IMPORTS];
    const m = streakModel(ts, NONE);
    expect(m?.dots.map((d) => d.id)).not.toContain('imp-1');
    expect(m?.dots.length).toBe(7);
    expect(m?.importsNote).toBe('取り込んだ取引 2 件は並べていません');
  });

  it('全部が取り込み・取引が無い → null', () => {
    expect(streakModel(S4_IMPORTS, NONE)).toBeNull();
    expect(streakModel([], NONE)).toBeNull();
  });
});

describe('AC-4: 文の書き分け', () => {
  it('1 件 → 「直近の取引は <判定の名前>」', () => {
    expect(streakModel([planned('a', 0)], NONE)?.headline).toBe('直近の取引は A いい損失');
    expect(streakModel([planned('a', 0), broken('b', 1)], NONE)?.headline).toBe(
      '直近の取引は B 悪い損失',
    );
  });

  it('崩れが 2 件以上 → 「崩れが N 件続いています」（B・危ない勝ち・C をまとめる）', () => {
    const m = streakModel([planned('a', 0), broken('b', 1), broken('c', 2)], NONE);
    expect(m?.headline).toBe('崩れが 2 件続いています');
    expect(m?.tier).toBe('break');
    expect(m?.symbol).toBe('triangle');
    // S1 の 5 件目まで（新しい順に C・危ない勝ち・B）
    const s = streakModel(S1.slice(0, 5), NONE);
    expect(s?.headline).toBe('崩れが 3 件続いています');
    expect(s?.tier).toBe('worst');
  });

  it('危ない勝ちが最新 → 「直近の取引は 危ない勝ち」・崩れの段（△）・計画どおりの件数に入らない', () => {
    // S1 の 4 件目まで（新しい順に 危ない勝ち・B・計画どおりの勝ち・A）
    const m = streakModel(S1.slice(0, 4), NONE);
    expect(m?.run).toEqual({ kind: 'off', count: 2 });
    expect(m?.headline).toBe('崩れが 2 件続いています');
    expect(m?.tier).toBe('break');
    expect(m?.symbol).toBe('triangle');
    expect(m?.subline).toBe('直近 4 件のうち計画どおり 2 件');
    // 危ない勝ちの 1 件だけ（前が計画どおり）
    const one = streakModel(
      [S1[0], S1[1], S1[3]].filter((t) => t !== undefined),
      NONE,
    );
    expect(one?.headline).toBe('直近の取引は 危ない勝ち');
    expect(one?.tier).toBe('break');
    expect(one?.dots.at(-1)?.tier).toBe('break');
    expect(one?.subline).toBe('直近 3 件のうち計画どおり 2 件');
  });

  it('判定なしが 2 件以上 → 「直近の N 件は判定なし」', () => {
    const m = streakModel([planned('a', 0), noJudge('b', 1), noJudge('c', 2)], NONE);
    expect(m?.run).toEqual({ kind: 'none', count: 2 });
    expect(m?.headline).toBe('直近の 2 件は判定なし');
    expect(m?.tier).toBe('neutral');
  });
});

describe('AC-5: 色だけに頼らない', () => {
  it('各点は段の記号と読み上げの文字を持ち、並びは名前つきの ol', () => {
    const m = streakModel([...S1], NONE);
    if (!m) throw new Error('model');
    const tree = expand(<StreakSection model={m} id="t" />);
    const ol = all(tree, (e) => e.type === 'ol')[0];
    expect(ol?.props['aria-label']).toBe('直近 7 件の判定（古い順）');
    const items = all(tree, hasClass('streak__item'));
    expect(items.length).toBe(7);
    const marks = items.map((li) => all(li.children, (e) => e.type === 'svg')[0]);
    // 段の記号（○ △ × −）は aria-hidden の SVG
    for (const svg of marks) expect(svg?.props['aria-hidden']).toBe('true');
    const labels = items.map((li) => text(all(li.children, hasClass('sr-only'))));
    expect(labels[2]).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2} B 悪い損失$/);
    expect(labels[3]).toMatch(/危ない勝ち$/);
    expect(labels[4]).toMatch(/C 極悪な損失$/);
    // 点の段のクラスは判定の段
    expect(cls(all(items[4]?.children ?? [], hasClass('streak__dot'))[0] as El)).toContain(
      'streak__dot--worst',
    );
    // 連続の印は最後の 2 点だけ
    expect(items.map((li) => cls(li).includes('streak__item--run'))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    // 見出しと文は文字で読める。点は押せない（押せるのはカードの全面に広げた取引のタブへのリンク 1 つだけ。#128）
    expect(text(tree)).toContain(STREAK_TITLE);
    expect(text(tree)).toContain('計画どおりが 2 件続いています');
    expect(text(tree)).toContain('直近 7 件のうち計画どおり 4 件');
    expect(
      all(tree, (e) => e.type === 'a' || e.type === 'button').map((e) => e.props.href),
    ).toEqual(['/trades']);
    expect(all(ol ? [ol] : [], (e) => e.type === 'a' || e.type === 'button')).toEqual([]);
    // 目盛り（古い / 新しい）は読み上げから外す
    expect(all(tree, hasClass('streak__axis'))[0]?.props['aria-hidden']).toBe('true');
  });
});

describe('AC-6: ホームだけに出す（#128。設計書 9.2・9.3）', () => {
  it('ホーム: 見出しの次（今月の規律・直近の取引の前）。押すと取引のタブ', () => {
    const tree = expand(
      <HomeView
        state={ready([...S1])}
        hidden={NONE}
        empty={<p>空</p>}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const kind = (e: El) =>
      hasClass('homehead')(e)
        ? 'head'
        : hasClass('streak')(e)
          ? 'streak'
          : hasClass('homerecent')(e)
            ? 'recent'
            : null;
    const order = all(tree, (e) => kind(e) !== null).map(kind);
    expect(order).toEqual(['head', 'streak', 'recent']);
    const card = all(tree, hasClass('streak'))[0] as El;
    expect(card.props['aria-labelledby']).toBe('home-streak-title');
    const link = all([card], (e) => e.type === 'a')[0] as El;
    expect(link.props.href).toBe('/trades');
    expect(text(link)).toBe('直近の流れを取引で見る');
  });

  it('一覧: 直近の流れのカードを置かない（月の区切りは U7）', () => {
    const tree = expand(
      <TradesView
        state={ready([...S1])}
        hidden={NONE}
        empty={<p>空</p>}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(all(tree, hasClass('streak'))).toEqual([]);
    expect(all(tree, hasClass('tradelist-card')).length).toBe(1);
  });

  it('並べる取引が無ければ出さない（取り込みだけの一覧）', () => {
    const tree = expand(
      <TradesView
        state={ready([...S4_IMPORTS])}
        hidden={NONE}
        empty={<p>空</p>}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    expect(all(tree, hasClass('streak'))).toEqual([]);
    expect(all(tree, hasClass('tradelist-card')).length).toBe(1);
  });
});
