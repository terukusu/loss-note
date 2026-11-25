// AI の利用状況（Issue #62。設計書 8.2・ADR-0014）の純関数。DOM・通信を持たない。
// - 応答（GET /api/ai-usage）の検査 parseAiUsage: 形が違えば null（画面は読めなかったと出す）
// - 表示の行 usageView: 今日は回数・金額の「残り」を主に、使った量と割合を添える。今月は合計だけ（同じ行の組み）。
//   上限を受けない利用者は「あなたの 1 日の上限: なし」と、全体の上限で止まることの 1 行
// - 金額は USD（円に換算しない）。使った量は 1 セント未満を切り上げ、残りは切り捨て（どちらも少なめに見せない = 使える量を
//   多めに見せない）。上限は設定の値のまま（小数 2〜6 桁）
// - 割合は floor(使った量 × 100 / 上限)（上限 0 なら 100%）。80% 以上で「上限に近づいています」、次の読み取りが本人の上限で
//   止まるなら「上限に届きました」（止まるかは API が 1 日の上限の判定と同じ式で出す。金額は 計上額 + 1 回の予約額 > 上限
//   なので、割合が 100% 未満でも止まる。そのときの残りは「次の 1 回分に足りない」分として棒の上でも示す）
// - 色は付けない（判定の段の色を使わない）。状態は文字・形で出す

export interface AiUsageBody {
  readonly today: { readonly date: string; readonly count: number; readonly microUsd: number };
  readonly month: { readonly month: string; readonly count: number; readonly microUsd: number };
  readonly limits: {
    readonly count: number | null;
    readonly userMicroUsd: number | null;
    readonly dailyMicroUsd: number;
  };
  readonly bypass: boolean;
  readonly blocked: { readonly count: boolean; readonly microUsd: boolean };
}

/** 上限に近いとみなす割合（%） */
export const NEAR_PCT = 80;

export const USAGE_TITLE = 'AI の利用状況';
export const USAGE_INTRO = '決済明細の読み取りの回数と金額（目安）です。';
/** 日の区切り・金額の扱いは「i」の中（C70・#254） */
export const USAGE_INFO = {
  label: '金額（目安）',
  body: [
    '1 日は日本時間の 0:00 で区切ります。',
    '金額は従量課金の料金表で換算した目安で、あなたに請求されるものではありません。',
  ],
  id: 'settings-usage-info',
} as const;
export const AMOUNT_LABEL = '金額（目安）';
export const COUNT_LABEL = '回数';
/** まとめの 1 行（「今日」の見出しのすぐ下） */
export const NEAR_SUMMARY = '今日の読み取りは上限に近づいています。';
export const REACHED_SUMMARY =
  '今日の読み取りは上限に届きました。明細は手入力してください（日本時間の 0:00 にリセットされます）。';
/** 各行の短い状態の文 */
export const NEAR_TEXT = '上限に近づいています';
export const COUNT_REACHED_TEXT = '上限に届きました';
export const AMOUNT_REACHED_TEXT = '次の 1 回分に足りません';
export const BYPASS_TEXT = 'あなたの 1 日の上限: なし';
export const USAGE_LOAD_FAILED = '利用状況を読み込めませんでした。再読み込みしてください。';

export const globalLimitNote = (limit: string) =>
  `すべての利用者の合計にも 1 日の上限（${limit}）があります。合計が上限に届いたときも読み取りは止まります（全体の利用額はここには表示されません）。`;
export const bypassGlobalNote = (limit: string) =>
  `すべての利用者の合計の 1 日の上限（${limit}）に届いたときは、読み取りが止まります。`;

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** 応答の本文 → 使った量。形が違えば null（中身を持ち出さない） */
export function parseAiUsage(raw: unknown): AiUsageBody | null {
  if (!isObj(raw)) return null;
  const { today, month, limits, bypass, blocked } = raw;
  if (!isObj(today) || !isObj(month) || !isObj(limits) || !isObj(blocked)) return null;
  if (typeof today.date !== 'string' || !DAY.test(today.date)) return null;
  if (typeof month.month !== 'string' || !MONTH.test(month.month)) return null;
  const counts = [today.count, today.microUsd, month.count, month.microUsd, limits.dailyMicroUsd];
  if (!counts.every(isCount)) return null;
  if (typeof bypass !== 'boolean') return null;
  if (typeof blocked.count !== 'boolean' || typeof blocked.microUsd !== 'boolean') return null;
  const personal = [limits.count, limits.userMicroUsd];
  // 上限を受けない利用者なら利用者の上限は null、そうでなければ数
  if (bypass ? !personal.every((v) => v === null) : !personal.every(isCount)) return null;
  return {
    today: { date: today.date, count: today.count as number, microUsd: today.microUsd as number },
    month: { month: month.month, count: month.count as number, microUsd: month.microUsd as number },
    limits: {
      count: limits.count as number | null,
      userMicroUsd: limits.userMicroUsd as number | null,
      dailyMicroUsd: limits.dailyMicroUsd as number,
    },
    bypass,
    blocked: { count: blocked.count, microUsd: blocked.microUsd },
  };
}

/** 3 桁ごとにカンマで区切る */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** セント → 「0.12」 */
const centsDigits = (cents: number) =>
  `${group(String(Math.floor(cents / 100)))}.${String(cents % 100).padStart(2, '0')}`;

/** 上限の金額（µUSD）→ 設定の値のまま（単位なし。小数 2〜6 桁） */
function limitUsdDigits(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000)
    .padStart(6, '0')
    .replace(/0{1,4}$/, '');
  return `${group(String(whole))}.${frac.padEnd(2, '0')}`;
}

/** 使った金額 → 「0.12 USD」（1 セント未満は切り上げ = 少なめに見せない） */
export const formatUsedUsd = (micro: number) => `${centsDigits(Math.ceil(micro / 10_000))} USD`;
/** 残りの金額 → 「0.88 USD」（1 セント未満は切り捨て = 多めに見せない。負は 0） */
export const formatRemainingUsd = (micro: number) =>
  `${centsDigits(Math.floor(Math.max(micro, 0) / 10_000))} USD`;
/** 上限の金額 → 「1.00 USD」「1.234567 USD」 */
export const formatLimitUsd = (micro: number) => `${limitUsdDigits(micro)} USD`;
/** 回数 → 「3 回」 */
export const formatCount = (n: number) => `${group(String(n))} 回`;

/** 割合（%）。floor(使った量 × 100 / 上限)。上限 0 なら 100（100 を超えてもそのまま） */
export function usagePct(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.floor((used * 100) / limit);
}

export type MeterStatus = 'ok' | 'near' | 'reached';

export interface UsageMeter {
  readonly label: string;
  /** 主の値: 残り（「あと 27 回」「あと 0.88 USD」） */
  readonly mainText: string;
  /** 添える値: 使った量・上限・割合（「3 / 30 回 使用・10%」） */
  readonly subText: string;
  /** 割合（%。棒の長さ。100 で頭打ちにしない値） */
  readonly pct: number;
  readonly status: MeterStatus;
  /** 短い状態の文（ok のときは null） */
  readonly statusText: string | null;
  /** 届いたのに棒が 100% に満たないとき、使えない残りがある（棒の上で点線の枠で示す） */
  readonly unusableRest: boolean;
}

export interface UsageRow {
  readonly label: string;
  readonly valueText: string;
}

export interface UsageView {
  /** 今日の日付（例: 今日（11 月 18 日）） */
  readonly todayLabel: string;
  /** 今日の読み取りの回数（設定の根の行の添え「今日 3 回」。#133） */
  readonly todayCount: number;
  /** 今月（例: 今月（11 月）） */
  readonly monthLabel: string;
  readonly bypass: boolean;
  /** 「今日」の見出しの下のまとめの 1 行（近い・届いたときだけ） */
  readonly summary: { readonly status: 'near' | 'reached'; readonly text: string } | null;
  /** 今日の回数・金額（上限を受けない利用者では空） */
  readonly today: readonly UsageMeter[];
  /** 上限を受けない利用者の今日の値（回数・金額） */
  readonly todayPlain: readonly UsageRow[];
  /** 上限を受けない利用者の上限の説明（2 行） */
  readonly bypassLines: readonly string[];
  readonly month: readonly UsageRow[];
  readonly notes: readonly string[];
}

function meter(
  label: string,
  mainText: string,
  subValue: string,
  pct: number,
  blocked: boolean,
  reachedText: string,
): UsageMeter {
  const status: MeterStatus = blocked ? 'reached' : pct >= NEAR_PCT ? 'near' : 'ok';
  return {
    label,
    mainText,
    subText: `${subValue} 使用・${pct}%`,
    pct,
    status,
    statusText: status === 'reached' ? reachedText : status === 'near' ? NEAR_TEXT : null,
    unusableRest: blocked && pct < 100,
  };
}

const monthDay = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;

/** 使った量 → 表示の行 */
export function usageView(u: AiUsageBody): UsageView {
  const global = formatLimitUsd(u.limits.dailyMicroUsd);
  const base = {
    todayLabel: `今日（${monthDay(u.today.date)}）`,
    todayCount: u.today.count,
    monthLabel: `今月（${Number(u.month.month.slice(5, 7))} 月）`,
    month: [
      { label: COUNT_LABEL, valueText: formatCount(u.month.count) },
      { label: AMOUNT_LABEL, valueText: formatUsedUsd(u.month.microUsd) },
    ],
  };
  const { count, userMicroUsd } = u.limits;
  if (u.bypass || count === null || userMicroUsd === null) {
    return {
      ...base,
      bypass: true,
      summary: null,
      today: [],
      todayPlain: [
        { label: COUNT_LABEL, valueText: formatCount(u.today.count) },
        { label: AMOUNT_LABEL, valueText: formatUsedUsd(u.today.microUsd) },
      ],
      bypassLines: [BYPASS_TEXT, bypassGlobalNote(global)],
      notes: [],
    };
  }
  const today = [
    meter(
      COUNT_LABEL,
      `あと ${formatCount(Math.max(count - u.today.count, 0))}`,
      `${group(String(u.today.count))} / ${group(String(count))} 回`,
      usagePct(u.today.count, count),
      u.blocked.count,
      COUNT_REACHED_TEXT,
    ),
    meter(
      AMOUNT_LABEL,
      `あと ${formatRemainingUsd(userMicroUsd - u.today.microUsd)}`,
      `${centsDigits(Math.ceil(u.today.microUsd / 10_000))} / ${limitUsdDigits(userMicroUsd)} USD`,
      usagePct(u.today.microUsd, userMicroUsd),
      u.blocked.microUsd,
      AMOUNT_REACHED_TEXT,
    ),
  ];
  const reached = today.some((m) => m.status === 'reached');
  const near = today.some((m) => m.status === 'near');
  return {
    ...base,
    bypass: false,
    summary: reached
      ? { status: 'reached', text: REACHED_SUMMARY }
      : near
        ? { status: 'near', text: NEAR_SUMMARY }
        : null,
    today,
    todayPlain: [],
    bypassLines: [],
    notes: [globalLimitNote(global)],
  };
}
