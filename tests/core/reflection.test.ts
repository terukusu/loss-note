// 取引の Good / More（Issue #123・設計書 C58・ADR-0024）の正規化と操作の純関数。値はすべて架空。
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { toTradeInput } from '../../core/record';
import {
  addNote,
  EMPTY_REFLECTION,
  isEmptyReflection,
  MAX_REFLECTION_NOTE_LENGTH,
  MAX_REFLECTION_NOTES,
  normalizeReflection,
  noteIssue,
  REFLECTION_TOPICS,
  removeNote,
  sameReflection,
  toggleTopic,
} from '../../core/reflection';
import { L1, L2 } from '../ui/helpers/trade-examples';
import { forAll } from './helpers/prng';

describe('Good / More の話題の一覧', () => {
  it('Good 7・More 7 で、両側に同じ ID が無い', () => {
    expect(REFLECTION_TOPICS.good).toHaveLength(7);
    expect(REFLECTION_TOPICS.more).toHaveLength(7);
    const all = [...REFLECTION_TOPICS.good, ...REFLECTION_TOPICS.more];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('normalizeReflection', () => {
  it('例 #1: 話題を一覧の順にそろえ、重複・知らない ID・反対側の ID を捨てる', () => {
    const r = normalizeReflection({
      good: { topics: ['cutEarly', 'cutEarly', 'enteredEarly'], notes: [] },
      more: { topics: ['lcTooTight', 'enteredEarly', 'nope'], notes: ['  出る前に TP を決める '] },
    });
    expect(r).toEqual({
      good: { topics: ['cutEarly'], notes: [] },
      more: { topics: ['enteredEarly', 'lcTooTight'], notes: ['出る前に TP を決める'] },
    });
  });

  it('形の違う値は空にする（応答に鍵が無い = 何も付いていない）', () => {
    expect(normalizeReflection(undefined)).toEqual(EMPTY_REFLECTION);
    expect(normalizeReflection({ good: 'x', more: { topics: 3, notes: [1, '', 'a\nb'] } })).toEqual(
      EMPTY_REFLECTION,
    );
    expect(isEmptyReflection(normalizeReflection(null))).toBe(true);
  });

  it('冪等（同じ値を 2 回通しても変わらない）', () => {
    forAll(
      123,
      200,
      (rand) => {
        const pick = <T>(xs: readonly T[]) => xs.filter(() => rand.bool(0.4));
        return {
          good: { topics: pick([...REFLECTION_TOPICS.good, 'x']), notes: pick(['a', ' b ', '']) },
          more: { topics: pick([...REFLECTION_TOPICS.more].reverse()), notes: pick(['c', 'd']) },
        };
      },
      (raw) => {
        const once = normalizeReflection(raw);
        expect(normalizeReflection(once)).toEqual(once);
      },
    );
  });
});

describe('行の検査（例 #4）', () => {
  it('空白だけ・改行・100 字を超える行は足せない', () => {
    expect(noteIssue('   ')).toBe('empty');
    expect(noteIssue('a\nb')).toBe('control');
    expect(noteIssue('a\tb')).toBe('control');
    expect(noteIssue('あ'.repeat(MAX_REFLECTION_NOTE_LENGTH))).toBeNull();
    expect(noteIssue('あ'.repeat(MAX_REFLECTION_NOTE_LENGTH + 1))).toBe('tooLong');
    // 文字はコードポイントで数える（API の len と同じ。絵文字 1 つ = 1 字）
    expect(noteIssue('😀'.repeat(MAX_REFLECTION_NOTE_LENGTH))).toBeNull();
  });
});

describe('操作', () => {
  it('toggleTopic: 付ける・外す。一覧の順', () => {
    let r = toggleTopic(EMPTY_REFLECTION, 'more', 'lcTooTight');
    r = toggleTopic(r, 'more', 'enteredEarly');
    expect(r.more.topics).toEqual(['enteredEarly', 'lcTooTight']);
    r = toggleTopic(r, 'more', 'lcTooTight');
    expect(r.more.topics).toEqual(['enteredEarly']);
    expect(r.good).toEqual(EMPTY_REFLECTION.good);
  });

  it('addNote: 例 #2 は足した順に並ぶ。11 行目は full', () => {
    let r = EMPTY_REFLECTION;
    for (let i = 0; i < MAX_REFLECTION_NOTES; i++) {
      const res = addNote(r, 'good', ` 行 ${i} `);
      expect(res.issue).toBeNull();
      r = res.value;
    }
    expect(r.good.notes[0]).toBe('行 0');
    expect(r.good.notes[9]).toBe('行 9');
    const over = addNote(r, 'good', '行 10');
    expect(over.issue).toBe('full');
    expect(over.value).toBe(r);
    expect(addNote(r, 'more', '')).toEqual({ value: r, issue: 'empty' });
  });

  it('removeNote: index の行だけ消す。範囲の外は変えない', () => {
    const r = normalizeReflection({ more: { topics: [], notes: ['a', 'b', 'c'] } });
    expect(removeNote(r, 'more', 1).more.notes).toEqual(['a', 'c']);
    expect(removeNote(r, 'more', 5)).toBe(r);
    expect(sameReflection(removeNote(r, 'more', 0), r)).toBe(false);
  });
});

describe('AC-7: Good / More は判定・R の入力に入らない', () => {
  it('付けても計算の入力と判定が同じ', () => {
    for (const t of [L1, L2]) {
      const withR = {
        ...t,
        reflection: normalizeReflection({
          good: { topics: ['cutEarly'], notes: ['架空の一言'] },
          more: { topics: ['oversized'], notes: [] },
        }),
      };
      expect(toTradeInput(withR)).toEqual(toTradeInput(t));
      expect(evaluateTrade(toTradeInput(withR))).toEqual(evaluateTrade(toTradeInput(t)));
    }
  });
});
