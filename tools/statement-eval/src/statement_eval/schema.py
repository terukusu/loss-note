"""正解のファイル（answers.json）の検査。読み取りの結果の形（ツール report_statement の入力）と検査は共有のパッケージ
（statement_read.result。API と同じもの。#11）から import する。

外れたときは Bad(位置, 理由) を投げる。メッセージに値を入れない（出力・ログに値を反射しない）。
"""

import re

from statement_read.result import (
    _ISO_MINUTE_RE,
    _SYMBOL_RE,
    KINDS,
    MAX_FEES,
    MAX_ROWS,
    MAX_SYMBOL_LEN,
    READ_ROW_KEYS,
    SIDE_OF,
    SIDE_WRITTEN,
    TIME_ZONES,
    TOOL_DESCRIPTION,
    TOOL_INPUT_SCHEMA,
    TOOL_NAME,
    Bad,
    check_read_row,
    check_result,
)

from .score import FIELDS, ORDER_TYPES, normalize_number, time_key

__all__ = [
    "KINDS",
    "MAX_FEES",
    "MAX_ROWS",
    "MAX_SYMBOL_LEN",
    "READ_ROW_KEYS",
    "SIDE_OF",
    "SIDE_WRITTEN",
    "TIME_ZONES",
    "TOOL_DESCRIPTION",
    "TOOL_INPUT_SCHEMA",
    "TOOL_NAME",
    "_SYMBOL_RE",
    "Bad",
    "check_answer_row",
    "check_answers",
    "check_read_row",
    "check_result",
]

_FILE_RE = re.compile(r"^[0-9A-Za-z_\-]+\.(png|jpg|jpeg)$")


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
    for k in ("entry_price", "exit_price", "qty", "pnl"):
        _num_str(row[k], f"{path}.{k}")
    cur = row["pnl_currency"]
    if not isinstance(cur, str) or not (cur == "unknown" or (len(cur) == 3 and cur.isascii() and cur.isupper())):
        raise Bad(f"{path}.pnl_currency", "format")
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
            if k not in ("file", "issuer", "rows"):
                raise Bad(f"{p}.<unknown>", "unknown_key")
        # 明細を出した会社の名前（#66。任意。無い = 書かれていない明細）
        issuer = im.get("issuer")
        if issuer is not None and (not isinstance(issuer, str) or not issuer.strip()):
            raise Bad(f"{p}.issuer", "type")
        f = im.get("file")
        if not isinstance(f, str) or not _FILE_RE.match(f):
            raise Bad(f"{p}.file", "format")
        if f in seen:
            raise Bad(f"{p}.file", "duplicate")
        seen.add(f)
        rows = im.get("rows")
        if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
            raise Bad(f"{p}.rows", "type")
        checked = [check_answer_row(r, f"{p}.rows[{j}]") for j, r in enumerate(rows)]
        out.append({"file": f, **({} if issuer is None else {"issuer": issuer}), "rows": checked})
    return {"schema_version": 1, "images": out}
