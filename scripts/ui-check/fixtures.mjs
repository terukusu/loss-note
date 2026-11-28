// 画面の検査の偽の記録の API と例の取引・画像（値はすべて架空）
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { settleLayers } from './base.mjs';

// ── 偽の記録の API（記憶の中だけ。値はすべて架空。形は api/src/loss_note_api/routes.py に合わせる） ──
export const FAKE_US30 = {
  id: 'inst-us30',
  name: 'US30',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: null,
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

/** 前に記録した架空の取引（開いたときの既定 R1 の確かめ: 銘柄 US30・数量 2） */
export function fakeTrade(id, instrumentId, quantity, createdAt) {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
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
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId,
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity }],
      exit: {
        time: createdAt,
        price: 99.5,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      fees: [],
    },
  };
}

// ── 取引の一覧・詳細・直すの例（Issue #9 の例の表 L1〜L3・D1・D2・E1・E2・H1。値はすべて架空）──
// 作った時刻はすべて t-last（1700000100000）より前（記録する画面の既定 R1 を変えない）。
// 損益 = (決済 − イン) × 数量。資金 1,000,000 円（L2 は資金なし）
export const DAY_MS = 86400000;
export const T_1110 = Date.UTC(2026, 10, 10, 0, 0);
export const SNAP = {
  instrument: {
    multiplier: 1,
    quantityStep: 1,
    priceCurrency: null,
    underlyingKind: 'index',
    productForm: 'spotCfd',
  },
  capitalYen: 1000000,
  riskTolerancePct: 1,
};
export function exampleTrade(id, createdAt, over = {}, top = {}) {
  const record = {
    status: 'closed',
    source: 'manual',
    instrumentId: FAKE_US30.id,
    side: 'L',
    lc: 99.5,
    lcBasis: 'chart',
    stopOrderPlaced: 'unanswered',
    lcDecidedBeforeEntry: true,
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    entries: [{ price: 100, quantity: 10000 }],
    exit: {
      time: T_1110,
      price: 99.5,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    fees: [],
    statementPnlYen: -5000,
    ...over,
  };
  for (const k of Object.keys(record)) if (record[k] === undefined) delete record[k];
  return { id, schemaVersion: 1, createdAt, updatedAt: createdAt, snapshot: SNAP, record, ...top };
}
export const TX_L1 = exampleTrade('x-l1', 1700000000001);
export const TX_L2 = exampleTrade(
  'x-l2',
  1700000000002,
  {
    side: 'S',
    lc: 150.5,
    entries: [{ price: 150, quantity: 10000 }],
    exit: {
      time: T_1110 + 2 * DAY_MS,
      price: 149,
      orderType: 'unknown',
      reason: 'tp',
      gapSlip: 'unanswered',
    },
    statementPnlYen: 10000,
  },
  { snapshot: { ...SNAP, capitalYen: null } },
);
export const TX_L3 = exampleTrade('x-l3', 1700000000003, {
  lc: undefined,
  lcDecidedBeforeEntry: false,
  entries: [{ price: 100, quantity: 3000 }],
  exit: {
    time: T_1110 + DAY_MS,
    price: 101,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: 3000,
});
export const D1_RECORD = {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: {
    time: T_1110 - DAY_MS,
    price: 99.2,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: -8000,
  entryChartTimeframe: '4h',
};
export const TX_D1 = exampleTrade(
  'x-d1',
  1700000000004,
  { ...D1_RECORD, exitChartTimeframe: '1d' },
  {
    charts: {
      entry: { contentType: 'image/png', size: 1 },
      exit: { contentType: 'image/png', size: 1 },
    },
  },
);
export const TX_D2 = exampleTrade(
  'x-d2',
  1700000000005,
  { ...D1_RECORD, exit: { ...D1_RECORD.exit, time: T_1110 - 2 * DAY_MS } },
  { charts: { entry: { contentType: 'image/png', size: 1 } } },
);
export const TX_E1 = exampleTrade('x-e1', 1700000000006, {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: {
    time: T_1110 - 3 * DAY_MS,
    price: 99.5,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
});
export const TX_E2 = exampleTrade('x-e2', 1700000000007, {
  exit: {
    time: T_1110 - 4 * DAY_MS,
    price: 99.5,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  entryChartTimeframe: '4h',
  exitChartTimeframe: '1d',
});
/** Issue #34 の撮影の場面（物差し）: 危ない勝ちで LC を広げていた（L）・TP を入れた（L）・ショートで LC を広げた。架空の値。
 * 決済の時刻は一覧・ホームの並びの後ろ（既存の手順の件数・並びを変えない） */
export const rulerExit = (days, price, reason = 'other') => ({
  time: T_1110 - days * DAY_MS,
  price,
  orderType: 'unknown',
  reason,
  gapSlip: 'unanswered',
});
export const TX_R1 = exampleTrade('x-r1', 1700000000011, {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: rulerExit(20, 100.75),
  statementPnlYen: 7500,
});
export const TX_R2 = exampleTrade('x-r2', 1700000000012, {
  tp: 101,
  exit: rulerExit(21, 101, 'tp'),
  statementPnlYen: 10000,
});
export const TX_R3 = exampleTrade('x-r3', 1700000000013, {
  side: 'S',
  lc: 150.5,
  // エントリーの時刻は決済の 2 日 4 時間前（詳細の見出しの下の行に保有時間。#58）
  entries: [{ price: 150, quantity: 10000, time: T_1110 - 22 * DAY_MS - 2 * DAY_MS - 4 * 3600000 }],
  lcMove: { kind: 'widened', after: 150.8 },
  exit: rulerExit(22, 150.8),
  statementPnlYen: -8000,
});
/**
 * #202 の例 #6: 前からの「価格あり・決めていなかった」の取引（後から書いた LC 99.5・決済 100.75 → 危ない勝ち +1.5R）。値は架空。
 * EXAMPLE_TRADES には入れない（一覧の件数を変えない。LD1 だけが使う）
 */
export const TX_LATE = exampleTrade('x-late', 1700000000020, {
  lcDecidedBeforeEntry: false,
  exit: {
    time: T_1110 - DAY_MS,
    price: 100.75,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: 7500,
});
export const EXAMPLE_TRADES = [
  TX_L1,
  TX_L2,
  TX_L3,
  TX_D1,
  TX_D2,
  TX_E1,
  TX_E2,
  TX_R1,
  TX_R2,
  TX_R3,
];
/**
 * Issue #88 の例の表 S1 の 7 件（架空の値）。決済は端末の今日から 6 日前〜今日の 10:00（7 日・3 か月に入り、1 日は今日の 1 件）。
 * 1 A −1.0R・2 計画どおりの勝ち +2.0R・3 B LC を広げた −1.6R・4 危ない勝ち +0.5R・5 C LC なし・6 A −0.8R・7 計画どおりの勝ち +1.2R
 */
export function reviewExit(daysAgo) {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - daysAgo, 10, 0).getTime();
}
export function reviewTrade(i, id, price, over = {}, source = 'manual') {
  return exampleTrade(id, 1700000001000 + i, {
    source,
    exit: {
      time: reviewExit(6 - i),
      price,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    statementPnlYen: Math.round((price - 100) * 10000),
    ...over,
  });
}
export const REVIEW_S1 = [
  reviewTrade(0, 'rv-1', 99.5),
  reviewTrade(1, 'rv-2', 101),
  reviewTrade(2, 'rv-3', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }),
  reviewTrade(3, 'rv-4', 100.25, { timeframeChange: 'longer' }),
  reviewTrade(4, 'rv-5', 99, { lc: undefined, lcDecidedBeforeEntry: false }),
  reviewTrade(5, 'rv-6', 99.6),
  reviewTrade(6, 'rv-7', 100.6),
];
/**
 * 両建てのまとまり（#268・設計書 6.5）の 2 件（架空の値）: 本玉 L（イン 100・LC 99.5）を 2 日前に建て、1 日前の夜に決済の代わり S
 * （同じ量・LC なし）を 100.6 で建てて固定（+1.2R・計画どおりの勝ち）、at（既定は今日の 10:00）に両方を外した。固定は at の fixGap 前。偽の API は最上位の
 * positionGroupId・groupRole（偽の API だけの印）からまとまりを組み、範囲の一覧に positionGroups・groupMembers を返す
 */
export function groupPair(prefix, at = reviewExit(0), fixGap = 12 * 3600_000) {
  const fix = at - fixGap;
  const gid = `${prefix}-g`;
  const mainT = exampleTrade(
    `${prefix}-m`,
    1700000003001,
    {
      entries: [{ time: at - 2 * DAY_MS, price: 100, quantity: 10000 }],
      exit: {
        time: at,
        price: 100.9,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      statementPnlYen: 9000,
    },
    { positionGroupId: gid, groupRole: 'main' },
  );
  const hedgeT = exampleTrade(
    `${prefix}-h`,
    1700000003002,
    {
      side: 'S',
      lc: undefined,
      lcDecidedBeforeEntry: false,
      entries: [{ time: fix, price: 100.6, quantity: 10000 }],
      exit: {
        time: at + 5 * 60_000,
        price: 100.9,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      statementPnlYen: -3000,
    },
    { positionGroupId: gid, groupRole: 'hedge' },
  );
  return [mainT, hedgeT];
}
/** 振り返りの S1 + 両建てのまとまり 1 件（#268。8 件 = S1 の 7 件 + まとまり 1 件。LC が無いのは rv-5 の 1 件だけ） */
export const REVIEW_GROUP = [...REVIEW_S1, ...groupPair('rvg', reviewExit(0) - 3 * 3600_000)];

/** 偽の API: 取引の最上位の印からまとまり（#268。4.8 の形。時刻の写しは取引から） */
export function groupsOf(trades) {
  const by = new Map();
  for (const t of trades) {
    if (!t.positionGroupId) continue;
    const list = by.get(t.positionGroupId) ?? [];
    list.push({
      tradeId: t.id,
      role: t.groupRole ?? 'main',
      entryTime: t.record.entries[0]?.time ?? t.record.exit.time,
      exitTime: t.record.exit.time,
    });
    by.set(t.positionGroupId, list);
  }
  return [...by].map(([id, members]) => ({
    id,
    schemaVersion: 1,
    members,
    createdAt: 1700000003000,
    updatedAt: 1700000003000,
  }));
}
/** S4 の取り込んだ取引 2 件（A −1.0R・B −1.3R） */
export const REVIEW_IMPORTS = [
  reviewTrade(1, 'rv-i1', 99.5, {}, 'import'),
  reviewTrade(2, 'rv-i2', 99.35, { lcMove: { kind: 'widened', after: 99.3 } }, 'import'),
];
/** S2: 判定の出た取引 3 件（A 1・B 2） */
/**
 * ホームの今月の規律（#128）の取引: S1 の 7 件の決済を今日の 0:01〜0:07 に寄せる（月の初めに流しても今月に入る）。
 * 直近の流れの点 10 個は TX_H1（7 件）と合わせて出す
 */
export function homeMonthTrades() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return REVIEW_S1.map((x, i) => ({
    ...x,
    record: { ...x.record, exit: { ...x.record.exit, time: start + (i + 1) * 60_000 } },
  }));
}
export const REVIEW_S2 = REVIEW_S1.slice(0, 3);
/** 差が無い期間（S1 から 3 番の B を除く） */
export const REVIEW_NOGAP = REVIEW_S1.filter((t) => t.id !== 'rv-3');
/** 差も曲線の外の取引も無い期間（「崩れなし ±0.0R」） */
export const REVIEW_CLEAN = REVIEW_S1.filter((t) => t.id !== 'rv-3' && t.id !== 'rv-5');
/** 今日から 120 日前に決済した取引だけ（1 日・7 日・1 か月・3 か月はどれも 0 件） */
export const REVIEW_OLD = REVIEW_S1.map((t) => ({
  ...t,
  record: { ...t.record, exit: { ...t.record.exit, time: reviewExit(120) } },
}));
/** 大きな負け（LC を広げて −8.0R の B）が 1 件ある期間 */
export const REVIEW_BIG = [
  ...REVIEW_S1,
  reviewTrade(6, 'rv-big', 96, { lcMove: { kind: 'widened', after: 95.5 } }),
];
/**
 * 振り返りの気づき（#162）の心理ごとの集計の取引（架空の値。Issue の例 E1 の形）: 平常心 5 件（A 3・計画どおりの勝ち 2）、
 * 取り戻したい 5 件（B 3・危ない勝ち 1・C 1）、ほかは 1〜2 件（件数が少ない行。長めの名前も入れる）、タグなし 1 件
 */
export const withTags = (t, tags) => ({ ...t, emotionTags: tags });
export const REVIEW_INSIGHT = [
  withTags(reviewTrade(0, 'rvi-1', 99.5), ['calm']),
  withTags(reviewTrade(0, 'rvi-2', 99.55), ['calm']),
  withTags(reviewTrade(1, 'rvi-3', 101), ['calm']),
  withTags(reviewTrade(1, 'rvi-4', 99.5), ['calm']),
  withTags(reviewTrade(2, 'rvi-5', 100.75), ['calm']),
  withTags(reviewTrade(2, 'rvi-6', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }), [
    'wantPosition',
    'recoup',
  ]),
  withTags(reviewTrade(3, 'rvi-7', 99, { lcMove: { kind: 'widened', after: 99 } }), ['recoup']),
  withTags(reviewTrade(3, 'rvi-8', 100.5, { timeframeChange: 'longer' }), [
    'overconfident',
    'recoup',
  ]),
  withTags(reviewTrade(4, 'rvi-9', 99, { lc: undefined, lcDecidedBeforeEntry: false }), [
    'recoup',
    'cantCut',
  ]),
  reviewTrade(4, 'rvi-10', 99.5),
  withTags(reviewTrade(5, 'rvi-11', 99.4, { lcMove: { kind: 'widened', after: 99.4 } }), [
    'fomo',
    'recoup',
    'confirmation',
  ]),
  withTags(reviewTrade(6, 'rvi-12', 99.5), ['lossAversion']),
  withTags(reviewTrade(6, 'rvi-13', 100.6), ['lossAversion']),
];
/**
 * 名前の長い心理が値の出る行になる期間（#162 のデザインレビュー）: 乗り遅れ怖い 5 件（B 2・A 3）・都合よく解釈 5 件（A 4・C 1）と、
 * 件数の少ない平常心 2 件（平常心は件数が少なくても基準の場所に出る）
 */
export const REVIEW_INSIGHT_LONG = [
  ...[0, 1, 2, 3, 4].map((i) =>
    withTags(
      reviewTrade(
        i,
        `rvl-f${i}`,
        i < 2 ? 99.2 : 99.5,
        i < 2 ? { lcMove: { kind: 'widened', after: 99.2 } } : {},
      ),
      ['fomo'],
    ),
  ),
  ...[0, 1, 2, 3, 4].map((i) =>
    withTags(
      reviewTrade(
        i,
        `rvl-c${i}`,
        99.5,
        i === 4 ? { lc: undefined, lcDecidedBeforeEntry: false } : {},
      ),
      ['confirmation'],
    ),
  ),
  withTags(reviewTrade(5, 'rvl-k1', 101), ['calm']),
  withTags(reviewTrade(6, 'rvl-k2', 99.5), ['calm']),
];
/**
 * 気づきの Good / More（#221）の取引（架空の値）: REVIEW_INSIGHT に Good / More を足す。More = 数量が多すぎた 5 件（値の出る行）・
 * 名前の長い話題 1〜2 件・自分で書いた行、Good = ルールどおりに動けた 5 件・早めに撤退できた 3 件・自分で書いた行
 */
export const withReflection = (t, good, more, notes = {}) => ({
  ...t,
  reflection: {
    good: { topics: good, notes: notes.good ?? [] },
    more: { topics: more, notes: notes.more ?? [] },
  },
});
export const REFLECT_PLAN = {
  'rvi-1': [['cutEarly', 'followedRules'], []],
  'rvi-2': [['cutEarly', 'followedRules'], [], { good: ['前提が崩れたので LC の前に決済した'] }],
  'rvi-3': [['followedRules', 'letProfitRun'], []],
  'rvi-4': [['cutEarly', 'followedRules'], []],
  'rvi-5': [['followedRules'], []],
  'rvi-6': [[], ['enteredEarly', 'oversized']],
  'rvi-7': [[], ['oversized', 'againstHigherTf']],
  'rvi-8': [[], ['oversized']],
  'rvi-9': [[], ['oversized', 'noExitPlan']],
  'rvi-11': [
    [],
    ['oversized', 'againstHigherTf', 'reEntered'],
    {
      more: [
        '入る前に数量を 1R から逆算して、許容リスクを超える分は入らない',
        '同じ日に 2 回目は入らない',
      ],
    },
  ],
};
export const REVIEW_REFLECT = REVIEW_INSIGHT.map((t) => {
  const plan = REFLECT_PLAN[t.id];
  return plan ? withReflection(t, plan[0], plan[1], plan[2]) : t;
});
/**
 * 振り返りの「何で崩れたか」の崩れ方（#239・C68）の取引（架空の値）: REVIEW_REFLECT に崩れの取引を 4 件足す。LC を広げた 5 件（値の出る
 * 行。rvi-6・rvi-7・rvi-11 と rvr-1・rvr-2）、件数が少ない行に 時間足を変えた・LC を決めずに入った・持ち続けた・過剰リスク（数量 50,000 →
 * 2.5%）・逆指値を取消・金額ありき。2 つ以上の崩れ方の取引があるので重なりの 1 行も出る
 */
export const REVIEW_REASON = [
  ...REVIEW_REFLECT,
  reviewTrade(1, 'rvr-1', 99, { lcMove: { kind: 'widened', after: 99.2 } }),
  reviewTrade(2, 'rvr-2', 99.3, {
    lcMove: { kind: 'widened', after: 99.3 },
    entries: [{ price: 100, quantity: 50000 }],
    statementPnlYen: -35000,
  }),
  reviewTrade(4, 'rvr-3', 99.5, { lcMove: { kind: 'cancelled' } }),
  reviewTrade(5, 'rvr-4', 99.75, { lcBasis: 'amount' }),
];
/** 期間の取引（#185）の状態ごとの題 */
export const REVIEW_TRADES_TITLE = {
  'review-trades': '取り戻したい',
  'review-trades-streak': '連勝の後',
  'review-trades-empty': '期間の取引',
  'review-trades-topic': '数量が多すぎた',
  'review-trades-notes': 'More の自分で書いた行',
  'review-trades-off': '崩れの取引',
  'review-trades-reason': 'LC を広げた',
};
/**
 * 連勝の後（#185）の取引（架空の値。Issue の例 B3 の形）: 決済の古い順に W W B W W A W W B W W A W W A の 15 件（W = 計画どおりの
 * 勝ち +1.0R）。連勝の後は 3・6・9・12・15 件目の 5 件（60%・崩れで −1.5R）。3・9 件目に「調子に乗った」。決済は 7 日の中で 1 分ずつ
 */
export const REVIEW_STREAK = Array.from({ length: 15 }, (_, k) => {
  const n = k + 1;
  const off = n % 3 === 0;
  const price = !off ? 100.5 : n === 3 ? 99.25 : n === 9 ? 99 : n === 15 ? 99.6 : 99.5;
  const over = n === 3 || n === 9 ? { lcMove: { kind: 'widened', after: price } } : {};
  const t = reviewTrade(0, `rvs-${n}`, price, over);
  const traded = {
    ...t,
    createdAt: 1700000002000 + n,
    record: { ...t.record, exit: { ...t.record.exit, time: reviewExit(5) + n * 60_000 } },
  };
  return n === 3 || n === 9 ? withTags(traded, ['overconfident']) : traded;
});
/** 取引の多い期間（合成 120 件。決済は今日から 0〜84 日前。10 件に 1 件が LC を広げた −1.5R の B） */
export const REVIEW_MANY = Array.from({ length: 120 }, (_, i) => {
  const daysAgo = Math.floor((119 - i) * 0.7);
  const price = i % 10 === 0 ? 99.25 : i % 3 === 0 ? 99.5 : 100.4;
  return exampleTrade(`rv-m${i}`, 1700000100000 + i, {
    exit: {
      time: reviewExit(daysAgo) + (i % 5) * 60000,
      price,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    statementPnlYen: Math.round((price - 100) * 10000),
    ...(i % 10 === 0 ? { lcMove: { kind: 'widened', after: 99.2 } } : {}),
  });
});
/** #47 PR-2: JPY の口座 × USD 建て・為替 150 の取引（詳細の外貨建ての測りで一時だけ足す。架空の値） */
/** Issue #89: エントリー時・決済時 + 追加のチャート 5 枚（一言の有り無し・時間足の有り無しを混ぜる。値は架空） */
export const CHART_META = { contentType: 'image/png', size: 1 };
export const TX_C7 = exampleTrade(
  'x-c7',
  1700000000040,
  {
    ...D1_RECORD,
    exitChartTimeframe: '1d',
    extraCharts: [
      { slot: 'x2', timeframe: '1w', note: '上位足の環境（週足の高値の下）' },
      { slot: 'x1', timeframe: '15m', note: '下位足のタイミング' },
      { slot: 'x3' },
      { slot: 'x5', note: '指標の予定の画面' },
      { slot: 'x4', timeframe: '1h' },
    ],
  },
  {
    charts: Object.fromEntries(
      ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5'].map((slot) => [slot, CHART_META]),
    ),
  },
);

/** 実際の桁の架空の銘柄と取引（#164 のレビュー。編集の画面の要約を測る）。値は架空 */
export const FAKE_REAL = {
  ...FAKE_US30,
  id: 'inst-real',
  name: '架空ミニ指数先物 26/12',
  multiplier: 1000,
};
export const TX_REAL = exampleTrade(
  'x-real',
  1700000000031,
  {
    instrumentId: FAKE_REAL.id,
    lc: 61180,
    entries: [{ price: 61234.5, quantity: 1 }],
    exit: {
      time: T_1110,
      price: 61139.5,
      orderType: 'unknown',
      reason: 'lc',
      gapSlip: 'unanswered',
    },
    statementPnlYen: -95000,
  },
  { snapshot: { ...SNAP, instrument: { ...SNAP.instrument, multiplier: 1000 } } },
);
export const TX_FX = exampleTrade(
  'x-fx',
  1700000000021,
  {
    instrumentId: 'inst-usd',
    entries: [{ price: 100, quantity: 100 }],
    exit: { ...rulerExit(30, 99.5, 'lc'), fxRate: 150 },
    statementPnlYen: undefined,
  },
  {
    snapshot: {
      ...SNAP,
      instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
      accountCurrency: 'JPY',
    },
  },
);
/** 心理のタグの付いた取引（#156。外貨建ての取引の写しに 3 つ。一覧の順） */
export const TX_EMO = {
  ...TX_FX,
  id: 'x-emo',
  emotionTags: ['wantPosition', 'overconfident', 'recoup'],
};
/** #123: Good / More の付いた取引（話題と自分で書いた行。架空の文） */
export const TX_REFL = {
  ...TX_FX,
  id: 'x-refl',
  emotionTags: ['fomo'],
  reflection: {
    good: { topics: ['cutEarly', 'readRight'], notes: [] },
    more: {
      topics: ['enteredEarly', 'againstHigherTf', 'lcTooTight'],
      notes: [
        '入る前に TP と出口を決め、上位足の向きを確かめてから入る',
        '架空の長い一言: 刈られた直後に同じ根拠で入り直さず、次の足の確定まで待つことを決まりにする',
      ],
    },
  },
};
/**
 * #248: 「なぜ」のカード（C69）。x-d1 と同じ B（LC を広げた）で、心理も Good / More も無く、総評は空の行で始まる長い 2 行
 * （題「なぜ崩れたか」・案内の 1 行・総評の添えは先頭の 1 行を 2 行で切る。架空の文）
 */
export const TX_WHY = exampleTrade('x-why', 1700000000023, {
  ...D1_RECORD,
  exit: {
    ...D1_RECORD.exit,
    review:
      '\n架空の総評: 押し目の安値を割ったのに、戻ると思って LC を広げた。根拠が崩れたら切る、を入る前に決めておく。次の取引から逆指値を先に置いてから入る\n架空の 2 行目',
  },
});
/** #248（AC-7 の W1）: x-d1 と同じ B に心理と Good / More の両側（More → Good で並ぶ。架空の文） */
export const TX_WHY_W1 = exampleTrade(
  'x-why-w1',
  1700000000024,
  { ...D1_RECORD },
  {
    emotionTags: ['recoup'],
    reflection: {
      good: { topics: ['readRight'], notes: [] },
      more: {
        topics: ['enteredEarly', 'againstHigherTf'],
        notes: ['架空の一言: 根拠が崩れたら広げずに切る'],
      },
    },
  },
);
/** #248（AC-7 の W5）: 取り込んだ C（LC なしの負け）と総評（案内の 1 行は出さない。架空の値） */
export const TX_WHY_W5 = exampleTrade('x-why-w5', 1700000000025, {
  source: 'import',
  lc: undefined,
  lcBasis: undefined,
  lcDecidedBeforeEntry: false,
  exit: { ...D1_RECORD.exit, price: 98.75, review: '【取り込み】元の判定 C' },
  statementPnlYen: -12500,
});
/** #47 PR-2: USD の口座・USD 建ての取引（明細の損益 −51.50 USD・手数料 1.50 USD。詳細の測りで一時だけ足す。架空の値） */
export const TX_FXU = exampleTrade(
  'x-fxu',
  1700000000022,
  {
    instrumentId: 'inst-usd',
    accountId: 'acc-usd',
    entries: [{ price: 100, quantity: 100 }],
    exit: rulerExit(31, 99.5, 'lc'),
    statementPnlYen: -51.5,
    fees: [{ amountYen: 1.5 }],
  },
  {
    snapshot: {
      ...SNAP,
      instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
      capitalYen: 10000,
      accountCurrency: 'USD',
    },
  },
);
/** H1: 決済の時刻の違う 7 件（新しい方から 2 件目が危ない勝ち = L3 の形） */
export const TX_H1 = Array.from({ length: 7 }, (_, i) => {
  const base = i === 1 ? TX_L3 : TX_L1;
  return exampleTrade(`x-h${i}`, 1700000000010 + i, {
    ...base.record,
    exit: { ...base.record.exit, time: T_1110 - i * DAY_MS },
  });
});

/**
 * #176 LV1: いちばん長い値の取引（ui-guidelines 10.3「いちばん長い実際の桁で確かめる」）。価格は 6 桁 + 小数、銘柄は限月つきの
 * 長い名前、口座は長い名前、金額は 7 桁、判定の名前は最長の「計画どおりの勝ち」、決済は去年の大みそか 23:59（日本時間。年つきの
 * 日付）、追加のチャートは 40 字の一言 + 15 分足。値はすべて架空
 */
export const FAKE_LONG = {
  ...FAKE_US30,
  id: 'inst-long',
  name: '架空指数ミニ先物 2027年3月限（夜間）',
  multiplier: 100,
};
export const LV_EXIT = Date.UTC(2025, 11, 31, 14, 59);
export const LV_SNAP = {
  ...SNAP,
  instrument: { ...SNAP.instrument, multiplier: 100 },
  capitalYen: 98765432,
};
export const LV_NOTE =
  '架空の一言のメモ（上位足の高値の下で戻りを待ってから入った。指標の前で様子見た）';
export const TX_LV = [
  exampleTrade(
    'x-lv1',
    1700000000051,
    {
      instrumentId: FAKE_LONG.id,
      accountId: 'acc-long',
      lc: 123000.25,
      tp: 124567.75,
      entries: [{ price: 123456.75, quantity: 10 }],
      exit: { ...rulerExit(0, 124567.75, 'tp'), time: LV_EXIT },
      statementPnlYen: 1111000,
    },
    { snapshot: LV_SNAP },
  ),
  exampleTrade(
    'x-lv2',
    1700000000052,
    {
      instrumentId: FAKE_LONG.id,
      accountId: 'acc-long',
      side: 'S',
      lc: undefined,
      lcDecidedBeforeEntry: false,
      entries: [{ price: 123456.75, quantity: 10 }],
      exit: { ...rulerExit(0, 124691.25), time: LV_EXIT - 60000 },
      statementPnlYen: -1234567,
      entryChartTimeframe: '4h',
      exitChartTimeframe: '15m',
      extraCharts: [{ slot: 'x1', timeframe: '15m', note: LV_NOTE }],
    },
    {
      snapshot: LV_SNAP,
      charts: Object.fromEntries(['entry', 'exit', 'x1'].map((slot) => [slot, CHART_META])),
    },
  ),
  exampleTrade(
    'x-lv3',
    1700000000053,
    {
      instrumentId: FAKE_LONG.id,
      lc: 123000.25,
      lcMove: { kind: 'widened', after: 122876.5 },
      entries: [{ price: 123456.75, quantity: 10 }],
      exit: { ...rulerExit(0, 122876.5), time: LV_EXIT - 120000 },
      statementPnlYen: -580250,
    },
    { snapshot: LV_SNAP },
  ),
];
/**
 * 省略してよい所（ui-guidelines 10.3 の表。tests/ui/truncation-rules.test.ts の ALLOWED のうち、名前・上の帯・詳細の総評の添え）。
 * LV1 はこれ以外の要素で実際に「…」が出たら外れにする（保険の 2 つ = 下の帯の状態の文・Google のボタンも外れ）
 */
export const CUT_ALLOWED = [
  '.traderow__name',
  '.traderow__account',
  '.homerow__name',
  '.homerow__account',
  '.seg__note',
  '.seg__text',
  '.appbar__title',
  '.appbar__backlabel',
  '.dwhy__preview',
];

/** 架空のチャートの画像（無圧縮の画素を deflate した小さな PNG。縞の色で枠を見分ける） */
export function makePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const k = (x >> 3) % 2 === 0 ? 1 : 0.6;
      raw[row + 1 + x * 3] = Math.round(rgb[0] * k);
      raw[row + 2 + x * 3] = Math.round(rgb[1] * k);
      raw[row + 3 + x * 3] = Math.round(rgb[2] * k);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビットの深さ
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const CHART_PNG = {
  entry: makePng(480, 300, [40, 160, 120]),
  exit: makePng(480, 300, [200, 120, 40]),
  // 追加のチャート（Issue #89）
  x1: makePng(480, 300, [70, 110, 200]),
  x2: makePng(480, 300, [150, 80, 180]),
  x3: makePng(480, 300, [60, 150, 170]),
  x4: makePng(480, 300, [180, 160, 60]),
  x5: makePng(480, 300, [120, 120, 120]),
};
/** API の trade_sort_key と同じ並び（決済の時刻の新しい順 → 作った時刻の新しい順 → ID） */
export const tradeSort = (a, b) =>
  b.record.exit.time - a.record.exit.time ||
  b.createdAt - a.createdAt ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** API の order=created と同じ並び（作った時刻の新しい順 → ID の降順。Issue #87） */
export const createdSort = (a, b) =>
  b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// ── 偽の読み取りの応答の行（Issue #15 の例の表。値は架空。形は normalize_row と同じ 12 の鍵） ──
export const pad2 = (n) => String(n).padStart(2, '0');
export function jstTime(y, mo, d, h, mi) {
  const written = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
  return {
    written,
    timeZone: 'JST',
    jst: written,
    epochMs: Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600000,
  };
}
export const READ_E1 = {
  symbol: '架空指数A',
  side: 'L',
  entryPrice: 100,
  exitPrice: 99,
  quantity: 2,
  pnl: -2000,
  pnlCurrency: 'JPY',
  entryTime: jstTime(2026, 11, 10, 9, 5),
  exitTime: jstTime(2026, 11, 10, 10, 30),
  timeZoneNeedsCheck: false,
  fees: [100, 50],
  feesTotal: 150,
  exitOrderType: 'unknown',
};
/**
 * 明細の読み取りが終わって要約が出た印: 読めた最初の行は名前の上の完了の文（#166）、次の行・ほかは名前の右の札「読み取り」
 */
export const READ_DONE = '.rsum__status--done, .rsum__mark';
/**
 * 実際の桁の架空の明細の行（#164 のレビュー）: オーナーの例と同じ桁（6 万台・小数 1 桁、損益 6 桁、名前の長さ）。値は架空
 */
export const READ_REAL = {
  ...READ_E1,
  symbol: '架空ミニ指数先物 26/12',
  entryPrice: 61234.5,
  exitPrice: 61139.5,
  quantity: 1,
  pnl: -95000,
};
/** 3 行。行 1 は決済の時刻の時間帯が明細に無い（E9 + E10） */
export const READ_E10 = [
  {
    ...READ_E1,
    entryTime: null,
    exitTime: { written: '2026-11-10T10:30', timeZone: 'unknown', jst: null, epochMs: null },
    timeZoneNeedsCheck: true,
  },
  { ...READ_E1, symbol: '架空指数C', side: 'S', entryPrice: 200, exitPrice: 201.5, quantity: 1 },
  { ...READ_E1, symbol: '架空指数D', entryPrice: 50, exitPrice: 51, quantity: 3, pnl: 3000 },
];
export const SYNTHETIC_STATEMENT = 'tools/statement-eval/synthetic/s05.png';

/**
 * 文脈の /api/** を偽の記録の API に置き換える。opts.capitalYen（資金）、opts.failTrades（POST /api/trades の状態）、
 * opts.delayMs（POST /api/trades を待たせる）。返す api.posts で保存の要求を数える。
 * 設定（Issue #5）: api.settings は書き換えてよい（PUT /api/settings で変わる。資金が変わったときだけ履歴に足す）。
 * PUT /api/instruments/<id> は本文に無い欄を既定に戻し、名前が自分以外と同じなら 409。設定・銘柄の書き込みは api.writes に残す
 * POST /api/statement-reads は api.read（{ status, rows, holdMs }。後から書き換えてよい）で答え、要求の
 * Content-Type と本文のバイト列を api.reads に残す（このスクリプトの記憶の中だけ）。api.read.profile（#66。明細の特徴の
 * 鍵と提案の口座。省けば null）を応答に足す。PUT /api/statement-profiles/<鍵> は 204 で api.profiles に残す
 * 口座（Issue #47）: api.accounts（opts.accounts。書き換えてよい）。既定の口座 default（「口座 1」）が無ければ、口座を読む・使う
 * 入口で api.settings から作る（本物の移し替えと同じ）。取引の snapshot の資金・許容リスクは取引の口座から写し、PUT で口座を
 * 付け替えたときだけ付け替え先の今の値で写し直す。opts.failAccounts は PUT /api/accounts/<id> の状態
 * POST /api/chart-reads（Issue #27）は api.chartTimeframes の先頭から順に時間足を返す（無ければ null = 読めなかった）。
 * api.chartRead（{ status, kind, holdMs }。後から書き換えてよい）で状態・種類・待ちを変える。要求の数を api.chartReads に残す。
 * 返す時間足は要求が届いた時点で取り出す（待たせた後に取り出すと、画面を離れた後に目覚めた前の状態の要求が、次の状態の
 * 時間足を横取りする。#149）
 * 口座の通貨（Issue #47 PR-2）: 口座はいつも currency を返す（無い = JPY）。POST / PUT の currency は任意（PUT の省略は今のまま）。
 * 取引のある口座の通貨を変える PUT は 409 currencyLocked。取引の snapshot に口座の通貨（accountCurrency）を写す
 */
/** 心理のタグの一覧の順（core/emotion-tags.ts の EMOTION_TAG_IDS と同じ。偽の API が並べ直すのに使う。#156） */
export const EMOTION_ORDER = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/records/emotion-tags.json', import.meta.url), 'utf8'),
).ids;
/** Good / More の話題の一覧の順（core/reflection.ts の REFLECTION_TOPICS と同じ。偽の API が並べ直すのに使う。#123） */
export const REFLECTION_ORDER = JSON.parse(
  readFileSync(
    new URL('../../tests/fixtures/records/reflection-topics.json', import.meta.url),
    'utf8',
  ),
);

/**
 * 記録の保存の後: 心理のシート「記録しました」（#156）が開くのを待って ［あとで］ で閉じ、保存の後の画面の知らせを待つ
 * （シートは modal なので、閉じないと後ろの ［次の取引を記録］ などを押せない）
 */
export async function waitSaved(p, text) {
  const sheet = p.locator('#record-emotion-sheet[open]');
  await sheet.waitFor({ timeout: 10000 });
  await sheet.locator('.emotions__actions button').click();
  await p.locator('#record-emotion-sheet[open]').waitFor({ state: 'detached', timeout: 10000 });
  await p.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 10000 });
  // ［あとで］ で閉じた後のアプリの history.go を待つ（続けて goto・goBack を重ねない）
  await settleLayers(p);
}

export async function installFakeApi(context, opts = {}) {
  const api = {
    /** 心理のタグの選択肢に出さないタグ（#163） */
    emotionHidden: [],
    instruments: [FAKE_US30],
    trades: opts.trades
      ? [...opts.trades]
      : [fakeTrade('t-last', FAKE_US30.id, 2, 1700000100000), ...EXAMPLE_TRADES],
    /** 取引の PUT・DELETE・チャートの GET（Issue #9） */
    puts: [],
    /** 取引の一覧の GET のクエリ（Issue #87。件数・カーソル・並び） */
    tradeGets: [],
    /** 取引の一覧のページの応答を待たせる（ミリ秒。Issue #87 の読み込み中の確かめ） */
    tradesPageDelayMs: 0,
    /**
     * 保存の後のシートの候補の読み（#230。order=created・limit=100 の 1 ページだけ）の状態と、応答を止める Promise
     * （放すまで答えない。開いた後に届いても候補が入れ替わらないことを見る）
     */
    historyStatus: 200,
    historyGate: null,
    /** 決済の時刻の範囲の読み（Issue #88）の状態（200 以外 = 振り返りだけ失敗させる） */
    rangeStatus: 200,
    /** 決済の時刻の範囲の応答を待たせる（ミリ秒。読み込み中の状態を撮る） */
    rangeHoldMs: 0,
    deletes: [],
    chartGets: [],
    /** 取引の PUT のチャートの変更（Issue #89） */
    chartPuts: [],
    posts: [],
    chartPosts: [],
    read: { status: 200, rows: [READ_E1], holdMs: 0 },
    reads: [],
    profiles: [],
    chartTimeframes: [],
    chartRead: { status: 200, kind: 'chart', holdMs: 0 },
    chartReads: 0,
    settings: {
      capitalYen: opts.capitalYen ?? null,
      riskTolerancePct: 1,
      performanceUnit: 'R',
      capitalHistory: [],
    },
    writes: [],
    accounts: [...(opts.accounts ?? [])],
    /** GET /api/ai-usage の応答（Issue #62。{ status, body, holdMs }。後から書き換えてよい） */
    aiUsage: { status: 200, body: FAKE_AI_USAGE },
  };
  let seq = 0;
  let clock = 1800000000000;
  const settings = () => api.settings;
  /** 名前の同一視（API の name_key と同じ） */
  const nameKey = (n) => n.normalize('NFKC').toUpperCase().toLowerCase().trim();
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  /** 既定の口座が無ければ設定から作る（移し替え） */
  const ensureDefault = () => {
    if (api.accounts.some((a) => a.id === 'default')) return;
    const s = api.settings;
    api.accounts.push({
      id: 'default',
      name: '口座 1',
      capitalYen: s.capitalYen,
      riskTolerancePct: s.riskTolerancePct,
      capitalHistory: [...s.capitalHistory],
      createdAt: clock,
      updatedAt: clock,
    });
  };
  const sortedAccounts = () =>
    [...api.accounts].sort(
      (a, b) => cmp(nameKey(a.name), nameKey(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id),
    );
  const okCap = (cap) => cap === null || (typeof cap === 'number' && cap > 0);
  const okRisk = (risk) => typeof risk === 'number' && risk >= 0.5 && risk <= 3;
  const okCurrency = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
  const currencyOf = (a) => a.currency || 'JPY';
  const withCurrency = (a) => ({ ...a, currency: currencyOf(a) });
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    if (key === 'POST /api/statement-reads') {
      api.reads.push({
        contentType: req.headers()['content-type'] ?? '',
        body: req.postDataBuffer() ?? Buffer.alloc(0),
      });
      const r = api.read;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        return await json(
          route,
          r.status,
          r.status === 200
            ? { kind: 'statement', rows: r.rows, profile: r.profile ?? null }
            : { error: 'read_unavailable', detail: 'SECRET-本文' },
        );
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    // 心理のタグ（Issue #156。形は routes.py の put_trade_emotions: 取引の集合のタグを置き換え、空なら鍵ごと消す）
    if (key === 'PUT /api/trade-emotions') {
      const b = JSON.parse(req.postData() ?? '{}');
      const ids = Array.isArray(b.tradeIds) ? b.tradeIds : [];
      const idx = ids.map((id) => api.trades.findIndex((t) => t.id === id));
      if (ids.length === 0 || idx.some((i) => i < 0))
        return json(route, 404, { error: 'not_found' });
      const tags = EMOTION_ORDER.filter((t) => (b.tags ?? []).includes(t));
      for (const i of idx) {
        const { emotionTags: _old, ...rest } = api.trades[i];
        api.trades[i] = tags.length > 0 ? { ...rest, emotionTags: tags } : rest;
      }
      return json(route, 200, { tags });
    }
    // Good / More（Issue #123。形は routes.py の put_trade_reflections: 取引の集合の Good / More を置き換え、両側とも空なら鍵ごと消す）
    if (key === 'PUT /api/trade-reflections') {
      const b = JSON.parse(req.postData() ?? '{}');
      const ids = Array.isArray(b.tradeIds) ? b.tradeIds : [];
      const idx = ids.map((id) => api.trades.findIndex((t) => t.id === id));
      if (ids.length === 0 || idx.some((i) => i < 0))
        return json(route, 404, { error: 'not_found' });
      const part = (side) => ({
        topics: REFLECTION_ORDER[side].filter((t) => (b[side]?.topics ?? []).includes(t)),
        notes: (b[side]?.notes ?? []).map((n) => String(n).trim()),
      });
      const saved = { good: part('good'), more: part('more') };
      const empty = ['good', 'more'].every(
        (s) => saved[s].topics.length === 0 && saved[s].notes.length === 0,
      );
      for (const i of idx) {
        const { reflection: _old, ...rest } = api.trades[i];
        api.trades[i] = empty ? rest : { ...rest, reflection: saved };
      }
      return json(route, 200, saved);
    }
    const profileM = /^\/api\/statement-profiles\/([0-9a-f]{32})$/.exec(path);
    if (req.method() === 'PUT' && profileM) {
      api.profiles.push({ key: profileM[1], body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ status: 204 });
    }
    if (key === 'POST /api/chart-reads') {
      api.chartReads++;
      const r = api.chartRead;
      // 時間足は届いた時点で取り出す（#149。「チャートの読み取り中」の状態は 20 秒待たせたまま次の状態へ移るので、待った後に
      // 取り出すと、同じ窓で後に流れる状態（「2 段目（読み取りの後・判定）」など）の時間足を横取りして、その状態が開けない）
      const timeframe =
        r.status === 200 && r.kind === 'chart' ? (api.chartTimeframes.shift() ?? null) : null;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        if (r.status !== 200) return await json(route, r.status, { error: 'read_unavailable' });
        return await json(route, 200, { kind: r.kind, timeframe });
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    // 取引の作成の multipart（#12）: 部分 record（JSON の文字）+ entryChart / exitChart（画像）
    const ctype = req.headers()['content-type'] ?? '';
    let body;
    let chartParts = null;
    let chartRemoves = [];
    if (ctype.startsWith('multipart/form-data')) {
      const fd = await new Response(req.postDataBuffer(), {
        headers: { 'Content-Type': ctype },
      }).formData();
      body = JSON.parse(String(fd.get('record')));
      chartParts = {};
      chartRemoves = fd.getAll('removeChart').map(String);
      for (const slot of ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5']) {
        const f = fd.get(`${slot}Chart`);
        if (f && typeof f !== 'string') {
          chartParts[slot] = { type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
        }
      }
      api.chartPosts.push({ parts: [...fd.keys()], charts: chartParts });
    } else {
      body = req.postData() ? JSON.parse(req.postData()) : undefined;
    }
    if (key === 'GET /api/trades') {
      // ページ分け（Issue #87。本物の trade_pages.py と同じ並びと切り出し。カーソルは並びの鍵の JSON）
      const q = new URL(req.url()).searchParams;
      api.tradeGets.push(q.toString());
      // 決済の時刻の範囲（Issue #88。本物の trade_range.py と同じ境目: 開始を含み終了を含まない。367 日まで）
      if (q.has('exitFrom') || q.has('exitTo')) {
        const from = Number(q.get('exitFrom'));
        const to = Number(q.get('exitTo'));
        if (!(from >= 0 && to > from && to - from <= 367 * 86400000) || q.has('limit')) {
          return json(route, 400, { error: 'invalid' });
        }
        if (api.rangeHoldMs) {
          await new Promise((ok) => {
            const t = setTimeout(ok, api.rangeHoldMs);
            t.unref?.();
          });
        }
        if (api.rangeStatus !== 200) {
          try {
            return await json(route, api.rangeStatus, { error: 'unavailable' });
          } catch {
            return undefined; // 待たせている間に画面を離れた
          }
        }
        const items = api.trades
          .filter((t) => t.record.exit.time >= from && t.record.exit.time < to)
          .sort(tradeSort);
        // 両建て（#266・#268）: 時刻の写しの幅が範囲と重なるまとまりと、範囲の外のメンバー（本物の routes.py と同じ）
        const groups = groupsOf(api.trades).filter((g) => {
          const lo = Math.min(...g.members.map((m) => m.entryTime));
          const hi = Math.max(...g.members.map((m) => m.exitTime));
          return lo < to && hi >= from;
        });
        const inRange = new Set(items.map((t) => t.id));
        const outside = new Set(
          groups.flatMap((g) => g.members.map((m) => m.tradeId)).filter((id) => !inRange.has(id)),
        );
        try {
          return await json(route, 200, {
            items: items.slice(0, 2000),
            truncated: items.length > 2000,
            positionGroups: groups,
            groupMembers: api.trades.filter((t) => outside.has(t.id)).sort(tradeSort),
          });
        } catch {
          return undefined; // 待たせている間に画面を離れた
        }
      }
      if (!q.has('limit')) return json(route, 200, { items: [...api.trades].sort(tradeSort) });
      const limit = Number(q.get('limit'));
      const order = q.get('order') ?? 'exit';
      if (!(limit >= 1 && limit <= 100) || (order !== 'exit' && order !== 'created')) {
        return json(route, 400, { error: 'invalid' });
      }
      if (order === 'created' && limit === 100) {
        if (api.historyGate) await api.historyGate;
        if (api.historyStatus !== 200) {
          try {
            return await json(route, api.historyStatus, { error: 'unavailable' });
          } catch {
            return undefined; // 待たせている間に画面を離れた
          }
        }
      }
      const cmp = order === 'exit' ? tradeSort : createdSort;
      const sorted = [...api.trades].sort(cmp);
      let start = 0;
      if (q.has('cursor')) {
        const k = JSON.parse(Buffer.from(q.get('cursor'), 'base64url').toString('utf8'));
        const at = { id: k.id, createdAt: k.c, record: { exit: { time: k.t } } };
        start = sorted.findIndex((t) => cmp(t, at) > 0);
        if (start < 0) start = sorted.length;
      }
      if (api.tradesPageDelayMs) await new Promise((ok) => setTimeout(ok, api.tradesPageDelayMs));
      const items = sorted.slice(start, start + limit);
      const last = items.at(-1);
      const next =
        start + limit < sorted.length && last
          ? Buffer.from(
              JSON.stringify({ t: last.record.exit.time, c: last.createdAt, id: last.id }),
            ).toString('base64url')
          : null;
      return json(route, 200, { items, next });
    }
    // 取引 1 件・チャート（Issue #9。形は routes.py の get_trade / update_trade / delete_trade / get_chart）
    const chartM = /^\/api\/trades\/([^/]+)\/charts\/([^/]+)$/.exec(path);
    if (chartM && req.method() === 'GET') {
      const id = decodeURIComponent(chartM[1]);
      api.chartGets.push(`${id}-${chartM[2]}`);
      const t = api.trades.find((x) => x.id === id);
      const png = CHART_PNG[chartM[2]];
      if (!t?.charts?.[chartM[2]] || !png) return json(route, 404, { error: 'not_found' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    const tradeM = /^\/api\/trades\/([^/]+)$/.exec(path);
    if (tradeM) {
      const id = decodeURIComponent(tradeM[1]);
      const idx = api.trades.findIndex((x) => x.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      const prev = api.trades[idx];
      if (req.method() === 'GET') return json(route, 200, prev);
      if (req.method() === 'DELETE') {
        api.deletes.push(id);
        api.trades.splice(idx, 1);
        return route.fulfill({ status: 204, body: '' });
      }
      if (req.method() === 'PUT') {
        // ?snapshot=current（#31）: 銘柄・口座が同じでも今の値で写し直す（routes.py の update_trade と同じ）
        const query = new URL(req.url()).search;
        const resnap = query === '?snapshot=current';
        api.puts.push({ id, body, query });
        const inst = api.instruments.find((i) => i.id === body.instrumentId);
        if (!inst) return json(route, 400, { error: 'invalid' });
        // チャートの変更（Issue #89。multipart の PUT: 差し替え・足す画像 + 外す枠）。直した後の枠で時間足を見る
        const nextCharts = {};
        for (const slot of ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5']) {
          if (chartParts?.[slot])
            nextCharts[slot] = { contentType: chartParts[slot].type, size: 1 };
          else if (prev.charts?.[slot] && !chartRemoves.includes(slot))
            nextCharts[slot] = prev.charts[slot];
        }
        api.chartPuts.push({ id, parts: Object.keys(chartParts ?? {}), removes: chartRemoves });
        for (const slot of ['entry', 'exit']) {
          if (body[`${slot}ChartTimeframe`] !== undefined && !nextCharts[slot]) {
            return json(route, 400, { error: 'invalid', issues: [{ kind: 'noChart' }] });
          }
        }
        // 口座を付け替えたときだけ、付け替え先の今の資金・許容リスクで写し直す（本文に口座が無ければ前の口座のまま）
        const prevAcc = prev.record.accountId || 'default';
        const target = body.accountId ?? prevAcc;
        let moved = null;
        if (resnap || target !== prevAcc) {
          ensureDefault();
          moved = api.accounts.find((a) => a.id === target);
          if (!moved) return json(route, 400, { error: 'invalid' });
        }
        clock += 1;
        const changed = resnap || inst.id !== prev.record.instrumentId;
        const snap = changed
          ? {
              ...prev.snapshot,
              instrument: {
                multiplier: inst.multiplier,
                quantityStep: inst.quantityStep,
                priceCurrency: inst.priceCurrency,
                underlyingKind: inst.underlyingKind,
                productForm: inst.productForm,
              },
            }
          : prev.snapshot;
        const { charts: _prevCharts, ...prevRest } = prev;
        const next = {
          ...prevRest,
          ...(Object.keys(nextCharts).length > 0 ? { charts: nextCharts } : {}),
          updatedAt: clock,
          snapshot: moved
            ? {
                ...snap,
                capitalYen: moved.capitalYen,
                riskTolerancePct: moved.riskTolerancePct,
                accountCurrency: currencyOf(moved),
              }
            : snap,
          record:
            body.accountId === undefined && prev.record.accountId !== undefined
              ? { ...body, accountId: prev.record.accountId }
              : body,
        };
        api.trades[idx] = next;
        return json(route, 200, next);
      }
    }
    if (key === 'GET /api/accounts') {
      ensureDefault();
      return json(route, 200, { items: sortedAccounts().map(withCurrency) });
    }
    if (key === 'POST /api/accounts') {
      api.writes.push({ key, body });
      ensureDefault();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const cap = body.capitalYen ?? null;
      const risk = body.riskTolerancePct ?? 1;
      const currency = body.currency ?? 'JPY';
      if (name === '' || !okCap(cap) || !okRisk(risk) || !okCurrency(currency))
        return json(route, 400, { error: 'invalid' });
      if (api.accounts.some((a) => nameKey(a.name) === nameKey(name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const acc = {
        id: `acc-${++seq}`,
        name,
        currency,
        capitalYen: cap,
        riskTolerancePct: risk,
        capitalHistory: cap === null ? [] : [{ valueYen: cap, at: clock, currency }],
        createdAt: clock,
        updatedAt: clock,
      };
      api.accounts.push(acc);
      return json(route, 201, acc);
    }
    const accountM = /^\/api\/accounts\/([^/]+)$/.exec(path);
    if (accountM) {
      ensureDefault();
      const id = decodeURIComponent(accountM[1]);
      const idx = api.accounts.findIndex((a) => a.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      const prev = api.accounts[idx];
      if (req.method() === 'GET') return json(route, 200, withCurrency(prev));
      if (req.method() === 'PUT') {
        api.writes.push({ key, body });
        if (opts.failAccounts) return json(route, opts.failAccounts, { error: 'unavailable' });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const prevCurrency = currencyOf(prev);
        const currency = body.currency ?? prevCurrency;
        if (
          name === '' ||
          !okCap(body.capitalYen) ||
          !okRisk(body.riskTolerancePct) ||
          !okCurrency(currency)
        ) {
          return json(route, 400, { error: 'invalid' });
        }
        if (
          currency !== prevCurrency &&
          api.trades.some((t) => (t.record.accountId || 'default') === id)
        ) {
          return json(route, 409, { error: 'conflict', reason: 'currencyLocked' });
        }
        if (api.accounts.some((a) => a.id !== id && nameKey(a.name) === nameKey(name))) {
          return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
        }
        clock += 1;
        const next = {
          id,
          name,
          currency,
          capitalYen: body.capitalYen,
          riskTolerancePct: body.riskTolerancePct,
          capitalHistory:
            body.capitalYen === prev.capitalYen && currency === prevCurrency
              ? prev.capitalHistory
              : [...prev.capitalHistory, { valueYen: body.capitalYen, at: clock, currency }],
          createdAt: prev.createdAt,
          updatedAt: clock,
        };
        api.accounts[idx] = next;
        return json(route, 200, next);
      }
    }
    if (key === 'GET /api/instruments') return json(route, 200, { items: api.instruments });
    if (key === 'GET /api/settings') return json(route, 200, settings());
    // 心理のタグの選択肢の設定（#163。形は routes.py の get / put_emotion_settings。丸ごと置き換え）
    if (key === 'GET /api/settings/emotion-tags') {
      return json(route, 200, { hidden: api.emotionHidden });
    }
    if (key === 'PUT /api/settings/emotion-tags') {
      api.writes.push({ key, body });
      api.emotionHidden = Array.isArray(body?.hidden) ? body.hidden : [];
      return json(route, 200, { hidden: api.emotionHidden });
    }
    if (key === 'POST /api/instruments') {
      api.writes.push({ key, body });
      if (api.instruments.some((i) => nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const inst = {
        id: `inst-${++seq}`,
        name: body.name.trim(),
        underlyingKind: 'other',
        productForm: 'spotCfd',
        priceCurrency: null,
        multiplier: 1,
        quantityStep: 1,
        createdAt: clock,
        updatedAt: clock,
      };
      api.instruments.push(inst);
      return json(route, 201, inst);
    }
    if (key === 'PUT /api/settings') {
      api.writes.push({ key, body });
      if (opts.failSettings) return json(route, opts.failSettings, { error: 'unavailable' });
      const cap = body.capitalYen;
      const risk = body.riskTolerancePct;
      if (
        !(cap === null || (typeof cap === 'number' && cap > 0)) ||
        !(typeof risk === 'number' && risk >= 0.5 && risk <= 3) ||
        !['R', 'yen'].includes(body.performanceUnit)
      ) {
        return json(route, 400, { error: 'invalid' });
      }
      clock += 1;
      const cur = api.settings;
      api.settings = {
        capitalYen: cap,
        riskTolerancePct: risk,
        performanceUnit: body.performanceUnit,
        capitalHistory:
          cap === cur.capitalYen
            ? cur.capitalHistory
            : [...cur.capitalHistory, { valueYen: cap, at: clock }],
      };
      return json(route, 200, api.settings);
    }
    if (req.method() === 'PUT' && path.startsWith('/api/instruments/')) {
      api.writes.push({ key, body });
      const id = decodeURIComponent(path.slice('/api/instruments/'.length));
      const idx = api.instruments.findIndex((i) => i.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      if (api.instruments.some((i) => i.id !== id && nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const prev = api.instruments[idx];
      const next = {
        id,
        name: body.name.trim(),
        ...(body.underlying === undefined ? {} : { underlying: body.underlying }),
        underlyingKind: body.underlyingKind ?? 'other',
        productForm: body.productForm ?? 'spotCfd',
        priceCurrency: body.priceCurrency ?? null,
        multiplier: body.multiplier ?? 1,
        quantityStep: body.quantityStep ?? 1,
        createdAt: prev.createdAt,
        updatedAt: clock,
      };
      api.instruments[idx] = next;
      return json(route, 200, next);
    }
    if (key === 'POST /api/trades') {
      api.posts.push(body);
      if (opts.delayMs) await new Promise((ok) => setTimeout(ok, opts.delayMs));
      if (opts.failTrades) return json(route, opts.failTrades, { error: 'unavailable' });
      const inst = api.instruments.find((i) => i.id === body.instrumentId);
      if (!inst) return json(route, 400, { error: 'invalid' });
      // 資金・許容リスクは取引の口座（無ければ既定の口座）から写す（#47）
      ensureDefault();
      const s = api.accounts.find((a) => a.id === (body.accountId || 'default'));
      if (!s) return json(route, 400, { error: 'invalid' });
      clock += 1;
      const stored = {
        id: `trade-${++seq}`,
        schemaVersion: 1,
        createdAt: clock,
        updatedAt: clock,
        snapshot: {
          instrument: {
            multiplier: inst.multiplier,
            quantityStep: inst.quantityStep,
            priceCurrency: inst.priceCurrency,
            underlyingKind: inst.underlyingKind,
            productForm: inst.productForm,
          },
          capitalYen: s.capitalYen,
          riskTolerancePct: s.riskTolerancePct,
          accountCurrency: currencyOf(s),
        },
        record: body,
        ...(chartParts && Object.keys(chartParts).length > 0
          ? {
              charts: Object.fromEntries(
                Object.entries(chartParts).map(([k, v]) => [
                  k,
                  { contentType: v.type, size: v.bytes.length },
                ]),
              ),
            }
          : {}),
      };
      api.trades.push(stored);
      return json(route, 201, stored);
    }
    if (key === 'GET /api/ai-usage') {
      const u = api.aiUsage;
      if (u.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, u.holdMs);
          t.unref?.();
        });
      }
      try {
        return await json(route, u.status, u.body);
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    if (key === 'GET /api/export') {
      // データの書き出し（#167。本物の export.export_body と同じ形: 一覧の API と同じ形・並びの設定・口座・銘柄・取引）
      ensureDefault();
      api.exportGets = (api.exportGets ?? 0) + 1;
      return json(route, 200, {
        format: 'loss-note-export',
        version: 1,
        exportedAt: clock,
        settings: settings(),
        emotionTagSettings: { hidden: [...(api.emotionHidden ?? [])] },
        accounts: sortedAccounts().map(withCurrency),
        instruments: api.instruments,
        trades: [...api.trades].sort(
          (x, y) =>
            y.record.exit.time - x.record.exit.time ||
            y.createdAt - x.createdAt ||
            (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
        ),
      });
    }
    if (key === 'GET /api/health') return json(route, 200, { status: 'ok' });
    return json(route, 404, { error: 'not_found' });
  });
  return api;
}

/** 記録する画面を開き、入力の欄が出るまで待つ */
/** 開いたページで出たダイアログの種類（beforeunload を受けた数を DR1 が見る。#75） */
export const dialogsSeen = [];

/** 口座の例（Issue #47。名前・値はすべて架空） */
export const acct = (id, name, capitalYen, riskTolerancePct = 1, currency = 'JPY') => ({
  id,
  name,
  currency,
  capitalYen,
  riskTolerancePct,
  capitalHistory: capitalYen === null ? [] : [{ valueYen: capitalYen, at: 1799000000000 }],
  createdAt: 1799000000000,
  updatedAt: 1799000000000,
});
export const ACC_ONE = acct('default', '口座 1', 1000000);
export const ACC_B = acct('acc-b', '口座 B', 200000);
export const ACC_C = acct('acc-c', '口座 C', null);
export const ACC_D = acct('acc-d', '口座 D', 500000);
export const ACC_LONG = acct(
  'acc-long',
  '架空の長い名前の口座 B（長期の積み立てと短期の売買）',
  200000,
);
/** USD の口座（#47 PR-2。架空の値） */
export const ACC_USD = acct('acc-usd', '口座 D', 10000, 1, 'USD');
export const ACCOUNTS_2 = [ACC_ONE, ACC_B];
export const ACCOUNTS_3_LONG = [ACC_ONE, ACC_LONG, ACC_C];
export const ACCOUNTS_4 = [ACC_ONE, ACC_B, ACC_C, ACC_D];
/** 偽の API の口座を入れ替える（空 = 既定の口座を設定から作り直す） */
/** 明細の特徴（#66）: 提案の口座の ID は API の ID の形（英数だけ） */
/** 状態の中の確かめ（外れたら投げる = その状態は「開けない」） */
export const mustEq = (got, want, what) => {
  if (got !== want)
    throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
};
export const ACCOUNTS_ALNUM = [ACC_ONE, { ...ACC_B, id: 'accB' }];
export const PROFILE_NEW = { key: 'd'.repeat(32), accountId: null };
export const PROFILE_B = { key: 'c'.repeat(32), accountId: 'accB' };
export const READ_USD = { ...READ_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' };
export const setAccounts = (api, list) => api.accounts.splice(0, api.accounts.length, ...list);
/** EUR 建ての架空の銘柄（#47 PR-2） */
export const FAKE_EUR_IDX = {
  ...FAKE_US30,
  id: 'inst-eur',
  name: '架空指数E',
  priceCurrency: 'EUR',
};
/** USD 建ての架空の銘柄（#47 PR-2）を一覧に足す（何度呼んでも 1 つ） */
export const FAKE_USD_IDX = {
  ...FAKE_US30,
  id: 'inst-usd',
  name: '架空指数U',
  priceCurrency: 'USD',
};
export const withUsdInstrument = (api) => {
  if (!api.instruments.some((i) => i.id === FAKE_USD_IDX.id)) api.instruments.push(FAKE_USD_IDX);
};

// ── 設定の画面（Issue #5 の E16）。値はすべて架空 ──
export const FAKE_N225 = {
  ...FAKE_US30,
  id: 'inst-n225',
  name: '日経225',
  underlying: '架空指数',
  priceCurrency: 'JPY',
};
export const FAKE_XAU = {
  ...FAKE_US30,
  id: 'inst-xau',
  name: 'XAU',
  underlyingKind: 'commodity',
  priceCurrency: 'USD',
  multiplier: 100,
  quantityStep: 0.01,
};
/**
 * AI の利用状況（Issue #62。架空の値）: 今日 3 回・0.12 USD、今月（18 日まで）41 回・0.96 USD、既定の上限。
 * 状態の値は、今月 ≥ 今日・今月の回数 ≤ 1 日の上限 × 経過日数の範囲にそろえる（ありえない数を写さない）
 */
export const FAKE_AI_USAGE = {
  today: { date: '2026-11-18', count: 3, microUsd: 120000 },
  month: { month: '2026-11', count: 41, microUsd: 960000 },
  limits: { count: 30, userMicroUsd: 1000000, dailyMicroUsd: 2000000 },
  bypass: false,
  blocked: { count: false, microUsd: false },
};
export const usageBody = (over) => ({ ...FAKE_AI_USAGE, ...over });
/** 自動で足されたままの銘柄（初期値のまま） */
export const FAKE_US30_AUTO = { ...FAKE_US30, underlyingKind: 'other' };

/** 資金 1,000,000円（履歴 3 件。移し替えで「口座 1」へ）・銘柄 3 件にする */
export function seedSettings(api) {
  setAccounts(api, []);
  api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO, FAKE_N225, FAKE_XAU);
  api.settings = {
    capitalYen: 1000000,
    riskTolerancePct: 1,
    performanceUnit: 'R',
    capitalHistory: [
      { valueYen: 800000, at: 1799000000000 },
      { valueYen: 1200000, at: 1799500000000 },
      { valueYen: 1000000, at: 1799900000000 },
    ],
  };
}

/** 設定の画面の題と、開いた後に待つ要素（#133: 設定はタブの根のまとめた一覧と、口座・銘柄・AI の利用状況の次の画面に分けた） */
