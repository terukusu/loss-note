"""根拠の足のチャート画像（Issue #12・ADR-0006）の純関数。I/O なし。

- 枠はエントリー時（``entry``）と決済時（``exit``）の 2 つ。1 枠 1 枚・どちらも任意
- 画像の上限は決済明細と同じ（共有の ``statement_read.image.check_limits``。PNG / JPEG・500,000 B・長辺 2,000 px。
  境目は通す）。理由はチャートの欄の issues の種類（``imageBytes`` / ``imageFormat`` / ``imageDimensions``）に写す
- チャートの時間足（``entryChartTimeframe`` / ``exitChartTimeframe``）は、その枠にチャートがある取引にだけ持つ（R4）
- 置き場は ``users/{uid}/charts/{tradeId}-{slot}``（``store.py``）。場所は API が uid・取引 ID・枠から作り、
  利用者の送ったパス・名前を使わない
"""

from statement_read import image

SLOTS = ("entry", "exit")
# multipart の部分の名前（作成）と、記録の時間足の欄
PART = {"entry": "entryChart", "exit": "exitChart"}
TIMEFRAME_FIELD = {"entry": "entryChartTimeframe", "exit": "exitChartTimeframe"}

MAX_BYTES = image.MAX_BYTES
# multipart の作成の入口だけの上限: 記録（64 KiB）+ 画像 2 枚 + 枠の分（境界・見出し）
MAX_RECORD_PART = 64 * 1024
MAX_MULTIPART_BYTES = MAX_RECORD_PART + 2 * MAX_BYTES + 8 * 1024
MAX_PARTS = 1 + len(SLOTS)

_KIND = {"bytes": "imageBytes", "format": "imageFormat", "dimensions": "imageDimensions"}


def valid_slot(slot: str) -> bool:
    return slot in SLOTS


def chart_doc_id(trade_id: str, slot: str) -> str:
    """チャートの文書の ID（取引 ID は ID_PATTERN に合う英数字だけ、枠は SLOTS だけ = ほかの場所を指せない）"""
    if slot not in SLOTS:
        raise ValueError("slot")
    return f"{trade_id}-{slot}"


def check_chart(data: bytes, content_type: str | None) -> str | None:
    """上限を破る理由（issues の kind）か None"""
    reason = image.check_limits(data, content_type)
    return None if reason is None else _KIND[reason]


def content_type_of(data: bytes) -> str:
    """検査を通ったバイト列の形式（署名から。送られた Content-Type の飾り（; charset など）を写さない）"""
    mt = image.media_type_of(data)
    if mt is None:
        raise ValueError("not an image")
    return mt


def chart_timeframe_issues(record: dict, slots: set[str] | frozenset[str]) -> list[dict]:
    """チャートの無い枠に時間足がある → その欄の noChart"""
    return [
        {"field": TIMEFRAME_FIELD[s], "kind": "noChart"}
        for s in SLOTS
        if TIMEFRAME_FIELD[s] in record and s not in slots
    ]


def chart_doc(data: bytes) -> dict:
    """保存する文書（形式とバイト列だけ）"""
    return {"contentType": content_type_of(data), "data": data}


def chart_meta(doc: dict) -> dict:
    """取引の文書・応答に持つ要約（形式と大きさだけ。バイト列は持たない）"""
    return {"contentType": doc["contentType"], "size": len(doc["data"])}


def charts_summary(charts: dict[str, dict]) -> dict:
    return {s: chart_meta(charts[s]) for s in SLOTS if s in charts}
