"""テストの ID トークン（値はすべて架空）。

- ``unsigned_token``: Auth のエミュレーターが出すのと同じ、署名の無いトークン（alg: none）
- ``signed_token``: テスト用の RSA 鍵で RS256 に署名したトークン。公開鍵の取得は ``patch_certs`` で差し替え、
  ネットワークに出ない
"""

import base64
import json
import time

import google.oauth2.id_token
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt
from google.auth import jwt as gjwt

TEST_KID = "test-kid"

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIVATE_PEM = _key.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
_PUBLIC_PEM = _key.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def claims(uid: str, project_id: str, *, email: str | None = None, exp_offset: int = 3600, **extra) -> dict:
    now = int(time.time())
    body = {
        "iss": f"https://securetoken.google.com/{project_id}",
        "aud": project_id,
        "auth_time": now - 10,
        "user_id": uid,
        "sub": uid,
        "iat": now - 10,
        "exp": now + exp_offset,
        "firebase": {"identities": {}, "sign_in_provider": "password"},
    }
    if email is not None:
        body["email"] = email
    body.update(extra)
    return body


def unsigned_token(uid: str, project_id: str = "demo-loss-note", **kw) -> str:
    header = {"alg": "none", "typ": "JWT"}
    payload = claims(uid, project_id, **kw)
    return f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}."


def signed_token(uid: str, project_id: str, *, kid: str = TEST_KID, **kw) -> str:
    signer = crypt.RSASigner.from_string(_PRIVATE_PEM, key_id=kid)
    return gjwt.encode(signer, claims(uid, project_id, **kw)).decode()


def patch_certs(monkeypatch, *, forbid: bool = False) -> list[str]:
    """公開鍵の取得を差し替える。forbid=True なら呼ばれたら失敗する（取得の前に拒むことを確かめる）"""
    calls: list[str] = []

    def fake(_request, certs_url):
        calls.append(certs_url)
        if forbid:
            raise AssertionError("公開鍵を取りに行った")
        return {TEST_KID: _PUBLIC_PEM}

    monkeypatch.setattr(google.oauth2.id_token, "_fetch_certs", fake)
    return calls


def cert_body() -> dict[str, str]:
    """公開鍵の応答の本文（kid → PEM）。手元の HTTP サーバーで配るとき用（#60）"""
    return {TEST_KID: _PUBLIC_PEM}


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
