"""AI の利用状況の入口 ``GET /api/ai-usage``（Issue #62・ADR-0014）。

本人（ID トークンの uid）の明細の読み取りの日の文書 ``users/{uid}/statement_read_days/{日付}`` を、日本時間の今月
1 日〜今日の範囲で読み（最大 31 件）、今日・今月の回数と金額、本人に効く上限の値、バイパスか、今日の次の読み取りが
本人の上限で止まるかを返す（``read_limits.usage_of``。数え方は 1 日の上限の判定と同じ）。

- 全体の日の文書 ``statement_read_spend/{日付}`` は読まない・返さない（ほかの利用者の使い方が漏れない）。全体の
  上限は設定の値だけ返す
- 書かない（AI を呼ばない・数えない）。認証・許可リストは記録の API の blueprint の門のまま
- 上限の値の形の誤り（#51）は読み取りと同じく 503 ``read_unavailable``（正しい上限が分からないのに割合を出さない）。
  保存先が読めなければ blueprint の 503 ``unavailable``
- 金額は整数の µUSD。方式（``oauth_token`` など）は返さない（どの方式でも従量課金の料金表で換算した額）
- ログは ``event=ai_usage``・``reason``（``ok`` / ``limit_config``）・``ms`` だけ（``limit_config`` のときは誤っている
  環境変数の名前 ``var`` も）。回数・金額・uid・メールは出さない
"""

import time
from collections.abc import Callable

from flask import Blueprint, Response, g, jsonify

from loss_note_api import read_limits
from loss_note_api.logs import log_event
from loss_note_api.store import Store

PATH = "/ai-usage"


def register(bp: Blueprint, store: Store, clock: Callable[[], int], limits: read_limits.ReadLimits) -> None:
    """記録の API の blueprint（認証済み）に使った量の入口を足す。clock は今の時刻（エポックのミリ秒）"""

    @bp.get(PATH)
    def ai_usage():
        started = time.perf_counter()

        def reply(status: int, body: dict, reason: str, **extra: str) -> Response:
            log_event(event="ai_usage", reason=reason, ms=round((time.perf_counter() - started) * 1000, 1), **extra)
            res = jsonify(body)
            res.status_code = status
            return res

        if limits.config_error is not None:
            return reply(503, {"error": "read_unavailable"}, "limit_config", var=limits.config_error)
        today = read_limits.jst_day(clock())
        days = dict(store.read_days_between(g.uid, read_limits.month_first_day(today), today))
        bypass = read_limits.is_bypass(g.get("claims"), limits)
        return reply(200, read_limits.usage_of(today, days, limits, bypass=bypass), "ok")
