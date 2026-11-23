// 心理のタグの言葉とシート・詳細のカード（Issue #156 の AC-1・AC-3・AC-7・AC-8・KEEP-1）。DOM のライブラリを使わず、
// 部品の関数を呼んで要素の木に展開して見る（View と部品は hook を持たない。Link は a、InfoTip・Sheet は helpers/info-tip.ts で
// hook を持たない木に置き換える）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { EMOTION_TAG_IDS, type EmotionTagId, toggleEmotion } from '../../core/emotion-tags';
import type { StoredTrade } from '../../core/record';
import { EmotionSheetBody } from '../../ui/src/components/Emotions';
import { DETAIL_SHEET_ID } from '../../ui/src/lib/detail-view';
import type { EmotionState } from '../../ui/src/lib/emotion-controller';
import {
  closeLabelOf,
  EMOTION_CALM_NOTE,
  EMOTION_EMPTY,
  EMOTION_SAVE_FAILED,
  EMOTION_TEXT,
  EMOTION_TRAIL_HINT,
  emotionGroups,
  emotionSheetTitle,
} from '../../ui/src/lib/emotion-tags';
import { summarize } from '../../ui/src/lib/record-form';
import { reviewItemOf } from '../../ui/src/lib/review-view';
import { Link } from '../../ui/src/lib/router';
import type { DetailState } from '../../ui/src/lib/trade-detail-controller';
import { RecordView } from '../../ui/src/pages/Record';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { closedInfoTip } from './helpers/info-tip';
import { E1, INSTRUMENTS, L1, L2, L3 } from './helpers/trade-examples';

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

/** Issue #156 の本文の「心理のタグの一覧」の表（まとまり・名前・一言。この順） */
const ISSUE_TABLE: readonly (readonly [string, string, string])[] = [
  ['良い状態', '平常心', '心穏やか・淡々と。計画どおりに動けた状態'],
  ['恐れ', '怖い', '含み損や値動きが怖くて判断が止まる'],
  // 一言の「入った後」は画面の言葉の規則（ui-guidelines 8.2）で「エントリーの後」にした（名前・まとまり・順は表のまま）
  ['恐れ', 'ドキドキ', 'エントリーの後に落ち着かない・迷う（数量が大きすぎるサイン）'],
  ['恐れ', '辛い', '資金が減るのを見て嫌な気分・パニックに近い'],
  ['恐れ', '減るのが嫌', '資金が減ることを嫌って損を確定できない'],
  ['恐れ', '安心したい', '根拠より安心感を求めて LC を近く・金額で置く'],
  ['恐れ', '利確を急ぐ', '含み益が減るのが嫌で TP の前に決済する'],
  ['欲', '儲けたい', 'お金を儲けたい気持ちが入りの理由になる'],
  ['欲', '大儲けしたい', '一発で大きく取りたい・賭けたい'],
  ['欲', 'ポジりたい', '根拠より「ポジションを持ちたい」が先に立つ'],
  ['欲', '乗り遅れ怖い', '置いていかれる焦りで入る'],
  ['欲', '調子に乗った', '勝ちが続いて全能感 → 過剰リスク・根拠の無いエントリー・オーバーサイズ'],
  ['取り戻し', '取り戻したい', '負け・減った含み益を取り返したい'],
  ['取り戻し', '悔しい', 'LC の後に思惑の方向へ戻った・狩られたのが悔しい'],
  ['取り戻し', '腹立たしい', 'LC に怒り・やり返したい'],
  ['取り戻し', '取り逃した', '取れたはずの値幅を逃して惜しい'],
  ['取り戻し', '後悔', '〜しておけばよかった・やるべきでなかった'],
  ['思い込み', '祈り', '戻るはずと希望で持ち続ける'],
  ['思い込み', '切れない', 'LC をためらう・遅れる・放置する'],
  ['思い込み', '都合よく解釈', '入りたいから根拠を探す・都合のいい情報だけ見る'],
  ['思い込み', '値ごろ感', '下げすぎ・高すぎの感覚だけで逆張りに入る'],
];

const state = (selected: EmotionTagId[] = [], over: Partial<EmotionState> = {}): EmotionState => ({
  selected,
  saved: selected,
  sending: false,
  error: null,
  ...over,
});

const sheet = (over: Partial<Parameters<typeof EmotionSheetBody>[0]> = {}) =>
  expand(
    <EmotionSheetBody
      prefix="t"
      context="saved"
      state={state()}
      onToggle={noop}
      onClose={noop}
      {...over}
    />,
  );

/** チップ（押す形）の名前と押されているか */
const chipsOf = (tree: Node[]) =>
  all(tree, hasClass('chip--toggle')).map((b) => ({
    name: text(b),
    pressed: b.props['aria-pressed'],
  }));

describe('一覧（AC-1）', () => {
  it('名前・まとまり・一言・順が Issue の表と同じ 21 個', () => {
    const rows = emotionGroups().flatMap((g) =>
      g.tags.map((t) => [g.name, t.name, EMOTION_TEXT[t.id].note] as const),
    );
    expect(rows).toEqual(ISSUE_TABLE);
  });

  it('保存の後と詳細の 2 つのシートのチップが表と同じ名前・順で出る', () => {
    const names = ISSUE_TABLE.map((r) => r[1]);
    expect(chipsOf(sheet()).map((c) => c.name)).toEqual(names);
    expect(chipsOf(sheet({ context: 'detail' })).map((c) => c.name)).toEqual(names);
  });

  it('まとまりごとの見出しの下にチップの組（fieldset）、見出しの「i」の中身は「名前 — 一言」', () => {
    const tree = sheet();
    const sets = all(tree, (e) => e.type === 'fieldset');
    expect(
      sets.map((f) => text(all(tree, (e) => e.props.id === f.props['aria-labelledby'])[0] ?? [])),
    ).toEqual(['良い状態', '恐れ', '欲', '取り戻し', '思い込み']);
    const fear = emotionGroups().find((g) => g.group === 'fear');
    expect(fear?.notes[0]).toBe('怖い — 含み損や値動きが怖くて判断が止まる');
  });
});

describe('シートの選び方（AC-3）', () => {
  it('押したチップの ID を渡し、付いているチップは aria-pressed と ✓', () => {
    const pressed: EmotionTagId[] = [];
    const tree = sheet({ state: state(['fear', 'hope']), onToggle: (id) => pressed.push(id) });
    const on = chipsOf(tree).filter((c) => c.pressed === 'true');
    expect(on.map((c) => c.name)).toEqual(['怖い', '祈り']);
    const btn = all(tree, hasClass('chip--toggle'))[0] as El;
    (btn.props.onClick as () => void)();
    expect(pressed).toEqual(['calm']);
    expect(all(tree, hasClass('chip__check'))).toHaveLength(2);
  });

  it('例 #3〜#5 をシートの押し方で通す（押した後の木）', () => {
    const run = (ids: EmotionTagId[]) => {
      let s: EmotionTagId[] = [];
      for (const id of ids) s = toggleEmotion(s, id);
      return chipsOf(sheet({ state: state(s) }))
        .filter((c) => c.pressed === 'true')
        .map((c) => c.name);
    };
    expect(run(['calm', 'fear'])).toEqual(['怖い']);
    expect(run(['fear', 'hope', 'calm'])).toEqual(['平常心']);
    expect(run(['frustrated', 'frustrated'])).toEqual([]);
  });

  it('下の帯: 保存の後で何も付いていなければ ［あとで］、付いていれば・詳細なら ［完了］', () => {
    expect(closeLabelOf('saved', 0)).toBe('あとで');
    expect(closeLabelOf('saved', 2)).toBe('完了');
    expect(closeLabelOf('detail', 0)).toBe('完了');
    const closed: string[] = [];
    const tree = sheet({ onClose: () => closed.push('x') });
    const btn = all(tree, (e) => e.type === 'button' && text(e) === 'あとで')[0] as El;
    (btn.props.onClick as () => void)();
    expect(closed).toEqual(['x']);
  });

  it('保存の後の判定: 1 件はバッジと R と理由の 1 行、2 件以上はバッジの並び（件数は題。詳細では出さない）', () => {
    const one = sheet({
      verdicts: [{ grade: 'B', r: -1.6, reason: 'LC を広げた（99.5 → 99.2）' }],
    });
    expect(text(all(one, hasClass('emotions__verdicts')))).toContain('−1.6R');
    expect(text(all(one, hasClass('emotions__reason')))).toBe('LC を広げた（99.5 → 99.2）');
    const three = sheet({
      verdicts: [{ grade: 'A', r: -1, reason: 'x' }, { grade: 'B', r: -1.6 }, { grade: null }],
    });
    expect(all(three, hasClass('emotions__reason'))).toEqual([]);
    expect(emotionSheetTitle(3)).toBe('3 件を記録しました');
    expect(emotionSheetTitle(1)).toBe('記録しました');
    expect(all(three, hasClass('emotions__badge'))).toHaveLength(3);
    expect(text(three)).not.toContain('R なし');
    const detail = sheet({ context: 'detail', verdicts: [{ grade: 'A', r: -1 }] });
    expect(all(detail, hasClass('emotions__verdicts'))).toEqual([]);
  });

  it('平常心: 区切りの塊と「ほかと同時には付きません」の添え書き（組の説明に結ぶ）。見出しは保存の後だけ', () => {
    const tree = sheet();
    const good = all(tree, hasClass('emotions__group--good'))[0] as El;
    expect(text(all([good], hasClass('emotions__gnote')))).toBe(EMOTION_CALM_NOTE);
    const set = all([good], (e) => e.type === 'fieldset')[0] as El;
    expect(set.props['aria-describedby']).toBe('t-emotion-good-note');
    expect(all(tree, hasClass('emotions__group--good'))).toHaveLength(1);
    expect(all(tree, hasClass('emotions__heading'))).toHaveLength(1);
    expect(all(sheet({ context: 'detail' }), hasClass('emotions__heading'))).toEqual([]);
  });

  it('色を付けない: チップに判定の段の class が無い（C34）', () => {
    const tree = sheet({ state: state(['fear']) });
    for (const c of all(tree, hasClass('chip'))) expect(cls(c)).not.toMatch(/tier|badge/);
  });
});

describe('失敗（AC-7）', () => {
  it('失敗の文言は role="alert" で出る', () => {
    const tree = sheet({ state: state([], { error: EMOTION_SAVE_FAILED }) });
    const alerts = all(tree, (e) => e.props.role === 'alert');
    expect(alerts.map(text)).toEqual([EMOTION_SAVE_FAILED]);
  });
});

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

describe('詳細の心理のカード（AC-8）', () => {
  it('例 #1: 付いているタグを一覧の順の札（押せない）で並べ、［変更］ で同じシートを開く', () => {
    const t: StoredTrade = { ...L1, emotionTags: ['wantPosition', 'recoup'] };
    const opened: unknown[] = [];
    const tree = detailTree(t, { onSheet: (s) => opened.push(s) });
    const card = all(tree, hasClass('emotioncard'))[0] as El;
    expect(all([card], hasClass('emotioncard__tag')).map(text)).toEqual([
      'ポジりたい',
      '取り戻したい',
    ]);
    // 札は押せない（押せるチップの形ではない）
    expect(all([card], hasClass('chip'))).toEqual([]);
    const add = all([card], (e) => e.type === 'button' && text(e) === '変更')[0] as El;
    expect(add.props['aria-label']).toBe('心理を変更');
    (add.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'emotion' }]);
  });

  it('#188 AC-1（E6）: 行き先があれば、付いているタグは一覧の順の押せるチップ（リンク）で、行き先はそのタグ', () => {
    const t: StoredTrade = { ...L1, emotionTags: ['recoup', 'wantPosition'] };
    const asked: EmotionTagId[] = [];
    const tree = detailTree(t, {
      emotionHref: (id) => {
        asked.push(id);
        return `/review/trades?period=3m&emotion=${id}`;
      },
    });
    const card = all(tree, hasClass('emotioncard'))[0] as El;
    const links = all([card], (e) => e.type === 'a' && hasClass('chip')(e));
    expect(links.map(text)).toEqual(['ポジりたい', '取り戻したい']);
    expect(links.map((a) => a.props.href)).toEqual([
      '/review/trades?period=3m&emotion=wantPosition',
      '/review/trades?period=3m&emotion=recoup',
    ]);
    // AC-6: リンクだけ（押しても心理の付け外し・シートの操作はしない）
    expect(links.every((a) => a.props.onClick === undefined)).toBe(true);
    expect(asked).toEqual(['wantPosition', 'recoup']);
    // 押した時点で行き先を決め直す（日付をまたいでも押した日で決める。コードレビュー 3）: 押すたびに行き先を作り直す
    const resolve = links[1]?.props.hrefAtClick as () => string;
    expect(resolve()).toBe('/review/trades?period=3m&emotion=recoup');
    expect(asked).toEqual(['wantPosition', 'recoup', 'recoup']);
    // 押せない札は出さず、添えの 1 行を出す。［変更］ は今までどおり
    expect(all([card], hasClass('emotioncard__tag'))).toEqual([]);
    expect(text(all([card], hasClass('emotioncard__hint')))).toBe(EMOTION_TRAIL_HINT);
    expect(all([card], (e) => e.type === 'button' && text(e) === '変更')).toHaveLength(1);
  });

  it('#188 E10: タグが無ければ行き先があっても「＋ 心理を付ける」だけ（チップ・添えなし）', () => {
    const tree = detailTree(L2, { emotionHref: () => '/review/trades' });
    const card = all(tree, hasClass('emotioncard'))[0] as El;
    expect(all([card], hasClass('chip'))).toEqual([]);
    expect(all([card], hasClass('emotioncard__hint'))).toEqual([]);
    expect(text(all([card], hasClass('rowlink'))[0] as El)).toContain(EMOTION_EMPTY);
  });

  it('例 #2: タグが無ければ押せる行「＋ 心理を付ける」', () => {
    const opened: unknown[] = [];
    const tree = detailTree(L2, { onSheet: (s) => opened.push(s) });
    const card = all(tree, hasClass('emotioncard'))[0] as El;
    expect(all([card], hasClass('emotioncard__tag'))).toEqual([]);
    const row = all([card], hasClass('rowlink'))[0] as El;
    expect(text(row)).toContain(EMOTION_EMPTY);
    (row.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'emotion' }]);
  });

  it('シートは題「心理」で、開いているときだけ open。中身は詳細の形（判定なし・［完了］）', () => {
    const t: StoredTrade = { ...L3, emotionTags: ['bargain'] };
    const tree = detailTree(t, { sheet: { kind: 'emotion' }, emotion: state(['bargain']) });
    const wrap = all(tree, (e) => e.props['data-sheet'] === DETAIL_SHEET_ID.emotion)[0] as El;
    expect(wrap.props['data-open']).toBe('true');
    expect(text(all([wrap], hasClass('sheet__title')))).toBe('心理');
    expect(
      chipsOf([wrap])
        .filter((c) => c.pressed === 'true')
        .map((c) => c.name),
    ).toEqual(['値ごろ感']);
    expect(all([wrap], (e) => e.type === 'button' && text(e) === '完了')).toHaveLength(1);
    const closed = detailTree(t, { emotion: state(['bargain']) });
    const w2 = all(closed, (e) => e.props['data-sheet'] === DETAIL_SHEET_ID.emotion)[0] as El;
    expect(w2.props['data-open']).toBe('false');
  });

  it('シートを閉じた後の失敗はカードの下に出る', () => {
    const tree = detailTree(L1, { emotion: state([], { error: EMOTION_SAVE_FAILED }) });
    const card = all(tree, hasClass('emotioncard'))[0] as El;
    expect(all([card], (e) => e.props.role === 'alert').map(text)).toEqual([EMOTION_SAVE_FAILED]);
  });
});

describe('判定・集計はタグで変わらない（KEEP-1・例 #10）', () => {
  it('どの取引もタグを付けた前後で summarize と集計の 1 件が同じ', () => {
    for (const base of [
      L1,
      L2,
      L3,
      E1,
      { ...L1, record: { ...L1.record, source: 'import' as const } },
    ]) {
      const tagged: StoredTrade = { ...base, emotionTags: [...EMOTION_TAG_IDS.slice(1, 6)] };
      expect(summarize(tagged)).toEqual(summarize(base));
      expect(reviewItemOf(tagged)).toEqual(reviewItemOf(base));
    }
  });
});

describe('保存の後の画面（AC-4 の表示の側）', () => {
  const savedState = (trades: StoredTrade[]) => ({
    phase: 'saved' as const,
    draft: {} as never,
    instruments: INSTRUMENTS,
    accounts: [],
    read: {} as never,
    error: null,
    saved: {
      trade: trades[trades.length - 1] as StoredTrade,
      trades,
      instrumentName: 'US30',
      summary: summarize(trades[trades.length - 1] as StoredTrade),
      accountName: '口座 1',
      accountCount: 1,
    },
  });
  const recordTree = (trades: StoredTrade[], over: Record<string, unknown> = {}) =>
    expand(
      <RecordView
        state={savedState(trades) as never}
        onUpdate={noop}
        onSave={noop}
        onNext={noop}
        onReload={noop}
        onRelogin={noop}
        {...over}
      />,
    );

  it('シート「記録しました」は emotion があるときだけ置き、sheet = emotion のときに開く', () => {
    expect(all(recordTree([L1]), (e) => e.props['data-sheet'] === 'record-emotion-sheet')).toEqual(
      [],
    );
    const tree = recordTree([L1], { emotion: state(), sheet: { kind: 'emotion' } });
    const wrap = all(tree, (e) => e.props['data-sheet'] === 'record-emotion-sheet')[0] as El;
    expect(wrap.props['data-open']).toBe('true');
    expect(text(all([wrap], hasClass('sheet__title')))).toBe('記録しました');
    expect(chipsOf([wrap])).toHaveLength(21);
    expect(all([wrap], (e) => e.type === 'button' && text(e) === 'あとで')).toHaveLength(1);
    // 次の取引を記録 は今までどおり
    expect(
      all(tree, (e) => e.type === 'button' && text(e).includes('次の取引を記録')),
    ).toHaveLength(1);
  });

  it('複数行は題に保存した件数、バッジの並び', () => {
    const tree = recordTree([L1, L2, L3], { emotion: state(), sheet: { kind: 'emotion' } });
    const wrap = all(tree, (e) => e.props['data-sheet'] === 'record-emotion-sheet')[0] as El;
    expect(text(all([wrap], hasClass('sheet__title')))).toBe('3 件を記録しました');
    expect(all(tree, hasClass('emotions__badge'))).toHaveLength(3);
  });

  it('シートを閉じた後の失敗は保存の後の画面に出る（開いている間はシートの中だけ）', () => {
    const err = state([], { error: EMOTION_SAVE_FAILED });
    // 閉じた dialog の中身は DOM に残る（見えない）ので、保存の後の画面の直下の知らせだけを数える
    const panelAlerts = (tree: Node[]) =>
      all(tree, hasClass('record'))
        .flatMap((r) => r.children)
        .filter((c): c is El => typeof c !== 'string' && c.props.role === 'alert')
        .map(text);
    expect(panelAlerts(recordTree([L1], { emotion: err, sheet: null }))).toEqual([
      EMOTION_SAVE_FAILED,
    ]);
    expect(panelAlerts(recordTree([L1], { emotion: err, sheet: { kind: 'emotion' } }))).toEqual([]);
  });
});
