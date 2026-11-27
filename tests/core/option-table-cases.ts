// 設計書 5.7 の例の表（オプションのポジション）の場面。場面の文章は写さず、設計書の `#` で対応づける。
// 値はすべて架空。既定（helpers/option-builder）: 乗数 1,000・円の口座・資金 10,000,000 円・許容 1%、
// 向き L、建てたときの原資産 38,500、LC 37,500（幅 1,000）、手数料 0、決済の注文の種類 unknown・理由 other
import type { Outcome } from '../../core/judge';
import type { OneRSource } from '../../core/option';
import type { Leg } from '../../core/trade';
import type { Scene } from './design-table-cases';
import { expiredLeg, leg, position } from './helpers/option-builder';
import { without } from './helpers/trade-builder';

export interface OptionScene extends Scene {
  /** 勝ち負け（判定の言葉だけでは分からない行で確かめる） */
  readonly outcome?: Outcome;
  /** 行に書かれた R（'none' = R が出ない） */
  readonly r?: number | 'none';
  /** 行に書かれた 1R の出どころ（'none' = 1R が出ない） */
  readonly oneRSource?: OneRSource | 'none';
}

/** 場面がまだ無い行（#113・#114 ですべて足した） */
export const PENDING_ROWS: readonly string[] = [];

// レッグの決済の時刻（エポックからのミリ秒。架空。t1 < t2 < t3 < SQ）
const T1 = 1_800_000_000_000;
const T2 = T1 + 86_400_000;
const T3 = T2 + 86_400_000;
const SQ = T3 + 86_400_000;

const at = (time: number): Partial<Leg['exit']> => ({ time });

// 決済の注文の種類は明細の値（生の値）のまま渡し、判定がレッグの決済の時点から導き直すことを確かめる（C54）

// O2・O3: 売りのプット 150 → 360（−210,000 円）、決済したときの原資産 37,100（LC を 400 越えた・成行）
// → 1R = 210,000 × 1,000 ÷ 1,400 = 150,000 円（実際の動きから）、−1.4R、リスク 1.5%
const heldPastLegs = [leg('P', 37_000, 'sell', 1, 150, 360)];

// O22: 売りのプット 150 → 255（−105,000 円）、決済したときの原資産 37,450（LC を 50 越えた = 幅 1,000 の 5%・成行）
// → 1R = 105,000 × 1,000 ÷ 1,050 = 100,000 円（実際の動きから）、−1.05R。0.1R までの滑りなので持ち続けたにしない（C71）
const slipLegs = [leg('P', 37_000, 'sell', 1, 150, 255)];

// O19・O20: 買いのコールを先に決済（80 → 150。+70,000 円）、売りのプットは SQ まで残して満期で消滅（+120,000 円）
const sellToSqLegs = [
  leg('C', 40_000, 'buy', 1, 80, 150, at(T1)),
  expiredLeg('P', 36_000, 'sell', 1, 120, 0, SQ),
];

// O21: 買いのコールを逆指値で決済（200 → 50。−150,000 円）、売りのプットは SQ まで残して ITM で消滅
// （SQ の原資産 36,300・本源的価値 200。100 → 200 で −100,000 円）
const stopThenSqLegs = [
  leg('C', 39_500, 'buy', 1, 200, 50, at(T1)),
  expiredLeg('P', 36_500, 'sell', 1, 100, 200, SQ),
];

// O8・O18: 買いのスプレッド（P 38,000 買い・P 37,000 売り。最大損失の例と同じ形）を「最大損失まで」。向き S（満期の損益の比べ方。C47）、
// 建てたときの原資産 38,200、決済したときの原資産 38,600（思惑と逆）。LC の価格は置かない
const bearPutSpread = (
  over: Parameters<typeof position>[2],
  buy: [number, number],
  sell: [number, number],
) =>
  without(
    position([leg('P', 38_000, 'buy', 1, ...buy), leg('P', 37_000, 'sell', 1, ...sell)], 38_600, {
      side: 'S',
      entries: [{ price: 38_200, quantity: 1 }],
      riskPlan: 'maxLoss',
      ...over,
    }),
    'lc',
  );

// O17: すべてのレッグが満期で消滅。SQ の原資産 36,800。
// 売りのプット 37,000（150 → 本源的価値 200。−50,000 円）、買いのプット 36,000（50 → 0。−50,000 円）
const allExpiredLegs = [
  expiredLeg('P', 37_000, 'sell', 1, 150, 200, SQ),
  expiredLeg('P', 36_000, 'buy', 1, 50, 0, SQ),
];

// O16: 売りのプットを原資産の LC（37,500）で決済（150 → 220。−70,000 円）、外側の買いのプットは放置して SQ で消滅（−30,000 円）
const sellClosedBuyExpiredLegs = [
  leg('P', 37_000, 'sell', 1, 150, 220, at(T1)),
  expiredLeg('P', 36_000, 'buy', 1, 30, 0, SQ),
];

export const OPTION_TABLE_CASES: Readonly<Record<string, readonly OptionScene[]>> = {
  O1: [
    {
      // 売りのプット 150 → 300（−150,000 円）、原資産 37,500 = LC で決済 → 1R 150,000 円（実際の動きから）、−1.0R
      input: position(
        [leg('P', 37_000, 'sell', 1, 150, 300)],
        37_500,
        {},
        { reason: 'lc', orderType: 'market' },
      ),
      grade: 'A',
      r: -1.0,
      oneRSource: 'actualMove',
      reasons: ['asPlannedLc'],
      absent: ['heldPastLc', 'overRisk'],
    },
  ],
  O2: [
    {
      input: position(heldPastLegs, 37_100, { gapSlipAnswer: false }, { orderType: 'market' }),
      grade: 'B',
      r: -1.4,
      oneRSource: 'actualMove',
      reasons: ['heldPastLc'],
    },
  ],
  O3: [
    {
      input: position(heldPastLegs, 37_100, { gapSlipAnswer: true }, { orderType: 'market' }),
      grade: 'A',
      r: -1.4,
      oneRSource: 'actualMove',
      reasons: ['gapSlip'],
      absent: ['heldPastLc'],
    },
  ],
  O4: [
    {
      // 売りのプット 150 → 105（+45,000 円）、見込み 150,000 円 → +0.3R。原資産 37,300 は LC を越えた
      input: position([leg('P', 36_000, 'sell', 1, 150, 105)], 37_300, { lcLossPlanYen: 150_000 }),
      grade: 'riskyWin',
      r: 0.3,
      oneRSource: 'plan',
      reasons: ['heldPastLc'],
      outcome: 'win',
    },
  ],
  O5: [
    {
      // 買いのコールのスプレッド: C 39,000 買い 200 → 170（−30,000 円）・C 40,000 売り 50 → 50（0 円）。原資産は 38,900（思惑どおり）
      // → (2) は出ない。(3) 原資産 = LC 37,500 の満期: −200,000 + 50,000 = −150,000 → 1R 150,000 円（1.5%）、−0.2R
      input: position(
        [leg('C', 39_000, 'buy', 1, 200, 170), leg('C', 40_000, 'sell', 1, 50, 50)],
        38_900,
      ),
      grade: 'A',
      r: -0.2,
      oneRSource: 'expiry',
      reasons: ['asPlannedLc'],
      absent: ['heldPastLc', 'overRisk'],
      outcome: 'loss',
    },
  ],
  O6: [
    {
      // 売りの裸・LC なし: 150 → 900（−750,000 円）。R は出ない
      input: without(
        position([leg('P', 36_000, 'sell', 1, 150, 900)], 36_400, { lcDecidedBeforeEntry: false }),
        'lc',
      ),
      grade: 'C',
      r: 'none',
      oneRSource: 'none',
      reasons: ['noLc'],
      outcome: 'loss',
    },
  ],
  O7: [
    {
      // 売りの裸・LC なし: 150 → 40（+110,000 円）
      input: without(
        position([leg('P', 36_000, 'sell', 1, 150, 40)], 38_900, { lcDecidedBeforeEntry: false }),
        'lc',
      ),
      grade: 'riskyWin',
      reasons: ['noLc'],
      outcome: 'win',
    },
  ],
  O8: [
    {
      // P 38,000 買い 400 → 250（−150,000 円）・P 37,000 売り 150 → 130（+20,000 円）= −130,000 円。
      // 最大損失 (400 − 150) × 1,000 = 250,000 円 → 1R 250,000 円、−0.52R。資金 20,000,000 円（1.25%。設計書の最大損失の例・O8 と同じ）
      input: bearPutSpread({ capitalYen: 20_000_000 }, [400, 250], [150, 130]),
      grade: 'A',
      r: -0.52,
      oneRSource: 'maxLoss',
      reasons: [],
      absent: ['noLc', 'heldPastLc', 'overRisk'],
      outcome: 'loss',
    },
  ],
  O9: [
    {
      // C 39,000 買い 300 → 450（+150,000 円）・C 41,000 売り 20 → 30（−10,000 円）= +140,000 円、原資産 39,200。
      // (3) 原資産 = LC 37,500 の満期: −300,000 + 20,000 = −280,000 → 1R 280,000 円（2.8%）、+0.5R
      input: position(
        [leg('C', 39_000, 'buy', 1, 300, 450), leg('C', 41_000, 'sell', 1, 20, 30)],
        39_200,
      ),
      grade: 'riskyWin',
      r: 0.5,
      oneRSource: 'expiry',
      reasons: ['overRisk'],
      absent: ['heldPastLc'],
      outcome: 'win',
    },
  ],
  O10: [
    {
      // LC 37,800（幅 700）→ 37,400 に広げた。決済の原資産 37,590（逆へ 910）、売りのプット 150 → 280（−130,000 円）
      // → 1R = 130,000 × 700 ÷ 910 = 100,000 円、−1.3R。広げた後の LC の手前なので持ち続けたは出ない
      input: position([leg('P', 37_000, 'sell', 1, 150, 280)], 37_590, {
        lc: 37_800,
        lcMove: { kind: 'widened', after: 37_400 },
      }),
      grade: 'B',
      r: -1.3,
      oneRSource: 'actualMove',
      reasons: ['lcWidened'],
      absent: ['heldPastLc'],
    },
  ],
  O11: [
    {
      // 一部の決済: 3 本を t1・t2・t3 に決済（−60,000・−70,000・+40,000 = −90,000 円）。最後の決済の原資産 37,900（LC の手前）
      // → 1R = 90,000 × 1,000 ÷ 600 = 150,000 円、−0.6R
      input: position(
        [
          leg('C', 40_000, 'buy', 1, 80, 20, at(T1)),
          leg('P', 37_000, 'sell', 1, 150, 220, at(T2)),
          leg('P', 36_000, 'buy', 1, 40, 80, at(T3)),
        ],
        37_900,
        {},
        { time: T3 },
      ),
      grade: 'A',
      r: -0.6,
      oneRSource: 'actualMove',
      reasons: ['asPlannedLc'],
      absent: ['heldPastLc'],
    },
  ],
  O12: [
    {
      // LC 37,500・見込みは空・限月が違う: C 39,000 買い（2027-01）200 → 300（+100,000 円）・P 37,000 売り（2027-02）100 → 50
      // （+50,000 円）= +150,000 円、原資産 38,900 → 1R はどれも出ない
      input: position(
        [
          leg('C', 39_000, 'buy', 1, 200, 300, {}, '2027-01'),
          leg('P', 37_000, 'sell', 1, 100, 50, {}, '2027-02'),
        ],
        38_900,
      ),
      grade: 'safeWin',
      r: 'none',
      oneRSource: 'none',
      reasons: ['riskNotChecked'],
      absent: ['overRisk', 'heldPastLc'],
      outcome: 'win',
    },
  ],
  O13: [
    {
      // ロール: 売りのプット 37,000 を決済（150 → 350。−200,000 円）+ 36,000 を建てて決済（200 → 225。−25,000 円）、
      // LC 37,500 → 37,000 に広げた。決済の原資産 37,000 → 1R = 225,000 × 1,000 ÷ 1,500 = 150,000 円、−1.5R
      input: position(
        [
          leg('P', 37_000, 'sell', 1, 150, 350, at(T1)),
          leg('P', 36_000, 'sell', 1, 200, 225, at(T2)),
        ],
        37_000,
        { lcMove: { kind: 'widened', after: 37_000 } },
      ),
      grade: 'B',
      r: -1.5,
      oneRSource: 'actualMove',
      reasons: ['lcWidened'],
    },
  ],
  O14: [
    {
      // 原資産 38,490（逆へ 10 = 幅の 1%）、IV の低下で −100,000 円、限月が違う → 1R は出ない
      input: position(
        [
          leg('C', 39_000, 'buy', 1, 200, 150, {}, '2027-01'),
          leg('P', 37_000, 'sell', 1, 250, 300, {}, '2027-02'),
        ],
        38_490,
      ),
      grade: 'A',
      r: 'none',
      oneRSource: 'none',
      reasons: ['riskNotChecked'],
      absent: ['overRisk'],
      outcome: 'loss',
    },
  ],
  O15: [
    {
      // 買いのプット（300・満期で消滅・明細に出ない）+ 売りのプット（150 → 30・明細の損益 +120,000 円）
      // → ポジションの損益 = 120,000 − 300,000 = −180,000 円。最後に閉じた時点（売りの決済）の原資産 38,400 は LC の手前
      input: position(
        [
          expiredLeg('P', 37_000, 'buy', 1, 300, 0, SQ),
          leg('P', 36_000, 'sell', 1, 150, 30, at(T1)),
        ],
        38_400,
        { statementPnlYen: 120_000 },
        { time: T1 },
      ),
      grade: 'A',
      reasons: [],
      absent: ['heldPastLc'],
      outcome: 'loss',
    },
  ],
  O16: [
    {
      // 決済の時点は売りの決済（t1・原資産 37,500 = LC）。SQ の原資産（LC の外）は使わない。
      // −100,000 円 → 1R 100,000 円（実際の動きから）、−1.0R、リスク 1.0%
      input: position(
        sellClosedBuyExpiredLegs,
        37_500,
        {},
        {
          time: T1,
          orderType: 'market',
          reason: 'lc',
        },
      ),
      grade: 'A',
      reasons: [],
      absent: ['heldPastLc'],
      outcome: 'loss',
    },
  ],
  O17: [
    {
      input: position(allExpiredLegs, 36_800, {}, { time: SQ, orderType: 'unknown' }),
      grade: 'B',
      reasons: ['heldPastLc'],
      outcome: 'loss',
    },
  ],
  O18: [
    {
      // USD 建て（乗数 100）で為替が空: P 38,000 買い 4.0 → 2.5（−150 USD）・P 37,000 売り 1.5 → 1.3（+20 USD）= −130 USD（負け）。
      // 最大損失 250 USD は定まるが口座の通貨にできない → 1R・R・リスク（%）は出さず、C にしない
      input: bearPutSpread(
        { instrument: { multiplier: 100, quantityStep: 1, priceInAccountCurrency: false } },
        [4.0, 2.5],
        [1.5, 1.3],
      ),
      grade: 'A',
      r: 'none',
      oneRSource: 'none',
      reasons: ['riskNotChecked'],
      absent: ['noLc', 'heldPastLc', 'overRisk'],
      outcome: 'loss',
    },
  ],
  O19: [
    {
      // SQ の原資産 37,300 は LC を越えた、+190,000 円
      input: position(sellToSqLegs, 37_300, {}, { time: SQ, orderType: 'market' }),
      grade: 'riskyWin',
      reasons: ['heldPastLc'],
      outcome: 'win',
    },
  ],
  O20: [
    {
      // SQ の原資産 38,200 は LC の手前、+190,000 円
      input: position(sellToSqLegs, 38_200, {}, { time: SQ, orderType: 'market' }),
      grade: 'safeWin',
      reasons: [],
      absent: ['heldPastLc'],
      outcome: 'win',
    },
  ],
  O21: [
    {
      // 明細の注文の種類は逆指値（先に決済したレッグ）だが、決済の時点は満期で消えた売り → 「満期（SQ）」。−250,000 円
      input: position(stopThenSqLegs, 36_300, {}, { time: SQ, orderType: 'stop' }),
      grade: 'B',
      reasons: ['heldPastLc'],
      absent: ['stopFilled'],
      outcome: 'loss',
    },
  ],
  O22: [
    {
      input: position(slipLegs, 37_450, {}, { orderType: 'market' }),
      grade: 'A',
      r: -1.05,
      oneRSource: 'actualMove',
      reasons: ['gapSlip'],
      absent: ['heldPastLc'],
      outcome: 'loss',
    },
  ],
};
