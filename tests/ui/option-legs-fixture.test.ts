// オプションのポジション（足つきの取引。Issue #116・設計書 4.7・C46・C54・ADR-0020）の、共有の合成の fixture
// `tests/fixtures/records/option-legs.json`。値・名前はすべて架空（架空の指数 XYZ・ABC のオプション）。
// API のテスト（api/tests/test_option_legs.py）が同じ fixture を本物の API に通し、POST / GET / PUT / 範囲の一覧で
// record が値と型を変えずに往復すること・snapshot が期待どおりなこと・legacyEdit（足を知らない画面が作る本文）の PUT が
// 409 で足を落とさないことを確かめる（EPIC #120 の終了条件 4・4b）。#117 の画面の本文（screenCreate = 記録する画面で手で
// 入れたポジション、screenEdits = 直す画面で開いて何も変えずに保存した本文）も、API のテストが本物に通す（201 / 200）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/option-legs-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { positionExitOrderType } from '../../core/option';
import type {
  InstrumentBody,
  InstrumentRecord,
  SettingsBody,
  StoredTrade,
  TradeRecord,
  TradeSnapshot,
} from '../../core/record';
import { toTradeInput } from '../../core/record';
import type { Leg } from '../../core/trade';
import { draftFromStored, editContext, mergeEdit } from '../../ui/src/lib/edit-form';
import { EMPTY_LEG } from '../../ui/src/lib/legs-form';
import { EMPTY_DRAFT, readDraft } from '../../ui/src/lib/record-form';
import { fillFromRow, parseReadResponse } from '../../ui/src/lib/statement-fill';
import { syncExpiry, unitLegs, unitRow } from '../../ui/src/lib/statement-positions';
import { OPT_A1, OPT_A2, optionRowJson, statementBody } from './helpers/statement-rows';

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
const FIXTURE = new URL('../fixtures/records/option-legs.json', import.meta.url);
/** API が決める銘柄の ID の印（テストが足した銘柄の ID に置き換える） */
const PLACEHOLDER = 'INSTRUMENT';
/** 記録する画面の本文（screenCreate）の決済の時刻。日本時間 2027-01-06 13:30 */
const SCREEN_EXIT_TIME = 1_799_209_800_000;

// 時点（日本時間）。満期で消えた足の決済の時刻は SQ の日の日本時間の終わり（翌日 0 時の 1 ms 前。設計書 C54）
const OPEN_0900 = 1_799_020_800_000; // 2027-01-04 09:00
const OPEN_0901 = 1_799_020_860_000;
const OPEN_0902 = 1_799_020_920_000;
const CLOSE_1330 = 1_799_209_800_000; // 2027-01-06 13:30
const CLOSE_1331 = 1_799_209_860_000;
const CLOSE_1332 = 1_799_209_920_000;
const SQ_2027_01 = 1_799_420_399_999; // 2027-01-08（1 月限の SQ の日）の終わり
const SQ_2027_02 = 1_802_444_399_999; // 2027-02-12（2 月限の SQ の日）の終わり
const CLOSE_0118 = 1_800_234_000_000; // 2027-01-18 10:00

interface Item {
  readonly name: string;
  readonly instrument: InstrumentBody;
  /** 既定の口座の資金・許容リスク（API のテストが PUT /api/accounts/default で入れる） */
  readonly settings: SettingsBody;
  readonly record: TradeRecord;
  /** API が作るときに写す値 */
  readonly snapshot: TradeSnapshot;
  /** 計算の結果（toTradeInput → evaluateTrade） */
  readonly expect: {
    readonly grade: string;
    readonly r: number | null;
    readonly oneR: number | null;
    readonly oneRSource: string | null;
    readonly pnlYen: number | null;
    /** 足の決済の時点から導いた注文の種類（C54） */
    readonly orderType: string;
  };
}

interface Fixture {
  readonly items: readonly Item[];
  /**
   * 足を知らない画面（#117 より前の直す画面・切り戻した後・古いタブ）が P1 を開いて何も変えずに保存したときの本文
   * （#117 の直す画面の本文から legs・riskPlan・lcLossPlanYen を落としたもの = 前の直す画面の本文と同じ）。API は 409 で止める
   */
  readonly legacyEdit: { readonly of: string; readonly body: TradeRecord };
  /** 記録する画面で手で入れたポジション（#117。readDraft の本文 + 銘柄の ID の印）。API は 201 で値を変えずに保存する */
  readonly screenCreate: { readonly instrument: InstrumentBody; readonly body: TradeRecord };
  /** 直す画面（#117）で各件を開いて何も変えずに保存した本文。元の記録と同じで、API は 200 */
  readonly screenEdits: readonly { readonly of: string; readonly body: TradeRecord }[];
  /**
   * 明細から読んだポジション（#118）: 読み取りの行 2 本（時刻つき・最後の決済は逆指値）+ 手で追加した決済の足 1 本 +
   * 手で追加した満期で消えた売り 1 本。注文の種類は満期（SQ）・決済の理由はその他・明細の損益は足した後の値。API は 201
   */
  readonly statementCreate: { readonly instrument: InstrumentBody; readonly body: TradeRecord };
}

const settings: SettingsBody = {
  capitalYen: 10_000_000,
  riskTolerancePct: 1,
  performanceUnit: 'R',
};

const XYZ: InstrumentBody = {
  name: '架空指数XYZオプション',
  underlying: 'XYZ',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'JPY',
  multiplier: 1_000,
  quantityStep: 1,
};

const ABC: InstrumentBody = {
  name: '架空指数ABCオプション',
  underlying: 'ABC',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'USD',
  multiplier: 100,
  quantityStep: 1,
};

function snapshotOf(i: InstrumentBody): TradeSnapshot {
  return {
    instrument: {
      multiplier: i.multiplier ?? 1,
      quantityStep: i.quantityStep ?? 1,
      priceCurrency: i.priceCurrency ?? null,
      underlyingKind: i.underlyingKind ?? 'other',
      productForm: i.productForm ?? 'spotCfd',
    },
    capitalYen: settings.capitalYen,
    riskTolerancePct: settings.riskTolerancePct,
    accountCurrency: 'JPY',
  };
}

const BASE = {
  status: 'closed',
  source: 'manual',
  instrumentId: PLACEHOLDER,
  lcBasis: 'chart',
  stopOrderPlaced: 'unanswered',
  lcDecidedBeforeEntry: true,
  lcMove: { kind: 'none' },
  timeframeChange: 'none',
} as const satisfies Partial<TradeRecord>;

// P1: 向き L・建てたときの原資産 38,500・LC 37,800（崩れの条件つき）・決済したときの原資産 37,700（LC に当たって全足を決済）。
// 足 3 本（プットの買い・プットの売り 2 枚・コールの買い）。明細の損益 −71,100 円・手数料 1,100 円・見込み 80,000 円
const p1Legs: readonly [Leg, ...Leg[]] = [
  {
    id: 'l1',
    optionType: 'P',
    contractMonth: '2027-01',
    strike: 37_000,
    side: 'buy',
    quantity: 1,
    entry: { price: 300, time: OPEN_0900 },
    exit: { price: 520, time: CLOSE_1330, kind: 'closed' },
  },
  {
    id: 'l2',
    optionType: 'P',
    contractMonth: '2027-01',
    strike: 36_000,
    side: 'sell',
    quantity: 2,
    entry: { price: 120, time: OPEN_0901 },
    exit: { price: 200, time: CLOSE_1331, kind: 'closed' },
  },
  {
    id: 'l3',
    optionType: 'C',
    contractMonth: '2027-01',
    strike: 40_000,
    side: 'buy',
    quantity: 1,
    entry: { price: 150, time: OPEN_0902 },
    exit: { price: 20, time: CLOSE_1332, kind: 'closed' },
  },
];
const p1: TradeRecord = {
  ...BASE,
  side: 'L',
  timeframe: '1h',
  lc: 37_800,
  brokenCondition: '37,800 を割ったら押し目の根拠が崩れる',
  tp: 39_500,
  thesis: '架空の押し目の根拠',
  stopOrderPlaced: 'placed',
  entries: [{ time: OPEN_0900, price: 38_500, quantity: 1 }],
  exit: {
    time: CLOSE_1332,
    price: 37_700,
    orderType: 'stop',
    reason: 'lc',
    gapSlip: 'no',
    review: '架空の総評',
  },
  statementPnlYen: -71_100,
  fees: [{ label: '手数料', amountYen: 1_100 }],
  legs: p1Legs,
  lcLossPlanYen: 80_000,
};

// P2: 売りのプットの裸 1 本を SQ まで持って満期で消滅（OTM・決済値 0）。決済の時点は SQ（注文の種類は満期（SQ））。
// 時刻は建てた時刻だけ（足の建てた時刻は無し = 任意）
const p2: TradeRecord = {
  ...BASE,
  side: 'L',
  lc: 37_500,
  entries: [{ time: OPEN_0900, price: 38_500, quantity: 1 }],
  exit: {
    time: SQ_2027_01,
    price: 38_900,
    orderType: 'expiry',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  fees: [],
  legs: [
    {
      id: 'l1',
      optionType: 'P',
      contractMonth: '2027-01',
      strike: 37_000,
      side: 'sell',
      quantity: 1,
      entry: { price: 250 },
      exit: { price: 0, time: SQ_2027_01, kind: 'expired' },
    },
  ],
};

// P3: 「最大損失まで」（LC なし）のコールの買いのスプレッド。すべて決済・明細の損益なし（足の合計）。時刻なし
const p3: TradeRecord = {
  ...BASE,
  side: 'L',
  entries: [{ price: 38_500, quantity: 1 }],
  exit: {
    time: CLOSE_1332,
    price: 39_300,
    orderType: 'limit',
    reason: 'tp',
    gapSlip: 'unanswered',
  },
  fees: [],
  legs: [
    {
      id: 'l1',
      optionType: 'C',
      contractMonth: '2027-01-15',
      strike: 39_000,
      side: 'buy',
      quantity: 1,
      entry: { price: 400 },
      exit: { price: 700, kind: 'closed' },
    },
    {
      id: 'l2',
      optionType: 'C',
      contractMonth: '2027-01-15',
      strike: 40_000,
      side: 'sell',
      quantity: 1,
      entry: { price: 150 },
      exit: { price: 250, kind: 'closed' },
    },
  ],
  riskPlan: 'maxLoss',
};

// P4: 価格の通貨 USD・円の口座（為替 150）。向き S（LC 5,100 は建てたときの原資産 5,000 より上）。プットの買いを決済し、
// 先の限月のプットの買いは満期で消滅（買いの SQ はポジションの決済より後でよい。C54）。明細の損益は決済した足の分
const p4: TradeRecord = {
  ...BASE,
  side: 'S',
  lc: 5_100,
  entries: [{ time: OPEN_0900, price: 5_000, quantity: 1 }],
  exit: {
    time: CLOSE_0118,
    price: 4_800,
    fxRate: 150,
    orderType: 'market',
    reason: 'brokeManual',
    gapSlip: 'no',
  },
  statementPnlYen: 1_049_500,
  fees: [{ label: '手数料', amountYen: 500 }],
  legs: [
    {
      id: 'l1',
      optionType: 'P',
      contractMonth: '2027-01',
      strike: 4_900,
      side: 'buy',
      quantity: 1,
      entry: { price: 50, time: OPEN_0900 },
      exit: { price: 120, time: CLOSE_0118, kind: 'closed' },
    },
    {
      id: 'l2',
      optionType: 'P',
      contractMonth: '2027-02',
      strike: 4_700,
      side: 'buy',
      quantity: 1,
      entry: { price: 20, time: OPEN_0901 },
      exit: { price: 0, time: SQ_2027_02, kind: 'expired' },
    },
  ],
};

function item(name: string, instrument: InstrumentBody, record: TradeRecord): Item {
  const snapshot = snapshotOf(instrument);
  const ev = evaluateTrade(toTradeInput({ record, snapshot }));
  if (!ev.ok) throw new Error(`${name}: 受け付けられなかった ${JSON.stringify(ev.issues)}`);
  // 判定が使う注文の種類（足の決済の時点から導き直した値。C54）
  const orderType = positionExitOrderType(record.legs ?? [], record.exit.orderType);
  return {
    name,
    instrument,
    settings,
    record,
    snapshot,
    expect: {
      grade: ev.judgment?.grade ?? '',
      r: ev.r ?? null,
      oneR: ev.oneRYen ?? null,
      oneRSource: ev.oneRSource ?? null,
      pnlYen: ev.pnlYen ?? null,
      orderType,
    },
  };
}

function screenEdit(of: Item): { readonly of: string; readonly body: TradeRecord } {
  const instrument: InstrumentRecord = {
    id: PLACEHOLDER,
    name: of.instrument.name,
    underlyingKind: of.snapshot.instrument.underlyingKind,
    productForm: of.snapshot.instrument.productForm,
    priceCurrency: of.snapshot.instrument.priceCurrency,
    multiplier: of.snapshot.instrument.multiplier,
    quantityStep: of.snapshot.instrument.quantityStep,
    createdAt: 1,
    updatedAt: 1,
  };
  const trade: StoredTrade = {
    id: 'T1',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    snapshot: of.snapshot,
    record: of.record,
  };
  const draft = draftFromStored(trade, [instrument]);
  const read = readDraft(draft, editContext(trade, [instrument]));
  if (!read.body) throw new Error(`${of.name}: 直す画面で本文が作れない`);
  return { of: of.name, body: mergeEdit(trade.record, draft, draft, read.body, PLACEHOLDER) };
}

function legacyEdit(of: Item): Fixture['legacyEdit'] {
  const { legs: _l, riskPlan: _r, lcLossPlanYen: _p, ...body } = screenEdit(of).body;
  return { of: of.name, body };
}

/**
 * 記録する画面で手で入れるポジション（設計書 5.7 の (3) の例と同じ形・架空）: 建てたとき 38,500・決済 39,100・LC 37,800、
 * P 37,000 買い 1（300 → 180）・P 36,000 売り 2（120 → 60）・C 40,000 買い 1（80 → 150）、限月 2027-01
 */
function screenCreate(): Fixture['screenCreate'] {
  const instrument: InstrumentRecord = {
    id: PLACEHOLDER,
    name: XYZ.name,
    underlyingKind: 'index',
    productForm: 'option',
    priceCurrency: 'JPY',
    multiplier: 1_000,
    quantityStep: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const leg = (o: Partial<typeof EMPTY_LEG>) => ({ ...EMPTY_LEG, contractMonth: '2027-01', ...o });
  const read = readDraft(
    {
      ...EMPTY_DRAFT,
      instrumentName: XYZ.name,
      entryPrice: '38500',
      exitPrice: '39100',
      exitTime: '2027-01-06T13:30',
      lc: '37800',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange: 'none',
      legs: [
        leg({
          optionType: 'P',
          strike: '37000',
          side: 'buy',
          quantity: '1',
          entryPrice: '300',
          exitPrice: '180',
        }),
        leg({
          optionType: 'P',
          strike: '36000',
          side: 'sell',
          quantity: '2',
          entryPrice: '120',
          exitPrice: '60',
        }),
        leg({
          optionType: 'C',
          strike: '40000',
          side: 'buy',
          quantity: '1',
          entryPrice: '80',
          exitPrice: '150',
        }),
      ],
    },
    { instruments: [instrument], accounts: [] },
  );
  if (!read.body) throw new Error('記録する画面で本文が作れない');
  // datetime-local の読みは端末の時間帯に依るので、決済の時刻は決まった時点（日本時間 2027-01-06 13:30）に置き換える
  return {
    instrument: XYZ,
    body: {
      ...read.body,
      instrumentId: PLACEHOLDER,
      exit: { ...read.body.exit, time: SCREEN_EXIT_TIME },
    },
  };
}

/**
 * 明細から読んだポジション（#118・架空）: P 36,000 売り 2（240 → 110。明細の損益 +259,000）・P 35,500 買い 2（150 → 70。
 * −161,000。逆指値で決済）を読み、P 35,000 買い 1（50 → 20 = −30,000）を手で足し、P 34,000 売り 1（30・満期で消滅）を足す。
 * 明細の損益 = 98,000 − 30,000 = 68,000、決済の時点は満期で消えた売り（SQ）→ 注文の種類 expiry
 */
function statementCreate(): Fixture['statementCreate'] {
  const instrument: InstrumentRecord = {
    id: PLACEHOLDER,
    name: XYZ.name,
    underlyingKind: 'index',
    productForm: 'option',
    priceCurrency: 'JPY',
    multiplier: 1_000,
    quantityStep: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const parsed = parseReadResponse(
    statementBody([
      optionRowJson({ ...OPT_A1, underlying: XYZ.name }),
      optionRowJson({ ...OPT_A2, underlying: XYZ.name, order: 'stop' }),
    ]),
  );
  const row = parsed && unitRow(parsed.rows, [0, 1]);
  if (!row) throw new Error('明細の行が読めない');
  const filled = fillFromRow(EMPTY_DRAFT, row, new Set());
  const leg = (o: Partial<typeof EMPTY_LEG>) => ({ ...EMPTY_LEG, contractMonth: '2027-01', ...o });
  const draft = {
    ...filled.draft,
    entryPrice: '38500',
    exitPrice: '37200',
    lc: '37800',
    lcDecided: true,
    lcMove: 'none' as const,
    timeframeChange: 'none' as const,
    legs: [
      ...unitLegs([], row, null),
      leg({
        optionType: 'P',
        strike: '35000',
        side: 'buy',
        quantity: '1',
        entryPrice: '50',
        exitPrice: '20',
      }),
      leg({
        optionType: 'P',
        strike: '34000',
        side: 'sell',
        quantity: '1',
        entryPrice: '30',
        exitPrice: '0',
        expired: true,
      }),
    ],
  };
  const synced = syncExpiry(draft, filled.marks, new Set(), row, null);
  const read = readDraft(synced.draft, { instruments: [instrument], accounts: [] });
  if (!read.body) throw new Error('明細から本文が作れない');
  return { instrument: XYZ, body: { ...read.body, instrumentId: PLACEHOLDER } };
}

function build(): Fixture {
  const items = [
    item('P1', XYZ, p1),
    item('P2', XYZ, p2),
    item('P3', XYZ, p3),
    item('P4', ABC, p4),
  ];
  return {
    items,
    legacyEdit: legacyEdit(items[0] as Item),
    screenCreate: screenCreate(),
    screenEdits: items.map(screenEdit),
    statementCreate: statementCreate(),
  };
}

describe('足つきの取引の共有の fixture（option-legs.json。#116）', () => {
  const built = build();

  it('fixture が場面から作った値と一致する', () => {
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    const onDisk = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Fixture;
    expect(onDisk).toEqual(built);
  });

  it('各件の写し: option に足（と見込み）が入り、計算が受け付ける', () => {
    const onDisk = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Fixture;
    expect(onDisk.items.map((x) => x.name)).toEqual(['P1', 'P2', 'P3', 'P4']);
    for (const x of onDisk.items) {
      const input = toTradeInput(x);
      expect(input.option?.legs, x.name).toEqual(x.record.legs);
      expect(input.option?.lcLossPlanYen, x.name).toBe(x.record.lcLossPlanYen);
      expect(input.option?.riskPlan, x.name).toBe(x.record.riskPlan);
      // JSON を往復した保存の形（API が返すのと同じ）から計算しても、fixture の期待と同じ判定・数
      const ev = evaluateTrade(input);
      if (!ev.ok) throw new Error(`${x.name}: 受け付けられなかった`);
      expect(ev.judgment?.grade ?? '', x.name).toBe(x.expect.grade);
      expect(ev.r ?? null, x.name).toBe(x.expect.r);
      expect(ev.oneRYen ?? null, x.name).toBe(x.expect.oneR);
      expect(ev.oneRSource ?? null, x.name).toBe(x.expect.oneRSource);
      expect(ev.pnlYen ?? null, x.name).toBe(x.expect.pnlYen);
    }
  });

  it('P1: 見込みの 1R 80,000 円・損益 −71,100 円・R = −70,000 ÷ 80,000 = −0.875・LC で切った負け = A', () => {
    const p = built.items[0]?.expect;
    // 手数料を除いた損益 = −71,100 + 1,100 = −70,000 円（明細の損益があり、満期で消えた足は無い）
    expect(p?.oneRSource).toBe('plan');
    expect(p?.oneR).toBe(80_000);
    expect(p?.pnlYen).toBe(-71_100);
    expect(p?.r).toBeCloseTo(-0.875, 12);
    expect(p?.grade).toBe('A');
  });

  it('P2: 満期で消えた売りで決済の時点が SQ → 注文の種類は満期（SQ）。損益 = 250 × 1 × 1,000 = 250,000 円', () => {
    const p = built.items[1]?.expect;
    expect(p?.orderType).toBe('expiry');
    expect(p?.pnlYen).toBe(250_000);
  });

  it('P3: 「最大損失まで」→ 1R = 最大損失 (400 − 150) × 1,000 = 250,000 円・損益 +200,000 円・R = +0.8', () => {
    const p = built.items[2]?.expect;
    // 最大損失は原資産が 39,000 以下で、払った差 250 × 乗数 1,000（C50）。損益 = (700 − 400 − (250 − 150)) × 1,000
    expect(p?.oneRSource).toBe('maxLoss');
    expect(p?.oneR).toBeCloseTo(250_000, 6);
    expect(p?.pnlYen).toBe(200_000);
    expect(p?.r).toBeCloseTo(0.8, 12);
    // LC が無いことでは C にしない（C50）。危ない勝ちの理由は過剰リスク（250,000 ÷ 10,000,000 = 2.5% > 1%）だけで、
    // LC 無し（noLc）・持ち続けた（heldPastLc。「最大損失まで」は見ない）は付かない
    expect(p?.grade).toBe('riskyWin');
    const item = built.items[2];
    if (item === undefined) throw new Error('P3 が無い');
    const ev = evaluateTrade(toTradeInput(item));
    if (!ev.ok) throw new Error('P3 が受け付けられなかった');
    const reasons = ev.judgment?.reasons ?? [];
    expect(reasons.map((r) => r.kind)).toEqual(['overRisk']);
    expect(reasons[0]).toEqual({ kind: 'overRisk', riskPct: expect.closeTo(2.5, 12) });
    expect(ev.riskPct).toBeCloseTo(2.5, 12);
  });

  it('P4: 損益 = 明細 1,049,500 円 + 満期で消えた買い −20 × 1 × 100 × 150 = 749,500 円', () => {
    const p = built.items[3]?.expect;
    expect(p?.pnlYen).toBe(749_500);
  });

  it('直す画面（#117）で開いて何も変えずに保存した本文は、元の記録と同じ（足・見込み・「最大損失まで」を落とさない）', () => {
    for (const e of built.screenEdits) {
      const of = built.items.find((x) => x.name === e.of);
      expect(e.body, e.of).toEqual(of?.record);
    }
  });

  it('記録する画面で手で入れたポジション: 足 3 本・数量 1・向き L（LC から）・1R は満期の損益から 140,000 円・+0.5R・計画どおりの勝ち', () => {
    const b = built.screenCreate.body;
    expect(b.legs?.map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(b.entries).toEqual([{ price: 38_500, quantity: 1 }]);
    expect(b.side).toBe('L');
    expect(b.exit.orderType).toBe('unknown');
    expect('riskPlan' in b).toBe(false);
    expect('lcLossPlanYen' in b).toBe(false);
    const ev = evaluateTrade(toTradeInput({ record: b, snapshot: snapshotOf(XYZ) }));
    if (!ev.ok) throw new Error('受け付けられなかった');
    // 損益 = (180 − 300) × 1,000 − (60 − 120) × 2 × 1,000 + (150 − 80) × 1,000 = −120,000 + 120,000 + 70,000
    expect(ev.pnlYen).toBe(70_000);
    expect(ev.oneRSource).toBe('expiry');
    expect(ev.oneRYen).toBe(140_000);
    expect(ev.r).toBeCloseTo(0.5, 12);
    expect(ev.judgment?.grade).toBe('safeWin');
  });

  it('明細から読んだポジション（#118）: 足 4 本・時刻は読み取りの 2 本だけ・満期（SQ）・明細の損益 68,000', () => {
    const b = built.statementCreate.body;
    expect(b.source).toBe('statement');
    expect(b.legs?.map((l) => [l.id, l.exit.kind, l.entry.time !== undefined])).toEqual([
      ['l1', 'closed', true],
      ['l2', 'closed', true],
      ['l3', 'closed', false],
      ['l4', 'expired', false],
    ]);
    expect(b.statementPnlYen).toBe(68_000);
    expect(b.fees).toEqual([{ amountYen: 2_000 }]);
    expect(b.exit).toMatchObject({ orderType: 'expiry', reason: 'other' });
    expect(b.stopOrderPlaced).toBe('unanswered');
    // 時刻の無い決済の足（手で追加した）があるので決済の時点は決まらず、決済の時刻は明細の値のまま。注文の種類は満期で
    // 消えた売りがあるので満期（SQ。C54 の救わない側）
    expect(b.exit.time).toBe(OPT_A2.closed.epochMs);
    const ev = evaluateTrade(toTradeInput({ record: b, snapshot: snapshotOf(XYZ) }));
    if (!ev.ok) throw new Error('受け付けられなかった');
    // 損益 = 明細の損益 68,000 + 満期で消えた売り +30 × 1 × 1,000 = 98,000
    expect(ev.pnlYen).toBe(98_000);
  });

  it('足を知らない画面の本文は legs・riskPlan・lcLossPlanYen を落とす → API が 409 で止める（守り (b)）', () => {
    const body = built.legacyEdit.body;
    expect(built.legacyEdit.of).toBe('P1');
    expect('legs' in body).toBe(false);
    expect('lcLossPlanYen' in body).toBe(false);
    expect('riskPlan' in body).toBe(false);
    // ほかの欄は元の記録のまま（落とすのは足を知らない欄だけ）
    expect(body.lc).toBe(p1.lc);
    expect(body.entries).toEqual(p1.entries);
    expect(body.exit.price).toBe(p1.exit.price);
  });
});
