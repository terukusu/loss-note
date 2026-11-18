"""数・日時・向き・手数料の純関数（評価の道具の採点と API の直しが共有する）。I/O・時刻・乱数を持たない。

- 数は Decimal にそろえる（桁区切り・全角・通貨の記号は無視、符号は区別）
- 向きは明細に書かれた売買の向き（side_written）と、その向きが建玉そのものの向きか決済の向きか（side_of）から、
  建てた向き（L / S）に直す（AI に反転させない。C27）
  - 形 1（1 行 1 取引で「方向」の欄に「売約定」「買約定」）: 建玉そのものの向き → 売約定 = S、買約定 = L
  - 形 2（「決済売」「決済買」）: 決済の向き → 決済売 = L、決済買 = S
- 手数料は欄ごとの配列の合計（合計は AI でなくここで出す）
- 明細を出した会社の名前の比べる形（``issuer_key``。API の明細の特徴の鍵と評価の道具の採点が共有する。#66）
"""

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

ORDER_TYPES = ("stop", "market", "limit", "unknown")

_CURRENCY = ("USD", "JPY", "¥", "円", "$")
_MINUS = ("−", "▲", "△", "－", "‐", "–")
_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$")


@dataclass(frozen=True)
class Usage:
    """使用量（トークン数）。提供元が返す値をそのまま"""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


def normalize_number(v: str | int | float | Decimal | None) -> Decimal | None:
    """数の文字列・数 → Decimal。読めなければ None（NaN・無限も None）"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, Decimal):
        d = v
    elif isinstance(v, int):
        d = Decimal(v)
    elif isinstance(v, float):
        d = Decimal(repr(v))
    elif isinstance(v, str):
        s = unicodedata.normalize("NFKC", v)
        s = "".join(s.split())
        for c in _CURRENCY:
            s = s.replace(c, "")
        s = s.replace(",", "")
        neg = False
        if s[:1] in _MINUS or s[:1] == "-":
            neg = True
            s = s[1:]
        elif s[:1] == "+":
            s = s[1:]
        if not s or not re.fullmatch(r"\d+(\.\d+)?|\.\d+", s):
            return None
        try:
            d = Decimal(s)
        except InvalidOperation:
            return None
        if neg:
            d = -d
    else:
        return None
    if not d.is_finite():
        return None
    return d


def time_key(v: str | None) -> tuple[int, int, int, int, int] | None:
    """ISO の日時 → (年, 月, 日, 時, 分)。読めなければ None"""
    if not isinstance(v, str):
        return None
    m = _ISO_RE.match(unicodedata.normalize("NFKC", v).strip())
    if not m:
        return None
    return tuple(int(x) for x in m.groups())  # type: ignore[return-value]


def opened_side(side_written: str | None, side_of: str | None) -> Literal["L", "S"] | None:
    """明細に書かれた向き → 建てた向き。side_of = position（建玉そのものの向き。形 1 の「売約定」）はそのまま、
    close（決済の向き。形 2 の「決済売」）は反転する"""
    if side_written not in ("buy", "sell"):
        return None
    if side_of == "position":
        return "L" if side_written == "buy" else "S"
    if side_of == "close":
        return "L" if side_written == "sell" else "S"
    return None


def sum_fees(v: list | None) -> Decimal | None:
    """手数料・消費税の欄ごとの配列 → 合計。None・空配列・読めない要素がある配列は None（例外を出さない）"""
    if v is None:
        return None
    if not isinstance(v, list) or not v:
        return None
    total = Decimal(0)
    for x in v:
        d = normalize_number(x)
        if d is None:
            return None
        total += d
    return total


def issuer_key(issuer) -> str | None:
    """明細を出した会社の名前 → 比べる形（NFKC・大文字小文字・前後と間の空白の違いを同じとみなす。#66 の S15）。
    文字列でない・空白だけなら None（鍵を作らない）"""
    if not isinstance(issuer, str):
        return None
    k = "".join(unicodedata.normalize("NFKC", issuer).casefold().split())
    return k or None
