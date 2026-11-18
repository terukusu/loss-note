// LC の物差し・詳細の 3 つのタップの答え・「すべての欄」の描画（Issue #34 AC-2・AC-4〜AC-8・契約 U-1・U-2）。
// DOM のライブラリを使わず、部品の関数を呼んで要素の木に展開して見る（trade-screens-view.test.tsx と同じ道具）。値はすべて架空
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
  '動かした LC 99.2（−1.6R）',
  '決済 99.2（−1.6R）',
  '決めた LC 99.5（−1.0R）',
  'イン 100',
  'LC を 0.6R 越えて決済',
];

/** 判定の枠の文字から 3 つのタップの答えの札と添え書きを除く（詳細だけにある。物差しの前からの中身と比べるため） */
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

describe('AC-2: N1〜N4 で物差しの段が無く、ほかの中身は同じ', () => {
  it.each([
    ['N1', N1],
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

  it('N1（記録する画面）: LC なしは判定が出ても物差しが無い', () => {
    const st = stateFor(DRAFT_NO_LC, CAPITAL_1M);
    expect(st.read.preview.judgment).toBeDefined();
    const tree = recordTree(st);
    expect(all([verdictOf(tree)], hasClass('ruler'))).toEqual([]);
  });

  it('N4（記録する画面）: 足りない欄がある間は物差しが無く、判定の枠の文字は物差しを足す前と同じ', () => {
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

describe('AC-7: 詳細の 3 つのタップの答え（判定の枠の中、理由の下の札。Phase 4b の指摘 6）', () => {
  function taps(t: StoredTrade) {
    const tree = detailTree(t);
    const v = verdictOf(tree);
    // 判定の枠の中、理由（あれば）の後に名前つきの一覧
    const ul = one([v], (e) => e.type === 'ul' && e.props['aria-label'] === '3 つのタップの答え');
    expect(hasClass('taps')(ul)).toBe(true);
    const at = childIndex(v, 'taps');
    expect(at).toBeGreaterThan(childIndex(v, 'reasons'));
    expect(at).toBeGreaterThan(childIndex(v, 'ruler'));
    return all([ul], (e) => e.type === 'li');
  }

  it('E2: 3 項目、「下げた」だけに印・「外れ」の文字と読み上げの「計画から外れた」', () => {
    const li = taps(must('E2'));
    expect(li.map(text)).toEqual([
      'LC を入る前に: 決めていた',
      '外れLC: 下げた（99.2）計画から外れた',
      '時間足: 変えず',
    ]);
    expect(li.map((e) => hasClass('taps__item--off')(e))).toEqual([false, true, false]);
    const off = li[1] as El;
    expect(all([off], hasClass('icon'))[0]?.props['aria-hidden']).toBe('true');
    expect(one([off], hasClass('taps__off')).props['aria-hidden']).toBe('true');
    expect(text(one([off], hasClass('sr-only')))).toBe('計画から外れた');
    // 外れの印の形は外れた札だけ（問いの説明の「i」の記号は数えない。#57）
    const shapes = (e: El) => all([e], (x) => hasClass('icon')(x) && !hasClass('info__icon')(x));
    expect([...shapes(li[0] as El), ...shapes(li[2] as El)]).toEqual([]);
  });

  it('E3（S）: 「上げた（150.8）」', () => {
    expect(taps(must('E3')).map(text)[1]).toBe('外れLC: 上げた（150.8）計画から外れた');
  });

  it('N1（LC なし）: 時間足の答えだけ', () => {
    expect(taps(N1).map(text)).toEqual(['時間足: 変えず']);
  });

  it('チャートから時間足を変えたと判定された取引は、答えが「変えず」でも印（D1。AC-7）', () => {
    expect(D1.record.timeframeChange).toBe('none');
    const li = taps(D1);
    expect(text(li[2] as El)).toBe('外れ時間足: 4 時間足 → 日足計画から外れた');
    expect(hasClass('taps__item--off')(li[2] as El)).toBe(true);
    // あなたの答えとの食い違いを 1 行で添える（「申告」「判定に使用」の言い方は使わない）
    const v = verdictOf(detailTree(D1));
    expect(text(v)).toContain('あなたの答えは「変えず」、チャートは 4 時間足 → 日足');
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
  it('−1R の線は破線のクラス、目盛りは「−1R（後から）」、一覧は「LC（入った後）」', () => {
    const t = stored('r-late', { lcDecidedBeforeEntry: false, exit: exitAt(100.75) });
    const ruler = one(detailTree(t), hasClass('ruler'));
    const plot = one([ruler], hasClass('ruler__plot'));
    const bar = all([plot], hasClass('ruler__mark--bar'));
    expect(bar).toHaveLength(1);
    expect(hasClass('ruler__mark--late')(bar[0] as El)).toBe(true);
    expect(all([plot], hasClass('ruler__tick')).map(text)).toContain('−1R（後から）');
    expect(text(all([ruler], (e) => e.type === 'li')[0] as El)).toBe(
      'LC（入った後） 99.5（−1.0R）',
    );
  });

  it('入る前に決めていた取引は実線（late のクラスが無い）', () => {
    const plot = one(detailTree(must('E1')), hasClass('ruler__plot'));
    expect(all([plot], hasClass('ruler__mark--late'))).toEqual([]);
    expect(all([plot], hasClass('ruler__tick')).map(text)).toContain('−1R');
  });
});

describe('動かした LC は線の上側・広げた区間は破線の太線（Phase 4b の指摘 1・2）', () => {
  it('E2: ▽ は線より上（y が負の側だけ）で、決めた LC〜動かした LC に ruler__widen', () => {
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

describe('AC-8: 「すべての欄」は既定で閉じ、行は今と同じ', () => {
  it.each([
    ['E2', must('E2')],
    ['N1', N1],
    ['D1', D1],
  ] as const)('%s', (_id, t) => {
    const tree = detailTree(t);
    const d = one(tree, (e) => e.type === 'details' && hasClass('more')(e));
    expect(d.props.open).toBeUndefined();
    expect(hasClass('card')(d)).toBe(true);
    const summary = one([d], (e) => e.type === 'summary');
    expect(text(summary)).toBe('すべての欄');
    expect(hasClass('more__summary')(summary)).toBe(true);
    const rows = all([d], hasClass('fields__row')).map((r) => ({
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
    expect(text(tree)).not.toContain('記録した欄');
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
    // N1（物差しが出ない取引）には物差しの「i」も出ない
    const n1 = verdictOf(detailTree(N1));
    expect(all([n1], (e) => e.props['aria-label'] === '「LC の物差し」の説明')).toEqual([]);
  });
});
