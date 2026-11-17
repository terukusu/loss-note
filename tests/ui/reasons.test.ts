// 理由の文言（Issue #13 AC-4・契約 R-2。設計書 5.3 の表示の言葉）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { REASON_ORDER, type Reason, type ReasonKind } from '../../core/judge';
import { reasonText } from '../../ui/src/lib/reasons';

const MINUS = '−';

/** 理由の種類ごとの例（種類が増えたら、この表に足さないと下のテストが落ちる） */
const TABLE: ReadonlyArray<readonly [ReasonKind, Reason, 'L' | 'S', string]> = [
  ['noLc', { kind: 'noLc' }, 'L', 'LC を決めずに入った'],
  ['lcWidened', { kind: 'lcWidened', from: 99.5, to: 99.2 }, 'L', 'LC を下げた（99.5 → 99.2）'],
  ['timeframeLonger', { kind: 'timeframeLonger', source: 'tap' }, 'L', '時間足を変えた'],
  ['heldPastLc', { kind: 'heldPastLc', r: -1.2 }, 'L', `LC で切らずに持ち続けた（${MINUS}1.2R）`],
  ['overRisk', { kind: 'overRisk', riskPct: 2.5 }, 'L', '過剰リスク（2.5%）'],
  ['amountBasedLc', { kind: 'amountBasedLc' }, 'L', '金額ありきの LC'],
  ['averagingDown', { kind: 'averagingDown', entryIndex: 1 }, 'L', 'ナンピン'],
  ['asPlannedLc', { kind: 'asPlannedLc' }, 'L', '決めた LC で切れた'],
  ['stopFilled', { kind: 'stopFilled' }, 'L', '逆指値で切れた（証拠あり）'],
  ['gapSlip', { kind: 'gapSlip' }, 'L', '窓・滑り'],
  ['earlyExit', { kind: 'earlyExit' }, 'L', '早逃げ'],
  [
    'riskNotChecked',
    { kind: 'riskNotChecked', cause: 'noCapital' },
    'L',
    '資金が未設定なので過剰リスクは見ていない',
  ],
];

describe('reasonText（AC-4）', () => {
  it('理由の種類をすべて網羅している（core の REASON_ORDER と表の種類が同じ）', () => {
    expect([...new Set(TABLE.map((r) => r[0]))].sort()).toEqual([...REASON_ORDER].sort());
  });

  it.each(TABLE)('%s → 表示の言葉', (_kind, reason, side, want) => {
    expect(reasonText(reason, side)).toBe(want);
  });

  it('S の取引では LC を不利な側へ動かしたことを「上げた」と言う', () => {
    expect(reasonText({ kind: 'lcWidened', from: 150.5, to: 151 }, 'S')).toBe(
      'LC を上げた（150.5 → 151）',
    );
  });

  it('下げた後の値が無ければ括弧を付けない（L / S）', () => {
    expect(reasonText({ kind: 'lcWidened', from: 99.5 }, 'L')).toBe('LC を下げた');
    expect(reasonText({ kind: 'lcWidened', from: 150.5 }, 'S')).toBe('LC を上げた');
    expect(reasonText({ kind: 'lcWidened' }, 'L')).toBe('LC を下げた');
  });

  it('1R が出ないときの注記', () => {
    expect(reasonText({ kind: 'riskNotChecked', cause: 'noOneR' }, 'L')).toBe(
      '1R が出ないので過剰リスクは見ていない',
    );
  });

  it('時間足: チャートの足が両方あれば「（4 時間足 → 日足・チャートから）」、片方だけなら括弧なし（Issue #12 AC-4）', () => {
    expect(
      reasonText({ kind: 'timeframeLonger', source: 'chart', from: '4h', to: '1d' }, 'L'),
    ).toBe('時間足を変えた（4 時間足 → 日足・チャートから）');
    expect(reasonText({ kind: 'timeframeLonger', source: 'tap', from: '1h' }, 'L')).toBe(
      '時間足を変えた',
    );
    expect(
      reasonText({ kind: 'timeframeLonger', source: 'chart', from: '1w', to: '1M' }, 'S'),
    ).toBe('時間足を変えた（週足 → 月足・チャートから）');
  });

  it('過剰リスクの % は小数 1 桁へ切り上げ（2.01 → 2.1%）', () => {
    expect(reasonText({ kind: 'overRisk', riskPct: 2.01 }, 'L')).toBe('過剰リスク（2.1%）');
  });
});
