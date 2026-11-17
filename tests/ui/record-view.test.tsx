// 記録する画面の描画 RecordView（Issue #13 契約 R-4・AC-5 ほか）。DOM のライブラリを使わず、部品の関数を呼んで
// 要素の木に展開して見る（RecordView と部品は hook を持たない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  AUTH_EXPIRED,
  LOAD_FAILED,
  type RecordState,
  SAVE_FAILED,
} from '../../ui/src/lib/record-controller';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  readDraft,
  summarize,
} from '../../ui/src/lib/record-form';
import { RecordView, type RecordViewProps } from '../../ui/src/pages/Record';
import {
  CAPITAL_1M,
  E1,
  E3,
  E4,
  E5,
  E6,
  E7,
  E8,
  E9,
  E10,
  E11,
  E16,
  E17,
  NO_CAPITAL,
} from './helpers/record-drafts';

interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

/** 部品（関数）を呼んで、要素（文字列の type）だけの木にする */
function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
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

function stateFor(draft: Draft, ctx: DraftContext, over: Partial<RecordState> = {}): RecordState {
  return {
    phase: 'editing',
    draft,
    instruments: ctx.instruments,
    settings: ctx.settings,
    read: readDraft(draft, ctx),
    error: null,
    ...over,
  };
}

function view(state: RecordState, over: Partial<RecordViewProps> = {}): Node[] {
  return expand(
    RecordView({
      state,
      onUpdate: noop,
      onSave: noop,
      onNext: noop,
      onReload: noop,
      onRelogin: noop,
      ...over,
    }),
  );
}

function badge(tree: Node[]): El {
  const b = all(tree, hasClass('badge'));
  expect(b).toHaveLength(1);
  return b[0] as El;
}

function verdictOf(tree: Node[]): El {
  const v = all(tree, hasClass('verdict'));
  expect(v).toHaveLength(1);
  return v[0] as El;
}

function submit(tree: Node[]): El {
  const b = all(tree, (e) => e.type === 'button' && e.props.type === 'submit');
  expect(b).toHaveLength(1);
  return b[0] as El;
}

describe('判定の段と数字の色（AC-5・C34）', () => {
  it('E1（B）・E3・E4（危ない勝ち）・E17（LC なしの勝ち）のバッジは同じ段の色・記号。文字は「B 悪い損失」/「危ない勝ち」', () => {
    const b1 = badge(view(stateFor(E1, NO_CAPITAL)));
    expect(cls(b1)).toBe('badge badge--break badge--lg');
    expect(text(b1)).toBe('B 悪い損失');
    for (const [d, ctx] of [
      [E3, NO_CAPITAL],
      [E4, CAPITAL_1M],
      [E17, NO_CAPITAL],
    ] as const) {
      const tree = view(stateFor(d, ctx));
      const b = badge(tree);
      expect(cls(b)).toBe(cls(b1));
      expect(text(b)).toBe('危ない勝ち');
      // 記号は段の形（三角）で同じ
      expect(JSON.stringify(b.children[0])).toBe(JSON.stringify(b1.children[0]));
      expect(cls(verdictOf(tree))).toContain('verdict--break');
      expect(text(tree)).toContain('勝っても、規律は崩れています。');
    }
    expect(cls(verdictOf(view(stateFor(E1, NO_CAPITAL))))).toContain('verdict--break');
  });

  it('R・円・% の数字の要素は num のクラスだけを持ち、段のクラス・バッジの中に入らない', () => {
    for (const [d, ctx] of [
      [E1, NO_CAPITAL],
      [E4, CAPITAL_1M],
    ] as const) {
      const tree = view(stateFor(d, ctx));
      const nums = all(tree, hasClass('num'));
      expect(nums.length).toBeGreaterThanOrEqual(1);
      for (const n of nums) expect(cls(n)).toMatch(/^num( num--(lg|xl))?$/);
      for (const b of all(tree, hasClass('badge'))) expect(all([b], hasClass('num'))).toEqual([]);
    }
    const e4 = text(all(view(stateFor(E4, CAPITAL_1M)), hasClass('num')));
    expect(e4).toContain('+1.0R');
    expect(e4).toContain('2.5%');
    expect(e4).toContain('+25,000円');
  });

  it('C（LC なしの負け）は極悪の段', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    expect(cls(badge(tree))).toBe('badge badge--worst badge--lg');
    expect(cls(verdictOf(tree))).toContain('verdict--worst');
  });
});

describe('結果の枠（判定・理由・R・リスク）', () => {
  it('E1: 理由と R、リスクの場所は「資金を設定すると出ます」', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons).toEqual([
      'LC を下げた（99.5 → 99.2）',
      '資金が未設定なので過剰リスクは見ていない',
    ]);
    expect(text(tree)).toContain('−1.6R');
    expect(text(tree)).toContain('資金を設定すると出ます');
  });

  it('E11: リスクの場所は「損益（円）を入れると出ます」', () => {
    expect(text(view(stateFor(E11, CAPITAL_1M)))).toContain('損益（円）を入れると出ます');
  });

  it('E16: R とリスクの場所は「LC が無いので出ません」', () => {
    const t = text(verdictOf(view(stateFor(E16, NO_CAPITAL))));
    expect(t.match(/LC が無いので出ません/g)).toHaveLength(2);
  });

  it('E5（S）: 理由と LC を動かしたかの選択肢は「上げた」', () => {
    const tree = view(stateFor(E5, NO_CAPITAL));
    expect(all(tree, hasClass('reasons__item')).map(text)).toContain('LC を上げた（150.5 → 151）');
    const labels = all(tree, hasClass('seg__item')).map(text);
    expect(labels).toContain('上げた');
    expect(labels).not.toContain('下げた');
    expect(text(tree)).toContain('上げた後の LC（任意）');
  });
});

describe('足りない欄と [記録する]（AC-2）', () => {
  it('E10: 判定なし（中立）・R は出る・[記録する] は押せず「時間足を変えたか」が足りない', () => {
    const tree = view(stateFor(E10, NO_CAPITAL));
    expect(cls(badge(tree))).toBe('badge badge--neutral badge--lg');
    expect(all(tree, hasClass('reasons__item'))).toEqual([]);
    expect(text(tree)).toContain('−1.6R');
    expect(submit(tree).props.disabled).toBe(true);
    const missing = all(tree, hasClass('record__missing'));
    expect(text(missing)).toBe('足りない欄: 時間足を変えたか');
    expect(missing[0]?.props['aria-live']).toBe('polite');
  });

  it('そろえば [記録する] を押せて、押すと onSave', () => {
    let saved = 0;
    const tree = view(stateFor(E1, NO_CAPITAL), {
      onSave: () => {
        saved++;
      },
    });
    expect(submit(tree).props.disabled).toBe(false);
    const form = all(tree, (e) => e.type === 'form')[0] as El;
    (form.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: noop });
    expect(saved).toBe(1);
  });

  it('保存中は入力の欄をまとめて止め、ボタンは「記録しています…」', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { phase: 'saving' }));
    expect(all(tree, (e) => e.type === 'fieldset')[0]?.props.disabled).toBe(true);
    expect(submit(tree).props.disabled).toBe(true);
    expect(text(submit(tree))).toBe('記録しています…');
  });
});

describe('入力の誤り（AC-7）', () => {
  it('E8: LC の欄に文言（aria-invalid・aria-describedby）。判定なし', () => {
    const tree = view(stateFor(E8, NO_CAPITAL));
    const input = all(tree, (e) => e.type === 'input' && e.props.id === 'record-lc')[0] as El;
    expect(input.props['aria-invalid']).toBe('true');
    expect(String(input.props['aria-describedby'])).toContain('record-lc-error');
    const err = all(tree, (e) => e.props.id === 'record-lc-error')[0] as El;
    expect(cls(err)).toBe('field__error');
    expect(text(err)).toBe('L の LC はインより下にしてください');
    expect(all(tree, hasClass('reasons__item'))).toEqual([]);
    expect(submit(tree).props.disabled).toBe(true);
  });
});

describe('入力の誤り（AC-7・E9）', () => {
  it('E9: 下げた後の LC の欄に文言。判定なし', () => {
    const tree = view(stateFor(E9, NO_CAPITAL));
    const err = all(tree, (e) => e.props.id === 'record-lc-after-error')[0] as El;
    expect(text(err)).toBe('下げた後の LC は、入る前の LC より下にしてください');
    expect(cls(badge(tree))).toBe('badge badge--neutral badge--lg');
    expect(submit(tree).props.disabled).toBe(true);
  });
});

describe('窓・滑りでしたか（AC-6）', () => {
  it('E6 では結果の枠の中に出て、E7 では出ない', () => {
    const e6 = view(stateFor(E6, NO_CAPITAL));
    const ask = all(e6, hasClass('verdict__ask'));
    expect(ask).toHaveLength(1);
    expect(all(ask, (e) => e.props.role === 'radiogroup')[0]?.props['aria-label']).toBe(
      '窓・滑りでしたか',
    );
    expect(all(view(stateFor(E7, NO_CAPITAL)), hasClass('verdict__ask'))).toEqual([]);
  });
});

describe('LC の「なし」', () => {
  it('E16: トグルは押した状態、LC の欄は止まる、決めていたか・動かしたかは出ない、時間足は出る', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    const toggle = all(tree, hasClass('lcnone'))[0] as El;
    expect(toggle.props['aria-pressed']).toBe('true');
    expect(toggle.props['aria-label']).toBe('LC を決めていなかった（なし）');
    const lc = all(tree, (e) => e.type === 'input' && e.props.id === 'record-lc')[0] as El;
    expect(lc.props.disabled).toBe(true);
    const groups = all(tree, (e) => e.props.role === 'radiogroup').map(
      (e) => e.props['aria-label'],
    );
    expect(groups).not.toContain('LC を入る前に決めていたか');
    expect(groups).not.toContain('LC を動かしたか');
    expect(groups).toContain('時間足を変えたか');
  });

  it('トグルを押すと「なし」を切り替える', () => {
    const got: unknown[] = [];
    const tree = view(stateFor(E1, NO_CAPITAL), { onUpdate: (a) => got.push(a) });
    const toggle = all(tree, hasClass('lcnone'))[0] as El;
    expect(toggle.props['aria-pressed']).toBe('false');
    (toggle.props.onClick as () => void)();
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: true }]);
  });
});

describe('失敗の文言（AC-10）', () => {
  it('保存の失敗は role="alert" の決まった文言、入力の欄は残る', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { error: SAVE_FAILED }));
    const alert = all(tree, (e) => e.props.role === 'alert');
    expect(alert.map(text)).toEqual([SAVE_FAILED]);
    expect(all(tree, (e) => e.type === 'input' && e.props.id === 'record-entry')).toHaveLength(1);
  });

  it('読み込みの失敗は文言と [もう一度読み込む]、入力の欄は出さない', () => {
    let reloaded = 0;
    const tree = view(stateFor(E1, NO_CAPITAL, { phase: 'loadFailed', error: LOAD_FAILED }), {
      onReload: () => {
        reloaded++;
      },
    });
    expect(text(all(tree, (e) => e.props.role === 'alert'))).toBe(LOAD_FAILED);
    expect(all(tree, (e) => e.type === 'input')).toEqual([]);
    const btn = all(tree, (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('もう一度読み込む');
    (btn.props.onClick as () => void)();
    expect(reloaded).toBe(1);
  });

  it('読み込み中は「読み込み中…」だけ', () => {
    expect(text(view(stateFor(E1, NO_CAPITAL, { phase: 'loading' })))).toBe('読み込み中…');
  });
});

describe('保存の後', () => {
  function savedState(): RecordState {
    const read = readDraft(E1, NO_CAPITAL);
    const trade: StoredTrade = {
      id: 'trade-1',
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
        capitalYen: null,
        riskTolerancePct: 1,
      },
      record: { ...(read.body as NonNullable<typeof read.body>), instrumentId: 'inst-us30' },
    };
    return stateFor(E1, NO_CAPITAL, {
      phase: 'saved',
      saved: { trade, instrumentName: 'US30', summary: summarize(trade) },
    });
  }

  it('「記録しました」と判定・理由・R を大きく出し、入力の欄は閉じる。[次の取引を記録] で onNext', () => {
    let next = 0;
    const tree = view(savedState(), {
      onNext: () => {
        next++;
      },
    });
    const v = verdictOf(tree);
    expect(cls(v)).toContain('verdict--saved');
    expect(cls(v)).toContain('verdict--break');
    expect(text(all(tree, (e) => e.props.role === 'status'))).toBe('記録しました');
    expect(text(badge(tree))).toBe('B 悪い損失');
    expect(all(tree, hasClass('reasons__item')).map(text)).toContain('LC を下げた（99.5 → 99.2）');
    expect(text(all(tree, hasClass('num--xl')))).toBe('−1.6R');
    expect(text(tree)).toContain('US30 · L ロング · イン 100 → 決済 99.2 · 数量 10000');
    expect(all(tree, (e) => e.type === 'input')).toEqual([]);
    const btn = all(tree, (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('次の取引を記録');
    (btn.props.onClick as () => void)();
    expect(next).toBe(1);
  });
});

describe('畳んだ欄の誤り（レビュー指摘 1）', () => {
  it('手数料に誤り → 「ほかの欄」を開き、ボタンの上に「誤りのある欄: 手数料（円）」、結果の枠は誤りを直す案内', () => {
    const d = applyDraft(E1, { type: 'set', field: 'feeYen', value: 'x' });
    const tree = view(stateFor(d, NO_CAPITAL));
    const details = all(tree, (e) => e.type === 'details')[0] as El;
    expect(details.props.open).toBe(true);
    expect(text(all(tree, hasClass('record__missing')))).toBe('誤りのある欄: 手数料（円）');
    expect(text(verdictOf(tree))).toContain('誤りのある欄を直すと、判定と理由が出ます。');
    expect(text(verdictOf(tree))).toContain('誤りを直すと出ます');
    expect(submit(tree).props.disabled).toBe(true);
  });

  it('誤りが無ければ「ほかの欄」は閉じたまま。誤りと足りない欄は両方並べる', () => {
    const closed = all(view(stateFor(E1, NO_CAPITAL)), (e) => e.type === 'details')[0] as El;
    expect(closed.props.open).toBeUndefined();
    const both = applyDraft(E10, { type: 'set', field: 'entryTime', value: '2026-03-04T11:00' });
    expect(text(all(view(stateFor(both, NO_CAPITAL)), hasClass('record__missing')))).toBe(
      '誤りのある欄: 建てた時刻 / 足りない欄: 時間足を変えたか',
    );
  });
});

describe('ログインが切れた（レビュー指摘 4）', () => {
  it('保存で 401 → 決まった文言と [ログインし直す]（onRelogin）', () => {
    let relogin = 0;
    const tree = view(stateFor(E1, NO_CAPITAL, { error: AUTH_EXPIRED, errorKind: 'auth' }), {
      onRelogin: () => {
        relogin++;
      },
    });
    const alert = all(tree, (e) => e.props.role === 'alert')[0] as El;
    expect(text(alert)).toContain(AUTH_EXPIRED);
    const btn = all([alert], (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('ログインし直す');
    (btn.props.onClick as () => void)();
    expect(relogin).toBe(1);
  });

  it('読み込みで 401 → [もう一度読み込む] ではなく [ログインし直す]', () => {
    const tree = view(
      stateFor(E1, NO_CAPITAL, { phase: 'loadFailed', error: AUTH_EXPIRED, errorKind: 'auth' }),
    );
    expect(all(tree, (e) => e.type === 'button').map(text)).toEqual(['ログインし直す']);
  });
});

describe('作りの約束（P8・P11）', () => {
  it('style 属性を持たず、欄にはすべて label がある', () => {
    for (const d of [E1, E6, E16, applyDraft(E1, { type: 'set', field: 'side', value: 'S' })]) {
      const tree = view(stateFor(d, CAPITAL_1M));
      expect(all(tree, (e) => 'style' in e.props)).toEqual([]);
      const ids = new Set(
        all(tree, (e) => e.type === 'label' && typeof e.props.for === 'string').map(
          (e) => e.props.for,
        ),
      );
      for (const input of all(
        tree,
        (e) => (e.type === 'input' && e.props.type !== 'radio') || e.type === 'select',
      )) {
        expect(ids.has(input.props.id), String(input.props.id)).toBe(true);
      }
    }
  });
});
