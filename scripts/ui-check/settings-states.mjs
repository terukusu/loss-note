// 設定の画面の偽の値と状態（SETTINGS_STATES）
import { waitReady } from './base.mjs';
import {
  ACC_B,
  ACC_C,
  ACC_ONE,
  ACC_USD,
  ACCOUNTS_2,
  FAKE_AI_USAGE,
  FAKE_US30_AUTO,
  seedSettings,
  setAccounts,
  usageBody,
} from './fixtures.mjs';

export const SETTINGS_SCREENS = {
  '/settings': { h1: '設定', wait: '#settings-link-accounts .rowlink__meta' },
  '/settings/accounts': { h1: '口座', wait: '#settings-account-add' },
  '/settings/instruments': { h1: '銘柄', wait: '#settings-inst-add' },
  '/settings/ai-usage': { h1: 'AI の利用状況', wait: '.usage' },
  '/settings/emotions': { h1: '心理のタグ', wait: '.emotionchoices__card' },
};

/** 設定の画面を開き、中身（根は口座の数の添え、口座・銘柄は ［＋ 〇〇を追加］）が出るまで待つ */
export async function openSettings(page, base, path = '/settings') {
  const screen = SETTINGS_SCREENS[path];
  if (!screen) throw new Error(`openSettings: 知らない画面 ${path}`);
  await page.goto(`${base}${path}`);
  await waitReady(page, screen.h1);
  await page.locator(screen.wait).first().waitFor({ state: 'visible', timeout: 15000 });
}

/** 開いている下のシート（設定の編集・追加。#133）が見えるまで待つ */
export async function waitSettingsSheet(page, id) {
  await page.locator(`dialog#${id}[open]`).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * 設定の画面の状態（幅 × テーマで測る）。path は開く画面（#133）、prep は開く前に偽の API を整え、fn は開いた画面をその状態にする。
 * 編集・追加は下のシートを開いた状態で測る
 */
export const SETTINGS_STATES = [
  {
    slug: 'settings-1-open',
    name: '根（まとめた一覧）',
    path: '/settings',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('#settings-link-aiUsage .rowlink__meta').waitFor();
    },
  },
  {
    slug: 'settings-5-accounts',
    name: '口座 2 つ（未設定の行）',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_C]);
    },
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
    },
  },
  {
    slug: 'settings-6-account-edit',
    name: '口座の編集のシート',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-name').waitFor();
      await p.locator('.sethistory__title', { hasText: '資金の履歴（3 件）' }).waitFor();
    },
  },
  {
    slug: 'settings-7-account-add',
    name: '口座の追加のシート',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, ACCOUNTS_2);
    },
    fn: async (p) => {
      await p.locator('#settings-account-add').click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-name').fill('口座 Ｂ');
      await p.locator('#settings-account-capital').fill('300,000');
      await p.locator('#settings-account-save').click();
      await p
        .locator('#settings-account-name-error', { hasText: '同じ名前の口座があります' })
        .waitFor();
    },
  },
  {
    // #47 PR-2 U30: USD の口座の行
    slug: 'settings-8-usd-row',
    name: 'USD の口座の行',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '10,000.00 USD · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 D を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-currency').waitFor();
    },
  },
  {
    // #47 PR-2 U31: 取引のある口座（既定の口座。例の取引は口座が付いていない）の直す欄は通貨が文字
    slug: 'settings-9-currency-locked',
    name: '通貨を変更できない口座',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      // 通貨を変える操作のときだけ取引を確かめる（開いたときは読まない）。取引のある口座は文字に戻る
      await p.locator('input#settings-account-currency').fill('USD');
      await p
        .locator('#settings-account-currency', { hasText: '取引があるので変更できません' })
        .waitFor();
    },
  },
  {
    slug: 'settings-15-instruments',
    name: '銘柄の一覧',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '初期値のまま' }).waitFor();
    },
  },
  {
    slug: 'settings-2-editing',
    name: '銘柄の編集のシート',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').waitFor();
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('USD');
    },
  },
  {
    slug: 'settings-16-inst-add',
    name: '銘柄の追加のシート',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('#settings-inst-add').click();
      await waitSettingsSheet(p, 'settings-inst-add-sheet');
      await p.locator('#settings-new-name').fill('xau');
      await p
        .locator('#settings-new-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
    },
  },
  {
    // 口座の誤りと警告（#133 で銘柄の誤りは settings-3b-inst-errors に分けた。画面が別になったため）
    slug: 'settings-3-errors',
    name: '口座の誤りと警告',
    path: '/settings/accounts',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-capital').fill('1000.5');
      await p.locator('#settings-account-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
    },
  },
  {
    slug: 'settings-3b-inst-errors',
    name: '銘柄の誤り',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-currency').fill('US');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.getByText('同じ名前の銘柄があります').waitFor();
    },
  },
  {
    slug: 'settings-4-unset',
    name: '資金が未設定',
    path: '/settings/accounts',
    prep: (api) => {
      api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO);
    },
    fn: async (p) => {
      await p
        .locator('.setrow', { hasText: '資金を入力するとリスク（%）が表示されます' })
        .waitFor();
    },
  },
  {
    slug: 'settings-8-usage-reached',
    name: 'AI 金額で届いた',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 24, microUsd: 721265 },
          month: { month: '2026-11', count: 96, microUsd: 3121265 },
          blocked: { count: false, microUsd: true },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日の読み取りは上限に届きました').waitFor();
    },
  },
  {
    slug: 'settings-11-usage-near',
    name: 'AI 上限に近いだけ',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 25, microUsd: 310000 },
          month: { month: '2026-11', count: 88, microUsd: 1720000 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日の読み取りは上限に近づいています').waitFor();
    },
  },
  {
    slug: 'settings-12-usage-count-reached',
    name: 'AI 回数で届いた',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 30, microUsd: 420000 },
          month: { month: '2026-11', count: 120, microUsd: 2100000 },
          blocked: { count: true, microUsd: false },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('あと 0 回').waitFor();
    },
  },
  {
    slug: 'settings-13-usage-zero',
    name: 'AI 月の初日・0 回',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-12-01', count: 0, microUsd: 0 },
          month: { month: '2026-12', count: 0, microUsd: 0 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日（12 月 1 日）').waitFor();
    },
  },
  {
    slug: 'settings-9-usage-bypass',
    name: 'AI 上限を受けない',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 40, microUsd: 1500000 },
          month: { month: '2026-11', count: 212, microUsd: 6400000 },
          bypass: true,
          limits: { count: null, userMicroUsd: null, dailyMicroUsd: 2000000 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('あなたの 1 日の上限: なし').waitFor();
    },
  },
  {
    slug: 'settings-14-usage-loading',
    name: 'AI 読み込み中',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = { status: 200, body: FAKE_AI_USAGE, holdMs: 20000 };
    },
    fn: async (p) => {
      await p.locator('.usage .loading', { hasText: '読み込んでいます…' }).waitFor();
    },
  },
  {
    slug: 'settings-10-usage-failed',
    name: 'AI 読めない',
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
      api.aiUsage = { status: 503, body: { error: 'read_unavailable' } };
    },
    fn: async (p) => {
      // AC-7（#62）の「読めなくても口座の編集と [保存] は使える」は、#133 で別の画面になったので SET6 で見る
      await p.getByText('利用状況を読み込めませんでした').waitFor();
    },
  },
];
