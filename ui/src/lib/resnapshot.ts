// 記録したときの値と今の値（Issue #31。設計書 C36・C41・5.1・5.3）の純関数。DOM・通信・現在時刻に触れない。
// - 編集の画面は既定で、取引に保存した記録したときの値（口座・銘柄を付け替えたら付け替え先の今の値）で計算する
//   （edit-form.ts の editSnapshot）。ここでは取引の口座・銘柄の今の値（currentSnapshot）と比べ、違う値の行（記録したとき → 今）と、
//   その値で再計算したときの判定・R・リスク（%）の 前 → 後 を作る（resnapshotOffer）。違わなければ null（何も出さない）
// - 再計算を勧める文（resnapshotLead）を出すのは、記録したときの資金（または銘柄の値）が空で、今の値が入っているときだけ
//   （prominent）。#131 で、詳細・編集とも比較は 1 行「今の値と比べる」→ 比較のシートにした（設計書 9.2）。シートでは違いと
//   判定・R・リスクの 前 → 後 を必ず見せる。判定が良い方へ変わるときも
//   変わることをはっきり書く（隠さない・勧めない。#31 Phase 4 N-5 の main の決定）
// - 利用者が「今の値」を選んで保存したときだけ、API が保存の時点の今の値で保存し直す（PUT の ?snapshot=current）
// - 口座の通貨（#47 PR-2）: 今の値には口座の通貨も入る（無い = JPY と読んで比べる）。資金は各々の口座の通貨で書く。
//   今の値で為替が意味を失う（口座の通貨が変わる・決まった価格の通貨どうしが違う）なら、打った為替を外して計算し・送る
//   （withoutStaleFx。価格の通貨が未設定 → 決まった通貨では保つ）
import {
  type AccountRecord,
  accountCurrencyOf,
  type InstrumentRecord,
  type InstrumentSnapshot,
  type StoredTrade,
  type TradeRecord,
  type TradeSnapshot,
} from '../../../core/record';
import { badgeModel } from './badge';
import { draftFromStored, editBlock, editContext, editSnapshot, mergedOf } from './edit-form';
import { formatAmount, formatNumber, formatPct, formatPlain, formatR } from './format';
import type { Draft, DraftContext, DraftReading, Summary } from './record-form';
import { fxStale, readDraft, summarize } from './record-form';
import { quietR } from './risky-win';
import { PRODUCT_FORM_LABEL, UNDERLYING_KIND_LABEL } from './settings-form';

/** 取引の PUT に付けるクエリ（API の SNAPSHOT_CURRENT と同じ） */
export const RESNAPSHOT_QUERY = '?snapshot=current';

/** 取引の口座・銘柄の今の値（付け替えの有無によらず、今の口座・銘柄を引く。一覧に無い名前の銘柄は既定の値） */
export function currentSnapshot(
  read: DraftReading,
  ctx: DraftContext,
  draft: Pick<Draft, 'accountId'>,
): TradeSnapshot {
  const { base: _base, ...rest } = ctx;
  return editSnapshot(read, rest, draft);
}

export interface SnapshotDiff {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

const NOT_SET = '未設定';

const capitalText = (v: number | null, currency: string) =>
  v === null ? NOT_SET : formatAmount(v, currency);
const pctText = (v: number) => `${formatPlain(v)}%`;
const currencyText = (v: string | null) => v ?? NOT_SET;

type InstrumentRow = {
  readonly [K in keyof InstrumentSnapshot]: {
    readonly key: K;
    readonly label: string;
    readonly text: (v: InstrumentSnapshot[K]) => string;
  };
}[keyof InstrumentSnapshot];

const INSTRUMENT_ROWS: readonly InstrumentRow[] = [
  { key: 'multiplier', label: '乗数', text: formatNumber },
  { key: 'quantityStep', label: '数量の刻み', text: formatNumber },
  { key: 'priceCurrency', label: '価格の通貨', text: currencyText },
  { key: 'underlyingKind', label: '原資産の種類', text: (v) => UNDERLYING_KIND_LABEL[v] },
  { key: 'productForm', label: '取引の形態', text: (v) => PRODUCT_FORM_LABEL[v] },
];

/** 違う値の行（資金・許容リスク・銘柄の 5 つの値の順。同じ値は出さない） */
export function snapshotDiffs(from: TradeSnapshot, to: TradeSnapshot): readonly SnapshotDiff[] {
  const out: SnapshotDiff[] = [];
  const fromCurrency = accountCurrencyOf(from);
  const toCurrency = accountCurrencyOf(to);
  if (from.capitalYen !== to.capitalYen || fromCurrency !== toCurrency) {
    out.push({
      label: '資金',
      from: capitalText(from.capitalYen, fromCurrency),
      to: capitalText(to.capitalYen, toCurrency),
    });
  }
  if (fromCurrency !== toCurrency) {
    out.push({ label: '口座の通貨', from: fromCurrency, to: toCurrency });
  }
  if (from.riskTolerancePct !== to.riskTolerancePct) {
    out.push({
      label: '許容リスク',
      from: pctText(from.riskTolerancePct),
      to: pctText(to.riskTolerancePct),
    });
  }
  for (const row of INSTRUMENT_ROWS) {
    const a = from.instrument[row.key];
    const b = to.instrument[row.key];
    if (a !== b) {
      const text = row.text as (v: typeof a) => string;
      out.push({ label: row.label, from: text(a), to: text(b) });
    }
  }
  return out;
}

/**
 * 写し直す先（to）で為替が意味を失うなら、記録の為替を外す（為替は「価格の通貨 1 単位 = 口座の通貨」）。外すのは口座の通貨が
 * 変わる、または決まった価格の通貨どうしが違う（USD → EUR）ときだけ。価格の通貨が未設定 → 決まった通貨（取り込んだ取引に
 * 価格の通貨を入れた）は為替を保つ（未設定の銘柄の為替も同じ意味で計算に使っているため。#47 PR-2 の再レビュー block。
 * record-form.ts の fxStale と同じ規則）
 */
export function withoutStaleFx(
  record: TradeRecord,
  from: TradeSnapshot,
  to: TradeSnapshot,
): TradeRecord {
  const stale = fxStale(
    { price: from.instrument.priceCurrency, account: accountCurrencyOf(from) },
    { price: to.instrument.priceCurrency, account: accountCurrencyOf(to) },
  );
  if (!stale || record.exit.fxRate === undefined) return record;
  const { fxRate: _stale, ...exit } = record.exit;
  return { ...record, exit };
}

export interface ResnapshotOffer {
  readonly diffs: readonly SnapshotDiff[];
  /** 今の値（保存で写る値の見込み。保存の時点の値は API が読む） */
  readonly snapshot: TradeSnapshot;
  /** 写した値での計算と、今の値での計算（保存する記録がそろっていないときは undefined） */
  readonly before?: Summary;
  readonly after?: Summary;
  /** 記録したときの資金が空で、今の口座の資金がある */
  readonly capitalFromEmpty: boolean;
  /** 記録したときの資金・銘柄の値に空のものがあり、今の値が入っている（目立つ枠で勧める。それ以外は折りたたみ） */
  readonly prominent: boolean;
  /** 判定の枠の注記（資金が未設定なので…）のそばにも操作を出す: capitalFromEmpty で、再計算するとリスク（%）が出る */
  readonly nearVerdict: boolean;
}

/**
 * 写し直しの提案。stored = 保存に使う値（editSnapshot）、current = 今の値（currentSnapshot）、
 * merged = 保存する記録（足りない欄・誤りがあれば undefined）。違う値が無ければ null
 */
export function resnapshotOffer(
  stored: TradeSnapshot,
  current: TradeSnapshot,
  merged: TradeRecord | undefined,
): ResnapshotOffer | null {
  const diffs = snapshotDiffs(stored, current);
  if (diffs.length === 0) return null;
  const capitalFromEmpty = stored.capitalYen === null && current.capitalYen !== null;
  const prominent =
    capitalFromEmpty ||
    (stored.instrument.priceCurrency === null && current.instrument.priceCurrency !== null);
  if (merged === undefined) {
    return { diffs, snapshot: current, capitalFromEmpty, prominent, nearVerdict: false };
  }
  const after = summarize({ record: withoutStaleFx(merged, stored, current), snapshot: current });
  return {
    diffs,
    snapshot: current,
    before: summarize({ record: merged, snapshot: stored }),
    after,
    capitalFromEmpty,
    prominent,
    nearVerdict: capitalFromEmpty && after.riskPct !== undefined,
  };
}

export interface OutcomeRow {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly changed: boolean;
  /** R の行で、前 / 後の判定が危ない勝ち（その側の R を静かな形で出す。#227・C59）。ほかの行・判定には無い */
  readonly fromQuiet?: true;
  readonly toQuiet?: true;
}

const NONE = '—';

function gradeText(s: Summary): string {
  return badgeModel(s.judgment?.grade ?? null).label;
}

/** 判定・R・リスク（%）の 前 → 後（出ない値は「—」）。変わる行を先に、変わらない行は後に（同じ中では判定・R・リスクの順） */
export function outcomeRows(before: Summary, after: Summary): readonly OutcomeRow[] {
  const r = (s: Summary) => (s.r === undefined ? NONE : formatR(s.r));
  const risk = (s: Summary) => (s.riskPct === undefined ? NONE : formatPct(s.riskPct));
  const rows = [
    { label: '判定', from: gradeText(before), to: gradeText(after) },
    {
      label: 'R',
      from: r(before),
      to: r(after),
      ...(quietR(before.judgment?.grade) ? { fromQuiet: true as const } : {}),
      ...(quietR(after.judgment?.grade) ? { toQuiet: true as const } : {}),
    },
    { label: 'リスク', from: risk(before), to: risk(after) },
  ].map((x) => ({ ...x, changed: x.from !== x.to }));
  return [...rows.filter((x) => x.changed), ...rows.filter((x) => !x.changed)];
}

/** 判定が変わるときの 1 文（良い方へも悪い方へも同じ形ではっきり書く。変わらなければ null）。小見出し「今の値で再計算すると」の直後に置くので、同じ書き出しを繰り返さない（#131 のデザインレビュー a4） */
export function gradeChangeText(before: Summary, after: Summary): string | null {
  const a = gradeText(before);
  const b = gradeText(after);
  return a === b ? null : `判定が「${a}」から「${b}」に変わります。`;
}

/** 判定・R・リスクがどれも変わらないときの 1 行 */
export const NO_OUTCOME_CHANGE = '再計算しても、判定・R・リスクは変わりません。';

/** 保存する記録がそろっていないとき */
export const OUTCOME_PENDING =
  '未入力の欄を入力すると、再計算したときの判定・R・リスクが表示されます。';

/** 判定の枠の注記のそばのボタン */
export const RESNAPSHOT_LABEL = '今の値で再計算';

/** 2 択（L / S と同じ部品）の見出しと選択肢 */
export const CHOICE_LABEL = '計算に使う値';
export type ResnapshotChoice = 'recorded' | 'current';
export const CHOICE_OPTIONS: readonly { value: ResnapshotChoice; label: string }[] = [
  { value: 'recorded', label: '記録したとき' },
  { value: 'current', label: '今の値' },
];
/** 2 択の radio の名前（判定の枠のそばのボタンを押した後、「今の値」へフォーカスを移す目印） */
export const CHOICE_NAME = 'edit-resnapshot';

/** 枠の最初の 1 文（目立つ枠のときは何が判定できるようになるかを言う） */
export function resnapshotLead(offer: ResnapshotOffer): string {
  if (offer.capitalFromEmpty) {
    const yen =
      offer.snapshot.capitalYen === null
        ? ''
        : formatAmount(offer.snapshot.capitalYen, accountCurrencyOf(offer.snapshot));
    return offer.nearVerdict
      ? `この取引には資金が保存されていないため、過剰リスクを判定していません。今の資金 ${yen} で再計算すると判定します。`
      : `この取引には資金が保存されていません。今の資金は ${yen} です。`;
  }
  if (offer.prominent)
    return 'この取引には銘柄の値の一部が保存されていません。今の値で再計算できます。';
  return '記録したときの口座・銘柄の値と、今の値が違います。';
}

/** どちらの値で保存するかと、戻し方 */
export function resnapshotStatus(on: boolean): string {
  return on
    ? '今の値で保存します。この取引の資金・銘柄の値が今の値に更新されます（戻すには「記録したとき」を選びます）。'
    : '記録したときの値で計算しています。このまま保存しても変わりません（再計算するには「今の値」を選びます）。';
}

/**
 * 詳細の比較のシート（#131。設計書 9.2・#31 の P4）: 開いた編集の画面が出すのと同じ提案を、保存した取引と今の銘柄・口座から
 * 作る（下書きは開いたときのまま = 何も変えていない編集。チャートの有無は保存した取引の枠）。見るだけで、写し直すのは編集の
 * 保存のときだけ。直せない取引（editBlock）と、違う値が無い取引は null
 */
export function detailOffer(
  trade: StoredTrade,
  instruments: readonly InstrumentRecord[],
  accounts: readonly AccountRecord[],
): ResnapshotOffer | null {
  if (editBlock(trade) !== null) return null;
  // レッグを持つ取引（#116）: 下書き・保存の本文はレッグを写さない（edit-form.ts）ので、比べた 前 → 後 がレッグ抜きの値になり、
  // 詳細の判定の枠と食い違う。見るだけの詳細では値を出さない（レッグの画面で決め直す。#117・#131 のレビュー N3）
  if ((trade.record.legs?.length ?? 0) > 0) return null;
  const draft = draftFromStored(trade, instruments);
  const ctx = editContext(trade, instruments, accounts);
  const read = readDraft(draft, ctx);
  const id = read.instrument.matchedId ?? trade.record.instrumentId;
  const merged = mergedOf(trade, draft, draft, read, id, ctx);
  return resnapshotOffer(editSnapshot(read, ctx, draft), currentSnapshot(read, ctx, draft), merged);
}

/**
 * 詳細の比較のシートの ［編集で今の値にする］ で開く編集の URL（#131）。検索部分の印で、編集の画面が読み込んだ後に
 * 「今の値」を選ぶ（保存までは何も写し直さない）
 */
export const CURRENT_VALUES_PARAM = 'values';
export const CURRENT_VALUES_VALUE = 'current';
export function editCurrentHref(id: string): string {
  return `/trades/${id}/edit?${CURRENT_VALUES_PARAM}=${CURRENT_VALUES_VALUE}`;
}

/** 編集の URL の検索部分が「今の値」を選んで開く印か */
export function wantsCurrentValues(search: string): boolean {
  try {
    return new URLSearchParams(search).get(CURRENT_VALUES_PARAM) === CURRENT_VALUES_VALUE;
  } catch {
    return false;
  }
}

/** 詳細の ［編集で今の値にする］（9.12 の 2 番目の重さ） */
export const EDIT_CURRENT_LABEL = '編集で今の値にする';

/** 詳細の比較のシートの最後の 1 行（見るだけで、何も変えていないこと） */
export const DETAIL_COMPARE_NOTE =
  'この画面では値を変えません。今の値で再計算するには、編集で「今の値」を選んで保存します。';

/** 「今の値と比べる」の行の右の添え（違う値の数。編集で「今の値」を選んでいればそのこと） */
export function compareRowMeta(offer: ResnapshotOffer, on = false): string {
  return on ? '今の値で計算中' : `${offer.diffs.length} か所違います`;
}

/** 「今の値と比べる」の行・比較のシートの題 */
export const COMPARE_ROW_LABEL = '今の値と比べる';
export const COMPARE_SHEET_TITLE = '記録したときの値と今の値';
