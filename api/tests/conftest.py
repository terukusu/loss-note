"""API のテストの土台。

- ``api``: 記録の API を、保存先 2 つ（記憶 ``memory`` / エミュレーターの Firestore ``firestore``）で同じテストを回す
  （``store_kind``）。どちらもエミュレーターモード（署名の無いトークン。``decide_runtime`` が demo- のときだけ選ぶ）
- Firestore の側は ``FIRESTORE_EMULATOR_HOST`` が無ければスキップ。``LOSS_NOTE_REQUIRE_EMULATOR=1``（CI・確認コマンド）
  のときはスキップせずに失敗する（黙って飛ばさない）
- 値はすべて架空。利用者 A・B はテストの中だけの uid
"""

import json
import time

import pytest
from helpers.emulator import PROJECT, clear_firestore, emulator_hosts, require_emulator
from helpers.memory_store import MemoryStore
from helpers.tokens import unsigned_token

from loss_note_api.app import create_app
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR
from loss_note_api.store import FirestoreStore


class ApiClient:
    """利用者ごとのトークンを付けて呼ぶ道具"""

    def __init__(self, app, store, kind: str):
        self.app = app
        self.client = app.test_client()
        self.store = store
        self.kind = kind

    @staticmethod
    def headers(uid: str | None, **token_kw) -> dict:
        if uid is None:
            return {}
        return {"Authorization": f"Bearer {unsigned_token(uid, PROJECT, **token_kw)}"}

    def call(self, method: str, path: str, uid: str | None = None, body=None, *, headers=None, raw=None,
             content_type="application/json"):  # fmt: skip
        h = {**self.headers(uid), **(headers or {})}
        data = raw if raw is not None else (None if body is None else json.dumps(body))
        kw = {"headers": h}
        if data is not None:
            kw["data"] = data
            kw["content_type"] = content_type
        return self.client.open(path, method=method, **kw)

    def get(self, path, uid=None, **kw):
        return self.call("GET", path, uid, **kw)

    def post(self, path, uid=None, body=None, **kw):
        return self.call("POST", path, uid, body, **kw)

    def put(self, path, uid=None, body=None, **kw):
        return self.call("PUT", path, uid, body, **kw)

    def delete(self, path, uid=None, **kw):
        return self.call("DELETE", path, uid, **kw)

    # よく使う組み立て
    def instrument(self, uid: str, name: str = "US30", **over) -> dict:
        res = self.post("/api/instruments", uid, {"name": name, "priceCurrency": "JPY", **over})
        assert res.status_code == 201, res.get_json()
        return res.get_json()

    def trades(self, uid: str) -> list[dict]:
        res = self.get("/api/trades", uid)
        assert res.status_code == 200
        return res.get_json()["items"]


class Clock:
    """今の時刻（ミリ秒）。トークンの exp と比べるので実時間に合わせ、advance で進められる"""

    def __init__(self):
        self.offset = 0

    def __call__(self) -> int:
        return int(time.time() * 1000) + self.offset

    def advance(self, ms: int) -> None:
        self.offset += ms


@pytest.fixture(params=["memory", "firestore"])
def store_kind(request):
    return request.param


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def api(store_kind, monkeypatch, clock):
    if store_kind == "firestore":
        auth_host, fs_host = require_emulator()
        clear_firestore(fs_host)
        store = FirestoreStore(PROJECT)
    else:
        hosts = emulator_hosts()
        auth_host, fs_host = hosts if hosts else ("127.0.0.1:9099", "127.0.0.1:8080")
        store = MemoryStore()
    # firebase-admin は呼ぶたびに環境変数を読むので、プロセスの環境にも入れる（中身はエミュレーターの接続先だけ）
    monkeypatch.setenv(AUTH_EMULATOR, auth_host)
    monkeypatch.setenv(FIRESTORE_EMULATOR, fs_host)
    env = {AUTH_EMULATOR: auth_host, FIRESTORE_EMULATOR: fs_host, "GOOGLE_CLOUD_PROJECT": PROJECT}
    app = create_app(env, store=store, clock=clock)
    return ApiClient(app, store, store_kind)


@pytest.fixture
def memory_api(monkeypatch, clock):
    """記憶の保存先だけ（保存先の失敗を差し込むテスト用）"""
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT}
    store = MemoryStore()
    return ApiClient(create_app(env, store=store, clock=clock), store, "memory")
