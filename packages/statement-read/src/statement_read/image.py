"""画像の上限（option-simulator の ADR-0009 と同じ）と形式の判定。純関数・I/O なし・Pillow なし"""

MAX_EDGE = 2000
MAX_BYTES = 500_000
PNG_SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SIG = b"\xff\xd8\xff"


def media_type_of(data: bytes) -> str | None:
    if data.startswith(PNG_SIG):
        return "image/png"
    if data.startswith(JPEG_SIG):
        return "image/jpeg"
    return None


# JPEG の SOF（フレームの始まり。寸法を持つ）。C4 = DHT・C8 = JPG（予約）・CC = DAC は SOF ではない
_JPEG_SOF = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
# 長さを持たない marker（TEM・RST0〜7・SOI）
_JPEG_STANDALONE = frozenset({0x01, 0xD8, *range(0xD0, 0xD8)})


def _png_info(data: bytes) -> tuple[str, int, int] | None:
    # 署名(8) + 長さ(4) = 13 + "IHDR" + 幅(4) + 高さ(4) + …
    if len(data) < 24 or data[8:12] != b"\x00\x00\x00\x0d" or data[12:16] != b"IHDR":
        return None
    return "image/png", int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _jpeg_info(data: bytes) -> tuple[str, int, int] | None:
    i, n = 2, len(data)
    while i < n:
        if data[i] != 0xFF:
            return None
        while i < n and data[i] == 0xFF:  # 詰め物の FF を飛ばす
            i += 1
        if i >= n:
            return None
        marker = data[i]
        i += 1
        if marker in _JPEG_STANDALONE:
            continue
        if marker in (0xD9, 0xDA):  # SOF より前に EOI・SOS
            return None
        if i + 2 > n:
            return None
        length = int.from_bytes(data[i : i + 2], "big")
        if length < 2 or i + length > n:
            return None
        if marker in _JPEG_SOF:
            if length < 7:
                return None
            height = int.from_bytes(data[i + 3 : i + 5], "big")
            width = int.from_bytes(data[i + 5 : i + 7], "big")
            return "image/jpeg", width, height
        i += length
    return None


def image_info(data: bytes) -> tuple[str, int, int] | None:
    """(media_type, 幅 px, 高さ px)。PNG は IHDR、JPEG は SOF から読む。読めなければ None（例外を出さない）"""
    mt = media_type_of(data)
    if mt == "image/png":
        return _png_info(data)
    if mt == "image/jpeg":
        return _jpeg_info(data)
    return None


def check_limits(data: bytes, content_type: str | None) -> str | None:
    """上限を破る理由（"bytes" / "format" / "dimensions"）か None（上限の内）。
    0 B → format、MAX_BYTES 超 → bytes、署名が PNG / JPEG でない・Content-Type と違う → format、
    寸法を読めない・幅か高さが 0・長辺が MAX_EDGE 超 → dimensions。境目（MAX_BYTES・MAX_EDGE ちょうど）は通す"""
    if not data:
        return "format"
    if len(data) > MAX_BYTES:
        return "bytes"
    mt = media_type_of(data)
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    if mt is None or declared != mt:
        return "format"
    info = image_info(data)
    if info is None:
        return "dimensions"
    _, width, height = info
    if width <= 0 or height <= 0 or max(width, height) > MAX_EDGE:
        return "dimensions"
    return None
