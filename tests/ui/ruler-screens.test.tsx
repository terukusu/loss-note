// LC の物差し・詳細の 決済までの行動の答え・「すべての欄」の描画（Issue #34 AC-2・AC-4〜AC-8・契約 U-1・U-2）。
// DOM のライブラリを使わず、部品の関数を呼んで要素の木に展開して見る（trade-screens-view.test.tsx と同じ道具）。値はすべて架空

import { readFileSync } from 'node:fs';
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { RULER_MARKS } from '../../ui/src/components/Ruler';
import { Verdict } from '../../ui/src/components/Verdict';
import {
  draftFromStored,
  editContext,
  editPreview,
  editSnapshot,
  mergeEdit,
} from '../../ui/src/lib/edit-form';
import type { RecordState } from '../../ui/src/lib/record-controller';
import {
  type Draft,
  type DraftContext,
  readDraft,
  type Summary,
  summarize,
} from '../../ui/src/lib/record-form';
import { Link } from '../../ui/src/lib/router';
import type { PreviewHandle } from '../../ui/src/lib/statement-image';
import type { DetailState } from '../../ui/src/lib/trade-detail-controller';
import { recordFields } from '../../ui/src/lib/trade-view';
import { RecordView } from '../../ui/src/pages/Record';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeNotesView } from '../../ui/src/pages/TradeNotes';
import { closedInfoTip } from './helpers/info-tip';
import { CAPITAL_1M, E1 as DRAFT_E2, E16 as DRAFT_NO_LC, draft } from './helpers/record-drafts';
import { exitAt, N1, N2, N3, RULER_EXAMPLES } from './helpers/ruler-examples';
import { D1, INSTRUMENTS, stored } from './helpers/trade-examples';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

/** 部品（関数）を呼んで、要素（文字列の type）だけの木にする。Link は a として止める（hook を使うため） */
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

function all(nodes: Node[], pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) out.push(n);
    all(n.children, pred, out);
  }
  return out;
}

function text(n: Node | Node[]): string {
  if (Array.isArray(n)) return n.map(text).join('');
  return typeof n === 'string' ? n : text(n.children);
}

const cls = (e: El) => String(e.props.class ?? '');
const hasClass = (c: string) => (e: El) => cls(e).split(' ').includes(c);
const noop = () => {};
const EMPTY = new Set<string>();

function one(tree: Node[], pred: (e: El) => boolean): El {
  const found = all(tree, pred);
  expect(found).toHaveLength(1);
  return found[0] as El;
}

const verdictOf = (tree: Node[]) => one(tree, hasClass('verdict'));
const rulerList = (tree: Node[]) =>
  all(tree, (e) => e.type === 'ul' && e.props['aria-label'] === 'LC の物差し');

/** 判定の枠の直接の子のうち、名前のクラスを持つものの添字 */
function childIndex(v: El, c: string): number {
  return v.children.findIndex((n) => typeof n !== 'string' && hasClass(c)(n));
}

function must(id: string): StoredTrade {
  const t = RULER_EXAMPLES[id];
  if (!t) throw new Error(id);
  return t;
}

// ---- 詳細 ----

const handle: PreviewHandle = { width: 320, height: 200, draw: noop, close: noop };

function detailState(t: StoredTrade): DetailState {
  return {
    phase: 'ready',
    trade: t,
    instruments: INSTRUMENTS,
    accounts: [],
    instrumentName: 'US30',
    summary: summarize(t),
    charts: {
      entry: t.charts?.entry ? { phase: 'ready', preview: handle } : { phase: 'none' },
      exit: t.charts?.exit ? { phase: 'ready', preview: handle } : { phase: 'none' },
    },
  };
}

function detailTree(t: StoredTrade): Node[] {
  return expand(
    <TradeDetailView
      id={t.id}
      state={detailState(t)}
      hidden={EMPTY}
      notFound={notFoundState()}
      onDelete={noop}
      onReloadChart={noop}
      onReload={noop}
      onRelogin={noop}
    />,
  );
}

// ---- 記録する画面 ----

function stateFor(d: Draft, ctx: DraftContext, over: Partial<RecordState> = {}): RecordState {
  return {
    phase: 'editing',
    draft: d,
    instruments: ctx.instruments,
    accounts: ctx.accounts,
    read: readDraft(d, ctx),
    error: null,
    ...over,
  };
}

function recordTree(state: RecordState): Node[] {
  return expand(
    RecordView({
      state,
      onUpdate: noop,
      onSave: noop,
      onNext: noop,
      onReload: noop,
      onRelogin: noop,
    }),
  );
}

/** E2 の数だけ入れて 3 つのタップをまだ押していない下書き */
const DRAFT_E2_BEFORE = draft({ side: 'L', entryPrice: '100.00', lc: '99.50', exitPrice: '99.20' });

function savedFrom(d: Draft): RecordState {
  const read = readDraft(d, CAPITAL_1M);
  const trade: StoredTrade = {
    id: 'trade-ruler',
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: 1_000_000,
      riskTolerancePct: 1,
    },
    record: { ...(read.body as NonNullable<typeof read.body>), instrumentId: 'inst-us30' },
  };
  return stateFor(d, CAPITAL_1M, {
    phase: 'saved',
    saved: {
      trade,
      instrumentName: 'US30',
      summary: summarize(trade),
      accountName: '口座 1',
      accountCount: 1,
    },
  });
}

const E2_LIST = [
  '広げた後の LC 99.2（−1.6R）',
  '決済 99.2（−1.6R）',
  '決めた LC 99.5（−1.0R）',
  'イン 100',
  'LC を 0.6R 超えて決済',
];

/** 判定の枠の文字から 決済までの行動の答えの札と添え書きを除く（詳細だけにある。物差しの前からの中身と比べるため） */
function withoutTaps(v: El): string {
  const tapsUl = all([v], hasClass('taps'))[0];
  let s = text(v);
  if (tapsUl) s = s.replace(text(tapsUl), '');
  return s;
}

/** 物差しの段を取り除いた Summary で描いた判定の枠の文字 */
function verdictTextWithoutRuler(s: Summary, side: 'L' | 'S'): string {
  const { ruler: _r, ...rest } = s;
  return text(expand(<Verdict summary={rest} side={side} titleId="x" />));
}

describe('AC-2: N2〜N4 で物差しの段が無く、ほかの中身は同じ（N1 の LC なしは #231 で価格の位置の図）', () => {
  it.each([
    ['N2', N2],
    ['N3', N3],
  ] as const)('%s（詳細）', (_id, t) => {
    const s = summarize(t);
    expect(s.ruler).toBeUndefined();
    const tree = detailTree(t);
    const v = verdictOf(tree);
    expect(all([v], hasClass('ruler'))).toEqual([]);
    expect(rulerList(tree)).toEqual([]);
    expect(withoutTaps(v)).toBe(verdictTextWithoutRuler(s, t.record.side));
  });

  it('N2 は保存した記録から計算できない（summary.invalid）', () => {
    expect(summarize(N2).invalid).toBe(true);
  });

  it('N2（記録する画面）: イン = LC は LC の向きの誤りで判定待ち、物差しは無い', () => {
    const d = draft({
      side: 'L',
      entryPrice: '100.00',
      lc: '100.00',
      exitPrice: '99.50',
      lcDecided: true,
      lcMove: 'none',
      timeframeChange: 'none',
    });
    const tree = recordTree(stateFor(d, CAPITAL_1M));
    expect(all([verdictOf(tree)], hasClass('ruler'))).toEqual([]);
  });

  it('N1（記録する画面）: LC なしは判定が出たら価格の位置の図（R の目盛りなし。#231・C66）', () => {
    const st = stateFor(DRAFT_NO_LC, CAPITAL_1M);
    expect(st.read.preview.judgment).toBeDefined();
    const v = verdictOf(recordTree(st));
    const ruler = one([v], hasClass('ruler'));
    expect(hasClass('ruler--price')(ruler)).toBe(true);
    expect(all([ruler], hasClass('ruler__tick')).map(text)).toEqual(['LC なし']);
  });

  it('N4（記録する画面）: 未入力の欄がある間は物差しが無く、判定の枠の文字は物差しを足す前と同じ', () => {
    const st = stateFor(DRAFT_E2_BEFORE, CAPITAL_1M);
    expect(st.read.missing.length).toBeGreaterThan(0);
    expect(st.read.preview.ruler).toBeUndefined();
    const v = verdictOf(recordTree(st));
    expect(all([v], hasClass('ruler'))).toEqual([]);
  });

  it('物差しが出る取引でも、物差しの段を除いた枠の文字は物差しを足す前と同じ（E2）', () => {
    const t = must('E2');
    const v = verdictOf(detailTree(t));
    const ruler = one([v], hasClass('ruler'));
    const without = withoutTaps(v).replace(text(ruler), '');
    expect(without).toBe(verdictTextWithoutRuler(summarize(t), 'L'));
  });
});

describe('AC-4: 図は読み上げから外れ、名前つきの一覧に 4 点と越えた行', () => {
  it('E2', () => {
    const tree = detailTree(must('E2'));
    const ruler = one(tree, hasClass('ruler'));
    const plots = all([ruler], (e) => e.type === 'svg' && hasClass('ruler__plot')(e));
    expect(plots).toHaveLength(1);
    expect(plots[0]?.props['aria-hidden']).toBe('true');
    expect(plots[0]?.props.focusable).toBe('false');
    // 一覧の頭の小さな形も読み上げから外す
    for (const k of all([ruler], hasClass('ruler__key')))
      expect(k.props['aria-hidden']).toBe('true');
    const lists = rulerList(tree);
    expect(lists).toHaveLength(1);
    expect(all(lists, (e) => e.type === 'li').map(text)).toEqual(E2_LIST);
  });
});

describe('AC-5: 5 種類の点の形がすべて違う', () => {
  it('RULER_MARKS の形（形・塗り）の組が 5 つとも違う', () => {
    const keys = Object.values(RULER_MARKS).map((m) => `${m.shape}/${m.filled}`);
    expect(Object.keys(RULER_MARKS).sort()).toEqual([
      'entry',
      'exit',
      'movedLc',
      'plannedLc',
      'tp',
    ]);
    expect(new Set(keys).size).toBe(5);
    expect(new Set(Object.values(RULER_MARKS).map((m) => m.shape)).size).toBe(5);
  });

  it('描いた点の形のクラスは RULER_MARKS のとおりで、形の要素も種類ごとに違う', () => {
    const seen = new Map<string, string>();
    for (const id of ['E2', 'E4']) {
      const t = must(id);
      const ruler = one(detailTree(t), hasClass('ruler'));
      const plot = one([ruler], hasClass('ruler__plot'));
      const marks = all([plot], hasClass('ruler__mark'));
      for (const m of marks) {
        const shape = cls(m).match(/ruler__mark--(\w+)/)?.[1] ?? '';
        const el = m.children[0] as El;
        seen.set(shape, `${el.type}:${String(el.props.d ?? el.props.r ?? el.props.width)}`);
      }
    }
    expect([...seen.keys()].sort()).toEqual(
      Object.values(RULER_MARKS)
        .map((m) => m.shape)
        .sort(),
    );
    expect(new Set(seen.values()).size).toBe(5);
  });

  it('範囲の外の点（E7 の決済・E13 の TP）には山形の印が付く', () => {
    expect(all(detailTree(must('E7')), hasClass('ruler__beyond'))).toHaveLength(1);
    expect(all(detailTree(must('E13')), hasClass('ruler__beyond'))).toHaveLength(1);
    expect(all(detailTree(must('E2')), hasClass('ruler__beyond'))).toHaveLength(0);
  });

  it('越えた区間の太い線は越えた場面（E2）だけ', () => {
    expect(all(detailTree(must('E2')), hasClass('ruler__over'))).toHaveLength(1);
    expect(all(detailTree(must('E10')), hasClass('ruler__over'))).toHaveLength(0);
  });

  it('style 属性を使わない（位置は SVG の属性の百分率）', () => {
    const tree = detailTree(must('E2'));
    expect(all(tree, (e) => 'style' in e.props)).toEqual([]);
    const xs = all(
      [one(tree, hasClass('ruler__plot'))],
      (e) => e.type === 'svg' && 'x' in e.props,
    ).map((e) => e.props.x);
    expect(xs.every((x) => /^\d+\.\d{2}%$/.test(String(x)))).toBe(true);
  });
});

describe('AC-6: 記録する画面（判定の前 / 後 / 保存の後）', () => {
  it('3 つのタップの前は物差しが無い', () => {
    const tree = recordTree(stateFor(DRAFT_E2_BEFORE, CAPITAL_1M));
    expect(all(tree, hasClass('ruler'))).toEqual([]);
  });

  it('タップの後は R・リスク・損益の段の後・理由の一覧の前に物差し', () => {
    const tree = recordTree(stateFor(DRAFT_E2, CAPITAL_1M));
    const v = verdictOf(tree);
    const stats = childIndex(v, 'verdict__stats');
    const ruler = childIndex(v, 'ruler');
    const reasons = childIndex(v, 'reasons');
    expect(stats).toBeGreaterThanOrEqual(0);
    expect(ruler).toBeGreaterThan(stats);
    expect(reasons).toBeGreaterThan(ruler);
    expect(all(rulerList(tree), (e) => e.type === 'li').map(text)).toEqual(E2_LIST);
  });

  it('保存の後の判定の枠にも同じ位置・同じ一覧の物差し', () => {
    const tree = recordTree(savedFrom(DRAFT_E2));
    const v = verdictOf(tree);
    expect(cls(v)).toContain('verdict--saved');
    expect(childIndex(v, 'ruler')).toBeGreaterThan(childIndex(v, 'verdict__stats'));
    expect(childIndex(v, 'reasons')).toBeGreaterThan(childIndex(v, 'ruler'));
    expect(all(rulerList(tree), (e) => e.type === 'li').map(text)).toEqual(E2_LIST);
  });
});

describe('AC-7: 詳細の 決済までの行動の答え（判定の枠の中、理由の下の札。Phase 4b の指摘 6）', () => {
  function taps(t: StoredTrade) {
    const tree = detailTree(t);
    const v = verdictOf(tree);
    // 判定の枠の中、理由（あれば）の後に名前つきの一覧
    const ul = one([v], (e) => e.type === 'ul' && e.props['aria-label'] === '決済までの行動の答え');
    expect(hasClass('taps')(ul)).toBe(true);
    const at = childIndex(v, 'taps');
    expect(at).toBeGreaterThan(childIndex(v, 'reasons'));
    expect(at).toBeGreaterThan(childIndex(v, 'ruler'));
    return all([ul], (e) => e.type === 'li');
  }
  /** 札に見える文字（短い問い。#131 のデザインレビュー a1）と、読み上げの文字（問いの全文 + 外れの印） */
  const shown = (e: El) => text(all([e], hasClass('taps__text')));
  const spoken = (e: El) => all([e], hasClass('sr-only')).map(text).join('');

  it('E2: 3 項目、札は短い問い（読み上げは問いの全文）、「広げた」だけに印・読み上げの「計画から外れた」（「外れ」の字は出さない）', () => {
    const li = taps(must('E2'));
    expect(li.map(shown)).toEqual(['LC: 決めていた', 'LC: 広げた（99.2）', '時間足: そのまま']);
    expect(li.map(spoken)).toEqual([
      'LC を入る前に決めていたか: 決めていた',
      'LC を動かしたか: 広げた（99.2）計画から外れた',
      '時間足を変えたか: そのまま',
    ]);
    // 見える短い問いは読み上げから外す（二重に読ませない）
    expect(all([li[0] as El], hasClass('taps__text'))[0]?.props['aria-hidden']).toBe('true');
    // 札ごとの「i」は置かない（#131 のデザインレビュー a1）
    expect(li.flatMap((e) => all([e], hasClass('info')))).toEqual([]);
    expect(li.map((e) => hasClass('taps__item--off')(e))).toEqual([false, true, false]);
    // 答えは語の途中で折らない塊（#58 デザインレビュー 2）
    expect(li.map((e) => text(all([e], hasClass('taps__a'))))).toEqual([
      '決めていた',
      '広げた（99.2）',
      'そのまま',
    ]);
    const off = li[1] as El;
    expect(all([off], hasClass('icon'))[0]?.props['aria-hidden']).toBe('true');
    // 「外れ」の字は出さない（記号と枠の太さで示す。#74 デザインレビュー）
    expect(all([off], hasClass('taps__off'))).toEqual([]);
    expect(all([off], hasClass('sr-only')).map(text).at(-1)).toBe('計画から外れた');
    // 外れの印の形は外れた札だけ（問いの説明の「i」の記号は数えない。#57）
    const shapes = (e: El) => all([e], (x) => hasClass('icon')(x) && !hasClass('info__icon')(x));
    expect([...shapes(li[0] as El), ...shapes(li[2] as El)]).toEqual([]);
  });

  it('E3（S）: L と同じ「広げた（150.8）」（#56）', () => {
    const li = taps(must('E3'));
    expect(shown(li[1] as El)).toBe('LC: 広げた（150.8）');
    expect(spoken(li[1] as El)).toBe('LC を動かしたか: 広げた（150.8）計画から外れた');
  });

  it('N1（LC なし）: 時間足の答えだけ', () => {
    expect(taps(N1).map(shown)).toEqual(['時間足: そのまま']);
  });

  it('チャートから時間足を変えたと判定された取引は、答えが「そのまま」でも印（D1。AC-7）', () => {
    expect(D1.record.timeframeChange).toBe('none');
    const li = taps(D1);
    expect(shown(li[2] as El)).toBe('時間足: 4 時間足 → 日足');
    expect(spoken(li[2] as El)).toBe('時間足を変えたか: 4 時間足 → 日足計画から外れた');
    expect(hasClass('taps__item--off')(li[2] as El)).toBe(true);
    // あなたの答えとの食い違いを 1 行で添える（チャートの足は札が言う。#131 のデザインレビュー a2。「申告」「判定に使用」の言い方は使わない）
    const v = verdictOf(detailTree(D1));
    expect(text(v)).toContain('あなたの答え: そのまま');
    expect(text(v)).not.toContain('／ チャート:');
    expect(text(v)).not.toContain('申告');
  });

  it('記録する画面・直す画面の判定の枠には札を出さない', () => {
    expect(all(recordTree(stateFor(DRAFT_E2, CAPITAL_1M)), hasClass('taps'))).toEqual([]);
  });
});

describe('直す画面のプレビューにも詳細と同じ物差し（Phase 4 の指摘 4）', () => {
  it.each(['E2', 'E4', 'E13'])('%s（E4・E13 は TP を保つ）', (id) => {
    const t = must(id);
    const ctx = editContext(t, INSTRUMENTS);
    const initial = draftFromStored(t, INSTRUMENTS);
    const read = readDraft(initial, ctx);
    expect(read.canSave).toBe(true);
    const merged = mergeEdit(
      t.record,
      initial,
      initial,
      read.body as NonNullable<typeof read.body>,
      t.record.instrumentId,
    );
    const preview = editPreview(read, merged, editSnapshot(read, ctx, initial));
    expect(preview.ruler).toBeDefined();
    expect(preview.ruler).toEqual(summarize(t).ruler);
  });
});

describe('LC を入る前に決めていない取引の物差し（Phase 4b の指摘 4）', () => {
  it('−1R の線は破線のクラス、目盛りは「−1R（後から）」、一覧は「後から決めた LC」', () => {
    const t = stored('r-late', { lcDecidedBeforeEntry: false, exit: exitAt(100.75) });
    const ruler = one(detailTree(t), hasClass('ruler'));
    const plot = one([ruler], hasClass('ruler__plot'));
    const bar = all([plot], hasClass('ruler__mark--bar'));
    expect(bar).toHaveLength(1);
    expect(hasClass('ruler__mark--late')(bar[0] as El)).toBe(true);
    expect(all([plot], hasClass('ruler__tick')).map(text)).toContain('−1R（後から）');
    expect(text(all([ruler], (e) => e.type === 'li')[0] as El)).toBe(
      '後から決めた LC 99.5（−1.0R）',
    );
  });

  it('入る前に決めていた取引は実線（late のクラスが無い）', () => {
    const plot = one(detailTree(must('E1')), hasClass('ruler__plot'));
    expect(all([plot], hasClass('ruler__mark--late'))).toEqual([]);
    expect(all([plot], hasClass('ruler__tick')).map(text)).toContain('−1R');
  });
});

describe('広げた後の LC は線の上側・広げた区間は破線の太線（Phase 4b の指摘 1・2）', () => {
  it('E2: ▽ は線より上（y が負の側だけ）で、決めた LC〜広げた後の LC に ruler__widen', () => {
    const plot = one(detailTree(must('E2')), hasClass('ruler__plot'));
    const tri = one([plot], hasClass('ruler__mark--triangleDown')).children[0] as El;
    const ys = [...String(tri.props.d).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    // d = M x y H x L x y Z → y は 2 番目と最後
    expect(ys[1]).toBeLessThan(0);
    expect(ys.at(-1)).toBeLessThan(0);
    expect(all([plot], hasClass('ruler__widen'))).toHaveLength(1);
    expect(all([plot], hasClass('ruler__over'))).toHaveLength(1);
  });

  it('E1（動かしていない）: 広げた区間は無い', () => {
    expect(all(detailTree(must('E1')), hasClass('ruler__widen'))).toEqual([]);
  });
});

describe('AC-8（#131 で次の画面に）: 「すべての欄」は押せる行 → 次の画面。行は今と同じ', () => {
  it.each([
    ['E2', must('E2')],
    ['N1', N1],
    ['D1', D1],
  ] as const)('%s', (_id, t) => {
    const tree = detailTree(t);
    // 詳細ではその場で開かない（折りたたみが無い）。押せる行で次の画面へ
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
    const row = one(
      tree,
      (e) => e.type === 'a' && hasClass('rowlink')(e) && text(e) === 'すべての欄',
    );
    expect(row.props.href).toBe(`/trades/${t.id}/fields`);
    expect(all(tree, hasClass('fields__row'))).toEqual([]);
    const page = expand(
      <TradeNotesView
        id={t.id}
        kind="fields"
        state={detailState(t)}
        hidden={EMPTY}
        notFound={notFoundState()}
        onReload={noop}
        onRelogin={noop}
      />,
    );
    const rows = all(page, hasClass('fields__row')).map((r) => ({
      label: text(one([r], hasClass('fields__label'))),
      value: text(one([r], hasClass('fields__value'))),
    }));
    expect(rows).toEqual(
      recordFields(t, 'US30', summarize(t).judgment).map((f) => ({
        label: f.label,
        value: f.value,
      })),
    );
    // 「記録した欄」の見出しは残さない
    expect(text(page)).not.toContain('記録した欄');
  });
});

describe('物差しの見出しと「i」（#57）', () => {
  it('物差しの上に見出し「LC の物差し」（読み上げは一覧の名前に任せる）と「「LC の物差し」の説明」のボタン', () => {
    const v = verdictOf(detailTree(D1));
    const ruler = one([v], hasClass('ruler'));
    const head = one([ruler], hasClass('ruler__head'));
    expect(ruler.children[0]).toBe(head);
    const label = head.children.find((n) => typeof n !== 'string' && n.type === 'span') as El;
    expect(label.props['aria-hidden']).toBe('true');
    expect(text(label)).toBe('LC の物差し');
    const b = one([head], (e) => e.type === 'button');
    expect(b.props['aria-label']).toBe('「LC の物差し」の説明');
    // N3（物差しが出ない取引。買い増し）には物差しの「i」も出ない
    const n3 = verdictOf(detailTree(N3));
    expect(all([n3], (e) => e.props['aria-label'] === '「LC の物差し」の説明')).toEqual([]);
  });
});

// ---- #231（設計書 C66）: 詳細の主役の物差し・図の文法・LC なしと LC の価格の無いオプションの形 ----

/** オプションのポジションの共有の fixture の P3（「最大損失まで」・レッグ 2 本。値は架空） */
function optionP3(): StoredTrade {
  const raw = JSON.parse(
    readFileSync(new URL('../fixtures/records/option-legs.json', import.meta.url), 'utf8'),
  ) as {
    items: { name: string; record: StoredTrade['record']; snapshot: StoredTrade['snapshot'] }[];
  };
  const p3 = raw.items.find((i) => i.name === 'P3');
  if (!p3) throw new Error('P3');
  return {
    id: 'r-p3',
    schemaVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    record: p3.record,
    snapshot: p3.snapshot,
  };
}

const segs = (tree: Node[]) =>
  all(tree, hasClass('ruler__seg')).map((e) => {
    const c = cls(e).split(' ');
    const kind = c.find(
      (x) => x.startsWith('ruler__') && x !== 'ruler__seg' && x !== 'ruler__breach',
    );
    return `${kind?.slice('ruler__'.length)}${c.includes('ruler__breach') ? '!' : ''}`;
  });

describe('#231 AC-1・KEEP-2: 詳細は物差しが数の段の前（記録する画面は今の順）', () => {
  it('E2（詳細）: 物差し → 数の段 → 理由 → 札', () => {
    const v = verdictOf(detailTree(must('E2')));
    const ruler = childIndex(v, 'ruler');
    expect(ruler).toBeGreaterThanOrEqual(0);
    expect(childIndex(v, 'verdict__stats')).toBeGreaterThan(ruler);
    expect(childIndex(v, 'reasons')).toBeGreaterThan(childIndex(v, 'verdict__stats'));
    expect(childIndex(v, 'taps')).toBeGreaterThan(childIndex(v, 'reasons'));
  });

  it('危ない勝ち（E10）: 崩れの文の後に物差し', () => {
    const v = verdictOf(detailTree(must('E10')));
    expect(childIndex(v, 'ruler')).toBeGreaterThan(childIndex(v, 'verdict__breach'));
    expect(childIndex(v, 'verdict__stats')).toBeGreaterThan(childIndex(v, 'ruler'));
  });

  it('記録する画面: 数の段 → 物差し（今のまま）', () => {
    const v = verdictOf(recordTree(stateFor(DRAFT_E2, CAPITAL_1M)));
    expect(childIndex(v, 'ruler')).toBeGreaterThan(childIndex(v, 'verdict__stats'));
  });
});

describe('#231 AC-2・AC-3: 図の文法（計画の帯・実行の線・崩れの区間）と段のクラス', () => {
  it.each([
    // [例, 段, 区間（! = 崩れの区間）]
    ['E1', 'plan', ['plan', 'exec']],
    ['E2', 'break', ['plan', 'exec', 'widen!', 'over!']],
    ['E3', 'break', ['plan', 'exec', 'widen!', 'over!']],
    ['E6', 'plan', ['plan', 'exec', 'over!']],
    ['E10', 'break', ['plan', 'exec', 'widen!']],
  ] as const)('%s: 段 %s・区間 %j', (id, tier, want) => {
    const tree = detailTree(must(id));
    const ruler = one(tree, hasClass('ruler'));
    expect(hasClass(`ruler--${tier}`)(ruler)).toBe(true);
    expect(segs(tree)).toEqual(want);
  });

  it('入る前に決めていない LC は計画の帯を描かない', () => {
    const t = stored('r-late2', { lcDecidedBeforeEntry: false, exit: exitAt(99.5) });
    expect(segs(detailTree(t))).toEqual(['exec']);
  });
});

describe('#231 AC-4: 広げた向きの矢印', () => {
  it.each(['E2', 'E3', 'E10'])('%s: 矢印の先が 1 つ・左（広げた後の LC の側）', (id) => {
    const arrows = all(detailTree(must(id)), hasClass('ruler__arrow'));
    expect(arrows).toHaveLength(1);
    expect(hasClass('ruler__arrow--left')(arrows[0] as El)).toBe(true);
  });

  it('E1（動かしていない）: 矢印なし', () => {
    expect(all(detailTree(must('E1')), hasClass('ruler__arrow'))).toEqual([]);
  });
});

describe('#231 AC-5: LC なし（N1）は価格の位置の図', () => {
  it('「LC なし」の印・R の目盛りなし・読み上げの一覧・イン〜決済が崩れの区間・極悪の段', () => {
    const tree = detailTree(N1);
    const ruler = one(tree, hasClass('ruler'));
    expect(hasClass('ruler--worst')(ruler)).toBe(true);
    expect(all([ruler], hasClass('ruler__tick')).map(text)).toEqual(['LC なし']);
    expect(all(rulerList(tree), (e) => e.type === 'li').map(text)).toEqual([
      'LC なし',
      '決済 99.2',
      'イン 100',
    ]);
    expect(segs(tree)).toEqual(['free!']);
    expect(all([ruler], hasClass('ruler__mark--none'))).toHaveLength(2); // 図と一覧の頭
    expect(one([ruler], hasClass('ruler__plot')).props['aria-hidden']).toBe('true');
  });
});

describe('#231 AC-6: 「最大損失まで」のオプションのポジションは −1R に「最大損失」', () => {
  it('P3: 一覧に「最大損失（−1.0R）」（価格なし）・題は原資産・目盛りは −1R 0 +1R', () => {
    const t = optionP3();
    const s = summarize(t);
    expect(s.option?.maxLossPlan).toBe(true);
    const tree = detailTree(t);
    const list = one(
      tree,
      (e) => e.type === 'ul' && e.props['aria-label'] === 'LC の物差し（原資産）',
    );
    const items = all([list], (e) => e.type === 'li').map(text);
    expect(items[0]).toBe('最大損失（−1.0R）');
    expect(items).toContain('イン 38,500');
    expect(items.some((i) => i.startsWith('決済 39,300（+0.8R）'))).toBe(true);
    const ruler = one(tree, hasClass('ruler'));
    expect(all([ruler], hasClass('ruler__tick')).map(text)).toEqual(['−1R', '0', '+1R']);
    expect(segs(tree)).toEqual(['plan', 'exec']);
  });

  it('R の出ないオプションのポジション（P3 から「最大損失まで」を外した LC なし）は図を出さない（ルール 6）', () => {
    const p3 = optionP3();
    const { riskPlan: _r, ...record } = p3.record;
    const t: StoredTrade = { ...p3, record };
    const s = summarize(t);
    expect(s.r).toBeUndefined();
    expect(s.noLc).toBe(true);
    expect(s.ruler).toBeUndefined();
    expect(all(detailTree(t), hasClass('ruler'))).toEqual([]);
  });
});
