"""本物の claude_agent_sdk を通して、子（同梱の CLI）に渡る環境を確かめる（Issue #55 のレビューの指摘 3）。

依存グループ ai（claude_agent_sdk）が入っているときだけ流れる。確認コマンド・CI は ai を入れないのでスキップする
（SDK の版を上げるときに手元で ``uv sync --locked --group ai`` の後に流す。ADR-0011）。

子のプロセスは起動しない: SDK の ``SubprocessCLITransport.connect`` が呼ぶ ``anyio.open_process`` を差し替え、渡された
``env=`` を記録して止める。版の確かめ（``claude -v``）も止める。実際の AI は呼ばない。値はすべて架空。
"""

import os

import pytest

pytest.importorskip("claude_agent_sdk")

from claude_agent_sdk._internal.transport import subprocess_cli  # noqa: E402
from statement_read import agent_reader  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"
FED = {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example",
       "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-0000-0000-000000000001"}
PARENT = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "GH_TOKEN": "GH-x",
    "ANTHROPIC_API_KEY": "KEY-parent", "CLAUDE_CODE_OAUTH_TOKEN": "TOK-parent", "ANTHROPIC_AUTH_TOKEN": "AUTH-x",
    "ANTHROPIC_PROFILE": "p", "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_parent", "ANTHROPIC_BASE_URL": "http://x.example",
    "CLAUDE_CODE_USE_BEDROCK": "1", "AWS_BEARER_TOKEN_BEDROCK": "B-x", "CLAUDECODE": "1",
}
METHOD = {
    "api_key": ("KEY-A", {"ANTHROPIC_API_KEY"}, {}),
    "oauth_token": ("TOK-O", {"CLAUDE_CODE_OAUTH_TOKEN"}, {}),
    "federation": (FED, set(FED) | {"ANTHROPIC_IDENTITY_TOKEN_FILE"}, {"identity_token": TOKEN}),
}


class _Stop(Exception):
    pass


@pytest.fixture
def captured(monkeypatch):
    seen: dict = {}

    async def fake_open_process(cmd, **kw):
        seen["env"] = dict(kw["env"])
        seen["cmd"] = list(cmd)
        raise _Stop()

    async def no_version_check(self):
        return None

    monkeypatch.setattr(subprocess_cli.anyio, "open_process", fake_open_process)
    monkeypatch.setattr(subprocess_cli.SubprocessCLITransport, "_check_claude_version", no_version_check)
    # 入口（create_app・道具の CLI）と同じく、全部入りの親から系統の名前を 1 回外す
    parent = dict(PARENT)
    monkeypatch.setattr(os, "environ", parent)
    agent_reader.scrub_process_env()
    return seen


@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
def test_real_sdk_child_env(captured, tmp_path, method):
    secret, names, kw = METHOD[method]
    r = agent_reader.Reader(method, secret, "claude-sonnet-5-5", "low", tmp_parent=str(tmp_path / "t"), timeout=10,
                            **kw)
    o = r.read(PNG, "image/png")
    assert o.result is None and "env" in captured
    env = captured["env"]
    family = {k for k in env if agent_reader.is_credential_name(k)}
    # 送り口が決める CLI の設定（CLAUDE_*）と SDK が足す固定の名前（CLAUDE_CODE_ENTRYPOINT・CLAUDE_AGENT_SDK_*）を除いた
    # 資格情報・送り先の系統の名前は、方式の変数だけ
    allowed_cli = {"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR", "CLAUDE_CODE_MAX_RETRIES",
                   "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
                   "CLAUDE_CODE_ENTRYPOINT"}
    creds = {k for k in family if k not in allowed_cli and not k.startswith("CLAUDE_AGENT_SDK")
             and not k.startswith("CLAUDE_CODE_SDK") and not k.startswith("CLAUDE_CODE_EMIT")}
    assert creds == names
    assert all(env[k] for k in names)
    for k in ("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
              "AWS_BEARER_TOKEN_BEDROCK", "CLAUDECODE"):
        assert k not in env
    # #99: 会話を保存しない指定が CLI の引数になる（SDK の extra_args → --no-session-persistence）
    assert "--no-session-persistence" in captured["cmd"]
    assert env["GH_TOKEN"] == ""
    assert list((tmp_path / "t").iterdir()) == []


@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
def test_real_sdk_child_env_warm(captured, tmp_path, method):
    # #65: 先立ての CLI も同じ許可リスト（本物の SDK の connect に渡る env=）。子は起動しない
    from statement_read import warm

    secret, names, kw = METHOD[method]
    token = kw.get("identity_token")
    pool = warm.WarmPool(method, secret, "claude-sonnet-5-5", "low", timeout=10, tmp_parent=str(tmp_path / "t"),
                         identity_token=(lambda: token) if token else None)
    try:
        assert pool.prepare(10) is False  # 起動を止めたので立ち上がらない
        assert pool.wait_idle(10)
    finally:
        pool.close()
    env = captured["env"]
    family = {k for k in env if agent_reader.is_credential_name(k)}
    allowed_cli = {"CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR", "CLAUDE_CODE_MAX_RETRIES",
                   "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
                   "CLAUDE_CODE_ENTRYPOINT"}
    creds = {k for k in family if k not in allowed_cli and not k.startswith("CLAUDE_AGENT_SDK")
             and not k.startswith("CLAUDE_CODE_SDK") and not k.startswith("CLAUDE_CODE_EMIT")}
    assert creds == names
    assert all(env[k] for k in names)
    assert env["GH_TOKEN"] == ""
    assert list((tmp_path / "t").iterdir()) == []
