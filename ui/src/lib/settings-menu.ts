// 設定のタブの根のまとめた一覧（#133。設計書 9.2 の設定の行・ui-guidelines 9.3・9.9・9.12）の純関数。DOM・通信を持たない。
// - 区切りは 口座 / 記録 / 表示 / アプリ（#121）/ アカウント。口座・銘柄・心理のタグ（#163）・AI の利用状況・用語集は次の画面への
//   押せる行（右に ›）
// - 行の右の添えは数（「2 件」「今日 3 回」「17 語」）。読めていない・読めなかった数は添えを出さない（「0 件」と見せない）
// - 口座の添えは中身（口座が 1 つ = 「1,000,000円 · 許容 1%」、資金が未設定の口座がある = 「資金 未設定」、ほか = 件数）。
//   冒頭の説明の文を無くした代わりに、根で「まず資金を入れる」を伝える（#133 デザインレビュー a-3）
// - 冒頭の説明の文（今までの 4 行）は、口座の画面の先頭の 1 行と「i」の説明に移す（9.2・9.9「カードに説明の文を常に出さない」）

import type { AccountRecord } from '../../../core/record';
import { accountLine } from './accounts';

export type SettingsLinkId = 'accounts' | 'instruments' | 'emotions' | 'aiUsage' | 'glossary';

export interface SettingsLinkRow {
  readonly id: SettingsLinkId;
  readonly label: string;
  /** 次の画面の URL */
  readonly href: string;
  /** 行の右の添え（無ければ null） */
  readonly meta: string | null;
}

export interface SettingsLinkGroup {
  readonly id: 'accounts' | 'record';
  readonly title: string;
  readonly rows: readonly SettingsLinkRow[];
}

export interface SettingsMenuInput {
  /** 口座（読めていなければ null） */
  readonly accounts: readonly AccountRecord[] | null;
  /** 銘柄の数（読めていなければ null） */
  readonly instruments: number | null;
  /** 心理のタグの行の添え（「19 / 21 個」。読めていなければ null。#163） */
  readonly emotions: string | null;
  /** 今日の AI の読み取りの回数（読めていなければ null） */
  readonly usageToday: number | null;
  /** 用語集の言葉の数 */
  readonly glossary: number;
}

/** 表示・アカウントの区切りの見出し（中身は画面の部品: テーマの切り替え・ログアウト） */
export const DISPLAY_GROUP_TITLE = '表示';
/** 表示とアカウントの間の区切り（ホーム画面のアプリとして入れる。#121。中身は components/InstallApp.tsx） */
export const APP_GROUP_TITLE = 'アプリ';
export const ACCOUNT_GROUP_TITLE = 'アカウント';

/** 口座の画面の先頭の 1 行と「i」（冒頭の説明の移し先）。頼む文は資金が未設定の口座があるときだけ（a-5） */
export const ACCOUNTS_LEAD = '記録を始める前に、資金と許容リスクを入力してください。';
export const ACCOUNTS_LEAD_SET = '資金と許容リスクは口座ごとに決めます。';

const hasUnset = (accounts: readonly AccountRecord[]) =>
  accounts.length === 0 || accounts.some((a) => a.capitalYen === null);

/** 口座の画面の先頭の 1 行（資金が未設定の口座がある・口座が無い = 頼む文、全部設定済み = 頼まない文） */
export function accountsLead(accounts: readonly AccountRecord[]): string {
  return hasUnset(accounts) ? ACCOUNTS_LEAD : ACCOUNTS_LEAD_SET;
}

/** 根の「口座」の行の添え（読めていなければ null） */
function accountsMeta(accounts: readonly AccountRecord[] | null): string | null {
  if (accounts === null) return null;
  if (accounts.some((a) => a.capitalYen === null)) return '資金 未設定';
  const [only] = accounts;
  if (accounts.length === 1 && only) return accountLine(only);
  return countMeta(accounts.length, '件');
}
export const ACCOUNTS_INFO = {
  label: '資金と許容リスク',
  body: [
    '記録のたびに、その時点の資金と許容リスクを取引に保存します。後で変えても、記録済みの取引は変わりません。',
    '資金はリスク（%）の分母、許容リスクは冷静なときに決めておく 1 回の負けの線です。',
  ],
  id: 'settings-accounts-info',
} as const;

const isCount = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n >= 0;

const countMeta = (n: number | null, unit: string): string | null =>
  isCount(n) ? `${n.toLocaleString('ja-JP')} ${unit}` : null;

/** 根の押せる行の区切り（口座・記録の 2 つ。表示・アカウントは画面の部品） */
export function settingsMenu(i: SettingsMenuInput): readonly SettingsLinkGroup[] {
  return [
    {
      id: 'accounts',
      title: '口座',
      rows: [
        {
          id: 'accounts',
          label: '口座',
          href: '/settings/accounts',
          meta: accountsMeta(i.accounts),
        },
      ],
    },
    {
      id: 'record',
      title: '記録',
      rows: [
        {
          id: 'instruments',
          label: '銘柄',
          href: '/settings/instruments',
          meta: countMeta(i.instruments, '件'),
        },
        {
          id: 'emotions',
          label: '心理のタグ',
          href: '/settings/emotions',
          meta: i.emotions,
        },
        {
          id: 'aiUsage',
          label: 'AI の利用状況',
          href: '/settings/ai-usage',
          meta: isCount(i.usageToday) ? `今日 ${i.usageToday.toLocaleString('ja-JP')} 回` : null,
        },
        {
          id: 'glossary',
          label: '用語集',
          href: '/glossary',
          meta: countMeta(i.glossary, '語'),
        },
      ],
    },
  ];
}
