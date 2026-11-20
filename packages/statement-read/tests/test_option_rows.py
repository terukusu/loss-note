"""オプションの行の読み取り（Issue #118。設計書 7.6・C51・C27）。値はすべて架空"""

import pytest

from statement_read import normalize, prompt, values
from statement_read.result import OPTION_KEYS, READ_ROW_KEYS, TOOL_INPUT_SCHEMA, Bad, check_result


def opt(**kw) -> dict:
    o = {"underlying": "日経225OP", "expiry_year": 27, "expiry_month": 1, "put_call": "put", "strike": 36000}
    o.update(kw)
    return o


def read_row(**kw) -> dict:
    """形 2（決済の向き・日本時間）のオプションの 1 行"""
    row = {
        "symbol": "日経225OP 27/01 P 36000",
        "side_written": "buy",
        "side_of": "close",
        "entry_price": 120,
        "entry_time": "2026-12-10T10:05",
        "exit_price": 60,
        "exit_time": "2026-12-15T13:50",
        "time_zone": "JST",
        "qty": 2,
        "fees": [275, 27, 275, 27],
        "pnl": 119396,
        "pnl_currency": "JPY",
        "exit_order_type": "unknown",
        "option": opt(),
    }
    row.update(kw)
    return row


def run(*rows) -> dict:
    return normalize.normalize_result(check_result({"kind": "statement", "issuer": None, "rows": list(rows)}))


# ---- 純関数: 年の無い限月を建てた日から直す ----


@pytest.mark.parametrize(
    "year,month,opened,want",
    [
        (2027, 1, "2026-12-10T10:05", ("2027-01", False)),  # 4 桁はそのまま
        (27, 1, "2026-12-10T10:05", ("2027-01", False)),  # 2 桁は 2000 年代
        (None, 1, "2026-12-10T10:05", ("2027-01", True)),  # 建てた月より前の月 → 翌年
        (None, 12, "2026-12-10T10:05", ("2026-12", True)),  # 同じ月 → 同じ年
        (None, 3, "2026-02-24T10:05", ("2026-03", True)),  # 後の月 → 同じ年
        (None, 1, None, (None, False)),  # 建てた日が無ければ直さない
        (None, 13, "2026-02-24T10:05", (None, False)),
        (2026, None, "2026-02-24T10:05", (None, False)),
        (True, 1, "2026-02-24T10:05", (None, False)),
        (100, 1, "2026-02-24T10:05", (None, False)),
    ],
)
def test_expiry_of(year, month, opened, want):
    assert values.expiry_of(year, month, opened) == want


def test_expiry_of_never_before_opened_month():
    """性質: 年が無いとき、直した限月は建てた月以降で、12 か月より先にならない"""
    for om in range(1, 13):
        for m in range(1, 13):
            got, inferred = values.expiry_of(None, m, f"2026-{om:02d}-15T09:00")
            assert inferred
            y, mm = int(got[:4]), int(got[5:])
            months_ahead = (y - 2026) * 12 + (mm - om)
            assert 0 <= months_ahead <= 11


# ---- 純関数: 建てた向きの買い / 売り（C27） ----


@pytest.mark.parametrize(
    "written,of,want",
    [
        ("buy", "close", "sell"),  # 決済買 = 売って建てた
        ("sell", "close", "buy"),  # 決済売 = 買って建てた
        ("buy", "position", "buy"),
        ("sell", "position", "sell"),
        ("buy", None, None),
        (None, "close", None),
    ],
)
def test_option_side(written, of, want):
    assert values.option_side(written, of) == want


# ---- ツールの形と検査 ----


def test_tool_schema_has_option_object():
    items = TOOL_INPUT_SCHEMA["properties"]["rows"]["items"]
    assert tuple(items["properties"]) == READ_ROW_KEYS
    o = items["properties"]["option"]
    assert o["type"] == ["object", "null"] and o["additionalProperties"] is False
    assert tuple(o["properties"]) == OPTION_KEYS == tuple(o["required"])
    assert "option" in prompt.READ_SYSTEM


def test_futures_row_without_option_key_is_unchanged():
    """option の鍵が無い・null の行は前と同じ応答（鍵の集合も同じ）"""
    row = read_row()
    row.pop("option")
    a = run(row)["rows"][0]
    b = run(read_row(option=None))["rows"][0]
    assert a == b and "option" not in a


@pytest.mark.parametrize(
    "mutate,path",
    [
        (lambda o: o.update(extra=1), "result.rows[0].option.<unknown>"),
        (lambda o: o.update(put_call="P"), "result.rows[0].option.put_call"),
        (lambda o: o.update(expiry_month=1.5), "result.rows[0].option.expiry_month"),
        (lambda o: o.update(expiry_year="27"), "result.rows[0].option.expiry_year"),
        (lambda o: o.update(strike="36000"), "result.rows[0].option.strike"),
        (lambda o: o.update(underlying=1), "result.rows[0].option.underlying"),
    ],
)
def test_option_shape_errors(mutate, path):
    o = opt()
    mutate(o)
    with pytest.raises(Bad) as e:
        check_result({"kind": "statement", "rows": [read_row(option=o)]})
    assert e.value.path == path
    assert "36000" not in str(e.value)


def test_option_type_error():
    with pytest.raises(Bad) as e:
        check_result({"kind": "statement", "rows": [read_row(option=[1])]})
    assert e.value.path == "result.rows[0].option"


def test_out_of_range_option_fields_drop_only_that_field():
    r = run(read_row(option=opt(underlying="OP<script>", expiry_month=13, expiry_year=123, strike=-1)))["rows"][0]
    o = r["option"]
    assert o["underlying"] is None and o["expiry"] is None and o["strike"] is None
    assert o["putCall"] == "put" and r["pnl"] == 119396


# ---- 応答の形 ----


def test_option_row_response():
    r = run(read_row(option=opt(expiry_year=None)))["rows"][0]
    assert r["side"] == "S"  # 前からの L / S はそのまま
    assert r["option"] == {
        "underlying": "日経225OP",
        "expiry": "2027-01",
        "expiryYearInferred": True,
        "putCall": "put",
        "strike": 36000,
        "side": "sell",
        "position": 0,
    }


def test_expiry_uses_jst_opened_day():
    """GMT で 11-30 の夜 = 日本時間で 12-01。年の無い 12 月限は 2026-12（日本時間の建てた日で直す）"""
    r = run(read_row(time_zone="GMT", entry_time="2026-11-30T20:00", exit_time="2026-12-02T01:00",
                     option=opt(expiry_year=None, expiry_month=11)))["rows"][0]
    assert r["entryTime"]["jst"] == "2026-12-01T05:00"
    assert r["option"]["expiry"] == "2027-11"


def test_group_same_underlying_same_opened_day():
    """同じ原資産（名前の同一視）で建てた日が同じ行は同じポジション。違う日・違う原資産・先物は分かれる"""
    rows = [
        read_row(symbol="日経225OP 27/01 P 36000", option=opt(strike=36000)),
        read_row(symbol="日経225OP 27/01 P 35500", side_written="sell", entry_time="2026-12-10T10:06",
                 option=opt(underlying=" 日経２２５ｏｐ ", strike=35500)),
        read_row(symbol="日経225mini 27/03", option=None),
        read_row(entry_time="2026-12-11T09:30", option=opt(strike=37000, put_call="call")),
        read_row(symbol="TOPIXOP 27/01 C 2800", option=opt(underlying="TOPIXOP", strike=2800, put_call="call")),
        read_row(symbol=None, option=opt(underlying=None)),
        read_row(entry_time=None, option=opt()),
    ]
    out = run(*rows)["rows"]
    assert "option" not in out[2]
    positions = [r["option"]["position"] if "option" in r else None for r in out]
    assert positions == [0, 0, None, 1, 2, 3, 4]
    assert [out[0]["option"]["side"], out[1]["option"]["side"]] == ["sell", "buy"]


def test_group_falls_back_to_symbol_and_written_day():
    """原資産の名前が無ければ銘柄の名前、時間帯が読めなければ書かれた日でまとめる"""
    rows = [
        read_row(symbol="OPX", time_zone="unknown", option=opt(underlying=None)),
        read_row(symbol="opx", time_zone="unknown", option=opt(underlying=None, strike=35000)),
    ]
    out = run(*rows)["rows"]
    assert [r["option"]["position"] for r in out] == [0, 0]
    assert out[0]["option"]["expiry"] == "2027-01"


# ---- レビュー B1: 中身がすべて null の option はオプションでない行（先物の応答を変えない） ----


_NULLS = dict.fromkeys(OPTION_KEYS)


@pytest.mark.parametrize("empty", [
    {}, _NULLS, {**_NULLS, "underlying": ""}, {**_NULLS, "underlying": "  "}, {**_NULLS, "underlying": "　"},
    {"underlying": " ", "expiry_month": None}, {**_NULLS, "expiry_month": 13, "expiry_year": 123},
])
def test_all_null_option_is_not_an_option_row(empty):
    want = run(read_row(option=None))["rows"][0]
    got = run(read_row(option=empty))["rows"][0]
    assert got == want and "option" not in got
    assert check_result({"kind": "statement", "rows": [read_row(option=empty)]})["rows"][0]["option"] is None


def test_one_field_is_enough_for_an_option_row():
    r = run(read_row(option={**dict.fromkeys(OPTION_KEYS), "put_call": "call"}))["rows"][0]
    assert r["option"]["putCall"] == "call" and r["option"]["expiry"] is None


# ---- レビュー N5: 行使価格の境目 ----


@pytest.mark.parametrize("strike,want", [(0, None), (-1, None), (1e12, 1e12), (1e12 + 1, None), (0.5, 0.5)])
def test_strike_bounds(strike, want):
    assert run(read_row(option=opt(strike=strike)))["rows"][0]["option"]["strike"] == want


# ---- 年の補いの建てた日 = 取引所の日付（日本時間） ----


@pytest.mark.parametrize(
    "written,tz,want",
    [
        ("2026-11-30T16:00", "GMT", "2026-12-01T01:00"),  # GMT の月末の夜 = 日本時間の翌月
        ("2026-11-30T16:00", "JST", "2026-11-30T16:00"),
        ("2026-11-30T16:00", "unknown", "2026-11-30T16:00"),  # 時間帯が読めなければ書かれた日時
        (None, "GMT", None),
        ("2026-02-30T10:00", "JST", None),  # 暦にない日時は None（例外を出さない）
    ],
)
def test_opened_for_expiry(written, tz, want):
    assert normalize.opened_for_expiry(written, tz) == want
