// 取引の詳細・編集の 1 画面の形の純関数（#131。設計書 9.2・9.3）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  chartCaption,
  commentHref,
  commentOf,
  detailActions,
  fieldsHref,
} from '../../ui/src/lib/detail-view';
import { editValuesNote, editVerdictLine } from '../../ui/src/lib/edit-screen';
import { readDraft } from '../../ui/src/lib/record-form';
import { chartSlotLine, miniChartId } from '../../ui/src/lib/record-screen';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { createFakeApi } from './helpers/fake-api';
import { CAPITAL_1M, E1 as E1_DRAFT } from './helpers/record-drafts';
import { fakePreview } from './helpers/statement-rows';
import { D1 } from './helpers/trade-examples';

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
