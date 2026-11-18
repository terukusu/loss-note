"""明細の読み取りの ``federation``（Workload Identity Federation。Issue #55・ADR-0011）で使う Google の ID トークン。

Cloud Run の実行用 SA の ID トークンを、インスタンスのメタデータ サーバーから要求ごとに取る（audience は
Anthropic の文書の ``https://api.anthropic.com``、``format=full`` で ``email`` の主張を含める）。
取ったトークンは送り口が要求ごとの一時ディレクトリのファイルに書いて子（CLI）に渡し、読み取りが終われば消える（保存しない）。

- 依存を足さない（標準の urllib）。メタデータ サーバーへはプロキシを通さない（環境変数のプロキシを使わない）
- 応答の形（JWT の 3 つの base64url の部分・16 KiB 以下）だけを確かめる。署名は Anthropic が確かめる
- 失敗は ``IdentityTokenUnavailable``（理由の短い名前だけ。応答の本文・例外の文言・トークンを持たない）
"""

import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from statement_read.agent_reader import IDENTITY_TOKEN_AUDIENCE

METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
)
# Anthropic のトークン交換が受ける JWT の上限（WIF reference「JWT verification」の Maximum size）
MAX_TOKEN_BYTES = 16 * 1024
TIMEOUT_SECONDS = 3.0
_JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


class IdentityTokenUnavailable(RuntimeError):
    """ID トークンを取れない。args[0] は理由の短い名前だけ"""


def identity_url(audience: str = IDENTITY_TOKEN_AUDIENCE) -> str:
    """メタデータ サーバーの ID トークンの URL（audience と format=full）"""
    return f"{METADATA_IDENTITY_URL}?{urllib.parse.urlencode({'audience': audience, 'format': 'full'})}"


def check_token(raw: bytes) -> str:
    """応答の本文 → ID トークン。JWT の形でなければ IdentityTokenUnavailable"""
    if len(raw) > MAX_TOKEN_BYTES:
        raise IdentityTokenUnavailable("too_large")
    try:
        text = raw.decode("ascii").strip()
    except UnicodeDecodeError:
        raise IdentityTokenUnavailable("shape") from None
    if not text or len(text) > MAX_TOKEN_BYTES or not _JWT.match(text):
        raise IdentityTokenUnavailable("shape")
    return text


def _default_open(req: urllib.request.Request, timeout: float):
    # 環境変数のプロキシを使わない（メタデータ サーバーはインスタンスの中から直接）
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(req, timeout=timeout)


def fetch_gcp_identity_token(
    audience: str = IDENTITY_TOKEN_AUDIENCE,
    *,
    open_fn: Callable | None = None,
    timeout: float = TIMEOUT_SECONDS,
) -> str:
    """メタデータ サーバーから ID トークンを取る。open_fn はテスト用（urllib の opener.open と同じ形）"""
    req = urllib.request.Request(identity_url(audience), headers={"Metadata-Flavor": "Google"})
    try:
        with (open_fn or _default_open)(req, timeout) as res:
            status = getattr(res, "status", None)
            if status != 200:
                raise IdentityTokenUnavailable("status")
            raw = res.read(MAX_TOKEN_BYTES + 1)
    except IdentityTokenUnavailable:
        raise
    except (urllib.error.URLError, OSError, ValueError):
        raise IdentityTokenUnavailable("unreachable") from None
    return check_token(raw)
