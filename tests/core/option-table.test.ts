// 設計書 5.7 の例の表（オプションのポジション）のテスト。正は設計書の表そのもの（13.3）。
// 5.6 と同じ形で `#` の列で行を数える。表に行を足して場面（option-table-cases.ts）か保留の一覧を足さないと失敗する
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import type { Grade, ReasonKind } from '../../core/judge';
import designMd from '../../docs/design.md?raw';
import { parseHashTable, splitExpectation, wordUse } from './helpers/design-table';
import { OPTION_TABLE_CASES, PENDING_ROWS } from './option-table-cases';

const rows = parseHashTable(designMd, '5.7');
const covered = rows.filter((r) => !PENDING_ROWS.includes(r.id));

const GRADE_WORDS: Record<Grade, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  riskyWin: '危ない勝ち',
  safeWin: '計画どおりの勝ち',
};

/**
 * 期待の列に現れる理由の言葉と種類。否定でない形で現れたら場面の reasons に、
 * 否定の形（「持ち続けたにしない」「過剰リスクではない」）で現れたら場面の absent に要る
 */
const REASON_WORDS: ReadonlyArray<{ word: string; kind: ReasonKind }> = [
  { word: 'LC を決めずに', kind: 'noLc' },
  { word: '持ち続けた', kind: 'heldPastLc' },
  { word: 'LC を広げた', kind: 'lcWidened' },
  { word: '時間足を変えた', kind: 'timeframeLonger' },
  { word: '過剰リスク', kind: 'overRisk' },
  { word: '過剰リスクは見ていない', kind: 'riskNotChecked' },
  { word: '金額ありき', kind: 'amountBasedLc' },
  { word: '逆指値で切れた', kind: 'stopFilled' },
  { word: '逆指値', kind: 'stopFilled' },
  { word: '決めた LC で切れた', kind: 'asPlannedLc' },
  { word: '早逃げ', kind: 'earlyExit' },
];

/** 判定の言葉の直後が否定（「C にしない」）なら、その言葉は期待の判定ではない */
const NEGATED_GRADE = /^\s*(?:に|と)(?:は)?しない/;

describe('5.7 例の表（オプションのポジション）', () => {
  it.each(covered.map((r) => [r.id] as const))('5.7 %s', (id) => {
    const scenes = OPTION_TABLE_CASES[id];
    if (scenes === undefined) {
      throw new Error(`設計書 5.7 の ${id} の場面が tests/core/option-table-cases.ts にありません`);
    }
    expect(scenes.length).toBeGreaterThan(0);
    for (const scene of scenes) {
      const ev = evaluateTrade(scene.input);
      if (!ev.ok) throw new Error(`${id} が受け付けられなかった: ${JSON.stringify(ev.issues)}`);
      const judgment = ev.judgment;
      expect(judgment, id).toBeDefined();
      expect(judgment?.grade, id).toBe(scene.grade);
      if (scene.outcome !== undefined) expect(judgment?.outcome, id).toBe(scene.outcome);
      // 行に書かれた R と 1R の出どころ（1R の順の取り違えを表で捕まえる。C49）
      if (scene.r === 'none') expect(ev.r, `${id} の R`).toBeUndefined();
      else if (scene.r !== undefined) expect(ev.r, `${id} の R`).toBeCloseTo(scene.r, 9);
      if (scene.oneRSource === 'none') expect(ev.oneRSource, `${id} の 1R`).toBeUndefined();
      else if (scene.oneRSource !== undefined) {
        expect(ev.oneRSource, `${id} の 1R の出どころ`).toBe(scene.oneRSource);
      }
      const got = (judgment?.reasons ?? []).map((r) => r.kind);
      for (const k of scene.reasons) expect(got, `${id} の理由に ${k}`).toContain(k);
      for (const k of scene.absent ?? [])
        expect(got, `${id} の理由に ${k} が無い`).not.toContain(k);
    }
  });
});

describe('5.7 の表とテストの対応', () => {
  it('表を読めている（行が 1 つ以上・ID の形・重複なし）', () => {
    const ids = rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^O\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('場面の ID と保留の ID を合わせた集合が表の ID の集合と同じで、重ならない', () => {
    const cases = Object.keys(OPTION_TABLE_CASES);
    for (const id of cases) expect(PENDING_ROWS, id).not.toContain(id);
    expect([...cases, ...PENDING_ROWS].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('保留の行が無い（#114 の O5・O8・O9・O12・O18 にも場面がある）', () => {
    expect(PENDING_ROWS).toEqual([]);
    const ids = covered.map((r) => r.id);
    for (const id of ['O5', 'O8', 'O9', 'O12', 'O18']) expect(ids).toContain(id);
  });

  it.each(covered.map((r) => [r.id, r.expectation] as const))(
    '期待の列と場面の期待が食い違わない（%s）',
    (id, expectation) => {
      const scenes = OPTION_TABLE_CASES[id] ?? [];
      // 「C にしない」のように否定の形で現れた判定の言葉は、期待の判定ではない（O18）
      const all = splitExpectation(expectation);
      const isNegated = (p: (typeof all)[number]) =>
        NEGATED_GRADE.test(p.text.slice(p.word.length));
      const parts = all.filter((p) => !isNegated(p));
      // 否定された判定の言葉は場面の判定と違う（O18 の「C にしない」なら C ではない）
      for (const neg of all.filter(isNegated)) {
        for (const scene of scenes)
          expect(GRADE_WORDS[scene.grade], expectation).not.toBe(neg.word);
      }
      expect(parts.length, `判定の言葉が見つからない: ${expectation}`).toBeGreaterThan(0);
      const first = parts[0];
      if (first === undefined) throw new Error(`${id} の期待が無い`);
      // 期待の列は判定の言葉で始まる（どの行も場面は 1 つ）
      expect(first.atStart, expectation).toBe(true);
      expect(parts.length, expectation).toBe(1);
      for (const scene of scenes) {
        const where = `${id}「${expectation}」`;
        expect(first.word, where).toBe(GRADE_WORDS[scene.grade]);
        for (const { word, kind } of REASON_WORDS) {
          const use = wordUse(expectation, word);
          if (use.positive) expect(scene.reasons, `${where}: 「${word}」→ ${kind}`).toContain(kind);
          if (use.negated)
            expect(scene.absent ?? [], `${where}: 「${word}」の否定 → ${kind} が無い`).toContain(
              kind,
            );
        }
      }
    },
  );
});
