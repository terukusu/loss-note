"""本番の起動（署名を検証する）での使える利用者の許可リストと、画面の HTML の CSP のヘッダ（Issue #43）。

- AC-1（例 A1〜A4）・AC-2（例 A5〜A10・A12）・AC-3（例 A11・A13）・AC-5（例 B1〜B4）・AC-6・AC-8（例 H1・H2）
- 起動は本番と同じ形（エミュレーターの接続先が無く、プロジェクト ID が demo- でない）。公開鍵の取得は ``patch_certs`` で
  テスト用の鍵に差し替える（ネットワークに出ない）。保存先は記憶。AI は偽の SDK（呼ばれた回数を数える）
- 値はすべて架空（メール・uid・プロジェクト ID・authDomain）
"""

import json
from pathlib import Path

import pytest
from helpers import fake_agent_sdk
from helpers.charts import chart_parts, chart_png, encode_multipart, png
from helpers.memory_store import MemoryStore
from helpers.records import t1
from helpers.tokens import bearer, patch_certs, signed_token, unsigned_token

from loss_note_api import web
from loss_note_api.allowlist import ALLOWED_EMAILS_VAR
from loss_note_api.app import create_app
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR, StartupRefused
from loss_note_api.web import AUTH_DOMAIN_VAR, STATIC_DIR_VAR

PROD = "example-prod"
OWNER = "owner@example.com"
OTHER = "other@example.com"
OWNER_UID = "ownerUidA1"
OTHER_UID = "otherUidB7"
EMULATOR_VARS = (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST")
FORBIDDEN = {"error": "forbidden"}


class CountingStore:
    """保存先の呼び出しを数える包み（403 のとき 0 回であることを確かめる）"""

    def __init__(self, inner: MemoryStore):
        self.inner = inner
        self.calls: list[str] = []

    def __getattr__(self, name):
        target = getattr(self.inner, name)
        if not callable(target):
            return target

        def wrapped(*args, **kwargs):
            self.calls.append(name)
            return target(*args, **kwargs)

        return wrapped


@pytest.fixture
def prod(monkeypatch):
    """本番と同じ起動の材料。make(allowed=...) で許可リストを変えたアプリを作る（None = 変数を置かない）"""
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    patch_certs(monkeypatch)
    inner = MemoryStore()
    store = CountingStore(inner)

    def make(allowed: str | None = OWNER, **extra):
        env = {"GOOGLE_CLOUD_PROJECT": PROD, **extra}
        if allowed is not None:
            env[ALLOWED_EMAILS_VAR] = allowed
        return create_app(env, store=store).test_client()

    make.store = store
    return make


def token(uid: str = OWNER_UID, email: str | None = OWNER, verified: bool | None = True, **kw) -> str:
    extra = {} if verified is None else {"email_verified": verified}
    return signed_token(uid, PROD, email=email, **extra, **kw)


# ── AC-1: 例 A1〜A4（401 が先） ─────────────────────
@pytest.mark.parametrize(
    "case,headers",
    [
        ("A1", {}),
        ("A2", bearer(unsigned_token(OWNER_UID, PROD, email=OWNER, email_verified=True))),
        ("A3", bearer(signed_token(OWNER_UID, "example-other", email=OWNER, email_verified=True))),
        ("A4", bearer(token(exp_offset=-120))),
    ],
)
def test_a1_a4_unauthenticated_is_401(prod, case, headers):
    res = prod().get("/api/trades", headers=headers)
    assert res.status_code == 401, case
    assert res.get_json() == {"error": "unauthorized"}


# ── AC-2: 例 A5〜A10・A12 ─────────────────────────
@pytest.mark.parametrize(
    "case,allowed,email,verified,status",
    [
        ("A5", OWNER, OWNER, True, 200),
        ("A6", OWNER, "Owner@Example.COM", True, 200),
        ("A7", OWNER, OTHER, True, 403),
        ("A8", OWNER, OWNER, False, 403),
        ("A9", OWNER, None, None, 403),
        ("A10", OWNER, "o.wner@example.com", True, 403),
        ("A12", " owner@example.com , ,second@example.org", "second@example.org", True, 200),
    ],
)
def test_a5_a12_allowlist(prod, case, allowed, email, verified, status):
    res = prod(allowed).get("/api/trades", headers=bearer(token(email=email, verified=verified)))
    assert res.status_code == status, case
    if status == 403:
        assert res.get_json() == FORBIDDEN
        assert "WWW-Authenticate" not in res.headers
    else:
        assert res.get_json() == {"items": []}


# ── AC-3: 例 A11・A13（未設定・空は閉じる） ───────────
@pytest.mark.parametrize("allowed", [None, ""])
def test_a11_a13_unset_or_empty_closes(prod, allowed):
    client = prod(allowed)
    res = client.get("/api/trades", headers=bearer(token()))
    assert res.status_code == 403
    assert res.get_json() == FORBIDDEN
    assert client.get("/api/health").status_code == 200


# ── AC-5: 例 B1〜B4（403 は保存先にも AI にも触れない） ─────
def test_b1_b4_forbidden_touches_nothing(prod, monkeypatch):
    sdk = fake_agent_sdk.install(monkeypatch)
    cred = {"ANTHROPIC_API_KEY": "fictional-credential"}
    # 対照: other も許可した起動では、同じ要求が通る（403 は許可リストのせい）
    open_client = prod(f"{OWNER},{OTHER}", **cred)
    other = bearer(token(OTHER_UID, OTHER))
    res = open_client.post("/api/instruments", json={"name": "US30", "priceCurrency": "JPY"}, headers=other)
    assert res.status_code == 201
    iid = res.get_json()["id"]
    res = open_client.post("/api/trades", json=t1(iid), headers=other)
    assert res.status_code == 201
    other_trade = res.get_json()["id"]
    before = json.dumps(prod.store.inner.users, sort_keys=True, default=str)

    client = prod(OWNER, **cred)
    prod.store.calls.clear()
    body, ctype = encode_multipart(chart_parts(t1(iid), {"entry": (chart_png(), "image/png")}))
    requests = {
        "B1": client.post("/api/trades", data=body, content_type=ctype, headers=other),
        "B2": client.post("/api/statement-reads", data=png(800, 600, size=2_000), content_type="image/png",
                          headers=other),
        "B3": client.get(f"/api/trades/{other_trade}", headers=other),
        "B3x": client.get("/api/trades/doesNotExist0000", headers=other),
        "B4": client.put("/api/settings", json={"capitalYen": 1_000_000, "riskTolerancePct": 1,
                                                "performanceUnit": "R"}, headers=other),
    }  # fmt: skip
    for case, res in requests.items():
        assert res.status_code == 403, case
        assert res.get_json() == FORBIDDEN, case
    assert prod.store.calls == []
    assert sdk.calls == []
    assert json.dumps(prod.store.inner.users, sort_keys=True, default=str) == before


# ── 入口の網羅: /api/ の配下のすべての入口（今後足した入口も）がトークンなしで 401・許可リスト外で 403 ──
def api_endpoints(app) -> list[tuple[str, str]]:
    """url_map から /api/ の配下の入口（/api/health を除く）を (メソッド, 架空の値を埋めたパス) で並べる"""
    out = []
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/") or rule.rule == "/api/health":
            continue
        path = rule.rule
        for arg in rule.arguments:
            # 変換器つき（<path:x>）も含めて、引数の部分を架空の値に置き換える
            start = path.index("<")
            path = path[:start] + ("entry" if arg == "slot" else "fictionalId0001") + path[path.index(">", start) + 1:]
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            out.append((method, path))
    return out


def test_every_api_endpoint_is_guarded(prod, monkeypatch):
    sdk = fake_agent_sdk.install(monkeypatch)
    client = prod(OWNER, ANTHROPIC_API_KEY="fictional-credential")
    endpoints = api_endpoints(client.application)
    # 今ある入口（取引・チャート・銘柄・設定・明細の読み取り）が並んでいること（列挙そのものが壊れていない）
    paths = {p for _, p in endpoints}
    for expected in ("/api/trades", "/api/instruments", "/api/settings", "/api/statement-reads"):
        assert expected in paths, expected
    assert any("/charts/" in p for p in paths)
    assert len(endpoints) >= 10
    other = bearer(token(OTHER_UID, OTHER))
    prod.store.calls.clear()
    for method, path in endpoints:
        res = client.open(path, method=method, data=b"{}", content_type="application/json")
        assert res.status_code == 401, (method, path)
        res = client.open(path, method=method, data=b"{}", content_type="application/json", headers=other)
        assert res.status_code == 403, (method, path)
        assert res.get_json() == FORBIDDEN, (method, path)
    assert prod.store.calls == []
    assert sdk.calls == []


# ── AC-6: 403 の本文とログに身元が無い ───────────────
@pytest.mark.parametrize(
    "case,uid,email,verified",
    [("A7", "otherUidQ9x", "other.marker@example.com", True), ("A8", "ownerUidZ3k", OWNER, False)],
)
def test_forbidden_body_and_logs_have_no_identity(prod, capsys, case, uid, email, verified):
    client = prod(f"{OWNER},listed.marker@example.org")
    capsys.readouterr()
    res = client.get("/api/trades", headers=bearer(token(uid, email, verified)))
    assert res.status_code == 403, case
    assert res.data.strip() == b'{"error":"forbidden"}'
    err = capsys.readouterr().err
    haystack = res.data.decode() + "".join(f"{k}: {v}" for k, v in res.headers.items()) + err
    for needle in (uid, email, OWNER, "listed.marker", "example.org"):
        assert needle not in haystack, (case, needle)
    events = [json.loads(line) for line in err.splitlines() if line.startswith("{")]
    forbidden = [e for e in events if e.get("event") == "forbidden"]
    assert forbidden == [{"event": "forbidden", "reason": "not_listed" if case == "A7" else "unverified"}]
    assert any(e.get("event") == "request" and e.get("status") == 403 for e in events)


# ── AC-8: 例 H1・H2（画面の HTML の CSP のヘッダ） ─────────
AUTH_DOMAIN = "auth.example.test"


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    root = tmp_path / "static"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_bytes(b"<!doctype html><title>t</title><div id=app></div>\n")
    return root


def directives(csp: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in csp.split(";"):
        words = part.split()
        if words:
            assert words[0] not in out, words[0]
            out[words[0]] = words[1:]
    return out


def test_h1_h2_csp_header(prod, static_dir):
    client = prod(OWNER, **{STATIC_DIR_VAR: str(static_dir), AUTH_DOMAIN_VAR: AUTH_DOMAIN})
    h1 = client.get("/")
    h2 = client.get("/trades/abc")
    assert h1.status_code == h2.status_code == 200
    csp = h1.headers["Content-Security-Policy"]
    assert csp == h2.headers["Content-Security-Policy"]
    d = directives(csp)
    # R7: script・frame・connect の許可の一覧
    assert set(d["script-src"]) == {"'self'", "https://apis.google.com"}
    assert set(d["frame-src"]) == {f"https://{AUTH_DOMAIN}"}
    assert set(d["connect-src"]) == {
        "'self'",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
    }
    for bad in ("'unsafe-inline'", "'unsafe-eval'", "*"):
        assert not any(bad in v for v in d["script-src"]), bad
    # ほかは自分のオリジンだけ（font は同梱の数字の書体だけ。#237）・ほかのサイトの frame に入れられない
    assert d["default-src"] == ["'none'"]
    assert d["style-src"] == ["'self'"]
    assert d["img-src"] == ["'self'"]
    assert d["font-src"] == ["'self'"]  # #237
    assert d["frame-ancestors"] == ["'none'"]
    assert d["base-uri"] == ["'none'"]
    assert d["form-action"] == ["'none'"]
    assert d["manifest-src"] == ["'self'"]  # #77
    assert set(d) == {"default-src", "script-src", "style-src", "img-src", "font-src", "connect-src", "manifest-src",
                      "base-uri", "form-action", "frame-ancestors", "frame-src"}  # fmt: skip


def test_csp_without_auth_domain_keeps_base(prod, static_dir):
    # 変数が無ければ #42 の土台のまま（ログインの外部を許さない）
    d = directives(prod(OWNER, **{STATIC_DIR_VAR: str(static_dir)}).get("/").headers["Content-Security-Policy"])
    assert d["script-src"] == ["'self'"]
    assert d["connect-src"] == ["'self'"]
    assert "frame-src" not in d


@pytest.mark.parametrize(
    "bad",
    ["a;b.example", "*.example.com", "https://x.example", "x.example ", "X.example", "localhost",
     "x.example,y.example", "x.example\n", ("a" * 60 + ".") * 5 + "example", "a" * 64 + ".example"],
)  # fmt: skip
def test_bad_auth_domain_refuses_startup(prod, bad):
    with pytest.raises(StartupRefused) as e:
        prod(OWNER, **{AUTH_DOMAIN_VAR: bad})
    assert bad.strip() not in str(e.value)


def test_valid_auth_domain_accepts_hostnames():
    for ok in ("auth.example.test", "example-prod.firebaseapp.com", ("a" * 63 + ".") * 3 + "example"):
        assert web.valid_auth_domain(ok), ok
    assert not web.valid_auth_domain(("a" * 63 + ".") * 4 + "x")  # 257 字
    assert not web.valid_auth_domain("")
    assert web.login_csp_extra("auth.example.test")["frame-src"] == ("https://auth.example.test",)


def test_emulator_ignores_auth_domain(monkeypatch):
    # 手元（エミュレーター）の画面は Vite が配るので、Flask のヘッダにログインの許可を足さない
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    env = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080",
           "GOOGLE_CLOUD_PROJECT": "demo-loss-note", AUTH_DOMAIN_VAR: AUTH_DOMAIN}  # fmt: skip
    res = create_app(env, store=MemoryStore()).test_client().get("/api/health")
    assert "frame-src" not in directives(res.headers["Content-Security-Policy"])


# ── R4: エミュレーターの起動（変数なしは今のまま・あれば効く。記憶の保存先で） ──
def test_emulator_unset_is_unrestricted_and_set_applies(monkeypatch):
    monkeypatch.setenv(AUTH_EMULATOR, "127.0.0.1:9099")
    monkeypatch.setenv(FIRESTORE_EMULATOR, "127.0.0.1:8080")
    base = {AUTH_EMULATOR: "127.0.0.1:9099", FIRESTORE_EMULATOR: "127.0.0.1:8080",
            "GOOGLE_CLOUD_PROJECT": "demo-loss-note"}  # fmt: skip
    other = bearer(unsigned_token(OTHER_UID, email=OTHER, email_verified=True))
    owner = bearer(unsigned_token(OWNER_UID, email=OWNER, email_verified=True))
    open_app = create_app(base, store=MemoryStore()).test_client()
    assert open_app.get("/api/trades", headers=other).status_code == 200
    closed = create_app({**base, ALLOWED_EMAILS_VAR: OWNER}, store=MemoryStore()).test_client()
    assert closed.get("/api/trades", headers=other).status_code == 403
    assert closed.get("/api/trades", headers=owner).status_code == 200
