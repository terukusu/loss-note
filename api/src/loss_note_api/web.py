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
- ホーム画面に追加（#77・ADR-0018）: manifest と manifest のアイコンを直下の決まった名前（``ROOT_FILES``）で配り、
  CSP に ``manifest-src 'self'`` を持つ。サービスワーカーは置かないので ``worker-src`` は足さない
  （``default-src 'none'`` のまま止める）
- 数字の書体（#237・ADR-0026）: 同梱の woff2（``/assets/`` の名前にハッシュの付いたファイル）を読むため、CSP に
  ``font-src 'self'`` を持つ（data: と外部は許さない）
- ログインの許可（#43・ADR-0003「縦切り 2 で決めたこと」）: Google ログインのポップアップが使う 4 つだけを
  ``login_csp_extra`` で足す（gapi の script・authDomain の iframe・Identity Toolkit と Secure Token の API）。
  authDomain は環境変数 ``FIREBASE_AUTH_DOMAIN`` から受け、ホスト名の形だけを通す（``valid_auth_domain``）
"""

import re
from collections.abc import Mapping
from pathlib import Path

from flask import Flask, Response, send_from_directory

from loss_note_api.runtime import StartupRefused

STATIC_DIR_VAR = "STATIC_DIR"
AUTH_DOMAIN_VAR = "FIREBASE_AUTH_DOMAIN"

# R3 の 8 つの指示と manifest-src（#77）・font-src（同梱の数字の書体。#237・ADR-0026）。順は固定（default-src を
# 先頭に）。画面は同じオリジンの同梱ファイルと /api だけを使う
BASE_CSP: Mapping[str, tuple[str, ...]] = {
    "default-src": ("'none'",),
    "script-src": ("'self'",),
    "style-src": ("'self'",),
    "img-src": ("'self'",),
    "font-src": ("'self'",),
    "connect-src": ("'self'",),
    "manifest-src": ("'self'",),
    "base-uri": ("'none'",),
    "form-action": ("'none'",),
    "frame-ancestors": ("'none'",),
}

# Google ログインのポップアップ（signInWithPopup）が使う外部（@firebase/auth の実装で確かめたもの）
GAPI_ORIGIN = "https://apis.google.com"
AUTH_API_ORIGINS = ("https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com")

# 小文字の英数字・ハイフンのラベルを点でつなぐ（点が 1 つ以上・ラベル 63 字・全体 253 字）。
# スキーム・ポート・ワイルドカード・空白・区切り（; ,）を受けない（CSP のヘッダへの差し込みを塞ぐ）
_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_AUTH_DOMAIN = re.compile(rf"^{_LABEL}(?:\.{_LABEL})+$")

INDEX_CACHE = "no-cache"
ASSET_CACHE = "public, max-age=31536000, immutable"

# 置き場の直下で配るアイコンと manifest（ui/public/ から dist の直下に入る。名前にハッシュが無いので
# 1 日だけ持たせる。#52・#77）。ブラウザ・iOS は link が無くても /favicon.ico・/apple-touch-icon.png を
# 取りに来るので、index.html に戻さない
ROOT_FILES = (
    "favicon.ico",
    "favicon.svg",
    "apple-touch-icon.png",
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
)
ROOT_FILE_CACHE = "public, max-age=86400"
# 拡張子から決まらない（Python の mimetypes が知らない）ものだけ Content-Type を決める
ROOT_FILE_TYPES: Mapping[str, str] = {"manifest.webmanifest": "application/manifest+json"}
# /assets/ の拡張子のうち、Python 3.13 の mimetypes が知らない（端末の /etc/mime.types しだいの）もの。イメージの
# python には mime.types が無く、同梱の数字の書体（#237）が application/octet-stream になるので決めておく
ASSET_TYPES: Mapping[str, str] = {".woff2": "font/woff2"}

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


def valid_auth_domain(value: str) -> bool:
    """authDomain としてヘッダに入れてよい形か（ホスト名だけ）"""
    return len(value) <= 253 and bool(_AUTH_DOMAIN.fullmatch(value))


def login_csp_extra(auth_domain: str) -> dict[str, tuple[str, ...]]:
    """Google ログインのポップアップに要る許可（build_csp の extra）。
    形の合わない authDomain は ValueError（文言に値を入れない）"""
    if not valid_auth_domain(auth_domain):
        raise ValueError(f"{AUTH_DOMAIN_VAR} はホスト名の形で指定する")
    return {
        "script-src": (GAPI_ORIGIN,),
        "connect-src": AUTH_API_ORIGINS,
        "frame-src": (f"https://{auth_domain}",),
    }


def security_headers(csp: str) -> dict[str, str]:
    """すべての応答に付けるヘッダ"""
    return {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    }


def is_spa_path(path: str) -> bool:
    """index.html に戻してよいパスか（/api・/assets の配下と、直下のアイコンは戻さない）"""
    for prefix in ("/api", "/assets"):
        if path == prefix or path.startswith(prefix + "/"):
            return False
    return path.lstrip("/") not in ROOT_FILES


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
        res = send_from_directory(assets, name, mimetype=ASSET_TYPES.get(Path(name).suffix.lower()))
        res.headers["Cache-Control"] = ASSET_CACHE
        return res

    def root_file(name: str):
        # 名前は ROOT_FILES の決まった値だけ。置き場に無ければ NotFound（→ 404 の JSON。index.html に戻さない）
        res = send_from_directory(root, name, mimetype=ROOT_FILE_TYPES.get(name))
        res.headers["Cache-Control"] = ROOT_FILE_CACHE
        return res

    for name in ROOT_FILES:
        app.add_url_rule(f"/{name}", f"root_file_{name}", root_file, methods=["GET"], defaults={"name": name})

    return StaticSite(root)
