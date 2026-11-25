// 心理のタグの言葉（#156・設計書 4.2・9.4・C55・ADR-0022）。ID と並び・選び方は core/emotion-tags.ts、ここは画面に
// 出す名前・一言・まとまりの見出しと、シートの文字の純関数（DOM なし）。名前は ID から引くので、名前を直しても記録の
// 意味は変わらない（#163 の出す・出さないの設定も選択肢を絞るだけ）。色はどのタグにも付けない（C34）
import {
  CALM,
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

/** シートの選択肢の絞り込み（#163。省けば一覧のすべて） */
export interface EmotionChoiceFilter {
  /** 選択肢に出さないタグ（設定。読めない・読み込み中は空 = すべて出す。R6） */
  readonly hidden?: readonly EmotionTagId[];
  /** 出さない設定でも並べるタグ（シートを開いたときに付いていたタグ・今選んでいるタグ。外せるように。R3） */
  readonly keep?: readonly EmotionTagId[];
  /** 並べないタグ（#230。保存の後のシートで「ほかの心理」を出したとき、上に出している平常心と候補を除く） */
  readonly exclude?: readonly EmotionTagId[];
}

/** シートに並べるまとまりとチップ（一覧の順）。出さないタグを除き、チップが 1 つも無いまとまりは見出しごと出さない（R4） */
export function emotionGroups(filter: EmotionChoiceFilter = {}): readonly EmotionGroupView[] {
  const hidden = new Set(filter.hidden ?? []);
  const keep = new Set(filter.keep ?? []);
  const exclude = new Set(filter.exclude ?? []);
  const shown = (id: EmotionTagId) => !exclude.has(id) && (!hidden.has(id) || keep.has(id));
  return EMOTION_GROUPS.flatMap((group) => {
    const tags = EMOTION_TAGS.filter((t) => t.group === group && shown(t.id)).map((t) => ({
      id: t.id,
      name: EMOTION_TEXT[t.id].name,
    }));
    if (tags.length === 0) return [];
    return [
      {
        group,
        name: EMOTION_GROUP_NAME[group],
        tags,
        notes: tags.map((t) => `${t.name} — ${EMOTION_TEXT[t.id].note}`),
      },
    ];
  });
}

/** 設定の根の「心理のタグ」の行の添え: 出しているタグの数 / 一覧の数（読めていなければ null） */
export function emotionChoicesMeta(hidden: readonly EmotionTagId[] | null): string | null {
  if (hidden === null) return null;
  return `${EMOTION_TAGS.length - hidden.length} / ${EMOTION_TAGS.length} 個`;
}

/** 設定の画面「心理のタグ」の文字 */
export const EMOTION_CHOICES_TITLE = '心理のタグ';
export const EMOTION_CHOICES_LEAD =
  '記録の後に心理を選ぶとき、選択肢に出すタグを押して選びます（押すと保存）。付けた記録と集計は変わりません。';
export const EMOTION_CHOICES_CALM_NOTE = '常に出します';
/** 出している数の 1 行 */
export function emotionChoicesCount(hidden: readonly EmotionTagId[]): string {
  return `${EMOTION_TAGS.length} 個のうち ${EMOTION_TAGS.length - hidden.length} 個を選択肢に出しています`;
}
export const EMOTION_CHOICES_LOAD_FAILED =
  '心理のタグの設定を読み込めませんでした。通信状況を確認して、再読み込みしてください。';
export const EMOTION_CHOICES_SAVE_FAILED =
  '心理のタグの設定を保存できませんでした。通信状況を確認して、もう一度押してください。';

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
/** 保存の後の短い形の案内（#230。平常心の見出しの塊を出さないので、押すとほかが外れることもここで先に言う） */
export const EMOTION_SHORT_HINT = '押すと保存・平常心はほかと同時には付きません';
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

/** 保存の後のシートの候補の数（平常心のほか。#230 R1） */
export const SAVED_CANDIDATE_COUNT = 3;

/**
 * 保存の後のシートに最初に出すチップ（#230 R1〜R4）: [平常心, 候補 3 個]。候補 = 平常心を除き、付いた取引の数（counts）の
 * 多い順・同数は一覧の順・0 件と出さない設定（hidden）のタグを除く。3 個に満たなければ、まとまりを 恐れ → 欲 → 取り戻し →
 * 思い込み の順に巡って、各まとまりの一覧の順でまだ無く出す設定のタグを 1 つずつ足す（巡り終えても足りなければある分だけ）。
 * counts = null（読めない・読み込み中）は巡りだけで決める
 */
export function savedCandidates(
  counts: ReadonlyMap<EmotionTagId, number> | null,
  hidden: readonly EmotionTagId[] = [],
): EmotionTagId[] {
  const off = new Set(hidden);
  const usable = EMOTION_TAGS.map((t) => t.id).filter((id) => id !== CALM && !off.has(id));
  const order = new Map(usable.map((id, i) => [id, i]));
  const picked = usable
    .filter((id) => (counts?.get(id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (counts?.get(b) ?? 0) - (counts?.get(a) ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0),
    )
    .slice(0, SAVED_CANDIDATE_COUNT);
  const queues = EMOTION_GROUPS.filter((g) => g !== 'good').map((g) =>
    usable.filter(
      (id) => EMOTION_TAGS.find((t) => t.id === id)?.group === g && !picked.includes(id),
    ),
  );
  while (picked.length < SAVED_CANDIDATE_COUNT && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined && picked.length < SAVED_CANDIDATE_COUNT) picked.push(next);
    }
  }
  return [CALM, ...picked];
}

/** 「ほかの心理」のボタンの文字（n = 押すと下に出るタグの数。#230 R1） */
export function emotionMoreLabel(n: number): string {
  return `ほかの心理（${n}）`;
}
