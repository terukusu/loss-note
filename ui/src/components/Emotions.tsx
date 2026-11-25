// 心理のタグの部品（#156・設計書 9.4・C55・docs/ui-guidelines.md 9.3・9.12）。hook を持たない。
// - EmotionSheetBody: 保存の後のシート「記録しました」と詳細のシート「心理」の中身。上に判定（保存の後だけ。1 件は判定の
//   理由の先頭の 1 行も）、まとまりの見出し（「i」で一言の並び）の下に押す形のチップ（aria-pressed）、失敗の文言、下に貼り付く
//   ［あとで］ / ［完了］。チップは設定で選択肢に出すタグと、開いたときに付いていたタグだけ（#163）。良い状態（平常心）は
//   ほかと区切りの線で分け、「ほかと同時には付きません」を添える（色は使わない）。保存の後のシートは短い形（short。#230）:
//   最初は平常心 + 候補 3 個 + ［ほかの心理（N）］ で、押すと候補の下に残りのまとまりを出す
// - EmotionCard: 詳細の「心理」のカード（付いているタグ + ［変更］。無ければ押せる行「＋ 心理を付ける」）。タグは行き先
//   （hrefOf）があれば押せるチップ（同じ心理の「期間の取引」へ。#188）、無ければ押せない輪郭の札
// 色はどのタグにも付けない（C34）。名前・一言は固定の文字（ID から引く）をテキストのノードで入れる
import { CALM, type EmotionTagId } from '../../../core/emotion-tags';
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
  EMOTION_SHORT_HINT,
  EMOTION_TEXT,
  EMOTION_TRAIL_HINT,
  type EmotionGroupView,
  emotionGroups,
  emotionMoreLabel,
  emotionNames,
  type SavedVerdict,
} from '../lib/emotion-tags';
import { formatR } from '../lib/format';
import { quietR } from '../lib/risky-win';
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
  /**
   * 保存の後の短い形（#230）。あれば最初は平常心 + 候補 + ［ほかの心理（N）］ だけを出し、押すと候補の下に残りのまとまりを
   * 出す。省けば今の全部の形（詳細のシート）
   */
  readonly short?: EmotionShort;
}

/** 保存の後のシートの短い形（#230 R1・R5） */
export interface EmotionShort {
  /** 最初に出すチップ（[平常心, 候補]。開いた時点で決めて固定する = savedCandidates） */
  readonly candidates: readonly EmotionTagId[];
  /** ［ほかの心理］ を押して残りを出したか（シートを閉じるまで出したまま） */
  readonly expanded: boolean;
  readonly onMore: () => void;
}

/** 「ほかの心理」で出した最初のまとまりの見出しの id（押した後のフォーカスの行き先。ボタンが消えるため） */
export const emotionMoreStartId = (prefix: string) => `${prefix}-emotion-more-start`;

/** まとまり 1 つ（見出し・「i」・チップの組）。良い状態（平常心）は見出しとチップを横に並べ、添え書きを結ぶ */
function GroupBlock(p: {
  readonly g: EmotionGroupView;
  readonly prefix: string;
  readonly selected: ReadonlySet<EmotionTagId>;
  readonly onToggle: (id: EmotionTagId) => void;
  /** 見出しをフォーカスの行き先にする（「ほかの心理」で出した最初のまとまり） */
  readonly focusId?: string;
}) {
  const { g } = p;
  const gid = `${p.prefix}-emotion-${g.group}`;
  const good = g.group === 'good';
  return (
    <div class={good ? 'emotions__group emotions__group--good' : 'emotions__group'}>
      <div class="emotions__ghead">
        <h4
          class="emotions__gname"
          id={gid}
          {...(p.focusId ? { 'data-focus-id': p.focusId, tabIndex: -1 } : {})}
        >
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
          <Chip key={t.id} selected={p.selected.has(t.id)} onClick={() => p.onToggle(t.id)}>
            {t.name}
          </Chip>
        ))}
      </fieldset>
    </div>
  );
}

/**
 * 保存の後の短い形（#230）: 1 つの組（見出し「このときの心理」に結び、案内の 1 行「…平常心はほかと同時には付きません」を
 * 説明に結ぶ）に 平常心・区切りの縦線・候補・末尾の ［ほかの心理（N）］ → 押した後は組の下に残りのまとまり（組のチップの位置は
 * 動かない。平常心と候補は二重に出さない）。窓の半分に収めるため、平常心の見出しの塊と横の区切りの線は短い形では出さない
 */
function ShortChoices(
  p: EmotionSheetBodyProps & {
    readonly short: EmotionShort;
    readonly selected: ReadonlySet<EmotionTagId>;
    readonly headingId: string;
    readonly hintId: string;
  },
) {
  const hidden = p.hidden ?? [];
  const keep = [...p.state.opened, ...p.state.selected];
  const cands = p.short.candidates.filter((id) => id !== CALM);
  // 畳んでいる間に付いている候補の外のタグも、外せるように候補の後に並べる（保存の後は空から始まるので通常は起きない）
  const top = p.short.expanded
    ? cands
    : [...cands, ...p.state.selected.filter((id) => id !== CALM && !cands.includes(id))];
  const rest = emotionGroups({ hidden, keep, exclude: [CALM, ...top] });
  const restCount = rest.reduce((n, g) => n + g.tags.length, 0);
  return (
    <>
      <fieldset
        class="chips emotions__chips emotions__short"
        aria-labelledby={p.headingId}
        aria-describedby={p.hintId}
      >
        {/* 平常心は常に先頭。押すとほかが外れるので、区切りの縦線で候補と分ける（色は使わない） */}
        <Chip selected={p.selected.has(CALM)} onClick={() => p.onToggle(CALM)}>
          {EMOTION_TEXT[CALM].name}
        </Chip>
        <span class="emotions__sep" aria-hidden="true" />
        {top.map((id) => (
          <Chip key={id} selected={p.selected.has(id)} onClick={() => p.onToggle(id)}>
            {EMOTION_TEXT[id].name}
          </Chip>
        ))}
        {!p.short.expanded && restCount > 0 ? (
          <button type="button" class="chip emotions__more" onClick={p.short.onMore}>
            {emotionMoreLabel(restCount)}
          </button>
        ) : null}
      </fieldset>
      {p.short.expanded
        ? rest.map((g, i) => (
            <GroupBlock
              key={g.group}
              g={g}
              prefix={p.prefix}
              selected={p.selected}
              onToggle={p.onToggle}
              {...(i === 0 ? { focusId: emotionMoreStartId(p.prefix) } : {})}
            />
          ))
        : null}
    </>
  );
}

export function EmotionSheetBody(p: EmotionSheetBodyProps) {
  const selected = new Set(p.state.selected);
  const verdicts = p.context === 'saved' ? (p.verdicts ?? []) : [];
  const headingId = `${p.prefix}-emotion-heading`;
  const hintId = `${p.prefix}-emotion-hint`;
  // 2 件以上の件数はシートの題（emotionSheetTitle）が言うので、ここでは繰り返さない
  const reason = verdicts.length === 1 ? verdicts[0]?.reason : undefined;
  return (
    <div class={p.short ? 'emotions emotions--short' : 'emotions'}>
      {verdicts.length > 0 ? (
        <div class="emotions__verdicts">
          <ul class="emotions__badges">
            {verdicts.map((v, i) => (
              // 取引の並びは保存の順で変わらない（並びの位置を鍵にする）
              <li key={i} class="emotions__badge">
                <JudgeBadge grade={v.grade} />
                {verdicts.length === 1 ? (
                  // 行の R（数字の段 row。#236）。危ない勝ちの R は静かな形（#227・C59）
                  <span
                    class={
                      quietR(v.grade)
                        ? 'num emotions__r emotions__r--quiet'
                        : 'num num--row emotions__r'
                    }
                  >
                    {formatR(v.r)}
                  </span>
                ) : null}
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
      <p class="emotions__hint" id={hintId}>
        {p.short ? EMOTION_SHORT_HINT : EMOTION_HINT}
      </p>
      {p.short ? (
        <ShortChoices
          {...p}
          short={p.short}
          selected={selected}
          headingId={headingId}
          hintId={hintId}
        />
      ) : (
        emotionGroups({
          hidden: p.hidden ?? [],
          keep: [...p.state.opened, ...p.state.selected],
        }).map((g) => (
          <GroupBlock
            key={g.group}
            g={g}
            prefix={p.prefix}
            selected={selected}
            onToggle={p.onToggle}
          />
        ))
      )}
      {p.state.error !== null ? (
        <p class="notice notice--error" role="alert">
          {p.state.error}
        </p>
      ) : null}
      <div class="emotions__actions">
        <Button
          block
          variant={p.state.selected.length > 0 ? 'primary' : 'secondary'}
          onClick={p.onClose}
        >
          {closeLabelOf(p.context, p.state.selected.length)}
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
