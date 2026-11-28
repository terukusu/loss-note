// 設計書 5.8 の例の表（両建てのまとまり）の場面。場面の文章は写さず、設計書の `#` で対応づける。
// 値はすべて架空。既定は helpers/group-builder（本玉 = XYZ 先物 L 1 枚・イン 38,000・LC 37,700 → 1R 300,000 円・1.0%、
// 決済の代わり = XYZ CFD S 100（量 1,000）・LC なし。決済の代わりの注文の種類は上書きなし = 不明、「窓・滑りでしたか」は未回答）
import type { Grade, ReasonKind } from '../../core/judge';
import type { GroupNote, PositionGroupInput } from '../../core/position-group';
import { FIX, hedge, MIN, MON, main, member } from './helpers/group-builder';

export interface GroupScene {
  readonly group: PositionGroupInput;
  readonly grade: Grade;
  readonly reasons: readonly ReasonKind[];
  readonly absent?: readonly ReasonKind[];
  /** まとまりの注記（判定の重さに数えない） */
  readonly notes?: readonly GroupNote['kind'][];
  /** 行に書かれた R（'none' = R が出ない） */
  readonly r?: number | 'none';
}

export const GROUP_TABLE_CASES: Readonly<Record<string, GroupScene>> = {
  // R = (38,450 − 38,000) ÷ 300 = +1.5。損益 = (38,600 − 38,000) × 1,000 + (38,450 − 38,620) × 100 × 10 = +430,000 円
  H1: {
    group: {
      members: [main({ exitPrice: 38_600 }), hedge({ price: 38_450, exitPrice: 38_620 })],
      exit: { orderType: 'market' },
    },
    grade: 'safeWin',
    reasons: [],
    r: 1.5,
  },
  // LC を割った後の 37,550 で固定: 越えた幅 150 = 0.5R > 0.1R、R = −450 ÷ 300 = −1.5
  H2: {
    group: {
      members: [main({ exitPrice: 37_400 }), hedge({ price: 37_550, exitPrice: 37_420 })],
    },
    grade: 'B',
    reasons: ['heldPastLc'],
    r: -1.5,
  },
  // 売りの逆指値 37,700 が 37,690 で約定: R = −310 ÷ 300 = −1.0333…（越えた幅 10 = 0.03R。逆指値でもある）
  H3: {
    group: {
      members: [main({ exitPrice: 37_400 }), hedge({ price: 37_690, exitPrice: 37_420 })],
      exit: { orderType: 'stop' },
    },
    grade: 'A',
    reasons: ['stopFilled'],
    absent: ['heldPastLc'],
    r: -310 / 300,
  },
  // 部分 500 @ 37,690（固定）と 500 @ 37,400（先物の成行）→ P = 37,545、R = −455 ÷ 300 = −1.5166…
  H4: {
    group: {
      members: [
        main({ exitPrice: 37_400, orderType: 'market', gapSlip: 'no' }),
        hedge({ price: 37_690, quantity: 50, exitPrice: 37_420 }),
      ],
    },
    grade: 'B',
    reasons: ['heldPastLc'],
    r: -455 / 300,
  },
  // 本玉 2 件（量 1,000 + 500）、固定 38,300 → R = (300 × 1,000 + 200 × 500) ÷ (300 × 1,000 + 300 × 500) = 400,000 ÷ 450,000
  H5: {
    group: {
      members: [
        main({ exitPrice: 38_400 }),
        main(
          {
            multiplier: 100,
            quantity: 5,
            price: 38_100,
            lc: 37_800,
            entryTime: FIX - 86_400_000,
            exitPrice: 38_400,
          },
          'm2',
        ),
        hedge({ price: 38_300, quantity: 150, exitPrice: 38_420 }),
      ],
    },
    grade: 'safeWin',
    reasons: [],
    r: 400_000 / 450_000,
  },
  // 固定 2 回: (38,300 × 600 + 38,200 × 400) ÷ 1,000 = 38,260 → R = 260 ÷ 300 = +0.8666…
  H6: {
    group: {
      members: [
        main({ exitPrice: 38_400 }),
        hedge({ price: 38_300, quantity: 60, entryTime: FIX, exitPrice: 38_420 }, 'h1'),
        hedge({ price: 38_200, quantity: 40, entryTime: FIX + 180 * MIN, exitPrice: 38_420 }, 'h2'),
      ],
    },
    grade: 'safeWin',
    reasons: [],
    r: 260 / 300,
  },
  // 同じ口座 B: 本玉 CFD L 100（量 1,000）・1R = 300 × 100 × 10 = 300,000 円 = 20,000,000 円の 1.5%、固定 37,800 → R = −200 ÷ 300
  H7: {
    group: {
      members: [
        member('m1', 'main', {
          multiplier: 10,
          quantity: 100,
          exitPrice: 37_850,
          accountId: 'B',
          capitalYen: 20_000_000,
        }),
        hedge({ price: 37_800, exitPrice: 37_850 }),
      ],
    },
    grade: 'A',
    reasons: ['asPlannedLc'],
    absent: ['heldPastLc', 'overRisk'],
    r: -200 / 300,
  },
  // 円の口座の ABC 先物（USD 建て・乗数 5・為替 150）L 2 枚、USD の口座の ABC CFD（乗数 1）S 10 を 5,040 → R = 40 ÷ 50 = +0.8
  H8: {
    group: {
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
          capitalYen: 100_000,
        }),
      ],
    },
    grade: 'safeWin',
    reasons: [],
    r: 0.8,
  },
  // 決済の代わりを最初の本玉の決済の 60 分前に決済 → 固定に数えない。P = 37,600、R = −400 ÷ 300（越えた幅 100 = 0.33R）
  H9: {
    group: {
      members: [
        main({ exitPrice: 37_600, orderType: 'market', gapSlip: 'no' }),
        hedge({ price: 38_450, exitPrice: 38_300, exitTime: MON - 60 * MIN }),
      ],
    },
    grade: 'B',
    reasons: ['heldPastLc'],
    notes: ['unfixed'],
    r: -400 / 300,
  },
  // LC を決めずに入った本玉。損益 = (37,450 − 38,000) × 1,000 + (37,500 − 37,480) × 1,000 = −530,000 円（R は出ない）
  H10: {
    group: {
      members: [main({ lc: null, exitPrice: 37_450 }), hedge({ price: 37_500, exitPrice: 37_480 })],
    },
    grade: 'C',
    reasons: ['noLc'],
    r: 'none',
  },
  // 広げた（37,700 → 37,500）。固定 37,520 → R = −480 ÷ 300 = −1.6。広げた後の LC は越えていない
  H11: {
    group: {
      members: [
        main({ lcMove: { kind: 'widened', after: 37_500 }, exitPrice: 37_450 }),
        hedge({ price: 37_520, exitPrice: 37_470 }),
      ],
    },
    grade: 'B',
    reasons: ['lcWidened'],
    absent: ['heldPastLc'],
    r: -1.6,
  },
};
