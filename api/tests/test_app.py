import os

import pytest

from loss_note_api.app import create_app


@pytest.fixture(autouse=True)
def _process_env_copy(monkeypatch):
    # env を渡さない起動は、この process の環境から資格情報の系統を外す（#55）。テストの process の環境は変えない
    monkeypatch.setattr(os, "environ", os.environ.copy())


def client():
    return create_app().test_client()


def test_health_returns_ok_json():
    res = client().get("/api/health")
    assert res.status_code == 200
    assert res.mimetype == "application/json"
    assert res.get_json() == {"status": "ok"}


def test_health_ignores_query():
    res = client().get("/api/health?x=1")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}


def test_unknown_path_is_404():
    res = client().get("/api/unknown")
    assert res.status_code == 404


def test_process_env_scrubbed_after_reading_credentials(monkeypatch):
    # #55: env を渡さない起動では、読み取りの資格情報を読んだ後に資格情報・送り先の系統の名前を
    # この process の環境から外す
    # （明細の読み取りの子の CLI に、選ばなかった方式の変数を引き継がせない）。ほかの変数は残す
    # 起動の種類（エミュレーターの有無）は実行の環境のまま（どちらでも外す）
    env = {"STATEMENT_READ_CREDENTIAL": "oauth_token", "CLAUDE_CODE_OAUTH_TOKEN": "TOK-x", "ANTHROPIC_API_KEY": "KEY-x",
           "ANTHROPIC_PROFILE": "p", "CLAUDE_CODE_USE_BEDROCK": "1", "AWS_BEARER_TOKEN_BEDROCK": "B-x",
           "UNRELATED_SETTING": "kept"}
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    create_app()
    for name in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_PROFILE", "CLAUDE_CODE_USE_BEDROCK",
                 "AWS_BEARER_TOKEN_BEDROCK"):
        assert name not in os.environ
    assert os.environ["UNRELATED_SETTING"] == "kept" and os.environ["STATEMENT_READ_CREDENTIAL"] == "oauth_token"


def test_explicit_env_does_not_touch_process_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "KEY-x")
    create_app({"ANTHROPIC_API_KEY": "KEY-y"})
    assert os.environ["ANTHROPIC_API_KEY"] == "KEY-x"
