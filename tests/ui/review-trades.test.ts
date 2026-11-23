// 振り返りの次の画面「期間の取引」の絞り方の URL と表示の形（Issue #185 の AC-1〜AC-3・AC-7・AC-8。例 L1〜L4・L6・B6）。
// 値はすべて架空
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { insightModel } from '../../ui/src/lib/insight-view';
import { type PeriodSelection, parsePeriod, periodRange } from '../../ui/src/lib/period';
import { createReviewController, type ReviewState } from '../../ui/src/lib/review-controller';
import {
  autoPeriodLead,
  isFromTrade,
  parseTrail,
  REVIEW_TRADES_NONE,
  reviewTradesHref,
  reviewTradesModel,
  reviewTradesModelFor,
  type TrailFilter,
  tradeEmotionHref,
  trailTitle,
} from '../../ui/src/lib/review-trades';
import { createFakeApi } from './helpers/fake-api';
import { E1, E1_HIDDEN, tagged } from './helpers/insight-examples';
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

describe('取引の詳細の心理のチップの行き先（Issue #188。例 E1・E5・E8・E9）', () => {
  /** 今日 = 2026-11-23 12:00（ローカル）。今日の「3 か月」= 2026-08-24〜2026-11-23 */
  const TODAY = new Date(2026, 10, 23, 12).getTime();
  const at = (m: number, d: number, h = 10) => new Date(2026, m - 1, d, h).getTime();
  const T1 = tagged('d1', 0, 'B', -1.6, ['recoup'], { exitTime: at(11, 20, 14) });
  const T2 = tagged('d2', 0, 'A', -1.0, ['wantPosition', 'recoup'], { exitTime: at(10, 2) });
  const T3 = tagged('d3', 0, 'B', -1.2, ['recoup'], { exitTime: at(7, 15) });
  const T4 = tagged('d4', 0, 'A', -1.0, ['calm'], { exitTime: at(11, 1) });
  const IMP = tagged('d5', 0, 'A', -1.0, ['calm'], { exitTime: at(11, 20), source: 'import' });
  const OLD = tagged('d6', 0, 'B', -1.4, ['recoup'], { exitTime: at(8, 23, 23) });
  const query = (href: string) => {
    const u = new URL(href, 'https://example.com');
    return { path: u.pathname, q: Object.fromEntries(u.searchParams) };
  };
  /** URL を開いたときの期間の取引（行き先の画面と同じ組み立て: parsePeriod → periodRange → 読み込み → 表示の形） */
  const open = (href: string, trades: readonly StoredTrade[]) => {
    const search = new URL(href, 'https://example.com').search;
    const sel = parsePeriod(search);
    const range = periodRange(sel, TODAY);
    if (!range.ok) throw new Error(range.error);
    const inside = trades.filter(
      (t) => t.record.exit.time >= range.from && t.record.exit.time < range.to,
    );
    return reviewTradesModel(inside, {
      hidden: new Set(),
      includeImports: sel.imports,
      range: { from: range.from, to: range.to },
      filter: parseTrail(search),
      instruments: INSTRUMENTS,
    });
  };

  it('E1: 取り込みでない・今日の 3 か月の中の取引 → 3 か月・取り込みなし・その心理', () => {
    const href = tradeEmotionHref(T1, 'recoup', TODAY);
    expect(query(href)).toEqual({
      path: '/review/trades',
      q: { period: '3m', emotion: 'recoup', via: 'trade' },
    });
    expect(trailTitle(parseTrail(new URL(href, 'https://example.com').search))).toBe(
      '取り戻したい',
    );
  });

  it('E5: 取り込んだ取引 → 取り込みを含める', () => {
    expect(query(tradeEmotionHref(IMP, 'calm', TODAY)).q).toEqual({
      period: '3m',
      imports: '1',
      emotion: 'calm',
      via: 'trade',
    });
  });

  it('E3 の形: 今日の 3 か月より前の取引 → 決済の日までの 3 か月', () => {
    expect(query(tradeEmotionHref(OLD, 'recoup', TODAY)).q).toEqual({
      period: 'custom',
      from: '2026-05-24',
      to: '2026-08-23',
      emotion: 'recoup',
      via: 'trade',
    });
  });

  it('E8: 行き先は期間とその心理に当たる取引だけ（T1 · T2。期間の外の T3・心理の違う T4 は出ない）', () => {
    const href = tradeEmotionHref(T1, 'recoup', TODAY);
    const m = open(href, [T1, T2, T3, T4]);
    expect(m.rows.map((r) => r.id)).toEqual(['d1', 'd2']);
    expect(m.title).toBe('取り戻したい');
    expect(m.empty).toBe(false);
    // 要約は同じ期間の気づきの「取り戻したい」の行と同じ値（#185 の約束。コードレビュー 5）
    const sel = parsePeriod(new URL(href, 'https://example.com').search);
    const range = periodRange(sel, TODAY);
    if (!range.ok) throw new Error(range.error);
    const inside = [T1, T2, T3, T4].filter(
      (t) => t.record.exit.time >= range.from && t.record.exit.time < range.to,
    );
    const insight = insightModel(inside, {
      hidden: new Set(),
      includeImports: false,
      range: { from: range.from, to: range.to },
    });
    const row = insight.rows.find((r) => r.id === 'recoup');
    expect(row).toBeDefined();
    expect(`${row?.name} ${m.summary}`).toBe(row?.text);
    expect(`${m.rows.length} 件`).toBe(row?.countText);
  });

  it('押した日で決める（コードレビュー 3）: 3 か月の最初の日の取引は、日付をまたいだ後に押すと決済の日までの 3 か月', () => {
    const edge = tagged('d7', 0, 'A', -1.0, ['recoup'], { exitTime: at(8, 24, 0) });
    expect(query(tradeEmotionHref(edge, 'recoup', TODAY)).q.period).toBe('3m');
    const nextDay = new Date(2026, 10, 24, 0, 5).getTime();
    const later = query(tradeEmotionHref(edge, 'recoup', nextDay)).q;
    expect(later).toEqual({
      period: 'custom',
      from: '2026-05-25',
      to: '2026-08-24',
      emotion: 'recoup',
      via: 'trade',
    });
    // どちらの日に押しても、押した取引が一覧に入る
    const m = reviewTradesModel([edge], {
      hidden: new Set(),
      includeImports: false,
      range: (() => {
        const r = periodRange(
          parsePeriod(`?period=custom&from=${later.from}&to=${later.to}`),
          nextDay,
        );
        if (!r.ok) throw new Error(r.error);
        return { from: r.from, to: r.to };
      })(),
      filter: { kind: 'emotion', id: 'recoup' },
      instruments: INSTRUMENTS,
    });
    expect(m.rows.map((r) => r.id)).toEqual(['d7']);
  });

  it('詳細から来た印（via=trade）と期間の名前。振り返りから来た URL は印なしのまま', () => {
    expect(isFromTrade(new URL(tradeEmotionHref(T1, 'recoup', TODAY), 'https://e.x').search)).toBe(
      true,
    );
    expect(reviewTradesHref({ key: '3m', imports: false }, { kind: 'emotion', id: 'recoup' })).toBe(
      '/review/trades?period=3m&emotion=recoup',
    );
    expect(isFromTrade('?period=3m&emotion=recoup')).toBe(false);
    expect(autoPeriodLead({ key: '3m', imports: false }, true)).toBe('この取引を含む 3 か月');
    expect(
      autoPeriodLead({ key: 'custom', from: '2026-05-24', to: '2026-08-23', imports: false }, true),
    ).toBe('この取引までの 3 か月');
    // 期間を選び直した（印が外れた）・振り返りから来た・ほかの期間は名前を添えない
    expect(autoPeriodLead({ key: '3m', imports: false }, false)).toBeNull();
    expect(autoPeriodLead({ key: '1m', imports: false }, true)).toBeNull();
  });

  it('E9: 古い取引も、押した取引が行き先の一覧に入る', () => {
    const m = open(tradeEmotionHref(OLD, 'recoup', TODAY), [OLD, T1, T3]);
    expect(m.rows.map((r) => r.id)).toContain('d6');
    expect(m.rows.map((r) => r.id)).not.toContain('d1');
  });

  it('取り込んだ取引から押すと、その取引が一覧に入る（R3）', () => {
    const m = open(tradeEmotionHref(IMP, 'calm', TODAY), [IMP, T4]);
    expect(m.rows.map((r) => r.id)).toEqual(['d5', 'd4']);
  });

  it('AC-6: 行き先の範囲を読む間に送る要求は GET だけ', async () => {
    const fake = createFakeApi({ trades: [T1, T2, T3, T4], instruments: INSTRUMENTS });
    const review = createReviewController({ api: fake.api });
    const sel = parsePeriod(new URL(tradeEmotionHref(T1, 'recoup', TODAY), 'https://e.x').search);
    const range = periodRange(sel, TODAY);
    if (!range.ok) throw new Error(range.error);
    await review.load({ from: range.from, to: range.to });
    expect(review.getState().phase).toBe('ready');
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((c) => c.method === 'GET')).toBe(true);
    review.dispose();
  });
});
