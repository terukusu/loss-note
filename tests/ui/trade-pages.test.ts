// 取引の一覧のページ分けの純関数（Issue #87・ADR-0016）。値はすべて架空
import { describe, expect, it } from 'vitest';
import {
  appendTrades,
  countText,
  endText,
  HOME_LIMIT,
  LIST_PAGE,
  notesWhileLoading,
  pageOf,
  REFRESH_PAGE,
  tradesPath,
} from '../../ui/src/lib/trade-pages';
import { L1, L2, L3 } from './helpers/trade-examples';

describe('tradesPath', () => {
  it('件数・カーソル・並び（決済の順は order を省く）', () => {
    expect(tradesPath({ limit: 50 })).toBe('/api/trades?limit=50');
    expect(tradesPath({ limit: 50, cursor: 'abc-_D' })).toBe('/api/trades?limit=50&cursor=abc-_D');
    expect(tradesPath({ limit: 1, order: 'created' })).toBe('/api/trades?order=created&limit=1');
    expect(tradesPath({ limit: 5, cursor: null })).toBe('/api/trades?limit=5');
  });

  it('カーソルの文字はパラメータとして符号化する（ほかのパラメータを足せない）', () => {
    expect(tradesPath({ limit: 5, cursor: 'a&order=created' })).toBe(
      '/api/trades?limit=5&cursor=a%26order%3Dcreated',
    );
  });

  it('件数の定数は API の上限（100）の中', () => {
    for (const n of [LIST_PAGE, HOME_LIMIT, REFRESH_PAGE]) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(100);
    }
    expect(HOME_LIMIT).toBeGreaterThanOrEqual(5);
  });
});

describe('pageOf', () => {
  it('items の配列と next（文字 / null）だけを受ける', () => {
    expect(pageOf({ items: [L1], next: 'x' })).toEqual({ items: [L1], next: 'x' });
    expect(pageOf({ items: [], next: null })).toEqual({ items: [], next: null });
    for (const bad of [
      null,
      'x',
      { items: 'x', next: null },
      { items: [] },
      { items: [], next: '' },
      { items: [], next: 3 },
    ]) {
      expect(pageOf(bad)).toBeNull();
    }
  });
});

describe('appendTrades', () => {
  it('次のページを後ろに足し、同じ ID は重ねずに新しい方で置き換える（位置は前のまま）', () => {
    const l1b = { ...L1, updatedAt: L1.updatedAt + 1 };
    const out = appendTrades([L1, L2], [l1b, L3]);
    expect(out.map((t) => t.id)).toEqual(['l1', 'l2', 'l3']);
    expect(out[0]).toBe(l1b);
    expect(appendTrades([], [L1])).toEqual([L1]);
  });
});

describe('countText・endText・notesWhileLoading', () => {
  it('途中は「N 件を表示中（…・続きあり）」、最後まで読んだら「全 N 件」', () => {
    expect(countText(50, false)).toBe('50 件を表示中（決済の新しい順・続きあり）');
    expect(countText(120, true)).toBe('全 120 件（決済の新しい順）');
    expect(endText(120)).toBe('全 120 件を表示しました');
  });

  it('続きがある間の脚注は件数の括弧を外す（理由の文は変えない）', () => {
    expect(
      notesWhileLoading([
        'リスクの「—」: 資金を設定すると出ます（50 件）',
        'R・リスクの「—」: LC が無いので出ません（1 件）',
      ]),
    ).toEqual(['リスクの「—」: 資金を設定すると出ます', 'R・リスクの「—」: LC が無いので出ません']);
  });
});
