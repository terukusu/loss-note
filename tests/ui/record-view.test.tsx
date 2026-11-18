// 記録する画面の描画 RecordView（Issue #13 契約 R-4・AC-5 ほか）。DOM のライブラリを使わず、部品の関数を呼んで
// 要素の木に展開して見る（RecordView と部品は hook を持たない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { CHART_READ_MARK, CHART_READ_MSG, CHART_READ_NOTICE } from '../../ui/src/lib/chart-read';
import {
  type AddAccountState,
  AUTH_EXPIRED,
  LOAD_FAILED,
  type RecordState,
  SAVE_FAILED,
  type StatementState,
} from '../../ui/src/lib/record-controller';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  readDraft,
  summarize,
} from '../../ui/src/lib/record-form';
import { fillFromRow, gateReading, READ_MSG } from '../../ui/src/lib/statement-fill';
import {
  Record as RecordPage,
  RecordView,
  type RecordViewProps,
  STATEMENT_NOTICE,
} from '../../ui/src/pages/Record';
import { account, defaultAccount } from './helpers/accounts';
import { CTX_A, CTX_D, INST_JPY, INST_NONE, pDraft } from './helpers/currency-examples';
import {
  CAPITAL_1M,
  draft,
  E1,
  E2,
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
import { fakePreview, ROW_E1 } from './helpers/statement-rows';

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
    accounts: ctx.accounts,
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

/** 貼り付きの帯の 1 行の状態の文（Issue #33） */
function statusOf(tree: Node[]): El {
  const s = all(tree, hasClass('record__status'));
  expect(s).toHaveLength(1);
  return s[0] as El;
}

/** 判定の枠の中の、押せない理由の案内（Issue #33 AC-2） */
function hintOf(tree: Node[]): El {
  const h = all([verdictOf(tree)], (e) => e.props.id === 'record-verdict-hint');
  expect(h).toHaveLength(1);
  return h[0] as El;
}

const count = (t: string, w: string) => t.split(w).length - 1;

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
    // 円は数の外に小さく出す（#47 PR-2 デザイン 7）。数の要素は符号つきの数、すぐ後ろに単位の「円」
    expect(e4).toContain('+25,000');
    const money = all(view(stateFor(E4, CAPITAL_1M)), hasClass('num-money'));
    expect(money.map((m) => text(m))).toContain('+25,000円');
    for (const m of money)
      expect(all([m], hasClass('num-unit')).map((u) => text(u))).toEqual(['円']);
  });

  it('C（LC なしの負け）は極悪の段', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    expect(cls(badge(tree))).toBe('badge badge--worst badge--lg');
    expect(cls(verdictOf(tree))).toContain('verdict--worst');
  });
});

describe('結果の枠（判定・理由・R・リスク）', () => {
  it('E1（資金なし・例 12）: 理由の一覧は崩れだけ。「見ていない」は脇の 1 行、資金の説明は枠の中に 1 回、リスクの場所は「—」', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const reasons = all(tree, hasClass('reasons__item')).map(text);
    expect(reasons).toEqual(['LC を下げた（99.5 → 99.2）']);
    const lists = all(tree, (e) => e.type === 'ul' && hasClass('reasons')(e));
    expect(lists).toHaveLength(1);
    expect(text(lists)).not.toContain('過剰リスクは見ていない');
    const aside = all(tree, hasClass('verdict__aside'));
    expect(aside).toHaveLength(1);
    expect(aside[0]?.type).toBe('p');
    expect(text(aside)).toBe('資金が未設定なので過剰リスクは見ていない');
    const v = text(verdictOf(tree));
    expect(v).toContain('−1.6R');
    expect(count(v, '資金')).toBe(1);
    expect(v).not.toContain('資金を設定すると表示されます');
    expect(text(all(tree, hasClass('verdict__none')))).toContain('—');
  });

  it('E11: リスクの場所は「—」、理由は注記に 1 回「損益を入力すると表示されます」（#47 PR-2 で「（円）」を取った）', () => {
    const v = text(verdictOf(view(stateFor(E11, CAPITAL_1M))));
    expect(count(v, '損益を入力すると表示されます')).toBe(1);
  });

  it('E16（例 7）: R は出ず、R・リスクの段の代わりに出ない理由を枠の中に 1 回だけ。C の添え書きと同じ理由を箇条に重ねない', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    const t = text(verdictOf(tree));
    expect(count(t, 'LC が無いので')).toBe(1);
    expect(t).toContain('LC が無いので R・リスクは表示されません');
    expect(all(tree, hasClass('num--xl'))).toEqual([]);
    expect(all(tree, hasClass('verdict__none'))).toEqual([]);
    expect(all(tree, hasClass('verdict__stats'))).toEqual([]);
    // 添え書き「LC を決めずに入った取引です。」と同じ「LC を決めずに入った」を理由の一覧に出さない
    expect(count(t, 'LC を決めずに入った')).toBe(1);
    expect(all(tree, hasClass('reasons__item')).map(text)).not.toContain('LC を決めずに入った');
  });

  it('E17（LC なしの危ない勝ち）: 理由の一覧に「LC を決めずに入った」は残る（添え書きが別のことを言う）', () => {
    const tree = view(stateFor(E17, NO_CAPITAL));
    expect(all(tree, hasClass('reasons__item')).map(text)).toContain('LC を決めずに入った');
  });

  it('値が出ない場所の「—」は読み上げから隠し、読み上げには「出ません」（E1・資金なしのリスク）', () => {
    const none = all(view(stateFor(E1, NO_CAPITAL)), hasClass('verdict__none'));
    expect(none).toHaveLength(1);
    for (const n of none) {
      const dash = all([n], (e) => e.props['aria-hidden'] === 'true');
      expect(text(dash)).toBe('—');
      expect(text(all([n], hasClass('sr-only')))).toBe('出ません');
    }
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
  it('E10: 判定なし（中立）・R は出る・[記録する] は押せず、帯は「あと 1 欄」、名前は判定の枠の案内に', () => {
    const tree = view(stateFor(E10, NO_CAPITAL));
    expect(cls(badge(tree))).toBe('badge badge--neutral badge--lg');
    expect(all(tree, hasClass('reasons__item'))).toEqual([]);
    expect(text(tree)).toContain('−1.6R');
    expect(submit(tree).props.disabled).toBe(true);
    const status = statusOf(tree);
    expect(text(status)).toBe('あと 1 欄');
    expect(status.props['aria-live']).toBe('polite');
    expect(text(hintOf(tree))).toContain('時間足を変えたか');
    expect(submit(tree).props['aria-describedby']).toBe('record-verdict-hint');
    // 待ちの間の案内は 1 回だけ（R・リスクの場所に「出ます」の文を重ねない。AC-8）
    const v = text(verdictOf(tree));
    expect(count(v, '判定と理由が出ます')).toBe(1);
    expect(v).not.toContain('資金を設定すると表示されます');
    expect(v).not.toContain('イン・決済・LC で出ます');
  });

  it('開いた直後（例 1・AC-2）: 帯は「あと 7 欄」だけ。7 つの欄の名前は判定の枠の案内にあり、[記録する] の説明に結ぶ', () => {
    const tree = view(stateFor(draft({}), NO_CAPITAL));
    expect(text(statusOf(tree))).toBe('あと 7 欄');
    const hint = text(hintOf(tree));
    for (const name of [
      'L / S',
      'イン',
      '決済の価格',
      'LC（価格か「なし」）',
      'LC を入る前に決めていたか',
      'LC を動かしたか',
      '時間足を変えたか',
    ]) {
      expect(hint).toContain(name);
      // 帯には名前を出さない
      expect(text(statusOf(tree))).not.toContain(name);
    }
    expect(submit(tree).props.disabled).toBe(true);
    expect(submit(tree).props['aria-describedby']).toBe('record-verdict-hint');
    expect(count(text(verdictOf(tree)), '判定と理由が出ます')).toBe(1);
  });

  it('決済に誤り 1 つ（例 3）: 帯は「誤り 1 欄・あと 6 欄」、案内に「決済」', () => {
    const tree = view(
      stateFor(applyDraft(draft({}), { type: 'set', field: 'exitPrice', value: 'x' }), NO_CAPITAL),
    );
    expect(text(statusOf(tree))).toBe('誤り 1 欄・あと 6 欄');
    expect(text(hintOf(tree))).toContain('誤りのある欄（決済）');
    expect(submit(tree).props['aria-describedby']).toBe('record-verdict-hint');
  });

  it('押せるときは帯に判定の要約（文字だけ・バッジにしない）、[記録する] に案内を結ばない', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const status = statusOf(tree);
    expect(text(status)).toBe('B 悪い損失 · −1.6R');
    expect(all([status], hasClass('badge'))).toEqual([]);
    expect(all(tree, (e) => e.props.id === 'record-verdict-hint')).toEqual([]);
    expect(submit(tree).props['aria-describedby']).toBeUndefined();
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
      saved: {
        trade,
        instrumentName: 'US30',
        summary: summarize(trade),
        accountName: '口座 1',
        accountCount: 1,
      },
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
    // ボタン 1 つのための帯（カード）に包まない（Phase 4b 指摘 6）
    expect(all(tree, hasClass('record__submit'))).toEqual([]);
    (btn.props.onClick as () => void)();
    expect(next).toBe(1);
  });
});

describe('畳んだ欄の誤り（レビュー指摘 1）', () => {
  it('手数料に誤り → 「ほかの欄」を開き、帯は「誤り 1 欄」、判定の枠は誤りの欄の名前つきで直す案内を 1 回', () => {
    const d = applyDraft(E1, { type: 'set', field: 'feeYen', value: 'x' });
    const tree = view(stateFor(d, NO_CAPITAL));
    const details = all(tree, (e) => e.type === 'details' && hasClass('more')(e))[0] as El;
    expect(details.props.open).toBe(true);
    expect(text(statusOf(tree))).toBe('誤り 1 欄');
    expect(text(hintOf(tree))).toBe('誤りのある欄（手数料）を直すと、判定と理由が出ます。');
    expect(count(text(verdictOf(tree)), '直すと')).toBe(1);
    expect(submit(tree).props.disabled).toBe(true);
  });

  it('誤りが無ければ「ほかの欄」は閉じたまま。誤りと足りない欄は両方数え、案内に両方の名前', () => {
    const closed = all(
      view(stateFor(E1, NO_CAPITAL)),
      (e) => e.type === 'details' && hasClass('more')(e),
    )[0] as El;
    expect(closed.props.open).toBeUndefined();
    const both = applyDraft(E10, { type: 'set', field: 'entryTime', value: '2026-03-04T11:00' });
    const tree = view(stateFor(both, NO_CAPITAL));
    expect(text(statusOf(tree))).toBe('誤り 1 欄・あと 1 欄');
    expect(text(hintOf(tree))).toContain('誤りのある欄（建てた時刻）');
    expect(text(hintOf(tree))).toContain('足りない欄（時間足を変えたか）');
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

// ── 決済明細を貼る枠（Issue #15） ──

function withStatement(draft: Draft, st: Partial<StatementState>, reading = false): RecordState {
  const statement: StatementState = {
    phase: 'ready',
    rows: [ROW_E1],
    index: 0,
    marks: {},
    message: null,
    notice: null,
    preview: null,
    ...st,
  };
  const base = stateFor(draft, NO_CAPITAL);
  return {
    ...base,
    statement,
    read: gateReading(base.read, { reading, marks: statement.marks }),
  };
}

const filledE1 = () => {
  const f = fillFromRow(
    applyDraft(E1, { type: 'set', field: 'feeYen', value: '' }),
    ROW_E1,
    new Set(),
  );
  return { draft: f.draft, marks: f.marks };
};

describe('送る前の注意（AC-11・R10）', () => {
  it('貼る前・読み取り中・読み取りの後に 3 つの中身（AI の提供元に送る・切り取る・保存しない）が常に出ている。畳まない・ダイアログは無い（KEEP-5）', () => {
    const f = filledE1();
    for (const t of [
      view(stateFor(E1, NO_CAPITAL)),
      view(withStatement(E1, { phase: 'reading' }, true)),
      view(withStatement(f.draft, { marks: f.marks })),
    ]) {
      const notice = all(t, hasClass('statement__notice'));
      expect(notice).toHaveLength(1);
      expect(notice[0]?.type).toBe('p');
      const body = text(notice);
      expect(body).toBe(STATEMENT_NOTICE.join(''));
      expect(body).toContain('AI の提供元（Anthropic）に送');
      expect(body).toContain('切り取って');
      expect(body).toContain('保存しません');
      expect(all(t, (e) => e.type === 'dialog' || e.props.role === 'alertdialog')).toEqual([]);
      for (const d of all(t, (e) => e.type === 'details')) {
        expect(all([d], hasClass('statement__notice'))).toEqual([]);
      }
      // 補足は「詳しく」に畳む（3 つの中身は畳まない注意の側にある）
      const more = all(t, hasClass('statement__more'));
      expect(more).toHaveLength(1);
      expect(more[0]?.type).toBe('details');
      expect(text(all(more, (e) => e.type === 'summary'))).toBe('詳しく');
      // [スクショを選ぶ] の読み上げの説明に注意を結ぶ
      const input = all(t, (e) => e.props.id === 'record-statement-file')[0] as El;
      expect(input.props['aria-describedby']).toBe(notice[0]?.props.id);
    }
  });

  it('[スクショを選ぶ] は label + ファイルの input（画像だけ）。選ぶと onPickFile、同じファイルを選び直せるよう空に戻す', () => {
    const got: unknown[] = [];
    const tree = view(stateFor(E1, NO_CAPITAL), { onPickFile: (f) => got.push(f) });
    const input = all(tree, (e) => e.type === 'input' && e.props.type === 'file')[0] as El;
    expect(input.props.id).toBe('record-statement-file');
    expect(String(input.props.accept)).toContain('image/png');
    const label = all(tree, (e) => e.type === 'label' && e.props.for === 'record-statement-file');
    expect(text(label)).toBe('スクショを選ぶ');
    const target = { files: ['架空の画像'], value: 'x' };
    (input.props.onChange as (e: unknown) => void)({ currentTarget: target });
    expect(got).toEqual(['架空の画像']);
    expect(target.value).toBe('');
  });
});

describe('読み取り中（AC-3）', () => {
  it('控えめな状態の文と [やめて手で入れる]。[記録する] は押せず理由「明細を読み取っています」。欄は入れられる', () => {
    let cancel = 0;
    const tree = view(withStatement(E1, { phase: 'reading', rows: [] }, true), {
      onCancelRead: () => {
        cancel++;
      },
    });
    const status = all(tree, (e) => e.props.role === 'status').map(text);
    expect(status).toContain('明細を読み取っています…');
    const btn = all(tree, (e) => e.type === 'button' && text(e) === 'キャンセル')[0] as El;
    (btn.props.onClick as () => void)();
    expect(cancel).toBe(1);
    expect(submit(tree).props.disabled).toBe(true);
    expect(text(statusOf(tree))).toBe('明細を読み取っています');
    expect(text(hintOf(tree))).toContain('明細を読み取っています。');
    expect(all(tree, (e) => e.type === 'fieldset')[0]?.props.disabled).toBe(false);
  });
});

describe('読み取りの後（AC-4・AC-6・AC-7）', () => {
  it('9 欄の印「読み取り」が文字で出て、欄の読み上げの説明に入る。「ほかの欄」は開いて損益・手数料・建てた時刻が見える', () => {
    const { draft, marks } = filledE1();
    const tree = view(withStatement(draft, { marks }));
    const texts = all(tree, hasClass('field__mark')).map(text);
    expect(texts).toHaveLength(9);
    expect(new Set(texts)).toEqual(new Set(['読み取り']));
    for (const id of [
      'record-instrument',
      'record-entry',
      'record-exit',
      'record-quantity',
      'record-exit-time',
      'record-pnl',
      'record-fee',
      'record-entry-time',
    ]) {
      const input = all(tree, (e) => e.type === 'input' && e.props.id === id)[0] as El;
      expect(String(input.props['aria-describedby']), id).toContain(`${id}-mark`);
    }
    const side = all(
      tree,
      (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === 'L / S',
    )[0] as El;
    expect(side.props['aria-describedby']).toBe('record-side-mark');
    const details = all(tree, (e) => e.type === 'details' && hasClass('more')(e))[0] as El;
    expect(details.props.open).toBe(true);
  });

  it('直した欄は「直した」、逆指値の既定は「明細から」、時間帯の無い時刻は「時間帯が明細にありません」', () => {
    const tree = view(
      withStatement(E1, {
        marks: {
          exitPrice: 'edited',
          lcDecided: 'statement',
          exitReason: 'statement',
          exitTime: 'tz',
        },
      }),
    );
    const marks = all(tree, hasClass('field__mark')).map(text);
    expect(marks).toEqual(
      expect.arrayContaining(['直した', '明細から', '明細から', '時間帯が明細にありません']),
    );
    const reason = all(tree, (e) => e.type === 'select')[0] as El;
    expect(reason.props['aria-describedby']).toBe('record-exit-reason-mark');
  });

  it('時間帯の確かめ: [日本時間で合っている] で onConfirmTz。足りない欄に「決済の時刻（時間帯の確かめ）」', () => {
    let confirmed = 0;
    const tree = view(withStatement(E1, { marks: { exitTime: 'tz' } }), {
      onConfirmTz: () => {
        confirmed++;
      },
    });
    const btn = all(
      tree,
      (e) => e.type === 'button' && text(e) === '日本時間で合っている',
    )[0] as El;
    (btn.props.onClick as () => void)();
    expect(confirmed).toBe(1);
    expect(text(statusOf(tree))).toBe('あと 1 欄');
    expect(text(hintOf(tree))).toContain('決済の時刻（時間帯の確かめ）');
    expect(submit(tree).props.disabled).toBe(true);
  });

  it('プレビューは canvas（width・height の属性、style なし、読み上げの名前）', () => {
    const preview = { width: 640, height: 320, draw: noop, close: noop };
    const tree = view(withStatement(E1, { preview }));
    const canvas = all(tree, (e) => e.type === 'canvas');
    expect(canvas).toHaveLength(1);
    expect(canvas[0]?.props).toMatchObject({
      width: 640,
      height: 320,
      role: 'img',
      'aria-label': '貼った明細のプレビュー',
    });
    expect('style' in (canvas[0]?.props ?? {})).toBe(false);
    expect(all(tree, (e) => e.type === 'img')).toEqual([]);
  });
});

describe('複数行（AC-9）', () => {
  it('「2 / 3 行目」と [この行を飛ばす]（onSkipRow）、保存した行の知らせ', () => {
    let skipped = 0;
    const tree = view(
      withStatement(E1, {
        rows: [ROW_E1, ROW_E1, ROW_E1],
        index: 1,
        notice: '1 / 3 行目を記録しました',
      }),
      {
        onSkipRow: () => {
          skipped++;
        },
      },
    );
    expect(text(all(tree, hasClass('statement__row')))).toBe('2 / 3 行目');
    const btn = all(tree, (e) => e.type === 'button' && text(e) === 'この行を飛ばす')[0] as El;
    (btn.props.onClick as () => void)();
    expect(skipped).toBe(1);
    expect(all(tree, (e) => e.props.role === 'status').map(text)).toContain(
      '1 / 3 行目を記録しました',
    );
  });

  it('1 行なら行の番号もボタンも出さない', () => {
    const tree = view(withStatement(E1, {}));
    expect(all(tree, hasClass('statement__row'))).toEqual([]);
  });
});

describe('読み取りの失敗（AC-10）', () => {
  it.each(Object.values(READ_MSG))(
    '「%s」は role="alert" の決まった文言。入力の欄は残る',
    (msg) => {
      const tree = view(withStatement(E1, { phase: 'failed', rows: [], message: msg }));
      expect(all(tree, (e) => e.props.role === 'alert').map(text)).toEqual([msg]);
      expect(all(tree, (e) => e.type === 'input' && e.props.id === 'record-entry')).toHaveLength(1);
      expect(submit(tree).props.disabled).toBe(false);
    },
  );
});

describe('作りの約束（#15 の枠）', () => {
  it('枠を含めて style 属性が無く、欄にはすべて label がある', () => {
    const { draft, marks } = filledE1();
    for (const st of [
      withStatement(draft, {
        marks,
        rows: [ROW_E1, ROW_E1],
        preview: { width: 1, height: 1, draw: noop, close: noop },
      }),
      withStatement(E1, { phase: 'reading' }, true),
    ]) {
      const tree = view(st);
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

describe('レビュー指摘の対応（#15 Phase 4）', () => {
  it('指摘 6: 画像を受けられなかった知らせを、読み込み中・読み込みの失敗・保存中の画面に出す', () => {
    const msg = '記録の準備ができてから、もう一度貼ってください。';
    for (const over of [
      { phase: 'loading', readBlocked: msg },
      { phase: 'loadFailed', error: LOAD_FAILED, readBlocked: msg },
      { phase: 'saving', readBlocked: msg },
    ] as const) {
      const tree = view(stateFor(E1, NO_CAPITAL, over));
      expect(all(tree, (e) => e.props.role === 'status').map(text)).toContain(msg);
    }
    expect(text(view(stateFor(E1, NO_CAPITAL, { phase: 'loading', readBlocked: null })))).toBe(
      '読み込み中…',
    );
  });

  it('指摘 4: 貼り付けの案内はキーの名前に頼らない（PC だけに出すクラス）', () => {
    const hint = all(view(stateFor(E1, NO_CAPITAL)), hasClass('statement__pastehint'));
    expect(hint.map(text)).toEqual(['PC はこの画面に貼り付けもできます。']);
    expect(text(view(stateFor(E1, NO_CAPITAL)))).not.toContain('Ctrl');
  });

  it('指摘 2・3: 枠の見出しと行の番号はフォーカスを受けられる（tabIndex -1）', () => {
    const tree = view(withStatement(E1, { rows: [ROW_E1, ROW_E1] }));
    const title = all(tree, (e) => e.props.id === 'record-statement-title')[0] as El;
    expect(title.props.tabIndex).toBe(-1);
    const row = all(tree, (e) => e.props.id === 'record-statement-row')[0] as El;
    expect(row.props.tabIndex).toBe(-1);
    expect(text(row)).toBe('1 / 2 行目');
  });
});

describe('保存に失敗して戻ったときのフォーカスの戻り先（Issue #5 のレビュー指摘 6）', () => {
  it('[記録する] は ID を持ち（RecordScreen が失敗の後にここへフォーカスを戻す）、失敗の文言は role="alert"', () => {
    const tree = view(stateFor(E1, CAPITAL_1M, { error: SAVE_FAILED, errorKind: 'other' }));
    expect(submit(tree).props.id).toBe('record-submit');
    expect(submit(tree).props.disabled).toBe(false);
    expect(text(all(tree, (e) => e.props.role === 'alert'))).toContain(SAVE_FAILED);
  });
});

// ── 根拠の足のチャートの枠（Issue #12 契約 UI-1・AC-1・AC-3・R2） ──

describe('チャートの枠（Issue #12）', () => {
  const frames = (tree: Node[]) => all(tree, (e) => typeof e.props['data-chart-slot'] === 'string');
  const ready = () => ({ phase: 'ready' as const, preview: fakePreview(1200, 800), message: null });

  it('記録する画面にエントリー時と決済時の枠があり、名前・撮る足の添え書き・[チャートを選ぶ]', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const f = frames(tree);
    expect(f.map((e) => e.props['data-chart-slot'])).toEqual(['entry', 'exit']);
    expect(text(all(tree, hasClass('section__title')))).toContain('根拠の足のチャート（任意）');
    expect(f.map((e) => text(all([e], hasClass('chart__name'))))).toEqual([
      'エントリー時',
      '決済時',
    ]);
    expect(f.map((e) => text(all([e], hasClass('chart__hint'))))).toEqual([
      'エントリーの根拠にした足',
      '決済の判断に使った足',
    ]);
    for (const e of f) {
      expect(e.type).toBe('fieldset');
      expect(e.props.tabIndex).toBe(0);
      expect(text(e)).toContain('チャートを選ぶ');
      expect(all([e], (x) => x.type === 'input' && x.props.type === 'file')).toHaveLength(1);
    }
    expect(text(all(tree, hasClass('chart__pastehint')))).toContain(
      'PC は枠を選んでから貼り付けもできます。',
    );
  });

  it('AC-3: 時間足の欄はチャートのある枠だけ（「選ばない」+ 9 つ）。チャートが無ければ select 0', () => {
    const none = view(stateFor(E1, NO_CAPITAL));
    expect(frames(none).flatMap((f) => all([f], (e) => e.type === 'select'))).toEqual([]);
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    const [entry, exit] = frames(tree) as [El, El];
    const sel = all([entry], (e) => e.type === 'select');
    expect(sel).toHaveLength(1);
    expect(all([exit], (e) => e.type === 'select')).toEqual([]);
    const opts = all(sel, (e) => e.type === 'option');
    expect(opts.map((o) => o.props.value)).toEqual([
      '',
      '1m',
      '5m',
      '15m',
      '30m',
      '1h',
      '4h',
      '1d',
      '1w',
      '1M',
    ]);
    expect(text(opts[0] as El)).toBe('選ばない');
    expect(text(opts[6] as El)).toBe('4 時間足');
    // 欄には label、プレビューには名前、[外す]
    const label = all(
      [entry],
      (e) => e.type === 'label' && e.props.for === (sel[0] as El).props.id,
    );
    expect(text(label)).toBe('時間足（任意）');
    const canvas = all([entry], (e) => e.type === 'canvas')[0] as El;
    expect(canvas.props['aria-label']).toBe('エントリー時のチャートのプレビュー');
    expect(canvas.props.role).toBe('img');
    expect(text(entry)).toContain('外す');
    expect(all([entry], (e) => e.type === 'input' && e.props.type === 'file')).toEqual([]);
  });

  it('時間足を選ぶ / 「選ばない」に戻す → onUpdate（空は null）。[外す] → onRemoveChart', () => {
    const actions: unknown[] = [];
    const removed: string[] = [];
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { exit: ready() } }), {
      onUpdate: (a) => {
        actions.push(a);
      },
      onRemoveChart: (slot) => {
        removed.push(slot);
      },
    });
    const exit = frames(tree)[1] as El;
    const sel = all([exit], (e) => e.type === 'select')[0] as El;
    const change = sel.props.onChange as (ev: { currentTarget: { value: string } }) => void;
    change({ currentTarget: { value: '1d' } });
    change({ currentTarget: { value: '' } });
    change({ currentTarget: { value: '2h' } });
    expect(actions).toEqual([
      { type: 'set', field: 'exitChartTimeframe', value: '1d' },
      { type: 'set', field: 'exitChartTimeframe', value: null },
      { type: 'set', field: 'exitChartTimeframe', value: null },
    ]);
    const btn = all([exit], (e) => e.type === 'button' && text(e) === '外す')[0] as El;
    (btn.props.onClick as () => void)();
    expect(removed).toEqual(['exit']);
  });

  it('選んだ時間足を select に出す', () => {
    const d = applyDraft(E1, { type: 'set', field: 'entryChartTimeframe', value: '4h' });
    const tree = view(stateFor(d, NO_CAPITAL, { charts: { entry: ready() } }));
    const sel = all(tree, (e) => e.type === 'select' && e.props.id === 'record-chart-entry-tf');
    expect((sel[0] as El).props.value).toBe('4h');
  });

  it('描き直し中は「準備しています…」、失敗は決まった文言だけ', () => {
    const tree = view(
      stateFor(E1, NO_CAPITAL, {
        charts: {
          entry: { phase: 'preparing', preview: null, message: null },
          exit: {
            phase: 'failed',
            preview: null,
            message: 'この画像は使えません。別の画像を選んでください。',
          },
        },
      }),
    );
    const [entry, exit] = frames(tree) as [El, El];
    expect(text(all([entry], (e) => e.props.role === 'status'))).toBe('準備しています…');
    expect(all([entry], (e) => e.type === 'input')).toEqual([]);
    expect(text(all([exit], (e) => e.props.role === 'alert'))).toBe(
      'この画像は使えません。別の画像を選んでください。',
    );
    // 失敗の後はもう一度選べる
    expect(all([exit], (e) => e.type === 'input' && e.props.type === 'file')).toHaveLength(1);
  });

  it('[チャートを選ぶ] で選んだファイルはその枠へ（onPickChart）', () => {
    const picked: string[] = [];
    const tree = view(stateFor(E1, NO_CAPITAL), {
      onPickChart: (slot) => {
        picked.push(slot);
      },
    });
    const exit = frames(tree)[1] as El;
    const input = all([exit], (e) => e.type === 'input')[0] as El;
    const target = { files: [new File(['x'], 'c.png', { type: 'image/png' })], value: 'c.png' };
    (input.props.onChange as (ev: { currentTarget: typeof target }) => void)({
      currentTarget: target,
    });
    expect(picked).toEqual(['exit']);
    expect(target.value).toBe('');
  });

  it('style 属性を持たず、欄にはすべて label がある（チャートありの状態でも）', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready(), exit: ready() } }));
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
  });

  it('記録した後の表示に「チャート 2 枚も保存しました」（チャートの無い取引には出さない）', () => {
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
    const saved = (t: StoredTrade) =>
      text(
        view(
          stateFor(E1, NO_CAPITAL, {
            phase: 'saved',
            saved: {
              trade: t,
              instrumentName: 'US30',
              summary: summarize(t),
              accountName: '口座 1',
              accountCount: 1,
            },
          }),
        ),
      );
    const meta = { contentType: 'image/png' as const, size: 4096 };
    expect(saved({ ...trade, charts: { entry: meta, exit: meta } })).toContain(
      'チャート 2 枚も保存しました',
    );
    expect(saved({ ...trade, charts: { exit: meta } })).toContain('チャート 1 枚も保存しました');
    expect(saved(trade)).not.toContain('チャート');
  });

  it('レビュー指摘 2: 2 つの枠の [外す]・[チャートを選ぶ] の読み上げの名前を区別する', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    const removes = all(tree, (e) => e.type === 'button' && text(e) === '外す');
    expect(removes.map((b) => b.props['aria-label'])).toEqual(['エントリー時のチャートを外す']);
    const files = all(
      tree,
      (e) =>
        e.type === 'input' &&
        e.props.type === 'file' &&
        String(e.props.id).startsWith('record-chart'),
    );
    expect(files.map((f) => f.props['aria-label'])).toEqual(['決済時のチャートを選ぶ']);
    const none = view(stateFor(E1, NO_CAPITAL));
    const both = all(
      none,
      (e) =>
        e.type === 'input' &&
        e.props.type === 'file' &&
        String(e.props.id).startsWith('record-chart'),
    );
    expect(both.map((f) => f.props['aria-label'])).toEqual([
      'エントリー時のチャートを選ぶ',
      '決済時のチャートを選ぶ',
    ]);
  });

  it('レビュー指摘 3: 枠を変えられなかった知らせを枠の見出しの下に出す', () => {
    const msg = '前の [記録する] が届いたか確かめるまで、チャートは変えられません。';
    const tree = view(stateFor(E1, NO_CAPITAL, { chartBlocked: msg }));
    const charts = all(tree, hasClass('charts'))[0] as El;
    expect(text(all([charts], (e) => e.props.role === 'status'))).toBe(msg);
  });
});

describe('チャートの時間足の読み取りの表示（Issue #27 の U0・U1・U4・U6）', () => {
  const ready = (over: Record<string, unknown> = {}) => ({
    phase: 'ready' as const,
    preview: fakePreview(1200, 800),
    message: null,
    ...over,
  });

  it('U0: チャートの枠の見出しの下に、AI の提供元に送って記録と一緒に保存する注意を常に出す。明細の注意は明細だけ', () => {
    for (const tree of [
      view(stateFor(E1, NO_CAPITAL)),
      view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } })),
    ]) {
      expect(text(all(tree, hasClass('charts__notice')))).toBe(CHART_READ_NOTICE);
      const body = text(all(tree, (e) => e.props.id === 'record-statement-notice'));
      expect(body).toContain('明細の画像は AI の提供元（Anthropic）に送って読み取り、保存しません');
    }
  });

  it('U9: 利用者の選んだ値と読めた値が違えば、読めた値と [〈値〉にする] を出す', () => {
    const d = applyDraft(E1, { type: 'set', field: 'exitChartTimeframe', value: '4h' });
    let accepted: string | null = null;
    const tree = view(
      stateFor(d, NO_CAPITAL, { charts: { exit: ready({ read: 'done', readSuggest: '1d' }) } }),
      {
        onAcceptChartTimeframe: (slot) => {
          accepted = slot;
        },
      },
    );
    const box = all(tree, hasClass('chart__suggest'))[0] as El;
    expect(text(all([box], hasClass('field__hint')))).toBe('チャートからは 日足 と読めました');
    const btn = all([box], (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('日足にする');
    (btn.props.onClick as () => void)();
    expect(accepted).toBe('exit');
  });

  it('U10: タップの答え「変えず」とチャートの時間足が食い違えば、理由の 2 行目とタップの下に事実として並べる', () => {
    const d = applyDraft(
      applyDraft(applyDraft(E1, { type: 'set', field: 'entryChartTimeframe', value: '4h' }), {
        type: 'set',
        field: 'exitChartTimeframe',
        value: '1d',
      }),
      { type: 'set', field: 'timeframeChange', value: 'none' },
    );
    const ctx = { ...NO_CAPITAL, charts: { entry: true, exit: true } };
    const tree = view(stateFor(d, ctx, { charts: { entry: ready(), exit: ready() } }));
    expect(text(all(tree, hasClass('reasons__sub'))).replace(/\u00a0/g, ' ')).toBe(
      'あなたの答え: 変えず ／ チャート: 4 時間足 → 日足',
    );
    expect(text(all(tree, hasClass('field__hint'))).replace(/\u00a0/g, ' ')).toContain(
      'チャートでは 4 時間足 → 日足',
    );
  });

  it('デザイン 7: 貼った枠の「ここに貼れます」は「貼ると差し替えます」になり、撮る足の添え書きは読み上げだけに残る', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    const box = all(tree, (e) => e.props.id === 'record-chart-entry')[0] as El;
    expect(text(all([box], hasClass('chart__ready')))).toBe('貼ると差し替えます');
    expect(cls(all([box], hasClass('chart__hint'))[0] as El)).toContain('sr-only');
    const empty = all(tree, (e) => e.props.id === 'record-chart-exit')[0] as El;
    expect(text(all([empty], hasClass('chart__ready')))).toBe('ここに貼れます');
  });

  it('U1: 読み取りで埋めた欄に印「チャートから読み取り」（select の説明にもつなぐ）', () => {
    const d = applyDraft(E1, { type: 'set', field: 'entryChartTimeframe', value: '4h' });
    const tree = view(
      stateFor(d, NO_CAPITAL, { charts: { entry: ready({ read: 'done', readMark: true }) } }),
    );
    const mark = all(tree, (e) => e.props.id === 'record-chart-entry-tf-mark')[0] as El;
    expect(text(mark)).toBe(CHART_READ_MARK);
    const sel = all(tree, (e) => e.type === 'select' && e.props.id === 'record-chart-entry-tf');
    expect(sel[0]?.props['aria-describedby']).toBe('record-chart-entry-tf-mark');
    expect(sel[0]?.props.value).toBe('4h');
  });

  it('印が無い欄は今までどおり（ラベルだけ）', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready({ read: 'done' }) } }));
    expect(all(tree, (e) => e.props.id === 'record-chart-entry-tf-mark')).toHaveLength(0);
    const sel = all(tree, (e) => e.type === 'select' && e.props.id === 'record-chart-entry-tf');
    expect(sel[0]?.props['aria-describedby']).toBeUndefined();
  });

  it('U6: 読み取り中は枠に「時間足を読み取っています…」', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { exit: ready({ read: 'reading' }) } }));
    const box = all(tree, (e) => e.props.id === 'record-chart-exit')[0] as El;
    expect(text(all([box], (e) => e.props.role === 'status'))).toBe('時間足を読み取っています…');
  });

  it('U4・U5: 知らせを枠の中に出す', () => {
    const tree = view(
      stateFor(E1, NO_CAPITAL, {
        charts: { entry: ready({ read: 'done', readNote: CHART_READ_MSG.notChart }) },
      }),
    );
    const box = all(tree, (e) => e.props.id === 'record-chart-entry')[0] as El;
    expect(text(all([box], (e) => e.props.role === 'status'))).toBe(CHART_READ_MSG.notChart);
  });
});

describe('密度と階層（Issue #33）', () => {
  it('AC-3: 判定の枠は 3 つのタップの枠のすぐ後（間に別の入力の枠が無い）', () => {
    for (const d of [draft({}), E1, E16]) {
      const tree = view(stateFor(d, NO_CAPITAL));
      const fieldset = all(tree, (e) => e.type === 'fieldset' && hasClass('record__fields')(e))[0];
      const kids = (fieldset?.children ?? []).filter((n): n is El => typeof n !== 'string');
      const taps = kids.findIndex((k) => k.props['aria-labelledby'] === 'record-taps-title');
      expect(taps).toBeGreaterThanOrEqual(0);
      expect(hasClass('verdict')(kids[taps + 1] as El)).toBe(true);
    }
  });

  it('例 13・AC-8: セグメントの選んだ項目はチェックの記号が文字の前（項目の子の並び: 記号 → 文字）', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const picked = all(
      tree,
      (e) =>
        hasClass('seg__item')(e) &&
        all([e], (x) => x.type === 'input' && x.props.checked === true).length === 1,
    );
    expect(picked.length).toBeGreaterThanOrEqual(4);
    for (const item of picked) {
      const kids = item.children.filter((n): n is El => typeof n !== 'string');
      const mark = kids.findIndex((k) => cls(k).split(' ').includes('seg__check'));
      const label = kids.findIndex((k) => k.type === 'span');
      expect(mark, text(item)).toBeGreaterThanOrEqual(0);
      expect(mark, text(item)).toBeLessThan(label);
      expect(kids[mark]?.props['aria-hidden']).toBe('true');
    }
    // 選んでいない項目には記号を出さない
    const others = all(
      tree,
      (e) =>
        hasClass('seg__item')(e) &&
        all([e], (x) => x.type === 'input' && x.props.checked === true).length === 0,
    );
    for (const item of others) expect(all([item], hasClass('seg__check'))).toEqual([]);
  });

  it('AC-4: 画面の見出しに説明文を付けない（見出しだけ）', () => {
    const page = RecordPage() as VNode<{ children: VNode<Record<string, unknown>>[] }>;
    const head = (page.props.children as VNode<Record<string, unknown>>[])[0];
    expect(head?.props.title).toBe('記録する');
    expect(head?.props.description).toBeUndefined();
  });

  it('AC-1: 帯は 1 段（状態の文 1 つ + [記録する]）。保存の後の帯は [次の取引を記録] だけで大きいボタンにしない', () => {
    const tree = view(stateFor(draft({}), NO_CAPITAL));
    const bar = all(tree, hasClass('record__submit'))[0] as El;
    expect(cls(bar)).toContain('record__submit--bar');
    const kids = bar.children.filter((n): n is El => typeof n !== 'string');
    expect(kids.map((k) => k.type)).toEqual(['p', 'button']);
    expect(String(kids[1]?.props.class)).not.toContain('btn--lg');
    expect(String(kids[1]?.props.class)).not.toContain('btn--block');
  });
});

// ---- 口座（Issue #47 PR-1。U1〜U11・AC-6・AC-7）。値・名前はすべて架空 ----

describe('口座の欄（#47 U1〜U4・U10）', () => {
  const ONE_1M = { ...CAPITAL_1M, accounts: [defaultAccount(1_000_000)] };
  const withAccounts = (n: number, longName = false): DraftContext => {
    const list = [
      defaultAccount(1_000_000),
      account(
        'accB',
        longName ? '口座 B（とても長い名前の口座で、幅に入らない）' : '口座 B',
        200_000,
      ),
      account('accC', '口座 C', null),
      account('accD', '口座 D', 500_000),
    ];
    return { ...CAPITAL_1M, accounts: list.slice(0, n) };
  };

  it('U1・B1・B2: 口座 1 つ → 口座の欄も判定の枠の 1 行も無い。「取引」の見出しの行に [＋ 口座を足す] だけ', () => {
    const tree = view(stateFor(E11, ONE_1M));
    expect(all(tree, (e) => e.props['aria-label'] === '口座')).toEqual([]);
    expect(all(tree, (e) => e.props.id === 'record-account')).toEqual([]);
    expect(all(tree, hasClass('verdict__account'))).toEqual([]);
    const add = all(tree, (e) => e.props.id === 'record-account-add')[0];
    expect(text(add ? [add] : [])).toBe('＋ 口座を追加');
    expect(add?.props['aria-expanded']).toBe('false');
    // 見出しの行の中（取引の枠の見出しと同じ行）
    const head = all(tree, hasClass('section__head'))[0];
    expect(text(head ? [head] : [])).toBe('取引＋ 口座を追加');
  });

  it('U2: 口座 2〜3 つ → 「取引」の先頭（銘柄の上）に Segment「口座」。選ばれた項目にチェック', () => {
    for (const n of [2, 3]) {
      const d = applyDraft(E11, { type: 'set', field: 'accountId', value: 'accB' });
      const tree = view(stateFor(d, withAccounts(n)));
      const group = all(
        tree,
        (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '口座',
      )[0];
      expect(group, `${n}`).toBeDefined();
      const radios = all(group ? [group] : [], (e) => e.type === 'input');
      expect(radios).toHaveLength(n);
      expect(radios.filter((r) => r.props.checked).map((r) => r.props.value)).toEqual(['accB']);
      // 銘柄の欄より前
      const ids = all(
        tree,
        (e) => e.props.name === 'record-account' || e.props.id === 'record-instrument',
      ).map((e) => String(e.props.name ?? e.props.id));
      expect(ids.indexOf('record-account')).toBeLessThan(ids.indexOf('record-instrument'));
    }
  });

  it('U3: 口座 4 つ以上 → select「口座」', () => {
    const tree = view(stateFor(E11, withAccounts(4)));
    const sel = all(tree, (e) => e.type === 'select' && e.props.id === 'record-account')[0];
    expect(sel).toBeDefined();
    expect(all(sel ? [sel] : [], (e) => e.type === 'option').map(text)).toEqual([
      '口座 1',
      '口座 B',
      '口座 C',
      '口座 D',
    ]);
  });

  it('#66 R4・デザイン 2: 自動で選んだ → 口座の欄の見出しに印「自動で選択」と読み上げの理由（Segment も select も）', () => {
    const st = (n: number): RecordState => ({
      ...stateFor(E11, withAccounts(n)),
      statement: {
        phase: 'ready',
        rows: [ROW_E1],
        index: 0,
        marks: { accountId: 'auto' },
        message: null,
        notice: null,
        preview: null,
      },
    });
    for (const n of [2, 4]) {
      const tree = view(st(n));
      const mark = all(tree, (e) => e.props.id === 'record-account-mark')[0];
      expect(text(mark ? [mark] : []), `${n}`).toBe('自動で選択');
      expect(cls(mark as El)).toBe('field__mark');
      const desc = all(tree, (e) => e.props.id === 'record-account-auto-desc')[0];
      expect(text(desc ? [desc] : [])).toBe(
        '前にこの明細で選んだ口座を自動で選びました。違うときは選び直してください',
      );
      expect(cls(desc as El)).toBe('sr-only');
    }
    const sel = all(view(st(4)), (e) => e.type === 'select' && e.props.id === 'record-account')[0];
    expect(sel?.props['aria-describedby']).toBe('record-account-mark record-account-auto-desc');
    // 覚えの無い明細: 印なし・口座の欄の下に「この明細の口座を選んでください…」（デザイン 1）
    const first: RecordState = {
      ...st(2),
      statement: {
        ...(st(2).statement as NonNullable<RecordState['statement']>),
        marks: {},
        firstTime: true,
      },
    };
    const hint = all(view(first), (e) => e.props.id === 'record-account-hint')[0];
    expect(text(hint ? [hint] : [])).toBe('この明細の口座を選んでください。次から自動で選びます');
    // 口座 1 つは欄も印も出ない（S7）
    const one = view({ ...st(1), accounts: withAccounts(1).accounts });
    expect(all(one, (e) => e.props.id === 'record-account-mark')).toEqual([]);
  });

  it('U4: 長い名前は省略の印（seg__text）を持つ項目の文字。全文は文字のまま', () => {
    const tree = view(stateFor(E11, withAccounts(3, true)));
    const texts = all(tree, hasClass('seg__text')).map(text);
    expect(texts).toContain('口座 B（とても長い名前の口座で、幅に入らない）');
    expect(all(tree, hasClass('seg--truncate'))).toHaveLength(1);
  });

  it('U10: 口座 2 つ以上 → 判定の枠の数の段の下に「口座 B の資金 200,000円 に対して」。未設定は「口座 C（資金は未設定）」', () => {
    const b = view(
      stateFor(
        applyDraft(E11, { type: 'set', field: 'accountId', value: 'accB' }),
        withAccounts(3),
      ),
    );
    expect(all(b, hasClass('verdict__account')).map(text)).toEqual([
      '口座 B の資金 200,000円 に対して',
    ]);
    const c = view(
      stateFor(
        applyDraft(E11, { type: 'set', field: 'accountId', value: 'accC' }),
        withAccounts(3),
      ),
    );
    expect(all(c, hasClass('verdict__account')).map(text)).toEqual(['口座 C（資金は未設定）']);
  });

  it('口座の 1 タップで onUpdate に口座が届く（AC-11 の自動の側）', () => {
    const got: unknown[] = [];
    const tree = view(stateFor(E11, withAccounts(2)), { onUpdate: (a) => got.push(a) });
    const radio = all(tree, (e) => e.type === 'input' && e.props.value === 'accB')[0];
    (radio?.props.onChange as (() => void) | undefined)?.();
    expect(got).toEqual([{ type: 'set', field: 'accountId', value: 'accB' }]);
  });
});

describe('その場で足す（#47 U5〜U9・B5）', () => {
  const open = (over: Partial<AddAccountState> = {}): RecordState =>
    stateFor(E11, CAPITAL_1M, {
      addAccount: {
        draft: { name: '', capital: '' },
        errors: {},
        saving: false,
        message: null,
        ...over,
      },
    });

  it('U5: 開くと見出しの下に「名前」「資金（任意）」と [足す] [やめる]。口座の欄は隠れる。ダイアログは無い', () => {
    const ctx = {
      ...CAPITAL_1M,
      accounts: [defaultAccount(1_000_000), account('accB', '口座 B', 1)],
    };
    const tree = view(
      stateFor(E11, ctx, {
        addAccount: { draft: { name: '', capital: '' }, errors: {}, saving: false, message: null },
      }),
    );
    const box = all(tree, hasClass('accountadd'))[0];
    expect(box?.type).toBe('fieldset');
    const b = box ? [box] : [];
    expect(all(b, (e) => e.type === 'label').map(text)).toEqual(['名前', '資金（任意）']);
    expect(all(b, (e) => e.type === 'button').map(text)).toEqual(['追加', 'キャンセル']);
    expect(text(b)).toContain('空でも足せます。資金を入れるとリスク（%）が出ます');
    expect(
      all(tree, (e) => e.props['aria-label'] === '口座' && e.props.role === 'radiogroup'),
    ).toEqual([]);
    expect(all(tree, (e) => e.type === 'dialog' || e.props.role === 'dialog')).toEqual([]);
    expect(all(tree, (e) => e.props.id === 'record-account-add')[0]?.props['aria-expanded']).toBe(
      'true',
    );
  });

  it('U6: Enter は [足す]（記録の送信にしない）。Esc は閉じる', () => {
    let added = 0;
    let closed = 0;
    let saved = 0;
    const tree = view(open(), {
      onAddAccount: () => added++,
      onCloseAddAccount: () => closed++,
      onSave: () => saved++,
    });
    const box = all(tree, hasClass('accountadd'))[0];
    const keydown = box?.props.onKeyDown as (e: unknown) => void;
    let prevented = 0;
    keydown({ key: 'Enter', target: { tagName: 'INPUT' }, preventDefault: () => prevented++ });
    keydown({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault: () => prevented++ });
    expect([added, closed, saved, prevented]).toEqual([1, 1, 0, 2]);
  });

  it('U8: 誤りは欄の下に文言、通信の失敗は欄の中の知らせ（値は残る）', () => {
    const tree = view(
      open({
        draft: { name: '口座 1', capital: '0' },
        errors: { name: '同じ名前の口座があります', capital: '0 より大きい数を入れてください' },
        message:
          '通信できませんでした。もう一度 [追加] を押してください（二重には追加されません）。',
      }),
    );
    expect(text(all(tree, (e) => e.props.id === 'record-account-new-name-error'))).toBe(
      '同じ名前の口座があります',
    );
    expect(all(tree, (e) => e.props.id === 'record-account-new-name')[0]?.props.value).toBe(
      '口座 1',
    );
    const alert = all(tree, (e) => e.props.role === 'alert').map(text);
    expect(alert.some((t) => t.startsWith('通信できませんでした。もう一度 [追加]'))).toBe(true);
  });

  it('U9: 送っている間は欄と [足す] が押せない', () => {
    const tree = view(open({ saving: true, draft: { name: '口座 C', capital: '' } }));
    const box = all(tree, hasClass('accountadd'))[0];
    const buttons = all(box ? [box] : [], (e) => e.type === 'button');
    expect(buttons.map((b) => b.props.disabled)).toEqual([true, true]);
    expect(text(buttons)).toContain('追加しています…');
  });
});

describe('保存の後の知らせ（#47 U11）', () => {
  it('口座 2 つ以上で「口座 B に記録しました」、1 つで「記録しました」', () => {
    const read = readDraft(E11, CAPITAL_1M);
    const trade: StoredTrade = {
      id: 't1',
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      snapshot: {
        instrument: {
          multiplier: 1,
          quantityStep: 1,
          priceCurrency: null,
          underlyingKind: 'other',
          productForm: 'spotCfd',
        },
        capitalYen: 200_000,
        riskTolerancePct: 1,
      },
      record: { ...(read.body as NonNullable<typeof read.body>), instrumentId: 'inst-us30' },
    };
    const saved = (accountName: string, accountCount: number) =>
      all(
        view(
          stateFor(E11, CAPITAL_1M, {
            phase: 'saved',
            saved: {
              trade,
              instrumentName: 'US30',
              summary: summarize(trade),
              accountName,
              accountCount,
            },
          }),
        ),
        hasClass('verdict__status'),
      ).map(text);
    expect(saved('口座 B', 2)).toEqual(['口座 B に記録しました']);
    expect(saved('口座 1', 1)).toEqual(['記録しました']);
    // #66 デザイン 5: 明細の口座を覚えたら、保存の後の 1 行で一度だけ伝える
    const learnedTree = view(
      stateFor(E11, CAPITAL_1M, {
        phase: 'saved',
        saved: {
          trade,
          instrumentName: 'US30',
          summary: summarize(trade),
          accountName: '口座 B',
          accountCount: 2,
          learned: true,
        },
      }),
    );
    expect(text(learnedTree)).toContain('次からこの明細は 口座 B を自動で選ぶようにしました');
  });
});

// ---- 数量の比と提案の数量（Issue #67 AC-6・AC-8）。値・名前はすべて架空 ----

describe('判定の枠の数量の 1 行（#67）', () => {
  /** 判定の枠の直下の子の class（並びを見る） */
  const order = (tree: Node[]) =>
    verdictOf(tree)
      .children.filter((c): c is El => typeof c !== 'string')
      .map((c) => cls(c).split(' ').at(-1));

  it('Z2: 口座の資金 200,000・1% で E2（1R 5,000）→「数量 10000 · 提案の数量 4000（2.5 倍）」が数の段の直後に 1 行・無色', () => {
    const ctx = { ...CAPITAL_1M, accounts: [defaultAccount(200_000)] };
    const tree = view(stateFor(E2, ctx));
    const line = all(tree, hasClass('verdict__sizing'));
    expect(line.map(text)).toEqual(['数量 10000 · 提案の数量 4000（2.5 倍）']);
    expect(cls(line[0] as El)).toBe('verdict__aside verdict__sizing');
    const o = order(tree);
    expect(o[o.indexOf('verdict__stats') + 1]).toBe('verdict__sizing');
  });

  it('口座 2 つ: 数量の 1 行は口座の 1 行の前', () => {
    const ctx = {
      ...CAPITAL_1M,
      accounts: [defaultAccount(200_000), account('accB', '口座 B', 1_000_000)],
    };
    const o = order(view(stateFor(E2, ctx)));
    expect(o.indexOf('verdict__sizing')).toBe(o.indexOf('verdict__stats') + 1);
    expect(o.indexOf('verdict__account')).toBe(o.indexOf('verdict__sizing') + 1);
  });

  it('判定を待つ間（開いた直後）・資金が未設定・LC なしでは出さない', () => {
    for (const [d, ctx] of [
      [draft({}), CAPITAL_1M],
      [E2, NO_CAPITAL],
      [E16, CAPITAL_1M],
    ] as const) {
      expect(all(view(stateFor(d, ctx)), hasClass('verdict__sizing'))).toEqual([]);
    }
  });
});

describe('通貨と為替（#47 PR-2・U22〜U28・AC-15・AC-21 の出る / 消える）', () => {
  const byId = (tree: Node[], id: string) => all(tree, (e) => e.props.id === id);
  const fxInput = (tree: Node[]) =>
    all(tree, (e) => e.type === 'input' && e.props.id === 'record-fx');

  it('F1: JPY の口座 × USD 建て → 銘柄の下に「USD 建て」、「数量 | 為替」の 2 列（単位 円）と下の 1 行', () => {
    const tree = view(stateFor(pDraft({}), CTX_A));
    expect(fxInput(tree)).toHaveLength(1);
    expect(text(byId(tree, 'record-instrument-hint'))).toBe('USD 建て');
    expect(text(byId(tree, 'record-fx-line'))).toBe('1 USD = ?円（空でも記録できます）');
    // 為替の欄の読み上げの説明に下の 1 行が入る
    expect(String(fxInput(tree)[0]?.props['aria-describedby'])).toContain('record-fx-line');
    const pair = all(tree, hasClass('record__pair--prices')).find(
      (e) => all([e], (x) => x.props.id === 'record-fx').length === 1,
    ) as El;
    expect(all([pair], (e) => e.type === 'input').map((e) => e.props.id)).toEqual([
      'record-quantity',
      'record-fx',
    ]);
    const unit = all([pair], hasClass('numfield__unit'));
    expect(text(unit)).toBe('円');
  });

  it('入れた為替は「1 USD = 150円」、明細から逆算できれば「明細から 1 USD = 150.00円」（欄は空のまま）', () => {
    expect(text(byId(view(stateFor(pDraft({ fxRate: '150' }), CTX_A)), 'record-fx-line'))).toBe(
      '1 USD = 150円',
    );
    const tree = view(
      stateFor(pDraft({ exitPrice: '99.40', pnlYen: '-9100', feeYen: '100' }), CTX_A),
    );
    expect(text(byId(tree, 'record-fx-line'))).toBe('明細から 1 USD = 150.00円');
    expect(fxInput(tree)[0]?.props.value).toBe('');
  });

  it('F8・F9・F11: 為替の欄は無い。F8・F9 は建ての 1 行も無く、F11 は外貨の口座だけ「価格の通貨 未設定」', () => {
    for (const [d, ctx] of [
      [pDraft({ instrumentName: INST_JPY.name }), CTX_A],
      [pDraft({}), CTX_D],
    ] as const) {
      const tree = view(stateFor(d, ctx));
      expect(fxInput(tree)).toHaveLength(0);
      expect(byId(tree, 'record-fx-line')).toHaveLength(0);
      expect(byId(tree, 'record-instrument-hint')).toHaveLength(0);
    }
    // 未設定の 1 行は外貨の口座のときだけ（J9 の直し）
    const f11 = view(stateFor(pDraft({ instrumentName: INST_NONE.name }), CTX_A));
    expect(fxInput(f11)).toHaveLength(0);
    expect(byId(f11, 'record-instrument-hint')).toHaveLength(0);
    const f11usd = view(stateFor(pDraft({ instrumentName: INST_NONE.name }), CTX_D));
    expect(text(byId(f11usd, 'record-instrument-hint'))).toBe('価格の通貨 未設定');
  });

  it('U25: 為替の誤りは欄の下に文言', () => {
    const tree = view(stateFor(pDraft({ fxRate: '0' }), CTX_A));
    expect(text(byId(tree, 'record-fx-error'))).toBe('0 より大きい数を入れてください');
  });

  it('U26（F2）: 為替も損益も無い → 損益も「—」、注記「為替か損益を入力すると表示されます」が 1 回', () => {
    const tree = view(stateFor(pDraft({}), CTX_A));
    const v = verdictOf(tree);
    expect(text(v).split('為替か損益を入力すると表示されます').length - 1).toBe(1);
    // 注記は「リスク・損益の「—」」の 1 行、脇の理由は直せる原因の言葉（デザインレビュー 2）
    expect(text(v)).toContain('リスク・損益の「—」: 為替か損益を入力すると表示されます');
    expect(text(v)).toContain('為替が無いので過剰リスクは見ていない');
    expect(text(v)).not.toContain('1R が出ないので');
    const labels = all([v], hasClass('verdict__label')).map((e) => text(e));
    expect(labels).toContain('損益');
  });

  it('U27・U29: 「ほかの欄」の名前は「損益（明細の値）」「手数料」、USD の口座では単位 USD・判定の枠の損益は「−50.00 USD」', () => {
    const tree = view(stateFor(pDraft({}), CTX_D));
    const labels = all(tree, (e) => e.type === 'label').map((e) => text(e));
    expect(labels).toContain('損益（明細の値）');
    expect(labels).toContain('手数料');
    const units = ['record-pnl', 'record-fee'].map((id) => {
      const field = all(tree, hasClass('field')).find(
        (e) => all([e], (x) => x.props.id === id).length === 1,
      ) as El;
      return text(all([field], hasClass('numfield__unit')));
    });
    expect(units).toEqual(['USD', 'USD']);
    expect(text(verdictOf(tree))).toContain('−50.00 USD');
  });

  it('#66 C4〜C6: USD の口座で明細を貼った → 通貨が合わない・読めないときだけ損益・手数料の下に理由', () => {
    const withRow = (ctx: typeof CTX_D, row: typeof ROW_E1): RecordState => ({
      ...stateFor(pDraft({}), ctx),
      statement: {
        phase: 'ready',
        rows: [row],
        index: 0,
        marks: {},
        message: null,
        notice: null,
        preview: null,
      },
    });
    // C5: JPY の明細を USD の口座 D に
    expect(text(byId(view(withRow(CTX_D, ROW_E1)), 'record-money-note'))).toBe(
      '明細の損益は JPY です（口座 D は USD）。JPY の口座を選ぶか、USD の損益を入力してください',
    );
    // C6: 通貨が読めない
    const unread = { ...ROW_E1, pnlCurrency: 'unknown' };
    expect(text(byId(view(withRow(CTX_D, unread)), 'record-money-note'))).toBe(
      '明細の損益の通貨が読めませんでした。USD の損益を入力してください',
    );
    // C4: USD の明細は入るので理由は出ない
    const usd = { ...ROW_E1, pnlCurrency: 'USD' };
    expect(byId(view(withRow(CTX_D, usd)), 'record-money-note')).toHaveLength(0);
    // C3: 円の口座 A に USD の明細
    expect(text(byId(view(withRow(CTX_A, usd)), 'record-money-note'))).toBe(
      '明細の損益は USD です（口座 A は JPY）。USD の口座を選ぶか、円の損益を入力してください',
    );
    // 円の口座・明細なしでは出ない
    expect(byId(view(stateFor(pDraft({}), CTX_A)), 'record-money-note')).toHaveLength(0);
  });

  it('KEEP-3: 口座 1 つ・円建てでは為替の欄・建ての 1 行・注記が無く、入力の欄の数が通貨の無い形と同じ', () => {
    const inputs = (tree: Node[]) =>
      all(tree, (e) => e.type === 'input' || e.type === 'select').map((e) => e.props.id);
    const jpy = view(stateFor(pDraft({ instrumentName: INST_JPY.name }), CTX_A));
    const noCurrency = view({
      ...stateFor(pDraft({ instrumentName: INST_JPY.name }), CTX_A),
      read: (() => {
        const { currency: _c, ...r } = readDraft(pDraft({ instrumentName: INST_JPY.name }), CTX_A);
        return r;
      })(),
    });
    expect(inputs(jpy)).toEqual(inputs(noCurrency));
    expect(byId(jpy, 'record-instrument-hint')).toHaveLength(0);
  });
});
