"""決済明細の読み取りの入口 ``POST /api/statement-reads``（Issue #11・ADR-0005）。

本文は画像の生のバイト（``Content-Type: image/png`` か ``image/jpeg``）。multipart・base64 は使わない（Werkzeug の
multipart は大きな本文をディスクに一時保存しうる。生のバイトは ``get_data`` でメモリだけ）。

順番: 認証（blueprint の ``authenticate``。本文を読む前に 401）→ 資格情報と SDK（503）→ 本文の長さ・形式・寸法（400）→
送る（共有の ``statement_read.agent_reader.Reader``。指示・画像 1 枚・決まった文・ツール 1 本だけ）→ 形の検査（502）→
直し（``statement_read.normalize``）→ 200。

画像も結果も保存しない（記録の保存先・Storage に触れない。CLI の一時ディレクトリは要求ごとに作って消す）。応答と
ログに画像の中身・結果の値・資格情報・送り先の文言を出さない（失敗は決まった符号だけ）。
"""

import time
from collections.abc import Mapping
from dataclasses import dataclass, field

from flask import Blueprint, Response, jsonify, request
from statement_read import app_settings, image
from statement_read.agent_reader import CREDENTIAL_ENV, Reader
from statement_read.normalize import normalize_result
from statement_read.result import Bad
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api.logs import log_event

PATH = "/statement-reads"
# 資格情報の切り替え（api_key = ANTHROPIC_API_KEY〔既定〕/ oauth_token = CLAUDE_CODE_OAUTH_TOKEN。後者は手元の実測だけ）
CREDENTIAL_SWITCH = "STATEMENT_READ_CREDENTIAL"
DEFAULT_CREDENTIAL = "api_key"


@dataclass(frozen=True)
class ReadConfig:
    """読み取りの設定。credential が None なら使えない（503）。secret は repr に出さない"""

    credential: str | None
    secret: str = field(default="", repr=False)
    timeout: float = app_settings.APP_TIMEOUT_SECONDS

    @property
    def usable(self) -> bool:
        return self.credential is not None and bool(self.secret)


def read_config(env: Mapping[str, str], timeout: float | None = None) -> ReadConfig:
    """環境変数 → 読み取りの設定。切り替えの値が不明・選んだ資格情報が空なら使えない設定（値は持たない）"""
    t = app_settings.APP_TIMEOUT_SECONDS if timeout is None else timeout
    kind = env.get(CREDENTIAL_SWITCH) or DEFAULT_CREDENTIAL
    name = CREDENTIAL_ENV.get(kind)
    secret = (env.get(name) or "") if name is not None else ""
    if not secret:
        return ReadConfig(None, "", t)
    return ReadConfig(kind, secret, t)


def sdk_available() -> bool:
    """claude_agent_sdk を import できるか（依存グループ ai。確認コマンド・CI では入れない）"""
    try:
        import claude_agent_sdk  # noqa: F401
    except ImportError:
        return False
    return True


# 送り口の失敗 → (状態, 符号, ログの理由)
def _failure(error: str) -> tuple[int, str, str]:
    if error == "timeout":
        return 504, "read_timeout", "timeout"
    if error == "sdk_missing":
        return 503, "read_unavailable", "unavailable"
    if error == "no_tool_call" or error.startswith("bad_result:"):
        return 502, "read_invalid_result", "invalid_result"
    return 502, "read_failed", "failed"


def register(bp: Blueprint, config: ReadConfig) -> None:
    """記録の API の blueprint（認証済み）に読み取りの入口を足す"""

    @bp.post(PATH)
    def read_statement():
        started = time.perf_counter()

        def reply(status: int, body: dict, reason: str, rows: int = 0) -> Response:
            log_event(event="statement_read", reason=reason, rows=rows,
                      ms=round((time.perf_counter() - started) * 1000, 1))
            res = jsonify(body)
            res.status_code = status
            return res

        if not config.usable or not sdk_available():
            return reply(503, {"error": "read_unavailable"}, "unavailable")

        # この入口だけ本文の上限を画像の上限に上げる（ほかの入口はアプリ全体の 64 KiB のまま）。Content-Length の無い
        # 分割の本文（chunked）は Werkzeug が上限で黙って切り詰めるので、上限 + 1 B まで読み、超えた分で「大きすぎる」を
        # 見分ける（切り詰めた画像を送らない）
        request.max_content_length = image.MAX_BYTES + 1
        if request.content_length is not None and request.content_length > image.MAX_BYTES:
            return reply(400, {"error": "image_rejected", "reason": "bytes"}, "image_bytes")
        try:
            data = request.get_data(cache=False)
        except RequestEntityTooLarge:
            return reply(400, {"error": "image_rejected", "reason": "bytes"}, "image_bytes")
        reason = image.check_limits(data, request.headers.get("Content-Type"))
        if reason is not None:
            return reply(400, {"error": "image_rejected", "reason": reason}, f"image_{reason}")

        reader = Reader(config.credential, config.secret, app_settings.APP_MODEL, app_settings.APP_EFFORT,
                                timeout=config.timeout)
        outcome = reader.read(data, image.media_type_of(data))
        del data
        if outcome.result is None or outcome.error is not None:
            status, code, why = _failure(outcome.error or "no_tool_call")
            return reply(status, {"error": code}, why)
        try:
            body = normalize_result(outcome.result)
        except Bad:
            return reply(502, {"error": "read_invalid_result"}, "invalid_result")
        return reply(200, body, "ok", rows=len(body["rows"]))
