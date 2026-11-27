// ホームの規律の振り返りの表示の形（Issue #88 契約 P-3・例の表 S1〜S7・AC-5〜AC-7）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { periodRange } from '../../ui/src/lib/period';
import {
  NO_CURVE,
  NO_GAP,
  REVIEW_EMPTY,
  REVIEW_ONLY_IMPORTS,
  reviewItemOf,
  reviewModel,
  reviewModelFor,
  TRUNCATED,
} from '../../ui/src/lib/review-view';
import { exitAt, REVIEW_NOW, S1, S2, S4_IMPORTS, S5, S6 } from './helpers/review-examples';
import { INSTRUMENTS } from './helpers/trade-examples';

const NONE: ReadonlySet<string> = new Set();
const model = (
  trades: Parameters<typeof reviewModel>[0],
  over: Partial<Parameters<typeof reviewModel>[1]> = {},
) =>
  reviewModel(trades, {
    hidden: NONE,
    includeImports: false,
    instruments: INSTRUMENTS,
    now: REVIEW_NOW,
    ...over,
  });

describe('reviewItemOf: 一覧と同じ判定の計算', () => {
  it('S1 の 7 件の判定と R（手で計算した値: (決済 − 100) ÷ 0.5）', () => {
    const items = S1.map(reviewItemOf);
    expect(items.map((i) => i.grade)).toEqual([
      'A',
      'safeWin',
      'B',
      'riskyWin',
      'C',
      'A',
      'safeWin',
    ]);
    const rs = items.map((i) => (i.r === undefined ? null : Math.round(i.r * 1e9) / 1e9));
    expect(rs).toEqual([-1, 2, -1.6, 0.5, null, -0.8, 1.2]);
    expect(items.every((i) => !i.imported)).toBe(true);
  });

  it('取り込みの印・S5・S6 の判定', () => {
    expect(S4_IMPORTS.map(reviewItemOf).map((i) => [i.grade, i.imported])).toEqual([
      ['A', true],
      ['B', true],
    ]);
    expect(reviewItemOf(S5)).toMatchObject({ grade: 'B' });
    expect(reviewItemOf(S5).r).toBeCloseTo(-0.5, 12);
    expect(reviewItemOf(S6)).toMatchObject({ grade: 'B' });
    expect(reviewItemOf(S6).r).toBeCloseTo(-1.25, 12);
  });
});

describe('reviewModel: 例の表', () => {
  it('S1（AC-5）: 57%・4 / 7 件・内訳・−0.6R・守っていれば +0.9R（実際 +0.3R）・運・R なし', () => {
    const m = model(S1);
    expect(m.empty).toBe(false);
    expect(m.countText).toBe('7 件');
    expect(m.rateText).toBe('57%');
    expect(m.rateCountText).toBe('4 / 7 件');
    expect(m.costText).toBe('−0.6R');
    expect(m.headline).toEqual({ kind: 'gap', lead: '崩れで', value: '−0.6R' });
    expect(m.subline).toBe('守っていれば +0.9R · 実際 +0.3R');
    expect(m.legend.map((l) => [l.label, l.count, l.tier])).toEqual([
      ['A いい損失', 2, 'plan'],
      ['計画どおりの勝ち', 2, 'plan'],
      ['B 悪い損失', 1, 'break'],
      ['危ない勝ち', 1, 'break'],
      ['C 極悪な損失', 1, 'worst'],
    ]);
    expect(m.luckText).toBe('危ない勝ち 1 件 +0.5R は運です');
    expect(m.noRText).toBe('LC が無い 1 件は曲線に入れていません');
    expect(m.imports).toBeNull();
    expect(m.importsNote).toBeNull();
    // 内訳の帯: 判定の順に並び、幅の和は 1
    expect(m.bar.map((b) => b.key)).toEqual(['A', 'safeWin', 'B', 'riskyWin', 'C']);
    expect(m.bar.reduce((s, b) => s + b.width, 0)).toBeCloseTo(1, 12);
    expect(m.bar[2]?.x).toBeCloseTo(4 / 7, 12);
  });

  it('S1 の「数で見る」の行（AC-10 の中身）: R の出た 6 件・日付・銘柄・判定・R・2 つの累積', () => {
    const m = model(S1);
    expect(m.rows.map((r) => [r.gradeLabel, r.rText, r.actualCumText, r.plannedCumText])).toEqual([
      ['A いい損失', '−1.0R', '−1.0R', '−1.0R'],
      ['計画どおりの勝ち', '+2.0R', '+1.0R', '+1.0R'],
      ['B 悪い損失', '−1.6R', '−0.6R', '±0.0R'],
      ['危ない勝ち', '+0.5R', '−0.1R', '+0.5R'],
      ['A いい損失', '−0.8R', '−0.9R', '−0.3R'],
      ['計画どおりの勝ち', '+1.2R', '+0.3R', '+0.9R'],
    ]);
    expect(m.rows[0]?.dateText).toBe('11/13');
    expect(m.rows.map((r) => r.gapText)).toEqual([
      '±0.0R',
      '±0.0R',
      '−0.6R',
      '−0.6R',
      '−0.6R',
      '−0.6R',
    ]);
    expect(m.curveDates).toEqual({ first: '11/13', last: '11/19' });
    expect(m.rows[0]?.instrumentName).toBe('US30');
    expect(m.rows.map((r) => r.id)).not.toContain('s1-5');
  });

  it('S2: 判定の出た取引が 3 件 → 率は出さず「件数が少ない」「あと 2 件で表示されます（判定の出た取引 3 件）」。内訳と曲線は出す', () => {
    const m = model(S2);
    expect(m.rateText).toBeNull();
    expect(m.rateMissingText).toBe('件数が少ない');
    expect(m.rateCountText).toBe('あと 2 件で表示されます（判定の出た取引 3 件）');
    expect(m.legend.map((l) => [l.label, l.count])).toEqual([
      ['A いい損失', 1],
      ['B 悪い損失', 2],
    ]);
    expect(m.curve).toHaveLength(3);
  });

  it('S3: 0 件 → 空の文。取り込みだけの期間は書き分けて切り替えを出す', () => {
    const m = model([]);
    expect(m.empty).toBe(true);
    expect(m.emptyText).toBe(REVIEW_EMPTY);
    expect(REVIEW_EMPTY).toBe('この期間に決済した取引はありません');
    expect(m.imports).toBeNull();
    const only = model(S4_IMPORTS);
    expect(only.empty).toBe(true);
    expect(only.emptyText).toBe(REVIEW_ONLY_IMPORTS);
    expect(only.imports?.count).toBe(2);
    expect(model(S4_IMPORTS, { includeImports: true }).empty).toBe(false);
  });

  it('S4（AC-7）: 既定は S1 と同じで「取り込んだ取引 2 件は集計に含めていません」、含めると 9 件・56%（5 / 9 件）', () => {
    const off = model([...S1, ...S4_IMPORTS]);
    expect([off.countText, off.rateText, off.rateCountText]).toEqual(['7 件', '57%', '4 / 7 件']);
    expect(off.importsNote).toBe('取り込んだ取引 2 件は集計に含めていません');
    expect(off.imports).toEqual({
      count: 2,
      include: false,
      stateText: '取り込んだ取引 2 件は集計に含めていません',
    });
    const on = model([...S1, ...S4_IMPORTS], { includeImports: true });
    expect([on.countText, on.rateText, on.rateCountText]).toEqual(['9 件', '56%', '5 / 9 件']);
    expect(on.importsNote).toBeNull();
    expect(on.imports).toEqual({
      count: 2,
      include: true,
      stateText: '取り込んだ取引 2 件を含めています',
    });
  });

  it('S5: B −0.5R → 規律コスト ±0.0R、守っていれば −0.5R', () => {
    const m = model([S5]);
    expect(m.costText).toBe('±0.0R');
    expect(m.subline).toBe('守っていれば −0.5R · 実際 −0.5R');
    // C も無い期間の差 0 は「崩れなし ±0.0R」
    expect(m.headline).toEqual({ kind: 'none', lead: '崩れなし', value: '±0.0R' });
  });

  it('S6: B −1.25R → 規律コスト −0.3R（0 から遠い側に丸める）', () => {
    const m = model([S6]);
    expect(m.costText).toBe('−0.3R');
    expect(m.subline).toBe('守っていれば −1.0R · 実際 −1.3R');
    expect(m.headline).toEqual({ kind: 'gap', lead: '崩れで', value: '−0.3R' });
  });

  it('S7: S1 の 3 番を消して [元に戻す] を待つ間 → 6 件・67%（4 / 6 件）・規律コスト ±0.0R', () => {
    const m = model(S1, { hidden: new Set(['s1-3']) });
    expect([m.countText, m.rateText, m.rateCountText, m.costText]).toEqual([
      '6 件',
      '67%',
      '4 / 6 件',
      '±0.0R',
    ]);
  });

  it('範囲の外の取引は落とす（範囲を知らない古い API が全件を返したとき）', () => {
    const m = model(S1, { range: { from: exitAt(0), to: exitAt(2) } });
    expect(m.countText).toBe('2 件');
    // 境目: 開始ちょうどは入り、終了ちょうどは入らない
    expect(model(S1, { range: { from: exitAt(0), to: exitAt(0) + 1 } }).countText).toBe('1 件');
  });

  it('R の出る取引が無ければ曲線の点も行も無い', () => {
    const noR = model([S1[4] as (typeof S1)[number]]);
    expect(noR.curve).toEqual([]);
    expect(noR.rows).toEqual([]);
    expect(noR.noRText).toBe('LC が無い 1 件は曲線に入れていません');
    expect(noR.headline).toBeNull();
    expect(NO_CURVE).toBe('R が出る取引がありません');
  });
});

describe('reviewModelFor: 読み終えた範囲と今の期間', () => {
  const sel = { key: '7d' as const, imports: false };
  const range = periodRange(sel, REVIEW_NOW);
  const r7 = range.ok ? { from: range.from, to: range.to } : { from: 0, to: 1 };
  const opts = { hidden: NONE, includeImports: false, instruments: INSTRUMENTS, now: REVIEW_NOW };

  it('同じ範囲なら表示の形、違う範囲（期間を変えた直後）・読み込み中・期間の誤りは null（前の件数を出さない）', () => {
    const ready = { phase: 'ready' as const, range: r7, trades: S1, truncated: false };
    expect(reviewModelFor(ready, range, opts)?.countText).toBe('7 件');
    const other = periodRange({ key: '1d', imports: false }, REVIEW_NOW);
    expect(reviewModelFor(ready, other, opts)).toBeNull();
    expect(reviewModelFor({ phase: 'loading', range: r7 }, range, opts)).toBeNull();
    expect(
      reviewModelFor(ready, { ok: false, error: '開始日と終了日を選んでください' }, opts),
    ).toBeNull();
  });

  it('C44: 件数の上限で切れた応答は 1 行の注記', () => {
    const cut = { phase: 'ready' as const, range: r7, trades: S1, truncated: true };
    expect(reviewModelFor(cut, range, opts)?.truncatedText).toBe(TRUNCATED);
    expect(TRUNCATED).toBe('期間の取引が多いので先頭の 2,000 件で集計しています');
    const whole = { phase: 'ready' as const, range: r7, trades: S1, truncated: false };
    expect(reviewModelFor(whole, range, opts)?.truncatedText).toBeNull();
  });
});

describe('差が無い期間', () => {
  it('差 0 の書き分け: C（曲線の外）があれば「R で測れる崩れ」、無ければ「崩れなし」', () => {
    // S7: 差は 0 だが LC の無い C（曲線の外）がある → 「崩れなし」と言い切らない（R で測れる崩れ ±0.0R）
    const s7 = model(S1, { hidden: new Set(['s1-3']) });
    expect(s7.noGapText).toBeNull();
    expect(s7.headline).toEqual({ kind: 'measured', lead: 'R で測れる崩れ', value: '±0.0R' });
    // C も除くと「崩れなし」
    const clean = model(S1, { hidden: new Set(['s1-3', 's1-5']) });
    expect(clean.noGapText).toBe(NO_GAP);
    expect(clean.headline?.kind).toBe('none');
    expect(model(S1).noGapText).toBeNull();
    expect(model([]).noGapText).toBeNull();
  });
});
