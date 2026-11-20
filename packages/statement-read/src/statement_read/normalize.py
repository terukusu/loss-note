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
- オプションの行（#118。設計書 7.6・C51）: 読み取りの ``option`` が null でない行だけ、応答の行に ``option`` を足す
  （オプションでない行の鍵の集合は前と同じ）。``{underlying, expiry: "YYYY-MM" | null, expiryYearInferred,
  putCall, strike, side: "buy" | "sell" | null, position}``。限月は ``values.expiry_of``（年が無ければ建てた日から。
  建てた日は取引所の日付 = 日本時間（国内のオプション。時間帯が読めなければ書かれた日）。``opened_for_expiry``）、
  向きは ``values.option_side``（建てた向きの買い / 売り）。``position`` は同じ原資産（名前の同一視）で建てた日
  （日本時間。時間帯が読めなければ書かれた日）が同じオプションの行に同じ番号（0 から、最初に出た順）を振る
  （1 つのポジションの下書きにまとめる単位）。原資産の名前（無ければ銘柄の名前）か建てた日が無い行は 1 行で 1 つ
"""

import unicodedata
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from .result import UNKNOWN_CURRENCY, Bad
from .values import expiry_of, opened_side, option_side, sum_fees

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


def _opened_day(entry: dict | None) -> str | None:
    """建てた日（日本時間の YYYY-MM-DD。直せなければ書かれた日）"""
    if entry is None:
        return None
    t = entry.get("jst") or entry.get("written")
    return t[:10] if isinstance(t, str) else None


def _name_key(name) -> str | None:
    """原資産の名前の同一視（API の ``schema.name_key`` と同じ: NFKC・大文字小文字・前後の空白）"""
    if not isinstance(name, str):
        return None
    k = unicodedata.normalize("NFKC", name).casefold().strip()
    return k or None


def opened_for_expiry(entry_time: str | None, tz: str | None) -> str | None:
    """年の無い限月を補う建てた日時（設計書 7.6 の 1）。取引所の日付 = 日本時間（日経 225 オプションなど国内の
    取引所の暦。明細の時間帯が GMT でも日本時間に直してから比べる）。時間帯が読めなければ書かれた日時。
    API の直しと評価の道具の採点が同じ規則で使う。暦にない日時は None（例外を出さない）"""
    if entry_time is None:
        return None
    try:
        jst, _ = to_jst(entry_time, tz)
    except Bad:
        return None
    return jst or entry_time


def _option(row: dict, entry: dict | None) -> dict | None:
    opt = row.get("option")
    if opt is None:
        return None
    opened = None if entry is None else (entry.get("jst") or entry.get("written"))  # = opened_for_expiry
    expiry, inferred = expiry_of(opt.get("expiry_year"), opt.get("expiry_month"), opened)
    return {
        "underlying": opt.get("underlying"),
        "expiry": expiry,
        "expiryYearInferred": inferred,
        "putCall": opt.get("put_call"),
        "strike": _positive(opt.get("strike")),
        "side": option_side(row.get("side_written"), row.get("side_of")),
        "position": None,
    }


def group_positions(rows: list[dict]) -> list[dict]:
    """応答の行（``normalize_row`` の出力）のオプションの行に ``option.position`` を振る（新しい行の並びを返す。
    入力は変えない）。鍵 = (原資産の名前の同一視（無ければ銘柄の名前）, 建てた日)"""
    out: list[dict] = []
    keys: dict[tuple[str, str], int] = {}
    n = 0
    for r in rows:
        opt = r.get("option")
        if opt is None:
            out.append(r)
            continue
        name = _name_key(opt.get("underlying")) or _name_key(r.get("symbol"))
        day = _opened_day(r.get("entryTime"))
        if name is None or day is None:
            pos, n = n, n + 1
        elif (name, day) in keys:
            pos = keys[(name, day)]
        else:
            pos = keys[(name, day)] = n
            n += 1
        out.append({**r, "option": {**opt, "position": pos}})
    return out


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
    out = {
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
    opt = _option(row, entry)
    if opt is not None:
        out["option"] = opt
    return out


def normalize_result(checked: dict) -> dict:
    """``check_result`` の出力 → {"kind": "statement" | "notStatement", "rows": [...]}。行の順序を保つ。
    暦にない日時は Bad（API は結果全体を捨てる）。会社の名前（issuer）は写さない"""
    if checked.get("kind") != "statement":
        return {"kind": "notStatement", "rows": []}
    rows = group_positions([normalize_row(r) for r in checked.get("rows") or []])
    return {"kind": "statement", "rows": rows}
