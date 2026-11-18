"""本文の検査（純関数。AC-13・D4・C11）。値はすべて架空。"""

import copy
import json

import pytest

from loss_note_api import schema
from loss_note_api.schema import (
    MAX_TIME_MS,
    BodyError,
    parse_json_body,
    validate_account,
    validate_instrument,
    validate_settings,
    validate_trade,
)


def t1() -> dict:
    """T1: L・イン 100.00・LC 99.50・数量 10,000・決済 99.50（理由 LC）・明細 −5,200 円・手数料 200 円"""
    return {
        "status": "closed",
        "source": "manual",
        "instrumentId": "INSTR1",
        "side": "L",
        "lc": 99.5,
        "brokenCondition": "99.50 を割ったら押し目の根拠が崩れる",
        "lcDecidedBeforeEntry": True,
        "lcMove": {"kind": "none"},
        "timeframeChange": "none",
        "entries": [{"price": 100, "quantity": 10000}],
        "exit": {"time": 1_700_000_000_000, "price": 99.5, "reason": "lc"},
        "statementPnlYen": -5200,
        "fees": [{"label": "手数料", "amountYen": 200}],
    }


def kinds(issues):
    return {(i["field"], i["kind"]) for i in issues}


def test_t1_is_valid_and_defaults_are_filled():
    value, issues = validate_trade(t1())
    assert issues == []
    assert value["lcBasis"] == "chart"
    assert value["stopOrderPlaced"] == "unanswered"
    assert value["exit"]["orderType"] == "unknown"
    assert value["exit"]["gapSlip"] == "unanswered"
    assert value["exit"]["reason"] == "lc"
    # 送った値はそのまま（丸めない・型を保つ）
    assert value["entries"] == [{"price": 100, "quantity": 10000}]
    assert type(value["entries"][0]["price"]) is int
    assert value["lc"] == 99.5


def test_defaults_when_omitted():
    body = t1()
    del body["fees"]
    del body["exit"]["reason"]
    value, issues = validate_trade(body)
    assert issues == []
    assert value["fees"] == []
    assert value["exit"]["reason"] == "other"


def test_input_is_not_mutated():
    body = t1()
    before = copy.deepcopy(body)
    validate_trade(body)
    assert body == before


def mutate(path, value):
    """道筋（"a.b" / "entries.0.price"）の値を置き換えた T1。value が DELETE なら消す"""
    body = t1()
    keys = path.split(".")
    cur = body
    for k in keys[:-1]:
        cur = cur[int(k)] if isinstance(cur, list) else cur[k]
    last = keys[-1]
    if value is DELETE:
        del cur[last]
    elif isinstance(cur, list):
        cur[int(last)] = value
    else:
        cur[last] = value
    return body


DELETE = object()

INVALID = [
    # E14: LC の向き（C11）
    ("lc", 100.2, ("entries[0].lc", "lcDirection")),
    ("lc", 100, ("entries[0].lc", "lcDirection")),
    # E15: 時間足を変えたか が無い（C17）
    ("timeframeChange", DELETE, ("timeframeChange", "required")),
    # E16: 知らない項目・列挙外・数でない
    ("uid", "someone", ("", "unknownField")),
    ("exit.reason", "panic", ("exit.reason", "enum")),
    ("exit.price", True, ("exit.price", "type")),
    ("entries.0.quantity", "10000", ("entries[0].quantity", "type")),
    ("entries.0.quantity", 0, ("entries[0].quantity", "range")),
    ("entries.0.quantity", -1, ("entries[0].quantity", "range")),
    ("entries.0.price", float("inf"), ("entries[0].price", "range")),
    ("entries.0.price", 1e13, ("entries[0].price", "range")),
    ("entries.0.extra", 1, ("entries[0]", "unknownField")),
    ("exit.secret", 1, ("exit", "unknownField")),
    # E17: 決済済み以外
    ("status", "planned", ("status", "unsupported")),
    ("status", "open", ("status", "unsupported")),
    ("status", "skipped", ("status", "unsupported")),
    ("status", "draft", ("status", "enum")),
    # 必須
    ("side", DELETE, ("side", "required")),
    ("lcDecidedBeforeEntry", DELETE, ("lcDecidedBeforeEntry", "required")),
    ("lcDecidedBeforeEntry", 1, ("lcDecidedBeforeEntry", "type")),
    ("lcMove", DELETE, ("lcMove", "required")),
    ("entries", [], ("entries", "count")),
    ("exit", DELETE, ("exit", "required")),
    ("exit.time", DELETE, ("exit.time", "required")),
    ("instrumentId", DELETE, ("instrumentId", "required")),
    ("instrumentId", "../x", ("instrumentId", "format")),
    ("source", DELETE, ("source", "required")),
    # 時点
    ("exit.time", 1.5, ("exit.time", "type")),
    ("exit.time", -1, ("exit.time", "range")),
    ("exit.time", MAX_TIME_MS + 1, ("exit.time", "range")),
    # 列挙
    ("side", "B", ("side", "enum")),
    ("timeframe", "2h", ("timeframe", "enum")),
    ("lcMove", {"kind": "moved"}, ("lcMove.kind", "enum")),
    ("lcMove", {"kind": "none", "after": 99}, ("lcMove", "unknownField")),
    ("optionType", "X", ("optionType", "enum")),
    ("exit.gapSlip", "maybe", ("exit.gapSlip", "enum")),
    ("stopOrderPlaced", "yes", ("stopOrderPlaced", "enum")),
    # 正の数の欄
    ("planFxRate", 0, ("planFxRate", "range")),
    ("strike", -5, ("strike", "range")),
    ("exit.fxRate", 0, ("exit.fxRate", "range")),
    # null は受けない（省く）
    ("lc", None, ("lc", "type")),
    # 文字列
    ("brokenCondition", "あ" * 201, ("brokenCondition", "length")),
    ("brokenCondition", "改行\nあり", ("brokenCondition", "control")),
    ("thesis", "x" * 2001, ("thesis", "length")),
    ("entryEmotion", "x" * 501, ("entryEmotion", "length")),
    ("exit.emotion", "x" * 501, ("exit.emotion", "length")),
    ("exit.review", "x" * 2001, ("exit.review", "length")),
    ("contractMonth", "x" * 17, ("contractMonth", "length")),
    ("thesis", "nul\x00", ("thesis", "control")),
    ("thesis", "\ud800", ("thesis", "control")),
    ("thesis", 5, ("thesis", "type")),
    # Cf（書式文字）: 双方向の上書き・ゼロ幅文字。長い文章の欄でも拒む
    ("brokenCondition", "99.50\u202eを割ったら", ("brokenCondition", "control")),
    ("thesis", "根拠\u200b", ("thesis", "control")),
    ("exit.review", "\u2066総評\u2069", ("exit.review", "control")),
    ("contractMonth", "2026\ufeff12", ("contractMonth", "control")),
    ("fees", [{"label": "x" * 41, "amountYen": 1}], ("fees[0].label", "length")),
    ("fees", [{"amountYen": 1}] * 21, ("fees", "count")),
    ("fees", [{"label": "x"}], ("fees[0].amountYen", "required")),
    ("fees", {"amountYen": 1}, ("fees", "type")),
    ("entries", [{"price": 100, "quantity": 1}] * 21, ("entries", "count")),
    ("entries", "x", ("entries", "type")),
    ("exit", [], ("exit", "type")),
]


@pytest.mark.parametrize(("path", "value", "expected"), INVALID, ids=[f"{p}={v!r:.20}" for p, v, _ in INVALID])
def test_invalid(path, value, expected):
    value_, issues = validate_trade(mutate(path, value))
    assert value_ is None
    assert expected in kinds(issues), issues


def test_multiline_fields_keep_newline_and_tab():
    body = t1()
    body["thesis"] = "1 行目\n2 行目\r\n\tタブ"
    body["exit"]["emotion"] = "悔しい\n次は守る"
    value, issues = validate_trade(body)
    assert issues == []
    assert value["thesis"] == "1 行目\n2 行目\r\n\tタブ"


def test_widened_after_must_be_on_unfavorable_side():
    body = t1()
    body["lcMove"] = {"kind": "widened", "after": 99.8}
    _, issues = validate_trade(body)
    assert ("lcMove.after", "lcMoveDirection") in kinds(issues)
    body["lcMove"] = {"kind": "widened", "after": 99.2}
    assert validate_trade(body)[1] == []
    body["lcMove"] = {"kind": "widened"}
    assert validate_trade(body)[1] == []


def test_short_lc_direction():
    body = t1()
    body["side"] = "S"
    body["lc"] = 100.5
    body["exit"]["price"] = 99
    assert validate_trade(body)[1] == []
    body["lc"] = 99.5
    assert ("entries[0].lc", "lcDirection") in kinds(validate_trade(body)[1])
    body["lc"] = 100.5
    body["lcMove"] = {"kind": "widened", "after": 100.2}
    assert ("lcMove.after", "lcMoveDirection") in kinds(validate_trade(body)[1])


def test_entry_lc_overrides_trade_lc():
    body = t1()
    body["entries"] = [{"price": 100, "quantity": 1, "lc": 99.5}, {"price": 99.8, "quantity": 1, "lc": 99.9}]
    assert ("entries[1].lc", "lcDirection") in kinds(validate_trade(body)[1])


def test_no_lc_is_allowed():
    body = t1()
    del body["lc"]
    assert validate_trade(body)[1] == []


def test_issues_never_contain_values_or_unknown_names():
    body = t1()
    body["secretFieldName"] = "MARKER-123"
    body["lc"] = 100.2
    body["exit"]["reason"] = "MARKER-456"
    _, issues = validate_trade(body)
    text = json.dumps(issues)
    assert "MARKER" not in text and "secretFieldName" not in text and "100.2" not in text


def test_body_must_be_object():
    for body in ([], "x", 1, None):
        value, issues = validate_trade(body)
        assert value is None and kinds(issues) == {("", "type")}


# ── 銘柄 ──────────────────────────────────────
def test_instrument_defaults():
    value, issues = validate_instrument({"name": "  US30 "})
    assert issues == []
    assert value == {
        "name": "US30",
        "underlyingKind": "other",
        "productForm": "spotCfd",
        "priceCurrency": None,
        "multiplier": 1,
        "quantityStep": 1,
    }


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({}, ("name", "required")),
        ({"name": "   "}, ("name", "length")),
        ({"name": "x" * 41}, ("name", "length")),
        ({"name": "a\tb"}, ("name", "control")),
        ({"name": "US30\u200b"}, ("name", "control")),
        ({"name": "\u202eUS30"}, ("name", "control")),
        ({"name": "US30", "underlying": "x\u2060y"}, ("underlying", "control")),
        ({"name": "US30", "multiplier": 0}, ("multiplier", "range")),
        ({"name": "US30", "quantityStep": -0.1}, ("quantityStep", "range")),
        ({"name": "US30", "priceCurrency": "usd"}, ("priceCurrency", "format")),
        ({"name": "US30", "priceCurrency": "USDX"}, ("priceCurrency", "format")),
        ({"name": "US30", "underlyingKind": "bond"}, ("underlyingKind", "enum")),
        ({"name": "US30", "productForm": "swap"}, ("productForm", "enum")),
        ({"name": "US30", "underlying": "x" * 41}, ("underlying", "length")),
        ({"name": "US30", "id": "x"}, ("", "unknownField")),
    ],
)
def test_instrument_invalid(body, expected):
    value, issues = validate_instrument(body)
    assert value is None
    assert expected in kinds(issues)


def test_name_key_normalizes():
    assert schema.name_key(" US30 ") == schema.name_key("us30") == schema.name_key("ＵＳ３０")


# ── 設定 ──────────────────────────────────────
def test_settings_valid():
    body = {"capitalYen": 1_000_000, "riskTolerancePct": 1, "performanceUnit": "R"}
    assert validate_settings(body) == (body, [])
    body = {"capitalYen": None, "riskTolerancePct": 0.5, "performanceUnit": "yen"}
    assert validate_settings(body) == (body, [])


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"riskTolerancePct": 1, "performanceUnit": "R"}, ("capitalYen", "required")),
        ({"capitalYen": 0, "riskTolerancePct": 1, "performanceUnit": "R"}, ("capitalYen", "range")),
        ({"capitalYen": 1, "riskTolerancePct": 0.4, "performanceUnit": "R"}, ("riskTolerancePct", "range")),
        ({"capitalYen": 1, "riskTolerancePct": 3.1, "performanceUnit": "R"}, ("riskTolerancePct", "range")),
        ({"capitalYen": 1, "riskTolerancePct": 1, "performanceUnit": "pips"}, ("performanceUnit", "enum")),
        ({"capitalYen": 1, "riskTolerancePct": 1, "performanceUnit": "R", "theme": "dark"}, ("", "unknownField")),
    ],
)
def test_settings_invalid(body, expected):
    value, issues = validate_settings(body)
    assert value is None
    assert expected in kinds(issues)


# ── 口座（#47 PR-1）─────────────────────────────


def test_trade_account_id_is_optional_and_checked():
    value, issues = validate_trade({**t1(), "accountId": "accA1"})
    assert issues == [] and value["accountId"] == "accA1"
    value, _ = validate_trade(t1())
    assert "accountId" not in value
    for bad in ("a/b", "", "x" * 41, 7, None):
        value, issues = validate_trade({**t1(), "accountId": bad})
        assert value is None and ("accountId", "format") in kinds(issues), bad


def test_account_create_defaults():
    assert validate_account({"name": " 口座 A "}, create=True) == (
        {"name": "口座 A", "capitalYen": None, "riskTolerancePct": 1}, [])  # fmt: skip
    body = {"name": "口座 B", "capitalYen": 200_000, "riskTolerancePct": 2.5}
    assert validate_account(body, create=True) == (body, [])


def test_account_update_requires_all():
    value, issues = validate_account({"name": "口座 A"}, create=False)
    assert value is None
    assert kinds(issues) == {("capitalYen", "required"), ("riskTolerancePct", "required")}
    body = {"name": "口座 A", "capitalYen": None, "riskTolerancePct": 0.5}
    assert validate_account(body, create=False) == (body, [])


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"name": "口座", "currency": "USD"}, ("", "unknownField")),
        ({"name": "x" * 41}, ("name", "length")),
        ({"name": "  "}, ("name", "length")),
        ({"name": "口座\u202e"}, ("name", "control")),
        ({"name": "口座", "riskTolerancePct": 3.5}, ("riskTolerancePct", "range")),
        ({"name": "口座", "riskTolerancePct": 0.4}, ("riskTolerancePct", "range")),
        ({"name": "口座", "capitalYen": -1}, ("capitalYen", "range")),
        ({"name": "口座", "capitalYen": True}, ("capitalYen", "type")),
        ([], ("", "type")),
    ],
)
def test_account_invalid(body, expected):
    value, issues = validate_account(body, create=True)
    assert value is None
    assert expected in kinds(issues)
    assert "USD" not in json.dumps(issues)


# ── 本文の読み取り ─────────────────────────────
def test_parse_json_body_ok():
    assert parse_json_body(b'{"a": 1.5, "b": "x"}', "application/json") == {"a": 1.5, "b": "x"}
    assert parse_json_body(b'{"a": 1}', "application/json; charset=utf-8") == {"a": 1}


@pytest.mark.parametrize(
    ("raw", "ctype"),
    [
        (b'{"a": NaN}', "application/json"),
        (b'{"a": Infinity}', "application/json"),
        (b'{"a": -Infinity}', "application/json"),
        (b'{"a": 1}', "text/plain"),
        (b'{"a": 1}', None),
        (b"not json", "application/json"),
        (b"\xff\xfe", "application/json"),
        (b"[" * 100_000, "application/json"),
        (b"", "application/json"),
    ],
)
def test_parse_json_body_rejects(raw, ctype):
    with pytest.raises(BodyError):
        parse_json_body(raw, ctype)


def test_huge_exponent_becomes_out_of_range():
    body = parse_json_body(json.dumps(t1()).replace('"price": 100', '"price": 1e400').encode(), "application/json")
    _, issues = validate_trade(body)
    assert ("entries[0].price", "range") in kinds(issues)


def test_zwj_emoji_is_accepted_but_bidi_is_rejected():
    """ZWJ（U+200D）で組む絵文字は受け、双方向の制御・見えない文字は拒む"""
    family = "\U0001f468\u200d\U0001f469\u200d\U0001f467"
    body = t1()
    body["entryEmotion"] = f"焦り{family}"
    body["brokenCondition"] = f"崩れ{family}"
    value, issues = validate_trade(body)
    assert issues == [] and value["entryEmotion"] == f"焦り{family}"
    for ch in ("\u202a", "\u202e", "\u2066", "\u2069", "\u200e", "\u200f", "\u061c", "\u200b", "\u200c",
               "\u2060", "\ufeff"):  # fmt: skip
        body = t1()
        body["entryEmotion"] = f"焦り{ch}"
        assert ("entryEmotion", "control") in kinds(validate_trade(body)[1]), hex(ord(ch))
