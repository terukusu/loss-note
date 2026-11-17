"""ID トークンの検証（ADR-0004）。

- ``verify``: firebase-admin で署名・kid・alg・iss・aud・exp を検証する（本番と同じ）
- ``emulator``: Auth のエミュレーターの署名の無いトークンを受ける（``decide_runtime`` が demo- のときだけ選ぶ）

どちらも ``check_claims`` で exp と uid の形を重ねて見る（firebase-admin はエミュレーターでは exp を見ない。
エミュレーターでは誰でも sub を作れるので、``/`` を含む uid で他人の場所を指させない）。
firebase-admin の例外の文言にはトークンや aud が入るので、ログにも応答にも出さない（型の名前だけ）。
"""

import math
import os
import re
from collections.abc import Mapping

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials
from google.auth.credentials import AnonymousCredentials

from loss_note_api.runtime import AUTH_EMULATOR, Runtime

# Firestore は __x__ の形の文書 ID を予約しているので受けない（エミュレーターでは誰でも sub を作れる）
UID_PATTERN = re.compile(r"^(?!__.*__$)[A-Za-z0-9_-]{1,128}$")
_BEARER = re.compile(r"^[Bb][Ee][Aa][Rr][Ee][Rr] ([A-Za-z0-9\-_.=]+)$")
_MAX_TOKEN = 8192


class InvalidToken(Exception):
    """検証に失敗した。reason は型の名前など、トークンの中身を含まない短い語"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class AuthUnavailable(Exception):
    """公開鍵を取れない（こちらの都合。401 にせず 503 にする）"""


def bearer_token(header: str | None) -> str | None:
    if not header or len(header) > _MAX_TOKEN + 7:
        return None
    m = _BEARER.match(header)
    return m.group(1) if m else None


def check_claims(claims: Mapping[str, object], now_ms: int) -> str:
    exp = claims.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, int | float) or not math.isfinite(exp):
        raise InvalidToken("exp")
    if exp * 1000 <= now_ms:
        raise InvalidToken("expired")
    uid = claims.get("sub")
    if not isinstance(uid, str) or not UID_PATTERN.match(uid):
        raise InvalidToken("uid")
    if "uid" in claims and claims["uid"] != uid:
        raise InvalidToken("uid")
    return uid


class _NoCredential(credentials.Base):
    """検証に資格情報は要らない（公開鍵は公開の URL から取る）。ADC を探しに行かないための空の資格情報"""

    def get_credential(self):
        return AnonymousCredentials()


class TokenVerifier:
    def __init__(self, runtime: Runtime):
        if runtime.mode not in ("verify", "emulator"):
            raise ValueError("verify か emulator のときだけ作る")
        self._mode = runtime.mode
        self._project_id = runtime.project_id
        self._client = None

    def _auth_client(self):
        if self._client is None:
            name = f"loss-note-{self._mode}-{self._project_id}"
            try:
                app = firebase_admin.get_app(name)
            except ValueError:
                app = firebase_admin.initialize_app(
                    _NoCredential(), options={"projectId": self._project_id}, name=name
                )
            self._client = fb_auth.Client(app)
        return self._client

    def verify(self, token: str, now_ms: int) -> str:
        # firebase-admin は呼ぶたびに環境変数でエミュレーターかを決める。起動の判定と食い違えば受けない
        emulated_now = bool(os.environ.get(AUTH_EMULATOR))
        if emulated_now != (self._mode == "emulator"):
            raise InvalidToken("auth_mode_mismatch")
        try:
            claims = self._auth_client().verify_id_token(token)
        except fb_auth.CertificateFetchError as e:
            raise AuthUnavailable(type(e).__name__) from None
        except Exception as e:  # noqa: BLE001 - 文言にトークンが入るので型の名前だけを残す
            raise InvalidToken(type(e).__name__) from None
        return check_claims(claims, now_ms)
