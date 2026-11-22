// 記録する画面の描画 RecordView（Issue #13 契約 R-4・AC-5 ほか）。DOM のライブラリを使わず、部品の関数を呼んで
// 要素の木に展開して見る（RecordView と部品は hook を持たない）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { numberFieldKeyOf, unlockKeyOf } from '../../ui/src/components/NumberField';
import { SummaryCard } from '../../ui/src/components/RecordParts';
import { CHART_READ_MARK, CHART_READ_MSG, CHART_READ_NOTICE } from '../../ui/src/lib/chart-read';
import { GLOSSARY } from '../../ui/src/lib/glossary';
import {
  type AddAccountState,
  AUTH_EXPIRED,
  LOAD_FAILED,
  type RecordState,
  SAVE_FAILED,
  type StatementState,
  type TzState,
} from '../../ui/src/lib/record-controller';
import {
  applyDraft,
  type Draft,
  type DraftContext,
  readDraft,
  summarize,
} from '../../ui/src/lib/record-form';
import { tradeSummary } from '../../ui/src/lib/record-screen';
import { fillFromRow, gateReading, READ_MSG } from '../../ui/src/lib/statement-fill';
import {
  lcTakesFocus,
  RESUMED_ID,
  RecordBar,
  RecordBarView,
  Record as RecordPage,
  RecordView,
  type RecordViewProps,
  STAGE1_CANCEL_ID,
  STATEMENT_NOTICE,
  STATEMENT_NOTICE_MORE,
  STATEMENT_REMOVE_ID,
  STATEMENT_REMOVED,
  STATEMENT_UNDO_ID,
} from '../../ui/src/pages/Record';
import { account, defaultAccount } from './helpers/accounts';
import { CTX_A, CTX_D, INST_JPY, INST_NONE, pDraft } from './helpers/currency-examples';
import { closedInfoTip } from './helpers/info-tip';
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
import { fakePreview, ROW_E1, ROW_E9, unknownTz } from './helpers/statement-rows';
import { checkSubmitGate } from './helpers/submit-gate';

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

/** 判定の枠（判定のシートの中・保存の後）のバッジ（下の帯の判定の 1 行のバッジは数えない。#130） */
/** シートの包み（テストの補いが SheetView を data-sheet で包む）。#130 */
function sheetOf(tree: Node[], id: string): El {
  const s = all(tree, (e) => e.props['data-sheet'] === id);
  expect(s).toHaveLength(1);
  return s[0] as El;
}

/** 取引の欄のシート（段 1）と、ほかの欄（段 2 を開いた木） */
const fieldsSheet = (tree: Node[]) => sheetOf(tree, 'record-fields-sheet');
const moreView = (state: RecordState, over: Partial<RecordViewProps> = {}) =>
  view(state, { sheet: { kind: 'fields', step: 'more' }, ...over });
/** 「ほかの欄（任意）›」の行の右の添え */
const moreMetaOf = (tree: Node[]) => text(all([fieldsSheet(tree)], hasClass('rowlink__meta')));

function badge(tree: Node[]): El {
  const b = all([verdictOf(tree)], hasClass('badge'));
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
    expect(reasons).toEqual(['LC を広げた（99.5 → 99.2）']);
    const lists = all(tree, (e) => e.type === 'ul' && hasClass('reasons')(e));
    expect(lists).toHaveLength(1);
    expect(text(lists)).not.toContain('過剰リスクは見ていない');
    const aside = all(tree, hasClass('verdict__aside'));
    expect(aside).toHaveLength(1);
    expect(aside[0]?.type).toBe('p');
    expect(text(aside)).toBe('資金が未設定のため、過剰リスクは判定していません');
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
    expect(count(t, 'LC が無いため')).toBe(1);
    expect(t).toContain('LC が無いため、R・リスクは表示されません');
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

  it('値が出ない場所の「—」は読み上げから隠し、読み上げには「表示なし」（E1・資金なしのリスク）', () => {
    const none = all(view(stateFor(E1, NO_CAPITAL)), hasClass('verdict__none'));
    expect(none).toHaveLength(1);
    for (const n of none) {
      const dash = all([n], (e) => e.props['aria-hidden'] === 'true');
      expect(text(dash)).toBe('—');
      expect(text(all([n], hasClass('sr-only')))).toBe('表示なし');
    }
  });

  it('#56 AC-1・AC-2・AC-4（E2・E4・E8）: S でも理由と LC を動かしたかの選択肢は L と同じ「広げた」', () => {
    const tree = view(stateFor(E5, NO_CAPITAL));
    expect(all(tree, hasClass('reasons__item')).map(text)).toContain('LC を広げた（150.5 → 151）');
    const labels = all(tree, hasClass('seg__item')).map(text);
    expect(labels).toEqual(expect.arrayContaining(['そのまま', '狭めた', '広げた']));
    for (const w of ['上げた', '下げた', '詰めた']) expect(labels).not.toContain(w);
    expect(text(tree)).toContain('広げた後の LC（任意）');
  });
});

describe('未入力の欄と [記録する]（AC-2）', () => {
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
    expect(count(v, '判定が表示されます')).toBe(1);
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
      '決済',
      'LC（価格か「なし」）',
      // 3 つの質問は 1 つにまとめる（#74 デザインレビュー 4）
      '決済までの行動の 3 つ',
    ]) {
      expect(hint).toContain(name);
      // 帯には名前を出さない
      expect(text(statusOf(tree))).not.toContain(name);
    }
    expect(submit(tree).props.disabled).toBe(true);
    expect(submit(tree).props['aria-describedby']).toBe('record-verdict-hint');
    expect(count(text(verdictOf(tree)), '判定が表示されます')).toBe(1);
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

  it('#172・#183: キーボードの印（<html data-keyboard>）の間は、欄の Enter の暗黙の送信では保存せず、本文の最後の ［記録する］ を押したときだけ送る。送る前にフォーカス中の欄を外す。印が外れれば送る', () => {
    let saved = 0;
    const tree = view(stateFor(E1, NO_CAPITAL), {
      onSave: () => {
        saved++;
      },
    });
    checkSubmitGate(all(tree, (e) => e.type === 'form')[0] as El, () => saved);
  });

  it('#127（#75 AC-4 の置き換え）: キャンセルは全画面のシートの左上の ✕ のアイコンのボタン（読み上げの名前「キャンセル」）。押すと onCancel、保存中は押せない。下の帯には置かない', () => {
    let cancelled = 0;
    const bar = (saving: boolean) =>
      expand(RecordBarView({ title: '記録する', saving, onCancel: () => cancelled++ }));
    const btn = (saving: boolean) => all(bar(saving), (e) => e.type === 'button')[0] as El;
    const b = btn(false);
    expect(b.props['aria-label']).toBe('キャンセル');
    // 見た目は ✕ のアイコンだけ（文字のリンクの見た目にしない。9.12）
    expect(text(b)).toBe('');
    expect(all([b], (e) => e.type === 'svg')).toHaveLength(1);
    expect(b.props.disabled).toBe(false);
    (b.props.onClick as () => void)();
    expect(cancelled).toBe(1);
    expect(btn(true).props.disabled).toBe(true);
    // 帯の先頭（左上）が ✕、次が題（h1）
    const head = all(bar(false), (e) => e.type === 'header')[0] as El;
    const order = all([head], (e) => e.type === 'button' || e.type === 'h1').map((e) => e.type);
    expect(order).toEqual(['button', 'h1']);
    expect(text(all([head], (e) => e.type === 'h1')[0] as El)).toBe('記録する');
    // 下の帯（判定の 1 行 + [記録する]）にキャンセルを置かない
    const withCancel = view(stateFor(E1, NO_CAPITAL), { onCancel: noop });
    const submitBar = all(withCancel, hasClass('record__submit--bar'))[0] as El;
    const barButtons = all([submitBar], (e) => e.type === 'button');
    // 判定の 1 行（押すと判定のシート）と [記録する] だけ（#130）
    expect(barButtons.map((b) => b.props.id)).toEqual(['record-verdict-line', 'record-submit']);
    expect(barButtons.some((b) => b.props['aria-label'] === 'キャンセル')).toBe(false);
    const page = RecordPage() as { props: { children: { type: unknown }[] } };
    expect(page.props.children[0]?.type).toBe(RecordBar);
  });

  it('#75 デザイン 1: 借り直した書きかけは見出しの下に「前の入力の続きです」と決済の時刻のまま。借り直していなければ出さない', () => {
    const base = stateFor(E1, NO_CAPITAL);
    const st = { ...base, baseline: base.draft };
    const line = (tree: Node[]) => all(tree, (e) => e.props.id === RESUMED_ID);
    expect(line(view(st))).toEqual([]);
    const now = 1_000_000_000;
    const tree = view(st, { resumedAt: now - 5 * 60_000, now });
    const l = line(tree)[0] as El;
    expect(text(l)).toContain('前の入力の続きです（5 分前）。');
    expect(text(l)).toContain('のままです。');
    expect(text(l)).toContain('左上の ✕（キャンセル）');
    const changed = view(
      { ...st, baseline: { ...base.draft, exitTime: '2000-01-01T00:00' } },
      {
        resumedAt: now - 60_000,
        now,
      },
    );
    expect(text(line(changed)[0] as El)).not.toContain('のままです');
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
    expect(text(err)).toBe('ロングの LC はインより下にしてください');
    expect(all(tree, hasClass('reasons__item'))).toEqual([]);
    expect(submit(tree).props.disabled).toBe(true);
  });
});

describe('入力の誤り（AC-7・E9）', () => {
  it('E9: 広げた後の LC の欄に文言。判定なし', () => {
    const tree = view(stateFor(E9, NO_CAPITAL));
    const err = all(tree, (e) => e.props.id === 'record-lc-after-error')[0] as El;
    expect(text(err)).toBe('広げた後の LC は、入る前の LC より下にしてください');
    expect(cls(badge(tree))).toBe('badge badge--neutral badge--lg');
    expect(submit(tree).props.disabled).toBe(true);
  });
});

describe('#58 エントリーの時刻は「取引」の枠で決済の時刻と並ぶ', () => {
  /** 「取引」の欄（取引の欄のシートの段 1）と「ほかの欄」（同じシートの段 2。#130） */
  const tradeSection = (tree: Node[]) => fieldsSheet(tree);
  const moreOf = (tree: Node[]) => fieldsSheet(tree);
  const inputIds = (n: El) => all([n], (e) => e.type === 'input').map((e) => String(e.props.id));

  it('AC-1（例 T1）: 開いた直後、「取引」の枠に「エントリーの時刻（任意）」が決済の時刻より前にあり、「ほかの欄」に無い', () => {
    const tree = view(stateFor(draft({}), NO_CAPITAL));
    const ids = inputIds(tradeSection(tree));
    expect(ids).toContain('record-entry-time');
    expect(ids.indexOf('record-entry-time')).toBeLessThan(ids.indexOf('record-exit-time'));
    // イン / 決済の後に エントリー / 決済の時刻（同じ並び。左 = エントリー側・右 = 決済の側）
    expect(ids.indexOf('record-exit')).toBeLessThan(ids.indexOf('record-entry-time'));
    const more = moreOf(moreView(stateFor(draft({}), NO_CAPITAL)));
    expect(inputIds(more)).toContain('record-pnl');
    expect(inputIds(more)).not.toContain('record-entry-time');
    const label = all(tree, (e) => e.type === 'label' && e.props.for === 'record-entry-time');
    expect(text(label)).toBe('エントリーの時刻（任意）');
  });

  it('KEEP-1 の作り: 円の口座・円建てでは銘柄と数量が 1 段（360px でも 2 列）、エントリーの時刻と決済の時刻が 1 段', () => {
    const tree = view(stateFor(draft({}), NO_CAPITAL));
    const pairs = all([tradeSection(tree)], hasClass('record__pair'));
    expect(pairs.map((n) => inputIds(n))).toEqual([
      ['record-instrument', 'record-quantity'],
      ['record-entry', 'record-exit'],
      ['record-entry-time', 'record-exit-time'],
    ]);
    expect(hasClass('record__pair--prices')(pairs[0] as El)).toBe(true);
  });

  it('エントリーの時刻の誤りは取引の欄のシートの中（「ほかの欄」に誤りの印を付けない）', () => {
    const tree = view(
      stateFor(draft({ entryTime: '2026-03-04T11:00', exitTime: '2026-03-04T10:00' }), NO_CAPITAL),
    );
    const err = all(tree, (e) => e.props.id === 'record-entry-time-error')[0] as El;
    expect(text(err)).toBe('エントリーの時刻は決済の時刻より前にしてください');
    // 取引の欄のシートの中の誤り（「ほかの欄」の行に誤りの印は付けない）
    expect(all([tradeSection(tree)], (e) => e.props.id === 'record-entry-time-error')).toHaveLength(
      1,
    );
    expect(moreMetaOf(tree)).toBe('');
  });
});

describe('#56 LC を動かしたかの言葉（L / S で同じ「そのまま / 狭めた / 広げた」）', () => {
  /** 架空の値。L: イン 100.00・LC 99.50、S: イン 150.00・LC 150.50 */
  const L = { side: 'L', entryPrice: '100.00', lc: '99.50', lcDecided: true } as const;
  const S = { side: 'S', entryPrice: '150.00', lc: '150.50', lcDecided: true } as const;
  const moveLabels = (tree: Node[]) => {
    const group = all(
      tree,
      (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === 'LC を動かしたか',
    );
    expect(group).toHaveLength(1);
    return all(group, hasClass('seg__item')).map(text);
  };
  const lcAfterLabel = (tree: Node[]) =>
    text(all(tree, (e) => e.type === 'label' && e.props.for === 'record-lc-after'));

  it.each([
    ['E1（L）', L],
    ['E2（S）', S],
  ] as const)(
    'AC-1 %s: 選択肢は「そのまま」「狭めた」「広げた」の順で、上げた・下げた・詰めたが無い',
    (_id, base) => {
      const labels = moveLabels(view(stateFor(draft({ ...base, lcMove: 'none' }), NO_CAPITAL)));
      expect(labels).toEqual(['そのまま', '狭めた', '広げた']);
      for (const w of ['上げた', '下げた', '詰めた']) expect(labels.join()).not.toContain(w);
    },
  );

  it.each([
    ['E3（L）', L],
    ['E4（S）', S],
  ] as const)('AC-2 %s: 広げたを選ぶと「広げた後の LC（任意）」の欄', (_id, base) => {
    const tree = view(stateFor(draft({ ...base, lcMove: 'widened' }), NO_CAPITAL));
    expect(lcAfterLabel(tree)).toBe('広げた後の LC（任意）');
  });

  it.each([
    ['E5（L）', { ...L, exitPrice: '99.80', lcMove: 'widened', lcAfter: '99.80' }, '下'],
    ['E6（S）', { ...S, exitPrice: '150.20', lcMove: 'widened', lcAfter: '150.20' }, '上'],
  ] as const)(
    'AC-3・AC-7 %s: 向きの逆の誤りの知らせと、判定の枠の案内の欄の名前',
    (_id, d, dir) => {
      const tree = view(stateFor(draft({ ...d, timeframeChange: 'none' }), NO_CAPITAL));
      const err = all(tree, (e) => e.props.id === 'record-lc-after-error')[0] as El;
      expect(text(err)).toBe(`広げた後の LC は、入る前の LC より${dir}にしてください`);
      const hint = text(hintOf(tree));
      expect(hint).toContain('誤りのある欄（広げた後の LC）');
      expect(hint).not.toContain('下げた後');
      expect(hint).not.toContain('上げた後');
    },
  );

  it('デザインレビュー 4（#130 で置き場を替えた）: 記録する画面ではどちらに当たるかの 1 行を出さず「i」の説明の先頭に任せる（1 画面の高さ）。L / S で同じ', () => {
    for (const base of [L, S]) {
      const tree = view(stateFor(draft({ ...base, lcMove: 'none' }), NO_CAPITAL));
      expect(all(tree, (e) => e.props.id === 'record-lc-move-hint')).toEqual([]);
      const group = all(
        tree,
        (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === 'LC を動かしたか',
      )[0] as El;
      expect(group.props['aria-describedby']).toBeUndefined();
      expect(all(tree, (e) => e.props['aria-label'] === '「LC を動かしたか」の説明')).toHaveLength(
        1,
      );
    }
    const summary = GLOSSARY.find((g) => g.id === 'lcMove')?.summary ?? '';
    expect(summary).toContain('インに近づけた（狭めた）');
    expect(summary).toContain('インから遠ざけた（広げた）');
  });

  it('デザインレビュー 3: 「（任意）」は薄く小さい文字に分け、空の日時の欄は薄い文字（値が入ると外れる）', () => {
    const tree = view(stateFor(draft({ ...L, lcMove: 'widened' }), NO_CAPITAL));
    const label = all(
      tree,
      (e) => e.type === 'label' && e.props.for === 'record-entry-time',
    )[0] as El;
    expect(text(label)).toBe('エントリーの時刻（任意）');
    expect(text(all([label], hasClass('field__optional')))).toBe('（任意）');
    const after = all(
      tree,
      (e) => e.type === 'label' && e.props.for === 'record-lc-after',
    )[0] as El;
    expect(text(all([after], hasClass('field__optional')))).toBe('（任意）');
    const input = (t: Node[], id: string) =>
      all(t, (e) => e.type === 'input' && e.props.id === id)[0] as El;
    expect(cls(input(tree, 'record-entry-time'))).toContain('textfield__input--empty');
    expect(cls(input(tree, 'record-exit-time'))).not.toContain('textfield__input--empty');
    const filled = view(stateFor(draft({ ...L, entryTime: '2026-03-04T09:00' }), NO_CAPITAL));
    expect(cls(input(filled, 'record-entry-time'))).not.toContain('textfield__input--empty');
  });

  it('KEEP-4: 「LC なし」なら LC を動かしたかの段が出ず、注記は今のまま', () => {
    const tree = view(
      stateFor(
        draft({ side: 'L', entryPrice: '100.00', lcNone: true, exitPrice: '100.75' }),
        NO_CAPITAL,
      ),
    );
    expect(
      all(
        tree,
        (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === 'LC を動かしたか',
      ),
    ).toEqual([]);
    expect(text(tree)).toContain('LC が無いため、「決めていない」「そのまま」として記録します。');
  });

  it('KEEP-5: 時間足を変えたかの選択肢は今のまま（そのまま / 長い足へ / 短い足へ。#74 で「変えず」→「そのまま」）', () => {
    const tree = view(stateFor(draft({ ...L, lcMove: 'none' }), NO_CAPITAL));
    const group = all(
      tree,
      (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '時間足を変えたか',
    );
    expect(all(group, hasClass('seg__item')).map(text)).toEqual([
      'そのまま',
      '長い足へ',
      '短い足へ',
    ]);
  });
});

describe('窓・滑りでしたか（AC-6）', () => {
  it('E6 では 3 つのタップの下（1 画面の中。判定のシートの中には置かない。#130）に出て、E7 では出ない', () => {
    const ask = (t: Node[]) =>
      all(t, (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '窓・滑りでしたか');
    const e6 = view(stateFor(E6, NO_CAPITAL));
    const taps = all(e6, hasClass('record__taps'))[0] as El;
    expect(ask([taps])).toHaveLength(1);
    expect(ask([verdictOf(e6)])).toEqual([]);
    expect(ask(view(stateFor(E7, NO_CAPITAL)))).toEqual([]);
  });
});

describe('LC の「なし」', () => {
  it('E16: トグルは押した状態、LC の欄は止まる、決めていたか・動かしたかは出ない、時間足は出る', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    const toggle = all(tree, hasClass('lcnone'))[0] as El;
    expect(toggle.props['aria-pressed']).toBe('true');
    expect(toggle.props['aria-label']).toBe('LC を決めていなかった（なし）');
    const lc = all(tree, (e) => e.type === 'input' && e.props.id === 'record-lc')[0] as El;
    // 薄い形のまま押せる（disabled はタップを受けない。#171）
    expect(lc.props.disabled).toBeFalsy();
    expect(lc.props.readOnly).toBe(true);
    expect(lc.props.placeholder).toBe('なし');
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

describe('#171: 「なし」で止まった LC の欄を押すと「なし」を外して価格の入力へ', () => {
  const lcOf = (tree: Node[]) =>
    all(tree, (e) => e.type === 'input' && e.props.id === 'record-lc')[0] as El;
  const fakeInput = () => {
    const el = { readOnly: true, focused: 0, blur() {}, focus() {} };
    el.focus = () => {
      el.focused++;
    };
    return el;
  };
  const ev = (el: unknown) => ({ currentTarget: el });

  it('薄い枠の印と、読み上げの説明「なし を選んでいます。押すと価格を入れられます」', () => {
    const tree = view(stateFor(E16, NO_CAPITAL));
    const lc = lcOf(tree);
    expect(all(tree, hasClass('numfield--locked'))).toHaveLength(1);
    const ids = String(lc.props['aria-describedby']).split(' ');
    expect(ids[0]).toBe('record-lc-lock');
    const note = all(tree, (e) => e.props.id === 'record-lc-lock')[0] as El;
    expect(text(note)).toBe('なし を選んでいます。押すと価格を入れられます');
    expect(cls(note)).toContain('sr-only');
    const label = all(tree, (e) => e.type === 'label' && e.props.for === 'record-lc')[0] as El;
    expect(text(label)).toBe('入る前に決めた LC');
    // 「なし」でなければ止めない
    const open = view(stateFor(E1, NO_CAPITAL));
    expect(lcOf(open).props.readOnly).toBeUndefined();
    expect(all(open, hasClass('numfield--locked'))).toEqual([]);
    expect(all(open, (e) => e.props.id === 'record-lc-lock')).toEqual([]);
  });

  it('押す（click。読み上げのダブルタップも click）と 1 回だけ外し、同じ欄にフォーカスし直す', () => {
    const got: unknown[] = [];
    const lc = lcOf(view(stateFor(E16, NO_CAPITAL), { onUpdate: (a) => got.push(a) }));
    const el = fakeInput();
    (lc.props.onClick as (e: unknown) => void)(ev(el));
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: false }]);
    expect(el.readOnly).toBe(false);
    expect(el.focused).toBe(1);
    // 外した後の click は何もしない
    (lc.props.onClick as (e: unknown) => void)(ev(el));
    expect(got).toHaveLength(1);
  });

  it('フォーカスだけでは外さない（読み取りの完了・1 段目 → 2 段目・シートを閉じた後の focus()、Tab で通る、読み上げのスワイプ）', () => {
    const lc = lcOf(view(stateFor(E16, NO_CAPITAL)));
    // フォーカス・ポインタの押下に応じるものを持たない = プログラムの focus() で状態は変わらない
    for (const k of ['onFocus', 'onFocusIn', 'onPointerDown', 'onMouseDown', 'onTouchStart']) {
      expect(lc.props[k]).toBeUndefined();
    }
    // シートを閉じた後の行き先は、止めた欄を避けて要約の ［編集］（前の disabled と同じ）
    expect(lcTakesFocus({ disabled: false, readOnly: true })).toBe(false);
    expect(lcTakesFocus({ disabled: true, readOnly: false })).toBe(false);
    expect(lcTakesFocus({ disabled: false, readOnly: false })).toBe(true);
  });

  it('キー: Enter / Space で外し、数字は外してその 1 文字を打つ。Tab・矢印・修飾キー・変換中は外さない', () => {
    const got: unknown[] = [];
    const lc = lcOf(view(stateFor(E16, NO_CAPITAL), { onUpdate: (a) => got.push(a) }));
    const key = (k: string, over: Record<string, unknown> = {}) => {
      const el = fakeInput();
      let prevented = false;
      (lc.props.onKeyDown as (e: unknown) => void)({
        key: k,
        currentTarget: el,
        preventDefault: () => {
          prevented = true;
        },
        ...over,
      });
      return { el, prevented };
    };
    for (const k of ['Tab', 'ArrowDown', 'Shift', 'Escape']) {
      expect(key(k).el.readOnly).toBe(true);
    }
    expect(key('v', { ctrlKey: true }).el.readOnly).toBe(true);
    expect(key('9', { isComposing: true }).el.readOnly).toBe(true);
    expect(got).toEqual([]);
    const enter = key('Enter');
    expect(enter.el.readOnly).toBe(false);
    expect(enter.prevented).toBe(true);
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: false }]);
    got.length = 0;
    expect(key(' ').prevented).toBe(true);
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: false }]);
    got.length = 0;
    const nine = key('9');
    expect(nine.prevented).toBe(true);
    expect(got).toEqual([
      { type: 'set', field: 'lcNone', value: false },
      { type: 'set', field: 'lc', value: '9' },
    ]);
    expect(unlockKeyOf({ key: 'a', metaKey: true })).toBeNull();
    expect(unlockKeyOf({ key: '.' })).toBe('type');
  });

  it('#172 と合わせて: 止まった LC の Enter は「なし」を外してその場に残り（一言へ移らない）、外れた後の Enter は一言へ。変換中はどちらもしない', () => {
    const got: unknown[] = [];
    const focused: string[] = [];
    const doc = {
      getElementById: (id: string) =>
        id === 'record-broken'
          ? {
              focus: () => {
                focused.push(id);
              },
            }
          : null,
    };
    const press = (lc: El, el: { readOnly: boolean }, over: Record<string, unknown> = {}) => {
      let prevented = false;
      (lc.props.onKeyDown as (e: unknown) => void)({
        key: 'Enter',
        keyCode: 13,
        isComposing: false,
        currentTarget: { ...el, ownerDocument: doc, blur() {}, focus() {} },
        preventDefault: () => {
          prevented = true;
        },
        ...over,
      });
      return prevented;
    };
    // 止まっている: 外す（#171）。一言へは移らない
    const locked = lcOf(view(stateFor(E16, NO_CAPITAL), { onUpdate: (a) => got.push(a) }));
    expect(locked.props.enterKeyHint).toBe('next');
    expect(press(locked, { readOnly: true })).toBe(true);
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: false }]);
    expect(focused).toEqual([]);
    // 外れた後（同じ欄で readOnly が外れた）: 一言へ（#172）
    got.length = 0;
    expect(press(locked, { readOnly: false })).toBe(true);
    expect(got).toEqual([]);
    expect(focused).toEqual(['record-broken']);
    // 止まっていない LC の欄: 一言へ
    focused.length = 0;
    const open = lcOf(view(stateFor(E1, NO_CAPITAL), { onUpdate: (a) => got.push(a) }));
    expect(press(open, { readOnly: false })).toBe(true);
    expect(focused).toEqual(['record-broken']);
    // 変換中（isComposing・keyCode 229）は、止まっていても止まっていなくても何もしない（送信も止めない）
    focused.length = 0;
    for (const over of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(press(locked, { readOnly: true }, over)).toBe(false);
      expect(press(open, { readOnly: false }, over)).toBe(false);
    }
    expect(got).toEqual([]);
    expect(focused).toEqual([]);
    // 振り分けの純関数
    expect(numberFieldKeyOf({ key: 'Enter' }, { locked: true, onEnter: true })).toBe('press');
    expect(numberFieldKeyOf({ key: 'Enter' }, { locked: false, onEnter: true })).toBe('enter');
    expect(numberFieldKeyOf({ key: 'Enter' }, { locked: false, onEnter: false })).toBeNull();
    expect(numberFieldKeyOf({ key: '9' }, { locked: false, onEnter: true })).toBeNull();
    expect(unlockKeyOf({ key: 'Enter', keyCode: 229 })).toBeNull();
  });

  it('#172: 一言の欄は「完了」。決定キーでフォーカスを外し（送信しない）、変換の確定では外さない', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const broken = all(tree, (e) => e.type === 'input' && e.props.id === 'record-broken')[0] as El;
    expect(broken.props.enterKeyHint).toBe('done');
    const press = (over: Record<string, unknown> = {}) => {
      let prevented = false;
      let blurred = 0;
      (broken.props.onKeyDown as (e: unknown) => void)({
        key: 'Enter',
        keyCode: 13,
        isComposing: false,
        currentTarget: {
          blur: () => {
            blurred++;
          },
        },
        preventDefault: () => {
          prevented = true;
        },
        ...over,
      });
      return { prevented, blurred };
    };
    expect(press()).toEqual({ prevented: true, blurred: 1 });
    expect(press({ isComposing: true })).toEqual({ prevented: false, blurred: 0 });
    expect(press({ keyCode: 229 })).toEqual({ prevented: false, blurred: 0 });
    expect(press({ key: 'a' })).toEqual({ prevented: false, blurred: 0 });
  });

  it('［なし］ のトグルは今のまま（押した状態・押すと外す）', () => {
    const got: unknown[] = [];
    const tree = view(stateFor(E16, NO_CAPITAL), { onUpdate: (a) => got.push(a) });
    const toggle = all(tree, hasClass('lcnone'))[0] as El;
    expect(toggle.props['aria-pressed']).toBe('true');
    (toggle.props.onClick as () => void)();
    expect(got).toEqual([{ type: 'set', field: 'lcNone', value: false }]);
  });
});

describe('失敗の文言（AC-10）', () => {
  it('保存の失敗は role="alert" の決まった文言、入力の欄は残る', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { error: SAVE_FAILED }));
    const alert = all(tree, (e) => e.props.role === 'alert');
    expect(alert.map(text)).toEqual([SAVE_FAILED]);
    expect(all(tree, (e) => e.type === 'input' && e.props.id === 'record-entry')).toHaveLength(1);
  });

  it('読み込みの失敗は文言と [再読み込み]、入力の欄は出さない', () => {
    let reloaded = 0;
    const tree = view(stateFor(E1, NO_CAPITAL, { phase: 'loadFailed', error: LOAD_FAILED }), {
      onReload: () => {
        reloaded++;
      },
    });
    expect(text(all(tree, (e) => e.props.role === 'alert'))).toBe(LOAD_FAILED);
    expect(all(tree, (e) => e.type === 'input')).toEqual([]);
    const btn = all(tree, (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('再読み込み');
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
    expect(all(tree, hasClass('reasons__item')).map(text)).toContain('LC を広げた（99.5 → 99.2）');
    expect(text(all(tree, hasClass('num--xl')))).toBe('−1.6R');
    expect(text(tree)).toContain('US30 · L ロング · イン 100 → 決済 99.2 · 数量 10,000');
    expect(all(tree, (e) => e.type === 'input')).toEqual([]);
    // 「i」（説明のボタン。#57）を除いた最初のボタン
    const btn = all(tree, (e) => e.type === 'button' && !hasClass('info')(e))[0] as El;
    expect(text(btn)).toBe('次の取引を記録');
    // ボタン 1 つのための帯（カード）に包まない（Phase 4b 指摘 6）
    expect(all(tree, hasClass('record__submit'))).toEqual([]);
    (btn.props.onClick as () => void)();
    expect(next).toBe(1);
  });

  it('説明の 1 行の 4 桁以上の価格・数量は 3 桁区切り、小数は丸めない（#40 AC4。架空の値）', () => {
    const base = savedState();
    const saved = base.saved as NonNullable<RecordState['saved']>;
    const r = saved.trade.record;
    const trade: StoredTrade = {
      ...saved.trade,
      record: {
        ...r,
        lc: 38_100.5,
        entries: [
          { ...(r.entries[0] as (typeof r.entries)[number]), price: 38_250.25, quantity: 1_500 },
        ],
        exit: { ...r.exit, price: 1_234_567.125 },
      },
    };
    const tree = view({ ...base, saved: { ...saved, trade, summary: summarize(trade) } });
    expect(text(tree)).toContain(
      'US30 · L ロング · イン 38,250.25 → 決済 1,234,567.125 · 数量 1,500',
    );
  });
});

describe('畳んだ欄の誤り（レビュー指摘 1）', () => {
  it('手数料に誤り → 「ほかの欄」の行に「誤りあり」、帯は「誤り 1 欄」、判定の枠は誤りの欄の名前つきで直す案内を 1 回', () => {
    const d = applyDraft(E1, { type: 'set', field: 'feeYen', value: 'x' });
    const tree = view(stateFor(d, NO_CAPITAL));
    // 「ほかの欄（任意）›」の行に誤りの印（#130。その場で開く折りたたみはやめた）
    expect(moreMetaOf(tree)).toBe('誤りあり');
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
    expect(text(statusOf(tree))).toBe('誤り 1 欄');
    expect(text(hintOf(tree))).toBe('誤りのある欄（手数料）を直すと判定が表示されます。');
    expect(count(text(verdictOf(tree)), '直すと')).toBe(1);
    expect(submit(tree).props.disabled).toBe(true);
  });

  it('誤りが無ければ「ほかの欄」の行に印は無い。誤りと未入力の欄は両方数え、案内に両方の名前', () => {
    expect(moreMetaOf(view(stateFor(E1, NO_CAPITAL)))).toBe('');
    const both = applyDraft(E10, { type: 'set', field: 'entryTime', value: '2026-03-04T11:00' });
    const tree = view(stateFor(both, NO_CAPITAL));
    expect(text(statusOf(tree))).toBe('誤り 1 欄・あと 1 欄');
    expect(text(hintOf(tree))).toContain('誤りのある欄（エントリーの時刻）');
    expect(text(hintOf(tree))).toContain(
      'あと 1 欄を入力すると判定が表示されます（時間足を変えたか）',
    );
  });
});

describe('ログインが切れた（レビュー指摘 4）', () => {
  it('保存で 401 → 決まった文言と [もう一度ログイン]（onRelogin）', () => {
    let relogin = 0;
    const tree = view(stateFor(E1, NO_CAPITAL, { error: AUTH_EXPIRED, errorKind: 'auth' }), {
      onRelogin: () => {
        relogin++;
      },
    });
    const alert = all(tree, (e) => e.props.role === 'alert')[0] as El;
    expect(text(alert)).toContain(AUTH_EXPIRED);
    const btn = all([alert], (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('もう一度ログイン');
    (btn.props.onClick as () => void)();
    expect(relogin).toBe(1);
  });

  it('読み込みで 401 → [再読み込み] ではなく [もう一度ログイン]', () => {
    const tree = view(
      stateFor(E1, NO_CAPITAL, { phase: 'loadFailed', error: AUTH_EXPIRED, errorKind: 'auth' }),
    );
    expect(all(tree, (e) => e.type === 'button').map(text)).toEqual(['もう一度ログイン']);
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
  it('送る前の注意は 1 段目の明細の枠の下に 3 つの中身（AI の提供元に送る・切り取る・保存しない）を畳まずに出す。2 段目と取引の欄のシートには明細を選ぶ入口も注意も無い（2026-11-21・C38）', () => {
    const f = filledE1();
    const area = (t: Node[]) => all(t, hasClass('rstmt'))[0] as El;
    const card = (t: Node[]) => all(t, hasClass('rin__card'))[0] as El;
    const empty = view({ ...stateFor(draft({}), NO_CAPITAL), stage: 'input' });
    const filled = view({ ...withStatement(f.draft, { marks: f.marks }), stage: 'input' });
    const reading = view(withStatement(E1, { phase: 'reading' }, true));
    const after = view(withStatement(f.draft, { marks: f.marks }));
    expect(area(reading).props['data-area']).toBe('reading');
    expect(area(after).props['data-area']).toBe('summary');
    // 2 段目（読み取り中・読み取りの後）は要約の 3 行。取引の欄のシートも欄だけ
    for (const t of [reading, after]) {
      expect(all(t, hasClass('statement__notice'))).toEqual([]);
      expect(all(t, (e) => e.props.id === 'record-statement-file')).toEqual([]);
    }
    for (const t of [empty, filled]) {
      const notice = all([card(t)], hasClass('statement__notice'));
      expect(notice).toHaveLength(1);
      expect(all(t, hasClass('statement__notice'))).toHaveLength(1);
      expect(notice[0]?.type).toBe('p');
      const body = text(
        all([notice[0] as El], (e) => e.type === 'span' && e.props.id !== undefined),
      );
      expect(body).toBe(STATEMENT_NOTICE.join(''));
      expect(body).toContain('AI の提供元（Anthropic）に送');
      expect(body).toContain('切り取って');
      expect(body).toContain('保存しません');
      expect(all(t, (e) => e.props.role === 'alertdialog')).toEqual([]);
      expect(all(t, (e) => e.type === 'details')).toEqual([]);
      expect(text(t)).not.toContain('詳しく');
      expect(all(t, hasClass('statement__more'))).toEqual([]);
      // [スクショを選ぶ] の読み上げの説明に注意を結ぶ（結ぶのは注意の文の span だけ）
      const input = all(t, (e) => e.props.id === 'record-statement-file');
      expect(input).toHaveLength(1);
      const span = (notice[0] as El).children.find(
        (c): c is El => typeof c !== 'string' && c.type === 'span' && c.props.id !== undefined,
      );
      expect(span && text(span)).toBe(STATEMENT_NOTICE.join(''));
      expect((input[0] as El).props['aria-describedby']).toBe(span?.props.id);
      // 「i」は注意の文の末尾（デザインレビュー 6）。閉じている間は補足の文が無い
      const info = all([card(t)], (e) => e.type === 'button' && hasClass('info')(e));
      expect(info).toHaveLength(1);
      expect(info[0]?.props['aria-label']).toBe('「明細の送り方」の説明');
      expect(info[0]?.props['aria-expanded']).toBe('false');
      expect(text(t)).not.toContain(STATEMENT_NOTICE_MORE);
    }
  });

  it('[スクショを選ぶ] は label + ファイルの input（画像だけ）。選ぶと onPickFile、同じファイルを選び直せるよう空に戻す', () => {
    const got: unknown[] = [];
    const tree = view(
      { ...stateFor(draft({}), NO_CAPITAL), stage: 'input' },
      { onPickFile: (f) => got.push(f) },
    );
    const input = all(tree, (e) => e.props.id === 'record-statement-file')[0] as El;
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
  it('控えめな状態の文と [読み取りをキャンセル]。[記録する] は押せず理由「明細を読み取っています」。欄は入れられる', () => {
    let cancel = 0;
    const tree = view(withStatement(E1, { phase: 'reading', rows: [] }, true), {
      onCancelRead: () => {
        cancel++;
      },
    });
    const status = all(tree, (e) => e.props.role === 'status').map(text);
    expect(status).toContain('読み取り中…');
    // 2 番目の重さの ［キャンセル］（見える文字は短く。デザインレビュー a2）（読み上げ「明細の読み取りをキャンセル」。9.4）
    const btn = all(tree, (e) => e.type === 'button' && text(e) === 'キャンセル')[0] as El;
    expect(btn.props['aria-label']).toBe('明細の読み取りをキャンセル');
    // 明細の場所は要約の骨組み（読み取りの後の要約と同じ形の 2 行 + ボタン）
    const card = all(tree, hasClass('rstmt__card'))[0] as El;
    expect(cls(card)).toContain('rstmt__card--sum');
    expect(all([card], hasClass('rsum__l1'))).toHaveLength(1);
    expect(all([card], hasClass('rsum__l2'))).toHaveLength(1);
    // LC・一言・3 つのタップは読み取り中も入れられる（C23）
    for (const id of ['record-lc', 'record-broken'])
      expect(all(tree, (e) => e.props.id === id)[0]?.props.disabled, id).not.toBe(true);
    (btn.props.onClick as () => void)();
    expect(cancel).toBe(1);
    expect(submit(tree).props.disabled).toBe(true);
    expect(text(statusOf(tree))).toBe('明細を読み取っています');
    expect(text(hintOf(tree))).toContain('明細を読み取っています。');
    expect(all(tree, (e) => e.type === 'fieldset')[0]?.props.disabled).toBe(false);
  });
});

describe('読み取りの後（AC-4・AC-6・AC-7）', () => {
  it('9 欄の印「読み取り」が文字で出て、欄の読み上げの説明に入る（取引の欄のシートの 7 欄・ほかの欄の 2 欄。エントリーの時刻は「取引」の欄。#58・#130）', () => {
    const { draft, marks } = filledE1();
    const main = view(withStatement(draft, { marks }));
    const more = moreView(withStatement(draft, { marks }));
    const marksIn = (t: Node[]) => all([fieldsSheet(t)], hasClass('field__mark')).map(text);
    const texts = [...marksIn(main), ...marksIn(more)];
    expect(texts).toHaveLength(9);
    expect(new Set(texts)).toEqual(new Set(['読み取り']));
    // 読めた最初の行は、要約の名前の上に完了の文（名前の右の印「読み取り」の代わり。#166）、「ほかの欄」の行に「読み取りあり」
    expect(text(all(main, hasClass('rsum__status')))).toBe('読み取りました');
    expect(all(main, hasClass('rsum__mark'))).toHaveLength(0);
    expect(moreMetaOf(main)).toBe('読み取りあり');
    const tree = [...main, ...more];
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
  });

  it('直した欄は「直した」、逆指値の既定は「明細から」、時間帯の無い時刻は「タイムゾーンが書かれていません」', () => {
    const st = withStatement(E1, {
      marks: {
        exitPrice: 'edited',
        lcDecided: 'statement',
        exitReason: 'statement',
        exitTime: 'tz',
      },
    });
    const tree = [
      ...view(st),
      ...all(moreView(st), (e) => e.props['data-sheet'] === 'record-fields-sheet'),
    ];
    const marks = all(tree, hasClass('field__mark')).map(text);
    expect(marks).toEqual(
      expect.arrayContaining([
        '修正済み',
        '明細から',
        '明細から',
        'タイムゾーンが書かれていません',
      ]),
    );
    const reason = all(
      tree,
      (e) => e.type === 'select' && e.props.id === 'record-exit-reason',
    )[0] as El;
    expect(reason.props['aria-describedby']).toBe('record-exit-reason-mark');
  });

  /** Z1 の行（時間帯の無い決済の時刻 2026-11-10 10:30。架空の値） */
  const Z1_ROW = { ...ROW_E9 };
  const tzState = (over: Partial<TzState> = {}): TzState => ({
    fields: ['exitTime'],
    choice: null,
    remembered: false,
    otherOpen: false,
    gap: null,
    ...over,
  });
  const tzView = (
    tz: TzState,
    marks: StatementState['marks'] = { exitTime: 'tz' },
    over: Partial<RecordViewProps> = {},
  ) => view(withStatement(E1, { rows: [Z1_ROW], marks, tz }), over);
  const radios = (tree: Node[]) =>
    all(
      tree,
      (e) => e.type === 'input' && e.props.type === 'radio' && e.props.name === 'record-tz',
    );

  it('AC-6・AC-11（Z1）: 押す前に明細の時刻と選択肢ごとの日本時間が見え、記録できない。文は選んだタイムゾーンで直すと言う', () => {
    let chosen: string[] = [];
    let other = 0;
    const tree = tzView(tzState(), undefined, {
      onChooseTz: (id) => {
        chosen = [...chosen, id];
      },
      onOpenOtherZones: () => {
        other++;
      },
    });
    const box = all(tree, hasClass('statement__tz'))[0] as El;
    expect(box.type).toBe('fieldset');
    const t = text(box);
    expect(t).toContain('明細の時刻のタイムゾーン');
    expect(t).toContain('決済の時刻: 明細 2026/11/10 10:30');
    expect(t).toContain('選んだタイムゾーンから日本時間に直して');
    expect(t).not.toContain('違えば欄を直します');
    const opts = all([box], hasClass('tzopt')).map(text);
    expect(opts).toEqual([
      '日本時間（そのまま）2026/11/10 10:30',
      'GMT（+9 時間）2026/11/10 19:30',
      'ほかのタイムゾーン…',
    ]);
    const r = radios(tree);
    expect(r.map((e) => e.props.checked)).toEqual([false, false, false]);
    ((r[1] as El).props.onChange as () => void)();
    ((r[2] as El).props.onChange as () => void)();
    expect(chosen).toEqual(['gmt']);
    expect(other).toBe(1);
    expect(all(tree, (e) => e.type === 'select' && e.props.id === 'record-tz-other')).toEqual([]);
    expect(text(hintOf(tree))).toContain('決済の時刻（タイムゾーンの確認）');
    expect(submit(tree).props.disabled).toBe(true);
  });

  it('Z3・Z5: ほかのタイムゾーンの一覧に結果の日本時間。その時間帯に無い時刻の項目は選べない', () => {
    const tree = tzView(tzState({ otherOpen: true }));
    expect(radios(tree).map((e) => e.props.checked)).toEqual([false, false, true]);
    const sel = all(tree, (e) => e.type === 'select' && e.props.id === 'record-tz-other')[0] as El;
    expect(sel.props['aria-label']).toBe('ほかのタイムゾーン');
    const opts = all([sel], (e) => e.type === 'option');
    expect(text(opts[1] as El)).toBe('米国東部（夏時間あり） → 2026/11/11 00:30');
    expect(text(tree)).not.toContain('→ 日本時間');
    const chosen = tzView(tzState({ otherOpen: true, choice: 'us-east' }), { exitTime: 'read' });
    expect(text(chosen)).toContain('米国東部（夏時間あり） → 日本時間 2026/11/11 00:30');
    const gapTree = view(
      withStatement(E1, {
        rows: [{ ...ROW_E9, exitTime: unknownTz('2026-03-08T02:30') }],
        marks: { exitTime: 'tz' },
        tz: tzState({ otherOpen: true, gap: 'us-east' }),
      }),
    );
    const gapSel = all(
      gapTree,
      (e) => e.type === 'select' && e.props.id === 'record-tz-other',
    )[0] as El;
    const east = all([gapSel], (e) => e.type === 'option' && e.props.value === 'us-east')[0] as El;
    expect(east.props.disabled).toBe(true);
    expect(text(east)).toContain('この時刻はありません（夏時間の切り替え）');
    const status = all(gapTree, (e) => e.props.role === 'status').map(text);
    expect(status).toContain(
      '明細の時刻は米国東部（夏時間あり）では夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。',
    );
  });

  it('Z7: 覚えたタイムゾーンで入れたときは何で直したかの 1 行と選択肢（選んだ項目にチェック）', () => {
    const tree = tzView(tzState({ choice: 'gmt', remembered: true }), { exitTime: 'read' });
    const box = all(tree, hasClass('statement__tz'))[0] as El;
    expect(text(box)).toContain(
      '前に選んだ GMT（+9 時間）で日本時間に直しました。違うときは変更してください。',
    );
    expect(radios(tree).map((e) => e.props.checked)).toEqual([false, true, false]);
  });

  it('覚えたタイムゾーンでは存在しない時刻: 「直しました」を出さず、ほかを選ぶよう促す 1 行だけ', () => {
    const tree = view(
      withStatement(E1, {
        rows: [{ ...ROW_E9, exitTime: unknownTz('2026-03-08T02:30') }],
        marks: { exitTime: 'tz' },
        tz: tzState({ remembered: true, gap: 'us-east' }),
      }),
    );
    const t = text(all(tree, hasClass('statement__tz'))[0] as El);
    expect(t).toContain(
      '前に選んだ米国東部（夏時間あり）では、明細の時刻が夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。',
    );
    expect(t).not.toContain('直しました');
    expect(t).not.toContain('選んだタイムゾーンから日本時間に直して');
    expect(t).not.toContain('→ 日本時間');
    expect(count(t, '存在しません')).toBe(1);
    expect(radios(tree).map((e) => e.props.checked)).toEqual([false, false, false]);
  });

  it('欄を直した（修正済み）ら選択肢を出さない（KEEP-6）。時間帯の書かれた明細でも出ない（KEEP-5）', () => {
    expect(all(tzView(tzState(), { exitTime: 'edited' }), hasClass('statement__tz'))).toEqual([]);
    expect(all(tzView(tzState(), { exitTime: 'edited' }), hasClass('rsum__tz'))).toEqual([]);
    expect(all(view(withStatement(E1, {})), hasClass('statement__tz'))).toEqual([]);
    expect(all(view(withStatement(E1, {})), hasClass('rsum__tz'))).toEqual([]);
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
      'aria-label': '貼り付けた明細のプレビュー',
    });
    expect('style' in (canvas[0]?.props ?? {})).toBe(false);
    expect(all(tree, (e) => e.type === 'img')).toEqual([]);
  });
});

describe('複数行（AC-9）', () => {
  it('「2 / 3 行目」と [この行をスキップ]（onSkipRow）、保存した行の知らせ', () => {
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
    const btn = all(tree, (e) => e.type === 'button' && text(e) === 'この行をスキップ')[0] as El;
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
    const msg = '記録の準備ができてから、もう一度貼り付けてください。';
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
    // 貼り付けの案内は 1 段目（スクショを入れる段）
    const hint = all(
      view({ ...stateFor(draft({}), NO_CAPITAL), stage: 'input' }),
      hasClass('statement__pastehint'),
    );
    expect(hint.map(text)).toEqual(['PC はこの画面に貼り付けることもできます。']);
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
  // チャートのシートの中の枠（時間足・差し替え・削除。#130 で 1 画面の小さな 2 枠とは分けた）
  const frames = (tree: Node[]) =>
    all(tree, (e) => e.type === 'fieldset' && typeof e.props['data-chart-slot'] === 'string');
  const ready = () => ({ phase: 'ready' as const, preview: fakePreview(1200, 800), message: null });

  it('記録する画面にエントリー時と決済時の枠があり、名前・撮る足の添え書き・[チャートを選ぶ]', () => {
    const tree = view(stateFor(E1, NO_CAPITAL));
    const f = frames(tree);
    expect(f.map((e) => e.props['data-chart-slot'])).toEqual(['entry', 'exit']);
    expect(text(all(tree, hasClass('section__title')))).toContain('チャート（任意）');
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
      'PC はこの欄を選んで貼り付けできます。',
    );
  });

  it('AC-3: 時間足の欄はチャートのある枠だけ（「指定なし」+ 9 つ）。チャートが無ければ select 0', () => {
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
    expect(text(opts[0] as El)).toBe('指定なし');
    expect(text(opts[6] as El)).toBe('4 時間足');
    // 欄には label、プレビューには名前、[削除]
    const label = all(
      [entry],
      (e) => e.type === 'label' && e.props.for === (sel[0] as El).props.id,
    );
    expect(text(label)).toBe('時間足（任意）');
    const canvas = all([entry], (e) => e.type === 'canvas')[0] as El;
    expect(canvas.props['aria-label']).toBe('エントリー時のチャートのプレビュー');
    expect(canvas.props.role).toBe('img');
    expect(text(entry)).toContain('削除');
    // チャートのある枠は [チャートを選ぶ] の代わりに 1 手の [差し替え]（#89）
    const files = all([entry], (e) => e.type === 'input' && e.props.type === 'file');
    expect(files.map((f) => f.props['aria-label'])).toEqual(['エントリー時のチャートを差し替える']);
  });

  it('時間足を選ぶ / 「指定なし」に戻す → onUpdate（空は null）。[削除] → onRemoveChart', () => {
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
    const btn = all([exit], (e) => e.type === 'button' && text(e) === '削除')[0] as El;
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

  it('レビュー指摘 2: 2 つの枠の [削除]・[チャートを選ぶ] の読み上げの名前を区別する', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    const removes = all(tree, (e) => e.type === 'button' && text(e) === '削除');
    expect(removes.map((b) => b.props['aria-label'])).toEqual(['エントリー時のチャートを削除']);
    const files = all(
      tree,
      (e) =>
        e.type === 'input' &&
        e.props.type === 'file' &&
        String(e.props.id).startsWith('record-chart'),
    );
    expect(files.map((f) => f.props['aria-label'])).toEqual([
      'エントリー時のチャートを差し替える',
      '決済時のチャートを選ぶ',
    ]);
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

  it('U0: チャートを送れる所すべてに、AI の提供元に送って記録と一緒に保存する注意を常に出す。明細の注意は明細の枠だけ（2026-11-21・C38）', () => {
    // 1 段目: チャートの枠の下（空でも入った後でも）と、チャートのシートの見出しの下。明細の注意は明細の枠の下
    for (const tree of [
      view(stateFor(E1, NO_CAPITAL, { stage: 'input' })),
      view(stateFor(E1, NO_CAPITAL, { stage: 'input', charts: { entry: ready() } })),
    ]) {
      const notices = all(tree, hasClass('charts__notice'));
      expect(notices.map(text)).toEqual([CHART_READ_NOTICE, CHART_READ_NOTICE]);
      expect(cls(notices[0] as El)).toContain('rin__notice');
      const body = text(all(tree, (e) => e.props.id === 'record-statement-notice'));
      expect(body).toContain('明細の画像は AI の提供元（Anthropic）に送って読み取り、保存しません');
    }
    // 2 段目: 空のチャートの行の中（1 タップで送れる）と、チャートのシートの見出しの下。明細の注意は無い
    const empty = view(stateFor(E1, NO_CAPITAL));
    const notices = all(empty, hasClass('charts__notice'));
    expect(notices.map(text)).toEqual([CHART_READ_NOTICE, CHART_READ_NOTICE]);
    expect(cls(notices[0] as El)).toContain('rchartrow__notice');
    expect(all(empty, (e) => e.props.id === 'record-statement-notice')).toEqual([]);
    // チャートが入った行は押すとシート（シートの見出しの下に注意）
    const full = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    expect(all(full, hasClass('charts__notice')).map(text)).toEqual([CHART_READ_NOTICE]);
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

  it('U10: タップの答え「そのまま」とチャートの時間足が食い違えば、理由の 2 行目とタップの下に事実として並べる', () => {
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
      'あなたの答え: そのまま ／ チャート: 4 時間足 → 日足',
    );
    expect(text(all(tree, hasClass('field__hint'))).replace(/\u00a0/g, ' ')).toContain(
      'チャートでは 4 時間足 → 日足',
    );
  });

  it('デザイン 7: 貼った枠の「ここに貼り付け」は「貼り付けると差し替えられます」になり、撮る足の添え書きは読み上げだけに残る', () => {
    const tree = view(stateFor(E1, NO_CAPITAL, { charts: { entry: ready() } }));
    const box = all(tree, (e) => e.props.id === 'record-chart-entry')[0] as El;
    expect(text(all([box], hasClass('chart__ready')))).toBe('貼り付けると差し替えられます');
    expect(cls(all([box], hasClass('chart__hint'))[0] as El)).toContain('sr-only');
    const empty = all(tree, (e) => e.props.id === 'record-chart-exit')[0] as El;
    expect(text(all([empty], hasClass('chart__ready')))).toBe('ここに貼り付け');
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
  it('2026-11-21（#130 の AC-3 の置き換え）: 2 段目の並びは 入れたもののカード（明細の行 → チャートの行）→ LC と一言 → 3 つのタップ。判定は判定のシートの中。1 段目は入れる段だけ', () => {
    const kidsOf = (tree: Node[]) => {
      const fieldset = all(tree, (e) => e.type === 'fieldset' && hasClass('record__fields')(e))[0];
      return (fieldset?.children ?? []).filter(
        (n): n is El => typeof n !== 'string' && n.type !== 'legend' && !('data-sheet' in n.props),
      );
    };
    for (const d of [draft({}), E1, E16]) {
      const tree = view(stateFor(d, NO_CAPITAL));
      const kids = kidsOf(tree);
      expect(kids.map((k) => cls(k))).toEqual(['rinput', 'record__lc', 'record__taps']);
      const card = (kids[0] as El).children.filter((n): n is El => typeof n !== 'string');
      expect(card.map((k) => cls(k).split(' ')[0])).toEqual(['rstmt', 'rchartrow']);
      expect(all([sheetOf(tree, 'record-verdict-sheet')], hasClass('verdict'))).toHaveLength(1);
      expect(all(tree, (e) => e.props.id === 'record-submit')).toHaveLength(1);
      // 1 段目: 入れる段だけ（LC・タップ・判定の帯・［記録する］ は無い。シートは同じ）
      const input = view(stateFor(d, NO_CAPITAL, { stage: 'input' }));
      expect(kidsOf(input).map((k) => cls(k))).toEqual(['rin']);
      expect(all(input, (e) => e.props.id === 'record-lc')).toEqual([]);
      expect(all(input, (e) => e.props.id === 'record-submit')).toEqual([]);
      expect(all(input, hasClass('record__submit'))).toEqual([]);
      expect(all([sheetOf(input, 'record-verdict-sheet')], hasClass('verdict'))).toHaveLength(1);
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

  it('AC-4: 画面の見出しに説明文を付けない（上の帯の題だけ）', () => {
    const page = RecordPage() as VNode<{ children: VNode<Record<string, unknown>>[] }>;
    const head = (page.props.children as VNode<Record<string, unknown>>[])[0];
    expect(head?.props.title).toBe('記録する');
    expect(Object.keys(head?.props ?? {})).toEqual(['title']);
  });

  it('AC-1: 帯は判定の 1 行 + [記録する] の 1 段（9.4）。[記録する] は大きいボタンにしない', () => {
    const tree = view(stateFor(draft({}), NO_CAPITAL));
    const bar = all(tree, hasClass('record__submit'))[0] as El;
    expect(cls(bar)).toContain('record__submit--bar');
    const kids = bar.children.filter((n): n is El => typeof n !== 'string');
    // 判定の 1 行（状態の文を持つ押せる行。押すと判定のシート）と [記録する]（#130）
    expect(kids.map((k) => k.type)).toEqual(['button', 'button']);
    expect(kids[0]?.props.id).toBe('record-verdict-line');
    expect(all([kids[0] as El], hasClass('record__status'))).toHaveLength(1);
    expect(kids[1]?.props.type).toBe('submit');
    expect(String(kids[1]?.props.class)).not.toContain('btn--lg');
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

  it('U1・B1・B2: 口座 1 つ → 口座の欄も判定の枠の 1 行も無い。「取引」の見出しの行に [＋ 口座を追加] だけ', () => {
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

  it('U2（#130 の置き場）: 口座 2〜3 つ → 要約の下に Segment「口座」（取引の欄のシートには出さない）。選ばれた項目にチェック', () => {
    for (const n of [2, 3]) {
      const d = applyDraft(E11, { type: 'set', field: 'accountId', value: 'accB' });
      const tree = view(stateFor(d, withAccounts(n), { manual: true }));
      const group = all(
        tree,
        (e) => e.props.role === 'radiogroup' && e.props['aria-label'] === '口座',
      )[0];
      expect(group, `${n}`).toBeDefined();
      const radios = all(group ? [group] : [], (e) => e.type === 'input');
      expect(radios).toHaveLength(n);
      expect(radios.filter((r) => r.props.checked).map((r) => r.props.value)).toEqual(['accB']);
      // 要約の下の 1 行（明細の場所の中）。取引の欄のシートには口座の欄が無い
      const summary = all(tree, hasClass('rsum__accounts'))[0] as El;
      expect(all([summary], (e) => e.props.role === 'radiogroup')).toHaveLength(1);
      expect(all([fieldsSheet(tree)], (e) => e.props.name === 'record-account')).toEqual([]);
      // 選ぶ前の明細の場所（1 画面の高さの予算）には出さない
      const blank = draft({ accountId: 'accB' });
      expect(all(view(stateFor(blank, withAccounts(n))), hasClass('rsum__accounts'))).toEqual([]);
    }
  });

  it('U3（#130 の置き場）: 口座 4 つ以上 → 要約の先頭の札（押すと取引の欄のシートの select「口座」へ）', () => {
    const sheets: unknown[] = [];
    const tree = view(stateFor(E11, withAccounts(4), { manual: true }), {
      onSheet: (x) => sheets.push(x),
    });
    const chip = all(tree, hasClass('rsum__account'))[0] as El;
    expect(text(chip)).toBe('口座 1');
    (chip.props.onClick as () => void)();
    expect(sheets).toEqual([{ kind: 'fields', step: 'main', focus: 'accountId' }]);
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
        '前にこの明細で選んだ口座を自動で選びました。違うときは変更してください',
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
    const tree = view(stateFor(E11, withAccounts(3, true), { manual: true }));
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
    const tree = view(stateFor(E11, withAccounts(2), { manual: true }), {
      onUpdate: (a) => got.push(a),
    });
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
    expect(text(b)).toContain('資金は空欄でも追加できます。入力するとリスク（%）が表示されます');
    expect(
      all(tree, (e) => e.props['aria-label'] === '口座' && e.props.role === 'radiogroup'),
    ).toEqual([]);
    // 取引の欄のシートの中に開く（シートの上にシートを重ねない。#130）
    expect(all([fieldsSheet(tree)], hasClass('accountadd'))).toHaveLength(1);
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
        errors: { name: '同じ名前の口座があります', capital: '0 より大きい数値を入力してください' },
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

  it('Z2: 口座の資金 200,000・1% で E2（1R 5,000）→「数量 10,000 · 適正の数量 4,000（2.5 倍）」が数の段の直後に 1 行・無色', () => {
    const ctx = { ...CAPITAL_1M, accounts: [defaultAccount(200_000)] };
    const tree = view(stateFor(E2, ctx));
    const line = all(tree, hasClass('verdict__sizing'));
    expect(line.map(text)).toEqual(['数量 10,000 · 適正の数量 4,000（実際は 2.5 倍）']);
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

  it('F1: JPY の口座 × USD 建て → 銘柄の下に「USD 建て」、「為替 | 1 行」の 2 列（単位 円）。銘柄 | 数量の段は円のときと同じ（#58 デザインレビュー 1）', () => {
    const tree = view(stateFor(pDraft({}), CTX_A));
    expect(fxInput(tree)).toHaveLength(1);
    expect(text(byId(tree, 'record-instrument-hint'))).toBe('USD 建て');
    expect(text(byId(tree, 'record-fx-line'))).toBe('1 USD = ?円（空でも記録できます）');
    // 為替の欄の読み上げの説明に下の 1 行が入る
    expect(String(fxInput(tree)[0]?.props['aria-describedby'])).toContain('record-fx-line');
    const pair = all(tree, hasClass('record__pair--prices')).find(
      (e) => all([e], (x) => x.props.id === 'record-fx').length === 1,
    ) as El;
    expect(all([pair], (e) => e.type === 'input').map((e) => e.props.id)).toEqual(['record-fx']);
    expect(all([pair], (e) => e.props.id === 'record-fx-line')).toHaveLength(1);
    const first = all(tree, hasClass('record__pair--prices'))[0] as El;
    expect(all([first], (e) => e.type === 'input').map((e) => e.props.id)).toEqual([
      'record-instrument',
      'record-quantity',
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
    expect(text(byId(tree, 'record-fx-error'))).toBe('0 より大きい数値を入力してください');
  });

  it('U26（F2）: 為替も損益も無い → 損益も「—」、注記「為替か損益を入力すると表示されます」が 1 回', () => {
    const tree = view(stateFor(pDraft({}), CTX_A));
    const v = verdictOf(tree);
    expect(text(v).split('為替か損益を入力すると表示されます').length - 1).toBe(1);
    // 注記は「リスク・損益の「—」」の 1 行、脇の理由は直せる原因の言葉（デザインレビュー 2）
    expect(text(v)).toContain('リスク・損益の「—」: 為替か損益を入力すると表示されます');
    expect(text(v)).toContain('為替が無いため、過剰リスクは判定していません');
    expect(text(v)).not.toContain('1R が出ないので');
    const labels = all([v], hasClass('verdict__label')).map((e) => text(e));
    expect(labels).toContain('損益');
  });

  it('U27・U29: 「ほかの欄」の名前は「損益（明細の値）」「手数料」、USD の口座では単位 USD・判定の枠の損益は「−50.00 USD」', () => {
    const tree = moreView(stateFor(pDraft({}), CTX_D));
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
    expect(text(byId(moreView(withRow(CTX_D, ROW_E1)), 'record-money-note'))).toBe(
      '明細の損益は JPY です（口座 D は USD）。JPY の口座を選ぶか、USD の損益を入力してください',
    );
    // C6: 通貨が読めない
    const unread = { ...ROW_E1, pnlCurrency: 'unknown' };
    expect(text(byId(moreView(withRow(CTX_D, unread)), 'record-money-note'))).toBe(
      '明細の損益の通貨が読めませんでした。USD の損益を入力してください',
    );
    // C4: USD の明細は入るので理由は出ない
    const usd = { ...ROW_E1, pnlCurrency: 'USD' };
    expect(byId(moreView(withRow(CTX_D, usd)), 'record-money-note')).toHaveLength(0);
    // C3: 円の口座 A に USD の明細
    expect(text(byId(moreView(withRow(CTX_A, usd)), 'record-money-note'))).toBe(
      '明細の損益は USD です（口座 A は JPY）。USD の口座を選ぶか、円の損益を入力してください',
    );
    // 円の口座・明細なしでは出ない
    expect(byId(moreView(stateFor(pDraft({}), CTX_A)), 'record-money-note')).toHaveLength(0);
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

describe('言葉の説明の「i」（#57）', () => {
  const infoButtons = (t: Node[]) => all(t, (e) => e.type === 'button' && hasClass('info')(e));
  const names = (t: Node[]) => infoButtons(t).map((e) => String(e.props['aria-label']));

  it('AC-1: 3 つのタップに「〈問い〉の説明」のボタンが 1 つずつ。radiogroup の外（KEEP-4）', () => {
    const t = view(stateFor(E1, CAPITAL_1M));
    for (const q of ['LC を入る前に決めていたか', 'LC を動かしたか', '時間足を変えたか']) {
      expect(names(t).filter((n) => n === `「${q}」の説明`)).toHaveLength(1);
    }
    const groups = all(t, (e) => e.props.role === 'radiogroup');
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const g of groups) expect(infoButtons([g])).toEqual([]);
  });

  it('AC-2: 判定が出ている状態で「判定」「R」「LC の物差し」の「i」が判定の枠にある', () => {
    const t = view(stateFor(E1, CAPITAL_1M));
    expect(names([verdictOf(t)])).toEqual(
      expect.arrayContaining(['「判定」の説明', '「R」の説明', '「LC の物差し」の説明']),
    );
  });

  it('AC-3（木）: 閉じている間は aria-expanded="false"・aria-controls なし（開いている間だけ。レビュー N10）、画面の木にシート（dialog）は無い（アプリに 1 つ。#129）。名前は重ならない', () => {
    const t = view(stateFor(E1, CAPITAL_1M));
    for (const b of infoButtons(t)) {
      expect(b.props['aria-expanded']).toBe('false');
      expect(b.props['aria-controls']).toBeUndefined();
    }
    const n = names(t);
    expect(new Set(n).size).toBe(n.length);
    // 説明のシートはアプリに 1 つ（#129）。画面の木の dialog は記録する画面のシート 4 つだけ（#130）
    expect(all(t, (e) => e.type === 'dialog').map((e) => e.props.id)).toEqual([
      'record-fields-sheet',
      'record-tz-sheet',
      'record-chart-sheet',
      'record-verdict-sheet',
    ]);
  });

  it('AC-5: 「i」は type="button" で、押しても onUpdate・onSave を呼ばない（未選択の下書き）', () => {
    const got: unknown[] = [];
    const t = [
      ...view(stateFor(draft({}), NO_CAPITAL), {
        onUpdate: (a) => got.push(a),
        onSave: () => got.push('save'),
      }),
      // 明細の補足は 1 段目の明細の枠の下
      ...view(stateFor(draft({}), NO_CAPITAL, { stage: 'input' }), {
        onUpdate: (a) => got.push(a),
        onSave: () => got.push('save'),
      }),
    ];
    const buttons = infoButtons(t);
    // 3 つのタップ・明細の補足・判定の枠の見出し・R（判定を待つ間も言葉の説明は読める）
    expect(names(t)).toEqual(
      expect.arrayContaining([
        '「LC を入る前に決めていたか」の説明',
        '「LC を動かしたか」の説明',
        '「時間足を変えたか」の説明',
        '「明細の送り方」の説明',
        '「判定」の説明',
      ]),
    );
    for (const b of buttons) {
      expect(b.props.type).toBe('button');
      (b.props.onClick as () => void)();
    }
    expect(got).toEqual([]);
  });
});

describe('1 画面の形（#130。設計書 K17・ui-guidelines 9.4）', () => {
  const sheets = () => {
    const got: unknown[] = [];
    return { got, onSheet: (x: unknown) => got.push(x) };
  };
  const area = (t: Node[]) => all(t, hasClass('rstmt'))[0] as El;

  it('1 段目（空）: 見出し・絵つきの枠 2 つ（主の ［スクショを選ぶ］・tonal の ［＋ チャートを選ぶ］）・［明細なしで手入力］。手入力を押すと onManual', () => {
    let manual = 0;
    const tree = view(stateFor(draft({}), NO_CAPITAL, { stage: 'input' }), {
      onManual: () => manual++,
    });
    const title = all(tree, (e) => e.props.id === 'record-stage1-title')[0] as El;
    expect(text(title)).toBe('スクショを入れる');
    expect(title.props.tabIndex).toBe(-1);
    const cards = all(tree, hasClass('rin__card'));
    expect(cards).toHaveLength(2);
    // 絵は SVG（読み上げから隠す）
    for (const c of cards) {
      const art = all([c], hasClass('rin__artwrap'))[0] as El;
      expect(art.props['aria-hidden']).toBe('true');
      expect(all([art], (e) => e.type === 'svg')).toHaveLength(1);
    }
    expect(text(all([cards[0] as El], hasClass('rin__name')))).toBe('決済明細のスクショ');
    expect(text(all(tree, hasClass('rin__lead')))).toBe(
      '決済明細を選ぶと、読み取りを待たずに振り返りへ進みます。',
    );
    // チャートの題は「エントリーした足の / チャート」の語の切れ目でだけ折る（デザインレビュー a2）
    expect(all([cards[1] as El], hasClass('rin__chunk')).map(text)).toEqual([
      'エントリーした足の',
      'チャート',
    ]);
    const pick = all([cards[0] as El], (e) => e.type === 'label')[0] as El;
    expect(cls(pick)).toContain('btn--primary');
    expect(text(pick)).toBe('スクショを選ぶ');
    const chart = all([cards[1] as El], (e) => e.type === 'label')[0] as El;
    expect(cls(chart)).toContain('btn--tonal');
    expect(text(chart)).toBe('チャートを選ぶ');
    const file = all([chart], (e) => e.type === 'input')[0] as El;
    expect(file.props['data-chart-slot']).toBe('entry');
    const btn = all(tree, (e) => e.props.id === 'record-manual')[0] as El;
    expect(text(btn)).toBe('明細なしで手入力');
    expect(cls(btn)).toContain('btn--secondary');
    expect(all(tree, (e) => e.props.id === 'record-proceed')).toEqual([]);
    (btn.props.onClick as () => void)();
    expect(manual).toBe(1);
  });

  it('1 段目（明細あり・戻ってきた）: 枠は実物の写しと ✓・状態の文・［スクショを変更］、下は主の ［振り返りへ進む］（onStage）', () => {
    const f = filledE1();
    const stages: unknown[] = [];
    const tree = view(
      {
        ...withStatement(f.draft, { marks: f.marks, preview: fakePreview(1200, 800) }),
        stage: 'input',
      },
      { onStage: (x) => stages.push(x) },
    );
    const card = all(tree, hasClass('rin__card'))[0] as El;
    expect(cls(card)).toContain('rin__card--filled');
    expect(all([card], (e) => e.type === 'canvas')).toHaveLength(1);
    expect(all([card], hasClass('rin__check'))).toHaveLength(1);
    expect(text(all([card], hasClass('rin__desc')))).toBe('読み取りました');
    const pick = all([card], (e) => e.type === 'label')[0] as El;
    expect(text(pick)).toBe('スクショを変更');
    expect(cls(pick)).toContain('btn--secondary');
    expect(all(tree, (e) => e.props.id === 'record-manual')).toEqual([]);
    // 案内の文は「入っています」に替わる（デザインレビュー a1）
    expect(text(all(tree, hasClass('rin__lead')))).toBe(
      '明細は入っています。チャートは振り返りの画面でも追加できます。',
    );
    const go = all(tree, (e) => e.props.id === 'record-proceed')[0] as El;
    expect(text(go)).toBe('振り返りへ進む');
    // 下のボタンは欄の外（フォームの下の端。デザインレビュー a3）
    const fieldset = all(tree, (e) => e.type === 'fieldset')[0] as El;
    expect(all([fieldset], (e) => e.props.id === 'record-proceed')).toEqual([]);
    expect(cls(go)).toContain('btn--primary');
    (go.props.onClick as () => void)();
    expect(stages).toEqual(['review']);
  });

  it('2 段目のやり直し: 読み取りの失敗で取引の値が無い → 理由と ［スクショを選ぶ］（1 段目へ）・［手入力で続ける］。［記録する］ は押せない（7.5）', () => {
    const stages: unknown[] = [];
    let manual = 0;
    const tree = view(
      withStatement(draft({}), { phase: 'failed', message: READ_MSG.failed, rows: [] }),
      { onStage: (x) => stages.push(x), onManual: () => manual++ },
    );
    expect(area(tree).props['data-area']).toBe('retry');
    expect(text(all([area(tree)], (e) => e.props.role === 'alert'))).toBe(READ_MSG.failed);
    const repick = all(tree, (e) => e.props.id === 'record-repick')[0] as El;
    expect(text(repick)).toBe('スクショを選ぶ');
    (repick.props.onClick as () => void)();
    expect(stages).toEqual(['input']);
    const cont = all(tree, (e) => e.props.id === 'record-manual')[0] as El;
    expect(text(cont)).toBe('手入力で続ける');
    (cont.props.onClick as () => void)();
    expect(manual).toBe(1);
    const submit = all(tree, (e) => e.props.id === 'record-submit')[0] as El;
    expect(submit.props.disabled).toBe(true);
  });

  it('AC-4: 読み取りの後は要約 3 行と ［編集］。読めなかった欄を名指し、押すとその欄で取引の欄のシート', () => {
    const { got, onSheet } = sheets();
    const d = draft({ side: 'L', entryPrice: '100', exitPrice: '' });
    const tree = view(
      withStatement(d, { marks: { exitPrice: 'unread', instrumentName: 'read' } }),
      { onSheet },
    );
    // 名前の右の印「読み取り」は、読めた最初の行では名前の上の完了の文に替わる（#166）
    expect(text(all(tree, hasClass('rsum__l1')))).toBe('US30');
    expect(text(all(tree, hasClass('rsum__status')))).toBe('読み取りました · 入力が必要な欄 1');
    expect(text(all(tree, hasClass('rsum__l2')))).toBe('L · 数量 10,000 · イン 100 → 決済 —');
    expect(text(all(tree, hasClass('rsum__l3')))).toBe('3/4 10:00 決済');
    const edit = all(tree, (e) => e.props.id === 'record-edit-fields')[0] as El;
    expect(text(edit)).toBe('編集');
    expect(edit.props['aria-label']).toBe('取引の欄を編集');
    (edit.props.onClick as () => void)();
    const chips = all(tree, hasClass('rsum__chip'));
    expect(chips.map((c) => c.props['aria-label'])).toEqual([
      '読み取れませんでした: 決済（取引の欄を開く）',
    ]);
    ((chips[0] as El).props.onClick as () => void)();
    expect(got).toEqual([
      { kind: 'fields', step: 'main' },
      { kind: 'fields', step: 'main', focus: 'exitPrice' },
    ]);
    // 文字のリンクの見た目にしない（2 番目の重さのボタン・チップ。9.12）
    expect(cls(edit)).toContain('btn--secondary');
    for (const c of chips) expect(cls(c)).toContain('chip');
  });

  it('AC-5: タイムゾーンが未選択 → シートは閉じたまま、要約の行に印と ［タイムゾーンを選ぶ］。判定の 1 行は「タイムゾーンが未選択」', () => {
    const { got, onSheet } = sheets();
    const st = withStatement(E1, {
      rows: [ROW_E9],
      marks: { exitTime: 'tz' },
      tz: { fields: ['exitTime'], choice: null, remembered: false, otherOpen: false, gap: null },
    });
    const tree = view(st, { onSheet });
    const tz = sheetOf(tree, 'record-tz-sheet');
    expect(tz.props['data-open']).toBe('false');
    expect(all([tz], hasClass('statement__tz'))).toHaveLength(1);
    const row = all(tree, hasClass('rsum__tz'))[0] as El;
    expect(text(all([row], hasClass('rsum__tzmark')))).toBe('時刻が未確定');
    const btn = all([row], (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('タイムゾーンを選ぶ');
    (btn.props.onClick as () => void)();
    expect(got).toEqual([{ kind: 'tz' }]);
    expect(text(statusOf(tree))).toBe('タイムゾーンが未選択');
    expect(submit(tree).props.disabled).toBe(true);
    const opened = view(st, { sheet: { kind: 'tz' } });
    expect(sheetOf(opened, 'record-tz-sheet').props['data-open']).toBe('true');
  });

  it('AC-9: 判定の 1 行は判定が出ればバッジ・R、押すと判定のシート', () => {
    const { got, onSheet } = sheets();
    const tree = view(stateFor(E1, NO_CAPITAL), { onSheet });
    const line = all(tree, (e) => e.props.id === 'record-verdict-line')[0] as El;
    expect(text(all([line], hasClass('badge')))).toBe('B 悪い損失');
    expect(text(all([line], hasClass('num')))).toContain('R');
    expect(line.props['aria-haspopup']).toBe('dialog');
    (line.props.onClick as () => void)();
    expect(got).toEqual([{ kind: 'verdict' }]);
    // 判定が出ていなければ状態の文だけ
    const open = view(stateFor(draft({}), NO_CAPITAL));
    const l2 = all(open, (e) => e.props.id === 'record-verdict-line')[0] as El;
    expect(all([l2], hasClass('badge'))).toEqual([]);
    expect(text(statusOf(open))).toMatch(/^あと \d+ 欄$/);
  });

  it('2026-11-21: 2 段目のチャートの行。空は行全体が 1 タップで選ぶ（ファイルの欄に data-chart-slot）、入ったら押すとチャートのシート', () => {
    const { got, onSheet } = sheets();
    const picked: unknown[] = [];
    const empty = view(stateFor(E1, NO_CAPITAL), {
      onSheet,
      onPickChart: (slot, f) => picked.push([slot, f]),
    });
    const row = all(empty, hasClass('rchartrow'))[0] as El;
    expect(row.type).toBe('label');
    expect(text(all([row], hasClass('rchartrow__l1')))).toBe('エントリーした足のチャート');
    const input = all([row], (e) => e.type === 'input')[0] as El;
    expect(row.props.for).toBe(input.props.id);
    expect(input.props['data-chart-slot']).toBe('entry');
    expect(input.props['aria-label']).toBe('エントリー時のチャートを選ぶ');
    const target = { files: ['架空のチャート'], value: 'x' };
    (input.props.onChange as (e: unknown) => void)({ currentTarget: target });
    expect(picked).toEqual([['entry', '架空のチャート']]);
    const full = view(
      stateFor(E1, NO_CAPITAL, {
        draft: { ...E1, entryChartTimeframe: '1h' },
        charts: { entry: { phase: 'ready', preview: fakePreview(1200, 800), message: null } },
      }),
      { onSheet },
    );
    const btn = all(full, hasClass('rchartrow--full'))[0] as El;
    expect(btn.type).toBe('button');
    expect(btn.props['aria-haspopup']).toBe('dialog');
    expect(text(btn)).toBe('エントリー時 · 1 時間足決済時のチャートも追加できます');
    expect(all([btn], (e) => e.type === 'canvas')).toHaveLength(1);
    (btn.props.onClick as () => void)();
    expect(got).toEqual([{ kind: 'chart' }]);
    // 行に貼って差し替えたら 1 行で知らせる（2026-11-21 のレビュー N5）
    const replaced = view(
      stateFor(E1, NO_CAPITAL, {
        charts: { entry: { phase: 'ready', preview: fakePreview(1200, 800), message: null } },
      }),
      { chartReplaced: 'エントリー時のチャートを差し替えました。' },
    );
    const note = all(replaced, hasClass('rchart__replaced'))[0] as El;
    expect(note.props.role).toBe('status');
    expect(text(note)).toBe('エントリー時のチャートを差し替えました。');
  });

  it('AC-7（1 段目に置き換え）: チャートが入ったら 1 段目の枠はエントリー時・決済時の 2 枠。空は ［チャートを選ぶ］、ある枠は押すとチャートのシート', () => {
    const { got, onSheet } = sheets();
    const tree = view(
      stateFor(E1, NO_CAPITAL, {
        stage: 'input',
        charts: { entry: { phase: 'ready', preview: fakePreview(1200, 800), message: null } },
      }),
      { onSheet },
    );
    const mini = all(tree, hasClass('rin__charts'))[0] as El;
    const grid = all([mini], hasClass('rcharts__grid'))[0] as El;
    const slots = grid.children.filter((n): n is El => typeof n !== 'string');
    expect(slots.map((x) => x.type)).toEqual(['button', 'label']);
    expect(slots[0]?.props['data-chart-slot']).toBe('entry');
    ((slots[0] as El).props.onClick as () => void)();
    expect(got).toEqual([{ kind: 'chart' }]);
    const file = all([slots[1] as El], (e) => e.type === 'input')[0] as El;
    expect(file.props['data-chart-slot']).toBe('exit');
    expect(file.props['aria-label']).toBe('決済時のチャートを選ぶ');
    expect(text(all(tree, hasClass('rin__notice')))).toContain(CHART_READ_NOTICE);
  });

  it('AC-8: 「ほかの欄（任意）›」は取引の欄のシートの次の段。段 2 は ［‹ 取引の欄］ で戻る', () => {
    const { got, onSheet } = sheets();
    const tree = view(stateFor(E1, NO_CAPITAL), { onSheet });
    const row = all(tree, (e) => e.props.id === 'record-more')[0] as El;
    (row.props.onClick as () => void)();
    const more = moreView(stateFor(E1, NO_CAPITAL), { onSheet });
    const up = all([fieldsSheet(more)], (e) => e.props['aria-label'] === '取引の欄へ戻る')[0] as El;
    (up.props.onClick as () => void)();
    expect(got).toEqual([
      { kind: 'fields', step: 'more' },
      { kind: 'fields', step: 'main' },
    ]);
    expect(all(more, (e) => e.type === 'details')).toEqual([]);
    expect(text(all([fieldsSheet(more)], (e) => e.type === 'h2'))).toBe('ほかの欄（任意）');
  });

  it('AC-1（2026-11-21 に置き場を替えた）: 行が 2 つ以上なら上の帯の題の下に「i / N 行目」。右は振り返る段の ［スクショ］', () => {
    let toInput = 0;
    const bar = expand(
      RecordBarView({
        title: '記録する',
        saving: false,
        rows: '1 / 2 行目',
        stage: 'review',
        onCancel: noop,
        onInput: () => toInput++,
      }),
    );
    const sub = all(bar, hasClass('appbar__sub'));
    expect(text(all(sub, hasClass('appbar__meta')))).toBe('1 / 2 行目');
    const end = all(bar, hasClass('appbar__end'))[0] as El;
    const btn = all([end], (e) => e.type === 'button')[0] as El;
    expect(text(btn)).toBe('スクショ');
    expect(btn.props.id).toBe('record-to-input');
    expect(btn.props['aria-label']).toBe('スクショを入れる画面へ戻る');
    (btn.props.onClick as () => void)();
    expect(toInput).toBe(1);
    // 保存中は押せない
    const saving = expand(
      RecordBarView({
        title: '記録する',
        saving: true,
        stage: 'review',
        onInput: noop,
        onCancel: noop,
      }),
    );
    expect(all(saving, (e) => e.props.id === 'record-to-input')[0]?.props.disabled).toBe(true);
    // 1 段目・置き場の無い画面は右が空、行が 1 つなら題だけ（今の DOM）
    const none = expand(
      RecordBarView({
        title: '記録する',
        saving: false,
        stage: 'input',
        onCancel: noop,
        onInput: noop,
      }),
    );
    expect(all(none, hasClass('appbar__meta'))).toEqual([]);
    expect(all(none, hasClass('appbar__sub'))).toEqual([]);
    expect(all(none, (e) => e.props.id === 'record-to-input')).toEqual([]);
  });
});

describe('2 段化のレビューの指摘（1 段目。2026-11-21）', () => {
  it('指摘 1: 保存に失敗した後に 1 段目へ戻っても、下の端に失敗の文（role="alert"）と、ログイン切れなら ［もう一度ログイン］', () => {
    const f = filledE1();
    const tree = view({
      ...withStatement(f.draft, { marks: f.marks }),
      stage: 'input',
      error: '保存できませんでした。',
      errorKind: 'auth',
    });
    const foot = all(tree, hasClass('rin__foot'))[0] as El;
    expect(text(all([foot], (e) => e.props.role === 'alert'))).toContain('保存できませんでした。');
    expect(text(foot)).toContain('もう一度ログイン');
  });

  it('指摘 2: 読み取り中に 1 段目へ戻ると ［読み取りをキャンセル］（onCancelRead）。読み取りの後は出さない', () => {
    let cancel = 0;
    const reading = view(
      { ...withStatement(E1, { phase: 'reading' }, true), stage: 'input' },
      { onCancelRead: () => cancel++ },
    );
    const btn = all(reading, (e) => e.props.id === STAGE1_CANCEL_ID)[0] as El;
    expect(text(btn)).toBe('読み取りをキャンセル');
    (btn.props.onClick as () => void)();
    expect(cancel).toBe(1);
    const f = filledE1();
    const after = view({ ...withStatement(f.draft, { marks: f.marks }), stage: 'input' });
    expect(all(after, (e) => e.props.id === STAGE1_CANCEL_ID)).toEqual([]);
  });

  it('指摘 3: 1 段目の状態の文は明細の有無によらず role="status" を持ち、中身だけが替わる', () => {
    const empty = view({ ...stateFor(draft({}), NO_CAPITAL), stage: 'input' });
    const reading = view({ ...withStatement(E1, { phase: 'reading' }, true), stage: 'input' });
    for (const t of [empty, reading]) {
      const desc = all(t, hasClass('rin__desc'))[0] as El;
      expect(desc.props.role).toBe('status');
    }
    expect(text(all(reading, hasClass('rin__desc'))[0] as El)).toBe('読み取り中…');
  });
});

describe('読み取りが終わったことの知らせ（#166。例は Issue の表）', () => {
  const area = (t: Node[]) => all(t, hasClass('rstmt'))[0] as El;
  /** 明細の行の読み上げの領域（見出しの次。3 つの形の外に常に描く） */
  const region = (t: Node[]) => {
    const kids = area(t).children.filter((n): n is El => typeof n !== 'string');
    return kids[1] as El;
  };
  const visible = (t: Node[]) => all(t, hasClass('rsum__status'));
  const filled = () => {
    const f = filledE1();
    return withStatement(f.draft, { marks: f.marks });
  };

  it('AC-2: 読み取り中・読み取りの後・やり直しのどの形でも、見出しの次に同じ id・role の領域があり、中身だけが替わる', () => {
    const reading = view(withStatement(E1, { phase: 'reading' }, true));
    const after = view(filled());
    const cancelled = view({ ...stateFor(draft({}), NO_CAPITAL), readCancelled: true });
    for (const [t, want] of [
      [reading, '読み取り中…'],
      [after, '読み取りました'],
      [cancelled, '読み取りをキャンセルしました'],
    ] as const) {
      const r = region(t);
      expect(r.type).toBe('p');
      expect(r.props.role).toBe('status');
      expect(r.props.id).toBe('record-statement-status');
      expect(cls(r)).toBe('sr-only');
      expect(text(r)).toBe(want);
    }
    expect(area(reading).props['data-area']).toBe('reading');
    expect(area(after).props['data-area']).toBe('summary');
    expect(area(cancelled).props['data-area']).toBe('retry');
    // 領域のほかに role="status" の「読み取り中…」を置かない（読み上げは 1 か所）
    expect(
      all([area(reading)], (e) => e.props.role === 'status' && text(e) === '読み取り中…'),
    ).toHaveLength(1);
  });

  it('#1: 見える完了の文は名前の上の 1 行（読み上げは領域だけ = aria-hidden）。名前の右の印「読み取り」は出さない', () => {
    const t = view(filled());
    const st = visible(t)[0] as El;
    expect(text(st)).toBe('読み取りました');
    expect(st.props['aria-hidden']).toBe('true');
    expect(cls(st)).toContain('rsum__status--done');
    expect(all(t, hasClass('rsum__mark'))).toHaveLength(0);
    // 読み取り中も同じ場所（名前の上）に「読み取り中…」
    const r = visible(view(withStatement(E1, { phase: 'reading' }, true)))[0] as El;
    expect(text(r)).toBe('読み取り中…');
    expect(r.props['aria-hidden']).toBe('true');
  });

  it('#2: 2 行の明細 → 「2 行を読み取りました」', () => {
    const f = filledE1();
    const t = view(withStatement(f.draft, { marks: f.marks, rows: [ROW_E1, ROW_E1] }));
    expect(text(visible(t))).toBe('2 行を読み取りました');
    expect(text(region(t))).toBe('2 行を読み取りました');
  });

  it('#4: 読めなかった欄が 2 つ → 「読み取りました · 入力が必要な欄 2」と今のチップ 2 つ', () => {
    const f = filledE1();
    const d = { ...f.draft, quantity: '', exitTime: '' };
    const t = view(
      withStatement(d, { marks: { ...f.marks, quantity: 'unread', exitTime: 'unread' } }),
    );
    expect(text(visible(t))).toBe('読み取りました · 入力が必要な欄 2');
    expect(text(region(t))).toBe('読み取りました · 入力が必要な欄 2');
    expect(all(t, hasClass('rsum__chip'))).toHaveLength(2);
  });

  it('#4 の印は中立の「!」、全欄読めたらチェック（デザインレビュー 2）', () => {
    const f = filledE1();
    const need = view(
      withStatement({ ...f.draft, quantity: '' }, { marks: { ...f.marks, quantity: 'unread' } }),
    );
    expect(all(need, hasClass('rsum__statusicon--need'))).toHaveLength(1);
    const ok = view(filled());
    expect(all(ok, hasClass('rsum__statusicon--need'))).toHaveLength(0);
    expect(all(ok, hasClass('rsum__statusicon'))).toHaveLength(1);
  });

  it('読み上げは終わった時点の数で止める（spokenNamed）。見える文は今の数（コードレビュー 2）', () => {
    const f = filledE1();
    const t = view(
      withStatement({ ...f.draft, quantity: '' }, { marks: { ...f.marks, quantity: 'unread' } }),
      { spokenNamed: 2 },
    );
    expect(text(visible(t))).toBe('読み取りました · 入力が必要な欄 1');
    expect(text(region(t))).toBe('読み取りました · 入力が必要な欄 2');
    // 読み取り中・キャンセルは spokenNamed に関わらない
    expect(
      text(region(view(withStatement(E1, { phase: 'reading' }, true), { spokenNamed: 2 }))),
    ).toBe('読み取り中…');
  });

  it('#9: 値の無いままキャンセル → やり直しの形に「読み取りをキャンセルしました」（「明細がありません」の代わり）と 2 つのボタン', () => {
    const t = view({ ...stateFor(draft({}), NO_CAPITAL), readCancelled: true });
    const card = all(t, hasClass('rstmt__card--retry'))[0] as El;
    const l1 = all([card], hasClass('rsum__l1'))[0] as El;
    expect(text(l1)).toBe('読み取りをキャンセルしました');
    expect(l1.props['aria-hidden']).toBe('true');
    expect(text(card)).not.toContain('明細がありません');
    expect(all(t, (e) => e.props.id === 'record-repick')).toHaveLength(1);
    expect(all(t, (e) => e.props.id === 'record-manual')).toHaveLength(1);
    // キャンセルでない選ぶ前は今のまま
    const plain = view(stateFor(draft({}), NO_CAPITAL));
    expect(text(all(plain, hasClass('rstmt__card--retry')))).toContain('明細がありません');
    expect(text(region(plain))).toBe('');
  });

  it('#10: 1 枚目の値があるままキャンセル → 要約のまま + 状態の 1 行に「読み取りをキャンセルしました」', () => {
    const f = filledE1();
    const t = view({ ...stateFor(f.draft, NO_CAPITAL), readCancelled: true });
    expect(area(t).props['data-area']).toBe('summary');
    const st = visible(t)[0] as El;
    expect(text(st)).toBe('読み取りをキャンセルしました');
    expect(cls(st)).toContain('rsum__status--cancelled');
    expect(text(region(t))).toBe('読み取りをキャンセルしました');
  });

  it('#7・#8: 失敗は今の警告のまま（領域は空・状態の 1 行なし）', () => {
    const t = view(
      withStatement(draft({}), { phase: 'failed', message: READ_MSG.failed, rows: [] }),
    );
    expect(text(region(t))).toBe('');
    expect(visible(t)).toHaveLength(0);
    expect(text(all([area(t)], (e) => e.props.role === 'alert'))).toBe(READ_MSG.failed);
    const f = filledE1();
    const t8 = view(
      withStatement(f.draft, { phase: 'failed', message: READ_MSG.failed, rows: [], marks: {} }),
    );
    expect(area(t8).props['data-area']).toBe('summary');
    expect(visible(t8)).toHaveLength(0);
    expect(all(t8, hasClass('rsum__mark'))).toHaveLength(0);
  });

  it('#14: 次の行へ進んだ → 知らせ 1 つだけ（完了の文・領域の文なし）。#15: 手入力 → 出ない', () => {
    const f = filledE1();
    const notice = '1 / 2 行目を記録しました。次の行（2 / 2）です';
    const t = view(
      withStatement(f.draft, { marks: f.marks, rows: [ROW_E1, ROW_E1], index: 1, notice }),
    );
    expect(visible(t)).toHaveLength(0);
    expect(text(region(t))).toBe('');
    expect(all(t, (e) => text(e) === notice && e.type === 'p')).toHaveLength(1);
    // 次の行は名前の右の印「読み取り」（今のまま）
    expect(text(all(t, hasClass('rsum__mark')))).toBe('読み取り');
    const manual = view({ ...stateFor(draft({}), NO_CAPITAL), manual: true });
    expect(area(manual).props['data-area']).toBe('summary');
    expect(visible(manual)).toHaveLength(0);
    expect(text(region(manual))).toBe('');
  });

  it('動きの印: readFlash の間だけ明細の行に rstmt--flash（hook の層が 1 回だけ立てる）', () => {
    expect(cls(area(view(filled())))).toBe('rstmt');
    expect(cls(area(view(filled(), { readFlash: true })))).toBe('rstmt rstmt--flash');
  });

  it('KEEP-6: 状態を渡さない要約のカード（編集の画面）は名前の右の印「読み取り」のまま・状態の 1 行なし', () => {
    const d = draft({ side: 'L', entryPrice: '100', exitPrice: '99' });
    const sum = tradeSummary(d, {}, { instrumentName: 'read' });
    const t = expand(
      SummaryCard({ prefix: 'edit', summary: sum, accountChip: null, onFields: noop }),
    );
    expect(all(t, hasClass('rsum__status'))).toHaveLength(0);
    expect(text(all(t, hasClass('rsum__mark')))).toBe('読み取り');
    expect(cls(all(t, hasClass('rsum__head'))[0] as El)).toBe('rsum__head');
  });
});

describe('明細の削除と ［元に戻す］（#184。1 段目の明細の枠）', () => {
  const byId = (t: Node[], id: string) => all(t, (e) => e.props.id === id);

  it('読めた明細は ［スクショを変更］ の横に 2 番目の重さの ［削除］（読み上げ「明細を削除」）。押すと onRemoveStatement', () => {
    let removed = 0;
    const f = filledE1();
    const tree = view(
      { ...withStatement(f.draft, { marks: f.marks }), stage: 'input' },
      { onRemoveStatement: () => removed++ },
    );
    const btn = byId(tree, STATEMENT_REMOVE_ID)[0] as El;
    expect(text(btn)).toBe('削除');
    expect(btn.props['aria-label']).toBe('明細を削除');
    expect(String(btn.props.class)).toContain('btn--secondary');
    // ［スクショを変更］ も小さい形で 1 行に（デザインレビュー 4）
    const change = all(
      tree,
      (e) => e.type === 'label' && e.props.for === 'record-statement-file',
    )[0] as El;
    expect(String(change.props.class)).toContain('btn--sm');
    (btn.props.onClick as () => void)();
    expect(removed).toBe(1);
    const label = all(tree, (e) => e.type === 'label' && e.props.for === 'record-statement-file');
    expect(text(label)).toBe('スクショを変更');
    // 削除の前は知らせの 1 行は空（読み上げの領域だけ）
    const live = all(tree, hasClass('rin__removed'))[0] as El;
    expect(live.props.role).toBe('status');
    expect(text(live)).toBe('');
  });

  it('例 #11: 読み取り中は ［削除］ を出さない（［読み取りをキャンセル］）', () => {
    const tree = view({ ...withStatement(E1, { phase: 'reading' }, true), stage: 'input' });
    expect(byId(tree, STATEMENT_REMOVE_ID)).toEqual([]);
    expect(byId(tree, STAGE1_CANCEL_ID)).toHaveLength(1);
  });

  it('削除の後: 枠は空の形（主の ［スクショを選ぶ］）と 1 行「明細を削除しました」・［元に戻す］。押すと onUndoRemoveStatement', () => {
    let undo = 0;
    const tree = view(
      { ...stateFor(draft({ lc: '99.5' }), NO_CAPITAL), stage: 'input', statementRemoved: true },
      { onUndoRemoveStatement: () => undo++ },
    );
    const label = all(tree, (e) => e.type === 'label' && e.props.for === 'record-statement-file');
    expect(text(label)).toBe('スクショを選ぶ');
    expect(String((label[0] as El).props.class)).toContain('btn--primary');
    expect(byId(tree, STATEMENT_REMOVE_ID)).toEqual([]);
    const live = all(tree, hasClass('rin__removed'))[0] as El;
    expect(live.props.role).toBe('status');
    expect(text(live)).toContain(STATEMENT_REMOVED);
    // 何が消えて何が残るかを言う（デザインレビュー 2）
    expect(STATEMENT_REMOVED).toBe(
      '明細の値を削除しました。LC・一言・タップ・チャートは残っています',
    );
    // 文のすぐ右に ［元に戻す］、置き場は枠の本文の直後（注意より前。デザインレビュー 3）
    const card = all(tree, hasClass('rin__card'))[0] as El;
    const kids = card.children.filter((c): c is El => typeof c !== 'string');
    const order = kids.map((k) => String(k.props.class ?? ''));
    expect(order.indexOf('rin__removed')).toBe(order.indexOf('rin__body') + 1);
    expect(
      live.children.filter((c) => typeof c !== 'string').map((c) => (c as El).props.id),
    ).toEqual([undefined, STATEMENT_UNDO_ID]);
    // 説明の文は 1 行に任せる（読み上げの領域だけ残す）
    const desc = all([card], hasClass('rin__desc'))[0] as El;
    expect(text(desc)).toBe('');
    const btn = byId(tree, STATEMENT_UNDO_ID)[0] as El;
    expect(text(btn)).toBe('元に戻す');
    expect(btn.props['aria-label']).toBe('明細の削除を元に戻す');
    (btn.props.onClick as () => void)();
    expect(undo).toBe(1);
  });

  it('R6: 読み直しが失敗して前の明細に戻した → 1 段目・2 段目の明細の枠に「…。前の明細に戻しました。」の警告（「手入力」は無い）。要約は出たまま', () => {
    const f = filledE1();
    const st = withStatement(f.draft, {
      marks: f.marks,
      reverted: { kind: 'failed', message: READ_MSG.limited },
    });
    for (const t of [view({ ...st, stage: 'input' }), view(st)]) {
      const alerts = all(t, (e) => e.props.role === 'alert');
      expect(alerts.map(text)).toContain(
        '今日の読み取りの上限に達しました。前の明細に戻しました。',
      );
      expect(alerts.map(text).join('')).not.toContain('手入力');
    }
    const area = all(view(st), hasClass('rstmt'))[0] as El;
    expect(area.props['data-area']).toBe('summary');
  });
});

describe('読み直しの途中（#184 のデザインレビュー 5）', () => {
  it('「別の明細を読み取り中…」と、読み上げ「読み取りをキャンセルして前の明細に戻す」の ［キャンセル］', () => {
    const tree = view(withStatement(E1, { phase: 'reading', rereading: true }, true));
    expect(text(all(tree, hasClass('rsum__status--reading')))).toBe('別の明細を読み取り中…');
    const cancel = all(
      tree,
      (e) =>
        e.type === 'button' && e.props['aria-label'] === '読み取りをキャンセルして前の明細に戻す',
    );
    expect(cancel).toHaveLength(1);
  });
});
