// 手で入れた下書きから画面が作る本文の、共有の合成の fixture（Issue #13 AC-1・KEEP-2）。値はすべて架空。
// API のテスト（api/tests/test_manual_entry_fixture.py）が同じ fixture を本物の API に通し、201 で受けて
// 送った本文のまま保存すること・snapshot が画面の予想と同じことを確かめる（偽の API とのずれを塞ぐ）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/manual-entry-fixture.test.ts` で書き直す

import { describe, expect, it } from 'vitest';
import type { InstrumentBody, SettingsBody, TradeRecord, TradeSnapshot } from '../../core/record';
import {
  applyDraft,
  DEFAULT_INSTRUMENT,
  type Draft,
  readDraft,
} from '../../ui/src/lib/record-form';
import { accountsOf } from './helpers/accounts';
import { E1, E2, E5, E6, E7, E16 } from './helpers/record-drafts';

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
const FIXTURE = new URL('../fixtures/records/manual-entry.json', import.meta.url);
const PLACEHOLDER = 'INSTRUMENT';
/** 決済の時刻（datetime-local の読みは端末の時間帯に依るので、fixture では決まった時点に置き換える） */
const EXIT_TIME = 1_772_586_000_000;

interface Item {
  readonly name: string;
  readonly instrument: InstrumentBody;
  readonly settings: SettingsBody;
  readonly record: TradeRecord;
  readonly snapshot: TradeSnapshot;
  readonly expect: { readonly grade: string; readonly r: number | null };
}

/** 一覧に無い銘柄の名前で記録する（銘柄は名前だけで足し、既定は API が埋める） */
function item(name: string, d: Draft, capitalYen: number | null): Item {
  const settings: SettingsBody = { capitalYen, riskTolerancePct: 1, performanceUnit: 'R' };
  const read = readDraft(
    { ...d, instrumentName: `架空指数${name}` },
    { instruments: [], accounts: accountsOf(settings) },
  );
  if (!read.body || !read.preview.judgment) throw new Error(`${name} が保存できる下書きでない`);
  return {
    name,
    instrument: { name: read.instrument.name },
    settings,
    record: {
      ...read.body,
      // エントリーの時刻も同じ理由で決まった時点（決済の 30 分前）に置き換える
      entries: read.body.entries.map((e) =>
        e.time === undefined ? e : { ...e, time: EXIT_TIME - 30 * 60_000 },
      ) as unknown as TradeRecord['entries'],
      exit: { ...read.body.exit, time: EXIT_TIME },
      instrumentId: PLACEHOLDER,
    },
    // API は記録したときの口座の通貨も写す（#47 PR-2。口座 1 つ = 既定の口座 = JPY）
    snapshot: {
      instrument: DEFAULT_INSTRUMENT,
      capitalYen,
      riskTolerancePct: 1,
      accountCurrency: 'JPY',
    },
    expect: { grade: read.preview.judgment.grade, r: read.preview.r ?? null },
  };
}

function build(): { trades: Item[] } {
  return {
    trades: [
      item('E1', E1, null),
      item('E2', E2, 1_000_000),
      item('E5', E5, null),
      item('E16', E16, 1_000_000),
      // 任意の欄をすべて入れた本文（レビュー指摘 3）: エントリーの時刻・損益・手数料・一言・金額ありきの LC・
      // 決済の理由（手で）・「窓・滑りでしたか」= はい
      item(
        'full',
        applyDraft(E6, {
          type: 'fill',
          values: {
            entryTime: '2026-03-04T09:30',
            pnlYen: '-12,200',
            feeYen: '200',
            brokenCondition: '架空の崩れの条件（押し目の安値を割ったら）',
            lcBasis: 'amount',
            exitReason: 'brokeManual',
            gapSlip: 'yes',
          },
        }),
        1_000_000,
      ),
      // LC を狭めた・時間足を長い足へ・TP
      item(
        'tightened',
        applyDraft(E7, {
          type: 'fill',
          values: { lcMove: 'tightened', timeframeChange: 'longer', exitReason: 'tp' },
        }),
        null,
      ),
      // 広げた後の LC を入れない「広げた」
      item('widenedNoAfter', applyDraft(E1, { type: 'set', field: 'lcAfter', value: '' }), null),
    ],
  };
}

describe('手で入れた本文の fixture（AC-1・KEEP-2）', () => {
  it('fixture は今の readDraft が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('例の判定（E1 = B・E2 = A・E5 = B・E16 = C）', () => {
    expect(build().trades.map((t) => [t.name, t.expect.grade])).toEqual([
      ['E1', 'B'],
      ['E2', 'A'],
      ['E5', 'B'],
      ['E16', 'C'],
      ['full', 'B'],
      ['tightened', 'riskyWin'],
      ['widenedNoAfter', 'B'],
    ]);
    const full = build().trades.find((t) => t.name === 'full')?.record;
    expect(full?.exit.gapSlip).toBe('yes');
    expect(full?.fees).toEqual([{ amountYen: 200 }]);
    expect(full?.entries[0].time).toBeDefined();
    expect(full?.brokenCondition).toBeDefined();
  });
});
