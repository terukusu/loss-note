// 明細から口座を選ぶ・損益を口座の通貨で入れる規則（Issue #66 の R3・R4・R6。AC-3・AC-8・AC-12・AC-13 の純関数の側）。
// 値・名前はすべて架空（口座 A・B・D、会社の名前は画面に来ない）。
// 共通の場面 Q: L、イン 100.00、LC 99.50、決済 99.40、数量 100、乗数 1（USD 建ての架空指数U）
import { describe, expect, it } from 'vitest';
import { formatAmount, formatPct, formatR } from '../../ui/src/lib/format';
import { type DraftField, readDraft } from '../../ui/src/lib/record-form';
import {
  AUTO_ACCOUNT_DESC,
  accountHintOf,
  CHOOSE_ACCOUNT_HINT,
  CURRENCY_UNREAD_NOTE,
  currencyMismatchNote,
  currencyOf,
  learnedAccountId,
  learnedText,
  parseProfile,
  pnlFillOf,
  profilePath,
  suggestedAccount,
} from '../../ui/src/lib/statement-account';
import {
  fillFromRow,
  markEdited,
  type ReadRow,
  refillMoney,
} from '../../ui/src/lib/statement-fill';
import { forAll } from '../core/helpers/prng';
import { account } from './helpers/accounts';
import { ACC_A, ACC_D, CTX_A, CTX_AD, INST_USD, pDraft } from './helpers/currency-examples';
import { jst } from './helpers/statement-rows';

const MINUS = '−';
const KEY = '0123456789abcdef0123456789abcdef';
const NONE = new Set<DraftField>();
const A = account('accA', '口座 A', 1_000_000);
const B = account('accB', '口座 B', 200_000);

describe('parseProfile（応答の形を画面の側でも確かめる）', () => {
  it('鍵（16 進 32 文字）と口座の ID（形の合うものだけ）', () => {
    expect(parseProfile({ key: KEY, accountId: 'accA' })).toEqual({ key: KEY, accountId: 'accA' });
    expect(parseProfile({ key: KEY, accountId: null })).toEqual({ key: KEY, accountId: null });
    expect(parseProfile({ key: KEY, accountId: 'a/b' })).toEqual({ key: KEY, accountId: null });
    expect(parseProfile({ key: KEY, accountId: 'x'.repeat(41) })).toEqual({
      key: KEY,
      accountId: null,
    });
  });

  it.each([
    null,
    undefined,
    'x',
    [],
    {},
    { key: KEY.toUpperCase(), accountId: 'accA' },
    { key: `${KEY}0`, accountId: 'accA' },
    { key: 5, accountId: 'accA' },
    { key: '架空証券 X', accountId: 'accA' },
  ])('%o → null', (v) => {
    expect(parseProfile(v)).toBeNull();
  });

  it('覚える道は鍵の形のときだけ', () => {
    expect(profilePath(KEY)).toBe(`/api/statement-profiles/${KEY}`);
    expect(profilePath('../x')).toBeUndefined();
    expect(learnedAccountId('')).toBe('default');
    expect(learnedAccountId('accB')).toBe('accB');
  });
});

describe('suggestedAccount（R3・R4。S1〜S3・S6・S7・S13）', () => {
  const two = [A, B];
  it.each([
    ['S1: 覚えなし', { key: KEY, accountId: null }, two, false, undefined],
    ['S2: 覚え A・口座 2 つ', { key: KEY, accountId: 'accA' }, two, false, 'accA'],
    ['S3: 本人が先に選んだ', { key: KEY, accountId: 'accA' }, two, true, undefined],
    ['S5・S6: 鍵なし（会社が写っていない）', null, two, false, undefined],
    ['S7: 口座 1 つ', { key: KEY, accountId: 'accA' }, [A], false, undefined],
    ['S13: 一覧に無い口座', { key: KEY, accountId: 'gone' }, two, false, undefined],
  ] as const)('%s', (_name, profile, accounts, touched, want) => {
    expect(suggestedAccount(profile, accounts, touched)).toBe(want);
  });

  it('性質: 提案は必ず今の一覧の口座で、口座 1 つ以下・touched では出ない', () => {
    forAll(
      66,
      300,
      (r) => ({
        n: r.int(0, 4),
        id: r.bool(0.7) ? `acc${r.int(0, 5)}` : null,
        touched: r.bool(0.3),
      }),
      ({ n, id, touched }) => {
        const accounts = Array.from({ length: n }, (_, i) => account(`acc${i}`, `口座 ${i}`, 1));
        const got = suggestedAccount({ key: KEY, accountId: id }, accounts, touched);
        if (got !== undefined) {
          expect(accounts.some((a) => a.id === got)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(2);
          expect(touched).toBe(false);
        } else if (!touched && n >= 2 && id !== null && accounts.some((a) => a.id === id)) {
          throw new Error('提案が出るはずの場面で出なかった');
        }
      },
    );
  });
});

describe('pnlFillOf（R6。C1〜C6 の入る / 入らない・脇の文）', () => {
  it.each([
    ['C1: 口座 A（JPY）・JPY', 'JPY', 'JPY', '口座 A', true, undefined],
    ['C2: 口座 A（JPY）・不明', 'unknown', 'JPY', '口座 A', true, undefined],
    [
      'C3: 口座 A（JPY）・USD',
      'USD',
      'JPY',
      '口座 A',
      false,
      '明細の損益は USD です（口座 A は JPY）。USD の口座を選ぶか、円の損益を入力してください',
    ],
    ['C4: 口座 D（USD）・USD', 'USD', 'USD', '口座 D', true, undefined],
    [
      'C5: 口座 D（USD）・JPY',
      'JPY',
      'USD',
      '口座 D',
      false,
      '明細の損益は JPY です（口座 D は USD）。JPY の口座を選ぶか、USD の損益を入力してください',
    ],
    [
      'C6: 口座 D（USD）・不明',
      'unknown',
      'USD',
      '口座 D',
      false,
      '明細の損益の通貨が読めませんでした。USD の損益を入力してください',
    ],
  ] as const)('%s', (_name, cur, acc, name, fills, note) => {
    const got = pnlFillOf(cur, acc, name);
    expect(got.fills).toBe(fills);
    expect(got.note).toBe(note);
  });

  it('文言と通貨の形', () => {
    expect(CURRENCY_UNREAD_NOTE).toBe('明細の損益の通貨が読めませんでした');
    expect(currencyMismatchNote('EUR', '口座 B', 'JPY')).toBe(
      '明細の損益は EUR です（口座 B は JPY）。EUR の口座を選ぶか、円の損益を入力してください',
    );
    expect(currencyOf('USD')).toBe('USD');
    for (const v of ['usd', 'US', 'USDX', '', null, 1, undefined])
      expect(currencyOf(v)).toBe('unknown');
  });
});

/** 場面 Q の明細の行（通貨・損益・手数料の合計だけを替える） */
function rowQ(pnlCurrency: string, pnl: number, feesTotal: number): ReadRow {
  return {
    symbol: INST_USD.name,
    side: 'L',
    entryPrice: 100,
    exitPrice: 99.4,
    quantity: 100,
    pnl,
    pnlCurrency,
    entryTime: jst(2026, 3, 4, 9, 0),
    exitTime: jst(2026, 3, 4, 10, 0),
    timeZoneNeedsCheck: false,
    fees: [feesTotal],
    feesTotal,
    exitOrderType: 'unknown',
  };
}

const CTX_ONLY_D = { ...CTX_AD, accounts: [ACC_A, ACC_D] };

describe('流し込み（AC-8・AC-12。C1〜C6 の 1R・リスク（%）・R）', () => {
  it('C1: 口座 A・JPY −9,100・手数料 100 → 入る。1R 7,500円・0.8%・−1.2R（#47 F3 と同じ）', () => {
    const f = fillFromRow(pDraft({}), rowQ('JPY', -9100, 100), NONE, { accountCurrency: 'JPY' });
    expect(f.draft.pnlYen).toBe('-9100');
    expect(f.draft.feeYen).toBe('100');
    expect(f.marks.pnlYen).toBe('read');
    const p = readDraft(f.draft, CTX_A).preview;
    expect(formatAmount(p.oneRYen as number, 'JPY')).toBe('7,500円');
    expect(formatPct(p.riskPct as number)).toBe('0.8%');
    expect(formatR(p.r)).toBe(`${MINUS}1.2R`);
  });

  it('C2: 通貨が不明 → C1 と同じに入る（KEEP-1）', () => {
    const c1 = fillFromRow(pDraft({}), rowQ('JPY', -9100, 100), NONE, { accountCurrency: 'JPY' });
    const c2 = fillFromRow(pDraft({}), rowQ('unknown', -9100, 100), NONE, {
      accountCurrency: 'JPY',
    });
    expect(c2).toEqual(c1);
  });

  it('C3: 口座 A・USD −62.00 → 入らない（空・印なし）。ほかの 7 欄は入る', () => {
    const f = fillFromRow(pDraft({}), rowQ('USD', -62, 2), NONE, { accountCurrency: 'JPY' });
    expect(f.draft.pnlYen).toBe('');
    expect(f.draft.feeYen).toBe('');
    expect(f.marks.pnlYen).toBeUndefined();
    expect(f.marks.feeYen).toBeUndefined();
    expect(f.draft.exitPrice).toBe('99.4');
    expect(f.marks.exitPrice).toBe('read');
  });

  it('C4: 口座 D（USD）・USD −62.00・手数料 2.00 → 入る。1R 50.00 USD・0.5%・−1.2R', () => {
    const draft = { ...pDraft({}), accountId: ACC_D.id };
    const f = fillFromRow(draft, rowQ('USD', -62, 2), NONE, { accountCurrency: 'USD' });
    expect(f.draft.pnlYen).toBe('-62');
    expect(f.draft.feeYen).toBe('2');
    const p = readDraft(f.draft, CTX_ONLY_D).preview;
    expect(formatAmount(p.oneRYen as number, 'USD')).toBe('50.00 USD');
    expect(p.riskPct).toBeCloseTo(0.5, 12);
    expect(formatR(p.r)).toBe(`${MINUS}1.2R`);
  });

  it.each([
    ['C5: 口座 D・JPY', 'JPY', -9100, 100],
    ['C6: 口座 D・不明', 'unknown', -9100, 100],
  ] as const)('%s → 入らない', (_name, cur, pnl, fee) => {
    const f = fillFromRow(pDraft({}), rowQ(cur, pnl, fee), NONE, { accountCurrency: 'USD' });
    expect(f.draft.pnlYen).toBe('');
    expect(f.draft.feeYen).toBe('');
    expect(f.marks.pnlYen).toBeUndefined();
  });
});

describe('口座の切り替え（AC-13。C7）', () => {
  it('C7: D で入った USD の値は A で外れ（C3 の理由）、D に戻すと戻る。手で打った値はどちらでも残る', () => {
    const row = rowQ('USD', -62, 2);
    const onD = fillFromRow({ ...pDraft({}), accountId: ACC_D.id }, row, NONE, {
      accountCurrency: 'USD',
    });
    const toA = refillMoney(onD, row, NONE, 'JPY');
    expect(toA.draft.pnlYen).toBe('');
    expect(toA.draft.feeYen).toBe('');
    expect(pnlFillOf(row.pnlCurrency, 'JPY', ACC_A.name).note).toBe(
      '明細の損益は USD です（口座 A は JPY）。USD の口座を選ぶか、円の損益を入力してください',
    );
    const back = refillMoney(toA, row, NONE, 'USD');
    expect(back.draft.pnlYen).toBe('-62');
    expect(back.draft.feeYen).toBe('2');
    expect(back.marks.pnlYen).toBe('read');
    // A で手数料を手で打つ → D に戻しても残り、損益だけ戻る。もう一度 A へ替えても手で打った値は残る
    const touched = new Set<DraftField>(['feeYen']);
    const typed = {
      draft: { ...toA.draft, feeYen: '300' },
      marks: markEdited(toA.marks, 'feeYen'),
    };
    const backTyped = refillMoney(typed, row, touched, 'USD');
    expect(backTyped.draft.feeYen).toBe('300');
    expect(backTyped.draft.pnlYen).toBe('-62');
    const againA = refillMoney(backTyped, row, touched, 'JPY');
    expect(againA.draft.feeYen).toBe('300');
    expect(againA.draft.pnlYen).toBe('');
  });
});

describe('レビュー P3: 円の口座で通貨が「不明」のときは、銘柄の価格の通貨が JPY か未設定のときだけ入れる', () => {
  it.each([
    ['価格の通貨 未設定', null, true],
    ['価格の通貨 JPY', 'JPY', true],
    ['一覧に無い銘柄（undefined）', undefined, true],
    ['価格の通貨 USD', 'USD', false],
    ['価格の通貨 EUR', 'EUR', false],
  ] as const)('%s', (_name, price, fills) => {
    const got = pnlFillOf('unknown', 'JPY', '口座 A', price);
    expect(got.fills).toBe(fills);
    expect(got.note).toBe(
      fills ? undefined : '明細の損益の通貨が読めませんでした。円の損益を入力してください',
    );
    const f = fillFromRow(pDraft({}), rowQ('unknown', -62, 2), NONE, {
      accountCurrency: 'JPY',
      priceCurrency: price,
    });
    expect(f.draft.pnlYen).toBe(fills ? '-62' : '');
    expect(f.draft.feeYen).toBe(fills ? '2' : '');
  });

  it('口座を替えて戻しても同じ判断（refillMoney も価格の通貨を見る）', () => {
    const row = rowQ('unknown', -62, 2);
    const onD = fillFromRow({ ...pDraft({}), accountId: ACC_D.id }, row, NONE, {
      accountCurrency: 'USD',
      priceCurrency: 'USD',
    });
    expect(onD.draft.pnlYen).toBe('');
    expect(refillMoney(onD, row, NONE, 'JPY', 'USD').draft.pnlYen).toBe('');
    expect(refillMoney(onD, row, NONE, 'JPY', null).draft.pnlYen).toBe('-62');
  });
});

describe('口座の欄の下の 1 行（デザイン 1・3b）', () => {
  const D = account('accD', '口座 D', 10_000, 1, { currency: 'USD' });
  const E = account('accE', '口座 E', 10_000, 1, { currency: 'USD' });
  it.each([
    ['覚えの無い明細', [A, B], 'accA', 'JPY', true, CHOOSE_ACCOUNT_HINT],
    ['覚えあり', [A, B], 'accA', 'JPY', false, undefined],
    ['口座 1 つ', [A], 'accA', 'JPY', true, undefined],
    [
      '通貨が違い、合う口座がある（優先）',
      [A, D],
      'accA',
      'USD',
      true,
      '明細は USD です。USD の口座は 口座 D です',
    ],
    [
      '合う口座が 2 つ',
      [A, D, E],
      'accA',
      'USD',
      false,
      '明細は USD です。USD の口座は 口座 D・口座 E です',
    ],
    ['通貨が違い、合う口座が無い', [A, B], 'accA', 'USD', false, undefined],
    ['今の口座が合っている', [A, D], 'accD', 'USD', false, undefined],
    ['通貨が不明', [A, D], 'accA', 'unknown', true, CHOOSE_ACCOUNT_HINT],
  ] as const)('%s', (_name, accounts, accountId, cur, firstTime, want) => {
    expect(accountHintOf({ accounts, accountId, pnlCurrency: cur, firstTime })).toBe(want);
  });

  it('文言（記録の後・読み上げ）', () => {
    expect(CHOOSE_ACCOUNT_HINT).toBe('この明細の口座を選んでください。次から自動で選びます');
    expect(AUTO_ACCOUNT_DESC).toBe(
      '前にこの明細で選んだ口座を自動で選びました。違うときは選び直してください',
    );
    expect(learnedText('口座 B')).toBe('次からこの明細は 口座 B を自動で選ぶようにしました');
  });
});
