// Good / More の言葉とシート・詳細のカード（Issue #123 の AC-10・例 #1・#2・#10）。DOM のライブラリを使わず、部品の関数を
// 呼んで要素の木に展開して見る（View と部品は hook を持たない。InfoTip・Sheet は helpers/info-tip.ts で hook を持たない木に
// 置き換える）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import {
  EMPTY_REFLECTION,
  normalizeReflection,
  REFLECTION_TOPICS,
  type Reflection,
} from '../../core/reflection';
import { ReflectionSheetBody } from '../../ui/src/components/Reflection';
import { DETAIL_SHEET_ID } from '../../ui/src/lib/detail-view';
import { summarize } from '../../ui/src/lib/record-form';
import {
  noteIssueText,
  REFLECTION_EMPTY,
  REFLECTION_SAVE_FAILED,
  REFLECTION_TOPIC_NAME,
  topicChoices,
} from '../../ui/src/lib/reflection';
import type { ReflectionState } from '../../ui/src/lib/reflection-controller';
import { Link } from '../../ui/src/lib/router';
import type { DetailState } from '../../ui/src/lib/trade-detail-controller';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { closedInfoTip } from './helpers/info-tip';
import { INSTRUMENTS, L1, L2 } from './helpers/trade-examples';

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

const EX1: Reflection = normalizeReflection({
  good: { topics: ['cutEarly'], notes: [] },
  more: { topics: ['lcTooTight', 'enteredEarly'], notes: ['出る前に TP を決める'] },
});

const state = (value: Reflection = EMPTY_REFLECTION, over: Partial<ReflectionState> = {}) =>
  ({
    value,
    saved: value,
    drafts: { good: '', more: '' },
    noteIssues: { good: null, more: null },
    sending: false,
    error: null,
    ...over,
  }) satisfies ReflectionState;

function detailState(t: StoredTrade): DetailState {
  return {
    phase: 'ready',
    trade: t,
    instruments: INSTRUMENTS,
    accounts: [],
    instrumentName: 'US30',
    summary: summarize(t),
    charts: { entry: { phase: 'none' }, exit: { phase: 'none' } },
  };
}

function detailTree(t: StoredTrade, over: Partial<Parameters<typeof TradeDetailView>[0]> = {}) {
  return expand(
    <TradeDetailView
      id={t.id}
      state={detailState(t)}
      hidden={new Set()}
      notFound={notFoundState()}
      onDelete={noop}
      onReloadChart={noop}
      onReload={noop}
      onRelogin={noop}
      {...over}
    />,
  );
}

const sheetTree = (over: Partial<Parameters<typeof ReflectionSheetBody>[0]> = {}) =>
  expand(
    <ReflectionSheetBody
      prefix="t"
      state={state()}
      onToggle={noop}
      onDraft={noop}
      onAddNote={noop}
      onRemoveNote={noop}
      onClose={noop}
      {...over}
    />,
  );

const chipsOf = (tree: Node[]) =>
  all(tree, hasClass('chip--toggle')).map((b) => ({
    name: text(b),
    pressed: b.props['aria-pressed'],
  }));

describe('話題の言葉', () => {
  it('Good 7・More 7 の名前が Issue の表の順で出る', () => {
    expect(topicChoices('good').map((c) => c.name)).toEqual([
      '早めに撤退できた',
      '方向の読みは合っていた',
      'ルールどおりに動けた',
      '利を伸ばせた',
      '衝動を抑えられた',
      '欲張らずに決済した',
      'サインが出るまで待てた',
    ]);
    expect(topicChoices('more').map((c) => c.name)).toEqual([
      '根拠が揃う前に入った',
      '上位足の流れに逆らった',
      '数量が多すぎた',
      'LC が近すぎた',
      '出口を決めていなかった',
      'すぐ再エントリーした',
      '発注を間違えた',
    ]);
    // 名前の表は一覧の ID だけを持つ
    expect(Object.keys(REFLECTION_TOPIC_NAME).sort()).toEqual(
      [...REFLECTION_TOPICS.good, ...REFLECTION_TOPICS.more].sort(),
    );
  });
});

describe('シート', () => {
  it('Good と More の段に 7 個ずつのチップ。付いているチップは aria-pressed', () => {
    const tree = sheetTree({ state: state(EX1) });
    const chips = chipsOf(tree);
    expect(chips).toHaveLength(14);
    expect(chips.filter((c) => c.pressed === 'true').map((c) => c.name)).toEqual([
      '早めに撤退できた',
      '根拠が揃う前に入った',
      'LC が近すぎた',
    ]);
    // 色を付けない（判定の段の class が無い。C34）
    expect(all(tree, (e) => /grade|badge--/.test(cls(e)))).toEqual([]);
  });

  it('押すとその段と ID を渡す。行の削除・追加・書きかけも段と位置を渡す', () => {
    const got: unknown[] = [];
    const tree = sheetTree({
      state: state(EX1, { drafts: { good: '', more: '架空' } }),
      onToggle: (side, id) => got.push(['toggle', side, id]),
      onDraft: (side, v) => got.push(['draft', side, v]),
      onAddNote: (side) => got.push(['add', side]),
      onRemoveNote: (side, i) => got.push(['remove', side, i]),
    });
    const chip = all(tree, (e) => hasClass('chip--toggle')(e) && text(e) === '数量が多すぎた')[0];
    ((chip as El).props.onClick as () => void)();
    const remove = all(
      tree,
      (e) => e.props['aria-label'] === 'More の行を削除: 出る前に TP を決める',
    )[0];
    ((remove as El).props.onClick as () => void)();
    const addMore = all(
      tree,
      (e) => e.type === 'button' && e.props['aria-label'] === 'More に追加',
    )[0];
    ((addMore as El).props.onClick as () => void)();
    const input = all(
      tree,
      (e) => e.type === 'input' && e.props.id === 't-reflection-good-note',
    )[0];
    ((input as El).props.onInput as (ev: unknown) => void)({ currentTarget: { value: 'x' } });
    expect(got).toEqual([
      ['toggle', 'more', 'oversized'],
      ['remove', 'more', 0],
      ['add', 'more'],
      ['draft', 'good', 'x'],
    ]);
  });

  it('例 #2: 自分で書いた行は足した順に並ぶ（テキストのノード）', () => {
    const r = normalizeReflection({ more: { topics: [], notes: ['1 行目', '<b>2 行目</b>'] } });
    const tree = sheetTree({ state: state(r) });
    expect(all(tree, hasClass('reflection__notetext')).map(text)).toEqual([
      '1 行目',
      '<b>2 行目</b>',
    ]);
    expect(all(tree, (e) => 'dangerouslySetInnerHTML' in e.props)).toEqual([]);
  });

  it('足せない理由は欄の誤りで、保存の失敗は role="alert"', () => {
    const tree = sheetTree({
      state: state(EMPTY_REFLECTION, {
        noteIssues: { good: 'tooLong', more: null },
        error: REFLECTION_SAVE_FAILED,
      }),
    });
    expect(text(tree)).toContain(noteIssueText('tooLong'));
    expect(all(tree, (e) => e.props.role === 'alert').map(text)).toContain(REFLECTION_SAVE_FAILED);
    // 下の帯は ［完了］ だけ（閉じるだけ）
    expect(all(tree, (e) => e.type === 'button' && text(e) === '完了')).toHaveLength(1);
  });
});

describe('詳細の Good / More のカード（AC-10）', () => {
  it('例 #1: 付いている話題を札で、行を箇条で並べ、［変更］ でシートを開く', () => {
    const opened: unknown[] = [];
    const tree = detailTree({ ...L1, reflection: EX1 }, { onSheet: (s) => opened.push(s) });
    const card = all(tree, hasClass('reflectioncard'))[0] as El;
    expect(all([card], hasClass('reflectioncard__sname')).map(text)).toEqual([
      'Good — 良かったこと',
      'More — 次はこうする',
    ]);
    expect(all([card], hasClass('emotioncard__tag')).map(text)).toEqual([
      '早めに撤退できた',
      '根拠が揃う前に入った',
      'LC が近すぎた',
    ]);
    expect(text(all([card], hasClass('reflectioncard__notes')))).toBe('出る前に TP を決める');
    expect(all([card], hasClass('chip'))).toEqual([]);
    const change = all([card], (e) => e.type === 'button' && text(e) === '変更')[0] as El;
    expect(change.props['aria-label']).toBe('Good / More を変更');
    (change.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'reflection' }]);
  });

  it('付いていなければ押せる行「＋ Good / More を書く」', () => {
    const opened: unknown[] = [];
    const tree = detailTree(L2, { onSheet: (s) => opened.push(s) });
    const card = all(tree, hasClass('reflectioncard'))[0] as El;
    expect(all([card], hasClass('reflectioncard__side'))).toEqual([]);
    const row = all([card], hasClass('rowlink'))[0] as El;
    expect(text(row)).toContain(REFLECTION_EMPTY);
    (row.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'reflection' }]);
  });

  it('片側だけなら、その段だけ出す', () => {
    const r = normalizeReflection({ good: { topics: [], notes: ['架空の一言'] } });
    const tree = detailTree({ ...L1, reflection: r });
    const card = all(tree, hasClass('reflectioncard'))[0] as El;
    expect(all([card], hasClass('reflectioncard__sname')).map(text)).toEqual([
      'Good — 良かったこと',
    ]);
  });

  it('シートは題「Good / More」で、開いているときだけ open。閉じた後の失敗はカードの下に出る', () => {
    const t = { ...L1, reflection: EX1 };
    const tree = detailTree(t, { sheet: { kind: 'reflection' }, reflection: state(EX1) });
    const wrap = all(tree, (e) => e.props['data-sheet'] === DETAIL_SHEET_ID.reflection)[0] as El;
    expect(wrap.props['data-open']).toBe('true');
    expect(text(all([wrap], hasClass('sheet__title')))).toBe('Good / More');
    const closed = detailTree(t, { reflection: state(EX1, { error: REFLECTION_SAVE_FAILED }) });
    const w2 = all(closed, (e) => e.props['data-sheet'] === DETAIL_SHEET_ID.reflection)[0] as El;
    expect(w2.props['data-open']).toBe('false');
    const card = all(closed, hasClass('reflectioncard'))[0] as El;
    expect(all([card], (e) => e.props.role === 'alert').map(text)).toEqual([
      REFLECTION_SAVE_FAILED,
    ]);
  });
});
