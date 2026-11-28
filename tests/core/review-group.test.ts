// 振り返りで両建てのまとまりを 1 件として数える（core/review-group.ts の groupTrades。設計書 6.5・C80。#268）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import type { GroupMember } from '../../core/position-group';
import { type StoredTrade, toTradeInput } from '../../core/record';
import { type ReviewItem, reviewPeriod } from '../../core/review';
import { groupTrades, type StoredPositionGroup } from '../../core/review-group';
import { FIX, hedge, MIN, MON, main, tradeOf } from './helpers/group-builder';

/** まとまりのメンバー → 保存した取引の形（版・更新の時刻を足す） */
const stored = (m: GroupMember): StoredTrade =>
  ({ schemaVersion: 1, updatedAt: m.trade?.createdAt ?? 0, ...m.trade }) as StoredTrade;

const groupOf = (
  id: string,
  members: readonly GroupMember[],
  exit?: StoredPositionGroup['exit'],
): StoredPositionGroup => ({
  id,
  schemaVersion: 1,
  members: members.map((m) => ({ tradeId: m.tradeId, role: m.role })),
  ...(exit === undefined ? {} : { exit }),
  createdAt: 1,
  updatedAt: 1,
});

/** 単独の取引の集計の 1 件（画面の reviewItemOf と同じ写し方） */
function itemOf(t: StoredTrade): ReviewItem {
  const ev = evaluateTrade(toTradeInput(t));
  return {
    id: t.id,
    exitTime: t.record.exit.time,
    createdAt: t.createdAt,
    grade: ev.ok ? (ev.judgment?.grade ?? null) : null,
    ...(ev.ok && ev.r !== undefined ? { r: ev.r } : {}),
    imported: t.record.source === 'import',
  };
}

// H1: 先物 L（イン 38,000・LC 37,700）を CFD S 100 の 38,450 で固定 → R = (38,450 − 38,000) ÷ 300 = +1.5・計画どおりの勝ち
const H1_MAIN = main({ exitPrice: 38_600 }, 'f1');
const H1_HEDGE = hedge({ price: 38_450, exitPrice: 38_620 }, 'c1');
const H1 = groupOf('g1', [H1_MAIN, H1_HEDGE], { orderType: 'market' });
// 単独の A: LC 37,700 の逆指値で切れた（R = −300 ÷ 300 = −1.0）
const SOLO = stored({
  tradeId: 's1',
  role: 'main',
  trade: tradeOf('s1', { exitPrice: 37_700, orderType: 'stop', exitTime: MON + 60 * MIN }),
});

describe('groupTrades（まとまりを 1 件に）', () => {
  it('R1: H1 と単独の A → まとまり 1 件（計画どおりの勝ち・+1.5R・決済の時刻 = 固定の時点）と単独 1 件。CFD は数えない', () => {
    const trades = [stored(H1_MAIN), stored(H1_HEDGE), SOLO];
    const { units, singles } = groupTrades(trades, [H1]);
    expect(units).toHaveLength(1);
    const [u] = units;
    expect(u?.leadId).toBe('f1');
    expect(u?.item).toMatchObject({ id: 'f1', grade: 'safeWin', exitTime: FIX, imported: false });
    expect(u?.item.r).toBeCloseTo(1.5, 12);
    expect(singles.map((t) => t.id)).toEqual(['s1']);
    const v = reviewPeriod([...singles.map(itemOf), ...units.map((x) => x.item)], {
      includeImports: false,
    });
    expect(v.total).toBe(2);
    expect(v.counts).toMatchObject({ safeWin: 1, A: 1, C: 0, none: 0 });
    expect(v.curve).toHaveLength(2);
    expect(v.noR).toBe(0);
  });

  it('まとまりを組まないと CFD が LC なしの C に入る（比べるための今の数え方）', () => {
    const v = reviewPeriod([stored(H1_MAIN), stored(H1_HEDGE), SOLO].map(itemOf), {
      includeImports: false,
    });
    expect(v.total).toBe(3);
    expect(v.counts.C).toBe(1);
  });

  it('R4: 心理・Good / More はメンバーの和（平常心はほかのタグと同時に持たない）', () => {
    const f = main({ exitPrice: 38_600, emotionTags: ['calm'] }, 'f1');
    const c = hedge({ price: 38_450, exitPrice: 38_620, emotionTags: ['overconfident'] }, 'c1');
    const { units } = groupTrades([stored(f), stored(c)], [groupOf('g1', [f, c])]);
    expect(units[0]?.item.emotions).toEqual(['overconfident']);
  });

  it('R5: 取り込んだメンバーがあればまとまりごと取り込み', () => {
    const c = hedge({ price: 38_450, exitPrice: 38_620, source: 'import' }, 'c1');
    const { units } = groupTrades([stored(H1_MAIN), stored(c)], [groupOf('g1', [H1_MAIN, c])]);
    expect(units[0]?.item.imported).toBe(true);
  });

  it('R6: 消した印の決済の代わり → 本玉を単独で（まとまりにしない）', () => {
    const { units, singles } = groupTrades([stored(H1_MAIN), stored(H1_HEDGE)], [H1], {
      excluded: new Set(['c1']),
    });
    expect(units).toEqual([]);
    expect(singles.map((t) => t.id)).toEqual(['f1']);
  });

  it('R6: 本玉 2・決済の代わり 1 で本玉の 1 件を消した印 → 残りでまとまり 1 件', () => {
    const m2 = main({ exitPrice: 38_600, entryTime: FIX - 86_400_000, price: 38_100 }, 'f2');
    const c = hedge({ price: 38_450, quantity: 200, exitPrice: 38_620 }, 'c1');
    const g = groupOf('g1', [H1_MAIN, m2, c]);
    const { units, singles } = groupTrades([stored(H1_MAIN), stored(m2), stored(c)], [g], {
      excluded: new Set(['f2']),
    });
    expect(units).toHaveLength(1);
    expect(units[0]?.trades.map((t) => t.id)).toEqual(['f1', 'c1']);
    expect(singles).toEqual([]);
  });

  it('R6: メンバーの取引が無い（崩れた）→ 見つかったメンバーを単独で', () => {
    const { units, singles } = groupTrades([stored(H1_MAIN)], [H1]);
    expect(units).toEqual([]);
    expect(singles.map((t) => t.id)).toEqual(['f1']);
  });

  it('同じ取引が 2 つのまとまりにいる → 後のまとまりは組まない（崩れた）', () => {
    const c2 = hedge({ price: 38_400, exitPrice: 38_620 }, 'c2');
    const g2 = groupOf('g2', [H1_MAIN, c2]);
    const { units, singles } = groupTrades(
      [stored(H1_MAIN), stored(H1_HEDGE), stored(c2)],
      [H1, g2],
    );
    expect(units.map((u) => u.groupId)).toEqual(['g1']);
    expect(singles.map((t) => t.id)).toEqual(['c2']);
  });

  it('判定の出ないまとまり（メンバーの入力の誤り）→ 判定なしの 1 件（決済の時刻 = 本玉の決済）', () => {
    // 数量 0 は入力の誤り（validateTrade）
    const bad = hedge({ price: 38_450, quantity: 0, exitPrice: 38_620 }, 'c1');
    const { units, singles } = groupTrades(
      [stored(H1_MAIN), stored(bad)],
      [groupOf('g1', [H1_MAIN, bad])],
    );
    expect(singles).toEqual([]);
    expect(units[0]?.item).toMatchObject({ id: 'f1', grade: null, exitTime: MON });
    expect(units[0]?.item.r).toBeUndefined();
  });

  it('同じ ID の取引は最初の 1 件（範囲の中と範囲の外のメンバーの重なり）', () => {
    const { units, singles } = groupTrades(
      [stored(H1_MAIN), stored(H1_HEDGE), stored(H1_HEDGE)],
      [H1],
    );
    expect(units[0]?.trades).toHaveLength(2);
    expect(singles).toEqual([]);
  });
});

/** 種つきの乱数（mulberry32） */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('groupTrades の性質', () => {
  it('KEEP: まとまりが無ければ単独は入力のまま（消した印を除く）', () => {
    const r = rng(268);
    for (let n = 0; n < 50; n++) {
      const trades = Array.from({ length: 1 + Math.floor(r() * 12) }, (_, i) =>
        stored({
          tradeId: `t${i}`,
          role: 'main',
          trade: tradeOf(`t${i}`, {
            exitPrice: 37_500 + Math.round(r() * 1_000),
            exitTime: MON + Math.round(r() * 1e8),
          }),
        }),
      );
      const excluded = new Set(trades.filter(() => r() < 0.2).map((t) => t.id));
      const { units, singles } = groupTrades(trades, [], { excluded });
      expect(units).toEqual([]);
      expect(singles).toEqual(trades.filter((t) => !excluded.has(t.id)));
    }
  });

  it('どの取引も 1 回だけ数える（まとまりのメンバー + 単独 = 消した印を除いた取引）', () => {
    const r = rng(2680);
    for (let n = 0; n < 60; n++) {
      const pairs = 1 + Math.floor(r() * 4);
      const trades: StoredTrade[] = [];
      const groups: StoredPositionGroup[] = [];
      for (let k = 0; k < pairs; k++) {
        const f = main({ exitPrice: 37_500 + Math.round(r() * 1_500) }, `f${k}`);
        const c = hedge({ price: 37_500 + Math.round(r() * 1_500), exitPrice: 38_000 }, `c${k}`);
        trades.push(stored(f), stored(c));
        groups.push(groupOf(`g${k}`, [f, c]));
      }
      const excluded = new Set(trades.filter(() => r() < 0.15).map((t) => t.id));
      const { units, singles } = groupTrades(trades, groups, { excluded });
      const counted = [
        ...units.flatMap((u) => u.trades.map((t) => t.id)),
        ...singles.map((t) => t.id),
      ];
      expect(new Set(counted).size).toBe(counted.length);
      expect(new Set(counted)).toEqual(
        new Set(trades.filter((t) => !excluded.has(t.id)).map((t) => t.id)),
      );
      // 両方残ったまとまりだけが 1 件になり、その件の R はメンバー単独の R と別（固定の価格から）
      for (const u of units) {
        expect(u.trades.map((t) => t.id).sort()).toEqual([
          `c${u.groupId.slice(1)}`,
          `f${u.groupId.slice(1)}`,
        ]);
        expect(Number.isNaN(u.item.r ?? 0)).toBe(false);
      }
    }
  });
});
