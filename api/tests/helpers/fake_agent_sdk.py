"""偽の claude_agent_sdk（Issue #11 の読み取りのテスト用。実際の AI は呼ばない）。

``install(monkeypatch)`` で ``sys.modules["claude_agent_sdk"]`` に差し込む（monkeypatch が戻すので漏れない）。
送り口は送る直前にこの process の環境から資格情報の系統の名前を外す（#55）ので、``os.environ`` はテストの間だけ
写しの dict に差し替える（テストの process の環境を変えない）。``query`` は SDK と同じ重ね方で作った子の環境を
``calls[*]["child_env"]`` に記録する。
本物の SDK と同じ名前の部品（``ClaudeAgentOptions``・``HookMatcher``・``create_sdk_mcp_server``・``tool``・
``query``）を持ち、共有の送り口（``statement_read.agent_reader``）の配線（MCP のツール 1 本・PreToolUse の
フック）をそのまま通す。

``query`` は受けた options と最初の user の message を ``calls`` に記録し、``script`` の筋書きで動く:

- ``"tool"``: フックにツールの入力を渡し（本物の CLI と同じ経路）、AssistantMessage と ResultMessage を返す
- ``"text"``: ツールを呼ばずに文章だけ返す
- ``"raise"``: 送り先の失敗（例外。文言に ``raise_text`` を入れる）
- ``"is_error"``: 送り先のエラーの結果
- ``"no_result"``: 結果も例外も無いまま終わる（CLI の異常終了の真似）
- ``"hang"``: 締め切りまで返さない（取り消されたら shield の中で後始末をする。``cleaned`` に記録）

ResultMessage の使用量・合計額は ``result_usage``・``result_cost``（既定は入力 1,500・出力 300・0.01 USD。#44 の精算）。

``write_tmp`` が真なら、CLI の振る舞い（画像を CLAUDE_CODE_TMPDIR・CLAUDE_CONFIG_DIR・HOME・TMPDIR・XDG の置き場所に
書く）を真似る。
"""

import base64
import os
import sys
import types

import anyio
from statement_read.agent_reader import scrub_process_env, spawn_env


class ClaudeAgentOptions:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        for k, v in kwargs.items():
            setattr(self, k, v)


class HookMatcher:
    def __init__(self, matcher=None, hooks=None):
        self.matcher = matcher
        self.hooks = hooks or []


class SdkMcpTool:
    def __init__(self, name, description, input_schema, handler):
        self.name, self.description, self.input_schema, self.handler = name, description, input_schema, handler


def tool(name, description, input_schema):
    def wrap(handler):
        return SdkMcpTool(name, description, input_schema, handler)

    return wrap


def create_sdk_mcp_server(name, version="1.0.0", tools=None):
    return {"type": "sdk", "name": name, "version": version, "tools": list(tools or [])}


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class TextBlock:
    def __init__(self, text):
        self.text = text


class AssistantMessage:
    def __init__(self, content):
        self.content = content


DEFAULT_USAGE = {"input_tokens": 1500, "output_tokens": 300}
DEFAULT_COST = 0.01


class ResultMessage:
    def __init__(self, is_error=False, usage=DEFAULT_USAGE, cost=DEFAULT_COST):
        self.is_error = is_error
        self.usage = usage
        self.duration_api_ms = 1200
        self.total_cost_usd = cost


class FakeSdk(types.ModuleType):
    def __init__(self):
        super().__init__("claude_agent_sdk")
        self.ClaudeAgentOptions = ClaudeAgentOptions
        self.HookMatcher = HookMatcher
        self.create_sdk_mcp_server = create_sdk_mcp_server
        self.tool = tool
        self.calls: list[dict] = []
        self.script = "tool"
        self.tool_input: dict | None = None
        self.raise_text = "upstream failed"
        self.write_tmp = False
        self.cleaned = 0
        # ResultMessage の使用量と合計額（#44 の精算の試験。None = 返さない）
        self.result_usage: dict | None = dict(DEFAULT_USAGE)
        self.result_cost: float | None = DEFAULT_COST
        self.query = self._query

    def _result(self, is_error=False):
        return ResultMessage(is_error=is_error, usage=self.result_usage, cost=self.result_cost)

    async def _query(self, *, prompt, options):
        call = {"options": options, "message": None, "child_env": spawn_env(os.environ, options.env)}
        self.calls.append(call)
        async for m in prompt:  # 最初の user の message を受け取る
            call["message"] = m
            break
        if self.write_tmp:
            self._write_like_cli(options, call["message"])
        if self.script == "raise":
            raise ConnectionError(self.raise_text)
        if self.script == "hang":
            try:
                await anyio.sleep(60)
            finally:
                with anyio.CancelScope(shield=True):  # SDK の後始末の真似（取り消されずに走る）
                    await anyio.sleep(0.01)
                    self.cleaned += 1
        if self.script == "no_result":
            yield AssistantMessage([])
            return
        if self.script == "is_error":
            yield AssistantMessage([])
            yield self._result(is_error=True)
            return
        if self.script == "text":
            yield AssistantMessage([TextBlock("読み取りました。")])
            yield self._result()
            return
        server_name, server = next(iter(options.mcp_servers.items()))
        cli_name = f"mcp__{server_name}__{server['tools'][0].name}"
        hook = options.hooks["PreToolUse"][0].hooks[0]
        await hook({"tool_name": cli_name, "tool_input": self.tool_input}, "toolu_1", None)
        yield AssistantMessage([ToolUseBlock(cli_name, self.tool_input)])
        yield self._result()

    @staticmethod
    def _write_like_cli(options, message):
        data = base64.b64decode(message["message"]["content"][0]["source"]["data"])
        for key in ("CLAUDE_CODE_TMPDIR", "CLAUDE_CONFIG_DIR", "HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
                    "XDG_DATA_HOME", "XDG_STATE_HOME"):
            d = options.env[key]
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "pasted-image.png"), "wb") as f:
                f.write(data)


def install(monkeypatch) -> FakeSdk:
    fake = FakeSdk()
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", fake)
    env = os.environ.copy()
    scrub_process_env(env)  # 入口（create_app）で外した後の状態から（送り口は名前が残っていると送らない）
    monkeypatch.setattr(os, "environ", env)
    return fake
