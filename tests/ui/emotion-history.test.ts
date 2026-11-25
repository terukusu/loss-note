// 保存の後のシートの候補に使う心理の数の読み込み（Issue #230 の R2・R4・AC-4）。偽の要求で、読む道と失敗の扱いを見る。値は架空
import { describe, expect, it } from 'vitest';
import { EMOTION_HISTORY_LIMIT, loadEmotionCounts } from '../../ui/src/lib/emotion-history';
import { Failed, type RequestFn } from '../../ui/src/lib/request';

const reply =
  (status: number, body: unknown, paths: string[] = []): RequestFn =>
  async (path) => {
    paths.push(path);
    return new Response(JSON.stringify(body), { status });
  };

describe('loadEmotionCounts', () => {
  it('作った時刻の新しい順の 100 件を 1 本だけ読み、取引ごとに付いた数を返す', async () => {
    const paths: string[] = [];
    const counts = await loadEmotionCounts(
      reply(
        200,
        {
          items: [
            { id: 'a', emotionTags: ['recoup', 'fear'] },
            { id: 'b', emotionTags: ['recoup'] },
            { id: 'c' },
          ],
          next: null,
        },
        paths,
      ),
    );
    expect(EMOTION_HISTORY_LIMIT).toBe(100);
    expect(paths).toEqual(['/api/trades?order=created&limit=100']);
    expect(counts && Object.fromEntries(counts)).toEqual({ recoup: 2, fear: 1 });
  });

  it('AC-4: 失敗（500・通信・形の違う本文）は null', async () => {
    expect(await loadEmotionCounts(reply(500, { error: 'x' }))).toBeNull();
    expect(await loadEmotionCounts(reply(200, { items: 'x' }))).toBeNull();
    expect(
      await loadEmotionCounts(async () => {
        throw new Failed('network');
      }),
    ).toBeNull();
  });
});
