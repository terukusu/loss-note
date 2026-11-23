// 心理のタグの言葉（#156・設計書 4.2・9.4・C55・ADR-0022）。ID と並び・選び方は core/emotion-tags.ts、ここは画面に
// 出す名前・一言・まとまりの見出しと、シートの文字の純関数（DOM なし）。名前は ID から引くので、名前を直しても記録の
// 意味は変わらない（#163 で出す・出さないを足しても同じ）。色はどのタグにも付けない（C34）
import {
  EMOTION_GROUPS,
  EMOTION_TAGS,
  type EmotionGroup,
  type EmotionTagId,
} from '../../../core/emotion-tags';
import type { Grade } from '../../../core/judge';

/** 名前（チップ）と一言（まとまりの「i」の説明のシート） */
export const EMOTION_TEXT: Readonly<
  Record<EmotionTagId, { readonly name: string; readonly note: string }>
> = {
  calm: { name: '平常心', note: '心穏やか・淡々と。計画どおりに動けた状態' },
  fear: { name: '怖い', note: '含み損や値動きが怖くて判断が止まる' },
  nervous: {
    name: 'ドキドキ',
    note: 'エントリーの後に落ち着かない・迷う（数量が大きすぎるサイン）',
  },
  distress: { name: '辛い', note: '資金が減るのを見て嫌な気分・パニックに近い' },
  lossAversion: { name: '減るのが嫌', note: '資金が減ることを嫌って損を確定できない' },
  reassurance: { name: '安心したい', note: '根拠より安心感を求めて LC を近く・金額で置く' },
  earlyProfit: { name: '利確を急ぐ', note: '含み益が減るのが嫌で TP の前に決済する' },
  wantProfit: { name: '儲けたい', note: 'お金を儲けたい気持ちが入りの理由になる' },
  bigWin: { name: '大儲けしたい', note: '一発で大きく取りたい・賭けたい' },
  wantPosition: { name: 'ポジりたい', note: '根拠より「ポジションを持ちたい」が先に立つ' },
  fomo: { name: '乗り遅れ怖い', note: '置いていかれる焦りで入る' },
  overconfident: {
    name: '調子に乗った',
    note: '勝ちが続いて全能感 → 過剰リスク・根拠の無いエントリー・オーバーサイズ',
  },
  recoup: { name: '取り戻したい', note: '負け・減った含み益を取り返したい' },
  frustrated: { name: '悔しい', note: 'LC の後に思惑の方向へ戻った・狩られたのが悔しい' },
  anger: { name: '腹立たしい', note: 'LC に怒り・やり返したい' },
  missedMove: { name: '取り逃した', note: '取れたはずの値幅を逃して惜しい' },
  regret: { name: '後悔', note: '〜しておけばよかった・やるべきでなかった' },
  hope: { name: '祈り', note: '戻るはずと希望で持ち続ける' },
  cantCut: { name: '切れない', note: 'LC をためらう・遅れる・放置する' },
  confirmation: { name: '都合よく解釈', note: '入りたいから根拠を探す・都合のいい情報だけ見る' },
  bargain: { name: '値ごろ感', note: '下げすぎ・高すぎの感覚だけで逆張りに入る' },
};

/** まとまりの見出し */
export const EMOTION_GROUP_NAME: Readonly<Record<EmotionGroup, string>> = {
  good: '良い状態',
  fear: '恐れ',
  greed: '欲',
  recoup: '取り戻し',
  belief: '思い込み',
};

export interface EmotionGroupView {
  readonly group: EmotionGroup;
  readonly name: string;
  readonly tags: readonly { readonly id: EmotionTagId; readonly name: string }[];
  /** 「i」の説明の文（「名前 — 一言」の並び） */
  readonly notes: readonly string[];
}

/** シートに並べるまとまりとチップ（一覧の順） */
export function emotionGroups(): readonly EmotionGroupView[] {
  return EMOTION_GROUPS.map((group) => {
    const tags = EMOTION_TAGS.filter((t) => t.group === group).map((t) => ({
      id: t.id,
      name: EMOTION_TEXT[t.id].name,
    }));
    return {
      group,
      name: EMOTION_GROUP_NAME[group],
      tags,
      notes: tags.map((t) => `${t.name} — ${EMOTION_TEXT[t.id].note}`),
    };
  });
}

/** 付いているタグの名前（一覧の順の ID を受ける） */
export function emotionNames(ids: readonly EmotionTagId[]): string[] {
  return ids.map((id) => EMOTION_TEXT[id].name);
}

/** シートの題（保存の後 = 「記録しました」・詳細 = 「心理」） */
export const EMOTION_SHEET_TITLE = { saved: '記録しました', detail: '心理' } as const;

/** 保存の後のシートの題: 1 件なら「記録しました」、複数行なら「3 件を記録しました」（件数の行を別に置かない） */
export function emotionSheetTitle(count: number): string {
  return count >= 2 ? `${count} 件を記録しました` : EMOTION_SHEET_TITLE.saved;
}
/** シートの中の見出し（判定の下・チップの上） */
export const EMOTION_HEADING = 'このときの心理';
/** シートの中の案内（押した時点で保存されることを言う） */
export const EMOTION_HINT = '当てはまるものを押してください（押すと保存）';
/** 良い状態（平常心）の見出しの添え書き（R3。押すとほかが外れることを先に言う） */
export const EMOTION_CALM_NOTE = 'ほかと同時には付きません';
/** 詳細のカードの見出しと操作 */
export const EMOTION_CARD_TITLE = '心理';
/** 詳細のカードの付け外しのボタン（付いているものを外す・替えるのも同じシート） */
export const EMOTION_CHANGE = '変更';
export const EMOTION_CHANGE_LABEL = '心理を変更';
export const EMOTION_EMPTY = '＋ 心理を付ける';
/** 詳細の心理のカードの押せるチップの添え（#188。期間は行き先の範囲の行が言う。古い取引は「今日から」でないため、ここでは言わない） */
export const EMOTION_TRAIL_HINT = '押すと、同じ心理の取引を見られます';

/** 下の帯のボタンの文字: 保存の後で何も付いていなければ ［あとで］、ほかは ［完了］。どちらも閉じるだけ（R5） */
export function closeLabelOf(context: 'saved' | 'detail', count: number): 'あとで' | '完了' {
  return context === 'saved' && count === 0 ? 'あとで' : '完了';
}

/** 保存の後のシートの上に並べる判定（1 件 = バッジと R、2 件以上 = バッジの並び） */
export interface SavedVerdict {
  readonly grade: Grade | null;
  readonly r?: number;
  /** 判定の理由の先頭の 1 つ（1 件のときだけ出す。心理を選ぶ手がかり = 何が崩れたか） */
  readonly reason?: string;
}

/** 保存の失敗（チップは最後に保存できた状態に戻る。AC-7） */
export const EMOTION_SAVE_FAILED =
  '心理を保存できませんでした。通信状況を確認して、もう一度押してください。';
/** 押し直しても通らない失敗（取引が消えた 404・この版の知らない形の取引 409） */
export const EMOTION_SAVE_GONE =
  '心理を保存できませんでした。この取引は変更できない状態です。取引を開き直してください。';
