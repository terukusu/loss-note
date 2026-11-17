"""採点の純関数（Issue #14 の R1〜R4、採点の例 #1〜#16）。値はすべて架空"""

import random
from decimal import Decimal

import pytest
from helpers import answer_row, read_from_answer

from statement_eval.score import (
    FIELDS,
    Usage,
    aggregate,
    compare_row,
    cost_usd,
    match_rows,
    median_max,
    normalize_number,
    opened_side,
    parse_statement_datetime,
    score_image,
)


def field_ok(answer: dict, read: dict, name: str) -> bool:
    return compare_row(answer, read).matches[FIELDS.index(name)]


# ---- 採点の例 #1〜#16（AC-1。1 行 = 1 テスト） ----


def example_01():
    a = answer_row(entry_price="38250")
    assert field_ok(a, read_from_answer(a, entry_price=38250), "entry_price") is True  # 「38,250」と 38250


def example_02():
    a = answer_row(pnl_jpy="-12340")
    assert field_ok(a, read_from_answer(a, pnl_jpy=12340), "pnl_jpy") is False  # 符号


def example_03():
    # 年 / 月 / 日の形の 2026/03/04 10:15 を 2026-04-03 10:15 と読んだ（月と日の取り違え）
    a = answer_row(exit_time=parse_statement_datetime("2026/03/04 10:15", "YMD"))
    assert a["exit_time"] == "2026-03-04T10:15"
    assert field_ok(a, read_from_answer(a, exit_time="2026-04-03T10:15"), "exit_time") is False


def example_04():
    # 日 / 月 / 年の形の 04/03/2026 10:15 GMT を 2026-03-04 10:15・GMT と読んだ（時間帯は換算しない）
    a = answer_row(exit_time=parse_statement_datetime("04/03/2026 10:15", "DMY"))
    assert a["exit_time"] == "2026-03-04T10:15"
    assert field_ok(a, read_from_answer(a, exit_time="2026-03-04T10:15", time_zone="GMT"), "exit_time") is True


def example_05():
    # 「決済売」= 決済の向きが売 → 建てたのは L
    a = answer_row(side="L")
    r = read_from_answer(a, side_written="sell", side_of="close")
    assert opened_side("sell", "close") == "L"
    assert field_ok(a, r, "side") is True


def example_06():
    # 「決済買」→ 建てたのは S。L と読んだら不一致
    a = answer_row(side="S")
    r = read_from_answer(a, side_written="sell", side_of="close")  # L になる読み取り
    assert opened_side("buy", "close") == "S"
    assert field_ok(a, r, "side") is False


def example_07():
    # 形 1 の「方向」は建玉そのものの向き（R1）。
    # 「買約定」→ L。L と読んだら一致
    a = answer_row(side="L")
    r = read_from_answer(a, side_written="buy", side_of="position")
    assert opened_side("buy", "position") == "L"
    assert field_ok(a, r, "side") is True


def example_07b():
    # 「売約定」→ S。決済の向きと取り違えて L と読んだら不一致
    a = answer_row(side="S")
    assert opened_side("sell", "position") == "S"
    assert field_ok(a, read_from_answer(a, side_written="sell", side_of="position"), "side") is True
    assert field_ok(a, read_from_answer(a, side_written="sell", side_of="close"), "side") is False


def example_08():
    a = answer_row(symbol="日経225mini 26/03")
    assert field_ok(a, read_from_answer(a, symbol="日経２２５ｍｉｎｉ　26/03"), "symbol") is True


def example_09():
    # 建て 38・消費税 3・決済 38・消費税 3 → 合計 82
    a = answer_row(fees=["38", "3", "38", "3"])
    assert field_ok(a, read_from_answer(a, fees=[82]), "fees") is True
    assert field_ok(a, read_from_answer(a, fees=[38, 3, 38, 3]), "fees") is True


def example_10():
    a = answer_row(exit_order_type="unknown")
    s = compare_row(a, read_from_answer(a, exit_order_type="unknown"))
    assert s.matches[FIELDS.index("exit_order_type")] is True
    assert s.hallucinated_order_type is False


def example_11():
    a = answer_row(exit_order_type="unknown")
    s = compare_row(a, read_from_answer(a, exit_order_type="stop"))
    assert s.matches[FIELDS.index("exit_order_type")] is False
    assert s.hallucinated_order_type is True  # 作り話 1 件


def example_12():
    a = answer_row(exit_order_type="stop")
    s = compare_row(a, read_from_answer(a, exit_order_type="stop"))
    assert s.matches[FIELDS.index("exit_order_type")] is True
    assert s.hallucinated_order_type is False


def example_13():
    a = answer_row(fees=None)  # 手数料の欄が無い明細
    assert field_ok(a, read_from_answer(a, fees=[0]), "fees") is False


def example_14():
    rows = [answer_row(pnl_jpy="100"), answer_row(pnl_jpy="200"), answer_row(pnl_jpy="300")]
    read = {"kind": "statement", "rows": [read_from_answer(rows[0]), read_from_answer(rows[2])]}
    s = score_image({"rows": rows}, read)
    assert [r.n_matched for r in s.rows] == [10, 0, 10]  # 欠けた中の 1 行の欄はすべて不一致（後ろはずれない）
    assert s.row_count_match is False
    t = aggregate([s], [], [], "claude-opus-5-5")
    assert t.n_reads - t.row_count_matches == 1  # 行数の不一致 1 件


def example_15():
    a1, a2 = answer_row(qty="1"), answer_row(qty="2")
    s1 = score_image({"rows": [a1]}, {"kind": "statement", "rows": [read_from_answer(a1)]})
    s2 = score_image({"rows": [a2]}, {"kind": "statement", "rows": [read_from_answer(a2, qty=3)]})
    t = aggregate([s1, s2], [], [], "claude-opus-5-5")
    assert t.field_matches["qty"] == 1 and t.n_answer_rows == 2
    assert t.rate("qty") == 0.5


def example_16():
    assert median_max([8.0, 9.5, 12.0]) == (9.5, 12.0)


EXAMPLES = [
    ("01", example_01), ("02", example_02), ("03", example_03), ("04", example_04), ("05", example_05),
    ("06", example_06), ("07", example_07), ("07b", example_07b), ("08", example_08), ("09", example_09),
    ("10", example_10), ("11", example_11), ("12", example_12), ("13", example_13), ("14", example_14),
    ("15", example_15), ("16", example_16),
]


@pytest.mark.parametrize("fn", [f for _, f in EXAMPLES], ids=[f"example_{i}" for i, _ in EXAMPLES])
def test_example(fn):
    fn()


# ---- 正規化 ----


@pytest.mark.parametrize(
    "text,expected",
    [
        ("38,250", "38250"), ("３８，２５０", "38250"), ("¥38,250", "38250"), ("38,250円", "38250"),
        ("−12,340", "-12340"), ("▲12,340", "-12340"), ("△5", "-5"), ("-0.5", "-0.5"), ("151.234", "151.234"),
        ("38250.0", "38250"), ("+15", "15"), (38250, "38250"), (151.234, "151.234"),
    ],
)
def test_normalize_number(text, expected):
    assert normalize_number(text) == Decimal(expected)


@pytest.mark.parametrize("v", [None, "", "abc", "1.2.3", "--5", True, float("nan"), float("inf"), "NaN", [1]])
def test_normalize_number_unreadable(v):
    assert normalize_number(v) is None


def test_parse_statement_datetime_rejects_bad():
    with pytest.raises(ValueError):
        parse_statement_datetime("13/13/2026 10:00", "DMY")
    with pytest.raises(ValueError):
        parse_statement_datetime("2026-03", "YMD")


def test_opened_side_unknowns():
    assert opened_side(None, "close") is None
    assert opened_side("sell", None) is None
    assert opened_side("hold", "close") is None


def test_null_answer_with_value_is_mismatch():
    # R2: 正解が「無し」の欄に値を返したら不一致
    a = answer_row(entry_price=None)
    assert field_ok(a, read_from_answer(a, entry_price=38250), "entry_price") is False
    assert field_ok(a, read_from_answer(a, entry_price=None), "entry_price") is True


def test_fees_empty_list_equals_none():
    a = answer_row(fees=None)
    assert field_ok(a, read_from_answer(a, fees=[]), "fees") is True
    b = answer_row(fees=["38"])
    assert field_ok(b, read_from_answer(b, fees=None), "fees") is False


def test_failed_read_all_mismatch():
    a = answer_row()
    s = score_image({"rows": [a, a]}, None)
    assert s.failed and not s.row_count_match
    assert all(r.n_matched == 0 for r in s.rows)


def test_not_statement_counts_as_no_rows():
    a = answer_row()
    s = score_image({"rows": [a]}, {"kind": "not_statement", "rows": []})
    assert s.rows[0].n_matched == 0 and s.n_read_rows == 0


def test_extra_read_rows_only_affect_row_count():
    a = answer_row()
    s = score_image({"rows": [a]}, {"kind": "statement", "rows": [read_from_answer(a), read_from_answer(a)]})
    assert s.rows[0].n_matched == 10 and s.row_count_match is False


def test_match_rows_large_falls_back_to_order():
    rows = [answer_row(pnl_jpy=str(i)) for i in range(10)]
    reads = [read_from_answer(r) for r in rows[:9]]
    assert match_rows(rows, reads) == [(i, i if i < 9 else None) for i in range(10)]


def test_median_max_even_and_empty():
    assert median_max([1.0, 2.0, 3.0, 10.0]) == (2.5, 10.0)
    assert median_max([]) is None


def test_cost_usd_hand_calculation():
    # Opus 5.5: 入力 1,000 × $4 + 出力 200 × $20 + cache 読み 10,000 × $0.20 + cache 作成 2,000 × $4 × 1.25
    # = (4,000 + 4,000 + 2,000 + 10,000) / 1,000,000 = $0.02
    u = Usage(input_tokens=1000, output_tokens=200, cache_read_input_tokens=10000, cache_creation_input_tokens=2000)
    assert cost_usd("claude-opus-5-5", u) == Decimal("0.02")
    # Haiku 5.5: 1,000 × $0.10 + 200 × $0.50 = 200 / 1,000,000
    assert cost_usd("claude-haiku-5-5", Usage(input_tokens=1000, output_tokens=200)) == Decimal("0.0002")
    assert cost_usd("unknown-model", u) is None
    t = aggregate([], [], [u, u], "claude-opus-5-5")
    assert t.cost_total_usd == Decimal("0.04")


# ---- 性質（種つき乱数で 200 通り） ----


def _random_row(rng: random.Random) -> dict:
    def num(lo, hi, dec):
        v = Decimal(rng.randint(lo, hi)) / (10**dec)
        return format(v, "f")

    return answer_row(
        symbol=rng.choice(["JP225", "US30", "USD/JPY", "日経225mini 26/06", "日経225OP 26/04 C 39500"]),
        side=rng.choice(["L", "S", None]),
        entry_price=rng.choice([num(0, 10**7, rng.randint(0, 3)), None, "0"]),
        exit_price=num(-10, 10**7, rng.randint(0, 3)),
        qty=rng.choice([num(1, 10**6, 0), "0"]),
        fees=rng.choice([None, [num(0, 2000, 0) for _ in range(rng.randint(1, 4))]]),
        pnl_jpy=num(-(10**8), 10**8, 0),
        exit_order_type=rng.choice(["unknown", "stop", "market", "limit"]),
        entry_time=f"2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}T{rng.randint(0, 23):02d}:"
        f"{rng.randint(0, 59):02d}",
    )


def _rand_image(rng):
    return {"rows": [_random_row(rng) for _ in range(rng.randint(1, 5))]}


def _exact(img):
    return {"kind": "statement", "rows": [read_from_answer(r) for r in img["rows"]]}


def test_property_exact_reading_is_perfect():
    rng = random.Random(14)
    for _ in range(200):
        img = _rand_image(rng)
        s = score_image(img, _exact(img))
        assert s.row_count_match and s.hallucinations == 0
        assert all(r.n_matched == len(FIELDS) for r in s.rows)


def test_property_dropping_a_row():
    rng = random.Random(15)
    for _ in range(200):
        img = _rand_image(rng)
        if len(img["rows"]) < 2:
            continue
        read = _exact(img)
        k = rng.randrange(len(read["rows"]))
        del read["rows"][k]
        s = score_image(img, read)
        assert not s.row_count_match
        assert sum(r.n_matched for r in s.rows) <= len(FIELDS) * (len(img["rows"]) - 1)
        assert sum(r.n_matched == 0 for r in s.rows) >= 1


def test_property_order_invariant():
    rng = random.Random(16)
    for _ in range(200):
        img = _rand_image(rng)
        read = _exact(img)
        # 一部の欄を崩してから並べ替える
        for r in read["rows"]:
            if rng.random() < 0.5:
                r["qty"] = 999
        base = score_image(img, read)
        shuffled = {"kind": "statement", "rows": rng.sample(read["rows"], len(read["rows"]))}
        s = score_image(img, shuffled)
        t1, t2 = aggregate([base], [], [], "m"), aggregate([s], [], [], "m")
        assert t1.field_matches == t2.field_matches


def test_property_number_format_invariance_and_sign():
    rng = random.Random(17)
    for _ in range(200):
        v = Decimal(rng.randint(-(10**9), 10**9)) / (10 ** rng.randint(0, 3))
        plain = format(v, "f")
        sep = format(v, ",f")
        full = sep.translate(str.maketrans("0123456789,.-", "０１２３４５６７８９，．－"))
        assert normalize_number(plain) == normalize_number(sep) == normalize_number(full) == v
        assert normalize_number("¥" + sep) == v
        if v != 0:
            assert normalize_number(format(-v, "f")) != v


def test_property_aggregate_sums_and_bounds():
    rng = random.Random(18)
    imgs = [_rand_image(rng) for _ in range(200)]
    scores = []
    for img in imgs:
        read = _exact(img)
        for r in read["rows"]:
            for k in ("entry_price", "pnl_jpy", "symbol"):
                if rng.random() < 0.3:
                    r[k] = None
        if rng.random() < 0.1:
            read = None
        scores.append(score_image(img, read))
    t = aggregate(scores, [rng.random() * 20 for _ in range(50)], [], "m")
    assert t.n_answer_rows == sum(len(i["rows"]) for i in imgs)
    for name in FIELDS:
        assert 0 <= t.field_matches[name] <= t.n_answer_rows
        per = sum(r.matches[FIELDS.index(name)] for s in scores for r in s.rows)
        assert t.field_matches[name] == per
        rate = t.rate(name)
        assert rate is not None and rate == rate  # NaN でない
    assert t.seconds is not None


def test_property_extreme_values_do_not_raise():
    for v in ["0", "-0", "0.000", "99999999999999999999", "-99999999999999999999.999", "1e5", " ", "－"]:
        a = answer_row(pnl_jpy="0")
        compare_row(a, read_from_answer(a, pnl_jpy=None))
        normalize_number(v)
    assert aggregate([], [], [], "m").rate("qty") is None
