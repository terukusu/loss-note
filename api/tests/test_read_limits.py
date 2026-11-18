"""読み取りの 1 日の上限の純関数（Issue #44 の AC-2・AC-5 の判定・精算）。値はすべて架空。

金額は整数の µUSD（1 USD = 1,000,000）。
"""

import random
from datetime import UTC, datetime, timedelta

import pytest
from statement_read import app_settings, pricing
from statement_read.values import Usage

from loss_note_api import allowlist
from loss_note_api.read_limits import (
    BYPASS_EMAILS_VAR,
    DAILY_USD_VAR,
    JST,
    USER_COUNT_VAR,
    USER_USD_VAR,
    ReadLimits,
    decide,
    effective_user_micro,
    is_bypass,
    jst_day,
    limits_from_env,
    parse_usd,
    settled_micro,
)


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


# ---- #51: 利用者ごとの費用の上限・バイパス・環境変数（ADR-0014） ----

P = 278_736  # Sonnet 5.5 の予約額（ADR-0010 決定 4）
D = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=P, per_user_micro_usd=1_000_000)
BYPASS = "bypass.owner@example.com"


def test_default_per_user_spend():
    # 既定 1.00 USD: 全体 2.00 USD の半分で、予約額の 3 回分が入る（同時に 3 枚まで）
    d = ReadLimits()
    assert d.per_user_micro_usd == 1_000_000
    assert 2 * d.per_user_micro_usd <= d.daily_micro_usd
    assert 3 * d.reserve_micro_usd <= d.per_user_micro_usd < 4 * d.reserve_micro_usd
    assert d.bypass == frozenset() and d.config_error is None


@pytest.mark.parametrize(
    ("label", "count", "user_spent", "spent", "bypass", "want"),
    [
        ("#1", 0, 0, 0, False, "ok"),
        ("#2", 30, 0, 0, False, "user"),
        ("#3", 3, 721_264, 721_264, False, "ok"),  # 721,264 + P = 1,000,000（等しいので送る）
        ("#4", 3, 721_265, 721_265, False, "user_spend"),
        ("#5", 0, 0, 1_721_265, False, "spend"),
        ("#6", 30, 5_000_000, 0, True, "ok"),
        ("#7", 0, 0, 1_721_265, True, "spend"),
        ("#8", 30, 0, 0, False, "user"),  # 確かめていないメール = バイパスでない（判定の入力は False）
    ],
)
def test_decide_issue51_table(label, count, user_spent, spent, bypass, want):
    assert decide(count, spent, D, user_spent_micro=user_spent, bypass=bypass) == want, label


def test_decide_issue51_row9_small_user_limit():
    # #9: 利用者の費用の上限 0.10 USD < 予約額 → 計上 0 でも送れない
    small = ReadLimits(reserve_micro_usd=P, per_user_micro_usd=100_000)
    assert decide(0, 0, small) == "user_spend"


def test_decide_order_and_bypass_properties():
    """性質: バイパスは利用者の 2 つだけを外す（全体の判定は同じ）。単調（増やして ok に戻らない）"""
    rng = random.Random(51)
    for _ in range(3_000):
        c, u, s = rng.randint(0, 40), rng.randint(0, 1_400_000), rng.randint(0, 2_100_000)
        normal = decide(c, s, D, user_spent_micro=u)
        by = decide(c, s, D, user_spent_micro=u, bypass=True)
        assert by == ("spend" if s + P > D.daily_micro_usd else "ok")
        if normal == "ok":
            assert by == "ok"  # バイパスで厳しくならない
        if normal == "spend":
            assert by == "spend"  # 全体はバイパスにも効く
        if normal != "ok":
            assert decide(c + rng.randint(0, 3), s + rng.randint(0, 50_000), D,
                          user_spent_micro=u + rng.randint(0, 50_000)) != "ok"


@pytest.mark.parametrize(
    ("raw", "want"),
    [("0.50", 500_000), ("5", 5_000_000), ("1.000001", 1_000_001), ("0", 0), (" 2.00 ", 2_000_000),
     ("999999.999999", 999_999_999_999),
     ("abc", None), ("-1", None), ("1.0000001", None), ("1e3", None), ("1,000", None), ("", None), (".5", None),
     ("5.", None), ("1234567", None), ("NaN", None), ("Infinity", None), ("１", None), ("+1", None)],
)
def test_parse_usd(raw, want):
    assert parse_usd(raw) == want


@pytest.mark.parametrize(
    ("env", "field", "want"),
    [
        ({USER_USD_VAR: "0.50"}, "per_user_micro_usd", 500_000),
        ({DAILY_USD_VAR: "5"}, "daily_micro_usd", 5_000_000),
        ({USER_COUNT_VAR: "0"}, "per_user", 0),
        ({USER_COUNT_VAR: "45"}, "per_user", 45),
        ({}, "per_user", 30),
        ({USER_COUNT_VAR: "", USER_USD_VAR: "", DAILY_USD_VAR: ""}, "daily_micro_usd", 2_000_000),
        ({}, "per_user_micro_usd", 1_000_000),
    ],
)
def test_limits_from_env_values(env, field, want):
    got = limits_from_env(env)
    assert got.config_error is None
    assert getattr(got, field) == want


@pytest.mark.parametrize(
    ("env", "var"),
    [
        ({USER_USD_VAR: "abc"}, USER_USD_VAR),
        ({USER_USD_VAR: "-1"}, USER_USD_VAR),
        ({USER_USD_VAR: "1.0000001"}, USER_USD_VAR),
        ({USER_COUNT_VAR: "3.5"}, USER_COUNT_VAR),
        ({USER_COUNT_VAR: "-3"}, USER_COUNT_VAR),
        ({DAILY_USD_VAR: "two"}, DAILY_USD_VAR),
        ({USER_COUNT_VAR: "30", DAILY_USD_VAR: "1e9"}, DAILY_USD_VAR),
        # 空白だけは「空」でなく形の誤り（ADR-0014 決定 4）
        ({USER_USD_VAR: " "}, USER_USD_VAR),
        ({USER_COUNT_VAR: "\t"}, USER_COUNT_VAR),
        ({DAILY_USD_VAR: "  "}, DAILY_USD_VAR),
    ],
)
def test_limits_from_env_bad_closes(env, var):
    got = limits_from_env(env)
    assert got.config_error == var
    assert "abc" not in repr(got) and "1e9" not in repr(got)  # 値を持たない


@pytest.mark.parametrize(
    ("count", "recorded", "want"),
    [
        (3, 500_000, 500_000),  # 0 以上の整数はそのまま
        (3, 0, 0),
        (3, None, 3 * P),  # 欠け（#51 より前・切り戻した日に前のコードが置き換えた）→ 回数 × 予約額
        (3, -200_000, 3 * P),  # 負（前のコードの予約が挟まった精算）→ 0 として扱わない
        (3, -1, 3 * P),
        (0, None, 0),
        (2, True, 2 * P),  # 整数でない値も数えられない側
        (2, "100", 2 * P),
        (2, 1.5, 2 * P),
    ],
)
def test_effective_user_micro(count, recorded, want):
    assert effective_user_micro(count, recorded, P) == want


def test_effective_user_micro_property():
    """性質: 0 未満にならない・欠けや負の見積もりは回数とともに増える"""
    rng = random.Random(1)
    for _ in range(1_000):
        c = rng.randint(0, 40)
        r = rng.choice([None, rng.randint(-2_000_000, -1), rng.randint(0, 2_000_000)])
        got = effective_user_micro(c, r, P)
        assert got >= 0
        if r is None or r < 0:
            assert got == c * P


def test_limits_from_env_count_zero_means_nobody_but_bypass():
    z = limits_from_env({USER_COUNT_VAR: "0"})
    assert decide(0, 0, z) == "user"
    assert decide(0, 0, z, bypass=True) == "ok"


def test_bypass_list_is_parsed_like_allowlist_and_hidden_from_repr():
    got = limits_from_env({BYPASS_EMAILS_VAR: f" Bypass.Owner@Example.COM , ,{BYPASS}"})
    assert got.bypass == frozenset({BYPASS})
    assert "example.com" not in repr(got)
    assert limits_from_env({}).bypass == frozenset()
    assert limits_from_env({BYPASS_EMAILS_VAR: " , "}).bypass == frozenset()


def _verified(email, **kw):
    return {"sub": "u1", "email": email, "email_verified": True, **kw}


@pytest.mark.parametrize(
    ("claims", "want"),
    [
        (_verified(BYPASS), True),
        (_verified("BYPASS.OWNER@EXAMPLE.COM"), True),
        (_verified("other@example.com"), False),
        (_verified("bypassowner@example.com"), False),  # 点の有無を同一視しない
        (_verified(f" {BYPASS}"), False),  # トークンのメールは空白を除かない
        ({"sub": "u1", "email": BYPASS, "email_verified": False}, False),
        ({"sub": "u1", "email": BYPASS, "email_verified": "true"}, False),
        ({"sub": "u1", "email": BYPASS}, False),
        ({"sub": "u1", "email_verified": True}, False),
        ({"sub": "u1", "email": None, "email_verified": True}, False),
        (None, False),
    ],
)
def test_is_bypass(claims, want):
    assert is_bypass(claims, ReadLimits(bypass=frozenset({BYPASS}))) is want


def test_is_bypass_matches_allowlist_property():
    """性質: リストが空でなければ、バイパスになる ⇔ 許可リストの照らし方で通る"""
    rng = random.Random(43)
    emails = [BYPASS, "BYPASS.owner@example.com", "other@example.com", "", None, " x@example.com"]
    for _ in range(500):
        listed = rng.sample([BYPASS, "other@example.com", "x@example.com"], rng.randint(1, 3))
        c = {"sub": "u1", "email": rng.choice(emails), "email_verified": rng.choice([True, False, "true", None])}
        limits = ReadLimits(bypass=allowlist.parse_allowlist(",".join(listed)))
        assert is_bypass(c, limits) is allowlist.is_allowed(c, limits.bypass)
    # 空のリストは誰も当たらない（許可リストの「制限しない」とは逆）
    assert is_bypass(_verified(BYPASS), ReadLimits()) is False
