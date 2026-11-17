// 直す画面が作る PUT の本文（Issue #9 AC-4・KEEP-1）を、共有の合成の fixture `tests/fixtures/records/edit-bodies.json` に書く。
// API のテスト（api/tests/test_edit_bodies_fixture.py）が同じ fixture を本物の API の PUT に通し、200・写した資金が変わらない・
// E2 のチャートの無い枠の時間足が消える・読み戻した判定が例の期待どおり、を確かめる。値はすべて架空。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/edit-bodies-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type {
  InstrumentBody,
  InstrumentRecord,
  SettingsBody,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../core/record';
import { draftFromStored, editContext, mergeEdit } from '../../ui/src/lib/edit-form';
import {
  applyDraft,
  DEFAULT_INSTRUMENT,
  type DraftAction,
  readDraft,
  summarize,
} from '../../ui/src/lib/record-form';
import { E1, E2 } from './helpers/trade-examples';

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
const FIXTURE = new URL('../fixtures/records/edit-bodies.json', import.meta.url);
const PLACEHOLDER = 'INSTRUMENT';

interface Item {
  readonly name: string;
  readonly instrument: InstrumentBody;
  /** 記録したときの設定（取引に写す） */
  readonly settings: SettingsBody;
  /** 直すときの今の設定（直しても取引に写した値は変わらない） */
  readonly settingsNow: SettingsBody;
  /** 元の記録（E2 はチャートの無い枠の時間足を持つ = API の作成を通らない形。テストが保存先に直接置く） */
  readonly original: TradeRecord;
  readonly snapshot: TradeSnapshot;
  /** 直す画面が送る PUT の本文 */
  readonly body: TradeRecord;
  readonly expect: {
    readonly before: string;
    readonly grade: string;
    readonly r: number | null;
    readonly riskPct: number | null;
  };
}

const INSTRUMENT: InstrumentRecord = {
  id: PLACEHOLDER,
  name: '',
  ...DEFAULT_INSTRUMENT,
  createdAt: 1,
  updatedAt: 1,
};
const settings: SettingsBody = { capitalYen: 1_000_000, riskTolerancePct: 1, performanceUnit: 'R' };
const settingsNow: SettingsBody = { ...settings, capitalYen: 2_000_000 };

function item(name: string, base: StoredTrade, actions: readonly DraftAction[]): Item {
  const instrument = { ...INSTRUMENT, name: `架空指数${name}` };
  const snapshot: TradeSnapshot = {
    instrument: DEFAULT_INSTRUMENT,
    capitalYen: settings.capitalYen,
    riskTolerancePct: settings.riskTolerancePct,
  };
  const { charts: _none, ...rest } = base;
  const trade: StoredTrade = {
    ...rest,
    snapshot,
    record: { ...base.record, instrumentId: PLACEHOLDER },
  };
  const initial = draftFromStored(trade, [instrument]);
  let draft = initial;
  for (const a of actions) draft = applyDraft(draft, a);
  const read = readDraft(draft, editContext(trade, [instrument]));
  if (!read.body) throw new Error(`${name}: 本文が作れない`);
  const body = mergeEdit(trade.record, initial, draft, read.body, PLACEHOLDER);
  const after = summarize({ record: body, snapshot });
  return {
    name,
    instrument: { name: instrument.name },
    settings,
    settingsNow,
    original: trade.record,
    snapshot,
    body,
    expect: {
      before: summarize(trade).judgment?.grade ?? '',
      grade: after.judgment?.grade ?? '',
      r: after.r ?? null,
      riskPct: after.riskPct ?? null,
    },
  };
}

function build(): { trades: Item[] } {
  return {
    trades: [item('E1', E1, [{ type: 'set', field: 'lcMove', value: 'none' }]), item('E2', E2, [])],
  };
}

describe('直す画面の本文の fixture（AC-4・KEEP-1）', () => {
  it('fixture は今の直す画面が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('例の期待: E1 = B → A・−1.0R・0.5%、E2 = B → A（時間足が外れる）', () => {
    const [e1, e2] = build().trades;
    expect(e1?.expect.before).toBe('B');
    expect(e1?.expect.grade).toBe('A');
    expect(e1?.expect.r).toBeCloseTo(-1, 12);
    expect(e1?.expect.riskPct).toBeCloseTo(0.5, 12);
    expect(e1?.body.lcMove).toEqual({ kind: 'none' });
    expect(e2?.expect.before).toBe('B');
    expect(e2?.expect.grade).toBe('A');
    expect(e2?.original.entryChartTimeframe).toBe('4h');
    expect(e2?.body.entryChartTimeframe).toBeUndefined();
    expect(e2?.body.exitChartTimeframe).toBeUndefined();
  });
});
