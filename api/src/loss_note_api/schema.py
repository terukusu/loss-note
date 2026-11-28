"""本文の検査（純関数。設計書 4 章・C11・Issue #4 の「入力の上限」・ADR-0004）。

``validate_*`` は ``(既定を埋めた値, [])`` か ``(None, issues)`` を返す。issues は既知の項目の道筋と種類だけで、
送った値・知らない項目の名前を含まない（入力を応答に映さない）。入力の辞書は変えない。
数は丸めず、int / float の区別をそのまま保つ（往復で同じ値が返る）。意味は ``core/trade.ts`` が正。
"""

import datetime
import json
import math
import re
import unicodedata
from collections.abc import Callable
from typing import Any

from loss_note_api import emotion_tags, position_groups, reflection

MAX_ABS = 1e12
MAX_TIME_MS = 4_102_444_800_000  # 2100-01-01T00:00:00Z
MAX_ENTRIES = 20
MAX_FEES = 20
MAX_BODY_BYTES = 64 * 1024
MAX_CAPITAL_HISTORY = 1000
MAX_ISSUES = 50

# 末尾は \Z（$ は末尾の改行の前でも当たり、"l1\n" のような値を通してしまう。#116 のレビュー N1）
ID_PATTERN = re.compile(r"^[A-Za-z0-9]{1,40}\Z")
_CURRENCY = re.compile(r"^[A-Z]{3}\Z")
_ZWJ = "\u200d"

# core/trade.ts の TIMEFRAMES と同じ（短い順）
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")
STATUSES = ("planned", "open", "closed", "skipped")
ACCEPTED_STATUSES = ("closed",)  # この Issue は決済済みだけ（計画中・保有中・見送りは縦切り 3）
SOURCES = ("manual", "statement", "import")
SIDES = ("L", "S")
OPTION_TYPES = ("P", "C")
LC_BASES = ("chart", "amount")
# cancelled = 置いた逆指値を持っている間に外した（取り消した。C56。after を持たない）
LC_MOVES = ("none", "tightened", "widened", "cancelled")
TIMEFRAME_CHANGES = ("none", "longer", "shorter")
# expiry = 満期（SQ）: 足を持つ取引だけ（C54。下の _check_legs）
ORDER_TYPES = ("stop", "market", "limit", "unknown", "expiry")
# satisfied = TP の前に満足して（#203）
EXIT_REASONS = (
    "lc",
    "gapSlip",
    "tp",
    "brokeManual",
    "fearEarly",
    "satisfied",
    "timeout",
    "other",
)
GAP_SLIP = ("yes", "no", "unanswered")
STOP_ORDER_PLACED = ("placed", "notPlaced", "unanswered")
UNDERLYING_KINDS = ("index", "fx", "commodity", "crypto", "stock", "other")
PRODUCT_FORMS = ("spotCfd", "future", "option")
PERFORMANCE_UNITS = ("R", "yen")

Issue = dict[str, str]


class BodyError(Exception):
    """本文を JSON のオブジェクトとして読めない（kind は短い語）"""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _reject_constant(_name: str):
    raise ValueError("NaN・Infinity は受けない")


def parse_json_body(raw: bytes, content_type: str | None) -> Any:
    mimetype = (content_type or "").split(";", 1)[0].strip().lower()
    if mimetype != "application/json":
        raise BodyError("contentType")
    if len(raw) > MAX_BODY_BYTES:
        raise BodyError("tooLarge")
    try:
        text = raw.decode("utf-8")
        return json.loads(text, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise BodyError("json") from None


def name_key(name: str) -> str:
    """銘柄の名前の比較用（全角・大文字小文字・前後の空白の違いを同じとみなす）"""
    return unicodedata.normalize("NFKC", name).casefold().strip()


def _is_number(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


class _Checker:
    def __init__(self):
        self.issues: list[Issue] = []

    def add(self, field: str, kind: str) -> None:
        if len(self.issues) < MAX_ISSUES:
            self.issues.append({"field": field, "kind": kind})

    @staticmethod
    def path(parent: str, key: str) -> str:
        return f"{parent}.{key}" if parent else key

    def obj(self, value: Any, path: str, allowed: tuple[str, ...]) -> dict | None:
        if not isinstance(value, dict):
            self.add(path, "type")
            return None
        if any(k not in allowed for k in value):
            self.add(path, "unknownField")
        return value

    # 各欄: 無ければ MISSING を返す。誤りは issues に足して INVALID を返す
    def field(self, src: dict, key: str, parent: str, check: Callable[[Any, str], Any], *, required=False):
        path = self.path(parent, key)
        if key not in src:
            if required:
                self.add(path, "required")
                return INVALID
            return MISSING
        return check(src[key], path)

    def number(self, v: Any, path: str, *, positive=False) -> Any:
        if not _is_number(v):
            self.add(path, "type")
            return INVALID
        if not math.isfinite(v) or abs(v) > MAX_ABS or (positive and v <= 0):
            self.add(path, "range")
            return INVALID
        return v

    def positive(self, v: Any, path: str) -> Any:
        return self.number(v, path, positive=True)

    def time(self, v: Any, path: str) -> Any:
        if isinstance(v, bool) or not isinstance(v, int):
            self.add(path, "type")
            return INVALID
        if v < 0 or v > MAX_TIME_MS:
            self.add(path, "range")
            return INVALID
        return v

    def boolean(self, v: Any, path: str) -> Any:
        if not isinstance(v, bool):
            self.add(path, "type")
            return INVALID
        return v

    def enum(self, choices: tuple[str, ...]) -> Callable[[Any, str], Any]:
        def check(v: Any, path: str) -> Any:
            if not isinstance(v, str) or v not in choices:
                self.add(path, "enum")
                return INVALID
            return v

        return check

    def text(self, max_len: int, *, multiline=False) -> Callable[[Any, str], Any]:
        allowed = {"\n", "\r", "\t"} if multiline else set()

        def check(v: Any, path: str) -> Any:
            if not isinstance(v, str):
                self.add(path, "type")
                return INVALID
            if len(v) > max_len:
                self.add(path, "length")
                return INVALID
            for ch in v:
                # Cc = 制御文字、Cs = 孤立したサロゲート、Cf = 書式文字（双方向の上書き・ゼロ幅文字など。
                # 見た目の同じ別の名前や、表示の順を入れ替える文字を作らせない）。ZWJ（U+200D）だけは
                # 絵文字の組み立て（家族の絵文字など）に使うので受ける
                if ch not in allowed and ch != _ZWJ and unicodedata.category(ch) in ("Cc", "Cs", "Cf"):
                    self.add(path, "control")
                    return INVALID
            return v

        return check


class _Sentinel:
    def __init__(self, name: str):
        self.name = name

    def __repr__(self) -> str:
        return self.name


MISSING = _Sentinel("MISSING")
INVALID = _Sentinel("INVALID")


def _put(out: dict, key: str, value: Any, default: Any = MISSING) -> None:
    if value is MISSING:
        if default is not MISSING:
            out[key] = default
        return
    if value is not INVALID:
        out[key] = value


# ── 取引 ─────────────────────────────────────

_TRADE_FIELDS = (
    "status", "source", "instrumentId", "accountId", "side", "contractMonth", "optionType", "strike", "timeframe", "lc",
    "brokenCondition", "lcBasis", "tp", "thesis", "entryEmotion", "stopOrderPlaced", "planFxRate", "plannedAt",
    "lcDecidedBeforeEntry", "lcMove", "timeframeChange", "entries", "exit", "statementPnlYen", "fees",
    "entryChartTimeframe", "exitChartTimeframe", "extraCharts", "legs", "riskPlan", "lcLossPlanYen",
)  # fmt: skip
# オプションのポジションの足（#116・設計書 4.7・C46。core/trade.ts の Leg と同じ形）
MAX_LEGS = 10
LEG_ID = re.compile(r"^l(?:10|[1-9])\Z")
LEG_SIDES = ("buy", "sell")
LEG_EXIT_KINDS = ("closed", "expired")
# 限月: YYYY-MM（週次は SQ の日 YYYY-MM-DD）。実在の月・日だけ
_CONTRACT_MONTH = re.compile(r"^([0-9]{4})-([0-9]{2})(?:-([0-9]{2}))?\Z")
# 1R の決め方（4.7・C50）: maxLoss = 「最大損失まで」
RISK_PLANS = ("maxLoss",)
_LEG_FIELDS = ("id", "optionType", "contractMonth", "strike", "side", "quantity", "entry", "exit")
_LEG_ENTRY_FIELDS = ("price", "time")
_LEG_EXIT_FIELDS = ("price", "time", "kind")
# 足を持つ取引では使わない前の欄（4.7。あれば 400）
_PRE_LEG_FIELDS = ("contractMonth", "optionType", "strike")
# 付属のチャート（#89）: 枠は x1〜x5、最大 5 枚、一言は 40 字まで（loss_note_api.charts と同じ値）
EXTRA_CHART_SLOTS = ("x1", "x2", "x3", "x4", "x5")
EXTRA_CHART_NOTE_MAX = 40
_EXTRA_CHART_FIELDS = ("slot", "timeframe", "note")
_ENTRY_FIELDS = ("time", "price", "quantity", "lc")
_EXIT_FIELDS = ("time", "price", "fxRate", "orderType", "reason", "gapSlip", "emotion", "review")
_FEE_FIELDS = ("label", "amountYen")


def validate_trade(body: Any) -> tuple[dict | None, list[Issue]]:
    c = _Checker()
    src = c.obj(body, "", _TRADE_FIELDS)
    if src is None:
        return None, c.issues
    out: dict = {}

    def status(v: Any, path: str) -> Any:
        v = c.enum(STATUSES)(v, path)
        if v is not INVALID and v not in ACCEPTED_STATUSES:
            c.add(path, "unsupported")
            return INVALID
        return v

    def instrument_id(v: Any, path: str) -> Any:
        if not isinstance(v, str) or not ID_PATTERN.match(v):
            c.add(path, "format")
            return INVALID
        return v

    _put(out, "status", c.field(src, "status", "", status, required=True))
    _put(out, "source", c.field(src, "source", "", c.enum(SOURCES), required=True))
    _put(out, "instrumentId", c.field(src, "instrumentId", "", instrument_id, required=True))
    # 口座（#47。任意。無い = 既定の口座）。形は銘柄の ID と同じ検査
    _put(out, "accountId", c.field(src, "accountId", "", instrument_id))
    _put(out, "side", c.field(src, "side", "", c.enum(SIDES), required=True))
    _put(out, "contractMonth", c.field(src, "contractMonth", "", c.text(16)))
    _put(out, "optionType", c.field(src, "optionType", "", c.enum(OPTION_TYPES)))
    _put(out, "strike", c.field(src, "strike", "", c.positive))
    _put(out, "timeframe", c.field(src, "timeframe", "", c.enum(TIMEFRAMES)))
    _put(out, "lc", c.field(src, "lc", "", c.number))
    _put(out, "brokenCondition", c.field(src, "brokenCondition", "", c.text(200)))
    _put(out, "lcBasis", c.field(src, "lcBasis", "", c.enum(LC_BASES)), "chart")
    _put(out, "tp", c.field(src, "tp", "", c.number))
    _put(out, "thesis", c.field(src, "thesis", "", c.text(2000, multiline=True)))
    _put(out, "entryEmotion", c.field(src, "entryEmotion", "", c.text(500, multiline=True)))
    _put(out, "stopOrderPlaced", c.field(src, "stopOrderPlaced", "", c.enum(STOP_ORDER_PLACED)), "unanswered")
    _put(out, "planFxRate", c.field(src, "planFxRate", "", c.positive))
    _put(out, "plannedAt", c.field(src, "plannedAt", "", c.time))
    _put(out, "lcDecidedBeforeEntry", c.field(src, "lcDecidedBeforeEntry", "", c.boolean, required=True))

    def lc_move(v: Any, path: str) -> Any:
        m = c.obj(v, path, ("kind", "after"))
        if m is None:
            return INVALID
        kind = c.field(m, "kind", path, c.enum(LC_MOVES), required=True)
        if kind is INVALID:
            return INVALID
        res: dict = {"kind": kind}
        if kind == "widened":
            after = c.field(m, "after", path, c.number)
            _put(res, "after", after)
        elif "after" in m:
            c.add(path, "unknownField")
            return INVALID
        return res

    _put(out, "lcMove", c.field(src, "lcMove", "", lc_move, required=True))
    _put(out, "timeframeChange", c.field(src, "timeframeChange", "", c.enum(TIMEFRAME_CHANGES), required=True))

    def entries(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if not 1 <= len(v) <= MAX_ENTRIES:
            c.add(path, "count")
            return INVALID
        res = []
        for i, item in enumerate(v):
            p = f"{path}[{i}]"
            e = c.obj(item, p, _ENTRY_FIELDS)
            if e is None:
                continue
            row: dict = {}
            _put(row, "time", c.field(e, "time", p, c.time))
            _put(row, "price", c.field(e, "price", p, c.number, required=True))
            _put(row, "quantity", c.field(e, "quantity", p, c.positive, required=True))
            _put(row, "lc", c.field(e, "lc", p, c.number))
            res.append(row)
        return res

    _put(out, "entries", c.field(src, "entries", "", entries, required=True))

    def exit_(v: Any, path: str) -> Any:
        x = c.obj(v, path, _EXIT_FIELDS)
        if x is None:
            return INVALID
        res: dict = {}
        _put(res, "time", c.field(x, "time", path, c.time, required=True))
        _put(res, "price", c.field(x, "price", path, c.number, required=True))
        _put(res, "fxRate", c.field(x, "fxRate", path, c.positive))
        _put(res, "orderType", c.field(x, "orderType", path, c.enum(ORDER_TYPES)), "unknown")
        _put(res, "reason", c.field(x, "reason", path, c.enum(EXIT_REASONS)), "other")
        _put(res, "gapSlip", c.field(x, "gapSlip", path, c.enum(GAP_SLIP)), "unanswered")
        _put(res, "emotion", c.field(x, "emotion", path, c.text(500, multiline=True)))
        _put(res, "review", c.field(x, "review", path, c.text(2000, multiline=True)))
        return res

    _put(out, "exit", c.field(src, "exit", "", exit_, required=True))
    _put(out, "statementPnlYen", c.field(src, "statementPnlYen", "", c.number))

    def fees(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if len(v) > MAX_FEES:
            c.add(path, "count")
            return INVALID
        res = []
        for i, item in enumerate(v):
            p = f"{path}[{i}]"
            f = c.obj(item, p, _FEE_FIELDS)
            if f is None:
                continue
            row: dict = {}
            _put(row, "label", c.field(f, "label", p, c.text(40)))
            _put(row, "amountYen", c.field(f, "amountYen", p, c.number, required=True))
            res.append(row)
        return res

    _put(out, "fees", c.field(src, "fees", "", fees), [])
    _put(out, "entryChartTimeframe", c.field(src, "entryChartTimeframe", "", c.enum(TIMEFRAMES)))
    _put(out, "exitChartTimeframe", c.field(src, "exitChartTimeframe", "", c.enum(TIMEFRAMES)))

    def extra_charts(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if len(v) > len(EXTRA_CHART_SLOTS):
            c.add(path, "length")
            return INVALID
        res: list = []
        seen: set = set()
        for i, item in enumerate(v):
            p = f"{path}[{i}]"
            e = c.obj(item, p, _EXTRA_CHART_FIELDS)
            if e is None:
                continue
            row: dict = {}
            _put(row, "slot", c.field(e, "slot", p, c.enum(EXTRA_CHART_SLOTS), required=True))
            _put(row, "timeframe", c.field(e, "timeframe", p, c.enum(TIMEFRAMES)))
            _put(row, "note", c.field(e, "note", p, c.text(EXTRA_CHART_NOTE_MAX)))
            if row.get("slot") in seen:
                c.add(f"{p}.slot", "duplicate")
            seen.add(row.get("slot"))
            # 空の一言は持たない
            if row.get("note") == "":
                del row["note"]
            res.append(row)
        # 空の並びは持たない（付属の無い取引は今と同じ形）
        return res if res else MISSING

    _put(out, "extraCharts", c.field(src, "extraCharts", "", extra_charts))

    def non_negative(v: Any, path: str) -> Any:
        v = c.number(v, path)
        if v is not INVALID and v < 0:
            c.add(path, "range")
            return INVALID
        return v

    def contract_month(v: Any, path: str) -> Any:
        m = _CONTRACT_MONTH.match(v) if isinstance(v, str) else None
        try:
            if m is None:
                raise ValueError
            datetime.date(int(m[1]), int(m[2]), int(m[3] or 1))
        except ValueError:
            c.add(path, "format")
            return INVALID
        return v

    def leg_id(v: Any, path: str) -> Any:
        if not isinstance(v, str) or not LEG_ID.match(v):
            c.add(path, "format")
            return INVALID
        return v

    def leg_side(fields: tuple[str, ...], with_kind: bool) -> Callable[[Any, str], Any]:
        def check(v: Any, path: str) -> Any:
            x = c.obj(v, path, fields)
            if x is None:
                return INVALID
            res: dict = {}
            _put(res, "price", c.field(x, "price", path, non_negative, required=True))
            _put(res, "time", c.field(x, "time", path, c.time))
            if with_kind:
                _put(res, "kind", c.field(x, "kind", path, c.enum(LEG_EXIT_KINDS), required=True))
            return res

        return check

    def legs(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if not 1 <= len(v) <= MAX_LEGS:
            c.add(path, "count")
            return INVALID
        res = []
        seen: set = set()
        for i, item in enumerate(v):
            p = f"{path}[{i}]"
            lg = c.obj(item, p, _LEG_FIELDS)
            if lg is None:
                continue
            row: dict = {}
            _put(row, "id", c.field(lg, "id", p, leg_id, required=True))
            _put(row, "optionType", c.field(lg, "optionType", p, c.enum(OPTION_TYPES), required=True))
            _put(row, "contractMonth", c.field(lg, "contractMonth", p, contract_month, required=True))
            _put(row, "strike", c.field(lg, "strike", p, c.positive, required=True))
            _put(row, "side", c.field(lg, "side", p, c.enum(LEG_SIDES), required=True))
            _put(row, "quantity", c.field(lg, "quantity", p, c.positive, required=True))
            _put(row, "entry", c.field(lg, "entry", p, leg_side(_LEG_ENTRY_FIELDS, False), required=True))
            _put(row, "exit", c.field(lg, "exit", p, leg_side(_LEG_EXIT_FIELDS, True), required=True))
            if "id" in row:
                if row["id"] in seen:
                    c.add(f"{p}.id", "duplicate")
                seen.add(row["id"])
            res.append(row)
        return res

    _put(out, "legs", c.field(src, "legs", "", legs))
    _put(out, "riskPlan", c.field(src, "riskPlan", "", c.enum(RISK_PLANS)))
    _put(out, "lcLossPlanYen", c.field(src, "lcLossPlanYen", "", c.positive))

    if not c.issues:
        _check_legs(out, c)
    if not c.issues:
        _check_lc_direction(out, c)
    if c.issues:
        return None, c.issues
    return out, []


def _check_legs(t: dict, c: _Checker) -> None:
    """足を持つ取引の欄同士の検査（設計書 4.7・C54・ADR-0020）。足の無い取引には新しい欄（riskPlan・
    lcLossPlanYen・満期（SQ））を持たせない（前からの取引の形を変えない）。
    最大損失が定まるかは見ない（画面が core で見る）"""
    legs = t.get("legs")
    if legs is None:
        for key in ("riskPlan", "lcLossPlanYen"):
            if key in t:
                c.add(key, "requiresLegs")
        if t["exit"]["orderType"] == "expiry":
            c.add("exit.orderType", "requiresLegs")
        return
    for key in _PRE_LEG_FIELDS:
        if key in t:
            c.add(key, "withLegs")
    # エントリーは 1 つ（price = 建てたときの原資産・quantity = 1。使わない値）
    if len(t["entries"]) != 1:
        c.add("entries", "count")
        return
    entry = t["entries"][0]
    if entry["quantity"] != 1:
        c.add("entries[0].quantity", "range")
    # 「最大損失まで」は LC と見込みを持たない（C50）
    if t.get("riskPlan") == "maxLoss":
        if "lc" in t:
            c.add("lc", "withRiskPlan")
        if "lc" in entry:
            c.add("entries[0].lc", "withRiskPlan")
        if "lcLossPlanYen" in t:
            c.add("lcLossPlanYen", "withRiskPlan")
    # 満期（SQ）は満期で消えた売りの足がある（またはすべての足が満期で消えた）ポジションだけ（C54）
    if t["exit"]["orderType"] == "expiry":
        expired = [lg for lg in legs if lg["exit"]["kind"] == "expired"]
        if not (any(lg["side"] == "sell" for lg in expired) or len(expired) == len(legs)):
            c.add("exit.orderType", "expiry")
    # 足の時刻はポジションの建てた時刻〜決済した時刻の範囲（満期で消えた足の決済の時刻 = SQ の日は見ない。C54）
    start, end = entry.get("time"), t["exit"]["time"]
    for i, lg in enumerate(legs):
        times = [("entry", lg["entry"].get("time"))]
        if lg["exit"]["kind"] == "closed":
            times.append(("exit", lg["exit"].get("time")))
        for side, at in times:
            if at is not None and ((start is not None and at < start) or at > end):
                c.add(f"legs[{i}].{side}.time", "outOfPosition")
        opened, closed = lg["entry"].get("time"), lg["exit"].get("time")
        if opened is not None and closed is not None and closed < opened:
            c.add(f"legs[{i}].exit.time", "legTimeOrder")


def _check_lc_direction(t: dict, c: _Checker) -> None:
    """C11（core/validate.ts と同じ規則）: L は LC < イン、S は LC > イン（等しいのも不可）。
    下げた後の LC は入る前の LC より不利な側"""
    is_long = t["side"] == "L"
    trade_lc = t.get("lc")
    for i, e in enumerate(t["entries"]):
        lc = e.get("lc", trade_lc)
        if lc is None:
            continue
        ok = lc < e["price"] if is_long else lc > e["price"]
        if not ok:
            c.add(f"entries[{i}].lc", "lcDirection")
    move = t["lcMove"]
    if move["kind"] == "widened" and "after" in move and trade_lc is not None:
        after = move["after"]
        ok = after < trade_lc if is_long else after > trade_lc
        if not ok:
            c.add("lcMove.after", "lcMoveDirection")
    # C56: 取り消した（置いた逆指値を外した）と、逆指値の未設定（置いていなかった）は同時に持たない
    if move["kind"] == "cancelled" and t.get("stopOrderPlaced") == "notPlaced":
        c.add("stopOrderPlaced", "lcMoveCancelledNotPlaced")


# ── 銘柄 ─────────────────────────────────────

MAX_NAME = 40


def _name_check(c: _Checker) -> Callable[[Any, str], Any]:
    """銘柄・口座の名前: 40 字まで・制御文字なし・前後の空白を除いて空でない（除いた値を保存する）"""

    def check(v: Any, path: str) -> Any:
        v = c.text(MAX_NAME)(v, path)
        if v is INVALID:
            return INVALID
        v = v.strip()
        if not v:
            c.add(path, "length")
            return INVALID
        return v

    return check


_INSTRUMENT_FIELDS = ("name", "underlying", "underlyingKind", "productForm", "priceCurrency", "multiplier",
                      "quantityStep")  # fmt: skip


def validate_instrument(body: Any) -> tuple[dict | None, list[Issue]]:
    c = _Checker()
    src = c.obj(body, "", _INSTRUMENT_FIELDS)
    if src is None:
        return None, c.issues
    out: dict = {}

    def currency(v: Any, path: str) -> Any:
        if v is None:
            return None
        if not isinstance(v, str) or not _CURRENCY.match(v):
            c.add(path, "format")
            return INVALID
        return v

    _put(out, "name", c.field(src, "name", "", _name_check(c), required=True))
    _put(out, "underlying", c.field(src, "underlying", "", c.text(40)))
    _put(out, "underlyingKind", c.field(src, "underlyingKind", "", c.enum(UNDERLYING_KINDS)), "other")
    _put(out, "productForm", c.field(src, "productForm", "", c.enum(PRODUCT_FORMS)), "spotCfd")
    _put(out, "priceCurrency", c.field(src, "priceCurrency", "", currency), None)
    _put(out, "multiplier", c.field(src, "multiplier", "", c.positive), 1)
    _put(out, "quantityStep", c.field(src, "quantityStep", "", c.positive), 1)
    if c.issues:
        return None, c.issues
    return out, []


# ── 設定 ─────────────────────────────────────

RISK_TOLERANCE_RANGE = (0.5, 3)


def _capital_check(c: _Checker) -> Callable[[Any, str], Any]:
    """資金（円）: 正の数か null（未設定）"""

    def check(v: Any, path: str) -> Any:
        return None if v is None else c.positive(v, path)

    return check


def _risk_check(c: _Checker) -> Callable[[Any, str], Any]:
    """許容リスク（%）: RISK_TOLERANCE_RANGE の中"""

    def check(v: Any, path: str) -> Any:
        v = c.number(v, path)
        if v is not INVALID and not RISK_TOLERANCE_RANGE[0] <= v <= RISK_TOLERANCE_RANGE[1]:
            c.add(path, "range")
            return INVALID
        return v

    return check


def validate_settings(body: Any) -> tuple[dict | None, list[Issue]]:
    c = _Checker()
    src = c.obj(body, "", ("capitalYen", "riskTolerancePct", "performanceUnit"))
    if src is None:
        return None, c.issues
    out: dict = {}
    _put(out, "capitalYen", c.field(src, "capitalYen", "", _capital_check(c), required=True))
    _put(out, "riskTolerancePct", c.field(src, "riskTolerancePct", "", _risk_check(c), required=True))
    _put(out, "performanceUnit", c.field(src, "performanceUnit", "", c.enum(PERFORMANCE_UNITS), required=True))
    if c.issues:
        return None, c.issues
    return out, []


# ── 口座（#47。通貨は PR-2）──────────────

_ACCOUNT_FIELDS = ("name", "currency", "capitalYen", "riskTolerancePct")
DEFAULT_ACCOUNT_RISK_PCT = 1
DEFAULT_ACCOUNT_CURRENCY = "JPY"


def _account_currency_check(c: _Checker) -> Callable[[Any, str], Any]:
    """口座の通貨: ISO 4217 の 3 文字（銘柄の priceCurrency と同じ形。null は受けない）"""

    def check(v: Any, path: str) -> Any:
        if not isinstance(v, str) or not _CURRENCY.match(v):
            c.add(path, "format")
            return INVALID
        return v

    return check


def validate_account(body: Any, *, create: bool) -> tuple[dict | None, list[Issue]]:
    """作成: name 必須・currency 任意（既定 JPY）・capitalYen 任意（既定 null）・riskTolerancePct 任意（既定 1）。
    直す: name・capitalYen・riskTolerancePct は必須、currency は任意（省くと今のまま = 応答に入れない）。
    ほかの欄は unknownField"""
    c = _Checker()
    src = c.obj(body, "", _ACCOUNT_FIELDS)
    if src is None:
        return None, c.issues
    out: dict = {}
    _put(out, "name", c.field(src, "name", "", _name_check(c), required=True))
    if create:
        _put(out, "currency", c.field(src, "currency", "", _account_currency_check(c)), DEFAULT_ACCOUNT_CURRENCY)
    else:
        _put(out, "currency", c.field(src, "currency", "", _account_currency_check(c)))
    if create:
        _put(out, "capitalYen", c.field(src, "capitalYen", "", _capital_check(c)), None)
        _put(out, "riskTolerancePct", c.field(src, "riskTolerancePct", "", _risk_check(c)), DEFAULT_ACCOUNT_RISK_PCT)
    else:
        _put(out, "capitalYen", c.field(src, "capitalYen", "", _capital_check(c), required=True))
        _put(out, "riskTolerancePct", c.field(src, "riskTolerancePct", "", _risk_check(c), required=True))
    if c.issues:
        return None, c.issues
    return out, []


# ── 明細の特徴の覚え（#66）─────────────────────────────

_STATEMENT_PROFILE_FIELDS = ("accountId",)


def validate_statement_profile(body: Any) -> tuple[dict | None, list[Issue]]:
    """覚える入口の本文: accountId（ID の形）だけ。必須。ほかの欄は unknownField"""
    c = _Checker()
    src = c.obj(body, "", _STATEMENT_PROFILE_FIELDS)
    if src is None:
        return None, c.issues

    def check_id(v: Any, path: str) -> Any:
        # 形は取引の accountId と同じ検査
        if not isinstance(v, str) or not ID_PATTERN.match(v):
            c.add(path, "format")
            return INVALID
        return v

    out: dict = {}
    _put(out, "accountId", c.field(src, "accountId", "", check_id, required=True))
    if c.issues:
        return None, c.issues
    return out, []


# ── 心理のタグ（#156・C55・ADR-0022）─────────────────────────

_EMOTION_FIELDS = ("tradeIds", "tags")


def validate_emotion_tags(body: Any) -> tuple[dict | None, list[Issue], bool]:
    """``PUT /api/trade-emotions`` の本文 →
    ``(値, issues, 取引の ID の形が崩れている)``。

    値は ``{"tradeIds": [...], "tags": [一覧の順]}``。tradeIds は 1〜20 件・重複なし。tags は 0〜21 個の一覧の ID・
    重複なし・平常心はほかと同時に付かない（exclusive）。取引の ID の形が崩れていれば 3 つ目を True にする（呼び出し側は
    経路の ID と同じく、保存先に触れずに 404 にする）。issues は道筋と種類だけ（送った値を映さない）
    """
    c = _Checker()
    src = c.obj(body, "", _EMOTION_FIELDS)
    if src is None:
        return None, c.issues, False
    bad_id = False

    def trade_ids(v: Any, path: str) -> Any:
        nonlocal bad_id
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if not 1 <= len(v) <= emotion_tags.MAX_TRADES:
            c.add(path, "count")
            return INVALID
        if any(not isinstance(x, str) or not ID_PATTERN.match(x) for x in v):
            bad_id = True
            return INVALID
        if len(set(v)) != len(v):
            c.add(path, "duplicate")
            return INVALID
        return list(v)

    def tags(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if len(v) > len(emotion_tags.EMOTION_TAG_IDS):
            c.add(path, "count")
            return INVALID
        ok = True
        for i, x in enumerate(v):
            if not isinstance(x, str) or x not in emotion_tags.ORDER:
                c.add(f"{path}.{i}", "enum")
                ok = False
        if not ok:
            return INVALID
        if len(set(v)) != len(v):
            c.add(path, "duplicate")
            return INVALID
        if emotion_tags.CALM in v and len(v) > 1:
            c.add(path, "exclusive")
            return INVALID
        return emotion_tags.ordered(list(v))

    out: dict = {}
    _put(out, "tradeIds", c.field(src, "tradeIds", "", trade_ids, required=True))
    _put(out, "tags", c.field(src, "tags", "", tags, required=True))
    if c.issues:
        return None, c.issues, False
    if bad_id:
        return None, [], True
    return out, [], False


# ── 取引の Good / More（#123・C58・ADR-0024）──────────────────

_REFLECTION_FIELDS = ("tradeIds", "good", "more")
_REFLECTION_PART_FIELDS = ("topics", "notes")
# 行の区切り（Zl・Zp）は 1 行の文にしない（text は Cc・Cs・Cf を見る）
_LINE_BREAK_CATEGORIES = ("Zl", "Zp")


def validate_reflection(body: Any) -> tuple[dict | None, list[Issue], bool]:
    """``PUT /api/trade-reflections`` の本文 →
    ``(値, issues, 取引の ID の形が崩れている)``。

    値は ``{"tradeIds": [...], "good": {"topics": [一覧の順], "notes": [...]}, "more": {...}}``。tradeIds は心理のタグと
    同じ 1〜20 件・重複なし。topics はその側の一覧の ID・重複なし。notes は 0〜10 行・前後の空白を除いて 1〜100 字
    （コードポイント）・改行と制御文字なし（除いた後の値を保存する）。issues は道筋と種類だけ（送った値を映さない）
    """
    c = _Checker()
    src = c.obj(body, "", _REFLECTION_FIELDS)
    if src is None:
        return None, c.issues, False
    bad_id = False

    def trade_ids(v: Any, path: str) -> Any:
        nonlocal bad_id
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if not 1 <= len(v) <= emotion_tags.MAX_TRADES:
            c.add(path, "count")
            return INVALID
        if any(not isinstance(x, str) or not ID_PATTERN.match(x) for x in v):
            bad_id = True
            return INVALID
        if len(set(v)) != len(v):
            c.add(path, "duplicate")
            return INVALID
        return list(v)

    def part(side: str) -> Callable[[Any, str], Any]:
        def topics(v: Any, path: str) -> Any:
            if not isinstance(v, list):
                c.add(path, "type")
                return INVALID
            if len(v) > len(reflection.TOPICS[side]):
                c.add(path, "count")
                return INVALID
            ok = True
            for i, x in enumerate(v):
                if not isinstance(x, str) or x not in reflection.ORDER[side]:
                    c.add(f"{path}.{i}", "enum")
                    ok = False
            if not ok:
                return INVALID
            if len(set(v)) != len(v):
                c.add(path, "duplicate")
                return INVALID
            return reflection.ordered(side, list(v))

        line = c.text(reflection.MAX_NOTE_LENGTH)

        def notes(v: Any, path: str) -> Any:
            if not isinstance(v, list):
                c.add(path, "type")
                return INVALID
            if len(v) > reflection.MAX_NOTES:
                c.add(path, "count")
                return INVALID
            out = []
            for i, x in enumerate(v):
                p = f"{path}.{i}"
                if not isinstance(x, str):
                    c.add(p, "type")
                    return INVALID
                s = x.strip()
                if not s:
                    c.add(p, "required")
                    return INVALID
                if any(unicodedata.category(ch) in _LINE_BREAK_CATEGORIES for ch in s):
                    c.add(p, "control")
                    return INVALID
                checked = line(s, p)
                if checked is INVALID:
                    return INVALID
                out.append(checked)
            return out

        def check(v: Any, path: str) -> Any:
            psrc = c.obj(v, path, _REFLECTION_PART_FIELDS)
            if psrc is None:
                return INVALID
            res: dict = {}
            _put(res, "topics", c.field(psrc, "topics", path, topics, required=True))
            _put(res, "notes", c.field(psrc, "notes", path, notes, required=True))
            return res

        return check

    out: dict = {}
    _put(out, "tradeIds", c.field(src, "tradeIds", "", trade_ids, required=True))
    for side in reflection.SIDES:
        _put(out, side, c.field(src, side, "", part(side), required=True))
    if c.issues:
        return None, c.issues, False
    if bad_id:
        return None, [], True
    return out, [], False


# ── 心理のタグの選択肢の設定（#163・ADR-0023）──────────────

_EMOTION_SETTINGS_FIELDS = ("hidden",)


def validate_emotion_settings(body: Any) -> tuple[dict | None, list[Issue]]:
    """``PUT /api/settings/emotion-tags`` の本文 → ``(値, issues)``。

    値は ``{"hidden": [一覧の順]}``。hidden は 0〜20 個の一覧の ID・重複なし・平常心を含まない（``calm``）。
    issues は道筋と種類だけ（送った値を映さない）
    """
    c = _Checker()
    src = c.obj(body, "", _EMOTION_SETTINGS_FIELDS)
    if src is None:
        return None, c.issues

    def hidden(v: Any, path: str) -> Any:
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if len(v) > len(emotion_tags.HIDEABLE):
            c.add(path, "count")
            return INVALID
        ok = True
        for i, x in enumerate(v):
            if not isinstance(x, str) or x not in emotion_tags.ORDER:
                c.add(f"{path}.{i}", "enum")
                ok = False
        if not ok:
            return INVALID
        if len(set(v)) != len(v):
            c.add(path, "duplicate")
            return INVALID
        if emotion_tags.CALM in v:
            c.add(path, "calm")
            return INVALID
        return emotion_tags.ordered(list(v))

    out: dict = {}
    _put(out, "hidden", c.field(src, "hidden", "", hidden, required=True))
    if c.issues:
        return None, c.issues
    return out, []



# ── 両建てのまとまり（#266・C75・4.8・ADR-0027）──────────────────

_GROUP_FIELDS = ("members", "exit")
_GROUP_MEMBER_FIELDS = ("tradeId", "role")
_GROUP_EXIT_FIELDS = ("price", "orderType", "reason")


def validate_position_group(body: Any) -> tuple[dict | None, list[Issue], bool]:
    """``POST /api/position-groups``・``PUT /api/position-groups/{id}`` の本文 →
    ``(値, issues, 取引の ID の形が崩れている)``。

    値は ``{"members": [{"tradeId", "role"}], "exit": {...}}``（``exit`` は任意。中身が空なら持たない）。members は
    2〜10 件・取引の ID の重なりなし・本玉（main）と決済の代わり（hedge）が 1 件以上ずつ。exit は ``price``（正の数）・
    ``orderType``（stop / market / limit）・``reason``（決済の理由の値）のどれも任意。向き・足・本人の取引かは取引を
    読んでから（``position_groups.shape_issues``）。取引の ID の形が崩れていれば 3 つ目を True にする（保存先に触れずに
    404）。issues は道筋と種類だけ（送った値を映さない）
    """
    c = _Checker()
    src = c.obj(body, "", _GROUP_FIELDS)
    if src is None:
        return None, c.issues, False
    bad_id = False

    def members(v: Any, path: str) -> Any:
        nonlocal bad_id
        if not isinstance(v, list):
            c.add(path, "type")
            return INVALID
        if not position_groups.MIN_MEMBERS <= len(v) <= position_groups.MAX_MEMBERS:
            c.add(path, "count")
            return INVALID
        res = []
        for i, item in enumerate(v):
            p = f"{path}[{i}]"
            m = c.obj(item, p, _GROUP_MEMBER_FIELDS)
            if m is None:
                continue
            tid = m.get("tradeId", MISSING)
            if tid is MISSING:
                c.add(f"{p}.tradeId", "required")
            elif not isinstance(tid, str) or not ID_PATTERN.match(tid):
                bad_id = True
            role = c.field(m, "role", p, c.enum(position_groups.ROLES), required=True)
            res.append({"tradeId": tid, "role": role})
        if c.issues or bad_id:
            return INVALID
        if len({m["tradeId"] for m in res}) != len(res):
            c.add(path, "duplicate")
            return INVALID
        if not position_groups.has_roles(res):
            c.add(path, "roles")
            return INVALID
        return res

    def exit_(v: Any, path: str) -> Any:
        x = c.obj(v, path, _GROUP_EXIT_FIELDS)
        if x is None:
            return INVALID
        res: dict = {}
        _put(res, "price", c.field(x, "price", path, c.positive))
        _put(res, "orderType", c.field(x, "orderType", path, c.enum(position_groups.EXIT_ORDER_TYPES)))
        _put(res, "reason", c.field(x, "reason", path, c.enum(EXIT_REASONS)))
        return res

    out: dict = {}
    _put(out, "members", c.field(src, "members", "", members, required=True))
    exit_value = c.field(src, "exit", "", exit_)
    if exit_value not in (MISSING, INVALID) and exit_value:
        out["exit"] = exit_value
    if c.issues:
        return None, c.issues, False
    if bad_id:
        return None, [], True
    return out, [], False
