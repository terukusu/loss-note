// 設定の画面が作る本文の、共有の合成の fixture（Issue #5 AC-1・AC-2・AC-4・AC-5・AC-6・KEEP-4）。値はすべて架空。
// API のテスト（api/tests/test_settings_screen_examples.py）が同じ fixture を本物の API に通し、受けた値が
// 画面の予想と同じことを確かめる（偽の API とのずれを塞ぐ）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/settings-bodies-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type { InstrumentBody, InstrumentRecord, SettingsBody } from '../../core/record';
import {
  type InstrumentDraft,
  instrumentDraftOf,
  readInstrumentDraft,
  readNewInstrumentName,
  readSettingsDraft,
  type SettingsDraft,
} from '../../ui/src/lib/settings-form';

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

const UNSET: SettingsBody = { capitalYen: null, riskTolerancePct: 1, performanceUnit: 'R' };
const SET_1M: SettingsBody = { capitalYen: 1_000_000, riskTolerancePct: 1, performanceUnit: 'R' };

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

interface InstrumentItem {
  readonly name: string;
  /** 直す前の銘柄（API に名前だけで足す。null = 足す本文そのもの） */
  readonly before: InstrumentBody | null;
  readonly body: InstrumentBody;
}

function settingsItem(name: string, before: SettingsBody, d: SettingsDraft): SettingsItem {
  const r = readSettingsDraft(d, before);
  if (!r.body) throw new Error(`${name} が保存できる下書きでない`);
  return { name, before, body: r.body };
}

function instrumentItem(name: string, over: Partial<InstrumentDraft>): InstrumentItem {
  const r = readInstrumentDraft({ ...instrumentDraftOf(AUTO), ...over }, [AUTO], AUTO.id);
  if (!r.body) throw new Error(`${name} が保存できる下書きでない`);
  return { name, before: { name: AUTO.name }, body: r.body };
}

function build(): { settings: SettingsItem[]; instruments: InstrumentItem[] } {
  const gold = readNewInstrumentName('GOLD', [AUTO]);
  if (!gold.ok) throw new Error('GOLD が足せない');
  return {
    settings: [
      settingsItem('E1', UNSET, { capital: '1,000,000', risk: '1' }),
      settingsItem('E2', UNSET, { capital: '１２０００００', risk: '1' }),
      settingsItem('E3b', UNSET, { capital: '', risk: '1.5' }),
      settingsItem('E7', SET_1M, { capital: '1,000,000', risk: '2.5' }),
      settingsItem(
        'KEEP-2',
        { ...SET_1M, performanceUnit: 'yen' },
        { capital: '800000', risk: '1' },
      ),
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

  it('例の値（E1 = 1,000,000・E2 = 1,200,000・E3b = 資金 null・E12 = USD・E13 = 名前だけ）', () => {
    const b = build();
    const s = Object.fromEntries(b.settings.map((x) => [x.name, x.body]));
    expect(s.E1?.capitalYen).toBe(1_000_000);
    expect(s.E2?.capitalYen).toBe(1_200_000);
    expect(s.E3b).toEqual({ capitalYen: null, riskTolerancePct: 1.5, performanceUnit: 'R' });
    expect(s['KEEP-2']?.performanceUnit).toBe('yen');
    const i = Object.fromEntries(b.instruments.map((x) => [x.name, x.body]));
    expect(i.E12?.priceCurrency).toBe('USD');
    expect(i.E13).toEqual({ name: 'GOLD' });
    expect(i.full?.priceCurrency).toBe('JPY');
  });
});
