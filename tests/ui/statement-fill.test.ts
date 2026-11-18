// 読み取りの応答を下書きに流し込む純関数（Issue #15 の R4〜R8・E1・E4〜E9・E11・E14。ui/src/lib/statement-fill.ts）。
// 値はすべて架空
import { afterEach, describe, expect, it } from 'vitest';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { formatPlain } from '../../ui/src/lib/format';
import {
  applyDraft,
  type Draft,
  type DraftField,
  EMPTY_DRAFT,
  parseNum,
  readDraft,
} from '../../ui/src/lib/record-form';
import {
  confirmJst,
  confirmTimeZone,
  fillFromRow,
  gateReading,
  imageFileFromClipboard,
  isTextTarget,
  MAX_ROWS,
  markEdited,
  needsTzCheck,
  type PasteTarget,
  parseReadResponse,
  READ_FIELDS,
  READ_MSG,
  READING_NOTICE,
  readFailureOf,
  rowLabel,
  TZ_MISSING,
} from '../../ui/src/lib/statement-fill';
import { NO_CAPITAL } from './helpers/record-drafts';
import {
  E1_ENTRY_MS,
  E1_EXIT_MS,
  ROW_E1,
  ROW_E4,
  ROW_E7,
  ROW_E8,
  ROW_E9,
  ROWS_E10,
  statementBody,
} from './helpers/statement-rows';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process;

/** 開いたときの既定（#13 の AC-9）: 前回の銘柄「架空指数B」・数量 1・決済の時刻 = 開いた時刻 */
const OPENED: Draft = applyDraft(EMPTY_DRAFT, {
  type: 'reset',
  values: { instrumentName: '架空指数B', quantity: '1', exitTime: '2026-11-18T14:37' },
});
const NONE = new Set<DraftField>();

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseReadResponse（応答の形を画面の側でも確かめる）', () => {
  it('E1 の応答 → 12 の鍵の行。知らない鍵は写さない', () => {
    const r = parseReadResponse(
      statementBody([{ ...ROW_E1, secret: 'SECRET-本文' }], { extra: 1 }),
    );
    expect(r?.kind).toBe('statement');
    expect(r?.rows).toEqual([ROW_E1]);
    expect(Object.keys(r?.rows[0] ?? {}).sort()).toEqual(
      [
        'symbol',
        'side',
        'entryPrice',
        'exitPrice',
        'quantity',
        'pnlYen',
        'entryTime',
        'exitTime',
        'timeZoneNeedsCheck',
        'fees',
        'feesTotalYen',
        'exitOrderType',
      ].sort(),
    );
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });

  it('notStatement と 0 行も読める（失敗の文言は controller が出す）', () => {
    expect(parseReadResponse({ kind: 'notStatement', rows: [] })).toEqual({
      kind: 'notStatement',
      rows: [],
    });
    expect(parseReadResponse(statementBody([]))?.rows).toEqual([]);
  });

  it('kind 違い・rows が配列でない・21 行・行がオブジェクトでない → null', () => {
    expect(parseReadResponse(null)).toBeNull();
    expect(parseReadResponse('x')).toBeNull();
    expect(parseReadResponse({ kind: 'other', rows: [] })).toBeNull();
    expect(parseReadResponse({ kind: 'statement', rows: {} })).toBeNull();
    expect(parseReadResponse(statementBody(Array(MAX_ROWS + 1).fill(ROW_E1)))).toBeNull();
    expect(parseReadResponse(statementBody(Array(MAX_ROWS).fill(ROW_E1)))?.rows).toHaveLength(20);
    expect(parseReadResponse({ kind: 'statement', rows: [1] })).toBeNull();
  });

  it('型違い・範囲の外の欄は null（銘柄は 40 字まで・制御文字なし。価格・数量は正。注文の種類のほか → unknown）', () => {
    const r = parseReadResponse(
      statementBody([
        {
          ...ROW_E1,
          symbol: `A${'x'.repeat(40)}`,
          side: 'B',
          entryPrice: '100',
          exitPrice: -1,
          quantity: 0,
          pnlYen: 2e12,
          entryTime: { written: '2026/11/10 09:05', timeZone: 'JST', jst: null, epochMs: 1 },
          exitTime: { ...ROW_E1.exitTime, epochMs: 1.5 },
          fees: [1, 'x'],
          feesTotalYen: Number.NaN,
          exitOrderType: 'trailing',
        },
      ]),
    );
    expect(r?.rows[0]).toEqual({
      symbol: null,
      side: null,
      entryPrice: null,
      exitPrice: null,
      quantity: null,
      pnlYen: null,
      entryTime: null,
      exitTime: null,
      timeZoneNeedsCheck: false,
      fees: null,
      feesTotalYen: null,
      exitOrderType: 'unknown',
    });
    expect(
      parseReadResponse(statementBody([{ ...ROW_E1, symbol: '架空\u0007' }]))?.rows[0]?.symbol,
    ).toBeNull();
    expect(
      parseReadResponse(statementBody([{ ...ROW_E1, symbol: ' 架空指数A ' }]))?.rows[0]?.symbol,
    ).toBe('架空指数A');
  });
});

describe('fillFromRow', () => {
  it('E1: 9 欄に応答の値と「読み取り」の印。既定（架空指数B・数量 1・開いた時刻）を置き換える。出どころ = 明細', () => {
    const f = fillFromRow(OPENED, ROW_E1, NONE);
    expect(f.draft).toMatchObject({
      instrumentName: '架空指数A',
      side: 'L',
      entryPrice: '100',
      exitPrice: '99',
      quantity: '2',
      pnlYen: '-2000',
      feeYen: '150',
      exitTime: toLocalInput(E1_EXIT_MS),
      entryTime: toLocalInput(E1_ENTRY_MS),
      source: 'statement',
      exitOrderType: 'unknown',
      stopOrderPlaced: 'unanswered',
      exitReason: 'other',
      lcDecided: null,
    });
    expect(Object.keys(f.marks).sort()).toEqual([...READ_FIELDS].sort());
    for (const k of READ_FIELDS) expect(f.marks[k]).toBe('read');
    // 読み取った時刻は保存の時刻に戻すと応答の epoch（端末の時間帯に依らない）
    const read = readDraft(
      { ...f.draft, lc: '99', lcDecided: true, lcMove: 'none', timeframeChange: 'none' },
      NO_CAPITAL,
    );
    expect(read.body?.exit.time).toBe(E1_EXIT_MS);
    expect(read.body?.entries[0].time).toBe(E1_ENTRY_MS);
    expect(read.body?.fees).toEqual([{ amountYen: 150 }]);
    expect(read.body?.statementPnlYen).toBe(-2000);
  });

  it('LC・一言・3 つのタップ・下げた後の LC・LC の根拠には触れない', () => {
    const typed = applyDraft(OPENED, {
      type: 'fill',
      values: {
        lc: '99',
        brokenCondition: '架空の一言',
        lcDecided: false,
        lcMove: 'widened',
        lcAfter: '98',
        timeframeChange: 'longer',
        lcBasis: 'amount',
      },
    });
    const f = fillFromRow(typed, ROW_E1, NONE);
    for (const k of [
      'lc',
      'brokenCondition',
      'lcDecided',
      'lcMove',
      'lcAfter',
      'timeframeChange',
      'lcBasis',
    ] as const) {
      expect(f.draft[k]).toEqual(typed[k]);
    }
  });

  it('E4: 銘柄・決済の時刻が null → 空で「読み取れませんでした」。足りない欄に銘柄・決済の時刻', () => {
    const f = fillFromRow(OPENED, ROW_E4, NONE);
    expect(f.draft.instrumentName).toBe('');
    expect(f.draft.exitTime).toBe('');
    expect(f.marks.instrumentName).toBe('unread');
    expect(f.marks.exitTime).toBe('unread');
    const read = readDraft(f.draft, NO_CAPITAL);
    expect(read.missing).toContain('銘柄');
    expect(read.missing).toContain('決済の時刻');
    expect(read.canSave).toBe(false);
  });

  it('E6: 貼った後に触った欄（イン）は値も印も変えない。ほかは応答の値', () => {
    const typed = applyDraft(OPENED, { type: 'fill', values: { entryPrice: '101.0', lc: '99.0' } });
    const f = fillFromRow(typed, ROW_E1, new Set<DraftField>(['entryPrice', 'lc']));
    expect(f.draft.entryPrice).toBe('101.0');
    expect(f.marks.entryPrice).toBeUndefined();
    expect(f.draft.lc).toBe('99.0');
    expect(f.draft.exitPrice).toBe('99');
    expect(f.marks.exitPrice).toBe('read');
  });

  it('E7: 逆指値 → 決済の理由 = LC・決めていた（印「明細から」）・逆指値を入れた = 入れた', () => {
    const f = fillFromRow(OPENED, ROW_E7, NONE);
    expect(f.draft).toMatchObject({
      exitReason: 'lc',
      lcDecided: true,
      exitOrderType: 'stop',
      stopOrderPlaced: 'placed',
    });
    expect(f.marks.lcDecided).toBe('statement');
    expect(f.marks.exitReason).toBe('statement');
  });

  it('E7 で、読み取り中に「決めていない」・決済の理由を選んでいたら、そちらが正（C15）', () => {
    const typed = applyDraft(OPENED, {
      type: 'fill',
      values: { lcDecided: false, exitReason: 'fearEarly' },
    });
    const f = fillFromRow(typed, ROW_E7, new Set<DraftField>(['lcDecided', 'exitReason']));
    expect(f.draft.lcDecided).toBe(false);
    expect(f.draft.exitReason).toBe('fearEarly');
    expect(f.marks.lcDecided).toBeUndefined();
    // 証拠（注文の種類・逆指値を入れたか）は明細のまま
    expect(f.draft.exitOrderType).toBe('stop');
    expect(f.draft.stopOrderPlaced).toBe('placed');
  });

  it('E8: 成行 → 決めていたかは既定なし・決済の理由 = その他・逆指値を入れたか = 未回答', () => {
    const f = fillFromRow(OPENED, ROW_E8, NONE);
    expect(f.draft).toMatchObject({
      lcDecided: null,
      exitReason: 'other',
      exitOrderType: 'market',
      stopOrderPlaced: 'unanswered',
    });
    expect(f.marks.lcDecided).toBeUndefined();
  });

  it('E9: 時間帯の無い時刻は書かれた値と「時間帯が明細にありません」。建てた時刻が無ければ空', () => {
    const f = fillFromRow(OPENED, ROW_E9, NONE);
    expect(f.draft.exitTime).toBe('2026-11-10T10:30');
    expect(f.marks.exitTime).toBe('tz');
    expect(f.draft.entryTime).toBe('');
    expect(needsTzCheck(f.marks)).toBe(true);
  });
});

describe('印の直し（E5）', () => {
  it('「読み取り」「読み取れませんでした」「時間帯が…」→「直した」、「明細から」→ 外す、印の無い欄はそのまま', () => {
    const m = fillFromRow(OPENED, ROW_E7, NONE).marks;
    expect(markEdited(m, 'exitPrice').exitPrice).toBe('edited');
    expect(markEdited(m, 'lcDecided').lcDecided).toBeUndefined();
    expect(markEdited(m, 'lc')).toBe(m);
    const e = markEdited(m, 'exitPrice');
    expect(markEdited(e, 'exitPrice')).toBe(e);
    expect(markEdited({ exitTime: 'tz' }, 'exitTime')).toEqual({ exitTime: 'edited' });
    expect(markEdited({ instrumentName: 'unread' }, 'instrumentName')).toEqual({
      instrumentName: 'edited',
    });
  });
});

describe('時間帯の確かめ（E9・AC-8）', () => {
  const original = proc.env.TZ;
  afterEach(() => {
    if (original === undefined) delete proc.env.TZ;
    else proc.env.TZ = original;
  });

  it('confirmJst: 書かれた時刻を日本時間として epoch に。暦にない日時は undefined', () => {
    expect(confirmJst('2026-11-10T10:30')).toBe(Date.UTC(2026, 10, 10, 1, 30));
    expect(confirmJst('2026-01-01T05:00')).toBe(Date.UTC(2025, 11, 31, 20, 0));
    expect(confirmJst('2026-02-30T10:00')).toBeUndefined();
    expect(confirmJst('2026-11-10T25:00')).toBeUndefined();
    expect(confirmJst('1970-01-01T08:59')).toBeUndefined();
    expect(confirmJst('2026/11/10 10:30')).toBeUndefined();
  });

  it.each(['Asia/Tokyo', 'UTC', 'America/New_York', 'Europe/London'])(
    '端末の時間帯 %s でも、[日本時間で合っている] の後に保存される時刻は日本時間の 10:30',
    (tz) => {
      proc.env.TZ = tz;
      const f = fillFromRow(OPENED, ROW_E9, NONE);
      const c = confirmTimeZone(f.draft, f.marks, ROW_E9);
      expect(c.marks.exitTime).toBe('read');
      expect(needsTzCheck(c.marks)).toBe(false);
      const read = readDraft(
        { ...c.draft, lc: '99', lcDecided: true, lcMove: 'none', timeframeChange: 'none' },
        NO_CAPITAL,
      );
      expect(read.body?.exit.time).toBe(Date.UTC(2026, 10, 10, 1, 30));
    },
  );

  it('性質: 端末の時間帯によらず confirmJst は同じ epoch（種つき乱数 300 件 × 3 つの時間帯）', () => {
    const r = rng(9);
    const p = (n: number) => String(n).padStart(2, '0');
    for (let i = 0; i < 300; i++) {
      const y = 1971 + Math.floor(r() * 120);
      const mo = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 28);
      const h = Math.floor(r() * 24);
      const mi = Math.floor(r() * 60);
      const w = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
      const got = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'].map((tz) => {
        proc.env.TZ = tz;
        return confirmJst(w);
      });
      const want = Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600_000;
      expect(got).toEqual(
        want < 4_102_444_800_000 ? [want, want, want] : [undefined, undefined, undefined],
      );
    }
  });

  it('利用者が直した時刻（印「直した」）は確かめのボタンで書き換えない', () => {
    const f = fillFromRow(OPENED, ROW_E9, NONE);
    const c = confirmTimeZone(
      { ...f.draft, exitTime: '2026-11-10T11:00' },
      markEdited(f.marks, 'exitTime'),
      ROW_E9,
    );
    expect(c.draft.exitTime).toBe('2026-11-10T11:00');
    expect(c.marks.exitTime).toBe('edited');
  });
});

describe('保存の門 gateReading（R3・R6）', () => {
  const full = (d: Draft) =>
    readDraft(
      { ...d, lc: '99', lcDecided: true, lcMove: 'none', timeframeChange: 'none' },
      NO_CAPITAL,
    );

  it('読み取り中は保存できず、理由「明細を読み取っています」', () => {
    const r = full(fillFromRow(OPENED, ROW_E1, NONE).draft);
    expect(r.canSave).toBe(true);
    const g = gateReading(r, { reading: true, marks: {} });
    expect(g.canSave).toBe(false);
    expect(g.notice).toBe(READING_NOTICE);
  });

  it('時間帯を確かめていなければ足りない欄に「決済の時刻（時間帯の確かめ）」', () => {
    const f = fillFromRow(OPENED, ROW_E9, NONE);
    const g = gateReading(full(f.draft), { reading: false, marks: f.marks });
    expect(g.canSave).toBe(false);
    expect(g.missing).toEqual([TZ_MISSING.exitTime]);
    expect(g.notice).toBeUndefined();
  });

  it('どちらでもなければ入力と同じもの', () => {
    const r = full(fillFromRow(OPENED, ROW_E1, NONE).draft);
    expect(gateReading(r, { reading: false, marks: { exitPrice: 'read' } })).toBe(r);
  });
});

describe('数の写し（formatPlain の往復）', () => {
  it('性質: 欄に入れた文字を読むと応答の数と同じ（種つき乱数 2,000 件。小さな数・大きな数を含む）', () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) {
      const exp = Math.floor(r() * 18) - 8;
      const x = Number((r() * 10 ** exp).toPrecision(1 + Math.floor(r() * 12)));
      if (!(x > 0)) continue;
      const p = parseNum(formatPlain(x));
      expect(p.ok && p.value).toBe(x);
      const n = parseNum(formatPlain(-x));
      expect(n.ok && n.value).toBe(-x);
    }
  });
});

describe('失敗の文言（E11・E12）', () => {
  it('状態 → 種類: 400 = 断られた・503 = 使えない・401 = ログイン・ほか = 読み取れなかった', () => {
    expect(readFailureOf(400)).toBe('rejected');
    expect(readFailureOf(503)).toBe('unavailable');
    expect(readFailureOf(401)).toBe('auth');
    expect(readFailureOf(429)).toBe('limited');
    for (const s of [500, 502, 504, 404, 413, 403]) expect(readFailureOf(s)).toBe('failed');
  });

  it('決まった文言（Issue の例の表）', () => {
    expect(READ_MSG).toEqual({
      notStatement: '決済明細として読めませんでした。別の画像を貼るか、手で入れてください。',
      rejected: 'この画像は読み取れません。別の画像を貼るか、手で入れてください。',
      unavailable: '今は読み取りを使えません。手で入れてください。',
      failed: '読み取れませんでした。もう一度貼るか、手で入れてください。',
      limited: '今日の読み取りの上限に達しました。手で入れてください。',
      notImage: '画像を読み込めませんでした。PNG か JPEG のスクショを貼ってください。',
    });
  });
});

describe('行の番号', () => {
  it('「i / N 行目」', () => {
    expect(rowLabel(0, ROWS_E10.length)).toBe('1 / 3 行目');
    expect(rowLabel(2, 3)).toBe('3 / 3 行目');
  });
});

describe('クリップボード（AC-1・E14）', () => {
  const item = (kind: string, type: string, file: string | null) => ({
    kind,
    type,
    getAsFile: () => file,
  });

  it('画像のファイルがあればそれ（最初の 1 枚）', () => {
    expect(
      imageFileFromClipboard([
        item('string', 'text/plain', null),
        item('file', 'image/png', 'png'),
        item('file', 'image/jpeg', 'jpeg'),
      ]),
    ).toBe('png');
  });

  it('文字だけ・画像でないファイル・空 → null（横取りしない）', () => {
    expect(imageFileFromClipboard([item('string', 'text/plain', null)])).toBeNull();
    expect(imageFileFromClipboard([item('file', 'application/pdf', 'pdf')])).toBeNull();
    expect(imageFileFromClipboard([item('file', 'image/png', null)])).toBeNull();
    expect(imageFileFromClipboard([])).toBeNull();
    expect(imageFileFromClipboard(null)).toBeNull();
    expect(imageFileFromClipboard(undefined)).toBeNull();
  });
});

describe('文字の欄への貼り付けは横取りしない（レビュー指摘 1・R1）', () => {
  const item = (kind: string, type: string, file: string | null) => ({
    kind,
    type,
    getAsFile: () => file,
  });
  /** 表計算から値をコピーしたときのように、文字と画像の両方を持つクリップボード */
  const both = [item('string', 'text/plain', null), item('file', 'image/png', 'png')];
  const imageOnly = [item('file', 'image/png', 'png')];

  it.each<[PasteTarget, string]>([
    [{ tagName: 'INPUT', type: 'text' }, '文字の input'],
    [{ tagName: 'input' }, 'type の無い input'],
    [{ tagName: 'INPUT', type: 'datetime-local' }, '日時の input'],
    [{ tagName: 'TEXTAREA' }, 'textarea'],
    [{ tagName: 'DIV', isContentEditable: true }, 'contenteditable'],
  ])(
    '%o（%s）: 文字と画像なら null（普通の貼り付け）、画像だけなら明細として受ける',
    (target, _name) => {
      expect(isTextTarget(target)).toBe(true);
      expect(imageFileFromClipboard(both, target)).toBeNull();
      expect(imageFileFromClipboard(imageOnly, target)).toBe('png');
      expect(
        imageFileFromClipboard([item('string', 'text/html', null), ...imageOnly], target),
      ).toBeNull();
    },
  );

  it.each([
    [{ tagName: 'BODY' }],
    [{ tagName: 'SECTION' }],
    [{ tagName: 'INPUT', type: 'file' }],
    [{ tagName: 'INPUT', type: 'radio' }],
    [{ tagName: 'BUTTON' }],
    [null],
  ])('%o: 文字の欄でなければ画像を受ける', (target) => {
    expect(isTextTarget(target)).toBe(false);
    expect(imageFileFromClipboard(both, target)).toBe('png');
  });
});
