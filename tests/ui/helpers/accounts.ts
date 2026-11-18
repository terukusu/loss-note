// 口座の例（Issue #47 PR-1）。値・名前はすべて架空（「口座 A」など）。
import { type AccountRecord, DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME } from '../../../core/record';

/** 口座を 1 つ作る（履歴は空・時刻は決まった値） */
export function account(
  id: string,
  name: string,
  capitalYen: number | null,
  riskTolerancePct = 1,
  over: Partial<AccountRecord> = {},
): AccountRecord {
  return {
    id,
    name,
    capitalYen,
    riskTolerancePct,
    capitalHistory: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

/** 既定の口座「口座 1」 */
export function defaultAccount(capitalYen: number | null, riskTolerancePct = 1): AccountRecord {
  return account(DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME, capitalYen, riskTolerancePct);
}

/** 今の設定の形（資金・許容リスク）→ 口座 1 つ（移し替えた後と同じ） */
export function accountsOf(s: {
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
}): AccountRecord[] {
  return [defaultAccount(s.capitalYen, s.riskTolerancePct)];
}

/** 口座 1 つ目の資金・許容リスク（テストで計算の入力を組むとき） */
export function moneyOf(accounts: readonly AccountRecord[]): {
  readonly capitalYen: number | null;
  readonly riskTolerancePct: number;
} {
  const a = accounts[0];
  return { capitalYen: a?.capitalYen ?? null, riskTolerancePct: a?.riskTolerancePct ?? 1 };
}
