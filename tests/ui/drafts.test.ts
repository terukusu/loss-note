// 書きかけの置き場（Issue #75 R1〜R8・AC-1〜AC-7。ADR-0019）。DOM を使わず、偽のタイマーと偽の API で確かめる。値はすべて架空
import { describe, expect, it } from 'vitest';
import { createDeletions, UNDO_MS } from '../../ui/src/lib/deletions';
import {
  agoText,
  type DraftStatus,
  editDraftLabel,
  editDraftStatus,
  exitTimeKept,
  recordDraftImages,
  recordDraftStatus,
  resumedAfter,
  resumedNote,
} from '../../ui/src/lib/draft-status';
import {
  createDrafts,
  DRAFT_TOAST_TEXT,
  DRAFT_UNDO_MS,
  type DraftEntry,
  editKey,
  imagesNote,
  recordKey,
} from '../../ui/src/lib/drafts';
import { createEditController, type EditController } from '../../ui/src/lib/edit-controller';
import { createRecordController, type RecordController } from '../../ui/src/lib/record-controller';
import { createFakeApi } from './helpers/fake-api';
import {
  blobOf,
  fakePreview,
  pngBytes,
  preparedImage,
  ROW_E1,
  statementBody,
} from './helpers/statement-rows';
import { E1, E2, US30 } from './helpers/trade-examples';

const NOW = new Date(2026, 3, 5, 14, 37, 21, 500).getTime();

/** 偽のタイマー（進めると期限の来たものを呼ぶ） */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** 状態を手で替えられる偽の書きかけ */
function fakeEntry(kind: 'record' | 'edit', href: string, status: DraftStatus = 'empty') {
  const log: string[] = [];
  const box = { status };
  const entry: DraftEntry<{ name: string }> = {
    controller: { name: href },
    kind,
    href,
    status: () => box.status,
    stop: () => log.push('stop'),
    dispose: () => log.push('dispose'),
  };
  return { entry, box, log };
}

function setup() {
  const t = fakeTimers();
  const d = createDrafts({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  return { t, d };
}

describe('置き場の規則（R1・R2・R5・R7・R8）', () => {
  it('取り消しの時間は削除の [元に戻す] と同じ 8 秒', () => {
    expect(DRAFT_UNDO_MS).toBe(UNDO_MS);
  });

  it('R1: 入力が無い [キャンセル] → すぐ捨てる（empty）・トーストなし・置き場は空', () => {
    const { d } = setup();
    const f = fakeEntry('record', '/record');
    d.acquire(recordKey(), () => f.entry);
    expect(d.cancel(recordKey())).toBe('empty');
    expect(f.log).toEqual(['stop', 'dispose']);
    expect(d.getState().toast).toBeNull();
    expect(d.keys()).toEqual([]);
    // 画面のアンマウントの release は何もしない
    d.release(recordKey(), f.entry.controller);
    expect(f.log).toEqual(['stop', 'dispose']);
  });

  it('R2: 入力がある [キャンセル] → 破棄のトースト・[元に戻す] で同じ書きかけと URL が戻る', () => {
    const { t, d } = setup();
    const f = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => f.entry);
    expect(d.cancel(recordKey())).toBe('discarded');
    expect(d.getState().toast).toEqual({
      type: 'discarded',
      kind: 'record',
      key: 'record',
      text: '記録の入力を破棄しました',
    });
    expect(d.keys()).toEqual([]);
    expect(d.undo()).toBe('/record');
    expect(d.getState().toast).toBeNull();
    expect(t.pending()).toBe(0);
    const again = d.acquire(recordKey(), () => fakeEntry('record', '/record').entry);
    expect(again).toMatchObject({ controller: f.entry.controller, restored: true });
    expect(f.log).toEqual(['stop']);
  });

  it('R2: [元に戻す] を押さずに 8 秒 → 捨てて（dispose 1 回）トーストを閉じる。次に開くと作り直す', () => {
    const { t, d } = setup();
    const f = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => f.entry);
    d.cancel(recordKey());
    t.advance(DRAFT_UNDO_MS - 1);
    expect(f.log).toEqual(['stop']);
    t.advance(1);
    expect(f.log).toEqual(['stop', 'dispose']);
    expect(d.getState().toast).toBeNull();
    expect(d.undo()).toBeNull();
    const g = fakeEntry('record', '/record');
    expect(d.acquire(recordKey(), () => g.entry).restored).toBe(false);
  });

  it('R2: トーストにフォーカス・ポインタがある間は時間を止め、離れたら 8 秒を置き直す', () => {
    const { t, d } = setup();
    const f = fakeEntry('edit', '/trades/a/edit', 'input');
    d.acquire(editKey('a'), () => f.entry);
    d.cancel(editKey('a'));
    d.hold();
    t.advance(DRAFT_UNDO_MS * 3);
    expect(f.log).toEqual(['stop']);
    d.resume();
    t.advance(DRAFT_UNDO_MS);
    expect(f.log).toEqual(['stop', 'dispose']);
  });

  it('R2: 取り消し待ちの画面を開き直した・次の破棄・閉じる → 前の取り消し待ちは確定して捨てる', () => {
    const { d } = setup();
    const a = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => a.entry);
    d.cancel(recordKey());
    d.acquire(recordKey(), () => fakeEntry('record', '/record').entry);
    expect(a.log).toEqual(['stop', 'dispose']);
    const b = fakeEntry('edit', '/trades/b/edit', 'input');
    const c = fakeEntry('edit', '/trades/c/edit', 'input');
    d.acquire(editKey('b'), () => b.entry);
    d.acquire(editKey('c'), () => c.entry);
    d.cancel(editKey('b'));
    d.cancel(editKey('c'));
    expect(b.log).toEqual(['stop', 'dispose']);
    d.dismiss();
    expect(c.log).toEqual(['stop', 'dispose']);
    expect(d.getState().toast).toBeNull();
  });

  it('R4: 保存中の [キャンセル] は何もしない（busy）', () => {
    const { d } = setup();
    const f = fakeEntry('edit', '/trades/a/edit', 'saving');
    d.acquire(editKey('a'), () => f.entry);
    expect(d.cancel(editKey('a'))).toBe('busy');
    expect(f.log).toEqual([]);
    expect(d.keys()).toEqual(['edit:a']);
  });

  it('R5: 入力があるまま離れる → 残して「残っています」+ 戻る先。戻ると借り直す（restored）', () => {
    const { t, d } = setup();
    const f = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => f.entry);
    d.release(recordKey(), f.entry.controller);
    expect(d.getState().toast).toEqual({
      type: 'kept',
      kind: 'record',
      key: 'record',
      text: '記録の入力は残っています',
    });
    expect(d.getState().kept).toEqual(new Set(['record']));
    expect(DRAFT_TOAST_TEXT.back.record).toBe('記録に戻る');
    expect(d.back()).toBe('/record');
    expect(d.getState().toast).toBeNull();
    expect(d.acquire(recordKey(), () => fakeEntry('record', '/record').entry).restored).toBe(true);
    // 「残っています」は 8 秒で閉じるだけ（書きかけは残る）
    d.release(recordKey(), f.entry.controller);
    t.advance(DRAFT_UNDO_MS);
    expect(d.getState().toast).toBeNull();
    expect(d.keys()).toEqual(['record']);
    expect(f.log).toEqual([]);
  });

  it('R5: 入力が無い・保存し終えたまま離れる → 捨てる。保存中は残す（トーストなし）', () => {
    const { d } = setup();
    for (const s of ['empty', 'done'] as const) {
      const f = fakeEntry('record', '/record', s);
      d.acquire(recordKey(), () => f.entry);
      d.release(recordKey(), f.entry.controller);
      expect(f.log).toEqual(['dispose']);
      expect(d.keys()).toEqual([]);
    }
    const g = fakeEntry('record', '/record', 'saving');
    d.acquire(recordKey(), () => g.entry);
    d.release(recordKey(), g.entry.controller);
    expect(d.keys()).toEqual(['record']);
    expect(d.getState().toast).toBeNull();
  });

  it('R5: 離れている間に保存し終えた記録は 1 度借りる（reuseDone）。編集は作り直す', () => {
    const { d } = setup();
    const r = fakeEntry('record', '/record', 'saving');
    d.acquire(recordKey(), () => r.entry);
    d.release(recordKey(), r.entry.controller);
    r.box.status = 'done';
    expect(
      d.acquire(recordKey(), () => fakeEntry('record', '/record').entry, { reuseDone: true })
        .restored,
    ).toBe(true);
    const e = fakeEntry('edit', '/trades/a/edit', 'saving');
    d.acquire(editKey('a'), () => e.entry);
    d.release(editKey('a'), e.entry.controller);
    e.box.status = 'done';
    const fresh = fakeEntry('edit', '/trades/a/edit');
    expect(d.acquire(editKey('a'), () => fresh.entry)).toEqual({
      controller: fresh.entry.controller,
      restored: false,
      resumedAt: null,
    });
    expect(e.log).toEqual(['dispose']);
  });

  it('R6: 編集の書きかけは取引ごと（ほかの取引を開いても前の取引の書きかけは残る）', () => {
    const { d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.release(editKey('a'), a.entry.controller);
    const b = fakeEntry('edit', '/trades/b/edit');
    d.acquire(editKey('b'), () => b.entry);
    d.release(editKey('b'), b.entry.controller);
    expect(
      d.acquire(editKey('a'), () => fakeEntry('edit', '/trades/a/edit').entry).controller,
    ).toBe(a.entry.controller);
    expect(d.keys()).toEqual(['edit:a']);
  });

  it('R7: ログアウト（reset）→ 残した書きかけ・取り消し待ちを全部捨て、知らせを閉じる', () => {
    const { t, d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    const r = fakeEntry('record', '/record', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.acquire(recordKey(), () => r.entry);
    d.cancel(editKey('a'));
    d.release(recordKey(), r.entry.controller);
    d.reset();
    expect(a.log).toEqual(['stop', 'dispose']);
    expect(r.log).toEqual(['dispose']);
    expect(d.keys()).toEqual([]);
    expect(d.getState().toast).toBeNull();
    expect(t.pending()).toBe(0);
  });

  it('R8: タブを閉じるときの確認は、入力がある・保存中の書きかけがある間だけ', () => {
    const { d } = setup();
    const f = fakeEntry('record', '/record', 'empty');
    d.acquire(recordKey(), () => f.entry);
    expect(d.hasInput()).toBe(false);
    f.box.status = 'input';
    expect(d.hasInput()).toBe(true);
    f.box.status = 'saving';
    expect(d.hasInput()).toBe(true);
    f.box.status = 'done';
    expect(d.hasInput()).toBe(false);
    f.box.status = 'input';
    d.cancel(recordKey());
    // 捨てた（取り消し待ち）書きかけは確認しない
    expect(d.hasInput()).toBe(false);
  });

  it('release は同じ controller のときだけ（借り直した後の古い画面の後始末で捨てない）', () => {
    const { d } = setup();
    const f = fakeEntry('record', '/record', 'empty');
    d.acquire(recordKey(), () => f.entry);
    d.release(recordKey(), { name: 'ほかの controller' });
    expect(f.log).toEqual([]);
    expect(d.keys()).toEqual(['record']);
  });
});

/** 置き場に記録する画面の controller を入れる（画面 Record.tsx と同じ作り） */
function recordEntry(c: RecordController): DraftEntry<RecordController> {
  return {
    controller: c,
    kind: 'record',
    href: '/record',
    status: () => recordDraftStatus(c.getState()),
    stop: () => c.cancelRead(),
    dispose: () => c.dispose(),
  };
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

async function openedRecord() {
  const fake = createFakeApi({ reads: [{ status: 200, body: statementBody([ROW_E1]) }] });
  const signals: AbortSignal[] = [];
  const api: typeof fake.api = (path, init) => {
    if (path === '/api/statement-reads' && init?.signal) signals.push(init.signal);
    return fake.api(path, init);
  };
  const previews: ReturnType<typeof fakePreview>[] = [];
  const c = createRecordController({
    api,
    now: () => NOW,
    prepare: async () => {
      const p = fakePreview();
      previews.push(p);
      return { ok: true, image: preparedImage(p) };
    },
  });
  await c.load();
  return { fake, c, previews, signals };
}

const img = () => blobOf(pngBytes(1200, 800, 2048));
const readCalls = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((x) => x.path === '/api/statement-reads');

describe('記録する画面の書きかけ（R0・R2・R3・R5。本物の controller）', () => {
  it('R0: 開いたときの既定のままは empty、欄を変えると input、戻すと empty', async () => {
    const { c } = await openedRecord();
    expect(recordDraftStatus(c.getState())).toBe('empty');
    c.update({ type: 'set', field: 'lc', value: '99.8' });
    expect(recordDraftStatus(c.getState())).toBe('input');
    c.update({ type: 'set', field: 'lc', value: '' });
    expect(recordDraftStatus(c.getState())).toBe('empty');
  });

  it('R2: イン・決済・LC とチャート 1 枚 → [キャンセル] → [元に戻す] で同じ値とチャート。8 秒後はプレビューを閉じる', async () => {
    const { c, previews } = await openedRecord();
    const t = fakeTimers();
    const d = createDrafts({ setTimer: t.setTimer, clearTimer: t.clearTimer });
    d.acquire(recordKey(), () => recordEntry(c));
    c.update({ type: 'set', field: 'entryPrice', value: '100.5' });
    c.update({ type: 'set', field: 'exitPrice', value: '101.2' });
    c.update({ type: 'set', field: 'lc', value: '99.8' });
    await c.setChart('exit', img());
    expect(c.getState().charts?.exit?.phase).toBe('ready');
    expect(d.cancel(recordKey())).toBe('discarded');
    expect(d.undo()).toBe('/record');
    const back = d.acquire(recordKey(), () => recordEntry(c));
    expect(back.restored).toBe(true);
    expect(c.getState().draft).toMatchObject({
      entryPrice: '100.5',
      exitPrice: '101.2',
      lc: '99.8',
    });
    expect(c.getState().charts?.exit?.phase).toBe('ready');
    expect(previews.every((p) => !p.closed())).toBe(true);
    // もう一度キャンセルして 8 秒 → 入れた画像のプレビューを閉じる
    d.cancel(recordKey());
    t.advance(DRAFT_UNDO_MS);
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.filter((p) => p.closed())).toHaveLength(previews.length);
  });

  it('R3: 読み取り中・ほかは既定で [キャンセル] → 読み取りの要求を中断し、入力は無くなる（empty）。後で届いた応答は入らない', async () => {
    const { fake, c, signals } = await openedRecord();
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    d.acquire(recordKey(), () => recordEntry(c));
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    expect(recordDraftStatus(c.getState())).toBe('input');
    expect(d.cancel(recordKey())).toBe('empty');
    expect(d.getState().toast).toBeNull();
    expect(signals[0]?.aborted).toBe(true);
    fake.releaseReads();
    await p;
    expect(c.getState().statement).toBeUndefined();
    expect(c.getState().draft.instrumentName).not.toBe(ROW_E1.symbol);
  });

  it('R3: 数量 2 を打ってから読み取り中に [キャンセル] → 破棄のトースト。[元に戻す] で数量 2・明細の枠は空', async () => {
    const { fake, c } = await openedRecord();
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    d.acquire(recordKey(), () => recordEntry(c));
    c.update({ type: 'set', field: 'quantity', value: '2' });
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    expect(d.cancel(recordKey())).toBe('discarded');
    fake.releaseReads();
    await p;
    d.undo();
    expect(c.getState().draft.quantity).toBe('2');
    expect(c.getState().statement).toBeUndefined();
  });

  it('R5: 読み取り中に離れる → 読み取りは続き、戻ったときに読み取った値が入っている', async () => {
    const { fake, c } = await openedRecord();
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    d.acquire(recordKey(), () => recordEntry(c));
    fake.holdReads();
    const p = c.readImage(img());
    await until(() => readCalls(fake).length === 1);
    d.release(recordKey(), c);
    expect(d.getState().toast?.type).toBe('kept');
    fake.releaseReads();
    await p;
    const back = d.acquire(recordKey(), () => recordEntry(c));
    expect(back.restored).toBe(true);
    expect(c.getState().statement?.phase).toBe('ready');
    expect(c.getState().draft.instrumentName).toBe(ROW_E1.symbol);
  });

  it('R5: 既定のまま離れる → 捨てて、次は作り直す（決済の時刻は開き直した時刻）', async () => {
    const { c } = await openedRecord();
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    d.acquire(recordKey(), () => recordEntry(c));
    d.release(recordKey(), c);
    expect(d.keys()).toEqual([]);
    expect(d.getState().toast).toBeNull();
  });
});

describe('編集の書きかけの状態（R0）', () => {
  it('読み込み中・保存中・保存の後', () => {
    const base = {
      draft: {},
      initial: {},
      charts: undefined,
      extras: [],
      trade: null,
      refresh: false,
      offer: null,
    };
    expect(editDraftStatus({ ...base, phase: 'loading' } as never)).toBe('empty');
    expect(editDraftStatus({ ...base, phase: 'saving' } as never)).toBe('saving');
    expect(editDraftStatus({ ...base, phase: 'saved' } as never)).toBe('done');
    expect(editDraftStatus({ ...base, phase: 'editing' } as never)).toBe('empty');
    expect(editDraftStatus({ ...base, phase: 'editing', draft: { lc: '1' } } as never)).toBe(
      'input',
    );
    expect(
      editDraftStatus({
        ...base,
        phase: 'editing',
        charts: { exit: { phase: 'removed', stored: true } },
      } as never),
    ).toBe('input');
    expect(
      editDraftStatus({
        ...base,
        phase: 'editing',
        charts: { exit: { phase: 'ready', stored: true } },
      } as never),
    ).toBe('empty');
    expect(editDraftStatus({ ...base, phase: 'editing', refresh: true, offer: {} } as never)).toBe(
      'input',
    );
  });
});

function editEntry(id: string, c: EditController): DraftEntry<EditController> {
  return {
    controller: c,
    kind: 'edit',
    href: `/trades/${id}/edit`,
    status: () => editDraftStatus(c.getState()),
    label: () => editDraftLabel(c.getState()),
    dispose: () => c.dispose(),
  };
}

describe('編集の書きかけ（R6。本物の controller）', () => {
  it('取引 A の決済を変えて離れる → 取引 B の編集を開く → A を開くと変えた値のまま。保存の後は作り直す', async () => {
    const fake = createFakeApi({ trades: [E1, E2], instruments: [US30] });
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    const a = createEditController({ api: fake.api, id: 'e1' });
    d.acquire(editKey('e1'), () => editEntry('e1', a));
    await a.load();
    expect(editDraftStatus(a.getState())).toBe('empty');
    const before = a.getState().draft.exitPrice;
    a.update({ type: 'set', field: 'exitPrice', value: `${before}1` });
    expect(editDraftStatus(a.getState())).toBe('input');
    d.release(editKey('e1'), a);
    // どの取引の編集か（削除のトーストと同じ短い名前。#75 N3）
    expect(d.getState().toast?.text).toMatch(/^US30 [LS] \d{2}\/\d{2} の編集の変更は残っています$/);
    const b = createEditController({ api: fake.api, id: 'e2' });
    expect(d.acquire(editKey('e2'), () => editEntry('e2', b)).restored).toBe(false);
    await b.load();
    d.release(editKey('e2'), b);
    const again = d.acquire(editKey('e1'), () =>
      editEntry('e1', createEditController({ api: fake.api, id: 'e1' })),
    );
    expect(again).toMatchObject({ controller: a, restored: true });
    expect(a.getState().draft.exitPrice).toBe(`${before}1`);
    await a.save();
    expect(editDraftStatus(a.getState())).toBe('done');
    d.release(editKey('e1'), a);
    expect(d.keys()).toEqual([]);
  });
});

describe('レビュー後の修正（#75 N1〜N3・N8・デザイン 1・5）', () => {
  it('N2: 破棄の取り消し待ちの間に別の書きかけを残して離れる → 取り消し待ちを確定（dispose 1 回）→ [記録に戻る]', () => {
    const { d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    const r = fakeEntry('record', '/record', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.cancel(editKey('a'));
    d.acquire(recordKey(), () => r.entry);
    // 記録する画面を開いても編集の破棄の知らせは残る（R1）
    expect(d.getState().toast?.type).toBe('discarded');
    expect(a.log).toEqual(['stop']);
    // 「残っています」が置き換えるときに確定する
    d.release(recordKey(), r.entry.controller);
    expect(a.log).toEqual(['stop', 'dispose']);
    expect(d.back()).toBe('/record');
    expect(a.log).toEqual(['stop', 'dispose']);
  });

  it('N2: 「残っています」が破棄の知らせを置き換えるとき、取り消し待ちを確定する', () => {
    const { d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    const r = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => r.entry);
    d.acquire(editKey('a'), () => a.entry);
    d.cancel(editKey('a'));
    expect(d.getState().toast?.type).toBe('discarded');
    d.release(recordKey(), r.entry.controller);
    expect(d.getState().toast?.type).toBe('kept');
    expect(a.log).toEqual(['stop', 'dispose']);
    expect(d.undo()).toBeNull();
  });

  it('N3: 取引 A の「残っています」は、取引 B の編集を開くと閉じる（B の画面から A へ移る知らせを残さない）', () => {
    const { d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.release(editKey('a'), a.entry.controller);
    expect(d.getState().toast?.key).toBe('edit:a');
    d.acquire(editKey('b'), () => fakeEntry('edit', '/trades/b/edit').entry);
    expect(d.getState().toast).toBeNull();
    // A の書きかけと印は残る
    expect(d.getState().kept).toEqual(new Set(['edit:a']));
    expect(a.log).toEqual([]);
  });

  it('N3・N8・デザイン 5: 知らせの文に取引の名前・画像の枚数。[元に戻す] の読み上げで削除と見分ける', () => {
    expect(
      DRAFT_TOAST_TEXT.discarded('edit', 'US30 L 11/09', { charts: 1, statement: false }),
    ).toBe('US30 L 11/09 の編集の変更を破棄しました（チャート 1 枚を含む）');
    expect(DRAFT_TOAST_TEXT.discarded('record', '', { charts: 2, statement: true })).toBe(
      '記録の入力を破棄しました（チャート 2 枚・明細を含む）',
    );
    expect(DRAFT_TOAST_TEXT.kept('edit', '')).toBe('編集の変更は残っています');
    expect(imagesNote({ charts: 0, statement: false })).toBe('');
    expect(DRAFT_TOAST_TEXT.undoName).toEqual({
      record: '記録の入力を元に戻す',
      edit: '編集の変更を元に戻す',
    });
  });

  it('N1: 削除が確定したら（204）その取引の編集の書きかけを捨て、印・タブを閉じる確認も消える', async () => {
    const { d } = setup();
    const e = fakeEntry('edit', '/trades/e1/edit', 'input');
    d.acquire(editKey('e1'), () => e.entry);
    d.release(editKey('e1'), e.entry.controller);
    expect(d.hasInput()).toBe(true);
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const t = fakeTimers();
    const del = createDeletions({
      api: fake.api,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
      onDeleted: (id) => d.drop(editKey(id)),
    });
    del.remove('e1', 'US30');
    // 取り消しの時間の間は残す（[元に戻す] で戻せる）
    expect(e.log).toEqual([]);
    await del.flush();
    expect(e.log).toEqual(['dispose']);
    expect(d.keys()).toEqual([]);
    expect(d.getState().kept).toEqual(new Set());
    expect(d.getState().toast).toBeNull();
    expect(d.hasInput()).toBe(false);
  });

  it('デザイン 1: 離れた時刻を、借り直したときだけ resumedAt で返す（同じ描画で 2 回借りても同じ）', () => {
    let clock = 1_000_000;
    const t = fakeTimers();
    const d = createDrafts({ setTimer: t.setTimer, clearTimer: t.clearTimer, now: () => clock });
    const f = fakeEntry('record', '/record', 'input');
    expect(d.acquire(recordKey(), () => f.entry).resumedAt).toBeNull();
    d.release(recordKey(), f.entry.controller);
    clock += 5 * 60_000;
    expect(d.acquire(recordKey(), () => f.entry).resumedAt).toBe(1_000_000);
    expect(d.acquire(recordKey(), () => f.entry).resumedAt).toBe(1_000_000);
    expect(d.getState().kept).toEqual(new Set());
  });

  it('デザイン 1: 続きの 1 行（何分前・決済の時刻が開いたときのまま・[キャンセル] への導き）', () => {
    expect(agoText(0, 30_000)).toBe('1 分以内');
    expect(agoText(0, 12 * 60_000)).toBe('12 分前');
    expect(agoText(0, 3 * 3_600_000)).toBe('3 時間前');
    expect(agoText(0, 50 * 3_600_000)).toBe('2 日前');
    expect(resumedNote('record', 0, 12 * 60_000, '2026-04-05T14:37')).toBe(
      '前の入力の続きです（12 分前）。決済の時刻は開いたときの 04/05 14:37 のままです。破棄するときは左上の ✕（キャンセル）を押してください。',
    );
    expect(resumedNote('edit', 0, 60_000)).toBe(
      '前の変更の続きです（1 分前）。破棄するときは左上の ✕（キャンセル）を押してください。',
    );
  });
});

describe('記録の書きかけの決済の時刻と画像（デザイン 1・5。本物の controller）', () => {
  it('決済の時刻が開いたときのままなら値を返し、変えたら返さない。チャートの枚数を数える', async () => {
    const { c } = await openedRecord();
    const opened = c.getState().draft.exitTime;
    expect(exitTimeKept(c.getState())).toBe(opened);
    c.update({ type: 'set', field: 'exitTime', value: '2026-04-05T10:00' });
    expect(exitTimeKept(c.getState())).toBeUndefined();
    expect(recordDraftImages(c.getState())).toEqual({ charts: 0, statement: false });
    await c.setChart('exit', img());
    expect(recordDraftImages(c.getState())).toEqual({ charts: 1, statement: false });
  });
});

describe('再レビュー後の修正（#75 R1〜R3）', () => {
  it('R1: 編集 A → 記録する画面で入力 → [キャンセル] で編集 A に戻っても、破棄の知らせが残り [元に戻す] で記録へ', () => {
    const { t, d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'empty');
    const r = fakeEntry('record', '/record', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.release(editKey('a'), a.entry.controller);
    d.acquire(recordKey(), () => r.entry);
    expect(d.cancel(recordKey())).toBe('discarded');
    // 前の画面 = 編集 A が開く
    d.acquire(editKey('a'), () => fakeEntry('edit', '/trades/a/edit').entry);
    expect(d.getState().toast).toMatchObject({ type: 'discarded', key: 'record' });
    expect(r.log).toEqual(['stop']);
    expect(d.undo()).toBe('/record');
    expect(t.pending()).toBe(0);
    expect(d.acquire(recordKey(), () => fakeEntry('record', '/record').entry).controller).toBe(
      r.entry.controller,
    );
  });

  it('R1: 編集 A に入力して記録する画面へ移ると「A の編集の変更は残っています」が出たまま', () => {
    const { d } = setup();
    const a = fakeEntry('edit', '/trades/a/edit', 'input');
    d.acquire(editKey('a'), () => a.entry);
    d.release(editKey('a'), a.entry.controller);
    d.acquire(recordKey(), () => fakeEntry('record', '/record').entry);
    expect(d.getState().toast).toMatchObject({ type: 'kept', key: 'edit:a' });
    expect(d.back()).toBe('/trades/a/edit');
  });

  it('R1: 同じ画面・別の取引の編集を開いたときだけ知らせを閉じる（記録の「残っています」は編集を開いても残る）', () => {
    const { d } = setup();
    const r = fakeEntry('record', '/record', 'input');
    d.acquire(recordKey(), () => r.entry);
    d.release(recordKey(), r.entry.controller);
    d.acquire(editKey('b'), () => fakeEntry('edit', '/trades/b/edit').entry);
    expect(d.getState().toast).toMatchObject({ type: 'kept', key: 'record' });
    d.acquire(recordKey(), () => r.entry);
    expect(d.getState().toast).toBeNull();
  });

  it('R3: 保存中に離れて、そのまま保存し終えたら印を外す（書きかけの状態の知らせで）', () => {
    const { d } = setup();
    const listeners = new Set<() => void>();
    const box = { status: 'saving' as DraftStatus };
    const entry: DraftEntry<object> = {
      controller: {},
      kind: 'edit',
      href: '/trades/a/edit',
      status: () => box.status,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      dispose: () => {},
    };
    d.acquire(editKey('a'), () => entry);
    d.release(editKey('a'), entry.controller);
    expect(d.getState().kept).toEqual(new Set(['edit:a']));
    box.status = 'done';
    for (const fn of listeners) fn();
    expect(d.getState().kept).toEqual(new Set());
    expect(d.hasInput()).toBe(false);
    // 捨てたら購読も外す
    d.reset();
    expect(listeners.size).toBe(0);
  });

  it('R3: 本物の編集の controller: 保存中に離れて保存し終えると印が消える', async () => {
    const fake = createFakeApi({ trades: [E1], instruments: [US30] });
    const d = createDrafts({ setTimer: () => 0, clearTimer: () => {} });
    const c = createEditController({ api: fake.api, id: 'e1' });
    d.acquire(editKey('e1'), () => ({
      ...editEntry('e1', c),
      subscribe: (fn) => c.subscribe(() => fn()),
    }));
    await c.load();
    c.update({ type: 'set', field: 'exitPrice', value: `${c.getState().draft.exitPrice}1` });
    const saving = c.save();
    d.release(editKey('e1'), c);
    expect(d.getState().kept.has('edit:e1')).toBe(true);
    await saving;
    expect(editDraftStatus(c.getState())).toBe('done');
    expect(d.getState().kept.has('edit:e1')).toBe(false);
  });

  it('R2: 借り直した記録を保存 → [次の取引] の空の下書きでは続きの 1 行を出さない（本物の controller）', async () => {
    const { c } = await openedRecord();
    let resumed: number | null = 1_000;
    c.subscribe((s) => {
      resumed = resumedAfter(resumed, s.phase);
    });
    expect(resumed).toBe(1_000);
    c.update({ type: 'set', field: 'instrumentName', value: '架空指数A' });
    c.update({ type: 'set', field: 'side', value: 'L' });
    c.update({ type: 'set', field: 'entryPrice', value: '100' });
    c.update({ type: 'set', field: 'exitPrice', value: '99' });
    c.update({ type: 'set', field: 'quantity', value: '1' });
    c.update({ type: 'set', field: 'lc', value: '99' });
    c.update({ type: 'set', field: 'brokenCondition', value: '押し目の安値を割ったら' });
    c.update({ type: 'set', field: 'lcDecided', value: true });
    c.update({ type: 'set', field: 'lcMove', value: 'none' });
    c.update({ type: 'set', field: 'timeframeChange', value: 'none' });
    expect(resumed).toBe(1_000);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    c.next();
    expect(c.getState().phase).toBe('editing');
    expect(resumed).toBeNull();
  });
});
