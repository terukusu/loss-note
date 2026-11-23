// 心理のタグの選び方（Issue #156 の R2・R3、AC-3 の例 #3〜#5）と並び。性質は種つきの乱数で確かめる
import { describe, expect, it } from 'vitest';
import {
  CALM,
  EMOTION_GROUP_OF,
  EMOTION_GROUPS,
  EMOTION_TAG_IDS,
  type EmotionTagId,
  isEmotionTagId,
  normalizeEmotions,
  normalizeHidden,
  toggleEmotion,
  toggleHidden,
} from '../../core/emotion-tags';
import { forAll, type Rng } from './helpers/prng';

const order = (ids: readonly EmotionTagId[]) => ids.map((id) => EMOTION_TAG_IDS.indexOf(id));
const sorted = (xs: readonly number[]) => xs.every((v, i) => i === 0 || (xs[i - 1] ?? 0) < v);

describe('一覧', () => {
  it('21 個・重複なし・平常心が先頭・まとまりは 良い状態 → 恐れ → 欲 → 取り戻し → 思い込み の順に並ぶ', () => {
    expect(EMOTION_TAG_IDS).toHaveLength(21);
    expect(new Set(EMOTION_TAG_IDS).size).toBe(21);
    expect(EMOTION_TAG_IDS[0]).toBe(CALM);
    const groups = EMOTION_TAG_IDS.map((id) => EMOTION_GROUPS.indexOf(EMOTION_GROUP_OF[id]));
    expect(groups.every((g, i) => i === 0 || (groups[i - 1] ?? 0) <= g)).toBe(true);
    expect(EMOTION_TAG_IDS.filter((id) => EMOTION_GROUP_OF[id] === 'good')).toEqual([CALM]);
  });

  it('ID は英字だけ（保存の鍵）', () => {
    for (const id of EMOTION_TAG_IDS) expect(id).toMatch(/^[A-Za-z]+$/);
  });

  it('isEmotionTagId は一覧の ID だけを通す', () => {
    expect(isEmotionTagId('fear')).toBe(true);
    expect(isEmotionTagId('Fear')).toBe(false);
    expect(isEmotionTagId('toString')).toBe(false);
    expect(isEmotionTagId(1)).toBe(false);
  });
});

describe('toggleEmotion（AC-3）', () => {
  it('例 #3: 平常心 → 怖い = 怖い だけ', () => {
    expect(toggleEmotion(toggleEmotion([], 'calm'), 'fear')).toEqual(['fear']);
  });

  it('例 #4: 怖い・祈り → 平常心 = 平常心 だけ', () => {
    const before = toggleEmotion(toggleEmotion([], 'fear'), 'hope');
    expect(before).toEqual(['fear', 'hope']);
    expect(toggleEmotion(before, 'calm')).toEqual(['calm']);
  });

  it('例 #5: 悔しい を押し直すと外れる', () => {
    expect(toggleEmotion(toggleEmotion([], 'frustrated'), 'frustrated')).toEqual([]);
  });

  it('例 #1: 取り戻したい → ポジりたい は一覧の順（ポジりたい → 取り戻したい）', () => {
    expect(toggleEmotion(toggleEmotion([], 'recoup'), 'wantPosition')).toEqual([
      'wantPosition',
      'recoup',
    ]);
  });

  const gen = (r: Rng) => {
    const presses: EmotionTagId[] = [];
    const n = r.int(0, 30);
    for (let i = 0; i < n; i++) presses.push(r.pick(EMOTION_TAG_IDS));
    return presses;
  };

  it('性質: どの押し方でも 重複なし・一覧の順・平常心と他が同時に無い', () => {
    forAll(156, 500, gen, (presses) => {
      let s: EmotionTagId[] = [];
      for (const id of presses) {
        s = toggleEmotion(s, id);
        expect(new Set(s).size).toBe(s.length);
        expect(sorted(order(s))).toBe(true);
        if (s.includes(CALM)) expect(s).toEqual([CALM]);
        // 押したタグは、押した後に付いているか外れているかのどちらか（押す前と逆）
      }
    });
  });

  it('性質: 押した ID の有無は押す前と逆になる', () => {
    forAll(157, 500, gen, (presses) => {
      let s: EmotionTagId[] = [];
      for (const id of presses) {
        const had = s.includes(id);
        s = toggleEmotion(s, id);
        expect(s.includes(id)).toBe(!had);
      }
    });
  });
});

describe('normalizeEmotions', () => {
  it('知らない値を捨て、重複を 1 つにし、一覧の順に並べる', () => {
    expect(normalizeEmotions(['hope', 'x', 'fear', 'hope', 3, null])).toEqual(['fear', 'hope']);
  });

  it('配列でなければ空', () => {
    expect(normalizeEmotions(undefined)).toEqual([]);
    expect(normalizeEmotions('fear')).toEqual([]);
  });

  it('性質: 冪等', () => {
    forAll(
      158,
      300,
      (r) => Array.from({ length: r.int(0, 25) }, () => r.pick([...EMOTION_TAG_IDS, 'zzz'])),
      (xs) => {
        const once = normalizeEmotions(xs);
        expect(normalizeEmotions(once)).toEqual(once);
      },
    );
  });
});

describe('normalizeHidden・toggleHidden（#163 の R2・R7）', () => {
  it('平常心と知らない値を捨て、重複を 1 つにし、一覧の順に並べる', () => {
    expect(normalizeHidden(['bargain', 'calm', 'zzz', 'fomo', 'bargain'])).toEqual([
      'fomo',
      'bargain',
    ]);
    expect(normalizeHidden(null)).toEqual([]);
  });

  it('押すと足す / 外す。平常心は変えない', () => {
    expect(toggleHidden([], 'fomo')).toEqual(['fomo']);
    expect(toggleHidden(['fomo', 'bargain'], 'fomo')).toEqual(['bargain']);
    expect(toggleHidden(['bargain'], 'fomo')).toEqual(['fomo', 'bargain']);
    expect(toggleHidden(['fomo'], CALM)).toEqual(['fomo']);
  });

  it('性質: 2 回押すと元に戻り、平常心は入らない', () => {
    forAll(
      163,
      300,
      (r) => ({
        hidden: normalizeHidden(
          Array.from({ length: r.int(0, 21) }, () => r.pick([...EMOTION_TAG_IDS])),
        ),
        id: r.pick([...EMOTION_TAG_IDS]),
      }),
      ({ hidden, id }) => {
        const once = toggleHidden(hidden, id);
        expect(once).not.toContain(CALM);
        expect(sorted(order(once))).toBe(true);
        expect(toggleHidden(once, id)).toEqual(hidden);
      },
    );
  });
});
