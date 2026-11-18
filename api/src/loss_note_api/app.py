"""Flask アプリの入口。

手元の起動: ``npm run dev:api``（エミュレーターに向けた環境変数を付けて
``uv run flask --app loss_note_api.app:create_app run -p 8000`` を動かす。画面の開発サーバーが /api をここへ渡す）。

起動の判定は ``runtime.decide_runtime``（ADR-0004）。エミュレーターの接続先があるのにプロジェクト ID が
``demo-`` で始まらない設定では ``StartupRefused`` を投げ、アプリを返さない。

本番（Issue #42・ADR-0009）はイメージの gunicorn が ``create_app()`` を呼ぶ。環境変数 ``STATIC_DIR``
（画面のビルド成果物の置き場）があるときだけ画面の静的ファイルも配る（``web.py``）。すべての応答に
CSP の土台と ``nosniff``・``no-referrer`` を付ける。

ログイン（Issue #43・ADR-0003「縦切り 2 で決めたこと」）: 署名を検証する起動では、``FIREBASE_AUTH_DOMAIN`` が
あるときだけ CSP に Google ログインのポップアップの許可を足す（形が合わなければ起動しない）。使える利用者の許可リスト
``LOSS_NOTE_ALLOWED_EMAILS``（``allowlist.py``）は起動時に 1 回読み、記録の API の入口で見る。
"""

import io
import os
import time
from collections.abc import Callable, Mapping

from flask import Flask, Request, Response, g, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from loss_note_api import allowlist, logs, schema, statement_read, web
from loss_note_api.auth import TokenVerifier
from loss_note_api.read_limits import ReadLimits
from loss_note_api.routes import error, invalid, make_blueprint, make_unconfigured_blueprint
from loss_note_api.runtime import StartupRefused, decide_runtime
from loss_note_api.store import FirestoreStore, Store, StoreUnavailable


def _now_ms() -> int:
    return int(time.time() * 1000)


class MemoryOnlyRequest(Request):
    """multipart のファイルの部分を記憶の中だけで受ける（Werkzeug の既定は大きな部分をディスクの一時ファイルに書く）。
    チャート画像も個人の情報なのでディスクに残さない（Issue #12・ADR-0006。ADR-0005 が multipart を避けた理由を塞ぐ）。
    大きさは入口ごとの上限（routes.read_trade_multipart）で抑える"""

    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return io.BytesIO()


def _login_csp(mode: str, env: Mapping[str, str]) -> dict[str, tuple[str, ...]] | None:
    """署名を検証する起動で authDomain があるときだけ、Google ログインの許可（手元の画面は Vite が配るので要らない）"""
    auth_domain = env.get(web.AUTH_DOMAIN_VAR) or ""
    if mode != "verify" or not auth_domain:
        return None
    try:
        return web.login_csp_extra(auth_domain)
    except ValueError:
        raise StartupRefused(
            f"{web.AUTH_DOMAIN_VAR} はホスト名の形（例: <PROJECT_ID>.firebaseapp.com）で書いてください"
        ) from None


def create_app(
    env: Mapping[str, str] | None = None,
    *,
    store: Store | None = None,
    clock: Callable[[], int] | None = None,
    read_timeout: float | None = None,
    read_limits: ReadLimits | None = None,
) -> Flask:
    """env は環境変数（既定は os.environ）。明細の読み取りの資格情報もここから読む（ADR-0005）。
    read_timeout は読み取りの締め切りの秒数（テスト用。既定は statement_read.app_settings.APP_TIMEOUT_SECONDS）。
    read_limits は読み取りの 1 日の上限（テスト用。既定は read_limits.ReadLimits() = 30 回・2.00 USD。#44）"""
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
                           statement_read.read_config(env, read_timeout, mode=runtime.mode),
                           allowed=allowlist.policy_for(runtime.mode, env), read_limits=read_limits)
        )

    # 画面の静的ファイル（STATIC_DIR があるときだけ。無ければ今のまま = /api 以外は 404 の JSON）
    static_dir = env.get(web.STATIC_DIR_VAR) or ""
    site = web.register_static(app, static_dir) if static_dir else None
    headers = web.security_headers(web.build_csp(web.BASE_CSP, _login_csp(runtime.mode, env)))

    @app.before_request
    def start_timer():
        g.started = time.perf_counter()

    @app.after_request
    def finish(res: Response) -> Response:
        if request.path == "/api" or request.path.startswith("/api/"):
            res.headers["Cache-Control"] = "no-store"
        # すべての応答（静的ファイル・404・500 を含む）
        res.headers.update(headers)
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
        # 画面の URL（ADR-0002）: どのルールにも当たらない GET / HEAD で /api・/assets の配下でなければ index.html
        if code == 404 and site is not None and request.method in ("GET", "HEAD") and web.is_spa_path(request.path):
            return site.index()
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
