"""決済明細の読み取りの入口 ``POST /api/statement-reads``（Issue #11・ADR-0005）。

本文は画像の生のバイト（``Content-Type: image/png`` か ``image/jpeg``）。multipart・base64 は使わない（Werkzeug の
multipart は大きな本文をディスクに一時保存しうる。生のバイトは ``get_data`` でメモリだけ）。

順番: 認証（blueprint の ``authenticate``。本文を読む前に 401）→ 資格情報と SDK（503）→ 本文の長さ・形式・寸法（400）→
``federation`` なら ID トークンの取得（取れなければ 502 ``read_failed``。AI を呼ばず数えない。Issue #55）→
1 日の上限の予約（Issue #44・ADR-0010、Issue #51・ADR-0014。利用者ごとの回数・利用者ごとの費用・全体の費用。
バイパスのリストの利用者は全体の費用だけ。越えるなら 429 ``read_limited``、数える場所が使えない・上限の値の形が
誤っていれば 503 ``read_unavailable``。どちらも AI を呼ばない）→ 送る（共有の ``statement_read.agent_reader.Reader``。
指示・画像 1 枚・決まった文・ツール 1 本だけ。最大出力は ``app_settings.APP_MAX_OUTPUT_TOKENS``）→ 精算（実額に直す。
失敗しても応答は変えない = 予約額が残る）→ 形の検査（502）→ 直し（``statement_read.normalize``）→ 200。

資格情報の方式（Issue #55・ADR-0011）は ``STATEMENT_READ_CREDENTIAL``（``api_key`` 既定 / ``oauth_token`` /
``federation``）。起動の種類（手元 / 本番）で方式を制限しない（本番の ``oauth_token`` はオーナーだけが使う間に限る。
設計書 8.2）。子（CLI）に渡る環境は方式ごとの許可リスト（``statement_read.agent_reader.child_env``）で、
選ばなかった方式の変数は子に名前ごと無い。

画像も結果も保存しない（記録の保存先・Storage に触れない。CLI の一時ディレクトリは要求ごとに作って消す）。応答と
ログに画像の中身・結果の値・資格情報・送り先の文言を出さない（失敗は決まった符号だけ）。

ログの時間の内訳（Issue #60。その段まで進んだときだけ出す）: ``token_ms`` = federation の ID トークンの取得・
``limit_ms`` = 1 日の上限の予約（Firestore のトランザクション）・``read_ms`` = 送り口の全体（CLI の起動・資格情報の
交換・AI の API・後始末）・``api_ms`` = CLI が報告する AI の API の時間（``read_ms - api_ms`` がおおよそ CLI の側の
時間）。``cli`` = 先立ての CLI を使ったか（``warm`` / ``cold``。#65。先立てを取ったが画像を送る前に失敗して
その場で立て直した回は ``cold_retry``。その回の ``wait_ms`` は先立てを取った時刻から数える。#99）。送り口の段ごとの
時間（#99。進んだ段だけ。``statement_read.agent_reader.Stages``）: ``wait_ms`` = CLI が画像を受け取れるまで（先立ての
立ち上がりの残り・その場で立てた起動）・``first_ms`` = 画像を渡してから CLI の最初の message まで・``result_ms`` =
結果まで・``turn_ms`` = CLI が報告するターンの時間・``close_ms`` = 結果から CLI が終わって一時ディレクトリを消すまで
（``read_ms`` ≈ ``wait_ms`` + ``result_ms`` + ``close_ms``）。

先立ての印（#99 の続き）: ``warm`` = 先立てを使えなかった理由（``none`` = 立てていない・``used`` = 最後の
先立ては前の読み取りが取って画像を送った・``retried`` = 前の読み取りが取ったが画像を送る前に失敗した（その回は
``cli=cold_retry``）・``expired``・``startup_timeout`` = 立ち上がる前に起動の上限を過ぎた・``start_failed``・
``ended`` = 立ち上がった後に CLI が自分で終わった・``closed``）、``warm_from`` = 先立ての出どころ（``startup`` /
``prepare``）、``warm_age_ms`` = 先立てを作ってからこの読み取りまで、``warm_ready_ms`` = 作ってから立ち上がるまで、
``warm_end_ms`` = 作ってから終わるまで。取られずに終わった先立ては、終わったときに ``event=statement_read_warm_end``
（``warm``・``warm_from``・``warm_end_ms``・``warm_ready_ms``）を 1 行出す（CPU が絞られている間に過ぎた締め切りは、
次に CPU が割り当てられたときに取り消されるので、ログの時刻と ``warm_end_ms`` で見分けられる）。

明細の特徴（Issue #66・ADR-0017）: 検査を通った結果の会社の名前（``issuer``）を ``statement_profile.profile_key`` で
利用者ごとの鍵に変え、名前はすぐ捨てる（応答・ログ・保存先に出さない）。鍵があれば覚え
``users/{uid}/statement_profiles/{鍵}`` を 1 つ読み（書かない）、応答に ``profile: {key, accountId}``（鍵が無ければ
null、覚えが無い・読めなければ accountId = null。読めなくても 200 のまま）を足す。ログは ``profile`` =
``hit`` / ``miss`` / ``none`` / ``unavailable`` だけ（鍵・名前・口座を出さない）。

先立ての CLI（Issue #65・ADR-0013・``statement_read.warm``）: 起動の段（``app.py`` の準備）と準備の要求
``POST /api/statement-reads/prepare`` のときだけ、CLI を 1 つ先に起動して待たせる。読み取りは先立てがあれば使い
（1 回で捨てる）、無い・期限切れ・画像を送る前に失敗したら、残りの時間でその場で立てる（AI へ送るのは 1 回）。
準備の要求は AI を呼ばず、1 日の上限に数えない（認証・許可リストは blueprint の門のまま）。応答は 200
``{"ready": bool}``（使えない設定・SDK なしは 503 ``read_unavailable``）。立ち上がったら、CLI の CPU の使用が静まるまで
最大 ``app_settings.APP_WARM_SETTLE_SECONDS`` 秒待ってから返す（#99。CLI の残りの起動の仕事を、CPU が割り当てられて
いるこの要求の中で済ませる）。ログは ``event=statement_read_prepare``・``reason``（``ok`` / ``not_ready`` /
``limit_config`` / ``ended`` = 静まりを待つ間に CLI が終わった）・``ms``・``settle_ms``（静まりを待ったミリ秒。
測れない・同じ先立てで静まり済みなら 0）だけ（``limit_config`` のときは誤っている上限の環境変数の名前 ``var`` も。
値は出さない。#51）。
"""

import math
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from flask import Blueprint, Response, g, jsonify, request
from statement_read import app_settings, image
from statement_read.agent_reader import (
    FEDERATION,
    NoCredential,
    Reader,
    ReadOutcome,
    credential_names_in,
    credential_values,
)
from statement_read.normalize import normalize_result
from statement_read.result import Bad
from statement_read.warm import WarmEnd, WarmPool
from werkzeug.exceptions import RequestEntityTooLarge

from loss_note_api import identity_token as id_token
from loss_note_api import read_limits, statement_profile
from loss_note_api.logs import log_event
from loss_note_api.store import Store

PATH = "/statement-reads"
PREPARE_PATH = "/statement-reads/prepare"
# 資格情報の方式の切り替え（api_key = ANTHROPIC_API_KEY〔既定〕/ oauth_token = CLAUDE_CODE_OAUTH_TOKEN /
# federation = ANTHROPIC_FEDERATION_RULE_ID・ANTHROPIC_ORGANIZATION_ID〔任意で SA の ID・ワークスペースの ID〕と
# ID トークン）
CREDENTIAL_SWITCH = "STATEMENT_READ_CREDENTIAL"
DEFAULT_CREDENTIAL = "api_key"
_EMPTY: Mapping[str, str] = MappingProxyType({})


@dataclass(frozen=True)
class ReadConfig:
    """読み取りの設定。credential が None なら使えない（503）。values（方式の変数の名前 → 値）と ID トークンの取り方は
    repr に出さない。identity_token は federation のときだけ（要求ごとに呼ぶ）"""

    credential: str | None
    values: Mapping[str, str] = field(default=_EMPTY, repr=False)
    timeout: float = app_settings.APP_TIMEOUT_SECONDS
    identity_token: Callable[[], str] | None = field(default=None, repr=False, compare=False)
    # 先立ての CLI（#65）。使える設定のときだけ（作るだけでは CLI を起動しない）
    warm: WarmPool | None = field(default=None, repr=False, compare=False)

    @property
    def usable(self) -> bool:
        if self.credential is None or not self.values:
            return False
        return self.credential != FEDERATION or self.identity_token is not None


def read_config(
    env: Mapping[str, str],
    timeout: float | None = None,
    *,
    mode: str,
    identity_token: Callable[[], str] | None = None,
) -> ReadConfig:
    """環境変数 → 読み取りの設定。切り替えの値が不明・選んだ方式の必須の値が空なら使えない設定（値は持たない）。
    mode は起動の種類（runtime.decide_runtime。必須・既定なし。渡し忘れで手元の扱いにならないように）。
    方式は起動の種類で制限しない（#55）。identity_token は federation の ID トークンの取り方
    （テスト用。既定はメタデータ サーバー）"""
    del mode  # 方式を起動の種類で制限しない（#55・ADR-0011）。呼び出しの形は保つ
    t = app_settings.APP_TIMEOUT_SECONDS if timeout is None else timeout
    kind = env.get(CREDENTIAL_SWITCH) or DEFAULT_CREDENTIAL
    try:
        values = credential_values(kind, env)
    except NoCredential:
        return ReadConfig(None, _EMPTY, t)
    fetch = (identity_token or id_token.fetch_gcp_identity_token) if kind == FEDERATION else None
    frozen = MappingProxyType(dict(values))
    warm = WarmPool(kind, frozen, app_settings.APP_MODEL, app_settings.APP_EFFORT, timeout=t,
                    max_output_tokens=app_settings.APP_MAX_OUTPUT_TOKENS, identity_token=fetch,
                    ttl=app_settings.APP_WARM_TTL_SECONDS, startup=app_settings.APP_WARM_STARTUP_SECONDS,
                    on_end=log_warm_end)
    return ReadConfig(kind, frozen, t, fetch, warm)


def log_warm_end(end: WarmEnd) -> None:
    """読み取りに取られずに終わった先立ての印（#99 の続き）。終わり方・出どころ・作ってから終わるまで・立ち上がるまで
    （立ち上がらなかったら出さない）だけ。ログの時刻が終わった時刻"""
    extra: dict[str, float] = {} if end.ready_ms is None else {"warm_ready_ms": end.ready_ms}
    log_event(event="statement_read_warm_end", warm=end.kind, warm_from=end.origin, warm_end_ms=end.end_ms,
              **extra)


# 先立ての印（attempt の鍵 → ログの鍵。#99 の続き）
_WARM_TAGS = {"miss": "warm", "origin": "warm_from"}
_WARM_TIMINGS = {"age_ms": "warm_age_ms", "ready_ms": "warm_ready_ms", "end_ms": "warm_end_ms"}


def sdk_available() -> bool:
    """claude_agent_sdk を import できるか（依存グループ ai。確認コマンド・CI では入れない）"""
    try:
        import claude_agent_sdk  # noqa: F401
    except ImportError:
        return False
    return True


# 送り口の失敗 → (状態, 符号, ログの理由)
def failure_of(error: str) -> tuple[int, str, str]:
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

    @bp.post(PREPARE_PATH)
    def prepare_statement_read():
        # 読み取りの準備（#65）: 先立ての CLI を立て、立ち上がるまで待つ。AI を呼ばず、上限に数えない
        started = time.perf_counter()

        def reply(status: int, body: dict, reason: str, **extra: str | float) -> Response:
            log_event(event="statement_read_prepare", reason=reason,
                      ms=round((time.perf_counter() - started) * 1000, 1), **extra)
            res = jsonify(body)
            res.status_code = status
            return res

        if not config.usable or config.warm is None or not sdk_available():
            return reply(503, {"error": "read_unavailable"}, "unavailable")
        # 上限の値の形の誤り（#51）は読み取りと同じく 503（CLI を立てない。利用者の上限は AI を呼ばないので見ない）
        if limits.config_error is not None:
            return reply(503, {"error": "read_unavailable"}, "limit_config", var=limits.config_error)
        # 立ち上がった後、CLI の残りの起動の仕事が静まるまで待つ（#99。待った時間は settle_ms。測れなければ 0）
        # 待つ間に CLI が自分で終わったら ready = false・reason = ended（立ち上がらなかった not_ready と分ける）
        p = config.warm.prepare_settled(app_settings.APP_WARM_STARTUP_SECONDS, app_settings.APP_WARM_SETTLE_SECONDS)
        reason = "ok" if p.ready else ("ended" if p.ended else "not_ready")
        return reply(200, {"ready": p.ready}, reason, settle_ms=p.settle_ms)

    @bp.post(PATH)
    def read_statement():
        started = time.perf_counter()
        timings: dict[str, float] = {}  # 段ごとの時間（#60。ログの鍵 → ミリ秒）
        tags: dict[str, str] = {}  # 先立てを使ったか（#65。cli = warm / cold）

        def ms_since(t: float) -> float:
            return round((time.perf_counter() - t) * 1000, 1)

        def elapsed() -> float:
            return ms_since(started)

        def reply(status: int, body: dict, reason: str, rows: int = 0) -> Response:
            log_event(event="statement_read", reason=reason, rows=rows, ms=elapsed(), **tags, **timings)
            res = jsonify(body)
            res.status_code = status
            return res

        if not config.usable or not sdk_available():
            return reply(503, {"error": "read_unavailable"}, "unavailable")
        # 上限の値の形の誤り（#51）: 既定値に戻さず閉じる側（AI を呼ばない・数えない）。ログには誤っている環境変数の
        # 名前だけ（値は出さない）
        if limits.config_error is not None:
            tags["var"] = limits.config_error
            return reply(503, {"error": "read_unavailable"}, "limit_config")

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

        # 親の環境に資格情報の系統の名前が残っていたら送らない（#55。入口で外していない起動。数えない）
        if credential_names_in():
            return reply(502, {"error": "read_failed"}, "credential_env")

        # federation（#55）: 要求ごとに ID トークンを取る。取れなければ AI を呼ばず、数えない（記録は手で続けられる）
        token = None
        if config.credential == FEDERATION and config.identity_token is not None:
            t = time.perf_counter()
            try:
                token = config.identity_token()
            except Exception:  # noqa: BLE001 - 理由の文言・トークンを出さない
                timings["token_ms"] = ms_since(t)
                return reply(502, {"error": "read_failed"}, "identity_token")
            timings["token_ms"] = ms_since(t)

        # 1 日の上限（#44）: AI へ送る要求だけを数える（ここより前の 401・503・400 は数えない）。
        # 数える場所が使えなければ閉じる側（AI を呼ばない）。理由（回数 / 費用）は応答に出さず、ログの理由だけで分ける
        day = read_limits.jst_day(clock())
        reserve = limits.reserve_micro_usd
        bypass = read_limits.is_bypass(g.get("claims"), limits)  # #51: 利用者ごとの上限を受けない（全体は受ける）

        def decide(count: int, user_spent: int, spent: int) -> str:
            return read_limits.decide(count, spent, limits, user_spent_micro=user_spent, bypass=bypass)

        t = time.perf_counter()
        try:
            decision = store.reserve_read(g.uid, day, decide, reserve)
        except Exception:  # noqa: BLE001 - つながらない・権限・競合のどれでも閉じる側（例外の文言は出さない）
            timings["limit_ms"] = ms_since(t)
            return reply(503, {"error": "read_unavailable"}, "limit_unavailable")
        timings["limit_ms"] = ms_since(t)
        if decision != "ok":
            return reply(429, {"error": "read_limited"}, f"limited_{decision}")

        media_type = image.media_type_of(data)
        t = time.perf_counter()
        taken_at = time.monotonic()  # 段の時間の起点（#99。Stages の時計）
        # 先立てがあれば使う（1 回で捨てる。#65）。無い・送る前に失敗したら、残りの時間でその場で立てる。
        # 先立てを取ったが送る前に失敗した回は cli = cold_retry（純粋な cold と見分ける。#99）
        attempt: dict[str, object] = {}
        outcome = config.warm.read(data, media_type, token, attempt=attempt) if config.warm is not None else None
        if outcome is not None:
            tags["cli"] = "warm"
        else:
            tags["cli"] = "cold_retry" if attempt.get("taken") else "cold"
        # 先立てを使えなかった理由・出どころ・時間（#99 の続き。使えたときも出どころと時間）
        for k, key in _WARM_TAGS.items():
            if isinstance(attempt.get(k), str):
                tags[key] = attempt[k]
        for k, key in _WARM_TIMINGS.items():
            if isinstance(attempt.get(k), int | float):
                timings[key] = attempt[k]
        if outcome is None:
            remaining = config.timeout - (time.perf_counter() - t)
            if remaining <= 0:
                outcome = ReadOutcome(result=None, seconds=None, error="timeout")
            else:
                reader = Reader(config.credential, config.values, app_settings.APP_MODEL, app_settings.APP_EFFORT,
                                timeout=remaining, max_output_tokens=app_settings.APP_MAX_OUTPUT_TOKENS,
                                identity_token=token)
                outcome = reader.read(data, media_type, taken_at=taken_at)
        del token
        timings["read_ms"] = ms_since(t)
        # 送り口の段ごとの時間（#99。wait_ms・first_ms・result_ms・turn_ms・close_ms のうち進んだ段だけ）
        timings.update(outcome.stages)
        api_seconds = outcome.api_seconds
        if isinstance(api_seconds, int | float) and not isinstance(api_seconds, bool) and math.isfinite(api_seconds) \
                and api_seconds >= 0:
            timings["api_ms"] = round(api_seconds * 1000, 1)
        del data
        # 精算: 使ったトークン・SDK の合計額が取れた回は実額に、取れなかった回は予約額のまま。予約した日の文書へ
        # （0:00 をまたいでも同じ日）。失敗しても応答は変えない（予約額が残る = 多めに数える側）
        settled = read_limits.settled_micro(outcome.usage, outcome.sdk_cost_usd, reserve, limits.model)
        try:
            store.settle_read(g.uid, day, settled - reserve)
        except Exception:  # noqa: BLE001 - 応答は変えない（予約額が残る）。例外の文言は出さない
            log_event(event="statement_read_settle", reason="unavailable", rows=0, ms=elapsed())
        if outcome.result is None or outcome.error is not None:
            status, code, why = failure_of(outcome.error or "no_tool_call")
            return reply(status, {"error": code}, why)
        try:
            body = normalize_result(outcome.result)
        except Bad:
            return reply(502, {"error": "read_invalid_result"}, "invalid_result")
        # 明細の特徴（#66）: 会社の名前を鍵に変えて捨てる。覚えが読めなくても読み取りは止めない
        issuer = outcome.result.get("issuer")
        key = statement_profile.profile_key(g.uid, issuer, outcome.result.get("rows") or [])
        del issuer
        outcome.result.pop("issuer", None)
        doc = None
        if key is None:
            tags["profile"] = "none"
        else:
            try:
                doc = store.get_statement_profile(g.uid, key)
                tags["profile"] = "hit" if doc is not None else "miss"
            except Exception:  # noqa: BLE001 - 覚えが読めなくても 200（提案なし）。例外の文言は出さない
                tags["profile"] = "unavailable"
        body["profile"] = statement_profile.profile_response(key, doc)
        return reply(200, body, "ok", rows=len(body["rows"]))
