// データの書き出しの CSV（Issue #167 の AC-5・例 E4〜E8）と応答の検査・ファイルの名前。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade, TradeSnapshot } from '../../core/record';
import {
  BOM,
  CSV_COLUMNS,
  csvDateTime,
  exportCsv,
  numCell,
  textCell,
} from '../../ui/src/lib/export-csv';
import {
  EXPORT_FORMAT,
  type ExportData,
  exportFileName,
  parseExport,
} from '../../ui/src/lib/export-data';
import { tradeRow } from '../../ui/src/lib/trade-view';
import { account, defaultAccount } from './helpers/accounts';
import { INSTRUMENTS as GROUP_INSTRUMENTS, h1 } from './helpers/group-examples';
import { stored, T_1110, T_1111, T_1112, US30 } from './helpers/trade-examples';

const NK: InstrumentRecord = {
  ...US30,
  id: 'nk',
  name: '日経225',
  priceCurrency: 'JPY',
  multiplier: 1000,
};
const EURUSD: InstrumentRecord = {
  ...US30,
  id: 'eu',
  name: 'EURUSD',
  priceCurrency: 'USD',
  multiplier: 1,
};

const SNAP_NK: TradeSnapshot = {
  instrument: {
    multiplier: 1000,
    quantityStep: 1,
    priceCurrency: 'JPY',
    underlyingKind: 'index',
    productForm: 'future',
  },
  capitalYen: 1_000_000,
  riskTolerancePct: 1,
};
const SNAP_USD: TradeSnapshot = {
  instrument: {
    multiplier: 1,
    quantityStep: 1,
    priceCurrency: 'USD',
    underlyingKind: 'fx',
    productForm: 'spotCfd',
  },
  capitalYen: 10_000,
  riskTolerancePct: 1,
  accountCurrency: 'USD',
};

/** E4: L・イン 100・LC 99・決済 102・数量 1・乗数 1,000・円の口座・資金 1,000,000・許容 1%。
 * 損益 = (102 − 100) × 1 × 1,000 = 2,000 円、1R = (100 − 99) × 1 × 1,000 = 1,000 円 → R = 2、リスク = 1,000 / 1,000,000 = 0.1% */
const E4 = stored(
  'e4',
  {
    instrumentId: NK.id,
    side: 'L',
    lc: 99,
    entries: [{ price: 100, quantity: 1, time: T_1110 - 3_600_000 }],
    exit: { time: T_1110, price: 102, orderType: 'limit', reason: 'tp', gapSlip: 'no' },
    timeframe: '1h',
  },
  { snapshot: SNAP_NK, emotionTags: ['calm'] },
);
/** E5: S・イン 100・LC 101・決済 98・数量 2・USD の口座（資金 10,000 USD）。
 * 損益 = (100 − 98) × 2 = 4 USD、1R = (101 − 100) × 2 = 2 USD → R = 2、リスク = 2 / 10,000 = 0.02% */
const E5 = stored(
  'e5',
  {
    instrumentId: EURUSD.id,
    accountId: 'usd',
    side: 'S',
    lc: 101,
    entries: [{ price: 100, quantity: 2 }],
    exit: { time: T_1111, price: 98, orderType: 'limit', reason: 'tp', gapSlip: 'no' },
  },
  { snapshot: SNAP_USD },
);
/** E6: LC なし（L・イン 100・決済 99.5・数量 1・乗数 1,000 → 損益 −500 円） */
const E6 = stored(
  'e6',
  {
    instrumentId: NK.id,
    lc: undefined,
    lcDecidedBeforeEntry: false,
    entries: [{ price: 100, quantity: 1 }],
    exit: { time: T_1112, price: 99.5, orderType: 'market', reason: 'other', gapSlip: 'no' },
  },
  { snapshot: SNAP_NK },
);
/** E7: 総評が式に見える文字・崩れの条件にカンマと改行・買い増し（エントリー 2 つ） */
const E7 = stored(
  'e7',
  {
    instrumentId: NK.id,
    brokenCondition: '99 を割る,\n戻りも弱い',
    entries: [
      { price: 100, quantity: 1 },
      { price: 100.5, quantity: 1 },
    ],
    exit: {
      time: T_1110 - 86_400_000,
      price: 99,
      orderType: 'stop',
      reason: 'lc',
      gapSlip: 'no',
      review: '=HYPERLINK("x")',
    },
  },
  { snapshot: SNAP_NK },
);

const ACCOUNTS = [
  defaultAccount(1_000_000),
  account('usd', '米ドル口座', 10_000, 1, { currency: 'USD' }),
];

const data = (trades: readonly StoredTrade[]): ExportData => ({
  format: EXPORT_FORMAT,
  version: 1,
  exportedAt: T_1112,
  settings: { capitalYen: 1_000_000 },
  emotionTagSettings: { hidden: [] },
  accounts: ACCOUNTS,
  instruments: [NK, EURUSD],
  trades,
});

/** RFC 4180 の CSV を行と欄に分ける（テストの道具） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name);

function rowOf(t: StoredTrade): Record<string, string> {
  const csv = exportCsv(data([t]));
  const [head, line] = parseCsv(csv.slice(BOM.length));
  expect(head).toEqual([...CSV_COLUMNS]);
  return Object.fromEntries((head ?? []).map((h, i) => [h, line?.[i] ?? '']));
}

describe('exportCsv（AC-5）', () => {
  it('E4: L・利益・円の口座。L / S が L・損益 2000・R 2・リスク 0.1・判定は一覧と同じ札の名前', () => {
    const r = rowOf(E4);
    expect(r['L / S']).toBe('L');
    expect(r.損益).toBe('2000');
    expect(r.R).toBe('2');
    expect(r['リスク（%）']).toBe('0.1');
    expect(r.判定).toBe(tradeRow(E4, [NK], ACCOUNTS).badge.label);
    expect(r.通貨).toBe('JPY');
    expect(r.銘柄).toBe('日経225');
    expect(r.口座).toBe('口座 1');
    expect([r.数量, r.イン, r.LC, r.TP, r.決済]).toEqual(['1', '100', '99', '', '102']);
    expect(r.時間足).toBe('1 時間足');
    expect(r.心理).toBe('平常心');
    expect(r.ID).toBe('e4');
    expect(r.決済の時刻).toBe(csvDateTime(T_1110));
    expect(r.エントリーの時刻).toBe(csvDateTime(T_1110 - 3_600_000));
  });

  it('E5: S・USD の口座。損益は口座の通貨の値 4・R 2・リスク 0.02・通貨 USD・口座の名前', () => {
    const r = rowOf(E5);
    expect([r['L / S'], r.損益, r.R, r['リスク（%）'], r.通貨, r.口座]).toEqual([
      'S',
      '4',
      '2',
      '0.02',
      'USD',
      '米ドル口座',
    ]);
  });

  it('E6: LC なしは LC・R・リスクの欄が空（「—」を書かない）。損益は出る', () => {
    const r = rowOf(E6);
    expect([r.LC, r.R, r['リスク（%）']]).toEqual(['', '', '']);
    expect(r.損益).toBe('-500');
    expect(exportCsv(data([E6]))).not.toContain('—');
  });

  it("E7: 式に見える総評は先頭に ' を足して引用符で囲む。カンマ・改行は引用符で囲んで保つ。買い増しのインは「 / 」", () => {
    const csv = exportCsv(data([E7]));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"99 を割る,\n戻りも弱い"');
    const r = rowOf(E7);
    expect(r.総評).toBe(`'=HYPERLINK("x")`);
    expect(r.根拠が崩れる条件).toBe('99 を割る,\n戻りも弱い');
    expect(r.イン).toBe('100 / 100.5');
    expect(r.数量).toBe('2');
  });

  it('知らない心理のタグ（後の版で足した ID）は外し、知っているタグだけを出す', () => {
    const t = { ...E4, emotionTags: ['calm', 'futureTag'] } as unknown as StoredTrade;
    expect(rowOf(t).心理).toBe('平常心');
  });

  it('小数の数量の合計に計算の誤差を出さない（0.1 + 0.2 = 0.3）', () => {
    const t = stored(
      'q',
      {
        instrumentId: NK.id,
        entries: [
          { price: 100, quantity: 0.1 },
          { price: 101, quantity: 0.2 },
        ],
      },
      { snapshot: SNAP_NK },
    );
    expect(rowOf(t).数量).toBe('0.3');
  });

  it('Good / More（#123）は話題の名前と一言を「 / 」でつなぐ。無ければ空', () => {
    const t = {
      ...E4,
      reflection: {
        good: { topics: ['cutEarly'], notes: ['早めに切れた'] },
        more: { topics: [], notes: [] },
      },
    } as unknown as StoredTrade;
    const r = rowOf(t);
    expect(r.Good).toMatch(/ \/ 早めに切れた$/);
    expect(r.Good?.length ?? 0).toBeGreaterThan(' / 早めに切れた'.length);
    expect(r.More).toBe('');
    expect(rowOf(E4).Good).toBe('');
  });

  it('E8: 取引 0 件は見出しの行だけ（BOM つき・CRLF）', () => {
    expect(exportCsv(data([]))).toBe(`${BOM}${CSV_COLUMNS.join(',')}\r\n`);
  });

  it('並びは取引の一覧と同じ（決済の新しい順）。行の数 = 取引の数 + 見出し', () => {
    const rows = parseCsv(exportCsv(data([E7, E4, E6, E5])).slice(BOM.length));
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).map((r) => r[col('ID')])).toEqual(['e6', 'e5', 'e4', 'e7']);
  });

  it("文字の欄の無害化: = + - @ タブ・CR で始まる文字に ' を足す。途中の記号は足さない", () => {
    for (const s of ['=1+1', '+81', '-5', '@SUM(A1)', '\tx', '\rx'])
      expect(textCell(s).replace(/^"/, '')).toMatch(/^'/);
    expect(textCell('a=b')).toBe('a=b');
    expect(textCell('')).toBe('');
    expect(textCell(undefined)).toBe('');
  });

  it('数の欄: 丸め・−0 は 0・有限でない値は空', () => {
    expect(numCell(1.23456, 2)).toBe('1.23');
    expect(numCell(-0)).toBe('0');
    expect(numCell(-0.001, 2)).toBe('0');
    expect(numCell(Number.NaN)).toBe('');
    expect(numCell(undefined)).toBe('');
    expect(numCell(-500)).toBe('-500');
  });

  it('日時は端末の時間帯の YYYY-MM-DD HH:mm', () => {
    expect(csvDateTime(new Date(2026, 10, 24, 9, 5).getTime())).toBe('2026-11-24 09:05');
    expect(csvDateTime(undefined)).toBe('');
  });
});

describe('両建てのまとまり（#267 の R12・4.8・C75）', () => {
  const rowsOf = (d: ExportData) => {
    const [head, ...lines] = parseCsv(exportCsv(d).slice(BOM.length));
    return lines.map((l) => Object.fromEntries((head ?? []).map((h, i) => [h, l[i] ?? ''])));
  };

  it('最初の本玉の行に「本玉」・まとまりの ID・まとまりの判定と R、決済の代わりの行は判定・R・リスクが空（損益は各行の値）', () => {
    const { f, c, g } = h1();
    const rows = rowsOf({
      ...data([f, c]),
      instruments: [...GROUP_INSTRUMENTS],
      positionGroups: [g],
    });
    const byIdRow = Object.fromEntries(rows.map((r) => [r.ID, r]));
    expect(byIdRow.f1).toMatchObject({
      両建て: '本玉',
      まとまり: g.id,
      判定: '計画どおりの勝ち',
      R: '1.5',
    });
    expect(byIdRow.c1).toMatchObject({
      両建て: '決済の代わり',
      まとまり: g.id,
      判定: '',
      R: '',
      'リスク（%）': '',
    });
    // 損益は取引ごと（+600,000 円と −170,000 円）。足すとまとまりの損益
    expect([byIdRow.f1?.損益, byIdRow.c1?.損益]).toEqual(['600000', '-170000']);
  });

  it('まとまりの無い取引の 2 列は空。逆参照の指す先が無い（崩れた）取引は単独の値', () => {
    expect(rowOf(E4)).toMatchObject({ 両建て: '', まとまり: '' });
    const { f } = h1();
    const rows = rowsOf({ ...data([f]), instruments: [...GROUP_INSTRUMENTS] });
    expect(rows[0]).toMatchObject({
      両建て: '',
      まとまり: '',
      判定: tradeRow(f, GROUP_INSTRUMENTS).badge.label,
    });
  });

  it('前の版の書き出し（positionGroups の鍵が無い）も受け、まとまりの形が崩れていれば受けない', () => {
    expect(parseExport(JSON.parse(JSON.stringify(data([E4]))))).not.toBeNull();
    expect(parseExport({ ...data([E4]), positionGroups: [{ id: 1 }] })).toBeNull();
  });
});

describe('parseExport・exportFileName', () => {
  const ok = { ...data([E4]) };

  it('形の合う本文を受ける', () => {
    expect(parseExport(JSON.parse(JSON.stringify(ok)))?.trades).toHaveLength(1);
  });

  it.each([
    ['形式の名前が違う', { ...ok, format: 'other' }],
    ['知らない版', { ...ok, version: 2 }],
    ['書き出した時刻が数でない', { ...ok, exportedAt: 'x' }],
    ['取引が配列でない', { ...ok, trades: {} }],
    ['取引の形が違う', { ...ok, trades: [{ id: 'x' }] }],
    ['銘柄の形が違う', { ...ok, instruments: [{ id: 1 }] }],
    ['設定が無い', { ...ok, settings: null }],
    ['選択肢の設定が無い', { ...ok, emotionTagSettings: undefined }],
    ['選択肢の設定の形が違う', { ...ok, emotionTagSettings: { hidden: [1] } }],
    ['配列', []],
    ['null', null],
  ])('%s → null', (_name, body) => {
    expect(parseExport(body)).toBeNull();
  });

  it('ファイルの名前は端末の時間帯の日付', () => {
    const at = new Date(2026, 10, 24, 23, 59).getTime();
    expect(exportFileName('json', at)).toBe('loss-note-20261124.json');
    expect(exportFileName('csv', at)).toBe('loss-note-20261124.csv');
  });
});
