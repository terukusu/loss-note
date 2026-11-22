// 記録する画面の 1 画面の形の純関数（#130。lib/record-screen.ts）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { EMPTY_LEG } from '../../ui/src/lib/legs-form';
import { EMPTY_DRAFT, readDraft } from '../../ui/src/lib/record-form';
import {
  chartRow,
  chartSlotLine,
  focusLcAfterRead,
  NAMED_LEAD,
  namedLabel,
  READ_CANCELLED,
  REVERTED_TAIL,
  readFinished,
  revertedMessage,
  showProceed,
  stage1Statement,
  stageOf,
  statementArea,
  statementRow,
  statementStatus,
  TZ_PENDING,
  timeText,
  timeZoneNeed,
  tradeSummary,
  verdictLine,
} from '../../ui/src/lib/record-screen';
import { gateReading } from '../../ui/src/lib/statement-fill';
import { CAPITAL_1M, draft, E1, E3, E10 } from './helpers/record-drafts';

describe('明細の場所の 3 つの状態（AC-2・AC-3）', () => {
  it('明細が無い → 選ぶ前、読み取り中（preparing / reading）→ 読み取り中、読めた → 読み取りの後', () => {
    expect(statementArea({})).toBe('pick');
    expect(statementArea({ statement: { phase: 'preparing' } })).toBe('reading');
    expect(statementArea({ statement: { phase: 'reading' } })).toBe('reading');
    expect(statementArea({ statement: { phase: 'ready' } })).toBe('summary');
  });
  it('失敗・最後の行を飛ばして終わった → 選ぶ前。［明細なしで手入力］ の後は読み取りの後（要約）', () => {
    expect(statementArea({ statement: { phase: 'failed' } })).toBe('pick');
    expect(statementArea({ statement: { phase: 'done' } })).toBe('pick');
    expect(statementArea({ manual: true })).toBe('summary');
    expect(statementArea({ statement: { phase: 'failed' }, manual: true })).toBe('summary');
    // 読み取り中は手入力の後でも読み取り中（骨組みとキャンセル）
    expect(statementArea({ statement: { phase: 'reading' }, manual: true })).toBe('reading');
  });
});

describe('要約の 3 行と名指し（AC-4・#164）', () => {
  it('例 3: 全部ある → 「US30」「L · 数量 10,000 · イン 100 → 決済 99.2」「3/4 10:00 決済」、名指し 0', () => {
    const s = tradeSummary(E1, readDraft(E1, CAPITAL_1M).errors, {});
    expect(s.name).toBe('US30');
    expect(s.line2).toBe('L · 数量 10,000 · イン 100 → 決済 99.2');
    // 区切りは塊の末尾（折り返した行の頭に「·」「→」が来ない。#164 のレビュー）
    expect(s.line2Parts).toEqual(['L ·', '数量 10,000 ·', 'イン 100 →', '決済 99.2']);
    expect(s.line3).toBe('3/4 10:00 決済');
    expect(s.pnl).toBeUndefined();
    expect(s.spoken).toBe('L、数量 10,000、イン 100、決済 99.2、3/4 10:00 決済');
    expect(s.named).toEqual([]);
    expect(s.read).toBe(false);
  });
  it('例 4: 決済が読めなかった → 「読み取れませんでした: 決済」を名指し、2 行目の決済は「—」', () => {
    const d = draft({ side: 'L', entryPrice: '100', exitPrice: '' });
    const s = tradeSummary(d, readDraft(d, CAPITAL_1M).errors, {
      instrumentName: 'read',
      exitPrice: 'unread',
    });
    expect(s.line2).toBe('L · 数量 10,000 · イン 100 → 決済 —');
    expect(s.line3).toBe('3/4 10:00 決済');
    expect(s.spoken).toBe('L、数量 10,000、イン 100、決済 未入力、3/4 10:00 決済');
    expect(s.named).toEqual([{ field: 'exitPrice', label: '決済', kind: 'unread' }]);
    expect(s.read).toBe(true);
    expect(namedLabel(s.named[0] as never)).toBe('読み取れませんでした: 決済（取引の欄を開く）');
  });
  it('空の下書き → 6 欄を画面の順に「未入力」で名指し', () => {
    const s = tradeSummary(EMPTY_DRAFT, {}, {});
    expect(s.name).toBe('—');
    expect(s.line2).toBe('— · 数量 — · イン — → 決済 —');
    expect(s.line3).toBe('— 決済');
    expect(s.spoken).toBe('未入力、数量 未入力、イン 未入力、決済 未入力、決済の時刻 未入力');
    expect(s.named.map((n) => n.label)).toEqual([
      '銘柄',
      'L / S',
      '数量',
      'イン',
      '決済',
      '決済の時刻',
    ]);
    expect(new Set(s.named.map((n) => n.kind))).toEqual(new Set(['missing']));
  });
  it('誤りのある欄は「誤り」で名指し、要約の値は「—」（誤りの値をそのまま出さない。デザインレビュー a5）', () => {
    const d = draft({ side: 'S', entryPrice: '100', exitPrice: 'x' });
    const r = readDraft(d, CAPITAL_1M);
    const s = tradeSummary(d, r.errors, {});
    expect(s.line2).toBe('S · 数量 10,000 · イン 100 → 決済 —');
    expect(s.named).toEqual([{ field: 'exitPrice', label: '決済', kind: 'error' }]);
    expect(NAMED_LEAD.error).toBe('誤り');
  });
  it('#164: 長い名前は切らずにそのまま 1 行目に。L / S と数量は 2 行目の先頭', () => {
    const d = draft({
      instrumentName: '架空ミニ指数先物 26/12 長い名前の銘柄',
      side: 'L',
      quantity: '1',
    });
    const s = tradeSummary(d, {}, {});
    expect(s.name).toBe('架空ミニ指数先物 26/12 長い名前の銘柄');
    expect(s.line2Parts[0]).toBe('L ·');
    expect(s.line2Parts[1]).toBe('数量 1 ·');
  });
  it('#164: 明細の損益が読めていれば 3 行目に口座の通貨の書き方で添える（無い・誤りなら出さない）', () => {
    const d = draft({ side: 'L', entryPrice: '100', exitPrice: '99.2', pnlYen: '-8000' });
    const s = tradeSummary(d, {}, {});
    expect(s.line3).toBe('3/4 10:00 決済 · 明細の損益 −8,000円');
    expect(s.line3Parts).toEqual(['3/4 10:00 決済 ·', '明細の損益 −8,000円']);
    expect(s.pnl).toBe('−8,000円');
    expect(s.spoken).toBe(
      'L、数量 10,000、イン 100、決済 99.2、3/4 10:00 決済、明細の損益 −8,000円',
    );
    expect(tradeSummary(d, {}, {}, undefined, 'USD').line3).toBe(
      '3/4 10:00 決済 · 明細の損益 −8,000.00 USD',
    );
    expect(tradeSummary(d, { pnlYen: '数値を入力してください' }, {}).line3).toBe('3/4 10:00 決済');
    expect(tradeSummary(draft({ pnlYen: '' }), {}, {}).line3).toBe('3/4 10:00 決済');
  });
  it('#164: オプションの形はレッグの本数と原資産のイン / 決済。レッグを直した（legsEdited）ときは明細の損益を出さない', () => {
    const d = draft({
      side: null,
      entryPrice: '30000',
      exitPrice: '29500.5',
      pnlYen: '+98000',
      legs: [EMPTY_LEG, EMPTY_LEG],
    });
    const option = {
      legErrors: [],
      autoSide: 'S' as const,
      askSide: false,
      maxLossSelectable: false,
      lossPlanUp: false,
      legsEdited: false,
    };
    const s = tradeSummary(d, {}, {}, option);
    expect(s.line2).toBe('S · レッグ 2 · 原資産 イン 30,000 → 決済 29,500.5');
    expect(s.line3).toBe('3/4 10:00 決済 · 明細の損益 +98,000円');
    expect(s.spoken).toBe(
      'S、レッグ 2、原資産 イン 30,000、決済 29,500.5、3/4 10:00 決済、明細の損益 +98,000円',
    );
    const edited = tradeSummary(d, {}, {}, { ...option, legsEdited: true });
    expect(edited.line3).toBe('3/4 10:00 決済');
    expect(edited.pnl).toBeUndefined();
  });
  it('時刻: 端末の時刻の欄は「M/D HH:mm」、タイムゾーンの無い書かれた時刻はそのまま、空は「—」', () => {
    expect(timeText('2026-11-19T14:05')).toBe('11/19 14:05');
    expect(timeText('2026/11/19 05:05')).toBe('2026/11/19 05:05');
    expect(timeText(' ')).toBe('—');
  });
});

describe('#130 のレビュー: 要約の外の欄の誤り（N4）・選ぶ前に戻らない（B1）・中立の文（N5）', () => {
  it('N4: エントリーの時刻・為替の誤りも「誤り」で名指す（押すとその欄へ）', () => {
    const d = draft({
      side: 'L',
      entryPrice: '100',
      exitPrice: '99',
      entryTime: '2026-03-04T11:00',
    });
    const r = readDraft(d, CAPITAL_1M);
    const s = tradeSummary(d, r.errors, {});
    expect(s.named).toEqual([{ field: 'entryTime', label: 'エントリーの時刻', kind: 'error' }]);
    const fx = tradeSummary(draft({}), { fxRate: '0 より大きい数値を入力してください' }, {});
    expect(fx.named.at(-1)).toEqual({ field: 'fxRate', label: '為替', kind: 'error' });
  });
  it('B1: 読み取りが失敗・終わった・無くても、L / S・イン・決済のどれかに値があれば要約（既定の銘柄・数量・時刻だけなら選ぶ前）', () => {
    const filled = draft({ side: 'L', entryPrice: '100', exitPrice: '99' });
    expect(statementArea({ statement: { phase: 'failed' }, draft: filled })).toBe('summary');
    expect(statementArea({ draft: filled })).toBe('summary');
    expect(statementArea({ statement: { phase: 'done' }, draft: draft({ exitPrice: '99' }) })).toBe(
      'summary',
    );
    expect(statementArea({ draft: draft({ side: 'S' }) })).toBe('summary');
    expect(statementArea({ draft: draft({}) })).toBe('pick');
    expect(statementArea({ statement: { phase: 'reading' }, draft: filled })).toBe('reading');
  });
  it('N5: 欄がそろって判定が出ないときは「あと 0 欄」ではなく中立の文', () => {
    const r = readDraft(E1, CAPITAL_1M);
    const { judgment: _j, ...preview } = r.preview;
    const none = { ...r, preview };
    expect(verdictLine(none, [], false)).toEqual({ kind: 'status', text: '判定を見る' });
  });
});

describe('タイムゾーン（AC-5）', () => {
  const tz = { fields: ['exitTime'] as const, choice: null, remembered: false, gap: null };
  it('例 5: 印 tz の欄があれば未選択（choose）、選んで read になれば chosen、欄を直せば出さない', () => {
    expect(timeZoneNeed(tz, { exitTime: 'tz' })).toBe('choose');
    expect(timeZoneNeed({ ...tz, choice: 'GMT' }, { exitTime: 'read' })).toBe('chosen');
    expect(timeZoneNeed(tz, { exitTime: 'edited' })).toBeNull();
    expect(timeZoneNeed(undefined, { exitTime: 'tz' })).toBeNull();
  });
  it('未選択の間、判定の 1 行は「タイムゾーンが未選択」（保存の門で判定が出ていても）', () => {
    const r = gateReading(readDraft(E3, CAPITAL_1M), { reading: false, marks: { exitTime: 'tz' } });
    expect(r.canSave).toBe(false);
    expect(verdictLine(r, [], true)).toEqual({ kind: 'status', text: TZ_PENDING.line });
  });
});

describe('判定の 1 行（AC-9）', () => {
  it('そろえば判定のバッジの段・R・リスク', () => {
    const r = readDraft(E1, CAPITAL_1M);
    const v = verdictLine(r, [], false);
    expect(v.kind).toBe('judged');
    if (v.kind === 'judged') {
      expect(v.grade).toBe(r.preview.judgment?.grade);
      expect(v.r).toBe(r.preview.r);
      expect(v.riskPct).toBe(r.preview.riskPct);
    }
  });
  it('足りない欄は「あと n 欄」、読み取り中は「明細を読み取っています」が先', () => {
    const r = readDraft(E10, CAPITAL_1M);
    expect(verdictLine(r, [], false)).toEqual({ kind: 'status', text: 'あと 1 欄' });
    const g = gateReading(readDraft(E1, CAPITAL_1M), { reading: true, marks: {} });
    expect(verdictLine(g, [], true)).toEqual({ kind: 'status', text: '明細を読み取っています' });
  });
});

describe('読み取りの後のフォーカス（AC-10）', () => {
  it('読み取り中 → 読めた、で欄にフォーカスが無いときだけ LC へ', () => {
    expect(focusLcAfterRead('reading', 'ready', 'none')).toBe(true);
    expect(focusLcAfterRead('preparing', 'ready', 'none')).toBe(true);
    expect(focusLcAfterRead('reading', 'ready', 'field')).toBe(false);
    expect(focusLcAfterRead('reading', 'failed', 'none')).toBe(false);
    expect(focusLcAfterRead('ready', 'ready', 'none')).toBe(false);
    expect(focusLcAfterRead(undefined, 'ready', 'none')).toBe(false);
  });
});

describe('小さなチャートの枠の 2 行目（AC-7）', () => {
  const base = {
    hasChart: true,
    preparing: false,
    reading: false,
    failed: false,
    timeframe: null,
    suggest: null,
  };
  it('空は「チャートを選ぶ」、読み取り中、案、時間足、指定なし', () => {
    expect(chartSlotLine({ ...base, hasChart: false })).toBe('チャートを選ぶ');
    expect(chartSlotLine({ ...base, reading: true })).toBe('時間足を読み取り中…');
    expect(chartSlotLine({ ...base, suggest: '日足' })).toBe('チャートからは 日足');
    expect(chartSlotLine({ ...base, timeframe: '4 時間足' })).toBe('4 時間足');
    expect(chartSlotLine(base)).toBe('時間足 指定なし');
    expect(chartSlotLine({ ...base, preparing: true })).toBe('準備しています…');
  });
});

describe('2 段（入れる → 振り返る。設計書 K17・2026-11-21）', () => {
  it('段は state の値。省けば振り返る段（状態だけを描くテスト）', () => {
    expect(stageOf({ stage: 'input' })).toBe('input');
    expect(stageOf({ stage: 'review' })).toBe('review');
    expect(stageOf({})).toBe('review');
  });

  it('2 段目の明細の行: 読み取り中・要約・やり直し（失敗・キャンセルで取引の値が無い。選ぶ枠は 1 段目だけ）', () => {
    expect(statementRow({ statement: { phase: 'reading' } })).toBe('reading');
    expect(statementRow({ statement: { phase: 'ready' } })).toBe('summary');
    expect(statementRow({ manual: true })).toBe('summary');
    expect(statementRow({ statement: { phase: 'failed' } })).toBe('retry');
    expect(statementRow({})).toBe('retry');
  });

  it('1 段目の明細の枠: 空・読み取り中・読めた（行の数）。失敗・終わった明細は空の枠（選び直す）', () => {
    expect(stage1Statement(undefined)).toEqual({ kind: 'empty' });
    expect(stage1Statement({ phase: 'done', rows: [] })).toEqual({ kind: 'empty' });
    expect(stage1Statement({ phase: 'failed', rows: [] })).toEqual({ kind: 'empty' });
    expect(stage1Statement({ phase: 'preparing', rows: [] })).toEqual({
      kind: 'filled',
      text: '読み取り中…',
    });
    expect(stage1Statement({ phase: 'ready', rows: [1] })).toEqual({
      kind: 'filled',
      text: '読み取りました',
    });
    expect(stage1Statement({ phase: 'ready', rows: [1, 2] })).toEqual({
      kind: 'filled',
      text: '2 行を読み取りました',
    });
  });

  it('［振り返りへ進む］ は 2 段目に見せるものがあるときだけ（無ければ ［明細なしで手入力］）', () => {
    expect(showProceed({})).toBe(false);
    expect(showProceed({ statement: { phase: 'failed' } })).toBe(false);
    expect(showProceed({ statement: { phase: 'reading' } })).toBe(true);
    expect(showProceed({ manual: true })).toBe(true);
  });

  const none = {
    hasChart: false,
    preparing: false,
    reading: false,
    failed: false,
    timeframe: null,
    suggest: null,
  };
  it('2 段目のチャートの行: 空は 1 タップで選ぶ行（準備中・失敗は状態の文）', () => {
    expect(chartRow({ entry: none, exit: none, extras: 0 })).toEqual({
      kind: 'empty',
      status: null,
    });
    expect(chartRow({ entry: { ...none, preparing: true }, exit: none, extras: 0 })).toEqual({
      kind: 'empty',
      status: '準備しています…',
    });
    expect(chartRow({ entry: { ...none, failed: true }, exit: none, extras: 0 })).toEqual({
      kind: 'empty',
      status: '使えない画像です',
    });
  });

  it('2 段目のチャートの行: 入ったら「エントリー時 · 時間足」と決済時の 1 行（押すとチャートのシート）', () => {
    const entry = { ...none, hasChart: true, timeframe: '1時間足' };
    expect(chartRow({ entry, exit: none, extras: 0 })).toEqual({
      kind: 'full',
      line1: 'エントリー時 · 1時間足',
      line2: '決済時のチャートも追加できます',
    });
    expect(
      chartRow({ entry, exit: { ...none, hasChart: true, timeframe: '日足' }, extras: 2 }),
    ).toEqual({
      kind: 'full',
      line1: 'エントリー時 · 1時間足',
      line2: '決済時 · 日足 · 追加 2 枚',
    });
    expect(chartRow({ entry: none, exit: { ...none, hasChart: true }, extras: 0 })).toEqual({
      kind: 'full',
      line1: 'エントリー時 · 未選択',
      line2: '決済時 · 時間足 指定なし',
    });
  });
});

describe('2 段目の明細の行の状態の文（#166 R1・R4・R5。例は Issue の表）', () => {
  const ready = (
    rows: number,
    extra: { raw?: number; index?: number; notice?: string | null } = {},
  ) => ({
    phase: 'ready' as const,
    rows: Array.from({ length: rows }, (_, i) => i),
    ...(extra.raw === undefined ? {} : { raw: Array.from({ length: extra.raw }, (_, i) => i) }),
    index: extra.index ?? 0,
    notice: extra.notice ?? null,
  });

  it('#1: 1 行の明細、全欄読めた → 「読み取りました」', () => {
    expect(statementStatus(ready(1), 0)).toEqual({ kind: 'done', text: '読み取りました', need: 0 });
  });
  it('#2: 2 行の明細 → 「2 行を読み取りました」（1 段目と同じ言い方）', () => {
    expect(statementStatus(ready(2), 0)).toEqual({
      kind: 'done',
      text: '2 行を読み取りました',
      need: 0,
    });
    expect(stage1Statement(ready(2))).toEqual({ kind: 'filled', text: '2 行を読み取りました' });
  });
  it('#3: オプションの 3 行が 2 件にまとまる → 「2 件（明細の 3 行）を読み取りました」', () => {
    expect(statementStatus(ready(2, { raw: 3 }), 0)).toEqual({
      kind: 'done',
      text: '2 件（明細の 3 行）を読み取りました',
      need: 0,
    });
  });
  it('#4: 名指す欄が 2 つ → 後ろに「 · 入力が必要な欄 2」。1 つなら 1、0 なら付けない', () => {
    expect(statementStatus(ready(1), 2)?.text).toBe('読み取りました · 入力が必要な欄 2');
    expect(statementStatus(ready(1), 1)?.text).toBe('読み取りました · 入力が必要な欄 1');
    expect(statementStatus(ready(2), 1)?.text).toBe('2 行を読み取りました · 入力が必要な欄 1');
    expect(statementStatus(ready(1), 0)?.text).toBe('読み取りました');
  });
  it('#9・#10: 読み取り中にキャンセルした（statement は無い）→ 「読み取りをキャンセルしました」', () => {
    expect(statementStatus(undefined, 0, true)).toEqual({
      kind: 'cancelled',
      text: '読み取りをキャンセルしました',
    });
    expect(READ_CANCELLED).toBe('読み取りをキャンセルしました');
    // 値の有無（#9 / #10）で文は変わらない（名指しの数も付けない）
    expect(statementStatus(undefined, 3, true)?.text).toBe('読み取りをキャンセルしました');
  });
  it('読み取り中 → 「読み取り中…」（読み上げの領域は読み取り中から同じ要素。R2）', () => {
    for (const phase of ['preparing', 'reading'] as const) {
      expect(statementStatus({ phase, rows: [], index: 0, notice: null }, 0)).toEqual({
        kind: 'reading',
        text: '読み取り中…',
      });
      // 新しい読み取りを始めたらキャンセルの文より読み取り中（R4）
      expect(statementStatus({ phase, rows: [], index: 0, notice: null }, 0, true)?.kind).toBe(
        'reading',
      );
    }
  });
  it('#14: 次の行へ進んで知らせが出ている・2 行目以降 → 出さない（知らせと 2 つ並べない。R5）', () => {
    expect(
      statementStatus(
        ready(2, { index: 1, notice: '1 / 2 行目を記録しました。次の行（2 / 2）です' }),
        0,
      ),
    ).toBeNull();
    expect(statementStatus(ready(2, { index: 1 }), 0)).toBeNull();
    expect(statementStatus(ready(2, { notice: 'まとめました' }), 0)).toBeNull();
  });
  it('失敗（決まった文言の警告のまま）・行を見終えた・#15 手入力（明細なし）→ 出さない', () => {
    expect(statementStatus({ phase: 'failed', rows: [], index: 0, notice: null }, 0)).toBeNull();
    expect(
      statementStatus(
        { phase: 'done', rows: [], index: 0, notice: '明細のすべての行を確認しました' },
        0,
      ),
    ).toBeNull();
    expect(statementStatus(undefined, 0)).toBeNull();
    expect(statementStatus(undefined, 2, false)).toBeNull();
  });
});

describe('明細の行の 1 回だけの動き（#166 R3）', () => {
  it('読み取り中から読めた・失敗したへ移ったときだけ', () => {
    for (const before of ['preparing', 'reading'] as const) {
      expect(readFinished(before, 'ready')).toBe(true);
      expect(readFinished(before, 'failed')).toBe(true);
      // キャンセル（statement が消える）は動かさない
      expect(readFinished(before, undefined)).toBe(false);
      expect(readFinished(before, 'reading')).toBe(false);
    }
    expect(readFinished('preparing', 'reading')).toBe(false);
    // 次の行へ進む・読めた後の描き直し・手入力は動かさない
    expect(readFinished('ready', 'ready')).toBe(false);
    expect(readFinished(undefined, 'ready')).toBe(false);
    expect(readFinished('ready', 'done')).toBe(false);
    expect(readFinished('failed', 'failed')).toBe(false);
  });
});

describe('読み直しをやめて前の明細に戻した文（#184 R6）', () => {
  const st = (reverted: { kind: 'failed' | 'cancelled' }) => ({
    phase: 'ready' as const,
    rows: [0],
    index: 0,
    notice: null,
    reverted,
  });

  it('キャンセルで戻した → キャンセルの文、失敗で戻した → 状態の文なし（決まった文言の警告を別に出す）', () => {
    expect(statementStatus(st({ kind: 'cancelled' }), 0, true)).toEqual({
      kind: 'cancelled',
      text: '読み取りをキャンセルしました',
    });
    expect(statementStatus(st({ kind: 'failed' }), 2)).toBeNull();
  });
});

describe('読み直しの文（#184 のデザインレビュー 1・5）', () => {
  it('失敗で前の明細に戻した文 = 決まった文言の 1 文目 +「前の明細に戻しました。」（次にすることの文は付けない）', () => {
    expect(revertedMessage('今は読み取りを使えません。手入力してください。')).toBe(
      '今は読み取りを使えません。前の明細に戻しました。',
    );
    expect(
      revertedMessage('読み取れませんでした。もう一度貼り付けるか、手入力してください。'),
    ).toBe(`読み取れませんでした。${REVERTED_TAIL}`);
    expect(revertedMessage('句点の無い文')).toBe(`句点の無い文${REVERTED_TAIL}`);
  });

  it('読み直しの途中は「別の明細を読み取り中…」（1 枚目は今の「読み取り中…」）', () => {
    const reading = { phase: 'reading' as const, rows: [], index: 0, notice: null };
    expect(statementStatus({ ...reading, rereading: true }, 0)?.text).toBe('別の明細を読み取り中…');
    expect(statementStatus(reading, 0)?.text).toBe('読み取り中…');
  });
});
