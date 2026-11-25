// 危ない勝ちの数字の扱い（Issue #227 AC-1〜AC-6・KEEP-2。設計書 5.4・C59）。値はすべて架空。
// 部品は DOM のライブラリを使わず、関数を呼んで要素の木に展開して見る（ruler-screens.test.tsx と同じ道具）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import type { Judgment, Reason } from '../../core/judge';
import type { StoredTrade } from '../../core/record';
import { EmotionSheetBody } from '../../ui/src/components/Emotions';
import { CompactTradeRow } from '../../ui/src/components/HomeCards';
import { VerdictLineButton } from '../../ui/src/components/RecordParts';
import { TradeRow } from '../../ui/src/components/TradeRow';
import { Verdict } from '../../ui/src/components/Verdict';
import { changeText } from '../../ui/src/lib/edit-form';
import { compactRowModel } from '../../ui/src/lib/home-view';
import { readDraft } from '../../ui/src/lib/record-form';
import { verdictLine } from '../../ui/src/lib/record-screen';
import { outcomeRows } from '../../ui/src/lib/resnapshot';
import { breachView, COUNTERFACTUAL, cautionText, quietR } from '../../ui/src/lib/risky-win';
import { Link } from '../../ui/src/lib/router';
import { listRowModel } from '../../ui/src/lib/trade-list';
import { tradeRow } from '../../ui/src/lib/trade-view';
import { submitStatus } from '../../ui/src/lib/verdict-notes';
import { OPTION_TABLE_CASES } from '../core/option-table-cases';
import { closedInfoTip } from './helpers/info-tip';
import {
  CAPITAL_1M,
  E1 as DRAFT_B,
  E17 as DRAFT_NO_LC_WIN,
  E4 as DRAFT_OVER_RISK,
  draft,
  NO_CAPITAL,
  PLANNED,
} from './helpers/record-drafts';
import { D1, INSTRUMENTS, L2, stored } from './helpers/trade-examples';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  const tip = closedInfoTip(vn);
  if (tip) return expand(tip);
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  if (typeof vn.type === 'function') {
    const fn = vn.type as (p: unknown) => unknown;
    return expand(fn(vn.props));
  }
  const { children, ...props } = vn.props ?? {};
  return [{ type: String(vn.type), props, children: expand(children) }];
}

const cls = (e: El): string => String(e.props.class ?? '');
const hasClass = (c: string) => (e: El) => cls(e).split(/\s+/).includes(c);
function all(nodes: readonly Node[], pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) out.push(n);
    out.push(...all(n.children, pred));
  }
  return out;
}
const text = (n: Node | readonly Node[]): string =>
  Array.isArray(n)
    ? (n as readonly Node[]).map(text).join('')
    : typeof n === 'string'
      ? n
      : text((n as El).children);
/** 木を文書の順に並べた要素 */
function flat(nodes: readonly Node[]): El[] {
  return all(nodes, () => true);
}

const win = (reasons: readonly Reason[]): Judgment => ({
  outcome: 'win',
  grade: 'riskyWin',
  reasons,
});

// 例の表 E1〜E7（理由の組と R → 帯の文・反実の 1 行の有無）
const TABLE: readonly {
  readonly id: string;
  readonly reasons: readonly Reason[];
  readonly r: number | undefined;
  readonly breach: string;
  readonly counterfactual: boolean;
}[] = [
  {
    id: 'E1',
    reasons: [{ kind: 'lcWidened', from: 990, to: 980 }],
    r: 1.5,
    breach: 'LC を広げた（990 → 980）',
    counterfactual: true,
  },
  {
    id: 'E2',
    reasons: [{ kind: 'lcWidened' }],
    r: 0.5,
    breach: 'LC を広げた',
    counterfactual: true,
  },
  {
    id: 'E3',
    reasons: [{ kind: 'lcCancelled' }],
    r: 0.8,
    breach: '持っている間に逆指値を取消',
    counterfactual: true,
  },
  {
    id: 'E4',
    reasons: [{ kind: 'noLc' }],
    r: undefined,
    breach: 'LC を決めずに入った',
    counterfactual: false,
  },
  {
    id: 'E5',
    reasons: [{ kind: 'overRisk', riskPct: 2.5 }],
    r: 1.5,
    breach: '過剰リスク（2.5%）',
    counterfactual: false,
  },
  {
    // 理由の並びが表の順でなくても、崩れの文は表の順で最初（広げた → 時間足）
    id: 'E6',
    reasons: [{ kind: 'timeframeLonger', source: 'tap' }, { kind: 'lcWidened' }],
    r: 0.4,
    breach: 'LC を広げた',
    counterfactual: true,
  },
  {
    id: 'E7',
    reasons: [
      { kind: 'heldPastLc', underlying: 37_300 },
      { kind: 'riskNotChecked', cause: 'noCapital' },
    ],
    r: 0.3,
    breach: 'LC で切らずに持ち続けた（原資産 37,300）',
    counterfactual: true,
  },
];

describe('breachView・cautionText: 崩れの文と反実の 1 行（AC-1・AC-3）', () => {
  it('反実の 1 行の言い方は「LC で切っていれば −1.0R」', () => {
    expect(COUNTERFACTUAL).toBe('LC で切っていれば −1.0R');
  });

  for (const row of TABLE) {
    it(`${row.id}: 崩れの文「${row.breach}」・反実の 1 行 ${row.counterfactual ? 'あり' : 'なし'}`, () => {
      const v = breachView(win(row.reasons), row.r);
      expect(v).toEqual({
        breach: row.breach,
        counterfactual: row.counterfactual ? COUNTERFACTUAL : null,
      });
      if (v === null) throw new Error('危ない勝ちなのに null');
      expect(cautionText(v)).toBe(row.counterfactual ? COUNTERFACTUAL : row.breach);
    });
  }

  it('LC の線を崩した理由でも R が出なければ反実の 1 行を出さない（−1.0R が言えない）', () => {
    expect(breachView(win([{ kind: 'lcWidened' }]), undefined)?.counterfactual).toBeNull();
  });

  it('時間足・金額ありき・ナンピンだけの危ない勝ちには反実の 1 行を出さない', () => {
    for (const reason of [
      { kind: 'timeframeLonger', source: 'chart' },
      { kind: 'amountBasedLc' },
      { kind: 'averagingDown', entryIndex: 1 },
    ] as const) {
      expect(breachView(win([reason]), 0.6)?.counterfactual).toBeNull();
    }
  });

  it('危ない勝ちでない判定は null（A・B・C・計画どおりの勝ち・判定なし）', () => {
    expect(breachView(undefined, 1)).toBeNull();
    for (const grade of ['A', 'B', 'C', 'safeWin'] as const) {
      expect(breachView({ outcome: 'win', grade, reasons: [{ kind: 'lcWidened' }] }, 1)).toBeNull();
    }
  });

  it('quietR は危ない勝ちだけ', () => {
    expect(quietR('riskyWin')).toBe(true);
    for (const g of ['A', 'B', 'C', 'safeWin', null, undefined] as const)
      expect(quietR(g)).toBe(false);
  });
});

/** LC を広げて耐え、+1.5R で決済した危ない勝ち（L、イン 100.00・LC 99.50 → 99.20、決済 100.75。架空） */
const DRAFT_WIDENED_WIN = draft({
  side: 'L',
  entryPrice: '100.00',
  lc: '99.50',
  exitPrice: '100.75',
  lcMove: 'widened',
  lcAfter: '99.20',
  timeframeChange: 'none',
});
/** 計画どおりの勝ち +1.5R（資金なし） */
const DRAFT_SAFE_WIN = draft({
  side: 'L',
  entryPrice: '100.00',
  lc: '99.50',
  exitPrice: '100.75',
  ...PLANNED,
});

describe('下の帯: 危ない勝ちは R の代わりに帯の文（AC-1・AC-2・KEEP-2）', () => {
  const lineTree = (d: typeof DRAFT_B, ctx = NO_CAPITAL) => {
    const read = readDraft(d, ctx);
    const line = verdictLine(read, [], false);
    const tree = expand(
      VerdictLineButton({
        id: 'x',
        line,
        status: submitStatus(read, []),
        disabled: false,
        onOpen: () => {},
      }),
    );
    return { read, line, tree };
  };

  it('LC を広げた勝ち: バッジ +「LC で切っていれば −1.0R」、R・リスクの数字は帯に無い', () => {
    const { read, line, tree } = lineTree(DRAFT_WIDENED_WIN, CAPITAL_1M);
    expect(read.preview.judgment?.grade).toBe('riskyWin');
    expect(read.preview.r).toBeCloseTo(1.5, 9);
    expect(line).toEqual({ kind: 'judged', grade: 'riskyWin', caution: COUNTERFACTUAL });
    expect(all(tree, hasClass('num'))).toEqual([]);
    expect(all(tree, hasClass('vline__risk'))).toEqual([]);
    expect(all(tree, hasClass('vline__caution')).map(text)).toEqual([COUNTERFACTUAL]);
    expect(submitStatus(read, [])).toBe(`危ない勝ち · ${COUNTERFACTUAL}`);
  });

  it('LC なしの勝ち: 帯の文は崩れの文「LC を決めずに入った」', () => {
    const { read, tree } = lineTree(DRAFT_NO_LC_WIN);
    expect(all(tree, hasClass('vline__caution')).map(text)).toEqual(['LC を決めずに入った']);
    expect(submitStatus(read, [])).toBe('危ない勝ち · LC を決めずに入った');
  });

  it('過剰リスクの勝ち: 帯の文は「過剰リスク（2.5%）」で、反実の 1 行は出さない', () => {
    const { read, tree } = lineTree(DRAFT_OVER_RISK, CAPITAL_1M);
    expect(read.preview.judgment?.grade).toBe('riskyWin');
    expect(all(tree, hasClass('vline__caution')).map(text)).toEqual(['過剰リスク（2.5%）']);
    expect(all(tree, hasClass('num'))).toEqual([]);
  });

  it('KEEP-2: 計画どおりの勝ちと B は今のまま（数字の段 title の R・帯の文なし。#236 で 24px → title 28px）', () => {
    for (const [d, r] of [
      [DRAFT_SAFE_WIN, '+1.5R'],
      [DRAFT_B, '−1.6R'],
    ] as const) {
      const { tree } = lineTree(d);
      expect(all(tree, hasClass('vline__caution'))).toEqual([]);
      const nums = all(tree, hasClass('num'));
      expect(nums.map(cls)).toEqual(['num num--title']);
      expect(text(all(tree, hasClass('numu--title')))).toBe(r);
    }
  });
});

describe('判定の枠: 危ない勝ちの主役は崩れの文（AC-3・AC-4・KEEP-2）', () => {
  const verdictTree = (d: typeof DRAFT_B, ctx = NO_CAPITAL) =>
    expand(Verdict({ summary: readDraft(d, ctx).preview, side: 'L' }));

  it('LC を広げた勝ち: 崩れの文と反実の 1 行が R より先、R は静かな形（数字の段 hero に出さない）', () => {
    const tree = verdictTree(DRAFT_WIDENED_WIN);
    expect(all(tree, hasClass('num--hero'))).toEqual([]);
    expect(all(tree, hasClass('verdict__breach-what')).map(text)).toEqual([
      'LC を広げた（99.5 → 99.2）',
    ]);
    expect(all(tree, hasClass('verdict__breach-if')).map(text)).toEqual([COUNTERFACTUAL]);
    const order = flat(tree);
    const breachAt = order.findIndex(hasClass('verdict__breach'));
    const rAt = order.findIndex(hasClass('num--quiet'));
    expect(breachAt).toBeGreaterThanOrEqual(0);
    expect(rAt).toBeGreaterThan(breachAt);
    expect(text(order.slice(rAt, rAt + 1))).toBe('+1.5R');
  });

  it('LC なしの勝ち: 崩れの文だけ（反実の 1 行なし）、R は今のまま「—」', () => {
    const tree = verdictTree(DRAFT_NO_LC_WIN);
    expect(all(tree, hasClass('verdict__breach-what')).map(text)).toEqual(['LC を決めずに入った']);
    expect(all(tree, hasClass('verdict__breach-if'))).toEqual([]);
    expect(all(tree, hasClass('num--quiet'))).toEqual([]);
  });

  it('KEEP-2: 計画どおりの勝ち・B は数字の段 hero の R のまま（#236 で 44px → hero 40px）、崩れの文の段は無い', () => {
    for (const d of [DRAFT_SAFE_WIN, DRAFT_B]) {
      const tree = verdictTree(d);
      expect(all(tree, hasClass('verdict__breach'))).toEqual([]);
      expect(all(tree, hasClass('num--hero'))).toHaveLength(1);
      expect(all(tree, hasClass('num--quiet'))).toEqual([]);
    }
  });
});

/** 一覧の例: LC を広げて耐え、決済 100.75 → 危ない勝ち +1.5R（D1 の形の勝ち。架空） */
const RISKY = stored('rw', {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: {
    time: Date.UTC(2026, 10, 12),
    price: 100.75,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: 7_500,
});

describe('一覧の行・ホームの行: 危ない勝ちの R は静かな形（AC-5・KEEP-2・KEEP-3）', () => {
  const NOW = Date.UTC(2026, 10, 20);
  const cases: readonly [string, StoredTrade, boolean][] = [
    ['危ない勝ち（E1）', RISKY, true],
    ['計画どおりの勝ち（E8）', L2, false],
    ['B（E9）', D1, false],
  ];

  for (const [name, t, quiet] of cases) {
    it(`${name}: 静かな形 ${quiet ? 'あり' : 'なし'}`, () => {
      const row = tradeRow(t, INSTRUMENTS);
      expect(listRowModel(row).rQuiet === true).toBe(quiet);
      expect(compactRowModel(row, NOW).rQuiet === true).toBe(quiet);
      const listR = all(expand(TradeRow({ row })), hasClass('traderow__r'));
      expect(listR.map((e) => hasClass('traderow__r--quiet')(e))).toEqual([quiet]);
      const homeR = all(expand(CompactTradeRow({ row, now: NOW })), hasClass('homerow__r'));
      expect(homeR.map((e) => hasClass('homerow__r--quiet')(e))).toEqual([quiet]);
    });
  }

  it('危ない勝ちの行の R の値と読み上げの名前は今のまま（R を隠さない）', () => {
    const row = tradeRow(RISKY, INSTRUMENTS);
    expect(row.badge.label).toBe('危ない勝ち');
    expect(row.rText).toBe('+1.5R');
    expect(row.label).toContain('危ない勝ち R +1.5R');
  });
});

describe('保存の後のシート（1 件）: 危ない勝ちの R は静かな形（AC-6）', () => {
  const sheet = (grade: 'riskyWin' | 'safeWin') =>
    expand(
      EmotionSheetBody({
        prefix: 'record',
        context: 'saved',
        state: { selected: [], saved: [], opened: [], sending: false, error: null },
        verdicts: [{ grade, r: 1.5 }],
        onToggle: () => {},
        onClose: () => {},
      }),
    );

  it('危ない勝ちは emotions__r--quiet、計画どおりの勝ちは今の形', () => {
    expect(all(sheet('riskyWin'), hasClass('emotions__r')).map(cls)).toEqual([
      'num emotions__r emotions__r--quiet',
    ]);
    expect(all(sheet('safeWin'), hasClass('emotions__r')).map(cls)).toEqual([
      'num num--row emotions__r',
    ]);
  });
});

describe('本物の判定（evaluateTrade）を通した場面（E3 取消・E7 オプションの持ち続けた）', () => {
  it('E7: 設計書 5.7 O4（売りのプットで原資産が LC を越えて持ち続け、+0.3R）→ 崩れの文「持ち続けた」+ 反実の 1 行', () => {
    const scene = OPTION_TABLE_CASES.O4?.[0];
    if (scene === undefined) throw new Error('O4 の場面が無い');
    const ev = evaluateTrade(scene.input);
    if (!ev.ok) throw new Error('O4 が評価できない');
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(ev.r).toBeCloseTo(0.3, 9);
    expect(breachView(ev.judgment, ev.r, scene.input.side)).toEqual({
      breach: 'LC で切らずに持ち続けた（原資産 37,300）',
      counterfactual: COUNTERFACTUAL,
    });
  });

  /** E3: 「LC を動かしたか」= 取消、TP の形で +1.5R（L、イン 100.00・LC 99.50、決済 100.75。架空） */
  const DRAFT_CANCELLED_WIN = draft({
    side: 'L',
    entryPrice: '100.00',
    lc: '99.50',
    exitPrice: '100.75',
    lcMove: 'cancelled',
    timeframeChange: 'none',
  });

  it('E3: 取消の勝ちは帯に反実の 1 行、枠に崩れの文「持っている間に逆指値を取消」（理由の一覧に重ねない）', () => {
    const read = readDraft(DRAFT_CANCELLED_WIN, NO_CAPITAL);
    expect(read.preview.judgment?.grade).toBe('riskyWin');
    expect(verdictLine(read, [], false)).toEqual({
      kind: 'judged',
      grade: 'riskyWin',
      caution: COUNTERFACTUAL,
    });
    const tree = expand(Verdict({ summary: read.preview, side: 'L' }));
    expect(all(tree, hasClass('verdict__breach-what')).map(text)).toEqual([
      '持っている間に逆指値を取消',
    ]);
    expect(all(tree, hasClass('verdict__breach-if')).map(text)).toEqual([COUNTERFACTUAL]);
    expect(all(tree, hasClass('reasons__item')).map(text)).not.toContain(
      '持っている間に逆指値を取消',
    );
  });
});

describe('判定の枠のほかの数・編集と比較の 1 行（#227 の独立レビューの指摘）', () => {
  it('崩れの文に使った理由だけを理由の一覧から外す（ほかの理由は残る）', () => {
    const d = draft({
      side: 'L',
      entryPrice: '100.00',
      lc: '99.50',
      exitPrice: '100.75',
      lcMove: 'widened',
      lcAfter: '99.20',
      timeframeChange: 'longer',
    });
    const tree = expand(Verdict({ summary: readDraft(d, NO_CAPITAL).preview, side: 'L' }));
    const list = all(tree, hasClass('reasons__item')).map(text);
    expect(list.some((t) => t.startsWith('LC を広げた'))).toBe(false);
    expect(list.some((t) => t.startsWith('時間足を変えた'))).toBe(true);
  });

  it('危ない勝ちのリスクと損益も静かな形（数字の段 row を使わない）、計画どおりの勝ちは今のまま', () => {
    const risky = expand(
      Verdict({ summary: readDraft(DRAFT_OVER_RISK, CAPITAL_1M).preview, side: 'L' }),
    );
    expect(all(risky, hasClass('num--row'))).toEqual([]);
    // 静かな形は段に入れず、単位も数と同じ塊（#236・C62）
    expect(all(risky, hasClass('num--quiet')).map(text)).toEqual(['+1.0R', '2.5%', '+25,000円']);
    expect(all(risky, hasClass('verdict__stat--quiet'))).toHaveLength(3);
    const safe = expand(
      Verdict({ summary: readDraft(DRAFT_SAFE_WIN, CAPITAL_1M).preview, side: 'L' }),
    );
    expect(all(safe, hasClass('num--quiet'))).toEqual([]);
    expect(all(safe, hasClass('verdict__stat--quiet'))).toEqual([]);
  });

  it('編集前が危ない勝ちなら、編集前の R は 2 番目の文字の色の包みの中の静かな形', () => {
    const before = readDraft(DRAFT_WIDENED_WIN, NO_CAPITAL).preview;
    const after = readDraft(DRAFT_B, NO_CAPITAL).preview;
    const tree = expand(Verdict({ summary: after, side: 'L', before: before as never }));
    const wrap = all(tree, hasClass('verdict__before-quiet'));
    expect(wrap).toHaveLength(1);
    expect(all(wrap, hasClass('num--quiet')).map(text)).toEqual(['+1.5R']);
  });

  it('編集の帯の変化の 1 行は危ない勝ちの R を出さない（R4）。R だけ変わればそのことを言う', () => {
    const risky = readDraft(DRAFT_WIDENED_WIN, NO_CAPITAL).preview as never;
    const b = readDraft(DRAFT_B, NO_CAPITAL).preview as never;
    expect(changeText(b, risky)).toBe('判定: B 悪い損失 −1.6R → 危ない勝ち');
    expect(changeText(risky, risky)).toBeNull();
    const risky2 = readDraft(
      draft({
        side: 'L',
        entryPrice: '100.00',
        lc: '99.50',
        exitPrice: '100.50',
        lcMove: 'widened',
        lcAfter: '99.20',
        timeframeChange: 'none',
      }),
      NO_CAPITAL,
    ).preview as never;
    expect(changeText(risky, risky2)).toBe('判定は 危ない勝ち のまま・R が変わります');
  });

  it('比較のシートの R の行は危ない勝ちの側だけ静かな形', () => {
    const risky = readDraft(DRAFT_WIDENED_WIN, NO_CAPITAL).preview as never;
    const b = readDraft(DRAFT_B, NO_CAPITAL).preview as never;
    const r = outcomeRows(b, risky).find((x) => x.label === 'R');
    expect(r).toMatchObject({ from: '−1.6R', to: '+1.5R', toQuiet: true });
    expect(r?.fromQuiet).toBeUndefined();
  });
});
