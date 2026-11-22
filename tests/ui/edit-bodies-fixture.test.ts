// 直す画面が作る PUT の本文（Issue #9 AC-4・KEEP-1）を、共有の合成の fixture `tests/fixtures/records/edit-bodies.json` に書く。
// API のテスト（api/tests/test_edit_bodies_fixture.py）が同じ fixture を本物の API の PUT に通し、200・写した資金が変わらない・
// E2 のチャートの無い枠の時間足が消える・読み戻した判定が例の期待どおり、を確かめる。値はすべて架空。
// #47（口座）: accountScenes = 口座が 2 個のときの直しの本文（A4 = 口座 A から口座 B へ付け替え、B7 = 口座の付いていない
// 取引を口座を変えずに保存）。口座の ID は API が決めるので、fixture では ACCOUNT_A・ACCOUNT_B の印（既定の口座は default）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/edit-bodies-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type {
  AccountRecord,
  InstrumentBody,
  InstrumentRecord,
  SettingsBody,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../core/record';
import { draftFromStored, editContext, editSnapshot, mergeEdit } from '../../ui/src/lib/edit-form';
import {
  applyDraft,
  DEFAULT_INSTRUMENT,
  type DraftAction,
  readDraft,
  summarize,
} from '../../ui/src/lib/record-form';
import { account, defaultAccount } from './helpers/accounts';
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
    accountCurrency: 'JPY',
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

interface AccountSpec {
  /** default = 既定の口座（「口座 1」）、ほかは API が決める ID の印 */
  readonly key: 'default' | 'ACCOUNT_A' | 'ACCOUNT_B' | 'ACCOUNT_D';
  readonly name: string;
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
  /** 口座の通貨（#47 PR-2。省けば JPY） */
  readonly currency?: string;
}

interface AccountScene {
  readonly name: string;
  readonly instrument: InstrumentBody;
  /** 記録したときの口座（API に先に作る） */
  readonly accounts: readonly AccountSpec[];
  /** 直すときの今の口座（記録の後に直した値） */
  readonly accountsNow: readonly AccountSpec[];
  /** 元の記録（B7 は口座の付いていない移す前の取引） */
  readonly original: TradeRecord;
  /** 記録したときに写した値 */
  readonly snapshot: TradeSnapshot;
  /** 直す画面が送る PUT の本文 */
  readonly body: TradeRecord;
  /** 保存の後の snapshot の資金と判定（付け替え = 付け替え先の今の値、付け替えない = 写した値のまま） */
  readonly expect: {
    readonly capitalYen: number | null;
    readonly accountCurrency: string;
    readonly grade: string;
    readonly riskPct: number | null;
  };
}

const asRecord = (a: AccountSpec): AccountRecord =>
  a.key === 'default'
    ? { ...defaultAccount(a.capitalYen, a.riskTolerancePct), name: a.name }
    : account(a.key, a.name, a.capitalYen, a.riskTolerancePct, {
        ...(a.currency === undefined ? {} : { currency: a.currency }),
      });

function accountScene(
  name: string,
  base: StoredTrade,
  recordedIn: AccountSpec['key'] | null,
  accounts: readonly AccountSpec[],
  accountsNow: readonly AccountSpec[],
  actions: readonly DraftAction[],
): AccountScene {
  const instrument = { ...INSTRUMENT, name: `架空指数${name}` };
  const at = accounts.find((a) => a.key === (recordedIn ?? 'default')) as AccountSpec;
  const snapshot: TradeSnapshot = {
    instrument: DEFAULT_INSTRUMENT,
    capitalYen: at.capitalYen,
    riskTolerancePct: at.riskTolerancePct,
    accountCurrency: 'JPY',
  };
  const { charts: _none, ...rest } = base;
  const { accountId: _old, ...plain } = base.record;
  const original: TradeRecord = {
    ...plain,
    instrumentId: PLACEHOLDER,
    ...(recordedIn === null ? {} : { accountId: recordedIn }),
  };
  const trade: StoredTrade = { ...rest, snapshot, record: original };
  const now = accountsNow.map(asRecord);
  const initial = draftFromStored(trade, [instrument]);
  let draft = initial;
  for (const a of actions) draft = applyDraft(draft, a);
  const ctx = editContext(trade, [instrument], now);
  const read = readDraft(draft, ctx);
  if (!read.body) throw new Error(`${name}: 本文が作れない`);
  const body = mergeEdit(original, initial, draft, read.body, PLACEHOLDER);
  const after = editSnapshot(read, ctx, draft);
  const s = summarize({ record: body, snapshot: after });
  return {
    name,
    instrument: { name: instrument.name },
    accounts,
    accountsNow,
    original,
    snapshot,
    body,
    expect: {
      capitalYen: after.capitalYen,
      accountCurrency: after.accountCurrency ?? 'JPY',
      grade: s.judgment?.grade ?? '',
      riskPct: s.riskPct ?? null,
    },
  };
}

const ONE: AccountSpec = {
  key: 'default',
  name: '口座 1',
  capitalYen: 1_000_000,
  riskTolerancePct: 1,
};
const ACC_A: AccountSpec = {
  key: 'ACCOUNT_A',
  name: '口座 A',
  capitalYen: 1_000_000,
  riskTolerancePct: 1,
};
const ACC_B: AccountSpec = {
  key: 'ACCOUNT_B',
  name: '口座 B',
  capitalYen: 200_000,
  riskTolerancePct: 1,
};
const ACC_D: AccountSpec = {
  key: 'ACCOUNT_D',
  name: '口座 D',
  capitalYen: 10_000,
  riskTolerancePct: 1,
  currency: 'USD',
};
/** E1 を「そのまま」に直した取引（L 100.00 / LC 99.50 / 数量 10,000 / 損益 −5,000 → 1R 5,000 円） */
const FIXED = { type: 'set', field: 'lcMove', value: 'none' } as const;

function build(): { trades: Item[]; accountScenes: AccountScene[] } {
  return {
    trades: [
      item('E1', E1, [FIXED]),
      item('E2', E2, []),
      // #165 E17（C56）: 取消・逆指値の未設定の取引を開いて何も変えずに保存 → 同じ値
      item(
        'cancelled',
        {
          ...E1,
          record: { ...E1.record, lcMove: { kind: 'cancelled' }, stopOrderPlaced: 'placed' },
        },
        [],
      ),
      item('stopNotPlaced', { ...E2, record: { ...E2.record, stopOrderPlaced: 'notPlaced' } }, []),
    ],
    accountScenes: [
      // A4: 口座 A で記録 → 口座 A の資金を 500,000 に直した後、口座 B へ付け替え → 2.5%・B（過剰リスク）
      accountScene(
        'A4',
        E1,
        'ACCOUNT_A',
        [ONE, ACC_A, ACC_B],
        [ONE, { ...ACC_A, capitalYen: 500_000 }, ACC_B],
        [FIXED, { type: 'set', field: 'accountId', value: 'ACCOUNT_B' }],
      ),
      // B7: 口座の付いていない取引（移す前）を、口座 1 の資金を直した後に口座を変えずに保存 → 写した値のまま
      accountScene(
        'B7',
        E1,
        null,
        [ONE, ACC_B],
        [{ ...ONE, capitalYen: 2_000_000 }, ACC_B],
        [FIXED],
      ),
      // #47 PR-2 A9: 口座 A（JPY）の取引（明細の損益・手数料あり）を口座 D（USD）へ付け替える。直す画面は損益・手数料を
      // 空に戻す（edit-controller。ここでは同じ操作を下書きに当てる）→ 本文に損益も手数料も無く、snapshot は口座 D の値
      accountScene(
        'A9',
        { ...E1, record: { ...E1.record, fees: [{ label: '手数料', amountYen: 100 }] } },
        'ACCOUNT_A',
        [ONE, ACC_A, ACC_D],
        [ONE, ACC_A, ACC_D],
        [
          FIXED,
          { type: 'set', field: 'accountId', value: 'ACCOUNT_D' },
          { type: 'set', field: 'pnlYen', value: '' },
          { type: 'set', field: 'feeYen', value: '' },
        ],
      ),
    ],
  };
}

describe('直す画面の本文の fixture（AC-4・KEEP-1）', () => {
  it('fixture は今の直す画面が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('#165 AC-11（E17）: 取消・未設定の取引は、何も変えずに保存すると本文の値が元と同じ', () => {
    const t = Object.fromEntries(build().trades.map((x) => [x.name, x]));
    expect(t.cancelled?.body.lcMove).toEqual({ kind: 'cancelled' });
    expect(t.cancelled?.body.stopOrderPlaced).toBe('placed');
    expect(t.cancelled?.expect.grade).toBe('B');
    expect(t.stopNotPlaced?.body.stopOrderPlaced).toBe('notPlaced');
    expect(t.stopNotPlaced?.body.lcMove).toEqual(t.stopNotPlaced?.original.lcMove);
  });

  it('#47 A4・B7: 付け替え = 付け替え先の今の資金で 2.5%・B、付け替えない = 写した資金のまま 0.5%・A', () => {
    const [a4, b7, a9] = build().accountScenes;
    expect(a4?.body.accountId).toBe('ACCOUNT_B');
    expect(a4?.expect).toEqual({
      capitalYen: 200_000,
      accountCurrency: 'JPY',
      grade: 'B',
      riskPct: 2.5,
    });
    // A9（#47 PR-2）: 損益・手数料が本文に無く、口座 D の USD・資金 10,000 で写し直す
    expect(a9?.original.statementPnlYen).toBe(-5_000);
    expect(a9?.body.statementPnlYen).toBeUndefined();
    expect(a9?.body.fees).toEqual([]);
    expect(a9?.body.accountId).toBe('ACCOUNT_D');
    expect(a9?.expect.capitalYen).toBe(10_000);
    expect(a9?.expect.accountCurrency).toBe('USD');
    expect(b7?.original.accountId).toBeUndefined();
    // 口座が 2 個なので本文には口座 1（既定）が入るが、付け替えではない
    expect(b7?.body.accountId).toBe('default');
    expect(b7?.expect.capitalYen).toBe(1_000_000);
    expect(b7?.expect.grade).toBe('A');
    expect(b7?.expect.riskPct).toBeCloseTo(0.5, 12);
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
