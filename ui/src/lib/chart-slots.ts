// チャートの枠の通信と状態（Issue #12・#27・#89。設計書 7.5、ADR-0006・ADR-0015）。DOM を持たない。
// 記録する画面（record-controller.ts）と編集の画面（edit-controller.ts）が同じものを使う（二重に作らない）。
// - 枠はエントリー時・決済時と付属の x1〜x5（最大 5 枚・追加した順）。setChart で画像を描き直してプレビューを出すだけで、
//   送るのは呼ぶ側の保存（記録 = POST の multipart、編集 = PUT の multipart）。描き直し中は保存しない（preparing）
// - 時間足: 足した枠・記録する画面で差し替えた枠は空に戻る（選び直し）。編集の画面でエントリー時・決済時を差し替えたときは
//   前に保存した時間足を残し（keptTf）、読めたら置き換え、読み取りが失敗で終われば「前のチャートの時間足のまま」と知らせる。
//   読み取りの途中で保存するときは、呼ぶ側がその枠を「指定なし」で保存する（keptReading。#89 N2）。外すと空
// - 時間足の読み取り（#27）: 枠の画像が使えるようになったら追加の操作なしで POST /api/chart-reads に送り、時間足が空で
//   利用者が触っていなければ読んだ値で埋めて印を付ける。違う値を選んでいれば上書きせず案を出す。AI の読み取りは 1 つずつ
//   （othersBusy = 明細の読み取り中は待つ。明細が先）。差し替え・外す・保存・離れたで止めて、後で届いた応答は捨てる
// - 編集（#89）: 保存済みのチャートは markStored / setStored でプレビュー（stored = 送らない・読み取りに送らない）として置き、
//   元のチャート（originals）を画面を離れるまで持つ。差し替え（replaced）・削除（phase = removed。枠と付属の行は残し
//   [元に戻す] で元のチャートと時間足に戻る）は [保存する] まで送らない
// - 差し替えの描き直しに失敗したら、枠は前のチャート（保存済み・前に入れた画像・削除した状態）のまま戻し、知らせを出す
//   （黙って消さない）。描き直し中にもう 1 枚入れたら戻す先を引き継ぎ、保存済みの枠はどの順で失敗しても保存済み（削除した
//   枠は削除した状態）へ戻る。呼ぶ側が保存で外す（removeChart）のは、利用者が [削除] した枠だけ（removedSlots）
// - 付属の保存済みの行は、[元に戻す]・使えない画像で戻すときに、一言と並びの位置も保存した値へ戻す（#89 N1）
// - エントリー時・決済時の時間足は呼ぶ側の下書き（判定のプレビューに使う）。付属の時間足・一言はここ（extras）が持つ
// - 画像は記憶の中だけ（端末の保存先・URL・履歴に書かない）。プレビューは捨てるときに close する
import type { Timeframe } from '../../../core/trade';
import {
  applyChartRead,
  CHART_READ_MSG,
  CHART_READ_PATH,
  chartReadFailureMessage,
  parseChartReadResponse,
  tfName,
} from './chart-read';
import {
  ALL_SLOTS,
  type AnySlot,
  CHART_SLOT_TEXT,
  type ChartSlot,
  type ChartUpload,
  type ExtraEntry,
  type ExtraSlot,
  freeExtraSlot,
  isMainSlot,
} from './charts';
import { kindOf, type RequestFn } from './request';
import type { PrepareResult, PreviewHandle } from './statement-image';

export const CHART_MSG = {
  notImage: '画像を読み込めませんでした。PNG か JPEG のチャートを選んでください。',
  rejected: 'この画像は使えません。別の画像を選んでください。',
  /** 編集で保存済みのチャートを読み戻せなかった（チャートは残っている。差し替え・削除はできる） */
  loadFailed: 'チャートを読み込めませんでした。差し替え・削除はできます。',
  /** 差し替えの画像を使えなかった（前のチャートのまま） */
  keptNotImage:
    '画像を読み込めませんでした。前のチャートのままです。PNG か JPEG を選んでください。',
  keptRejected: 'この画像は使えません。前のチャートのままです。別の画像を選んでください。',
} as const;

/** 差し替えたチャートの時間足を読めなかった: 前に保存した時間足を残す（デザインの再レビュー 1） */
export function keptTimeframeText(tf: Timeframe): string {
  return `前のチャートの時間足（${tfName(tf)}）のままです。違えば選んでください。`;
}

/** 削除した保存済みのチャートの文（[保存する] で消える。[元に戻す] で戻る） */
export const CHART_REMOVED = 'チャートなし（保存で削除）';

/** チャートの枠の段階: 描き直し中 / 使える（プレビューあり）/ 失敗（決まった文言）/ 保存済みを削除した（編集。#89） */
export type ChartPhase = 'preparing' | 'ready' | 'failed' | 'removed';

export interface ChartState {
  readonly phase: ChartPhase;
  /** 送るものと同じ画像のプレビュー（phase = ready のとき。記憶の中だけ） */
  readonly preview: PreviewHandle | null;
  readonly message: string | null;
  /** 時間足の表示の読み取り（#27。phase = ready のとき）: 読み取り中 / 終わった */
  readonly read?: 'reading' | 'done';
  /** 読み取りの知らせ（読めない・チャートでない・失敗。決まった文言だけ） */
  readonly readNote?: string | null;
  /** 時間足の欄を読み取りで埋めた（印「チャートから読み取り」。利用者が直すと消える） */
  readonly readMark?: boolean;
  /** 利用者が違う値を選んでいたときの、チャートから読めた値（上書きしない。[〈値〉にする] で 1 タップで直せる） */
  readonly readSuggest?: Timeframe | null;
  /** 保存済みのまま（編集。#89）: 送らない・読み取りに送らない。読み戻せなかったときは phase = failed */
  readonly stored?: true;
  /** 保存済みのチャートを差し替えた（編集。#89。枠の名前の横の印「差し替え済み」） */
  readonly replaced?: true;
  /** 編集の 2 枠: 差し替えた後も前に保存した時間足を残している（読めたら置き換える。#89） */
  readonly keptTf?: true;
}

/**
 * 保存の前の帯の知らせ（#89 N2）: 前の時間足を残したまま読み取りの途中の 2 枠（保存ではその枠を「指定なし」にする）
 */
export function keptReadingSlots(charts: ChartsState | undefined): ChartSlot[] {
  return (['entry', 'exit'] as const).filter((s) => {
    const c = charts?.[s];
    return c?.keptTf === true && c.read === 'reading';
  });
}

/** 保存の前の帯の文（「決済時の時間足は読み取りの途中なので指定なしで保存します」） */
export function keptReadingText(slots: readonly ChartSlot[]): string {
  const names = slots.map((s) => CHART_SLOT_TEXT[s].name).join('・');
  return `${names}の時間足は読み取りの途中なので指定なしで保存します`;
}

/** 編集の画面のチャートの変更の数（差し替え・追加・削除した枠。保存の帯に出す。#89） */
export function chartChangeCount(charts: ChartsState | undefined): number {
  return Object.values(charts ?? {}).filter(
    (c) => c !== undefined && (c.phase === 'removed' || (c.phase === 'ready' && !c.stored)),
  ).length;
}

export type ChartsState = Readonly<Partial<Record<AnySlot, ChartState>>>;

export interface ChartSlotsView {
  readonly charts: ChartsState;
  /** 付属の枠（追加した順。画像の無い行 = 足したが、まだ選んでいない） */
  readonly extras: readonly ExtraEntry[];
}

export interface ChartSlotsChange {
  readonly view: ChartSlotsView;
  /** エントリー時・決済時の時間足を変える（鍵がある枠だけ） */
  readonly timeframes?: Partial<Record<ChartSlot, Timeframe | null>>;
  /** 読み取りでログインの切れが分かった */
  readonly authExpired?: true;
}

export interface ChartSlotsDeps {
  readonly request: RequestFn;
  readonly readTimeoutMs: number;
  /** 画像を送る形に描き直す（画面が statement-image.ts の prepareImage を渡す。テストは偽物） */
  readonly prepare?: (file: Blob) => Promise<PrepareResult>;
  /** エントリー時・決済時の時間足（呼ぶ側の下書き） */
  timeframeOf(slot: ChartSlot): Timeframe | null;
  /** 変わったので状態に写す */
  commit(change: ChartSlotsChange): void;
  /** ほかの AI の読み取り（明細）が走っている間は送らない */
  othersBusy?(): boolean;
}

export interface ChartSlots {
  view(): ChartSlotsView;
  /** 枠にチャートがある（使える・保存済み） */
  has(slot: AnySlot): boolean;
  /** 描き直し中の枠がある（保存しない） */
  preparing(): boolean;
  /** 時間足の読み取り中の枠がある */
  reading(): boolean;
  /** チャートを 1 枚、枠に入れる（描き直してプレビューを出し、読み取りに並べる。読み取りが終わるか止まると解決） */
  setChart(slot: AnySlot, file: Blob): Promise<void>;
  /** [削除]: 枠の画像と時間足を消す（付属の枠は行ごと） */
  remove(slot: AnySlot): void;
  /** [＋ チャートを追加]: 空いた付属の枠を末尾に足す（5 枚なら null） */
  addExtra(): ExtraSlot | null;
  /** エントリー時・決済時の時間足を利用者が選んだ（読み取りで上書きしない。印を消す）。呼ぶ側が次に写す */
  touch(slot: AnySlot, value: Timeframe | null): void;
  setExtraTimeframe(slot: ExtraSlot, value: Timeframe | null): void;
  setExtraNote(slot: ExtraSlot, note: string): void;
  /** [〈読めた値〉にする] */
  accept(slot: AnySlot): void;
  /** 保存の前: 終わっていない読み取りを止める（結果を捨てる）。止めた枠を返す。呼ぶ側が次に写す */
  stopReads(): AnySlot[];
  /** 保存の失敗の後: 止めた読み取りを並べ直す */
  requeue(slots: readonly AnySlot[]): void;
  /** 送る画像（新しく入れた枠だけ） */
  uploads(): Partial<Record<AnySlot, ChartUpload>>;
  /** 編集: 読み戻した保存済みのチャートを置く（preview = null は読み戻せなかった）。差し替え・削除の後なら元として持つだけ */
  setStored(slot: AnySlot, preview: PreviewHandle | null): void;
  /**
   * 編集: 保存済みのチャートがある枠を「読み戻し中」で置く（チャートはある = 時間足の欄・判定はそのまま）。
   * timeframe = 保存した時間足（[元に戻す] で戻す値。付属は init の行の値）
   */
  markStored(slot: AnySlot, timeframe?: Timeframe | null): void;
  /** 編集: [元に戻す]（削除・差し替えした枠を保存済みのチャートと時間足に戻す） */
  restore(slot: AnySlot): void;
  /** 編集: 保存で removeChart を送る枠（利用者が [削除] した保存済みの枠で、新しい画像を入れていないもの） */
  removedSlots(): AnySlot[];
  /** 編集: 付属の行を置く（保存した並び） */
  init(extras: readonly ExtraEntry[]): void;
  /** 送っている読み取りが終わるまで待つ（明細の読み取りを後から送る） */
  idle(): Promise<void>;
  /** 待っている読み取りを送る（明細の読み取りが終わったとき） */
  pump(): void;
  /** すべての枠を空に戻す（プレビューを閉じる。知らせは呼ぶ側の次の写しで） */
  clear(): void;
}

/** 戻す先（前の状態・送る画像・時間足） */
interface Stash {
  readonly chart: ChartState;
  readonly bytes?: ChartUpload | undefined;
  readonly timeframe: Timeframe | null;
}

export function createChartSlots(deps: ChartSlotsDeps): ChartSlots {
  let charts: ChartsState = {};
  let extras: readonly ExtraEntry[] = [];
  /** 枠ごとの送る画像（記憶の中だけ）と世代（差し替え・外す・離れたで進め、古い描き直しの結果を捨てる） */
  const bytes: Partial<Record<AnySlot, ChartUpload>> = {};
  const gen = {} as Record<AnySlot, number>;
  const readGen = {} as Record<AnySlot, number>;
  const readAbort: Partial<Record<AnySlot, AbortController>> = {};
  const touched = new Set<AnySlot>();
  for (const s of ALL_SLOTS) {
    gen[s] = 0;
    readGen[s] = 0;
  }
  /** AI の読み取りは 1 つずつ: 送るのを待つ枠（順）と、送っている枠 */
  let queue: AnySlot[] = [];
  let running: AnySlot | null = null;
  const done: Partial<Record<AnySlot, { readonly gen: number; readonly ok: () => void }>> = {};
  let idleWaiters: (() => void)[] = [];
  /** 編集: 保存済みのチャート（枠ごと。プレビューは画面を離れるまで持つ）と保存した時間足 */
  /** 描き直し中の差し替えの戻す先（次の差し替えが引き継ぐ。#89 R1） */
  const pending: Partial<Record<AnySlot, Stash | null>> = {};
  /** 利用者が [削除] した保存済みの枠（保存で removeChart を送るのはこの枠だけ。#89 R1） */
  const removedByUser = new Set<AnySlot>();
  /** 2 枠の時間足を前に保存した値のまま残している（読めたときだけ置き換える。デザインの再レビュー 1） */
  const inherited = new Set<AnySlot>();
  const originals: Partial<
    Record<
      AnySlot,
      {
        preview: PreviewHandle | null;
        loaded: boolean;
        timeframe: Timeframe | null;
        /** 付属の行の一言と並びの位置（保存した並びの何番目か） */
        note?: string;
        index?: number;
      }
    >
  > = {};
  /** 削除した保存済みの付属の枠を、[＋ 追加] で新しい行に使った（印は「追加（未保存）」） */
  const reused = new Set<AnySlot>();

  /** 付属の保存済みの行を、保存した一言と並びの位置へ戻す（#89 N1） */
  const resetRow = (slot: AnySlot) => {
    const o = originals[slot];
    if (isMainSlot(slot) || !o || o.index === undefined) return;
    const row = extras.find((e) => e.slot === slot);
    if (!row) return;
    const rest = extras.filter((e) => e.slot !== slot);
    const at = Math.min(o.index, rest.length);
    extras = [...rest.slice(0, at), { ...row, note: o.note ?? '' }, ...rest.slice(at)];
    reused.delete(slot);
  };

  const view = (): ChartSlotsView => ({ charts, extras });
  const commit = (extra: Omit<ChartSlotsChange, 'view'> = {}) =>
    deps.commit({ view: view(), ...extra });

  const patch = (slot: AnySlot, c: ChartState | undefined) => {
    if (c === undefined) {
      const { [slot]: _gone, ...rest } = charts;
      charts = rest;
    } else {
      charts = { ...charts, [slot]: c };
    }
  };
  const setExtra = (slot: ExtraSlot, p: Partial<ExtraEntry>) => {
    extras = extras.map((e) => (e.slot === slot ? { ...e, ...p } : e));
  };
  const timeframeOf = (slot: AnySlot): Timeframe | null =>
    isMainSlot(slot)
      ? deps.timeframeOf(slot)
      : (extras.find((e) => e.slot === slot)?.timeframe ?? null);

  const settle = (slot: AnySlot, g?: number) => {
    const d = done[slot];
    if (!d || (g !== undefined && d.gen !== g)) return;
    delete done[slot];
    d.ok();
  };

  const stopRead = (slot: AnySlot) => {
    readGen[slot]++;
    queue = queue.filter((s) => s !== slot);
    readAbort[slot]?.abort();
    delete readAbort[slot];
    settle(slot);
  };

  /** 閉じてよいプレビュー（保存済みのチャートのプレビューは元として持つので閉じない） */
  const closePreview = (h: PreviewHandle | null | undefined) => {
    if (!h) return;
    if (Object.values(originals).some((o) => o?.preview === h)) return;
    h.close();
  };

  /** 枠の画像と読み取りを止める。keep = 前の状態を戻す先として持つ（プレビューを閉じない） */
  const drop = (slot: AnySlot, keep = false) => {
    gen[slot]++;
    stopRead(slot);
    touched.delete(slot);
    if (!keep) {
      closePreview(charts[slot]?.preview);
      closePreview(pending[slot]?.chart.preview);
      delete pending[slot];
      delete bytes[slot];
      inherited.delete(slot);
    }
  };

  /** 保存済みの枠の戻す先（安全網）: 削除していれば削除した状態、ほかは保存済みの状態と保存した時間足 */
  const storedBack = (slot: AnySlot): Stash | null => {
    const o = originals[slot];
    const st = storedState(slot);
    if (!o || !st) return null;
    if (removedByUser.has(slot)) {
      return { chart: { phase: 'removed', preview: null, message: null }, timeframe: null };
    }
    return { chart: st, timeframe: o.timeframe };
  };

  /** 保存済みのチャートの状態（読み戻し中・読み戻した・読み戻せなかった） */
  const storedState = (slot: AnySlot): ChartState | undefined => {
    const o = originals[slot];
    if (!o) return undefined;
    if (o.preview) return { phase: 'ready', preview: o.preview, message: null, stored: true };
    return o.loaded
      ? { phase: 'failed', preview: null, message: CHART_MSG.loadFailed, stored: true }
      : { phase: 'ready', preview: null, message: null, stored: true };
  };

  const pump = () => {
    if (running !== null || deps.othersBusy?.()) return;
    const slot = queue.shift();
    if (slot === undefined) return;
    const upload = bytes[slot];
    const g = readGen[slot];
    if (!upload || charts[slot]?.read !== 'reading') {
      settle(slot, g);
      pump();
      return;
    }
    running = slot;
    void readChart(slot, g, upload).finally(() => {
      running = null;
      settle(slot, g);
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const w of waiters) w();
      pump();
    });
  };

  const readChart = async (slot: AnySlot, g: number, upload: ChartUpload) => {
    const ctl = new AbortController();
    readAbort[slot] = ctl;
    const live = () => g === readGen[slot] && charts[slot]?.phase === 'ready';
    const finish = (p: Partial<ChartState>, extra: Omit<ChartSlotsChange, 'view'> = {}) => {
      const c = charts[slot];
      if (!live() || !c) return;
      patch(slot, { ...c, read: 'done', ...p, readNote: quiet(p.readNote ?? null) });
      commit(extra);
    };
    /**
     * 知らせの出し方: 追加の枠は読めなくても黙る（判定に使わず、時間足の無い資料も入る。デザインの再レビュー 2）。
     * 前に保存した時間足を残している 2 枠は「前のチャートの時間足のまま」
     */
    const quiet = (note: string | null): string | null => {
      if (!isMainSlot(slot)) return null;
      const kept = deps.timeframeOf(slot);
      if (inherited.has(slot) && kept !== null) return keptTimeframeText(kept);
      return note;
    };
    try {
      const res = await deps.request(
        CHART_READ_PATH,
        {
          method: 'POST',
          headers: { 'Content-Type': upload.contentType },
          body: upload.bytes as BodyInit,
        },
        { ms: deps.readTimeoutMs, ctl },
      );
      if (!live()) return;
      if (res.status !== 200) {
        finish({ readNote: chartReadFailureMessage(res.status) });
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!live()) return;
      const result = parseChartReadResponse(json);
      if (result === null) {
        finish({ readNote: CHART_READ_MSG.failed });
        return;
      }
      // 前に保存した時間足を残している枠は、利用者の値ではないので読めた値で置き換える
      const current = inherited.has(slot) ? null : timeframeOf(slot);
      const applied = applyChartRead(result, current, touched.has(slot));
      if (applied.value !== undefined) inherited.delete(slot);
      const c = charts[slot];
      if (!c) return;
      const { keptTf: _kept, ...base } = c;
      patch(slot, {
        ...(applied.value !== undefined ? base : c),
        read: 'done',
        readNote: applied.value !== undefined ? null : quiet(applied.note),
        readMark: applied.marked,
        readSuggest: applied.suggest ?? null,
      });
      if (applied.value !== undefined && !isMainSlot(slot)) {
        setExtra(slot, { timeframe: applied.value });
      }
      commit(
        applied.value !== undefined && isMainSlot(slot)
          ? { timeframes: { [slot]: applied.value } }
          : {},
      );
    } catch (e) {
      if (!live()) return;
      if (kindOf(e) === 'auth') {
        finish({ readNote: null }, { authExpired: true });
        return;
      }
      finish({ readNote: CHART_READ_MSG.failed });
    } finally {
      if (readAbort[slot] === ctl) delete readAbort[slot];
    }
  };

  /** 枠の時間足を空に戻す変更（エントリー時・決済時は呼ぶ側の下書き、付属はここ） */
  const clearTimeframe = (slot: AnySlot): Omit<ChartSlotsChange, 'view'> => {
    if (isMainSlot(slot)) return { timeframes: { [slot]: null } };
    setExtra(slot, { timeframe: null });
    return {};
  };

  const touch = (slot: AnySlot, value: Timeframe | null) => {
    touched.add(slot);
    inherited.delete(slot);
    const k = charts[slot];
    if (k?.keptTf) {
      const { keptTf: _k, ...rest } = k;
      patch(slot, rest);
    }
    const c = charts[slot];
    if (c && (c.readMark || c.readNote || c.readSuggest)) {
      // 読めた値と同じ値を選んだら案は消す（違う値のままなら案を残す）
      const suggest = c.readSuggest && c.readSuggest !== value ? c.readSuggest : null;
      patch(slot, { ...c, readMark: false, readNote: null, readSuggest: suggest });
    }
  };

  const has = (slot: AnySlot) => {
    const c = charts[slot];
    return c !== undefined && (c.phase === 'ready' || (c.stored === true && c.phase === 'failed'));
  };

  return {
    view,
    has,
    preparing: () => ALL_SLOTS.some((s) => charts[s]?.phase === 'preparing'),
    reading: () => ALL_SLOTS.some((s) => charts[s]?.read === 'reading'),
    async setChart(slot, file) {
      if (!deps.prepare) return;
      if (!isMainSlot(slot) && !extras.some((e) => e.slot === slot)) {
        if (freeExtraSlot(extras) === null) return;
        extras = [...extras, { slot, timeframe: null, note: '' }];
      }
      // 戻す先（描き直しに失敗したとき）: 前の状態（保存済み・前に入れた画像・その時間足）。描き直しの途中にもう 1 枚
      // 入れたら、走っている差し替えの戻す先を引き継ぐ。削除した保存済みの枠は「削除した」に戻す（#89 R1・R2）
      const before = charts[slot];
      const own: Stash | null =
        before !== undefined &&
        (before.phase === 'ready' || (before.stored === true && before.phase === 'failed'))
          ? { chart: before, bytes: bytes[slot], timeframe: timeframeOf(slot) }
          : before?.phase === 'removed'
            ? { chart: before, bytes: undefined, timeframe: null }
            : null;
      const stash = own ?? (before?.phase === 'preparing' ? (pending[slot] ?? null) : null);
      drop(slot, true);
      delete bytes[slot];
      pending[slot] = stash;
      const g = gen[slot];
      patch(slot, { phase: 'preparing', preview: null, message: null });
      // 時間足: 記録する画面は空に戻す（選び直し）。編集の画面の 2 枠は前に保存した時間足を残し、読めたときだけ
      // 置き換える（読めなければ「前のチャートの時間足のまま」。デザインの再レビュー 1）
      const keepTf =
        isMainSlot(slot) && originals[slot] !== undefined && (stash?.timeframe ?? null) !== null;
      if (keepTf && stash?.timeframe) {
        inherited.add(slot);
        commit({ timeframes: { [slot]: stash.timeframe } });
      } else {
        inherited.delete(slot);
        commit(clearTimeframe(slot));
      }
      let prepared: PrepareResult;
      try {
        prepared = await deps.prepare(file);
      } catch {
        prepared = { ok: false, error: 'not_image' };
      }
      if (g !== gen[slot] || charts[slot]?.phase !== 'preparing') {
        // 新しい差し替え・削除・元に戻すが先に進んだ: 戻す先は次の差し替えが引き継ぐ（ここでは閉じない）
        if (prepared.ok) prepared.image.preview.close();
        return;
      }
      delete pending[slot];
      if (!prepared.ok) {
        const notImage = prepared.error === 'not_image';
        // 保存済みの枠は、どの順で失敗しても保存済み（または削除した）の状態へ戻す（安全網。#89 R1）
        const back = stash ?? (originals[slot] ? storedBack(slot) : null);
        if (back) {
          // 差し替えに失敗: 前のチャートと時間足に戻し、知らせだけを出す（保存で消さない。#89 B1）
          const { read: _r, ...prevChart } =
            back.chart.stored && back.chart.phase !== 'removed'
              ? (storedState(slot) ?? back.chart)
              : back.chart;
          const removedBack = back.chart.phase === 'removed';
          const { keptTf: _kt, ...prevBase } = prevChart;
          patch(slot, {
            ...prevBase,
            ...(back.chart.read === undefined ? {} : { read: 'done' as const }),
            readNote: null,
            // 削除した枠に戻すときは「前のチャートのまま」と言わない（枠は「チャートなし（保存で削除）」。#89 N4）
            message: removedBack
              ? notImage
                ? CHART_MSG.notImage
                : CHART_MSG.rejected
              : notImage
                ? CHART_MSG.keptNotImage
                : CHART_MSG.keptRejected,
          });
          if (back.bytes) bytes[slot] = back.bytes;
          inherited.delete(slot);
          // 削除した枠を新しい行に使っていたら、行を保存した一言と位置へ戻す（#89 N1）
          if (removedBack && reused.has(slot)) resetRow(slot);
          if (isMainSlot(slot)) {
            commit({ timeframes: { [slot]: back.timeframe } });
          } else {
            setExtra(slot, { timeframe: back.timeframe });
            commit();
          }
          return;
        }
        patch(slot, {
          phase: 'failed',
          preview: null,
          message: notImage ? CHART_MSG.notImage : CHART_MSG.rejected,
        });
        commit();
        return;
      }
      closePreview(stash?.chart.preview);
      removedByUser.delete(slot);
      const { bytes: b, contentType, preview } = prepared.image;
      bytes[slot] = { bytes: b, contentType };
      patch(slot, {
        phase: 'ready',
        preview,
        message: null,
        read: 'reading',
        readNote: null,
        ...(originals[slot] && !reused.has(slot) ? { replaced: true as const } : {}),
        ...(inherited.has(slot) ? { keptTf: true as const } : {}),
      });
      commit();
      const wait = new Promise<void>((ok) => {
        done[slot] = { gen: readGen[slot], ok };
      });
      queue.push(slot);
      pump();
      await wait;
    },
    remove(slot) {
      drop(slot);
      if (originals[slot]) {
        removedByUser.add(slot);
        // 保存済みのチャート: 枠（付属は行）は残して「保存で削除」と [元に戻す]（#89）
        patch(slot, { phase: 'removed', preview: null, message: null });
        if (isMainSlot(slot)) {
          commit({ timeframes: { [slot]: null } });
        } else {
          setExtra(slot, { timeframe: null });
          commit();
        }
        return;
      }
      patch(slot, undefined);
      if (isMainSlot(slot)) {
        commit({ timeframes: { [slot]: null } });
        return;
      }
      extras = extras.filter((e) => e.slot !== slot);
      commit();
    },
    restore(slot) {
      const o = originals[slot];
      const back = storedState(slot);
      if (!o || !back) return;
      drop(slot);
      removedByUser.delete(slot);
      patch(slot, back);
      if (isMainSlot(slot)) {
        commit({ timeframes: { [slot]: o.timeframe } });
        return;
      }
      setExtra(slot, { timeframe: o.timeframe });
      resetRow(slot);
      commit();
    },
    addExtra() {
      let slot = freeExtraSlot(extras);
      if (slot === null) {
        // 削除した保存済みの枠は 5 枚に数えない（デザインの再レビュー 7）: その枠を末尾の新しい行に使う。保存では
        // 新しい画像で置き換わる（画像を選ばなければ削除のまま送る）
        const freed = extras.find((e) => charts[e.slot]?.phase === 'removed');
        if (!freed) return null;
        slot = freed.slot;
        extras = extras.filter((e) => e.slot !== freed.slot);
        patch(slot, undefined);
        removedByUser.add(slot);
        reused.add(slot);
      }
      extras = [...extras, { slot, timeframe: null, note: '' }];
      commit();
      return slot;
    },
    removedSlots: () => ALL_SLOTS.filter((s) => removedByUser.has(s) && !has(s)),
    touch,
    setExtraTimeframe(slot, value) {
      touch(slot, value);
      setExtra(slot, { timeframe: value });
      commit();
    },
    setExtraNote(slot, note) {
      setExtra(slot, { note });
      commit();
    },
    accept(slot) {
      const c = charts[slot];
      if (!c?.readSuggest) return;
      const tf = c.readSuggest;
      patch(slot, { ...c, readMark: true, readSuggest: null, readNote: null });
      if (isMainSlot(slot)) {
        commit({ timeframes: { [slot]: tf } });
        return;
      }
      setExtra(slot, { timeframe: tf });
      commit();
    },
    stopReads() {
      const stopped: AnySlot[] = [];
      for (const slot of ALL_SLOTS) {
        const c = charts[slot];
        if (c?.read !== 'reading') continue;
        stopRead(slot);
        patch(slot, { ...c, read: 'done', readNote: null });
        stopped.push(slot);
      }
      return stopped;
    },
    requeue(slots) {
      let any = false;
      for (const slot of slots) {
        const c = charts[slot];
        if (c?.phase !== 'ready' || !bytes[slot]) continue;
        patch(slot, { ...c, read: 'reading', readNote: null });
        queue.push(slot);
        any = true;
      }
      if (!any) return;
      commit();
      pump();
    },
    uploads() {
      const out: Partial<Record<AnySlot, ChartUpload>> = {};
      for (const slot of ALL_SLOTS) {
        const b = bytes[slot];
        if (b && charts[slot]?.phase === 'ready' && !charts[slot]?.stored) out[slot] = b;
      }
      return out;
    },
    setStored(slot, preview) {
      const o = originals[slot];
      if (!o) {
        preview?.close();
        return;
      }
      if (o.preview && o.preview !== preview) o.preview.close();
      o.preview = preview;
      o.loaded = true;
      // まだ保存済みのまま（差し替え・削除していない）枠だけ表示を置き換える
      if (charts[slot]?.stored) {
        patch(slot, storedState(slot));
        commit();
      }
    },
    markStored(slot, timeframe = null) {
      originals[slot] = { preview: null, loaded: false, timeframe };
      patch(slot, storedState(slot));
      commit();
    },
    init(rows) {
      extras = rows;
      rows.forEach((e, i) => {
        const o = originals[e.slot];
        if (!o) return;
        o.timeframe = e.timeframe;
        o.note = e.note;
        o.index = i;
      });
      commit();
    },
    idle: () => (running === null ? Promise.resolve() : new Promise((ok) => idleWaiters.push(ok))),
    pump,
    clear() {
      for (const slot of ALL_SLOTS) drop(slot);
      removedByUser.clear();
      reused.clear();
      for (const slot of ALL_SLOTS) {
        originals[slot]?.preview?.close();
        delete originals[slot];
      }
      charts = {};
      extras = [];
    },
  };
}
