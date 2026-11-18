"""使える利用者の許可リストの純関数（Issue #43 の R2・R3・R4・契約「allowlist.py」）。値はすべて架空。"""

import pytest

from loss_note_api.allowlist import ALLOWED_EMAILS_VAR, denial_reason, is_allowed, parse_allowlist, policy_for

OWNER = "owner@example.com"


# ── parse_allowlist ──────────────────────────
def test_parse_trims_and_drops_empty_items():
    assert parse_allowlist(" owner@example.com , ,second@example.org") == {"owner@example.com", "second@example.org"}


def test_parse_lowercases_ascii_only():
    assert parse_allowlist("Owner@Example.COM") == {"owner@example.com"}
    # ASCII でない大文字は寄せない（Unicode の大文字小文字の同一視で別の文字列を一致させない）
    assert parse_allowlist("ÖWNER@example.com") == {"Öwner@example.com"}


@pytest.mark.parametrize("raw", [None, "", " ", ",", " , ,"])
def test_parse_empty(raw):
    assert parse_allowlist(raw) == frozenset()


def test_parse_keeps_dots():
    assert parse_allowlist("o.wner@example.com") == {"o.wner@example.com"}


# ── policy_for ───────────────────────────────
def test_policy_emulator_without_key_is_unrestricted():
    assert policy_for("emulator", {}) is None


def test_policy_emulator_with_key_applies():
    assert policy_for("emulator", {ALLOWED_EMAILS_VAR: OWNER}) == {OWNER}
    assert policy_for("emulator", {ALLOWED_EMAILS_VAR: ""}) == frozenset()


@pytest.mark.parametrize("env", [{}, {ALLOWED_EMAILS_VAR: ""}, {ALLOWED_EMAILS_VAR: " , "}])
def test_policy_verify_unset_or_empty_closes(env):
    # R3: 本番は未設定・空でも制限する（空の集合 = すべて 403）
    assert policy_for("verify", env) == frozenset()


def test_policy_verify_with_value():
    assert policy_for("verify", {ALLOWED_EMAILS_VAR: f"{OWNER},second@example.org"}) == {OWNER, "second@example.org"}


# ── is_allowed / denial_reason ───────────────
def verified(email, **kw):
    return {"sub": "u1", "email": email, "email_verified": True, **kw}


def test_unrestricted_allows_anything():
    assert is_allowed({}, None)
    assert is_allowed({"email": "x@example.com", "email_verified": False}, None)


@pytest.mark.parametrize("email", [OWNER, "Owner@Example.COM", "OWNER@EXAMPLE.COM"])
def test_allowed_case_insensitive(email):
    assert is_allowed(verified(email), frozenset({OWNER}))


@pytest.mark.parametrize(
    ("claims", "reason"),
    [
        (verified("other@example.com"), "not_listed"),
        (verified("o.wner@example.com"), "not_listed"),  # 点の有無を同一視しない
        (verified(" owner@example.com"), "not_listed"),  # トークンのメールは空白を除かない（完全一致）
        (verified("owner@example.com.evil.example"), "not_listed"),
        ({"sub": "u1", "email": OWNER, "email_verified": False}, "unverified"),
        ({"sub": "u1", "email": OWNER, "email_verified": "true"}, "unverified"),  # 真偽値の真だけ
        ({"sub": "u1", "email": OWNER, "email_verified": 1}, "unverified"),
        ({"sub": "u1", "email": OWNER}, "unverified"),
        ({"sub": "u1", "email_verified": True}, "no_email"),
        ({"sub": "u1", "email": "", "email_verified": True}, "no_email"),
        ({"sub": "u1", "email": ["owner@example.com"], "email_verified": True}, "no_email"),
        ({"sub": "u1", "email": None, "email_verified": True}, "no_email"),
    ],
)
def test_denied(claims, reason):
    policy = frozenset({OWNER})
    assert denial_reason(claims, policy) == reason
    assert not is_allowed(claims, policy)


def test_empty_policy_denies_everyone():
    assert denial_reason(verified(OWNER), frozenset()) == "empty_list"
    assert not is_allowed(verified(OWNER), frozenset())


def test_reason_words_are_fixed():
    # ログに出す理由は決まった語だけ（メール・uid を含まない）
    words = {"empty_list", "no_email", "unverified", "not_listed"}
    samples = [verified("other@example.com"), {"email": OWNER}, {"email_verified": True}]
    for c in samples:
        for p in (frozenset(), frozenset({OWNER})):
            r = denial_reason(c, p)
            assert r is None or r in words
