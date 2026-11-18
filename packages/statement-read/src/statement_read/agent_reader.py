"""Claude Agent SDK（claude-agent-sdk。使う側の依存グループ ai）で明細の画像 1 枚を読む送り口。API の読み取りの入口と
評価の道具が同じものを使う（#11・ADR-0005。#14 で測った経路そのまま）。

- 資格情報は使う側が選ぶ（道具は --credential、API は STATEMENT_READ_CREDENTIAL。oauth_token =
  CLAUDE_CODE_OAUTH_TOKEN / api_key = ANTHROPIC_API_KEY）。子（同梱の CLI）の環境は許可リスト方式: CLI が
  動くのに要る変数（PASS_THROUGH_ENV）と選んだ資格情報だけを渡し、ほかの親の変数は空で上書きする
  （選ばなかった資格情報・送信先の変数も空。option-simulator の ADR-0005 S5）
- SDK は読むときにだけ import する（確認コマンドと CI は SDK を入れない。資格情報が無いときは import しない）
- ツールは SDK MCP の report_statement 1 本。PreToolUse のフックが deny + continue_=False を返し、関数は実行せずに
  入力だけを受け取る。組み込みのツールなし・設定ファイルを読まない・turn 1
- 子の CLAUDE_CONFIG_DIR・CLAUDE_CODE_TMPDIR・cwd は実行ごとの一時ディレクトリ（道具の実物のときは data/local/ の下、
  API はシステムの一時ディレクトリ）。成功・失敗・締め切り超えのどれでも終わったら消す。CLI の標準エラー・例外の本文は
  出さない（型名だけ）。読み取りの値は保存しない
- 締め切り（timeout 秒。None = 無し）は anyio の cancel scope（fail_after）で取り消す。SDK の後始末（子の stdin を
  閉じ → 待って SIGTERM → SIGKILL）は SDK の shield の中で走る。asyncio の素の task.cancel() / wait_for は後始末を
  飛ばして子が残るので使わない（option-simulator の agent_sdk.py と同じ）
- ReadOutcome.error の分類: None（成功）/ "timeout" / "sdk_missing"（SDK を import できない）/ "no_tool_call" /
  "bad_result:<理由>" / "result_error"（送り先のエラー）/ "no_result"（結果も例外も無いまま終わった。CLI の異常終了
  など。送り先の失敗として扱う）/ 例外の型の名前
- 子の HOME・TMPDIR・XDG_*（設定・キャッシュ・データ・状態の置き場所）も実行ごとの一時ディレクトリの中にする
  （isolated_env）。子が一時ディレクトリの外に書かず、終わったら一緒に消える
"""

import asyncio
import base64
import contextlib
import os
import shutil
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass

import anyio

from . import prompt
from . import result as schema
from .values import Usage

CREDENTIAL_ENV = {"oauth_token": "CLAUDE_CODE_OAUTH_TOKEN", "api_key": "ANTHROPIC_API_KEY"}
# 子（CLI）に親の値のまま渡す変数（許可リスト）。CLI が動くのに要るものだけ。ほかの親の変数（ほかのサービスの
# トークン・送信先の上書きなど）は空で上書きする（SDK は親の環境に options.env を重ねて子を起動するため）
PASS_THROUGH_ENV = (
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
)
SERVER = "eval"
CLI_TOOL_NAME = f"mcp__{SERVER}__{schema.TOOL_NAME}"
DENY_REASON = "Recorded. Do not call any tool again; the turn is over."
MAX_BUFFER_BYTES = 8 * 1024 * 1024
# CLI の最大出力（トークン）の変数。CLI はモデルの最大出力を上限にこの値を要求の max_tokens にする（#44）
MAX_OUTPUT_ENV = "CLAUDE_CODE_MAX_OUTPUT_TOKENS"


class SdkMissing(RuntimeError):
    """claude_agent_sdk を import できない（依存グループ ai を入れていない）"""


class NoCredential(RuntimeError):
    """資格情報が無い（値は持たない）"""


def credential_secret(credential: str | None, env: dict[str, str]) -> str:
    """選んだ資格情報の値を環境から取る。無ければ NoCredential（SDK を import する前に呼ぶ）"""
    name = CREDENTIAL_ENV.get(credential or "")
    if name is None:
        raise NoCredential("credential")
    secret = env.get(name) or ""
    if not secret:
        raise NoCredential(name)
    return secret


def child_env(credential: str, secret: str, base_dir: str, parent_env: dict[str, str] | None = None,
              max_output_tokens: int | None = None) -> dict[str, str]:
    """子（CLI）の環境。許可リスト（PASS_THROUGH_ENV）にない親の変数はすべて空で上書きし、選んだ資格情報の変数と
    CLI の設定だけを足す。parent_env はテスト用（既定は os.environ）。max_output_tokens があれば CLI の最大出力
    （MAX_OUTPUT_ENV）にする（無ければ親の値も空で上書きされ、CLI の既定 = モデルの最大出力。#44）"""
    parent = os.environ if parent_env is None else parent_env
    env = {k: "" for k in parent if k not in PASS_THROUGH_ENV}
    # 親に無くても、資格情報・送信先を指す変数は空で固定する（選んだもの以外を CLI に使わせない）
    env.update(dict.fromkeys(("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
                              "ANTHROPIC_BASE_URL"), ""))
    env[CREDENTIAL_ENV[credential]] = secret
    env.update(
        {
            "CLAUDE_CONFIG_DIR": f"{base_dir}/cfg",
            "CLAUDE_CODE_TMPDIR": f"{base_dir}/tmp",
            "CLAUDE_CODE_MAX_RETRIES": "0",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_TELEMETRY": "1",
            "DISABLE_ERROR_REPORTING": "1",
            "DISABLE_AUTOUPDATER": "1",
            "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        }
    )
    if max_output_tokens is not None:
        env[MAX_OUTPUT_ENV] = str(max_output_tokens)
    return env


# 子の書き込み先を実行ごとの一時ディレクトリの中に閉じる変数（HOME の下の設定・キャッシュ、一時ファイル）
ISOLATED_SUBDIRS = ("cfg", "cwd", "tmp", "home")


def isolated_env(base_dir: str) -> dict[str, str]:
    """子の HOME・TMPDIR・XDG の置き場所を base_dir の中にする（親の HOME・TMPDIR を子に使わせない）"""
    home = f"{base_dir}/home"
    return {
        "HOME": home,
        "TMPDIR": f"{base_dir}/tmp",
        "XDG_CONFIG_HOME": f"{home}/.config",
        "XDG_CACHE_HOME": f"{home}/.cache",
        "XDG_DATA_HOME": f"{home}/.local/share",
        "XDG_STATE_HOME": f"{home}/.local/state",
    }


def option_kwargs(model: str, effort: str, credential: str, secret: str, base_dir: str,
                  max_output_tokens: int | None = None) -> dict:
    """ClaudeAgentOptions の引数のうち SDK の型を要らないもの（テストで中身を確かめる）。子の環境は child_env に
    isolated_env を重ねる（書き込み先を base_dir の中に閉じる）"""
    return {
        "tools": [],
        "setting_sources": [],
        "strict_mcp_config": True,
        "system_prompt": prompt.READ_SYSTEM,
        "model": model,
        "effort": effort,
        "max_turns": 1,
        "verbatim_prompts": True,
        "include_partial_messages": False,
        "cwd": f"{base_dir}/cwd",
        "env": {**child_env(credential, secret, base_dir, max_output_tokens=max_output_tokens),
                **isolated_env(base_dir)},
        "stderr": lambda line: None,  # CLI の標準エラーは本文を含みうるので捨てる
        "max_buffer_size": MAX_BUFFER_BYTES,
    }


def _hook(captured: list):
    async def pre_tool_use(input_data, tool_use_id, context):
        if input_data.get("tool_name") == CLI_TOOL_NAME and not captured:
            captured.append(input_data.get("tool_input"))
        return {
            "continue_": False,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": DENY_REASON,
            },
        }

    return pre_tool_use


def sdk_options(kwargs: dict, captured: list):
    """SDK の ClaudeAgentOptions（ツールの MCP サーバーとフックを足す）。SDK はここで初めて import する"""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher, create_sdk_mcp_server
    from claude_agent_sdk import tool as sdk_tool

    async def handler(args):  # 呼ばれない前提（フックが止める）
        return {"content": [{"type": "text", "text": "not available"}], "is_error": True}

    t = sdk_tool(schema.TOOL_NAME, schema.TOOL_DESCRIPTION, schema.TOOL_INPUT_SCHEMA)(handler)
    server = create_sdk_mcp_server(name=SERVER, version="1.0.0", tools=[t])
    return ClaudeAgentOptions(
        **kwargs,
        mcp_servers={SERVER: server},
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[_hook(captured)])]},
    )


@dataclass
class ReadOutcome:
    """1 回の読み取りの結果。result は検査済みの {"kind", "rows"}（失敗なら None）。error は種類の名前だけ"""

    result: dict | None
    seconds: float | None
    api_seconds: float | None = None
    usage: Usage | None = None
    sdk_cost_usd: float | None = None
    error: str | None = None
    tool_calls: int = 0


def _usage(d) -> Usage | None:
    if not isinstance(d, dict):
        return None

    def n(k: str) -> int:
        v = d.get(k)
        return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0

    return Usage(
        input_tokens=n("input_tokens"),
        output_tokens=n("output_tokens"),
        cache_creation_input_tokens=n("cache_creation_input_tokens"),
        cache_read_input_tokens=n("cache_read_input_tokens"),
    )


class Reader:
    """1 枚ずつ読む。query_fn はテスト用（claude_agent_sdk.query と同じ形の async generator 関数）。query_fn を
    渡したときは options に option_kwargs の dict をそのまま渡す（SDK を import しない）。timeout は締め切りの秒数
    （None = 無し。道具の既定）。max_output_tokens は CLI の最大出力（None = CLI の既定。道具の既定）"""

    def __init__(
        self,
        credential: str,
        secret: str,
        model: str,
        effort: str,
        tmp_parent: str | None = None,
        query_fn: Callable | None = None,
        clock: Callable[[], float] = time.monotonic,
        timeout: float | None = None,
        max_output_tokens: int | None = None,
    ):
        self._credential = credential
        self._secret = secret
        self.model = model
        self.effort = effort
        self._tmp_parent = tmp_parent
        self._query_fn = query_fn
        self._clock = clock
        self.timeout = timeout
        self.max_output_tokens = max_output_tokens

    def __repr__(self) -> str:  # 資格情報の値を repr に出さない
        return f"Reader(model={self.model!r}, effort={self.effort!r}, credential={self._credential!r})"

    def read(self, data: bytes, media_type: str) -> ReadOutcome:
        if self._tmp_parent is not None:
            os.makedirs(self._tmp_parent, mode=0o700, exist_ok=True)
        base = tempfile.mkdtemp(prefix="statement-read-", dir=self._tmp_parent)
        try:
            for sub in ISOLATED_SUBDIRS:
                os.mkdir(f"{base}/{sub}", 0o700)
            return asyncio.run(self._read(data, media_type, base))
        except TimeoutError:
            return ReadOutcome(result=None, seconds=None, error="timeout")
        except SdkMissing:
            return ReadOutcome(result=None, seconds=None, error="sdk_missing")
        except Exception as e:  # noqa: BLE001 - 型の名前だけを返す
            return ReadOutcome(result=None, seconds=None, error=type(e).__name__)
        finally:
            shutil.rmtree(base, ignore_errors=True)

    async def _read(self, data: bytes, media_type: str, base: str) -> ReadOutcome:
        captured: list = []
        kwargs = option_kwargs(self.model, self.effort, self._credential, self._secret, base,
                               max_output_tokens=self.max_output_tokens)
        query_fn = self._query_fn
        if query_fn is None:
            try:
                from claude_agent_sdk import query as query_fn
            except ImportError:
                raise SdkMissing("claude_agent_sdk") from None

            opts = sdk_options(kwargs, captured)
        else:
            opts = kwargs
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                         "data": base64.b64encode(data).decode("ascii")}},
            {"type": "text", "text": prompt.READ_USER_TEXT},
        ]
        done = asyncio.Event()

        async def prompt_stream():
            # 結果を受け取るまで入力を閉じない（閉じると CLI の制御要求 = SDK MCP・フックに答えられない）
            yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None,
                   "session_id": "default"}
            await done.wait()

        started = self._clock()
        seconds = api_seconds = sdk_cost = None
        usage = None
        is_error = False
        tool_inputs: list = []
        try:
            # 締め切りは cancel scope で（超えたら TimeoutError。generator の中の await に取り消しが届き、SDK の後始末が
            # 走る）。generator は同じ scope の中で閉じる
            with anyio.fail_after(self.timeout):
                async with contextlib.aclosing(query_fn(prompt=prompt_stream(), options=opts)) as stream:
                    async for m in stream:
                        kind = type(m).__name__
                        if kind == "AssistantMessage":
                            for b in getattr(m, "content", None) or []:
                                if type(b).__name__ == "ToolUseBlock" and str(getattr(b, "name", "")).endswith(
                                    schema.TOOL_NAME
                                ):
                                    tool_inputs.append(getattr(b, "input", None))
                        elif kind == "ResultMessage" and seconds is None:
                            seconds = self._clock() - started
                            api_ms = getattr(m, "duration_api_ms", None)
                            api_seconds = api_ms / 1000 if isinstance(api_ms, (int, float)) else None
                            usage = _usage(getattr(m, "usage", None))
                            cost = getattr(m, "total_cost_usd", None)
                            sdk_cost = float(cost) if isinstance(cost, (int, float)) else None
                            is_error = bool(getattr(m, "is_error", False))
                            done.set()
        finally:
            done.set()
        raw = captured[0] if captured else (tool_inputs[0] if tool_inputs else None)
        n_calls = max(len(tool_inputs), len(captured))
        out = ReadOutcome(result=None, seconds=seconds, api_seconds=api_seconds, usage=usage, sdk_cost_usd=sdk_cost,
                          tool_calls=n_calls)
        if raw is None:
            if seconds is None:  # ResultMessage を受けないまま終わった（CLI の異常終了など）
                out.error = "no_result"
            else:
                out.error = "result_error" if is_error else "no_tool_call"
            return out
        try:
            out.result = schema.check_result(raw)
        except schema.Bad as e:
            out.error = f"bad_result:{e.reason}"
        return out
