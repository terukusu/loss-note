import { describe, expect, it } from 'vitest';
import { RECORD_STATES } from '../../scripts/ui-check/record-states.mjs';
import {
  coverageErrors,
  recordUnitOf,
  reviewUnitOf,
  UNIT_IDS,
  unitOfPath,
  unitsForChanges,
} from '../../scripts/ui-check/units.mjs';

/**
 * 画面の検査の単位への振り分け（#226）。全部の状態がちょうど 1 つの単位に入り、変えたファイルから流す単位が決まる
 */
describe('画面の検査の単位', () => {
  it('どの画面・状態も、ちょうど 1 つの知っている単位に入る', () => {
    expect(coverageErrors()).toEqual([]);
  });

  it('単位に振り分けていない状態を足すと、その名前が誤りに出る', () => {
    RECORD_STATES.push({ slug: 'record-99-new', name: '足した状態' });
    try {
      expect(coverageErrors()).toEqual([
        '記録する画面の状態 record-99-new の単位が無い（units.mjs の RECORD_UNIT）',
      ]);
    } finally {
      RECORD_STATES.pop();
    }
    expect(coverageErrors()).toEqual([]);
  });

  it('画面のパスから単位が決まる', () => {
    expect(unitOfPath('/')).toBe('home');
    expect(unitOfPath('/record')).toBe('record');
    expect(unitOfPath('/trades/x-d1')).toBe('detail');
    expect(unitOfPath('/trades/x-d1/edit')).toBe('edit');
    expect(unitOfPath('/review?period=7d')).toBe('review');
    expect(unitOfPath('/review/table?period=7d')).toBe('review-more');
    expect(unitOfPath('/settings/accounts')).toBe('settings-accounts');
    expect(unitOfPath('/settings/ai-usage')).toBe('settings');
    expect(unitOfPath('/no-such')).toBeNull();
  });

  it('状態の slug から単位が決まり、知らない slug は null', () => {
    expect(recordUnitOf('record-8-read')).toBe('record-read');
    expect(recordUnitOf('record-11-info-tap')).toBe('sheets');
    expect(recordUnitOf('record-no-such')).toBeNull();
    expect(reviewUnitOf('review-7d')).toBe('review');
    expect(reviewUnitOf('review-info')).toBe('review-more');
    expect(reviewUnitOf('review-insight')).toBe('review-insight');
    expect(reviewUnitOf('review-trades')).toBe('review-insight');
    expect(reviewUnitOf('review-no-such')).toBeNull();
  });

  it('変えたファイルから流す単位を選ぶ', () => {
    // 明細の時間帯の純関数 → 明細の単位だけ
    expect(unitsForChanges(['ui/src/lib/statement-tz.ts'])).toEqual({
      units: ['record-read', 'record-rows'],
      allBy: [],
    });
    // 振り返りの画面 → 振り返りの 3 つとホーム
    expect(unitsForChanges(['ui/src/pages/Review.tsx']).units).toEqual([
      'home',
      'review',
      'review-more',
      'review-insight',
    ]);
    // 設定の状態の一覧 → 設定の 2 つの単位（口座・銘柄の状態も入っている）
    expect(unitsForChanges(['scripts/ui-check/settings-states.mjs']).units).toEqual([
      'settings',
      'settings-accounts',
    ]);
    // レッグの部品 → オプションの手順と、レッグの画面を測る記録する・詳細・編集の単位
    expect(unitsForChanges(['ui/src/components/LegList.tsx']).units).toEqual([
      'detail',
      'edit',
      'record',
      'option',
    ]);
    // 単位のファイル → その単位
    expect(unitsForChanges(['scripts/ui-check/screens/trades.mjs']).units).toEqual(['trades']);
    // API・文書だけ → 流す単位なし
    expect(unitsForChanges(['api/src/loss_note_api/routes.py', 'docs/design.md']).units).toEqual(
      [],
    );
  });

  it('共有の部品・トークン・検査の共有のファイル・どの規則にも当たらない画面のソースは全部の単位', () => {
    for (const f of [
      'ui/src/styles/tokens.css',
      'ui/src/components/Button.tsx',
      'ui/src/layout/Shell.tsx',
      'core/judge.ts',
      'scripts/ui-check/base.mjs',
      'scripts/ui-check.mjs',
    ]) {
      const got = unitsForChanges([f]);
      expect(got.units, f).toEqual(UNIT_IDS);
      expect(got.allBy, f).toEqual([f]);
    }
  });
});
