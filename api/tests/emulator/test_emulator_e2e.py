"""エミュレーターを使う結合のテスト（AC-3・KEEP-1）。``npm run test:api:emulator`` で流す。

- Auth のエミュレーターが発行した本物の（署名の無い）ID トークン + Firestore のエミュレーターで、API が読み書きできる
- 画面（クライアント）から Firestore を直接読み書きできない（ルールはすべて拒否）。
  ログインした利用者の自分の場所でも 403。チャート画像の場所 ``users/{uid}/charts`` も同じ（Issue #12 KEEP-3）
- Storage も画面から読み書きできない（ルールはすべて拒否。チャートは Firestore に置き、Storage は使っていない）
- チャートと取引は 1 トランザクション（チャートが書けなければ取引も無い。Issue #12 AC-6）
値はすべて架空（メールは example.com）。
"""

import os
import urllib.error
import urllib.request

import pytest
from helpers.charts import chart_png, png
from helpers.emulator import (
    PROJECT,
    REQUIRE_EMULATOR,
    clear_auth,
    clear_firestore,
    http,
    require_emulator,
    sign_in_google,
    sign_up,
)
from helpers.records import t1

from loss_note_api.allowlist import ALLOWED_EMAILS_VAR
from loss_note_api.app import create_app
from loss_note_api.store import FirestoreStore

STORAGE_EMULATOR = "FIREBASE_STORAGE_EMULATOR_HOST"
BUCKET = f"{PROJECT}.appspot.com"


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


def test_rules_deny_own_charts_path(emulator):
    """Issue #12 KEEP-3: チャート画像の場所も、本人のトークンで読み・書きが 403"""
    auth_host, fs_host = emulator
    uid, token = sign_up(auth_host, "charts@example.com", "synthetic-pass-4")
    base = f"http://{fs_host}/v1/projects/{PROJECT}/databases/(default)/documents"
    h = {"Authorization": f"Bearer {token}"}
    assert http("GET", f"{base}/users/{uid}/charts/x-entry", headers=h)[0] == 403
    assert http("POST", f"{base}/users/{uid}/charts?documentId=x-entry", {"fields": {}}, headers=h)[0] == 403
    assert http("DELETE", f"{base}/users/{uid}/charts/x-entry", headers=h)[0] == 403
    assert http("GET", f"{base}/users/{uid}/charts/x-entry", headers={"Authorization": "Bearer owner"})[0] == 404


def _raw(method: str, url: str, data: bytes | None = None, headers: dict | None = None) -> int:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code


@pytest.fixture
def storage_host():
    host = os.environ.get(STORAGE_EMULATOR)
    if not host:
        if REQUIRE_EMULATOR:
            pytest.fail("LOSS_NOTE_REQUIRE_EMULATOR=1 なのに Storage のエミュレーターの接続先がありません")
        pytest.skip("Storage のエミュレーターが無い（npm run test:api:emulator で流す）")
    return host.removeprefix("http://")


def test_storage_rules_deny_everything(emulator, storage_host):
    """Issue #12 KEEP-3: Firebase の REST で、未認証・本人のトークンとも読み・書きが 403（ルールはすべて拒否）。
    管理の読みは 403 でない（403 がルールによるものだと確かめる）"""
    auth_host, _ = emulator
    uid, token = sign_up(auth_host, "storage@example.com", "synthetic-pass-5")
    name = f"users%2F{uid}%2Fcharts%2Fx-entry.png"
    obj = f"http://{storage_host}/v0/b/{BUCKET}/o/{name}"
    upload = f"http://{storage_host}/v0/b/{BUCKET}/o?name=users%2F{uid}%2Fcharts%2Fx-entry.png"
    for h in ({}, {"Authorization": f"Firebase {token}"}, {"Authorization": f"Bearer {token}"}):
        assert _raw("GET", obj, headers=h) == 403, h
        assert _raw("GET", f"{obj}?alt=media", headers=h) == 403, h
        assert _raw("POST", upload, chart_png(), {**h, "Content-Type": "image/png"}) == 403, h
        assert _raw("DELETE", obj, headers=h) == 403, h
    assert _raw("GET", obj, headers={"Authorization": "Bearer owner"}) == 404


def test_chart_and_trade_are_one_transaction(emulator):
    """Issue #12 AC-6: 1 MiB を超えるチャート（Firestore の 1 文書の上限の外）を取引と一緒に書くと、
    例外になり取引も残らない"""
    store = FirestoreStore(PROJECT)
    uid = "atomicUser"
    store.create_instrument(uid, {"name": "US30", "nameKey": "us30", "priceCurrency": "JPY", "multiplier": 1,
                                  "quantityStep": 1, "underlyingKind": "other", "productForm": "spotCfd",
                                  "createdAt": 1, "updatedAt": 1})  # fmt: skip
    iid = store.list_instruments(uid)[0][0]

    def build(_inst, _settings):
        return {"schemaVersion": 1, "createdAt": 1, "updatedAt": 1, "snapshot": {}, "record": t1(iid)}

    huge = {"contentType": "image/png", "data": png(1200, 800, size=1_100_000)}
    small = {"contentType": "image/png", "data": chart_png()}
    with pytest.raises(Exception):  # noqa: B017 — 型は google の InvalidArgument（保存先の上限）
        store.create_trade(uid, iid, build, {"entry": small, "exit": huge})
    assert store.list_trades(uid) == []
    db = store._db().collection("users").document(uid)
    assert list(db.collection("charts").stream()) == []
    # 上限の内なら 2 枚と取引が一緒に書ける
    tid, _ = store.create_trade(uid, iid, build, {"entry": small, "exit": small})
    assert len(list(db.collection("charts").stream())) == 2
    assert store.delete_trade(uid, tid)
    assert list(db.collection("charts").stream()) == []


def test_allowlist_with_emulator_tokens(emulator):
    """Issue #43 の AC-4（例 A14・A15）: Auth のエミュレーターが出した Google の架空のアカウントのトークンで、
    許可リストの変数が無ければ今のまま 200、変数があれば本番と同じに効く
    （無いアカウントは 403・あるアカウントは 200）"""
    auth_host, _ = emulator
    _, other = sign_in_google(auth_host, "google-sub-other-1", "other@example.com")
    _, owner = sign_in_google(auth_host, "google-sub-owner-1", "owner@example.com")
    env = {k: v for k, v in os.environ.items() if k != ALLOWED_EMAILS_VAR}
    # A14: 変数なし → 制限しない
    open_client = create_app(env).test_client()
    assert open_client.get("/api/trades", headers={"Authorization": f"Bearer {other}"}).status_code == 200
    # A15: 変数 owner@example.com → other は 403（決まった本文）、owner は 200（対照）
    closed = create_app({**env, ALLOWED_EMAILS_VAR: "owner@example.com"}).test_client()
    res = closed.get("/api/trades", headers={"Authorization": f"Bearer {other}"})
    assert res.status_code == 403 and res.get_json() == {"error": "forbidden"}
    assert closed.get("/api/trades", headers={"Authorization": f"Bearer {owner}"}).status_code == 200
