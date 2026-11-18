"""チャートの時間足の表示の読み取り（Issue #27）: 表記の直し（AC-1）・結果の検査（AC-3 の形）・読み取りの種類の配線。
表記はすべて架空の例（実物のチャートを写していない）。実際の AI は呼ばない"""

import asyncio
import json
import random
import sys

import pytest

from statement_read import agent_reader, chart_timeframe, pricing, prompt, result
from statement_read.chart_timeframe import CHART_TASK, TIMEFRAMES, check_result, normalize_chart, timeframe_of
from statement_read.task import STATEMENT_TASK

# ---- AC-1: 表記の例 N1〜N9（Issue #27「ルールと例」の表） ----

EXAMPLES = {
    "N1": (["4H", "4h", "H4", "240", "4時間足", "４Ｈ"], "4h"),
    "N2": (["D", "1D", "D1", "日足", "Daily"], "1d"),
    "N3": (["60", "1H", "H1", "1時間足"], "1h"),
    "N4": (["1m", "M1", "1", "1分足"], "1m"),
    "N5": (["15m", "M15", "15", "15分足", "15M"], "15m"),
    "N6": (["W", "1W", "W1", "週足", "Weekly"], "1w"),
    "N7": (["M", "MN", "MN1", "月足", "Monthly"], "1M"),
    "N8": (["1M"], None),
    "N9": (["2H", "3m", "120", "12時間足", "2D"], None),
}


@pytest.mark.parametrize("no", list(EXAMPLES))
def test_examples_n1_to_n9(no):
    written, want = EXAMPLES[no]
    assert [timeframe_of(w) for w in written] == [want] * len(written)


@pytest.mark.parametrize(
    "written,want",
    [
        ("4 hours", "4h"), ("1 hour", "1h"), ("15min", "15m"), ("30 minutes", "30m"), ("1 day", "1d"),
        ("1 week", "1w"), ("1 month", "1M"), ("5分", "5m"), ("240分足", "4h"), ("60分足", "1h"), ("4時間", "4h"),
        ("1日足", "1d"), ("1ヶ月足", "1M"), ("1か月足", "1M"), ("1カ月足", "1M"), ("1週足", "1w"),
        ("M5", "5m"), ("M30", "30m"),
        ("30M", "30m"), ("5M", "5m"), ("h4", "4h"), ("１Ｄ", "1d"), (" 4H ", "4h"), ("1d", "1d"), ("1w", "1w"),
    ],
)
def test_more_written_forms(written, want):
    assert timeframe_of(written) == want


@pytest.mark.parametrize(
    "written",
    [None, "", " ", "　", "H", "m", "0", "00", "04H", "3M", "6M", "12M", "2W", "2時間足", "3日", "45", "1Y", "Y",
     "tick", "4HH",
     "日", "月", "週", "1日", "1月", "12月", "3日", "1ヶ月", "1週",
     "12345", "D2", "W2", "MN2", "H2", "M2", "4時間足足", 4, ["4H"]],
)
def test_unreadable_is_none(written):
    # 2 通りに読める・列挙に無い・形の外は空（読み違えるより空）
    assert timeframe_of(written) is None


def test_result_is_always_in_enum_or_none():
    # 性質: どんな表記でも列挙の外の値を作らない（種つきの乱数）
    rng = random.Random(27)
    alphabet = "0123456789MmHhDdWwN分時間足日週月ヶか 　"
    for _ in range(5000):
        s = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 6)))
        assert timeframe_of(s) in (*TIMEFRAMES, None)


def test_enum_matches_records():
    # 記録の時間足の列挙（API の schema.TIMEFRAMES・core/trade.ts と同じ 9 つ）
    assert TIMEFRAMES == ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M")


# ---- 結果の検査（AC-3 の形の外） ----


def test_check_result_ok():
    assert check_result({"kind": "chart", "timeframe_written": "4H"}) == {"kind": "chart", "timeframe_written": "4H"}
    assert check_result({"kind": "chart", "timeframe_written": None}) == {"kind": "chart", "timeframe_written": None}


def test_check_result_drops_written_for_not_chart():
    assert check_result({"kind": "not_chart", "timeframe_written": "4H"}) == {"kind": "not_chart",
                                                                            "timeframe_written": None}


@pytest.mark.parametrize(
    "bad,reason",
    [
        ("not a dict", "type"),
        ({"kind": "chart", "timeframe_written": "4H", "price": 1}, "unknown_key"),
        ({"kind": "statement", "timeframe_written": None}, "enum"),
        ({"timeframe_written": None}, "enum"),
        ({"kind": "chart", "timeframe_written": "4" * 17}, "format"),
        ({"kind": "chart", "timeframe_written": "1234-5678@x"}, "format"),
        ({"kind": "chart", "timeframe_written": "口座 12345678"}, "format"),
        ({"kind": "chart", "timeframe_written": "4H\n"}, "format"),
        ({"kind": "chart", "timeframe_written": "   "}, "format"),
        ({"kind": "chart", "timeframe_written": ""}, "format"),
        ({"kind": "chart", "timeframe_written": 4}, "type"),
    ],
)
def test_check_result_rejects_whole(bad, reason):
    with pytest.raises(result.Bad) as e:
        check_result(bad)
    assert e.value.reason == reason
    # 例外の文言に値を入れない
    assert "1234" not in str(e.value) and "口座" not in str(e.value)


def test_normalize_chart_returns_only_kind_and_enum():
    assert normalize_chart({"kind": "chart", "timeframe_written": "240"}) == {"kind": "chart", "timeframe": "4h"}
    assert normalize_chart({"kind": "chart", "timeframe_written": "1M"}) == {"kind": "chart", "timeframe": None}
    assert normalize_chart({"kind": "not_chart", "timeframe_written": None}) == {"kind": "not_chart",
                                                                                "timeframe": None}


def test_schema_matches_checker():
    s = chart_timeframe.TOOL_INPUT_SCHEMA
    assert set(s["properties"]) == {"kind", "timeframe_written"} and s["additionalProperties"] is False
    assert s["properties"]["timeframe_written"]["maxLength"] == chart_timeframe.MAX_WRITTEN_LEN
    assert s["properties"]["kind"]["enum"] == list(chart_timeframe.KINDS)
    json.dumps(s)


# ---- 読み取りの種類（送り口への差し込み） ----


def test_statement_task_is_the_default():
    assert STATEMENT_TASK.system is prompt.READ_SYSTEM and STATEMENT_TASK.check is result.check_result
    r = agent_reader.Reader("api_key", "S", "m", "low", None)
    assert r.task is STATEMENT_TASK
    # 料金の上界の数え方は明細の pricing と同じ
    assert STATEMENT_TASK.prompt_bytes() == pricing.prompt_bytes()


def test_chart_prompt_is_not_longer_than_statement():
    # チャートの読み取りは明細と同じ予約額で予約する（上界であるために、指示・ツールの定義が明細より長くない）
    assert CHART_TASK.prompt_bytes() <= STATEMENT_TASK.prompt_bytes()


def test_dates_are_not_timeframes():
    # N7: 日付の文字（「1日」「1月」）は日足・月足と読まない。指示も日付を返さないよう求める
    assert [timeframe_of(w) for w in ("1日", "1月", "12月", "日", "月")] == [None] * 5
    assert "日付" in chart_timeframe.CHART_SYSTEM


def test_chart_reserve_is_less_than_half_of_statement():
    # B1: チャートは結果が小さいので最大出力を小さくし、予約額を種類ごとに出す（明細と同時に通る）
    from statement_read import app_settings

    chart = pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_CHART_MAX_OUTPUT_TOKENS, CHART_TASK)
    statement = pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS)
    assert statement == pricing.reserve_micro_usd(app_settings.APP_MODEL, app_settings.APP_MAX_OUTPUT_TOKENS,
                                                  STATEMENT_TASK)
    assert chart * 2 < statement
    # 結果の最も長い形（表記 16 文字の漢字）の JSON は最大出力よりずっと小さい
    longest = json.dumps({"kind": "not_chart", "timeframe_written": "時" * 16}, ensure_ascii=False)
    assert len(longest.encode("utf-8")) * 10 < app_settings.APP_CHART_MAX_OUTPUT_TOKENS


def test_chart_prompt_does_not_ask_prices():
    # K11: 価格・エントリーポイントは読まない（指示が返さないものに挙げる）
    assert "価格" in chart_timeframe.CHART_SYSTEM.split("# 返さないもの")[1]


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = {}, 900, 0.002, False


def test_reader_with_chart_task(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    seen: dict = {}

    async def q(*, prompt, options):
        seen["options"] = options
        async for m in prompt:
            seen["message"] = m
            break
        name = agent_reader.cli_tool_name(CHART_TASK)
        tool = ToolUseBlock(name, {"kind": "chart", "timeframe_written": "H4"})
        for m in (AssistantMessage([tool]), ResultMessage()):
            await asyncio.sleep(0)
            yield m

    r = agent_reader.Reader("api_key", "SECRET-X", "claude-sonnet-5-5", "low", tmp_parent=str(tmp_path / "t"),
                            query_fn=q, timeout=5, task=CHART_TASK)
    o = r.read(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png")
    assert o.error is None and o.result == {"kind": "chart", "timeframe_written": "H4"}
    assert seen["options"]["system_prompt"] is chart_timeframe.CHART_SYSTEM
    content = seen["message"]["message"]["content"]
    assert content[1]["text"] == chart_timeframe.CHART_USER_TEXT
    assert list((tmp_path / "t").iterdir()) == []


def test_reader_with_chart_task_bad_result(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)

    async def q(*, prompt, options):
        async for _ in prompt:
            break
        name = agent_reader.cli_tool_name(CHART_TASK)
        yield AssistantMessage([ToolUseBlock(name, {"kind": "chart", "timeframe_written": "口座@1"})])
        yield ResultMessage()

    r = agent_reader.Reader("api_key", "S", "m", "low", tmp_parent=str(tmp_path / "t"), query_fn=q, task=CHART_TASK)
    o = r.read(b"\x89PNG\r\n\x1a\n", "image/png")
    assert o.result is None and o.error == "bad_result:format"


def test_cli_tool_name_per_task():
    assert agent_reader.cli_tool_name(STATEMENT_TASK) == agent_reader.CLI_TOOL_NAME
    assert agent_reader.cli_tool_name(CHART_TASK) == f"mcp__{agent_reader.SERVER}__report_chart_timeframe"
