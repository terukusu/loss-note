// 明細の読み取りから画面が作る本文の、共有の合成の fixture（Issue #15 KEEP-2・AC-4・AC-7）。値はすべて架空。
// API のテスト（api/tests/test_statement_entry_fixture.py）が同じ fixture を本物の API に通し、201 で受けて
// 送った本文のまま保存すること（出どころ「明細」・注文の種類「逆指値 / 成行 / 不明」・逆指値を入れた）を確かめる。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/statement-entry-fixture.test.ts` で書き直す

import { describe, expect, it } from 'vitest';
import type { InstrumentBody, SettingsBody, TradeRecord, TradeSnapshot } from '../../core/record';
import { DEFAULT_INSTRUMENT, EMPTY_DRAFT, readDraft } from '../../ui/src/lib/record-form';
import { fillFromRow, type ReadRow } from '../../ui/src/lib/statement-fill';
import { accountsOf } from './helpers/accounts';
import { ROW_E1, ROW_E7, ROW_E8 } from './helpers/statement-rows';

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
const FIXTURE = new URL('../fixtures/records/statement-entry.json', import.meta.url);
const PLACEHOLDER = 'INSTRUMENT';

interface Item {
  readonly name: string;
  readonly instrument: InstrumentBody;
  readonly settings: SettingsBody;
  readonly record: TradeRecord;
  readonly snapshot: TradeSnapshot;
  readonly expect: { readonly grade: string; readonly r: number | null };
}

/** 行を流し込み、LC 99.0・一言・3 つのタップ（逆指値なら決めていたかは既定のまま）を入れて本文にする */
function item(name: string, row: ReadRow): Item {
  const settings: SettingsBody = { capitalYen: null, riskTolerancePct: 1, performanceUnit: 'R' };
  const filled = fillFromRow(EMPTY_DRAFT, row, new Set());
  const draft = {
    ...filled.draft,
    lc: '99.0',
    brokenCondition: '押し目の安値を割ったら',
    lcDecided: filled.draft.lcDecided ?? true,
    lcMove: 'none' as const,
    timeframeChange: 'none' as const,
  };
  const read = readDraft(draft, { instruments: [], accounts: accountsOf(settings) });
  if (!read.body || !read.preview.judgment) throw new Error(`${name} が保存できる下書きでない`);
  return {
    name,
    instrument: { name: read.instrument.name },
    settings,
    record: { ...read.body, instrumentId: PLACEHOLDER },
    snapshot: {
      instrument: DEFAULT_INSTRUMENT,
      capitalYen: null,
      riskTolerancePct: 1,
      accountCurrency: 'JPY',
    },
    expect: { grade: read.preview.judgment.grade, r: read.preview.r ?? null },
  };
}

function build(): { trades: Item[] } {
  return { trades: [item('E1', ROW_E1), item('E7', ROW_E7), item('E8', ROW_E8)] };
}

describe('明細の読み取りから作る本文の fixture（KEEP-2）', () => {
  it('fixture は今の fillFromRow → readDraft が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('E1 = A・−1.0R・不明 / E7 = 逆指値・入れた・LC / E8 = 成行・未回答。どれも出どころ 明細・手数料は合計 1 つ', () => {
    const t = Object.fromEntries(build().trades.map((x) => [x.name, x]));
    expect(t.E1?.expect).toEqual({ grade: 'A', r: -1 });
    for (const x of Object.values(t)) {
      expect(x.record.source).toBe('statement');
      expect(x.record.fees).toEqual([{ amountYen: 150 }]);
      expect(x.record.statementPnlYen).toBe(-2000);
    }
    expect(
      [t.E1, t.E7, t.E8].map((x) => [
        x?.record.exit.orderType,
        x?.record.stopOrderPlaced,
        x?.record.exit.reason,
      ]),
    ).toEqual([
      ['unknown', 'unanswered', 'other'],
      ['stop', 'placed', 'lc'],
      ['market', 'unanswered', 'other'],
    ]);
  });
});
