"""読み取りの結果（``result.check_result`` を通ったもの）→ API の応答の形。純関数（I/O・今の時刻を持たない）。

- 向き: ``values.opened_side``（書かれた向き × 何の向きか → L / S。直せなければ None）
- 日時: 時間帯が GMT / UTC なら +9 時間（夏時間を見ない）、JST はそのまま、unknown・None は直さずに印を付ける。
  暦にない日時（2 月 30 日・25 時など）は「日時の書式の違い」として結果全体を捨てる（``Bad``）
- 手数料: 欄ごとの値と、``values.sum_fees`` の合計（None・空配列 → None、0・0 → 0）
- 範囲の外: 数量・価格が 0 以下、数量・価格・損益の絶対値が 1e12 超 → その欄だけ None。手数料の要素に絶対値 1e12 超が
  あれば手数料の欄と合計を None。損益・価格・数量の値そのものは直さない（書かれた数を同じ型で返す）
- 通貨（#66）: 損益・手数料の合計は明細の通貨のまま ``pnl``・``feesTotal`` と ``pnlCurrency``（英字 3 文字か unknown）。
  前からの ``pnlYen``・``feesTotalYen`` は通貨が JPY か unknown のときだけ値、ほかは None（USD の数を円として入れない）
- 会社の名前（``issuer``）は応答に入れない（API が鍵に変えて捨てる。#66）
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from .result import UNKNOWN_CURRENCY, Bad
from .values import opened_side, sum_fees

MAX_ABS = 1e12
_JST = timedelta(hours=9)
_FORMAT = "%Y-%m-%dT%H:%M"
# 前からの円の欄（pnlYen・feesTotalYen）に値を入れる通貨
_YEN_OR_UNKNOWN = ("JPY", UNKNOWN_CURRENCY)


def _parse(written: str) -> datetime:
    try:
        return datetime.strptime(written, _FORMAT)
    except ValueError:
        raise Bad("time", "format") from None


def to_jst(written: str | None, tz: str | None) -> tuple[str | None, int | None]:
    """書かれた日時（YYYY-MM-DDTHH:MM）と時間帯 → (日本時間の YYYY-MM-DDTHH:MM, UTC の epoch ms)。
    時間帯が unknown・None なら (None, None)。暦にない日時は Bad("time", "format")（時間帯によらない）"""
    if written is None:
        return None, None
    dt = _parse(written)
    if tz not in ("GMT", "UTC", "JST"):
        return None, None
    try:
        utc = dt - _JST if tz == "JST" else dt
        j = utc + _JST
    except OverflowError:  # 0001-01-01 より前・9999-12-31 より後になる（暦の外）
        raise Bad("time", "format") from None
    # strftime の %Y は年が 1000 未満だと 4 桁に埋めない（環境による）ので、桁をそろえて組み立てる
    jst = f"{j.year:04d}-{j.month:02d}-{j.day:02d}T{j.hour:02d}:{j.minute:02d}"
    epoch_ms = int(utc.replace(tzinfo=UTC).timestamp()) * 1000
    return jst, epoch_ms


def _time(written: str | None, tz: str | None) -> dict | None:
    if written is None:
        return None
    jst, epoch_ms = to_jst(written, tz)
    return {"written": written, "timeZone": tz or "unknown", "jst": jst, "epochMs": epoch_ms}


def _positive(v):
    return v if v is not None and 0 < v <= MAX_ABS else None


def _bounded(v):
    return v if v is not None and abs(v) <= MAX_ABS else None


def _json_number(d: Decimal) -> int | float:
    return int(d) if d == d.to_integral_value() else float(d)


def normalize_row(row: dict) -> dict:
    """``check_read_row`` を通った 1 行 → 応答の 1 行（欄の鍵の集合は常に同じ）"""
    tz = row.get("time_zone")
    fees = row.get("fees")
    if fees is not None and any(abs(x) > MAX_ABS for x in fees):
        fees = None
    total = sum_fees(list(fees)) if fees is not None else None
    entry, exit_ = _time(row.get("entry_time"), tz), _time(row.get("exit_time"), tz)
    currency = row.get("pnl_currency") or UNKNOWN_CURRENCY
    pnl = _bounded(row.get("pnl"))
    fees_total = None if total is None else _json_number(total)
    yen = currency in _YEN_OR_UNKNOWN
    return {
        "symbol": row.get("symbol"),
        "side": opened_side(row.get("side_written"), row.get("side_of")),
        "entryPrice": _positive(row.get("entry_price")),
        "exitPrice": _positive(row.get("exit_price")),
        "quantity": _positive(row.get("qty")),
        "pnl": pnl,
        "pnlCurrency": currency,
        "pnlYen": pnl if yen else None,
        "entryTime": entry,
        "exitTime": exit_,
        "timeZoneNeedsCheck": (entry is not None or exit_ is not None) and tz in (None, "unknown"),
        "fees": None if fees is None else list(fees),
        "feesTotal": fees_total,
        "feesTotalYen": fees_total if yen else None,
        "exitOrderType": row.get("exit_order_type") or "unknown",
    }


def normalize_result(checked: dict) -> dict:
    """``check_result`` の出力 → {"kind": "statement" | "notStatement", "rows": [...]}。行の順序を保つ。
    暦にない日時は Bad（API は結果全体を捨てる）。会社の名前（issuer）は写さない"""
    if checked.get("kind") != "statement":
        return {"kind": "notStatement", "rows": []}
    return {"kind": "statement", "rows": [normalize_row(r) for r in checked.get("rows") or []]}
