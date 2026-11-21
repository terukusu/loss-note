// オプションのポジションのレッグの一覧（#117。設計書 7.6「レッグは 1 本 2 行のカード … 押すとそのレッグのシート」）。
// 記録する画面（取引の欄のシート）と直す画面が共有する。hook を持たない。値はテキストのノードだけ。
// - 1 本 = 押せる行（RowLink。右に ›）の 2 行: 1 行目「売り 2 · P 36,000 · 2027-01」、2 行目「120 → 60」。誤り・未入力は右の添え
// - 下に [＋ レッグ]（tonal。10 本で押せない）。10 本まで並べても横にスクロールしない（行の中で折る）
// - 損益の内訳は出さない（記録の画面は判定が主役。7.6）
import type { LegDraft, LegField } from '../lib/legs-form';
import { LEG_UNDO_FULL, legCardText, MAX_LEGS } from '../lib/legs-form';
import '../styles/legs.css';
import { Button, RowLink } from './Button';

export const LEG_LIST_ID = 'record-legs';

export interface LegListProps {
  readonly legs: readonly LegDraft[];
  /** レッグごとの欄の誤り（readDraft の option.legErrors） */
  readonly errors?: readonly Readonly<Partial<Record<LegField, string>>>[];
  readonly onOpen: (index: number) => void;
  readonly onAdd: () => void;
  /** 一覧の上の 1 行の誤り（レッグが無いまま保存しようとした など） */
  readonly error?: string;
  /** 直前に消したレッグ（「レッグ 2 を削除しました ［元に戻す］」。P4）。省けば出さない */
  readonly removed?: string | null;
  readonly onUndo?: () => void;
}

export const LEG_UNDO_ID = `${LEG_LIST_ID}-undo`;

/** 行の右の添え（誤り > 未入力） */
export function legMeta(
  leg: LegDraft,
  errors: Partial<Record<LegField, string>> | undefined,
): string | null {
  if (errors && Object.keys(errors).length > 0) return '誤りあり';
  const { head, prices } = legCardText(leg);
  return head.includes('?') || prices.includes('?') ? '未入力あり' : null;
}

export function LegList(p: LegListProps) {
  const full = p.legs.length >= MAX_LEGS;
  return (
    <div class="legs" id={LEG_LIST_ID}>
      <div class="legs__head">
        <span class="field__label" id={`${LEG_LIST_ID}-title`}>
          レッグ
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
                  <span class="legs__line legs__line--prices">{prices}</span>
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
      <Button
        variant="tonal"
        size="sm"
        icon="plus"
        id={`${LEG_LIST_ID}-add`}
        label="レッグを追加"
        disabled={full}
        onClick={p.onAdd}
      >
        レッグ
      </Button>
    </div>
  );
}
