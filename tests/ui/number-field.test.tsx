// 数値の欄 NumberField の要素の形（#207）。「i」（info）・印（mark）・止めた欄（locked）・誤り（error）の有無で、`.field` の
// 先頭の子（名前の段）と、欄の input に至る道（何番目の子が何の要素か）を変えない。形が変わると Preact が後ろの要素を
// 流用し直して input を作り直し、止めた欄を外す click の focus() が外された要素に当たってフォーカスが外れる
// （LC の「なし」→ 欄を押す で、「逆指値 未設定」の「i」が出入りしていた）。DOM は使わず部品の関数の返す木を見る
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { NumberField, type NumberFieldProps } from '../../ui/src/components/NumberField';

type El = VNode<Record<string, unknown> & { children?: unknown }>;

const kids = (v: El): unknown[] => {
  const c = v.props.children;
  return Array.isArray(c) ? c : [c];
};
const isEl = (x: unknown): x is El => typeof x === 'object' && x !== null && 'type' in x;
/** 子の並びの形（要素の型と class。null・文字は '-'） */
const shapeOf = (v: El) =>
  kids(v).map((c) =>
    isEl(c) && typeof c.type === 'string' ? `${c.type}.${c.props.class ?? ''}` : '-',
  );
const sig = (c: unknown) =>
  isEl(c) ? (typeof c.type === 'string' ? `${c.type}` : 'component') : c == null ? 'null' : 'text';

/** `.field` から input までの道（何番目の子か・その要素の型） */
function pathToInput(root: El, id: string): string[] {
  const walk = (v: El, at: string[]): string[] | null => {
    if (v.type === 'input' && v.props.id === id) return at;
    const cs = kids(v);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!isEl(c) || typeof c.type !== 'string') continue;
      const got = walk(c, [...at, `${i}:${c.type}`]);
      if (got) return got;
    }
    return null;
  };
  const got = walk(root, []);
  if (!got) throw new Error('input が無い');
  return got;
}

const base: NumberFieldProps = {
  id: 'record-lc',
  label: '入る前に決めた LC',
  value: '',
  onInput: () => {},
  size: 'lg',
  hint: '思惑が外れたと確認できる価格',
};
const lock = { note: 'なし を選んでいます。押すと価格を入れられます', onUnlock: () => {} };
const info = <button type="button" class="infotip" aria-label="説明" />;

/** LC の欄が取りうる組み合わせ（「なし」で止めた = locked・「i」なし / 外した = 「i」あり、に印・誤りを掛ける） */
const states: [string, NumberFieldProps][] = [];
for (const lk of [false, true])
  for (const inf of [false, true])
    for (const mk of [false, true])
      for (const er of [false, true])
        states.push([
          `locked=${lk} info=${inf} mark=${mk} error=${er}`,
          {
            ...base,
            ...(lk ? { locked: lock } : {}),
            ...(inf ? { info } : {}),
            ...(mk ? { mark: '読み取り' } : {}),
            ...(er ? { error: '価格を入れてください' } : {}),
          },
        ]);

describe('#207: NumberField の形は「i」・印・止めた欄の有無で変わらない', () => {
  const [, first] = states[0] as [string, NumberFieldProps];
  const want = pathToInput(NumberField(first) as El, 'record-lc');
  const head = kids(NumberField(first) as El).map(sig);

  it.each(states)('%s: 先頭の子は名前の段 div.field__head、2 番目は欄の div.numfield', (_, p) => {
    const tree = NumberField(p) as El;
    const s = shapeOf(tree);
    expect(s[0]).toBe('div.field__head');
    expect(s[1]?.startsWith('div.numfield')).toBe(true);
  });

  it.each(states)('%s: input に至る道が同じ（Preact が input を作り直さない）', (_, p) => {
    const tree = NumberField(p) as El;
    expect(pathToInput(tree, 'record-lc')).toEqual(want);
    // 欄より前の子の並び（型）が同じ = 突き合わせの位置がずれない
    expect(kids(tree).map(sig).slice(0, 2)).toEqual(head.slice(0, 2));
  });

  it('「なし」で止めた欄（i なし）→ 外した欄（i あり）の移りで、名前の段の中に「i」が足されるだけ', () => {
    const locked = NumberField({ ...base, locked: lock }) as El;
    const open = NumberField({ ...base, info }) as El;
    const headOf = (t: El) => kids(t)[0] as El;
    expect(shapeOf(headOf(locked))[0]).toBe('label.field__label');
    expect(shapeOf(headOf(open))[0]).toBe('label.field__label');
    expect(kids(headOf(open))).toContain(info);
    expect(kids(headOf(locked))).not.toContain(info);
  });
});
