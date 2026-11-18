"""根拠の足のチャートの時間足の表示の読み取り（Issue #27。設計書 7.5・K9・K11・C27）。

- AI はチャートに写っている時間足の表示を **書かれたまま** 返す（``timeframe_written``。例: 「4H」「240」「日足」）。
  列挙への直しはこの純関数（``timeframe_of``）で行う（明細の向き・時間帯の直しと同じ考え。C27）
- 価格・エントリーポイントは読まない（K11）。結果は「チャートか」と書かれた表記だけ（16 文字以下・許した文字だけ）。
  形に合わない結果は全体を捨てる（``Bad``。値を持たない）
- API の応答は ``normalize_chart`` の ``{"kind", "timeframe"}`` だけ（書かれた表記を応答・ログに出さない）
- 読めない・2 通りに読める・列挙に無い足は None（読み違えるより空。空なら判定は壊れない。読み違いは偽の B になる）

I/O・時刻・乱数を持たない。
"""

import re
import unicodedata
from typing import Any

from .result import Bad
from .task import ReadTask

TOOL_NAME = "report_chart_timeframe"
KINDS = ("chart", "not_chart")
MAX_WRITTEN_LEN = 16
# 記録の時間足の列挙（core/trade.ts の TIMEFRAMES・API の schema.TIMEFRAMES と同じ 9 つ）
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")

# 書かれた表記に許す文字（英数・全角の英数・空白と、日本語の時間足の言葉に要る字だけ）。全体に当てる
_WRITTEN_RE = re.compile(r"[0-9A-Za-z０-９Ａ-Ｚａ-ｚ 　分時間足日週月ヶか カ]+")

CHART_SYSTEM = """\
あなたは相場のチャートの画像から、チャートの時間足の表示だけを読み取る係です。
答えは必ずツール report_chart_timeframe を 1 回だけ呼んで返し、文章では答えません。

# 読み方
- チャートの銘柄名のそば・見出し・凡例・選ばれている時間足のボタンなどに書かれた、今描かれているチャートの
  時間足の表示を、画面に書かれた文字のとおりに timeframe_written に返します（例: 4H、4h、H4、240、D、1D、日足、
  15分足、W、MN1）。大文字・小文字・全角・半角も書かれたとおりにします。言い換え・換算・補いはしません
- 時間足の表示が写っていない・読めない・時間足の違う複数のチャートが並んでいる・どれが今の時間足か分からない
  ときは null にします。ローソク足の間隔などから推測してはいけません
- 選べる時間足の一覧（ツールバーの並び）のうち、選ばれていないものは返しません
- 日付・時刻（「1日」「12月」「2026/03/04」「10:15」など）は時間足ではありません。返しません
- チャート（ローソク足・バー・ラインの値動きの図）でない画像（決済明細・表・文章など）なら kind = "not_chart"、
  timeframe_written = null にします

# 返さないもの
- 価格・日時・銘柄名・インジケーターの値・口座の情報など、時間足の表示の外の文字は返しません
"""

CHART_USER_TEXT = "このチャートの画像の時間足の表示を読み取り、report_chart_timeframe を 1 回だけ呼んで返してください。"

TOOL_DESCRIPTION = "チャートに書かれた時間足の表示を、書かれたとおりに返す。答えはこのツールを 1 回だけ呼んで返す"

TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "timeframe_written"],
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "timeframe_written": {
            "type": ["string", "null"],
            "maxLength": MAX_WRITTEN_LEN,
            "description": "チャートに書かれた時間足の表示（書かれたまま。無ければ null）",
        },
    },
}


def _written_ok(s: str) -> bool:
    return 1 <= len(s) <= MAX_WRITTEN_LEN and _WRITTEN_RE.fullmatch(s) is not None and s.strip(" 　") != ""


def check_result(tool_input) -> dict:
    """report_chart_timeframe の入力 → {"kind", "timeframe_written"}（検査済み）。外れたら Bad（値を持たない）。
    not_chart の表記は捨てる"""
    path = "result"
    if not isinstance(tool_input, dict):
        raise Bad(path, "type")
    for k in tool_input:
        if k not in ("kind", "timeframe_written"):
            raise Bad(f"{path}.<unknown>", "unknown_key")
    kind = tool_input.get("kind")
    if not isinstance(kind, str) or kind not in KINDS:
        raise Bad(f"{path}.kind", "enum")
    written = tool_input.get("timeframe_written")
    if written is not None:
        if not isinstance(written, str):
            raise Bad(f"{path}.timeframe_written", "type")
        if not _written_ok(written):
            raise Bad(f"{path}.timeframe_written", "format")
    return {"kind": kind, "timeframe_written": written if kind == "chart" else None}


# ---- 表記の直し ----

_MINUTES = {1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h"}
_HOURS = {1: "1h", 4: "4h"}


def _by_unit(n: int, unit: str) -> str | None:
    if unit == "min":
        return _MINUTES.get(n)
    if unit == "hour":
        return _HOURS.get(n)
    if n != 1:
        return None
    return {"day": "1d", "week": "1w", "month": "1M"}.get(unit)


def _n(s: str | None) -> int | None:
    """数の部分（無ければ 1。先頭の 0・桁の多すぎる数は読まない）"""
    if not s:
        return 1
    if len(s) > 4 or (len(s) > 1 and s[0] == "0"):
        return None
    return int(s)


_JA_UNIT = {"分": "min", "時間": "hour", "日": "day", "週": "week", "ヶ月": "month", "か月": "month", "カ月": "month",
            "月": "month"}
_JA_RE = re.compile(r"^(\d*)(分|時間|日|週|ヶ月|か月|カ月|月)足?$")
_EN_WORD = {"daily": "1d", "weekly": "1w", "monthly": "1M"}
_EN_RE = re.compile(r"^(\d*)(min|mins|minute|minutes|hour|hours|hr|hrs|day|days|week|weeks|month|months)$")
_EN_UNIT = {"min": "min", "mins": "min", "minute": "min", "minutes": "min", "hour": "hour", "hours": "hour",
            "hr": "hour", "hrs": "hour", "day": "day", "days": "day", "week": "week", "weeks": "week",
            "month": "month", "months": "month"}


def _rules(t: str) -> str | None:
    """空白を除き NFKC で直した表記 → 列挙か None。大文字・小文字を見分ける規則を先に当てる"""
    # 日本語（4時間足・日足・15分・1ヶ月）
    m = _JA_RE.match(t)
    if m:
        unit = _JA_UNIT[m.group(2)]
        # 日・週・月は「足」が付くときだけ（「1日」「1月」「12月」は日付にも読めるので時間足として読まない）。
        # 分・時間は「足」が無くても時間足の書き方（「15分」「4時間」）
        if unit in ("day", "week", "month") and not t.endswith("足"):
            return None
        n = _n(m.group(1))
        return None if n is None else _by_unit(n, unit)
    # MT 型（大文字の接頭: M1・M15・H1・H4・D1・W1・MN・MN1）。M + 数は分
    m = re.match(r"^M(\d+)$", t)
    if m:
        n = _n(m.group(1))
        return None if n is None else _MINUTES.get(n)
    m = re.match(r"^[Hh](\d+)$", t)
    if m:
        n = _n(m.group(1))
        return None if n is None else _HOURS.get(n)
    if t in ("D1", "d1"):
        return "1d"
    if t in ("W1", "w1"):
        return "1w"
    if t in ("MN", "MN1"):
        return "1M"
    # 1 文字（D・W・M）。M は大文字だけ月足（小文字の m だけは足として読まない）
    if t in ("D", "d"):
        return "1d"
    if t in ("W", "w"):
        return "1w"
    if t == "M":
        return "1M"
    # 数だけ（分。60 = 1 時間足・240 = 4 時間足）
    if re.fullmatch(r"\d+", t):
        n = _n(t)
        return None if n is None else _MINUTES.get(n)
    # 数 + 単位の 1 文字（4H・4h・1D・1W・15m・15M）
    m = re.match(r"^(\d+)([A-Za-z])$", t)
    if m:
        n = _n(m.group(1))
        unit = m.group(2)
        if n is None:
            return None
        if unit == "m":
            return _MINUTES.get(n)
        if unit in ("H", "h"):
            return _HOURS.get(n)
        if unit in ("D", "d"):
            return "1d" if n == 1 else None
        if unit in ("W", "w"):
            return "1w" if n == 1 else None
        if unit == "M":
            # 大文字の M は月足（チャートの道具によって 1 分足）にも分にも読める。1M は 2 通りに読めるので空。
            # 5M・15M・30M は月足の時間足として使われないので分（列挙の外の 3M・6M などは空）
            return None if n == 1 else _MINUTES.get(n) if n in (5, 15, 30) else None
        return None
    # 英語の言葉（Daily・4 hours・15min）
    low = t.lower()
    if low in _EN_WORD:
        return _EN_WORD[low]
    m = _EN_RE.match(low)
    if m:
        n = _n(m.group(1))
        return None if n is None else _by_unit(n, _EN_UNIT[m.group(2)])
    return None


def timeframe_of(written: str | None) -> str | None:
    """書かれた時間足の表記 → 記録の時間足の列挙（9 つ）か None（読めない・2 通りに読める・列挙に無い足）"""
    if not isinstance(written, str):
        return None
    t = re.sub(r"\s+", "", unicodedata.normalize("NFKC", written))
    if not t or len(t) > MAX_WRITTEN_LEN:
        return None
    out = _rules(t)
    return out if out in TIMEFRAMES else None


def normalize_chart(checked: dict) -> dict:
    """検査済みの結果 → API の応答 {"kind", "timeframe"}（書かれた表記は持たない）"""
    kind = checked["kind"]
    return {"kind": kind, "timeframe": timeframe_of(checked.get("timeframe_written")) if kind == "chart" else None}


CHART_TASK = ReadTask(
    system=CHART_SYSTEM,
    user_text=CHART_USER_TEXT,
    tool_name=TOOL_NAME,
    tool_description=TOOL_DESCRIPTION,
    input_schema=TOOL_INPUT_SCHEMA,
    check=check_result,
)
