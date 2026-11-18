// 設定の画面の純関数（Issue #5 契約「settings-form.ts」・R1〜R5・AC-2・AC-4・AC-5）。値はすべて架空。
// 口座の下書き（#47。旧「資金と許容リスク」の下書き）は tests/ui/accounts.test.ts
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { ACCOUNT_FIELD_LABEL } from '../../ui/src/lib/accounts';
import { formatAmountYen } from '../../ui/src/lib/format';
import {
  allowanceText,
  allowanceYen,
  EFFECT_NOTE,
  errorFieldsOf,
  errorFieldsText,
  historyRows,
  INSTRUMENT_FIELD_LABEL,
  type InstrumentDraft,
  instrumentDraftOf,
  instrumentSummary,
  isProvisional,
  readCapital,
  readInstrumentDraft,
  readNewInstrumentName,
  readRisk,
  riskWarning,
  SETTINGS_MSG,
  sortInstruments,
} from '../../ui/src/lib/settings-form';
import { rng } from '../core/helpers/prng';

function inst(id: string, name: string, over: Partial<InstrumentRecord> = {}): InstrumentRecord {
  return {
    id,
    name,
    underlyingKind: 'other',
    productForm: 'spotCfd',
    priceCurrency: null,
    multiplier: 1,
    quantityStep: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

const US30 = inst('i-us30', 'US30');
const N225 = inst('i-n225', '日経225', { underlyingKind: 'index', priceCurrency: 'JPY' });
const XAU = inst('i-xau', 'XAU', { underlyingKind: 'commodity', priceCurrency: 'USD' });
const LIST = [US30, N225, XAU];

describe('readCapital（R1・AC-1・AC-2）', () => {
  it.each([
    ['1,000,000', 1_000_000],
    ['1000000', 1_000_000],
    ['１２０００００', 1_200_000], // E2 全角
    ['１，２００，０００', 1_200_000],
    [' 800000 ', 800_000],
  ])('%s → %d', (raw, want) => {
    expect(readCapital(raw, null)).toEqual({ ok: true, value: want });
  });

  it.each([
    ['0', SETTINGS_MSG.capitalNotPositive],
    ['-5', SETTINGS_MSG.capitalNotPositive],
    ['1000.5', SETTINGS_MSG.capitalNotInteger],
    ['百万', SETTINGS_MSG.capitalNotNumber],
    ['1e6', SETTINGS_MSG.capitalNotNumber],
    ['1000000000001', SETTINGS_MSG.tooLarge],
  ])('E3: %s は誤り', (raw, error) => {
    expect(readCapital(raw, 1_000_000)).toEqual({ ok: false, error });
  });

  it('E3: 設定済みで空は誤り（未設定には戻せない）', () => {
    expect(readCapital('', 1_000_000)).toEqual({ ok: false, error: SETTINGS_MSG.capitalRequired });
    expect(readCapital('  ', 1_000_000)).toEqual({
      ok: false,
      error: SETTINGS_MSG.capitalRequired,
    });
  });

  it('E3b: 未設定で空は未設定のまま（null）', () => {
    expect(readCapital('', null)).toEqual({ ok: true, value: null });
  });

  it('上限ちょうど（1e12）は受ける', () => {
    expect(readCapital('1000000000000', null)).toEqual({ ok: true, value: 1e12 });
  });

  it('性質: 1〜1e12 の整数を 3 桁区切り・全角にしても同じ値に戻る', () => {
    const r = rng(5005);
    const toWide = (s: string) =>
      s.replace(/[0-9,]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    for (let i = 0; i < 500; i++) {
      const digits = r.int(1, 13);
      let n = r.int(1, 9) * 10 ** (digits - 1) + r.int(0, 10 ** Math.min(digits - 1, 6) - 1);
      n = Math.min(Math.max(1, Math.trunc(n)), 1e12);
      const grouped = formatAmountYen(n).replace('円', '');
      expect(readCapital(grouped, null), grouped).toEqual({ ok: true, value: n });
      expect(readCapital(toWide(grouped), 5)).toEqual({ ok: true, value: n });
      expect(readCapital(String(n), null)).toEqual({ ok: true, value: n });
    }
  });

  it('性質: どんな文字列でも例外を投げず、NaN を返さない', () => {
    const r = rng(77);
    const chars = ['1', '0', ',', '.', '-', '−', '１', 'e', ' ', 'あ', '+', '\u0000'];
    for (let i = 0; i < 500; i++) {
      const s = Array.from({ length: r.int(0, 8) }, () => r.pick(chars)).join('');
      const got = readCapital(s, r.bool() ? null : 1000);
      if (got.ok && got.value !== null) {
        expect(Number.isInteger(got.value), s).toBe(true);
        expect(got.value > 0, s).toBe(true);
      }
    }
  });
});

describe('readRisk・riskWarning（R3・AC-4）', () => {
  it.each([
    ['2', 2],
    ['2.5', 2.5],
    ['0.5', 0.5],
    ['3', 3],
    ['１．５', 1.5],
  ])('%s → %d', (raw, want) => {
    expect(readRisk(raw)).toEqual({ ok: true, value: want });
  });

  it.each(['0.4', '3.1', '', '  ', 'abc', '-1'])('E8: %j は誤り', (raw) => {
    expect(readRisk(raw)).toEqual({ ok: false, error: SETTINGS_MSG.risk });
  });

  it('E6・E7: 2 は警告なし、2 を超えると警告（判定 B と食い違う）', () => {
    expect(riskWarning(2)).toBeNull();
    expect(riskWarning(1)).toBeNull();
    expect(riskWarning(2.5)).toBe(SETTINGS_MSG.riskWarning);
    expect(riskWarning(3)).toBe(SETTINGS_MSG.riskWarning);
    expect(SETTINGS_MSG.riskWarning).toBe(
      '2% を超えています。このリスクで負けると、判定は B（過剰リスク）になります',
    );
  });

  it('性質: 0.5〜3 の数は保存でき、2 を超えるときだけ警告', () => {
    const r = rng(303);
    for (let i = 0; i < 500; i++) {
      const v = Math.round((0.5 + r.next() * 2.5) * 100) / 100;
      const got = readRisk(String(v));
      expect(got).toEqual({ ok: true, value: v });
      expect(riskWarning(v) !== null).toBe(v > 2);
    }
  });
});

describe('allowanceText（資金 × 許容リスク = 1 回の負けの上限）', () => {
  it('資金 1,000,000円・1% → 10,000円', () => {
    expect(allowanceText(1_000_000, 1)).toBe(
      'これから記録する取引にリスク（%）が表示されます。許容リスク 1% なら、1 回の負けは 10,000円 までです',
    );
  });
  it('資金 1,000,000円・1.5% → 15,000円', () => {
    expect(allowanceText(1_000_000, 1.5)).toContain('1 回の負けは 15,000円 まで');
  });
  it('資金が無ければ null', () => {
    expect(allowanceText(null, 1)).toBeNull();
  });
});

describe('historyRows（R2・AC-3）', () => {
  it('E5: API の古い順を新しい順にする', () => {
    const rows = historyRows([
      { valueYen: 1_000_000, at: 1 },
      { valueYen: 800_000, at: 2 },
      { valueYen: 900_000, at: 3 },
    ]);
    expect(rows.map((r) => r.valueYen)).toEqual([900_000, 800_000, 1_000_000]);
    expect(rows.map((r) => r.at)).toEqual([3, 2, 1]);
  });
  it('空は空', () => {
    expect(historyRows([])).toEqual([]);
  });
});

describe('銘柄の下書き（R4・AC-5）', () => {
  const draftOf = (over: Partial<InstrumentDraft>, base = US30): InstrumentDraft => ({
    ...instrumentDraftOf(base),
    ...over,
  });

  it('下書きの初期値は保存値（通貨の未設定は空、数は指数表記にしない）', () => {
    expect(instrumentDraftOf(US30)).toEqual({
      name: 'US30',
      underlying: '',
      underlyingKind: 'other',
      productForm: 'spotCfd',
      priceCurrency: '',
      multiplier: '1',
      quantityStep: '1',
    });
    expect(
      instrumentDraftOf(inst('a', 'B', { quantityStep: 1e-7, underlying: 'X' })),
    ).toMatchObject({ quantityStep: '0.0000001', underlying: 'X' });
  });

  it('E9: 株価指数・USD・乗数 1・刻み 0.1 → 7 欄の本文（原資産が空なら省く）', () => {
    const got = readInstrumentDraft(
      draftOf({ underlyingKind: 'index', priceCurrency: 'USD', quantityStep: '0.1' }),
      LIST,
      US30.id,
    );
    expect(got.errors).toEqual({});
    expect(got.body).toEqual({
      name: 'US30',
      underlyingKind: 'index',
      productForm: 'spotCfd',
      priceCurrency: 'USD',
      multiplier: 1,
      quantityStep: 0.1,
    });
  });

  it('原資産は trim して入れる。通貨の空は null', () => {
    const got = readInstrumentDraft(
      draftOf({ underlying: ' ダウ平均 ', priceCurrency: '  ' }),
      LIST,
      US30.id,
    );
    expect(got.body).toMatchObject({ underlying: 'ダウ平均', priceCurrency: null });
  });

  it('E10: 別の銘柄の名前を「日経２２５ 」に → 同じ名前の銘柄があります', () => {
    const got = readInstrumentDraft(draftOf({ name: '日経２２５ ' }), LIST, US30.id);
    expect(got.body).toBeNull();
    expect(got.errors.name).toBe(SETTINGS_MSG.duplicateName);
    expect(SETTINGS_MSG.duplicateName).toBe('同じ名前の銘柄があります');
  });

  it('自分自身の名前（大文字小文字・空白の違い）は重複でない', () => {
    const got = readInstrumentDraft(draftOf({ name: ' us30 ' }), LIST, US30.id);
    expect(got.errors).toEqual({});
    expect(got.body?.name).toBe('us30');
  });

  it('重複は大文字小文字・全角を同じとみなす', () => {
    expect(readInstrumentDraft(draftOf({ name: 'ｘａｕ' }), LIST, US30.id).errors.name).toBe(
      SETTINGS_MSG.duplicateName,
    );
  });

  it('E11: 乗数 0・刻み -1・通貨 US → 欄ごとの誤り', () => {
    const got = readInstrumentDraft(
      draftOf({ multiplier: '0', quantityStep: '-1', priceCurrency: 'US' }),
      LIST,
      US30.id,
    );
    expect(got.body).toBeNull();
    expect(got.errors).toEqual({
      multiplier: SETTINGS_MSG.notPositive,
      quantityStep: SETTINGS_MSG.notPositive,
      priceCurrency: SETTINGS_MSG.currency,
    });
  });

  it('E12: 通貨 usd → USD（全角も）', () => {
    expect(
      readInstrumentDraft(draftOf({ priceCurrency: 'usd' }), LIST, US30.id).body?.priceCurrency,
    ).toBe('USD');
    expect(
      readInstrumentDraft(draftOf({ priceCurrency: 'ｊｐｙ' }), LIST, US30.id).body?.priceCurrency,
    ).toBe('JPY');
  });

  it.each([
    ['', SETTINGS_MSG.nameRequired],
    ['   ', SETTINGS_MSG.nameRequired],
    ['あ'.repeat(41), SETTINGS_MSG.nameInvalid],
    ['名前\u0007', SETTINGS_MSG.nameInvalid],
  ])('名前 %j は誤り', (name, error) => {
    expect(readInstrumentDraft(draftOf({ name }), LIST, US30.id).errors.name).toBe(error);
  });

  it('名前 40 字（コードポイント）は受ける', () => {
    expect(readInstrumentDraft(draftOf({ name: '𠮷'.repeat(40) }), LIST, US30.id).errors).toEqual(
      {},
    );
  });

  it.each([
    ['', SETTINGS_MSG.notNumber],
    ['abc', SETTINGS_MSG.notNumber],
    ['2000000000000', SETTINGS_MSG.tooLarge],
  ])('乗数 %j は誤り', (multiplier, error) => {
    expect(readInstrumentDraft(draftOf({ multiplier }), LIST, US30.id).errors.multiplier).toBe(
      error,
    );
  });

  it('原資産 41 字は誤り', () => {
    expect(
      readInstrumentDraft(draftOf({ underlying: 'x'.repeat(41) }), LIST, US30.id).errors.underlying,
    ).toBe(SETTINGS_MSG.underlyingInvalid);
  });

  it('性質: どんな文字列でも例外を投げず、本文の数は有限の正', () => {
    const r = rng(9);
    const chars = ['1', '0', '.', '-', 'a', 'U', 'S', 'D', ' ', '５', ','];
    for (let i = 0; i < 300; i++) {
      const s = () => Array.from({ length: r.int(0, 5) }, () => r.pick(chars)).join('');
      const got = readInstrumentDraft(
        draftOf({ name: s(), priceCurrency: s(), multiplier: s(), quantityStep: s() }),
        LIST,
        US30.id,
      );
      if (got.body) {
        expect(Number.isFinite(got.body.multiplier)).toBe(true);
        expect(got.body.multiplier).toBeGreaterThan(0);
        expect(got.body.quantityStep).toBeGreaterThan(0);
      }
    }
  });
});

describe('readNewInstrumentName（R5・AC-6）', () => {
  it('E13: GOLD は受ける（trim）', () => {
    expect(readNewInstrumentName(' GOLD ', LIST)).toEqual({ ok: true, value: 'GOLD' });
  });
  it('空・重複・長すぎは誤り', () => {
    expect(readNewInstrumentName('', LIST)).toEqual({
      ok: false,
      error: SETTINGS_MSG.nameRequired,
    });
    expect(readNewInstrumentName('xau', LIST)).toEqual({
      ok: false,
      error: SETTINGS_MSG.duplicateName,
    });
    expect(readNewInstrumentName('a'.repeat(41), LIST)).toEqual({
      ok: false,
      error: SETTINGS_MSG.nameInvalid,
    });
  });
});

describe('一覧の表示', () => {
  it('並びは API と同じ（nameKey → name → id）', () => {
    const list = [inst('3', 'b'), inst('2', 'A'), inst('1', 'a'), inst('0', '日経225')];
    expect(sortInstruments(list).map((i) => i.id)).toEqual(['2', '1', '3', '0']);
  });

  it('要約は利用者の言葉（内部の識別子を出さない）', () => {
    expect(instrumentSummary(US30)).toBe(
      'その他 · 現物・CFD · 価格の通貨 未設定 · 乗数 1 · 刻み 1',
    );
    expect(
      instrumentSummary(
        inst('x', 'US30', {
          underlyingKind: 'index',
          priceCurrency: 'USD',
          quantityStep: 0.1,
          underlying: 'ダウ平均',
        }),
      ),
    ).toBe('株価指数 · 現物・CFD · USD 建て · 乗数 1 · 刻み 0.1 · 原資産 ダウ平均');
    expect(
      instrumentSummary(inst('y', 'F', { productForm: 'future', underlyingKind: 'fx' })),
    ).toContain('FX · 先物');
  });

  it('初期値のまま: 自動で足したままの既定（その他・現物・CFD・未設定・1・1・原資産なし）', () => {
    expect(isProvisional(US30)).toBe(true);
    expect(isProvisional(N225)).toBe(false);
    expect(isProvisional(inst('z', 'Z', { underlying: 'x' }))).toBe(false);
    expect(isProvisional(inst('z', 'Z', { multiplier: 100 }))).toBe(false);
  });

  it('AC-7: 直したときの効き方の文言', () => {
    expect(EFFECT_NOTE).toContain('記録済みの取引は変わりません');
  });
});

describe('allowanceYen（1 回の負けの上限は切り捨て。レビュー指摘 3）', () => {
  it.each([
    // 資金 × 許容リスク / 100（架空の値）
    [1_000_050, 1, 10_000], // 10,000.5 → 切り捨てて 10,000（四捨五入の 10,001 にしない）
    [1_000_000, 1.1, 11_000], // 11000.000000000002（2 進の誤差）→ 11,000
    [999_999, 1, 9_999], // 9,999.99 → 9,999
    [1_000_000, 0.7, 7_000], // 7000.000000000001 → 7,000
    [1_234_567, 2.5, 30_864], // 30,864.175 → 30,864
    [1e12, 3, 30_000_000_000],
  ])('%d × %d%% → %d 円', (cap, pct, want) => {
    expect(allowanceYen(cap, pct)).toBe(want);
  });

  it('文も切り捨てた値で出す', () => {
    expect(allowanceText(1_000_050, 1)).toContain('1 回の負けは 10,000円 まで');
  });

  it('性質: 小数 2 桁の許容リスクで、整数の計算（切り捨て）と一致し、上限を超えない', () => {
    const r = rng(1203);
    for (let i = 0; i < 2000; i++) {
      const cap = r.int(1, 1e9) * (r.bool() ? 1 : r.int(1, 1000));
      const k = r.int(50, 300); // 0.50〜3.00 %
      const pct = k / 100;
      const exact = (BigInt(cap) * BigInt(k)) / 10_000n; // 切り捨ての正解
      const got = allowanceYen(cap, pct);
      expect(BigInt(got), `${cap} × ${pct}`).toBe(exact);
      expect(got <= (cap * pct) / 100 + 1e-6).toBe(true);
    }
  });
});

describe('誤りのある欄の知らせ（レビュー指摘 5）', () => {
  it('画面の並びの順に欄の名前を並べる', () => {
    expect(errorFieldsOf({ risk: 'x', capital: 'y' }, ACCOUNT_FIELD_LABEL)).toEqual([
      'capital',
      'risk',
    ]);
    expect(
      errorFieldsOf({ quantityStep: 'a', name: 'b', priceCurrency: 'c' }, INSTRUMENT_FIELD_LABEL),
    ).toEqual(['name', 'priceCurrency', 'quantityStep']);
    expect(errorFieldsText(['資金', '許容リスク'])).toBe(
      '誤りのある欄があります（資金・許容リスク）。直してから、もう一度押してください。',
    );
  });
});
