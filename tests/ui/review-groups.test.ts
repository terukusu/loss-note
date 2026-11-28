// 振り返り・期間の取引・ホームで両建てのまとまりを 1 件として数える（設計書 6.5・C80。#268）。値はすべて架空
// 場面は設計書 5.8 の例（本玉 F = XYZ 先物 L 1 枚・イン 38,000・LC 37,700、決済の代わり C = XYZ CFD S 100・LC なし）
import { describe, expect, it } from 'vitest';
import type { GroupMember } from '../../core/position-group';
import type { StoredTrade } from '../../core/record';
import { reviewAfterWinStreak, reviewByEmotion, reviewByReason } from '../../core/review';
import type { StoredPositionGroup } from '../../core/review-group';
import { monthCard } from '../../ui/src/lib/home-view';
import { insightItems } from '../../ui/src/lib/insight-view';
import { createReviewController } from '../../ui/src/lib/review-controller';
import { parseTrail, reviewTradesModel } from '../../ui/src/lib/review-trades';
import { reviewUnits } from '../../ui/src/lib/review-units';
import { reviewModel } from '../../ui/src/lib/review-view';
import { streakModel } from '../../ui/src/lib/streak';
import { streakGroupRange } from '../../ui/src/pages/Home';
import { FIX, hedge, MIN, MON, main, tradeOf } from '../core/helpers/group-builder';

const HOUR = 60 * MIN;
const stored = (m: GroupMember, extra: Partial<StoredTrade> = {}): StoredTrade =>
  ({ schemaVersion: 1, updatedAt: m.trade?.createdAt ?? 0, ...m.trade, ...extra }) as StoredTrade;
const solo = (id: string, o: Parameters<typeof tradeOf>[1]) =>
  stored({ tradeId: id, role: 'main', trade: tradeOf(id, o) });
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
const around = (t: number) => ({ from: t - 6 * HOUR, to: t + 6 * HOUR });
const WIDE = { from: FIX - 3 * 86_400_000, to: MON + 3 * 86_400_000 };
const NONE = new Set<string>();
const base = { hidden: NONE, includeImports: false, instruments: [], now: MON };

// H1（固定だけで済んだ = まとまりの決済の時刻は固定の時点 FIX）: R = (38,450 − 38,000) ÷ 300 = +1.5・計画どおりの勝ち
const F1 = main({ exitPrice: 38_600 }, 'f1');
const C1 = hedge({ price: 38_450, exitPrice: 38_620 }, 'c1');
const H1 = groupOf('g1', [F1, C1], { orderType: 'market' });
// 単独の A（LC 37,700 の逆指値で切れた。−1.0R）。決済は MON の 1 時間後
const A1 = solo('s1', { exitPrice: 37_700, orderType: 'stop', exitTime: MON + HOUR });
// H2（LC を割った後の 37,550 で固定）: −1.5R・B（持ち続けた）
const F2 = main({ exitPrice: 37_400 }, 'f2');
const C2 = hedge({ price: 37_550, exitPrice: 37_420 }, 'c2');
const H2 = groupOf('g2', [F2, C2]);
// H4（一部だけの固定。まとまりの決済の時刻 = 先物の決済 MON）: −1.52R・B
const F4 = main({ exitPrice: 37_400, orderType: 'market', gapSlip: 'no' }, 'f4');
const C4 = hedge({ price: 37_690, quantity: 50, exitPrice: 37_420 }, 'c4');
const H4 = groupOf('g4', [F4, C4]);

describe('規律の集計（reviewModel）', () => {
  it('AC-1 R1: H1 と単独の A → 2 件・計画どおりの勝ち 1・A 1・C 0・曲線の点 2・LC が無い 0', () => {
    const m = reviewModel([stored(F1), stored(C1), A1], {
      ...base,
      range: WIDE,
      groups: [H1],
      groupMembers: [],
    });
    expect(m.review.total).toBe(2);
    expect(m.review.counts).toMatchObject({ safeWin: 1, A: 1, C: 0, none: 0 });
    expect(m.review.curve.map((p) => p.id)).toEqual(['f1', 's1']);
    expect(m.review.curve[0]?.r).toBeCloseTo(1.5, 12);
    expect(m.noRText).toBeNull();
    expect(m.rows[0]?.instrumentName.endsWith(' · 両建て')).toBe(true);
    // 比べる: まとまりを渡さなければ CFD が LC なしの C に入る
    const raw = reviewModel([stored(F1), stored(C1), A1], { ...base, range: WIDE });
    expect([raw.review.total, raw.review.counts.C]).toEqual([3, 1]);
  });

  it('AC-2 R2: 期間の境はまとまりの決済の時刻（範囲の外のメンバーは groupMembers から）', () => {
    // H1 の決済の時刻 = FIX。FIX の日の範囲には F1・C1（決済は MON）が無く、範囲の外のメンバーとして届く
    const fixDay = reviewModel([], {
      ...base,
      range: around(FIX),
      groups: [H1],
      groupMembers: [stored(F1), stored(C1)],
    });
    expect(fixDay.review.total).toBe(1);
    const monDay = reviewModel([stored(F1), stored(C1)], {
      ...base,
      range: around(MON),
      groups: [H1],
      groupMembers: [],
    });
    expect(monDay.review.total).toBe(0);
    // H4 の決済の時刻 = MON（残りを先物で閉じた）
    const h4Mon = reviewModel([stored(F4), stored(C4)], {
      ...base,
      range: around(MON),
      groups: [H4],
    });
    expect(h4Mon.review.total).toBe(1);
    const h4Fix = reviewModel([], {
      ...base,
      range: around(FIX),
      groups: [H4],
      groupMembers: [stored(F4), stored(C4)],
    });
    expect(h4Fix.review.total).toBe(0);
  });

  it('AC-2 R3: 曲線の並びはまとまりの決済の時刻（H1 = FIX → FIX と MON の間の単独 X）', () => {
    const x = solo('x1', { exitPrice: 37_700, orderType: 'stop', exitTime: FIX + 12 * HOUR });
    const m = reviewModel([stored(F1), stored(C1), x], { ...base, range: WIDE, groups: [H1] });
    expect(m.review.curve.map((p) => p.id)).toEqual(['f1', 'x1']);
    expect(m.curveDates?.first).not.toBeUndefined();
  });

  it('AC-4 R5: 取り込んだメンバーがあればまとまりごと取り込み', () => {
    const c = stored(C1, { record: { ...stored(C1).record, source: 'import' } });
    const off = reviewModel([stored(F1), c], { ...base, range: WIDE, groups: [H1] });
    expect([off.review.total, off.review.excludedImports]).toEqual([0, 1]);
    const on = reviewModel([stored(F1), c], {
      ...base,
      includeImports: true,
      range: WIDE,
      groups: [H1],
    });
    expect(on.review.total).toBe(1);
  });

  it('AC-5 R6: 消した印の決済の代わり → 本玉を単独で 1 件（まとまりにしない）', () => {
    const m = reviewModel([stored(F1), stored(C1)], {
      ...base,
      hidden: new Set(['c1']),
      range: WIDE,
      groups: [H1],
    });
    expect(m.review.total).toBe(1);
    expect(m.rows[0]?.instrumentName.endsWith(' · 両建て')).toBe(false);
  });

  it('AC-5: 崩れたまとまり（メンバーの取引が届かない）→ 見つかったメンバーを単独で', () => {
    const m = reviewModel([stored(C1)], { ...base, range: WIDE, groups: [H1] });
    expect([m.review.total, m.review.counts.C]).toEqual([1, 1]);
  });

  it('AC-7: ホームの今月の規律のカードも 1 件で数える', () => {
    const m = reviewModel([stored(F1), stored(C1), A1], { ...base, range: WIDE, groups: [H1] });
    const card = monthCard(
      m,
      { ok: true, from: WIDE.from, to: WIDE.to, label: '期間' } as never,
      {
        period: 'month',
        imports: false,
      } as never,
    );
    expect(card.count).toBe('2 件');
  });
});

describe('気づき（心理・崩れ方・連勝の後）', () => {
  it('AC-3 R4: 心理はメンバーの和で 1 件ずつ（F に nervous、C に overconfident）', () => {
    const f = main({ exitPrice: 38_600, emotionTags: ['nervous'] }, 'f1');
    const c = hedge({ price: 38_450, exitPrice: 38_620, emotionTags: ['overconfident'] }, 'c1');
    const items = insightItems([stored(f), stored(c)], {
      hidden: NONE,
      range: WIDE,
      groups: [groupOf('g1', [f, c])],
    });
    const v = reviewByEmotion(items, { includeImports: false });
    expect(v.total).toBe(1);
    expect(v.rows.map((r) => [r.id, r.review.total])).toEqual(
      expect.arrayContaining([
        ['nervous', 1],
        ['overconfident', 1],
      ]),
    );
  });

  it('AC-3 R4: F に平常心・C に fear → 平常心の行に入らない', () => {
    const f = main({ exitPrice: 38_600, emotionTags: ['calm'] }, 'f1');
    const c = hedge({ price: 38_450, exitPrice: 38_620, emotionTags: ['fear'] }, 'c1');
    const items = insightItems([stored(f), stored(c)], {
      hidden: NONE,
      range: WIDE,
      groups: [groupOf('g1', [f, c])],
    });
    const v = reviewByEmotion(items, { includeImports: false });
    expect(v.rows.map((r) => r.id)).toEqual(['fear']);
  });

  it('AC-3: H2 のまとまりは崩れ方「持ち続けた」に 1 件・「LC 無し」に 0 件', () => {
    const items = insightItems([stored(F2), stored(C2)], {
      hidden: NONE,
      range: WIDE,
      groups: [H2],
    });
    const v = reviewByReason(items, { includeImports: false });
    expect(v.rows.map((r) => [r.kind, r.review.total])).toEqual([['heldPastLc', 1]]);
    // まとまりを組まなければ CFD の LC 無しが数えられる
    const raw = reviewByReason(
      insightItems([stored(F2), stored(C2)], { hidden: NONE, range: WIDE }),
      {
        includeImports: false,
      },
    );
    expect(raw.rows.some((r) => r.kind === 'noLc')).toBe(true);
  });

  it('AC-3: まとまりの勝ちが連勝を続ける（勝ち 2 件の後の取引が連勝の後）', () => {
    // 単独の勝ち（TP 38,600）→ H1（勝ち。決済の時刻 FIX の後に置くため単独は FIX の前）→ 単独の A（MON の後）
    const w = solo('w1', { exitPrice: 38_600, exitTime: FIX - HOUR, reason: 'tp' });
    const items = insightItems([w, stored(F1), stored(C1), A1], {
      hidden: NONE,
      range: WIDE,
      groups: [H1],
    });
    const v = reviewAfterWinStreak(items, { includeImports: false });
    expect([...v.ids]).toEqual(['s1']);
    // まとまりを組まなければ CFD の C が連勝を切る
    const raw = reviewAfterWinStreak(
      insightItems([w, stored(F1), stored(C1), A1], { hidden: NONE, range: WIDE }),
      { includeImports: false },
    );
    expect(raw.ids.has('s1')).toBe(false);
  });
});

describe('期間の取引（reviewTradesModel）', () => {
  it('AC-6 R8: 崩れの取引で H2 → 最初の本玉の 1 行（札 B・R −1.5R・「· 両建て」）。CFD の行は出ない', () => {
    const m = reviewTradesModel([stored(F2), stored(C2)], {
      hidden: NONE,
      includeImports: false,
      range: WIDE,
      filter: parseTrail('?tier=off'),
      instruments: [],
      groups: [H2],
      origin: 'c2',
    });
    expect(m.rows.map((r) => r.id)).toEqual(['f2']);
    const [row] = m.rows;
    expect(row?.badge.label).toContain('B');
    expect(row?.rText).toBe('−1.5R');
    expect(row?.instrumentName.endsWith(' · 両建て')).toBe(true);
    expect(row?.exitTime).toBe(FIX);
    expect(m.summary?.startsWith('1 件')).toBe(true);
    // URL の元の取引が決済の代わりでも、まとまりの行に札
    expect(m.origin).toBe('f2');
  });

  it('KEEP-1: まとまりが無ければ行は今と同じ', () => {
    const opts = {
      hidden: NONE,
      includeImports: false,
      range: WIDE,
      filter: parseTrail('?tier=off'),
      instruments: [],
    };
    const trades = [stored(F2), stored(C2), A1];
    expect(reviewTradesModel(trades, { ...opts, groups: [] })).toEqual(
      reviewTradesModel(trades, opts),
    );
  });
});

describe('直近の流れ（streakModel）', () => {
  it('AC-7 R9: 直近の行に F・C と単独 3 件 → 点 4、F の位置にまとまりの段', () => {
    const singles = [1, 2, 3].map((i) =>
      solo(`s${i}`, { exitPrice: 37_700, orderType: 'stop', exitTime: MON + i * HOUR }),
    );
    const trades = [stored(F1), stored(C1), ...singles];
    const m = streakModel(trades, NONE, { groups: [H1], groupMembers: [] });
    expect(m?.dots.map((d) => d.id)).toEqual(['f1', 's1', 's2', 's3']);
    expect(m?.dots[0]?.tier).toBe('plan');
    expect(streakModel(trades, NONE)?.dots).toHaveLength(5);
  });

  it('メンバーがあるときだけ読む範囲（最も古い決済 〜 最も新しい決済 + 1ms）', () => {
    expect(streakGroupRange([A1], NONE)).toBeNull();
    const f = stored(F1, { positionGroupId: 'g1' } as Partial<StoredTrade>);
    expect(streakGroupRange([f, A1], NONE)).toEqual({ from: MON, to: MON + HOUR + 1 });
  });
});

describe('範囲の読み（review-controller）', () => {
  const respond = (body: unknown) => async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('AC-8: positionGroups・groupMembers を持つ', async () => {
    const c = createReviewController({
      api: respond({
        items: [stored(F1)],
        truncated: false,
        positionGroups: [H1],
        groupMembers: [stored(C1)],
      }),
    });
    await c.load(WIDE);
    const s = c.getState();
    expect(
      s.phase === 'ready' && [s.groups?.map((g) => g.id), s.groupMembers?.map((t) => t.id)],
    ).toEqual([['g1'], ['c1']]);
  });

  it('AC-8: 鍵の無い応答（前の版の API）・崩れた値は空の配列', async () => {
    const c = createReviewController({ api: respond({ items: [], truncated: false }) });
    await c.load(WIDE);
    expect(c.getState()).toMatchObject({ phase: 'ready', groups: [], groupMembers: [] });
    const d = createReviewController({
      api: respond({
        items: [],
        positionGroups: [{ id: 1 }, { id: 'g', members: [{ tradeId: 't', role: 'x' }] }],
      }),
    });
    await d.load(WIDE);
    expect(d.getState()).toMatchObject({ phase: 'ready', groups: [] });
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

describe('性質', () => {
  it('KEEP-1: まとまりが無ければ（空・メンバーの居ないまとまり）規律と単位は今と同じ', () => {
    const r = rng(1268);
    for (let n = 0; n < 40; n++) {
      const trades = Array.from({ length: 1 + Math.floor(r() * 15) }, (_, i) =>
        solo(`t${i}`, {
          exitPrice: 37_300 + Math.round(r() * 1_600),
          exitTime: MON + Math.round((r() - 0.5) * 4e8),
          ...(r() < 0.2 ? { lc: null } : {}),
          ...(r() < 0.2 ? { source: 'import' as const } : {}),
        }),
      );
      const hidden = new Set(trades.filter(() => r() < 0.15).map((t) => t.id));
      const opts = { ...base, hidden, range: WIDE };
      const now = reviewModel(trades, opts);
      expect(reviewModel(trades, { ...opts, groups: [], groupMembers: [] })).toEqual(now);
      const ghost = groupOf('gx', [
        main({ exitPrice: 1 }, 'zz1'),
        hedge({ price: 1, exitPrice: 1 }, 'zz2'),
      ]);
      expect(reviewModel(trades, { ...opts, groups: [ghost] }).review).toEqual(now.review);
    }
  });

  it('まとまりのメンバーは別に数えない（件数 = 単独 + まとまり。どの取引も 1 回）', () => {
    const r = rng(2268);
    for (let n = 0; n < 40; n++) {
      const k = 1 + Math.floor(r() * 4);
      const trades: StoredTrade[] = [];
      const groups: StoredPositionGroup[] = [];
      for (let i = 0; i < k; i++) {
        const f = main({ exitPrice: 37_400 + Math.round(r() * 1_400) }, `f${i}`);
        const c = hedge({ price: 37_400 + Math.round(r() * 1_400), exitPrice: 38_000 }, `c${i}`);
        trades.push(stored(f), stored(c));
        groups.push(groupOf(`g${i}`, [f, c]));
      }
      const s = Math.floor(r() * 5);
      for (let i = 0; i < s; i++)
        trades.push(solo(`s${i}`, { exitPrice: 37_700, orderType: 'stop' }));
      const units = reviewUnits(trades, { hidden: NONE, range: WIDE, groups });
      expect(units.filter((u) => u.kind === 'group')).toHaveLength(k);
      expect(units).toHaveLength(k + s);
      const m = reviewModel(trades, { ...base, range: WIDE, groups });
      expect(m.review.total).toBe(k + s);
      expect(m.review.counts.C).toBe(0);
      expect(Number.isFinite(m.review.cost)).toBe(true);
    }
  });
});
