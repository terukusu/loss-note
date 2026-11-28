// シートの中の続けて入れる欄の決定キー（#174。Issue の例の表 #1〜#6・#9・#10）。純関数 enterChain / enterPropsOf と、取引の欄・
// ほかの欄・足・広げた後の LC の部品の木。DOM のライブラリを使わず、部品の関数を呼んで要素の木に展開して見る。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { LegEditor } from '../../ui/src/components/LegEditor';
import {
  LcFields,
  NEW_MULTIPLIER_ID,
  TapFields,
  TradeCoreFields,
  type TradeFieldsProps,
  TradeMoreBody,
} from '../../ui/src/components/TradeFields';
import { ENTER_DONE, enterChain, enterPropsOf } from '../../ui/src/lib/enter-chain';
import { EMPTY_LEG } from '../../ui/src/lib/legs-form';
import { applyDraft, type Draft, type DraftReading, readDraft } from '../../ui/src/lib/record-form';
import { checkChain, pressEnter } from './helpers/enter-chain';
import { closedInfoTip } from './helpers/info-tip';
import { E1, NO_CAPITAL } from './helpers/record-drafts';

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

const inputs = (tree: Node[]) => all(tree, (e) => e.type === 'input');
const finder = (tree: Node[]) => (id: string) => inputs(tree).find((e) => e.props.id === id);
const noop = () => {};

function props(d: Draft, over: Partial<TradeFieldsProps> = {}): TradeFieldsProps {
  const read = readDraft(d, NO_CAPITAL);
  return {
    draft: d,
    errors: read.errors,
    instruments: NO_CAPITAL.instruments,
    marks: {},
    onUpdate: noop,
    ...over,
  };
}

/** オプションのポジションの読みの最小の形（部品が見る欄だけ。値は架空） */
function optionReading(over: Partial<NonNullable<DraftReading['option']>> = {}) {
  return {
    legErrors: [],
    askSide: false,
    maxLossSelectable: false,
    lossPlanUp: false,
    ...over,
  } as unknown as NonNullable<DraftReading['option']>;
}

describe('並びの純関数（#174）', () => {
  it('途中は次へ（次の ID）・最後は完了。偽の欄（表示しない欄）は落とし、重ねた ID は最初の位置', () => {
    const c = enterChain(['a', false, 'b', null, undefined, '', 'c', 'b']);
    expect([...c.entries()]).toEqual([
      ['a', { hint: 'next', next: 'b' }],
      ['b', { hint: 'next', next: 'c' }],
      ['c', { hint: 'done', next: null }],
    ]);
    expect([...enterChain([]).entries()]).toEqual([]);
    expect([...enterChain(['only']).entries()]).toEqual([['only', { hint: 'done', next: null }]]);
  });

  it('enterPropsOf: 並びに無い ID は何も渡さない（端末の既定）。最後は ENTER_DONE。次の欄が無くなっていたら外す', () => {
    const c = enterChain(['a', 'b']);
    expect(enterPropsOf(c, 'x')).toEqual({});
    expect(enterPropsOf(c, 'b')).toBe(ENTER_DONE);
    const a = enterPropsOf(c, 'a') as typeof ENTER_DONE;
    expect(a.enterKeyHint).toBe('next');
    let blurred = 0;
    const focused: string[] = [];
    a.onEnter({
      ownerDocument: { getElementById: () => null },
      blur: () => {
        blurred++;
      },
    });
    expect(blurred).toBe(1);
    a.onEnter({
      ownerDocument: { getElementById: (id) => ({ focus: () => focused.push(id) }) },
      blur: () => {
        blurred++;
      },
    });
    expect(focused).toEqual(['b']);
    expect(blurred).toBe(1);
  });
});

describe('取引の欄のシート（記録する・編集で共有。#174 の例の表 #1〜#3・#9・#10）', () => {
  it('#1 通貨が口座と同じ: 銘柄 → 数量 → イン → 決済（完了）。口座・L / S は飛ばす', () => {
    const tree = expand(<TradeCoreFields {...props(E1)} />);
    checkChain(finder(tree), [
      'record-instrument',
      'record-quantity',
      'record-entry',
      'record-exit',
    ]);
  });

  it('#2 通貨が違う: 決済 → 為替（完了）', () => {
    const tree = expand(
      <TradeCoreFields
        {...props(E1, {
          currency: { fx: { unit: '円', line: '1 USD = ? 円' }, moneyUnit: '円' },
        })}
      />,
    );
    checkChain(finder(tree), [
      'record-instrument',
      'record-quantity',
      'record-entry',
      'record-exit',
      'record-fx',
    ]);
  });

  it('#3 オプション・明細の銘柄が一覧に無い: 銘柄 → 乗数 → イン（原資産）→ 決済（原資産）。数量の欄は無い', () => {
    const tree = expand(
      <TradeCoreFields
        {...props(E1, {
          option: {
            reading: optionReading({ newInstrument: '架空指数オプション' }),
            onOpenLeg: noop,
            onAddLeg: noop,
          },
        })}
      />,
    );
    expect(finder(tree)('record-quantity')).toBeUndefined();
    checkChain(finder(tree), [
      'record-instrument',
      NEW_MULTIPLIER_ID,
      'record-entry',
      'record-exit',
    ]);
    // 銘柄が一覧にあれば乗数の欄は無く、銘柄 → イン
    const known = expand(
      <TradeCoreFields
        {...props(E1, {
          option: { reading: optionReading(), onOpenLeg: noop, onAddLeg: noop },
        })}
      />,
    );
    checkChain(finder(known), ['record-instrument', 'record-entry', 'record-exit']);
  });

  it('#9 エントリー / 決済の時刻（日時の欄）は並びに入らず、Enter はフォーカスを外すだけ（フォームを送らない）', () => {
    const tree = expand(<TradeCoreFields {...props(E1)} />);
    for (const id of ['record-entry-time', 'record-exit-time']) {
      const el = finder(tree)(id) as El;
      expect(el.props.type).toBe('datetime-local');
      expect(el.props.enterKeyHint).toBe('done');
      expect(pressEnter(el)).toEqual({ focused: [], blurred: 1, prevented: true });
      expect(pressEnter(el, { isComposing: true })).toEqual({
        focused: [],
        blurred: 0,
        prevented: false,
      });
    }
  });

  it('#10 変換中の Enter（isComposing・keyCode 229）は数量から動かない（checkChain の中でも全欄で見る）', () => {
    const q = finder(expand(<TradeCoreFields {...props(E1)} />))('record-quantity') as El;
    expect(pressEnter(q, { isComposing: true }).focused).toEqual([]);
    expect(pressEnter(q, { keyCode: 229 }).focused).toEqual([]);
  });
});

describe('ほかの欄（#174 の例の表 #4）', () => {
  it('損益 → 手数料（完了）。LC の根拠・決済の理由は飛ばす', () => {
    checkChain(finder(expand(<TradeMoreBody {...props(E1)} />)), ['record-pnl', 'record-fee']);
  });

  it('オプションで損失の見込みがここにあるとき: 手数料 → 損失の見込み（完了）', () => {
    const tree = expand(
      <TradeMoreBody
        {...props(E1, { option: { reading: optionReading(), onOpenLeg: noop, onAddLeg: noop } })}
      />,
    );
    checkChain(finder(tree), ['record-pnl', 'record-fee', 'record-loss-plan']);
  });
});

describe('LC の並び（#172 を並びの宣言にそろえた。KEEP-1）', () => {
  it('LC → 根拠が崩れる条件（完了）。オプションで損失の見込みが LC の枠にあれば LC → 見込み → 条件', () => {
    checkChain(finder(expand(<LcFields {...props(E1)} />)), ['record-lc', 'record-broken']);
    const tree = expand(
      <LcFields
        {...props(E1, {
          option: {
            reading: optionReading({ lossPlanUp: true }),
            onOpenLeg: noop,
            onAddLeg: noop,
          },
        })}
      />,
    );
    checkChain(finder(tree), ['record-lc', 'record-loss-plan', 'record-broken']);
  });
});

describe('広げた後の LC（#174 の例の表 #6）', () => {
  it('1 つだけの並び: 完了でフォーカスを外す', () => {
    const d = applyDraft(E1, { type: 'set', field: 'lcMove', value: 'widened' });
    checkChain(finder(expand(<TapFields {...props(d)} />)), ['record-lc-after']);
  });
});

describe('足（#174 の例の表 #5）', () => {
  it('限月 → 行使価格 → 枚数 → イン → 決済（完了）。P / C・買い / 売り・満期で消滅は飛ばす', () => {
    const tree = expand(
      <LegEditor
        leg={{ ...EMPTY_LEG, contractMonth: '2027-01' }}
        index={1}
        onChange={noop}
        onRemove={noop}
      />,
    );
    checkChain(finder(tree), [
      'leg-1-month',
      'leg-1-strike',
      'leg-1-qty',
      'leg-1-entry',
      'leg-1-exit',
    ]);
  });
});
