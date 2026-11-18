"""federation の ID トークンの取得（Issue #55）。メタデータ サーバーには出ない（open_fn を差し替える）。
値はすべて架空。"""

import urllib.error
import urllib.parse

import pytest

from loss_note_api import identity_token

TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl"


class _Res:
    def __init__(self, body: bytes, status: int = 200):
        self._body, self.status = body, status

    def read(self, n=-1):
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_url_and_header():
    seen = {}

    def open_fn(req, timeout):
        seen["url"], seen["headers"], seen["timeout"] = req.full_url, dict(req.header_items()), timeout
        return _Res(TOKEN.encode())

    assert identity_token.fetch_gcp_identity_token(open_fn=open_fn) == TOKEN
    url = urllib.parse.urlsplit(seen["url"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == identity_token.METADATA_IDENTITY_URL
    assert urllib.parse.parse_qs(url.query) == {"audience": ["https://api.anthropic.com"], "format": ["full"]}
    assert seen["headers"] == {"Metadata-flavor": "Google"}
    assert 0 < seen["timeout"] <= 5


def test_trailing_newline_is_trimmed():
    assert identity_token.fetch_gcp_identity_token(open_fn=lambda r, t: _Res(TOKEN.encode() + b"\n")) == TOKEN


@pytest.mark.parametrize(("body", "status", "reason"), [
    (b"", 200, "shape"),
    (b"not a token", 200, "shape"),
    (b"a.b", 200, "shape"),
    ("ey.日本.x".encode(), 200, "shape"),
    (b"a." * 9000 + b"b", 200, "too_large"),
    (TOKEN.encode(), 500, "status"),
])
def test_bad_responses(body, status, reason):
    with pytest.raises(identity_token.IdentityTokenUnavailable) as e:
        identity_token.fetch_gcp_identity_token(open_fn=lambda r, t: _Res(body, status))
    assert e.value.args == (reason,)


@pytest.mark.parametrize("exc", [urllib.error.URLError("MARKER-down"), TimeoutError("MARKER-slow"),
                                 ConnectionRefusedError("MARKER-refused")])
def test_unreachable_has_no_detail(exc):
    def open_fn(req, timeout):
        raise exc

    with pytest.raises(identity_token.IdentityTokenUnavailable) as e:
        identity_token.fetch_gcp_identity_token(open_fn=open_fn)
    assert e.value.args == ("unreachable",) and "MARKER" not in repr(e.value)
    assert e.value.__cause__ is None
