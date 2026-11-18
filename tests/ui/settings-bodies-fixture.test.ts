// 設定の画面が作る本文の、共有の合成の fixture（Issue #5 AC-1・AC-2・AC-4・AC-5・AC-6・KEEP-4、#47 の口座）。
// 値・名前はすべて架空。口座は設定の画面の足す・直す欄と、記録する画面のその場で足す 2 欄が作る本文。
// 設定（/api/settings）の場面は表示の単位を保つ 1 つだけ（画面はもう送らない。KEEP-6）。
// API のテスト（api/tests/test_settings_screen_examples.py）が同じ fixture を本物の API に通し、受けた値が
// 画面の予想と同じことを確かめる（偽の API とのずれを塞ぐ）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/settings-bodies-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type {
  AccountBody,
  AccountPut,
  InstrumentBody,
  InstrumentRecord,
  SettingsBody,
} from '../../core/record';
import {
  type AccountDraft,
  type NewAccountDraft,
  readAccountDraft,
  readNewAccountDraft,
} from '../../ui/src/lib/accounts';
import {
  type InstrumentDraft,
  instrumentDraftOf,
  readInstrumentDraft,
  readNewInstrumentName,
} from '../../ui/src/lib/settings-form';
import { defaultAccount } from './helpers/accounts';

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
const FIXTURE = new URL('../fixtures/records/settings-bodies.json', import.meta.url);

const SET_1M: SettingsBody = { capitalYen: 1_000_000, riskTolerancePct: 1, performanceUnit: 'R' };
/** 移し替えた直後の既定の口座（設定の資金 1,000,000・1%） */
const ONE = defaultAccount(1_000_000);

/** 自動で足されたままの銘柄（名前だけで足した既定） */
const AUTO: InstrumentRecord = {
  id: 'auto',
  name: 'US30',
  underlyingKind: 'other',
  productForm: 'spotCfd',
  priceCurrency: null,
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
};

interface SettingsItem {
  readonly name: string;
  /** 保存の前の設定（API にこの値を先に入れる） */
  readonly before: SettingsBody;
  readonly body: SettingsBody;
}

interface AccountItem {
  readonly name: string;
  /** create = POST /api/accounts（設定の足す欄・記録する画面の 2 欄）、update = PUT /api/accounts/default */
  readonly kind: 'create' | 'update';
  readonly body: AccountBody | AccountPut;
}

interface InstrumentItem {
  readonly name: string;
  /** 直す前の銘柄（API に名前だけで足す。null = 足す本文そのもの） */
  readonly before: InstrumentBody | null;
  readonly body: InstrumentBody;
}

function addItem(name: string, d: AccountDraft): AccountItem {
  const r = readAccountDraft(d, [ONE], null, null);
  if (!r.body) throw new Error(`${name} が保存できる下書きでない`);
  return { name, kind: 'create', body: r.body };
}

function editItem(name: string, d: AccountDraft): AccountItem {
  const r = readAccountDraft(d, [ONE], ONE.id, ONE.capitalYen);
  if (!r.body) throw new Error(`${name} が保存できる下書きでない`);
  return { name, kind: 'update', body: r.body };
}

function recordAddItem(name: string, d: NewAccountDraft): AccountItem {
  const r = readNewAccountDraft(d, [ONE]);
  if (!r.body) throw new Error(`${name} が足せる下書きでない`);
  return { name, kind: 'create', body: r.body };
}

function instrumentItem(name: string, over: Partial<InstrumentDraft>): InstrumentItem {
  const r = readInstrumentDraft({ ...instrumentDraftOf(AUTO), ...over }, [AUTO], AUTO.id);
  if (!r.body) throw new Error(`${name} が保存できる下書きでない`);
  return { name, before: { name: AUTO.name }, body: r.body };
}

function build(): {
  settings: SettingsItem[];
  accounts: AccountItem[];
  instruments: InstrumentItem[];
} {
  const gold = readNewInstrumentName('GOLD', [AUTO]);
  if (!gold.ok) throw new Error('GOLD が足せない');
  return {
    // 表示の単位を円にしてある利用者の設定の PUT（画面は送らないが、API の形を保つ。KEEP-6）
    settings: [
      {
        name: 'KEEP-6',
        before: { ...SET_1M, performanceUnit: 'yen' },
        body: { ...SET_1M, capitalYen: 800_000, performanceUnit: 'yen' },
      },
    ],
    accounts: [
      addItem('E1', { name: '口座 A', capital: '1,000,000', risk: '1' }),
      addItem('E2', { name: '口座 B', capital: '１２０００００', risk: '1' }),
      addItem('E3b', { name: '口座 C', capital: '', risk: '1.5' }),
      addItem('A7', { name: '口座 E', capital: '1,000,000', risk: '2.5' }),
      editItem('edit', { name: '口座 1 改', capital: '800,000', risk: '1' }),
      recordAddItem('B5', { name: '口座 F', capital: '300,000' }),
    ],
    instruments: [
      instrumentItem('E9', { underlyingKind: 'index', priceCurrency: 'USD', quantityStep: '0.1' }),
      instrumentItem('E12', { priceCurrency: 'usd' }),
      instrumentItem('full', {
        underlying: '架空指数',
        underlyingKind: 'commodity',
        productForm: 'future',
        priceCurrency: 'jpy',
        multiplier: '100',
        quantityStep: '0.01',
      }),
      { name: 'E13', before: null, body: { name: gold.value } },
    ],
  };
}

describe('設定の画面が作る本文の fixture（AC-1・AC-5・AC-6）', () => {
  it('fixture は今の純関数が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it('例の値（E1 = 1,000,000・E2 = 1,200,000・E3b = 資金 null・B5 = 名前と資金だけ・E12 = USD・E13 = 名前だけ）', () => {
    const b = build();
    const a = Object.fromEntries(b.accounts.map((x) => [x.name, x.body]));
    expect(a.E1?.capitalYen).toBe(1_000_000);
    expect(a.E2?.capitalYen).toBe(1_200_000);
    expect(a.E3b).toEqual({ name: '口座 C', capitalYen: null, riskTolerancePct: 1.5 });
    expect(a.A7?.riskTolerancePct).toBe(2.5);
    expect(a.B5).toEqual({ name: '口座 F', capitalYen: 300_000 });
    expect(b.settings.map((x) => x.body.performanceUnit)).toEqual(['yen']);
    const i = Object.fromEntries(b.instruments.map((x) => [x.name, x.body]));
    expect(i.E12?.priceCurrency).toBe('USD');
    expect(i.E13).toEqual({ name: 'GOLD' });
    expect(i.full?.priceCurrency).toBe('JPY');
  });
});
