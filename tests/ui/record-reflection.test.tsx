// 記録の保存の後のシート「記録しました」の Good / More の段（Issue #220 の AC-1〜AC-10・例 1〜11・KEEP-3）。
// 表示は RecordView を要素の木に展開して見る（View と部品は hook を持たない。InfoTip・Sheet は helpers/info-tip.ts で
// hook を持たない木に置き換える）。送りは記録の controller を偽の API で回し、保存した取引（SavedView.trades）をそのまま
// reflection-controller に渡して、偽の API に届いた本文を見る（画面の hook と同じ組み立て）。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { EmotionTagId } from '../../core/emotion-tags';
import type { StoredTrade } from '../../core/record';
import { EMPTY_REFLECTION, normalizeReflection, type Reflection } from '../../core/reflection';
import { ReflectionSheetBody } from '../../ui/src/components/Reflection';
import type { EmotionState } from '../../ui/src/lib/emotion-controller';
import { EMOTION_HEADING } from '../../ui/src/lib/emotion-tags';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import { applyDraft, EMPTY_DRAFT, summarize } from '../../ui/src/lib/record-form';
import {
  noteIssueText,
  REFLECTION_COMPOSE,
  REFLECTION_SAVE_FAILED,
  reflectionHasInput,
  topicChoices,
} from '../../ui/src/lib/reflection';
import {
  createReflectionController,
  type ReflectionController,
  type ReflectionState,
} from '../../ui/src/lib/reflection-controller';
import { createRequest } from '../../ui/src/lib/request';
import { Link } from '../../ui/src/lib/router';
import { RecordView } from '../../ui/src/pages/Record';
import { createFakeApi, type FakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { E1, US30 } from './helpers/record-drafts';
import {
  blobOf,
  fakePreview,
  pngBytes,
  preparedImage,
  ROWS_E10,
  statementBody,
} from './helpers/statement-rows';
import { INSTRUMENTS, L1, L2, L3 } from './helpers/trade-examples';

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

const emotion = (selected: EmotionTagId[] = []): EmotionState => ({
  selected,
  saved: selected,
  opened: selected,
  sending: false,
  error: null,
});

const reflection = (value: Reflection = EMPTY_REFLECTION, over: Partial<ReflectionState> = {}) =>
  ({
    value,
    saved: value,
    drafts: { good: '', more: '' },
    noteIssues: { good: null, more: null },
    sending: false,
    error: null,
    ...over,
  }) satisfies ReflectionState;

const NONE = { good: false, more: false } as const;

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

const recordTree = (over: Partial<Parameters<typeof RecordView>[0]> = {}, trades = [L1]) =>
  expand(
    <RecordView
      state={savedState(trades) as never}
      onUpdate={noop}
      onSave={noop}
      onNext={noop}
      onReload={noop}
      onRelogin={noop}
      emotion={emotion()}
      reflection={reflection()}
      reflectionComposing={NONE}
      sheet={{ kind: 'emotion' }}
      {...over}
    />,
  );

const sheetOf = (tree: Node[]) =>
  all(tree, (e) => e.props['data-sheet'] === 'record-emotion-sheet')[0] as El;
const closeButton = (tree: Node[]) =>
  all([sheetOf(tree)], hasClass('emotions__actions'))
    .flatMap((a) => all([a], (e) => e.type === 'button'))
    .at(0) as El;
const fieldOf = (tree: Node[], side: 'good' | 'more') =>
  all(tree, (e) => e.type === 'input' && e.props.id === `record-reflection-${side}-note`);

describe('保存の後のシートの Good / More の段（表示）', () => {
  it('AC-1: 心理の段の下に Good と More の段。話題は C58 の順に 7 + 7 個の押す形のチップ', () => {
    const wrap = sheetOf(recordTree());
    const heads = all([wrap], (e) => /^h[1-6]$/.test(e.type)).map(text);
    const iEmotion = heads.indexOf(EMOTION_HEADING);
    const iGood = heads.findIndex((h) => h.startsWith('Good'));
    const iMore = heads.findIndex((h) => h.startsWith('More'));
    expect(iEmotion).toBeGreaterThanOrEqual(0);
    expect(iEmotion).toBeLessThan(iGood);
    expect(iGood).toBeLessThan(iMore);
    expect(heads[iGood]).toBe('Good — 良かったこと');
    expect(heads[iMore]).toBe('More — 次はこうする');
    const chips = all([wrap], hasClass('reflection__chips')).flatMap((f) =>
      all([f], hasClass('chip--toggle')).map(text),
    );
    expect(chips).toEqual([...topicChoices('good'), ...topicChoices('more')].map((t) => t.name));
    // 色を付けない（判定の段の class が Good / More の段に無い。C34）
    expect(all(all([wrap], hasClass('reflection')), (e) => /grade|badge--/.test(cls(e)))).toEqual(
      [],
    );
  });

  it('AC-4: 「＋ 自分で書く」を押すまで欄は出ない。押すとその段を渡す', () => {
    const got: string[] = [];
    const tree = recordTree({
      onReflection: {
        toggle: noop,
        draft: noop,
        add: noop,
        remove: noop,
        compose: (side) => got.push(side),
        done: () => true,
      },
    });
    expect(fieldOf(tree, 'good')).toHaveLength(0);
    expect(fieldOf(tree, 'more')).toHaveLength(0);
    const compose = all(tree, (e) => e.type === 'button' && text(e) === REFLECTION_COMPOSE);
    expect(compose.map((b) => b.props['aria-label'])).toEqual([
      'Good を自分で書く',
      'More を自分で書く',
    ]);
    ((compose[1] as El).props.onClick as () => void)();
    expect(got).toEqual(['more']);
    // 開いた段だけ欄（［＋ 自分で書く］ は消える）
    const open = recordTree({ reflectionComposing: { good: false, more: true } });
    expect(fieldOf(open, 'good')).toHaveLength(0);
    expect(fieldOf(open, 'more')).toHaveLength(1);
    expect(
      all(open, (e) => e.type === 'button' && text(e) === REFLECTION_COMPOSE).map(
        (b) => b.props['aria-label'],
      ),
    ).toEqual(['Good を自分で書く']);
  });

  it('書きかけ・足せない理由がある段は、たたんでいても欄を出す（書きかけを隠さない）', () => {
    const tree = recordTree({
      reflection: reflection(EMPTY_REFLECTION, {
        drafts: { good: '架空の書きかけ', more: '' },
        noteIssues: { good: null, more: 'tooLong' },
      }),
    });
    expect(fieldOf(tree, 'good')).toHaveLength(1);
    expect(fieldOf(tree, 'more')).toHaveLength(1);
    // AC-7 の表示: 理由は欄の下
    expect(text(sheetOf(tree))).toContain(noteIssueText('tooLong'));
  });

  it('AC-5: 何も付いておらず書きかけも無ければ ［あとで］（例 3）、心理だけ（例 8）・書きかけだけ（例 11）・話題だけなら ［完了］', () => {
    expect(text(closeButton(recordTree()))).toBe('あとで');
    expect(text(closeButton(recordTree({ emotion: emotion(['calm']) })))).toBe('完了');
    expect(
      text(
        closeButton(
          recordTree({
            reflection: reflection(EMPTY_REFLECTION, { drafts: { good: '架空', more: '' } }),
          }),
        ),
      ),
    ).toBe('完了');
    const topic = normalizeReflection({ good: { topics: ['cutEarly'], notes: [] } });
    expect(text(closeButton(recordTree({ reflection: reflection(topic) })))).toBe('完了');
    // 空白だけの書きかけは無いのと同じ
    expect(
      text(
        closeButton(
          recordTree({
            reflection: reflection(EMPTY_REFLECTION, { drafts: { good: '  ', more: '' } }),
          }),
        ),
      ),
    ).toBe('あとで');
  });

  it('［あとで］ / ［完了］ は書きかけを足せたときだけ閉じる（AC-6・AC-7 の画面の側）', () => {
    for (const ok of [true, false]) {
      const closed: unknown[] = [];
      const tree = recordTree({
        onSheet: (s) => closed.push(s),
        onReflection: {
          toggle: noop,
          draft: noop,
          add: noop,
          remove: noop,
          compose: noop,
          done: () => ok,
        },
      });
      (closeButton(tree).props.onClick as () => void)();
      expect(closed).toEqual(ok ? [null] : []);
    }
  });

  it('AC-9: 送りの失敗はシートの中に出す。AC-10: 閉じた後は保存の後の画面（判定の枠の下）に出す', () => {
    const err = reflection(EMPTY_REFLECTION, { error: REFLECTION_SAVE_FAILED });
    const open = recordTree({ reflection: err });
    expect(all([sheetOf(open)], (e) => e.props.role === 'alert').map(text)).toEqual([
      REFLECTION_SAVE_FAILED,
    ]);
    const panelAlerts = (tree: Node[]) =>
      all(tree, hasClass('record'))
        .flatMap((r) => r.children)
        .filter((c): c is El => typeof c !== 'string' && c.props.role === 'alert')
        .map(text);
    expect(panelAlerts(open)).toEqual([]);
    expect(panelAlerts(recordTree({ reflection: err, sheet: null }))).toEqual([
      REFLECTION_SAVE_FAILED,
    ]);
  });

  it('複数行でも段は 1 つ（付ける先は保存した行すべて = 題の件数と同じ）', () => {
    const tree = recordTree({}, [L1, L2, L3]);
    expect(text(all([sheetOf(tree)], hasClass('sheet__title')))).toBe('3 件を記録しました');
    expect(all([sheetOf(tree)], hasClass('reflection__chips'))).toHaveLength(2);
  });

  it('reflection を渡さなければ Good / More の段を出さない（今までの心理だけのシート）', () => {
    const tree = recordTree({ reflection: undefined as never });
    expect(all([sheetOf(tree)], hasClass('reflection__chips'))).toEqual([]);
  });

  it('KEEP-3: 詳細のシートは「＋ 自分で書く」を出さず、欄を初めから出す', () => {
    const tree = expand(
      <ReflectionSheetBody
        prefix="detail"
        state={reflection()}
        onToggle={noop}
        onDraft={noop}
        onAddNote={noop}
        onRemoveNote={noop}
        onClose={noop}
      />,
    );
    expect(all(tree, (e) => e.type === 'button' && text(e) === REFLECTION_COMPOSE)).toEqual([]);
    expect(all(tree, (e) => e.type === 'input')).toHaveLength(2);
  });
});

describe('reflectionHasInput（ボタンの文字の決め方）', () => {
  it('話題・行・空白でない書きかけのどれかがあれば true', () => {
    const blank = { good: '', more: '' };
    expect(reflectionHasInput(EMPTY_REFLECTION, blank)).toBe(false);
    expect(reflectionHasInput(EMPTY_REFLECTION, { good: ' 　', more: '' })).toBe(false);
    expect(reflectionHasInput(EMPTY_REFLECTION, { good: '', more: 'x' })).toBe(true);
    expect(
      reflectionHasInput(
        normalizeReflection({ more: { topics: ['oversized'], notes: [] } }),
        blank,
      ),
    ).toBe(true);
    expect(
      reflectionHasInput(normalizeReflection({ good: { topics: [], notes: ['架空'] } }), blank),
    ).toBe(true);
  });
});

// ---- 送り（記録の controller → 保存した取引 → Good / More の controller → 偽の API） ----

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();
const settle = () => new Promise((ok) => setTimeout(ok, 0));

async function saveOne(fake: FakeApi) {
  const c = createRecordController({ api: fake.api, now: () => NOW });
  await c.load();
  c.update({ type: 'fill', values: applyDraft(EMPTY_DRAFT, { type: 'fill', values: E1 }) });
  await c.save();
  return c;
}

function typeFive(c: RecordController, lc: string) {
  for (const a of [
    { type: 'set', field: 'lc', value: lc },
    { type: 'set', field: 'brokenCondition', value: '押し目の安値を割ったら' },
    { type: 'set', field: 'lcDecided', value: true },
    { type: 'set', field: 'lcMove', value: 'none' },
    { type: 'set', field: 'timeframeChange', value: 'none' },
  ] as const)
    c.update(a);
}

/** 保存の後のシートの Good / More の controller（画面の hook と同じく SavedView.trades の ID へ送る） */
function savedReflection(fake: FakeApi, c: RecordController): ReflectionController {
  const saved = c.getState().saved;
  if (!saved) throw new Error('保存の後ではない');
  return createReflectionController({
    request: createRequest(fake.api),
    tradeIds: (saved.trades ?? [saved.trade]).map((t) => t.id),
    initial: undefined,
  });
}

async function drain(r: ReflectionController) {
  for (let i = 0; i < 20 && r.getState().sending; i++) await settle();
  await settle();
}

const puts = (fake: FakeApi) =>
  fake.calls.filter((x) => x.method === 'PUT' && x.path === '/api/trade-reflections');

describe('保存の後のシートの Good / More の送り', () => {
  it('AC-2 例 1: 1 件の保存の後に Good のチップを押すと、その取引だけへ送る', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await saveOne(fake);
    expect(c.getState().phase).toBe('saved');
    const r = savedReflection(fake, c);
    r.toggle('good', 'cutEarly');
    await drain(r);
    const id = c.getState().saved?.trade.id;
    expect(puts(fake).map((x) => x.body)).toEqual([
      {
        tradeIds: [id],
        good: { topics: ['cutEarly'], notes: [] },
        more: { topics: [], notes: [] },
      },
    ]);
    expect(fake.trades[0]?.reflection?.good.topics).toEqual(['cutEarly']);
  });

  it('AC-3 例 2: 3 行の明細から 3 件を保存した後は、3 件すべてへ送る', async () => {
    const fake = createFakeApi({
      instruments: [US30],
      reads: [{ status: 200, body: statementBody(ROWS_E10) }],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => NOW,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    for (const lc of ['99.0', '202', '49']) {
      typeFive(c, lc);
      await c.save();
    }
    expect(c.getState().phase).toBe('saved');
    const r = savedReflection(fake, c);
    r.toggle('more', 'oversized');
    await drain(r);
    const ids = (c.getState().saved?.trades ?? []).map((t) => t.id);
    expect(ids).toHaveLength(3);
    const body = puts(fake)[0]?.body as { tradeIds: string[]; more: Reflection['more'] };
    expect(body.tradeIds).toEqual(ids);
    expect(body.more).toEqual({ topics: ['oversized'], notes: [] });
    expect(fake.trades.map((t) => t.reflection?.more.topics)).toEqual([
      ['oversized'],
      ['oversized'],
      ['oversized'],
    ]);
  });

  it('例 3: 何も押さなければ送らない', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const c = await saveOne(fake);
    const r = savedReflection(fake, c);
    expect(r.commitDrafts()).toBe(true);
    await drain(r);
    expect(puts(fake)).toEqual([]);
  });

  it('AC-4 例 4: 欄に打って追加すると行が足されて送り、欄は空になる', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const r = savedReflection(fake, await saveOne(fake));
    r.setDraft('good', 'LC を動かさずに待てた');
    r.addNote('good');
    await drain(r);
    expect((puts(fake)[0] as { body: Reflection }).body.good.notes).toEqual([
      'LC を動かさずに待てた',
    ]);
    expect(r.getState().drafts.good).toBe('');
  });

  it('AC-6 例 5: ［完了］ は書きかけを足して送る（送り 1 回）', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const r = savedReflection(fake, await saveOne(fake));
    r.setDraft('more', '入る前に TP を決める');
    expect(r.commitDrafts()).toBe(true);
    await drain(r);
    expect(puts(fake)).toHaveLength(1);
    expect((puts(fake)[0] as { body: Reflection }).body.more.notes).toEqual([
      '入る前に TP を決める',
    ]);
  });

  it('AC-7 例 6: 101 字の書きかけでは ［完了］ で閉じず、理由を出し、送らない', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const r = savedReflection(fake, await saveOne(fake));
    r.setDraft('good', 'あ'.repeat(101));
    expect(r.commitDrafts()).toBe(false);
    await drain(r);
    expect(r.getState().noteIssues.good).toBe('tooLong');
    expect(noteIssueText('tooLong')).toBe('1 行は 100 字までです。');
    expect(puts(fake)).toEqual([]);
  });

  it('AC-8 例 7: ✕ で閉じる（書きかけを捨てる）と送らない', async () => {
    const fake = createFakeApi({ instruments: [US30] });
    const r = savedReflection(fake, await saveOne(fake));
    r.setDraft('good', 'あいう');
    // 画面の hook が ✕・戻るで閉じたときにすること（書きかけを捨てる）
    r.setDraft('good', '');
    r.setDraft('more', '');
    await drain(r);
    expect(puts(fake)).toEqual([]);
    expect(fake.trades[0]?.reflection).toBeUndefined();
  });

  it('AC-9 例 9: 送りが 500 で失敗したら押す前に戻し、決まった文言を出す', async () => {
    const fake = createFakeApi({
      instruments: [US30],
      fail: { 'PUT /api/trade-reflections': 500 },
    });
    const r = savedReflection(fake, await saveOne(fake));
    r.toggle('good', 'cutEarly');
    expect(r.getState().value.good.topics).toEqual(['cutEarly']);
    await drain(r);
    expect(r.getState().value.good.topics).toEqual([]);
    expect(r.getState().error).toBe(REFLECTION_SAVE_FAILED);
  });
});
