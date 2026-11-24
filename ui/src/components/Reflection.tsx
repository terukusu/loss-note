// Good / More の部品（#123・設計書 9.4・C58・docs/ui-guidelines.md 9.3・9.12）。hook を持たない。
// - ReflectionSheetBody: 詳細のシート「Good / More」の中身。Good と More の段ごとに、押す形のチップ（aria-pressed）、
//   自分で書いた行（行ごとに削除のアイコンのボタン）、「自分で書く」の欄と ［追加］（決定キー = 追加。変換中は除く）。
//   失敗の文言、下に貼り付く ［完了］（書きかけがあれば行として足してから閉じる。押した・足した時点で保存済み）
// - ReflectionSides: Good と More の段（シートの中身と、記録の保存の後のシート「記録しました」の心理の段の下が共有する。#220）。
//   composing を渡すと、開いていない段は欄の代わりに「＋ 自分で書く」を出す（保存の後のシート。書きかけ・理由があれば欄のまま）
// - ReflectionCard: 詳細の「Good / More」のカード（付いている話題の札と行 + ［変更］。無ければ押せる行「＋ Good / More を書く」）
// 色は付けない（Good を緑・More を赤にしない。C34）。行（自分で書いた文）はテキストのノードで入れる（HTML にしない）
import type { ReflectionSide, ReflectionTopicId } from '../../../core/reflection';
import { REFLECTION_SIDES } from '../../../core/reflection';
import {
  composeLabel,
  noteIssueText,
  notePlaceholder,
  noteRemoveLabel,
  REFLECTION_CHANGE,
  REFLECTION_CHANGE_LABEL,
  REFLECTION_COMPOSE,
  REFLECTION_DONE,
  REFLECTION_EMPTY,
  REFLECTION_HINT,
  REFLECTION_NOTE_ADD,
  REFLECTION_NOTE_LABEL,
  REFLECTION_SIDE_TEXT,
  REFLECTION_TITLE,
  type ReflectionCardSide,
  topicChoices,
} from '../lib/reflection';
import type { ReflectionState } from '../lib/reflection-controller';
import { Button, Chip, IconButton, RowLink } from './Button';
import { TextField } from './TextField';
import '../styles/emotions.css';
import '../styles/reflection.css';

export interface ReflectionSheetBodyProps {
  /** id の接頭辞（detail。保存の後のシート（#220）では record） */
  readonly prefix: string;
  readonly state: ReflectionState;
  readonly onToggle: (side: ReflectionSide, id: ReflectionTopicId) => void;
  readonly onDraft: (side: ReflectionSide, text: string) => void;
  readonly onAddNote: (side: ReflectionSide) => void;
  readonly onRemoveNote: (side: ReflectionSide, index: number) => void;
  readonly onClose: () => void;
}

/** 「自分で書く」の欄の id */
export const noteFieldId = (prefix: string, side: ReflectionSide) =>
  `${prefix}-reflection-${side}-note`;

export function ReflectionSheetBody(p: ReflectionSheetBodyProps) {
  const s = p.state;
  return (
    <div class="reflection">
      <p class="reflection__hint">{REFLECTION_HINT}</p>
      <ReflectionSides {...p} />
      {s.error !== null ? (
        <p class="notice notice--error" role="alert">
          {s.error}
        </p>
      ) : null}
      <div class="emotions__actions reflection__actions">
        <Button block variant="primary" onClick={p.onClose}>
          {REFLECTION_DONE}
        </Button>
      </div>
    </div>
  );
}

export interface ReflectionSidesProps {
  /** id の接頭辞（detail / record） */
  readonly prefix: string;
  readonly state: ReflectionState;
  readonly onToggle: (side: ReflectionSide, id: ReflectionTopicId) => void;
  readonly onDraft: (side: ReflectionSide, text: string) => void;
  readonly onAddNote: (side: ReflectionSide) => void;
  readonly onRemoveNote: (side: ReflectionSide, index: number) => void;
  /**
   * 保存の後のシート（#220）: 段ごとに「自分で書く」の欄を開いているか。渡すと、開いておらず書きかけ・足せない理由も無い段は
   * 欄の代わりに「＋ 自分で書く」を出す。省けば（詳細のシート）欄を初めから出す
   */
  readonly composing?: Readonly<Record<ReflectionSide, boolean>>;
  /** 「＋ 自分で書く」を押した（欄を開いてフォーカスを移すのは画面の hook の層） */
  readonly onCompose?: (side: ReflectionSide) => void;
}

export function ReflectionSides(p: ReflectionSidesProps) {
  const s = p.state;
  return (
    <>
      {REFLECTION_SIDES.map((side) => {
        const text = REFLECTION_SIDE_TEXT[side];
        const headId = `${p.prefix}-reflection-${side}`;
        const part = s.value[side];
        const selected = new Set<string>(part.topics);
        const issue = s.noteIssues[side];
        const fieldId = noteFieldId(p.prefix, side);
        const showField =
          p.composing === undefined || p.composing[side] || s.drafts[side] !== '' || issue !== null;
        return (
          <section key={side} class="reflection__side" aria-labelledby={headId}>
            <h3 class="reflection__sname" id={headId}>
              {text.name}
              <span class="reflection__snote"> — {text.note}</span>
            </h3>
            {/* 段の名前で読み上げる組（fieldset の既定の枠・余白は CSS で消す） */}
            <fieldset class="chips reflection__chips" aria-labelledby={headId}>
              {topicChoices(side).map((t) => (
                <Chip
                  key={t.id}
                  selected={selected.has(t.id)}
                  onClick={() => p.onToggle(side, t.id)}
                >
                  {t.name}
                </Chip>
              ))}
            </fieldset>
            {part.notes.length > 0 ? (
              <ul class="reflection__notes" aria-label={`${text.name} の自分で書いた行`}>
                {part.notes.map((n, i) => (
                  // 行の並びは足した順で、消すと詰まる（文と位置を鍵にする）
                  <li key={`${i}:${n}`} class="reflection__note">
                    <span class="reflection__notetext">{n}</span>
                    <IconButton
                      icon="cross"
                      label={noteRemoveLabel(side, n)}
                      class="reflection__remove"
                      onClick={() => p.onRemoveNote(side, i)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            {showField ? (
              <div class="reflection__add">
                <TextField
                  id={fieldId}
                  label={`${text.name} を${REFLECTION_NOTE_LABEL}`}
                  value={s.drafts[side]}
                  onInput={(v) => p.onDraft(side, v)}
                  placeholder={notePlaceholder(side)}
                  enterKeyHint="done"
                  onEnter={() => p.onAddNote(side)}
                  {...(issue !== null ? { error: noteIssueText(issue) } : {})}
                />
                <Button
                  variant="secondary"
                  onClick={() => p.onAddNote(side)}
                  label={`${text.name} に追加`}
                >
                  {REFLECTION_NOTE_ADD}
                </Button>
              </div>
            ) : (
              <div class="reflection__compose">
                <Button
                  variant="tonal"
                  size="sm"
                  label={composeLabel(side)}
                  onClick={() => p.onCompose?.(side)}
                >
                  {REFLECTION_COMPOSE}
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

export interface ReflectionCardProps {
  readonly sides: readonly ReflectionCardSide[];
  /** シートを閉じた後の失敗（シートの外に出す。閉じている間だけ） */
  readonly error?: string | null;
  readonly onOpen: () => void;
}

export const REFLECTION_CARD_TITLE_ID = 'detail-reflection-title';

export function ReflectionCard(p: ReflectionCardProps) {
  return (
    <section class="card reflectioncard" aria-labelledby={REFLECTION_CARD_TITLE_ID}>
      <div class="emotioncard__head">
        <h2 class="emotioncard__title" id={REFLECTION_CARD_TITLE_ID}>
          {REFLECTION_TITLE}
        </h2>
        {p.sides.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={p.onOpen} label={REFLECTION_CHANGE_LABEL}>
            {REFLECTION_CHANGE}
          </Button>
        ) : null}
      </div>
      {p.sides.length > 0 ? (
        p.sides.map((side) => (
          <div key={side.side} class="reflectioncard__side">
            <h3 class="reflectioncard__sname">
              {side.name}
              <span class="reflection__snote"> — {side.note}</span>
            </h3>
            {side.topics.length > 0 ? (
              // 押せない札（シートの押せるチップと見分ける輪郭の形。心理のカードの札と同じ）
              <ul class="emotioncard__tags">
                {side.topics.map((n) => (
                  <li key={n} class="emotioncard__tag">
                    {n}
                  </li>
                ))}
              </ul>
            ) : null}
            {side.notes.length > 0 ? (
              <ul class="reflectioncard__notes">
                {side.notes.map((n, i) => (
                  <li key={`${i}:${n}`}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))
      ) : (
        <div class="dlist">
          <RowLink onClick={p.onOpen}>{REFLECTION_EMPTY}</RowLink>
        </div>
      )}
      {p.error ? (
        <p class="notice notice--error" role="alert">
          {p.error}
        </p>
      ) : null}
    </section>
  );
}
