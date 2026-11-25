// 保存の後のシートの候補（#230・設計書 9.4・C65）に使う、本人の心理のタグの付いた数の読み込み。DOM なし。
// 既存の取引の一覧の API（作った時刻の新しい順の 1 ページ = 最大 100 件）を 1 本だけ読み、取引の emotionTags を数える
// （新しい保存の形を足さない）。失敗は null（候補は既定の巡りで決める。R4）。数えるのは core の countEmotions
import { countEmotions, type EmotionTagId } from '../../../core/emotion-tags';
import { getJson, type RequestFn } from './request';
import { pageOf, tradesPath } from './trade-pages';

/** 数える範囲（作った時刻の新しい順の件数。一覧の API の 1 ページの上限。R2） */
export const EMOTION_HISTORY_LIMIT = 100;

/** 直近の取引に付いたタグの数を読む（読めない・形が違う = null） */
export async function loadEmotionCounts(
  request: RequestFn,
): Promise<Map<EmotionTagId, number> | null> {
  try {
    const page = pageOf(
      await getJson<unknown>(
        await request(tradesPath({ order: 'created', limit: EMOTION_HISTORY_LIMIT })),
        200,
      ),
    );
    return page ? countEmotions(page.items) : null;
  } catch {
    return null;
  }
}
