"""読み取りの資格情報と起動の種類（Issue #44 の AC-8・例 K1〜K5。Issue #55 で本番も 3 方式を使えるようにした:
例 E4〜E6）。

本番の起動（verify）は実物の firebase-admin で署名を検証し、公開鍵の取得だけを差し替える（ネットワークに出ない）。
保存先は記憶の保存先。実際の AI は呼ばない（偽の claude_agent_sdk）。値はすべて架空。
"""

import json

import pytest
from helpers import fake_agent_sdk
from helpers.charts import png
from helpers.emulator import PROJECT
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, patch_certs, signed_token, unsigned_token

from loss_note_api import identity_token, statement_read
from loss_note_api.app import create_app
from loss_note_api.read_limits import ReadLimits
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR

PROD = "example-prod"
U = "credUserA"
PATH = "/api/statement-reads"
IMAGE = png(800, 600, size=2_000)
KEY = "KEY-MARKER-資格情報-k1"
OAUTH = "OAUTH-MARKER-資格情報-o1"
ORG = "00000000-0000-0000-0000-000000000001"
ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"  # 架空の JWT の形
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

    def make(identity_token=None, **extra):
        store = MemoryStore()
        env = {"GOOGLE_CLOUD_PROJECT": PROD, "LOSS_NOTE_ALLOWED_EMAILS": EMAIL, **extra}
        app = create_app(env, store=store, read_limits=LIMITS, identity_token=identity_token)
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
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in sdk.calls[0]["child_env"]


def test_E5_prod_allows_oauth_without_keys(prod, sdk):
    # #55: 本番の起動でも oauth_token を使える（#44 の K2 = 503 から変わる）。env にキーがあっても子には名前ごと無い
    client, store = prod(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=OAUTH, ANTHROPIC_API_KEY=KEY,
                         ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    res = post(client, prod_token())
    assert res.status_code == 200 and len(sdk.calls) == 1
    child = sdk.calls[0]["child_env"]
    assert child["CLAUDE_CODE_OAUTH_TOKEN"] == OAUTH
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID",
                 "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE"):
        assert name not in child


def test_prod_federation(prod, sdk):
    # 例 E3（API の経路）: 要求ごとに ID トークンを 1 回取り、ファイルで渡す。キー系・OAuth は子に名前ごと無い
    calls = []

    def fetch():
        calls.append(1)
        return ID_TOKEN

    client, store = prod(identity_token=fetch, STATEMENT_READ_CREDENTIAL="federation", ANTHROPIC_API_KEY=KEY,
                         CLAUDE_CODE_OAUTH_TOKEN=OAUTH, ANTHROPIC_FEDERATION_RULE_ID="fdrl_example",
                         ANTHROPIC_ORGANIZATION_ID=ORG)
    res = post(client, prod_token())
    assert res.status_code == 200 and len(sdk.calls) == 1 and calls == [1]
    child = sdk.calls[0]["child_env"]
    assert child["ANTHROPIC_FEDERATION_RULE_ID"] == "fdrl_example" and child["ANTHROPIC_ORGANIZATION_ID"] == ORG
    assert child["ANTHROPIC_IDENTITY_TOKEN_FILE"]
    for name in ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE",
                 "ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID"):
        assert name not in child
    assert store.spend != {}  # 送った回は数える


def test_federation_log_has_token_timing(prod, sdk, capfd):
    # #60: federation の回は ID トークンの取得の時間（token_ms）も内訳に出る。トークンの値は出さない
    client, _store = prod(identity_token=lambda: ID_TOKEN, STATEMENT_READ_CREDENTIAL="federation",
                          ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    capfd.readouterr()
    assert post(client, prod_token()).status_code == 200
    _out, err = capfd.readouterr()
    lines = [json.loads(ln) for ln in err.splitlines() if ln.startswith("{")]
    (read,) = [ln for ln in lines if ln.get("event") == "statement_read"]
    # #99: 送り口の段の時間（wait_ms・first_ms・result_ms・turn_ms・close_ms）も出る
    assert set(read) == {"event", "reason", "rows", "ms", "token_ms", "limit_ms", "read_ms", "api_ms", "cli",
                         "profile", "wait_ms", "first_ms", "result_ms", "turn_ms", "close_ms"}
    assert all(isinstance(read[k], int | float) for k in ("token_ms", "limit_ms", "read_ms", "api_ms"))
    assert ID_TOKEN not in err and "fdrl_example" not in err and ORG not in err


def test_E4_federation_token_failure_not_counted(prod, sdk):
    def fail():
        raise identity_token.IdentityTokenUnavailable("unreachable")

    client, store = prod(identity_token=fail, STATEMENT_READ_CREDENTIAL="federation",
                         ANTHROPIC_FEDERATION_RULE_ID="fdrl_example", ANTHROPIC_ORGANIZATION_ID=ORG)
    res = post(client, prod_token())
    assert res.status_code == 502 and res.get_json() == {"error": "read_failed"}
    assert len(sdk.calls) == 0
    assert store.read_days == {} and store.spend == {}


@pytest.mark.parametrize("extra", [
    {"ANTHROPIC_ORGANIZATION_ID": ORG},  # 例 E6: ルール ID が無い
    {"ANTHROPIC_FEDERATION_RULE_ID": "", "ANTHROPIC_ORGANIZATION_ID": ORG},
    {"ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example"},
])
def test_E6_federation_missing_values(prod, sdk, extra):
    client, store = prod(identity_token=lambda: ID_TOKEN, STATEMENT_READ_CREDENTIAL="federation", **extra)
    res = post(client, prod_token())
    assert res.status_code == 503 and res.get_json() == {"error": "read_unavailable"}
    assert len(sdk.calls) == 0 and store.read_days == {} and store.spend == {}


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
        ("verify", {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "k"}, True),
        ("verify", {"STATEMENT_READ_CREDENTIAL": "federation", "ANTHROPIC_FEDERATION_RULE_ID": "r",
                    "ANTHROPIC_ORGANIZATION_ID": "o"}, True),
        ("verify", {"STATEMENT_READ_CREDENTIAL": "federation", "ANTHROPIC_FEDERATION_RULE_ID": "r"}, False),
        ("verify", {"STATEMENT_READ_CREDENTIAL": "oauth_token", "ANTHROPIC_API_KEY": "k"}, False),
        ("verify", {}, False),
        ("emulator", {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "k"}, True),
        ("emulator", {"ANTHROPIC_API_KEY": "k"}, True),
    ],
)
def test_read_config_by_mode(mode, env, usable):
    c = statement_read.read_config(env, None, mode=mode)
    assert c.usable is usable
    if not usable:
        assert dict(c.values) == {}


def test_read_config_requires_mode():
    # 起動の種類は必須（#44 のレビューの指摘 1。#55 で方式は起動の種類で制限しなくなったが、呼び出しの形は保つ）
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


# ---- レビューの指摘 4: 本番と同じ起動のしかた（env を渡さない create_app）から子の環境まで通しで ----

FULL_PROCESS_ENV = {
    "ANTHROPIC_API_KEY": KEY, "CLAUDE_CODE_OAUTH_TOKEN": OAUTH,
    "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_example", "ANTHROPIC_ORGANIZATION_ID": ORG,
    "ANTHROPIC_AUTH_TOKEN": "AUTH-x", "ANTHROPIC_PROFILE": "p", "ANTHROPIC_BASE_URL": "http://elsewhere.example",
    "CLAUDE_CODE_USE_BEDROCK": "1", "AWS_BEARER_TOKEN_BEDROCK": "B-x",
}
METHOD_NAMES = {
    "api_key": {"ANTHROPIC_API_KEY"},
    "oauth_token": {"CLAUDE_CODE_OAUTH_TOKEN"},
    "federation": {"ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE"},
}


@pytest.mark.parametrize("method", ["api_key", "oauth_token", "federation"])
def test_process_env_start_passes_only_selected_method(monkeypatch, sdk, method):
    # 偽の SDK の install が os.environ を写しの dict に差し替えている（テストの process の環境を変えない）
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", PROJECT)
    for k, v in {**FULL_PROCESS_ENV, "STATEMENT_READ_CREDENTIAL": method}.items():
        monkeypatch.setenv(k, v)
    client = create_app(store=MemoryStore(), read_limits=LIMITS, identity_token=lambda: ID_TOKEN).test_client()
    res = post(client, unsigned_token(U, PROJECT))
    assert res.status_code == 200 and len(sdk.calls) == 1
    child = sdk.calls[0]["child_env"]
    family = {k for k in child if k.startswith(("ANTHROPIC_", "AWS_", "CLAUDE_CODE_USE_"))
              or k == "CLAUDE_CODE_OAUTH_TOKEN"}
    assert family == METHOD_NAMES[method]
    assert all(child[k] for k in family)
    if method == "api_key":
        assert child["ANTHROPIC_API_KEY"] == KEY
    if method == "oauth_token":
        assert child["CLAUDE_CODE_OAUTH_TOKEN"] == OAUTH


def test_leftover_name_in_process_env_not_sent(prod, sdk, monkeypatch):
    # 入口で外していない起動（env を渡す起動で親に系統の名前が残っている）: 送らず、数えない
    monkeypatch.setenv("ANTHROPIC_API_KEY", "LEFTOVER-x")
    client, store = prod(STATEMENT_READ_CREDENTIAL="oauth_token", CLAUDE_CODE_OAUTH_TOKEN=OAUTH)
    res = post(client, prod_token())
    assert res.status_code == 502 and res.get_json() == {"error": "read_failed"}
    assert len(sdk.calls) == 0 and store.read_days == {} and store.spend == {}
