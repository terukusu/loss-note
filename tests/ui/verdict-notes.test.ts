// 判定の枠と貼り付きの帯の文（Issue #33 AC-2・AC-8・例 1・3・7・12。ui/src/lib/verdict-notes.ts の純関数）。
// 値はすべて架空（tests/ui/helpers/record-drafts.ts の例の表の下書き）
import { describe, expect, it } from 'vitest';
import { CHART_PREPARING } from '../../ui/src/lib/record-controller';
import { applyDraft, FIELD_LABEL, readDraft, summarize } from '../../ui/src/lib/record-form';
import { gateReading } from '../../ui/src/lib/statement-fill';
import {
  blockReason,
  isTapAction,
  submitStatus,
  verdictNotes,
} from '../../ui/src/lib/verdict-notes';
import { CAPITAL_1M, draft, E1, E3, E10, E11, E16, NO_CAPITAL } from './helpers/record-drafts';

/** 開いた直後（銘柄・数量・決済の時刻は前の取引と今から入っている。足りない欄は 7 つ） */
const OPENED = draft({});
const OPENED_READ = readDraft(OPENED, NO_CAPITAL);
const SEVEN = [
  'L / S',
  'イン',
  '決済の価格',
  'LC（価格か「なし」）',
  'LC を入る前に決めていたか',
  'LC を動かしたか',
  '時間足を変えたか',
];

/** 誤りのある欄の名前（画面と同じ作り: FIELD_LABEL を重ねない） */
function errorLabelsOf(errors: Readonly<Partial<Record<keyof typeof FIELD_LABEL, string>>>) {
  const keys = (Object.keys(errors) as (keyof typeof FIELD_LABEL)[]).filter(
    (k) => errors[k] !== undefined,
  );
  return [...new Set(keys.map((k) => FIELD_LABEL[k]))];
}

describe('submitStatus: 帯の 1 行の文（AC-1・AC-2・例 1・2・3）', () => {
  it('開いた直後は「あと 7 欄」（名前は並べない）', () => {
    expect(OPENED_READ.missing).toEqual(SEVEN);
    expect(submitStatus(OPENED_READ, [])).toBe('あと 7 欄');
  });

  it('決済の欄に誤り 1 つ → 「誤り 1 欄・あと 6 欄」。足りない欄が無ければ「誤り 1 欄」', () => {
    const r = readDraft(
      applyDraft(OPENED, { type: 'set', field: 'exitPrice', value: 'x' }),
      NO_CAPITAL,
    );
    expect(errorLabelsOf(r.errors)).toEqual(['決済']);
    expect(submitStatus(r, errorLabelsOf(r.errors))).toBe('誤り 1 欄・あと 6 欄');
    const full = readDraft(
      applyDraft(E1, { type: 'set', field: 'exitPrice', value: 'x' }),
      NO_CAPITAL,
    );
    expect(submitStatus(full, errorLabelsOf(full.errors))).toBe('誤り 1 欄');
  });

  it('チャートの準備中は短い一言（帯に長い知らせを入れない）。案内は全文で句点を重ねない', () => {
    const r = { ...readDraft(E1, NO_CAPITAL), canSave: false, notice: CHART_PREPARING };
    expect(submitStatus(r, [])).toBe('チャートの準備中');
    expect(blockReason(r, [])).toBe(CHART_PREPARING);
  });

  it('読み取り中は「明細を読み取っています」の一言', () => {
    const r = gateReading(OPENED_READ, { reading: true, marks: {} });
    expect(submitStatus(r, [])).toBe('明細を読み取っています');
  });

  it('そろったら判定の要約（文字だけ）: B は「B 悪い損失 · −1.6R」、危ない勝ちは R つき、C は R なし', () => {
    expect(submitStatus(readDraft(E1, NO_CAPITAL), [])).toBe('B 悪い損失 · −1.6R');
    expect(submitStatus(readDraft(E3, NO_CAPITAL), [])).toMatch(/^危ない勝ち · \+1\.5R$/);
    expect(submitStatus(readDraft(E16, NO_CAPITAL), [])).toBe('C 極悪な損失');
  });

  it('時間足だけが足りない（E10）→「あと 1 欄」', () => {
    expect(submitStatus(readDraft(E10, NO_CAPITAL), [])).toBe('あと 1 欄');
  });
});

describe('blockReason: [記録する] が押せない理由の文（AC-2）', () => {
  it('開いた直後: 7 つの欄の名前をすべて含む 1 文', () => {
    const t = blockReason(OPENED_READ, []);
    expect(t).not.toBeNull();
    for (const name of SEVEN) expect(t).toContain(name);
    expect(t).toContain('判定と理由が出ます');
  });

  it('誤りのある欄の名前（決済）を含む', () => {
    const r = readDraft(
      applyDraft(E1, { type: 'set', field: 'exitPrice', value: 'x' }),
      NO_CAPITAL,
    );
    const t = blockReason(r, errorLabelsOf(r.errors));
    expect(t).toContain('誤りのある欄（決済）');
  });

  it('読み取り中は「明細を読み取っています。」を含む', () => {
    const r = gateReading(OPENED_READ, { reading: true, marks: {} });
    expect(blockReason(r, [])).toContain('明細を読み取っています。');
  });

  it('押せるときは null', () => {
    expect(blockReason(readDraft(E1, NO_CAPITAL), [])).toBeNull();
  });
});

describe('verdictNotes: 判定の枠の注記・脇の 1 行・理由（AC-8・例 7・12）', () => {
  const textOf = (n: ReturnType<typeof verdictNotes>) => [...n.notes].join('\n');

  it('E1・資金なし: 理由の一覧から「見ていない」を外し脇へ。資金の説明は脇の 1 回だけ（注記に資金を出さない）', () => {
    const n = verdictNotes(readDraft(E1, NO_CAPITAL).preview, { pending: false });
    expect(n.reasons.map((r) => r.kind)).toEqual(['lcWidened']);
    expect(n.aside.map((r) => r.kind)).toEqual(['riskNotChecked']);
    expect(n.rNone).toBe(false);
    expect(n.riskNone).toBe(true);
    expect(textOf(n)).not.toContain('資金');
    expect(n.notes).toEqual([]);
  });

  it('E11（資金あり・1R が出ない）: 「リスクの「—」: 損益（円）を入れると出ます」が 1 回', () => {
    const n = verdictNotes(readDraft(E11, CAPITAL_1M).preview, { pending: false });
    expect(n.notes).toEqual(['リスクの「—」: 損益（円）を入れると出ます']);
  });

  it('E16（LC なし）: R・リスクの段を出さず、注記「LC が無いので R・リスクは出ません」が 1 回。C の noLc は理由の一覧に重ねない', () => {
    const n = verdictNotes(readDraft(E16, NO_CAPITAL).preview, { pending: false });
    expect(n.rNone).toBe(true);
    expect(n.riskNone).toBe(true);
    expect(n.hideRisk).toBe(true);
    expect(n.notes).toEqual(['LC が無いので R・リスクは出ません']);
    expect(n.reasons.map((r) => r.kind)).not.toContain('noLc');
  });

  it('判定を待つ間は LC なしでも R・リスクの段を隠さない', () => {
    const d = applyDraft(E16, { type: 'set', field: 'timeframeChange', value: null });
    expect(verdictNotes(readDraft(d, NO_CAPITAL).preview, { pending: true }).hideRisk).toBe(false);
  });

  it('計算できない記録: 「R・リスクの「—」: この記録からは計算できません」', () => {
    expect(
      verdictNotes(
        { noLc: false, invalid: true, riskNote: 'この記録からは計算できません' },
        {
          pending: false,
        },
      ).notes,
    ).toEqual(['R・リスクの「—」: この記録からは計算できません']);
  });

  it('判定を待つ間（E10・開いた直後）は注記を出さない（案内の 1 文だけにする）', () => {
    for (const d of [E10, OPENED]) {
      const n = verdictNotes(readDraft(d, NO_CAPITAL).preview, { pending: true });
      expect(n.notes).toEqual([]);
      expect(n.reasons).toEqual([]);
      expect(n.aside).toEqual([]);
    }
  });

  it('保存した取引の形（summarize）でも同じ: 資金なしの B は注記なし・脇に見ていない', () => {
    const body = readDraft(E1, NO_CAPITAL).body;
    expect(body).toBeDefined();
    const s = summarize({
      record: { ...(body as NonNullable<typeof body>), instrumentId: 'inst-us30' },
      snapshot: {
        instrument: {
          multiplier: 1,
          quantityStep: 1,
          priceCurrency: null,
          underlyingKind: 'index',
          productForm: 'spotCfd',
        },
        capitalYen: null,
        riskTolerancePct: 1,
      },
    } as Parameters<typeof summarize>[0]);
    const n = verdictNotes(s, { pending: false });
    expect(n.notes).toEqual([]);
    expect(n.aside.map((r) => r.kind)).toEqual(['riskNotChecked']);
  });
});

describe('isTapAction: 判定の枠を見える範囲へ寄せる操作（AC-3）', () => {
  it('3 つのタップと LC の「なし」だけ', () => {
    expect(isTapAction({ type: 'set', field: 'lcDecided', value: true })).toBe(true);
    expect(isTapAction({ type: 'set', field: 'lcMove', value: 'none' })).toBe(true);
    expect(isTapAction({ type: 'set', field: 'timeframeChange', value: 'none' })).toBe(true);
    expect(isTapAction({ type: 'set', field: 'lcNone', value: true })).toBe(true);
    expect(isTapAction({ type: 'set', field: 'lc', value: '99.5' })).toBe(false);
    expect(isTapAction({ type: 'set', field: 'side', value: 'L' })).toBe(false);
    expect(isTapAction({ type: 'set', field: 'gapSlip', value: 'yes' })).toBe(false);
    expect(isTapAction({ type: 'fill', values: { timeframeChange: 'none' } })).toBe(false);
    expect(isTapAction({ type: 'reset' })).toBe(false);
  });
});
