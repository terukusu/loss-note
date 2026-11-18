"""エミュレーター（firebase emulators:exec が入れる環境変数）を使うテストの道具。"""

import json
import os
import urllib.parse
import urllib.request

import pytest

from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

PROJECT = "demo-loss-note"
REQUIRE_EMULATOR = os.environ.get("LOSS_NOTE_REQUIRE_EMULATOR") == "1"


def emulator_hosts() -> tuple[str, str] | None:
    auth = os.environ.get(AUTH_EMULATOR)
    fs = os.environ.get(FIRESTORE_EMULATOR)
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT")
    if auth and fs and project == PROJECT:
        return auth, fs
    return None


def require_emulator() -> tuple[str, str]:
    """エミュレーターが無ければスキップ。LOSS_NOTE_REQUIRE_EMULATOR=1（CI・確認コマンド）なら失敗にする"""
    hosts = emulator_hosts()
    if hosts is None:
        if REQUIRE_EMULATOR:
            pytest.fail("LOSS_NOTE_REQUIRE_EMULATOR=1 なのにエミュレーターの接続先がありません")
        pytest.skip("エミュレーターが無い（npm run test:api:emulator で流す）")
    return hosts


def http(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json",
                                                                          **(headers or {})})  # fmt: skip
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            raw = res.read()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else {}
        except ValueError:
            return e.code, {}


def clear_firestore(fs_host: str) -> None:
    http("DELETE", f"http://{fs_host}/emulator/v1/projects/{PROJECT}/databases/(default)/documents")


def clear_auth(auth_host: str) -> None:
    http("DELETE", f"http://{auth_host}/emulator/v1/projects/{PROJECT}/accounts")


def sign_up(auth_host: str, email: str, password: str) -> tuple[str, str]:
    """Auth のエミュレーターに架空の利用者を作り、(uid, idToken) を返す"""
    status, body = http(
        "POST",
        f"http://{auth_host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key",
        {"email": email, "password": password, "returnSecureToken": True},
    )
    assert status == 200, status
    return body["localId"], body["idToken"]


def sign_in_google(auth_host: str, sub: str, email: str) -> tuple[str, str]:
    """Auth のエミュレーターに Google の架空のアカウントでログインし、(uid, idToken) を返す（Issue #43）。
    エミュレーターは署名の無い IdP のトークンを受ける。メールは確かめ済み（email_verified: true）で作る"""
    id_token = json.dumps({"sub": sub, "email": email, "email_verified": True})
    status, body = http(
        "POST",
        f"http://{auth_host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key",
        {
            "postBody": urllib.parse.urlencode({"providerId": "google.com", "id_token": id_token}),
            "requestUri": "http://localhost",
            "returnSecureToken": True,
            "returnIdpCredential": True,
        },
    )
    assert status == 200, status
    return body["localId"], body["idToken"]
