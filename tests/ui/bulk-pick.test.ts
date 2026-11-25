// スクショをまとめて選ぶ（Issue #232・設計書 C67）の純関数: 選んだ順の振り分け（例 #1〜#5）と、入れ替えの相手（例 #6〜#9・#12）。
// 画像の代わりに架空の名前の文字を使う
import { describe, expect, it } from 'vitest';
import {
  bulkDroppedText,
  bulkSwapLabel,
  chartCheckOf,
  planPicks,
  swapTargetOf,
} from '../../ui/src/lib/bulk-pick';
import { CHART_READ_MSG } from '../../ui/src/lib/chart-read';
import { READ_MSG } from '../../ui/src/lib/statement-fill';

const FREE = { taken: { entry: false, exit: false }, extrasFree: 5 } as const;

describe('選んだ順の振り分け（例 #1〜#5）', () => {
  it('#1: 明細 A・チャート P・R → 明細 A・エントリー時 P・決済時 R', () => {
    expect(planPicks(['A', 'P', 'R'], FREE)).toEqual({
      statement: 'A',
      charts: [
        { target: { kind: 'main', slot: 'entry' }, file: 'P' },
        { target: { kind: 'main', slot: 'exit' }, file: 'R' },
      ],
      dropped: 0,
    });
  });

  it('#2: 1 枚だけ → 明細だけ', () => {
    expect(planPicks(['A'], FREE)).toEqual({ statement: 'A', charts: [], dropped: 0 });
  });

  it('#3: エントリー時に前からチャートがある → 2 枚目は決済時へ（前のチャートはそのまま）', () => {
    const plan = planPicks(['A', 'P'], { taken: { entry: true, exit: false }, extrasFree: 5 });
    expect(plan.charts).toEqual([{ target: { kind: 'main', slot: 'exit' }, file: 'P' }]);
    expect(plan.dropped).toBe(0);
  });

  it('#4: 4 枚目は追加のチャートへ', () => {
    const plan = planPicks(['A', 'P', 'R', 'S'], FREE);
    expect(plan.charts.map((c) => c.target)).toEqual([
      { kind: 'main', slot: 'entry' },
      { kind: 'main', slot: 'exit' },
      { kind: 'extra' },
    ]);
    expect(plan.charts[2]?.file).toBe('S');
  });

  it('#5: 9 枚 → 明細 1・2 枠・追加 5、残り 1 枚は入れない', () => {
    const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const plan = planPicks(files, FREE);
    expect(plan.statement).toBe('A');
    expect(plan.charts).toHaveLength(7);
    expect(plan.charts.filter((c) => c.target.kind === 'extra')).toHaveLength(5);
    expect(plan.dropped).toBe(1);
    expect(bulkDroppedText(plan.dropped)).toBe(
      '選んだ画像のうち 1 枚は入れていません（チャートは 7 枚までです）。',
    );
  });

  it('0 枚 → 何もしない。枠が埋まっていて追加も足せなければ、2 枚目からは入れない', () => {
    expect(planPicks([], FREE)).toEqual({ statement: null, charts: [], dropped: 0 });
    expect(
      planPicks(['A', 'P', 'R'], { taken: { entry: true, exit: true }, extrasFree: 0 }),
    ).toEqual({ statement: 'A', charts: [], dropped: 2 });
  });

  it('性質: どの枚数・空きでも、明細 1 + 入れた枚数 + 入れなかった枚数 = 選んだ枚数で、選んだ順を保つ', () => {
    for (let n = 0; n <= 10; n++) {
      for (const entry of [false, true]) {
        for (const exit of [false, true]) {
          for (let free = 0; free <= 5; free++) {
            const files = Array.from({ length: n }, (_, i) => i);
            const plan = planPicks(files, { taken: { entry, exit }, extrasFree: free });
            const used = (plan.statement === null ? 0 : 1) + plan.charts.length + plan.dropped;
            expect(used).toBe(n);
            expect(plan.charts.map((c) => c.file)).toEqual(files.slice(1, 1 + plan.charts.length));
            const mains = plan.charts.filter((c) => c.target.kind === 'main');
            expect(mains.some((c) => c.target.kind === 'main' && c.target.slot === 'entry')).toBe(
              !entry && n >= 2,
            );
          }
        }
      }
    }
  });
});

const notStatement = { phase: 'failed', message: READ_MSG.notStatement } as const;
const chartOk = { phase: 'ready', read: 'done', readNote: null } as const;
const notChart = { phase: 'ready', read: 'done', readNote: CHART_READ_MSG.notChart } as const;
const unknown = { phase: 'ready', read: 'done', readNote: CHART_READ_MSG.unavailable } as const;
const reading = { phase: 'ready', read: 'reading' } as const;

describe('入れ替えの相手（例 #6〜#9・#12）', () => {
  it('#6: 明細が読めない・エントリー時がチャートでない → エントリー時', () => {
    expect(
      swapTargetOf({ statement: notStatement, charts: { entry: notChart }, slots: ['entry'] }),
    ).toBe('entry');
  });

  it('#7: 明細が読めない・エントリー時はチャート・決済時がチャートでない → 決済時', () => {
    expect(
      swapTargetOf({
        statement: notStatement,
        charts: { entry: chartOk, exit: notChart },
        slots: ['entry', 'exit'],
      }),
    ).toBe('exit');
  });

  it('#8: 明細が読めた → 出さない', () => {
    expect(
      swapTargetOf({
        statement: { phase: 'ready' },
        charts: { entry: notChart },
        slots: ['entry'],
      }),
    ).toBeNull();
  });

  it('#9: 明細が読めない・チャートはどれもチャートと読めた → 出さない', () => {
    expect(
      swapTargetOf({ statement: notStatement, charts: { entry: chartOk }, slots: ['entry'] }),
    ).toBeNull();
  });

  it('#12: 明細が上限で失敗（読めないとは分からない） → 出さない', () => {
    expect(
      swapTargetOf({
        statement: { phase: 'failed', message: READ_MSG.limited },
        charts: { entry: notChart },
        slots: ['entry'],
      }),
    ).toBeNull();
  });

  it('チャートでない枠が無ければ、読み取り中の枠を待ち、終われば確かめられなかった最初の枠', () => {
    const base = { statement: notStatement, slots: ['entry', 'exit'] as const };
    expect(swapTargetOf({ ...base, charts: { entry: unknown, exit: reading } })).toBeNull();
    expect(swapTargetOf({ ...base, charts: { entry: unknown, exit: chartOk } })).toBe('entry');
    // 読み取り中でも、チャートでないと分かった枠があればそれ
    expect(swapTargetOf({ ...base, charts: { entry: reading, exit: notChart } })).toBe('exit');
  });

  it('組から外れた枠（本人が差し替えた・消した）は相手にしない', () => {
    expect(
      swapTargetOf({ statement: notStatement, charts: { entry: notChart }, slots: [] }),
    ).toBeNull();
    expect(swapTargetOf({ statement: notStatement, charts: {}, slots: ['entry'] })).toBeNull();
  });

  it('枠の状態の見分け', () => {
    expect(chartCheckOf(undefined)).toBeNull();
    expect(chartCheckOf({ phase: 'failed' })).toBeNull();
    expect(chartCheckOf({ phase: 'preparing' })).toBe('pending');
    expect(chartCheckOf(reading)).toBe('pending');
    expect(chartCheckOf(chartOk)).toBe('chart');
    expect(chartCheckOf(notChart)).toBe('notChart');
    expect(chartCheckOf(unknown)).toBe('unknown');
    expect(chartCheckOf({ ...chartOk, readNote: CHART_READ_MSG.noTimeframe })).toBe('unknown');
    expect(bulkSwapLabel('エントリー時')).toBe('明細とエントリー時のチャートを入れ替える');
  });
});
