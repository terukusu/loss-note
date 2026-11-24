// Good / More の言葉（#123・設計書 4.2・9.4・C58・ADR-0024）。ID と並び・操作は core/reflection.ts、ここは画面に出す
// 話題の名前・段の見出し・シートとカードの文字の純関数（DOM なし）。名前は ID から引くので、名前を直しても記録の意味は
// 変わらない。色は付けない（Good を緑・More を赤にしない。C34。言葉で分ける）
import {
  type GoodTopicId,
  MAX_REFLECTION_NOTE_LENGTH,
  MAX_REFLECTION_NOTES,
  type MoreTopicId,
  type NoteIssue,
  REFLECTION_SIDES,
  REFLECTION_TOPICS,
  type Reflection,
  type ReflectionSide,
  type ReflectionTopicId,
} from '../../../core/reflection';

/** 話題の名前（チップ・カードの札） */
export const REFLECTION_TOPIC_NAME: Readonly<Record<GoodTopicId | MoreTopicId, string>> = {
  cutEarly: '早めに撤退できた',
  readRight: '方向の読みは合っていた',
  followedRules: 'ルールどおりに動けた',
  letProfitRun: '利を伸ばせた',
  resistedUrge: '衝動を抑えられた',
  noGreedExit: '欲張らずに決済した',
  waitedForSignal: 'サインが出るまで待てた',
  enteredEarly: '根拠が揃う前に入った',
  againstHigherTf: '上位足の流れに逆らった',
  oversized: '数量が多すぎた',
  lcTooTight: 'LC が近すぎた',
  noExitPlan: '出口を決めていなかった',
  reEntered: 'すぐ再エントリーした',
  orderMistake: '発注を間違えた',
};

/** 段の見出しと添え（Good / More は言葉で分ける） */
export const REFLECTION_SIDE_TEXT: Readonly<
  Record<ReflectionSide, { readonly name: string; readonly note: string }>
> = {
  good: { name: 'Good', note: '良かったこと' },
  more: { name: 'More', note: '次はこうする' },
};

/** シート・カードの題 */
export const REFLECTION_TITLE = 'Good / More';
export const REFLECTION_CHANGE = '変更';
export const REFLECTION_CHANGE_LABEL = 'Good / More を変更';
export const REFLECTION_EMPTY = '＋ Good / More を書く';
/** シートの中の案内（押した・足した時点で保存されることを言う） */
export const REFLECTION_HINT =
  '当てはまるものを押すか、自分で書いてください（押す・追加すると保存）';
/** 自分で書く欄 */
export const REFLECTION_NOTE_LABEL = '自分で書く';
export const REFLECTION_NOTE_ADD = '追加';
export const REFLECTION_DONE = '完了';
/** 保存の後のシートで「自分で書く」の欄を開くボタン（#220。押すまで欄をたたむ = 押すだけの人の手間を増やさない） */
export const REFLECTION_COMPOSE = '＋ 自分で書く';

/** 「＋ 自分で書く」の読み上げの名前（「Good を自分で書く」。開いた後の欄の名前と同じ） */
export function composeLabel(side: ReflectionSide): string {
  return `${REFLECTION_SIDE_TEXT[side].name} を${REFLECTION_NOTE_LABEL}`;
}

/**
 * 話題・自分で書いた行・空白でない書きかけのどれかがあるか（#220。保存の後のシートの下の帯のボタンを ［あとで］ から
 * ［完了］ にする。［完了］ は書きかけを行として足すので、書きかけだけでも ［完了］）
 */
export function reflectionHasInput(
  value: Reflection,
  drafts: { readonly good: string; readonly more: string },
): boolean {
  return REFLECTION_SIDES.some(
    (side) =>
      value[side].topics.length > 0 || value[side].notes.length > 0 || drafts[side].trim() !== '',
  );
}

export function notePlaceholder(side: ReflectionSide): string {
  return side === 'good' ? '例: 前提が崩れたので LC の前に決済した' : '例: 入る前に TP を決める';
}

/** 行の削除のボタンの読み上げの名前 */
export function noteRemoveLabel(side: ReflectionSide, note: string): string {
  return `${REFLECTION_SIDE_TEXT[side].name} の行を削除: ${note}`;
}

/** 行を足せない理由の文 */
export function noteIssueText(issue: NoteIssue | 'full'): string {
  switch (issue) {
    case 'empty':
      return '文字を入れてから追加してください。';
    case 'control':
      return '改行や見えない文字は使えません。1 行で書いてください。';
    case 'tooLong':
      return `1 行は ${MAX_REFLECTION_NOTE_LENGTH} 字までです。`;
    case 'full':
      return `${MAX_REFLECTION_NOTES} 行まで書けます。不要な行を削除してから追加してください。`;
  }
}

/** 保存の失敗（チップ・行は最後に保存できた状態に戻る） */
export const REFLECTION_SAVE_FAILED =
  'Good / More を保存できませんでした。通信状況を確認して、もう一度操作してください。';
/** 押し直しても通らない失敗（取引が消えた 404・この版の知らない形の取引 409） */
export const REFLECTION_SAVE_GONE =
  'Good / More を保存できませんでした。この取引は変更できない状態です。取引を開き直してください。';

export interface TopicChoice {
  readonly id: ReflectionTopicId;
  readonly name: string;
}

/** 段の話題の選択肢（一覧の順） */
export function topicChoices(side: ReflectionSide): readonly TopicChoice[] {
  return (REFLECTION_TOPICS[side] as readonly ReflectionTopicId[]).map((id) => ({
    id,
    name: REFLECTION_TOPIC_NAME[id],
  }));
}

/** 詳細のカードの段（付いている話題の名前と行。何も無い段は出さない） */
export interface ReflectionCardSide {
  readonly side: ReflectionSide;
  readonly name: string;
  readonly note: string;
  readonly topics: readonly string[];
  readonly notes: readonly string[];
}

export function reflectionCardSides(r: Reflection): readonly ReflectionCardSide[] {
  return REFLECTION_SIDES.flatMap((side) => {
    const part = r[side];
    if (part.topics.length === 0 && part.notes.length === 0) return [];
    return [
      {
        side,
        ...REFLECTION_SIDE_TEXT[side],
        topics: part.topics.map((id) => REFLECTION_TOPIC_NAME[id]),
        notes: part.notes,
      },
    ];
  });
}
