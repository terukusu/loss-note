// 設定のタブの根のまとめた一覧（#133 の AC-1・AC-2）の純関数。値は架空
import { describe, expect, it } from 'vitest';
import { parseRoute } from '../../ui/src/lib/routes';
import {
  ACCOUNTS_INFO,
  ACCOUNTS_LEAD,
  ACCOUNTS_LEAD_SET,
  accountsLead,
  settingsMenu,
} from '../../ui/src/lib/settings-menu';
import { account, defaultAccount } from './helpers/accounts';

const A1 = defaultAccount(1_000_000);
const A2 = account('b', '口座 B', 500_000, 2);
const UNSET = account('c', '口座 C', null);

const flat = (m: ReturnType<typeof settingsMenu>) =>
  m.flatMap((g) => g.rows.map((r) => `${g.title}|${r.label}|${r.meta ?? ''}|${r.href}`));

describe('settingsMenu（AC-1）', () => {
  it('R1: 口座 2（設定済み）・銘柄 3・心理 19 / 21・今日 3 回・用語 17 → 区切り 口座 / 記録 と、行の添え', () => {
    const m = settingsMenu({
      accounts: [A1, A2],
      instruments: 3,
      emotions: '19 / 21 個',
      usageToday: 3,
      glossary: 17,
    });
    expect(m.map((g) => g.title)).toEqual(['口座', '記録']);
    expect(flat(m)).toEqual([
      '口座|口座|2 件|/settings/accounts',
      '記録|銘柄|3 件|/settings/instruments',
      '記録|心理のタグ|19 / 21 個|/settings/emotions',
      '記録|AI の利用状況|今日 3 回|/settings/ai-usage',
      '記録|用語集|17 語|/glossary',
    ]);
  });

  it('読めていない数は添えを出さない（「0 件」と見せない）。0 は 0 のまま', () => {
    const m = settingsMenu({
      accounts: null,
      instruments: 0,
      emotions: null,
      usageToday: null,
      glossary: 17,
    });
    expect(m.flatMap((g) => g.rows.map((r) => r.meta))).toEqual([
      null,
      '0 件',
      null,
      null,
      '17 語',
    ]);
  });

  it('壊れた数（負・小数・NaN）は添えを出さない。大きな数は桁区切り', () => {
    const m = settingsMenu({
      accounts: null,
      instruments: 1.5,
      emotions: null,
      usageToday: Number.NaN,
      glossary: 1200,
    });
    expect(m.flatMap((g) => g.rows.map((r) => r.meta))).toEqual([
      null,
      null,
      null,
      null,
      '1,200 語',
    ]);
  });

  it('AC-2: 行き先はどれもアプリの画面（設定のタブの次の画面）', () => {
    const m = settingsMenu({
      accounts: [A1],
      instruments: 1,
      emotions: null,
      usageToday: 0,
      glossary: 17,
    });
    const names = m.flatMap((g) => g.rows.map((r) => parseRoute(r.href, { dev: false })?.name));
    expect(names).toEqual([
      'settingsAccounts',
      'settingsInstruments',
      'settingsEmotions',
      'settingsAiUsage',
      'glossary',
    ]);
  });
});

describe('根の「口座」の添えは中身（#133 デザインレビュー a-3）', () => {
  const meta = (accounts: Parameters<typeof settingsMenu>[0]['accounts']) =>
    settingsMenu({ accounts, instruments: 0, emotions: null, usageToday: 0, glossary: 17 })[0]
      ?.rows[0]?.meta;
  it('口座が 1 つ: 口座の一覧の 2 行目と同じ「資金 · 許容」', () => {
    expect(meta([A1])).toBe('1,000,000円 · 許容 1%');
  });
  it('資金が未設定の口座がある: 件数より先に「資金 未設定」', () => {
    expect(meta([defaultAccount(null)])).toBe('資金 未設定');
    expect(meta([A1, A2, UNSET])).toBe('資金 未設定');
  });
  it('2 つ以上で全部設定済み: 件数。読めていない: 添えなし', () => {
    expect(meta([A1, A2])).toBe('2 件');
    expect(meta(null)).toBeNull();
  });
});

describe('口座の画面の先頭の 1 行と「i」（冒頭の説明の移し先）', () => {
  it('1 行は短く、「i」に記録済みの取引は変わらないことと資金・許容リスクの意味', () => {
    expect(ACCOUNTS_LEAD).not.toContain('\n');
    expect(ACCOUNTS_LEAD.length).toBeLessThanOrEqual(30);
    const body = ACCOUNTS_INFO.body.join('');
    expect(body).toContain('記録済みの取引は変わりません');
    expect(body).toContain('資金はリスク（%）の分母');
  });

  it('資金が未設定の口座があるときだけ頼む文、全部設定済みなら頼まない文（a-5）', () => {
    expect(accountsLead([A1, UNSET])).toBe(ACCOUNTS_LEAD);
    expect(accountsLead([])).toBe(ACCOUNTS_LEAD);
    expect(accountsLead([A1, A2])).toBe(ACCOUNTS_LEAD_SET);
    expect(ACCOUNTS_LEAD_SET).not.toContain('ください');
  });
});
