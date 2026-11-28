// 設計書 5.8 の例の表（両建てのまとまり）のテスト。正は設計書の表そのもの（13.3）。
// 5.7 と同じ形で `#` の列で行を数える。表に行を足して場面（group-table-cases.ts）を足さないと失敗する
import { describe, expect, it } from 'vitest';
import type { Grade, ReasonKind } from '../../core/judge';
import { evaluatePositionGroup, type GroupNote } from '../../core/position-group';
import designMd from '../../docs/design.md?raw';
import { GROUP_TABLE_CASES } from './group-table-cases';
import { parseHashTable, splitExpectation, wordUse } from './helpers/design-table';

const rows = parseHashTable(designMd, '5.8');

const GRADE_WORDS: Record<Grade, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  riskyWin: '危ない勝ち',
  safeWin: '計画どおりの勝ち',
};

/** 期待の列に現れる理由の言葉と種類（否定でない形で現れたら場面の reasons に要る） */
const REASON_WORDS: ReadonlyArray<{ word: string; kind: ReasonKind }> = [
  { word: '持ち続けた', kind: 'heldPastLc' },
  { word: 'LC を広げた', kind: 'lcWidened' },
  { word: '時間足を変えた', kind: 'timeframeLonger' },
  { word: '過剰リスク', kind: 'overRisk' },
  { word: '逆指値で切れた', kind: 'stopFilled' },
  { word: '決めた LC で切れた', kind: 'asPlannedLc' },
  { word: '早逃げ', kind: 'earlyExit' },
];

/** 期待の列に現れるまとまりの注記の言葉 */
const NOTE_WORDS: ReadonlyArray<{ word: string; kind: GroupNote['kind'] }> = [
  { word: '固定を外した', kind: 'unfixed' },
  { word: '多い', kind: 'overHedged' },
];

describe('5.8 例の表（両建てのまとまり）', () => {
  it.each(rows.map((r) => [r.id] as const))('5.8 %s', (id) => {
    const scene = GROUP_TABLE_CASES[id];
    if (scene === undefined) {
      throw new Error(`設計書 5.8 の ${id} の場面が tests/core/group-table-cases.ts にありません`);
    }
    const ev = evaluatePositionGroup(scene.group);
    if (!ev.ok) throw new Error(`${id} が受け付けられなかった: ${JSON.stringify(ev)}`);
    expect(ev.judgment, id).toBeDefined();
    expect(ev.judgment?.grade, id).toBe(scene.grade);
    if (scene.r === 'none') expect(ev.r, `${id} の R`).toBeUndefined();
    else if (scene.r !== undefined) expect(ev.r, `${id} の R`).toBeCloseTo(scene.r, 9);
    const got = (ev.judgment?.reasons ?? []).map((r) => r.kind);
    for (const k of scene.reasons) expect(got, `${id} の理由に ${k}`).toContain(k);
    for (const k of scene.absent ?? []) expect(got, `${id} の理由に ${k} が無い`).not.toContain(k);
    const notes = ev.notes.map((n) => n.kind);
    expect(notes, `${id} の注記`).toEqual(scene.notes ?? []);
  });
});

describe('5.8 の表とテストの対応', () => {
  it('表を読めている（行が 1 つ以上・ID の形・重複なし）', () => {
    const ids = rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^H\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('場面の ID の集合が表の ID の集合と同じ', () => {
    expect(Object.keys(GROUP_TABLE_CASES).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it.each(rows.map((r) => [r.id, r.expectation] as const))(
    '期待の列と場面の期待が食い違わない（%s）',
    (id, expectation) => {
      const scene = GROUP_TABLE_CASES[id];
      if (scene === undefined) throw new Error(`${id} の場面が無い`);
      const parts = splitExpectation(expectation);
      const first = parts[0];
      if (first === undefined) throw new Error(`判定の言葉が見つからない: ${expectation}`);
      expect(first.atStart, expectation).toBe(true);
      expect(parts.length, expectation).toBe(1);
      const where = `${id}「${expectation}」`;
      expect(first.word, where).toBe(GRADE_WORDS[scene.grade]);
      for (const { word, kind } of REASON_WORDS) {
        if (wordUse(expectation, word).positive)
          expect(scene.reasons, `${where}: 「${word}」→ ${kind}`).toContain(kind);
      }
      for (const { word, kind } of NOTE_WORDS) {
        if (wordUse(expectation, word).positive)
          expect(scene.notes ?? [], `${where}: 「${word}」→ ${kind}`).toContain(kind);
      }
    },
  );
});
