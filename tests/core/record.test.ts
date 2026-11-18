// 保存の形 → 計算の入力の写し（core/record.ts。Issue #4 の AC-10・11・12、契約 4）。値はすべて架空。
// 共有の fixture（tests/fixtures/records/）は API のテスト（api/tests/test_records_roundtrip.py）も読む。
// design-table.json は 5.6 の場面から作る。ずれたら `UPDATE_FIXTURES=1 npx vitest run tests/core/record.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import {
  accountCurrencyOf,
  DEFAULT_CURRENCY,
  feesTotalYen,
  type InstrumentBody,
  type SettingsBody,
  type StoredTrade,
  type TradeRecord,
  toTradeInput,
} from '../../core/record';
import type { TradeInput } from '../../core/trade';
import designMd from '../../docs/design.md?raw';
import { DESIGN_TABLE_CASES } from './design-table-cases';
import { parseDesignTable } from './helpers/design-table';
import { forAll } from './helpers/prng';
import { FILL, fromTradeInput, type StoredScene, stored } from './helpers/record';
import { closedAt, trade } from './helpers/trade-builder';

// @types/node を足さないため、Node の fs と環境変数の型はここで最小限に書く（tests/ui/cssTokens.test.ts と同じ）
const node = (
  globalThis as unknown as {
    process: {
      env: Record<string, string | undefined>;
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(p: URL, enc: 'utf8'): string;
        writeFileSync(p: URL, data: string): void;
      };
    };
  }
).process;
const fs = node.getBuiltinModule('node:fs');
const DESIGN_FIXTURE = new URL('../fixtures/records/design-table.json', import.meta.url);
const FULL_FIXTURE = new URL('../fixtures/records/full-record.json', import.meta.url);

const rows = parseDesignTable(designMd);

interface DesignFixtureItem extends StoredScene {
  readonly scene: string;
  readonly index: number;
}

function buildDesignFixture(): DesignFixtureItem[] {
  return rows.flatMap((row) =>
    (DESIGN_TABLE_CASES[row.id] ?? []).map((scene, index) => ({
      scene: row.id,
      index,
      ...fromTradeInput(scene.input, `scene-${row.id}-${index}`),
    })),
  );
}

function judged(t: TradeInput) {
  const ev = evaluateTrade(t);
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev.issues)}`);
  return ev;
}

describe('5.6 の表を保存の形で往復（AC-10）', () => {
  it('全行の場面を保存の形に写して戻すと、判定・理由・R が元の入力と同じで、表の期待どおり', () => {
    let counted = 0;
    for (const row of rows) {
      const scenes = DESIGN_TABLE_CASES[row.id];
      if (scenes === undefined) throw new Error(`#${row.id} の場面が無い`);
      counted++;
      scenes.forEach((scene, i) => {
        const where = `#${row.id} 場面 ${i + 1}`;
        const back = toTradeInput(stored(fromTradeInput(scene.input)));
        const ev = judged(back);
        const orig = judged(scene.input);
        expect(ev.judgment?.grade, where).toBe(scene.grade);
        const kinds = (ev.judgment?.reasons ?? []).map((r) => r.kind);
        for (const k of scene.reasons) expect(kinds, `${where} の理由に ${k}`).toContain(k);
        for (const k of scene.absent ?? [])
          expect(kinds, `${where} に ${k} が無い`).not.toContain(k);
        expect(ev.judgment, where).toEqual(orig.judgment);
        expect(ev.r, where).toBe(orig.r);
        expect(ev.oneRYen, where).toBe(orig.oneRYen);
        expect(ev.riskPct, where).toBe(orig.riskPct);
        expect(ev.pnlYen, where).toBe(orig.pnlYen);
      });
    }
    // 場面を数えた行数が表の行数と一致する
    expect(counted).toBe(rows.length);
    expect(Object.keys(DESIGN_TABLE_CASES).length).toBe(rows.length);
  });

  it('fixture（design-table.json）が場面から作った値と一致する', () => {
    const built = buildDesignFixture();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(DESIGN_FIXTURE, json);
    const onDisk = JSON.parse(fs.readFileSync(DESIGN_FIXTURE, 'utf8')) as DesignFixtureItem[];
    expect(onDisk).toEqual(built);
    // 表の全行が fixture に入っている
    expect(new Set(onDisk.map((x) => x.scene)).size).toBe(rows.length);
  });

  it('fixture の各件を写すと、表の期待どおり（API の往復のテストと同じ値）', () => {
    const items = JSON.parse(fs.readFileSync(DESIGN_FIXTURE, 'utf8')) as DesignFixtureItem[];
    for (const item of items) {
      const scene = DESIGN_TABLE_CASES[item.scene]?.[item.index];
      if (scene === undefined) throw new Error(`#${item.scene} の場面 ${item.index} が無い`);
      expect(judged(toTradeInput(item)).judgment?.grade, `#${item.scene}`).toBe(scene.grade);
    }
  });
});

describe('移す前の取引（snapshot に口座の通貨が無い）は JPY の口座と同じ（#47 KEEP-2・F15・P6）', () => {
  it('design-table.json の全件: accountCurrency を足さない写しと JPY を足した写しで計算の入力と結果が同じ', () => {
    const items = JSON.parse(fs.readFileSync(DESIGN_FIXTURE, 'utf8')) as DesignFixtureItem[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect('accountCurrency' in item.snapshot, `#${item.scene}`).toBe(false);
      const without = toTradeInput(item);
      const withJpy = toTradeInput({
        ...item,
        snapshot: { ...item.snapshot, accountCurrency: 'JPY' },
      });
      expect(withJpy, `#${item.scene}`).toEqual(without);
      expect(evaluateTrade(withJpy), `#${item.scene}`).toEqual(evaluateTrade(without));
    }
  });
});

describe('写しは snapshot（記録したときの値）だけを使う', () => {
  // T1: L・イン 100.00・LC 99.50・数量 10,000・決済 99.50（理由 LC）・明細 −5,200 円・手数料 200 円・資金 1,000,000 円
  const t1 = fromTradeInput(
    closedAt(trade({ statementPnlYen: -5_200, feesTotalYen: 200 }), 99.5, { reason: 'lc' }),
  );

  it('E1: A・−1.0R・1R 5,000 円・リスク 0.5%', () => {
    const ev = judged(toTradeInput(t1));
    // R = (99.50 − 100.00) ÷ 0.50 = −1.0、1R = 0.50 × 10,000 × 1 = 5,000 円、リスク = 5,000 ÷ 1,000,000 = 0.5%
    expect(ev.judgment?.grade).toBe('A');
    expect(ev.r).toBeCloseTo(-1.0, 12);
    expect(ev.oneRYen).toBeCloseTo(5_000, 9);
    expect(ev.riskPct).toBeCloseTo(0.5, 12);
  });

  it('記録したときの資金で写す（AC-11: 後で設定の資金を 500,000 円に直しても 0.5% のまま）', () => {
    // 写しは設定を受け取らない。snapshot の資金 1,000,000 円が使われる
    const input = toTradeInput(t1);
    expect(input.capitalYen).toBe(1_000_000);
    expect(judged(input).riskPct).toBeCloseTo(0.5, 12);
    expect(judged(input).judgment?.grade).toBe('A');
  });

  it('記録したときの銘柄の値で写す（AC-12: 直す前の取引は乗数 1、直した後の取引は 10）', () => {
    const before = toTradeInput(t1);
    const after = toTradeInput({
      ...t1,
      snapshot: { ...t1.snapshot, instrument: { ...t1.snapshot.instrument, multiplier: 10 } },
    });
    expect(before.instrument.multiplier).toBe(1);
    expect(after.instrument.multiplier).toBe(10);
    // R は価格だけから出るので −1.0R のまま（C18）。T1 の 1R は明細の損益から逆算するので乗数に依らない（C32）
    expect(judged(after).r).toBeCloseTo(-1.0, 12);
    expect(judged(after).oneRYen).toBeCloseTo(5_000, 9);
    // 明細の損益が無ければ 1R = 0.50 × 10,000 × 乗数: 乗数 1 → 5,000 円、乗数 10 → 50,000 円
    const { statementPnlYen: _omit, ...noStatement } = t1.record;
    const plain = { ...t1, record: noStatement };
    expect(judged(toTradeInput(plain)).oneRYen).toBeCloseTo(5_000, 9);
    expect(
      judged(
        toTradeInput({
          ...plain,
          snapshot: { ...t1.snapshot, instrument: { ...t1.snapshot.instrument, multiplier: 10 } },
        }),
      ).oneRYen,
    ).toBeCloseTo(50_000, 9);
  });

  it('資金が null なら資金の項目なし（リスクは出ない）', () => {
    const input = toTradeInput({ ...t1, snapshot: { ...t1.snapshot, capitalYen: null } });
    expect('capitalYen' in input).toBe(false);
    expect(judged(input).riskPct).toBeUndefined();
  });

  it.each([
    ['JPY', undefined, true],
    ['USD', undefined, false],
    [null, undefined, false],
    ['JPY', 'JPY', true],
    ['USD', 'USD', true],
    ['JPY', 'USD', false],
    ['EUR', 'USD', false],
    [null, 'USD', false],
  ] as const)(
    '価格の通貨 %s × 口座の通貨 %s → 為替 1 で固定 %s（未設定は同じとみなさない・口座の通貨が無い = JPY）',
    (currency, accountCurrency, same) => {
      const input = toTradeInput({
        ...t1,
        snapshot: {
          ...t1.snapshot,
          ...(accountCurrency === undefined ? {} : { accountCurrency }),
          instrument: { ...t1.snapshot.instrument, priceCurrency: currency },
        },
      });
      expect(input.instrument.priceInAccountCurrency).toBe(same);
    },
  );

  it('accountCurrencyOf: 無い・空は JPY、ほかはその値', () => {
    expect(accountCurrencyOf({})).toBe('JPY');
    expect(accountCurrencyOf({ accountCurrency: '' })).toBe('JPY');
    expect(accountCurrencyOf({ accountCurrency: 'USD' })).toBe('USD');
    expect(DEFAULT_CURRENCY).toBe('JPY');
  });

  it.each([
    ['yes', true],
    ['no', false],
  ] as const)('窓・滑り %s → gapSlipAnswer %s、未回答は項目なし', (answer, value) => {
    const withAnswer = toTradeInput({
      ...t1,
      record: { ...t1.record, exit: { ...t1.record.exit, gapSlip: answer } },
    });
    expect(withAnswer.gapSlipAnswer).toBe(value);
    expect('gapSlipAnswer' in toTradeInput(t1)).toBe(false);
  });

  it('手数料の欄の合計（丸めない）', () => {
    expect(feesTotalYen([])).toBe(0);
    expect(feesTotalYen([{ amountYen: 150 }, { label: '金利', amountYen: 50.5 }])).toBe(200.5);
    expect(toTradeInput(t1).feesTotalYen).toBe(200);
  });

  it('性質: 判定に使わない欄を変えても写しは変わらない', () => {
    const base = toTradeInput(t1);
    forAll(
      20261117,
      500,
      (r) => {
        const extra: Partial<TradeRecord> = {
          brokenCondition: `崩れ ${r.int(0, 9999)}`,
          thesis: r.bool() ? '根拠' : '別の根拠',
          entryEmotion: r.pick(['焦り', '冷静']),
          tp: 100 + r.int(1, 500) / 100,
          contractMonth: `2026-${r.int(10, 12)}`,
          optionType: r.pick(['P', 'C'] as const),
          strike: r.int(1, 500),
          stopOrderPlaced: r.pick(['placed', 'notPlaced', 'unanswered'] as const),
          instrumentId: `ID${r.int(0, 1_000_000)}`,
        };
        return {
          extra,
          exitText: { emotion: r.pick(['悔しい', '安心']), review: `総評 ${r.int(0, 99)}` },
        };
      },
      ({ extra, exitText }) => {
        const changed = toTradeInput({
          ...t1,
          record: { ...t1.record, ...extra, exit: { ...t1.record.exit, ...exitText } },
        });
        expect(changed).toEqual(base);
      },
    );
  });
});

describe('全項目の取引（full-record.json）', () => {
  interface FullItem {
    readonly name: string;
    readonly instrument: InstrumentBody;
    readonly settings: SettingsBody;
    readonly record: TradeRecord;
  }
  const full = JSON.parse(fs.readFileSync(FULL_FIXTURE, 'utf8')) as { trades: FullItem[] };
  const byName = new Map(full.trades.map((t) => [t.name, t]));

  function asStored(item: FullItem): Pick<StoredTrade, 'record' | 'snapshot'> {
    const i = item.instrument;
    return {
      record: item.record,
      snapshot: {
        instrument: {
          multiplier: i.multiplier ?? 1,
          quantityStep: i.quantityStep ?? 1,
          priceCurrency: i.priceCurrency ?? null,
          underlyingKind: i.underlyingKind ?? 'other',
          productForm: i.productForm ?? 'spotCfd',
        },
        capitalYen: item.settings.capitalYen,
        riskTolerancePct: item.settings.riskTolerancePct,
      },
    };
  }

  it('口座の通貨が無い写しと JPY を足した写しで同じ（KEEP-2。USD 建て・fxRate つきの full を含む）', () => {
    for (const item of full.trades) {
      const base = asStored(item);
      const without = toTradeInput(base);
      const withJpy = toTradeInput({
        ...base,
        snapshot: { ...base.snapshot, accountCurrency: 'JPY' },
      });
      expect(withJpy, item.name).toEqual(without);
      expect(evaluateTrade(withJpy), item.name).toEqual(evaluateTrade(without));
    }
  });

  it('すべて受け付けられる（検査を通る）', () => {
    expect(full.trades.map((t) => t.name)).toEqual(['full', 'E11', 'E12', 'E18']);
    for (const item of full.trades) judged(toTradeInput(asStored(item)));
  });

  it('E11: S・イン 100.00・LC 100.50・決済 99.00 → +2.0R・計画どおりの勝ち', () => {
    const item = byName.get('E11');
    if (item === undefined) throw new Error('E11 が無い');
    const ev = judged(toTradeInput(asStored(item)));
    // R = −(99.00 − 100.00) ÷ 0.50 = +2.0
    expect(ev.r).toBeCloseTo(2.0, 12);
    expect(ev.judgment?.grade).toBe('safeWin');
  });

  it('E12: 2 つのエントリーとそれぞれの LC が残り、ナンピン', () => {
    const item = byName.get('E12');
    if (item === undefined) throw new Error('E12 が無い');
    const input = toTradeInput(asStored(item));
    expect(input.entries).toEqual([
      { price: 100, quantity: 10_000, lc: 99.5 },
      { price: 99.8, quantity: 10_000, lc: 99.5 },
    ]);
    expect(judged(input).judgment?.reasons.map((r) => r.kind)).toContain('averagingDown');
  });

  it('E18: 数量 0.3 は丸めない', () => {
    const item = byName.get('E18');
    if (item === undefined) throw new Error('E18 が無い');
    const input = toTradeInput(asStored(item));
    expect(input.entries[0].quantity).toBe(0.3);
    expect(input.instrument.quantityStep).toBe(0.1);
  });

  it('全項目の取引: 手数料の欄の合計と、写さない欄', () => {
    const item = byName.get('full');
    if (item === undefined) throw new Error('full が無い');
    const input = toTradeInput(asStored(item));
    expect(input.feesTotalYen).toBe(200.5);
    expect(input.gapSlipAnswer).toBe(false);
    expect(input.instrument.priceInAccountCurrency).toBe(false);
    expect(input.plannedAt).toBe(1_699_990_000_000);
    expect(JSON.stringify(input)).not.toContain('崩れる');
    expect(FILL.instrumentId).toBe(item.record.instrumentId);
  });
});
