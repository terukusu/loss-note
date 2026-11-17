"""ID トークンの検証（AC-1〜3・契約 3・ADR-0004）。

検証モードは実物の firebase-admin を通し、公開鍵の取得だけを差し替える（ネットワークに出ない）。
"""

import time

import google.auth.exceptions
import google.oauth2.id_token
import pytest
from helpers.tokens import bearer, patch_certs, signed_token, unsigned_token

from loss_note_api.auth import AuthUnavailable, InvalidToken, TokenVerifier, bearer_token, check_claims
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR, Runtime

PROD = "example-prod"
DEMO = "demo-loss-note"


def now_ms() -> int:
    return int(time.time() * 1000)


@pytest.fixture
def verify_env(monkeypatch):
    # 本番と同じ設定: エミュレーターの接続先が無い
    for name in (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"):
        monkeypatch.delenv(name, raising=False)
    return TokenVerifier(Runtime("verify", PROD))


@pytest.fixture
def emulator_env(monkeypatch):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    return TokenVerifier(Runtime("emulator", DEMO))


# ── bearer_token ───────────────────────────────
@pytest.mark.parametrize(
    "header",
    [None, "", "Bearer", "Bearer ", "Basic abc", "bearer", "Token abc.def.ghi", "Bearer a b", "Bearer \x00"],
)
def test_bearer_token_rejects(header):
    assert bearer_token(header) is None


def test_bearer_token_accepts():
    assert bearer_token("Bearer abc.def.") == "abc.def."
    assert bearer_token("bearer abc.def.ghi") == "abc.def.ghi"


def test_bearer_token_rejects_too_long():
    assert bearer_token("Bearer " + "a" * 9000) is None


# ── check_claims（契約 3）──────────────────────
def test_check_claims_ok():
    assert check_claims({"sub": "u1", "uid": "u1", "exp": 2_000}, 1_999_999) == "u1"
    # 前後どちらかだけの __ は予約の形ではない
    for uid in ("__x", "x__", "_x_", "a__b"):
        assert check_claims({"sub": uid, "exp": 2_000}, 1_999_999) == uid


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "u1", "exp": 2_000},  # exp * 1000 == now
        {"sub": "u1", "exp": 1_000},
        {"sub": "u1"},
        {"sub": "u1", "exp": "3000"},
        {"sub": "u1", "exp": True},
        {"sub": "u1", "exp": float("nan")},
        {"sub": "a/b", "exp": 3_000},
        {"sub": "..", "exp": 3_000},
        {"sub": "", "exp": 3_000},
        {"sub": "x" * 129, "exp": 3_000},
        {"sub": 1, "exp": 3_000},
        {"sub": "u1", "uid": "u2", "exp": 3_000},
        {"exp": 3_000},
        {"sub": "__x__", "exp": 3_000},  # Firestore が予約している文書 ID の形
        {"sub": "____", "exp": 3_000},
    ],
)
def test_check_claims_rejects(claims):
    with pytest.raises(InvalidToken):
        check_claims(claims, 2_000_000)


# ── 検証モード（本番と同じ）────────────────────
def test_verify_mode_accepts_signed(verify_env, monkeypatch):
    calls = patch_certs(monkeypatch)
    assert verify_env.verify(signed_token("u1", PROD), now_ms()) == "u1"
    assert calls  # 公開鍵（差し替え）で署名を確かめた


def test_verify_mode_rejects_unsigned(verify_env, monkeypatch):
    """AC-2: エミュレーターが出す署名の無いトークン（aud・iss はこのプロジェクト）を受けない。
    公開鍵を取りに行く前に拒む"""
    patch_certs(monkeypatch, forbid=True)
    with pytest.raises(InvalidToken):
        verify_env.verify(unsigned_token("u1", PROD), now_ms())


def test_expired_in_verify_mode(verify_env, monkeypatch):
    patch_certs(monkeypatch)
    with pytest.raises(InvalidToken):
        verify_env.verify(signed_token("u1", PROD, exp_offset=-120), now_ms())


@pytest.mark.parametrize(
    "token_fn",
    [
        lambda: signed_token("u1", "other-project"),  # aud 違い
        lambda: signed_token("u1", PROD, kid="unknown-kid"),
        lambda: signed_token("u1", PROD)[:-4] + "AAAA",  # 署名を壊す
        lambda: "not-a-jwt",
        lambda: "a.b.c",
        lambda: signed_token("a/b", PROD),  # uid の形
    ],
)
def test_verify_mode_rejects_bad(verify_env, monkeypatch, token_fn):
    patch_certs(monkeypatch)
    with pytest.raises(InvalidToken):
        verify_env.verify(token_fn(), now_ms())


def test_verify_mode_refuses_when_emulator_env_appears_later(verify_env, monkeypatch):
    """守りを重ねる: verify で起動したのに、後から環境変数が入っても署名の無いトークンを受けない"""
    patch_certs(monkeypatch)
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    with pytest.raises(InvalidToken):
        verify_env.verify(unsigned_token("u1", PROD), now_ms())
    with pytest.raises(InvalidToken):
        verify_env.verify(signed_token("u1", PROD), now_ms())


# ── エミュレーターモード ────────────────────────
def test_emulator_mode_accepts_unsigned(emulator_env):
    assert emulator_env.verify(unsigned_token("u1", DEMO), now_ms()) == "u1"


def test_expired_in_emulator_mode(emulator_env):
    # firebase-admin はエミュレーターでは exp を見ないので、check_claims が拒む
    with pytest.raises(InvalidToken):
        emulator_env.verify(unsigned_token("u1", DEMO, exp_offset=-120), now_ms())


@pytest.mark.parametrize(
    "token_fn",
    [
        lambda: unsigned_token("u1", "demo-other"),  # aud 違い
        lambda: unsigned_token("a/b", DEMO),
        lambda: unsigned_token("..", DEMO),
        lambda: "x.y.",
    ],
)
def test_emulator_mode_rejects_bad(emulator_env, token_fn):
    with pytest.raises(InvalidToken):
        emulator_env.verify(token_fn(), now_ms())


def test_emulator_mode_refuses_when_env_removed(emulator_env, monkeypatch):
    monkeypatch.delenv(AUTH_EMULATOR)
    with pytest.raises(InvalidToken):
        emulator_env.verify(unsigned_token("u1", DEMO), now_ms())


def test_exception_message_is_not_exposed(verify_env, monkeypatch):
    """firebase-admin の例外の文言にはトークン・aud が入る。InvalidToken には型の名前だけ"""
    patch_certs(monkeypatch)
    token = signed_token("u1", "other-project-marker")
    with pytest.raises(InvalidToken) as e:
        verify_env.verify(token, now_ms())
    assert "other-project-marker" not in str(e.value)
    assert token not in str(e.value)
    assert e.value.reason.isidentifier()


def test_bearer_helper_shape():
    assert bearer("t") == {"Authorization": "Bearer t"}


def test_verify_mode_cert_fetch_failure_is_unavailable(verify_env, monkeypatch):
    """公開鍵を取れない（こちらの都合）は InvalidToken（401）でなく AuthUnavailable（503）。文言を持ち出さない"""

    def fail(_request, _url):
        raise google.auth.exceptions.TransportError("MARKER-certs-down secret-detail")

    monkeypatch.setattr(google.oauth2.id_token, "_fetch_certs", fail)
    with pytest.raises(AuthUnavailable) as e:
        verify_env.verify(signed_token("u1", PROD), now_ms())
    assert "MARKER" not in str(e.value)
