// オプションのポジションの計算と判定（設計書 4.7・5.7・C47〜C49・C54）。値はすべて架空
import { describe, expect, it } from 'vitest';
import { evaluateTrade } from '../../core/evaluate';
import {
  optionOneR,
  optionSideFromLc,
  positionExitOrderType,
  positionExitPoint,
  positionNetYen,
  positionPnlPriceCurrency,
  positionPnlYen,
} from '../../core/option';
import { oneRYen, pnlYen, rMultiple, statementFxRate } from '../../core/pnl';
import { reviewSizing } from '../../core/sizing';
import type { Leg } from '../../core/trade';
import { validateTrade } from '../../core/validate';
import { expiredLeg, leg, position } from './helpers/option-builder';
import { without } from './helpers/trade-builder';

const T1 = 1_800_000_000_000;
const T2 = T1 + 86_400_000;
const SQ = T2 + 86_400_000;

function ok(ev: ReturnType<typeof evaluateTrade>) {
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev.issues)}`);
  return ev;
}

describe('手計算の例（5.7）', () => {
  it('1R が実際の動きから: 1R 225,000 円・リスク 2.25%・−1.2R・B（持ち続けた・過剰リスク）', () => {
    // P 36,000 売り 1、150 → 420、原資産 38,500 → 37,300、LC 37,500
    const t = position([leg('P', 36_000, 'sell', 1, 150, 420)], 37_300);
    const ev = ok(evaluateTrade(t));
    expect(ev.pnlYen).toBe(-270_000);
    expect(ev.oneRYen).toBeCloseTo(225_000, 6);
    expect(ev.oneRSource).toBe('actualMove');
    expect(ev.riskPct).toBeCloseTo(2.25, 9);
    expect(ev.r).toBeCloseTo(-1.2, 9);
    expect(ev.judgment?.grade).toBe('B');
    const kinds = ev.judgment?.reasons.map((r) => r.kind);
    expect(kinds).toContain('heldPastLc');
    expect(kinds).toContain('overRisk');
    expect(ev.judgment?.reasons.find((r) => r.kind === 'heldPastLc')).toMatchObject({
      underlying: 37_300,
    });
  });

  it('(2) の守り: 逆へ 10（幅の半分未満）は 1R を出さず、過剰リスクにしない → A', () => {
    // 限月がそろわない（(3) も出ない）。IV の低下で −100,000 円
    const t = position(
      [
        leg('C', 39_000, 'buy', 1, 200, 150, {}, '2027-01'),
        leg('P', 37_000, 'sell', 1, 250, 300, {}, '2027-02'),
      ],
      38_490,
    );
    const ev = ok(evaluateTrade(t));
    expect(ev.pnlYen).toBe(-100_000);
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.r).toBeUndefined();
    expect(ev.riskPct).toBeUndefined();
    expect(ev.oneRSource).toBeUndefined();
    expect(ev.judgment?.grade).toBe('A');
    const kinds = ev.judgment?.reasons.map((r) => r.kind);
    expect(kinds).not.toContain('overRisk');
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
  });

  it('満期で消えたレッグ: 明細 +120,000 円 + 消えた買い −300,000 円 = −180,000 円（負け）', () => {
    const t = position(
      [
        expiredLeg('P', 37_000, 'buy', 1, 300, 0, SQ),
        leg('P', 36_000, 'sell', 1, 150, 30, { time: T1 }),
      ],
      38_400,
      { statementPnlYen: 120_000 },
    );
    expect(positionPnlYen(t)).toBe(-180_000);
    const ev = ok(evaluateTrade(t));
    expect(ev.pnlYen).toBe(-180_000);
    expect(ev.judgment?.outcome).toBe('loss');
  });
});

describe('ポジションの損益（4.7）', () => {
  const legs = [
    leg('P', 37_000, 'buy', 1, 300, 180),
    leg('P', 36_000, 'sell', 2, 120, 60),
    leg('C', 40_000, 'buy', 1, 80, 150),
  ];

  it('明細の損益が無ければ、すべてのレッグの導出の損益の合計（−120,000 + 120,000 + 70,000）', () => {
    expect(positionPnlYen(position(legs, 39_100))).toBe(70_000);
  });

  it('満期で消えたレッグが無ければ明細の損益をそのまま使う', () => {
    expect(positionPnlYen(position(legs, 39_100, { statementPnlYen: 65_000 }))).toBe(65_000);
  });

  it('ITM で消えたレッグは sign × (決済値 − 建値) で足す', () => {
    // 売りのプット 100 → 本源的価値 200: −100,000 円。明細の損益 +50,000 円
    const t = position(
      [leg('C', 39_000, 'buy', 1, 100, 150), expiredLeg('P', 36_500, 'sell', 1, 100, 200)],
      36_300,
      { statementPnlYen: 50_000 },
    );
    expect(positionPnlYen(t)).toBe(-50_000);
  });

  it('為替を掛けて口座の通貨にする（USD 建て・為替 150）', () => {
    const t = position(
      [leg('P', 36_000, 'sell', 1, 1.5, 1.0)],
      38_600,
      {
        instrument: { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false },
      },
      { fxRate: 150 },
    );
    // (1.5 − 1.0) × 1 × 100 × 150 = 7,500
    expect(positionPnlYen(t)).toBeCloseTo(7_500, 9);
  });

  it('外貨建てで為替が空: 消えたレッグがあれば損益・R を出さず（見込みの 1R は出す）、勝ち負けは価格の通貨の合計の符号', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    const t = position(
      [expiredLeg('P', 37_000, 'buy', 1, 3, 0), leg('P', 36_000, 'sell', 1, 1.5, 0.3)],
      38_400,
      { instrument: usd, statementPnlYen: 18_000, lcLossPlanYen: 50_000 },
    );
    expect(positionPnlYen(t)).toBeUndefined();
    // 価格の通貨: −300 + 120 = −180（USD）
    expect(positionPnlPriceCurrency(t)).toBeCloseTo(-180, 9);
    const ev = ok(evaluateTrade(t));
    expect(ev.pnlYen).toBeUndefined();
    expect(ev.r).toBeUndefined();
    // 見込み（C49 の (1)）は口座の通貨なので為替なしで 1R・リスク（%）に使う
    expect(ev.oneRYen).toBe(50_000);
    expect(ev.oneRSource).toBe('plan');
    expect(ev.riskPct).toBeCloseTo(0.5, 9);
    expect(ev.judgment?.outcome).toBe('loss');
  });

  it('外貨建てで為替が空・見込みが無ければ 1R を出さない（(2) は損益が要る）', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    const t = position(
      [expiredLeg('P', 37_000, 'buy', 1, 3, 0), leg('P', 36_000, 'sell', 1, 1.5, 4.2)],
      37_000,
      {
        instrument: usd,
        statementPnlYen: -27_000,
      },
    );
    const ev = ok(evaluateTrade(t));
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
  });

  it('見込みの 1R が資金の 2% を超えれば、為替が空でも過剰リスク', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    const t = position(
      [expiredLeg('P', 37_000, 'buy', 1, 3, 0), leg('P', 36_000, 'sell', 1, 1.5, 0.3)],
      38_400,
      {
        instrument: usd,
        statementPnlYen: 18_000,
        lcLossPlanYen: 250_000,
      },
    );
    const kinds = ok(evaluateTrade(t)).judgment?.reasons.map((r) => r.kind);
    expect(kinds).toContain('overRisk');
  });

  it('外貨建てで為替が空でも、消えたレッグが無ければ明細の損益を使う', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    const t = position([leg('P', 36_000, 'sell', 1, 1.5, 0.3)], 38_400, {
      instrument: usd,
      statementPnlYen: 18_000,
    });
    expect(positionPnlYen(t)).toBe(18_000);
  });

  it('外貨建てで為替も明細の損益も無ければ損益を出さない', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    expect(
      positionPnlYen(
        position([leg('P', 36_000, 'sell', 1, 1.5, 0.3)], 38_400, { instrument: usd }),
      ),
    ).toBeUndefined();
  });
});

describe('勝ち負けの境（C48）', () => {
  it('手数料を除いた損益（損益 + 手数料）の符号で分ける。原資産が思惑どおりでも負けがある', () => {
    // 明細の損益 −1,000 円（手数料 1,000 円込み）→ 手数料を除いた損益 0 → 勝ちの側
    const zero = position([leg('P', 36_000, 'sell', 1, 150, 150)], 38_800, {
      statementPnlYen: -1_000,
      feesTotalYen: 1_000,
    });
    expect(positionNetYen(zero)).toBe(0);
    expect(ok(evaluateTrade(zero)).judgment?.outcome).toBe('win');
    // 原資産は思惑どおり上がったが損益はマイナス → 負け
    const ivLoss = position([leg('C', 39_000, 'buy', 1, 400, 300)], 38_700);
    expect(ok(evaluateTrade(ivLoss)).judgment?.outcome).toBe('loss');
  });

  it('明細の損益が無ければ、レッグの導出の合計に手数料を足さない（−1,000 円・手数料 1,500 円 → 負け）', () => {
    // P 36,000 売り 1、150 → 151（−1,000 円）。手数料を足すと +500 円の勝ちに化ける
    const t = position([leg('P', 36_000, 'sell', 1, 150, 151)], 38_600, { feesTotalYen: 1_500 });
    expect(positionPnlYen(t)).toBe(-1_000);
    expect(positionNetYen(t)).toBe(-1_000);
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.outcome).toBe('loss');
    expect(ev.judgment?.grade).toBe('A');
  });

  it('レッグを直して明細の損益を空にした後も（手数料は残る）、レッグの合計が手数料を除いた損益', () => {
    // 記録したときは明細の損益 −3,000 円・手数料 1,000 円（手数料を除いた損益 −2,000 円）。
    // レッグを直して明細の損益を空にした（4.7）→ レッグの合計 −2,000 円のまま。手数料 1,000 円を足さない
    const legs = [leg('P', 36_000, 'sell', 1, 150, 152)];
    const before = position(legs, 38_600, { statementPnlYen: -3_000, feesTotalYen: 1_000 });
    const after = position(legs, 38_600, { feesTotalYen: 1_000 });
    expect(positionNetYen(before)).toBe(-2_000);
    expect(positionNetYen(after)).toBe(-2_000);
  });

  it('明細の損益があれば、明細の損益 + 手数料 + 満期で消えたレッグ', () => {
    // 明細 +118,000 円（手数料 2,000 円込み）+ 消えた買い −300,000 円 → −180,000 円
    const t = position(
      [expiredLeg('P', 37_000, 'buy', 1, 300, 0), leg('P', 36_000, 'sell', 1, 150, 30)],
      38_400,
      { statementPnlYen: 118_000, feesTotalYen: 2_000 },
    );
    expect(positionNetYen(t)).toBe(-180_000);
  });
});

describe('1R の順（C49）', () => {
  it('(1) 見込みがあれば見込み。R = 手数料を除いた損益 ÷ 1R', () => {
    const t = position([leg('P', 36_000, 'sell', 1, 150, 420)], 37_300, {
      lcLossPlanYen: 300_000,
      statementPnlYen: -272_000,
      feesTotalYen: 2_000,
    });
    expect(optionOneR(t)).toEqual({ value: 300_000, source: 'plan' });
    expect(rMultiple(t)).toBeCloseTo(-0.9, 9);
  });

  it('(2) は負けで原資産が逆へ幅の半分以上のときだけ。ちょうど半分は出す', () => {
    const half = position([leg('P', 36_000, 'sell', 1, 150, 250)], 38_000);
    expect(optionOneR(half)).toEqual({ value: 200_000, source: 'actualMove' });
    const short = position([leg('P', 36_000, 'sell', 1, 150, 250)], 38_001);
    expect(optionOneR(short)).toBeUndefined();
  });

  it('(2) は勝ちでは出ない・思惑どおりの向きの動きでは出ない', () => {
    expect(optionOneR(position([leg('P', 36_000, 'sell', 1, 150, 100)], 37_300))).toBeUndefined();
    expect(optionOneR(position([leg('C', 39_000, 'buy', 1, 400, 300)], 39_500))).toBeUndefined();
  });

  it('LC が無ければ (2) は出ない', () => {
    const t = without(position([leg('P', 36_000, 'sell', 1, 150, 900)], 36_400), 'lc');
    expect(optionOneR(t)).toBeUndefined();
  });

  it('(2) は広げる前の LC（R の分母。C30）で出す', () => {
    const t = position([leg('P', 37_000, 'sell', 1, 150, 280)], 37_590, {
      lc: 37_800,
      lcMove: { kind: 'widened', after: 37_400 },
    });
    expect(optionOneR(t)?.value).toBeCloseTo(100_000, 6);
  });
});

describe('5.1 の補いの式と明細から逆算した為替を当てない（C49・C43）', () => {
  it('1R が (1)(2) で出なければ、先物 1 枚ぶんの式（|イン − LC| × 1 × 乗数）を出さない', () => {
    // 先物の式なら 1,000 × 1 × 1,000 = 1,000,000 円が出てしまう場面
    const t = position(
      [
        leg('C', 39_000, 'buy', 1, 400, 300, {}, '2027-01'),
        leg('P', 37_000, 'sell', 1, 100, 90, {}, '2027-02'),
      ],
      38_700,
    );
    expect(oneRYen(t)).toBeUndefined();
    expect(ok(evaluateTrade(t)).riskPct).toBeUndefined();
  });

  it('明細から逆算した為替を出さない', () => {
    const usd = { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } as const;
    const t = position([leg('P', 36_000, 'sell', 1, 1.5, 4.2)], 37_300, {
      instrument: usd,
      statementPnlYen: -40_500,
    });
    expect(statementFxRate(t)).toBeUndefined();
    expect(pnlYen(t)).toBe(-40_500);
  });
});

describe('数量の比（C42）', () => {
  it('比だけを出し、提案の数量は出さない', () => {
    // 1R 225,000 円 ÷ 許容額 100,000 円 = 2.25 倍
    const t = position([leg('P', 36_000, 'sell', 1, 150, 420)], 37_300);
    const sz = reviewSizing(t);
    expect(sz?.ratio).toBeCloseTo(2.25, 9);
    expect(sz?.suggestedQuantity).toBeUndefined();
  });
});

describe('決済の時点と注文の種類（C54）', () => {
  const closedSell = leg('P', 37_000, 'sell', 1, 150, 220, { time: T1 });
  const expiredBuy = expiredLeg('P', 36_000, 'buy', 1, 30, 0, SQ);
  const closedBuy = leg('C', 40_000, 'buy', 1, 80, 150, { time: T1 });
  const expiredSell = expiredLeg('P', 36_000, 'sell', 1, 120, 0, SQ);

  it('満期で消えた買いは数えない（売りを決済した時点）', () => {
    expect(positionExitPoint([closedSell, expiredBuy])).toEqual({
      kind: 'closed',
      legId: closedSell.id,
      time: T1,
    });
    expect(positionExitOrderType([closedSell, expiredBuy], 'stop')).toBe('stop');
  });

  it('満期で消えた売りが最後なら SQ で、注文の種類は満期（SQ）', () => {
    expect(positionExitPoint([closedBuy, expiredSell])).toEqual({
      kind: 'expiredSell',
      legId: expiredSell.id,
      time: SQ,
    });
    expect(positionExitOrderType([closedBuy, expiredSell], 'stop')).toBe('expiry');
  });

  it('決済したレッグが SQ より後なら（限月が違う）、その決済の時点に戻る', () => {
    const later = leg('C', 40_000, 'buy', 1, 80, 150, { time: SQ + 86_400_000 }, '2027-02');
    expect(positionExitPoint([expiredSell, later])?.kind).toBe('closed');
    expect(positionExitOrderType([expiredSell, later], 'market')).toBe('market');
    expect(positionExitOrderType([expiredSell, later], undefined)).toBe('unknown');
  });

  it('すべてが満期で消えた買いなら SQ（注文の種類は満期（SQ））', () => {
    const p = positionExitPoint([expiredBuy]);
    expect(p).toEqual({ kind: 'expiredBuy', legId: expiredBuy.id, time: SQ });
    expect(positionExitOrderType([expiredBuy], undefined)).toBe('expiry');
  });

  it('すべてが満期で消えた買いなら、時刻が無く 2 本以上でも満期（SQ）', () => {
    const a = expiredLeg('P', 37_000, 'buy', 1, 300, 0);
    const b = expiredLeg('C', 40_000, 'buy', 1, 80, 0);
    expect(positionExitPoint([a, b])).toBeUndefined();
    expect(positionExitOrderType([a, b], 'market')).toBe('expiry');
  });

  it('判定は入力の注文の種類を信じず、レッグから導き直す（明細の逆指値が残っていても SQ まで残した売りを救わない）', () => {
    const t = position([closedBuy, expiredSell], 37_000, {}, { orderType: 'stop' });
    const ev = ok(evaluateTrade(t));
    const kinds = ev.judgment?.reasons.map((r) => r.kind);
    expect(kinds).toContain('heldPastLc');
    expect(kinds).not.toContain('stopFilled');
  });

  it('判定は時点が自分の決済なのに満期（SQ）と入っていれば明細の値（不明）に戻して読む', () => {
    const t = position(
      [leg('P', 37_000, 'sell', 1, 150, 300)],
      37_500,
      {},
      { orderType: 'expiry' },
    );
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('asPlannedLc');
  });

  it('数えるレッグに時刻の無いものがあり 2 本以上なら時点は決まらず、満期で消えた売りがあれば満期（SQ）', () => {
    const noTime: Leg = leg('C', 40_000, 'buy', 1, 80, 150);
    expect(positionExitPoint([noTime, expiredSell])).toBeUndefined();
    expect(positionExitOrderType([noTime, expiredSell], 'stop')).toBe('expiry');
    const noTime2: Leg = leg('P', 37_000, 'sell', 1, 150, 220);
    expect(positionExitOrderType([noTime, noTime2], 'stop')).toBe('stop');
  });

  it('数えるレッグが 1 本なら時刻が無くてもそのレッグ', () => {
    const only = leg('P', 37_000, 'sell', 1, 150, 220);
    expect(positionExitPoint([only, expiredBuy])).toEqual({ kind: 'closed', legId: only.id });
  });

  it('満期（SQ）は逆指値とみなさない（持ち続けたを救わない）', () => {
    const t = position([closedBuy, expiredSell], 37_000, {}, { orderType: 'expiry' });
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('heldPastLc');
    expect(ev.judgment?.reasons.map((r) => r.kind)).not.toContain('stopFilled');
  });

  it('逆指値で決済した時点なら、原資産が LC を越えていても持ち続けたにしない', () => {
    const t = position([leg('P', 37_000, 'sell', 1, 150, 380)], 37_200, {}, { orderType: 'stop' });
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.grade).toBe('A');
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('stopFilled');
  });
});

describe('持ち続けた（C48）', () => {
  it('1R・損益の符号を見ない（1R が無い勝ちでも、越えていれば危ない勝ち）', () => {
    const t = position(
      [
        leg('P', 35_000, 'sell', 1, 100, 60, {}, '2027-01'),
        leg('C', 41_000, 'sell', 1, 50, 10, {}, '2027-02'),
      ],
      37_499,
    );
    const ev = ok(evaluateTrade(t));
    expect(ev.r).toBeUndefined();
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('heldPastLc');
  });

  it('S のポジションでは LC より上が不利な側', () => {
    const t = position([leg('C', 40_000, 'sell', 1, 150, 300)], 39_600, { side: 'S', lc: 39_500 });
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('heldPastLc');
    const inside = position([leg('C', 40_000, 'sell', 1, 150, 300)], 39_400, {
      side: 'S',
      lc: 39_500,
    });
    expect(ok(evaluateTrade(inside)).judgment?.reasons.map((r) => r.kind)).not.toContain(
      'heldPastLc',
    );
  });

  it('広げて値が無ければ持ち続けたを出さない（C30）', () => {
    const t = position([leg('P', 37_000, 'sell', 1, 150, 600)], 36_800, {
      lcMove: { kind: 'widened' },
    });
    expect(ok(evaluateTrade(t)).judgment?.reasons.map((r) => r.kind)).not.toContain('heldPastLc');
  });

  it('決済の理由が窓・滑りなら救う（注記「窓・滑り」）', () => {
    const t = position([leg('P', 37_000, 'sell', 1, 150, 380)], 37_200, {}, { reason: 'gapSlip' });
    const ev = ok(evaluateTrade(t));
    expect(ev.judgment?.grade).toBe('A');
    expect(ev.judgment?.reasons.map((r) => r.kind)).toContain('gapSlip');
  });
});

describe('向き（C47 の LC の側）', () => {
  it('LC が建てたときの原資産より下なら L・上なら S・同じ / 無いなら決まらない', () => {
    expect(optionSideFromLc(38_500, 37_500)).toBe('L');
    expect(optionSideFromLc(38_500, 39_500)).toBe('S');
    expect(optionSideFromLc(38_500, 38_500)).toBeUndefined();
    expect(optionSideFromLc(38_500, undefined)).toBeUndefined();
    expect(optionSideFromLc(Number.NaN, 37_500)).toBeUndefined();
  });
});

describe('レッグの検査（4.7）', () => {
  const base = position([leg('P', 36_000, 'sell', 1, 150, 420)], 37_300);
  const withLegs = (legs: readonly Leg[]) => {
    const o = base.option;
    if (o === undefined) throw new Error('レッグが無い');
    return { ...base, option: { ...o, legs: legs as [Leg, ...Leg[]] } };
  };
  const one = (over: Partial<Leg>): Leg => ({
    ...leg('P', 36_000, 'sell', 1, 150, 420),
    id: 'l1',
    ...over,
  });

  it('正しいポジションは問題なし', () => {
    expect(validateTrade(base)).toEqual([]);
  });

  it('レッグは 1〜10 本', () => {
    expect(validateTrade(withLegs([]))).toContainEqual({ kind: 'legs', problem: 'count' });
    const eleven = Array.from({ length: 11 }, (_, i) => one({ id: `l${i + 1}` }));
    expect(validateTrade(withLegs(eleven))).toContainEqual({ kind: 'legs', problem: 'count' });
    const ten = Array.from({ length: 10 }, (_, i) => one({ id: `l${i + 1}` }));
    expect(validateTrade(withLegs(ten))).toEqual([]);
  });

  it('ID は一意', () => {
    expect(validateTrade(withLegs([one({}), one({})]))).toContainEqual({
      kind: 'legs',
      problem: 'duplicateId',
    });
  });

  it('エントリーは 1 つ', () => {
    const two = { ...base, entries: [base.entries[0], base.entries[0]] as const };
    expect(validateTrade(two)).toContainEqual({ kind: 'legs', problem: 'entries' });
  });

  it('行使価格・枚数は正、建値・決済値は 0 以上の有限、時刻は有限、見込みは正', () => {
    const cases: Array<[Partial<Leg>, string]> = [
      [{ strike: 0 }, 'legs[0].strike'],
      [{ quantity: -1 }, 'legs[0].quantity'],
      [{ entry: { price: -1 } }, 'legs[0].entry.price'],
      [{ entry: { price: Number.NaN } }, 'legs[0].entry.price'],
      [{ entry: { price: 1, time: Number.POSITIVE_INFINITY } }, 'legs[0].entry.time'],
      [{ exit: { price: -0.5, kind: 'closed' } }, 'legs[0].exit.price'],
      [{ exit: { price: 0, kind: 'expired', time: Number.NaN } }, 'legs[0].exit.time'],
    ];
    for (const [over, field] of cases) {
      expect(validateTrade(withLegs([one(over)])), field).toContainEqual({
        kind: 'invalidNumber',
        field,
      });
    }
    expect(
      validateTrade(withLegs([one({ entry: { price: 0 }, exit: { price: 0, kind: 'expired' } })])),
    ).toEqual([]);
    const badPlan = {
      ...base,
      option: { ...base.option, legs: base.option?.legs ?? [one({})], lcLossPlanYen: 0 },
    };
    expect(validateTrade(badPlan)).toContainEqual({
      kind: 'invalidNumber',
      field: 'option.lcLossPlanYen',
    });
  });

  it('LC の向きは建てたときの原資産で見る（C11）', () => {
    expect(validateTrade({ ...base, lc: 38_600 })).toContainEqual({
      kind: 'lcDirection',
      entryIndex: 0,
    });
  });
});
