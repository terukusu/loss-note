// 設定の画面の通信と状態（Issue #5 契約・AC-1〜AC-6・KEEP-2）。偽の API（tests/ui/helpers/fake-api.ts）で確かめる。
// 値はすべて架空
import { describe, expect, it } from 'vitest';
import type { AccountRecord, InstrumentRecord, StoredTrade } from '../../core/record';
import { ACCOUNT_MSG } from '../../ui/src/lib/accounts';
import { NotSignedIn } from '../../ui/src/lib/api';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import {
  ACCOUNT_ADD_NETWORK_FAILED,
  ACCOUNT_NOT_FOUND,
  accountAdded,
  accountSaved,
  createSettingsController,
  focusAfter,
  INSTRUMENT_NOT_FOUND,
  instrumentAdded,
  instrumentSaved,
  SETTINGS_LOAD_FAILED,
  SETTINGS_NETWORK_FAILED,
  SETTINGS_SAVE_FAILED,
  type SettingsController,
} from '../../ui/src/lib/settings-controller';
import { SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import { account, defaultAccount } from './helpers/accounts';
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

const posts = (fake: FakeApi, path: string) =>
  fake.calls.filter((x) => x.method === 'POST' && x.path === path);
const puts = (fake: FakeApi, path: string) =>
  fake.calls.filter((x) => x.method === 'PUT' && x.path === path);

describe('読み込み', () => {
  it('口座と銘柄を並行に読み（設定は読まない）、口座・銘柄は名前の順', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    const s = c.getState();
    expect(s.phase).toBe('ready');
    expect(s.instruments.map((i) => i.name)).toEqual(['US30', 'XAU', '日経225']);
    // 移し替え: 既定の口座「口座 1」が設定の資金で 1 つ
    expect(s.accounts.map((a) => [a.name, a.capitalYen])).toEqual([['口座 1', 1_000_000]]);
    // 取引の一覧は開いたときには読まない（通貨を変える操作のときだけ。#47 PR-2 のレビュー 6）
    expect(fake.calls.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'GET /api/accounts',
      'GET /api/instruments',
    ]);
  });

  it('AC-4: 未設定の利用者の口座は許容リスク 1・資金 未設定', async () => {
    const { c } = await open();
    expect(c.getState().accounts[0]?.riskTolerancePct).toBe(1);
    expect(c.getState().accounts[0]?.capitalYen).toBeNull();
  });

  it.each([
    ['500', { 'GET /api/accounts': 500 }],
    ['通信の失敗', { 'GET /api/instruments': 'throw' as const }],
  ])('読み込みの失敗（%s）は決まった文言で、保存を送らない', async (_n, fail) => {
    const { c, fake } = await open({ fail });
    const s = c.getState();
    expect(s.phase).toBe('loadFailed');
    expect(s.error).toBe(SETTINGS_LOAD_FAILED);
    expect(JSON.stringify(s)).not.toContain('偽物');
    c.openAccount(null);
    await c.saveAccount();
    await c.addInstrument();
    expect(fake.calls.filter((x) => x.method !== 'GET')).toEqual([]);
  });

  it('401 はログインが切れた', async () => {
    const { c } = await open({ fail: { 'GET /api/accounts': 401 } });
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

describe('口座（#47 AC-1・AC-2・U14・U15）', () => {
  it('AC-1: 「口座 B」「口座 A」を足すと名前の順に並び、口座 A の資金を直すと値が変わり履歴が 1 件増える', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    for (const [name, capital] of [
      ['口座 B', '200,000'],
      ['口座 A', ''],
    ] as const) {
      c.openAccount(null);
      c.updateAccount('name', name);
      c.updateAccount('capital', capital);
      await c.saveAccount();
      expect(c.getState().notice).toEqual({
        area: 'accounts',
        kind: 'ok',
        text: accountAdded(name),
      });
    }
    expect(c.getState().accounts.map((a) => a.name)).toEqual(['口座 1', '口座 A', '口座 B']);
    expect(posts(fake, '/api/accounts').map((x) => x.body)).toEqual([
      { name: '口座 B', currency: 'JPY', capitalYen: 200_000, riskTolerancePct: 1 },
      { name: '口座 A', currency: 'JPY', capitalYen: null, riskTolerancePct: 1 },
    ]);
    const a = c.getState().accounts.find((x) => x.name === '口座 A') as AccountRecord;
    expect(a.capitalHistory).toHaveLength(0);
    c.openAccount(a.id);
    expect(c.getState().account?.draft).toEqual({
      name: '口座 A',
      currency: 'JPY',
      capital: '',
      risk: '1',
    });
    c.updateAccount('capital', '500000');
    await c.saveAccount();
    const after = c.getState().accounts.find((x) => x.id === a.id) as AccountRecord;
    expect(after.capitalYen).toBe(500_000);
    expect(after.capitalHistory).toHaveLength(1);
    expect(c.getState().account).toBeNull();
    expect(c.getState().notice?.text).toBe(accountSaved('口座 A'));
    // 資金が同じなら履歴は増えない
    c.openAccount(a.id);
    c.updateAccount('risk', '1.5');
    await c.saveAccount();
    expect(
      (c.getState().accounts.find((x) => x.id === a.id) as AccountRecord).capitalHistory,
    ).toHaveLength(1);
    // 設定（/api/settings）は送らない（KEEP-6）
    expect(fake.calls.some((x) => x.path === '/api/settings')).toBe(false);
  });

  it('AC-2 A6: 「口座 A」があるときに「口座 Ａ」・「 口座 a 」は送らず重複の文言', async () => {
    const { c, fake } = await open({
      accounts: [defaultAccount(null), account('accA', '口座 A', null)],
    });
    for (const name of ['口座 Ａ', ' 口座 a ']) {
      c.openAccount(null);
      c.updateAccount('name', name);
      await c.saveAccount();
      expect(c.getState().account?.reading.errors.name, name).toBe(ACCOUNT_MSG.duplicateName);
    }
    expect(posts(fake, '/api/accounts')).toHaveLength(0);
  });

  it('AC-2 A7: 3.5 / 0.4 は送らない。2.5 は警告つきで足せる', async () => {
    const { c, fake } = await open();
    c.openAccount(null);
    c.updateAccount('name', '口座 E');
    for (const risk of ['3.5', '0.4']) {
      c.updateAccount('risk', risk);
      await c.saveAccount();
      expect(c.getState().account?.reading.errors.risk).toBe(SETTINGS_MSG.risk);
    }
    expect(posts(fake, '/api/accounts')).toHaveLength(0);
    c.updateAccount('risk', '2.5');
    expect(c.getState().account?.reading.warning).toBe(SETTINGS_MSG.riskWarning);
    await c.saveAccount();
    expect(c.getState().accounts.find((a) => a.name === '口座 E')?.riskTolerancePct).toBe(2.5);
  });

  it('API が 409 を返した（ほかの端末で同じ名前）→ 一覧を取り直して重複の文言', async () => {
    const { c, fake } = await open();
    c.openAccount(null);
    c.updateAccount('name', '口座 Z');
    fake.accounts.push(account('accZ', '口座 Z', null));
    await c.saveAccount();
    expect(c.getState().account?.reading.errors.name).toBe(ACCOUNT_MSG.duplicateName);
    expect(c.getState().accounts.map((a) => a.name)).toContain('口座 Z');
  });

  it('通信の失敗の後にもう一度押して 409 なら、届いていたものとして扱う（二重に足さない）', async () => {
    const { c, fake } = await open({ failOnce: { 'POST /api/accounts': 'throw' } });
    c.openAccount(null);
    c.updateAccount('name', '口座 B');
    await c.saveAccount();
    expect(c.getState().notice?.text).toBe(ACCOUNT_ADD_NETWORK_FAILED);
    // 届いていた（偽の API に先に足す）
    fake.accounts.push(account('accB', '口座 B', null));
    await c.saveAccount();
    expect(c.getState().account).toBeNull();
    expect(c.getState().notice?.text).toBe(accountAdded('口座 B'));
    expect(c.getState().addedAccountId).toBe('accB');
  });

  it('同時に開けるのは 1 つ（直す欄を開くと足す欄は閉じる）。やめると閉じる', async () => {
    const { c } = await open();
    c.openAccount(null);
    c.updateAccount('name', '口座 X');
    c.openAccount('default');
    expect(c.getState().account?.id).toBe('default');
    expect(c.getState().account?.draft.name).toBe('口座 1');
    c.closeAccount();
    expect(c.getState().account).toBeNull();
  });

  it('設定済みの資金を空にすると送らない（未設定には戻せない）', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    c.openAccount('default');
    c.updateAccount('capital', '');
    await c.saveAccount();
    expect(c.getState().account?.reading.errors.capital).toBe(SETTINGS_MSG.capitalRequired);
    expect(fake.calls.filter((x) => x.method === 'PUT')).toHaveLength(0);
  });

  it('二度押しでも PUT は 1 回', async () => {
    const { c, fake } = await open();
    c.openAccount('default');
    c.updateAccount('capital', '1000000');
    fake.hold();
    const a = c.saveAccount();
    const b = c.saveAccount();
    expect(c.getState().account?.saving).toBe(true);
    fake.release();
    await Promise.all([a, b]);
    expect(fake.calls.filter((x) => x.method === 'PUT')).toHaveLength(1);
  });

  it.each([
    ['500', 500, SETTINGS_SAVE_FAILED],
    ['通信の失敗', 'throw' as const, SETTINGS_NETWORK_FAILED],
  ])('保存の失敗（%s）は決まった文言で、入力は残る', async (_n, f, text) => {
    const { c } = await open({ failOnce: { 'PUT /api/accounts/default': f } });
    c.openAccount('default');
    c.updateAccount('capital', '1000000');
    await c.saveAccount();
    const s = c.getState();
    expect(s.notice).toEqual({ area: 'accounts', kind: 'error', text });
    expect(s.account?.draft.capital).toBe('1000000');
    expect(JSON.stringify(s)).not.toContain('偽物');
    await c.saveAccount();
    expect(c.getState().accounts[0]?.capitalYen).toBe(1_000_000);
  });

  it('保存の 401 はログインが切れた（もう一度ログイン案内）', async () => {
    const { c } = await open({ fail: { 'PUT /api/accounts/default': 401 } });
    c.openAccount('default');
    c.updateAccount('capital', '1000000');
    await c.saveAccount();
    expect(c.getState().notice).toEqual({
      area: 'accounts',
      kind: 'error',
      text: AUTH_EXPIRED,
      auth: true,
    });
  });

  it('無い口座（404）は決まった文言', async () => {
    const { c } = await open({ fail: { 'PUT /api/accounts/default': 404 } });
    c.openAccount('default');
    c.updateAccount('capital', '1000000');
    await c.saveAccount();
    expect(c.getState().notice?.text).toBe(ACCOUNT_NOT_FOUND);
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

describe('銘柄を追加', () => {
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
  it('口座: 送らず、誤りのある欄を role="alert" の知らせで出す', async () => {
    const { c, fake } = await open({ capitalYen: 1_000_000 });
    c.openAccount('default');
    c.updateAccount('capital', '0');
    c.updateAccount('risk', '3.1');
    await c.saveAccount();
    expect(fake.calls.filter((x) => x.method === 'PUT')).toHaveLength(0);
    expect(c.getState().notice).toEqual({
      area: 'accounts',
      kind: 'error',
      text: '誤りのある欄があります（資金・許容リスク）。直してから、もう一度押してください。',
    });
    // 直し始めたら消える
    c.updateAccount('capital', '1000000');
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
  it('口座: 誤り → 最初の誤りの欄、失敗 → [保存]、保存できた → 移さない、足せた → 新しい行の [直す]（U15）', async () => {
    const { c } = await open({ failOnce: { 'PUT /api/accounts/default': 503 } });
    c.openAccount('default');
    c.updateAccount('risk', '3.1');
    await c.saveAccount();
    expect(focusAfter('account', c.getState())).toBe('settings-account-risk');
    c.updateAccount('capital', '-1');
    expect(focusAfter('account', c.getState())).toBe('settings-account-capital');
    c.updateAccount('capital', '1000000');
    c.updateAccount('risk', '1');
    await c.saveAccount();
    expect(c.getState().notice?.kind).toBe('error');
    expect(focusAfter('account', c.getState())).toBe('settings-account-save');
    await c.saveAccount();
    expect(focusAfter('account', c.getState())).toBeNull();
    c.openAccount(null);
    await c.saveAccount();
    expect(focusAfter('account', c.getState())).toBe('settings-account-name');
    c.updateAccount('name', '口座 C');
    await c.saveAccount();
    const added = c.getState().addedAccountId as string;
    expect(focusAfter('account', c.getState())).toBe(`settings-account-edit-${added}`);
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

describe('口座の通貨（#47 PR-2・F14・U30・U31・AC-18）', () => {
  const A = account('accA', '口座 A', 1_000_000);
  const D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });
  const tradeIn = (accountId: string | undefined) =>
    ({
      id: `t-${accountId ?? 'none'}`,
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      snapshot: {
        instrument: {
          multiplier: 1,
          quantityStep: 1,
          priceCurrency: null,
          underlyingKind: 'other',
          productForm: 'spotCfd',
        },
        capitalYen: null,
        riskTolerancePct: 1,
      },
      record: {
        status: 'closed',
        source: 'manual',
        instrumentId: 'i-us30',
        ...(accountId === undefined ? {} : { accountId }),
        side: 'L',
        lc: 99.5,
        lcBasis: 'chart',
        stopOrderPlaced: 'unanswered',
        lcDecidedBeforeEntry: true,
        lcMove: { kind: 'none' },
        timeframeChange: 'none',
        entries: [{ price: 100, quantity: 1 }],
        exit: {
          time: 1,
          price: 99.5,
          orderType: 'unknown',
          reason: 'other',
          gapSlip: 'unanswered',
        },
        fees: [],
      },
    }) as StoredTrade;

  it('開いたときは取引を読まず、通貨を今と違う値にしたときだけ 1 回読む。取引の無い口座は直せる（USD・小数 2 桁まで）', async () => {
    const { fake, c } = await open({
      accounts: [defaultAccount(1_000_000), A, D],
      trades: [tradeIn(undefined), tradeIn('accD')],
    });
    const tradeGets = () => fake.calls.filter((x) => x.path === '/api/trades').length;
    expect(tradeGets()).toBe(0);
    c.openAccount('accA');
    // 名前・資金だけを直す・同じ通貨を打つ操作では読まない
    c.updateAccount('capital', '900,000');
    c.updateAccount('currency', 'jpy');
    expect(tradeGets()).toBe(0);
    c.updateAccount('currency', 'usd');
    await c.settled();
    expect(tradeGets()).toBe(1);
    expect([...(c.getState().accountsInUse ?? [])].sort()).toEqual(['accD', 'default']);
    expect(c.getState().account?.draft.currency).toBe('usd');
    c.updateAccount('capital', '10,000.505');
    expect(c.getState().account?.reading.errors.capital).toBe(SETTINGS_MSG.capitalTooManyDecimals);
    c.updateAccount('capital', '10,000.50');
    await c.saveAccount();
    expect(puts(fake, '/api/accounts/accA')[0]?.body).toEqual({
      name: '口座 A',
      currency: 'USD',
      capitalYen: 10_000.5,
      riskTolerancePct: 1,
    });
    expect(c.getState().accounts.find((a) => a.id === 'accA')?.currency).toBe('USD');
    // 一度読んだら読み直さない
    c.openAccount('accA');
    c.updateAccount('currency', 'EUR');
    await c.settled();
    expect(tradeGets()).toBe(1);
  });

  it('取引のある口座（accountId なしの取引がある既定の口座も）で通貨を変えると、元に戻して文字にし知らせる。本文に通貨なし', async () => {
    for (const [id, cur] of [
      ['accD', 'USD'],
      ['default', 'JPY'],
    ] as const) {
      const { c } = await open({
        accounts: [defaultAccount(1_000_000), A, D],
        trades: [tradeIn(undefined), tradeIn('accD')],
      });
      c.openAccount(id);
      c.updateAccount('currency', 'EUR');
      await c.settled();
      const s = c.getState();
      expect(s.account?.draft.currency, id).toBe(cur);
      expect(s.accountsInUse?.has(id), id).toBe(true);
      expect(s.notice?.text, id).toBe(`通貨: ${cur}（取引があるので変更できません）`);
      expect(s.account?.reading.body, id).not.toHaveProperty('currency');
    }
  });

  it('取引の一覧が読めなければ欄のまま（守りは API の 409）。読み込みは失敗にしない', async () => {
    const { c } = await open({
      accounts: [defaultAccount(1_000_000), A],
      fail: { 'GET /api/trades': 503 },
    });
    expect(c.getState().phase).toBe('ready');
    c.openAccount('accA');
    c.updateAccount('currency', 'USD');
    await c.settled();
    expect(c.getState().accountsInUse).toBeNull();
    expect(c.getState().account?.reading.body).toHaveProperty('currency', 'USD');
  });

  it('API の 409 currencyLocked: その口座を取引のある口座に入れ、通貨を元に戻して知らせる', async () => {
    const { fake, c } = await open({ accounts: [defaultAccount(1_000_000), A] });
    // 開いた後にほかの端末で口座 A に記録された
    fake.trades.push(tradeIn('accA'));
    c.openAccount('accA');
    c.updateAccount('currency', 'USD');
    await c.saveAccount();
    const s = c.getState();
    expect(s.notice).toEqual({
      area: 'accounts',
      kind: 'error',
      text: '通貨: JPY（取引があるので変更できません）',
    });
    expect(s.accountsInUse?.has('accA')).toBe(true);
    expect(s.account?.draft.currency).toBe('JPY');
    expect(s.account?.saving).toBe(false);
    expect(s.accounts.find((a) => a.id === 'accA')?.currency).toBe('JPY');
    // 次の保存は通貨を送らない（名前・資金だけ直せる）
    c.updateAccount('capital', '900,000');
    await c.saveAccount();
    const last = puts(fake, '/api/accounts/accA').at(-1)?.body;
    expect(last).toEqual({ name: '口座 A', capitalYen: 900_000, riskTolerancePct: 1 });
  });
});
