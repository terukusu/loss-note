"""送り口（agent_reader.Reader）: 締め切り・一時ディレクトリ・失敗の分類（実際の AI・SDK は使わない）"""

import asyncio
import sys
from pathlib import Path

import anyio
import pytest

from statement_read import agent_reader, prompt, result

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def no_sdk(monkeypatch):
    """claude_agent_sdk を import できなくする（import したら ImportError で落ちる）"""
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self, is_error=False):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = {}, 1000, 0.01, is_error


def good_input():
    return {"kind": "statement", "rows": [{
        "symbol": "US30", "side_written": "buy", "side_of": "position", "entry_price": 39012.5,
        "entry_time": "2026-03-04T01:15", "exit_price": 39100.0, "exit_time": "2026-03-04T06:40", "time_zone": "GMT",
        "qty": 0.5, "fees": None, "pnl": 6500, "exit_order_type": "unknown"}]}


def make_reader(query_fn, tmp_path, **kw):
    return agent_reader.Reader("api_key", "SECRET-X", "claude-sonnet-5-5", "low", tmp_parent=str(tmp_path / "t"),
                               query_fn=query_fn, **kw)


def scripted(messages, seen=None):
    async def q(*, prompt, options):
        if seen is not None:
            seen["options"] = options
        async for m in prompt:
            if seen is not None:
                seen["message"] = m
            break
        for m in messages:
            await asyncio.sleep(0)
            yield m

    return q


def test_positional_signature_unchanged():
    # 道具の既存の呼び方（credential, secret, model, effort, tmp_parent=…）のまま。timeout の既定は None
    r = agent_reader.Reader("api_key", "S", "m", "low", None)
    assert r.timeout is None


def test_success_within_timeout(no_sdk, tmp_path):
    seen: dict = {}
    msgs = [AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input())]), ResultMessage()]
    o = make_reader(scripted(msgs, seen), tmp_path, timeout=5).read(PNG, "image/png")
    assert o.error is None and o.result is not None and o.result["rows"][0]["symbol"] == "US30"
    assert seen["options"]["system_prompt"] is prompt.READ_SYSTEM
    content = seen["message"]["message"]["content"]
    assert [c["type"] for c in content] == ["image", "text"] and content[1]["text"] == prompt.READ_USER_TEXT
    assert list((tmp_path / "t").iterdir()) == []


def test_timeout_cancels_and_runs_cleanup(no_sdk, tmp_path):
    state = {"cleaned": False, "tmp_seen": None}

    async def hang(*, prompt, options):
        state["tmp_seen"] = options["env"]["CLAUDE_CODE_TMPDIR"]
        try:
            await anyio.sleep(30)
            yield None  # pragma: no cover
        finally:
            # SDK の後始末の真似: shield の中の await は取り消されずに最後まで走る
            with anyio.CancelScope(shield=True):
                await anyio.sleep(0.01)
                state["cleaned"] = True

    o =make_reader(hang, tmp_path, timeout=0.05).read(PNG, "image/png")
    assert o.result is None and o.error == "timeout"
    assert state["cleaned"] is True
    # 一時ディレクトリは消えている
    assert state["tmp_seen"] is not None and list((tmp_path / "t").iterdir()) == []


def test_no_timeout_when_none(no_sdk, tmp_path):
    async def slow(*, prompt, options):
        await anyio.sleep(0.1)
        yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input())])
        yield ResultMessage()

    o = make_reader(slow, tmp_path, timeout=None).read(PNG, "image/png")
    assert o.error is None and o.result is not None


def test_sdk_missing_is_classified(no_sdk, tmp_path):
    r = agent_reader.Reader("api_key", "S", "m", "low", tmp_parent=str(tmp_path / "t"))
    o = r.read(PNG, "image/png")
    assert o.result is None and o.error == "sdk_missing"
    assert list((tmp_path / "t").iterdir()) == []


def test_result_error_and_no_tool_call(no_sdk, tmp_path):
    o = make_reader(scripted([AssistantMessage([]), ResultMessage(is_error=True)]), tmp_path).read(PNG, "image/png")
    assert o.error == "result_error"
    o = make_reader(scripted([AssistantMessage([]), ResultMessage()]), tmp_path).read(PNG, "image/png")
    assert o.error == "no_tool_call"


def test_bad_result_reason_only(no_sdk, tmp_path):
    bad = good_input()
    bad["rows"][0]["entry_price"] = "39,012.5"
    msgs = [AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, bad)]), ResultMessage()]
    o = make_reader(scripted(msgs), tmp_path).read(PNG, "image/png")
    assert o.result is None and o.error == "bad_result:type"


def test_exception_type_name_only(no_sdk, tmp_path):
    async def boom(*, prompt, options):
        raise ConnectionError("upstream said SECRET-BODY")
        yield  # pragma: no cover

    o = make_reader(boom, tmp_path).read(PNG, "image/png")
    assert o.error == "ConnectionError" and "SECRET" not in repr(o)


def test_tool_name_from_shared_result():
    assert agent_reader.CLI_TOOL_NAME == f"mcp__eval__{result.TOOL_NAME}"


# ---- レビューの指摘 3: 結果も例外も無いまま終わった ----


def test_stream_ended_without_result_is_no_result(no_sdk, tmp_path):
    o = make_reader(scripted([AssistantMessage([])]), tmp_path).read(PNG, "image/png")
    assert o.result is None and o.error == "no_result"
    o = make_reader(scripted([]), tmp_path).read(PNG, "image/png")
    assert o.error == "no_result"


# ---- レビューの指摘 6: 子の書き込み先は実行ごとの一時ディレクトリの中だけ ----


def test_child_home_and_tmp_are_inside_base(no_sdk, tmp_path):
    seen: dict = {}
    written: list[str] = []

    async def q(*, prompt, options):
        seen["options"] = options
        env = options["env"]
        # CLI の真似: HOME・TMPDIR・XDG の置き場所・設定・一時ファイルの場所に書く
        import os

        for key in ("HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
                    "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR"):
            os.makedirs(env[key], exist_ok=True)
            p = os.path.join(env[key], "x")
            with open(p, "wb") as f:
                f.write(b"img")
            written.append(p)
        async for _ in prompt:
            break
        yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, good_input())])
        yield ResultMessage()

    parent = tmp_path / "t"
    o = make_reader(q, tmp_path).read(PNG, "image/png")
    assert o.error is None
    env = seen["options"]["env"]
    base = str(Path(seen["options"]["cwd"]).parent)
    assert base.startswith(str(parent))
    for key in ("HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"):
        assert env[key].startswith(base + "/"), key
    assert all(p.startswith(base + "/") for p in written)
    # 終わったら一緒に消える
    assert list(parent.iterdir()) == []


def test_isolated_env_overrides_parent_home(no_sdk):
    kw = agent_reader.option_kwargs("m", "low", "api_key", "S", "/b")
    assert kw["env"]["HOME"] == "/b/home" and kw["env"]["TMPDIR"] == "/b/tmp"
    assert kw["env"]["CLAUDE_CONFIG_DIR"] == "/b/cfg" and kw["env"]["ANTHROPIC_API_KEY"] == "S"
