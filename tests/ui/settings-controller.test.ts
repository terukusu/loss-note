// 設定の画面の通信と状態（Issue #5 契約・AC-1〜AC-6・KEEP-2）。偽の API（tests/ui/helpers/fake-api.ts）で確かめる。
// 値はすべて架空
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord } from '../../core/record';
import { NotSignedIn } from '../../ui/src/lib/api';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import {
  createSettingsController,
  focusAfter,
  INSTRUMENT_NOT_FOUND,
  instrumentAdded,
  instrumentSaved,
  SETTINGS_LOAD_FAILED,
  SETTINGS_NETWORK_FAILED,
  SETTINGS_SAVE_FAILED,
  SETTINGS_SAVED,
  type SettingsController,
} from '../../ui/src/lib/settings-controller';
import { SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import { createFakeApi, type FakeApi, type FakeOptions } from './helpers/fake-api';

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

async function open(opts: FakeOptions = {}): Promise<{ fake: FakeApi; c: SettingsController }> {
  const fake = createFakeApi({ instruments: [XAU, US30, N225], ...opts });
  const c = createSettingsController({ api: fake.api, timeoutMs: 50 });
  await c.load();
  return { fake, c };
}

const puts = (fake: FakeApi, path = '/api/settings') =>
  fake.calls.filter((x) => x.method === 'PUT' && x.path === path);

describe('読み込み', () => {
  it('設定と銘柄を並行に読み、銘柄は名前の順、下書きは保存値', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    const s = c.getState();
    expect(s.phase).toBe('ready');
    expect(s.instruments.map((i) => i.name)).toEqual(['US30', 'XAU', '日経225']);
    expect(s.draft).toEqual({ capital: '1,000,000', risk: '1' });
    expect(fake.calls.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/instruments',
      'GET /api/settings',
    ]);
  });

  it('AC-4: 未設定の利用者には許容リスク 1 が出る', async () => {
    const { c } = await open();
    expect(c.getState().settings?.riskTolerancePct).toBe(1);
    expect(c.getState().draft.risk).toBe('1');
  });

  it.each([
    ['500', { 'GET /api/settings': 500 }],
    ['通信の失敗', { 'GET /api/instruments': 'throw' as const }],
  ])('読み込みの失敗（%s）は決まった文言で、保存を送らない', async (_n, fail) => {
    const { c, fake } = await open({ fail });
    const s = c.getState();
    expect(s.phase).toBe('loadFailed');
    expect(s.error).toBe(SETTINGS_LOAD_FAILED);
    expect(JSON.stringify(s)).not.toContain('偽物');
    c.setField('capital', '1000000');
    await c.saveSettings();
    await c.addInstrument();
    expect(fake.calls.filter((x) => x.method !== 'GET')).toEqual([]);
  });

  it('401 はログインが切れた', async () => {
    const { c } = await open({ fail: { 'GET /api/settings': 401 } });
    expect(c.getState().error).toBe(AUTH_EXPIRED);
    expect(c.getState().errorKind).toBe('auth');
  });

  it('ログインしていない（NotSignedIn）もログインが切れた', async () => {
    const c = createSettingsController({
      api: async () => {
        throw new NotSignedIn();
      },
    });
    await c.load();
    expect(c.getState().errorKind).toBe('auth');
  });

  it('時間切れは読み込みの失敗', async () => {
    const fake = createFakeApi();
    fake.hold();
    const c = createSettingsController({ api: fake.api, timeoutMs: 20 });
    await c.load();
    expect(c.getState().phase).toBe('loadFailed');
    fake.release();
  });
});

describe('資金と許容リスク', () => {
  it('AC-1 E1: 未設定で 1,000,000 を保存 → 保存値・履歴 1 件、開き直しても同じ', async () => {
    const { c, fake } = await open();
    c.setField('capital', '1,000,000');
    await c.saveSettings();
    const s = c.getState();
    expect(puts(fake)).toHaveLength(1);
    expect(puts(fake)[0]?.body).toEqual({
      capitalYen: 1_000_000,
      riskTolerancePct: 1,
      performanceUnit: 'R',
    });
    expect(s.settings?.capitalYen).toBe(1_000_000);
    expect(s.settings?.capitalHistory).toHaveLength(1);
    expect(s.notice).toEqual({ area: 'settings', kind: 'ok', text: SETTINGS_SAVED });
    expect(s.draft.capital).toBe('1,000,000');

    const again = createSettingsController({ api: fake.api });
    await again.load();
    expect(again.getState().settings?.capitalYen).toBe(1_000_000);
    expect(again.getState().draft.capital).toBe('1,000,000');
  });

  it('AC-1 E2: 全角の １２０００００ → 1,200,000', async () => {
    const { c, fake } = await open();
    c.setField('capital', '１２０００００');
    await c.saveSettings();
    expect(fake.settings().capitalYen).toBe(1_200_000);
  });

  it.each(['0', '-5', '1000.5', '百万', ''])(
    'AC-2 E3: 1,000,000 が保存済みで %j → PUT 0 回・欄に誤り・保存値は変わらない',
    async (raw) => {
      const { c, fake } = await open({ capitalYen: 1_000_000 });
      c.setField('capital', raw);
      expect(c.getState().reading.errors.capital).toBeTruthy();
      await c.saveSettings();
      expect(puts(fake)).toHaveLength(0);
      expect(fake.settings().capitalYen).toBe(1_000_000);
      expect(c.getState().settings?.capitalYen).toBe(1_000_000);
    },
  );

  it('AC-2 E3b: 未設定で資金は空、許容リスク 1.5 → 資金 null のまま、履歴 0 件', async () => {
    const { c, fake } = await open();
    c.setField('risk', '1.5');
    await c.saveSettings();
    expect(puts(fake)[0]?.body).toEqual({
      capitalYen: null,
      riskTolerancePct: 1.5,
      performanceUnit: 'R',
    });
    expect(fake.settings().riskTolerancePct).toBe(1.5);
    expect(fake.settings().capitalHistory).toEqual([]);
    expect(c.getState().settings?.capitalYen).toBeNull();
  });

  it('AC-3 E4・E5: 同じ値では増えず、1,000,000 → 800,000 → 900,000 は新しい順に 3 件', async () => {
    const { c } = await open();
    for (const v of ['1000000', '1000000', '800000', '900000']) {
      c.setField('capital', v);
      await c.saveSettings();
    }
    const h = c.getState().settings?.capitalHistory ?? [];
    expect(h.map((x) => x.valueYen)).toEqual([1_000_000, 800_000, 900_000]);
    expect(c.getState().history.map((x) => x.valueYen)).toEqual([900_000, 800_000, 1_000_000]);
    expect(c.getState().history.every((x) => typeof x.at === 'number')).toBe(true);
  });

  it.each([
    ['2', 2, false],
    ['2.5', 2.5, true],
  ])('AC-4 E6・E7: 許容リスク %s は保存され、警告は %s', async (raw, want, warn) => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    c.setField('risk', raw);
    expect(c.getState().reading.warning !== null).toBe(warn);
    await c.saveSettings();
    expect(fake.settings().riskTolerancePct).toBe(want);
    expect(c.getState().reading.warning !== null).toBe(warn);
  });

  it.each(['0.4', '3.1', ''])('AC-4 E8: 許容リスク %j は保存しない', async (raw) => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    c.setField('risk', raw);
    await c.saveSettings();
    expect(puts(fake)).toHaveLength(0);
    expect(c.getState().reading.errors.risk).toBe(SETTINGS_MSG.risk);
  });

  it('KEEP-2: 円にしてある利用者が資金を保存しても performanceUnit は yen のまま', async () => {
    const { c, fake } = await open({ performanceUnit: 'yen' });
    c.setField('capital', '1000000');
    await c.saveSettings();
    expect(puts(fake)[0]?.body).toMatchObject({ performanceUnit: 'yen' });
    expect(fake.settings().performanceUnit).toBe('yen');
  });

  it('二度押しでも PUT は 1 回', async () => {
    const { c, fake } = await open();
    c.setField('capital', '1000000');
    fake.hold();
    const a = c.saveSettings();
    const b = c.saveSettings();
    expect(c.getState().savingSettings).toBe(true);
    fake.release();
    await Promise.all([a, b]);
    expect(puts(fake)).toHaveLength(1);
    expect(c.getState().savingSettings).toBe(false);
  });

  it.each([
    ['500', 500, SETTINGS_SAVE_FAILED],
    ['400', 400, SETTINGS_SAVE_FAILED],
    ['通信の失敗', 'throw' as const, SETTINGS_NETWORK_FAILED],
  ])('保存の失敗（%s）は決まった文言で、入力は残る', async (_n, f, text) => {
    const { c } = await open({ failOnce: { 'PUT /api/settings': f } });
    c.setField('capital', '1000000');
    await c.saveSettings();
    const s = c.getState();
    expect(s.notice).toEqual({ area: 'settings', kind: 'error', text });
    expect(s.draft.capital).toBe('1000000');
    expect(JSON.stringify(s)).not.toContain('偽物');
    // もう一度押せば保存できる（PUT は同じ本文の置き換えなので二重にならない）
    await c.saveSettings();
    expect(c.getState().settings?.capitalYen).toBe(1_000_000);
  });

  it('保存の 401 はログインが切れた（ログインし直す案内）', async () => {
    const { c } = await open({ fail: { 'PUT /api/settings': 401 } });
    c.setField('capital', '1000000');
    await c.saveSettings();
    expect(c.getState().notice).toEqual({
      area: 'settings',
      kind: 'error',
      text: AUTH_EXPIRED,
      auth: true,
    });
  });

  it('打ち直すと前の知らせは消える', async () => {
    const { c } = await open();
    c.setField('capital', '1000000');
    await c.saveSettings();
    expect(c.getState().notice).not.toBeNull();
    c.setField('capital', '1000001');
    expect(c.getState().notice).toBeNull();
  });
});

describe('銘柄を直す', () => {
  it('AC-5 E9: US30 を株価指数・USD・刻み 0.1 に直す → 一覧と開き直しても同じ', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    expect(c.getState().editing?.id).toBe(US30.id);
    c.updateInstrument('underlyingKind', 'index');
    c.updateInstrument('priceCurrency', 'USD');
    c.updateInstrument('quantityStep', '0.1');
    await c.saveInstrument();
    expect(puts(fake, `/api/instruments/${US30.id}`)[0]?.body).toEqual({
      name: 'US30',
      underlyingKind: 'index',
      productForm: 'spotCfd',
      priceCurrency: 'USD',
      multiplier: 1,
      quantityStep: 0.1,
    });
    const s = c.getState();
    expect(s.editing).toBeNull();
    expect(s.notice).toEqual({ area: 'instruments', kind: 'ok', text: instrumentSaved('US30') });
    expect(s.instruments.find((i) => i.id === US30.id)).toMatchObject({
      underlyingKind: 'index',
      priceCurrency: 'USD',
      quantityStep: 0.1,
    });
    const again = createSettingsController({ api: fake.api });
    await again.load();
    expect(again.getState().instruments.find((i) => i.id === US30.id)).toMatchObject({
      underlyingKind: 'index',
      priceCurrency: 'USD',
      quantityStep: 0.1,
    });
  });

  it('AC-5 E10: 名前を「日経２２５ 」に → PUT 0 回で重複の文言', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('name', '日経２２５ ');
    await c.saveInstrument();
    expect(puts(fake, `/api/instruments/${US30.id}`)).toHaveLength(0);
    expect(c.getState().editing?.reading.errors.name).toBe(SETTINGS_MSG.duplicateName);
  });

  it('AC-5 E10: API が 409 を返したとき（ほかの端末で同じ名前が足された）も同じ文言', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('name', 'GOLD');
    // ほかの端末が先に GOLD を足した
    fake.instruments.push(inst('i-gold', 'gold'));
    await c.saveInstrument();
    const ed = c.getState().editing;
    expect(ed?.id).toBe(US30.id);
    expect(ed?.reading.errors.name).toBe(SETTINGS_MSG.duplicateName);
    // 名前を変えれば消える
    c.updateInstrument('name', 'GOLD2');
    expect(c.getState().editing?.reading.errors.name).toBeUndefined();
  });

  it('AC-5 E11: 乗数 0・刻み -1・通貨 US → 欄ごとの誤り・PUT 0 回', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('multiplier', '0');
    c.updateInstrument('quantityStep', '-1');
    c.updateInstrument('priceCurrency', 'US');
    await c.saveInstrument();
    expect(fake.calls.filter((x) => x.method === 'PUT')).toHaveLength(0);
    expect(Object.keys(c.getState().editing?.reading.errors ?? {}).sort()).toEqual([
      'multiplier',
      'priceCurrency',
      'quantityStep',
    ]);
  });

  it('AC-5 E12: 通貨 usd → 本文は USD', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('priceCurrency', 'usd');
    await c.saveInstrument();
    expect(puts(fake, `/api/instruments/${US30.id}`)[0]?.body).toMatchObject({
      priceCurrency: 'USD',
    });
  });

  it('別の行を開くと前の下書きは捨てる。やめると閉じる', async () => {
    const { c } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('multiplier', '5');
    c.openInstrument(XAU.id);
    expect(c.getState().editing?.id).toBe(XAU.id);
    c.openInstrument(US30.id);
    expect(c.getState().editing?.draft.multiplier).toBe('1');
    c.closeInstrument();
    expect(c.getState().editing).toBeNull();
  });

  it('無い銘柄（404）は決まった文言', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    fake.instruments.splice(
      fake.instruments.findIndex((i) => i.id === US30.id),
      1,
    );
    await c.saveInstrument();
    expect(c.getState().notice).toEqual({
      area: 'instruments',
      kind: 'error',
      text: INSTRUMENT_NOT_FOUND,
    });
  });

  it('二度押しでも PUT は 1 回', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('multiplier', '100');
    fake.hold();
    const a = c.saveInstrument();
    const b = c.saveInstrument();
    expect(c.getState().editing?.saving).toBe(true);
    fake.release();
    await Promise.all([a, b]);
    expect(puts(fake, `/api/instruments/${US30.id}`)).toHaveLength(1);
  });

  it('保存の失敗（500）は決まった文言で、下書きは残る', async () => {
    const { c } = await open({ failOnce: { [`PUT /api/instruments/${US30.id}`]: 500 } });
    c.openInstrument(US30.id);
    c.updateInstrument('multiplier', '100');
    await c.saveInstrument();
    const s = c.getState();
    expect(s.editing?.draft.multiplier).toBe('100');
    expect(s.notice).toEqual({ area: 'instruments', kind: 'error', text: SETTINGS_SAVE_FAILED });
    expect(JSON.stringify(s)).not.toContain('偽物');
  });
});

describe('銘柄を足す', () => {
  it('AC-6 E13: 名前 GOLD だけで足す → POST 本文は名前だけ、一覧に既定で増える', async () => {
    const { c, fake } = await open();
    c.setNewName(' GOLD ');
    await c.addInstrument();
    const posts = fake.calls.filter((x) => x.method === 'POST');
    expect(posts).toEqual([{ method: 'POST', path: '/api/instruments', body: { name: 'GOLD' } }]);
    const s = c.getState();
    expect(s.instruments.map((i) => i.name)).toEqual(['GOLD', 'US30', 'XAU', '日経225']);
    expect(s.instruments.find((i) => i.name === 'GOLD')).toMatchObject({
      underlyingKind: 'other',
      productForm: 'spotCfd',
      priceCurrency: null,
      multiplier: 1,
      quantityStep: 1,
    });
    expect(s.newName).toBe('');
    expect(s.notice).toEqual({ area: 'instruments', kind: 'ok', text: instrumentAdded('GOLD') });
  });

  it('空・重複は送らず、誤りの文言', async () => {
    const { c, fake } = await open();
    expect(c.getState().newNameError).toBeNull();
    await c.addInstrument();
    expect(c.getState().newNameError).toBe(SETTINGS_MSG.nameRequired);
    c.setNewName('xau');
    expect(c.getState().newNameError).toBe(SETTINGS_MSG.duplicateName);
    await c.addInstrument();
    expect(fake.calls.filter((x) => x.method === 'POST')).toHaveLength(0);
  });

  it('409（ほかの端末で同じ名前）は一覧を取り直して重複の文言', async () => {
    const { c } = await open({ conflictOnce: inst('i-gold', 'GOLD') });
    c.setNewName('GOLD');
    await c.addInstrument();
    const s = c.getState();
    expect(s.instruments.map((i) => i.name)).toContain('GOLD');
    expect(s.newNameError).toBe(SETTINGS_MSG.duplicateName);
  });

  it('通信の失敗の後にもう一度押して 409 なら、届いていたものとして扱う（二重に足さない）', async () => {
    const { c, fake } = await open();
    fake.hold();
    c.setNewName('GOLD');
    const p = c.addInstrument();
    // 要求は届いて保存されたが、応答が時間切れ
    await new Promise((ok) => setTimeout(ok, 80));
    fake.release();
    await p;
    expect(c.getState().notice?.kind).toBe('error');
    expect(fake.instruments.map((i) => i.name)).toContain('GOLD');
    await c.addInstrument();
    const s = c.getState();
    expect(s.notice).toEqual({ area: 'instruments', kind: 'ok', text: instrumentAdded('GOLD') });
    expect(s.newNameError).toBeNull();
    expect(s.instruments.filter((i) => i.name === 'GOLD')).toHaveLength(1);
  });
});

describe('誤りのまま押したときの知らせ（レビュー指摘 5）', () => {
  it('資金・許容リスク: 送らず、誤りのある欄を role="alert" の知らせで出す', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    c.setField('capital', '0');
    c.setField('risk', '3.1');
    await c.saveSettings();
    expect(puts(fake)).toHaveLength(0);
    expect(c.getState().notice).toEqual({
      area: 'settings',
      kind: 'error',
      text: '誤りのある欄があります（資金・許容リスク）。直してから、もう一度押してください。',
    });
    // 直し始めたら消える
    c.setField('capital', '1000000');
    expect(c.getState().notice).toBeNull();
  });

  it('銘柄: E11 で押すと、誤りのある欄を画面の並びの順で知らせる', async () => {
    const { c, fake } = await open();
    c.openInstrument(US30.id);
    c.updateInstrument('multiplier', '0');
    c.updateInstrument('quantityStep', '-1');
    c.updateInstrument('priceCurrency', 'US');
    await c.saveInstrument();
    expect(fake.calls.filter((x) => x.method === 'PUT')).toHaveLength(0);
    expect(c.getState().notice).toEqual({
      area: 'instruments',
      kind: 'error',
      text: '誤りのある欄があります（価格の通貨・乗数・数量の刻み）。直してから、もう一度押してください。',
    });
    expect(c.getState().editing?.id).toBe(US30.id);
  });
});

describe('focusAfter（押した後のフォーカスの移し先。レビュー指摘 5・6）', () => {
  it('資金と許容リスク: 誤り → 最初の誤りの欄、失敗 → [保存]、成功 → 移さない', async () => {
    const { c } = await open({ failOnce: { 'PUT /api/settings': 503 } });
    c.setField('risk', '3.1');
    await c.saveSettings();
    expect(focusAfter('settings', c.getState())).toBe('settings-risk');
    c.setField('capital', '-1');
    expect(focusAfter('settings', c.getState())).toBe('settings-capital');
    c.setField('capital', '1000000');
    c.setField('risk', '1');
    await c.saveSettings();
    expect(c.getState().notice?.kind).toBe('error');
    expect(focusAfter('settings', c.getState())).toBe('settings-save');
    await c.saveSettings();
    expect(focusAfter('settings', c.getState())).toBeNull();
  });

  it('銘柄: 誤り → 最初の誤りの欄、409 → 名前、失敗 → [保存]、閉じた → 移さない', async () => {
    const { c, fake } = await open({ failOnce: { [`PUT /api/instruments/${US30.id}`]: 500 } });
    c.openInstrument(US30.id);
    c.updateInstrument('quantityStep', '0');
    c.updateInstrument('priceCurrency', 'x');
    await c.saveInstrument();
    expect(focusAfter('instrument', c.getState())).toBe('settings-inst-currency');
    c.updateInstrument('quantityStep', '1');
    c.updateInstrument('priceCurrency', '');
    await c.saveInstrument();
    expect(focusAfter('instrument', c.getState())).toBe('settings-inst-save');
    c.updateInstrument('name', 'GOLD');
    fake.instruments.push(inst('i-gold', 'GOLD'));
    await c.saveInstrument();
    expect(focusAfter('instrument', c.getState())).toBe('settings-inst-name');
    c.updateInstrument('name', 'US30');
    await c.saveInstrument();
    expect(c.getState().editing).toBeNull();
    expect(focusAfter('instrument', c.getState())).toBeNull();
  });

  it('足す: 名前の誤り → 名前の欄、失敗 → [足す]、成功 → 移さない', async () => {
    const { c } = await open({ failOnce: { 'POST /api/instruments': 500 } });
    await c.addInstrument();
    expect(focusAfter('add', c.getState())).toBe('settings-new-name');
    c.setNewName('GOLD');
    await c.addInstrument();
    expect(focusAfter('add', c.getState())).toBe('settings-add');
    await c.addInstrument();
    expect(focusAfter('add', c.getState())).toBeNull();
  });
});
