// 取引の一覧・ホーム・詳細の表示の形（Issue #9 契約 P-1・AC-1・AC-7）。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { AccountRecord, StoredTrade } from '../../core/record';
import { formatDate, formatDateTime } from '../../ui/src/lib/datetime';
import { RISK_NOTE, summarize } from '../../ui/src/lib/record-form';
import {
  chartSlots,
  detailHeading,
  MISSING,
  missingNotes,
  RECENT_COUNT,
  recentRows,
  recordFields,
  shortLabel,
  sortTrades,
  tapAnswers,
  timeframeChangeText,
  timeframeNote,
  tradeRow,
  UNKNOWN_INSTRUMENT,
  visibleTrades,
} from '../../ui/src/lib/trade-view';
import { account } from './helpers/accounts';
import {
  D1,
  D2,
  E2,
  H1,
  INSTRUMENTS,
  L1,
  L2,
  L3,
  SNAP_1M,
  stored,
  T_1110,
} from './helpers/trade-examples';

/** 種つきの乱数（mulberry32） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('AC-1: 一覧の行（例 L1〜L4）', () => {
  it('L4: 並びは L2 → L3 → L1（決済の時刻の新しい順）', () => {
    expect(sortTrades([L1, L2, L3]).map((t) => t.id)).toEqual(['l2', 'l3', 'l1']);
    expect(sortTrades([L3, L1, L2]).map((t) => t.id)).toEqual(['l2', 'l3', 'l1']);
  });

  it('L1: A いい損失・−1.0R・0.5%', () => {
    const r = tradeRow(L1, INSTRUMENTS);
    expect(r.badge.label).toBe('A いい損失');
    expect(r.badge.tier).toBe('plan');
    expect(r.rText).toBe('−1.0R');
    expect(r.riskText).toBe('0.5%');
    expect(r.rNote).toBeNull();
    expect(r.riskNote).toBeNull();
    expect(r.instrumentName).toBe('US30');
    expect(r.sideText).toBe('L');
    expect(r.dateIso).toMatch(/^2026-11-1[01]$/);
    expect(r.dateText).toBe(formatDate(T_1110));
    expect(r.href).toBe('/trades/l1');
  });

  it('L2: 計画どおりの勝ち・+2.0R・リスクは「—」で理由は「資金を設定すると表示されます」', () => {
    const r = tradeRow(L2, INSTRUMENTS);
    expect(r.badge.label).toBe('計画どおりの勝ち');
    expect(r.rText).toBe('+2.0R');
    expect(r.riskText).toBe(MISSING);
    expect(r.riskNote).toBe(RISK_NOTE.noCapital);
    expect(r.riskNote).toBe('資金を設定すると表示されます');
    expect(r.sideText).toBe('S');
  });

  it('L3: 危ない勝ち（段は崩れ）・R なし・「LC が無いので表示されません」', () => {
    const r = tradeRow(L3, INSTRUMENTS);
    expect(r.badge.label).toBe('危ない勝ち');
    expect(r.badge.tier).toBe('break');
    expect(r.badge.symbol).toBe('triangle');
    expect(r.rText).toBe(MISSING);
    expect(r.rNote).toBe('LC が無いので表示されません');
    expect(r.riskText).toBe(MISSING);
    expect(r.riskNote).toBe('LC が無いので表示されません');
  });

  it('「—」の理由は一覧の上に 1 回だけ（同じ理由は件数にまとめる。R とリスクが同じ理由なら 1 行）', () => {
    const rows = [L1, L2, L3, L3].map((t) => tradeRow(t, INSTRUMENTS));
    expect(missingNotes(rows)).toEqual([
      'リスクの「—」: 資金を設定すると表示されます（1 件）',
      'R・リスクの「—」: LC が無いので表示されません（2 件）',
    ]);
    expect(missingNotes([tradeRow(L1, INSTRUMENTS)])).toEqual([]);
  });

  it('読み上げの名前に日付・銘柄・L / S・判定・R・リスクが入る（出ない値は理由の文言）', () => {
    const r = tradeRow(L1, INSTRUMENTS);
    expect(r.label).toBe(`${formatDate(T_1110)} US30 L ロング A いい損失 R −1.0R リスク 0.5%`);
    expect(tradeRow(L3, INSTRUMENTS).label).toContain(
      'R LC が無いので表示されません リスク LC が無いので表示されません',
    );
  });

  it('計算できない記録（検査を通らない形）は一覧・詳細で同じ決まった文言', () => {
    const bad = stored('bad', { lc: 100.5 });
    const s = summarize(bad);
    expect(s.invalid).toBe(true);
    expect(s.riskNote).toBe(RISK_NOTE.invalid);
    const r = tradeRow(bad, INSTRUMENTS);
    expect(r.rText).toBe(MISSING);
    expect(r.rNote).toBe('この記録からは計算できません');
    expect(r.riskNote).toBe('この記録からは計算できません');
  });

  it('トースト・見出しの短い名前', () => {
    expect(shortLabel(L2, 'US30')).toMatch(/^US30 S 11\/1[23]$/);
    expect(detailHeading(D1, 'US30').title).toBe('US30 · L ロング');
    expect(detailHeading(D1, 'US30').sub).toBe(`決済 ${formatDateTime(T_1110)}`);
  });

  it('今の設定・銘柄を引かない: 写した資金だけで計算する（銘柄の一覧の値が違っても同じ）', () => {
    const other = [{ ...INSTRUMENTS[0], multiplier: 100 } as (typeof INSTRUMENTS)[number]];
    expect(tradeRow(L1, other).riskText).toBe('0.5%');
    expect(tradeRow(L1, other).rText).toBe('−1.0R');
  });

  it('銘柄が一覧に無い → 「銘柄が見つかりません」', () => {
    expect(tradeRow(L1, []).instrumentName).toBe(UNKNOWN_INSTRUMENT);
  });
});

describe('AC-7: ホームの直近 5 件（例 H1）', () => {
  it('新しい順の 5 件、2 件目は危ない勝ちで B と同じ段（崩れ・三角）', () => {
    const rows = recentRows([...H1].reverse(), INSTRUMENTS);
    expect(RECENT_COUNT).toBe(5);
    expect(rows.map((r) => r.id)).toEqual(['h0', 'h1', 'h2', 'h3', 'h4']);
    expect(rows[1]?.badge.label).toBe('危ない勝ち');
    const b = tradeRow(D1, INSTRUMENTS).badge;
    expect(b.label).toBe('B 悪い損失');
    expect(rows[1]?.badge.tier).toBe(b.tier);
    expect(rows[1]?.badge.symbol).toBe(b.symbol);
    expect(rows[1]?.badge.className).toBe(b.className);
  });

  it('件数が 5 未満なら全部、n を指定すればその件数', () => {
    expect(recentRows([L1, L2], INSTRUMENTS)).toHaveLength(2);
    expect(recentRows(H1, INSTRUMENTS, 3).map((r) => r.id)).toEqual(['h0', 'h1', 'h2']);
    expect(recentRows(H1, INSTRUMENTS, 0)).toEqual([]);
  });
});

describe('sortTrades の性質（API の trade_sort_key と同じ並び）', () => {
  const make = (r: () => number, i: number): StoredTrade =>
    stored(
      `id-${Math.floor(r() * 5)}-${i}`,
      { exit: { ...L1.record.exit, time: 1_700_000_000_000 + Math.floor(r() * 4) * 1000 } },
      { createdAt: 1_600_000_000_000 + Math.floor(r() * 3) },
    );
  const key = (t: StoredTrade) => [-t.record.exit.time, -t.createdAt, t.id] as const;
  const cmp = (a: StoredTrade, b: StoredTrade) => {
    const [x, y] = [key(a), key(b)];
    for (let k = 0; k < 3; k++) {
      if ((x[k] as number | string) < (y[k] as number | string)) return -1;
      if ((x[k] as number | string) > (y[k] as number | string)) return 1;
    }
    return 0;
  };

  it('入力の順に依らない・件数を保つ・冪等・キーの昇順（200 回）', () => {
    const r = rng(9);
    for (let n = 0; n < 200; n++) {
      const ts = Array.from({ length: Math.floor(r() * 12) }, (_, i) => make(r, i));
      const shuffled = [...ts].sort(() => r() - 0.5);
      const a = sortTrades(ts);
      const b = sortTrades(shuffled);
      expect(b.map((t) => t.id)).toEqual(a.map((t) => t.id));
      expect(a).toHaveLength(ts.length);
      expect(sortTrades(a).map((t) => t.id)).toEqual(a.map((t) => t.id));
      for (let i = 1; i < a.length; i++) {
        expect(cmp(a[i - 1] as StoredTrade, a[i] as StoredTrade)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('入力の配列を変えない', () => {
    const input = [L1, L2, L3];
    sortTrades(input);
    expect(input.map((t) => t.id)).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('visibleTrades', () => {
  it('隠した ID だけを除き、順を保つ', () => {
    expect(visibleTrades([L1, L2, L3], new Set(['l2'])).map((t) => t.id)).toEqual(['l1', 'l3']);
    expect(visibleTrades([L1, L2], new Set())).toEqual([L1, L2]);
    expect(visibleTrades([L1], new Set(['nope']))).toEqual([L1]);
  });
});

describe('chartSlots（AC-3 の枠）', () => {
  it('D1: 2 枠とも有り、時間足の名前', () => {
    expect(chartSlots(D1)).toEqual([
      { slot: 'entry', name: 'エントリー時', has: true, timeframe: '4 時間足' },
      { slot: 'exit', name: '決済時', has: true, timeframe: '日足' },
    ]);
  });

  it('D2: 決済時の枠は無い', () => {
    expect(chartSlots(D2)[1]).toEqual({
      slot: 'exit',
      name: '決済時',
      has: false,
      timeframe: null,
    });
  });

  it('E2: チャートの無い枠の時間足は出さない', () => {
    expect(chartSlots(E2).map((c) => [c.has, c.timeframe])).toEqual([
      [false, null],
      [false, null],
    ]);
  });
});

describe('recordFields（詳細の記録した欄）', () => {
  it('D1: 主な欄と、下げた後の LC・明細の損益', () => {
    const f = Object.fromEntries(recordFields(D1, 'US30').map((r) => [r.label, r.value]));
    expect(f.銘柄).toBe('US30');
    expect(f['L / S']).toBe('L ロング');
    expect(f.イン).toBe('100');
    expect(f.決済).toBe('99.2');
    expect(f.数量).toBe('10000');
    expect(f.LC).toBe('99.5');
    expect(f['LC を動かしたか']).toBe('下げた（99.2）');
    expect(f['損益（明細の値）']).toBe('−8,000円');
    expect(f.建てた時刻).toBeUndefined();
  });

  it('L3（LC なし）: LC は「なし」、決めていたか・動かしたかは出さない', () => {
    const labels = recordFields(L3, 'US30').map((r) => r.label);
    expect(Object.fromEntries(recordFields(L3, 'US30').map((r) => [r.label, r.value])).LC).toBe(
      'なし',
    );
    expect(labels).not.toContain('LC を入る前に決めていたか');
    expect(labels).not.toContain('LC を動かしたか');
  });

  it('S で LC を上げた取引は「上げた」', () => {
    const t = stored('s1', {
      side: 'S',
      lc: 100.5,
      lcMove: { kind: 'widened', after: 101 },
      exit: { ...L1.record.exit, price: 101 },
    });
    const f = Object.fromEntries(recordFields(t, 'X').map((r) => [r.label, r.value]));
    expect(f['LC を動かしたか']).toBe('上げた（101）');
  });

  it('#47 U18: 口座・記録したときの資金と許容リスクを口座の数によらず出す（付いていない取引は既定の口座の名前）', () => {
    const f = Object.fromEntries(
      recordFields({ ...L1, snapshot: SNAP_1M }, 'US30').map((r) => [r.label, r.value]),
    );
    expect(f.口座).toBe('口座 1');
    expect(f['口座の資金（記録したとき）']).toBe('1,000,000円');
    expect(f['許容リスク（記録したとき）']).toBe('1%');
    const noCapital = Object.fromEntries(
      recordFields({ ...L1, snapshot: { ...SNAP_1M, capitalYen: null } }, 'US30').map((r) => [
        r.label,
        r.value,
      ]),
    );
    expect(noCapital['口座の資金（記録したとき）']).toBe('未設定');
  });
});

describe('時間足を変えたかの表示（申告とチャートを並べ、判定に使った方に印）', () => {
  it('D1: 申告は変えず・チャートは 4 時間足 → 日足（判定に使用）', () => {
    expect(timeframeChangeText(D1, summarize(D1).judgment)).toBe(
      '変えず（申告） / 4 時間足 → 日足（チャートから・判定に使用）',
    );
    const f = Object.fromEntries(
      recordFields(D1, 'US30', summarize(D1).judgment).map((r) => [r.label, r.value]),
    );
    expect(f.時間足を変えたか).toBe('変えず（申告） / 4 時間足 → 日足（チャートから・判定に使用）');
  });

  it('申告が「長い足へ」なら申告を判定に使う（チャートより先。judge.ts）', () => {
    const t = stored(
      'tf',
      { ...D1.record, timeframeChange: 'longer' },
      { charts: D1.charts ?? {} },
    );
    expect(timeframeChangeText(t, summarize(t).judgment)).toBe(
      '長い足へ（申告・判定に使用） / 4 時間足 → 日足（チャートから）',
    );
  });

  it('チャートが 2 枚そろっていなければ申告だけ（D2・E2）', () => {
    expect(timeframeChangeText(D2, summarize(D2).judgment)).toBe('変えず');
    expect(timeframeChangeText(E2, summarize(E2).judgment)).toBe('変えず');
  });
});

describe('tapAnswers（詳細の 3 つのタップの答え。Issue #34 AC-7）', () => {
  it('D1: 決めていた / 下げた（99.2）（外れ）/ 時間足はチャートから判定に効いたので外れ', () => {
    expect(tapAnswers(D1, summarize(D1).judgment)).toEqual([
      { label: 'LC を入る前に', value: '決めていた', offPlan: false },
      { label: 'LC', value: '下げた（99.2）', offPlan: true },
      { label: '時間足', value: '4 時間足 → 日足', offPlan: true },
    ]);
  });

  it('L1: すべて計画どおり（印なし）', () => {
    expect(tapAnswers(L1, summarize(L1).judgment).map((a) => a.offPlan)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('決めていない・長い足へは外れ、詰めた・短い足へは外れない', () => {
    const t = stored('tap', {
      lcDecidedBeforeEntry: false,
      lcMove: { kind: 'tightened' },
      timeframeChange: 'longer',
    });
    expect(tapAnswers(t, summarize(t).judgment)).toEqual([
      { label: 'LC を入る前に', value: '決めていない', offPlan: true },
      { label: 'LC', value: '詰めた', offPlan: false },
      { label: '時間足', value: '長い足へ', offPlan: true },
    ]);
    const u = stored('tap2', { timeframeChange: 'shorter' });
    expect(tapAnswers(u, summarize(u).judgment).at(-1)).toEqual({
      label: '時間足',
      value: '短い足へ',
      offPlan: false,
    });
  });

  it('S で上げた・後の値なしは「上げた」（括弧なし）', () => {
    const t = stored('tap3', {
      side: 'S',
      lc: 150.5,
      entries: [{ price: 150, quantity: 10_000 }],
      lcMove: { kind: 'widened' },
      exit: { ...L1.record.exit, price: 150.8 },
    });
    expect(tapAnswers(t)[1]).toEqual({ label: 'LC', value: '上げた', offPlan: true });
  });

  it('L3（LC なし）: 時間足だけ（C37）', () => {
    expect(tapAnswers(L3, summarize(L3).judgment).map((a) => a.label)).toEqual(['時間足']);
  });

  it('LC の答えは「すべての欄」の同じ答えと同じ文言、時間足はチャートから効かなければ答えのまま', () => {
    for (const t of [D1, D2, L1, L3, E2]) {
      const j = summarize(t).judgment;
      const f = Object.fromEntries(recordFields(t, 'US30', j).map((r) => [r.label, r.value]));
      const a = Object.fromEntries(tapAnswers(t, j).map((x) => [x.label, x.value]));
      if (t.record.lc !== undefined) {
        expect(a.LC).toBe(f['LC を動かしたか']);
        expect(a['LC を入る前に']).toBe(f['LC を入る前に決めていたか']);
      }
    }
    expect(tapAnswers(L1, summarize(L1).judgment).at(-1)?.value).toBe('変えず');
  });

  it('timeframeNote: あなたの答えとチャートが食い違うときだけ 1 行（D1）。そろう・チャートが足りないときは null', () => {
    expect(timeframeNote(D1)).toBe('あなたの答えは「変えず」、チャートは 4 時間足 → 日足');
    const agree = stored(
      'tfa',
      { ...D1.record, timeframeChange: 'longer' },
      { charts: D1.charts ?? {} },
    );
    expect(timeframeNote(agree)).toBeNull();
    const denied = stored(
      'tfb',
      { ...D1.record, timeframeChange: 'longer', exitChartTimeframe: '4h' },
      { charts: D1.charts ?? {} },
    );
    expect(timeframeNote(denied)).toBe(
      'あなたの答えは「長い足へ」、チャートは 4 時間足 → 4 時間足',
    );
    expect(timeframeNote(D2)).toBeNull();
    expect(timeframeNote(E2)).toBeNull();
  });
});

describe('recordFields の通貨と為替（#47 PR-2・U32・D2・D3・AC-20）', () => {
  const MINUS = '−';
  const snap = (accountCurrency: string | undefined, capitalYen: number, price: string | null) => ({
    ...SNAP_1M,
    instrument: { ...SNAP_1M.instrument, priceCurrency: price },
    capitalYen,
    ...(accountCurrency === undefined ? {} : { accountCurrency }),
  });
  const fields = (t: StoredTrade, accounts: readonly AccountRecord[] = []) =>
    Object.fromEntries(
      recordFields(t, '架空指数U', undefined, accounts).map((r) => [r.label, r.value]),
    );
  // 場面 P（L・イン 100.00・LC 99.50・決済 99.50・数量 100）
  const P = { entries: [{ price: 100, quantity: 100 }] } as const;

  it('D2: F1（口座 A・JPY・USD 建て・為替 150）→ 建ての通貨「USD」・為替「1 USD = 150円」・1R「7,500円」', () => {
    const { statementPnlYen: _s, ...rec } = L1.record;
    const t: StoredTrade = {
      ...L1,
      snapshot: snap('JPY', 1_000_000, 'USD'),
      record: { ...rec, ...P, accountId: 'accA', exit: { ...rec.exit, fxRate: 150 } },
    };
    const f = fields(t, [
      account('accA', '口座 A', 1_000_000),
      account('accD', '口座 D', 10_000, 1, { currency: 'USD' }),
    ]);
    expect(f.口座).toBe('口座 A');
    expect(f.建ての通貨).toBe('USD');
    expect(f.為替).toBe('1 USD = 150円');
    expect(f['1R']).toBe('7,500円');
    expect(f['口座の資金（記録したとき）']).toBe('1,000,000円');
  });

  it('D3: F9（口座 D・USD・USD 建て）→ 建ての通貨・為替の行なし・1R「50.00 USD」・金額は USD', () => {
    const t: StoredTrade = {
      ...L1,
      snapshot: snap('USD', 10_000, 'USD'),
      record: {
        ...L1.record,
        ...P,
        accountId: 'accD',
        statementPnlYen: -51.5,
        fees: [{ amountYen: 1.5 }],
      },
    };
    const f = fields(t, [account('accD', '口座 D', 10_000, 1, { currency: 'USD' })]);
    expect(f.口座).toBe('口座 D');
    expect('建ての通貨' in f).toBe(false);
    expect('為替' in f).toBe(false);
    // 1R は明細の損益から（C32）: (51.5 − 1.5) × 0.50 ÷ 0.50 = 50
    expect(f['1R']).toBe('50.00 USD');
    expect(f['口座の資金（記録したとき）']).toBe('10,000.00 USD');
    expect(f['損益（明細の値）']).toBe(`${MINUS}51.50 USD`);
    expect(f.手数料).toBe('1.5 USD');
  });

  it('為替なし・明細あり → 「1 USD = 150.00円（明細から）」。どちらも無ければ行なし。未設定は外貨の口座だけ「未設定」', () => {
    const base: StoredTrade = {
      ...L1,
      snapshot: snap('JPY', 1_000_000, 'USD'),
      record: {
        ...L1.record,
        ...P,
        exit: { ...L1.record.exit, price: 99.4 },
        statementPnlYen: -9_100,
        fees: [{ amountYen: 100 }],
      },
    };
    expect(fields(base).為替).toBe('1 USD = 150.00円（明細から）');
    const { statementPnlYen: _s, ...noPnl } = base.record;
    const plain = fields({ ...base, record: { ...noPnl, fees: [] } });
    expect('為替' in plain).toBe(false);
    expect('1R' in plain).toBe(false);
    const none = fields({ ...base, snapshot: snap('JPY', 1_000_000, null) });
    expect('建ての通貨' in none).toBe(false);
    expect('為替' in none).toBe(false);
    const noneUsd = fields({ ...base, snapshot: snap('USD', 10_000, null) });
    expect(noneUsd.建ての通貨).toBe('未設定');
  });

  it('移す前の取引（口座の通貨なし）・円建て: 建ての通貨・為替の行は無く、金額は今の表記', () => {
    const f = fields({ ...L1, snapshot: snap(undefined, 1_000_000, 'JPY') });
    expect('建ての通貨' in f).toBe(false);
    expect('為替' in f).toBe(false);
    expect(f['損益（明細の値）']).toBe(`${MINUS}5,000円`);
    expect(f['1R']).toBe('5,000円');
  });
});
