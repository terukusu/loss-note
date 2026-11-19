// 設計書 5.6 の例の表のテスト。正は設計書の表そのもの（13.3）。
// テストは設計書の `#` の列で回すので、表に行を足してテスト側の場面を足さないと、その行が失敗する
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import type { Grade, ReasonKind } from '../../core/judge';
import designMd from '../../docs/design.md?raw';
import { DESIGN_TABLE_CASES } from './design-table-cases';
import { parenthesized, parseDesignTable, splitExpectation } from './helpers/design-table';

const rows = parseDesignTable(designMd);

/** 判定の言葉（期待の列に書く言葉） */
const GRADE_WORDS: Record<Grade, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  riskyWin: '危ない勝ち',
  safeWin: '計画どおりの勝ち',
};

/** 期待の列に現れる理由の言葉（5.3 の表示の言葉）と、理由の種類。inParen は括弧の中だけで数える言葉 */
const REASON_WORDS: ReadonlyArray<{ word: string; kind: ReasonKind; inParen?: boolean }> = [
  { word: 'LC を決めずに', kind: 'noLc' },
  { word: '持ち続けた', kind: 'heldPastLc' },
  { word: 'LC を広げた', kind: 'lcWidened' },
  { word: '時間足を変えた', kind: 'timeframeLonger' },
  { word: '過剰リスク', kind: 'overRisk' },
  { word: '金額ありき', kind: 'amountBasedLc' },
  { word: 'ナンピン', kind: 'averagingDown' },
  { word: '逆指値で切れた', kind: 'stopFilled' },
  { word: '決めた LC で切れた', kind: 'asPlannedLc' },
  { word: '早逃げ', kind: 'earlyExit' },
  // 「窓・滑り」は場面の説明（「窓・滑りでしたか」）にも出るので、括弧の中の理由として現れたときだけ
  { word: '窓・滑り', kind: 'gapSlip', inParen: true },
];

describe('5.6 例の表', () => {
  it.each(rows.map((r) => [r.id] as const))('5.6 #%s', (id) => {
    const scenes = DESIGN_TABLE_CASES[id];
    if (scenes === undefined) {
      throw new Error(
        `設計書 5.6 の #${id} の場面が tests/core/design-table-cases.ts にありません`,
      );
    }
    expect(scenes.length).toBeGreaterThan(0);
    for (const scene of scenes) {
      const where = `#${id}${scene.label ? `（${scene.label}）` : ''}`;
      const ev = evaluateTrade(scene.input);
      if (!ev.ok) throw new Error(`${where} が受け付けられなかった: ${JSON.stringify(ev.issues)}`);
      const judgment = ev.judgment;
      expect(judgment, where).toBeDefined();
      expect(judgment?.grade, where).toBe(scene.grade);
      const got = (judgment?.reasons ?? []).map((r) => r.kind);
      for (const k of scene.reasons) expect(got, `${where} の理由に ${k}`).toContain(k);
      for (const k of scene.absent ?? [])
        expect(got, `${where} の理由に ${k} が無い`).not.toContain(k);
    }
  });
});

describe('例の表とテストの対応', () => {
  it('表を読めている（行が 1 つ以上・ID の形・重複なし）', () => {
    expect(rows.length).toBeGreaterThan(0);
    const ids = rows.map((r) => r.id);
    for (const id of ids) expect(id).toMatch(/^\d+[a-z]?$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('テスト側の場面の ID の集合が、表の ID の集合と同じ', () => {
    expect(Object.keys(DESIGN_TABLE_CASES).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it.each(rows.map((r) => [r.id, r.expectation] as const))(
    '期待の列と場面の期待が食い違わない（#%s）',
    (id, expectation) => {
      const scenes = DESIGN_TABLE_CASES[id] ?? [];
      // 期待の列を判定の言葉ごとに分け、場面に対応づける。
      // 判定の言葉が場面の数と同じなら順に 1 対 1、1 つだけなら全場面が同じ部分（例: #6）
      const parts = splitExpectation(expectation);
      expect(parts.length, `判定の言葉が見つからない: ${expectation}`).toBeGreaterThan(0);
      if (parts.length !== 1) expect(parts.length, expectation).toBe(scenes.length);
      scenes.forEach((scene, i) => {
        const part = parts.length === 1 ? parts[0] : parts[i];
        if (part === undefined) throw new Error(`#${id} の場面 ${i} の期待が無い`);
        const where = `#${id} 場面 ${i + 1}「${part.text}」`;
        // 判定の言葉が一致する。1 場面の行では期待の列がその言葉で始まる
        expect(part.word, where).toBe(GRADE_WORDS[scene.grade]);
        if (scenes.length === 1) expect(part.atStart, where).toBe(true);
        // その場面の期待の文に書かれた理由の言葉が、場面の期待の理由に含まれる（取りこぼさない。C31）
        const inParen = parenthesized(part.text);
        for (const { word, kind, inParen: parenOnly } of REASON_WORDS) {
          const found = parenOnly ? inParen.includes(word) : part.text.includes(word);
          if (found) expect(scene.reasons, `${where}: 「${word}」→ ${kind}`).toContain(kind);
        }
      });
    },
  );
});
