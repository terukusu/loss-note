// 満期の損益・最大損失・1R の (3)・「最大損失まで」・向き（設計書 5.7 の 5・C47・C49・C50・#114）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import { expirySlopes, maxLossPrice, sameContractMonth, sideFromExpiry } from '../../core/expiry';
import {
  isMaxLossPlan,
  optionExpiryPnlYen,
  optionMaxLoss,
  optionOneR,
  optionSide,
  optionSideMismatch,
} from '../../core/option';
import type { Leg, TradeInput } from '../../core/trade';
import { validateTrade } from '../../core/validate';
import { leg, MULT, position } from './helpers/option-builder';
import { without } from './helpers/trade-builder';

function ok(ev: ReturnType<typeof evaluateTrade>) {
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev.issues)}`);
  return ev;
}

const kinds = (ev: ReturnType<typeof ok>) => (ev.judgment?.reasons ?? []).map((r) => r.kind);

const USD = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;

/** 最大損失の例の形（P 38,000 買い 1・P 37,000 売り 1。建てたときの原資産 38,200・向き S・「最大損失まで」） */
function spread(
  buy: [number, number],
  sell: [number, number],
  over: Parameters<typeof position>[2] = {},
  exitOver: Parameters<typeof position>[3] = {},
): TradeInput {
  return without(
    position(
      [leg('P', 38_000, 'buy', 1, ...buy), leg('P', 37_000, 'sell', 1, ...sell)],
      38_600,
      { side: 'S', entries: [{ price: 38_200, quantity: 1 }], riskPlan: 'maxLoss', ...over },
      exitOver,
    ),
    'lc',
  );
}

describe('手計算の例（5.7）', () => {
  // 1R の例 (3): 向き L・建てたときの原資産 38,500・LC 37,800・決済したときの原資産 39,100・限月はすべて 2027-01
  const example3 = position(
    [
      leg('P', 37_000, 'buy', 1, 300, 180),
      leg('P', 36_000, 'sell', 2, 120, 60),
      leg('C', 40_000, 'buy', 1, 80, 150),
    ],
    39_100,
    { lc: 37_800 },
  );

  it('1R が満期の損益から: 原資産 37,800 の満期 −140,000 円 → 1R 140,000 円・1.4%・+0.5R・計画どおりの勝ち', () => {
    expect(optionExpiryPnlYen(example3, 37_800)).toBe(-140_000);
    const ev = ok(evaluateTrade(example3));
    expect(ev.pnlYen).toBe(70_000);
    expect(ev.oneRYen).toBe(140_000);
    expect(ev.oneRSource).toBe('expiry');
    expect(ev.riskPct).toBeCloseTo(1.4, 9);
    expect(ev.r).toBeCloseTo(0.5, 9);
    expect(ev.judgment?.grade).toBe('safeWin');
    expect(kinds(ev)).not.toContain('overRisk');
  });

  it('1R の例 (3) の最大損失は定まらない（プットの売りが 1 枚余り、原資産が下がるほど損が増える）', () => {
    expect(optionMaxLoss(example3)).toEqual({ defined: false, cause: 'unbounded' });
    // 下の端の傾き: 買い 1 枚 − 売り 2 枚 → 原資産 1 上がるごとに +1,000（下がるほど損）
    expect(expirySlopes(example3.option?.legs ?? [], MULT)).toEqual({ low: 1_000, high: 1_000 });
  });

  it('最大損失: (400 − 150) × 1,000 = 250,000 円、向きは S（34,380 で +750,000 円・42,020 で −250,000 円）', () => {
    const t = spread([400, 250], [150, 130], { capitalYen: 20_000_000 });
    expect(optionMaxLoss(t)).toEqual({ defined: true, yen: 250_000 });
    expect(optionExpiryPnlYen(t, 34_380)).toBe(750_000);
    expect(optionExpiryPnlYen(t, 42_020)).toBe(-250_000);
    expect(optionSide(t)).toBe('S');
    expect(isMaxLossPlan(t)).toBe(true);
  });

  it('最大損失の例: 「最大損失まで」で −130,000 円 → 1R 250,000 円（最大損失）・−0.52R・A', () => {
    // 設計書の例の資金 20,000,000 円（1.25%）。10,000,000 円なら 2.5% で過剰リスク（下の「最大損失が資金の 2% を超えれば」）
    const ev = ok(evaluateTrade(spread([400, 250], [150, 130], { capitalYen: 20_000_000 })));
    expect(ev.pnlYen).toBe(-130_000);
    expect(ev.oneRYen).toBe(250_000);
    expect(ev.oneRSource).toBe('maxLoss');
    expect(ev.r).toBeCloseTo(-0.52, 9);
    expect(ev.riskPct).toBeCloseTo(1.25, 9);
    expect(ev.judgment?.grade).toBe('A');
    expect(kinds(ev)).not.toContain('noLc');
    expect(kinds(ev)).not.toContain('heldPastLc');
  });
});

describe('為替（5.7 の 5・C43・C50）', () => {
  // USD 建て（乗数 100）: P 38,000 買い 4.0 → 2.5（−150 USD）・P 37,000 売り 1.5 → 1.3（+20 USD）= −130 USD、最大損失 250 USD
  it('為替が 1 でない口座: 満期の損益・最大損失は価格の通貨 × 為替（150）', () => {
    const t = spread([4.0, 2.5], [1.5, 1.3], { instrument: USD }, { fxRate: 150 });
    expect(optionMaxLoss(t)).toEqual({ defined: true, yen: 37_500 });
    // 原資産 34,380: (3,620 − 4.0) × 100 − (2,620 − 1.5) × 100 = 99,750 USD → 14,962,500 円
    expect(optionExpiryPnlYen(t, 34_380)).toBeCloseTo(14_962_500, 6);
    expect(optionExpiryPnlYen(t, 42_020)).toBeCloseTo(-37_500, 6);
    const ev = ok(evaluateTrade(t));
    expect(ev.oneRYen).toBe(37_500);
    expect(ev.oneRSource).toBe('maxLoss');
    expect(ev.pnlYen).toBeCloseTo(-19_500, 6);
    expect(ev.r).toBeCloseTo(-0.52, 9);
    expect(ev.riskPct).toBeCloseTo(0.375, 9);
    expect(ev.judgment?.grade).toBe('A');
  });

  it('為替が 1 でない口座の (3): 原資産 = LC の満期の損益 × 為替', () => {
    // C 39,000 買い 3.0 → 4.5（+150 USD）、LC 37,500 の満期 −300 USD × 140 = −42,000 円 → 1R 42,000 円
    const t = position(
      [leg('C', 39_000, 'buy', 1, 3.0, 4.5)],
      39_200,
      { instrument: USD },
      {
        fxRate: 140,
      },
    );
    expect(optionOneR(t)).toEqual({ value: 42_000, source: 'expiry' });
  });

  it('為替が空: 満期の損益・最大損失の額は出さないが、最大損失が定まるかは変わらない', () => {
    const withFx = spread([4.0, 2.5], [1.5, 1.3], { instrument: USD }, { fxRate: 150 });
    const noFx = spread([4.0, 2.5], [1.5, 1.3], { instrument: USD });
    expect(optionExpiryPnlYen(noFx, 37_000)).toBeUndefined();
    expect(optionMaxLoss(noFx)).toEqual({ defined: true });
    expect(optionMaxLoss(withFx)?.defined).toBe(true);
    expect(isMaxLossPlan(noFx)).toBe(true);
    expect(maxLossPrice(noFx.option?.legs ?? [], 100)).toEqual({ defined: true, value: 250 });
    // 「最大損失まで」は C にせず、1R・R・リスク（%）だけ出さない（C50）
    const ev = ok(evaluateTrade(noFx));
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.r).toBeUndefined();
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.grade).toBe('A');
    expect(ev.judgment?.outcome).toBe('loss');
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
    expect(kinds(ev)).not.toContain('noLc');
  });

  it('為替が空なら (3) は出ない（見込みがあれば見込み）', () => {
    const t = position([leg('C', 39_000, 'buy', 1, 3.0, 4.5)], 39_200, { instrument: USD });
    expect(optionOneR(t)).toBeUndefined();
    const planned = position([leg('C', 39_000, 'buy', 1, 3.0, 4.5)], 39_200, {
      instrument: USD,
      lcLossPlanYen: 40_000,
    });
    expect(optionOneR(planned)).toEqual({ value: 40_000, source: 'plan' });
  });

  it('定まらない組み合わせは為替があっても無くても定まらない', () => {
    const naked = (fx?: number) =>
      position(
        [leg('P', 36_000, 'sell', 1, 1.5, 4.2)],
        37_300,
        { instrument: USD },
        fx === undefined ? {} : { fxRate: fx },
      );
    expect(optionMaxLoss(naked())).toEqual({ defined: false, cause: 'unbounded' });
    expect(optionMaxLoss(naked(150))).toEqual({ defined: false, cause: 'unbounded' });
  });
});

describe('最大損失が定まるか（C50）', () => {
  const legsOf = (t: TradeInput): readonly Leg[] => t.option?.legs ?? [];
  const at = (legs: Leg[]) => position(legs, 38_500);

  it('裸のプットの売り・裸のコールの売りは定まらない（売りの裸）', () => {
    expect(maxLossPrice(legsOf(at([leg('P', 37_000, 'sell', 1, 150, 150)])), MULT)).toEqual({
      defined: false,
      cause: 'unbounded',
    });
    expect(maxLossPrice(legsOf(at([leg('C', 40_000, 'sell', 1, 150, 150)])), MULT)).toEqual({
      defined: false,
      cause: 'unbounded',
    });
  });

  it('限月が違えば定まらず、満期の損益も出さない', () => {
    const t = at([
      leg('P', 38_000, 'buy', 1, 400, 400, {}, '2027-01'),
      leg('P', 37_000, 'sell', 1, 150, 150, {}, '2027-02'),
    ]);
    expect(sameContractMonth(legsOf(t))).toBe(false);
    expect(optionMaxLoss(t)).toEqual({ defined: false, cause: 'contractMonths' });
    expect(optionExpiryPnlYen(t, 37_000)).toBeUndefined();
    expect(sideFromExpiry(legsOf(t), MULT, 38_500)).toBeUndefined();
  });

  it('買いだけなら払ったプレミアムが最大損失', () => {
    expect(optionMaxLoss(at([leg('P', 38_000, 'buy', 1, 400, 400)]))).toEqual({
      defined: true,
      yen: 400_000,
    });
    expect(optionMaxLoss(at([leg('C', 39_000, 'buy', 2, 150, 150)]))).toEqual({
      defined: true,
      yen: 300_000,
    });
  });

  it('売りのスプレッド（受け取り）: 幅 − 受け取ったプレミアム', () => {
    // P 37,000 売り 150・P 36,000 買い 50 → (1,000 − 100) × 1,000 = 900,000 円（下の端の傾き 0）
    const t = at([leg('P', 37_000, 'sell', 1, 150, 150), leg('P', 36_000, 'buy', 1, 50, 50)]);
    expect(expirySlopes(legsOf(t), MULT).low).toBe(0);
    expect(optionMaxLoss(t)).toEqual({ defined: true, yen: 900_000 });
  });

  it('最小値が 0 以上なら定まらない（損失が無い）', () => {
    expect(optionMaxLoss(at([leg('C', 39_000, 'buy', 1, 0, 0)]))).toEqual({
      defined: false,
      cause: 'noLoss',
    });
  });

  it('最小値が −1e-9 以内のマイナスは定まらない・それより小さければ定まる', () => {
    const tiny = maxLossPrice(legsOf(at([leg('C', 39_000, 'buy', 1, 1e-13, 0)])), MULT);
    expect(tiny).toEqual({ defined: false, cause: 'noLoss' });
    const small = maxLossPrice(legsOf(at([leg('C', 39_000, 'buy', 1, 1e-11, 0)])), MULT);
    expect(small.defined).toBe(true);
  });

  it('下の端の傾きが負の形（プットの買いの比率が多い）でも、最小は行使価格で取る', () => {
    // P 37,000 買い 2（各 300）・P 38,000 売り 1（800）: 下の端の傾き −1,000（下がるほど得）、
    // 満期の損益 x ≥ 38,000: −600,000 + 800,000 = +200,000、x = 37,000: +200,000 − 1,000,000 = −800,000 → 最大損失 800,000 円
    const t = at([leg('P', 37_000, 'buy', 2, 300, 300), leg('P', 38_000, 'sell', 1, 800, 800)]);
    expect(optionMaxLoss(t)).toEqual({ defined: true, yen: 800_000 });
  });
});

describe('1R の (3) 満期の損益から（C49）', () => {
  it('原資産 = LC の満期の損益が 0 以上なら出さない', () => {
    // 売りのプット 36,000 は LC 37,500 で OTM → +150,000 円
    expect(optionOneR(position([leg('P', 36_000, 'sell', 1, 150, 100)], 39_000))).toBeUndefined();
  });

  it('(2) が出れば (2) が先', () => {
    // C 39,000 買い 400 → 100（−300,000 円）、原資産が LC 37,500 まで逆へ → (2) 300,000 円（(3) なら 400,000 円）
    expect(optionOneR(position([leg('C', 39_000, 'buy', 1, 400, 100)], 37_500))).toEqual({
      value: 300_000,
      source: 'actualMove',
    });
  });

  it('(1) 見込みがあれば (3) より先', () => {
    const t = position([leg('C', 39_000, 'buy', 1, 400, 500)], 39_500, { lcLossPlanYen: 350_000 });
    expect(optionOneR(t)).toEqual({ value: 350_000, source: 'plan' });
  });

  it('LC を広げても、(3) は入る前の LC で出す（C30）', () => {
    const t = position([leg('C', 39_000, 'buy', 1, 400, 500)], 39_500, {
      lcMove: { kind: 'widened', after: 37_000 },
    });
    expect(optionOneR(t)).toEqual({ value: 400_000, source: 'expiry' });
  });

  it('LC が無ければ (3) は出ない', () => {
    const t = without(position([leg('C', 39_000, 'buy', 1, 400, 500)], 39_500), 'lc');
    expect(optionOneR(t)).toBeUndefined();
  });
});

describe('「最大損失まで」（C50）', () => {
  it('定まらない組み合わせの「最大損失まで」は「なし」と同じ: 負けは C（LC を決めずに）、1R は出ない', () => {
    const t = without(
      position([leg('P', 36_000, 'sell', 1, 150, 900)], 36_400, { riskPlan: 'maxLoss' }),
      'lc',
    );
    expect(isMaxLossPlan(t)).toBe(false);
    const ev = ok(evaluateTrade(t));
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.judgment?.grade).toBe('C');
    expect(kinds(ev)).toContain('noLc');
  });

  it('定まらない組み合わせの「最大損失まで」で勝てば危ない勝ち（LC を決めずに）', () => {
    const t = without(
      position([leg('P', 36_000, 'sell', 1, 150, 40)], 38_900, { riskPlan: 'maxLoss' }),
      'lc',
    );
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(kinds(ev)).toContain('noLc');
  });

  it('「LC を入る前に決めていたか = 決めていなかった」は「最大損失まで」でも C', () => {
    const ev = ok(
      evaluateTrade(
        spread([400, 250], [150, 130], { capitalYen: 20_000_000, lcDecidedBeforeEntry: false }),
      ),
    );
    expect(ev.judgment?.grade).toBe('C');
    expect(kinds(ev)).toContain('noLc');
  });

  it('「最大損失まで」で勝てば、1R = 最大損失で R を出し、計画どおりの勝ち', () => {
    const ev = ok(evaluateTrade(spread([400, 600], [150, 100], { capitalYen: 20_000_000 })));
    expect(ev.pnlYen).toBe(250_000);
    expect(ev.r).toBeCloseTo(1, 9);
    expect(ev.judgment?.grade).toBe('safeWin');
  });

  it('最大損失が資金の 2% を超えれば過剰リスク（資金 10,000,000 円で 2.5%）', () => {
    const ev = ok(evaluateTrade(spread([400, 250], [150, 130])));
    expect(ev.riskPct).toBeCloseTo(2.5, 9);
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toContain('overRisk');
  });

  it('LC の価格・見込みと同時は検査で落とす（4.7）', () => {
    const base = spread([400, 250], [150, 130]);
    expect(validateTrade(base)).toEqual([]);
    expect(validateTrade({ ...base, lc: 38_700 })).toContainEqual({
      kind: 'legs',
      problem: 'riskPlan',
    });
    const o = base.option;
    if (o === undefined) throw new Error('ポジションでない');
    expect(validateTrade({ ...base, option: { ...o, lcLossPlanYen: 100_000 } })).toContainEqual({
      kind: 'legs',
      problem: 'riskPlan',
    });
  });
});

describe('向き（C47）', () => {
  it('LC が無い・「最大損失まで」なら満期の損益の比べ方', () => {
    const bull = without(
      position([leg('C', 39_000, 'buy', 1, 200, 300), leg('C', 40_000, 'sell', 1, 50, 50)], 39_000),
      'lc',
    );
    expect(optionSide(bull)).toBe('L');
    expect(optionSide(spread([400, 250], [150, 130]))).toBe('S');
  });

  it('LC があり「最大損失まで」でなければ LC の側', () => {
    expect(optionSide(position([leg('P', 38_000, 'buy', 1, 400, 300)], 38_000))).toBe('L');
  });

  it('比べて同じ・限月が違えば決まらない（本人が選ぶ）', () => {
    // 同じ行使価格・同じ建値のプットとコールの買い（±10% で同じ損益）
    const straddle = without(
      position(
        [leg('P', 38_500, 'buy', 1, 500, 500), leg('C', 38_500, 'buy', 1, 500, 500)],
        38_500,
      ),
      'lc',
    );
    expect(optionSide(straddle)).toBeUndefined();
    const months = without(
      position(
        [
          leg('C', 39_000, 'buy', 1, 200, 300, {}, '2027-01'),
          leg('C', 40_000, 'sell', 1, 50, 50, {}, '2027-02'),
        ],
        39_000,
      ),
      'lc',
    );
    expect(optionSide(months)).toBeUndefined();
  });

  it('LC から決めた向きと満期の損益の比べ方が食い違えば警告の印（建てたときの原資産の打ち間違いなど）', () => {
    // LC 37,500 は建てたときの原資産 38,500 より下（L）なのに、プットの買いのスプレッドは下がるほど得（S）
    const t = position(
      [leg('P', 38_000, 'buy', 1, 400, 300), leg('P', 37_000, 'sell', 1, 150, 100)],
      38_000,
    );
    expect(optionSideMismatch(t)).toBe(true);
    // 合っていれば出さない・LC が無ければ出さない・比べられなければ出さない
    const bull = position(
      [leg('C', 39_000, 'buy', 1, 200, 300), leg('C', 40_000, 'sell', 1, 50, 50)],
      39_000,
    );
    expect(optionSideMismatch(bull)).toBe(false);
    expect(optionSideMismatch(without(t, 'lc'))).toBe(false);
  });
});
