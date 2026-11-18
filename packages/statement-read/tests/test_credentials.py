"""資格情報の方式（api_key / oauth_token / federation）と、子（CLI）に渡る環境の名前の集合（Issue #55・ADR-0011）。

親の環境（os.environ）に全方式の変数と資格情報・送り先の系統の変数がすべて入った状態から、入口で系統の名前を外して、
送り口の本物の経路（SDK を import する経路。偽の claude_agent_sdk を差し込む）を通し、
SDK と同じ重ね方（spawn_env）で子の環境を作って確かめる。
os.environ はテストの dict に差し替える（テストの process の環境を変えない）。値はすべて架空。実際の AI は呼ばない。
"""

import os
import stat
import sys
import types
from pathlib import Path

import pytest

from statement_read import agent_reader, result

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"  # 架空の JWT の形

# 親の環境: CLI が動くのに要る変数（許可リスト）はすべて値あり
PASS = {name: f"/pass/{name}" for name in agent_reader.PASS_THROUGH_ENV}
# 全方式の資格情報と、資格情報・送り先の系統（どの方式でも子に名前ごと無いはずのもの）
CREDENTIAL_PARENT = {
    "ANTHROPIC_API_KEY": "KEY-A-parent",
    "CLAUDE_CODE_OAUTH_TOKEN": "TOK-O-parent",
    "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_parent",
    "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-00000000000p",
    "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_parent",
    "ANTHROPIC_WORKSPACE_ID": "wrkspc_parent",
    "ANTHROPIC_IDENTITY_TOKEN_FILE": "/parent/token",
    "ANTHROPIC_IDENTITY_TOKEN": "eyJ.parent.sig",
    "ANTHROPIC_AUTH_TOKEN": "AUTH-parent",
    "ANTHROPIC_PROFILE": "parent-profile",
    "ANTHROPIC_CONFIG_DIR": "/parent/anthropic",
    "ANTHROPIC_BASE_URL": "http://elsewhere.example",
    "ANTHROPIC_VERTEX_PROJECT_ID": "parent-vertex",
    "anthropic_api_key": "KEY-lower",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN": "REFRESH-parent",
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLAUDE_CODE_USE_FOUNDRY": "1",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1",
    "CLAUDE_CODE_API_KEY_HELPER_TTL_MS": "1000",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "999999",
    "CLAUDE_CONFIG_DIR": "/parent/claude",
    "CLAUDECODE": "1",
    "AWS_BEARER_TOKEN_BEDROCK": "BEDROCK-parent",
    "AWS_ACCESS_KEY_ID": "AKIA-parent",
    "AWS_REGION": "us-east-1",
    "CLOUD_ML_REGION": "us-east5",
    "VERTEX_REGION_CLAUDE_SONNET": "us-east5",
}
# 系統の外で許可リストに無い変数（子では空にする）
OTHER_PARENT = {
    "GH_TOKEN": "GH-parent",
    "NODE_OPTIONS": "--require /x",
    "GOOGLE_APPLICATION_CREDENTIALS": "/parent/adc.json",
    "GOOGLE_CLOUD_PROJECT": "example-project",
    "STATEMENT_READ_CREDENTIAL": "api_key",
    "LOSS_NOTE_ALLOWED_EMAILS": "someone@example.com",
}
FULL_PARENT = {**PASS, **CREDENTIAL_PARENT, **OTHER_PARENT}

# どの方式でも子に値のある名前（許可リスト + 要求ごとの置き場 + CLI の固定の設定）
COMMON = (
    set(agent_reader.PASS_THROUGH_ENV)
    | {"HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"}
    | {"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR", "CLAUDE_CODE_MAX_RETRIES", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
       "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING", "DISABLE_AUTOUPDATER", "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
       agent_reader.MAX_OUTPUT_ENV}
)
FED_VALUES = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example",
              "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-000000000001"}


class ToolUseBlock:
    def __init__(self, name, input):
        self.name, self.input = name, input


class AssistantMessage:
    def __init__(self, content):
        self.content = content


class ResultMessage:
    def __init__(self):
        self.usage, self.duration_api_ms, self.total_cost_usd, self.is_error = {}, 1000, 0.01, False


def _good_input():
    return {"kind": "statement", "rows": []}


class _Sdk(types.ModuleType):
    """偽の claude_agent_sdk。query は SDK と同じ重ね方で子の環境を作り、起動の時点の一時ディレクトリの中身を記録する"""

    def __init__(self):
        super().__init__("claude_agent_sdk")
        self.ClaudeAgentOptions = lambda **kw: types.SimpleNamespace(**kw)
        self.HookMatcher = lambda matcher=None, hooks=None: types.SimpleNamespace(matcher=matcher, hooks=hooks)
        self.create_sdk_mcp_server = lambda name, version="1.0.0", tools=None: {"name": name}
        self.tool = lambda *a: (lambda h: h)
        self.seen: dict = {}
        self.script = "tool"
        self.query = self._query

    async def _query(self, *, prompt, options):
        child = agent_reader.spawn_env(os.environ, options.env)
        base = Path(options.cwd).parent
        self.seen = {
            "child": child,
            "base": base,
            # 子の起動の時点で、要求ごとの HOME・設定の置き場にあるファイル
            "config_files": sorted(str(p.relative_to(base)) for sub in ("home", "cfg")
                                   for p in (base / sub).rglob("*") if p.is_file()),
            "all_files": sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()),
        }
        token_file = child.get(agent_reader.IDENTITY_TOKEN_FILE_ENV)
        if token_file:
            self.seen["token"] = Path(token_file).read_text(encoding="ascii")
            self.seen["token_mode"] = stat.S_IMODE(os.stat(token_file).st_mode)
        async for _ in prompt:
            break
        if self.script == "raise":
            raise ConnectionError("upstream failed")
        if self.script == "hang":
            import anyio

            await anyio.sleep(30)
        yield AssistantMessage([ToolUseBlock(agent_reader.CLI_TOOL_NAME, _good_input())])
        yield ResultMessage()


@pytest.fixture
def sdk(monkeypatch):
    fake = _Sdk()
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", fake)
    # 親の環境はテストの dict（本物の os.environ を変えない）。全部の変数が入った状態から、プロセスの入口（API の
    # create_app・道具の CLI）と同じく系統の名前を 1 回外す
    parent = dict(FULL_PARENT)
    monkeypatch.setattr(os, "environ", parent)
    agent_reader.scrub_process_env()
    return fake


def _reader(tmp_path, credential, secret, **kw):
    return agent_reader.Reader(credential, secret, "claude-sonnet-5-5", "low", tmp_parent=str(tmp_path / "t"),
                               max_output_tokens=16_000, **kw)


def _valued(env: dict[str, str]) -> set[str]:
    return {k for k, v in env.items() if v}


def _assert_absent_except(child: dict[str, str], keep: set[str]):
    # 資格情報・送り先の系統の名前は、方式の変数（と送り口が決めた CLI の設定）を除いて名前ごと無い
    # （空の文字列でもない）
    for name in CREDENTIAL_PARENT:
        if name in keep or name in COMMON:
            continue
        assert name not in child, name


# ---- AC-1 / 例 E1: api_key ----


def test_api_key_child_env_names(sdk, tmp_path):
    o = _reader(tmp_path, "api_key", "KEY-A").read(PNG, "image/png")
    assert o.error is None
    child = sdk.seen["child"]
    assert _valued(child) == COMMON | {"ANTHROPIC_API_KEY"}
    assert child["ANTHROPIC_API_KEY"] == "KEY-A"
    _assert_absent_except(child, {"ANTHROPIC_API_KEY"})
    for name in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID",
                 "ANTHROPIC_IDENTITY_TOKEN_FILE", "CLAUDE_CODE_USE_BEDROCK"):
        assert name not in child


# ---- AC-2 / 例 E2: oauth_token（親に API キーがあっても子に名前ごと無い） ----


def test_oauth_token_child_env_names(sdk, tmp_path):
    o = _reader(tmp_path, "oauth_token", "TOK-O").read(PNG, "image/png")
    assert o.error is None
    child = sdk.seen["child"]
    assert _valued(child) == COMMON | {"CLAUDE_CODE_OAUTH_TOKEN"}
    assert child["CLAUDE_CODE_OAUTH_TOKEN"] == "TOK-O"
    _assert_absent_except(child, {"CLAUDE_CODE_OAUTH_TOKEN"})
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "anthropic_api_key",
                 "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_IDENTITY_TOKEN"):
        assert name not in child


# ---- AC-3・AC-4 / 例 E3: federation ----


def test_federation_child_env_names_and_token_file(sdk, tmp_path):
    o = _reader(tmp_path, "federation", FED_VALUES, identity_token=TOKEN).read(PNG, "image/png")
    assert o.error is None
    child = sdk.seen["child"]
    assert _valued(child) == COMMON | set(FED_VALUES) | {agent_reader.IDENTITY_TOKEN_FILE_ENV}
    assert {k: child[k] for k in FED_VALUES} == FED_VALUES
    _assert_absent_except(child, set(FED_VALUES) | {agent_reader.IDENTITY_TOKEN_FILE_ENV})
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "CLAUDE_CODE_OAUTH_TOKEN",
                 "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID"):
        assert name not in child
    # ID トークンのファイル: 要求ごとの一時ディレクトリの中・中身が一致・所有者だけ
    token_file = Path(child[agent_reader.IDENTITY_TOKEN_FILE_ENV])
    assert str(token_file).startswith(str(sdk.seen["base"]) + "/")
    assert sdk.seen["token"] == TOKEN and sdk.seen["token_mode"] == 0o600
    # 読み取りの後は無い（一時ディレクトリごと消える）
    assert not token_file.exists() and list((tmp_path / "t").iterdir()) == []


def test_federation_optional_ids_only_when_set(sdk, tmp_path):
    values = {**FED_VALUES, "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_example", "ANTHROPIC_WORKSPACE_ID": "wrkspc_example"}
    o = _reader(tmp_path, "federation", values, identity_token=TOKEN).read(PNG, "image/png")
    assert o.error is None
    assert _valued(sdk.seen["child"]) == COMMON | set(values) | {agent_reader.IDENTITY_TOKEN_FILE_ENV}


@pytest.mark.parametrize("script", ["raise", "hang"])
def test_federation_token_file_removed_after_failure(sdk, tmp_path, script):
    sdk.script = script
    o = _reader(tmp_path, "federation", FED_VALUES, identity_token=TOKEN, timeout=0.05).read(PNG, "image/png")
    assert o.error == ("ConnectionError" if script == "raise" else "timeout")
    assert sdk.seen["token"] == TOKEN
    assert list((tmp_path / "t").iterdir()) == []


def test_federation_without_token_does_not_call(sdk, tmp_path):
    o = _reader(tmp_path, "federation", FED_VALUES, identity_token=None).read(PNG, "image/png")
    assert o.result is None and o.error == "identity_token"
    assert sdk.seen == {}
    assert list((tmp_path / "t").iterdir()) == []


# ---- AC-6: 子の起動の時点で HOME・設定の置き場にファイルが無い（apiKeyHelper・プロファイル・ログインなし） ----


@pytest.mark.parametrize(("credential", "secret", "kw"), [
    ("api_key", "KEY-A", {}),
    ("oauth_token", "TOK-O", {}),
    ("federation", FED_VALUES, {"identity_token": TOKEN}),
])
def test_no_config_files_at_spawn(sdk, tmp_path, credential, secret, kw):
    o = _reader(tmp_path, credential, secret, **kw).read(PNG, "image/png")
    assert o.error is None
    assert sdk.seen["config_files"] == []
    expected = [f"{agent_reader.IDENTITY_TOKEN_SUBDIR}/{agent_reader.IDENTITY_TOKEN_NAME}"] if kw else []
    assert sdk.seen["all_files"] == expected
    # 設定の置き場は要求ごとの一時ディレクトリの中（親の HOME・XDG・CLI の設定・Anthropic の設定の置き場を使わない）
    child = sdk.seen["child"]
    for key in ("HOME", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR"):
        assert child[key].startswith(str(sdk.seen["base"]) + "/")
    assert "ANTHROPIC_CONFIG_DIR" not in child


# ---- 親の環境から系統の名前を外す ----


def test_scrub_process_env_removes_only_credential_names():
    env = dict(FULL_PARENT)
    removed = agent_reader.scrub_process_env(env)
    assert set(removed) == set(CREDENTIAL_PARENT)
    assert set(env) == set(PASS) | set(OTHER_PARENT)
    assert agent_reader.scrub_process_env(env) == []  # 2 回目は何もしない


def test_child_env_rejects_values_of_other_methods():
    with pytest.raises(ValueError):
        agent_reader.child_env("oauth_token", {"ANTHROPIC_API_KEY": "x"}, "/b", parent_env={})
    with pytest.raises(ValueError):
        agent_reader.child_env("federation", {"CLAUDE_CODE_OAUTH_TOKEN": "x"}, "/b", parent_env={})


# ---- 環境 → 方式の変数 ----


def test_credential_values():
    env = {**FULL_PARENT, "ANTHROPIC_SERVICE_ACCOUNT_ID": "", "ANTHROPIC_WORKSPACE_ID": "wrkspc_x"}
    assert agent_reader.credential_values("api_key", env) == {"ANTHROPIC_API_KEY": "KEY-A-parent"}
    assert agent_reader.credential_values("oauth_token", env) == {"CLAUDE_CODE_OAUTH_TOKEN": "TOK-O-parent"}
    assert agent_reader.credential_values("federation", env) == {
        "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_parent",
        "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-00000000000p",
        "ANTHROPIC_WORKSPACE_ID": "wrkspc_x"}
    for bad in ({"ANTHROPIC_ORGANIZATION_ID": "o"}, {"ANTHROPIC_FEDERATION_RULE_ID": "r"},
                {"ANTHROPIC_FEDERATION_RULE_ID": "", "ANTHROPIC_ORGANIZATION_ID": "o"}):
        with pytest.raises(agent_reader.NoCredential):
            agent_reader.credential_values("federation", bad)
    for kind in (None, "", "password"):
        with pytest.raises(agent_reader.NoCredential):
            agent_reader.credential_values(kind, env)


def test_reader_repr_has_no_values():
    r = agent_reader.Reader("federation", FED_VALUES, "m", "low", identity_token=TOKEN)
    assert "fdrl_example" not in repr(r) and TOKEN not in repr(r)


def test_tool_name_shared():
    assert agent_reader.CLI_TOOL_NAME.endswith(result.TOOL_NAME)


# ---- レビューの指摘 1: 送り口は os.environ を書き換えず、系統の名前が残っていれば送らない ----


@pytest.mark.parametrize("leftover", ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_PROFILE",
                                      "CLAUDE_CODE_USE_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK"])
def test_leftover_credential_name_fails_closed(sdk, tmp_path, leftover):
    os.environ[leftover] = "x"
    before = dict(os.environ)
    o = _reader(tmp_path, "oauth_token", "TOK-O").read(PNG, "image/png")
    assert o.result is None and o.error == "credential_env"
    assert sdk.seen == {}  # AI を呼ばない
    assert dict(os.environ) == before  # 書き換えない
    assert list((tmp_path / "t").iterdir()) == []


def test_credential_names_in():
    assert agent_reader.credential_names_in(dict(OTHER_PARENT)) == []
    assert agent_reader.credential_names_in({**OTHER_PARENT, "ANTHROPIC_API_KEY": "x", "CLAUDECODE": "1"}) == [
        "ANTHROPIC_API_KEY", "CLAUDECODE"]
