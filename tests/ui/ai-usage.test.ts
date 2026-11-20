// AI の利用状況の純関数と通信（Issue #62 の AC-5・AC-6・AC-7 の文言）。値はすべて架空。
// 例の表（Issue 本文）の API の応答 → 画面の行。P = 予約額 278,736 µUSD、上限は既定（30 回・1.00 USD・全体 2.00 USD）
import { describe, expect, it } from 'vitest';
import {
  type AiUsageBody,
  AMOUNT_LABEL,
  AMOUNT_REACHED_TEXT,
  BYPASS_TEXT,
  bypassGlobalNote,
  COUNT_REACHED_TEXT,
  formatLimitUsd,
  formatRemainingUsd,
  formatUsedUsd,
  globalLimitNote,
  NEAR_SUMMARY,
  NEAR_TEXT,
  parseAiUsage,
  REACHED_SUMMARY,
  USAGE_INTRO,
  USAGE_LOAD_FAILED,
  usagePct,
  usageView,
} from '../../ui/src/lib/ai-usage';
import { AI_USAGE_PATH, createAiUsageController } from '../../ui/src/lib/ai-usage-controller';
import { NotSignedIn } from '../../ui/src/lib/api';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';

const P = 278_736;
const LIMITS = { count: 30, userMicroUsd: 1_000_000, dailyMicroUsd: 2_000_000 };

function body(
  today: [number, number],
  month: [number, number],
  over: Partial<AiUsageBody> = {},
): AiUsageBody {
  return {
    today: { date: '2026-11-18', count: today[0], microUsd: today[1] },
    month: { month: '2026-11', count: month[0], microUsd: month[1] },
    limits: LIMITS,
    bypass: false,
    blocked: { count: false, microUsd: false },
    ...over,
  };
}

describe('金額の書き方（AC-5）', () => {
  it('使った量は 1 セント未満を切り上げ、残りは切り捨て、上限は設定の値のまま', () => {
    expect(formatUsedUsd(0)).toBe('0.00 USD');
    expect(formatUsedUsd(1)).toBe('0.01 USD');
    expect(formatUsedUsd(557_472)).toBe('0.56 USD');
    expect(formatUsedUsd(120_000)).toBe('0.12 USD');
    expect(formatUsedUsd(1_500_000)).toBe('1.50 USD');
    expect(formatUsedUsd(1_234_000_000)).toBe('1,234.00 USD');
    expect(formatRemainingUsd(880_000)).toBe('0.88 USD');
    expect(formatRemainingUsd(278_735)).toBe('0.27 USD');
    expect(formatRemainingUsd(-5)).toBe('0.00 USD');
    expect(formatLimitUsd(1_000_000)).toBe('1.00 USD');
    expect(formatLimitUsd(1_234_567)).toBe('1.234567 USD');
    expect(formatLimitUsd(500_000)).toBe('0.50 USD');
    expect(formatLimitUsd(100_000)).toBe('0.10 USD');
    expect(formatLimitUsd(120)).toBe('0.00012 USD');
    expect(formatLimitUsd(0)).toBe('0.00 USD');
  });

  it('切り上げ・切り捨ては使える量を多めに見せない（性質）', () => {
    let seed = 62;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);
    for (let i = 0; i < 500; i++) {
      const micro = rnd() % 5_000_000;
      const up = cents(formatUsedUsd(micro));
      expect(up * 10_000).toBeGreaterThanOrEqual(micro);
      expect((up - 1) * 10_000).toBeLessThan(micro);
      const down = cents(formatRemainingUsd(micro));
      expect(down * 10_000).toBeLessThanOrEqual(micro);
      expect((down + 1) * 10_000).toBeGreaterThan(micro);
    }
  });

  it('割合は切り捨て、上限 0 は 100%', () => {
    expect(usagePct(24, 30)).toBe(80);
    expect(usagePct(721_265, 1_000_000)).toBe(72);
    expect(usagePct(999_999, 1_000_000)).toBe(99);
    expect(usagePct(0, 0)).toBe(100);
    expect(usagePct(40, 30)).toBe(133);
  });
});

describe('例の表 → 画面（AC-5）', () => {
  // [行, 応答, 回数 [主, 添え, 状態], 金額 [主, 添え, 状態], まとめ, 今月 [回数, 金額]]
  const rows: [string, AiUsageBody, string[], string[], string, [string, string]][] = [
    [
      '#1',
      body([0, 0], [0, 0]),
      ['あと 30 回', '0 / 30 回 使用・0%', ''],
      ['あと 1.00 USD', '0.00 / 1.00 USD 使用・0%', ''],
      '',
      ['0 回', '0.00 USD'],
    ],
    [
      '#2',
      body([3, 120_000], [5, 200_000]),
      ['あと 27 回', '3 / 30 回 使用・10%', ''],
      ['あと 0.88 USD', '0.12 / 1.00 USD 使用・12%', ''],
      '',
      ['5 回', '0.20 USD'],
    ],
    [
      '#3',
      body([24, 300_000], [24, 300_000]),
      ['あと 6 回', '24 / 30 回 使用・80%', NEAR_TEXT],
      ['あと 0.70 USD', '0.30 / 1.00 USD 使用・30%', ''],
      NEAR_SUMMARY,
      ['24 回', '0.30 USD'],
    ],
    [
      '#4',
      body([30, 400_000], [30, 400_000], { blocked: { count: true, microUsd: false } }),
      ['あと 0 回', '30 / 30 回 使用・100%', COUNT_REACHED_TEXT],
      ['あと 0.60 USD', '0.40 / 1.00 USD 使用・40%', ''],
      REACHED_SUMMARY,
      ['30 回', '0.40 USD'],
    ],
    [
      '#5',
      body([3, 721_265], [3, 721_265], { blocked: { count: false, microUsd: true } }),
      ['あと 27 回', '3 / 30 回 使用・10%', ''],
      ['あと 0.27 USD', '0.73 / 1.00 USD 使用・72%', AMOUNT_REACHED_TEXT],
      REACHED_SUMMARY,
      ['3 回', '0.73 USD'],
    ],
    [
      '#6',
      body([3, 721_264], [3, 721_264]),
      ['あと 27 回', '3 / 30 回 使用・10%', ''],
      ['あと 0.27 USD', '0.73 / 1.00 USD 使用・72%', ''],
      '',
      ['3 回', '0.73 USD'],
    ],
    [
      '#7',
      body([2, 2 * P], [3, 3 * P]),
      ['あと 28 回', '2 / 30 回 使用・6%', ''],
      ['あと 0.44 USD', '0.56 / 1.00 USD 使用・55%', ''],
      '',
      ['3 回', '0.84 USD'],
    ],
    [
      '#11',
      body([0, 0], [0, 0], {
        limits: { ...LIMITS, count: 0 },
        blocked: { count: true, microUsd: false },
      }),
      ['あと 0 回', '0 / 0 回 使用・100%', COUNT_REACHED_TEXT],
      ['あと 1.00 USD', '0.00 / 1.00 USD 使用・0%', ''],
      REACHED_SUMMARY,
      ['0 回', '0.00 USD'],
    ],
  ];
  for (const [row, b, count, amount, summary, month] of rows) {
    it(row, () => {
      expect(parseAiUsage(JSON.parse(JSON.stringify(b)))).toEqual(b);
      const v = usageView(b);
      expect(v.bypass).toBe(false);
      const [c, a] = v.today;
      expect([c?.mainText, c?.subText, c?.statusText ?? '']).toEqual(count);
      expect([a?.mainText, a?.subText, a?.statusText ?? '']).toEqual(amount);
      expect(v.summary?.text ?? '').toBe(summary);
      expect(v.month.map((r) => r.valueText)).toEqual(month);
      expect(v.month.map((r) => r.label)).toEqual(['回数', AMOUNT_LABEL]);
      expect(a?.label).toBe('金額（目安）');
      expect(v.todayLabel).toBe('今日（11 月 18 日）');
      expect(v.monthLabel).toBe('今月（11 月）');
    });
  }

  it('#5 は使えない残りがあり（棒は 72%）、#4 の回数は棒が 100% で残りなし', () => {
    const v5 = usageView(
      body([3, 721_265], [3, 721_265], { blocked: { count: false, microUsd: true } }),
    );
    expect(v5.today.map((m) => m.unusableRest)).toEqual([false, true]);
    const v4 = usageView(
      body([30, 400_000], [30, 400_000], { blocked: { count: true, microUsd: false } }),
    );
    expect(v4.today.map((m) => m.unusableRest)).toEqual([false, false]);
  });

  it('#8 上限を受けない利用者: 「あなたの 1 日の上限: なし」と全体の上限で止まること、割合・まとめなし', () => {
    const b = body([40, 1_500_000], [52, 1_900_000], {
      bypass: true,
      limits: { count: null, userMicroUsd: null, dailyMicroUsd: 2_000_000 },
    });
    expect(parseAiUsage(b)).toEqual(b);
    const v = usageView(b);
    expect(v.bypass).toBe(true);
    expect(v.today).toEqual([]);
    expect(v.summary).toBeNull();
    expect(v.bypassLines).toEqual([BYPASS_TEXT, bypassGlobalNote('2.00 USD')]);
    expect(v.todayPlain).toEqual([
      { label: '回数', valueText: '40 回' },
      { label: '金額（目安）', valueText: '1.50 USD' },
    ]);
    expect(v.notes).toEqual([]);
  });

  it('#10 月の境目: 今月の見出しは応答の月', () => {
    const v = usageView(
      body([1, 40_000], [1, 40_000], {
        today: { date: '2026-12-01', count: 1, microUsd: 40_000 },
        month: { month: '2026-12', count: 1, microUsd: 40_000 },
      }),
    );
    expect([v.todayLabel, v.monthLabel, v.month[1]?.valueText]).toEqual([
      '今日（12 月 1 日）',
      '今月（12 月）',
      '0.04 USD',
    ]);
  });

  it('説明と注記（AC-6）: 換算の目安・請求されない・全体の 1 日の上限の値', () => {
    const v = usageView(body([3, 120_000], [5, 200_000]));
    expect(USAGE_INTRO).toContain('従量課金の料金表で換算した目安');
    expect(USAGE_INTRO).toContain('あなたに請求されるものではありません');
    expect(v.notes).toEqual([globalLimitNote('2.00 USD')]);
    expect(v.notes.join('')).not.toContain('Console');
  });
});

describe('応答の検査', () => {
  const ok = body([1, 2], [3, 4]);
  it('形の違う本文は null', () => {
    const bad: unknown[] = [
      null,
      'x',
      { ...ok, today: { ...ok.today, count: -1 } },
      { ...ok, today: { ...ok.today, microUsd: 1.5 } },
      { ...ok, today: { ...ok.today, date: '2026/11/18' } },
      { ...ok, month: { ...ok.month, month: '2026-11-01' } },
      { ...ok, bypass: 'false' },
      { ...ok, blocked: { count: 0, microUsd: false } },
      { ...ok, limits: { ...ok.limits, count: null } }, // 上限を受ける利用者なのに上限が無い
      { ...ok, bypass: true }, // 上限を受けない利用者なのに利用者の上限がある
      { ...ok, limits: { ...ok.limits, dailyMicroUsd: '2000000' } },
    ];
    for (const b of bad) expect(parseAiUsage(b)).toBeNull();
  });
});

describe('通信（AC-7 の失敗の文言）', () => {
  const res = (status: number, b: unknown) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

  it('読めたら表示の行、GET /api/ai-usage を 1 回だけ（重ねて呼んでも二重に送らない）', async () => {
    const calls: [string, string | undefined][] = [];
    const c = createAiUsageController({
      api: async (path, init) => {
        calls.push([path, init?.method]);
        return res(200, body([3, 120_000], [5, 200_000]));
      },
    });
    expect(c.getState().phase).toBe('loading');
    await Promise.all([c.load(), c.load()]);
    expect(calls).toEqual([[AI_USAGE_PATH, undefined]]);
    const s = c.getState();
    expect(s.phase).toBe('ready');
    if (s.phase === 'ready') expect(s.view.month[1]?.valueText).toBe('0.20 USD');
  });

  it('503・形の違う本文・通信の失敗は決まった文言、401・ログインしていないはログインが切れた', async () => {
    const cases: [() => Promise<Response>, string, boolean][] = [
      [async () => res(503, { error: 'read_unavailable' }), USAGE_LOAD_FAILED, false],
      [async () => res(200, { today: 1 }), USAGE_LOAD_FAILED, false],
      [
        async () => {
          throw new TypeError('network down: secret-ish detail');
        },
        USAGE_LOAD_FAILED,
        false,
      ],
      [async () => res(401, { error: 'unauthorized' }), AUTH_EXPIRED, true],
      [
        async () => {
          throw new NotSignedIn();
        },
        AUTH_EXPIRED,
        true,
      ],
    ];
    for (const [api, text, auth] of cases) {
      const c = createAiUsageController({ api });
      await c.load();
      expect(c.getState()).toEqual({ phase: 'failed', text, auth });
    }
  });
});

describe('設定の根の行の添え（#133）', () => {
  it('todayCount は今日の回数（上限を受けない利用者も同じ）', () => {
    expect(usageView(body([3, P * 3], [10, P * 10])).todayCount).toBe(3);
    expect(usageView(body([0, 0], [0, 0])).todayCount).toBe(0);
    const bypass = body([40, 1_500_000], [212, 6_400_000], {
      bypass: true,
      limits: { count: null, userMicroUsd: null, dailyMicroUsd: 2_000_000 },
    });
    expect(usageView(bypass).todayCount).toBe(40);
  });
});
