"""テスト用の組み立て（値はすべて架空）"""

from decimal import Decimal

from statement_eval.score import FIELDS


def answer_row(**kw) -> dict:
    row = {
        "symbol": "JP225",
        "side": "L",
        "entry_price": "38250",
        "entry_time": "2026-03-04T01:15",
        "exit_price": "38610",
        "exit_time": "2026-03-04T06:40",
        "qty": "10",
        "fees": None,
        "pnl": "3600",
        "pnl_currency": "JPY",
        "exit_order_type": "unknown",
    }
    row.update(kw)
    assert set(row) == set(FIELDS)
    return row


def _num(s):
    if s is None:
        return None
    d = Decimal(s)
    return int(d) if d == d.to_integral_value() else float(d)


def read_from_answer(a: dict, **kw) -> dict:
    """正解どおりの読み取りの行（形 2 の書き方: L = 決済売、S = 決済買）"""
    side = a["side"]
    row = {
        "symbol": a["symbol"],
        "side_written": None if side is None else ("sell" if side == "L" else "buy"),
        "side_of": None if side is None else "close",
        "entry_price": _num(a["entry_price"]),
        "entry_time": a["entry_time"],
        "exit_price": _num(a["exit_price"]),
        "exit_time": a["exit_time"],
        "time_zone": "unknown",
        "qty": _num(a["qty"]),
        "fees": None if a["fees"] is None else [_num(x) for x in a["fees"]],
        "pnl": _num(a["pnl"]),
        "pnl_currency": a["pnl_currency"],
        "exit_order_type": a["exit_order_type"],
    }
    row.update(kw)
    return row
