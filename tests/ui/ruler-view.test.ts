// LC の物差しの文字の一覧と越えた行（Issue #34 契約 P-2・AC-3）。値はすべて架空
import { describe, expect, it } from 'vitest';
import type { NoLcRuler, Ruler } from '../../core/ruler';
import { formatR } from '../../ui/src/lib/format';
import { summarize } from '../../ui/src/lib/record-form';
import {
  LATE_LC_NAME,
  overArc,
  overshootText,
  rulerItems,
  rulerSegments,
  rulerTicks,
  widenArc,
  widenArrow,
  xOf,
} from '../../ui/src/lib/ruler-view';
import { exitAt, RULER_EXAMPLES } from './helpers/ruler-examples';
import { stored } from './helpers/trade-examples';

function rulerOfStored(id: string): Ruler {
  const t = RULER_EXAMPLES[id];
  if (!t) throw new Error(id);
  const r = summarize(t).ruler;
  if (r?.basis !== 'r') throw new Error(`${id} に R の物差しが出ません`);
  return r;
}

const LC = '決めた LC 99.5（−1.0R）';
const IN = 'イン 100';

const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  E1: [LC, '決済 99.5（−1.0R）', IN],
  E2: ['広げた後の LC 99.2（−1.6R）', '決済 99.2（−1.6R）', LC, IN],
  E3: [
    '広げた後の LC 150.8（−1.6R）',
    '決済 150.8（−1.6R）',
    '決めた LC 150.5（−1.0R）',
    'イン 150',
  ],
  E4: [LC, IN, 'TP 101（+2.0R）', '決済 101（+2.0R）'],
  E5: [LC, IN, 'TP 100.75（+1.5R）', '決済 101（+2.0R）'],
  E6: ['決済 99.2（−1.6R）', LC, IN],
  E7: ['決済 97.5（−5.0R）', LC, IN],
  E8: [LC, '決済 99.7（−0.6R）', IN],
  E9: ['決済 99.2（−1.6R）', LC, IN],
  E10: ['広げた後の LC 99.2（−1.6R）', LC, IN, '決済 100.25（+0.5R）'],
  E11: [LC, IN, '決済 100（±0.0R）'],
  E12: [LC, '決済 99.5（−1.0R）', IN],
  E13: [LC, IN, '決済 101（+2.0R）', 'TP 103（+6.0R）'],
};

const OVER: Readonly<Record<string, string>> = {
  E2: 'LC を 0.6R 超えて決済',
  E3: 'LC を 0.6R 超えて決済',
  E6: 'LC を 0.6R 超えて決済',
  E7: 'LC を 4.0R 超えて決済',
  E9: 'LC を 0.6R 超えて決済',
};

const IDS = Object.keys(EXPECTED);

describe('rulerItems: 文字の一覧 E1〜E13（AC-3）', () => {
  it.each(IDS)('%s', (id) => {
    expect(rulerItems(rulerOfStored(id)).map((i) => i.text)).toEqual(EXPECTED[id]);
  });

  it('範囲の外の印は E7 の決済と E13 の TP だけ', () => {
    const outs = IDS.flatMap((id) =>
      rulerOfStored(id)
        .points.filter((p) => p.outOfRange)
        .map((p) => `${id}:${p.kind}`),
    );
    expect(outs).toEqual(['E7:exit', 'E13:tp']);
  });
});

describe('overshootText: 越えた行（AC-3）', () => {
  it('越えた行は E2・E3・E6・E7・E9 の 5 場面だけ', () => {
    const got = Object.fromEntries(
      IDS.map((id) => [id, overshootText(rulerOfStored(id))] as const).filter(
        ([, v]) => v !== null,
      ),
    );
    expect(got).toEqual(OVER);
  });

  it('決済の R の文字が「−1.0R」になる小さな越え（−1.03R）は「0.1R 未満」', () => {
    // 決済 99.485 → R (99.485 − 100) ÷ 0.5 = −1.03
    const t = stored('r-tiny', { exit: exitAt(99.485) });
    const r = summarize(t).ruler as Ruler;
    expect(formatR(summarize(t).r)).toBe('−1.0R');
    expect(overshootText(r)).toBe('LC を 0.1R 未満超えて決済');
  });

  it('幅は R の文字から作る（−1.65R → R の文字「−1.7R」・越えた「0.7R」）', () => {
    // 決済 99.175 → R (99.175 − 100) ÷ 0.5 = −1.65
    const t = stored('r-165', { exit: exitAt(99.175) });
    expect(formatR(summarize(t).r)).toBe('−1.7R');
    expect(overshootText(summarize(t).ruler as Ruler)).toBe('LC を 0.7R 超えて決済');
  });
});

describe('決済の R の文字は判定の枠の R と同じ（AC-3）', () => {
  it.each(IDS)('%s', (id) => {
    const t = RULER_EXAMPLES[id];
    if (!t) throw new Error(id);
    const s = summarize(t);
    const exit = rulerItems(s.ruler as Ruler).find((i) => i.kind === 'exit');
    expect(exit?.text.endsWith(`（${formatR(s.r)}）`)).toBe(true);
  });

  it('越えた幅 + 1.0 = 決済の R の文字の絶対値', () => {
    for (const id of Object.keys(OVER)) {
      const t = RULER_EXAMPLES[id];
      if (!t) throw new Error(id);
      const s = summarize(t);
      const m = /([\d.]+)R 超えて/.exec(overshootText(s.ruler as Ruler) ?? '');
      expect((Number(m?.[1]) + 1).toFixed(1)).toBe(formatR(s.r).replace(/[−+R]/g, ''));
    }
  });
});

describe('xOf・overArc', () => {
  it('百分率の小数 2 桁、範囲の外・有限でない値は端', () => {
    expect(xOf(0.230769)).toBe('23.08%');
    expect(xOf(0)).toBe('0.00%');
    expect(xOf(1)).toBe('100.00%');
    expect(xOf(-0.5)).toBe('0.00%');
    expect(xOf(2)).toBe('100.00%');
    expect(xOf(Number.NaN)).toBe('0.00%');
  });

  it('越えた区間は決済〜決めた LC（E2）、越えていなければ null（E1）', () => {
    expect(overArc(rulerOfStored('E2'))).toEqual({ from: '0.00%', to: '23.08%' });
    expect(overArc(rulerOfStored('E1'))).toBeNull();
  });
});

describe('widenArc・rulerTicks・入る前に決めていない LC（Phase 4b の指摘 2・3・4）', () => {
  it('広げた区間は広げた後の LC〜決めた LC（E2・E10）、広げた後の LC の点が無ければ null（E1・E9）', () => {
    expect(widenArc(rulerOfStored('E2'))).toEqual({ from: '0.00%', to: '23.08%' });
    expect(widenArc(rulerOfStored('E10'))).toEqual({ from: '0.00%', to: '23.08%' });
    expect(widenArc(rulerOfStored('E1'))).toBeNull();
    expect(widenArc(rulerOfStored('E9'))).toBeNull();
  });

  it('目盛り: E2 は −1R・0・+1R、端の文字は内側へ寄せる', () => {
    // 範囲 −1.6〜+1（幅 2.6）: −1R 0.6/2.6 = 23.08%、0 は 61.54%、+1R は右端
    expect(rulerTicks(rulerOfStored('E2'))).toEqual([
      { key: 'lc', x: '23.08%', label: '−1R', anchor: 'middle' },
      { key: 'entry', x: '61.54%', label: '0', anchor: 'middle' },
      { key: 'one', x: '100.00%', label: '+1R', anchor: 'end' },
    ]);
    expect(rulerTicks(rulerOfStored('E1'))[0]).toEqual({
      key: 'lc',
      x: '0.00%',
      label: '−1R',
      anchor: 'start',
    });
  });

  it('目盛り: TP があれば「TP」、+1R と近ければ +1R を出さない（E4 は +1R 66.67%・TP 100%、E5 は TP 83.33% で近くない）', () => {
    expect(rulerTicks(rulerOfStored('E4')).map((t) => `${t.label}@${t.x}`)).toEqual([
      '−1R@0.00%',
      '0@33.33%',
      '+1R@66.67%',
      'TP@100.00%',
    ]);
    // TP 1.05R（100.525）: +1R 66.67% と TP 68.33% は近いので +1R を出さない
    const t = stored('r-tp', { tp: 100.525, exit: exitAt(101) });
    expect(rulerTicks(summarize(t).ruler as Ruler).map((x) => x.label)).toEqual(['−1R', '0', 'TP']);
  });

  it('LC を入る前に決めていない取引は「後から決めた LC」と「−1R（後から）」（位置・R は同じ）', () => {
    const t = stored('r-late', { lcDecidedBeforeEntry: false, exit: exitAt(100.75) });
    const r = summarize(t).ruler as Ruler;
    expect(r.lcDecidedBeforeEntry).toBe(false);
    expect(rulerItems(r).map((i) => i.text)).toEqual([
      `${LATE_LC_NAME} 99.5（−1.0R）`,
      'イン 100',
      '決済 100.75（+1.5R）',
    ]);
    expect(rulerTicks(r)[0]?.label).toBe('−1R（後から）');
  });

  it('一覧の項目は名前・価格・R の文字に分かれ、text はそれをつないだ文', () => {
    for (const i of rulerItems(rulerOfStored('E2'))) {
      expect(i.text).toBe(`${i.name} ${i.price}${i.rText === null ? '' : `（${i.rText}）`}`);
    }
  });
});

// ---- #231（設計書 C66）: 区間・矢印・計画の上限の名前・LC なしの図の文字 ----

describe('rulerSegments・widenArrow（#231）', () => {
  it('E2: 計画の帯（決めた LC〜イン）・実行の線・広げた区間と越えた区間は崩れの区間', () => {
    const r = rulerOfStored('E2');
    expect(rulerSegments(r)).toEqual([
      { kind: 'plan', from: '23.08%', to: '61.54%', breach: false },
      { kind: 'exec', from: '0.00%', to: '61.54%', breach: false },
      { kind: 'widen', from: '0.00%', to: '23.08%', breach: true },
      { kind: 'over', from: '0.00%', to: '23.08%', breach: true },
    ]);
    expect(widenArrow(r)).toEqual({ x: '0.00%', dir: 'left' });
  });

  it('E1: 計画の帯と実行の線だけ・矢印なし', () => {
    const r = rulerOfStored('E1');
    expect(rulerSegments(r).map((g) => g.kind)).toEqual(['plan', 'exec']);
    expect(widenArrow(r)).toBeNull();
  });

  it('決済 = イン（E11）は実行の線を描かない（長さ 0）', () => {
    expect(rulerSegments(rulerOfStored('E11')).map((g) => g.kind)).toEqual(['plan']);
  });

  it('LC なしの図: イン〜決済だけ（崩れの区間）・矢印なし・目盛りは「LC なし」だけ・一覧は名前と価格', () => {
    const r: NoLcRuler = {
      basis: 'price',
      points: [
        { kind: 'noLc', pos: 0 },
        { kind: 'exit', price: 98.75, pos: 0.1 },
        { kind: 'entry', price: 100, pos: 0.5 },
        { kind: 'tp', price: 101.5, pos: 0.9 },
      ],
    };
    expect(rulerSegments(r)).toEqual([
      { kind: 'free', from: '10.00%', to: '50.00%', breach: true },
    ]);
    expect(widenArrow(r)).toBeNull();
    expect(rulerTicks(r)).toEqual([{ key: 'noLc', x: '0.00%', label: 'LC なし', anchor: 'start' }]);
    expect(rulerItems(r).map((i) => i.text)).toEqual([
      'LC なし',
      '決済 98.75',
      'イン 100',
      'TP 101.5',
    ]);
    expect(overshootText(r)).toBeNull();
  });
});

describe('計画の上限の名前（LC の価格の無いオプションのポジション。#231）', () => {
  const bound = (b: 'maxLoss' | 'lossPlan', decided: boolean): Ruler => ({
    basis: 'r',
    bound: b,
    lo: -1,
    hi: 1,
    lcDecidedBeforeEntry: decided,
    points: [
      { kind: 'plannedLc', r: -1, pos: 0, outOfRange: false },
      { kind: 'entry', price: 38_500, r: 0, pos: 0.5, outOfRange: false },
      { kind: 'exit', price: 38_200, r: -0.4, pos: 0.3, outOfRange: false },
    ],
  });

  it('最大損失: 価格なしの「最大損失（−1.0R）」・目盛りは −1R', () => {
    const r = bound('maxLoss', true);
    expect(rulerItems(r)[0]?.text).toBe('最大損失（−1.0R）');
    expect(rulerItems(r)[0]?.price).toBeNull();
    expect(rulerTicks(r).find((t) => t.key === 'lc')?.label).toBe('−1R');
  });

  it('LC での損失の見込み（入る前に決めていない）: 名前は見込み・目盛りに「後から」を付けない・計画の帯なし', () => {
    const r = bound('lossPlan', false);
    expect(rulerItems(r)[0]?.text).toBe('LC での損失の見込み（−1.0R）');
    expect(rulerTicks(r).find((t) => t.key === 'lc')?.label).toBe('−1R');
    expect(rulerSegments(r).map((g) => g.kind)).toEqual(['exec']);
  });
});
