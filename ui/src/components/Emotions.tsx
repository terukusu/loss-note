// 心理のタグの部品（#156・設計書 9.4・C55・docs/ui-guidelines.md 9.3・9.12）。hook を持たない。
// - EmotionSheetBody: 保存の後のシート「記録しました」と詳細のシート「心理」の中身。上に判定（保存の後だけ。1 件は判定の
//   理由の先頭の 1 行も）、まとまりの見出し（「i」で一言の並び）の下に押す形のチップ（aria-pressed）、失敗の文言、下に貼り付く
//   ［あとで］ / ［完了］。チップは設定で選択肢に出すタグと、開いたときに付いていたタグだけ（#163）。良い状態（平常心）は
//   ほかと区切りの線で分け、「ほかと同時には付きません」を添える（色は使わない）。保存の後のシートは心理の段の下に
//   Good / More の段（children。#220）を置き、それが付いていればボタンを ［完了］ にする（alsoAttached）
// - EmotionCard: 詳細の「心理」のカード（付いているタグ + ［変更］。無ければ押せる行「＋ 心理を付ける」）。タグは行き先
//   （hrefOf）があれば押せるチップ（同じ心理の「期間の取引」へ。#188）、無ければ押せない輪郭の札
// 色はどのタグにも付けない（C34）。名前・一言は固定の文字（ID から引く）をテキストのノードで入れる
import type { ComponentChildren } from 'preact';
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { EmotionState } from '../lib/emotion-controller';
import {
  closeLabelOf,
  EMOTION_CALM_NOTE,
  EMOTION_CARD_TITLE,
  EMOTION_CHANGE,
  EMOTION_CHANGE_LABEL,
  EMOTION_EMPTY,
  EMOTION_HEADING,
  EMOTION_HINT,
  EMOTION_TRAIL_HINT,
  emotionGroups,
  emotionNames,
  type SavedVerdict,
} from '../lib/emotion-tags';
import { formatR } from '../lib/format';
import { Button, Chip, RowLink } from './Button';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';
import { JudgeBadge } from './JudgeBadge';
import '../styles/emotions.css';

export interface EmotionSheetBodyProps {
  /** id の接頭辞（record / detail。同じ画面に 2 つ置かないが、「i」・見出しの id を分ける） */
  readonly prefix: string;
  /** saved = 保存の後（判定を上に出す・何も付いていなければ ［あとで］）、detail = 詳細から */
  readonly context: 'saved' | 'detail';
  readonly state: EmotionState;
  /** 保存の後の判定（保存した取引の順。context = saved のときだけ） */
  readonly verdicts?: readonly SavedVerdict[];
  /**
   * 選択肢に出さないタグ（#163 の設定。省く・読めない・読み込み中 = すべて出す）。シートを開いたときに付いていたタグと
   * 選んでいるタグは、出さない設定でも並べる（外せるように）
   */
  readonly hidden?: readonly EmotionTagId[];
  readonly onToggle: (id: EmotionTagId) => void;
  readonly onClose: () => void;
  /** 心理の段の下に置く中身（保存の後のシートの Good / More の段。#220） */
  readonly children?: ComponentChildren;
  /** 心理のほかに付いているもの・書きかけがある（#220。あれば下の帯のボタンを ［あとで］ でなく ［完了］ にする） */
  readonly alsoAttached?: boolean;
}

export function EmotionSheetBody(p: EmotionSheetBodyProps) {
  const selected = new Set(p.state.selected);
  const verdicts = p.context === 'saved' ? (p.verdicts ?? []) : [];
  const headingId = `${p.prefix}-emotion-heading`;
  // 2 件以上の件数はシートの題（emotionSheetTitle）が言うので、ここでは繰り返さない
  const reason = verdicts.length === 1 ? verdicts[0]?.reason : undefined;
  // 下の帯のボタン: 心理のほかに Good / More が付いている・書きかけがあれば 1 つ分と数える（#220）
  const attached = p.state.selected.length + (p.alsoAttached ? 1 : 0);
  return (
    <div class="emotions">
      {verdicts.length > 0 ? (
        <div class="emotions__verdicts">
          <ul class="emotions__badges">
            {verdicts.map((v, i) => (
              // 取引の並びは保存の順で変わらない（並びの位置を鍵にする）
              <li key={i} class="emotions__badge">
                <JudgeBadge grade={v.grade} />
                {verdicts.length === 1 ? <span class="emotions__r">{formatR(v.r)}</span> : null}
              </li>
            ))}
          </ul>
          {reason ? <p class="emotions__reason">{reason}</p> : null}
        </div>
      ) : null}
      {/* 詳細のシートは題が「心理」なので、中の見出しは保存の後だけ */}
      {p.context === 'saved' ? (
        <h3 class="emotions__heading" id={headingId}>
          {EMOTION_HEADING}
        </h3>
      ) : null}
      <p class="emotions__hint">{EMOTION_HINT}</p>
      {emotionGroups({
        hidden: p.hidden ?? [],
        keep: [...p.state.opened, ...p.state.selected],
      }).map((g) => {
        const gid = `${p.prefix}-emotion-${g.group}`;
        const good = g.group === 'good';
        return (
          <div
            key={g.group}
            class={good ? 'emotions__group emotions__group--good' : 'emotions__group'}
          >
            <div class="emotions__ghead">
              <h4 class="emotions__gname" id={gid}>
                {g.name}
              </h4>
              <InfoTip label={g.name} body={g.notes} id={`${gid}-info`} />
              {/* 平常心を押すとほかが外れる（逆も）ことを先に言う（R3。黙って外れたと見せない） */}
              {good ? (
                <span class="emotions__gnote" id={`${gid}-note`}>
                  {EMOTION_CALM_NOTE}
                </span>
              ) : null}
            </div>
            {/* まとまりの名前で読み上げる組（fieldset の既定の枠・余白は CSS で消す） */}
            <fieldset
              class="chips emotions__chips"
              aria-labelledby={gid}
              {...(good ? { 'aria-describedby': `${gid}-note` } : {})}
            >
              {g.tags.map((t) => (
                <Chip key={t.id} selected={selected.has(t.id)} onClick={() => p.onToggle(t.id)}>
                  {t.name}
                </Chip>
              ))}
            </fieldset>
          </div>
        );
      })}
      {p.children}
      {p.state.error !== null ? (
        <p class="notice notice--error" role="alert">
          {p.state.error}
        </p>
      ) : null}
      <div class="emotions__actions">
        <Button block variant={attached > 0 ? 'primary' : 'secondary'} onClick={p.onClose}>
          {closeLabelOf(p.context, attached)}
        </Button>
      </div>
    </div>
  );
}

export interface EmotionCardProps {
  readonly tags: readonly EmotionTagId[];
  /** シートを閉じた後の失敗（シートの外に出す。閉じている間だけ） */
  readonly error?: string | null;
  readonly onOpen: () => void;
  /**
   * タグの行き先（#188。同じ心理の「期間の取引」）。あれば付いているタグを押せるチップ（リンク）で並べる。省けば押せない札。
   * 行き先は今日で決まるので、描くときと押したときの 2 回呼ぶ（押した日で決める）
   */
  readonly hrefOf?: (id: EmotionTagId) => string;
}

export const EMOTION_CARD_TITLE_ID = 'detail-emotion-title';

export function EmotionCard(p: EmotionCardProps) {
  const names = emotionNames(p.tags);
  const hrefOf = p.hrefOf;
  return (
    <section class="card emotioncard" aria-labelledby={EMOTION_CARD_TITLE_ID}>
      <div class="emotioncard__head">
        <h2 class="emotioncard__title" id={EMOTION_CARD_TITLE_ID}>
          {EMOTION_CARD_TITLE}
        </h2>
        {names.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={p.onOpen} label={EMOTION_CHANGE_LABEL}>
            {EMOTION_CHANGE}
          </Button>
        ) : null}
      </div>
      {names.length > 0 && hrefOf !== undefined ? (
        // 押せるチップ（#188。同じ心理の「期間の取引」へ進むリンク。右の › で次の画面へ進むことを示す。ui-guidelines 9.12）
        <>
          <ul class="emotioncard__tags">
            {p.tags.map((id, i) => (
              <li key={id} class="emotioncard__item">
                <Chip href={hrefOf(id)} hrefAtClick={() => hrefOf(id)}>
                  <span>{names[i]}</span>
                  <Icon name="chevron" class="emotioncard__chev" />
                </Chip>
              </li>
            ))}
          </ul>
          <p class="emotioncard__hint">{EMOTION_TRAIL_HINT}</p>
        </>
      ) : names.length > 0 ? (
        // 押せない札（シートの押せるチップと見分ける輪郭の形。判定のカードの答えの札と同じ考え）
        <ul class="emotioncard__tags">
          {names.map((n) => (
            <li key={n} class="emotioncard__tag">
              {n}
            </li>
          ))}
        </ul>
      ) : (
        <div class="dlist">
          <RowLink onClick={p.onOpen}>{EMOTION_EMPTY}</RowLink>
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
