"""AI の呼び出しの周り（実際の AI は呼ばない。SDK も import しない）"""

import asyncio
import io
import sys
from pathlib import Path

import pytest

from statement_eval import prompt, reader, schema
from statement_eval.cli import main

SYNTHETIC_PNG = (Path(__file__).resolve().parents[1] / "synthetic" / "s01.png").read_bytes()


@pytest.fixture
def no_sdk(monkeypatch):
    """claude_agent_sdk を import できなくする（import したら ImportError で落ちる）"""
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)


@pytest.mark.parametrize(
    "argv",
    [
        ["eval", "--set", "synthetic"],
        ["eval", "--set", "synthetic", "--credential", "api_key"],
        ["eval", "--set", "synthetic", "--credential", "oauth_token"],
    ],
)
def test_no_credentials_stops_without_calling(no_sdk, argv):
    out = io.StringIO()
    called = []
    code = main(argv, env={}, reader_factory=lambda *a: called.append(a), out=out, err=io.StringIO())
    assert code == 2
    assert called == []
    assert "資格情報がありません" in out.getvalue() and "AI は呼んでいません" in out.getvalue()


def test_other_credential_does_not_count(no_sdk):
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--credential", "api_key"], env={"CLAUDE_CODE_OAUTH_TOKEN": "x"},
                out=out, err=io.StringIO())
    assert code == 2


@pytest.mark.parametrize("d", ["/tmp", "tools/statement-eval/synthetic", "data/local/../../x"])
def test_real_dir_must_be_under_data_local(d):
    out = io.StringIO()
    code = main(["eval", "--set", "real", "--dir", d, "--credential", "api_key"], env={"ANTHROPIC_API_KEY": "k"},
                reader_factory=lambda *a: pytest.fail("called"), out=out, err=io.StringIO())
    assert code == 2 and "data/local/" in out.getvalue()


def test_json_out_must_be_local_or_tmp():
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--credential", "api_key", "--json-out", "docs/x.json"],
                env={"ANTHROPIC_API_KEY": "k"}, reader_factory=lambda *a: pytest.fail("called"), out=out,
                err=io.StringIO())
    assert code == 2


def test_bad_model_name_rejected():
    out = io.StringIO()
    code = main(["eval", "--set", "synthetic", "--credential", "api_key", "--model", "x; rm"],
                env={"ANTHROPIC_API_KEY": "k"}, reader_factory=lambda *a: pytest.fail("called"), out=out,
                err=io.StringIO())
    assert code == 2


def test_child_env_keeps_only_selected_credential():
    parent = {"PATH": "/bin", "HOME": "/h", "LANG": "ja_JP.UTF-8", "ANTHROPIC_AUTH_TOKEN": "T",
              "OTHER_SERVICE_TOKEN": "X", "ANTHROPIC_BASE_URL": "http://elsewhere"}
    # 資格情報・送り先の系統は選んだ方式の変数だけ。ほかは空にせず名前ごと置かない（親からは送る直前に外す。#55）
    scrubbed = dict(parent)
    reader.scrub_process_env(scrubbed)
    env = reader.child_env("api_key", "SECRET-A", "/base", parent_env=parent)
    child = reader.spawn_env(scrubbed, env)
    assert child["ANTHROPIC_API_KEY"] == "SECRET-A"
    for k in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
        assert k not in child
    assert env["CLAUDE_CONFIG_DIR"] == "/base/cfg" and env["CLAUDE_CODE_TMPDIR"] == "/base/tmp"
    assert env["CLAUDE_CODE_MAX_RETRIES"] == "0"
    child2 = reader.spawn_env(scrubbed, reader.child_env("oauth_token", "SECRET-O", "/base", parent_env=parent))
    assert child2["CLAUDE_CODE_OAUTH_TOKEN"] == "SECRET-O" and "ANTHROPIC_API_KEY" not in child2


def test_child_env_is_allowlist():
    # 許可リストに無い親の変数は空で上書き（SDK は親の環境に重ねて子を起動する）、許可リストの変数は上書きしない
    parent = {"PATH": "/bin", "HOME": "/h", "LANG": "C.UTF-8", "TMPDIR": "/t", "OTHER_SERVICE_TOKEN": "X",
              "GH_TOKEN": "Y", "AWS_SECRET_ACCESS_KEY": "Z", "NODE_OPTIONS": "--require x"}
    env = reader.child_env("api_key", "S", "/b", parent_env=parent)
    scrubbed = dict(parent)
    reader.scrub_process_env(scrubbed)  # AWS_* は資格情報の系統（名前ごと外す。#55）
    merged = reader.spawn_env(scrubbed, env)
    for k in ("OTHER_SERVICE_TOKEN", "GH_TOKEN", "NODE_OPTIONS"):
        assert merged[k] == ""
    assert "AWS_SECRET_ACCESS_KEY" not in merged
    for k in ("PATH", "HOME", "LANG", "TMPDIR"):
        assert k not in env and merged[k] == parent[k]
    assert {k for k, v in merged.items() if v} <= set(reader.PASS_THROUGH_ENV) | {
        "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR", "CLAUDE_CODE_MAX_RETRIES",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING",
        "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_AUTO_MEMORY"}


def test_option_kwargs_fixed_values():
    kw = reader.option_kwargs("claude-sonnet-5-5", "low", "api_key", "S", "/b")
    assert kw["tools"] == [] and kw["setting_sources"] == [] and kw["strict_mcp_config"] is True
    assert kw["max_turns"] == 1 and kw["model"] == "claude-sonnet-5-5" and kw["effort"] == "low"
    assert kw["system_prompt"] == prompt.READ_SYSTEM and kw["cwd"] == "/b/cwd"


def test_prompt_explains_both_side_forms():
    # 形 1 の「売約定 / 買約定」は建玉そのものの向き、形 2 の「決済売 / 決済買」は決済の向き
    p = prompt.READ_SYSTEM
    assert "売約定" in p and "建玉そのものの向き" in p and 'side_of = "position"' in p
    assert "決済売" in p and 'side_of = "close"' in p


# ---- 偽の query_fn（claude_agent_sdk.query と同じ形） ----


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self, usage, duration_api_ms=2100, total_cost_usd=0.01, is_error=False):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = (
            usage, duration_api_ms, total_cost_usd, is_error)


def _good_input():
    return {"kind": "statement", "rows": [{
        "symbol": "JP225", "side_written": "buy", "side_of": "position", "entry_price": 38250,
        "entry_time": "2026-03-04T01:15", "exit_price": 38610, "exit_time": "2026-03-04T06:40", "time_zone": "GMT",
        "qty": 10, "fees": None, "pnl_jpy": 3600, "exit_order_type": "unknown"}]}


def _fake_query(messages, seen: dict):
    async def q(*, prompt, options):
        seen["options"] = options
        async for m in prompt:  # 最初の user の message を受け取る
            seen["message"] = m
            break
        for m in messages:
            await asyncio.sleep(0)
            yield m

    return q


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        self.t += 3.25
        return self.t


def _reader(messages, seen, tmp_path):
    return reader.Reader("api_key", "SECRET-X", "claude-opus-5-5", "low", tmp_parent=str(tmp_path / "t"),
                         query_fn=_fake_query(messages, seen), clock=Clock())


def test_reader_reads_tool_input(no_sdk, tmp_path):
    seen: dict = {}
    usage = {"input_tokens": 1500, "output_tokens": 300, "cache_read_input_tokens": 0,
             "cache_creation_input_tokens": 0}
    msgs = [AssistantMessage([ToolUseBlock(reader.CLI_TOOL_NAME, _good_input())]), ResultMessage(usage)]
    o = _reader(msgs, seen, tmp_path).read(SYNTHETIC_PNG, "image/png")
    assert o.error is None and o.result is not None and o.result["rows"][0]["side_of"] == "position"
    assert o.seconds == pytest.approx(3.25) and o.api_seconds == pytest.approx(2.1)
    assert o.usage.input_tokens == 1500 and o.tool_calls == 1
    content = seen["message"]["message"]["content"]
    assert content[0]["type"] == "image" and content[0]["source"]["media_type"] == "image/png"
    assert seen["options"]["env"]["ANTHROPIC_API_KEY"] == "SECRET-X"
    # 一時ディレクトリは消えている
    assert list((tmp_path / "t").iterdir()) == []


def test_reader_no_tool_call_is_failure(no_sdk, tmp_path):
    o = _reader([AssistantMessage([]), ResultMessage({})], {}, tmp_path).read(SYNTHETIC_PNG, "image/png")
    assert o.result is None and o.error == "no_tool_call"


def test_reader_bad_result_is_failure(no_sdk, tmp_path):
    bad = _good_input()
    bad["rows"][0]["account_number"] = "x"
    msgs = [AssistantMessage([ToolUseBlock(reader.CLI_TOOL_NAME, bad)]), ResultMessage({})]
    o = _reader(msgs, {}, tmp_path).read(SYNTHETIC_PNG, "image/png")
    assert o.result is None and o.error == "bad_result:unknown_key"


def test_reader_exception_reports_type_only(no_sdk, tmp_path):
    async def boom(*, prompt, options):
        raise RuntimeError("body with secret")
        yield  # pragma: no cover

    r = reader.Reader("api_key", "SECRET-X", "m", "low", tmp_parent=str(tmp_path / "t"), query_fn=boom)
    o = r.read(SYNTHETIC_PNG, "image/png")
    assert o.result is None and o.error == "RuntimeError"


def test_reader_repr_hides_secret():
    r = reader.Reader("api_key", "SECRET-X", "m", "low")
    assert "SECRET-X" not in repr(r)


def test_tool_name_matches_schema():
    assert reader.CLI_TOOL_NAME.endswith(schema.TOOL_NAME)
