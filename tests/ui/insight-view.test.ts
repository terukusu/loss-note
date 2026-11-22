// 振り返りの「気づき」の心理ごとの集計の表示の形（Issue #162 の AC-1〜AC-6・KEEP-3。例 E1〜E8）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  emotionItemOf,
  FEW,
  INSIGHT_NONE,
  insightModel,
  insightModelFor,
  OVERLAP_NOTE,
} from '../../ui/src/lib/insight-view';
import { periodRange } from '../../ui/src/lib/period';
import { REVIEW_ONLY_IMPORTS, reviewItemOf, reviewModel } from '../../ui/src/lib/review-view';
import { E1, E1_HIDDEN, E3, E4, E5, E6, E8 } from './helpers/insight-examples';
import { REVIEW_NOW } from './helpers/review-examples';
import { INSTRUMENTS } from './helpers/trade-examples';

const range7 = periodRange({ key: '7d', imports: false }, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };
const NONE = new Set<string>();

const model = (
  trades: Parameters<typeof insightModel>[0],
  includeImports = false,
  hidden: ReadonlySet<string> = NONE,
) => insightModel(trades, { hidden, includeImports, range: R7 });

describe('例の取引の判定と R（手で計算した値: (決済 − 100) ÷ 0.5）', () => {
  it('E1 の判定・R・タグ', () => {
    const items = E1.map(emotionItemOf);
    expect(items.map((i) => i.grade)).toEqual([
      'A',
      'A',
      'safeWin',
      'A',
      'safeWin',
      'B',
      'B',
      'riskyWin',
      'C',
      'A',
      'B',
      'B',
      'B',
      'B',
      'A',
    ]);
    const rs = items.map((i) => (i.r === undefined ? null : Math.round(i.r * 1e9) / 1e9));
    expect(rs).toEqual([-1, -0.9, 2, -1, 1.5, -1.6, -2, 1, null, -1, -1.2, -3, -2, -1.5, -1]);
    expect(items[9]?.emotions).toBeUndefined();
    // タグは一覧の順（平常心 → … → 取り戻したい → … → 切れない）
    expect(items[5]?.emotions).toEqual(['wantPosition', 'recoup']);
    // 規律の集計の 1 件はタグで変わらない
    expect(reviewItemOf(E1[5] as (typeof E1)[number])).not.toHaveProperty('emotions');
  });

  it('E3 の判定なし・E4 の C', () => {
    expect(E3.map(emotionItemOf).map((i) => i.grade)).toEqual(['A', 'A', 'B', 'safeWin', null]);
    expect(E4.map(emotionItemOf).map((i) => [i.grade, i.r === undefined])).toEqual([
      ['A', false],
      ['A', false],
      ['A', false],
      ['A', false],
      ['C', true],
    ]);
  });
});

describe('AC-1・AC-5: E1（取り込みを含めない・T12 は消した印・T13 は期間の外）', () => {
  const m = model(E1, false, E1_HIDDEN);

  it('見出し「11 件のうち 10 件に記入」', () => {
    expect(m.empty).toBe(false);
    expect(m.headText).toBe('11 件のうち 10 件に記入');
    expect(m.emptyText).toBeNull();
  });

  it('6 行の名前・順・件数・率・分数・規律コストの文', () => {
    expect(m.rows.map((r) => r.text)).toEqual([
      '平常心 5 件 · 100%（5 / 5）· 崩れなし ±0.0R',
      '取り戻したい 5 件 · 0%（0 / 5）· 崩れで −1.8R',
      `儲けたい 1 件 · ${FEW}`,
      `ポジりたい 1 件 · ${FEW}`,
      `調子に乗った 1 件 · ${FEW}`,
      `切れない 1 件 · ${FEW}`,
    ]);
    expect(m.rows[0]).toMatchObject({
      name: '平常心',
      countText: '5 件',
      rateText: '100%',
      fractionText: '5 / 5',
      cost: { kind: 'none', lead: '崩れなし', value: '±0.0R' },
    });
    expect(m.rows[1]?.cost).toEqual({ kind: 'gap', lead: '崩れで', value: '−1.8R' });
  });

  it('T12・T13・I1・I2 はどの行にも入らない（取り戻したい 5 件 = T6・T7・T8・T9・T11）', () => {
    const shown = model([...E1].filter((t) => !['t12', 't13', 'i1', 'i2'].includes(t.id)));
    expect(shown).toEqual(m);
  });

  it('AC-2: 2 つ以上のタグの取引があるので添えの 1 行が出る（行の和 14 ≠ 記入 10）', () => {
    expect(m.overlapText).toBe(OVERLAP_NOTE);
    expect(m.rows.reduce((s, r) => s + Number.parseInt(r.countText, 10), 0)).toBe(14);
  });
});

describe('AC-3: E2（E1 で取り込みを含める）', () => {
  it('13 件のうち 12 件に記入・平常心 6 件 100%（6 / 6）崩れなし・取り戻したい 6 件 0%（0 / 6）崩れで −2.3R・ほかは E1 と同じ', () => {
    const m = model(E1, true, E1_HIDDEN);
    expect(m.headText).toBe('13 件のうち 12 件に記入');
    expect(m.rows.map((r) => r.text)).toEqual([
      '平常心 6 件 · 100%（6 / 6）· 崩れなし ±0.0R',
      '取り戻したい 6 件 · 0%（0 / 6）· 崩れで −2.3R',
      ...model(E1, false, E1_HIDDEN)
        .rows.slice(2)
        .map((r) => r.text),
    ]);
  });
});

describe('AC-2: E8（1 件に 1 つずつ）', () => {
  it('添えの 1 行は出ない・行の和 = 記入', () => {
    const m = model(E8);
    expect(m.overlapText).toBeNull();
    expect(m.headText).toBe('7 件のうち 7 件に記入');
    expect(m.rows.map((r) => r.text)).toEqual([
      '平常心 5 件 · 100%（5 / 5）· 崩れなし ±0.0R',
      `悔しい 2 件 · ${FEW}`,
    ]);
  });
});

describe('AC-4: E3（判定の出た取引が 4 件）', () => {
  it('怖い 5 件 · 件数が少ない（%・分数・R の文が無い）', () => {
    const m = model(E3);
    expect(m.rows).toHaveLength(1);
    const r = m.rows[0];
    expect(r?.text).toBe(`怖い 5 件 · ${FEW}`);
    expect(r).toMatchObject({ few: true, rateText: null, fractionText: null, cost: null });
    expect(r?.text).not.toMatch(/%|\/|R/);
  });
});

describe('AC-5: E4（R の出ない C が 1 件）', () => {
  it('祈り 5 件 · 80%（4 / 5）· R で測れる崩れ ±0.0R（「崩れなし」と言い切らない）', () => {
    const m = model(E4);
    expect(m.rows.map((r) => r.text)).toEqual(['祈り 5 件 · 80%（4 / 5）· R で測れる崩れ ±0.0R']);
    expect(m.rows[0]?.cost?.kind).toBe('measured');
  });

  it('判定は 5 件以上だが R が 1 件も出ない行は、規律コストの代わりに「R が出る取引がありません」', () => {
    const allC = E4.map((t) => ({ ...t, record: { ...t.record } }));
    const noR = allC.map((t) => {
      const { lc: _lc, ...rest } = t.record;
      return { ...t, record: { ...rest, lcDecidedBeforeEntry: false } } as typeof t;
    });
    const m = model(noR);
    expect(m.rows[0]?.text).toBe('祈り 5 件 · 0%（0 / 5）· R が出る取引がありません');
  });
});

describe('AC-6: 行が 0 の期間', () => {
  it('E5: タグの無い 3 件 → 行 0・見出しは「3 件のうち 0 件に記入」・付け方の 1 行', () => {
    const m = model(E5);
    expect(m.rows).toEqual([]);
    expect(m.empty).toBe(false);
    expect(m.headText).toBe('3 件のうち 0 件に記入');
    expect(m.emptyText).toBe(INSIGHT_NONE);
    expect(m.overlapText).toBeNull();
  });

  it('E6: 取り込みだけで含めない → 規律と同じ文・行 0', () => {
    const m = model(E6);
    expect(m.rows).toEqual([]);
    expect(m.empty).toBe(true);
    expect(m.emptyText).toBe(REVIEW_ONLY_IMPORTS);
    expect(
      reviewModel(E6, {
        hidden: NONE,
        includeImports: false,
        instruments: INSTRUMENTS,
        now: REVIEW_NOW,
        range: R7,
      }).emptyText,
    ).toBe(REVIEW_ONLY_IMPORTS);
  });

  it('期間の取引が 0 件 → 規律と同じ空の文', () => {
    const m = model([]);
    expect(m.empty).toBe(true);
    expect(m.emptyText).toBe('この期間に決済した取引はありません');
  });
});

describe('KEEP-3: タグの欄を持たない取引', () => {
  it('規律の値はタグを外しても同じ・気づきは E5', () => {
    const plain = E1.map((t) => {
      const { emotionTags: _t, ...rest } = t;
      return rest;
    });
    const opts = {
      hidden: E1_HIDDEN,
      includeImports: false,
      instruments: INSTRUMENTS,
      now: REVIEW_NOW,
      range: R7,
    };
    expect(reviewModel(plain, opts)).toEqual(reviewModel(E1, opts));
    const m = model(plain, false, E1_HIDDEN);
    expect(m.rows).toEqual([]);
    expect(m.emptyText).toBe(INSIGHT_NONE);
  });

  it('知らないタグの ID は捨てる（行にも記入にも入らない）', () => {
    const odd = { ...(E5[0] as (typeof E5)[number]), emotionTags: ['unknown'] } as never;
    const m = model([odd, ...E5.slice(1)]);
    expect(m.headText).toBe('3 件のうち 0 件に記入');
  });
});

describe('値の行と件数が少ない行の分け方（#162 デザインレビュー 1・4・5）', () => {
  it('E1: 値の行 = 平常心（基準）・取り戻したい、件数が少ない行 = 残り 4 つ（あと 4 件）', () => {
    const m = model(E1, false, E1_HIDDEN);
    expect(m.main.map((r) => r.id)).toEqual(['calm', 'recoup']);
    expect(m.main.map((r) => r.base)).toEqual([true, false]);
    expect(m.few.map((r) => [r.id, r.restText])).toEqual([
      ['wantProfit', 'あと 4 件'],
      ['wantPosition', 'あと 4 件'],
      ['overconfident', 'あと 4 件'],
      ['cantCut', 'あと 4 件'],
    ]);
    expect([...m.main, ...m.few]).toEqual(m.rows);
  });

  it('E3: 件数は 5 件でも判定の出た取引 4 件 → あと 1 件', () => {
    expect(model(E3).few.map((r) => [r.countText, r.restText])).toEqual([['5 件', 'あと 1 件']]);
  });

  it('平常心は件数が少なくても値の行の先頭（基準の場所を変えない）', () => {
    const m = model(E8.filter((t) => t.id !== 'c1' && t.id !== 'c2'));
    expect(m.main.map((r) => [r.id, r.few, r.restText])).toEqual([['calm', true, 'あと 2 件']]);
    expect(m.few.map((r) => r.id)).toEqual(['frustrated']);
  });
});

describe('対象の外の取引（レビュー 4）', () => {
  it('取り込みを含めても、消した印の T12・期間の外の T13 はどの行にも入らない', () => {
    const on = model(E1, true, E1_HIDDEN);
    const without = model(
      E1.filter((t) => t.id !== 't12' && t.id !== 't13'),
      true,
    );
    expect(on).toEqual(without);
    expect(on.rows.find((r) => r.id === 'recoup')?.countText).toBe('6 件');
  });
});

describe('insightModelFor: 読み終えた範囲と今の期間', () => {
  it('同じ範囲なら表示の形、違う範囲・読み込み中・期間の誤りは null', () => {
    const ready = { phase: 'ready', range: R7, trades: E8, truncated: false } as const;
    const opts = { hidden: NONE, includeImports: false };
    expect(insightModelFor(ready, range7, opts)?.rows).toHaveLength(2);
    expect(
      insightModelFor(ready, periodRange({ key: '1d', imports: false }, REVIEW_NOW), opts),
    ).toBeNull();
    expect(insightModelFor({ phase: 'loading', range: R7 }, range7, opts)).toBeNull();
    expect(insightModelFor(ready, { ok: false, error: 'x' }, opts)).toBeNull();
  });
});
