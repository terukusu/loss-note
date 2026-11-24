// Good / More の話題の ID の一覧の fixture（Issue #123・ADR-0024）。API のテスト（api/tests/test_reflection_fixture.py）が
// 同じ fixture を Python の一覧（loss_note_api.reflection）と突き合わせ、画面と API の一覧のずれを塞ぐ。
// 一覧が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/core/reflection-fixture.test.ts` で書き直す
// （ID は保存の形なので、変えるのは足すときだけ）
import { describe, expect, it } from 'vitest';
import {
  MAX_REFLECTION_NOTE_LENGTH,
  MAX_REFLECTION_NOTES,
  REFLECTION_TOPICS,
} from '../../core/reflection';

const node = (
  globalThis as unknown as {
    process: {
      env: Record<string, string | undefined>;
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(p: URL, enc: 'utf8'): string;
        writeFileSync(p: URL, data: string): void;
      };
    };
  }
).process;
const fs = node.getBuiltinModule('node:fs');
const FIXTURE = new URL('../fixtures/records/reflection-topics.json', import.meta.url);

describe('Good / More の話題の一覧の fixture', () => {
  it('fixture は core/reflection.ts の一覧と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = {
      good: REFLECTION_TOPICS.good,
      more: REFLECTION_TOPICS.more,
      maxNotes: MAX_REFLECTION_NOTES,
      maxNoteLength: MAX_REFLECTION_NOTE_LENGTH,
    };
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });
});
