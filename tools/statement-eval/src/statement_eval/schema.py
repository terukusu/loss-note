"""読み取りの結果の形（ツール report_statement の入力）と検査、正解のファイル（answers.json）の検査。

外れたときは Bad(位置, 理由) を投げる。メッセージに値を入れない（出力・ログに値を反射しない）。
"""

import re
from typing import Any

from .score import FIELDS, ORDER_TYPES, normalize_number, time_key

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
    "pnl_jpy",
    "exit_order_type",
)
# 銘柄の名前に許す文字（英数・かな・漢字・空白・/ . - ( ) ・ と全角の同じもの）。外れたらその欄だけ None（C21）
_SYMBOL_RE = re.compile(r"^[0-9A-Za-z０-９Ａ-Ｚａ-ｚ぀-ヿ一-鿿々\s/／.．\-－()（）・ー]+$")
_ISO_MINUTE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
_FILE_RE = re.compile(r"^[0-9A-Za-z_\-]+\.(png|jpg|jpeg)$")


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
    "required": ["kind", "rows"],
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
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
                    "pnl_jpy": _NUM,
                    "exit_order_type": {"type": "string", "enum": list(ORDER_TYPES)},
                },
            },
        },
    },
}

TOOL_DESCRIPTION = "決済明細から読み取った取引を 1 行ずつ返す。答えはこのツールを 1 回だけ呼んで返す"


# ---- 読み取りの結果 ----


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
    out["symbol"] = sym if isinstance(sym, str) and len(sym) <= MAX_SYMBOL_LEN and _SYMBOL_RE.match(sym) else None
    out["side_written"] = _enum(row.get("side_written"), f"{path}.side_written", SIDE_WRITTEN)
    out["side_of"] = _enum(row.get("side_of"), f"{path}.side_of", SIDE_OF)
    out["time_zone"] = _enum(row.get("time_zone"), f"{path}.time_zone", TIME_ZONES)
    for k in ("entry_price", "exit_price", "qty", "pnl_jpy"):
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
    out["exit_order_type"] = _enum(row.get("exit_order_type", "unknown"), f"{path}.exit_order_type", ORDER_TYPES,
                                   nullable=False)
    return out


def check_result(tool_input) -> dict:
    """report_statement の入力 → {"kind", "rows"}（検査済み）。全体の不正は Bad（その回は失敗として数える）"""
    path = "result"
    if not isinstance(tool_input, dict):
        raise Bad(path, "type")
    for k in tool_input:
        if k not in ("kind", "rows"):
            raise Bad(f"{path}.<unknown>", "unknown_key")
    kind = _enum(tool_input.get("kind"), f"{path}.kind", KINDS, nullable=False)
    rows = tool_input.get("rows", [])
    if not isinstance(rows, list):
        raise Bad(f"{path}.rows", "type")
    if len(rows) > MAX_ROWS:
        raise Bad(f"{path}.rows", "size")
    checked = [check_read_row(r, f"{path}.rows[{i}]") for i, r in enumerate(rows)]
    return {"kind": kind, "rows": checked if kind == "statement" else []}


# ---- 正解のファイル ----


def _num_str(v, path: str):
    if v is None:
        return None
    if not isinstance(v, str) or normalize_number(v) is None:
        raise Bad(path, "number_string")
    return v


def check_answer_row(row, path: str) -> dict:
    if not isinstance(row, dict):
        raise Bad(path, "type")
    for k in row:
        if k not in FIELDS:
            raise Bad(f"{path}.<unknown>", "unknown_key")
    for k in FIELDS:
        if k not in row:
            raise Bad(f"{path}.{k}", "missing")
    sym = row["symbol"]
    if sym is not None and (not isinstance(sym, str) or not sym.strip()):
        raise Bad(f"{path}.symbol", "type")
    if row["side"] not in ("L", "S", None):
        raise Bad(f"{path}.side", "enum")
    for k in ("entry_price", "exit_price", "qty", "pnl_jpy"):
        _num_str(row[k], f"{path}.{k}")
    for k in ("entry_time", "exit_time"):
        v = row[k]
        if v is not None and (not isinstance(v, str) or not _ISO_MINUTE_RE.match(v) or time_key(v) is None):
            raise Bad(f"{path}.{k}", "format")
    fees = row["fees"]
    if fees is not None:
        if not isinstance(fees, list) or not fees or len(fees) > MAX_FEES:
            raise Bad(f"{path}.fees", "type")
        for i, x in enumerate(fees):
            _num_str(x, f"{path}.fees[{i}]")
    if row["exit_order_type"] not in ORDER_TYPES:
        raise Bad(f"{path}.exit_order_type", "enum")
    return dict(row)


def check_answers(obj) -> dict:
    """answers.json（合成・実物で共通の形）の検査。外れたら Bad（位置と理由だけ）"""
    if not isinstance(obj, dict):
        raise Bad("answers", "type")
    for k in obj:
        if k not in ("schema_version", "images"):
            raise Bad("answers.<unknown>", "unknown_key")
    if obj.get("schema_version") != 1:
        raise Bad("answers.schema_version", "version")
    images = obj.get("images")
    if not isinstance(images, list) or not images:
        raise Bad("answers.images", "type")
    seen: set[str] = set()
    out = []
    for i, im in enumerate(images):
        p = f"images[{i}]"
        if not isinstance(im, dict):
            raise Bad(p, "type")
        for k in im:
            if k not in ("file", "rows"):
                raise Bad(f"{p}.<unknown>", "unknown_key")
        f = im.get("file")
        if not isinstance(f, str) or not _FILE_RE.match(f):
            raise Bad(f"{p}.file", "format")
        if f in seen:
            raise Bad(f"{p}.file", "duplicate")
        seen.add(f)
        rows = im.get("rows")
        if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
            raise Bad(f"{p}.rows", "type")
        out.append({"file": f, "rows": [check_answer_row(r, f"{p}.rows[{j}]") for j, r in enumerate(rows)]})
    return {"schema_version": 1, "images": out}
