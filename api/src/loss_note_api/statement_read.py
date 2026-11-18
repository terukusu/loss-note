"""決済明細の読み取りの入口 ``POST /api/statement-reads``（Issue #11・ADR-0005）。

本文は画像の生のバイト（``Content-Type: image/png`` か ``image/jpeg``）。multipart・base64 は使わない（Werkzeug の
multipart は大きな本文をディスクに一時保存しうる。生のバイトは ``get_data`` でメモリだけ）。

順番: 認証（blueprint の ``authenticate``。本文を読む前に 401）→ 資格情報と SDK（503）→ 本文の長さ・形式・寸法（400）→
1 日の上限の予約（Issue #44・ADR-0010。利用者ごとの回数と全体の費用。越えるなら 429 ``read_limited``、数える場所が
使えなければ 503 ``read_unavailable``。どちらも AI を呼ばない）→ 送る（共有の ``statement_read.agent_reader.Reader``。
指示・画像 1 枚・決まった文・ツール 1 本だけ。最大出力は ``app_settings.APP_MAX_OUTPUT_TOKENS``）→ 精算（実額に直す。
失敗しても応答は変えない = 予約額が残る）→ 形の検査（502）→ 直し（``statement_read.normalize``）→ 200。

本番の起動（ADR-0004 の verify）では OAuth トークン（``oauth_token``。サブスクの資格情報）を使わない（503）。

画像も結果も保存しない（記録の保存先・Storage に触れない。CLI の一時ディレクトリは要求ごとに作って消す）。応答と
ログに画像の中身・結果の値・資格情報・送り先の文言を出さない（失敗は決まった符号だけ）。
"""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from flask import Blueprint, Response, g, jsonify, request
from statement_read import app_settings, image
from statement_read.agent_reader import CREDENTIAL_ENV, Reader
from statement_read.normalize import normalize_result
from statement_read.result import Bad
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api import read_limits
from loss_note_api.logs import log_event
from loss_note_api.store import Store

PATH = "/statement-reads"
# 資格情報の切り替え（api_key = ANTHROPIC_API_KEY〔既定〕/ oauth_token = CLAUDE_CODE_OAUTH_TOKEN。後者は手元の実測だけ）
CREDENTIAL_SWITCH = "STATEMENT_READ_CREDENTIAL"
DEFAULT_CREDENTIAL = "api_key"
# 本番の起動（verify）で使える資格情報（サブスクの OAuth トークンは使わない。設計書 8.2・ADR-0005 の決定 3）
VERIFY_CREDENTIALS = ("api_key",)


@dataclass(frozen=True)
class ReadConfig:
    """読み取りの設定。credential が None なら使えない（503）。secret は repr に出さない"""

    credential: str | None
    secret: str = field(default="", repr=False)
    timeout: float = app_settings.APP_TIMEOUT_SECONDS

    @property
    def usable(self) -> bool:
        return self.credential is not None and bool(self.secret)


def read_config(env: Mapping[str, str], timeout: float | None = None, *, mode: str) -> ReadConfig:
    """環境変数 → 読み取りの設定。切り替えの値が不明・選んだ資格情報が空なら使えない設定（値は持たない）。
    mode は起動の種類（runtime.decide_runtime。必須・既定なし。渡し忘れで手元の扱いにならないように）。
    本番（verify）では api_key 以外を使えない設定にする"""
    t = app_settings.APP_TIMEOUT_SECONDS if timeout is None else timeout
    kind = env.get(CREDENTIAL_SWITCH) or DEFAULT_CREDENTIAL
    if mode == "verify" and kind not in VERIFY_CREDENTIALS:
        return ReadConfig(None, "", t)
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


def register(
    bp: Blueprint,
    config: ReadConfig,
    store: Store,
    clock: Callable[[], int],
    limits: read_limits.ReadLimits,
) -> None:
    """記録の API の blueprint（認証済み）に読み取りの入口を足す。store は 1 日の計上の置き場（#44）、clock は今の
    時刻（エポックのミリ秒。日本時間の日付に直す）、limits は上限の値"""

    @bp.post(PATH)
    def read_statement():
        started = time.perf_counter()

        def elapsed() -> float:
            return round((time.perf_counter() - started) * 1000, 1)

        def reply(status: int, body: dict, reason: str, rows: int = 0) -> Response:
            log_event(event="statement_read", reason=reason, rows=rows, ms=elapsed())
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

        # 1 日の上限（#44）: AI へ送る要求だけを数える（ここより前の 401・503・400 は数えない）。
        # 数える場所が使えなければ閉じる側（AI を呼ばない）。理由（回数 / 費用）は応答に出さず、ログの理由だけで分ける
        day = read_limits.jst_day(clock())
        reserve = limits.reserve_micro_usd
        try:
            decision = store.reserve_read(g.uid, day, lambda count, spent: read_limits.decide(count, spent, limits),
                                          reserve)
        except Exception:  # noqa: BLE001 - つながらない・権限・競合のどれでも閉じる側（例外の文言は出さない）
            return reply(503, {"error": "read_unavailable"}, "limit_unavailable")
        if decision != "ok":
            return reply(429, {"error": "read_limited"}, f"limited_{decision}")

        reader = Reader(config.credential, config.secret, app_settings.APP_MODEL, app_settings.APP_EFFORT,
                        timeout=config.timeout, max_output_tokens=app_settings.APP_MAX_OUTPUT_TOKENS)
        outcome = reader.read(data, image.media_type_of(data))
        del data
        # 精算: 使ったトークン・SDK の合計額が取れた回は実額に、取れなかった回は予約額のまま。予約した日の文書へ
        # （0:00 をまたいでも同じ日）。失敗しても応答は変えない（予約額が残る = 多めに数える側）
        settled = read_limits.settled_micro(outcome.usage, outcome.sdk_cost_usd, reserve, limits.model)
        try:
            store.settle_read(day, settled - reserve)
        except Exception:  # noqa: BLE001 - 応答は変えない（予約額が残る）。例外の文言は出さない
            log_event(event="statement_read_settle", reason="unavailable", rows=0, ms=elapsed())
        if outcome.result is None or outcome.error is not None:
            status, code, why = _failure(outcome.error or "no_tool_call")
            return reply(status, {"error": code}, why)
        try:
            body = normalize_result(outcome.result)
        except Bad:
            return reply(502, {"error": "read_invalid_result"}, "invalid_result")
        return reply(200, body, "ok", rows=len(body["rows"]))
