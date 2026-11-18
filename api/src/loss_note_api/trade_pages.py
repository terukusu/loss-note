"""取引の一覧のページ分け（Issue #87・ADR-0016）の純関数。

並びは 2 つ:

- ``exit``（既定）: 決済の時刻の新しい順 → 作った時刻の新しい順 → ID の昇順
  （今の一覧と同じ。画面の ``sortTrades`` と同じ）
- ``created``: 作った時刻の新しい順 → ID の降順（前回の 1 件・保存が届いたかの確かめに使う）

カーソルは並びの鍵の値（並び・決済の時刻・作った時刻・ID）を詰めた不透明な文字（base64url の JSON 配列。署名なし）。
読む場所は常に検証した uid の ``users/{uid}/trades`` なので、細工したカーソルでも自分の取引の別の位置にしか届かない。
形・型・範囲・ID の形を検査し、外れたら誤り（欄と種類だけ。送った値を返さない）。
"""

import base64
import binascii
import json
from collections.abc import Iterable, Mapping

from loss_note_api.schema import ID_PATTERN, MAX_TIME_MS

ORDERS = ("exit", "created")
DEFAULT_ORDER = "exit"
MAX_LIMIT = 100
# カーソルの文字の長さの上限（ID 40 文字 + 時刻 2 つでも 150 文字に満たない）
MAX_CURSOR_CHARS = 200
_CURSOR_TAG = {"exit": "e", "created": "c"}
_MAX_INT = 2**53 - 1
_B64URL = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")

# 並びの鍵の値（exit = (決済の時刻, 作った時刻, ID)、created = (作った時刻, ID)）
Key = tuple


class PageParamError(Exception):
    """パラメータの誤り（400）。issues は欄と種類だけ"""

    def __init__(self, field: str, kind: str):
        super().__init__(kind)
        self.issues = [{"field": field, "kind": kind}]


def key_of(order: str, tid: str, doc: Mapping) -> Key:
    if order == "exit":
        return (doc["record"]["exit"]["time"], doc["createdAt"], tid)
    return (doc["createdAt"], tid)


def exit_key(item: tuple[str, Mapping]):
    """決済の時刻の新しい順、同じなら作った時刻の新しい順、さらに ID の昇順（並びを決まったものにする）"""
    tid, doc = item
    return (-doc["record"]["exit"]["time"], -doc["createdAt"], tid)


def _sort_items(items: Iterable[tuple[str, Mapping]], order: str) -> list[tuple[str, Mapping]]:
    if order == "exit":
        return sorted(items, key=exit_key)
    # 作った時刻の新しい順 → ID の降順（どちらも降順なので、鍵の組を逆に並べる）
    return sorted(items, key=lambda it: (it[1]["createdAt"], it[0]), reverse=True)


def _after(order: str, key: Key, after: Key) -> bool:
    """key が並びの上で after より後か"""
    if order == "exit":
        t, c, i = key
        at, ac, ai = after
        return (-t, -c, i) > (-at, -ac, ai)
    return key < after


def page_of(items: Iterable[tuple[str, Mapping]], order: str, after: Key | None, limit: int) -> list:
    """全件 → after より後の先頭から最大 limit + 1 件（続きがあるかを見分ける 1 件を含む）"""
    ordered = _sort_items(items, order)
    if after is not None:
        ordered = [it for it in ordered if _after(order, key_of(order, it[0], it[1]), after)]
    return ordered[: limit + 1]


def encode_cursor(order: str, key: Key) -> str:
    raw = json.dumps([_CURSOR_TAG[order], *key], separators=(",", ":")).encode("ascii")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _int_in(v, high: int) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= high


def decode_cursor(order: str, text: str) -> Key:
    """カーソルの文字 → 並びの鍵の値。形が違えば PageParamError（並びの違うカーソルも）"""
    bad = PageParamError("cursor", "format")
    if not text or len(text) > MAX_CURSOR_CHARS or not set(text) <= _B64URL:
        raise bad
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
        value = json.loads(raw.decode("ascii"))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise bad from None
    if not isinstance(value, list) or not value:
        raise bad
    if value[0] != _CURSOR_TAG[order]:
        raise PageParamError("cursor", "order")
    if order == "exit":
        if len(value) != 4:
            raise bad
        _, t, c, i = value
        if not (_int_in(t, MAX_TIME_MS) and _int_in(c, _MAX_INT) and isinstance(i, str) and ID_PATTERN.fullmatch(i)):
            raise bad
        return (t, c, i)
    if len(value) != 3:
        raise bad
    _, c, i = value
    if not (_int_in(c, _MAX_INT) and isinstance(i, str) and ID_PATTERN.fullmatch(i)):
        raise bad
    return (c, i)


def _one(args, name: str) -> str | None:
    values = args.getlist(name)
    if len(values) > 1:
        raise PageParamError(name, "duplicate")
    return values[0] if values else None


def parse_page_params(args) -> tuple[str, int, Key | None] | None:
    """クエリ（``getlist`` を持つもの）→ (並び, 件数, カーソルの鍵) / None（パラメータなし = 全件。今と同じ）。

    誤りは PageParamError。``limit`` の無い ``cursor``・``order`` も誤り（ページ分けは件数を付けたときだけ）
    """
    limit_text = _one(args, "limit")
    order_text = _one(args, "order")
    cursor_text = _one(args, "cursor")
    if limit_text is None:
        if order_text is not None:
            raise PageParamError("order", "requiresLimit")
        if cursor_text is not None:
            raise PageParamError("cursor", "requiresLimit")
        return None
    if not (limit_text.isascii() and limit_text.isdigit()) or len(limit_text) > 3 or limit_text.startswith("0"):
        raise PageParamError("limit", "range")
    limit = int(limit_text)
    if not 1 <= limit <= MAX_LIMIT:
        raise PageParamError("limit", "range")
    order = DEFAULT_ORDER if order_text is None else order_text
    if order not in ORDERS:
        raise PageParamError("order", "unknown")
    after = None if cursor_text is None else decode_cursor(order, cursor_text)
    return order, limit, after


def split_page(order: str, items: list, limit: int) -> tuple[list, str | None]:
    """最大 limit + 1 件 → (limit 件, 次のカーソル or None)"""
    page = items[:limit]
    if len(items) <= limit or not page:
        return page, None
    tid, doc = page[-1]
    return page, encode_cursor(order, key_of(order, tid, doc))
