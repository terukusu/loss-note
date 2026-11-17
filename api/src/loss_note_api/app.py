"""Flask アプリの入口。

手元の起動: ``npm run dev:api``（エミュレーターに向けた環境変数を付けて
``uv run flask --app loss_note_api.app:create_app run -p 8000`` を動かす。画面の開発サーバーが /api をここへ渡す）。

起動の判定は ``runtime.decide_runtime``（ADR-0004）。エミュレーターの接続先があるのにプロジェクト ID が
``demo-`` で始まらない設定では ``StartupRefused`` を投げ、アプリを返さない。
"""

import io
import os
import time
from collections.abc import Callable, Mapping

from flask import Flask, Request, Response, g, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from loss_note_api import logs, schema, statement_read
from loss_note_api.auth import TokenVerifier
from loss_note_api.routes import error, invalid, make_blueprint, make_unconfigured_blueprint
from loss_note_api.runtime import decide_runtime
from loss_note_api.store import FirestoreStore, Store, StoreUnavailable


def _now_ms() -> int:
    return int(time.time() * 1000)


class MemoryOnlyRequest(Request):
    """multipart のファイルの部分を記憶の中だけで受ける（Werkzeug の既定は大きな部分をディスクの一時ファイルに書く）。
    チャート画像も個人の情報なのでディスクに残さない（Issue #12・ADR-0006。ADR-0005 が multipart を避けた理由を塞ぐ）。
    大きさは入口ごとの上限（routes.read_trade_multipart）で抑える"""

    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return io.BytesIO()


def create_app(
    env: Mapping[str, str] | None = None,
    *,
    store: Store | None = None,
    clock: Callable[[], int] | None = None,
    read_timeout: float | None = None,
) -> Flask:
    """env は環境変数（既定は os.environ）。明細の読み取りの資格情報もここから読む（ADR-0005）。
    read_timeout は読み取りの締め切りの秒数（テスト用。既定は statement_read.app_settings.APP_TIMEOUT_SECONDS）"""
    env = os.environ if env is None else env
    runtime = decide_runtime(env)
    clock = clock or _now_ms
    logs.configure()

    app = Flask(__name__)
    app.request_class = MemoryOnlyRequest
    # 本文の上限（超えたら 413 → 400 に直す）。明細の読み取りの入口だけは画像の上限に上げる（statement_read.py）
    app.config["MAX_CONTENT_LENGTH"] = schema.MAX_BODY_BYTES

    @app.get("/api/health")
    def health():
        # 生存確認だけ。記録（Firestore・Storage）には触れない
        return {"status": "ok"}

    if runtime.mode == "unconfigured":
        app.register_blueprint(make_unconfigured_blueprint())
    else:
        app.register_blueprint(
            make_blueprint(store or FirestoreStore(runtime.project_id), TokenVerifier(runtime), clock,
                           statement_read.read_config(env, read_timeout))
        )

    @app.before_request
    def start_timer():
        g.started = time.perf_counter()

    @app.after_request
    def finish(res: Response) -> Response:
        if request.path.startswith("/api/"):
            res.headers["Cache-Control"] = "no-store"
            res.headers["X-Content-Type-Options"] = "nosniff"
        started = g.get("started")
        logs.log_event(
            event="request",
            method=request.method,
            route=request.url_rule.rule if request.url_rule else None,
            status=res.status_code,
            ms=round((time.perf_counter() - started) * 1000, 1) if started else None,
        )
        return res

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_e):
        return invalid([{"field": "", "kind": "tooLarge"}])

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException):
        code = e.code or 500
        names = {404: "not_found", 405: "method_not_allowed"}
        return error(code, names.get(code, "http_error"))

    @app.errorhandler(StoreUnavailable)
    def store_unavailable(e: StoreUnavailable):
        logs.log_event(event="store_unavailable", exc=str(e))
        return error(503, "unavailable")

    @app.errorhandler(Exception)
    def internal(e: Exception):
        # Flask が例外を自分でログに出す経路を通さない。型の名前だけを残す（文言に中身が入りうる）
        logs.log_event(event="error", route=request.url_rule.rule if request.url_rule else None, exc=type(e).__name__)
        return error(500, "internal")

    return app
