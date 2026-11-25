// 取引の詳細・編集の 1 画面の形の純関数（#131。設計書 9.2・9.3）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  chartCaption,
  commentHref,
  commentOf,
  commentPreview,
  detailActions,
  fieldsHref,
  WHY_HINT,
  whyCardModel,
} from '../../ui/src/lib/detail-view';
import { editValuesNote, editVerdictLine } from '../../ui/src/lib/edit-screen';
import { readDraft } from '../../ui/src/lib/record-form';
import { chartSlotLine, miniChartId } from '../../ui/src/lib/record-screen';
import { reflectionCardSides } from '../../ui/src/lib/reflection';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { createFakeApi } from './helpers/fake-api';
import { CAPITAL_1M, E1 as E1_DRAFT } from './helpers/record-drafts';
import { fakePreview } from './helpers/statement-rows';
import { D1, L1 } from './helpers/trade-examples';

describe('詳細の操作のシート・チャートの名前・次の画面（#131）', () => {
  it('操作のシートの行: 違う値があれば「今の値と比べる」→「削除」、無ければ「削除」だけ', () => {
    expect(detailActions(true)).toEqual(['compare', 'delete']);
    expect(detailActions(false)).toEqual(['delete']);
  });

  it('チャートの枠の名前は「名前 · 時間足」。追加のチャートは一言を名前に。時間足が無ければ名前だけ', () => {
    expect(
      chartCaption({ slot: 'entry', name: 'エントリー時', has: true, timeframe: '4 時間足' }),
    ).toBe('エントリー時 · 4 時間足');
    expect(chartCaption({ slot: 'exit', name: '決済時', has: true, timeframe: null })).toBe(
      '決済時',
    );
    expect(
      chartCaption({ slot: 'x1', name: '追加 1', has: true, timeframe: '日足', note: '上位足' }),
    ).toBe('上位足 · 日足');
  });

  it('総評は空・空白だけなら null（行を出さない）', () => {
    const withReview = (review?: string) => ({
      ...D1,
      record: {
        ...D1.record,
        exit: { ...D1.record.exit, ...(review === undefined ? {} : { review }) },
      },
    });
    expect(commentOf(withReview())).toBeNull();
    expect(commentOf(withReview('  '))).toBeNull();
    expect(commentOf(withReview(' 【取り込み】元の判定 A '))).toBe('【取り込み】元の判定 A');
    expect(fieldsHref('a')).toBe('/trades/a/fields');
    expect(commentHref('a')).toBe('/trades/a/comment');
  });

  it('次の画面の controller はチャートを読まない（charts: false。GET は取引・銘柄・口座だけ）', async () => {
    const fake = createFakeApi({ trades: [D1] });
    const c = createTradeDetailController({
      api: fake.api,
      id: D1.id,
      charts: false,
      preview: async () => fakePreview(),
    });
    await c.load();
    expect(c.getState().phase).toBe('ready');
    expect(fake.calls.some((x) => x.path.includes('/charts/'))).toBe(false);
    await c.reloadChart('entry');
    expect(fake.calls.some((x) => x.path.includes('/charts/'))).toBe(false);
  });
});

describe('編集の 1 画面（#131）', () => {
  it('小さなチャートの枠: 変えた枠の印を時間足より先に。id は接頭辞つき', () => {
    const base = {
      hasChart: true,
      preparing: false,
      reading: true,
      failed: false,
      timeframe: '4 時間足',
      suggest: '日足',
    };
    expect(chartSlotLine({ ...base, change: '差し替え済み' })).toBe('差し替え済み');
    expect(chartSlotLine({ ...base, change: null })).toBe('時間足を読み取り中…');
    expect(chartSlotLine({ ...base, preparing: true, change: '追加（未保存）' })).toBe(
      '準備しています…',
    );
    expect(miniChartId('entry')).toBe('record-mini-entry');
    expect(miniChartId('exit', 'edit')).toBe('edit-mini-exit');
  });

  it('判定の 1 行は編集のプレビュー（写した値・今の値）で出す', () => {
    const read = readDraft(E1_DRAFT, CAPITAL_1M);
    const line = editVerdictLine(read, read.preview, []);
    expect(line.kind).toBe('judged');
    // プレビューを差し替えると、その判定（読みのプレビューではない）
    const { judgment: _j, ...noJudgment } = read.preview;
    const other = editVerdictLine(read, noJudgment, []);
    expect(other.kind).toBe('status');
  });

  it('判定のシートの 1 行（どの値で計算しているか）', () => {
    expect(editValuesNote(false)).toBe(
      '資金・許容リスクと銘柄の値は、記録したときの値で計算します。',
    );
    expect(editValuesNote(true)).toContain('今の値で計算しています');
  });
});

describe('#248: 詳細の「なぜ」のカードの形（C69。例は Issue の W1〜W8・値は架空）', () => {
  const none = { emotions: 0, reflection: false };
  const some = { emotions: 1, reflection: true };

  it('AC-2: 題は判定の段（計画どおり = なぜ守れたか / 崩れ・極悪 = なぜ崩れたか / 判定なし = 心理と振り返り）', () => {
    const title = (g: Parameters<typeof whyCardModel>[1]) => whyCardModel(L1, g, some).title;
    // W1 = B・W3 = 危ない勝ち・W4 = C
    expect([title('B'), title('riskyWin'), title('C')]).toEqual([
      'なぜ崩れたか',
      'なぜ崩れたか',
      'なぜ崩れたか',
    ]);
    // W2 = A・W7 = 計画どおりの勝ち
    expect([title('A'), title('safeWin')]).toEqual(['なぜ守れたか', 'なぜ守れたか']);
    // W6 = 判定なし
    expect(title(null)).toBe('心理と振り返り');
  });

  it('AC-3: Good / More を More → Good にするのは崩れ・極悪だけ', () => {
    const order = (g: Parameters<typeof whyCardModel>[1]) => whyCardModel(L1, g, some).moreFirst;
    expect([order('B'), order('riskyWin'), order('C')]).toEqual([true, true, true]);
    expect([order('A'), order('safeWin'), order(null)]).toEqual([false, false, false]);
    const r = {
      good: { topics: ['readRight' as const], notes: [] },
      more: { topics: ['enteredEarly' as const], notes: [] },
    };
    expect(reflectionCardSides(r, { moreFirst: true }).map((x) => x.name)).toEqual([
      'More',
      'Good',
    ]);
    expect(reflectionCardSides(r).map((x) => x.name)).toEqual(['Good', 'More']);
    // 中身の無い側は今のとおり出さない（W3: Good だけ）
    const goodOnly = { ...r, more: { topics: [], notes: [] } };
    expect(reflectionCardSides(goodOnly, { moreFirst: true }).map((x) => x.name)).toEqual(['Good']);
  });

  it('AC-4: 案内の 1 行は崩れ・極悪で、心理も Good / More も無く、取り込みでないときだけ', () => {
    // W4: C・何も無い・手で記録 → 出る
    expect(whyCardModel(L1, 'C', none).hint).toBe(WHY_HINT);
    expect(whyCardModel(L1, 'B', none).hint).toBe(WHY_HINT);
    // W1: B・心理と Good / More あり → 出ない。心理だけ・Good / More だけでも出ない
    expect(whyCardModel(L1, 'B', some).hint).toBeNull();
    expect(whyCardModel(L1, 'B', { emotions: 2, reflection: false }).hint).toBeNull();
    expect(whyCardModel(L1, 'riskyWin', { emotions: 0, reflection: true }).hint).toBeNull();
    // W7: 計画どおりの勝ち・何も無い → 出ない（計画どおりの取引に入力を促さない）。判定なしも出ない
    expect(whyCardModel(L1, 'safeWin', none).hint).toBeNull();
    expect(whyCardModel(L1, null, none).hint).toBeNull();
    // W5: C・取り込み → 出ない（振り返りは既定で取り込みを数えない）
    const imported = { ...L1, record: { ...L1.record, source: 'import' as const } };
    expect(whyCardModel(imported, 'C', none).hint).toBeNull();
  });

  it('AC-5: 総評の添えは空の行を飛ばした最初の行。総評が無ければ行を出さない', () => {
    const withReview = (review: string) => ({
      ...L1,
      record: { ...L1.record, exit: { ...L1.record.exit, review } },
    });
    // W5
    expect(whyCardModel(withReview('【取り込み】元の判定 C'), 'C', none).comment).toEqual({
      preview: '【取り込み】元の判定 C',
    });
    // W8
    expect(
      whyCardModel(withReview('\n  \n架空の 1 行目\r\n架空の 2 行目'), 'A', none).comment,
    ).toEqual({ preview: '架空の 1 行目' });
    // W1: 総評なし・空白だけ
    expect(whyCardModel(L1, 'B', some).comment).toBeNull();
    expect(whyCardModel(withReview(' \n '), 'B', some).comment).toBeNull();
    expect(commentPreview('  前後の空白  \n次')).toBe('前後の空白');
    expect(commentPreview('\n\n')).toBeNull();
  });
});
