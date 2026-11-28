// 両建てのまとまりの計算と判定（設計書 5.8・C76〜C80。#265）の手計算の例・境・崩れたまとまり・振り返りの項目・性質。
// 値はすべて架空。既定は helpers/group-builder（本玉 = XYZ 先物 L 1 枚・量 1,000・イン 38,000・LC 37,700、
// 決済の代わり = XYZ CFD S 100・乗数 10・量 1,000）
import { describe, expect, it } from 'vitest';
import {
  evaluatePositionGroup,
  type GroupEvaluation,
  type GroupMember,
  groupProblems,
  groupReviewItem,
  type PositionGroupInput,
  UNFIX_GAP_MS,
} from '../../core/position-group';
import { ENTRY, FIX, hedge, MIN, MON, main, member, tradeOf } from './helpers/group-builder';
import { forAll } from './helpers/prng';

type Ok = Extract<GroupEvaluation, { ok: true }>;

function ok(group: PositionGroupInput): Ok {
  const ev = evaluatePositionGroup(group);
  if (!ev.ok) throw new Error(`受け付けられなかった: ${JSON.stringify(ev)}`);
  return ev;
}

const kinds = (ev: Ok) => (ev.judgment?.reasons ?? []).map((r) => r.kind);

describe('固定の時点と価格（C77・5.8 の 1）', () => {
  it('2 回に分けた固定: 時点は揃った 2 回目、価格は (38,300 × 600 + 38,200 × 400) ÷ 1,000 = 38,260', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_400 }),
        hedge({ price: 38_300, quantity: 60, exitPrice: 38_420 }, 'h1'),
        hedge({ price: 38_200, quantity: 40, entryTime: FIX + 180 * MIN, exitPrice: 38_420 }, 'h2'),
      ],
    });
    expect(ev.fix?.time).toBe(FIX + 180 * MIN);
    expect(ev.fix?.price).toBeCloseTo(38_260, 9);
    expect(ev.fix?.full).toBe(true);
    expect(ev.exitTime).toBe(FIX + 180 * MIN);
    expect(ev.parts).toHaveLength(1);
  });

  it('時刻の順に足す: 記録の並びが逆でも、先に建てた分から数える', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_400 }),
        hedge({ price: 38_200, quantity: 40, entryTime: FIX + 180 * MIN, exitPrice: 38_420 }, 'h2'),
        hedge({ price: 38_300, quantity: 60, exitPrice: 38_420 }, 'h1'),
      ],
    });
    expect(ev.fix?.price).toBeCloseTo(38_260, 9);
  });

  it('最後のエントリーは Q に揃う分だけ数え、超えた量は注記に出して判定・R に使わない', () => {
    // 60 @ 38,300 → 量 600、次の 100 @ 38,100 → 量 1,000 のうち 400 だけ数える。超えた量 = 600 + 1,000 − 1,000 = 600
    const ev = ok({
      members: [
        main({ exitPrice: 38_400 }),
        hedge({ price: 38_300, quantity: 60, exitPrice: 38_420 }, 'h1'),
        hedge({ price: 38_100, quantity: 100, entryTime: FIX + MIN, exitPrice: 38_420 }, 'h2'),
      ],
    });
    // (38,300 × 600 + 38,100 × 400) ÷ 1,000 = 38,220
    expect(ev.fix?.price).toBeCloseTo(38_220, 9);
    expect(ev.r).toBeCloseTo(220 / 300, 9);
    expect(ev.notes).toEqual([{ kind: 'overHedged', excess: 600 }]);
  });

  it('決済の代わりが量 500 多い: R は揃った量だけのときと同じで、注記の量は 500', () => {
    const base = ok({
      members: [main({ exitPrice: 38_600 }), hedge({ price: 38_450, exitPrice: 38_620 })],
    });
    const over = ok({
      members: [
        main({ exitPrice: 38_600 }),
        hedge({ price: 38_450, quantity: 150, exitPrice: 38_620 }),
      ],
    });
    expect(over.r).toBeCloseTo(base.r ?? Number.NaN, 9);
    expect(over.notes).toEqual([{ kind: 'overHedged', excess: 500 }]);
    expect(base.notes).toEqual([]);
  });

  it('量の比の誤差 1e-9 の内なら揃ったとみなし、注記を出さない', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_600 }),
        hedge({ price: 38_450, quantity: 100 * (1 + 1e-12), exitPrice: 38_620 }),
      ],
    });
    expect(ev.fix?.full).toBe(true);
    expect(ev.notes).toEqual([]);
  });

  it('まとまりの exit.price があれば固定の価格にそれを使う（建値の平均は derivedPrice に残す）', () => {
    const ev = ok({
      members: [main({ exitPrice: 38_600 }), hedge({ price: 38_450, exitPrice: 38_620 })],
      exit: { price: 38_480 },
    });
    expect(ev.fix?.price).toBe(38_480);
    expect(ev.fix?.derivedPrice).toBe(38_450);
    expect(ev.exitPrice).toBe(38_480);
    expect(ev.r).toBeCloseTo(480 / 300, 9);
  });

  it('時刻の無いエントリーがあれば、記録の並びで数え、固定の時点を出さず、決済の時刻は本玉の決済', () => {
    const h = tradeOf('h1', {
      side: 'S',
      multiplier: 10,
      entries: [{ price: 38_450, quantity: 100 }],
      lc: null,
      exitPrice: 38_620,
      exitTime: MON + 5 * MIN,
      accountId: 'B',
    });
    const ev = ok({
      members: [main({ exitPrice: 38_600 }), { tradeId: 'h1', role: 'hedge', trade: h }],
    });
    expect(ev.fix?.time).toBeUndefined();
    expect(ev.fix?.price).toBe(38_450);
    expect(ev.exitTime).toBe(MON);
  });
});

describe('一部だけの固定（5.8 の 2）', () => {
  it('H4: 部分 500 @ 37,690 と 500 @ 37,400 → P = 37,545、R = −1.5166…、決済の時刻は先物の決済', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 37_400, orderType: 'market', gapSlip: 'no' }),
        hedge({ price: 37_690, quantity: 50, exitPrice: 37_420 }),
      ],
    });
    expect(ev.parts.map((p) => [p.kind, p.quantity, p.price])).toEqual([
      ['fix', 500, 37_690],
      ['rest', 500, 37_400],
    ]);
    expect(ev.exitPrice).toBeCloseTo(37_545, 9);
    expect(ev.r).toBeCloseTo(-455 / 300, 9);
    expect(ev.exitTime).toBe(MON);
    expect(ev.fix?.full).toBe(false);
    // 損益 = (37,400 − 38,000) × 1,000 + (37,690 − 37,420) × 50 × 10 = −600,000 + 135,000 = −465,000 円
    expect(ev.pnl).toEqual([{ currency: 'JPY', amount: -465_000 }]);
  });

  it('本玉 2 件の残りは量の割合で分け、決済の時刻は遅いほうの本玉の決済', () => {
    // 量 1,000（38,000）+ 量 500（38,100）= 1,500、固定 750 @ 38,200。残り 750 = 500 @ 38,300（MON）+ 250 @ 38,350（MON + 30 分）
    const ev = ok({
      members: [
        main({ exitPrice: 38_300 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 38_100,
            lc: 37_800,
            exitPrice: 38_350,
            exitTime: MON + 30 * MIN,
          },
          'm2',
        ),
        hedge({ price: 38_200, quantity: 75, exitPrice: 38_320 }),
      ],
    });
    expect(ev.parts.map((p) => [p.kind, p.quantity, p.price, p.time])).toEqual([
      ['fix', 750, 38_200, FIX],
      ['rest', 500, 38_300, MON],
      ['rest', 250, 38_350, MON + 30 * MIN],
    ]);
    // P = (750 × 38,200 + 500 × 38,300 + 250 × 38,350) ÷ 1,500 = 38,258.333…
    const p = (750 * 38_200 + 500 * 38_300 + 250 * 38_350) / 1_500;
    expect(ev.exitPrice).toBeCloseTo(p, 9);
    // R = ((P − 38,000) × 1,000 + (P − 38,100) × 500) ÷ (300 × 1,000 + 300 × 500)
    expect(ev.r).toBeCloseTo(((p - 38_000) * 1_000 + (p - 38_100) * 500) / 450_000, 9);
    expect(ev.exitTime).toBe(MON + 30 * MIN);
  });
});

describe('固定を外した・本玉の決済の後に建てた（5.8 の 3）', () => {
  const at = (gap: number) =>
    ok({
      members: [
        main({ exitPrice: 37_600, orderType: 'market' }),
        hedge({ price: 38_450, exitPrice: 38_300, exitTime: MON - gap }),
      ],
    });

  it('最初の本玉の決済のちょうど 30 分前に外した決済の代わりは固定に数える', () => {
    const ev = at(UNFIX_GAP_MS);
    expect(ev.notes).toEqual([]);
    expect(ev.exitPrice).toBe(38_450);
  });

  it('30 分 + 1 ms 前なら固定に数えず、注記に取引と時刻。まとまりの決済は本玉の決済で、損益には入る', () => {
    const ev = at(UNFIX_GAP_MS + 1);
    expect(ev.notes).toEqual([{ kind: 'unfixed', tradeId: 'h1', time: MON - UNFIX_GAP_MS - 1 }]);
    expect(ev.fix).toBeUndefined();
    expect(ev.parts.map((p) => [p.kind, p.price, p.orderType])).toEqual([
      ['rest', 37_600, 'market'],
    ]);
    // −400,000 + (38,450 − 38,300) × 1,000 = −250,000 円
    expect(ev.pnl).toEqual([{ currency: 'JPY', amount: -250_000 }]);
  });

  it('本玉の決済より後に建てた決済の代わりは固定に数えない（損益には入る）', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 37_600, orderType: 'market' }),
        hedge({ price: 37_550, entryTime: MON + MIN, exitPrice: 37_500, exitTime: MON + 60 * MIN }),
      ],
    });
    expect(ev.fix).toBeUndefined();
    expect(ev.exitPrice).toBe(37_600);
    expect(ev.pnl).toEqual([{ currency: 'JPY', amount: -400_000 + 50_000 }]);
  });
});

describe('判定（C78）', () => {
  it('決済の代わりの部分の注文の種類はまとまりの上書き: 無ければ不明で救わず、逆指値なら救う', () => {
    // 固定 37,600（越えた幅 100 = 0.33R・R = −1.33）
    const members = [main({ exitPrice: 37_400 }), hedge({ price: 37_600, exitPrice: 37_420 })];
    const none = ok({ members });
    expect(none.parts[0]?.orderType).toBe('unknown');
    expect(none.judgment?.grade).toBe('B');
    expect(kinds(none)).toContain('heldPastLc');
    const stop = ok({ members, exit: { orderType: 'stop' } });
    expect(stop.judgment?.grade).toBe('A');
    expect(kinds(stop)).toContain('stopFilled');
    // 決済の代わりの取引の明細の注文の種類（外したときの逆指値）は固定の証拠にしない
    const hedgeStop = ok({
      members: [
        main({ exitPrice: 37_400 }),
        hedge({ price: 37_600, exitPrice: 37_420, orderType: 'stop' }),
      ],
    });
    expect(hedgeStop.judgment?.grade).toBe('B');
  });

  it('決済の理由はまとまりの上書き、無ければ最初の本玉の決済の理由（窓・滑りで救う）', () => {
    const members = [
      main({ exitPrice: 37_400, reason: 'gapSlip' }),
      hedge({ price: 37_600, exitPrice: 37_420 }),
    ];
    const fromMain = ok({ members });
    expect(fromMain.judgment?.grade).toBe('A');
    expect(kinds(fromMain)).toContain('gapSlip');
    const overridden = ok({ members, exit: { reason: 'other' } });
    expect(overridden.judgment?.grade).toBe('B');
  });

  it('メンバー単独なら C の決済の代わり（LC なし）も、まとまりでは C にしない', () => {
    const ev = ok({
      members: [main({ exitPrice: 37_750 }), hedge({ price: 37_750, exitPrice: 37_700 })],
    });
    expect(ev.judgment?.grade).toBe('A');
    expect(kinds(ev)).not.toContain('noLc');
  });

  it('本玉が複数なら答えは崩れの側: 1 件でも取り消した・広げたなら、まとまりもその理由（広げたの値は広げた本玉）', () => {
    const ev = ok({
      members: [
        main({ lcMove: { kind: 'cancelled' }, exitPrice: 38_400 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 38_100,
            lc: 37_800,
            lcMove: { kind: 'widened', after: 37_600 },
            exitPrice: 38_400,
          },
          'm2',
        ),
        hedge({ price: 38_300, quantity: 150, exitPrice: 38_420 }),
      ],
    });
    expect(ev.judgment?.grade).toBe('riskyWin');
    expect(
      ev.judgment?.reasons.filter((r) => r.kind === 'lcCancelled' || r.kind === 'lcWidened'),
    ).toEqual([{ kind: 'lcCancelled' }, { kind: 'lcWidened', from: 37_800, to: 37_600 }]);
  });

  it('本玉の 1 件が LC を決めていなければ C（R・1R を出さない）', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 37_400 }),
        main({ multiplier: 100, quantity: 5, lc: null, exitPrice: 37_400 }, 'm2'),
        hedge({ price: 37_600, quantity: 150, exitPrice: 37_420 }),
      ],
    });
    expect(ev.judgment?.grade).toBe('C');
    expect(ev.r).toBeUndefined();
    expect(ev.oneRYen).toBeUndefined();
  });

  it('本玉が複数: 含み損で足した本玉はナンピン、持ち続けたの比較先は時刻の最後のエントリーの LC', () => {
    // 量 1,000 @ 38,000（LC 37,700）+ 量 500 @ 37,900（後で足した・LC 37,700）。固定 37,650
    // 比較先 = 37,700、越えた幅 50 > 0.1R（幅 200 の 10% = 20）。R = (−350 × 1,000 − 250 × 500) ÷ (300 × 1,000 + 200 × 500) = −1.1875
    const ev = ok({
      members: [
        main({ exitPrice: 37_400 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 37_900,
            entryTime: ENTRY + MIN,
            exitPrice: 37_400,
          },
          'm2',
        ),
        hedge({ price: 37_650, quantity: 150, exitPrice: 37_420 }),
      ],
    });
    expect(ev.r).toBeCloseTo(-475_000 / 400_000, 9);
    expect(kinds(ev)).toEqual(expect.arrayContaining(['heldPastLc', 'averagingDown']));
  });

  it('部分ごと: 固定の部分が 0.1R までの滑りでも、残りの部分が越えれば持ち続けた（H4）。残りも滑りの内なら A', () => {
    const inSlip = ok({
      members: [
        main({ exitPrice: 37_690, orderType: 'market' }),
        hedge({ price: 37_690, quantity: 50, exitPrice: 37_420 }),
      ],
    });
    expect(inSlip.judgment?.grade).toBe('A');
    expect(kinds(inSlip)).toContain('gapSlip');
  });
});

describe('R・損益・1R・リスク（C79・5.8 の 6〜8）', () => {
  it('H1: R は固定の価格から +1.5、損益は合計 +430,000 円（÷ 1R の +1.43 ではない）', () => {
    const ev = ok({
      members: [main({ exitPrice: 38_600 }), hedge({ price: 38_450, exitPrice: 38_620 })],
    });
    expect(ev.r).toBeCloseTo(1.5, 9);
    expect(ev.pnl).toEqual([{ currency: 'JPY', amount: 430_000 }]);
    expect(ev.oneRYen).toBe(300_000);
    expect(ev.oneRCurrency).toBe('JPY');
    expect(ev.riskPct).toBeCloseTo(1.0, 9);
    expect(ev.overRisk).toBe(false);
  });

  it('H8: 通貨が違えば損益を通貨ごとに並べ（換算しない）、1R は本玉の円、リスクは 0.25%', () => {
    const ev = ok({
      members: [
        main({
          multiplier: 5,
          quantity: 2,
          price: 5_000,
          lc: 4_950,
          exitPrice: 5_060,
          fxRate: 150,
          priceCurrency: 'USD',
        }),
        hedge({
          price: 5_040,
          quantity: 10,
          multiplier: 1,
          exitPrice: 5_065,
          accountCurrency: 'USD',
        }),
      ],
    });
    // 先物: 60 × 2 × 5 × 150 = +90,000 円、CFD: (5,040 − 5,065) × 10 × 1 = −250 USD
    expect(ev.pnl).toEqual([
      { currency: 'JPY', amount: 90_000 },
      { currency: 'USD', amount: -250 },
    ]);
    // 1R = 50 × 2 × 5 × 150 = 75,000 円、30,000,000 円の 0.25%
    expect(ev.oneRYen).toBeCloseTo(75_000, 6);
    expect(ev.riskPct).toBeCloseTo(0.25, 9);
    expect(ev.r).toBeCloseTo(0.8, 9);
  });

  it('H5: 本玉 2 件の 1R = 300,000 + 300 × 5 × 100 = 450,000 円・口座 A の 1.5%', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_400 }),
        main({ multiplier: 100, quantity: 5, price: 38_100, lc: 37_800, exitPrice: 38_400 }, 'm2'),
        hedge({ price: 38_300, quantity: 150, exitPrice: 38_420 }),
      ],
    });
    expect(ev.oneRYen).toBe(450_000);
    expect(ev.riskPct).toBeCloseTo(1.5, 9);
  });

  it('本玉が 2 口座なら口座ごとの 1R ÷ その口座の資金の大きいほう。2% を超えれば過剰リスク', () => {
    // 口座 A: 300,000 ÷ 30,000,000 = 1.0%、口座 C: 150,000 ÷ 6,000,000 = 2.5%
    const ev = ok({
      members: [
        main({ exitPrice: 37_700 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 38_000,
            exitPrice: 37_700,
            accountId: 'C',
            capitalYen: 6_000_000,
          },
          'm2',
        ),
        hedge({ price: 37_700, quantity: 150, exitPrice: 37_720 }),
      ],
    });
    expect(ev.riskPct).toBeCloseTo(2.5, 9);
    expect(ev.overRisk).toBe(true);
    expect(ev.judgment?.grade).toBe('B');
    expect(kinds(ev)).toContain('overRisk');
  });

  it('本玉の口座の通貨が違えば 1R の額は出さないが、リスクは出し、リスクを見ていないの注記を出さない', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_300 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 38_000,
            exitPrice: 38_300,
            accountId: 'U',
            accountCurrency: 'USD',
            priceCurrency: 'JPY',
            fxRate: 0.0067,
            capitalYen: 200_000,
          },
          'm2',
        ),
        hedge({ price: 38_200, quantity: 150, exitPrice: 38_250 }),
      ],
    });
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.riskPct).toBeDefined();
    expect(kinds(ev)).not.toContain('riskNotChecked');
  });

  it('資金の無い口座の本玉があればリスクを出さず、リスクを見ていないの注記', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_600, capitalYen: null }),
        hedge({ price: 38_450, exitPrice: 38_620 }),
      ],
    });
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noCapital' });
  });

  it('メンバーの 1 件でも損益が出なければ損益の合計を出さない', () => {
    // 円の口座の USD 建ての決済の代わりで、決済の為替が無い
    const ev = ok({
      members: [
        main({ exitPrice: 38_600 }),
        hedge({ price: 38_450, exitPrice: 38_620, priceCurrency: 'USD' }),
      ],
    });
    expect(ev.pnl).toBeUndefined();
    expect(ev.r).toBeCloseTo(1.5, 9);
  });
});

describe('勝ち負けの境（5.8 の 9）', () => {
  it('H10: R が出なければ損益の合計の符号（−530,000 円 → 負け・C）', () => {
    const ev = ok({
      members: [main({ lc: null, exitPrice: 37_450 }), hedge({ price: 37_500, exitPrice: 37_480 })],
    });
    expect(ev.pnl).toEqual([{ currency: 'JPY', amount: -530_000 }]);
    expect(ev.judgment?.outcome).toBe('loss');
    expect(ev.judgment?.grade).toBe('C');
  });

  it('R も損益も出なければ価格の符号（固定 38,100 > イン 38,000 → 勝ち）', () => {
    const ev = ok({
      members: [
        main({ lc: null, exitPrice: 37_450 }),
        hedge({ price: 38_100, exitPrice: 37_480, priceCurrency: 'USD' }),
      ],
    });
    expect(ev.r).toBeUndefined();
    expect(ev.pnl).toBeUndefined();
    expect(ev.judgment?.outcome).toBe('win');
    expect(ev.judgment?.grade).toBe('riskyWin');
  });
});

describe('崩れたまとまり（4.8）', () => {
  const m = main({ exitPrice: 38_600 });
  const h = hedge({ price: 38_450, exitPrice: 38_620 });
  const cases: ReadonlyArray<readonly [string, GroupMember[], string]> = [
    ['メンバーが 1 件', [m], 'memberCount'],
    [
      'メンバーが 11 件',
      [
        m,
        ...Array.from({ length: 10 }, (_, i) =>
          hedge({ price: 38_450, quantity: 10, exitPrice: 38_620 }, `h${i}`),
        ),
      ],
      'memberCount',
    ],
    ['取引の重なり', [m, h, h], 'duplicateTrade'],
    ['無い取引', [m, { tradeId: 'gone', role: 'hedge' }], 'missingTrade'],
    ['本玉が無い', [h, hedge({ price: 1, exitPrice: 1 }, 'h2')], 'noMain'],
    ['決済の代わりが無い', [m, main({ exitPrice: 38_600 }, 'm2')], 'noHedge'],
    [
      '本玉の向きが混ざる',
      [m, main({ side: 'S', lc: 38_300, exitPrice: 38_600 }, 'm2'), h],
      'mainSideMixed',
    ],
    [
      '決済の代わりが本玉と同じ向き',
      [m, hedge({ side: 'L', price: 38_450, exitPrice: 38_620 })],
      'hedgeSameSide',
    ],
    [
      '足を持つ取引',
      [m, member('h1', 'hedge', { side: 'S', exitPrice: 38_600, legs: true, lc: null })],
      'hasLegs',
    ],
  ];

  it.each(cases)('%s → 判定を出さず理由を返す', (_label, members, problem) => {
    expect(groupProblems(members)).toContain(problem);
    const ev = evaluatePositionGroup({ members });
    expect(ev.ok).toBe(false);
    if (!ev.ok) expect(ev.problems).toContain(problem);
    expect(groupReviewItem('g1', { members })).toBeUndefined();
  });

  it('組が揃っていれば理由は空', () => {
    expect(groupProblems([m, h])).toEqual([]);
  });
});

describe('振り返りの 1 件の項目（C80・6.5）', () => {
  it('決済の時刻 = まとまりの決済の時刻（固定の時点）・判定・R・崩れの理由・心理の和・Good / More の和・取り込み', () => {
    const group: PositionGroupInput = {
      members: [
        main({
          exitPrice: 37_400,
          emotionTags: ['calm'],
          reflection: {
            good: { topics: [], notes: ['同じ一言'] },
            more: { topics: [], notes: [] },
          },
          createdAt: MON + 10 * MIN,
        }),
        hedge({
          price: 37_550,
          exitPrice: 37_420,
          emotionTags: ['fear'],
          reflection: {
            good: { topics: [], notes: ['同じ一言', '別の一言'] },
            more: { topics: [], notes: [] },
          },
          source: 'import',
          createdAt: MON + 20 * MIN,
        }),
      ],
    };
    const item = groupReviewItem('g1', group);
    expect(item?.id).toBe('g1');
    expect(item?.exitTime).toBe(FIX);
    expect(item?.createdAt).toBe(MON + 10 * MIN);
    expect(item?.grade).toBe('B');
    expect(item?.r).toBeCloseTo(-1.5, 9);
    expect(item?.reasons).toEqual(['heldPastLc']);
    expect(item?.imported).toBe(true);
    expect(item?.reflection?.good.notes).toEqual(['同じ一言', '別の一言']);
  });

  it('心理のタグの和: 平常心とほかのタグがあれば平常心を外す。平常心だけなら平常心', () => {
    const tagged = (a: string[], b: string[]): PositionGroupInput => ({
      members: [
        main({ exitPrice: 38_600, emotionTags: a as never }),
        hedge({ price: 38_450, exitPrice: 38_620, emotionTags: b as never }),
      ],
    });
    expect(groupReviewItem('g', tagged(['calm'], ['calm']))?.emotions).toEqual(['calm']);
    const mixed = groupReviewItem('g', tagged(['calm'], ['overconfident']))?.emotions;
    expect(mixed).toEqual(['overconfident']);
    expect(groupReviewItem('g', tagged([], []))?.emotions).toBeUndefined();
  });
});

describe('性質（種つき乱数）', () => {
  interface Gen {
    readonly entry: number;
    readonly width: number;
    readonly fixMove: number;
    readonly restMove: number;
    readonly mainQty: number;
    readonly hedgeFrac: number;
    readonly hedgeExitMove: number;
    readonly fees: number;
  }

  function build(g: Gen, side: 'L' | 'S', scale = 1): PositionGroupInput {
    const s = side === 'L' ? 1 : -1;
    const mainQty = g.mainQty * scale;
    // 決済の代わりの量 = 本玉の量 × 割合（乗数 10 なので数量 = 量 ÷ 10）
    const hedgeQty = (g.mainQty * 1_000 * g.hedgeFrac * scale) / 10;
    const fixPrice = g.entry + s * g.fixMove;
    return {
      members: [
        main({
          side,
          quantity: mainQty,
          price: g.entry,
          lc: g.entry - s * g.width,
          exitPrice: g.entry + s * g.restMove,
          fees: g.fees,
        }),
        hedge({
          side: side === 'L' ? 'S' : 'L',
          price: fixPrice,
          quantity: hedgeQty,
          exitPrice: fixPrice + s * g.hedgeExitMove,
          fees: g.fees,
        }),
      ],
    };
  }

  const gen = (r: import('./helpers/prng').Rng): Gen => ({
    entry: r.int(10_000, 50_000),
    width: r.int(1, 2_000),
    fixMove: r.int(-3_000, 3_000),
    restMove: r.int(-3_000, 3_000),
    mainQty: r.int(1, 20),
    hedgeFrac: r.pick([0.1, 0.25, 0.5, 1, 1.5]),
    hedgeExitMove: r.int(-500, 500),
    fees: r.int(0, 5_000),
  });

  it('L と S を入れ替えて価格を鏡にしても、判定と R は同じ', () => {
    forAll(2651, 400, gen, (g) => {
      const l = ok(build(g, 'L'));
      const s = ok(build(g, 'S'));
      expect(s.judgment?.grade).toBe(l.judgment?.grade);
      expect(s.r ?? 0).toBeCloseTo(l.r ?? 0, 9);
      expect(s.exitPrice - g.entry).toBeCloseTo(-(l.exitPrice - g.entry), 6);
    });
  });

  it('数量を何倍にしても R は同じ（1R・損益は比例）', () => {
    forAll(2652, 300, gen, (g) => {
      const a = ok(build(g, 'L'));
      const b = ok(build(g, 'L', 3));
      expect(b.r ?? 0).toBeCloseTo(a.r ?? 0, 9);
      expect(b.oneRYen ?? 0).toBeCloseTo(3 * (a.oneRYen ?? 0), 3);
      expect(b.judgment?.outcome).toBe(a.judgment?.outcome);
    });
  });

  it('決済の代わりの決済の価格と手数料を変えても R は変わらない（固定した時点で決まる）', () => {
    forAll(2653, 300, gen, (g) => {
      const a = ok(build(g, 'L'));
      const b = ok(
        build({ ...g, hedgeExitMove: g.hedgeExitMove + 777, fees: g.fees * 2 + 1 }, 'L'),
      );
      expect(b.r ?? 0).toBeCloseTo(a.r ?? 0, 9);
      expect(b.exitPrice).toBeCloseTo(a.exitPrice, 9);
    });
  });

  it('損益の合計 = メンバーの損益の和、R・損益・P に NaN を出さない', () => {
    forAll(2654, 400, gen, (g) => {
      const ev = ok(build(g, 'L'));
      const s = 1;
      const mainPnl = s * g.restMove * g.mainQty * 1_000;
      const hedgeQty = (g.mainQty * 1_000 * g.hedgeFrac) / 10;
      const hedgePnl = -s * g.hedgeExitMove * hedgeQty * 10;
      // 手数料は明細の損益が無いときの損益に入らない（5.1。明細の損益の無い取引）
      expect(ev.pnl?.[0]?.amount ?? 0).toBeCloseTo(mainPnl + hedgePnl, 3);
      expect(Number.isNaN(ev.exitPrice)).toBe(false);
      if (ev.r !== undefined) expect(Number.isFinite(ev.r)).toBe(true);
      const q = ev.parts.reduce((a, p) => a + p.quantity, 0);
      expect(q).toBeCloseTo(ev.quantity, 6);
    });
  });
});

describe('独立レビューの指摘（#265）', () => {
  // 本玉 2 件（先物 量 1,000 + ミニ 量 500）・決済の代わり CFD S 150 を 38,300 → +0.89R
  const mini = (o: Partial<Parameters<typeof main>[0]> = {}) =>
    main(
      { multiplier: 100, quantity: 5, price: 38_100, lc: 37_800, exitPrice: 38_400, ...o },
      'm2',
    );
  const h150 = hedge({ price: 38_300, quantity: 150, exitPrice: 38_420 });

  it('チャートの長い足へは、当たる本玉を優先する（メンバーの並びに依らない）', () => {
    const m1 = main({ exitPrice: 38_400, entryChartTimeframe: '1h', exitChartTimeframe: '1h' });
    const m2 = mini({ entryChartTimeframe: '1h', exitChartTimeframe: '4h' });
    for (const members of [
      [m1, m2, h150],
      [m2, m1, h150],
      [h150, m1, m2],
    ]) {
      const ev = ok({ members });
      expect(ev.judgment?.grade).toBe('riskyWin');
      expect(ev.judgment?.reasons).toContainEqual({
        kind: 'timeframeLonger',
        source: 'chart',
        from: '1h',
        to: '4h',
      });
    }
  });

  it('タップの長い足へは、答えた本玉の足を理由の from にする', () => {
    const ev = ok({
      members: [
        main({ exitPrice: 38_400, timeframe: '15m' }),
        mini({ timeframe: '1h', timeframeChange: 'longer' }),
        h150,
      ],
    });
    expect(ev.judgment?.reasons).toContainEqual({
      kind: 'timeframeLonger',
      source: 'tap',
      from: '1h',
    });
  });

  it('本玉の 1R が 1 件でも出なければ、資金があっても注記の原因は「1R が出ない」', () => {
    // 円の口座の USD 建ての本玉で、決済の為替が無い → 1R が出ない
    const ev = ok({
      members: [main({ exitPrice: 38_400 }), mini({ priceCurrency: 'USD' }), h150],
    });
    expect(ev.oneRYen).toBeUndefined();
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
  });

  it('同じ口座の本玉の資金が違えば小さいほう: 450,000 ÷ 15,000,000 = 3.0%（過剰リスク）', () => {
    const ev = ok({
      members: [main({ exitPrice: 38_400 }), mini({ capitalYen: 15_000_000 }), h150],
    });
    expect(ev.riskPct).toBeCloseTo(3.0, 9);
    expect(ev.overRisk).toBe(true);
    const reversed = ok({
      members: [mini({ capitalYen: 15_000_000 }), h150, main({ exitPrice: 38_400 })],
    });
    expect(reversed.riskPct).toBeCloseTo(3.0, 9);
  });

  it('同じ口座の本玉の 1 件の資金が未設定なら、リスクを出さない', () => {
    const ev = ok({ members: [main({ exitPrice: 38_400 }), mini({ capitalYen: null }), h150] });
    expect(ev.riskPct).toBeUndefined();
    expect(ev.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noCapital' });
  });

  it('性質: 本玉 2 件・決済の代わり 2 件の並びを入れ替えても、判定・理由・R・損益・決済の時刻は同じ', () => {
    const tfs = ['15m', '1h', '4h'] as const;
    forAll(
      2655,
      300,
      (r) => {
        const entry = r.int(20_000, 40_000);
        const width = r.int(50, 1_000);
        const t1 = ENTRY + r.int(0, 600) * MIN;
        const t2 = t1 + r.int(1, 600) * MIN;
        const ex1 = MON + r.int(0, 120) * MIN;
        const ex2 = MON + r.int(121, 240) * MIN;
        const move = () => r.int(-2 * width, 2 * width);
        return {
          m1: main({
            quantity: r.int(1, 3),
            price: entry,
            lc: entry - width,
            entryTime: t1,
            exitPrice: entry + move(),
            exitTime: ex1,
            orderType: r.pick(['market', 'stop', 'unknown'] as const),
            entryChartTimeframe: r.pick(tfs),
            exitChartTimeframe: r.pick(tfs),
            lcMove: r.pick([{ kind: 'none' }, { kind: 'cancelled' }] as const),
          }),
          m2: main(
            {
              multiplier: 100,
              quantity: r.int(1, 10),
              price: entry + r.int(-width, width),
              lc: entry - width,
              entryTime: t2,
              exitPrice: entry + move(),
              exitTime: ex2,
              entryChartTimeframe: r.pick(tfs),
              exitChartTimeframe: r.pick(tfs),
              timeframe: r.pick(tfs),
              timeframeChange: r.pick(['none', 'longer', 'shorter'] as const),
              capitalYen: r.pick([30_000_000, 10_000_000]),
            },
            'm2',
          ),
          h1: hedge(
            {
              price: entry + move(),
              quantity: r.int(10, 200),
              entryTime: FIX,
              exitPrice: entry + move(),
            },
            'h1',
          ),
          h2: hedge(
            {
              price: entry + move(),
              quantity: r.int(10, 200),
              entryTime: FIX + r.int(1, 300) * MIN,
              exitPrice: entry + move(),
              exitTime: MON - r.int(0, 90) * MIN,
            },
            'h2',
          ),
          perm: [r.next(), r.next(), r.next(), r.next()],
        };
      },
      ({ m1, m2, h1, h2, perm }) => {
        const base = ok({ members: [m1, m2, h1, h2] });
        const order = [m1, m2, h1, h2]
          .map((m, i) => ({ m, k: perm[i] ?? 0 }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.m);
        const shuffled = ok({ members: order });
        expect(shuffled.judgment?.grade).toBe(base.judgment?.grade);
        const sortKinds = (e: Ok) => kinds(e).slice().sort();
        expect(sortKinds(shuffled)).toEqual(sortKinds(base));
        expect(shuffled.judgment?.reasons.find((x) => x.kind === 'timeframeLonger')).toEqual(
          base.judgment?.reasons.find((x) => x.kind === 'timeframeLonger'),
        );
        if (base.r === undefined) expect(shuffled.r).toBeUndefined();
        else expect(shuffled.r ?? Number.NaN).toBeCloseTo(base.r, 9);
        expect(shuffled.exitPrice).toBeCloseTo(base.exitPrice, 6);
        expect(shuffled.exitTime).toBe(base.exitTime);
        expect(shuffled.riskPct ?? -1).toBeCloseTo(base.riskPct ?? -1, 9);
        expect(shuffled.pnl?.[0]?.amount ?? 0).toBeCloseTo(base.pnl?.[0]?.amount ?? 0, 3);
        expect(shuffled.notes.map((n) => n.kind).sort()).toEqual(
          base.notes.map((n) => n.kind).sort(),
        );
      },
    );
  });
});
