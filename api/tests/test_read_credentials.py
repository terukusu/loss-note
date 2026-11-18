"""読み取りの資格情報と起動の種類（Issue #44 の AC-8・例 K1〜K5）。

本番の起動（verify）は実物の firebase-admin で署名を検証し、公開鍵の取得だけを差し替える（ネットワークに出ない）。
保存先は記憶の保存先。実際の AI は呼ばない（偽の claude_agent_sdk）。値はすべて架空。
"""

import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, patch_certs, signed_token, unsigned_token

from loss_note_api import statement_read
from loss_note_api.app import create_app
from loss_note_api.read_limits import ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

PROD = "example-prod"
U = "credUserA"
PATH = "/api/statement-reads"
IMAGE = png(800, 600, size=2_000)
KEY = "KEY-MARKER-資格情報-k1"
EMAIL = "fictional.cred@example.com"  # 本番の許可リスト（#43）に載せる架空のメール
LIMITS = ReadLimits(per_user=30, daily_micro_usd=2_000_000, reserve_micro_usd=50_000)


@pytest.fixture
def sdk(monkeypatch):
    fake = fake_agent_sdk.install(monkeypatch)
    fake.tool_input = {"kind": "statement", "rows": []}
    return fake


@pytest.fixture
def prod(monkeypatch):
    """本番と同じ起動（エミュレーターの接続先なし・プロジェクト ID あり = verify）。env の差分で作る"""
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"):
        monkeypatch.delenv(name, raising=False)
    patch_certs(monkeypatch)

    def make(**extra):
        store = MemoryStore()
        env = {"GOOGLE_CLOUD_PROJECT": PROD, "LOSS_NOTE_ALLOWED_EMAILS": EMAIL, **extra}
        app = create_app(env, store=store, read_limits=LIMITS)
        return app.test_client(), store

    return make


def prod_token() -> str:
    # 本番の起動は許可リストを通った利用者だけ（#43。403 は読み取りの入口より前で、数えない）
    return signed_token(U, PROD, email=EMAIL, email_verified=True)


def post(client, token):
    return client.post(PATH, data=IMAGE, content_type="image/png", headers=bearer(token))


def test_K1_prod_api_key(prod, sdk):
    client, store = prod(ANTHROPIC_API_KEY=KEY)
    res = post(client, prod_token())
    assert res.status_code == 200 and len(sdk.calls) == 1
    assert sdk.calls[0]["options"].env["ANTHROPIC_API_KEY"] == KEY
    assert sdk.calls[0]["options"].env["CLAUDE_CODE_OAUTH_TOKEN"] == ""


def test_K2_prod_refuses_oauth(prod, sdk):
    client, store = prod(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=KEY, ANTHROPIC_API_KEY=KEY)
    res = post(client, prod_token())
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0
    assert store.read_days == {} and store.spend == {}


def test_K3_emulator_allows_oauth(monkeypatch, sdk):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080", "GOOGLE_CLOUD_PROJECT": PROJECT,
           "STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": KEY}
    client = create_app(env, store=MemoryStore(), read_limits=LIMITS).test_client()
    res = post(client, unsigned_token(U, PROJECT))
    assert res.status_code == 200 and len(sdk.calls) == 1
    assert sdk.calls[0]["options"].env["CLAUDE_CODE_OAUTH_TOKEN"] == KEY


def test_K4_prod_without_key_other_apis_work(prod, sdk):
    client, _store = prod()
    token = prod_token()
    res = post(client, token)
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/trades", headers=bearer(token)).status_code == 200


def test_K5_prod_unknown_switch(prod, sdk):
    client, _store = prod(STATEMENT_READ_CREDENTIAL="password", ANTHROPIC_API_KEY=KEY)
    res = post(client, prod_token())
    assert res.status_code == 503 and len(sdk.calls) == 0


@pytest.mark.parametrize(
    ("mode", "env", "usable"),
    [
        ("verify", {"ANTHROPIC_API_KEY": "k"}, True),
        ("verify", {"STATEMENT_READ_CREDENTIAL": "api_key", "ANTHROPIC_API_KEY": "k"}, True),
        ("verify", {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "k"}, False),
        ("verify", {}, False),
        ("emulator", {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "k"}, True),
        ("emulator", {"ANTHROPIC_API_KEY": "k"}, True),
    ],
)
def test_read_config_by_mode(mode, env, usable):
    c = statement_read.read_config(env, None, mode=mode)
    assert c.usable is usable
    if not usable:
        assert c.secret == ""


def test_read_config_requires_mode():
    # 起動の種類は必須（既定で手元の扱い = OAuth トークンを許す側にならない。#44 のレビューの指摘 1）
    with pytest.raises(TypeError):
        statement_read.read_config({"ANTHROPIC_API_KEY": "k"})  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        statement_read.read_config({"ANTHROPIC_API_KEY": "k"}, None, "verify")  # type: ignore[misc]


def test_forbidden_not_counted(prod, sdk):
    # R3: 許可リストに無い利用者（#43 の 403）は読み取りの入口より前で止まり、数えない
    client, store = prod(ANTHROPIC_API_KEY=KEY)
    other = signed_token(U, PROD, email="fictional.other@example.com", email_verified=True)
    res = post(client, other)
    assert res.status_code == 403 and len(sdk.calls) == 0
    assert store.read_days == {} and store.spend == {}
