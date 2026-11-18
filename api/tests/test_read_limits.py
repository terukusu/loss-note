"""読み取りの 1 日の上限の純関数（Issue #44 の AC-2・AC-5 の判定・精算）。値はすべて架空。

金額は整数の µUSD（1 USD = 1,000,000）。
"""

import random
from datetime import UTC, datetime, timedelta

from statement_read import app_settings, pricing
from statement_read.values import Usage

from loss_note_api.read_limits import JST, ReadLimits, decide, jst_day, settled_micro


def ms(y, mo, d, h, mi, s=0) -> int:
    return int(datetime(y, mo, d, h, mi, s, tzinfo=UTC).timestamp() * 1000)


# ---- AC-2（例 L4）: 日の区切りは日本時間の 0:00 ----


def test_jst_day_boundary_L4():
    assert jst_day(ms(2026, 11, 18, 14, 59, 59)) == "2026-11-18"
    assert jst_day(ms(2026, 11, 18, 15, 0, 0)) == "2026-11-19"
    # 1 ms 前と当の ms
    assert jst_day(ms(2026, 11, 18, 15, 0, 0) - 1) == "2026-11-18"
    # 日本時間の 0:00〜8:59 は協定世界時では前の日
    assert jst_day(ms(2026, 11, 18, 23, 30)) == "2026-11-19"
    # 年の境目
    assert jst_day(ms(2026, 12, 31, 15, 0)) == "2027-01-01"


def test_jst_day_properties():
    rng = random.Random(44)
    base = ms(2020, 1, 1, 0, 0)
    prev = None
    for t in sorted(rng.randint(base, base + 10 * 365 * 86_400_000) for _ in range(3_000)):
        d = jst_day(t)
        # UTC+9 の日付と同じ
        assert d == (datetime.fromtimestamp(t / 1000, UTC) + timedelta(hours=9)).date().isoformat()
        assert d == datetime.fromtimestamp(t / 1000, JST).date().isoformat()
        # 単調（時刻が進めば日付は戻らない）
        if prev is not None:
            assert d >= prev
        prev = d
    # 日本時間の 0:00 の前後 1 ms で日が 1 つ変わる
    for _ in range(200):
        day = datetime(2026, 1, 1, tzinfo=JST) + timedelta(days=rng.randint(0, 3_000))
        midnight = int(day.timestamp() * 1000)
        before, after = jst_day(midnight - 1), jst_day(midnight)
        assert after == day.date().isoformat()
        assert before == (day - timedelta(days=1)).date().isoformat()


# ---- 判定（例 L・C）----

L = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000)


def test_decide_user_limit():
    assert decide(29, 0, L) == "ok"  # L1
    assert decide(30, 0, L) == "user"  # L2
    assert decide(31, 0, L) == "user"
    assert decide(0, 0, L) == "ok"  # L5（ほかの利用者の回数は関係しない）


def test_decide_spend_limit():
    assert decide(0, 1_900_000, L) == "ok"  # C1
    assert decide(0, 1_960_000, L) == "spend"  # C2
    assert decide(0, 1_950_000, L) == "ok"  # C3（等しいときは送る）
    assert decide(0, 1_950_001, L) == "spend"
    assert decide(10, 1_960_000, L) == "spend"  # C7（回数に余裕があっても費用で止まる）
    # 回数を先に見る
    assert decide(30, 1_960_000, L) == "user"


def test_decide_monotonic():
    """性質: 回数・計上額を増やして ok に戻らない"""
    rng = random.Random(7)
    for _ in range(2_000):
        c, s = rng.randint(0, 40), rng.randint(0, 2_100_000)
        if decide(c, s, L) != "ok":
            assert decide(c + rng.randint(0, 5), s + rng.randint(0, 100_000), L) != "ok"


# ---- 精算 ----

SONNET = "claude-sonnet-5-5"


def test_settled_takes_larger_of_table_and_sdk():
    u = Usage(input_tokens=1500, output_tokens=300)  # 料金表 1,500 × 2 + 300 × 10 = 6,000
    assert settled_micro(u, 0.01, 50_000, SONNET) == 10_000  # C1: SDK 10,000 の方が大きい
    assert settled_micro(u, 0.001, 50_000, SONNET) == 6_000
    assert settled_micro(u, None, 50_000, SONNET) == 6_000
    assert settled_micro(None, 0.002, 50_000, SONNET) == 2_000  # C5
    assert settled_micro(None, None, 50_000, SONNET) == 50_000  # C4（受け取れない → 予約額のまま）
    # 料金表に無いモデル・壊れた額は無いものとして扱う
    assert settled_micro(u, None, 50_000, "unknown") == 50_000
    assert settled_micro(None, float("nan"), 50_000, SONNET) == 50_000


def test_settled_at_least_each_source():
    rng = random.Random(3)
    for _ in range(1_000):
        u = Usage(input_tokens=rng.randint(0, 9_000), output_tokens=rng.randint(0, 3_000),
                  cache_creation_input_tokens=rng.randint(0, 9_000), cache_read_input_tokens=rng.randint(0, 9_000))
        sdk = rng.random() / 10
        got = settled_micro(u, sdk, 1, SONNET)
        assert got >= pricing.cost_micro_usd(SONNET, u)
        assert got >= pricing.usd_to_micro(sdk)


def test_default_limits():
    d = ReadLimits()
    assert (d.per_user, d.daily_micro_usd, d.model) == (30, 2_000_000, app_settings.APP_MODEL)
    assert d.reserve_micro_usd == pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)
    # 同時の 2 枚目が費用の側で止まらない（2 × 予約額 ≤ 2.00 USD）
    assert 2 * d.reserve_micro_usd <= d.daily_micro_usd
