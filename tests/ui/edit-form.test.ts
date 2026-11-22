// 取引を編集画面の純関数（Issue #9 契約 P-2・AC-4）。値はすべて架空。
// 往復の性質: 記録する画面が作った取引（manual-entry・statement-entry・chart-entry）・全項目の取引（full-record）・
// 設計書 5.6 の全場面（design-table）を開いて何も変えずに保存した記録が、元の記録と等しい（決まった正規化を除く）

import { describe, expect, it } from 'vitest';
import type {
  InstrumentBody,
  InstrumentRecord,
  SettingsBody,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../core/record';
import {
  draftFromStored,
  EDIT_BLOCKED,
  editBlock,
  editContext,
  editPreview,
  editSnapshot,
  mergeEdit,
  orphanTimeframes,
} from '../../ui/src/lib/edit-form';
import {
  applyDraft,
  DEFAULT_INSTRUMENT,
  type Draft,
  readDraft,
  snapshotOf,
  summarize,
} from '../../ui/src/lib/record-form';
import { defaultAccount } from './helpers/accounts';
import { CAPITAL_NOW, D1, E1, E2, L1, L3, SNAP_1M, stored, US30 } from './helpers/trade-examples';

const node = (
  globalThis as unknown as {
    process: {
      getBuiltinModule(id: 'node:fs'): { readFileSync(p: URL, enc: 'utf8'): string };
    };
  }
).process;
const fs = node.getBuiltinModule('node:fs');
const load = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/records/${name}`, import.meta.url), 'utf8')) as T;

const PLACEHOLDER = 'INSTRUMENT';

function instrumentOf(body: InstrumentBody): InstrumentRecord {
  return {
    id: PLACEHOLDER,
    name: body.name,
    underlyingKind: body.underlyingKind ?? DEFAULT_INSTRUMENT.underlyingKind,
    productForm: body.productForm ?? DEFAULT_INSTRUMENT.productForm,
    priceCurrency: body.priceCurrency ?? DEFAULT_INSTRUMENT.priceCurrency,
    multiplier: body.multiplier ?? DEFAULT_INSTRUMENT.multiplier,
    quantityStep: body.quantityStep ?? DEFAULT_INSTRUMENT.quantityStep,
    createdAt: 1,
    updatedAt: 1,
  };
}

interface FixtureItem {
  readonly name?: string;
  readonly scene?: string;
  readonly index?: number;
  readonly instrument: InstrumentBody;
  readonly settings: SettingsBody;
  readonly record: TradeRecord;
  readonly snapshot?: TradeSnapshot;
  readonly charts?: readonly ('entry' | 'exit')[];
}

function asStored(item: FixtureItem): { trade: StoredTrade; instruments: InstrumentRecord[] } {
  const inst = instrumentOf(item.instrument);
  const snapshot: TradeSnapshot = item.snapshot ?? {
    instrument: {
      multiplier: inst.multiplier,
      quantityStep: inst.quantityStep,
      priceCurrency: inst.priceCurrency,
      underlyingKind: inst.underlyingKind,
      productForm: inst.productForm,
    },
    capitalYen: item.settings.capitalYen,
    riskTolerancePct: item.settings.riskTolerancePct,
  };
  const charts = item.charts ?? [];
  return {
    trade: {
      id: 'fx',
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      snapshot,
      record: { ...item.record, instrumentId: PLACEHOLDER },
      ...(charts.length > 0
        ? {
            charts: Object.fromEntries(
              charts.map((s) => [s, { contentType: 'image/png' as const, size: 10 }]),
            ),
          }
        : {}),
    },
    instruments: [inst],
  };
}

/** 開いて何も変えずに保存した記録 */
function saveUnchanged(t: StoredTrade, instruments: readonly InstrumentRecord[]) {
  const initial = draftFromStored(t, instruments);
  const ctx = editContext(t, instruments);
  const read = readDraft(initial, ctx);
  expect(read.errors, 'errors').toEqual({});
  expect(read.missing, 'missing').toEqual([]);
  expect(read.body, 'body').toBeDefined();
  const merged = mergeEdit(
    t.record,
    initial,
    initial,
    read.body as NonNullable<typeof read.body>,
    t.record.instrumentId,
  );
  return { merged, read };
}

/**
 * 決まった正規化（記録する画面が作れない形だけに起きる）: チャートの無い枠の時間足は外す（#12 の API の約束。E2）。
 * 利用者が触っていない答え（聞かない場面の「窓・滑りでしたか」、LC なしの「決めていたか」「動かしたか」）は書き換えない
 */
function normalized(t: StoredTrade, _showGapSlip?: boolean): TradeRecord {
  const out: Record<string, unknown> = { ...t.record };
  for (const o of orphanTimeframes(t)) delete out[`${o.slot}ChartTimeframe`];
  // 取消（置いた逆指値の注文を取り消した）の取引の逆指値は「置いた」に正規化する（C56・#165。未回答で保存された文書だけ変わる）
  if (t.record.lcMove.kind === 'cancelled' && t.record.stopOrderPlaced === 'unanswered')
    out.stopOrderPlaced = 'placed';
  return out as unknown as TradeRecord;
}

describe('editBlock（直せない取引。D6）', () => {
  it('建てが 1 つで建てごとの LC が無い → 直せる', () => {
    expect(editBlock(L1)).toBeNull();
  });
  it('建てが複数 → 直せない', () => {
    const t = { record: { ...L1.record, entries: [L1.record.entries[0], L1.record.entries[0]] } };
    expect(editBlock(t as unknown as Pick<StoredTrade, 'record'>)).toBe(EDIT_BLOCKED);
  });
  it('建てごとの LC がある → 直せない', () => {
    const t = { record: { ...L1.record, entries: [{ price: 100, quantity: 1, lc: 99 }] } };
    expect(editBlock(t as unknown as Pick<StoredTrade, 'record'>)).toBe(EDIT_BLOCKED);
  });
});

describe('snapshotOf の 3 通り（D5。API の update_trade と同じ）', () => {
  const XAU: InstrumentRecord = {
    ...US30,
    id: 'inst-xau',
    name: 'XAU',
    multiplier: 100,
    priceCurrency: 'USD',
  };
  const ctx = editContext({ ...E1, snapshot: SNAP_1M }, [US30, XAU]);
  it('同じ銘柄 → 写した値のまま', () => {
    expect(snapshotOf(ctx, US30)).toEqual(SNAP_1M);
    // 銘柄の今の値が変わっていても写した値（C36）
    expect(snapshotOf(ctx, { ...US30, multiplier: 5 })).toEqual(SNAP_1M);
  });
  it('別の銘柄 → その銘柄の今の値 + 写した資金・許容リスク', () => {
    expect(snapshotOf(ctx, XAU)).toEqual({
      instrument: {
        multiplier: 100,
        quantityStep: 1,
        priceCurrency: 'USD',
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: 1_000_000,
      riskTolerancePct: 1,
    });
  });
  it('一覧に無い名前 → 既定の銘柄 + 写した資金・許容リスク', () => {
    expect(snapshotOf(ctx, undefined)).toEqual({
      instrument: DEFAULT_INSTRUMENT,
      capitalYen: 1_000_000,
      riskTolerancePct: 1,
    });
  });
  it('base が無い（記録する画面）→ 今の設定（変更前と同じ）', () => {
    const plain = {
      instruments: [US30],
      accounts: [defaultAccount(CAPITAL_NOW, 2)],
    };
    expect(snapshotOf(plain, US30).capitalYen).toBe(CAPITAL_NOW);
    expect(snapshotOf(plain, US30).riskTolerancePct).toBe(2);
  });
});

describe('AC-4: 例 E1・E2', () => {
  it('E1: 直す前 B → 「そのまま」でプレビューは A・−1.0R・0.5%（今の資金 2,000,000 円の 0.3% にならない）', () => {
    expect(summarize(E1).judgment?.grade).toBe('B');
    const instruments = [US30];
    const initial = draftFromStored(E1, instruments);
    expect(initial.lcMove).toBe('widened');
    expect(initial.lcAfter).toBe('99.2');
    const ctx = editContext(E1, instruments);
    // 今の設定の資金は文脈に入らない（写した資金だけ）
    expect(ctx.base?.snapshot.capitalYen).toBe(1_000_000);
    const draft = applyDraft(initial, { type: 'set', field: 'lcMove', value: 'none' });
    const read = readDraft(draft, ctx);
    expect(read.canSave).toBe(true);
    const merged = mergeEdit(
      E1.record,
      initial,
      draft,
      read.body as NonNullable<typeof read.body>,
      US30.id,
    );
    const preview = editPreview(read, merged, editSnapshot(read, ctx, draft));
    expect(preview.judgment?.grade).toBe('A');
    expect(preview.r).toBeCloseTo(-1, 12);
    expect(preview.riskPct).toBeCloseTo(0.5, 12);
    expect(merged.lcMove).toEqual({ kind: 'none' });
    // 保存した記録で計算し直しても同じ（保存の後の表示 = 写した値）
    const after = summarize({ record: merged, snapshot: E1.snapshot });
    expect(after.judgment?.grade).toBe('A');
    expect(after.riskPct).toBeCloseTo(0.5, 12);
  });

  it('E2: 直す前 B（時間足を変えた・チャートから）→ 何も変えずに保存すると時間足が外れ A', () => {
    expect(summarize(E2).judgment?.grade).toBe('B');
    expect(summarize(E2).judgment?.reasons.map((r) => r.kind)).toEqual(['timeframeLonger']);
    expect(orphanTimeframes(E2)).toEqual([
      { slot: 'entry', timeframe: '4h' },
      { slot: 'exit', timeframe: '1d' },
    ]);
    const { merged, read } = saveUnchanged(E2, [US30]);
    expect(merged.entryChartTimeframe).toBeUndefined();
    expect(merged.exitChartTimeframe).toBeUndefined();
    expect(editPreview(read, merged, E2.snapshot).judgment?.grade).toBe('A');
    expect(merged).toEqual(normalized(E2, false));
  });

  it('D1（チャートあり）の時間足は保つ', () => {
    expect(orphanTimeframes(D1)).toEqual([]);
    const { merged } = saveUnchanged(D1, [US30]);
    expect(merged.entryChartTimeframe).toBe('4h');
    expect(merged.exitChartTimeframe).toBe('1d');
  });
});

describe('mergeEdit（D5）', () => {
  const base: StoredTrade = {
    ...L1,
    record: {
      ...L1.record,
      thesis: '架空の根拠',
      tp: 101,
      timeframe: '4h',
      entries: [{ price: 100, quantity: 10_000, time: L1.record.exit.time - 3_723_456 }],
      exit: {
        ...L1.record.exit,
        time: L1.record.exit.time + 42_123,
        fxRate: 1,
        review: '架空の総評',
      },
      fees: [
        { label: '取引手数料', amountYen: 120 },
        { label: '税', amountYen: 12 },
      ],
      brokenCondition: '架空の一言',
      statementPnlYen: -5_000,
      source: 'import',
    },
  };
  const instruments = [US30];
  const open = () => {
    const initial = draftFromStored(base, instruments);
    const ctx = editContext(base, instruments);
    return { initial, ctx };
  };
  const save = (initial: Draft, draft: Draft) => {
    const read = readDraft(draft, editContext(base, instruments));
    expect(read.body).toBeDefined();
    return mergeEdit(
      base.record,
      initial,
      draft,
      read.body as NonNullable<typeof read.body>,
      US30.id,
    );
  };

  it('下書きが持たない欄（根拠・TP・時間足・総評・為替）と出どころは元の値', () => {
    const { initial } = open();
    expect(initial.source).toBe('manual');
    const m = save(
      initial,
      applyDraft(initial, { type: 'set', field: 'exitPrice', value: '99.4' }),
    );
    expect(m.thesis).toBe('架空の根拠');
    expect(m.tp).toBe(101);
    expect(m.timeframe).toBe('4h');
    expect(m.exit.review).toBe('架空の総評');
    expect(m.exit.fxRate).toBe(1);
    expect(m.source).toBe('import');
    expect(m.exit.price).toBe(99.4);
  });

  it('時刻・手数料の文字を変えなければ元の値（秒・ラベルを落とさない）', () => {
    const { initial } = open();
    const m = save(initial, initial);
    expect(m.exit.time).toBe(base.record.exit.time);
    expect(m.entries[0].time).toBe(base.record.entries[0].time);
    expect(m.fees).toEqual(base.record.fees);
  });

  it('変えれば本文の値（手数料は 1 欄の合計、時刻は分まで）', () => {
    const { initial } = open();
    const draft = applyDraft(initial, {
      type: 'fill',
      values: { feeYen: '200', exitTime: '2026-11-10T10:00' },
    });
    const m = save(initial, draft);
    expect(m.fees).toEqual([{ amountYen: 200 }]);
    expect(m.exit.time).toBe(new Date(2026, 10, 10, 10, 0).getTime());
  });

  it('空にした任意の欄は消える（明細の損益・一言・エントリーの時刻）', () => {
    const { initial } = open();
    const draft = applyDraft(initial, {
      type: 'fill',
      values: { pnlYen: '', brokenCondition: '', entryTime: '', feeYen: '' },
    });
    const m = save(initial, draft);
    expect(m.statementPnlYen).toBeUndefined();
    expect(m.brokenCondition).toBeUndefined();
    expect(m.entries[0].time).toBeUndefined();
    expect(m.fees).toEqual([]);
    expect('statementPnlYen' in m).toBe(false);
  });

  it('LC を「なし」にすると lc が消え、決めていなかった・動かしていない', () => {
    const { initial } = open();
    const m = save(initial, applyDraft(initial, { type: 'set', field: 'lcNone', value: true }));
    expect('lc' in m).toBe(false);
    expect(m.lcDecidedBeforeEntry).toBe(false);
    expect(m.lcMove).toEqual({ kind: 'none' });
  });

  it('L3（LC なし）は下書きで「なし」', () => {
    const d = draftFromStored(L3, instruments);
    expect(d.lcNone).toBe(true);
    expect(d.lc).toBe('');
    expect(d.lcDecided).toBeNull();
  });
});

describe('往復の性質: 何も変えずに保存した記録 = 元の記録（正規化を除く）', () => {
  const sets: [string, FixtureItem[]][] = [
    ['manual-entry', load<{ trades: FixtureItem[] }>('manual-entry.json').trades],
    ['statement-entry', load<{ trades: FixtureItem[] }>('statement-entry.json').trades],
    ['chart-entry', load<{ trades: FixtureItem[] }>('chart-entry.json').trades],
    ['full-record', load<{ trades: FixtureItem[] }>('full-record.json').trades],
    ['design-table', load<FixtureItem[]>('design-table.json')],
  ];

  for (const [set, items] of sets) {
    it(`${set}: 直せる取引は往復で同じ、判定も同じ`, () => {
      let editable = 0;
      for (const item of items) {
        const what = `${set} ${item.name ?? `${item.scene}-${item.index}`}`;
        const { trade, instruments } = asStored(item);
        if (editBlock(trade) !== null) continue;
        editable++;
        const { merged, read } = saveUnchanged(trade, instruments);
        const want = normalized(trade, read.preview.showGapSlip);
        expect(merged, what).toEqual(want);
        const preview = editPreview(
          read,
          merged,
          editSnapshot(read, editContext(trade, instruments), { accountId: '' }),
        );
        const before = summarize({ record: want, snapshot: trade.snapshot });
        expect(preview.judgment?.grade, what).toBe(before.judgment?.grade);
        expect(preview.r, what).toBe(before.r);
        expect(preview.riskPct, what).toBe(before.riskPct);
        // 正規化しても、チャートの無い枠の時間足（E2 型）のほかは元の記録の判定・理由と同じ
        if (orphanTimeframes(trade).length === 0) {
          const orig = summarize(trade);
          expect(preview.judgment, what).toEqual(orig.judgment);
        }
      }
      expect(editable).toBeGreaterThan(0);
    });
  }

  it('記録する画面が作った取引（3 つの fixture）は正規化なしで完全に同じ', () => {
    for (const name of ['manual-entry.json', 'statement-entry.json', 'chart-entry.json']) {
      for (const item of load<{ trades: FixtureItem[] }>(name).trades) {
        const { trade, instruments } = asStored(item);
        const { merged } = saveUnchanged(trade, instruments);
        expect(merged, `${name} ${item.name}`).toEqual(trade.record);
      }
    }
  });

  it('full-record の「全項目」は建てごとの LC があるので直せない（D6）。LC を外した形は往復で同じ', () => {
    const full = load<{ trades: FixtureItem[] }>('full-record.json').trades.find(
      (t) => t.name === 'full',
    );
    expect(full).toBeDefined();
    const { trade, instruments } = asStored(full as FixtureItem);
    expect(editBlock(trade)).toBe(EDIT_BLOCKED);
    const { lc: _lc, ...entry } = trade.record.entries[0];
    const t2: StoredTrade = { ...trade, record: { ...trade.record, entries: [entry] } };
    expect(editBlock(t2)).toBeNull();
    const { merged, read } = saveUnchanged(t2, instruments);
    expect(merged).toEqual(normalized(t2, read.preview.showGapSlip));
  });
});

describe('触っていない答えは保存で書き換えない（レビュー指摘 4）', () => {
  it('聞かない場面の「窓・滑りでしたか」の答え・LC なしの「決めていた」「広げた」を保つ', () => {
    const odd = stored('odd', {
      ...L3.record,
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'tightened' },
      exit: { ...L3.record.exit, gapSlip: 'yes' },
    });
    const { merged } = saveUnchanged(odd, [US30]);
    expect(merged).toEqual(odd.record);
  });

  it('LC を入れ直すと、LC なしの答えは今の下書きの値になる', () => {
    const odd = stored('odd2', { ...L3.record, lcDecidedBeforeEntry: true });
    const initial = draftFromStored(odd, [US30]);
    const draft = applyDraft(initial, {
      type: 'fill',
      values: { lc: '99.5', lcDecided: false, lcMove: 'none' },
    });
    const read = readDraft(draft, editContext(odd, [US30]));
    const m = mergeEdit(
      odd.record,
      initial,
      draft,
      read.body as NonNullable<typeof read.body>,
      US30.id,
    );
    expect(m.lc).toBe(99.5);
    expect(m.lcDecidedBeforeEntry).toBe(false);
  });
});
