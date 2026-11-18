// 通貨と為替（#47 PR-2）の記録する画面が作る本文の、共有の合成の fixture（F1・F3・F9・F10）。値・名前はすべて架空。
// API のテスト（api/tests/test_fx_entry_fixture.py）が同じ fixture を本物の API に通し、201 で受けて送った本文のまま
// 保存すること・snapshot（口座の通貨・資金）が画面の予想と同じことを確かめる（偽の API とのずれを塞ぐ）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/fx-entry-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type {
  AccountBody,
  InstrumentBody,
  InstrumentRecord,
  TradeRecord,
  TradeSnapshot,
} from '../../core/record';
import { type Draft, readDraft, summarize } from '../../ui/src/lib/record-form';
import { account, defaultAccount } from './helpers/accounts';
import { pDraft } from './helpers/currency-examples';

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
const FIXTURE = new URL('../fixtures/records/fx-entry.json', import.meta.url);
/** API が決める ID の印（テストが足した銘柄・口座の ID に置き換える） */
const INSTRUMENT = 'INSTRUMENT';
const ACCOUNT = 'ACCOUNT';
/** 決済の時刻（datetime-local の読みは端末の時間帯に依るので決まった時点に置き換える） */
const EXIT_TIME = 1_772_586_000_000;

interface Item {
  readonly name: string;
  /** 一覧に無い銘柄（名前と価格の通貨だけで足す） */
  readonly instrument: InstrumentBody;
  /** 記録する口座（POST /api/accounts の本文。既定の口座と別に足す = 本文に accountId が入る） */
  readonly account: AccountBody;
  readonly record: TradeRecord;
  readonly snapshot: TradeSnapshot;
  readonly expect: {
    readonly grade: string;
    readonly r: number | null;
    readonly oneR: number | null;
    readonly riskPct: number | null;
    readonly derivedFx: number | null;
  };
}

function item(
  name: string,
  priceCurrency: string,
  acc: { readonly currency: string; readonly capitalYen: number },
  values: Partial<Draft>,
): Item {
  const instrument: InstrumentRecord = {
    id: INSTRUMENT,
    name: `架空指数${name}`,
    underlyingKind: 'other',
    productForm: 'spotCfd',
    priceCurrency,
    multiplier: 1,
    quantityStep: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const accountBody: AccountBody = {
    name: `口座 ${name}`,
    currency: acc.currency,
    capitalYen: acc.capitalYen,
  };
  const ctx = {
    instruments: [instrument],
    accounts: [
      defaultAccount(1_000_000),
      account(ACCOUNT, accountBody.name, acc.capitalYen, 1, { currency: acc.currency }),
    ],
  };
  const read = readDraft(
    pDraft({ instrumentName: instrument.name, accountId: ACCOUNT, ...values }),
    ctx,
  );
  if (!read.body || !read.preview.judgment) throw new Error(`${name} が保存できる下書きでない`);
  const record: TradeRecord = {
    ...read.body,
    exit: { ...read.body.exit, time: EXIT_TIME },
    instrumentId: INSTRUMENT,
  };
  const snapshot: TradeSnapshot = {
    instrument: {
      multiplier: 1,
      quantityStep: 1,
      priceCurrency,
      underlyingKind: 'other',
      productForm: 'spotCfd',
    },
    capitalYen: acc.capitalYen,
    riskTolerancePct: 1,
    accountCurrency: acc.currency,
  };
  // 保存の後に読み直した取引でも同じ値になる（保存の前の表示と保存の後の表示が同じ道）
  const s = summarize({ record, snapshot });
  expect(s.judgment?.grade).toBe(read.preview.judgment.grade);
  return {
    name,
    instrument: { name: instrument.name, priceCurrency },
    account: accountBody,
    record,
    snapshot,
    expect: {
      grade: s.judgment?.grade ?? '',
      r: s.r ?? null,
      oneR: s.oneRYen ?? null,
      riskPct: s.riskPct ?? null,
      derivedFx: s.derivedFx ?? null,
    },
  };
}

function build(): { trades: Item[] } {
  const JPY_A = { currency: 'JPY', capitalYen: 1_000_000 };
  const USD_D = { currency: 'USD', capitalYen: 10_000 };
  return {
    trades: [
      item('F1', 'USD', JPY_A, { fxRate: '150' }),
      item('F3', 'USD', JPY_A, { exitPrice: '99.40', pnlYen: '-9100', feeYen: '100' }),
      item('F9', 'USD', USD_D, {}),
      item('F10', 'EUR', USD_D, { fxRate: '1.10' }),
    ],
  };
}

describe('通貨と為替の本文の fixture（AC-13・AC-14）', () => {
  it('fixture は今の readDraft が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('例の値（F1 = 1R 7,500・F3 = 逆算 150・本文に為替なし・F9 = 1R 50・本文に為替なし・F10 = 1R 55）', () => {
    const t = Object.fromEntries(build().trades.map((x) => [x.name, x]));
    expect(t.F1?.record.exit.fxRate).toBe(150);
    expect(t.F1?.expect.oneR).toBeCloseTo(7_500, 9);
    expect(t.F1?.expect.riskPct).toBeCloseTo(0.75, 12);
    expect(t.F3?.record.exit.fxRate).toBeUndefined();
    expect(t.F3?.expect.derivedFx).toBeCloseTo(150, 9);
    expect(t.F3?.expect.oneR).toBeCloseTo(7_500, 9);
    expect(t.F9?.record.exit.fxRate).toBeUndefined();
    expect(t.F9?.expect.oneR).toBeCloseTo(50, 9);
    expect(t.F10?.expect.oneR).toBeCloseTo(55, 9);
    expect(t.F10?.expect.riskPct).toBeCloseTo(0.55, 12);
    for (const x of build().trades) expect(x.record.accountId, x.name).toBe(ACCOUNT);
  });
});
