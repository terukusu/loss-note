// 根拠の足のチャートの例の表（Issue #12 の E1〜E6）を、画面の純関数（readDraft）でプレビューの判定と理由に通し、
// 同じ本文を共有の合成の fixture `tests/fixtures/records/chart-entry.json` に書く（AC-4）。
// API のテスト（api/tests/test_chart_entry_fixture.py）が同じ fixture を合成のチャートつきで本物の API に通し、
// 読み戻した record が送ったものと一致することを確かめる。ここでは fixture の record を保存の形として summarize に通し、
// 読み戻した取引でも同じ判定・理由になることを見る（判定は TS の純関数が正。ADR-0004 決定 6）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/chart-entry-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type { Reason } from '../../core/judge';
import type { InstrumentBody, SettingsBody, TradeRecord, TradeSnapshot } from '../../core/record';
import { reasonText } from '../../ui/src/lib/reasons';
import { DEFAULT_INSTRUMENT, readDraft, summarize } from '../../ui/src/lib/record-form';
import { CHART_CASES } from './helpers/chart-drafts';

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
const FIXTURE = new URL('../fixtures/records/chart-entry.json', import.meta.url);
const PLACEHOLDER = 'INSTRUMENT';
/** 決済の時刻（datetime-local の読みは端末の時間帯に依るので、fixture では決まった時点に置き換える。架空） */
const EXIT_TIME = 1_794_274_200_000;

interface Item {
  readonly name: string;
  readonly instrument: InstrumentBody;
  readonly settings: SettingsBody;
  /** チャートを付ける枠（API のテストが合成の画像を付けて送る） */
  readonly charts: readonly ('entry' | 'exit')[];
  readonly record: TradeRecord;
  readonly snapshot: TradeSnapshot;
  readonly expect: { readonly grade: string; readonly reasons: readonly string[] };
}

const settings: SettingsBody = { capitalYen: null, riskTolerancePct: 1, performanceUnit: 'R' };
const snapshot: TradeSnapshot = {
  instrument: DEFAULT_INSTRUMENT,
  capitalYen: null,
  riskTolerancePct: 1,
};

/** 比べる理由（資金が未設定の注記は時間足と関係ないので除く。fixture は資金なしで作る） */
const shown = (reasons: readonly Reason[]) =>
  reasons.filter((r) => r.kind !== 'riskNotChecked').map((r) => reasonText(r, 'L'));

function texts(record: TradeRecord): { grade: string | undefined; reasons: string[] } {
  const s = summarize({ record, snapshot });
  return {
    grade: s.judgment?.grade,
    reasons: shown(s.judgment?.reasons ?? []),
  };
}

function build(): { trades: Item[] } {
  return {
    trades: CHART_CASES.map((c) => {
      const read = readDraft(c.draft, { instruments: [], settings, charts: c.charts });
      if (!read.body || !read.preview.judgment)
        throw new Error(`${c.name} が保存できる下書きでない`);
      return {
        name: c.name,
        instrument: { name: read.instrument.name },
        settings,
        charts: (['entry', 'exit'] as const).filter((s) => c.charts[s]),
        record: {
          ...read.body,
          exit: { ...read.body.exit, time: EXIT_TIME },
          instrumentId: PLACEHOLDER,
        },
        snapshot,
        expect: {
          grade: read.preview.judgment.grade,
          reasons: shown(read.preview.judgment.reasons),
        },
      };
    }),
  };
}

describe('チャートつきの本文の fixture（Issue #12 AC-4）', () => {
  it('fixture は今の readDraft が作る本文と同じ（ずれたら UPDATE_FIXTURES=1 で書き直す）', () => {
    const built = build();
    const json = `${JSON.stringify(built, null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, json);
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(built);
  });

  it.each(CHART_CASES)('$name: プレビューの判定と括弧の理由が例の表のとおり', (c) => {
    const read = readDraft(c.draft, { instruments: [], settings, charts: c.charts });
    expect(read.preview.judgment?.grade).toBe(c.grade);
    expect(shown(read.preview.judgment?.reasons ?? [])).toEqual(c.reasons);
  });

  it('保存の形（fixture の record）から summarize しても同じ判定・理由（読み戻した取引でも同じ）', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { trades: Item[] };
    expect(fixture.trades.map((t) => t.name)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
    for (const t of fixture.trades) {
      const want = CHART_CASES.find((c) => c.name === t.name);
      expect(texts(t.record), t.name).toEqual({ grade: want?.grade, reasons: want?.reasons });
      expect(t.expect, t.name).toEqual({ grade: want?.grade, reasons: want?.reasons });
    }
  });

  it('E1 の理由にチャートからであることが出る / E3 は決済時の時間足を本文に持たない', () => {
    const t = Object.fromEntries(build().trades.map((x) => [x.name, x]));
    expect(t.E1?.expect.reasons[0]).toContain('・チャートから');
    expect(t.E3?.record.entryChartTimeframe).toBe('4h');
    expect(t.E3 && 'exitChartTimeframe' in t.E3.record).toBe(false);
    expect(t.E6 && 'entryChartTimeframe' in t.E6.record).toBe(false);
  });

  it('E11: 決済時のチャートを外す（時間足も消える）と、E1 の理由から「チャートから」が消える', () => {
    const e1 = build().trades.find((x) => x.name === 'E1');
    if (!e1) throw new Error('E1 が無い');
    const { exitChartTimeframe: _gone, ...removed } = e1.record;
    const after = texts(removed as TradeRecord);
    expect(after.reasons.some((r) => r.includes('チャートから'))).toBe(false);
    expect(after.reasons).toEqual([`LC で切らずに持ち続けた（−1.4R）`]);
    expect(after.grade).toBe('B');
  });
});
