"""本文の検査（純関数。設計書 4 章・C11・Issue #4 の「入力の上限」・ADR-0004）。

``validate_*`` は ``(既定を埋めた値, [])`` か ``(None, issues)`` を返す。issues は既知の項目の道筋と種類だけで、
送った値・知らない項目の名前を含まない（入力を応答に映さない）。入力の辞書は変えない。
数は丸めず、int / float の区別をそのまま保つ（往復で同じ値が返る）。意味は ``core/trade.ts`` が正。
"""

import json
import math
import re
import unicodedata
from collections.abc import Callable
from typing import Any

MAX_ABS = 1e12
MAX_TIME_MS = 4_102_444_800_000  # 2100-01-01T00:00:00Z
MAX_ENTRIES = 20
MAX_FEES = 20
MAX_BODY_BYTES = 64 * 1024
MAX_CAPITAL_HISTORY = 1000
MAX_ISSUES = 50

ID_PATTERN = re.compile(r"^[A-Za-z0-9]{1,40}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_ZWJ = "\u200d"

# core/trade.ts の TIMEFRAMES と同じ（短い順）
TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")
STATUSES = ("planned", "open", "closed", "skipped")
ACCEPTED_STATUSES = ("closed",)  # この Issue は決済済みだけ（計画中・保有中・見送りは縦切り 3）
SOURCES = ("manual", "statement", "import")
SIDES = ("L", "S")
OPTION_TYPES = ("P", "C")
LC_BASES = ("chart", "amount")
LC_MOVES = ("none", "tightened", "widened")
TIMEFRAME_CHANGES = ("none", "longer", "shorter")
ORDER_TYPES = ("stop", "market", "limit", "unknown")
EXIT_REASONS = ("lc", "gapSlip", "tp", "brokeManual", "fearEarly", "timeout", "other")
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
    "entryChartTimeframe", "exitChartTimeframe",
)  # fmt: skip
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

    if not c.issues:
        _check_lc_direction(out, c)
    if c.issues:
        return None, c.issues
    return out, []


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


# ── 口座（#47 PR-1。通貨は持たない = すべて円）──────────────

_ACCOUNT_FIELDS = ("name", "capitalYen", "riskTolerancePct")
DEFAULT_ACCOUNT_RISK_PCT = 1


def validate_account(body: Any, *, create: bool) -> tuple[dict | None, list[Issue]]:
    """作成: name 必須・capitalYen 任意（既定 null）・riskTolerancePct 任意（既定 1）。直す: 3 欄とも必須。
    ほかの欄（通貨など）は unknownField"""
    c = _Checker()
    src = c.obj(body, "", _ACCOUNT_FIELDS)
    if src is None:
        return None, c.issues
    out: dict = {}
    _put(out, "name", c.field(src, "name", "", _name_check(c), required=True))
    if create:
        _put(out, "capitalYen", c.field(src, "capitalYen", "", _capital_check(c)), None)
        _put(out, "riskTolerancePct", c.field(src, "riskTolerancePct", "", _risk_check(c)), DEFAULT_ACCOUNT_RISK_PCT)
    else:
        _put(out, "capitalYen", c.field(src, "capitalYen", "", _capital_check(c), required=True))
        _put(out, "riskTolerancePct", c.field(src, "riskTolerancePct", "", _risk_check(c), required=True))
    if c.issues:
        return None, c.issues
    return out, []
