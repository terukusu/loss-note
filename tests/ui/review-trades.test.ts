// 振り返りの次の画面「期間の取引」の絞り方の URL と表示の形（Issue #185 の AC-1〜AC-3・AC-7・AC-8。例 L1〜L4・L6・B6）。
// 値はすべて架空
import { describe, expect, it } from 'vitest';
import { insightModel } from '../../ui/src/lib/insight-view';
import { type PeriodSelection, parsePeriod, periodRange } from '../../ui/src/lib/period';
import type { ReviewState } from '../../ui/src/lib/review-controller';
import {
  parseTrail,
  REVIEW_TRADES_NONE,
  reviewTradesHref,
  reviewTradesModel,
  reviewTradesModelFor,
  type TrailFilter,
  trailTitle,
} from '../../ui/src/lib/review-trades';
import { E1, E1_HIDDEN } from './helpers/insight-examples';
import { REVIEW_NOW } from './helpers/review-examples';
import { B, B_HIDDEN } from './helpers/streak-examples';
import { INSTRUMENTS } from './helpers/trade-examples';

const SEVEN: PeriodSelection = { key: '7d', imports: false };
const range7 = periodRange(SEVEN, REVIEW_NOW);
const R7 = range7.ok ? { from: range7.from, to: range7.to } : { from: 0, to: 1 };

const model = (
  filter: TrailFilter | null,
  opts: { trades?: typeof E1; includeImports?: boolean; hidden?: ReadonlySet<string> } = {},
) =>
  reviewTradesModel(opts.trades ?? E1, {
    hidden: opts.hidden ?? E1_HIDDEN,
    includeImports: opts.includeImports ?? false,
    range: R7,
    filter,
    instruments: INSTRUMENTS,
  });
const ids = (m: ReturnType<typeof model>) => m.rows.map((r) => r.id);
const recoup: TrailFilter = { kind: 'emotion', id: 'recoup' };

describe('絞り方の URL', () => {
  it('心理・連勝の後の URL（期間の検索部分は振り返りのタブと同じ）と往復', () => {
    expect(reviewTradesHref(SEVEN, recoup)).toBe('/review/trades?period=7d&emotion=recoup');
    expect(reviewTradesHref({ key: '1m', imports: true }, { kind: 'winStreak' })).toBe(
      '/review/trades?period=1m&imports=1&after=winStreak',
    );
    const custom: PeriodSelection = {
      key: 'custom',
      from: '2026-11-01',
      to: '2026-11-19',
      imports: false,
    };
    const href = reviewTradesHref(custom, { kind: 'emotion', id: 'overconfident' });
    const search = href.slice('/review/trades'.length);
    expect(parsePeriod(search)).toEqual(custom);
    expect(parseTrail(search)).toEqual({ kind: 'emotion', id: 'overconfident' });
    expect(parseTrail('?period=7d&after=winStreak')).toEqual({ kind: 'winStreak' });
  });

  it('知らない値は null（一覧の ID だけを通す）', () => {
    for (const s of [
      '',
      '?period=7d',
      '?emotion=foo',
      '?emotion=',
      '?after=lossStreak',
      '?emotion=__proto__',
    ]) {
      expect(parseTrail(s)).toBeNull();
    }
  });

  it('題: 心理の名前・連勝の後・知らない絞り方は「期間の取引」', () => {
    expect(trailTitle(recoup)).toBe('取り戻したい');
    expect(trailTitle({ kind: 'winStreak' })).toBe('連勝の後');
    expect(trailTitle(null)).toBe('期間の取引');
  });
});

describe('AC-2・AC-3: 心理の行 → 期間の取引（例 A）', () => {
  it('L1: 取り戻したい = T11 · T9 · T8 · T7 · T6、要約「5 件 · 0%（0 / 5）· 崩れで −1.8R」', () => {
    const m = model(recoup);
    expect(m.title).toBe('取り戻したい');
    expect(ids(m)).toEqual(['t11', 't9', 't8', 't7', 't6']);
    expect(m.summary).toBe('5 件 · 0%（0 / 5）· 崩れで −1.8R');
    expect(m.empty).toBe(false);
    expect(m.rows.map((r) => r.href)).toEqual(ids(m).map((id) => `/trades/${id}`));
  });

  it('L2: 取り込みを含める = I1 · T11 · T9 · T8 · T7 · T6、「6 件 · 0%（0 / 6）· 崩れで −2.3R」', () => {
    const m = model(recoup, { includeImports: true });
    expect(ids(m)).toEqual(['i1', 't11', 't9', 't8', 't7', 't6']);
    expect(m.summary).toBe('6 件 · 0%（0 / 6）· 崩れで −2.3R');
  });

  it('L3: 調子に乗った（件数が少ない行）= T8、「1 件 · 件数が少ない」', () => {
    const m = model({ kind: 'emotion', id: 'overconfident' });
    expect(m.title).toBe('調子に乗った');
    expect(ids(m)).toEqual(['t8']);
    expect(m.summary).toBe('1 件 · 件数が少ない');
  });

  it('L4: 平常心（基準の行）= T5 · T4 · T3 · T2 · T1', () => {
    expect(ids(model({ kind: 'emotion', id: 'calm' }))).toEqual(['t5', 't4', 't3', 't2', 't1']);
  });

  it('T12（消した印）・T13（期間の外）はどの心理にも出ない・I1 は取り込みを含めたときだけ', () => {
    for (const include of [false, true]) {
      const all = [
        'calm',
        'recoup',
        'overconfident',
        'wantPosition',
        'cantCut',
        'wantProfit',
      ] as const;
      const seen = all.flatMap((id) =>
        ids(model({ kind: 'emotion', id }, { includeImports: include })),
      );
      expect(seen).not.toContain('t12');
      expect(seen).not.toContain('t13');
      expect(seen.includes('i1')).toBe(include);
    }
  });

  it('要約と件数は気づきの行と同じ（行の文 = 名前 + 要約・行の件数 = 画面の行の数）', () => {
    for (const include of [false, true]) {
      const insight = insightModel(E1, { hidden: E1_HIDDEN, includeImports: include, range: R7 });
      for (const row of insight.rows) {
        const m = model({ kind: 'emotion', id: row.id }, { includeImports: include });
        expect(`${row.name} ${m.summary}`).toBe(row.text);
        expect(`${m.rows.length} 件`).toBe(row.countText);
      }
    }
  });
});

describe('AC-7: 連勝の後 → 期間の取引（B6）', () => {
  it('題「連勝の後」・要約「2 件 · 件数が少ない」・行 S6 · S3', () => {
    const m = model({ kind: 'winStreak' }, { trades: B, hidden: B_HIDDEN });
    expect(m.title).toBe('連勝の後');
    expect(m.summary).toBe('2 件 · 件数が少ない');
    expect(ids(m)).toEqual(['s6', 's3']);
  });

  it('取り込みを含めると S10 · S6 · S3（カードの件数と同じ）', () => {
    const m = model({ kind: 'winStreak' }, { trades: B, hidden: B_HIDDEN, includeImports: true });
    expect(ids(m)).toEqual(['s10', 's6', 's3']);
    const card = insightModel(B, { hidden: B_HIDDEN, includeImports: true, range: R7 }).streak;
    expect(m.summary).toBe(card?.summary);
  });
});

describe('AC-8: 該当なし', () => {
  it('L6: 知らない心理（絞り方なし）→ 行 0・文', () => {
    const m = model(null);
    expect(m).toEqual({
      title: '期間の取引',
      summary: null,
      summaryParts: [],
      rows: [],
      notes: {},
      empty: true,
      emptyText: REVIEW_TRADES_NONE,
      truncatedText: null,
    });
    expect(REVIEW_TRADES_NONE).toBe('この期間に該当する取引はありません');
  });

  it('期間に該当 0 件（E1 に怖いは無い）→ 行 0・文', () => {
    const m = model({ kind: 'emotion', id: 'fear' });
    expect(m.title).toBe('怖い');
    expect(m.rows).toEqual([]);
    // 何で絞って 0 件かを言う（#185 デザインレビュー 7）
    expect(m.emptyText).toBe('この期間に「怖い」を付けた取引はありません');
  });

  it('連勝の後が 0 件（E1）→ 題「連勝の後」・連勝の後のカードと同じ文', () => {
    const m = model({ kind: 'winStreak' });
    expect(m.title).toBe('連勝の後');
    expect(m.emptyText).toBe('この期間に 2 連勝の直後の取引はありません');
  });
});

describe('名前つきの要約・行の心理の添え・上限の印（#185 のレビュー）', () => {
  it('名前つきの要約は値が気づきの行と同じ（件数が少ないときは件数だけ）', () => {
    expect(model(recoup).summaryParts).toEqual([
      '5 件',
      '計画どおり率 0%（0 / 5）',
      '規律コスト 崩れで −1.8R',
    ]);
    expect(model({ kind: 'emotion', id: 'overconfident' }).summaryParts).toEqual([
      '1 件',
      '件数が少ない',
    ]);
    expect(model(null).summaryParts).toEqual([]);
  });

  it('心理の添え: 絞った心理を省く・心理の無い行は無い・3 つ以上は「ほか N」', () => {
    expect(model(recoup).notes).toEqual({
      t11: '儲けたい',
      t9: '切れない',
      t8: '調子に乗った',
      t6: 'ポジりたい',
    });
    const many = E1.map((t) =>
      t.id === 't11'
        ? { ...t, emotionTags: ['recoup', 'fear', 'nervous', 'regret', 'hope'] as const }
        : t,
    );
    expect(model(recoup, { trades: many }).notes.t11).toBe('怖い・ドキドキ ほか 2');
  });

  it('連勝の後: 「調子に乗った」を先に、ほかの心理を後に', () => {
    expect(model({ kind: 'winStreak' }, { trades: B, hidden: B_HIDDEN }).notes).toEqual({
      s6: '調子に乗った・ポジりたい',
      s3: '調子に乗った',
    });
  });

  it('上限（2,000 件）を超えた期間は気づき・規律と同じ文。超えなければ null', () => {
    const ready = (truncated: boolean): ReviewState => ({
      phase: 'ready',
      range: R7,
      trades: E1,
      truncated,
    });
    const opts = {
      hidden: E1_HIDDEN,
      includeImports: false,
      filter: recoup,
      instruments: INSTRUMENTS,
    };
    expect(reviewTradesModelFor(ready(true), range7, opts)?.truncatedText).toBe(
      '期間の取引が多いので先頭の 2,000 件で集計しています',
    );
    expect(reviewTradesModelFor(ready(false), range7, opts)?.truncatedText).toBeNull();
    expect(
      reviewTradesModelFor(ready(true), range7, { ...opts, filter: null })?.truncatedText,
    ).toBe('期間の取引が多いので先頭の 2,000 件で集計しています');
  });
});

describe('reviewTradesModelFor: 読み終えた範囲が今の期間と同じときだけ', () => {
  const ready: ReviewState = { phase: 'ready', range: R7, trades: E1, truncated: false };
  const opts = {
    hidden: E1_HIDDEN,
    includeImports: false,
    filter: recoup,
    instruments: INSTRUMENTS,
  };
  it('同じ範囲なら表示の形・違う範囲・読み込み中は null', () => {
    expect(reviewTradesModelFor(ready, range7, opts)?.rows).toHaveLength(5);
    const one = periodRange({ key: '1m', imports: false }, REVIEW_NOW);
    expect(reviewTradesModelFor(ready, one, opts)).toBeNull();
    expect(reviewTradesModelFor({ phase: 'loading', range: R7 }, range7, opts)).toBeNull();
  });
});
