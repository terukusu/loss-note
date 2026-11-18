"""Claude Agent SDK（claude-agent-sdk。使う側の依存グループ ai）で明細の画像 1 枚を読む送り口。API の読み取りの入口と
評価の道具が同じものを使う（#11・ADR-0005。#14 で測った経路そのまま）。

- 資格情報の方式は使う側が選ぶ（道具は --credential、API は STATEMENT_READ_CREDENTIAL。#55・ADR-0011）:
  api_key = ANTHROPIC_API_KEY / oauth_token = CLAUDE_CODE_OAUTH_TOKEN / federation = Workload Identity Federation
  （ANTHROPIC_FEDERATION_RULE_ID・ANTHROPIC_ORGANIZATION_ID と、要求ごとの一時ディレクトリに書く ID トークンの
  ファイル ANTHROPIC_IDENTITY_TOKEN_FILE。任意で ANTHROPIC_SERVICE_ACCOUNT_ID・ANTHROPIC_WORKSPACE_ID）
- 子（同梱の CLI）の環境は方式ごとの許可リストで組み立てる（child_env）。資格情報・送り先の系統の名前
  （is_credential_name。ANTHROPIC_*・CLAUDE_*・AWS_* など）は、選んだ方式の変数を除いて子の環境に **名前ごと置かない**
  （空の文字列も資格情報の優先順位の枠を占めうるため。Anthropic の WIF reference）。SDK は親の環境（os.environ）に
  options.env を重ねて子を起動するので、送る直前に親の環境から系統の名前を外す（scrub_process_env）。系統の外で
  許可リスト（PASS_THROUGH_ENV）に無い親の変数は空で上書きする（ほかのサービスのトークンなどを子に見せない）。
  親の環境から外すのは各プロセスの入口の 1 回だけ（API の create_app・道具の CLI）。送り口は要求ごとに os.environ を
  書き換えず、系統の名前が親に残っていれば送らずに失敗にする（"credential_env"。fail closed）
- SDK を上げるときは subprocess_cli の connect の重ね方（親の環境 → options.env の順）を確かめ直す。spawn_env はその
  写しで、本物の SDK を通すテストは依存グループ ai があるときだけ流れる（api/tests/test_real_sdk_env.py）
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
  "bad_result:<理由>" / "result_error"（送り先のエラー）/ "identity_token"（federation の ID トークンが無い。
  AI を呼ばない）/ "credential_env"（親の環境に資格情報の系統の名前が残っている。AI を呼ばない）/
  "no_result"（結果も例外も無いまま終わった。CLI の異常終了
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

# 値 1 つで決まる方式 → その変数（道具の --credential もこの 2 つ）
CREDENTIAL_ENV = {"oauth_token": "CLAUDE_CODE_OAUTH_TOKEN", "api_key": "ANTHROPIC_API_KEY"}
FEDERATION = "federation"
CREDENTIALS = ("api_key", "oauth_token", FEDERATION)
# Workload Identity Federation の変数（Anthropic の WIF reference）。必須の 2 つ + 要求ごとの ID トークンのファイル
FEDERATION_REQUIRED_ENV = ("ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID")
FEDERATION_OPTIONAL_ENV = ("ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID")
IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE"
# ID トークンの audience（Anthropic の文書の値。フェデレーションのルールの audience と同じにする）
IDENTITY_TOKEN_AUDIENCE = "https://api.anthropic.com"
# 要求ごとの一時ディレクトリの中の ID トークンのファイル（HOME・設定の置き場の外）
IDENTITY_TOKEN_SUBDIR = "cred"
IDENTITY_TOKEN_NAME = "identity-token"
# 資格情報・送り先の系統（子の環境に名前ごと置かない。選んだ方式の変数と、送り口が決めた CLI の設定だけを足す）。
# ANTHROPIC_*（キー・トークン・プロファイル・送り先・フェデレーション・設定の置き場）、CLAUDE_*（OAuth トークン・
# Bedrock / Vertex / Foundry の切り替え CLAUDE_CODE_USE_*・設定の置き場・apiKeyHelper の関係）、
# AWS_*（Bedrock の資格情報）、Vertex の地域（CLOUD_ML_REGION・VERTEX_REGION_*）。
# GOOGLE_* は API 自身（Firestore・ID トークンの検証）が使うので親からは外さず、子では空にする
# （Vertex は CLAUDE_CODE_USE_VERTEX が無ければ使われない）
CREDENTIAL_PREFIXES = ("ANTHROPIC_", "CLAUDE_", "AWS_", "VERTEX_REGION_")
CREDENTIAL_NAMES = frozenset({"CLAUDECODE", "CLOUD_ML_REGION"})


def is_credential_name(name: str) -> bool:
    """資格情報・送り先の系統の名前か（大文字・小文字を区別せずに見る）"""
    n = name.upper()
    return n in CREDENTIAL_NAMES or n.startswith(CREDENTIAL_PREFIXES)


def method_env_names(credential: str) -> frozenset[str]:
    """方式が子に渡してよい資格情報の変数の名前"""
    if credential == FEDERATION:
        return frozenset((*FEDERATION_REQUIRED_ENV, *FEDERATION_OPTIONAL_ENV, IDENTITY_TOKEN_FILE_ENV))
    name = CREDENTIAL_ENV.get(credential)
    if name is None:
        raise ValueError("credential")
    return frozenset((name,))


def credential_values(credential: str | None, env) -> dict[str, str]:
    """選んだ方式の資格情報の変数（名前 → 値）を環境から取る。必須の値が無ければ NoCredential（値は持たない）。
    federation の ID トークンのファイルは要求ごとに作るのでここには入らない"""
    if credential == FEDERATION:
        out = {}
        for name in FEDERATION_REQUIRED_ENV:
            v = env.get(name) or ""
            if not v:
                raise NoCredential(name)
            out[name] = v
        for name in FEDERATION_OPTIONAL_ENV:
            v = env.get(name) or ""
            if v:
                out[name] = v
        return out
    secret = credential_secret(credential, env)  # 不明な方式も NoCredential
    return {CREDENTIAL_ENV[credential]: secret}


def credential_names_in(environ=None) -> list[str]:
    """環境（既定は os.environ）に残っている資格情報・送り先の系統の名前（値は返さない）"""
    env = os.environ if environ is None else environ
    return sorted(k for k in list(env) if is_credential_name(k))


def scrub_process_env(environ=None) -> list[str]:
    """親（この process）の環境から資格情報・送り先の系統の名前を外す（SDK が子に引き継がせないため）。外した名前だけを
    返す（値は返さない）。各プロセスの入口で、資格情報を読んだ直後に 1 回だけ呼ぶ（API は create_app、道具は CLI の
    起動。要求ごとには呼ばない = スレッドの中で os.environ を書き換えない）"""
    env = os.environ if environ is None else environ
    names = sorted(k for k in list(env) if is_credential_name(k))
    for k in names:
        env.pop(k, None)
    return names


def spawn_env(parent_env, options_env: dict[str, str]) -> dict[str, str]:
    """SDK が子を起動するときの環境の写し（claude-agent-sdk の subprocess_cli の connect:
    親の環境から CLAUDECODE を除き、options.env を重ねる。SDK が足す固定の名前 CLAUDE_CODE_ENTRYPOINT・
    CLAUDE_AGENT_SDK_VERSION などは資格情報でないので省く）。テストで「子に渡る名前の集合」を確かめる"""
    return {**{k: v for k, v in parent_env.items() if k != "CLAUDECODE"}, **options_env}
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


class CredentialEnvPresent(RuntimeError):
    """親の環境に資格情報・送り先の系統の名前が残っている（入口で外していない）。名前・値は持たない"""


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


def child_env(credential: str, secret, base_dir: str, parent_env=None,
              max_output_tokens: int | None = None) -> dict[str, str]:
    """子（CLI）の options.env。secret は値 1 つ（api_key・oauth_token）か、名前 → 値の dict（方式の変数だけ）。
    資格情報・送り先の系統の名前は選んだ方式の変数だけを入れる（ほかは入れない = scrub_process_env の後の親にも
    無いので、子に名前ごと無い）。系統の外で許可リスト（PASS_THROUGH_ENV）に無い親の変数は空で上書きする。
    parent_env はテスト用（既定は os.environ）。max_output_tokens があれば CLI の最大出力（MAX_OUTPUT_ENV）にする
    （無ければ親の値も空で上書きされ、CLI の既定 = モデルの最大出力。#44）"""
    parent = os.environ if parent_env is None else parent_env
    values = {CREDENTIAL_ENV[credential]: secret} if isinstance(secret, str) else dict(secret)
    allowed = method_env_names(credential)
    if not set(values) <= allowed:
        raise ValueError("credential values")
    env = {k: "" for k in parent if k not in PASS_THROUGH_ENV and not is_credential_name(k)}
    env.update({k: v for k, v in values.items() if v})
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
ISOLATED_SUBDIRS = ("cfg", "cwd", "tmp", "home", IDENTITY_TOKEN_SUBDIR)


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


def option_kwargs(model: str, effort: str, credential: str, secret, base_dir: str,
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
    （None = 無し。道具の既定）。max_output_tokens は CLI の最大出力（None = CLI の既定。道具の既定）。
    secret は値 1 つ（api_key・oauth_token）か、方式の変数の dict（federation。credential_values の結果）。
    identity_token は federation の ID トークン（この 1 回の読み取りの間だけ、一時ディレクトリのファイルに置く）"""

    def __init__(
        self,
        credential: str,
        secret,
        model: str,
        effort: str,
        tmp_parent: str | None = None,
        query_fn: Callable | None = None,
        clock: Callable[[], float] = time.monotonic,
        timeout: float | None = None,
        max_output_tokens: int | None = None,
        identity_token: str | None = None,
    ):
        self._credential = credential
        self._secret = secret
        self._identity_token = identity_token
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
            values = self._values(base)
            if values is None:
                return ReadOutcome(result=None, seconds=None, error="identity_token")
            return asyncio.run(self._read(data, media_type, base, values))
        except TimeoutError:
            return ReadOutcome(result=None, seconds=None, error="timeout")
        except SdkMissing:
            return ReadOutcome(result=None, seconds=None, error="sdk_missing")
        except CredentialEnvPresent:
            return ReadOutcome(result=None, seconds=None, error="credential_env")
        except Exception as e:  # noqa: BLE001 - 型の名前だけを返す
            return ReadOutcome(result=None, seconds=None, error=type(e).__name__)
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def _values(self, base: str) -> dict[str, str] | None:
        """子に渡す方式の変数。federation は ID トークンを base の中のファイル（0600）に書き、その場所を足す
        （ファイルは base ごと消える）。ID トークンが無ければ None（AI を呼ばない）"""
        values = {CREDENTIAL_ENV[self._credential]: self._secret} if isinstance(self._secret, str) else dict(
            self._secret)
        if self._credential != FEDERATION:
            return values
        if not self._identity_token:
            return None
        path = f"{base}/{IDENTITY_TOKEN_SUBDIR}/{IDENTITY_TOKEN_NAME}"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as f:
            f.write(self._identity_token)
        return {**values, IDENTITY_TOKEN_FILE_ENV: path}

    async def _read(self, data: bytes, media_type: str, base: str, values: dict[str, str]) -> ReadOutcome:
        captured: list = []
        kwargs = option_kwargs(self.model, self.effort, self._credential, values, base,
                               max_output_tokens=self.max_output_tokens)
        query_fn, opts = resolve_query(self._query_fn, kwargs, captured)
        done = asyncio.Event()
        message = user_message(data, media_type)

        async def prompt_stream():
            # 結果を受け取るまで入力を閉じない（閉じると CLI の制御要求 = SDK MCP・フックに答えられない）
            yield message
            await done.wait()

        collector = Collector(self._clock, self._clock())
        try:
            # 締め切りは cancel scope で（超えたら TimeoutError。generator の中の await に取り消しが届き、SDK の後始末が
            # 走る）。generator は同じ scope の中で閉じる
            with anyio.fail_after(self.timeout):
                async with contextlib.aclosing(query_fn(prompt=prompt_stream(), options=opts)) as stream:
                    async for m in stream:
                        if collector.feed(m):
                            done.set()
        finally:
            done.set()
        return collector.outcome(captured)


def resolve_query(query_fn: Callable | None, kwargs: dict, captured: list) -> tuple[Callable, object]:
    """送る関数と options。query_fn（テスト用）があれば options は option_kwargs の dict のまま
    （SDK を import しない）。無ければ SDK を import し、親の環境に資格情報の系統の名前が残っていれば送らない
    （外すのは入口の 1 回だけ。ここでは os.environ を書き換えない）"""
    if query_fn is not None:
        return query_fn, kwargs
    try:
        from claude_agent_sdk import query as sdk_query
    except ImportError:
        raise SdkMissing("claude_agent_sdk") from None
    # SDK は親の環境に options.env を重ねて子を起動する
    if credential_names_in():
        raise CredentialEnvPresent("credential_env")
    return sdk_query, sdk_options(kwargs, captured)


def user_message(data: bytes, media_type: str) -> dict:
    """CLI へ送る user の message（画像 1 枚と決まった文）"""
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                     "data": base64.b64encode(data).decode("ascii")}},
        {"type": "text", "text": prompt.READ_USER_TEXT},
    ]
    return {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None,
            "session_id": "default"}


class Collector:
    """stream の message を受けて ReadOutcome を組み立てる（その場で立てる送り口と先立て（warm）が共有する）。
    started は秒数を数え始めた時刻（clock の値）"""

    def __init__(self, clock: Callable[[], float], started: float):
        self._clock = clock
        self.started = started
        self.seconds: float | None = None
        self.api_seconds: float | None = None
        self.sdk_cost: float | None = None
        self.usage: Usage | None = None
        self.is_error = False
        self.tool_inputs: list = []

    def feed(self, m) -> bool:
        """message を 1 つ受ける。最初の ResultMessage を受けたら True（入力を閉じてよい）"""
        kind = type(m).__name__
        if kind == "AssistantMessage":
            for b in getattr(m, "content", None) or []:
                if type(b).__name__ == "ToolUseBlock" and str(getattr(b, "name", "")).endswith(schema.TOOL_NAME):
                    self.tool_inputs.append(getattr(b, "input", None))
        elif kind == "ResultMessage" and self.seconds is None:
            self.seconds = self._clock() - self.started
            api_ms = getattr(m, "duration_api_ms", None)
            self.api_seconds = api_ms / 1000 if isinstance(api_ms, (int, float)) else None
            self.usage = _usage(getattr(m, "usage", None))
            cost = getattr(m, "total_cost_usd", None)
            self.sdk_cost = float(cost) if isinstance(cost, (int, float)) else None
            self.is_error = bool(getattr(m, "is_error", False))
            return True
        return False

    def outcome(self, captured: list) -> ReadOutcome:
        """フックが受けた入力（captured）か、AssistantMessage のツールの入力から結果を作る"""
        raw = captured[0] if captured else (self.tool_inputs[0] if self.tool_inputs else None)
        n_calls = max(len(self.tool_inputs), len(captured))
        out = ReadOutcome(result=None, seconds=self.seconds, api_seconds=self.api_seconds, usage=self.usage,
                          sdk_cost_usd=self.sdk_cost, tool_calls=n_calls)
        if raw is None:
            if self.seconds is None:  # ResultMessage を受けないまま終わった（CLI の異常終了など）
                out.error = "no_result"
            else:
                out.error = "result_error" if self.is_error else "no_tool_call"
            return out
        try:
            out.result = schema.check_result(raw)
        except schema.Bad as e:
            out.error = f"bad_result:{e.reason}"
        return out
