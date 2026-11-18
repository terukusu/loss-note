"""読み取りの結果の形（ツール report_statement の入力）と検査。

外れたときは Bad(位置, 理由) を投げる。メッセージに値を入れない（出力・ログに値を反射しない）。
"""

import re
from typing import Any

from .values import ORDER_TYPES, normalize_number, time_key

TOOL_NAME = "report_statement"
MAX_ROWS = 20
MAX_SYMBOL_LEN = 40
MAX_FEES = 8
KINDS = ("statement", "not_statement")
SIDE_WRITTEN = ("buy", "sell")
# position = 書かれた向きが建玉そのものの向き（形 1 の「売約定」「買約定」）
# close = 決済の注文の向き（形 2 の「決済売」「決済買」）
SIDE_OF = ("position", "close")
TIME_ZONES = ("GMT", "JST", "UTC", "unknown")
READ_ROW_KEYS = (
    "symbol",
    "side_written",
    "side_of",
    "entry_price",
    "entry_time",
    "exit_price",
    "exit_time",
    "time_zone",
    "qty",
    "fees",
    "pnl",
    "pnl_currency",
    "exit_order_type",
)
# 損益・手数料の通貨（英字 3 文字か unknown。外れたら unknown。#66）
UNKNOWN_CURRENCY = "unknown"
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
# 明細を出した会社・サービスの名前の上限（#66。銘柄の名前と同じ文字・長さ。外れたら None で捨てる）
MAX_ISSUER_LEN = MAX_SYMBOL_LEN
# 銘柄の名前に許す文字（英数・かな・漢字・半角と全角の空白・/ . - ( ) ・ と全角の同じもの）。外れたらその欄だけ None
# （C21）。空白は半角（U+0020）と全角（U+3000）だけ（\s は改行・タブ・制御文字の区切りも通すので使わない）。全体に当てる
_SYMBOL_RE = re.compile(r"[0-9A-Za-z０-９Ａ-Ｚａ-ｚ぀-ヿ一-鿿々 　/／.．\-－()（）・ー]+")


def _symbol_ok(sym: str) -> bool:
    """許した文字だけ・40 文字以下・空白だけでない"""
    return len(sym) <= MAX_SYMBOL_LEN and _SYMBOL_RE.fullmatch(sym) is not None and sym.strip(" 　") != ""
_ISO_MINUTE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


class Bad(ValueError):
    """検査の失敗。位置と理由だけを持つ（値は持たない）"""

    def __init__(self, path: str, reason: str):
        super().__init__(f"{path}: {reason}")
        self.path = path
        self.reason = reason


_NUM = {"type": ["number", "null"]}
_TIME = {"type": ["string", "null"], "description": "YYYY-MM-DDTHH:MM（明細の時間帯のまま。換算しない）"}

TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "issuer", "rows"],
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "issuer": {"type": ["string", "null"], "maxLength": MAX_ISSUER_LEN},
        "rows": {
            "type": "array",
            "maxItems": MAX_ROWS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": list(READ_ROW_KEYS),
                "properties": {
                    "symbol": {"type": ["string", "null"], "maxLength": MAX_SYMBOL_LEN},
                    "side_written": {"type": ["string", "null"], "enum": [*SIDE_WRITTEN, None]},
                    "side_of": {"type": ["string", "null"], "enum": [*SIDE_OF, None]},
                    "entry_price": _NUM,
                    "entry_time": _TIME,
                    "exit_price": _NUM,
                    "exit_time": _TIME,
                    "time_zone": {"type": ["string", "null"], "enum": [*TIME_ZONES, None]},
                    "qty": _NUM,
                    "fees": {"type": ["array", "null"], "maxItems": MAX_FEES, "items": {"type": "number"}},
                    "pnl": _NUM,
                    "pnl_currency": {"type": "string", "description": "英字 3 文字（JPY・USD など）か unknown"},
                    "exit_order_type": {"type": "string", "enum": list(ORDER_TYPES)},
                },
            },
        },
    },
}

TOOL_DESCRIPTION = "決済明細から読み取った取引を 1 行ずつ返す。答えはこのツールを 1 回だけ呼んで返す"


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and normalize_number(v) is not None


def _enum(v, path: str, allowed: tuple, nullable: bool = True):
    if v is None and nullable:
        return None
    if not isinstance(v, str) or v not in allowed:
        raise Bad(path, "enum")
    return v


def check_read_row(row, path: str) -> dict:
    if not isinstance(row, dict):
        raise Bad(path, "type")
    for k in row:
        if k not in READ_ROW_KEYS:
            raise Bad(f"{path}.<unknown>", "unknown_key")
    out: dict[str, Any] = {}
    sym = row.get("symbol")
    if sym is not None and not isinstance(sym, str):
        raise Bad(f"{path}.symbol", "type")
    # 長すぎる・許さない文字を含む銘柄の名前はその欄だけ捨てる（C21）
    out["symbol"] = sym if isinstance(sym, str) and _symbol_ok(sym) else None
    out["side_written"] = _enum(row.get("side_written"), f"{path}.side_written", SIDE_WRITTEN)
    out["side_of"] = _enum(row.get("side_of"), f"{path}.side_of", SIDE_OF)
    out["time_zone"] = _enum(row.get("time_zone"), f"{path}.time_zone", TIME_ZONES)
    for k in ("entry_price", "exit_price", "qty", "pnl"):
        v = row.get(k)
        if v is not None and not _is_num(v):
            raise Bad(f"{path}.{k}", "type")
        out[k] = v
    for k in ("entry_time", "exit_time"):
        v = row.get(k)
        if v is not None and (not isinstance(v, str) or not _ISO_MINUTE_RE.match(v) or time_key(v) is None):
            raise Bad(f"{path}.{k}", "format")
        out[k] = v
    fees = row.get("fees")
    if fees is not None:
        if not isinstance(fees, list) or len(fees) > MAX_FEES or not all(_is_num(x) for x in fees):
            raise Bad(f"{path}.fees", "type")
        fees = list(fees)
    out["fees"] = fees
    # 通貨は形が外れたら unknown（その欄だけ。行は捨てない）
    cur = row.get("pnl_currency")
    out["pnl_currency"] = cur if isinstance(cur, str) and _CURRENCY_RE.fullmatch(cur) else UNKNOWN_CURRENCY
    out["exit_order_type"] = _enum(row.get("exit_order_type", "unknown"), f"{path}.exit_order_type", ORDER_TYPES,
                                   nullable=False)
    return out


def check_issuer(v) -> str | None:
    """明細を出した会社の名前（#66）。文字列でない・許さない文字（銘柄の名前と同じ制限。``&``・``,`` なども外れる）・
    長すぎる・空白だけなら None（鍵を作らない）。会社の名前は鍵の材料に過ぎないので、型が外れても結果全体は捨てない"""
    if not isinstance(v, str):
        return None
    return v if _symbol_ok(v) else None


def check_result(tool_input) -> dict:
    """report_statement の入力 → {"kind", "issuer", "rows"}（検査済み）。全体の不正は Bad（その回は失敗として数える）。
    issuer（会社の名前）は API の中で明細の特徴の鍵に変えて捨てる（応答・ログ・保存先に出さない。#66）"""
    path = "result"
    if not isinstance(tool_input, dict):
        raise Bad(path, "type")
    for k in tool_input:
        if k not in ("kind", "issuer", "rows"):
            raise Bad(f"{path}.<unknown>", "unknown_key")
    kind = _enum(tool_input.get("kind"), f"{path}.kind", KINDS, nullable=False)
    rows = tool_input.get("rows", [])
    if not isinstance(rows, list):
        raise Bad(f"{path}.rows", "type")
    if len(rows) > MAX_ROWS:
        raise Bad(f"{path}.rows", "size")
    checked = [check_read_row(r, f"{path}.rows[{i}]") for i, r in enumerate(rows)]
    issuer = check_issuer(tool_input.get("issuer"))
    statement = kind == "statement"
    return {"kind": kind, "issuer": issuer if statement else None, "rows": checked if statement else []}
