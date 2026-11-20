"""根拠の足のチャート画像（Issue #12・ADR-0006）の純関数。I/O なし。

- 枠はエントリー時（``entry``）と決済時（``exit``）の 2 つ。1 枠 1 枚・どちらも任意
- 画像の上限は決済明細と同じ（共有の ``statement_read.image.check_limits``。PNG / JPEG・500,000 B・長辺 2,000 px。
  境目は通す）。理由はチャートの欄の issues の種類（``imageBytes`` / ``imageFormat`` / ``imageDimensions``）に写す
- チャートの時間足（``entryChartTimeframe`` / ``exitChartTimeframe``）は、その枠にチャートがある取引にだけ持つ（R4）
- 置き場は ``users/{uid}/charts/{tradeId}-{slot}``（``store.py``）。場所は API が uid・取引 ID・枠から作り、
  利用者の送ったパス・名前を使わない
- 付属のチャート（Issue #89）: 枠 ``x1``〜``x5``（最大 5 枚。エントリー時・決済時と合わせて 1 取引 7 枚まで）。
  判定に使わない。
  並び・時間足・一言は記録の ``extraCharts``（``[{slot, timeframe?, note?}]``。追加した順）に持ち、付属の画像のある枠と
  ``extraCharts`` の枠は一致する（``chart_timeframe_issues``）
"""

from statement_read import image

from loss_note_api.schema import EXTRA_CHART_NOTE_MAX, EXTRA_CHART_SLOTS

MAIN_SLOTS = ("entry", "exit")
# 付属のチャートの枠（#89。判定に使わない）
EXTRA_SLOTS = EXTRA_CHART_SLOTS
SLOTS = MAIN_SLOTS + EXTRA_SLOTS
# multipart の部分の名前（作成・取引の直し）と、記録の時間足の欄（エントリー時・決済時だけ）
PART = {s: f"{s}Chart" for s in SLOTS}
TIMEFRAME_FIELD = {"entry": "entryChartTimeframe", "exit": "exitChartTimeframe"}
# 取引の直しの multipart で、外す枠を 1 つずつ持つ文字の部分（#89）
REMOVE_PART = "removeChart"
EXTRA_FIELD = "extraCharts"
NOTE_MAX = EXTRA_CHART_NOTE_MAX

MAX_BYTES = image.MAX_BYTES
# multipart の入口（作成・取引の直し）だけの上限: 記録（64 KiB）+ 画像 7 枚 + 枠の分（境界・見出し）
MAX_RECORD_PART = 64 * 1024
MAX_MULTIPART_BYTES = MAX_RECORD_PART + len(SLOTS) * MAX_BYTES + 16 * 1024
# Werkzeug の max_form_memory_size に渡す値（#151）。Werkzeug（3.1.9）の解析は部分がファイルかを見ずに「解析の残り +
# 読んだ塊（64 KiB）」をこの値と比べるので、記録の上限（64 KiB）を渡すと画像の CR / LF の近くに塊の境目が来たとき
# 超える。塊の 2 倍にして、記録の 64 KiB は read_trade_multipart が自分で数える（画像の上限 500,000 B より小さい）。
# 根拠: 部分の中身の途中で buffer に残るのは境界の取りかけだけで、最大 len(boundary) + 4 B
# （multipart.py の _last_partial_boundary_index。ブラウザの境界は 70 字以下 = 74 B）。64 KiB + 74 B < 128 KiB。
# Werkzeug を上げるときは、塊の大きさ（MultiPartParser の buffer_size）とこの残りの決め方を見直す
MAX_FORM_MEMORY = 2 * 64 * 1024
# 記録 + 枠ごとに 1 つ（画像か外す印。同じ枠に両方は 400）
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
    """チャートの無い枠に時間足がある → その欄の noChart。付属: extraCharts の枠に画像が無い → extraCharts の noChart、
    付属の画像があるのに extraCharts に無い → その部分の noEntry"""
    issues = [
        {"field": TIMEFRAME_FIELD[s], "kind": "noChart"}
        for s in MAIN_SLOTS
        if TIMEFRAME_FIELD[s] in record and s not in slots
    ]
    listed = {e["slot"] for e in record.get(EXTRA_FIELD) or []}
    if any(s not in slots for s in listed):
        issues.append({"field": EXTRA_FIELD, "kind": "noChart"})
    issues += [{"field": PART[s], "kind": "noEntry"} for s in EXTRA_SLOTS if s in slots and s not in listed]
    return issues


def kept_extras(record: dict, stored: dict, slots: set[str] | frozenset[str]) -> dict:
    """直しの本文に extraCharts が無ければ、保存済みの並び（残る枠だけ）を保つ（古い画面が黙って付属を落とさない）"""
    if EXTRA_FIELD in record:
        return record
    extras = [e for e in stored.get(EXTRA_FIELD) or [] if e.get("slot") in slots]
    return {**record, EXTRA_FIELD: extras} if extras else record


def chart_doc(data: bytes) -> dict:
    """保存する文書（形式とバイト列だけ）"""
    return {"contentType": content_type_of(data), "data": data}


def chart_meta(doc: dict) -> dict:
    """取引の文書・応答に持つ要約（形式と大きさだけ。バイト列は持たない）"""
    return {"contentType": doc["contentType"], "size": len(doc["data"])}


def charts_summary(charts: dict[str, dict]) -> dict:
    return {s: chart_meta(charts[s]) for s in SLOTS if s in charts}


def record_after_replace(record: dict, slot: str) -> dict:
    """枠ごとの差し替え（PUT /charts/{slot}）の後の記録: 時間足は選び直し（消す）。付属の枠は並びに無ければ末尾に足す"""
    if slot in TIMEFRAME_FIELD:
        return {k: v for k, v in record.items() if k != TIMEFRAME_FIELD[slot]}
    extras = list(record.get(EXTRA_FIELD) or [])
    for i, e in enumerate(extras):
        if e.get("slot") == slot:
            extras[i] = {k: v for k, v in e.items() if k != "timeframe"}
            break
    else:
        extras.append({"slot": slot})
    return {**record, EXTRA_FIELD: extras}


def record_after_remove(record: dict, slot: str) -> dict:
    """枠ごとの外す（DELETE /charts/{slot}）の後の記録: その枠の時間足・付属の並びの行を消す"""
    if slot in TIMEFRAME_FIELD:
        return {k: v for k, v in record.items() if k != TIMEFRAME_FIELD[slot]}
    extras = [e for e in record.get(EXTRA_FIELD) or [] if e.get("slot") != slot]
    out = {k: v for k, v in record.items() if k != EXTRA_FIELD}
    return {**out, EXTRA_FIELD: extras} if extras else out
