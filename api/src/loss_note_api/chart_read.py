"""根拠の足のチャートの時間足の読み取りの入口 ``POST /api/chart-reads``（Issue #27。設計書 7.5・8.2）。

本文はチャートの画像の生のバイト（``Content-Type: image/png`` か ``image/jpeg``）。明細の読み取りの入口
（``statement_read.py``）と同じ守りと順番で、違うのは読み取りの種類（``statement_read.chart_timeframe.CHART_TASK``）と
応答だけ:

認証（blueprint）→ 資格情報と SDK（503）→ 本文の長さ・形式・寸法（400）→ 資格情報の系統の名前（502）→
``federation`` の ID トークン（502。数えない）→ 1 日の上限の予約（429 / 503。**明細の読み取りと同じ財布**:
利用者ごとの回数・全体の費用を同じ日の文書で合わせて数える。予約額はチャートの種類の額
``ReadLimits.chart_reserve_micro_usd``（指示とツールの定義・最大出力 ``APP_CHART_MAX_OUTPUT_TOKENS`` から出す））
→ 送る → 精算 →
形の検査（502）→ 直し（``chart_timeframe.normalize_chart``）→ 200 ``{"kind": "chart" | "not_chart",
"timeframe": 列挙 | null}``。

上限は #51（ADR-0014）の形のまま明細と共有する: 利用者ごとの回数と費用・全体の費用・バイパスのリスト（バイパスの利用者は
利用者ごとの上限を受けず、全体の上限は受ける）。上限の値の形の誤りは明細と同じく AI を呼ばずに 503 ``read_unavailable``
（ログの理由 ``limit_config`` と誤った変数の名前 ``var`` だけ）。

先立ての CLI（#65・ADR-0013 の ``WarmPool``）は使わず、要求ごとにその場で立てる（ログ ``cli`` = ``cold``）。
先立ては明細の指示・ツールで立ち上げ済みの 1 つだけで、記録する画面を開いたときの準備は明細の読み取りのためのもの。
チャートで使うと明細の読み取りがその場の起動を待つことになり、種類ごとの先立てを持つと待たせる CLI と費用の見積もりが
増える。チャートの
読み取りは入力と並んで進む（読み取り中も欄は入れられる）ので、起動の数秒は 30 秒の予算の中で重なる（ADR-0015）。

画像も結果も保存しない（チャートは [記録する] で取引と一緒に保存する。ここでは読むだけ）。書かれた表記は応答・ログに
出さない（応答は列挙だけ。ログは時間足が読めたかの件数 ``rows`` = 1 / 0 だけ）。
"""

import math
import time
from collections.abc import Callable

from flask import Blueprint, Response, g, jsonify, request
from statement_read import app_settings, image
from statement_read.agent_reader import FEDERATION, Reader, credential_names_in
from statement_read.chart_timeframe import CHART_TASK, normalize_chart
from statement_read.result import Bad
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api import read_limits
from loss_note_api.logs import log_event
from loss_note_api.statement_read import ReadConfig, failure_of, sdk_available
from loss_note_api.store import Store

PATH = "/chart-reads"


def register(
    bp: Blueprint,
    config: ReadConfig,
    store: Store,
    clock: Callable[[], int],
    limits: read_limits.ReadLimits,
) -> None:
    """記録の API の blueprint（認証済み）にチャートの時間足の読み取りの入口を足す。設定・計上の置き場・時刻・上限は
    明細の読み取りと同じものを受ける（同じ財布）"""

    @bp.post(PATH)
    def read_chart():
        started = time.perf_counter()
        timings: dict[str, float] = {}
        tags: dict[str, str] = {"cli": "cold"}  # 先立ては使わない（#65。上の説明）

        def ms_since(t: float) -> float:
            return round((time.perf_counter() - t) * 1000, 1)

        def reply(status: int, body: dict, reason: str, rows: int = 0) -> Response:
            log_event(event="chart_read", reason=reason, rows=rows, ms=ms_since(started), **tags, **timings)
            res = jsonify(body)
            res.status_code = status
            return res

        if not config.usable or not sdk_available():
            return reply(503, {"error": "read_unavailable"}, "unavailable")
        # 上限の値の形の誤り（#51）: 明細と同じく閉じる側（AI を呼ばない・数えない。ログは変数の名前だけ）
        if limits.config_error is not None:
            tags["var"] = limits.config_error
            return reply(503, {"error": "read_unavailable"}, "limit_config")

        # 本文の上限は画像の上限（明細の入口と同じ。分割の本文は上限 + 1 B まで読んで「大きすぎる」を見分ける）
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

        if credential_names_in():
            return reply(502, {"error": "read_failed"}, "credential_env")

        token = None
        if config.credential == FEDERATION and config.identity_token is not None:
            t = time.perf_counter()
            try:
                token = config.identity_token()
            except Exception:  # noqa: BLE001 - 理由の文言・トークンを出さない
                timings["token_ms"] = ms_since(t)
                return reply(502, {"error": "read_failed"}, "identity_token")
            timings["token_ms"] = ms_since(t)

        # 1 日の上限（明細の読み取りと同じ日の文書・同じ判定・同じバイパス。#44・#51・ADR-0010・ADR-0014）
        # 予約額はチャートの額（種類ごとの指示・最大出力から出す。明細より小さい。ADR-0015 の決定 4）
        day = read_limits.jst_day(clock())
        chart_limits = limits.for_chart()
        reserve = chart_limits.reserve_micro_usd
        bypass = read_limits.is_bypass(g.get("claims"), limits)

        def decide(count: int, user_spent: int, spent: int) -> str:
            return read_limits.decide(count, spent, chart_limits, user_spent_micro=user_spent, bypass=bypass)

        t = time.perf_counter()
        try:
            decision = store.reserve_read(g.uid, day, decide, reserve)
        except Exception:  # noqa: BLE001 - 閉じる側（例外の文言は出さない）
            timings["limit_ms"] = ms_since(t)
            return reply(503, {"error": "read_unavailable"}, "limit_unavailable")
        timings["limit_ms"] = ms_since(t)
        if decision != "ok":
            return reply(429, {"error": "read_limited"}, f"limited_{decision}")

        reader = Reader(config.credential, config.values, app_settings.APP_MODEL, app_settings.APP_EFFORT,
                        timeout=config.timeout, max_output_tokens=app_settings.APP_CHART_MAX_OUTPUT_TOKENS,
                        identity_token=token, task=CHART_TASK)
        del token
        t = time.perf_counter()
        outcome = reader.read(data, image.media_type_of(data))
        timings["read_ms"] = ms_since(t)
        api_seconds = outcome.api_seconds
        if isinstance(api_seconds, int | float) and not isinstance(api_seconds, bool) and math.isfinite(api_seconds) \
                and api_seconds >= 0:
            timings["api_ms"] = round(api_seconds * 1000, 1)
        del data
        settled = read_limits.settled_micro(outcome.usage, outcome.sdk_cost_usd, reserve, limits.model)
        try:
            store.settle_read(g.uid, day, settled - reserve)
        except Exception:  # noqa: BLE001 - 応答は変えない（予約額が残る）
            log_event(event="chart_read_settle", reason="unavailable", rows=0, ms=ms_since(started))
        if outcome.result is None or outcome.error is not None:
            status, code, why = failure_of(outcome.error or "no_tool_call")
            return reply(status, {"error": code}, why)
        try:
            body = normalize_chart(outcome.result)
        except (Bad, KeyError):
            return reply(502, {"error": "read_invalid_result"}, "invalid_result")
        return reply(200, body, "ok", rows=1 if body["timeframe"] is not None else 0)
