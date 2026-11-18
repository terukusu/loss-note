"""取引の一覧を決済の時刻の範囲で絞る引数（Issue #88・設計書 C44）の純関数。

``GET /api/trades?exitFrom=<ms>&exitTo=<ms>``: 決済の時刻が ``exitFrom`` 以上 ``exitTo`` 未満の取引だけを、
範囲を付けない一覧と同じ並び（``trade_pages.exit_key``）で返す。集計（判定・R）は画面が一覧と同じ計算で出す
（API は絞るだけ）。

- 2 つそろったときだけ範囲の扱い。片方だけ・10 進の整数でない（符号・小数・空・16 桁以上）・開始 ≧ 終了・
  長さが 367 日（端末の時間帯の夏時間の余裕を含めた任意の期間 366 日の上限）を超える・時刻の上限を超える は誤り
- ページ分けの引数（``limit``・``order``・``cursor``）と同時に来たら誤り（範囲は全件を返す。量は長さの上限で抑える）
- 誤りは欄と種類だけ（送った値を返さない）
- 件数の上限 ``MAX_RANGE_ITEMS``（2,000 件）。超えたら決済の新しい順の先頭の 2,000 件と ``truncated: true`` を返す
  （画面は「先頭の 2,000 件で集計しています」と出す。1 件 0.6〜1.2 KB なので応答は 2.5 MB ほどまで）
"""

import re

from loss_note_api.schema import MAX_TIME_MS
from loss_note_api.trade_pages import PageParamError

DAY_MS = 86_400_000
# 範囲の長さの上限（ミリ秒）。任意の期間は 366 日まで（画面）。夏時間の端末で 1 日が 25 時間になる分の余裕に 1 日
MAX_SPAN_MS = 367 * DAY_MS
# 範囲の応答の件数の上限（C44）
MAX_RANGE_ITEMS = 2_000
_INT = re.compile(r"[0-9]{1,15}")
_PAGE_ARGS = ("limit", "order", "cursor")


def _one(args, name: str) -> str | None:
    values = args.getlist(name)
    if len(values) > 1:
        raise PageParamError(name, "duplicate")
    return values[0] if values else None


def _ms(name: str, text: str) -> int:
    if not _INT.fullmatch(text):
        raise PageParamError(name, "format")
    value = int(text)
    if value > MAX_TIME_MS:
        raise PageParamError(name, "range")
    return value


def parse_range_params(args) -> tuple[int, int] | None:
    """クエリ（``getlist`` を持つもの）→ (開始, 終了) / None（範囲の引数なし）。誤りは PageParamError"""
    from_text = _one(args, "exitFrom")
    to_text = _one(args, "exitTo")
    if from_text is None and to_text is None:
        return None
    if from_text is None:
        raise PageParamError("exitFrom", "required")
    if to_text is None:
        raise PageParamError("exitTo", "required")
    start = _ms("exitFrom", from_text)
    end = _ms("exitTo", to_text)
    if start >= end:
        raise PageParamError("exitTo", "order")
    if end - start > MAX_SPAN_MS:
        raise PageParamError("exitTo", "span")
    for name in _PAGE_ARGS:
        if args.getlist(name):
            raise PageParamError(name, "withRange")
    return start, end


def in_range(doc, start: int, end: int) -> bool:
    """決済の時刻が [start, end) に入るか（テストの記憶の保存先が Firestore の where と同じ境目で絞るのに使う）"""
    t = doc["record"]["exit"]["time"]
    return start <= t < end
