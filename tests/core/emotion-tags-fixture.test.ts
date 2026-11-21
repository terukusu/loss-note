// 心理のタグの ID の一覧の fixture（Issue #156・ADR-0022）。API のテスト（api/tests/test_emotion_tags_fixture.py）が
// 同じ fixture を Python の一覧（loss_note_api.emotion_tags）と突き合わせ、画面と API の一覧のずれを塞ぐ。
// 一覧が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/core/emotion-tags-fixture.test.ts` で書き直す
// （ID は保存の形なので、変えるのは足すときだけ。変える・消すと過去の記録の意味が変わる）
import { describe, expect, it } from 'vitest';
import { CALM, EMOTION_TAG_IDS, MAX_EMOTION_TRADES } from '../../core/emotion-tags';

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
const FIXTURE = new URL('../fixtures/records/emotion-tags.json', import.meta.url);

describe('心理のタグの一覧の fixture', () => {
  it('fixture は core/emotion-tags.ts の一覧と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = { ids: EMOTION_TAG_IDS, calm: CALM, maxTrades: MAX_EMOTION_TRADES };
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });
});
