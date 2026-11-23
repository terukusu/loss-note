// 欄の名前の段の形（#210。NumberField の #207 と同じ）。TextField・AccountField（select）・Segment は、「i」（info）・
// 印（mark）・添え（note）・誤り（error）の有無で `.field` の先頭の子（名前の段 div.field__head）と、欄の要素
// （input・select・radio）に至る道を変えない。形が変わると Preact が後ろの要素を作り直し、フォーカスが外れる。
// DOM は使わず部品の関数の返す木を見る（tests/ui/number-field.test.tsx と同じ形）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { AccountRecord } from '../../core/record';
import { AccountField, type AccountFieldProps } from '../../ui/src/components/AccountField';
import { Segment, type SegmentProps } from '../../ui/src/components/Segment';
import { TextField, type TextFieldProps } from '../../ui/src/components/TextField';

type El = VNode<Record<string, unknown> & { children?: unknown }>;

const kids = (v: El): unknown[] => {
  const c = v.props.children;
  return Array.isArray(c) ? c : [c];
};
const isEl = (x: unknown): x is El => typeof x === 'object' && x !== null && 'type' in x;
const shapeOf = (v: El) =>
  kids(v).map((c) =>
    isEl(c) && typeof c.type === 'string' ? `${c.type}.${c.props.class ?? ''}` : '-',
  );

/** 根から、条件に合う最初の要素までの道（何番目の子か・その要素の型） */
function pathTo(root: El, hit: (v: El) => boolean): string[] {
  const walk = (v: El, at: string[]): string[] | null => {
    if (hit(v)) return at;
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
  if (!got) throw new Error('欄の要素が無い');
  return got;
}

/** 2 つの値の組み合わせをすべて並べる */
function combos<P>(base: P, parts: Record<string, Partial<P>>): [string, P][] {
  const keys = Object.keys(parts);
  const out: [string, P][] = [];
  for (let m = 0; m < 1 << keys.length; m++) {
    let p = { ...base };
    const on: string[] = [];
    keys.forEach((k, i) => {
      if (m & (1 << i)) {
        p = { ...p, ...parts[k] };
        on.push(k);
      }
    });
    out.push([on.join('+') || 'なし', p]);
  }
  return out;
}

function expectStable<P>(
  name: string,
  render: (p: P) => El,
  states: [string, P][],
  hit: (v: El) => boolean,
  second: string,
) {
  describe(name, () => {
    const first = states[0] as [string, P];
    const want = pathTo(render(first[1]), hit);
    it.each(states)('%s: 先頭の子は名前の段 div.field__head、欄に至る道が同じ', (_, p) => {
      const tree = render(p);
      const s = shapeOf(tree);
      expect(s[0]).toBe('div.field__head');
      expect(s[1]?.startsWith(second)).toBe(true);
      expect(pathTo(tree, hit)).toEqual(want);
    });
  });
}

const text: TextFieldProps = { id: 'leg-expiry', label: '限月', value: '', onInput: () => {} };
expectStable(
  '#210: TextField の形は印・誤り・説明の有無で変わらない',
  (p: TextFieldProps) => TextField(p) as El,
  combos(text, {
    mark: { mark: '読み取り' },
    error: { error: '限月を入れてください' },
    hint: { hint: '202701 の形' },
  }),
  (v) => v.type === 'input' && v.props.id === 'leg-expiry',
  'div.numfield',
);

const account = (id: string, name: string): AccountRecord => ({
  id,
  name,
  currency: 'JPY',
  capitalYen: null,
  riskTolerancePct: 1,
  capitalHistory: [],
  createdAt: 0,
  updatedAt: 0,
});
const accounts = ['a', 'b', 'c', 'd'].map((x) => account(x, `口座 ${x}`));
const acc: AccountFieldProps = { accounts, value: 'a', onChange: () => {} };
expectStable(
  '#210: AccountField（4 つ以上 = select）の形は「自動で選択」・下の 1 行の有無で変わらない',
  (p: AccountFieldProps) => AccountField(p) as El,
  combos(acc, { mark: { mark: '自動で選択' }, hint: { hint: '口座を替えました' } }),
  (v) => v.type === 'select',
  'select.select',
);

const seg: SegmentProps<'L' | 'S'> = {
  label: '向き',
  options: [
    { value: 'L', label: 'L' },
    { value: 'S', label: 'S' },
  ],
  value: 'L',
  onChange: () => {},
  id: 'record-side',
};
const info = <button type="button" class="infotip" aria-label="説明" />;
const segStates = combos(seg, {
  mark: { mark: '読み取り' },
  info: { info },
  note: { note: '選択中: L' },
});
expectStable(
  '#210: Segment の形は「i」・印・添えの有無で変わらない',
  (p: SegmentProps<'L' | 'S'>) => Segment(p) as El,
  segStates,
  (v) => v.type === 'input' && v.props.value === 'S',
  'div.seg',
);
expectStable(
  '#210: 見出しを見せない Segment も同じ形（何も無い名前の段は CSS の :empty で隠す）',
  (p: SegmentProps<'L' | 'S'>) => Segment(p) as El,
  segStates.map(([n, p]) => [n, { ...p, showLabel: false }] as [string, SegmentProps<'L' | 'S'>]),
  (v) => v.type === 'input' && v.props.value === 'S',
  'div.seg',
);

describe('#210: 見出しを見せず何も無い Segment の名前の段は空（:empty で隠れる）', () => {
  it('子はすべて null', () => {
    const head = kids(Segment({ ...seg, showLabel: false }) as El)[0] as El;
    expect(kids(head).every((c) => c == null)).toBe(true);
  });
  it('見出しを見せる Segment の名前の段の先頭は見出し', () => {
    const head = kids(Segment(seg) as El)[0] as El;
    expect(shapeOf(head)[0]).toBe('span.field__label');
  });
});
