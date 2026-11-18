"""本番の配信（Issue #42・ADR-0009）: 画面のビルド成果物（STATIC_DIR）を API と同じアプリから配る部分と、
全応答のヘッダ。

- 振り分け（R1）: ``/assets/<path>`` はビルド成果物のファイルだけ（``send_from_directory`` = safe_join。
  無い・外は 404 の JSON）。どのルールにも当たらない GET / HEAD で ``/api``・``/assets`` とその配下でない
  パスは ``index.html``（ADR-0002）。戻しは catch-all のルートではなく 404 の扱いの中で行う
  （catch-all だと ``POST /api/nope`` が 405 になり、/api の 404 の JSON を崩す）
- キャッシュ（R2）: ``index.html`` は ``no-cache``（毎回確かめる。ETag で 304）、``/assets/`` は名前に
  ハッシュを持つので ``immutable``
- ヘッダ（R3）: CSP の土台と ``nosniff``・``no-referrer`` をすべての応答に付ける。CSP は指示 → 値の辞書
  （``BASE_CSP``）と純関数 ``build_csp`` で組み立てる。ログインに要る許可（#43）は ``build_csp`` の
  ``extra`` で足す（ここには値を持たない）
"""

from collections.abc import Mapping
from pathlib import Path

from flask import Flask, Response, send_from_directory

from loss_note_api.runtime import StartupRefused

STATIC_DIR_VAR = "STATIC_DIR"

# R3 の 8 つの指示（順は固定。default-src を先頭に）。画面は同じオリジンの同梱ファイルと /api だけを使う
BASE_CSP: Mapping[str, tuple[str, ...]] = {
    "default-src": ("'none'",),
    "script-src": ("'self'",),
    "style-src": ("'self'",),
    "img-src": ("'self'",),
    "connect-src": ("'self'",),
    "base-uri": ("'none'",),
    "form-action": ("'none'",),
    "frame-ancestors": ("'none'",),
}

INDEX_CACHE = "no-cache"
ASSET_CACHE = "public, max-age=31536000, immutable"

# ヘッダの区切り（; ,）・改行・空白を値に入れない（指示を足す・壊すことを防ぐ）
_FORBIDDEN_IN_VALUE = (";", ",", "\n", "\r", " ", "\t")


def build_csp(
    directives: Mapping[str, tuple[str, ...]], extra: Mapping[str, tuple[str, ...]] | None = None
) -> str:
    """指示 → 値の辞書を CSP のヘッダの値にする（純関数）。extra の値は同じ指示の後ろに足し、重複を除く。
    指示の順は directives の順 → extra にだけある指示の順"""
    merged: dict[str, list[str]] = {}
    for source in (directives, extra or {}):
        for name, values in source.items():
            bucket = merged.setdefault(name, [])
            for v in values:
                if not v or any(c in v for c in _FORBIDDEN_IN_VALUE):
                    raise ValueError("CSP の値に空・区切り・空白は使えない")
                if v not in bucket:
                    bucket.append(v)
    return "; ".join(f"{name} {' '.join(values)}" if values else name for name, values in merged.items())


def security_headers(csp: str) -> dict[str, str]:
    """すべての応答に付けるヘッダ"""
    return {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    }


def is_spa_path(path: str) -> bool:
    """index.html に戻してよいパスか（/api・/assets の配下は戻さない）"""
    for prefix in ("/api", "/assets"):
        if path == prefix or path.startswith(prefix + "/"):
            return False
    return True


class StaticSite:
    """STATIC_DIR の置き場。index.html を返す応答を作る"""

    def __init__(self, root: Path):
        self.root = root

    def index(self) -> Response:
        res = send_from_directory(self.root, "index.html", max_age=0)
        res.headers["Cache-Control"] = INDEX_CACHE
        return res


def register_static(app: Flask, static_dir: str) -> StaticSite:
    """/assets/ の配信を足す。index.html が無ければ起動しない（文言にパスを入れない）"""
    root = Path(static_dir).resolve()
    if not (root / "index.html").is_file():
        raise StartupRefused(f"{STATIC_DIR_VAR} の置き場に index.html がありません")
    assets = root / "assets"

    @app.get("/assets/<path:name>")
    def assets_file(name: str):
        # send_from_directory はディレクトリの外（..・絶対パス）と無いファイルを NotFound にする（→ 404 の JSON）
        res = send_from_directory(assets, name)
        res.headers["Cache-Control"] = ASSET_CACHE
        return res

    return StaticSite(root)
