"""起動の段の準備（Issue #60。AC-2〜AC-7・KEEP-1・KEEP-4）。値はすべて架空。

公開鍵は手元の HTTP サーバー（127.0.0.1）で配り、firebase-admin の実物（cachecontrol の session）を通す。
ネットワークの外には出ない。
"""

import http.server
import json
import threading

import firebase_admin
import pytest
from firebase_admin import _token_gen
from firebase_admin import auth as fb_auth
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, cert_body, patch_certs, signed_token, unsigned_token
from statement_read.agent_reader import credential_names_in

from loss_note_api import statement_read, store, warmup
from loss_note_api.app import create_app
from loss_note_api.auth import TokenVerifier
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR, Runtime

PROD = "example-prod"
DEMO = "demo-loss-note"
EMAIL = "fictional.owner@example.com"
UID = "warmUser1"
EMULATOR_VARS = (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST")
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
WARM_KEYS = {"event", "reason", "ms", "store_ms", "auth_ms"}


class CertServer:
    """公開鍵を配る手元の HTTP サーバー。GET の回数を数える。status を変えると失敗を返す"""

    def __init__(self):
        self.hits = 0
        self.status = 200
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 - http.server の名前
                owner.hits += 1
                body = json.dumps(cert_body()).encode() if owner.status == 200 else b"{}"
                self.send_response(owner.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "public, max-age=3600")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}/certs"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def close(self):
        self._server.shutdown()
        self._server.server_close()


@pytest.fixture
def certs(monkeypatch):
    # firebase-admin は TokenVerifier を作るときにこの URL を読む（検証と準備が同じ URL を使う）
    server = CertServer()
    monkeypatch.setattr(_token_gen, "ID_TOKEN_CERT_URI", server.url)
    for name in PROXY_VARS:
        monkeypatch.delenv(name, raising=False)
    yield server
    server.close()


@pytest.fixture
def prod_env(monkeypatch):
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    # firebase-admin のアプリは process の中で名前ごとに 1 つ。テストごとに作り直す
    # （公開鍵の URL・キャッシュを持ち越さない）
    _drop_firebase_apps()
    yield {"GOOGLE_CLOUD_PROJECT": PROD, "LOSS_NOTE_ALLOWED_EMAILS": EMAIL}
    _drop_firebase_apps()


def _drop_firebase_apps():
    for name in (f"loss-note-verify-{PROD}", f"loss-note-emulator-{DEMO}"):
        try:
            firebase_admin.delete_app(firebase_admin.get_app(name))
        except ValueError:
            pass


@pytest.fixture
def sdk_calls(monkeypatch):
    calls = []

    def fake():
        calls.append(1)
        return True

    monkeypatch.setattr(statement_read, "sdk_available", fake)
    return calls


def warm_lines(capfd) -> list[dict]:
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    return [ln for ln in lines if ln.get("event") == "warmup"]


def owner_token() -> str:
    return signed_token(UID, PROD, email=EMAIL, email_verified=True)


# ── AC-2・AC-3: 起動で 1 回ずつ・先取りした公開鍵を検証が使う ──
def test_start_warms_each_once_before_requests(prod_env, certs, sdk_calls, capfd):
    records = MemoryStore()
    app = create_app({**prod_env, "ANTHROPIC_API_KEY": "sk-fictional"}, store=records, warm=True)
    # 要求の前
    assert records.warm_calls == 1
    assert certs.hits == 1
    assert sdk_calls == [1]
    lines = warm_lines(capfd)
    assert len(lines) == 1 and lines[0]["reason"] == "ok"
    assert set(lines[0]) == WARM_KEYS | {"sdk_ms"}
    assert all(isinstance(lines[0][k], int | float) for k in ("ms", "store_ms", "auth_ms", "sdk_ms"))

    # AC-3: 最初の検証は公開鍵を取りに行かない（cachecontrol のキャッシュ = 検証と同じ置き場）
    res = app.test_client().get("/api/trades", headers=bearer(owner_token()))
    assert res.status_code == 200
    assert certs.hits == 1
    assert records.warm_calls == 1


def test_without_warm_the_first_verify_fetches(prod_env, certs):
    # 対照: 準備をしない起動では最初の検証が公開鍵を取りに行く（AC-3 の差がキャッシュによることの確かめ）
    app = create_app(prod_env, store=MemoryStore(), warm=False)
    assert certs.hits == 0
    assert app.test_client().get("/api/trades", headers=bearer(owner_token())).status_code == 200
    assert certs.hits == 1


# ── AC-4: 失敗しても起動し、最初の要求で作り直す ──
def test_store_warm_failure_does_not_stop_start(prod_env, certs, capfd):
    records = MemoryStore()
    records.fail_warm = RuntimeError("fictional users/x/trades/y unreachable")
    app = create_app(prod_env, store=records, warm=True)
    lines = warm_lines(capfd)
    assert [ln["reason"] for ln in lines] == ["store"]
    assert "users/x" not in json.dumps(lines)  # 例外の文言を出さない
    client = app.test_client()
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/trades", headers=bearer(owner_token())).status_code == 200


def test_cert_fetch_failure_does_not_stop_start(prod_env, certs, capfd):
    certs.status = 503
    app = create_app(prod_env, store=MemoryStore(), warm=True)
    assert [ln["reason"] for ln in warm_lines(capfd)] == ["auth"]
    client = app.test_client()
    assert client.get("/api/health").status_code == 200
    # 最初の要求で取り直す（503 の応答はキャッシュされない）
    certs.status = 200
    assert client.get("/api/trades", headers=bearer(owner_token())).status_code == 200
    assert certs.hits == 2


def test_firestore_client_failure_is_retried(monkeypatch):
    # 実物の FirestoreStore: 準備でクライアントを作れなくても、次の呼び出しで作り直す（None のまま残す）
    from google.cloud import firestore

    made = []

    class Flaky:
        def __init__(self, project):
            made.append(project)
            if len(made) == 1:
                raise RuntimeError("no credentials (fictional)")

    monkeypatch.setattr(firestore, "Client", Flaky)
    fs = store.FirestoreStore(PROD)
    assert warmup.run([("store", fs.warm)]) == ["store"]
    assert isinstance(fs._db(), Flaky)
    assert made == [PROD, PROD]


def test_all_steps_fail_and_start_still_returns(prod_env, certs, sdk_calls, monkeypatch, capfd):
    def boom():
        raise RuntimeError("fictional")

    monkeypatch.setattr(statement_read, "sdk_available", boom)
    certs.status = 500
    records = MemoryStore()
    records.fail_warm = RuntimeError("fictional")
    app = create_app({**prod_env, "ANTHROPIC_API_KEY": "sk-fictional"}, store=records, warm=True)
    assert [ln["reason"] for ln in warm_lines(capfd)] == ["store+auth+sdk"]
    assert app.test_client().get("/api/health").status_code == 200


# ── AC-5: 同時の最初の要求で 2 度作らない ──
def test_firestore_client_made_once_under_concurrency(monkeypatch):
    from google.cloud import firestore

    made = []
    gate = threading.Barrier(8)

    class Slow:
        def __init__(self, project):
            made.append(project)
            threading.Event().wait(0.05)

    monkeypatch.setattr(firestore, "Client", Slow)
    fs = store.FirestoreStore(PROD)
    got = []

    def call():
        gate.wait()
        got.append(fs._db())

    threads = [threading.Thread(target=call) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(made) == 1 and len({id(c) for c in got}) == 1


def test_first_requests_concurrently_make_one_verifier(prod_env, monkeypatch):
    # エミュレーターの起動（署名の無いトークン）で、準備をしない起動に 8 件同時に来ても、検証器は 1 回・500 は 0 件
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    made = []
    real = fb_auth.Client

    def counting(app):
        made.append(1)
        threading.Event().wait(0.05)
        return real(app)

    monkeypatch.setattr(fb_auth, "Client", counting)
    env = {"GOOGLE_CLOUD_PROJECT": DEMO, AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080"}
    app = create_app(env, store=MemoryStore(), warm=False)
    gate = threading.Barrier(8)
    statuses = []

    def call():
        client = app.test_client()
        gate.wait()
        statuses.append(client.get("/api/trades", headers=bearer(unsigned_token(UID, DEMO))).status_code)

    threads = [threading.Thread(target=call) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert statuses == [200] * 8
    assert len(made) == 1


# ── AC-6: エミュレーターは公開鍵を取りに行かない・資格情報の無い起動は SDK を読み込まない ──
def test_emulator_start_does_not_fetch_certs_and_no_sdk_without_credential(prod_env, monkeypatch, sdk_calls, capfd):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    patch_certs(monkeypatch, forbid=True)
    env = {"GOOGLE_CLOUD_PROJECT": DEMO, AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080"}
    records = MemoryStore()
    create_app(env, store=records, warm=True)
    lines = warm_lines(capfd)
    assert [ln["reason"] for ln in lines] == ["ok"]
    assert set(lines[0]) == WARM_KEYS  # sdk_ms が無い = SDK の段が無い
    assert sdk_calls == []
    assert records.warm_calls == 1


def test_emulator_verifier_warm_makes_client_only(monkeypatch):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    patch_certs(monkeypatch, forbid=True)
    v = TokenVerifier(Runtime("emulator", DEMO))
    v.warm()
    assert v._client is not None


# ── KEEP-2: 環境を渡す起動は既定で準備をしない ──
def test_env_start_does_not_warm_by_default(prod_env, certs, sdk_calls, capfd):
    records = MemoryStore()
    create_app({**prod_env, "ANTHROPIC_API_KEY": "sk-fictional"}, store=records)
    assert records.warm_calls == 0 and certs.hits == 0 and sdk_calls == []
    assert warm_lines(capfd) == []


def test_unconfigured_start_does_not_warm(monkeypatch, capfd):
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    records = MemoryStore()
    create_app({}, store=records, warm=True)
    assert records.warm_calls == 0
    assert warm_lines(capfd) == []


# ── KEEP-1: 資格情報の名前を環境から外した後に準備する（環境変数から起動する経路）──
def test_process_start_warms_after_scrub(prod_env, certs, monkeypatch, capfd):
    import os

    # os.environ を写しに差し替える（テストの process の環境を変えない。create_app が写しから資格情報の名前を外す）
    env = os.environ.copy()
    env.update({**prod_env, "ANTHROPIC_API_KEY": "sk-fictional", "CLAUDE_CODE_OAUTH_TOKEN": "fictional"})
    monkeypatch.setattr(os, "environ", env)
    seen = []

    class Watching(MemoryStore):
        def warm(self):
            seen.append(credential_names_in())
            super().warm()

    monkeypatch.setattr(statement_read, "sdk_available", lambda: seen.append(credential_names_in()) or True)
    records = Watching()
    create_app(store=records)  # env を渡さない = 本番の gunicorn と同じ経路（既定で準備する）
    assert records.warm_calls == 1
    assert certs.hits == 1  # 既定の経路でも公開鍵を要求の前に 1 回取る（AC-2）
    assert seen == [[], []]
    assert [ln["reason"] for ln in warm_lines(capfd)] == ["ok"]


# ── AC-7: ログの行の形 ──
def test_warmup_log_has_only_names_and_numbers(capfd):
    def boom():
        raise RuntimeError(f"{EMAIL} users/{UID}/trades/t1")

    assert warmup.run([("store", lambda: None), ("auth", boom)]) == ["auth"]
    _out, err = capfd.readouterr()
    assert EMAIL not in err and UID not in err and "RuntimeError" not in err
    (line,) = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    assert line["event"] == "warmup" and line["reason"] == "auth"
    assert set(line) == WARM_KEYS


def test_warmup_rejects_unknown_step_name():
    with pytest.raises(KeyError):
        warmup.run([("other", lambda: None)])
