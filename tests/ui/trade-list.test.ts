// 取引の一覧の月の区切りと行の形（Issue #132 AC-1・AC-2・AC-5。設計書 9.2）。値はすべて架空。時刻は端末の時間帯で作る
// （new Date(年, 月, 日, 時, 分)）ので、どの時間帯で流しても同じ結果になる
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  listRowModel,
  MISSING_INFO_ID,
  MISSING_INFO_LABEL,
  missingInfo,
  monthGroups,
  monthKeyOf,
  monthSummary,
  monthTitle,
  whenIso,
  whenText,
} from '../../ui/src/lib/trade-list';
import { missingNotes, sortTrades, tradeRow, visibleTrades } from '../../ui/src/lib/trade-view';
import { D1, INSTRUMENTS, L1, L2, L3 } from './helpers/trade-examples';

const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

/** 決済の時刻を替えた取引（ID も替える） */
const at = (t: StoredTrade, id: string, ms: number): StoredTrade => ({
  ...t,
  id,
  record: { ...t.record, exit: { ...t.record.exit, time: ms } },
});

const rowsOf = (ts: readonly StoredTrade[], hidden: ReadonlySet<string> = new Set()) =>
  sortTrades(visibleTrades(ts, hidden)).map((t) => tradeRow(t, INSTRUMENTS));

describe('whenText・monthKeyOf・monthTitle', () => {
  it('決済の時刻は「月/日 時:分」（端末の時間帯。時と分は 2 桁）', () => {
    expect(whenText(local(2026, 11, 19, 14, 5))).toBe('11/19 14:05');
    expect(whenText(local(2026, 1, 9, 9, 35))).toBe('1/9 09:35');
    // time 要素の datetime は表示と同じ時刻（#132 N2）
    expect(whenIso(local(2026, 1, 9, 9, 35))).toBe('2026-01-09T09:35');
  });

  it('月は端末の時間帯の年月（月の始まりの 00:30 は新しい月）', () => {
    const row = tradeRow(at(L1, 'a', local(2026, 11, 1, 0, 30)), INSTRUMENTS);
    expect(monthKeyOf(row)).toBe('2026-11');
    const prev = tradeRow(at(L1, 'b', local(2026, 10, 31, 23, 59)), INSTRUMENTS);
    expect(monthKeyOf(prev)).toBe('2026-10');
    expect(monthTitle('2026-11')).toBe('2026年11月');
    expect(monthTitle('2027-01')).toBe('2027年1月');
  });
});

describe('listRowModel（AC-1。ホームの詰めた行と同じ規則）', () => {
  it('R とリスクが出る行: 記号・判定の名前・時刻・「リスク 0.5%」', () => {
    const m = listRowModel(tradeRow(at(L1, 'a', local(2026, 11, 10, 9, 0)), INSTRUMENTS));
    expect(m).toEqual({
      tier: 'plan',
      symbol: 'circle',
      gradeLabel: 'A いい損失',
      when: '11/10 09:00',
      whenIso: '2026-11-10T09:00',
      rText: '−1.0R',
      rMissing: false,
      riskText: 'リスク 0.5%',
    });
  });

  it('リスクだけ出ない行は 2 段目なし、R が出ない行は「—」を 1 つだけ', () => {
    const noCapital = listRowModel(tradeRow(L2, INSTRUMENTS));
    expect(noCapital.rText).toBe('+2.0R');
    expect(noCapital.riskText).toBeNull();
    const noLc = listRowModel(tradeRow(L3, INSTRUMENTS));
    expect(noLc.rText).toBe('—');
    expect(noLc.rMissing).toBe(true);
    expect(noLc.riskText).toBeNull();
    expect(noLc.tier).toBe('break');
  });
});

describe('monthGroups（AC-2。設計書 9.2 の件数の数え方）', () => {
  // 11 月: A 2・計画どおりの勝ち 1・B 1・危ない勝ち 1 = 5 件・計画どおり 3。10 月: A 1・B 1
  const NOV = [
    at(L1, 'n1', local(2026, 11, 19, 14, 5)),
    at(L2, 'n2', local(2026, 11, 18, 10, 40)),
    at(L1, 'n3', local(2026, 11, 17, 22, 15)),
    at(D1, 'n4', local(2026, 11, 14, 16, 20)),
    at(L3, 'n5', local(2026, 11, 1, 0, 30)),
  ];
  const OCT = [at(L1, 'o1', local(2026, 10, 31, 23, 59)), at(D1, 'o2', local(2026, 10, 2))];

  it('最後まで読んだ: どの月も「N 件 · 計画どおり M」', () => {
    const g = monthGroups(rowsOf([...OCT, ...NOV]), true);
    expect(g.map((x) => [x.title, x.summary, x.complete])).toEqual([
      ['2026年11月', '5 件 · 計画どおり 3', true],
      ['2026年10月', '2 件 · 計画どおり 1', true],
    ]);
    expect(g[0]?.rows.map((r) => r.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('続きあり: いちばん古い月だけ「N 件を表示中 · 続きあり」（計画どおりの数を出さない）', () => {
    const g = monthGroups(rowsOf([...OCT, ...NOV]), false);
    expect(g.map((x) => x.summary)).toEqual(['5 件 · 計画どおり 3', '2 件を表示中 · 続きあり']);
    expect(g.map((x) => x.complete)).toEqual([true, false]);
    // 1 か月だけで続きあり → その月がそろっていない
    expect(monthGroups(rowsOf(NOV), false).map((x) => x.summary)).toEqual([
      '5 件を表示中 · 続きあり',
    ]);
  });

  it('[元に戻す] を待つ取引は行にも数にも入れない', () => {
    const g = monthGroups(rowsOf([...NOV], new Set(['n2'])), true);
    expect(g[0]?.summary).toBe('4 件 · 計画どおり 2');
  });

  it('年をまたぐ: 2027年1月 → 2026年12月', () => {
    const g = monthGroups(
      rowsOf([at(L1, 'a', local(2026, 12, 31, 23, 0)), at(L1, 'b', local(2027, 1, 1, 0, 10))]),
      true,
    );
    expect(g.map((x) => x.title)).toEqual(['2027年1月', '2026年12月']);
  });

  it('空の行 → 束なし。数の合計は行の数と同じ（性質）', () => {
    expect(monthGroups([], true)).toEqual([]);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const base = [L1, L2, L3, D1];
    for (let k = 0; k < 30; k++) {
      const n = 1 + Math.floor(rnd() * 40);
      const ts = Array.from({ length: n }, (_, i) =>
        at(
          base[Math.floor(rnd() * base.length)] as StoredTrade,
          `r${k}-${i}`,
          local(
            2026,
            1 + Math.floor(rnd() * 12),
            1 + Math.floor(rnd() * 28),
            Math.floor(rnd() * 24),
          ),
        ),
      );
      const rows = rowsOf(ts);
      for (const done of [true, false]) {
        const g = monthGroups(rows, done);
        expect(g.reduce((a, x) => a + x.count, 0)).toBe(rows.length);
        expect(g.flatMap((x) => x.rows)).toEqual(rows);
        // 月の鍵は重ならず、新しい順
        const keys = g.map((x) => x.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect([...keys].sort().reverse()).toEqual(keys);
        for (const x of g) expect(x.plan).toBeLessThanOrEqual(x.count);
        expect(g.filter((x) => !x.complete).length).toBe(done ? 0 : 1);
      }
    }
  });

  it('monthSummary の 2 つの形', () => {
    expect(monthSummary(13, 8, true)).toBe('13 件 · 計画どおり 8');
    expect(monthSummary(13, 8, false)).toBe('13 件を表示中 · 続きあり');
    expect(monthSummary(1, 0, true)).toBe('1 件 · 計画どおり 0');
  });
});

describe('missingInfo（AC-5。「—」の理由は題の行の「i」）', () => {
  it('理由が無ければ null、あれば説明のシートの中身', () => {
    expect(missingInfo([])).toBeNull();
    const notes = missingNotes(rowsOf([L1, L2, L3]));
    expect(missingInfo(notes)).toEqual({
      label: MISSING_INFO_LABEL,
      body: [
        'リスクの「—」: 資金を設定すると表示されます（1 件）',
        'R・リスクの「—」: LC が無いため表示されません（1 件）',
      ],
      id: MISSING_INFO_ID,
    });
  });
});
