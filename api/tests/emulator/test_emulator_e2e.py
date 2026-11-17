"""エミュレーターを使う結合のテスト（AC-3・KEEP-1）。``npm run test:api:emulator`` で流す。

- Auth のエミュレーターが発行した本物の（署名の無い）ID トークン + Firestore のエミュレーターで、API が読み書きできる
- 画面（クライアント）から Firestore を直接読み書きできない（ルールはすべて拒否）。
  ログインした利用者の自分の場所でも 403
値はすべて架空（メールは example.com）。
"""

import os

import pytest
from helpers.emulator import PROJECT, clear_auth, clear_firestore, http, require_emulator, sign_up
from helpers.records import t1

from loss_note_api.app import create_app


@pytest.fixture
def emulator():
    auth_host, fs_host = require_emulator()
    clear_firestore(fs_host)
    clear_auth(auth_host)
    return auth_host, fs_host


def test_auth_emulator_token_round_trip(emulator):
    """AC-3: エミュレーターの接続先あり・demo- で、Auth のエミュレーターが出したトークンの uid で作って読み戻せる"""
    auth_host, _ = emulator
    uid, token = sign_up(auth_host, "a@example.com", "synthetic-pass-1")
    _, other_token = sign_up(auth_host, "b@example.com", "synthetic-pass-2")
    app = create_app(dict(os.environ))  # 本物の保存先（FirestoreStore）
    client = app.test_client()
    h = {"Authorization": f"Bearer {token}"}
    res = client.post("/api/instruments", json={"name": "US30", "priceCurrency": "JPY"}, headers=h)
    assert res.status_code == 201
    res = client.post("/api/trades", json=t1(res.get_json()["id"]), headers=h)
    assert res.status_code == 201
    tid = res.get_json()["id"]
    got = client.get(f"/api/trades/{tid}", headers=h)
    assert got.status_code == 200 and got.get_json() == res.get_json()
    # 保存した場所は users/{そのトークンの uid}（エミュレーターの管理の読みで確かめる）
    status, doc = http(
        "GET",
        f"http://{emulator[1]}/v1/projects/{PROJECT}/databases/(default)/documents/users/{uid}/trades/{tid}",
        headers={"Authorization": "Bearer owner"},
    )
    assert status == 200 and doc["name"].endswith(f"/users/{uid}/trades/{tid}")
    # 別の利用者のトークンでは 404
    assert client.get(f"/api/trades/{tid}", headers={"Authorization": f"Bearer {other_token}"}).status_code == 404


def test_rules_deny_own_path(emulator):
    """KEEP-1: ログインした利用者 u1 のトークンで、自分の場所への読み・作成も拒まれる（ルールはすべて拒否）"""
    auth_host, fs_host = emulator
    uid, token = sign_up(auth_host, "rules@example.com", "synthetic-pass-3")
    base = f"http://{fs_host}/v1/projects/{PROJECT}/databases/(default)/documents"
    h = {"Authorization": f"Bearer {token}"}
    assert http("GET", f"{base}/users/{uid}/trades/x", headers=h)[0] == 403
    assert http("POST", f"{base}/users/{uid}/trades?documentId=x", {"fields": {}}, headers=h)[0] == 403
    assert http("GET", f"{base}/users/{uid}/settings/current", headers=h)[0] == 403
    assert http("PATCH", f"{base}/users/{uid}/settings/current", {"fields": {}}, headers=h)[0] == 403
    # 管理者（owner）では読めること（403 がルールによるものだと確かめる）
    assert http("GET", f"{base}/users/{uid}/settings/current", headers={"Authorization": "Bearer owner"})[0] == 404
