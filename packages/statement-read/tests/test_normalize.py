"""直しの純関数（Issue #11 の例 #1〜#28。AC-5〜AC-9 の純関数の側）。値はすべて架空"""

import copy
import random
from datetime import UTC, datetime

import pytest

from statement_read import normalize, values
from statement_read.result import Bad, check_result

ROW_KEYS = {
    "symbol",
    "side",
    "entryPrice",
    "exitPrice",
    "quantity",
    "pnlYen",
    "entryTime",
    "exitTime",
    "timeZoneNeedsCheck",
    "fees",
    "feesTotalYen",
    "exitOrderType",
}


def read_row(**kw) -> dict:
    """読み取りの 1 行（report_statement の入力の形。値は架空）"""
    row = {
        "symbol": "US30",
        "side_written": "buy",
        "side_of": "position",
        "entry_price": 39012.5,
        "entry_time": "2026-03-04T01:15",
        "exit_price": 39100.0,
        "exit_time": "2026-03-04T06:40",
        "time_zone": "GMT",
        "qty": 0.5,
        "fees": None,
        "pnl_jpy": 6500,
        "exit_order_type": "unknown",
    }
    row.update(kw)
    return row


def run(*rows, kind="statement") -> dict:
    return normalize.normalize_result(check_result({"kind": kind, "rows": list(rows)}))


def epoch_ms(y, mo, d, h, mi) -> int:
    return int(datetime(y, mo, d, h, mi, tzinfo=UTC).timestamp() * 1000)


# ---- AC-7: 向き（例 #1〜#6） ----


@pytest.mark.parametrize(
    "no,written,of,expected",
    [
        (1, "buy", "position", "L"),  # 形 1「買約定」
        (2, "sell", "position", "S"),  # 形 1「売約定」
        (3, "sell", "close", "L"),  # 形 2「決済売」
        (4, "buy", "close", "S"),  # 形 2「決済買」
        (5, "buy", None, None),  # 何の向きか不明
        (6, None, "position", None),  # 向きが読めない
    ],
)
def test_side_examples(no, written, of, expected):
    assert values.opened_side(written, of) == expected
    assert run(read_row(side_written=written, side_of=of))["rows"][0]["side"] == expected


# ---- AC-8: 日時（例 #7〜#12） ----


@pytest.mark.parametrize(
    "no,written,tz,jst,epoch",
    [
        # GMT・UTC は +9 時間（夏時間を見ない）
        (7, "2026-03-04T01:15", "GMT", "2026-03-04T10:15", epoch_ms(2026, 3, 4, 1, 15)),
        (8, "2026-03-04T20:30", "GMT", "2026-03-05T05:30", epoch_ms(2026, 3, 4, 20, 30)),  # 日付の境目
        (9, "2026-12-31T23:30", "UTC", "2027-01-01T08:30", epoch_ms(2026, 12, 31, 23, 30)),  # 年の境目
        # JST はそのまま。epoch は 9 時間前の UTC
        (10, "2026-03-04T10:15", "JST", "2026-03-04T10:15", epoch_ms(2026, 3, 4, 1, 15)),
        # 時間帯の表記なし: 直さない
        (11, "2026-03-04T10:15", "unknown", None, None),
    ],
)
def test_time_examples(no, written, tz, jst, epoch):
    assert normalize.to_jst(written, tz) == (jst, epoch)
    row = run(read_row(entry_time=written, exit_time=None, time_zone=tz))["rows"][0]
    assert row["entryTime"] == {"written": written, "timeZone": tz, "jst": jst, "epochMs": epoch}
    assert row["exitTime"] is None
    # 「時間帯の確認が要る」印は #11 だけ
    assert row["timeZoneNeedsCheck"] is (no == 11)


def test_time_example_12_unreadable():
    row = run(read_row(entry_time=None, exit_time=None, time_zone="GMT"))["rows"][0]
    assert row["entryTime"] is None and row["exitTime"] is None
    assert row["timeZoneNeedsCheck"] is False


def test_time_zone_null_is_unknown():
    row = run(read_row(time_zone=None))["rows"][0]
    assert row["entryTime"]["timeZone"] == "unknown" and row["entryTime"]["jst"] is None
    assert row["timeZoneNeedsCheck"] is True
    # 時刻が無ければ印を付けない
    assert run(read_row(time_zone=None, entry_time=None, exit_time=None))["rows"][0]["timeZoneNeedsCheck"] is False


def test_to_jst_none_written():
    assert normalize.to_jst(None, "GMT") == (None, None)


@pytest.mark.parametrize("written", ["2026-02-30T10:15", "2026-03-04T25:00", "2026-13-01T00:00", "2026-03-04T10:60"])
@pytest.mark.parametrize("tz", ["GMT", "UTC", "JST", "unknown", None])
def test_calendar_invalid_is_bad(written, tz):
    # 暦にない日時は「日時の書式の違い」として結果全体を捨てる（時間帯によらない）
    with pytest.raises(Bad) as e:
        normalize.to_jst(written, tz)
    assert e.value.reason == "format"
    with pytest.raises(Bad):
        run(read_row(exit_time=written, time_zone=tz))


def test_to_jst_properties():
    # 性質: GMT と UTC は同じ、JST は書かれた値と同じ、epoch の差はちょうど 9 時間
    rng = random.Random(1118)
    for _ in range(500):
        dt = datetime(rng.randrange(1990, 2100), rng.randrange(1, 13), rng.randrange(1, 29), rng.randrange(24),
                      rng.randrange(60))
        w = dt.strftime("%Y-%m-%dT%H:%M")
        assert normalize.to_jst(w, "GMT") == normalize.to_jst(w, "UTC")
        jst, ep = normalize.to_jst(w, "JST")
        assert jst == w
        _, ep_gmt = normalize.to_jst(w, "GMT")
        assert ep_gmt - ep == 9 * 3600 * 1000


# ---- AC-9: 手数料（例 #13〜#16） ----


def test_fee_examples():
    r13 = run(read_row(fees=[38, 3, 38, 3]))["rows"][0]
    assert r13["fees"] == [38, 3, 38, 3] and r13["feesTotalYen"] == 82
    r14 = run(read_row(fees=None))["rows"][0]
    assert r14["fees"] is None and r14["feesTotalYen"] is None  # 0 にしない
    r15 = run(read_row(fees=[0, 0]))["rows"][0]
    assert r15["feesTotalYen"] is not None and r15["feesTotalYen"] == 0
    r16 = run(read_row(fees=[]))["rows"][0]
    assert r16["fees"] == [] and r16["feesTotalYen"] is None


def test_fee_total_decimal_and_types():
    r = run(read_row(fees=[0.1, 0.2]))["rows"][0]
    assert r["feesTotalYen"] == 0.3 and isinstance(r["feesTotalYen"], float)
    r = run(read_row(fees=[38.0, 3]))["rows"][0]
    assert r["feesTotalYen"] == 41 and isinstance(r["feesTotalYen"], int)


def test_fee_out_of_range_drops_fees_only():
    r = run(read_row(fees=[38, 2e12]))["rows"][0]
    assert r["fees"] is None and r["feesTotalYen"] is None
    assert r["pnlYen"] == 6500 and r["side"] == "L"


# ---- AC-6: 形（例 #17〜#19・#26〜#28） ----


def test_example_17_one_row():
    out = run(read_row())
    assert out["kind"] == "statement" and len(out["rows"]) == 1
    r = out["rows"][0]
    assert r == {
        "symbol": "US30",
        "side": "L",
        "entryPrice": 39012.5,
        "exitPrice": 39100.0,
        "quantity": 0.5,
        "pnlYen": 6500,
        "entryTime": {"written": "2026-03-04T01:15", "timeZone": "GMT", "jst": "2026-03-04T10:15",
                      "epochMs": epoch_ms(2026, 3, 4, 1, 15)},
        "exitTime": {"written": "2026-03-04T06:40", "timeZone": "GMT", "jst": "2026-03-04T15:40",
                     "epochMs": epoch_ms(2026, 3, 4, 6, 40)},
        "timeZoneNeedsCheck": False,
        "fees": None,
        "feesTotalYen": None,
        "exitOrderType": "unknown",
    }


def test_example_18_zero_and_loss():
    out = run(read_row(pnl_jpy=0), read_row(pnl_jpy=-12340, side_written="sell"))
    assert [r["pnlYen"] for r in out["rows"]] == [0, -12340]
    # 損益は 0 以下でも空にしない（負けを消さない）
    assert out["rows"][0]["pnlYen"] is not None and out["rows"][0]["pnlYen"] == 0


def test_example_19_not_statement():
    assert run(kind="not_statement") == {"kind": "notStatement", "rows": []}
    # 行が付いていても返さない
    assert run(read_row(), kind="not_statement") == {"kind": "notStatement", "rows": []}


@pytest.mark.parametrize("symbol", ["X" * 41, "US30;DROP", "US30@x", "<script>"])
def test_examples_26_27_symbol_only_blank(symbol):
    r = run(read_row(symbol=symbol))["rows"][0]
    assert r["symbol"] is None
    assert r["side"] == "L" and r["entryPrice"] == 39012.5 and r["pnlYen"] == 6500 and r["quantity"] == 0.5


def test_symbol_40_chars_kept():
    assert run(read_row(symbol="X" * 40))["rows"][0]["symbol"] == "X" * 40


@pytest.mark.parametrize("qty", [0, -1, 0.0])
def test_example_28_quantity_only_blank(qty):
    r = run(read_row(qty=qty))["rows"][0]
    assert r["quantity"] is None
    assert r["entryPrice"] == 39012.5 and r["exitPrice"] == 39100.0 and r["pnlYen"] == 6500


@pytest.mark.parametrize("key,out_key", [("entry_price", "entryPrice"), ("exit_price", "exitPrice")])
@pytest.mark.parametrize("v", [0, -5, 1e12 + 1, -2e12])
def test_price_out_of_range_only_blank(key, out_key, v):
    r = run(read_row(**{key: v}))["rows"][0]
    assert r[out_key] is None and r["quantity"] == 0.5 and r["pnlYen"] == 6500


def test_huge_quantity_and_pnl_blank():
    r = run(read_row(qty=1e13, pnl_jpy=-1e13))["rows"][0]
    assert r["quantity"] is None and r["pnlYen"] is None
    # 境目: 1e12 ちょうどは残す
    r = run(read_row(qty=1e12, pnl_jpy=-1e12, entry_price=1e12))["rows"][0]
    assert r["quantity"] == 1e12 and r["pnlYen"] == -1e12 and r["entryPrice"] == 1e12


def test_order_types_pass_through():
    for t in ("stop", "market", "limit", "unknown"):
        assert run(read_row(exit_order_type=t))["rows"][0]["exitOrderType"] == t


def test_rows_order_kept():
    out = run(*[read_row(pnl_jpy=i) for i in range(5)])
    assert [r["pnlYen"] for r in out["rows"]] == [0, 1, 2, 3, 4]


# ---- AC-5: 全体を捨てる（例 #20〜#24。#25 は送り口の側） ----


@pytest.mark.parametrize(
    "no,mutate",
    [
        (20, lambda r: r["rows"][0].update({"account_number": "x"})),
        (21, lambda r: r["rows"][0].update({"entry_price": "39,012.5"})),
        (22, lambda r: r["rows"][0].update({"side_written": "long"})),
        (23, lambda r: r["rows"][0].update({"entry_time": "04/03/2026 10:15"})),
        (24, lambda r: r.update({"rows": [read_row() for _ in range(21)]})),
    ],
)
def test_invalid_examples_raise(no, mutate):
    raw = {"kind": "statement", "rows": [read_row()]}
    mutate(raw)
    with pytest.raises(Bad):
        normalize.normalize_result(check_result(raw))


# ---- 性質 ----


def test_row_shape_is_constant_and_in_range_values_unchanged():
    rng = random.Random(42)
    for _ in range(400):
        row = read_row(
            symbol=rng.choice([None, "JP225", "X" * 41]),
            side_written=rng.choice(["buy", "sell", None]),
            side_of=rng.choice(["position", "close", None]),
            entry_price=rng.choice([None, round(rng.uniform(0.01, 1e6), 2), 0, -1]),
            exit_price=rng.choice([None, round(rng.uniform(0.01, 1e6), 2)]),
            qty=rng.choice([None, rng.randrange(1, 1000), 0]),
            pnl_jpy=rng.choice([None, rng.randrange(-10**7, 10**7), 0]),
            fees=rng.choice([None, [], [rng.randrange(0, 500) for _ in range(rng.randrange(1, 5))]]),
            time_zone=rng.choice(["GMT", "UTC", "JST", "unknown", None]),
            exit_order_type=rng.choice(["stop", "market", "limit", "unknown"]),
        )
        before = copy.deepcopy(row)
        out = run(row)["rows"][0]
        assert set(out) == ROW_KEYS
        assert row == before  # 入力を変えない
        for src, dst, positive in (("entry_price", "entryPrice", True), ("exit_price", "exitPrice", True),
                                   ("qty", "quantity", True), ("pnl_jpy", "pnlYen", False)):
            v = row[src]
            if v is None or (positive and v <= 0):
                assert out[dst] is None
            else:
                assert out[dst] == v and type(out[dst]) is type(v)
        if row["fees"]:
            assert out["feesTotalYen"] == sum(row["fees"])


@pytest.mark.parametrize("written,tz", [("0001-01-01T00:00", "JST"), ("9999-12-31T23:30", "GMT")])
def test_calendar_edges_do_not_crash(written, tz):
    with pytest.raises(Bad):
        normalize.to_jst(written, tz)


# ---- レビューの指摘 1: 銘柄の名前の空白は半角と全角だけ ----


@pytest.mark.parametrize(
    "symbol",
    ["US30\n", "US\n30", "US\t30", "US30\r", "US\x1c30", "US\x1f30", "US\x8530", "US 30", "US 30",
     "US\x0b30", "US\x0c30", "   ", "\n\n", "　　", " 　 "],
)
def test_symbol_rejects_control_and_blank(symbol):
    r = run(read_row(symbol=symbol))["rows"][0]
    assert r["symbol"] is None and r["side"] == "L" and r["pnlYen"] == 6500


@pytest.mark.parametrize("symbol", ["日経225 先物", "日経225　先物", "US 30", "日経225OP 26/04 C 39500"])
def test_symbol_allows_half_and_full_width_space(symbol):
    assert run(read_row(symbol=symbol))["rows"][0]["symbol"] == symbol


# ---- レビューの指摘 2: 日本時間は常に YYYY-MM-DDTHH:MM ----


@pytest.mark.parametrize(
    "written,tz,jst",
    [
        ("0005-01-01T05:00", "GMT", "0005-01-01T14:00"),
        ("0999-12-31T20:00", "UTC", "1000-01-01T05:00"),
        ("0010-06-01T10:00", "JST", "0010-06-01T10:00"),
    ],
)
def test_jst_is_zero_padded_for_small_years(written, tz, jst):
    got, _ = normalize.to_jst(written, tz)
    assert got == jst
    import re

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", got)
