"""本番の配信（Issue #42）: 画面の静的ファイルと API を 1 つのアプリで配る振り分け・キャッシュ・
全応答のヘッダ・本番の起動。

- 静的の置き場は tmp に作る合成のもの（index.html と assets/app-0000aaaa.js。中身は架空の印だけ）
- AC-1（例 S・R1・R2）・AC-2（例 S12・R4）・AC-3（例 H1・R3）・KEEP-2（STATIC_DIR が無ければ今のまま）
- #77: manifest とそのアイコンの配信（例 E1〜E5）・CSP の manifest-src（例 E7。worker-src は無い）
"""

from pathlib import Path

import pytest
from helpers.memory_store import MemoryStore
from helpers.tokens import bearer, patch_certs, unsigned_token

from loss_note_api import web
from loss_note_api.app import create_app
from loss_note_api.runtime import AUTH_EMULATOR, FIRESTORE_EMULATOR, StartupRefused, decide_runtime

PROD = "example-prod"
INDEX = b"<!doctype html><html><head><title>t</title></head><body><div id=app></div>INDEX-MARK-7c1</body></html>\n"
ASSET = b"console.log('ASSET-MARK-2b9');\n"
ASSET_PATH = "/assets/app-0000aaaa.js"
# 直下のアイコン（#52）。中身は架空の印（ICO の頭の 4 バイト + 印）
ICON = b"\x00\x00\x01\x00ICON-MARK-4e2"
# manifest と manifest のアイコン（#77）。中身は架空の印
MANIFEST = b'{"name":"MANIFEST-MARK-8a3"}\n'
PNG = b"\x89PNG\r\n\x1a\nPNG-MARK-1f6"
MANIFEST_ICONS = ("icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png")
EMULATOR_VARS = (AUTH_EMULATOR, FIRESTORE_EMULATOR, "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST")

R3 = {
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
}


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    root = tmp_path / "static"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_bytes(INDEX)
    (root / "assets" / "app-0000aaaa.js").write_bytes(ASSET)
    (root / "favicon.ico").write_bytes(ICON)
    (root / "manifest.webmanifest").write_bytes(MANIFEST)
    for name in MANIFEST_ICONS:
        (root / name).write_bytes(PNG)
    # 置き場の外のファイル（S8: これを返さない）
    (tmp_path / "secret.txt").write_bytes(b"OUTSIDE-MARK-5d3\n")
    return root


@pytest.fixture
def prod_env(monkeypatch):
    """本番と同じ形: エミュレーターの接続先が無く、プロジェクト ID が demo- でない（プロセスの環境からも消す）"""
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    return {"GOOGLE_CLOUD_PROJECT": PROD}


@pytest.fixture
def client(prod_env, static_dir):
    app = create_app({**prod_env, "STATIC_DIR": str(static_dir)}, store=MemoryStore())
    return app.test_client()


def is_index(res) -> bool:
    return res.data == INDEX


def csp_directives(res) -> set[str]:
    return {d.strip() for d in res.headers.get("Content-Security-Policy", "").split(";") if d.strip()}


# ── AC-1: 例 S の振り分けとキャッシュ ─────────────────────
@pytest.mark.parametrize(
    "case,path",
    [
        ("S1", "/"),
        ("S2", "/trades/abc123"),
        ("S3", "/login?next=%2Ftrades"),
        ("S4", "/settings/unknown/deep"),
        ("S5", "/dev/parts"),
        ("other", "/apix"),
        ("other", "/assetsx/a.js"),
    ],
)
def test_spa_paths_return_index(client, case, path):
    res = client.get(path)
    assert res.status_code == 200, case
    assert is_index(res), case
    assert res.mimetype == "text/html"
    assert res.headers["Cache-Control"] == "no-cache"


def test_spa_s6_asset_is_immutable(client):
    res = client.get(ASSET_PATH)
    assert res.status_code == 200
    assert res.data == ASSET
    assert res.mimetype in ("text/javascript", "application/javascript")
    cache = {p.strip() for p in res.headers["Cache-Control"].split(",")}
    assert {"public", "max-age=31536000", "immutable"} <= cache
    assert "no-store" not in cache


@pytest.mark.parametrize("path", ["/assets/missing-0000.js", "/assets/", "/assets/sub/missing.css"])
def test_spa_s7_missing_asset_is_404_json(client, path):
    res = client.get(path)
    assert res.status_code == 404
    assert not is_index(res)
    assert res.get_json() == {"error": "not_found"}


# ── 直下のアイコン（#52）: /favicon.ico は index.html でなくアイコンを返し、無いアイコンは 404 の JSON
def test_root_icon_is_served_not_index(client):
    res = client.get("/favicon.ico")
    assert res.status_code == 200
    assert res.data == ICON
    assert not is_index(res)
    assert res.mimetype in ("image/vnd.microsoft.icon", "image/x-icon")
    assert res.headers["Cache-Control"] == web.ROOT_FILE_CACHE
    assert "img-src 'self'" in csp_directives(res)
    head = client.head("/favicon.ico")
    assert head.status_code == 200
    assert head.data == b""


@pytest.mark.parametrize("path", ["/apple-touch-icon.png", "/favicon.svg"])
def test_root_icon_missing_is_404_json(client, path):
    res = client.get(path)
    assert res.status_code == 404
    assert not is_index(res)
    assert res.get_json() == {"error": "not_found"}


# ── manifest とアイコン（#77。例 E1〜E5）
def test_manifest_is_served_not_index(client):
    res = client.get("/manifest.webmanifest")
    assert res.status_code == 200
    assert res.data == MANIFEST
    assert not is_index(res)
    assert res.mimetype == "application/manifest+json"
    assert res.headers["Cache-Control"] == web.ROOT_FILE_CACHE
    assert "manifest-src 'self'" in csp_directives(res)
    head = client.head("/manifest.webmanifest")
    assert head.status_code == 200
    assert head.data == b""


@pytest.mark.parametrize("name", MANIFEST_ICONS)
def test_manifest_icons_are_served_not_index(client, name):
    res = client.get(f"/{name}")
    assert res.status_code == 200
    assert res.data == PNG
    assert res.mimetype == "image/png"
    assert res.headers["Cache-Control"] == web.ROOT_FILE_CACHE


@pytest.mark.parametrize("name", ("manifest.webmanifest", *MANIFEST_ICONS))
def test_manifest_files_missing_are_404_json(client, static_dir, name):
    (static_dir / name).unlink()
    res = client.get(f"/{name}")
    assert res.status_code == 404
    assert not is_index(res)
    assert res.get_json() == {"error": "not_found"}


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
def test_manifest_rejects_non_get(client, method):
    res = client.open("/manifest.webmanifest", method=method)
    assert res.status_code == 405
    assert not is_index(res)


def test_manifest_lookalike_is_index(client):
    # 似た知らない名前は今までどおり画面の経路の戻し（例 E4）
    res = client.get("/manifest.webmanifestx")
    assert res.status_code == 200
    assert is_index(res)


def test_root_icon_rejects_post(client):
    res = client.post("/favicon.ico")
    assert res.status_code == 405
    assert not is_index(res)


@pytest.mark.parametrize(
    "path",
    [
        "/assets/../index.html",
        "/assets/../../secret.txt",
        "/assets/%2e%2e/index.html",
        "/assets/..%2f..%2fsecret.txt",
        "/assets//etc/passwd",
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/secret.txt",
        "/index.html/../../secret.txt",
    ],
)
def test_spa_s8_outside_is_404_or_index(client, path):
    """S8: ディレクトリの外を指しても、404 か index.html のどちらかで、ほかのファイルを返さない。
    続く / の重なり（//）は Werkzeug が同じオリジンの 1 つの / へ 308 で寄せるので、寄せた先で見る"""
    res = client.get(path, follow_redirects=True)
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert is_index(res)
    assert b"OUTSIDE-MARK" not in res.data
    assert b"root:" not in res.data


def test_spa_s9_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}
    assert res.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("path", ["/api/nope", "/api", "/api/", "/api/unknown/deep"])
def test_spa_s10_unknown_api_is_404_json(client, path):
    res = client.get(path)
    assert res.status_code == 404
    assert not is_index(res)
    assert res.get_json() == {"error": "not_found"}
    assert res.headers["Cache-Control"] == "no-store"


def test_spa_s10_post_unknown_api_is_404_json(client):
    # 404 の中で戻すので、/api/ の無い入口は POST でも今の 404 の JSON（catch-all の 405 にならない）
    res = client.post("/api/nope", json={})
    assert res.status_code == 404
    assert res.get_json() == {"error": "not_found"}


def test_spa_s11_trades_without_token_is_401(client):
    res = client.get("/api/trades")
    assert res.status_code == 401
    assert not is_index(res)


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH"])
@pytest.mark.parametrize("path", ["/trades", "/", "/settings/unknown/deep"])
def test_spa_s13_non_get_is_4xx_not_index(client, method, path):
    res = client.open(path, method=method)
    assert 400 <= res.status_code < 500
    assert not is_index(res)
    assert res.is_json


def test_spa_s13_post_asset_is_4xx(client):
    res = client.post(ASSET_PATH)
    assert 400 <= res.status_code < 500
    assert res.data != ASSET


def test_spa_s14_head_has_no_body(client):
    res = client.head("/trades/abc123")
    assert res.status_code == 200
    assert res.data == b""
    assert res.mimetype == "text/html"
    assert res.headers["Cache-Control"] == "no-cache"


def test_spa_head_asset_has_no_body(client):
    res = client.head(ASSET_PATH)
    assert res.status_code == 200
    assert res.data == b""


def test_spa_index_conditional_get_is_304(client):
    # index.html は no-cache（毎回確かめる）。ETag が合えば 304
    first = client.get("/")
    etag = first.headers.get("ETag")
    assert etag
    again = client.get("/", headers={"If-None-Match": etag})
    assert again.status_code == 304


def test_static_dir_without_index_refuses_startup(prod_env, tmp_path):
    """index.html の無い置き場では起動しない（Cloud Run の新しいリビジョンが Ready にならず、前が残る）"""
    empty = tmp_path / "empty"
    (empty / "assets").mkdir(parents=True)
    with pytest.raises(StartupRefused):
        create_app({**prod_env, "STATIC_DIR": str(empty)}, store=MemoryStore())


def test_static_dir_missing_refuses_startup(prod_env, tmp_path):
    with pytest.raises(StartupRefused):
        create_app({**prod_env, "STATIC_DIR": str(tmp_path / "nope")}, store=MemoryStore())


def test_static_error_message_has_no_path(prod_env, tmp_path):
    with pytest.raises(StartupRefused) as e:
        create_app({**prod_env, "STATIC_DIR": str(tmp_path / "nope")}, store=MemoryStore())
    assert str(tmp_path) not in str(e.value)


# ── KEEP-2: STATIC_DIR が無ければ静的配信は無効（今のまま） ─────────────
@pytest.mark.parametrize("static", [None, ""])
def test_no_static_dir_keeps_404(prod_env, static):
    env = dict(prod_env)
    if static is not None:
        env["STATIC_DIR"] = static
    c = create_app(env, store=MemoryStore()).test_client()
    for path in ("/", "/trades/abc123", ASSET_PATH):
        res = c.get(path)
        assert res.status_code == 404, path
        assert res.get_json() == {"error": "not_found"}


def test_no_static_dir_unconfigured_keeps_404(monkeypatch):
    for name in EMULATOR_VARS:
        monkeypatch.delenv(name, raising=False)
    c = create_app({}).test_client()
    assert c.get("/").status_code == 404
    assert c.get("/api/health").status_code == 200


# ── AC-2: 本番の環境変数の形で verify・401 ─────────────────
def test_prod_env_is_verify_and_401(prod_env, static_dir, monkeypatch):
    assert decide_runtime(prod_env).mode == "verify"
    patch_certs(monkeypatch, forbid=True)
    for env in (prod_env, {**prod_env, "STATIC_DIR": str(static_dir)}):
        c = create_app(env, store=MemoryStore()).test_client()
        res = c.get("/api/trades")
        assert res.status_code == 401
        res = c.get("/api/trades", headers=bearer(unsigned_token("fake-ac2", PROD)))
        assert res.status_code == 401
        assert res.status_code != 503


def test_prod_env_statement_read_is_unavailable(client):
    """R4: 読み取りの入口もトークンの検査が先（トークンなしは 401。資格情報が無いときの 503 はその後）"""
    res = client.post("/api/statement-reads", data=b"x", content_type="image/png")
    assert res.status_code == 401


# ── AC-3: 全応答のヘッダ（例 H1） ─────────────────────────
@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/"),
        ("GET", "/trades/abc123"),
        ("HEAD", "/trades/abc123"),
        ("GET", ASSET_PATH),
        ("GET", "/api/health"),
        ("GET", "/api/nope"),
        ("GET", "/assets/missing-0000.js"),
        ("GET", "/api/trades"),
        ("POST", "/trades"),
        ("POST", ASSET_PATH),
    ],
)
def test_security_headers_on_every_response(client, method, path):
    res = client.open(path, method=method)
    assert R3 <= csp_directives(res), (path, res.headers.get("Content-Security-Policy"))
    # サービスワーカー・ワーカーは許さない（#77・ADR-0018。default-src 'none' で止まる）
    assert not any(d.startswith("worker-src") for d in csp_directives(res))
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["Referrer-Policy"] == "no-referrer"


def test_security_headers_without_static(prod_env):
    c = create_app(prod_env, store=MemoryStore()).test_client()
    for path in ("/", "/api/health", "/api/nope"):
        res = c.get(path)
        assert R3 <= csp_directives(res), path
        assert res.headers["X-Content-Type-Options"] == "nosniff"
        assert res.headers["Referrer-Policy"] == "no-referrer"


def test_security_headers_on_internal_error(prod_env, static_dir):
    app = create_app({**prod_env, "STATIC_DIR": str(static_dir)}, store=MemoryStore())

    @app.get("/api/boom-for-test")
    def boom():
        raise RuntimeError("boom")

    res = app.test_client().get("/api/boom-for-test")
    assert res.status_code == 500
    assert R3 <= csp_directives(res)
    assert res.headers["Referrer-Policy"] == "no-referrer"


# ── build_csp（純関数） ───────────────────────────────
def test_build_csp_base_has_r3_in_fixed_order():
    csp = web.build_csp(web.BASE_CSP)
    parts = [p.strip() for p in csp.split(";")]
    assert set(parts) == R3
    assert parts[0] == "default-src 'none'"
    assert web.build_csp(web.BASE_CSP) == csp  # 同じ入力なら同じ文字列


def test_build_csp_extra_adds_values_without_duplicates():
    # #43 が足す口: 指示に値を足す・新しい指示を足す（値は架空）
    csp = web.build_csp(
        web.BASE_CSP,
        {"connect-src": ("'self'", "https://example.invalid"), "frame-src": ("https://example.invalid",)},
    )
    parts = {p.strip() for p in csp.split(";")}
    assert "connect-src 'self' https://example.invalid" in parts
    assert "frame-src https://example.invalid" in parts
    assert "script-src 'self'" in parts
    # 元の辞書は変えない
    assert web.BASE_CSP["connect-src"] == ("'self'",)


@pytest.mark.parametrize("bad", ["a;b", "a,b", "a\nb", ""])
def test_build_csp_rejects_values_that_break_the_header(bad):
    with pytest.raises(ValueError):
        web.build_csp(web.BASE_CSP, {"connect-src": (bad,)})


def test_security_headers_shape():
    h = web.security_headers(web.build_csp(web.BASE_CSP))
    assert set(h) == {"Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"}


def test_is_spa_path():
    assert web.is_spa_path("/")
    assert web.is_spa_path("/trades/abc123")
    assert web.is_spa_path("/apix")
    assert web.is_spa_path("/favicon.icox")
    assert web.is_spa_path("/manifest.webmanifestx")
    for p in ("/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/manifest.webmanifest",
              "/icon-maskable-512.png"):  # fmt: skip
        assert not web.is_spa_path(p), p
    for p in ("/api", "/api/", "/api/nope", "/assets/", "/assets/a.js"):
        assert not web.is_spa_path(p), p
