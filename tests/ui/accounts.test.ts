// 口座の純関数（Issue #47 PR-1 契約「accounts.ts」・AC-2・AC-6・AC-10・U10・U11・U12・U13・U19）。
// 値・名前はすべて架空（「口座 A」など）
import { describe, expect, it } from 'vitest';
import {
  type AccountRecord,
  accountIdOf,
  DEFAULT_ACCOUNT_ID,
  type StoredTrade,
} from '../../core/record';
import {
  ACCOUNT_FIELD_LABEL,
  ACCOUNT_MSG,
  accountAllowanceLine,
  accountChoiceKind,
  accountDraftOf,
  accountLine,
  accountNameOf,
  defaultAccountId,
  nameWidth,
  readAccountDraft,
  readNewAccountDraft,
  savedText,
  segmentGrowIndex,
  selectedAccountId,
  selectedNote,
  sortAccounts,
  switchHint,
  tradeAccountName,
  UNKNOWN_ACCOUNT,
  verdictAsideText,
} from '../../ui/src/lib/accounts';
import { SETTINGS_MSG } from '../../ui/src/lib/settings-form';
import { mulberry32 as rng } from '../core/helpers/prng';
import { account, defaultAccount } from './helpers/accounts';

const ONE = defaultAccount(1_000_000);
const A = account('accA', '口座 A', 1_000_000);
const B = account('accB', '口座 B', 200_000);
const C = account('accC', '口座 C', null);

/** 作った時刻と口座だけを持つ取引（既定の口座の判定に使う形） */
function t(createdAt: number, accountId?: string): Pick<StoredTrade, 'createdAt' | 'record'> {
  return {
    createdAt,
    record: { ...(accountId === undefined ? {} : { accountId }) } as StoredTrade['record'],
  };
}

describe('accountIdOf（API の account_id_of と同じ表）', () => {
  it.each([
    [{}, 'default'],
    [{ accountId: 'accA' }, 'accA'],
    [{ accountId: 'default' }, 'default'],
    [{ accountId: '' }, 'default'],
  ])('%j → %s', (record, want) => {
    expect(accountIdOf(record)).toBe(want);
  });
  it('既定の口座の ID は決まった値', () => {
    expect(DEFAULT_ACCOUNT_ID).toBe('default');
  });
});

describe('sortAccounts（API の (nameKey, name, id) と同じ）', () => {
  it('名前の順。「口座 1」が先、全角・大文字小文字は同じ鍵', () => {
    const got = sortAccounts([B, A, ONE]).map((a) => a.name);
    expect(got).toEqual(['口座 1', '口座 A', '口座 B']);
  });
  it('入力を変えない', () => {
    const list = [B, A];
    sortAccounts(list);
    expect(list).toEqual([B, A]);
  });
});

describe('accountChoiceKind（U1〜U3: 1 = 無し / 2〜3 = Segment / 4 以上 = select）', () => {
  it.each([
    [0, 'none'],
    [1, 'none'],
    [2, 'segment'],
    [3, 'segment'],
    [4, 'select'],
    [12, 'select'],
  ])('%i → %s', (n, want) => {
    expect(accountChoiceKind(n)).toBe(want);
  });
});

describe('defaultAccountId（R4・B3・B4）', () => {
  it('B3: 最後に記録した取引が口座 B → B', () => {
    expect(defaultAccountId([t(1, 'accA'), t(2, 'accB')], [A, B])).toBe('accB');
  });
  it('B4: 最後の取引に口座が付いていない（移す前）→ 既定の口座', () => {
    expect(defaultAccountId([t(1, 'accB'), t(2)], [ONE, B])).toBe('default');
  });
  it('取引が無い・その口座が一覧に無い → 既定の口座', () => {
    expect(defaultAccountId([], [ONE, B])).toBe('default');
    expect(defaultAccountId([t(1, 'gone')], [ONE, B])).toBe('default');
  });
  it('性質: 取引の並びに依らない（作った時刻が最大の取引の口座）', () => {
    const r = rng(47);
    const accounts = [ONE, A, B];
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(r() * 6);
      const ts = Array.from({ length: n }, (_, k) => {
        const pick = Math.floor(r() * 4);
        return t(k * 10 + 1, pick === 3 ? undefined : (accounts[pick] as AccountRecord).id);
      });
      const want = accountIdOf((ts[ts.length - 1] as ReturnType<typeof t>).record);
      const shuffled = [...ts].sort(() => r() - 0.5);
      expect(defaultAccountId(shuffled, accounts)).toBe(want);
    }
  });
});

describe('名前・文言', () => {
  it('accountNameOf: 一覧に無い既定の口座は「口座 1」、ほかは見つからない', () => {
    expect(accountNameOf('accA', [A])).toBe('口座 A');
    expect(accountNameOf('default', [])).toBe('口座 1');
    expect(accountNameOf('gone', [A])).toBe(UNKNOWN_ACCOUNT);
  });
  it('tradeAccountName: accountId の無い取引は既定の口座の名前（U18）', () => {
    expect(tradeAccountName(t(1), [ONE, A])).toBe('口座 1');
    expect(tradeAccountName(t(1, 'accA'), [ONE, A])).toBe('口座 A');
  });
  it('selectedAccountId: 空は既定（直す画面は元の口座）', () => {
    expect(selectedAccountId('')).toBe('default');
    expect(selectedAccountId('', 'accB')).toBe('accB');
    expect(selectedAccountId('accA', 'accB')).toBe('accA');
  });
  it('U10・U17: 判定の枠の 1 行', () => {
    expect(verdictAsideText('口座 A', 1_000_000)).toBe('口座 A の資金 1,000,000円 に対して');
    expect(verdictAsideText('口座 A', 1_000_000, { recorded: true })).toBe(
      '口座 A の資金 1,000,000円（記録したとき）に対して',
    );
    expect(verdictAsideText('口座 B', null)).toBe('口座 B（資金は未設定）');
  });
  it('U11: 保存の後の知らせ', () => {
    expect(savedText(2, '口座 A')).toBe('口座 A に記録しました');
    expect(savedText(1, '口座 1')).toBe('記録しました');
  });
  it('U19: 直す画面で口座を替えたときの 1 行（元へ戻すと消える）', () => {
    expect(switchHint(B, true)).toBe('口座 B の今の資金 200,000円 で計算し直します');
    expect(switchHint(C, true)).toBe('口座 C は資金が未設定です。リスク（%）は出なくなります');
    expect(switchHint(B, false)).toBeNull();
    expect(switchHint(undefined, true)).toBeNull();
  });
  it('U12・U13: 設定の口座の行の 2・3 行目', () => {
    expect(accountLine(A)).toBe('1,000,000円 · 許容 1%');
    expect(accountAllowanceLine(A)).toBe('1 回の負けは 10,000円 まで');
    expect(accountLine(C)).toBe('資金 未設定 · 許容 1%');
    expect(accountAllowanceLine(C)).toBe('資金を入れるとリスク（%）が出ます');
    expect(accountLine({ capitalYen: 1_000_000, riskTolerancePct: 1.5 })).toBe(
      '1,000,000円 · 許容 1.5%',
    );
  });
});

describe('readAccountDraft（設定の直す欄・足す欄。AC-2）', () => {
  it('開いたときの下書きは保存値（3 桁区切り・未設定は空）', () => {
    expect(accountDraftOf(A)).toEqual({
      name: '口座 A',
      currency: 'JPY',
      capital: '1,000,000',
      risk: '1',
    });
    expect(accountDraftOf(C)).toEqual({ name: '口座 C', currency: 'JPY', capital: '', risk: '1' });
  });
  it('直す: 3 欄の本文', () => {
    const got = readAccountDraft(
      { name: ' 口座 A2 ', currency: 'JPY', capital: '500,000', risk: '1.5' },
      [A, B],
      'accA',
      1_000_000,
    );
    expect(got.body).toEqual({
      name: '口座 A2',
      currency: 'JPY',
      capitalYen: 500_000,
      riskTolerancePct: 1.5,
    });
    expect(got.errors).toEqual({});
  });
  it('A6: 「口座 A」があるときに「口座 Ａ」・「 口座 a 」は重複', () => {
    for (const name of ['口座 Ａ', ' 口座 a ']) {
      const got = readAccountDraft(
        { name, currency: 'JPY', capital: '', risk: '1' },
        [A],
        null,
        null,
      );
      expect(got.body, name).toBeNull();
      expect(got.errors.name, name).toBe(ACCOUNT_MSG.duplicateName);
    }
    // 自分自身の名前（大文字小文字の違い）は重複でない
    expect(
      readAccountDraft(
        { name: '口座 a', currency: 'JPY', capital: '1', risk: '1' },
        [A],
        'accA',
        1_000_000,
      ).body,
    ).not.toBeNull();
  });
  it('A7: 3.5 と 0.4 は誤り、2.5 は本文あり + 2% 超の警告', () => {
    for (const risk of ['3.5', '0.4']) {
      const got = readAccountDraft(
        { name: '口座 E', currency: 'JPY', capital: '', risk },
        [A],
        null,
        null,
      );
      expect(got.errors.risk, risk).toBe(SETTINGS_MSG.risk);
      expect(got.body).toBeNull();
    }
    const ok = readAccountDraft(
      { name: '口座 E', currency: 'JPY', capital: '', risk: '2.5' },
      [A],
      null,
      null,
    );
    expect(ok.body).toEqual({
      name: '口座 E',
      currency: 'JPY',
      capitalYen: null,
      riskTolerancePct: 2.5,
    });
    expect(ok.warning).toBe(SETTINGS_MSG.riskWarning);
  });
  it('設定済みの資金を空にすると誤り（未設定には戻せない）、名前が空も誤り', () => {
    const got = readAccountDraft(
      { name: '  ', currency: 'JPY', capital: '', risk: '1' },
      [A],
      'accA',
      1_000_000,
    );
    expect(got.errors).toEqual({
      name: ACCOUNT_MSG.nameRequired,
      capital: SETTINGS_MSG.capitalRequired,
    });
  });
  it('欄の名前の順', () => {
    expect(Object.keys(ACCOUNT_FIELD_LABEL)).toEqual(['name', 'currency', 'capital', 'risk']);
  });
});

describe('readNewAccountDraft（記録する画面のその場で足す 2 欄。B5）', () => {
  it('B5: 「口座 C」・300,000 → 名前と資金だけの本文（許容リスクは API の既定 1）', () => {
    const got = readNewAccountDraft({ name: '口座 C', capital: '300,000' }, [ONE, B]);
    expect(got.body).toEqual({ name: '口座 C', capitalYen: 300_000 });
  });
  it('資金は空でも足せる（本文に資金を入れない）', () => {
    expect(readNewAccountDraft({ name: '口座 C', capital: '' }, [ONE]).body).toEqual({
      name: '口座 C',
    });
  });
  it('名前が空・重複・資金の誤り', () => {
    expect(readNewAccountDraft({ name: '', capital: '' }, [ONE]).errors.name).toBe(
      ACCOUNT_MSG.nameRequired,
    );
    expect(readNewAccountDraft({ name: '口座　１', capital: '' }, [ONE]).errors.name).toBe(
      ACCOUNT_MSG.duplicateName,
    );
    expect(readNewAccountDraft({ name: '口座 C', capital: '0' }, [ONE]).errors.capital).toBe(
      SETTINGS_MSG.capitalNotPositive,
    );
  });
  it('性質: どんな文字列でも例外を投げず、本文の資金は有限の正か無し', () => {
    const r = rng(4747);
    const chars = ['1', '0', ',', '.', '-', 'あ', ' ', '１', 'e', '口座'];
    for (let i = 0; i < 300; i++) {
      const s = (n: number) =>
        Array.from({ length: n }, () => chars[Math.floor(r() * chars.length)]).join('');
      const got = readNewAccountDraft({ name: s(4), capital: s(6) }, [ONE]);
      if (got.body?.capitalYen !== undefined && got.body.capitalYen !== null) {
        expect(Number.isFinite(got.body.capitalYen) && got.body.capitalYen > 0).toBe(true);
      }
    }
  });
});

describe('口座の Segment の幅の割り振り（再レビュー 2・N2）', () => {
  it('nameWidth: 全角 2・半角 1', () => {
    expect(nameWidth('口座 1')).toBe(6);
    expect(nameWidth('ABC')).toBe(3);
  });
  it('長い名前がちょうど 1 つ → その位置。似た長さ・短い名前だけ → 等分（null）', () => {
    expect(segmentGrowIndex(['口座 1', '架空の長い名前の口座', '口座 C'])).toBe(1);
    expect(segmentGrowIndex(['口座 1', '口座 B'])).toBeNull();
    expect(segmentGrowIndex(['架空の長い名前の口座', '架空の長い名前の口座 B'])).toBeNull();
    expect(segmentGrowIndex(['口座 1'])).toBeNull();
  });
  it('性質: 選んでいる口座に依らない（引数に選択が無い）・並べ替えても同じ名前を指す', () => {
    const names = ['口座 1', '架空の長い名前の口座', '口座 C'];
    const i = segmentGrowIndex(names);
    const rev = [...names].reverse();
    const j = segmentGrowIndex(rev);
    expect(i === null ? null : names[i]).toBe(j === null ? null : rev[j]);
  });
  it('selectedNote: 長い名前の口座があるときだけ「選択中: 〈名前〉」', () => {
    const accs = [
      { id: 'default', name: '口座 1' },
      { id: 'long', name: '架空の長い名前の口座' },
    ];
    expect(selectedNote(accs, 'long')).toBe('選択中: 架空の長い名前の口座');
    expect(selectedNote(accs, 'default')).toBe('選択中: 口座 1');
    expect(
      selectedNote(
        [
          { id: 'default', name: '口座 1' },
          { id: 'b', name: '口座 B' },
        ],
        'b',
      ),
    ).toBeNull();
  });
});
