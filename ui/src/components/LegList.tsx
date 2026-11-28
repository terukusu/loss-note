// オプションのポジションの足の一覧（#117。設計書 7.6「足は 1 本 2 行のカード … 押すとその足のシート」）。
// 記録する画面（取引の欄のシート）と直す画面が共有する。hook を持たない。値はテキストのノードだけ。
// - 1 本 = 押せる行（RowLink。右に ›）の 2 行: 1 行目「売り 2 · P 36,000 · 2027-01」、2 行目「120 → 60」。誤り・未入力は右の添え
// - 下に [＋ 足]（tonal。10 本で押せない）。10 本まで並べても横にスクロールしない（行の中で折る）
// - 記録する画面だけ [＋ 足] の隣に ［明細から追加］（#260・C73。2 枚目の明細から足を追加する）。押せない理由・読み取り中の 1 行と
//   ［キャンセル］・結果の知らせと ［元に戻す］ は一覧の中（シートの中なのでトーストではない）
// - 損益の内訳は出さない（記録の画面は判定が主役。7.6）
import type { ComponentChildren } from 'preact';
import type { LegDraft, LegField } from '../lib/legs-form';
import {
  LEG_UNDO_FULL,
  legCardText,
  legReadText,
  MAX_LEGS,
  YEAR_INFERRED_CHIP,
} from '../lib/legs-form';
import { ADD_LEGS_LABEL } from '../lib/statement-add-legs';
import '../styles/legs.css';
import { Button, RowLink } from './Button';

export const LEG_LIST_ID = 'record-legs';

export interface LegListProps {
  readonly legs: readonly LegDraft[];
  /** 足ごとの欄の誤り（readDraft の option.legErrors） */
  readonly errors?: readonly Readonly<Partial<Record<LegField, string>>>[];
  readonly onOpen: (index: number) => void;
  readonly onAdd: () => void;
  /** 一覧の上の 1 行の誤り（足が無いまま保存しようとした など） */
  readonly error?: string;
  /** 直前に消した足（「足 2 を削除しました ［元に戻す］」。P4）。省けば出さない */
  readonly removed?: string | null;
  readonly onUndo?: () => void;
  /**
   * 明細の次のポジション（同じ原資産。#118・7.6）の足の本数。あれば一覧の下に「次のポジション（足 N 本）
   * ［このポジションに入れる］」を出す（ナイト・セッションの 0 時またぎなどで分かれたまとまりを 1 タップでまとめる）
   */
  readonly nextPosition?: NextPosition | null;
  readonly onMergeNext?: () => void;
  /** 直前の操作の知らせ（「足 2 を別のポジションにしました」。デザインレビュー 4）。省けば出さない */
  readonly notice?: string | null;
  /** ［明細から追加］（記録する画面だけ。#260）。省けば出さない（直す画面） */
  readonly fromStatement?: LegAddView;
}

/** ［明細から追加］ の見せ方（#260） */
export interface LegAddView {
  /** 押せない理由（押せれば null。読み取り中は reading の行が理由を兼ねる） */
  readonly blocked: string | null;
  readonly reading: boolean;
  /** 結果の 1 行（追加した・追加しなかった理由・失敗。無ければ null） */
  readonly notice: string | null;
  /** ［元に戻す］ を出す（追加した直後だけ） */
  readonly undo: boolean;
  readonly onPick: (file: File) => void;
  readonly onCancel: () => void;
  readonly onUndo: () => void;
}

export const LEG_ADD_FROM_ID = `${LEG_LIST_ID}-from`;
export const LEG_ADD_FILE_ID = `${LEG_ADD_FROM_ID}-file`;
export const LEG_ADD_UNDO_ID = `${LEG_ADD_FROM_ID}-undo`;
export const LEG_ADD_CANCEL_ID = `${LEG_ADD_FROM_ID}-cancel`;
export const LEG_ADD_READING = '明細の足を読み取っています…';

/** 明細の次のポジション（同じ原資産。#118・7.6）の見出しの中身 */
export interface NextPosition {
  /** 足の本数 */
  readonly legs: number;
  /** 1 本目の足の 1 行（一覧の行と同じ書き方「売り 1 · C 41,000 · 2027-01」） */
  readonly head: string;
  /** エントリーの日（「12/09」。読めなければ null） */
  readonly opened: string | null;
}

export const LEG_MERGE_ID = `${LEG_LIST_ID}-merge`;
export const MERGE_LABEL = 'このポジションに入れる';
export const MERGE_FULL = `足は ${MAX_LEGS} 本までです`;
export const nextPositionTitle = (n: NextPosition) =>
  `明細の次のポジション${n.opened === null ? '' : ` · エントリー ${n.opened}`}`;
export const nextPositionLine = (n: NextPosition) =>
  n.legs >= 2 ? `${n.head}（ほか ${n.legs - 1} 本）` : n.head;

export const LEG_UNDO_ID = `${LEG_LIST_ID}-undo`;

/** 行の右の添え（誤り > 未入力 > 明細から読んだ印「読み取り · 年を補った」。#118） */
export function legMeta(
  leg: LegDraft,
  errors: Partial<Record<LegField, string>> | undefined,
): string | null {
  if (errors && Object.keys(errors).length > 0) return '誤りあり';
  const { head, prices } = legCardText(leg);
  if (head.includes('?') || prices.includes('?')) return '未入力あり';
  return legReadText(leg);
}

export function LegList(p: LegListProps) {
  const full = p.legs.length >= MAX_LEGS;
  const addButton = (
    <Button
      variant="tonal"
      size="sm"
      icon="plus"
      id={`${LEG_LIST_ID}-add`}
      label="足を追加"
      disabled={full}
      onClick={p.onAdd}
    >
      足
    </Button>
  );
  return (
    <div class="legs" id={LEG_LIST_ID}>
      <div class="legs__head">
        <span class="field__label" id={`${LEG_LIST_ID}-title`}>
          足
        </span>
        <span class="legs__count">{p.legs.length === 0 ? '' : `${p.legs.length} 本`}</span>
      </div>
      {p.legs.length > 0 ? (
        <ul class="legs__list" aria-labelledby={`${LEG_LIST_ID}-title`}>
          {p.legs.map((l, i) => {
            const { head, prices } = legCardText(l);
            const meta = legMeta(l, p.errors?.[i]);
            return (
              <li key={i} class="legs__item">
                <RowLink
                  id={`${LEG_LIST_ID}-${i}`}
                  onClick={() => p.onOpen(i)}
                  {...(meta ? { meta } : {})}
                >
                  <span class="legs__line legs__line--head">{head}</span>
                  <span class="legs__line legs__line--prices">
                    {prices}
                    {l.read?.yearInferred ? (
                      <span class="field__mark field__mark--warn legs__warn">
                        {YEAR_INFERRED_CHIP}
                      </span>
                    ) : null}
                  </span>
                </RowLink>
              </li>
            );
          })}
        </ul>
      ) : null}
      {p.error ? <p class="field__error">{p.error}</p> : null}
      {/* 消した後の戻す行（チャートを外したときと同じ形。シートの中なのでトーストではなく一覧の中。P4） */}
      <div class="legs__removed" role="status">
        {p.removed ? (
          <>
            <span>{p.removed}</span>
            <Button
              variant="secondary"
              size="sm"
              id={LEG_UNDO_ID}
              disabled={full}
              {...(full ? { describedBy: `${LEG_UNDO_ID}-why` } : {})}
              onClick={() => p.onUndo?.()}
            >
              元に戻す
            </Button>
            {full ? <span id={`${LEG_UNDO_ID}-why`}>{LEG_UNDO_FULL}</span> : null}
          </>
        ) : null}
      </div>
      {p.notice ? (
        <p class="legs__notice" role="status">
          {p.notice}
        </p>
      ) : null}
      {p.nextPosition ? (
        <NextPositionRow
          next={p.nextPosition}
          full={p.legs.length + p.nextPosition.legs > MAX_LEGS}
          onMerge={() => p.onMergeNext?.()}
        />
      ) : null}
      {p.fromStatement ? <FromStatement view={p.fromStatement} add={addButton} /> : addButton}
    </div>
  );
}

/** ［＋ 足］ と ［明細から追加］ の行（狭い幅では折り返す）と、その下の理由・読み取り中・結果の 1 行 */
function FromStatement(p: { readonly view: LegAddView; readonly add: ComponentChildren }) {
  const v = p.view;
  const whyId = `${LEG_ADD_FROM_ID}-why`;
  const blocked = v.blocked !== null && !v.reading;
  return (
    <>
      <div class="legs__actions">
        {p.add}
        <Button
          variant="tonal"
          size="sm"
          icon="image"
          id={LEG_ADD_FROM_ID}
          disabled={v.blocked !== null || v.reading}
          {...(blocked ? { describedBy: whyId } : {})}
          onClick={() => document.getElementById(LEG_ADD_FILE_ID)?.click()}
        >
          {ADD_LEGS_LABEL}
        </Button>
        <input
          id={LEG_ADD_FILE_ID}
          type="file"
          hidden
          tabIndex={-1}
          accept="image/png,image/jpeg,image/*"
          onChange={(ev) => {
            const input = ev.currentTarget;
            const file = input.files?.[0];
            input.value = '';
            if (file) v.onPick(file);
          }}
        />
      </div>
      {blocked ? (
        <p class="legs__why" id={whyId}>
          {v.blocked}
        </p>
      ) : null}
      <div class="legs__removed legs__fromstatus" role="status">
        {v.reading ? (
          <>
            <span>{LEG_ADD_READING}</span>
            <Button
              variant="secondary"
              size="sm"
              id={LEG_ADD_CANCEL_ID}
              label="明細の足の読み取りをキャンセル"
              onClick={v.onCancel}
            >
              キャンセル
            </Button>
          </>
        ) : v.notice ? (
          <>
            <span>{v.notice}</span>
            {v.undo ? (
              <Button variant="secondary" size="sm" id={LEG_ADD_UNDO_ID} onClick={v.onUndo}>
                元に戻す
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

/** 一覧の下の区切り + 明細の次のポジション（エントリーの日・1 本目の足）と ［このポジションに入れる］ */
function NextPositionRow(p: {
  readonly next: NextPosition;
  readonly full: boolean;
  readonly onMerge: () => void;
}) {
  const whatId = `${LEG_MERGE_ID}-what`;
  const whyId = `${LEG_MERGE_ID}-why`;
  return (
    <div class="legs__next">
      <div class="legs__nexttext" id={whatId}>
        <span class="legs__nexttitle">{nextPositionTitle(p.next)}</span>
        <span class="legs__nextline">{nextPositionLine(p.next)}</span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        id={LEG_MERGE_ID}
        describedBy={p.full ? `${whatId} ${whyId}` : whatId}
        disabled={p.full}
        onClick={p.onMerge}
      >
        {MERGE_LABEL}
      </Button>
      {p.full ? (
        <span class="legs__nextwhy" id={whyId}>
          {MERGE_FULL}
        </span>
      ) : null}
    </div>
  );
}
