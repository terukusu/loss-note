// 書きかけの置き場（Issue #75。ADR-0019・docs/ui-guidelines.md P4・P6）。DOM を持たない。アプリの殻（App.tsx）に 1 つ。
// 記録する画面・編集の画面の controller（欄・明細の読み取りの結果・チャートの画像を持つ）を、画面を移っても同じタブの記憶に残す。
// - acquire: 画面を開いた。同じ鍵が残っていれば借りる（restored。画面は読み込み直さない）。無ければ create で作る。離れていた
//   書きかけを借り直したときは、離れた時刻（resumedAt。見出しの下の「前の入力の続きです（N 分前）」）を返す
// - release: 画面を離れた。入力がある・保存中なら残し（入力があればトースト「〜は残っています」+ [記録に戻る] / [編集に戻る]）、
//   入力が無い・保存し終えたなら dispose して外す（次に開くと既定と今の時刻で作り直す）
// - cancel: [キャンセル]。保存中は何もしない。まず stop（明細の読み取りを止める）。入力があれば取り消し待ちの 1 枠へ移して
//   トースト「〜を破棄しました」+ [元に戻す]、取り消しの時間（8 秒。削除と同じ）が過ぎたら dispose。入力が無ければすぐ dispose
// - undo: 取り消し待ちを置き場へ戻し、その画面の URL を返す（殻が進む）。back: 「残っています」から戻る画面の URL
// - 知らせは 1 つ（新しい知らせは前のものを置き換える）。破棄の知らせが置き換わるときは取り消し待ちを確定して捨てる（押せない
//   [元に戻す] の裏で画像を持ち続けない）。画面を開いたときに閉じるのは、その画面自身の知らせ（同じ鍵）と、別の取引の編集の
//   知らせ（編集を開いたとき。A の知らせから B の画面へ移らせない）だけ。記録の破棄は前の画面（編集）に戻っても押せる（#75 R1）
// - トーストにフォーカス・ポインタがある間は時間を止める（hold / resume。WCAG 2.2.1）
// - kept: 離れて残している書きかけの鍵（ナビの [記録する]・詳細の [編集] の印の点）。離れたまま保存し終えたら外す（#75 R3）
// - hasInput: 入力がある書きかけがあるか（タブを閉じる・再読み込みの確認 = beforeunload。殻が使う）
// - drop: 1 つの書きかけを捨てる（その取引を削除した。#75 N1）。reset: ログアウト。全部 dispose
// 書きかけは記憶の中だけ（端末の保存先・URL・履歴に書かない。画像を保存しない ADR-0005）
import type { DraftStatus } from './draft-status';

/** 書きかけの印の点の読み上げ（ナビの [記録する]・詳細の [編集]） */
export const DRAFT_DOT_TEXT = '入力の途中あり';

/** 取り消しの時間（ミリ秒。削除の [元に戻す] と同じ） */
export const DRAFT_UNDO_MS = 8_000;

export type DraftKind = 'record' | 'edit';

/** 書きかけの画像（破棄の知らせに「チャート 2 枚・明細を含む」と添える） */
export interface DraftImages {
  readonly charts: number;
  readonly statement: boolean;
}

/** 画像があるときの添え書き（無ければ空） */
export function imagesNote(images: DraftImages | undefined): string {
  if (!images) return '';
  const parts = [
    ...(images.charts > 0 ? [`チャート ${images.charts} 枚`] : []),
    ...(images.statement ? ['明細'] : []),
  ];
  return parts.length > 0 ? `（${parts.join('・')}を含む）` : '';
}

/** 編集の知らせの頭（どの取引か。削除のトーストと同じ短い名前） */
const editHead = (label: string) => (label ? `${label} の編集` : '編集');

export const DRAFT_TOAST_TEXT = {
  discarded: (kind: DraftKind, label: string, images?: DraftImages) =>
    kind === 'record'
      ? `記録の入力を破棄しました${imagesNote(images)}`
      : `${editHead(label)}の変更を破棄しました${imagesNote(images)}`,
  kept: (kind: DraftKind, label: string) =>
    kind === 'record' ? '記録の入力は残っています' : `${editHead(label)}の変更は残っています`,
  back: { record: '記録に戻る', edit: '編集に戻る' },
  /** [元に戻す] の読み上げの名前（削除の [元に戻す] と並んだときに見分ける。#75 N8） */
  undoName: { record: '記録の入力を元に戻す', edit: '編集の変更を元に戻す' },
} as const;

/** 書きかけの知らせ（discarded = [元に戻す]、kept = [記録に戻る] / [編集に戻る]）。text は出したときに決めた文 */
export type DraftToast = null | {
  readonly type: 'discarded' | 'kept';
  readonly kind: DraftKind;
  readonly key: string;
  readonly text: string;
};

export interface DraftsState {
  readonly toast: DraftToast;
  /** 離れて残している書きかけの鍵（印の点） */
  readonly kept: ReadonlySet<string>;
}

/** 置き場に入れるもの（画面が controller から作る） */
export interface DraftEntry<C> {
  readonly controller: C;
  readonly kind: DraftKind;
  /** その画面の URL（[元に戻す]・[記録に戻る] で進む先） */
  readonly href: string;
  status(): DraftStatus;
  /** 状態が変わったら知らせる（離れたまま保存し終えたら印を外す。#75 R3）。無ければ省く */
  subscribe?(fn: () => void): () => void;
  /** どの取引か（編集の知らせ。例: US30 L 11/09）。無ければ省く */
  label?(): string;
  /** 書きかけの画像（破棄の知らせの添え書き）。無ければ省く */
  images?(): DraftImages;
  /** [キャンセル] の前に止めるもの（明細の読み取り）。無ければ省く */
  stop?(): void;
  dispose(): void;
}

export interface AcquireOptions {
  /** 保存し終えた書きかけも借りる（記録する画面: 離れている間に保存し終えた結果を 1 度見せる）。既定は作り直す */
  readonly reuseDone?: boolean;
}

export interface Acquired<C> {
  readonly controller: C;
  readonly restored: boolean;
  /** 離れていた書きかけを借り直した: 離れた時刻（ミリ秒）。そうでなければ null */
  readonly resumedAt: number | null;
}

export type CancelResult = 'busy' | 'empty' | 'discarded';

export type TimerId = unknown;

export interface DraftsDeps {
  readonly setTimer: (fn: () => void, ms: number) => TimerId;
  readonly clearTimer: (id: TimerId) => void;
  readonly undoMs?: number;
  /** 今の時刻（離れた時刻）。既定は Date.now */
  readonly now?: () => number;
}

export interface Drafts {
  getState(): DraftsState;
  subscribe(fn: (s: DraftsState) => void): () => void;
  acquire<C>(key: string, create: () => DraftEntry<C>, opts?: AcquireOptions): Acquired<C>;
  release(key: string, controller: unknown): void;
  cancel(key: string): CancelResult;
  /** [元に戻す]: 戻す画面の URL（取り消し待ちが無ければ null） */
  undo(): string | null;
  /** [記録に戻る] / [編集に戻る]: 戻る画面の URL（残っていなければ null） */
  back(): string | null;
  hold(): void;
  resume(): void;
  /** トーストを閉じる（取り消し待ちはすぐ確定して捨てる） */
  dismiss(): void;
  hasInput(): boolean;
  /** 置き場にある鍵の controller（無ければ undefined） */
  peek<C>(key: string): C | undefined;
  /** 1 つの書きかけを捨てる（取り消し待ちを含む。その取引を削除した） */
  drop(key: string): void;
  /** 置き場にある鍵（テスト・検査用） */
  keys(): string[];
  reset(): void;
}

export function recordKey(): string {
  return 'record';
}

export function editKey(id: string): string {
  return `edit:${id}`;
}

interface Slot {
  readonly entry: DraftEntry<unknown>;
  /** entry.subscribe の解除 */
  off: (() => void) | null;
  /** 離れた時刻（残したとき・破棄したとき）。借り直したら resumedAt に移す */
  leftAt: number | null;
  resumedAt: number | null;
}

export function createDrafts(deps: DraftsDeps): Drafts {
  const undoMs = deps.undoMs ?? DRAFT_UNDO_MS;
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<(s: DraftsState) => void>();
  const slots = new Map<string, Slot>();
  let state: DraftsState = { toast: null, kept: new Set() };
  /** 取り消し待ち（同時に 1 つ） */
  let discarded: { key: string; slot: Slot } | null = null;
  let timer: TimerId | null = null;
  let held = false;

  const emit = (patch: Partial<DraftsState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };
  const keptWith = (key: string, on: boolean): ReadonlySet<string> => {
    const next = new Set(state.kept);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const stopTimer = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  /** 取り消し待ちを確定して捨てる */
  const finalize = () => {
    const d = discarded;
    discarded = null;
    if (d) disposeSlot(d.slot);
  };
  const closeToast = () => {
    stopTimer();
    held = false;
    finalize();
  };
  /** 知らせの時間（破棄 = 過ぎたら確定、残っています = 過ぎたら閉じるだけ） */
  const startTimer = () => {
    stopTimer();
    timer = deps.setTimer(() => {
      timer = null;
      held = false;
      finalize();
      emit({ toast: null });
    }, undoMs);
  };
  /** 置き場から外して捨てる（状態の購読も外す） */
  const disposeSlot = (slot: Slot) => {
    slot.off?.();
    slot.off = null;
    slot.entry.dispose();
  };
  /** 離れたまま保存し終えた（done）・入力が無くなったら印を外す */
  const watch = (key: string, slot: Slot) => {
    slot.off =
      slot.entry.subscribe?.(() => {
        if (!state.kept.has(key) || slots.get(key) !== slot) return;
        const st = slot.entry.status();
        if (st !== 'input' && st !== 'saving') emit({ kept: keptWith(key, false) });
      }) ?? null;
  };
  const toastOf = (type: 'discarded' | 'kept', key: string, e: DraftEntry<unknown>) => ({
    type,
    kind: e.kind,
    key,
    text:
      type === 'discarded'
        ? DRAFT_TOAST_TEXT.discarded(e.kind, e.label?.() ?? '', e.images?.())
        : DRAFT_TOAST_TEXT.kept(e.kind, e.label?.() ?? ''),
  });

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => {
        listeners.delete(fn);
      };
    },
    acquire<C>(key: string, create: () => DraftEntry<C>, opts: AcquireOptions = {}) {
      // 書きかけの画面を開いた: その画面自身の知らせ（同じ鍵。取り消し待ちは [元に戻す] を押さなかったので確定する）と、
      // 別の取引の編集の知らせ（編集を開いたとき。#75 N3）は役目を終えた。ほかの知らせは残す（記録を破棄して編集の画面へ
      // 戻っても [元に戻す] を押せる。#75 R1）
      const t = state.toast;
      if (t !== null && (t.key === key || (t.kind === 'edit' && key.startsWith('edit:')))) {
        closeToast();
        emit({ toast: null });
      }
      const kept = slots.get(key);
      if (kept) {
        const s = kept.entry.status();
        if (s !== 'done' || opts.reuseDone) {
          if (kept.leftAt !== null) {
            kept.resumedAt = kept.leftAt;
            kept.leftAt = null;
          }
          if (state.kept.has(key)) emit({ kept: keptWith(key, false) });
          return {
            controller: kept.entry.controller as C,
            restored: true,
            resumedAt: kept.resumedAt,
          };
        }
        slots.delete(key);
        disposeSlot(kept);
        if (state.kept.has(key)) emit({ kept: keptWith(key, false) });
      }
      const entry = create();
      const slot: Slot = {
        entry: entry as DraftEntry<unknown>,
        off: null,
        leftAt: null,
        resumedAt: null,
      };
      slots.set(key, slot);
      watch(key, slot);
      return { controller: entry.controller, restored: false, resumedAt: null };
    },
    release(key, controller) {
      const slot = slots.get(key);
      if (!slot || slot.entry.controller !== controller) return;
      const s = slot.entry.status();
      if (s === 'input' || s === 'saving') {
        slot.leftAt = now();
        slot.resumedAt = null;
        if (s === 'input') {
          // 前の知らせ（破棄の取り消し待ちを含む）は置き換わるので確定する（#75 N2）
          closeToast();
          emit({ kept: keptWith(key, true), toast: toastOf('kept', key, slot.entry) });
          startTimer();
        } else {
          emit({ kept: keptWith(key, true) });
        }
        return;
      }
      slots.delete(key);
      disposeSlot(slot);
    },
    cancel(key) {
      const slot = slots.get(key);
      if (!slot) return 'empty';
      const e = slot.entry;
      if (e.status() === 'saving') return 'busy';
      e.stop?.();
      slots.delete(key);
      const kept = state.kept.has(key) ? { kept: keptWith(key, false) } : {};
      if (e.status() !== 'input') {
        disposeSlot(slot);
        if (state.toast?.key === key) {
          closeToast();
          emit({ ...kept, toast: null });
        } else if (kept.kept) emit(kept);
        return 'empty';
      }
      // 前の取り消し待ちは確定する（同時に待つのは 1 つ）
      closeToast();
      slot.leftAt = now();
      slot.resumedAt = null;
      discarded = { key, slot };
      emit({ ...kept, toast: toastOf('discarded', key, e) });
      startTimer();
      return 'discarded';
    },
    undo() {
      const d = discarded;
      if (!d) return null;
      stopTimer();
      held = false;
      discarded = null;
      const cur = slots.get(d.key);
      if (cur && cur !== d.slot) disposeSlot(cur);
      slots.set(d.key, d.slot);
      emit({ toast: null });
      return d.slot.entry.href;
    },
    back() {
      const t = state.toast;
      if (t?.type !== 'kept') return null;
      const slot = slots.get(t.key);
      closeToast();
      emit({ toast: null });
      return slot ? slot.entry.href : null;
    },
    hold() {
      if (state.toast === null) return;
      held = true;
      stopTimer();
    },
    resume() {
      if (state.toast === null || !held) return;
      held = false;
      startTimer();
    },
    dismiss() {
      closeToast();
      if (state.toast !== null) emit({ toast: null });
    },
    hasInput() {
      for (const s of slots.values()) {
        const st = s.entry.status();
        if (st === 'input' || st === 'saving') return true;
      }
      return false;
    },
    peek<C>(key: string) {
      return slots.get(key)?.entry.controller as C | undefined;
    },
    drop(key) {
      if (discarded?.key === key) {
        closeToast();
        emit({ toast: null });
      }
      const slot = slots.get(key);
      if (slot) {
        slots.delete(key);
        disposeSlot(slot);
      }
      if (state.kept.has(key) || state.toast?.key === key) {
        if (state.toast?.key === key) closeToast();
        emit({
          kept: keptWith(key, false),
          ...(state.toast?.key === key ? { toast: null } : {}),
        });
      }
    },
    keys: () => [...slots.keys()],
    reset() {
      closeToast();
      for (const s of slots.values()) disposeSlot(s);
      slots.clear();
      emit({ toast: null, kept: new Set() });
    },
  };
}
